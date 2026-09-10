//! Full-screen map pass.

use super::field::GpuField;
use super::profiler::GpuProfiler;
use bytemuck::{Pod, Zeroable};

pub const FLAG_CONTOURS: u32 = 1;
pub const FLAG_CURSOR: u32 = 2;
pub const FLAG_HYPSO: u32 = 4;

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Debug)]
pub struct ViewUniform {
    pub screen_size: [f32; 2],
    pub field_size: [f32; 2],
    pub origin: [f32; 2],
    pub scale: f32,
    pub sea_level: f32,
    pub sun_dir: [f32; 3],
    pub exaggeration: f32,
    pub shade_strength: f32,
    pub contour_interval: f32,
    pub coast_width: f32,
    pub flags: u32,
    pub cursor: [f32; 2],
    pub cursor_radius: f32,
    pub meters_per_texel: f32,
    pub elev_min: f32,
    pub elev_max: f32,
    pub time: f32,
    pub _pad: f32,
}

pub struct MapRenderer {
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    uniform: wgpu::Buffer,
    bind_group: Option<wgpu::BindGroup>,
}

impl MapRenderer {
    pub fn new(device: &wgpu::Device, target_format: wgpu::TextureFormat) -> Self {
        let error_scope = device.push_error_scope(wgpu::ErrorFilter::Validation);
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("map.wgsl"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/map.wgsl").into()),
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("map bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer {
                        ty: wgpu::BufferBindingType::Uniform,
                        has_dynamic_offset: false,
                        min_binding_size: wgpu::BufferSize::new(std::mem::size_of::<ViewUniform>() as u64),
                    },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture {
                        sample_type: wgpu::TextureSampleType::Float { filterable: false },
                        view_dimension: wgpu::TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
            ],
        });
        let pipeline_layout = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor {
            label: Some("map pl"),
            bind_group_layouts: &[Some(&layout)],
            immediate_size: 0,
        });
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("map"),
            layout: Some(&pipeline_layout),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[],
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState {
                    format: target_format,
                    blend: None,
                    write_mask: wgpu::ColorWrites::ALL,
                })],
            }),
            multiview_mask: None,
            cache: None,
        });
        if let Some(e) = pollster::block_on(error_scope.pop()) {
            panic!("map pipeline failed validation: {e}");
        }
        let uniform = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("map view"),
            size: std::mem::size_of::<ViewUniform>() as u64,
            usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST,
            mapped_at_creation: false,
        });
        Self { pipeline, layout, uniform, bind_group: None }
    }

    pub fn bind(&mut self, device: &wgpu::Device, field: &GpuField) {
        self.bind_group = Some(device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("map bg"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: self.uniform.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&field.view) },
            ],
        }));
    }

    pub fn render(
        &self,
        queue: &wgpu::Queue,
        encoder: &mut wgpu::CommandEncoder,
        target: &wgpu::TextureView,
        view: &ViewUniform,
        profiler: &mut GpuProfiler,
    ) {
        queue.write_buffer(&self.uniform, 0, bytemuck::bytes_of(view));
        let timestamps = profiler.render_timestamps("map");
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("map"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations {
                    load: wgpu::LoadOp::Clear(wgpu::Color { r: 0.9, g: 0.87, b: 0.8, a: 1.0 }),
                    store: wgpu::StoreOp::Store,
                },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: timestamps,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_bind_group(0, self.bind_group.as_ref().expect("MapRenderer::bind not called"), &[]);
        pass.draw(0..3, 0..1);
    }
}
