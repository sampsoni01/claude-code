//! Window, input, and the per-frame pipeline.

use crate::camera::Camera;
use crate::document::Document;
use crate::gpu::brush::{BrushPass, MAX_DABS_PER_FRAME};
use crate::gpu::field::GpuField;
use crate::gpu::map_render::{DerivedViews, MapRenderer, ViewMode, ViewUniform, FLAG_CONTOURS, FLAG_CURSOR, FLAG_HAS_DERIVED, FLAG_HYPSO, FLAG_WATER};
use crate::gpu::profiler::{CpuStats, GpuProfiler};
use crate::gpu::Gpu;
use crate::jobs::Job;
use crate::tools::{Tool, ToolState};
use crate::ui::{self, NewProjectParams, RecoveryPrompt, UiAction, UiContext, UiState};
use anyhow::{Context, Result};
use glam::Vec2;
use isoline_core::biome::Biome;
use isoline_core::brush::{StrokeInput, StrokeSampler};
use isoline_core::derived::{self, Derived};
use isoline_core::field::ScalarField;
use isoline_core::project::{self, ProjectData, ViewState};
use isoline_core::terrain;
use isoline_core::tiles::PixelRect;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32};
use std::sync::Arc;
use std::time::{Duration, Instant};
use winit::application::ApplicationHandler;
use winit::event::{ElementState, MouseButton, MouseScrollDelta, TouchPhase, WindowEvent};
use winit::event_loop::{ActiveEventLoop, ControlFlow, EventLoop};
use winit::keyboard::{KeyCode, PhysicalKey};
use winit::window::{Window, WindowId};

pub const AUTOSAVE_INTERVAL: Duration = Duration::from_secs(120);
/// Quiet time after the last edit before the derived job starts.
pub const DERIVED_DEBOUNCE: Duration = Duration::from_millis(200);

/// GPU copies of the derived fields.
struct DerivedTextures {
    water: GpuField,
    moisture: GpuField,
    temperature: GpuField,
    biome: GpuField,
    flow: GpuField,
    /// The CPU fields currently on the GPU, for tile diffing.
    uploaded: Option<Derived>,
    pub last_upload_tiles: u32,
}

impl DerivedTextures {
    fn new(device: &wgpu::Device, w: u32, h: u32) -> Self {
        Self {
            water: GpuField::new_labelled(device, w, h, "water"),
            moisture: GpuField::new_labelled(device, w, h, "moisture"),
            temperature: GpuField::new_labelled(device, w, h, "temperature"),
            biome: GpuField::new_labelled(device, w, h, "biome"),
            flow: GpuField::new_labelled(device, w, h, "flow"),
            uploaded: None,
            last_upload_tiles: 0,
        }
    }

    fn views(&self) -> DerivedViews<'_> {
        DerivedViews {
            water: &self.water.view,
            moisture: &self.moisture.view,
            temperature: &self.temperature.view,
            biome: &self.biome.view,
            flow: &self.flow.view,
        }
    }

    fn device_bytes(&self) -> u64 {
        self.water.device_bytes + self.moisture.device_bytes + self.temperature.device_bytes + self.biome.device_bytes + self.flow.device_bytes
    }

    /// Upload changed tiles only.
    fn upload(&mut self, queue: &wgpu::Queue, d: &Derived) {
        let old = self.uploaded.as_ref();
        let mut n = 0;
        n += self.water.upload_diff(queue, old.map(|o| &o.water), &d.water);
        n += self.moisture.upload_diff(queue, old.map(|o| &o.moisture), &d.moisture);
        n += self.temperature.upload_diff(queue, old.map(|o| &o.temperature), &d.temperature);
        n += self.flow.upload_diff(queue, old.map(|o| &o.flow), &d.flow);
        let biome_f = ScalarField::from_vec(d.water.width(), d.water.height(), d.biome.iter().map(|b| *b as f32).collect());
        let old_biome = old.map(|o| ScalarField::from_vec(o.water.width(), o.water.height(), o.biome.iter().map(|b| *b as f32).collect()));
        n += self.biome.upload_diff(queue, old_biome.as_ref(), &biome_f);
        self.last_upload_tiles = n;
        self.uploaded = Some(d.clone());
    }
}

#[derive(Clone, Debug)]
pub struct StartupOptions {
    pub open: Option<PathBuf>,
    pub size: u32,
    pub demo: bool,
    pub screenshot: Option<PathBuf>,
}

impl Default for StartupOptions {
    fn default() -> Self {
        Self { open: None, size: 2048, demo: false, screenshot: None }
    }
}

#[derive(Default)]
struct Input {
    cursor: Option<Vec2>,
    ctrl: bool,
    shift: bool,
    space: bool,
    panning: bool,
    stroke: bool,
    /// The pointer stroke ended; the document record closes once the last
    /// queued dabs have been dispatched (so every tile is snapshotted).
    close_pending: bool,
    touch_id: Option<u64>,
}

struct AppState {
    window: Arc<Window>,
    surface: wgpu::Surface<'static>,
    config: wgpu::SurfaceConfiguration,
    gpu: Gpu,
    egui_ctx: egui::Context,
    egui_state: egui_winit::State,
    egui_renderer: egui_wgpu::Renderer,
    doc: Document,
    field: GpuField,
    derived_tex: DerivedTextures,
    derived_job: Option<Job<Derived>>,
    /// A change arrived while a job was running; rerun when it finishes.
    derived_rerun: bool,
    view_mode: ViewMode,
    show_water: bool,
    brush: BrushPass,
    map: MapRenderer,
    profiler: GpuProfiler,
    cpu: CpuStats,
    camera: Camera,
    tools: ToolState,
    ui: UiState,
    input: Input,
    gen_job: Option<Job<(NewProjectParams, ScalarField)>>,
    load_job: Option<Job<(Option<PathBuf>, Result<ProjectData>)>>,
    save_job: Option<Job<(PathBuf, Result<()>)>>,
    autosave_job: Option<Job<Result<PathBuf>>>,
    start: Instant,
    needs_fit: bool,
    demo: bool,
    screenshot: Option<PathBuf>,
    frames_since_install: u32,
    surface_copyable: bool,
}

