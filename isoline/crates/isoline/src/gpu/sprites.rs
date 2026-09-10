//! Texture atlas and instanced sprite pass for map symbols.

use bytemuck::{Pod, Zeroable};
use isoline_core::assets::Bitmap;
use std::collections::HashMap;

pub const ATLAS_SIZE: u32 = 4096;
const PAD: u32 = 2;

#[derive(Clone, Copy, Debug)]
pub struct AtlasRect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

impl AtlasRect {
    pub fn uv(&self) -> ([f32; 2], [f32; 2]) {
        let s = ATLAS_SIZE as f32;
        ([self.x as f32 / s, self.y as f32 / s], [(self.x + self.w) as f32 / s, (self.y + self.h) as f32 / s])
    }
    pub fn aspect(&self) -> f32 {
        self.w as f32 / self.h.max(1) as f32
    }
}

/// Shelf-packed RGBA atlas, rebuilt whenever the library changes.
pub struct Atlas {
    pub texture: wgpu::Texture,
    pub view: wgpu::TextureView,
    pub rects: HashMap<String, AtlasRect>,
    pixels: Vec<u8>,
    shelf_y: u32,
    shelf_h: u32,
    cursor_x: u32,
    pub generation: u64,
}

impl Atlas {
    pub fn new(device: &wgpu::Device) -> Self {
        let texture = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("symbol atlas"),
            size: wgpu::Extent3d { width: ATLAS_SIZE, height: ATLAS_SIZE, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format: wgpu::TextureFormat::Rgba8UnormSrgb,
            usage: wgpu::TextureUsages::TEXTURE_BINDING | wgpu::TextureUsages::COPY_DST,
            view_formats: &[],
        });
        let view = texture.create_view(&Default::default());
        Self { texture, view, rects: HashMap::new(), pixels: vec![0; (ATLAS_SIZE * ATLAS_SIZE * 4) as usize], shelf_y: 0, shelf_h: 0, cursor_x: 0, generation: 0 }
    }

    pub fn clear(&mut self) {
        self.rects.clear();
        self.pixels.iter_mut().for_each(|b| *b = 0);
        self.shelf_y = 0;
        self.shelf_h = 0;
        self.cursor_x = 0;
    }

    /// Add a bitmap; returns None if the atlas is full.
    pub fn insert(&mut self, id: &str, b: &Bitmap) -> Option<AtlasRect> {
        if b.is_empty() || b.width + PAD > ATLAS_SIZE {
            return None;
        }
        if self.cursor_x + b.width + PAD > ATLAS_SIZE {
            self.shelf_y += self.shelf_h + PAD;
            self.shelf_h = 0;
            self.cursor_x = 0;
        }
        if self.shelf_y + b.height + PAD > ATLAS_SIZE {
            return None;
        }
        let rect = AtlasRect { x: self.cursor_x, y: self.shelf_y, w: b.width, h: b.height };
        for y in 0..b.height {
            let src = &b.rgba[(y * b.width * 4) as usize..((y + 1) * b.width * 4) as usize];
            let dst = ((rect.y + y) * ATLAS_SIZE + rect.x) as usize * 4;
            self.pixels[dst..dst + src.len()].copy_from_slice(src);
        }
        self.cursor_x += b.width + PAD;
        self.shelf_h = self.shelf_h.max(b.height);
        self.rects.insert(id.to_string(), rect);
        Some(rect)
    }

    pub fn upload(&mut self, queue: &wgpu::Queue) {
        queue.write_texture(
            wgpu::TexelCopyTextureInfo { texture: &self.texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            &self.pixels,
            wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(ATLAS_SIZE * 4), rows_per_image: Some(ATLAS_SIZE) },
            wgpu::Extent3d { width: ATLAS_SIZE, height: ATLAS_SIZE, depth_or_array_layers: 1 },
        );
        self.generation += 1;
    }
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable, Debug)]
pub struct SpriteInstance {
    pub pos: [f32; 2],
    pub size: [f32; 2],
    pub pivot: [f32; 2],
    pub uv0: [f32; 2],
    pub uv1: [f32; 2],
    pub rot_flip: [f32; 2],
    pub tint: [f32; 4],
}

