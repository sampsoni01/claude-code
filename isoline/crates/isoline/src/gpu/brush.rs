//! Brush compute pass: batches dabs into rect-bounded dispatches.

use super::field::GpuField;
use super::profiler::GpuProfiler;
use bytemuck::{Pod, Zeroable};
use isoline_core::brush::{BlendMode, Dab};
use isoline_core::tiles::{PixelRect, TileSet};

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct Params {
    rect_origin: [u32; 2],
    rect_size: [u32; 2],
    field_size: [u32; 2],
    dab_offset: u32,
    dab_count: u32,
}

/// Dabs per dispatch. Consecutive dabs are spatially close, so small groups
/// keep the bounding rect tight and the per-texel loop short.
const GROUP: usize = 24;
/// Groups per frame (limited by the dynamic-offset uniform buffer).
pub const MAX_GROUPS_PER_FRAME: usize = 64;
pub const MAX_DABS_PER_FRAME: usize = GROUP * MAX_GROUPS_PER_FRAME;
const PARAM_STRIDE: u64 = 256;

pub struct BrushPass {
    pipeline: wgpu::ComputePipeline,
    layout: wgpu::BindGroupLayout,
    params_buf: wgpu::Buffer,
    dab_buf: wgpu::Buffer,
    dab_capacity: usize,
    bind_groups: std::collections::HashMap<&'static str, wgpu::BindGroup>,
    pub last_dispatches: u32,
    pub last_texels: u64,
    pub last_dabs: u32,
}

