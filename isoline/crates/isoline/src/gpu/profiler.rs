//! GPU timestamp profiling plus CPU frame timing.

use crossbeam_channel::{Receiver, Sender};
use std::collections::{HashMap, VecDeque};
use web_time::Instant;

const MAX_QUERIES: u32 = 32;
const HISTORY: usize = 240;

struct Frame {
    buffer: wgpu::Buffer,
    names: Vec<(String, u32)>,
    in_flight: bool,
}

pub struct GpuProfiler {
    query_set: Option<wgpu::QuerySet>,
    resolve: Option<wgpu::Buffer>,
    frames: Vec<Frame>,
    /// Slot resolved by the last `end_frame`, waiting to be mapped after submit.
    pending: Option<usize>,
    next_query: u32,
    names: Vec<(String, u32)>,
    period_ns: f32,
    tx: Sender<(usize, bool)>,
    rx: Receiver<(usize, bool)>,
    /// Latest GPU pass timings in milliseconds.
    pub gpu_ms: HashMap<String, f32>,
    pub enabled: bool,
}

impl GpuProfiler {
    pub fn new(device: &wgpu::Device, queue: &wgpu::Queue, timestamps_supported: bool) -> Self {
        let (tx, rx) = crossbeam_channel::unbounded();
        let mut p = Self {
            query_set: None,
            resolve: None,
            frames: Vec::new(),
            pending: None,
            next_query: 0,
            names: Vec::new(),
            period_ns: queue.get_timestamp_period(),
            tx,
            rx,
            gpu_ms: HashMap::new(),
            enabled: timestamps_supported,
        };
        if timestamps_supported {
            p.query_set = Some(device.create_query_set(&wgpu::QuerySetDescriptor {
                label: Some("profiler timestamps"),
                ty: wgpu::QueryType::Timestamp,
                count: MAX_QUERIES,
            }));
            p.resolve = Some(device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("profiler resolve"),
                size: MAX_QUERIES as u64 * 8,
                usage: wgpu::BufferUsages::QUERY_RESOLVE | wgpu::BufferUsages::COPY_SRC,
                mapped_at_creation: false,
            }));
            for _ in 0..3 {
                p.frames.push(Frame {
                    buffer: device.create_buffer(&wgpu::BufferDescriptor {
                        label: Some("profiler staging"),
                        size: MAX_QUERIES as u64 * 8,
                        usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                        mapped_at_creation: false,
                    }),
                    names: Vec::new(),
                    in_flight: false,
                });
            }
        }
        p
    }

    pub fn begin_frame(&mut self) {
        self.next_query = 0;
        self.names.clear();
    }

    fn alloc(&mut self, name: &str) -> Option<u32> {
        if !self.enabled || self.query_set.is_none() || self.next_query + 2 > MAX_QUERIES {
            return None;
        }
        // Need a free frame slot to receive results.
        if self.frames.iter().all(|f| f.in_flight) {
            return None;
        }
        let i = self.next_query;
        self.next_query += 2;
        self.names.push((name.to_string(), i));
        Some(i)
    }

    pub fn compute_timestamps(&mut self, name: &str) -> Option<wgpu::ComputePassTimestampWrites<'_>> {
        let i = self.alloc(name)?;
        Some(wgpu::ComputePassTimestampWrites {
            query_set: self.query_set.as_ref().unwrap(),
            beginning_of_pass_write_index: Some(i),
            end_of_pass_write_index: Some(i + 1),
        })
    }

    pub fn render_timestamps(&mut self, name: &str) -> Option<wgpu::RenderPassTimestampWrites<'_>> {
        let i = self.alloc(name)?;
        Some(wgpu::RenderPassTimestampWrites {
            query_set: self.query_set.as_ref().unwrap(),
            beginning_of_pass_write_index: Some(i),
            end_of_pass_write_index: Some(i + 1),
        })
    }

    /// Resolve this frame's queries into a staging buffer. Call before submit.
    pub fn end_frame(&mut self, encoder: &mut wgpu::CommandEncoder) {
        if self.next_query == 0 {
            return;
        }
        let Some(slot) = self.frames.iter().position(|f| !f.in_flight) else { return };
        let qs = self.query_set.as_ref().unwrap();
        let resolve = self.resolve.as_ref().unwrap();
        encoder.resolve_query_set(qs, 0..self.next_query, resolve, 0);
        encoder.copy_buffer_to_buffer(resolve, 0, &self.frames[slot].buffer, 0, self.next_query as u64 * 8);
        self.frames[slot].names = std::mem::take(&mut self.names);
        self.frames[slot].in_flight = true;
        self.pending = Some(slot);
    }

    /// Call after submit. Maps only the slot `end_frame` resolved this
    /// frame; a slot already waiting on the GPU must not be mapped twice.
    pub fn after_submit(&mut self) {
        let Some(slot) = self.pending.take() else { return };
        if self.frames.get(slot).map(|f| f.in_flight && !f.names.is_empty()).unwrap_or(false) {
            let tx = self.tx.clone();
            let n = self.frames[slot].names.len() as u64 * 16;
            self.frames[slot].buffer.slice(..n).map_async(wgpu::MapMode::Read, move |r| {
                let _ = tx.send((slot, r.is_ok()));
            });
        }
    }

    /// Collect finished results.
    pub fn poll(&mut self) {
        while let Ok((slot, ok)) = self.rx.try_recv() {
            let f = &mut self.frames[slot];
            if ok {
                let n = f.names.len() as u64 * 16;
                let mapped = f.buffer.slice(..n).get_mapped_range();
                let stamps: &[u64] = bytemuck::cast_slice(&mapped);
                for (name, i) in &f.names {
                    let a = stamps[*i as usize];
                    let b = stamps[*i as usize + 1];
                    let ms = b.saturating_sub(a) as f32 * self.period_ns / 1.0e6;
                    self.gpu_ms.insert(name.clone(), ms);
                }
                drop(mapped);
            }
            f.buffer.unmap();
            f.names.clear();
            f.in_flight = false;
        }
    }
}

/// CPU-side frame statistics.
pub struct CpuStats {
    pub frame_ms: VecDeque<f32>,
    pub sections: HashMap<&'static str, f32>,
    last_frame: Instant,
}

impl Default for CpuStats {
    fn default() -> Self {
        Self::new()
    }
}

impl CpuStats {
    pub fn new() -> Self {
        Self { frame_ms: VecDeque::with_capacity(HISTORY), sections: HashMap::new(), last_frame: Instant::now() }
    }

    pub fn tick(&mut self) {
        let now = Instant::now();
        let ms = now.duration_since(self.last_frame).as_secs_f32() * 1000.0;
        self.last_frame = now;
        if self.frame_ms.len() == HISTORY {
            self.frame_ms.pop_front();
        }
        self.frame_ms.push_back(ms);
    }

    pub fn avg_frame_ms(&self) -> f32 {
        if self.frame_ms.is_empty() {
            0.0
        } else {
            self.frame_ms.iter().sum::<f32>() / self.frame_ms.len() as f32
        }
    }
    pub fn max_frame_ms(&self) -> f32 {
        self.frame_ms.iter().cloned().fold(0.0, f32::max)
    }
}