pub struct App {
    opts: StartupOptions,
    state: Option<AppState>,
}

pub fn run(opts: StartupOptions) -> Result<()> {
    let event_loop = EventLoop::new().context("create event loop")?;
    event_loop.set_control_flow(ControlFlow::Wait);
    let mut app = App { opts, state: None };
    event_loop.run_app(&mut app).context("event loop")?;
    Ok(())
}

impl ApplicationHandler for App {
    fn resumed(&mut self, event_loop: &ActiveEventLoop) {
        if self.state.is_some() {
            return;
        }
        match AppState::new(event_loop, &self.opts) {
            Ok(s) => self.state = Some(s),
            Err(e) => {
                log::error!("failed to initialise: {e:#}");
                eprintln!("failed to initialise: {e:#}");
                event_loop.exit();
            }
        }
    }

    fn window_event(&mut self, event_loop: &ActiveEventLoop, _id: WindowId, event: WindowEvent) {
        let Some(s) = self.state.as_mut() else { return };
        if s.handle_event(event_loop, event) {
            event_loop.exit();
        }
    }

    fn about_to_wait(&mut self, _event_loop: &ActiveEventLoop) {
        if let Some(s) = self.state.as_ref() {
            if s.wants_redraw() {
                s.window.request_redraw();
            }
        }
    }
}

impl AppState {
    fn new(event_loop: &ActiveEventLoop, opts: &StartupOptions) -> Result<Self> {
        let attrs = Window::default_attributes()
            .with_title("Isoline")
            .with_inner_size(winit::dpi::LogicalSize::new(1480.0, 920.0));
        let window = Arc::new(event_loop.create_window(attrs).context("create window")?);
        let instance = Gpu::new_instance();
        let surface = instance.create_surface(window.clone()).context("create surface")?;
        let gpu = Gpu::new(instance, Some(&surface))?;

        let caps = surface.get_capabilities(&gpu.adapter);
        // Prefer a non-sRGB swapchain so the map shader's colours land as written.
        let format = caps.formats.iter().copied().find(|f| !f.is_srgb()).unwrap_or(caps.formats[0]);
        let size = window.inner_size();
        let surface_copyable = caps.usages.contains(wgpu::TextureUsages::COPY_SRC);
        let config = wgpu::SurfaceConfiguration {
            usage: if surface_copyable {
                wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC
            } else {
                wgpu::TextureUsages::RENDER_ATTACHMENT
            },
            format,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode: if caps.present_modes.contains(&wgpu::PresentMode::Mailbox) {
                wgpu::PresentMode::Mailbox
            } else {
                wgpu::PresentMode::AutoVsync
            },
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&gpu.device, &config);

        let egui_ctx = egui::Context::default();
        egui_ctx.set_visuals(egui::Visuals::dark());
        let egui_state = egui_winit::State::new(
            egui_ctx.clone(),
            egui::ViewportId::ROOT,
            &window,
            Some(window.scale_factor() as f32),
            window.theme(),
            Some(gpu.limits.max_texture_dimension_2d as usize),
        );
        let egui_renderer = egui_wgpu::Renderer::new(
            &gpu.device,
            format,
            egui_wgpu::RendererOptions { msaa_samples: 1, ..Default::default() },
        );

        // Placeholder document so the window is live while the real terrain generates.
        let placeholder = terrain::generate(
            256,
            256,
            &terrain::TerrainParams { preset: terrain::TerrainPreset::Ocean, ..Default::default() },
            &AtomicU32::new(0),
            &AtomicBool::new(false),
        );
        let doc = Document::new("Loading…", placeholder, 0.0, 100.0);
        let field = GpuField::new(&gpu.device, doc.width(), doc.height());
        field.upload_all(&gpu.queue, &doc.elevation);
        let mut brush = BrushPass::new(&gpu.device);
        brush.bind(&gpu.device, &field);
        let mut map = MapRenderer::new(&gpu.device, format);
        let derived_tex = DerivedTextures::new(&gpu.device, doc.width(), doc.height());
        map.bind(&gpu.device, &field, derived_tex.views());
        let profiler = GpuProfiler::new(&gpu.device, &gpu.queue, gpu.has_timestamps());

        let mut st = Self {
            window,
            surface,
            config,
            gpu,
            egui_ctx,
            egui_state,
            egui_renderer,
            doc,
            field,
            derived_tex,
            derived_job: None,
            derived_rerun: false,
            view_mode: ViewMode::BiomeShaded,
            show_water: true,
            brush,
            map,
            profiler,
            cpu: CpuStats::new(),
            camera: Camera::new(Vec2::new(128.0, 128.0), 1.0),
            tools: ToolState::default(),
            ui: UiState::default(),
            input: Input::default(),
            gen_job: None,
            load_job: None,
            save_job: None,
            autosave_job: None,
            start: Instant::now(),
            needs_fit: true,
            demo: opts.demo,
            screenshot: opts.screenshot.clone(),
            frames_since_install: u32::MAX,
            surface_copyable,
        };

        match &opts.open {
            Some(p) => st.open_path(p.clone()),
            None => {
                let params = NewProjectParams {
                    size: opts.size.clamp(64, st.gpu.max_field_dim()) / 64 * 64,
                    ..NewProjectParams::default()
                };
                st.ui.new_params = params.clone();
                st.start_generation(params);
                if let Some((dir, m)) = project::pending_untitled_recovery() {
                    st.ui.recovery = Some(RecoveryPrompt { autosave_dir: dir, manifest: m, project_dir: None });
                }
            }
        }
        st.ui.status = format!("{} · {:?}", st.gpu.info.name, st.gpu.info.backend);
        Ok(st)
    }

    fn screen_size(&self) -> Vec2 {
        Vec2::new(self.config.width as f32, self.config.height as f32)
    }

