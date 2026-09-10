//! Raster export: the map rendered at any resolution by tiling the view and
//! streaming bands to disk, so a 16000-pixel sheet never has to fit in
//! memory at once. Terrain and symbols come from the GPU passes; labels,
//! borders and towns are laid out once for the whole sheet with a headless
//! egui context and rasterized per tile.

use anyhow::{bail, Context, Result};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::Instant;

#[derive(Clone, Debug, PartialEq)]
pub struct ExportSettings {
    /// Output pixels per field texel.
    pub scale: f32,
    pub dpi: u32,
    pub jpeg: bool,
    pub quality: u8,
    /// Transparent outside the sheet (PNG only).
    pub transparent: bool,
    /// Extra margin around the sheet, in texels.
    pub bleed: f32,
    /// Write terrain, symbols and overlay as three files instead of one.
    pub separate_layers: bool,
    /// Which view's label sizes and detail the export reproduces.
    pub reference: Reference,
}

/// Labels, ornaments and town detail are sized as they appear on screen
/// at some zoom, then the whole sheet is rendered at the export scale.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reference {
    /// The zoom at which the sheet fits the window.
    Fit,
    /// The current zoom.
    Current,
}

impl Default for ExportSettings {
    fn default() -> Self {
        Self { scale: 2.0, dpi: 300, jpeg: false, quality: 90, transparent: false, bleed: 0.0, separate_layers: false, reference: Reference::Fit }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Layer {
    All,
    Terrain,
    Symbols,
    Overlay,
}

impl Layer {
    fn suffix(self) -> &'static str {
        match self {
            Layer::All => "",
            Layer::Terrain => "-terrain",
            Layer::Symbols => "-symbols",
            Layer::Overlay => "-overlay",
        }
    }
    pub fn draws_terrain(self) -> bool {
        matches!(self, Layer::All | Layer::Terrain)
    }
    pub fn draws_symbols(self) -> bool {
        matches!(self, Layer::All | Layer::Symbols)
    }
    pub fn draws_overlay(self) -> bool {
        matches!(self, Layer::All | Layer::Overlay)
    }
    /// Layers other than the combined one sit on a transparent ground.
    pub fn transparent(self, settings: &ExportSettings) -> bool {
        self != Layer::All || settings.transparent
    }
}

enum Sink {
    Png(png::StreamWriter<'static, std::io::BufWriter<std::fs::File>>),
    Jpeg { path: PathBuf, rgb: Vec<u8>, quality: u8 },
}

/// The state of one export, advanced a band at a time by the app.
pub struct ExportJob {
    pub settings: ExportSettings,
    pub base_path: PathBuf,
    pub layers: Vec<Layer>,
    pub layer_idx: usize,
    pub width: u32,
    pub height: u32,
    /// Field coordinate at output pixel (0, 0).
    pub origin: glam::Vec2,
    pub tile_w: u32,
    pub band_h: u32,
    pub band_y: u32,
    band: Vec<u8>,
    pub tile_tex: wgpu::Texture,
    pub tile_view: wgpu::TextureView,
    readback: wgpu::Buffer,
    bpr: u32,
    sink: Option<Sink>,
    pub shapes: Vec<egui::epaint::ClippedShape>,
    pub ctx: egui::Context,
    pub renderer: egui_wgpu::Renderer,
    /// Output pixels per overlay point.
    pub ppp: f32,
    pub done: bool,
    pub started: Instant,
    bgra: bool,
    pub bands_done: u32,
    pub bands_total: u32,
}

impl ExportJob {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        device: &wgpu::Device,
        format: wgpu::TextureFormat,
        settings: ExportSettings,
        base_path: PathBuf,
        field_w: u32,
        field_h: u32,
        max_dim: u32,
        shapes: Vec<egui::epaint::ClippedShape>,
        ctx: egui::Context,
        renderer: egui_wgpu::Renderer,
        ppp: f32,
    ) -> Result<Self> {
        let s = settings.scale.max(0.05);
        let width = ((field_w as f32 + 2.0 * settings.bleed) * s).round().max(1.0) as u32;
        let height = ((field_h as f32 + 2.0 * settings.bleed) * s).round().max(1.0) as u32;
        if settings.jpeg && (width as u64 * height as u64) > 64_000_000 {
            bail!("JPEG export is limited to 64 megapixels; use PNG for larger sheets");
        }
        let tile_w = width.min(max_dim.min(4096));
        let band_h = height.min(max_dim.min(1024));
        let tile_tex = device.create_texture(&wgpu::TextureDescriptor {
            label: Some("export tile"),
            size: wgpu::Extent3d { width: tile_w, height: band_h, depth_or_array_layers: 1 },
            mip_level_count: 1,
            sample_count: 1,
            dimension: wgpu::TextureDimension::D2,
            format,
            usage: wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC,
            view_formats: &[],
        });
        let tile_view = tile_tex.create_view(&Default::default());
        let bpr = (tile_w * 4).div_ceil(256) * 256;
        let readback = device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("export readback"),
            size: bpr as u64 * band_h as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let layers = if settings.separate_layers { vec![Layer::Terrain, Layer::Symbols, Layer::Overlay] } else { vec![Layer::All] };
        let bands = height.div_ceil(band_h);
        let bgra = matches!(format, wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Bgra8UnormSrgb);
        let mut job = Self {
            settings,
            base_path,
            layers: layers.clone(),
            layer_idx: 0,
            width,
            height,
            origin: glam::Vec2::ZERO,
            tile_w,
            band_h,
            band_y: 0,
            band: vec![0u8; (width * band_h * 4) as usize],
            tile_tex,
            tile_view,
            readback,
            bpr,
            sink: None,
            shapes,
            ctx,
            renderer,
            ppp,
            done: false,
            started: Instant::now(),
            bgra,
            bands_done: 0,
            bands_total: bands * layers.len() as u32,
        };
        job.origin = glam::Vec2::splat(-job.settings.bleed);
        job.open_layer()?;
        Ok(job)
    }