#[repr(C)]
#[derive(Clone, Copy, Pod, Zeroable)]
struct SpriteView {
    screen_size: [f32; 2],
    origin: [f32; 2],
    scale: f32,
    shadow_pass: f32,
    shadow_offset: [f32; 2],
    shadow_alpha: f32,
    /// WGSL pads before the trailing vec3; total 64 bytes.
    _pad: [f32; 7],
}

pub struct SpritePass {
    pipeline: wgpu::RenderPipeline,
    layout: wgpu::BindGroupLayout,
    sampler: wgpu::Sampler,
    uniform: wgpu::Buffer,
    uniform_shadow: wgpu::Buffer,
    bind_group: Option<wgpu::BindGroup>,
    bind_group_shadow: Option<wgpu::BindGroup>,
    instances: wgpu::Buffer,
    capacity: usize,
    count: u32,
    pub last_instances: u32,
}

impl SpritePass {
    pub fn new(device: &wgpu::Device, format: wgpu::TextureFormat) -> Self {
        let shader = device.create_shader_module(wgpu::ShaderModuleDescriptor {
            label: Some("sprites.wgsl"),
            source: wgpu::ShaderSource::Wgsl(include_str!("../shaders/sprites.wgsl").into()),
        });
        let layout = device.create_bind_group_layout(&wgpu::BindGroupLayoutDescriptor {
            label: Some("sprites bgl"),
            entries: &[
                wgpu::BindGroupLayoutEntry {
                    binding: 0,
                    visibility: wgpu::ShaderStages::VERTEX_FRAGMENT,
                    ty: wgpu::BindingType::Buffer { ty: wgpu::BufferBindingType::Uniform, has_dynamic_offset: false, min_binding_size: None },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 1,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Texture { sample_type: wgpu::TextureSampleType::Float { filterable: true }, view_dimension: wgpu::TextureViewDimension::D2, multisampled: false },
                    count: None,
                },
                wgpu::BindGroupLayoutEntry {
                    binding: 2,
                    visibility: wgpu::ShaderStages::FRAGMENT,
                    ty: wgpu::BindingType::Sampler(wgpu::SamplerBindingType::Filtering),
                    count: None,
                },
            ],
        });
        let pl = device.create_pipeline_layout(&wgpu::PipelineLayoutDescriptor { label: Some("sprites pl"), bind_group_layouts: &[Some(&layout)], immediate_size: 0 });
        let stride = std::mem::size_of::<SpriteInstance>() as u64;
        let attrs: Vec<wgpu::VertexAttribute> = (0..7)
            .map(|i| wgpu::VertexAttribute {
                format: if i == 6 { wgpu::VertexFormat::Float32x4 } else { wgpu::VertexFormat::Float32x2 },
                offset: i as u64 * 8,
                shader_location: i,
            })
            .collect();
        let pipeline = device.create_render_pipeline(&wgpu::RenderPipelineDescriptor {
            label: Some("sprites"),
            layout: Some(&pl),
            vertex: wgpu::VertexState {
                module: &shader,
                entry_point: Some("vs_main"),
                compilation_options: Default::default(),
                buffers: &[wgpu::VertexBufferLayout { array_stride: stride, step_mode: wgpu::VertexStepMode::Instance, attributes: &attrs }],
            },
            primitive: wgpu::PrimitiveState::default(),
            depth_stencil: None,
            multisample: wgpu::MultisampleState::default(),
            fragment: Some(wgpu::FragmentState {
                module: &shader,
                entry_point: Some("fs_main"),
                compilation_options: Default::default(),
                targets: &[Some(wgpu::ColorTargetState { format, blend: Some(wgpu::BlendState::ALPHA_BLENDING), write_mask: wgpu::ColorWrites::ALL })],
            }),
            multiview_mask: None,
            cache: None,
        });
        let sampler = device.create_sampler(&wgpu::SamplerDescriptor {
            label: Some("atlas sampler"),
            mag_filter: wgpu::FilterMode::Linear,
            min_filter: wgpu::FilterMode::Linear,
            mipmap_filter: wgpu::MipmapFilterMode::Nearest,
            ..Default::default()
        });
        let mk = |label| {
            device.create_buffer(&wgpu::BufferDescriptor { label: Some(label), size: std::mem::size_of::<SpriteView>() as u64, usage: wgpu::BufferUsages::UNIFORM | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false })
        };
        let capacity = 4096;
        let instances = device.create_buffer(&wgpu::BufferDescriptor { label: Some("sprite instances"), size: (capacity * std::mem::size_of::<SpriteInstance>()) as u64, usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        Self { pipeline, layout, sampler, uniform: mk("sprite view"), uniform_shadow: mk("sprite view shadow"), bind_group: None, bind_group_shadow: None, instances, capacity, count: 0, last_instances: 0 }
    }

    pub fn bind(&mut self, device: &wgpu::Device, atlas: &Atlas) {
        let mk = |buf: &wgpu::Buffer| {
            device.create_bind_group(&wgpu::BindGroupDescriptor {
                label: Some("sprites bg"),
                layout: &self.layout,
                entries: &[
                    wgpu::BindGroupEntry { binding: 0, resource: buf.as_entire_binding() },
                    wgpu::BindGroupEntry { binding: 1, resource: wgpu::BindingResource::TextureView(&atlas.view) },
                    wgpu::BindGroupEntry { binding: 2, resource: wgpu::BindingResource::Sampler(&self.sampler) },
                ],
            })
        };
        self.bind_group = Some(mk(&self.uniform));
        self.bind_group_shadow = Some(mk(&self.uniform_shadow));
    }

    pub fn set_instances(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, inst: &[SpriteInstance]) {
        if inst.len() > self.capacity {
            self.capacity = inst.len().next_power_of_two();
            self.instances = device.create_buffer(&wgpu::BufferDescriptor { label: Some("sprite instances"), size: (self.capacity * std::mem::size_of::<SpriteInstance>()) as u64, usage: wgpu::BufferUsages::VERTEX | wgpu::BufferUsages::COPY_DST, mapped_at_creation: false });
        }
        if !inst.is_empty() {
            queue.write_buffer(&self.instances, 0, bytemuck::cast_slice(inst));
        }
        self.count = inst.len() as u32;
        self.last_instances = self.count;
    }

    #[allow(clippy::too_many_arguments)]
    pub fn render(&self, queue: &wgpu::Queue, encoder: &mut wgpu::CommandEncoder, target: &wgpu::TextureView, screen_size: [f32; 2], origin: [f32; 2], scale: f32, shadow_alpha: f32) {
        if self.count == 0 {
            return;
        }
        let (Some(bg), Some(bg_shadow)) = (&self.bind_group, &self.bind_group_shadow) else { return };
        let base = SpriteView { screen_size, origin, scale, shadow_pass: 0.0, shadow_offset: [0.06, 0.05], shadow_alpha, _pad: [0.0; 7] };
        queue.write_buffer(&self.uniform, 0, bytemuck::bytes_of(&base));
        queue.write_buffer(&self.uniform_shadow, 0, bytemuck::bytes_of(&SpriteView { shadow_pass: 1.0, ..base }));
        let mut pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
            label: Some("sprites"),
            color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                view: target,
                depth_slice: None,
                resolve_target: None,
                ops: wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store },
            })],
            depth_stencil_attachment: None,
            timestamp_writes: None,
            occlusion_query_set: None,
            multiview_mask: None,
        });
        pass.set_pipeline(&self.pipeline);
        pass.set_vertex_buffer(0, self.instances.slice(..));
        if shadow_alpha > 0.0 {
            pass.set_bind_group(0, bg_shadow, &[]);
            pass.draw(0..6, 0..self.count);
        }
        pass.set_bind_group(0, bg, &[]);
        pass.draw(0..6, 0..self.count);
    }
}