    fn wants_redraw(&self) -> bool {
        self.input.stroke
            || !self.tools.queued.is_empty()
            || !self.doc.pending_readback.is_empty()
            || self.field.has_in_flight()
            || self.gen_job.is_some()
            || self.load_job.is_some()
            || self.save_job.is_some()
            || self.autosave_job.is_some()
            || self.derived_job.is_some()
            || self.doc.derived_stale
            || self.egui_ctx.has_requested_repaint()
    }

    // ---- document lifecycle --------------------------------------------------

    fn install_document(&mut self, doc: Document) {
        self.finish_stroke_now();
        self.doc = doc;
        if let Some(j) = self.derived_job.take() {
            j.cancel();
        }
        self.derived_rerun = false;
        self.field = GpuField::new(&self.gpu.device, self.doc.width(), self.doc.height());
        self.field.upload_all(&self.gpu.queue, &self.doc.elevation);
        self.derived_tex = DerivedTextures::new(&self.gpu.device, self.doc.width(), self.doc.height());
        self.brush.bind(&self.gpu.device, &self.field);
        self.map.bind(&self.gpu.device, &self.field, self.derived_tex.views());
        self.doc.derived_stale = true;
        self.doc.derived_last_change = Instant::now() - DERIVED_DEBOUNCE;
        self.tools.queued.clear();
        self.tools.sampler = None;
        self.input.stroke = false;
        self.needs_fit = true;
        if self.doc.saved_view.zoom > 0.0 {
            self.camera = Camera::new(Vec2::from(self.doc.saved_view.center), self.doc.saved_view.zoom);
            self.needs_fit = false;
        }
        let title = format!("Isoline — {}", self.doc.name);
        self.window.set_title(&title);
        self.frames_since_install = 0;
    }

    /// Scripted edits through the normal stroke path (used by `--demo`).
    fn run_demo(&mut self) {
        let ss = self.screen_size();
        let w = self.doc.width() as f32;
        let h = self.doc.height() as f32;
        let to_screen = |c: &Camera, f: Vec2| c.field_to_screen(f, ss);
        let strokes: [(Tool, f32, Vec<Vec2>); 3] = [
            (Tool::Raise, w / 24.0, vec![Vec2::new(w * 0.30, h * 0.35), Vec2::new(w * 0.45, h * 0.30), Vec2::new(w * 0.60, h * 0.42), Vec2::new(w * 0.72, h * 0.40)]),
            (Tool::Lower, w / 30.0, vec![Vec2::new(w * 0.40, h * 0.62), Vec2::new(w * 0.52, h * 0.70), Vec2::new(w * 0.62, h * 0.66)]),
            (Tool::Smooth, w / 20.0, vec![Vec2::new(w * 0.30, h * 0.35), Vec2::new(w * 0.50, h * 0.36)]),
        ];
        for (tool, radius, path) in strokes {
            self.tools.tool = tool;
            self.tools.brush.radius = radius;
            self.tools.brush.strength = 0.8;
            self.tools.brush.amount = 120.0;
            self.begin_stroke(to_screen(&self.camera, path[0]), 1.0);
            for seg in path.windows(2) {
                for i in 1..=24 {
                    let p = seg[0].lerp(seg[1], i as f32 / 24.0);
                    self.continue_stroke(to_screen(&self.camera, p), 1.0);
                }
            }
            self.end_stroke();
            self.finish_stroke_now();
        }
        let from = self.doc.sea_level;
        self.doc.set_sea_level_live(from + 60.0);
        self.doc.commit_sea_level(from, from + 60.0);
        self.undo();
        self.redo();
        self.tools.tool = Tool::Raise;
        self.ui.status = format!("demo: {} undo entries", self.doc.undo.len());
        self.ui.show_profiler = true;
        // Exercise the save path; `--open <temp>/isoline-demo.isoline` reloads it.
        let dir = std::env::temp_dir().join("isoline-demo.isoline");
        self.doc.name = "isoline-demo".into();
        self.save_to(dir);
    }

    fn save_screenshot(&mut self, texture: &wgpu::Texture, path: &Path) -> Result<()> {
        let (w, h) = (self.config.width, self.config.height);
        let bpr = (w * 4).div_ceil(256) * 256;
        let buf = self.gpu.device.create_buffer(&wgpu::BufferDescriptor {
            label: Some("screenshot"),
            size: bpr as u64 * h as u64,
            usage: wgpu::BufferUsages::COPY_DST | wgpu::BufferUsages::MAP_READ,
            mapped_at_creation: false,
        });
        let mut enc = self.gpu.device.create_command_encoder(&Default::default());
        enc.copy_texture_to_buffer(
            wgpu::TexelCopyTextureInfo { texture, mip_level: 0, origin: wgpu::Origin3d::ZERO, aspect: wgpu::TextureAspect::All },
            wgpu::TexelCopyBufferInfo { buffer: &buf, layout: wgpu::TexelCopyBufferLayout { offset: 0, bytes_per_row: Some(bpr), rows_per_image: Some(h) } },
            wgpu::Extent3d { width: w, height: h, depth_or_array_layers: 1 },
        );
        self.gpu.queue.submit([enc.finish()]);
        let (tx, rx) = std::sync::mpsc::channel();
        buf.slice(..).map_async(wgpu::MapMode::Read, move |r| {
            let _ = tx.send(r);
        });
        let _ = self.gpu.device.poll(wgpu::PollType::wait_indefinitely());
        rx.recv().context("screenshot map")?.context("screenshot map failed")?;
        let bgra = self.config.format == wgpu::TextureFormat::Bgra8Unorm || self.config.format == wgpu::TextureFormat::Bgra8UnormSrgb;
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        {
            let data = buf.slice(..).get_mapped_range();
            for y in 0..h as usize {
                let row = &data[y * bpr as usize..y * bpr as usize + (w * 4) as usize];
                let dst = &mut rgba[y * (w * 4) as usize..(y + 1) * (w * 4) as usize];
                dst.copy_from_slice(row);
                if bgra {
                    for px in dst.chunks_exact_mut(4) {
                        px.swap(0, 2);
                    }
                }
                for px in dst.chunks_exact_mut(4) {
                    px[3] = 255;
                }
            }
        }
        buf.unmap();
        let file = std::fs::File::create(path).with_context(|| format!("create {}", path.display()))?;
        let mut enc = png::Encoder::new(std::io::BufWriter::new(file), w, h);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.write_header()?.write_image_data(&rgba)?;
        log::info!("screenshot written to {}", path.display());
        Ok(())
    }

