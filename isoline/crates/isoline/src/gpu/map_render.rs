//! Full-screen map pass.

use super::field::GpuField;
use super::profiler::GpuProfiler;
use bytemuck::{Pod, Zeroable};

pub const FLAG_CONTOURS: u32 = 1;
pub const FLAG_CURSOR: u32 = 2;
pub const FLAG_HYPSO: u32 = 4;
pub const FLAG_WATER: u32 = 8;
pub const FLAG_HAS_DERIVED: u32 = 16;
pub const FLAG_TRANSPARENT: u32 = 32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ViewMode {
    /// The themed map.
    Map = 0,
    Hypsometric = 1,
    BiomeFlat = 2,
    Moisture = 3,
    Temperature = 4,
}

impl ViewMode {
    pub const ALL: [ViewMode; 5] = [
        ViewMode::Map,
        ViewMode::Hypsometric,
        ViewMode::BiomeFlat,
        ViewMode::Moisture,
        ViewMode::Temperature,
    ];
    pub fn label(self) -> &'static str {
        match self {
            ViewMode::Map => "Map",
            ViewMode::Hypsometric => "Elevation tint",
            ViewMode::BiomeFlat => "Biomes",
            ViewMode::Moisture => "Moisture",
            ViewMode::Temperature => "Temperature",
        }
    }
}

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
    pub view_mode: u32,
    pub temp_min: f32,
    pub temp_max: f32,
    pub _pad_a: [f32; 2],
    /// Moisture / temperature texture size divided by field size.
    pub moist_scale: [f32; 2],
    pub temp_scale: [f32; 2],
    // Theme block (vec3 + scalar pairs keep 16-byte alignment).
    pub paper: [f32; 3],
    pub theme_style: u32,
    pub paper_dark: [f32; 3],
    pub relief_style: u32,
    pub ink: [f32; 3],
    pub forest_style: u32,
    pub sea_fill: [f32; 3],
    pub coast_rings: u32,
    pub sea_ink: [f32; 3],
    pub land_tint: f32,
    pub river_ink: [f32; 3],
    pub paper_grain: f32,
    pub forest_fill: [f32; 3],
    pub vignette: f32,
    pub ring_spacing: f32,
    pub hatch_strength: f32,
    pub hatch_spacing: f32,
    pub forest_scale: f32,
    pub forest_threshold: f32,
    /// Region fill strength (0 = no regions) and region texture size / field size.
    pub region_fill: f32,
    pub region_scale: [f32; 2],
    /// WGSL pads to the next 16-byte boundary before the arrays.
    pub _pad_b: [f32; 4],
    pub palette: [[f32; 4]; 16],
    /// Region fill colours by region id modulo 32.
    pub region_palette: [[f32; 4]; 32],
}

pub struct MapRenderer {
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    uniform: wgpu::Buffer,
    bind_group: Option<wgpu::BindGroup>,
}

fn tex_entry(binding: u32) -> wgpu::BindGroupLayoutEntry {
    wgpu::BindGroupLayoutEntry {
        binding,
        visibility: wgpu::ShaderStages::FRAGMENT,
        ty: wgpu::BindingType::Texture {
            sample_type: wgpu::TextureSampleType::Float { filterable: false },
            view_dimension: wgpu::TextureViewDimension::D2,
            multisampled: false,
        },
        count: None,
    }
}

/// The derived-field textures the map pass samples.
pub struct DerivedViews<'a> {
    pub water: &'a wgpu::TextureView,
    pub moisture: &'a wgpu::TextureView,
    pub temperature: &'a wgpu::TextureView,
    pub biome: &'a wgpu::TextureView,
    pub forest: &'a wgpu::TextureView,
    pub regions: &'a wgpu::TextureView,
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
                tex_entry(1),
                tex_entry(2),
                tex_entry(3),
                tex_entry(4),
                tex_entry(5),
                tex_entry(6),
                tex_entry(7),
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

    pub fn bind(&mut self, device: &wgpu::Device, field: &GpuField, derived: DerivedViews<'_>) {
        self.bind_group = Some(device.create_bind_group(&wgpu::BindGroupDescriptor {
            label: Some("map bg"),
            layout: &self.layout,
            entries: &[
                wgpu::BindGroupEntry { binding: 0, resource: self.uniform.as_entire_binding() },
                wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&field.view) },
                wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::TextureView(derived.water) },
                wgpu::BindGroupEntry { binding: 3, resource: wgpu::BindingResource::TextureView(derived.moisture) },
                wgpu::BindGroupEntry { binding: 4, resource: wgpu::BindingResource::TextureView(derived.temperature) },
                wgpu::BindGroupEntry { binding: 5, resource: wgpu::BindingResource::TextureView(derived.biome) },
                wgpu::BindGroupEntry { binding: 6, resource: wgpu::BindingResource::TextureView(derived.forest) },
                wgpu::BindGroupEntry { binding: 7, resource: wgpu::BindingResource::TextureView(derived.regions) },
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
