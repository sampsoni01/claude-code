//! A scalar field on the GPU plus the tile-granular readback path that keeps
//! the CPU mirror in sync.
//!
//! Sync model: the GPU texture is the authority for brush edits. Every tile a
//! dispatch writes is queued for readback; each frame the queued tiles are
//! copied into a staging buffer, mapped asynchronously, and written into the
//! CPU [`ScalarField`] when the map completes (normally the next frame).
//! CPU → GPU goes the other way through [`GpuField::upload_tiles`] (undo/redo,
//! project load), which never needs a readback because the mirror already
//! holds the value.

use crossbeam_channel::{Receiver, Sender};
use isoline_core::field::{ScalarField, TILE, TILE_TEXELS};
use isoline_core::tiles::TileSet;

pub const TILE_BYTES: u64 = (TILE_TEXELS * 4) as u64;
/// Largest single readback (tiles) per staging slot: 4096 tiles = 64 MiB.
pub const MAX_TILES_PER_SLOT: u32 = 4096;
const SLOTS: usize = 3;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum SlotState {
    Free,
    Encoded,
    InFlight,
}

struct Slot {
    buffer: Option<wgpu::Buffer>,
    capacity: u32,
    tiles: Vec<u32>,
    state: SlotState,
}

pub struct GpuField {
    pub texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    /// Pre-dispatch copy used for neighbourhood reads.
    pub scratch: wgpu::Texture,
    pub scratch_view: wgpu::TextureView,
    width: u32,
    height: u32,
    slots: Vec<Slot>,
    tx: Sender<(usize, bool)>,
    rx: Receiver<(usize, bool)>,
    /// Bytes we have allocated on the device for this field.
    pub device_bytes: u64,
    pub stats: ReadbackStats,
}

#[derive(Default, Clone, Copy, Debug)]
pub struct ReadbackStats {
    pub tiles_in_flight: u32,
    pub tiles_landed_last_frame: u32,
    pub total_tiles_landed: u64,
    pub total_bytes_landed: u64,
}

impl GpuField {
    pub fn new(device: &wgpu::Device, width: u32, height: u32) -> Self {
        let make = |label: &str| {
            device.create_texture(&wgpu::TextureDescriptor {
                label: Some(label),
                size: wgpu::Extent3d { width, height, depth_or_array_layers: 1 },
                mip_level_count: 1,
                sample_count: 1,
                dimension: wgpu::TextureDimension::D2,
                format: wgpu::TextureFormat::R32Float,
                usage: wgpu::TextureUsages::STORAGE_BINDING
                    | wgpu::TextureUsages::TEXTURE_BINDING
                    | wgpu::TextureUsages::COPY_SRC
                    | wgpu::TextureUsages::COPY_DST,
                view_formats: &[],
            })
        };
        let texture = make("elevation");
        let scratch = make("elevation scratch");
        let view = texture.create_view(&Default::default());
        let scratch_view = scratch.create_view(&Default::default());
        let (tx, rx) = crossbeam_channel::unbounded();
        Self {
            texture,
            view,
            scratch,
            scratch_view,
            width,
            height,
            slots: (0..SLOTS).map(|_| Slot { buffer: None, capacity: 0, tiles: Vec::new(), state: SlotState::Free }).collect(),
            tx,
            rx,
            device_bytes: 2 * width as u64 * height as u64 * 4,
            stats: ReadbackStats::default(),
        }
    }

    pub fn width(&self) -> u32 {
        self.width
    }
    pub fn height(&self) -> u32 {
        self.height
    }
    pub fn tiles_x(&self) -> u32 {
        self.width.div_ceil(TILE)
    }

    pub fn tile_origin(&self, tile: u32) -> (u32, u32) {
        let tx = tile % self.tiles_x();
        let ty = tile / self.tiles_x();
        (tx * TILE, ty * TILE)
    }

    fn tile_extent(&self, tile: u32) -> (u32, u32) {
        let (x, y) = self.tile_origin(tile);
        ((self.width - x).min(TILE), (self.height - y).min(TILE))
    }