    fn start_generation(&mut self, params: NewProjectParams) {
        let size = params.size;
        let tp = params.terrain.clone();
        self.gen_job = Some(Job::spawn("Generating terrain", move |progress, cancel| {
            let f = terrain::generate(size, size, &tp, progress, cancel);
            (params, f)
        }));
    }

    fn open_path(&mut self, dir: PathBuf) {
        let d = dir.clone();
        self.load_job = Some(Job::spawn("Opening project", move |_, _| {
            let r = project::load(&d);
            (Some(d), r)
        }));
    }

    fn save_to(&mut self, dir: PathBuf) {
        self.finish_stroke_now();
        let view = ViewState { center: self.camera.center.to_array(), zoom: self.camera.zoom };
        let data = self.doc.to_project_data(view);
        let d = dir.clone();
        self.save_job = Some(Job::spawn("Saving", move |_, _| (d.clone(), project::save(&d, &data))));
    }

    fn save(&mut self) {
        match self.doc.path.clone() {
            Some(p) => self.save_to(p),
            None => self.save_as(),
        }
    }

    fn save_as(&mut self) {
        let mut dlg = rfd::FileDialog::new().set_title("Save map as").set_file_name(format!("{}.{}", self.doc.name, project::PROJECT_EXTENSION));
        if let Some(p) = self.doc.path.as_ref().and_then(|p| p.parent()) {
            dlg = dlg.set_directory(p);
        }
        if let Some(mut p) = dlg.save_file() {
            if p.extension().map(|e| e != project::PROJECT_EXTENSION).unwrap_or(true) {
                p.set_extension(project::PROJECT_EXTENSION);
            }
            self.doc.name = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "Untitled".into());
            self.save_to(p);
        }
    }

    fn open_dialog(&mut self) {
        let dlg = rfd::FileDialog::new().set_title("Open map (choose the .isoline folder)");
        if let Some(p) = dlg.pick_folder() {
            self.open_path(p);
        }
    }

    fn poll_jobs(&mut self) {
        if let Some(job) = &self.gen_job {
            if let Some((params, field)) = job.try_take() {
                self.gen_job = None;
                let mut doc = Document::new(params.name, field, 0.0, 100.0);
                doc.modified = false;
                self.install_document(doc);
                self.ui.status = "New map ready".into();
            }
        }
        if let Some(job) = &self.load_job {
            if let Some((path, result)) = job.try_take() {
                self.load_job = None;
                match result.and_then(|d| Document::from_project(d, path.clone())) {
                    Ok(doc) => {
                        self.install_document(doc);
                        if let Some(p) = &path {
                            if let Some((dir, m)) = project::pending_recovery(p) {
                                self.ui.recovery = Some(RecoveryPrompt { autosave_dir: dir, manifest: m, project_dir: Some(p.clone()) });
                            }
                        }
                        self.ui.status = format!("Opened {}", path.as_ref().map(|p| p.display().to_string()).unwrap_or_default());
                    }
                    Err(e) => self.ui.error = Some(format!("Could not open project: {e:#}")),
                }
            }
        }
        if let Some(job) = &self.save_job {
            if let Some((path, result)) = job.try_take() {
                self.save_job = None;
                match result {
                    Ok(()) => {
                        self.doc.path = Some(path.clone());
                        self.doc.modified = false;
                        self.doc.last_autosave = Instant::now();
                        project::discard_autosave(Some(&path));
                        project::discard_autosave(None);
                        self.ui.status = format!("Saved {}", path.display());
                        self.window.set_title(&format!("Isoline — {}", self.doc.name));
                    }
                    Err(e) => self.ui.error = Some(format!("Save failed: {e:#}")),
                }
            }
        }
        if let Some(job) = &self.autosave_job {
            if let Some(result) = job.try_take() {
                self.autosave_job = None;
                match result {
                    Ok(dir) => log::info!("autosaved to {}", dir.display()),
                    Err(e) => log::warn!("autosave failed: {e:#}"),
                }
            }
        }
        // Derived systems: start after a quiet period, restart on change.
        if let Some(job) = &self.derived_job {
            if let Some(result) = job.try_take() {
                let elapsed = job.started.elapsed();
                self.derived_job = None;
                if !result.cancelled {
                    let t = Instant::now();
                    self.derived_tex.upload(&self.gpu.queue, &result);
                    self.cpu.sections.insert("derived upload", t.elapsed().as_secs_f32() * 1000.0);
                    self.doc.last_derived_ms = result.timings.total_ms;
                    self.ui.status = format!(
                        "Rivers & biomes: {:.0} ms ({} rivers, {} lakes, {} tiles uploaded)",
                        elapsed.as_secs_f32() * 1000.0,
                        result.rivers.len(),
                        result.lakes.len(),
                        self.derived_tex.last_upload_tiles
                    );
                    self.doc.derived = Some(result);
                }
                if self.derived_rerun {
                    self.derived_rerun = false;
                    self.doc.derived_stale = true;
                }
            } else if self.doc.derived_stale && !self.derived_rerun {
                // Newer edits: cancel and rerun once this job exits.
                job.cancel();
                self.derived_rerun = true;
                self.doc.derived_stale = false;
            }
        } else if self.doc.derived_stale
            && !self.input.stroke
            && self.tools.queued.is_empty()
            && self.doc.pending_readback.is_empty()
            && !self.field.has_in_flight()
            && self.doc.derived_last_change.elapsed() >= DERIVED_DEBOUNCE
            && self.gen_job.is_none()
            && self.load_job.is_none()
        {
            self.doc.derived_stale = false;
            let elev = self.doc.elevation.clone();
            let sea = self.doc.sea_level;
            let params = self.doc.params.clone();
            self.derived_job = Some(Job::spawn("Rivers & biomes", move |progress, cancel| {
                derived::compute(&elev, sea, &params, cancel, progress)
            }));
        }

        // Periodic autosave of modified documents.
        if self.doc.modified
            && self.autosave_job.is_none()
            && self.save_job.is_none()
            && self.doc.last_autosave.elapsed() >= AUTOSAVE_INTERVAL
            && !self.input.stroke
        {
            self.doc.last_autosave = Instant::now();
            let view = ViewState { center: self.camera.center.to_array(), zoom: self.camera.zoom };
            let data = self.doc.to_project_data(view);
            let path = self.doc.path.clone();
            self.autosave_job = Some(Job::spawn("Autosaving", move |_, _| project::autosave(path.as_deref(), &data)));
        }
    }

    // ---- strokes -----------------------------------------------------------

    /// Block until the mirror is current, finalize any finishing strokes.
    fn sync_mirror(&mut self) {
        let landed = self.field.flush(&self.gpu.device, &self.gpu.queue, &mut self.doc.elevation, &mut self.doc.pending_readback);
        if !landed.is_empty() {
            self.doc.on_tiles_landed(&landed);
        }
        self.doc.try_finalize_strokes(self.field.has_in_flight());
    }

    fn begin_stroke(&mut self, pos_screen: Vec2, pressure: f32) {
        let Some(mode) = self.tools.tool.blend_mode() else { return };
        // Dispatch anything still queued from a previous stroke, then sync.
        self.finish_stroke_now();
        self.sync_mirror();
        let fp = self.camera.screen_to_field(pos_screen, self.screen_size());
        let target = if fp.x >= 0.0 && fp.y >= 0.0 && fp.x < self.doc.width() as f32 && fp.y < self.doc.height() as f32 {
            self.doc.elevation.sample(fp.x, fp.y)
        } else {
            0.0
        };
        self.tools.stroke_seed = self.tools.stroke_seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let settings = self.tools.settings_for_tool();
        let mut sampler = StrokeSampler::new(settings, mode, target, self.tools.stroke_seed);
        let dabs = sampler.feed(StrokeInput { pos: fp, pressure, tilt: Vec2::ZERO, time: self.start.elapsed().as_secs_f64() });
        self.tools.queued.extend(dabs);
        self.tools.sampler = Some(sampler);
        self.tools.stroke_dabs = 0;
        self.doc.begin_stroke(self.tools.tool.label());
        self.input.stroke = true;
    }

    fn continue_stroke(&mut self, pos_screen: Vec2, pressure: f32) {
        let fp = self.camera.screen_to_field(pos_screen, self.screen_size());
        let t = self.start.elapsed().as_secs_f64();
        if let Some(s) = self.tools.sampler.as_mut() {
            let dabs = s.feed(StrokeInput { pos: fp, pressure, tilt: Vec2::ZERO, time: t });
            self.tools.queued.extend(dabs);
        }
    }

    fn end_stroke(&mut self) {
        if let Some(mut s) = self.tools.sampler.take() {
            self.tools.queued.extend(s.finish());
        }
        self.input.stroke = false;
        self.input.close_pending = true;
        self.close_stroke_if_drained();
    }

    fn close_stroke_if_drained(&mut self) {
        if self.input.close_pending && self.tools.queued.is_empty() {
            self.input.close_pending = false;
            self.doc.end_stroke();
        }
    }

    /// Dispatch every queued dab synchronously (used before undo/save/new).
    fn finish_stroke_now(&mut self) {
        if self.input.stroke {
            self.end_stroke();
        }
        while !self.tools.queued.is_empty() {
            let mut enc = self.gpu.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("stroke flush") });
            self.encode_queued_dabs(&mut enc);
            self.gpu.queue.submit([enc.finish()]);
        }
        self.close_stroke_if_drained();
        self.sync_mirror();
    }

    fn encode_queued_dabs(&mut self, encoder: &mut wgpu::CommandEncoder) {
        if self.tools.queued.is_empty() {
            return;
        }
        let n = self.tools.queued.len().min(MAX_DABS_PER_FRAME);
        let (w, h) = (self.doc.width(), self.doc.height());
        let mut rect = PixelRect::EMPTY;
        for d in &self.tools.queued[..n] {
            rect = rect.union(&d.rect(w, h));
        }
        self.doc.stroke_will_touch(&rect);
        let mut dirty = self.doc.elevation.empty_tileset();
        let used = self.brush.encode(&self.gpu.queue, encoder, &self.field, &self.tools.queued[..n], &mut dirty, &mut self.profiler);
        self.tools.queued.drain(..used);
        self.tools.stroke_dabs += used as u32;
        if !dirty.is_empty() {
            self.doc.pending_readback.union_with(&dirty);
            self.doc.modified = true;
        }
        self.close_stroke_if_drained();
    }

    // ---- actions -----------------------------------------------------------

    fn undo(&mut self) {
        self.finish_stroke_now();
        if let Some(tiles) = self.doc.undo() {
            self.field.upload_tiles(&self.gpu.queue, &self.doc.elevation, tiles.into_iter());
            self.ui.status = "Undo".into();
        }
    }

    fn redo(&mut self) {
        self.finish_stroke_now();
        if let Some(tiles) = self.doc.redo() {
            self.field.upload_tiles(&self.gpu.queue, &self.doc.elevation, tiles.into_iter());
            self.ui.status = "Redo".into();
        }
    }

    fn fit_view(&mut self) {
        self.camera = Camera::fit(Vec2::new(self.doc.width() as f32, self.doc.height() as f32), self.screen_size());
        self.needs_fit = false;
    }

    fn handle_actions(&mut self, actions: Vec<UiAction>, event_loop: &ActiveEventLoop) {
        for a in actions {
            match a {
                UiAction::New(p) => self.start_generation(p),
                UiAction::Open => self.open_dialog(),
                UiAction::Save => self.save(),
                UiAction::SaveAs => self.save_as(),
                UiAction::Undo => self.undo(),
                UiAction::Redo => self.redo(),
                UiAction::Quit => {
                    project::discard_autosave(None);
                    event_loop.exit();
                }
                UiAction::FitView => self.fit_view(),
                UiAction::Recover(rp) => {
                    let dir = rp.autosave_dir.clone();
                    let target = rp.project_dir.clone();
                    self.load_job = Some(Job::spawn("Recovering autosave", move |_, _| {
                        let r = project::load(&dir);
                        (target, r)
                    }));
                    self.doc.modified = true;
                }
                UiAction::DiscardRecovery => {
                    project::discard_autosave(self.doc.path.as_deref());
                    project::discard_autosave(None);
                }
                UiAction::SeaLevelCommit { from, to } => self.doc.commit_sea_level(from, to),
                UiAction::SettingsChanged => self.doc.settings_changed(),
                UiAction::ViewMode(m) => self.view_mode = m,
                UiAction::ShowWater(b) => self.show_water = b,
            }
        }
    }

    // ---- events ------------------------------------------------------------

    /// Returns true when the app should exit.
    fn handle_event(&mut self, event_loop: &ActiveEventLoop, event: WindowEvent) -> bool {
        let response = self.egui_state.on_window_event(&self.window, &event);
        let egui_wants_pointer = self.egui_ctx.egui_wants_pointer_input() || self.egui_ctx.is_pointer_over_egui();
        let egui_wants_keys = self.egui_ctx.egui_wants_keyboard_input();
        match event {
            WindowEvent::CloseRequested => {
                project::discard_autosave(None);
                return true;
            }
            WindowEvent::Resized(size) => {
                if size.width > 0 && size.height > 0 {
                    self.config.width = size.width;
                    self.config.height = size.height;
                    self.surface.configure(&self.gpu.device, &self.config);
                }
            }
            WindowEvent::ScaleFactorChanged { .. } => {}
            WindowEvent::RedrawRequested => self.frame(event_loop),
            WindowEvent::DroppedFile(path) => {
                if path.join("manifest.json").exists() {
                    self.open_path(path);
                } else if path.file_name().map(|n| n == "manifest.json").unwrap_or(false) {
                    if let Some(p) = path.parent() {
                        self.open_path(p.to_path_buf());
                    }
                }
            }
            WindowEvent::ModifiersChanged(m) => {
                self.input.ctrl = m.state().control_key() || m.state().super_key();
                self.input.shift = m.state().shift_key();
            }
            WindowEvent::KeyboardInput { event, .. } => {
                if event.state == ElementState::Pressed && !(egui_wants_keys && response.consumed) {
                    self.key_pressed(event.physical_key, event.repeat, event_loop);
                } else if event.state == ElementState::Released {
                    if let PhysicalKey::Code(KeyCode::Space) = event.physical_key {
                        self.input.space = false;
                        if self.input.panning && !self.input.stroke {
                            self.input.panning = false;
                        }
                    }
                }
            }
            WindowEvent::CursorMoved { position, .. } => {
                let p = Vec2::new(position.x as f32, position.y as f32);
                if let Some(prev) = self.input.cursor {
                    if self.input.panning {
                        self.camera.pan_screen(p - prev);
                    }
                }
                self.input.cursor = Some(p);
                if self.input.stroke && self.input.touch_id.is_none() {
                    self.continue_stroke(p, 1.0);
                }
            }
            WindowEvent::CursorLeft { .. } => {
                self.input.cursor = None;
            }
            WindowEvent::MouseInput { state, button, .. } => {
                let Some(p) = self.input.cursor else { return false };
                match (button, state) {
                    (MouseButton::Left, ElementState::Pressed) => {
                        if egui_wants_pointer {
                            return false;
                        }
                        if self.input.space || self.tools.tool == Tool::Pan {
                            self.input.panning = true;
                        } else if self.tools.tool.is_brush() {
                            self.input.touch_id = None;
                            self.begin_stroke(p, 1.0);
                        }
                    }
                    (MouseButton::Left, ElementState::Released) => {
                        if self.input.stroke && self.input.touch_id.is_none() {
                            self.end_stroke();
                        }
                        if !self.input.space {
                            self.input.panning = false;
                        }
                    }
                    (MouseButton::Middle | MouseButton::Right, ElementState::Pressed) => {
                        if !egui_wants_pointer {
                            self.input.panning = true;
                        }
                    }
                    (MouseButton::Middle | MouseButton::Right, ElementState::Released) => {
                        if !self.input.space {
                            self.input.panning = false;
                        }
                    }
                    _ => {}
                }
            }
            WindowEvent::MouseWheel { delta, .. } => {
                if egui_wants_pointer {
                    return false;
                }
                let Some(p) = self.input.cursor else { return false };
                let steps = match delta {
                    MouseScrollDelta::LineDelta(_, y) => y,
                    MouseScrollDelta::PixelDelta(d) => d.y as f32 / 60.0,
                };
                if steps != 0.0 {
                    let factor = 1.15f32.powf(steps);
                    let ss = self.screen_size();
                    self.camera.zoom_about(p, ss, factor);
                }
            }
            WindowEvent::Touch(t) => {
                if egui_wants_pointer && t.phase == TouchPhase::Started {
                    return false;
                }
                let p = Vec2::new(t.location.x as f32, t.location.y as f32);
                let pressure = t.force.map(|f| f.normalized() as f32).unwrap_or(1.0).clamp(0.05, 1.0);
                match t.phase {
                    TouchPhase::Started => {
                        if self.input.touch_id.is_none() && self.tools.tool.is_brush() {
                            self.input.touch_id = Some(t.id);
                            self.input.cursor = Some(p);
                            self.begin_stroke(p, pressure);
                        }
                    }
                    TouchPhase::Moved => {
                        if self.input.touch_id == Some(t.id) {
                            self.input.cursor = Some(p);
                            self.continue_stroke(p, pressure);
                        }
                    }
                    TouchPhase::Ended | TouchPhase::Cancelled => {
                        if self.input.touch_id == Some(t.id) {
                            self.input.touch_id = None;
                            self.end_stroke();
                        }
                    }
                }
            }
            _ => {}
        }
        if response.repaint || self.wants_redraw() || self.input.cursor.is_some() {
            self.window.request_redraw();
        }
        false
    }

    fn key_pressed(&mut self, key: PhysicalKey, repeat: bool, event_loop: &ActiveEventLoop) {
        let PhysicalKey::Code(code) = key else { return };
        let ctrl = self.input.ctrl;
        match code {
            KeyCode::Space => {
                self.input.space = true;
            }
            KeyCode::KeyZ if ctrl && !repeat => {
                if self.input.shift {
                    self.redo();
                } else {
                    self.undo();
                }
            }
            KeyCode::KeyY if ctrl && !repeat => self.redo(),
            KeyCode::KeyS if ctrl && !repeat => {
                if self.input.shift {
                    self.save_as();
                } else {
                    self.save();
                }
            }
            KeyCode::KeyO if ctrl && !repeat => self.open_dialog(),
            KeyCode::KeyN if ctrl && !repeat => self.ui.show_new = true,
            KeyCode::KeyQ if ctrl => {
                project::discard_autosave(None);
                event_loop.exit();
            }
            KeyCode::F3 if !repeat => self.ui.show_profiler = !self.ui.show_profiler,
            KeyCode::Home => self.fit_view(),
            KeyCode::Digit1 => self.tools.tool = Tool::Raise,
            KeyCode::Digit2 => self.tools.tool = Tool::Lower,
            KeyCode::Digit3 => self.tools.tool = Tool::Smooth,
            KeyCode::Digit4 => self.tools.tool = Tool::Flatten,
            KeyCode::Digit5 => self.tools.tool = Tool::Pan,
            KeyCode::BracketLeft => self.tools.brush.radius = (self.tools.brush.radius / 1.2).max(1.0),
            KeyCode::BracketRight => self.tools.brush.radius = (self.tools.brush.radius * 1.2).min(1024.0),
            KeyCode::Escape => {
                if self.input.stroke {
                    self.end_stroke();
                }
            }
            _ => {}
        }
    }

    // ---- frame -------------------------------------------------------------

    fn frame(&mut self, event_loop: &ActiveEventLoop) {
        self.cpu.tick();
        self.profiler.poll();
        self.profiler.begin_frame();
        self.poll_jobs();
        if self.needs_fit {
            self.fit_view();
        }
        if self.frames_since_install != u32::MAX {
            self.frames_since_install += 1;
            if self.frames_since_install == 3 && self.demo && self.gen_job.is_none() && self.load_job.is_none() {
                self.run_demo();
            }
        }

        // UI.
        let raw = self.egui_state.take_egui_input(&self.window);
        let cursor_field = self.input.cursor.map(|p| self.camera.screen_to_field(p, self.screen_size()));
        let job = [
            self.gen_job.as_ref().map(|j| (j.name.clone(), j.progress01())),
            self.load_job.as_ref().map(|j| (j.name.clone(), 0.5)),
            self.save_job.as_ref().map(|j| (j.name.clone(), 0.5)),
            self.autosave_job.as_ref().map(|j| (j.name.clone(), 0.5)),
            self.derived_job.as_ref().map(|j| (j.name.clone(), j.progress01())),
        ]
        .into_iter()
        .flatten()
        .next();
        let mut actions = Vec::new();
        let t_ui = Instant::now();
        let full = {
            let ctx = self.egui_ctx.clone();
            let ui_state = &mut self.ui;
            let mut uc = Some(UiContext {
                doc: &mut self.doc,
                tools: &mut self.tools,
                camera: &self.camera,
                cpu: &self.cpu,
                gpu_ms: &self.profiler.gpu_ms,
                gpu_name: &self.gpu.info.name,
                gpu_backend: &format!("{:?}", self.gpu.info.backend),
                timestamps_supported: self.gpu.has_timestamps(),
                device_bytes: self.field.device_bytes,
                allocated_bytes: self.gpu.allocated_bytes(),
                readback: self.field.stats,
                brush_dispatches: self.brush.last_dispatches,
                brush_texels: self.brush.last_texels,
                brush_dabs: self.brush.last_dabs,
                cursor_field,
                job,
                max_field_dim: self.gpu.max_field_dim(),
                view_mode: self.view_mode,
                show_water: self.show_water,
                derived_running: self.derived_job.as_ref().map(|j| j.progress01()),
                derived_device_bytes: self.derived_tex.device_bytes(),
                derived_upload_tiles: self.derived_tex.last_upload_tiles,
            });
            ctx.run_ui(raw, |root| {
                if let Some(uc) = uc.take() {
                    actions = ui::draw(root, ui_state, uc);
                }
            })
        };
        self.cpu.sections.insert("ui", t_ui.elapsed().as_secs_f32() * 1000.0);
        self.egui_state.handle_platform_output(&self.window, full.platform_output);
        self.handle_actions(actions, event_loop);
        if event_loop.exiting() {
            return;
        }

        // GPU work.
        let mut encoder = self.gpu.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("frame") });
        let t = Instant::now();
        self.encode_queued_dabs(&mut encoder);
        self.cpu.sections.insert("brush encode", t.elapsed().as_secs_f32() * 1000.0);
        let t = Instant::now();
        self.field.encode_readback(&self.gpu.device, &mut encoder, &mut self.doc.pending_readback);
        self.cpu.sections.insert("readback encode", t.elapsed().as_secs_f32() * 1000.0);

        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t) | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                // Still submit the compute work so strokes are not lost.
                self.gpu.queue.submit([encoder.finish()]);
                self.field.after_submit();
                return;
            }
            _ => {
                self.surface.configure(&self.gpu.device, &self.config);
                self.gpu.queue.submit([encoder.finish()]);
                self.field.after_submit();
                self.window.request_redraw();
                return;
            }
        };
        let target = frame.texture.create_view(&Default::default());

        let ss = self.screen_size();
        let origin = self.camera.screen_to_field(Vec2::ZERO, ss);
        let az = self.doc.render.sun_azimuth_deg.to_radians();
        let alt = self.doc.render.sun_altitude_deg.to_radians();
        let mut flags = FLAG_HYPSO;
        if self.doc.render.show_contours {
            flags |= FLAG_CONTOURS;
        }
        if self.show_water {
            flags |= FLAG_WATER;
        }
        if self.derived_tex.uploaded.is_some() {
            flags |= FLAG_HAS_DERIVED;
        }
        let (flow_max, temp_min, temp_max) = match &self.doc.derived {
            Some(d) => {
                let fm = d.flow.min_max().1.max(1.0);
                let (tlo, thi) = d.temperature.min_max();
                (fm, tlo, thi.max(tlo + 1.0))
            }
            None => (1.0, -20.0, 30.0),
        };
        let mut palette = [[0f32; 4]; 16];
        for (i, b) in Biome::ALL.iter().enumerate() {
            let c = b.color();
            palette[i] = [c[0], c[1], c[2], 1.0];
        }
        let egui_over = self.egui_ctx.is_pointer_over_egui();
        let show_cursor = self.tools.tool.is_brush() && self.input.cursor.is_some() && !egui_over && !self.input.panning;
        if show_cursor {
            flags |= FLAG_CURSOR;
        }
        let view = ViewUniform {
            screen_size: ss.to_array(),
            field_size: [self.doc.width() as f32, self.doc.height() as f32],
            origin: origin.to_array(),
            scale: self.camera.zoom,
            sea_level: self.doc.sea_level,
            sun_dir: [az.sin() * alt.cos(), -az.cos() * alt.cos(), alt.sin()],
            exaggeration: self.doc.render.vertical_exaggeration,
            shade_strength: self.doc.render.hillshade_strength,
            contour_interval: self.doc.render.contour_interval,
            coast_width: self.doc.render.coast_line_width,
            flags,
            cursor: cursor_field.unwrap_or(Vec2::ZERO).to_array(),
            cursor_radius: self.tools.brush.radius,
            meters_per_texel: self.doc.meters_per_texel,
            elev_min: self.doc.stats.min,
            elev_max: self.doc.stats.max,
            time: self.start.elapsed().as_secs_f32(),
            _pad: 0.0,
            view_mode: self.view_mode as u32,
            flow_max,
            temp_min,
            temp_max,
            palette,
        };
        self.map.render(&self.gpu.queue, &mut encoder, &target, &view, &mut self.profiler);

        // egui on top.
        let t = Instant::now();
        let ppp = full.pixels_per_point;
        let paint_jobs = self.egui_ctx.tessellate(full.shapes, ppp);
        let screen = egui_wgpu::ScreenDescriptor { size_in_pixels: [self.config.width, self.config.height], pixels_per_point: ppp };
        for (id, delta) in &full.textures_delta.set {
            self.egui_renderer.update_texture(&self.gpu.device, &self.gpu.queue, *id, delta);
        }
        self.egui_renderer.update_buffers(&self.gpu.device, &self.gpu.queue, &mut encoder, &paint_jobs, &screen);
        {
            let pass = encoder.begin_render_pass(&wgpu::RenderPassDescriptor {
                label: Some("egui"),
                color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                    view: &target,
                    depth_slice: None,
                    resolve_target: None,
                    ops: wgpu::Operations { load: wgpu::LoadOp::Load, store: wgpu::StoreOp::Store },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
                multiview_mask: None,
            });
            let mut pass = pass.forget_lifetime();
            self.egui_renderer.render(&mut pass, &paint_jobs, &screen);
        }
        for id in &full.textures_delta.free {
            self.egui_renderer.free_texture(id);
        }
        self.cpu.sections.insert("egui render", t.elapsed().as_secs_f32() * 1000.0);

        self.profiler.end_frame(&mut encoder);
        let t = Instant::now();
        self.gpu.queue.submit([encoder.finish()]);
        self.field.after_submit();
        self.profiler.after_submit();
        self.window.pre_present_notify();
        let take_shot = self.screenshot.is_some()
            && self.frames_since_install >= 20
            && self.gen_job.is_none()
            && self.load_job.is_none()
            && self.derived_job.is_none()
            && !self.doc.derived_stale
            && self.doc.derived.is_some();
        if take_shot {
            let path = self.screenshot.take().unwrap();
            if self.surface_copyable {
                if let Err(e) = self.save_screenshot(&frame.texture, &path) {
                    log::error!("screenshot failed: {e:#}");
                }
            } else {
                log::error!("surface does not support COPY_SRC; cannot take screenshot");
            }
        }
        frame.present();
        if take_shot {
            project::discard_autosave(None);
            event_loop.exit();
            return;
        }
        self.cpu.sections.insert("submit+present", t.elapsed().as_secs_f32() * 1000.0);

        // Sync: pull finished readbacks into the mirror and update derived data.
        let t = Instant::now();
        let _ = self.gpu.device.poll(wgpu::PollType::Poll);
        let landed = self.field.collect(&mut self.doc.elevation);
        if !landed.is_empty() {
            self.doc.on_tiles_landed(&landed);
        }
        let n = self.doc.try_finalize_strokes(self.field.has_in_flight());
        if n > 0 {
            self.ui.status = format!("{} · {} dabs", self.doc.undo.undo_label().unwrap_or(""), self.tools.stroke_dabs);
        }
        self.cpu.sections.insert("mirror sync", t.elapsed().as_secs_f32() * 1000.0);

        if self.wants_redraw() {
            self.window.request_redraw();
        }
    }
}