    pub fn layer(&self) -> Layer {
        self.layers[self.layer_idx]
    }

    pub fn progress(&self) -> f32 {
        self.bands_done as f32 / self.bands_total.max(1) as f32
    }

    fn layer_path(&self, layer: Layer) -> PathBuf {
        let stem = self.base_path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "map".into());
        let ext = if self.settings.jpeg { "jpg" } else { "png" };
        self.base_path.with_file_name(format!("{stem}{}.{ext}", layer.suffix()))
    }

    fn open_layer(&mut self) -> Result<()> {
        let path = self.layer_path(self.layer());
        if self.settings.jpeg {
            self.sink = Some(Sink::Jpeg { path, rgb: Vec::with_capacity((self.width * self.height * 3) as usize), quality: self.settings.quality });
        } else {
            let file = std::fs::File::create(&path).with_context(|| format!("create {}", path.display()))?;
            let mut enc = png::Encoder::new(std::io::BufWriter::with_capacity(1 << 20, file), self.width, self.height);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            let ppm = (self.settings.dpi as f32 / 0.0254).round() as u32;
            enc.set_pixel_dims(Some(png::PixelDimensions { xppu: ppm, yppu: ppm, unit: png::Unit::Meter }));
            let writer = enc.write_header()?;
            self.sink = Some(Sink::Png(writer.into_stream_writer()?));
        }
        self.band_y = 0;
        Ok(())
    }

    /// The tiles of the current band as (x, width) pairs.
    pub fn tiles(&self) -> Vec<(u32, u32)> {
        let mut out = Vec::new();
        let mut x = 0;
        while x < self.width {
            let w = (self.width - x).min(self.tile_w);
            out.push((x, w));
            x += w;
        }
        out
    }

    pub fn band_rows(&self) -> u32 {
        (self.height - self.band_y).min(self.band_h)
    }

    /// Field-space origin of a tile in the current band.
    pub fn tile_origin(&self, x: u32) -> glam::Vec2 {
        self.origin + glam::Vec2::new(x as f32, self.band_y as f32) / self.settings.scale
    }