impl BrushPass {
    pub fn new(device: &wgpu::Device) -> Self {
        let error_scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("brush.wgsl"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/brush.wgsl").into()),
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("brush bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: true,
                        min_binding_size: wgpu::BufferSize::new(std::mem::size_of::<Params>() as u64),
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Storage { read_only: true },
                        has_dynamic_offset: false,
                        min_binding_size: None,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::ReadWrite,
                        format: wgpu::TextureFormat::R32Float,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 3,
                    visibility: wgpu::ShaderStages::COMPUTE,
                    ty: wgpu::BindingType::StorageTexture {
                        access: wgpu::StorageTextureAccess::ReadOnly,
                        format: wgpu::TextureFormat::R32Float,
                        view_dimension: wgpu::TextureViewDimension::D2,
                    },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("brush pl"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_compute_pipeline(&wgpu::ComputePipelineDescriptor {
            label: Some("brush"),
            layout: Some(&pipeline_layout),
            module: &shader,
            entry_point: Some("main"),
            compilation_options: Default::default(),
            cache: None,
        });
        let params_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("brush params"),
            size: PARAM_STRIDE * MAX_GROUPS_PER_FRAME as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        if let Some(e) = pollster::block_on(error_scope.pop()) {
            panic!("brush pipeline failed validation: {e}");
        }
        let dab_capacity = MAX_DABS_PER_FRAME;
        let dab_buf = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("brush dabs"),
            size: (dab_capacity * std::mem::size_of::<Dab>()) as u64,
            usage: wgpu::BufferUsages::STORAGE | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        Self {
            pipeline,
            layout,
            params_buf,
            dab_buf,
            dab_capacity,
            bind_groups: Default::default(),
            last_dispatches: 0,
            last_texels: 0,
            last_dabs: 0,
        }
    }

    /// (Re)bind a named paintable field. Call when the field is replaced.
    pub fn bind(&mut self, device: &wgpu::Device, name: &'static str, field: &GpuField) {
        let bg = device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("brush bg"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry {
                    binding: 0,
                    resource: wgpu::BindingResource::Buffer(wgpu::BufferBinding {
                        buffer: &self.params_buf,
                        offset: 0,
                        size: wgpu::BufferSize::new(std::mem::size_of::<Params>() as u64),
                    }),
                },
                wgpu::BindGroupEntry { binding: 1, resource: self.dab_buf.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(&field.view) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::TextureView(&field.scratch_view) },
            ],
        });
        self.bind_groups.insert(name, bg);
    }

    pub fn unbind(&mut self, name: &str) {
        self.bind_groups.remove(name);
    }

    /// Encode dispatches for up to `MAX_DABS_PER_FRAME` dabs. Returns the
    /// number consumed from the front of `dabs`; the tiles written are added
    /// to `dirty`.
    #[allow(clippy::too_many_arguments)]
    pub fn encode(
        &mut self,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        name: &str,
        field: &GpuField,
        dabs: &[Dab],
        dirty: &mut TileSet,
        profiler: &mut GpuProfiler,
    ) -> usize {
        let bind_group = self.bind_groups.get(name).expect("BrushPass::bind not called for this field");
        let n = dabs.len().min(self.dab_capacity);
        if n == 0 {
            self.last_dispatches = 0;
            self.last_texels = 0;
            self.last_dabs = 0;
            return 0;
        }
        let (w, h) = (field.width(), field.height());
        let dabs = &dabs[..n];
        queue.write_buffer(&self.dab_buf, 0, bytemuck::cast_slice(dabs));

        // Build the per-group parameter table.
        let mut params_bytes = vec![0u8; PARAM_STRIDE as usize * MAX_GROUPS_PER_FRAME];
        let mut groups: Vec<(PixelRect, bool)> = Vec::new();
        for (gi, chunk) in dabs.chunks(GROUP).enumerate() {
            let mut rect = PixelRect::EMPTY;
            let mut smooth = false;
            for d in chunk {
                rect = rect.union(&d.rect(w, h));
                smooth |= d.mode == BlendMode::Smooth as u32;
            }
            let p = Params {
                rect_origin: [rect.x0, rect.y0],
                rect_size: [rect.width(), rect.height()],
                field_size: [w, h],
                dab_offset: (gi * GROUP) as u32,
                dab_count: chunk.len() as u32,
            };
            let off = gi * PARAM_STRIDE as usize;
            params_bytes[off..off + std::mem::size_of::<Params>()].copy_from_slice(bytemuck::bytes_of(&p));
            groups.push((rect, smooth));
        }
        queue.write_buffer(&self.params_buf, 0, &params_bytes[..groups.len() * PARAM_STRIDE as usize]);

        let mut texels = 0u64;
        let mut dispatches = 0u32;
        for (gi, (rect, smooth)) in groups.iter().enumerate() {
            if rect.is_empty() {
                continue;
            }
            if *smooth {
                // Snapshot the neighbourhood so smoothing reads pre-dispatch values.
                let r = rect.dilate(1, w, h);
                encoder.copy_texture_to_texture(
                    wgpu::TexelCopyTextureInfo {
                        texture: &field.texture,
                        mip_level: 0,
                        origin: wgpu::Origin3d { x: r.x0, y: r.y0, z: 0 },
                        aspect: wgpu::TextureAspect::All,
                    },
                    wgpu::TexelCopyTextureInfo {
                        texture: &field.scratch,
                        mip_level: 0,
                        origin: wgpu::Origin3d { x: r.x0, y: r.y0, z: 0 },
                        aspect: wgpu::TextureAspect::All,
                    },
                    wgpu::Extent3d { width: r.width(), height: r.height(), depth_or_array_layers: 1 },
                );
            }
            let timestamps = if gi == 0 { profiler.compute_timestamps("brush") } else { None };
            let mut pass = encoder.begin_compute_pass(&wgpu::ComputePassDescriptor {
                label: Some("brush"),
                timestamp_writes: timestamps,
            });
            pass.set_pipeline(&self.pipeline);
            pass.set_bind_group(0, bind_group, &[(gi as u64 * PARAM_STRIDE) as u32]);
            pass.dispatch_workgroups(rect.width().div_ceil(16), rect.height().div_ceil(16), 1);
            dirty.insert_rect(rect);
            texels += rect.area();
            dispatches += 1;
        }
        self.last_dispatches = dispatches;
        self.last_texels = texels;
        self.last_dabs = n as u32;
        n
    }
}