    /// Upload the whole mirror. Requires `width % 64 == 0` (256-byte rows).
    pub fn upload_all(&self, queue: &wgpu::Queue, field: &ScalarField) {
        assert_eq!(field.width(), self.width);
        assert_eq!(field.height(), self.height);
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.texture,
                mip_level: 0,
                origin: wgpu::Origin3d::ZERO,
                aspect: wgpu::TextureAspect::All,
            },
            bytemuck::cast_slice(field.data()),
            wgpu::TexelCopyBufferLayout {
                offset: 0,
                bytes_per_row: Some(self.width * 4),
                rows_per_image: Some(self.height),
            },
            wgpu::Extent3d { width: self.width, height: self.height, depth_or_array_layers: 1 },
        );
    }

    /// Upload a `TILE×TILE` block for one tile.
    pub fn upload_tile(&self, queue: &wgpu::Queue, tile: u32, data: &[f32]) {
        debug_assert_eq!(data.len(), TILE_TEXELS);
        let (x, y) = self.tile_origin(tile);
        let (w, h) = self.tile_extent(tile);
        queue.write_texture(
            wgpu::TexelCopyTextureInfo {
                texture: &self.texture,
                mip_level: 0,
                origin: wgpu::Origin3d { x, y, z: 0 },
                aspect: wgpu::TextureAspect::All,
            },
            bytemuck::cast_slice(data),
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(TILE * 4), rows_per_image: Some(TILE) },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
    }

    /// Upload the given tiles from the mirror.
    pub fn upload_tiles(&self, queue: &wgpu::Queue, field: &ScalarField, tiles: impl Iterator<Item = u32>) {
        let mut buf = vec![0f32; TILE_TEXELS];
        for t in tiles {
            field.read_tile(t, &mut buf);
            self.upload_tile(queue, t, &buf);
        }
    }

    /// Encode a readback of up to `MAX_TILES_PER_SLOT` tiles from `pending`.
    /// Tiles that were encoded are removed from `pending`. Returns the number
    /// encoded (0 if no staging slot is free this frame).
    pub fn encode_readback(&mut self, device: &wgpu::Device, encoder: &mut wgpu::CommandEncoder, pending: &mut TileSet) -> u32 {
        if pending.is_empty() {
            return 0;
        }
        let Some(si) = self.slots.iter().position(|s| s.state == SlotState::Free) else {
            return 0;
        };
        let tiles: Vec<u32> = pending.iter_indices().take(MAX_TILES_PER_SLOT as usize).collect();
        let n = tiles.len() as u32;
        let slot = &mut self.slots[si];
        if slot.buffer.is_none() || slot.capacity < n {
            let capacity = n.max(64).next_power_of_two().min(MAX_TILES_PER_SLOT);
            if let Some(old) = slot.buffer.take() {
                self.device_bytes -= old.size();
            }
            let buffer = device.create_buffer(&wgpu::BufferDescriptor {
                label: Some("field readback"),
                size: capacity as u64 * TILE_BYTES,
                usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
                mapped_at_creation: false,
            });
            self.device_bytes += buffer.size();
            slot.buffer = Some(buffer);
            slot.capacity = capacity;
        }
        let buffer = slot.buffer.as_ref().unwrap();
        for (i, &t) in tiles.iter().enumerate() {
            let tx = t % self.width.div_ceil(TILE);
            let ty = t / self.width.div_ceil(TILE);
            let x = tx * TILE;
            let y = ty * TILE;
            let w = (self.width - x).min(TILE);
            let h = (self.height - y).min(TILE);
            encoder.copy_texture_to_buffer(
                wgpu::TexelCopyTextureInfo {
                    texture: &self.texture,
                    mip_level: 0,
                    origin: wgpu::Origin3d { x, y, z: 0 },
                    aspect: wgpu::TextureAspect::All,
                },
                wgpu::TexelCopyBufferInfo {
                    buffer,
                    layout: wgpu::TexelCopyBufferLayout {
                        offset: i as u64 * TILE_BYTES,
                        bytes_per_row: Some(TILE * 4),
                        rows_per_image: Some(TILE),
                    },
                },
                wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
            );
            pending.remove_index(t);
        }
        slot.tiles = tiles;
        slot.state = SlotState::Encoded;
        self.stats.tiles_in_flight += n;
        n
    }

    /// Call once after the encoder containing readbacks has been submitted.
    pub fn after_submit(&mut self) {
        for (i, slot) in self.slots.iter_mut().enumerate() {
            if slot.state == SlotState::Encoded {
                let tx = self.tx.clone();
                let n = slot.tiles.len() as u64 * TILE_BYTES;
                slot.buffer.as_ref().unwrap().slice(..n).map_async(wgpu::MapMode::Read, move |r| {
                    let _ = tx.send((i, r.is_ok()));
                });
                slot.state = SlotState::InFlight;
            }
        }
    }

    /// Drain completed readbacks into the mirror. Returns the tiles that landed.
    pub fn collect(&mut self, field: &mut ScalarField) -> Vec<u32> {
        let mut landed = Vec::new();
        while let Ok((i, ok)) = self.rx.try_recv() {
            let slot = &mut self.slots[i];
            let n = slot.tiles.len();
            if ok {
                let buffer = slot.buffer.as_ref().unwrap();
                {
                    let mapped = buffer.slice(..n as u64 * TILE_BYTES).get_mapped_range();
                    let floats: &[f32] = bytemuck::cast_slice(&mapped);
                    for (k, &t) in slot.tiles.iter().enumerate() {
                        field.write_tile(t, &floats[k * TILE_TEXELS..(k + 1) * TILE_TEXELS]);
                    }
                }
                buffer.unmap();
                landed.extend_from_slice(&slot.tiles);
                self.stats.total_tiles_landed += n as u64;
                self.stats.total_bytes_landed += n as u64 * TILE_BYTES;
            } else {
                log::error!("readback map failed for {n} tiles");
            }
            self.stats.tiles_in_flight -= n as u32;
            slot.tiles.clear();
            slot.state = SlotState::Free;
        }
        self.stats.tiles_landed_last_frame = landed.len() as u32;
        landed
    }

    pub fn has_in_flight(&self) -> bool {
        self.slots.iter().any(|s| s.state != SlotState::Free)
    }

    /// Block until every queued readback has landed in the mirror. Used at
    /// stroke start so the undo snapshot reads a current mirror.
    pub fn flush(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, field: &mut ScalarField, pending: &mut TileSet) -> Vec<u32> {
        let mut landed = Vec::new();
        let mut guard = 0;
        while (!pending.is_empty() || self.has_in_flight()) && guard < 64 {
            guard += 1;
            if !pending.is_empty() {
                let mut enc = device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("flush readback") });
                let n = self.encode_readback(device, &mut enc, pending);
                if n > 0 {
                    queue.submit([enc.finish()]);
                    self.after_submit();
                }
            }
            let _ = device.poll(wgpu::PollType::wait_indefinitely());
            landed.extend(self.collect(field));
        }
        landed
    }
}