    /// Overlay shapes translated into a tile's pixel space, bounding-box
    /// culled so a huge sheet does not tessellate everything per tile.
    pub fn tile_shapes(&self, x: u32, w: u32) -> Vec<egui::epaint::ClippedShape> {
        let p = self.ppp.max(0.01);
        let rect = egui::Rect::from_min_size(egui::pos2(x as f32 / p, self.band_y as f32 / p), egui::vec2(w as f32 / p, self.band_rows() as f32 / p)).expand(64.0);
        let delta = egui::vec2(-(x as f32) / p, -(self.band_y as f32) / p);
        self.shapes
            .iter()
            .filter(|s| s.shape.visual_bounding_rect().intersects(rect) || s.shape.visual_bounding_rect().is_negative())
            .map(|s| {
                let mut c = s.clone();
                c.transform(egui::emath::TSTransform::from_translation(delta));
                c
            })
            .collect()
    }

    /// Copy a rendered tile out of the GPU into the band buffer.
    pub fn read_tile(&mut self, device: &wgpu::Device, queue: &wgpu::Queue, x: u32, w: u32, transparent: bool) -> Result<()> {
        let rows = self.band_rows();
        let mut enc = device.create_command_encoder(&Default::default());
        enc.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo { texture: &self.tile_tex, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            wgpu::TexelCopyBufferInfo { buffer: &self.readback, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(self.bpr), rows_per_image: Some(self.band_h) } },
            wgpu::Extent3d { width: self.tile_w, height: self.band_h, depth_or_array_layers: 1 },
        );
        queue.submit([enc.finish()]);
        let (tx, rx) = std::sync::mpsc::channel();
        self.readback.slice(..).map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        let _ = device.poll(wgpu::PollType::wait_indefinitely());
        rx.recv().context("export readback")?.context("export readback failed")?;
        {
            let data = self.readback.slice(..).get_mapped_range();
            let stride = (self.width * 4) as usize;
            for y in 0..rows as usize {
                let src = &data[y * self.bpr as usize..y * self.bpr as usize + (w * 4) as usize];
                let dst = &mut self.band[y * stride + (x * 4) as usize..y * stride + ((x + w) * 4) as usize];
                dst.copy_from_slice(src);
                for px in dst.chunks_exact_mut(4) {
                    if self.bgra {
                        px.swap(0, 2);
                    }
                    if transparent {
                        // The passes composite premultiplied; files want straight alpha.
                        let a = px[3] as u32;
                        if a > 0 && a < 255 {
                            for c in px.iter_mut().take(3) {
                                *c = ((*c as u32 * 255) / a).min(255) as u8;
                            }
                        }
                    } else {
                        px[3] = 255;
                    }
                }
            }
        }
        self.readback.unmap();
        Ok(())
    }

    /// The band is complete: write it and advance. Returns true when the
    /// whole export (all layers) is finished.
    pub fn finish_band(&mut self) -> Result<bool> {
        let rows = self.band_rows() as usize;
        let stride = (self.width * 4) as usize;
        match self.sink.as_mut().expect("open sink") {
            Sink::Png(w) => w.write_all(&self.band[..rows * stride])?,
            Sink::Jpeg { rgb, .. } => {
                for px in self.band[..rows * stride].chunks_exact(4) {
                    rgb.extend_from_slice(&px[..3]);
                }
            }
        }
        self.band_y += rows as u32;
        self.bands_done += 1;
        if self.band_y >= self.height {
            match self.sink.take().expect("open sink") {
                Sink::Png(w) => w.finish()?,
                Sink::Jpeg { path, rgb, quality } => {
                    let file = std::fs::File::create(&path).with_context(|| format!("create {}", path.display()))?;
                    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(std::io::BufWriter::new(file), quality);
                    enc.encode(&rgb, self.width, self.height, image::ExtendedColorType::Rgb8)?;
                }
            }
            log::info!("export: wrote {} ({}×{})", self.layer_path(self.layer()).display(), self.width, self.height);
            self.layer_idx += 1;
            if self.layer_idx >= self.layers.len() {
                self.done = true;
                return Ok(true);
            }
            self.open_layer()?;
        }
        Ok(false)
    }

    pub fn written_paths(&self) -> Vec<PathBuf> {
        self.layers.iter().map(|l| self.layer_path(*l)).collect()
    }
}

/// Extension the file dialog should default to.
pub fn default_name(project: &str, settings: &ExportSettings) -> String {
    format!("{project}.{}", if settings.jpeg { "jpg" } else { "png" })
}

pub fn describe(path: &Path, w: u32, h: u32, ms: f32) -> String {
    format!("Exported {} ({w}×{h}) in {:.1} s", path.display(), ms / 1000.0)
}
