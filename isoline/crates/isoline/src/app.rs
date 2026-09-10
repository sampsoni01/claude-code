//! Window, input, and the per-frame pipeline.

use crate::camera::Camera;
use crate::document::{Document, FieldKind};
use crate::gpu::brush::{BrushPass, MAX_DABS_PER_FRAME};
use crate::gpu::field::GpuField;
use crate::gpu::map_render::{DerivedViews, MapRenderer, ViewMode, ViewUniform, FLAG_CONTOURS, FLAG_CURSOR, FLAG_HAS_DERIVED, FLAG_HYPSO, FLAG_WATER};
use crate::gpu::profiler::{CpuStats, GpuProfiler};
use crate::gpu::sprites::{Atlas, SpriteInstance, SpritePass};
use crate::library::Library;
use crate::gpu::Gpu;
use crate::jobs::Job;
use crate::tools::{Tool, ToolState};
use crate::ui::{self, NewProjectParams, Overlay, RecoveryPrompt, UiAction, UiContext, UiState, WaterSel};
use anyhow::{Context, Result};
use glam::Vec2;
use isoline_core::biome::Biome;
use isoline_core::brush::{StrokeInput, StrokeSampler};
use isoline_core::derived::{self, Derived};
use isoline_core::field::ScalarField;
use isoline_core::placement::{self, Placement, PlacementLayer, Rng, SpatialHash, Terrain};
use isoline_core::procedural::{self, CoastPreset};
use isoline_core::project::{self, ProjectData, ViewState};
use isoline_core::terrain;
use isoline_core::theme::{ForestStyle, ReliefStyle, Theme, ThemeStyle};
use isoline_core::assets::TerrainFilter;
use isoline_core::tiles::PixelRect;
use isoline_core::undo::GeometrySnapshot;
use isoline_core::water::RecomputeMode;
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
/// Quiet time after the last edit before the derived job starts (After stroke mode).
pub const DERIVED_DEBOUNCE: Duration = Duration::from_millis(500);
/// Water recompute budget; exceeding it downgrades the simulation resolution.
pub const WATER_BUDGET_MS: f32 = 1000.0;

#[derive(Clone, Debug)]
pub struct StartupOptions {
    pub open: Option<PathBuf>,
    pub size: u32,
    pub demo: bool,
    pub screenshot: Option<PathBuf>,
    pub theme: Option<String>,
    pub zoom: Option<f32>,
    pub center: Option<(f32, f32)>,
}

impl Default for StartupOptions {
    fn default() -> Self {
        Self { open: None, size: 2048, demo: false, screenshot: None, theme: None, zoom: None, center: None }
    }
}

/// What is currently on the GPU for diffing.
struct UploadedDerived {
    water_cov: ScalarField,
    biome: ScalarField,
    forest: ScalarField,
    moisture: Option<ScalarField>,
    temperature: ScalarField,
}

/// GPU copies of the derived fields. Water and biome live at project
/// resolution; moisture and temperature at the simulation resolution, except
/// that baked moisture is a paintable project-resolution field.
struct DerivedTextures {
    water: GpuField,
    biome: GpuField,
    forest: GpuField,
    moisture: GpuField,
    temperature: GpuField,
    uploaded: Option<UploadedDerived>,
    last_upload_tiles: u32,
}

impl DerivedTextures {
    fn new(device: &wgpu::Device, w: u32, h: u32) -> Self {
        Self {
            water: GpuField::new_labelled(device, w, h, "water"),
            biome: GpuField::new_labelled(device, w, h, "biome"),
            forest: GpuField::new_labelled(device, w, h, "forest"),
            moisture: GpuField::new_labelled(device, 64, 64, "moisture"),
            temperature: GpuField::new_labelled(device, 64, 64, "temperature"),
            uploaded: None,
            last_upload_tiles: 0,
        }
    }

    fn views(&self) -> DerivedViews<'_> {
        DerivedViews { water: &self.water.view, moisture: &self.moisture.view, temperature: &self.temperature.view, biome: &self.biome.view, forest: &self.forest.view }
    }

    fn device_bytes(&self) -> u64 {
        self.water.device_bytes + self.moisture.device_bytes + self.temperature.device_bytes + self.biome.device_bytes + self.forest.device_bytes
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
    close_pending: bool,
    touch_id: Option<u64>,
}

/// The last procedural stroke, so parameter changes can re-apply it.
struct LastProcedural {
    tool: Tool,
    path: Vec<[f32; 2]>,
    undo_len_after: usize,
}

#[derive(Default)]
struct WaterEdit {
    selected: Option<WaterSel>,
    dragging: bool,
    before: Option<GeometrySnapshot>,
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
    derived_rerun: bool,
    library: Library,
    atlas: Atlas,
    sprites: SpritePass,
    atlas_egui: Option<egui::TextureId>,
    symbol_job: Option<Job<(Vec<Placement>, u64)>>,
    instances_dirty: bool,
    instance_key: (usize, usize),
    selected_placement: Option<u64>,
    place_drag: Option<Vec<Placement>>,
    scatter_before: Option<Vec<Placement>>,
    scatter_hash: Option<SpatialHash>,
    scatter_rng: Rng,
    /// Consecutive water runs over budget (two in a row downgrade the resolution).
    over_budget_runs: u32,
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
    last_proc: Option<LastProcedural>,
    water_edit: WaterEdit,
    gen_job: Option<Job<(NewProjectParams, ScalarField)>>,
    load_job: Option<Job<(Option<PathBuf>, Result<ProjectData>)>>,
    save_job: Option<Job<(PathBuf, Result<()>)>>,
    autosave_job: Option<Job<Result<PathBuf>>>,
    start: Instant,
    needs_fit: bool,
    demo: bool,
    demo_stage: u32,
    startup_theme: Option<ThemeStyle>,
    startup_view: (Option<f32>, Option<(f32, f32)>),
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
        let attrs = Window::default_attributes().with_title("Isoline").with_inner_size(winit::dpi::LogicalSize::new(1480.0, 920.0));
        let window = Arc::new(event_loop.create_window(attrs).context("create window")?);
        let instance = Gpu::new_instance();
        let surface = instance.create_surface(window.clone()).context("create surface")?;
        let gpu = Gpu::new(instance, Some(&surface))?;

        let caps = surface.get_capabilities(&gpu.adapter);
        let format = caps.formats.iter().copied().find(|f| !f.is_srgb()).unwrap_or(caps.formats[0]);
        let size = window.inner_size();
        let surface_copyable = caps.usages.contains(wgpu::TextureUsages::COPY_SRC);
        let config = wgpu::SurfaceConfiguration {
            usage: if surface_copyable { wgpu::TextureUsages::RENDER_ATTACHMENT | wgpu::TextureUsages::COPY_SRC } else { wgpu::TextureUsages::RENDER_ATTACHMENT },
            format,
            width: size.width.max(1),
            height: size.height.max(1),
            present_mode: if caps.present_modes.contains(&wgpu::PresentMode::Mailbox) { wgpu::PresentMode::Mailbox } else { wgpu::PresentMode::AutoVsync },
            alpha_mode: caps.alpha_modes[0],
            view_formats: vec![],
            desired_maximum_frame_latency: 2,
        };
        surface.configure(&gpu.device, &config);

        let egui_ctx = egui::Context::default();
        ui::install_fonts(&egui_ctx);
        ui::apply_style(&egui_ctx);
        let egui_state = egui_winit::State::new(
            egui_ctx.clone(),
            egui::ViewportId::ROOT,
            &window,
            Some(window.scale_factor() as f32),
            window.theme(),
            Some(gpu.limits.max_texture_dimension_2d as usize),
        );
        let egui_renderer = egui_wgpu::Renderer::new(&gpu.device, format, egui_wgpu::RendererOptions { msaa_samples: 1, ..Default::default() });

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
        brush.bind(&gpu.device, "elevation", &field);
        let mut map = MapRenderer::new(&gpu.device, format);
        let derived_tex = DerivedTextures::new(&gpu.device, doc.width(), doc.height());
        map.bind(&gpu.device, &field, derived_tex.views());
        let profiler = GpuProfiler::new(&gpu.device, &gpu.queue, gpu.has_timestamps());
        let mut atlas = Atlas::new(&gpu.device);
        let mut library = Library::new();
        library.reload(&mut atlas, &gpu.queue);
        let mut sprites = SpritePass::new(&gpu.device, format);
        sprites.bind(&gpu.device, &atlas);
        let mut egui_renderer = egui_renderer;
        let atlas_egui = Some(egui_renderer.register_native_texture(&gpu.device, &atlas.view, wgpu::FilterMode::Linear));

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
            library,
            atlas,
            sprites,
            atlas_egui,
            symbol_job: None,
            instances_dirty: true,
            instance_key: (usize::MAX, usize::MAX),
            selected_placement: None,
            place_drag: None,
            scatter_before: None,
            scatter_hash: None,
            scatter_rng: Rng::new(99),
            over_budget_runs: 0,
            view_mode: ViewMode::Map,
            show_water: true,
            brush,
            map,
            profiler,
            cpu: CpuStats::new(),
            camera: Camera::new(Vec2::new(128.0, 128.0), 1.0),
            tools: ToolState::default(),
            ui: UiState::default(),
            input: Input::default(),
            last_proc: None,
            water_edit: WaterEdit::default(),
            gen_job: None,
            load_job: None,
            save_job: None,
            autosave_job: None,
            start: Instant::now(),
            needs_fit: true,
            demo: opts.demo,
            demo_stage: 0,
            startup_theme: opts.theme.as_deref().and_then(|t| match t {
                "ink" | "parchment" => Some(ThemeStyle::ParchmentInk),
                "illuminated" => Some(ThemeStyle::Illuminated),
                "modern" => Some(ThemeStyle::Modern),
                _ => None,
            }),
            startup_view: (opts.zoom, opts.center),
            screenshot: opts.screenshot.clone(),
            frames_since_install: u32::MAX,
            surface_copyable,
        };

        match &opts.open {
            Some(p) => st.open_path(p.clone()),
            None => {
                let params = NewProjectParams { size: opts.size.clamp(64, st.gpu.max_field_dim()) / 64 * 64, ..NewProjectParams::default() };
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
            || self.doc.any_pending_readback()
            || self.field.has_in_flight()
            || self.derived_tex.moisture.has_in_flight()
            || self.gen_job.is_some()
            || self.load_job.is_some()
            || self.save_job.is_some()
            || self.autosave_job.is_some()
            || self.derived_job.is_some()
            || self.symbol_job.is_some()
            || (self.doc.symbols_stale && self.doc.derived.is_some())
            || (self.doc.derived_stale && self.doc.params.water.mode != RecomputeMode::Manual)
            || self.doc.derived_requested
            || self.egui_ctx.has_requested_repaint()
    }

    // ---- document lifecycle --------------------------------------------------

    fn install_document(&mut self, doc: Document) {
        self.finish_stroke_now();
        if let Some(j) = self.derived_job.take() {
            j.cancel();
        }
        self.derived_rerun = false;
        self.doc = doc;
        if let Some(t) = self.startup_theme {
            self.doc.render.theme = Theme::preset(t);
        }
        if let Some(j) = self.symbol_job.take() {
            j.cancel();
        }
        self.library.set_project_dir(self.doc.path.clone());
        self.selected_placement = None;
        self.instances_dirty = true;
        self.field = GpuField::new(&self.gpu.device, self.doc.width(), self.doc.height());
        self.field.upload_all(&self.gpu.queue, &self.doc.elevation);
        self.derived_tex = DerivedTextures::new(&self.gpu.device, self.doc.width(), self.doc.height());
        self.brush.bind(&self.gpu.device, "elevation", &self.field);
        self.brush.unbind("moisture");
        if self.doc.baked.is_some() {
            self.install_baked_moisture();
        }
        self.map.bind(&self.gpu.device, &self.field, self.derived_tex.views());
        self.tools.queued.clear();
        self.tools.sampler = None;
        self.tools.path.clear();
        self.input.stroke = false;
        self.last_proc = None;
        self.water_edit = WaterEdit::default();
        self.needs_fit = true;
        if self.doc.saved_view.zoom > 0.0 {
            self.camera = Camera::new(Vec2::from(self.doc.saved_view.center), self.doc.saved_view.zoom);
            self.needs_fit = false;
        }
        if self.startup_view.0.is_some() || self.startup_view.1.is_some() {
            let c = self.startup_view.1.map(|(x, y)| Vec2::new(x * self.doc.width() as f32, y * self.doc.height() as f32)).unwrap_or(Vec2::new(self.doc.width() as f32 / 2.0, self.doc.height() as f32 / 2.0));
            self.camera = Camera::new(c, self.startup_view.0.unwrap_or(1.0));
            self.needs_fit = false;
        }
        self.doc.derived_stale = true;
        self.doc.derived_last_change = Instant::now() - DERIVED_DEBOUNCE;
        if self.doc.params.water.mode == RecomputeMode::Manual {
            self.doc.derived_requested = true;
        }
        self.window.set_title(&format!("Isoline — {}", self.doc.name));
        self.frames_since_install = 0;
    }

    /// Make the baked moisture field a paintable project-resolution texture.
    fn install_baked_moisture(&mut self) {
        let Some(b) = self.doc.baked.as_ref() else { return };
        self.derived_tex.moisture = GpuField::new_labelled(&self.gpu.device, b.moisture.width(), b.moisture.height(), "moisture");
        self.derived_tex.moisture.upload_all(&self.gpu.queue, &b.moisture);
        if let Some(u) = self.derived_tex.uploaded.as_mut() {
            u.moisture = Some(b.moisture.clone());
        }
        self.brush.bind(&self.gpu.device, "moisture", &self.derived_tex.moisture);
        self.map.bind(&self.gpu.device, &self.field, self.derived_tex.views());
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
        if let Some(p) = rfd::FileDialog::new().set_title("Open map (choose the .isoline folder)").pick_folder() {
            self.open_path(p);
        }
    }

    // ---- derived job ---------------------------------------------------------

    fn derived_job_allowed(&self) -> bool {
        let mode = self.doc.params.water.mode;
        if self.gen_job.is_some() || self.load_job.is_some() {
            return false;
        }
        if self.doc.derived_requested {
            return true;
        }
        if !self.doc.derived_stale {
            return false;
        }
        match mode {
            RecomputeMode::Live => true,
            RecomputeMode::AfterStroke => {
                !self.input.stroke
                    && self.tools.queued.is_empty()
                    && !self.doc.any_pending_readback()
                    && !self.field.has_in_flight()
                    && !self.derived_tex.moisture.has_in_flight()
                    && self.doc.derived_last_change.elapsed() >= DERIVED_DEBOUNCE
            }
            RecomputeMode::Manual => false,
        }
    }

    fn spawn_derived_job(&mut self) {
        self.doc.derived_stale = false;
        self.doc.derived_requested = false;
        let elev = self.doc.elevation.clone();
        let sea = self.doc.sea_level;
        let params = self.doc.params.clone();
        let baked = self.doc.baked.clone();
        self.derived_job = Some(Job::spawn("Water & biomes", move |progress, cancel| {
            derived::compute(&elev, sea, &params, baked.as_ref(), cancel, progress)
        }));
    }

    fn sync_derived_textures(&mut self, d: &Derived) {
        let t = Instant::now();
        let q = &self.gpu.queue;
        let old = self.derived_tex.uploaded.as_ref();
        let mut n = 0;
        n += self.derived_tex.water.upload_diff(q, old.map(|o| &o.water_cov), &d.water_cov);
        let biome_f = ScalarField::from_vec(d.water_cov.width(), d.water_cov.height(), d.biome.iter().map(|b| *b as f32).collect());
        n += self.derived_tex.biome.upload_diff(q, old.map(|o| &o.biome), &biome_f);
        n += self.derived_tex.forest.upload_diff(q, old.map(|o| &o.forest), &d.forest);
        let mut rebind = false;
        if (self.derived_tex.temperature.width(), self.derived_tex.temperature.height()) != (d.temperature.width(), d.temperature.height()) {
            self.derived_tex.temperature = GpuField::new_labelled(&self.gpu.device, d.temperature.width(), d.temperature.height(), "temperature");
            rebind = true;
            n += self.derived_tex.temperature.upload_diff(q, None, &d.temperature);
        } else {
            n += self.derived_tex.temperature.upload_diff(q, old.map(|o| &o.temperature), &d.temperature);
        }
        let mut moisture_uploaded = old.and_then(|o| o.moisture.clone());
        if self.doc.baked.is_none() {
            if let Some(m) = &d.water.moisture {
                if (self.derived_tex.moisture.width(), self.derived_tex.moisture.height()) != (m.width(), m.height()) {
                    self.derived_tex.moisture = GpuField::new_labelled(&self.gpu.device, m.width(), m.height(), "moisture");
                    rebind = true;
                    n += self.derived_tex.moisture.upload_diff(q, None, m);
                } else {
                    n += self.derived_tex.moisture.upload_diff(q, moisture_uploaded.as_ref(), m);
                }
                moisture_uploaded = Some(m.clone());
            }
        }
        if rebind {
            self.map.bind(&self.gpu.device, &self.field, self.derived_tex.views());
        }
        self.derived_tex.uploaded = Some(UploadedDerived { water_cov: d.water_cov.clone(), biome: biome_f, forest: d.forest.clone(), moisture: moisture_uploaded, temperature: d.temperature.clone() });
        self.derived_tex.last_upload_tiles = n;
        self.cpu.sections.insert("derived upload", t.elapsed().as_secs_f32() * 1000.0);
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
                        self.library.set_project_dir(Some(path.clone()));
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

        // Derived systems.
        if let Some(job) = &self.derived_job {
            if let Some(result) = job.try_take() {
                let elapsed = job.started.elapsed();
                self.derived_job = None;
                if !result.cancelled {
                    log::info!(
                        "derived: {} rivers, {} lakes, water coverage max {:.2}, baked {}",
                        result.water.rivers.len(),
                        result.water.lakes.len(),
                        result.water_cov.min_max().1,
                        result.baked
                    );
                    self.sync_derived_textures(&result);
                    self.doc.last_derived_ms = result.timings.total_ms;
                    self.doc.derived_runs += 1;
                    let w = &result.timings.water;
                    let wp = &mut self.doc.params.water;
                    if !result.baked && w.total_ms > WATER_BUDGET_MS {
                        self.over_budget_runs += 1;
                    } else {
                        self.over_budget_runs = 0;
                    }
                    if !result.baked && wp.auto_downgrade && self.over_budget_runs >= 2 && wp.sim_resolution > 1024 {
                        wp.sim_resolution = 1024;
                        self.over_budget_runs = 0;
                        self.ui.status = format!("Water took {:.0} ms twice; simulation resolution lowered to 1024²", w.total_ms);
                        self.doc.derived_stale = true;
                    } else {
                        self.ui.status = format!(
                            "Water & biomes {:.0} ms ({} rivers, {} lakes, {} tiles uploaded){}",
                            elapsed.as_secs_f32() * 1000.0,
                            result.water.rivers.len(),
                            result.water.lakes.len(),
                            self.derived_tex.last_upload_tiles,
                            if result.baked { " · baked" } else { "" }
                        );
                    }
                    self.doc.derived = Some(result);
                }
                if self.derived_rerun {
                    self.derived_rerun = false;
                    self.doc.derived_stale = true;
                }
            } else if (self.doc.derived_stale || self.doc.derived_requested) && !self.derived_rerun {
                job.cancel();
                self.derived_rerun = true;
                self.doc.derived_stale = false;
                self.doc.derived_requested = false;
            }
        } else if self.derived_job_allowed() {
            self.spawn_derived_job();
        }

        // Symbol layers follow the derived result.
        if let Some(job) = &self.symbol_job {
            if let Some((symbols, next_id)) = job.try_take() {
                let ms = job.started.elapsed().as_secs_f32() * 1000.0;
                self.symbol_job = None;
                self.doc.auto_symbols = symbols;
                self.doc.next_placement_id = self.doc.next_placement_id.max(next_id);
                self.instances_dirty = true;
                self.cpu.sections.insert("symbols job", ms);
            }
        } else if self.doc.symbols_stale && self.derived_job.is_none() && self.gen_job.is_none() && self.load_job.is_none() {
            if let Some(d) = &self.doc.derived {
                self.doc.symbols_stale = false;
                let elev = self.doc.elevation.clone();
                let sea = self.doc.sea_level;
                let forest = d.forest.clone();
                let water = d.water_cov.clone();
                let temperature = d.temperature.clone();
                let biome = d.biome.clone();
                let mut params = self.doc.symbols.clone();
                params.forest.enabled = params.forest.enabled && self.doc.render.theme.forest == ForestStyle::Symbols;
                let sets = self.library.symbol_sets(self.doc.render.theme.style == ThemeStyle::ParchmentInk);
                let mut next_id = self.doc.next_placement_id + 1_000_000;
                self.symbol_job = Some(Job::spawn("Placing symbols", move |_, _| {
                    let t = Terrain { elevation: &elev, sea_level: sea, biome: Some(&biome), water: Some(&water) };
                    let mut out = placement::place_mountains(&t, &params.mountains, &sets, Some(&temperature), &mut next_id);
                    out.extend(placement::place_forest(&t, &forest, Some(&temperature), &params.forest, &sets, &mut next_id));
                    (out, next_id)
                }));
            }
        }

        if self.doc.modified && self.autosave_job.is_none() && self.save_job.is_none() && self.doc.last_autosave.elapsed() >= AUTOSAVE_INTERVAL && !self.input.stroke {
            self.doc.last_autosave = Instant::now();
            let view = ViewState { center: self.camera.center.to_array(), zoom: self.camera.zoom };
            let data = self.doc.to_project_data(view);
            let path = self.doc.path.clone();
            self.autosave_job = Some(Job::spawn("Autosaving", move |_, _| project::autosave(path.as_deref(), &data)));
        }
    }

    // ---- strokes ---------------------------------------------------------------

    fn gpu_field_for(&self, kind: FieldKind) -> &GpuField {
        match kind {
            FieldKind::Elevation => &self.field,
            FieldKind::Moisture => &self.derived_tex.moisture,
        }
    }

    /// Block until every mirror is current, finalize any finishing strokes.
    fn sync_mirror(&mut self) {
        for kind in [FieldKind::Elevation, FieldKind::Moisture] {
            if kind == FieldKind::Moisture && self.doc.baked.is_none() {
                continue;
            }
            let mut pending = self.doc.pending_readback_mut(kind).take();
            let landed = {
                let device = &self.gpu.device;
                let queue = &self.gpu.queue;
                let (gpu_field, mirror) = match kind {
                    FieldKind::Elevation => (&mut self.field, &mut self.doc.elevation),
                    FieldKind::Moisture => (&mut self.derived_tex.moisture, &mut self.doc.baked.as_mut().unwrap().moisture),
                };
                gpu_field.flush(device, queue, mirror, &mut pending)
            };
            if !landed.is_empty() {
                self.doc.on_tiles_landed(kind, &landed);
            }
        }
        let in_flight = self.field.has_in_flight() || self.derived_tex.moisture.has_in_flight();
        self.doc.try_finalize_strokes(in_flight);
    }

    fn stroke_kind(&self) -> FieldKind {
        if self.tools.tool == Tool::Moisture {
            FieldKind::Moisture
        } else {
            FieldKind::Elevation
        }
    }

    fn begin_stroke(&mut self, pos_screen: Vec2, pressure: f32) {
        let tool = self.tools.tool;
        if tool.needs_baked_water() && self.doc.baked.is_none() {
            self.ui.status = "Bake water first (Water panel) to paint moisture or edit rivers".into();
            return;
        }
        let fp = self.camera.screen_to_field(pos_screen, self.screen_size());
        if tool == Tool::Place {
            self.place_press(pos_screen, fp);
            return;
        }
        if tool == Tool::Scatter {
            self.scatter_before = Some(self.doc.placements.clone());
            self.scatter_hash = Some(self.build_scatter_hash());
            self.input.stroke = true;
            self.scatter_dab(fp);
            return;
        }
        if tool.is_procedural() {
            self.tools.path.clear();
            self.tools.path.push(fp.to_array());
            self.input.stroke = true;
            return;
        }
        if tool == Tool::WaterEdit {
            self.water_edit_press(pos_screen);
            return;
        }
        if !tool.is_dab_brush() {
            return;
        }
        self.finish_stroke_now();
        self.sync_mirror();
        let kind = self.stroke_kind();
        let target = match self.doc.field(kind) {
            Some(f) if fp.x >= 0.0 && fp.y >= 0.0 && fp.x < f.width() as f32 && fp.y < f.height() as f32 => f.sample(fp.x, fp.y),
            _ => 0.0,
        };
        self.tools.stroke_seed = self.tools.stroke_seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let (settings, mode) = self.tools.dab_settings();
        let mut sampler = StrokeSampler::new(settings, mode, target, self.tools.stroke_seed);
        let dabs = sampler.feed(StrokeInput { pos: fp, pressure, tilt: Vec2::ZERO, time: self.start.elapsed().as_secs_f64() });
        self.tools.queued.extend(dabs);
        self.tools.sampler = Some(sampler);
        self.tools.stroke_dabs = 0;
        self.doc.begin_stroke(tool.label(), kind);
        self.input.stroke = true;
    }

    fn continue_stroke(&mut self, pos_screen: Vec2, pressure: f32) {
        let fp = self.camera.screen_to_field(pos_screen, self.screen_size());
        if self.tools.tool.is_procedural() {
            if let Some(last) = self.tools.path.last() {
                if (Vec2::from(*last) - fp).length() >= 1.5 {
                    self.tools.path.push(fp.to_array());
                }
            }
            return;
        }
        if self.water_edit.dragging {
            self.water_edit_drag(fp);
            return;
        }
        if self.place_drag.is_some() {
            if let Some(id) = self.selected_placement {
                if let Some(p) = self.doc.placements.iter_mut().find(|p| p.id == id) {
                    p.pos = fp.to_array();
                    self.instances_dirty = true;
                }
            }
            return;
        }
        if self.tools.tool == Tool::Scatter && self.input.stroke {
            self.scatter_dab(fp);
            return;
        }
        let t = self.start.elapsed().as_secs_f64();
        if let Some(s) = self.tools.sampler.as_mut() {
            let dabs = s.feed(StrokeInput { pos: fp, pressure, tilt: Vec2::ZERO, time: t });
            self.tools.queued.extend(dabs);
        }
    }

    fn end_stroke(&mut self) {
        if self.water_edit.dragging {
            self.water_edit_release();
            return;
        }
        if let Some(before) = self.place_drag.take() {
            self.input.stroke = false;
            self.doc.commit_placements("Move symbol", before);
            return;
        }
        if let Some(before) = self.scatter_before.take() {
            self.input.stroke = false;
            self.scatter_hash = None;
            self.doc.commit_placements(if self.tools.scatter.erase { "Erase symbols" } else { "Scatter symbols" }, before);
            return;
        }
        if self.tools.tool.is_procedural() && self.input.stroke {
            self.input.stroke = false;
            let path = std::mem::take(&mut self.tools.path);
            self.apply_procedural(self.tools.tool, path);
            return;
        }
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
        let kind = self.doc.stroke_field().unwrap_or(FieldKind::Elevation);
        if kind == FieldKind::Moisture && self.doc.baked.is_none() {
            self.tools.queued.clear();
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
        let used = {
            let gpu_field = match kind {
                FieldKind::Elevation => &self.field,
                FieldKind::Moisture => &self.derived_tex.moisture,
            };
            self.brush.encode(&self.gpu.queue, encoder, kind.name(), gpu_field, &self.tools.queued[..n], &mut dirty, &mut self.profiler)
        };
        self.tools.queued.drain(..used);
        self.tools.stroke_dabs += used as u32;
        if !dirty.is_empty() {
            self.doc.pending_readback_mut(kind).union_with(&dirty);
            self.doc.modified = true;
        }
        self.close_stroke_if_drained();
    }

    // ---- procedural strokes ------------------------------------------------

    fn apply_procedural(&mut self, tool: Tool, path: Vec<[f32; 2]>) {
        if path.len() < 2 {
            return;
        }
        self.finish_stroke_now();
        let (w, h) = (self.doc.width(), self.doc.height());
        let t = Instant::now();
        let sea = self.doc.sea_level;
        type Apply = Box<dyn FnOnce(&mut ScalarField) -> PixelRect>;
        let (label, rect_reach, apply): (&str, f32, Apply) = match tool {
            Tool::Ridge => {
                let p = self.tools.ridge.clone();
                let path2 = path.clone();
                ("Ridge", procedural::ridge_reach(&p), Box::new(move |f: &mut ScalarField| procedural::apply_ridge(f, &path2, &p)))
            }
            Tool::Coast => {
                let p = self.tools.coast.clone();
                let path2 = path.clone();
                ("Coastline", procedural::coast_reach(&p), Box::new(move |f: &mut ScalarField| procedural::apply_coast(f, &path2, sea, &p)))
            }
            _ => return,
        };
        let mut lo = [f32::INFINITY; 2];
        let mut hi = [f32::NEG_INFINITY; 2];
        for p in &path {
            lo[0] = lo[0].min(p[0]);
            lo[1] = lo[1].min(p[1]);
            hi[0] = hi[0].max(p[0]);
            hi[1] = hi[1].max(p[1]);
        }
        let rect = PixelRect::new(
            (lo[0] - rect_reach).floor().max(0.0) as u32,
            (lo[1] - rect_reach).floor().max(0.0) as u32,
            ((hi[0] + rect_reach).ceil().max(0.0) as u32).min(w),
            ((hi[1] + rect_reach).ceil().max(0.0) as u32).min(h),
        );
        let tiles = self.doc.apply_cpu_edit(label, FieldKind::Elevation, &rect, |f| {
            apply(f);
        });
        self.field.upload_tiles(&self.gpu.queue, &self.doc.elevation, tiles.iter().copied());
        self.cpu.sections.insert("procedural brush", t.elapsed().as_secs_f32() * 1000.0);
        self.ui.status = format!("{label}: {} tiles in {:.0} ms · adjust parameters to re-apply", tiles.len(), t.elapsed().as_secs_f32() * 1000.0);
        self.last_proc = Some(LastProcedural { tool, path, undo_len_after: self.doc.undo.len() });
    }

    /// Parameters changed after a procedural stroke: undo it and re-apply.
    fn reapply_last_procedural(&mut self) {
        let Some(last) = self.last_proc.take() else { return };
        if self.doc.undo.len() != last.undo_len_after || !self.doc.undo.can_undo() || last.tool != self.tools.tool {
            return;
        }
        self.finish_stroke_now();
        if let Some(Some((kind, tiles))) = self.doc.undo() {
            let f = self.doc.field(kind).unwrap().clone();
            self.gpu_field_for(kind).upload_tiles(&self.gpu.queue, &f, tiles.into_iter());
        }
        self.apply_procedural(last.tool, last.path);
    }

    // ---- symbols ---------------------------------------------------------------

    fn placement_under(&self, screen: Vec2) -> Option<u64> {
        let ss = self.screen_size();
        let mut best = None;
        let mut best_d = f32::INFINITY;
        for p in &self.doc.placements {
            let Some(a) = self.library.get(&p.asset) else { continue };
            let h = p.size / a.aspect.max(0.1);
            let anchor = self.camera.field_to_screen(Vec2::from(p.pos), ss);
            let top_left = anchor - Vec2::new(a.def.pivot[0] * p.size, a.def.pivot[1] * h) * self.camera.zoom;
            let rect = egui::Rect::from_min_size(egui::pos2(top_left.x, top_left.y), egui::vec2(p.size * self.camera.zoom, h * self.camera.zoom)).expand(4.0);
            if rect.contains(egui::pos2(screen.x, screen.y)) {
                let d = (anchor - screen).length();
                if d < best_d {
                    best_d = d;
                    best = Some(p.id);
                }
            }
        }
        best
    }

    fn make_placement(&mut self, qid: &str, pos: [f32; 2], size_override: f32, layer: PlacementLayer) -> Option<Placement> {
        let a = self.library.get(qid)?;
        let b = &a.def.behavior;
        let rng = &mut self.scatter_rng;
        let scale = rng.range(b.scale_range[0], b.scale_range[1]);
        let size = if size_override > 0.0 { size_override } else { a.def.world_size } * scale;
        let rotation = if b.rotation_range > 0.0 { rng.range(-b.rotation_range, b.rotation_range).to_radians() } else { 0.0 };
        let flip = b.flip && rng.f32() < 0.5;
        let id = self.doc.new_placement_id();
        Some(Placement { id, asset: qid.to_string(), pos, size, rotation, flip, tint: b.tint, layer })
    }

    fn place_press(&mut self, screen: Vec2, fp: Vec2) {
        if let Some(id) = self.placement_under(screen) {
            self.selected_placement = Some(id);
            self.place_drag = Some(self.doc.placements.clone());
            self.input.stroke = true;
            return;
        }
        let Some(qid) = self.tools.selected_assets.first().cloned() else {
            self.ui.status = "Pick a symbol in the browser below".into();
            return;
        };
        let size = self.tools.place_size;
        if let Some(p) = self.make_placement(&qid, fp.to_array(), size, PlacementLayer::Manual) {
            let before = self.doc.placements.clone();
            self.selected_placement = Some(p.id);
            self.doc.placements.push(p);
            self.doc.commit_placements("Place symbol", before);
            self.library.touch_recent(&qid);
            self.instances_dirty = true;
        }
    }

    fn build_scatter_hash(&self) -> SpatialHash {
        let mut h = SpatialHash::new(self.tools.scatter.spacing.max(4.0) * 2.0);
        for p in &self.doc.placements {
            h.insert(p.pos, p.size * 0.3);
        }
        h
    }

    fn scatter_dab(&mut self, fp: Vec2) {
        let s = self.tools.scatter.clone();
        if s.erase {
            let r2 = s.radius * s.radius;
            let n = self.doc.placements.len();
            self.doc.placements.retain(|p| (p.pos[0] - fp.x).powi(2) + (p.pos[1] - fp.y).powi(2) > r2);
            if self.doc.placements.len() != n {
                self.instances_dirty = true;
            }
            return;
        }
        if self.tools.selected_assets.is_empty() {
            self.ui.status = "Pick one or more symbols in the browser below".into();
            return;
        }
        let Some(mut hash) = self.scatter_hash.take() else { return };
        let water = self.doc.derived.as_ref().map(|d| d.water_cov.clone());
        let biome = self.doc.derived.as_ref().map(|d| d.biome.clone());
        let filter = TerrainFilter { on_land: if s.avoid_water { Some(true) } else { None }, max_slope: Some(s.max_slope), ..Default::default() };
        let assets = self.tools.selected_assets.clone();
        let mut rng = Rng::new(self.scatter_rng.next_u64());
        let spacing = s.spacing.max(2.0);
        let pts = {
            let t = Terrain { elevation: &self.doc.elevation, sea_level: self.doc.sea_level, biome: biome.as_deref(), water: water.as_ref() };
            placement::scatter_disc(fp.to_array(), s.radius, spacing, &mut hash, &mut rng, |p, _| if t.passes(p, &filter) { Some(spacing * 0.45) } else { None })
        };
        for (p, _) in pts {
            let qid = rng.pick(&assets).clone();
            let base = self.library.get(&qid).map(|a| a.def.world_size).unwrap_or(32.0);
            let size = base * rng.range(1.0 - s.size_jitter, 1.0 + s.size_jitter);
            let mut pl = match self.make_placement(&qid, p, size, PlacementLayer::Manual) {
                Some(pl) => pl,
                None => continue,
            };
            if s.rotation_jitter_deg > 0.0 {
                pl.rotation = rng.range(-s.rotation_jitter_deg, s.rotation_jitter_deg).to_radians();
            }
            pl.flip = s.flip && rng.f32() < 0.5;
            self.doc.placements.push(pl);
        }
        self.scatter_hash = Some(hash);
        self.instances_dirty = true;
    }

    fn delete_selected_placement(&mut self) {
        let Some(id) = self.selected_placement.take() else { return };
        let before = self.doc.placements.clone();
        self.doc.placements.retain(|p| p.id != id);
        self.doc.commit_placements("Delete symbol", before);
        self.instances_dirty = true;
    }

    fn rebuild_instances(&mut self) {
        let mut inst: Vec<SpriteInstance> = Vec::new();
        for p in self.doc.all_symbols() {
            let Some(a) = self.library.get(&p.asset) else { continue };
            let Some(rect) = a.rect else { continue };
            let (uv0, uv1) = rect.uv();
            let h = p.size / rect.aspect().max(0.05);
            let sel = self.selected_placement == Some(p.id);
            inst.push(SpriteInstance {
                pos: p.pos,
                size: [p.size, h],
                pivot: a.def.pivot,
                uv0,
                uv1,
                rot_flip: [p.rotation, if p.flip { 1.0 } else { 0.0 }],
                tint: [p.tint[0], p.tint[1], p.tint[2] * if sel { 0.6 } else { 1.0 }, 1.0],
            });
        }
        self.sprites.set_instances(&self.gpu.device, &self.gpu.queue, &inst);
        self.instances_dirty = false;
        self.instance_key = (self.doc.placements.len(), self.doc.auto_symbols.len());
    }

    fn reload_library(&mut self) {
        self.library.reload(&mut self.atlas, &self.gpu.queue);
        self.sprites.bind(&self.gpu.device, &self.atlas);
        if let Some(old) = self.atlas_egui.take() {
            self.egui_renderer.free_texture(&old);
        }
        self.atlas_egui = Some(self.egui_renderer.register_native_texture(&self.gpu.device, &self.atlas.view, wgpu::FilterMode::Linear));
        self.doc.symbols_stale = true;
        self.instances_dirty = true;
        self.ui.status = format!("Library: {} symbols in {} packs", self.library.assets.len(), self.library.packs.len());
    }

    fn import_files(&mut self, files: Vec<PathBuf>) {
        let mut n = 0;
        for f in files {
            let ext = f.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
            if !isoline_core::assets::IMAGE_EXTENSIONS.contains(&ext.as_str()) {
                continue;
            }
            match self.library.import_image(&f, true, ext == "jpg" || ext == "jpeg", 0.12) {
                Ok(_) => n += 1,
                Err(e) => self.ui.error = Some(format!("Import failed: {e:#}")),
            }
        }
        if n > 0 {
            self.ui.status = format!("Imported {n} image(s) into the project's assets folder");
            self.tools.tool = Tool::Place;
        }
    }

    // ---- water editing -------------------------------------------------------

    fn water_edit_press(&mut self, pos_screen: Vec2) {
        let Some(b) = self.doc.baked.as_ref() else { return };
        let ss = self.screen_size();
        let mut best = 12.0f32 * 12.0;
        let mut sel = None;
        for (ri, r) in b.rivers.iter().enumerate() {
            for (vi, p) in r.points.iter().enumerate() {
                let sp = self.camera.field_to_screen(Vec2::from(*p), ss);
                let d2 = (sp - pos_screen).length_squared();
                if d2 < best {
                    best = d2;
                    sel = Some(WaterSel::River { river: ri, vertex: vi });
                }
            }
        }
        for (li, l) in b.lakes.iter().enumerate() {
            for (vi, p) in l.polygon.points.iter().enumerate() {
                let sp = self.camera.field_to_screen(Vec2::from(*p), ss);
                let d2 = (sp - pos_screen).length_squared();
                if d2 < best {
                    best = d2;
                    sel = Some(WaterSel::Lake { lake: li, vertex: vi });
                }
            }
        }
        self.water_edit.selected = sel;
        if sel.is_some() {
            self.water_edit.before = self.doc.geometry_snapshot();
            self.water_edit.dragging = true;
            self.input.stroke = true;
        }
    }

    fn water_edit_drag(&mut self, fp: Vec2) {
        let Some(sel) = self.water_edit.selected else { return };
        let Some(b) = self.doc.baked.as_mut() else { return };
        match sel {
            WaterSel::River { river, vertex } => {
                if let Some(p) = b.rivers.get_mut(river).and_then(|r| r.points.get_mut(vertex)) {
                    *p = fp.to_array();
                }
            }
            WaterSel::Lake { lake, vertex } => {
                if let Some(p) = b.lakes.get_mut(lake).and_then(|l| l.polygon.points.get_mut(vertex)) {
                    *p = fp.to_array();
                }
            }
        }
    }

    fn water_edit_release(&mut self) {
        self.water_edit.dragging = false;
        self.input.stroke = false;
        if let Some(before) = self.water_edit.before.take() {
            self.doc.commit_geometry_edit("Move water vertex", before);
        }
    }

    fn delete_selected_water(&mut self) {
        let Some(sel) = self.water_edit.selected.take() else { return };
        let Some(before) = self.doc.geometry_snapshot() else { return };
        if let Some(b) = self.doc.baked.as_mut() {
            match sel {
                WaterSel::River { river, .. } => {
                    if river < b.rivers.len() {
                        b.rivers.remove(river);
                    }
                }
                WaterSel::Lake { lake, .. } => {
                    if lake < b.lakes.len() {
                        b.lakes.remove(lake);
                    }
                }
            }
        }
        self.doc.commit_geometry_edit("Delete water feature", before);
    }

    // ---- actions ---------------------------------------------------------------

    fn undo(&mut self) {
        self.finish_stroke_now();
        let had_baked = self.doc.baked.is_some();
        if let Some(step) = self.doc.undo() {
            self.after_history_step(step, had_baked);
            self.ui.status = "Undo".into();
        }
        self.last_proc = None;
    }

    fn redo(&mut self) {
        self.finish_stroke_now();
        let had_baked = self.doc.baked.is_some();
        if let Some(step) = self.doc.redo() {
            self.after_history_step(step, had_baked);
            self.ui.status = "Redo".into();
        }
        self.last_proc = None;
    }

    fn after_history_step(&mut self, step: Option<(FieldKind, Vec<u32>)>, had_baked: bool) {
        self.instances_dirty = true;
        if let Some((kind, tiles)) = step {
            let f = self.doc.field(kind).unwrap().clone();
            self.gpu_field_for(kind).upload_tiles(&self.gpu.queue, &f, tiles.into_iter());
        }
        if had_baked != self.doc.baked.is_some() {
            self.on_baked_changed();
        } else if self.doc.baked.is_some() {
            // A bake/unbake round trip may have replaced the moisture field wholesale.
            if let Some(b) = self.doc.baked.as_ref() {
                self.derived_tex.moisture.upload_diff(&self.gpu.queue, self.derived_tex.uploaded.as_ref().and_then(|u| u.moisture.as_ref()), &b.moisture);
                if let Some(u) = self.derived_tex.uploaded.as_mut() {
                    u.moisture = Some(b.moisture.clone());
                }
            }
        }
    }

    fn on_baked_changed(&mut self) {
        self.water_edit = WaterEdit::default();
        if self.doc.baked.is_some() {
            self.install_baked_moisture();
        } else {
            self.brush.unbind("moisture");
            if self.tools.tool.needs_baked_water() {
                self.tools.tool = Tool::Raise;
            }
            // Moisture texture will be replaced by the next derived result.
            if let Some(u) = self.derived_tex.uploaded.as_mut() {
                u.moisture = None;
            }
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
                UiAction::RecomputeWater => self.doc.derived_requested = true,
                UiAction::BakeWater => {
                    self.finish_stroke_now();
                    if self.doc.bake_water() {
                        self.on_baked_changed();
                        self.ui.status = "Water baked: rivers and lakes are now editable geometry, moisture is paintable".into();
                    }
                }
                UiAction::UnbakeWater => {
                    self.finish_stroke_now();
                    if self.doc.unbake_water() {
                        self.on_baked_changed();
                        self.ui.status = "Water unbaked: rivers, lakes and moisture are derived again".into();
                    }
                }
                UiAction::ReapplyLastStroke => self.reapply_last_procedural(),
                UiAction::DeleteSelectedWater => self.delete_selected_water(),
                UiAction::SelectTool(t) => self.tools.tool = t,
                UiAction::SelectAsset { qid, additive } => {
                    if additive && self.tools.tool == Tool::Scatter {
                        if let Some(i) = self.tools.selected_assets.iter().position(|a| a == &qid) {
                            self.tools.selected_assets.remove(i);
                        } else {
                            self.tools.selected_assets.push(qid);
                        }
                    } else {
                        self.tools.selected_assets = vec![qid];
                    }
                    if !self.tools.tool.uses_assets() {
                        self.tools.tool = Tool::Place;
                    }
                }
                UiAction::ToggleFavorite(qid) => self.library.toggle_favorite(&qid),
                UiAction::ImportImages => {
                    if self.doc.path.is_none() {
                        self.ui.error = Some("Save the project first: imported images are copied into its assets folder.".into());
                    } else if let Some(files) = rfd::FileDialog::new().set_title("Import images").add_filter("Images", &["png", "jpg", "jpeg", "webp", "svg"]).pick_files() {
                        self.import_files(files);
                    }
                }
                UiAction::AddPackDir => {
                    if let Some(dir) = rfd::FileDialog::new().set_title("Add an asset pack folder").pick_folder() {
                        self.library.register_pack_dir(dir);
                    }
                }
                UiAction::RemovePackDir(dir) => self.library.unregister_pack_dir(&dir),
                UiAction::SymbolsChanged => self.doc.symbols_changed(),
                UiAction::DeleteSelectedPlacement => self.delete_selected_placement(),
            }
        }
    }

    // ---- events ----------------------------------------------------------------

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
            WindowEvent::RedrawRequested => self.frame(event_loop),
            WindowEvent::DroppedFile(path) => {
                if path.join("manifest.json").exists() {
                    self.open_path(path);
                } else if path.file_name().map(|n| n == "manifest.json").unwrap_or(false) {
                    if let Some(p) = path.parent() {
                        self.open_path(p.to_path_buf());
                    }
                } else if path.join("pack.json").exists() {
                    self.library.register_pack_dir(path);
                } else if self.doc.path.is_none() {
                    self.ui.error = Some("Save the project first: dropped images are copied into its assets folder.".into());
                } else {
                    self.import_files(vec![path]);
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
            WindowEvent::CursorLeft { .. } => self.input.cursor = None,
            WindowEvent::MouseInput { state, button, .. } => {
                let Some(p) = self.input.cursor else { return false };
                match (button, state) {
                    (MouseButton::Left, ElementState::Pressed) => {
                        if egui_wants_pointer {
                            return false;
                        }
                        if self.input.space || self.tools.tool == Tool::Pan {
                            self.input.panning = true;
                        } else {
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
                    let ss = self.screen_size();
                    self.camera.zoom_about(p, ss, 1.15f32.powf(steps));
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
                        if self.input.touch_id.is_none() {
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
            KeyCode::Space => self.input.space = true,
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
            KeyCode::KeyR if ctrl && !repeat => self.doc.derived_requested = true,
            KeyCode::F3 if !repeat => self.ui.show_profiler = !self.ui.show_profiler,
            KeyCode::Home => self.fit_view(),
            KeyCode::Digit1 => self.tools.tool = Tool::Raise,
            KeyCode::Digit2 => self.tools.tool = Tool::Lower,
            KeyCode::Digit3 => self.tools.tool = Tool::Smooth,
            KeyCode::Digit4 => self.tools.tool = Tool::Flatten,
            KeyCode::Digit5 => self.tools.tool = Tool::Ridge,
            KeyCode::Digit6 => self.tools.tool = Tool::Coast,
            KeyCode::Digit7 => self.tools.tool = Tool::Place,
            KeyCode::Digit8 => self.tools.tool = Tool::Scatter,
            KeyCode::Digit9 => self.tools.tool = Tool::Moisture,
            KeyCode::Digit0 => self.tools.tool = Tool::WaterEdit,
            KeyCode::BracketLeft => self.scale_radius(1.0 / 1.2),
            KeyCode::BracketRight => self.scale_radius(1.2),
            KeyCode::Delete | KeyCode::Backspace => {
                if self.tools.tool == Tool::WaterEdit {
                    self.delete_selected_water();
                } else if self.tools.tool == Tool::Place {
                    self.delete_selected_placement();
                }
            }
            KeyCode::Escape => {
                if self.input.stroke {
                    if self.tools.tool.is_procedural() {
                        self.tools.path.clear();
                        self.input.stroke = false;
                    } else {
                        self.end_stroke();
                    }
                }
            }
            _ => {}
        }
    }

    fn scale_radius(&mut self, k: f32) {
        match self.tools.tool {
            Tool::Moisture => self.tools.moisture_brush.radius = (self.tools.moisture_brush.radius * k).clamp(1.0, 1024.0),
            Tool::Ridge => self.tools.ridge.width = (self.tools.ridge.width * k).clamp(2.0, 1024.0),
            Tool::Coast => self.tools.coast.band = (self.tools.coast.band * k).clamp(4.0, 1024.0),
            Tool::Scatter => self.tools.scatter.radius = (self.tools.scatter.radius * k).clamp(4.0, 1024.0),
            Tool::Place => {
                if let Some(id) = self.selected_placement {
                    let before = self.doc.placements.clone();
                    if let Some(p) = self.doc.placements.iter_mut().find(|p| p.id == id) {
                        p.size = (p.size * k).clamp(2.0, 2048.0);
                    }
                    self.doc.commit_placements("Resize symbol", before);
                    self.instances_dirty = true;
                }
            }
            _ => self.tools.brush.radius = (self.tools.brush.radius * k).clamp(1.0, 1024.0),
        }
    }

    // ---- demo / screenshot -------------------------------------------------

    fn run_demo(&mut self) {
        let ss = self.screen_size();
        let w = self.doc.width() as f32;
        let h = self.doc.height() as f32;
        let to_screen = |c: &Camera, f: Vec2| c.field_to_screen(f, ss);
        let strokes: [(Tool, f32, Vec<Vec2>); 2] = [
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
                    self.continue_stroke(to_screen(&self.camera, seg[0].lerp(seg[1], i as f32 / 24.0)), 1.0);
                }
            }
            self.end_stroke();
            self.finish_stroke_now();
        }
        // A ridge across the north and a fjord coast on the south-west.
        self.tools.ridge.width = w / 48.0;
        self.tools.ridge.height = 2200.0;
        self.tools.ridge.spur_frequency = 0.6;
        let ridge: Vec<[f32; 2]> = (0..40)
            .map(|i| {
                let k = i as f32 / 39.0;
                [w * (0.28 + 0.45 * k), h * (0.34 - 0.05 * (k * 3.0).sin())]
            })
            .collect();
        self.apply_procedural(Tool::Ridge, ridge);
        self.tools.coast = self.tools.coast.with_preset(CoastPreset::Fjord);
        self.tools.coast.band = w / 22.0;
        let coast: Vec<[f32; 2]> = (0..40)
            .map(|i| {
                let k = i as f32 / 39.0;
                [w * (0.18 + 0.02 * (k * 5.0).sin()), h * (0.80 - 0.45 * k)]
            })
            .collect();
        self.apply_procedural(Tool::Coast, coast);
        let from = self.doc.sea_level;
        self.doc.set_sea_level_live(from + 40.0);
        self.doc.commit_sea_level(from, from + 40.0);
        self.undo();
        self.redo();
        self.tools.tool = Tool::Coast;
        self.ui.status = format!("demo: {} undo entries", self.doc.undo.len());
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
        let bgra = matches!(self.config.format, wgpu::TextureFormat::Bgra8Unorm | wgpu::TextureFormat::Bgra8UnormSrgb);
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        {
            let data = buf.slice(..).get_mapped_range();
            for y in 0..h as usize {
                let row = &data[y * bpr as usize..y * bpr as usize + (w * 4) as usize];
                let dst = &mut rgba[y * (w * 4) as usize..(y + 1) * (w * 4) as usize];
                dst.copy_from_slice(row);
                for px in dst.chunks_exact_mut(4) {
                    if bgra {
                        px.swap(0, 2);
                    }
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

    // ---- frame -----------------------------------------------------------------

    fn build_overlay(&self, ppp: f32) -> Overlay {
        let ss = self.screen_size();
        let to = |p: [f32; 2]| {
            let s = self.camera.field_to_screen(Vec2::from(p), ss) / ppp;
            egui::pos2(s.x, s.y)
        };
        let mut ov = Overlay::default();
        let a = to([0.0, 0.0]);
        let b = to([self.doc.width() as f32, self.doc.height() as f32]);
        ov.map_rect = egui::Rect::from_two_pos(a, b);
        ov.title = self.doc.name.clone();
        ov.show_ornaments = self.doc.render.theme.show_ornaments && self.doc.render.theme.style != ThemeStyle::Modern && self.view_mode == ViewMode::Map;
        ov.sun_azimuth_deg = self.doc.render.sun_azimuth_deg;
        let ink = self.doc.render.theme.ink;
        let paper = self.doc.render.theme.paper;
        ov.ink = egui::Color32::from_rgb((ink[0] * 255.0) as u8, (ink[1] * 255.0) as u8, (ink[2] * 255.0) as u8);
        ov.paper = egui::Color32::from_rgb((paper[0] * 255.0) as u8, (paper[1] * 255.0) as u8, (paper[2] * 255.0) as u8);
        if self.tools.tool.is_procedural() && !self.tools.path.is_empty() {
            ov.path = self.tools.path.iter().map(|p| to(*p)).collect();
            ov.path_is_coast = self.tools.tool == Tool::Coast;
        }
        if self.tools.tool == Tool::Place {
            if let Some(id) = self.selected_placement {
                if let Some(p) = self.doc.placements.iter().find(|p| p.id == id) {
                    ov.selected = Some(to(p.pos));
                }
            }
        }
        if self.tools.tool == Tool::WaterEdit {
            if let Some(b) = &self.doc.baked {
                ov.rivers = b.rivers.iter().map(|r| r.points.iter().map(|p| to(*p)).collect()).collect();
                ov.lakes = b.lakes.iter().map(|l| l.polygon.points.iter().map(|p| to(*p)).collect()).collect();
                ov.selected = self.water_edit.selected.and_then(|s| match s {
                    WaterSel::River { river, vertex } => b.rivers.get(river).and_then(|r| r.points.get(vertex)).map(|p| to(*p)),
                    WaterSel::Lake { lake, vertex } => b.lakes.get(lake).and_then(|l| l.polygon.points.get(vertex)).map(|p| to(*p)),
                });
            }
        }
        ov
    }

    fn frame(&mut self, event_loop: &ActiveEventLoop) {
        self.cpu.tick();
        self.profiler.poll();
        self.profiler.begin_frame();
        self.poll_jobs();
        if self.library.poll() {
            self.reload_library();
        }
        if self.instances_dirty || self.instance_key != (self.doc.placements.len(), self.doc.auto_symbols.len()) {
            let t = Instant::now();
            self.rebuild_instances();
            self.cpu.sections.insert("symbol instances", t.elapsed().as_secs_f32() * 1000.0);
        }
        if self.needs_fit {
            self.fit_view();
        }
        if self.frames_since_install != u32::MAX {
            self.frames_since_install += 1;
            if self.demo && self.gen_job.is_none() && self.load_job.is_none() {
                if self.frames_since_install == 3 && self.demo_stage == 0 {
                    self.demo_stage = 1;
                    self.run_demo();
                } else if self.demo_stage == 1 && self.doc.derived.is_some() && self.derived_job.is_none() && !self.doc.derived_stale {
                    self.demo_stage = 2;
                    let w = self.doc.width() as f32;
                    let h = self.doc.height() as f32;
                    let before = self.doc.placements.clone();
                    for (qid, x, y, size) in [("default/city", 0.62, 0.55, 150.0), ("default/castle", 0.45, 0.48, 110.0), ("default/village", 0.70, 0.40, 80.0), ("default/ship", 0.15, 0.30, 90.0), ("default/sea_serpent", 0.82, 0.78, 120.0), ("default/ruins", 0.36, 0.72, 80.0)] {
                        if let Some(p) = self.make_placement(qid, [w * x, h * y], size, PlacementLayer::Manual) {
                            self.doc.placements.push(p);
                        }
                    }
                    self.doc.commit_placements("Demo symbols", before);
                    self.instances_dirty = true;
                    self.tools.tool = Tool::Place;
                } else if self.demo_stage == 2 && self.save_job.is_none() && self.doc.path.is_some() {
                    self.demo_stage = 3;
                    // Import a PNG with a white background to exercise trim, chroma key and hot reload.
                    let png_path = std::env::temp_dir().join("isoline-demo-import.png");
                    let mut bm = isoline_core::assets::Bitmap::new(96, 96);
                    for y in 0..96u32 {
                        for x in 0..96u32 {
                            let dx = x as f32 - 48.0;
                            let dy = y as f32 - 48.0;
                            let inside = dx * dx + dy * dy < 30.0 * 30.0 && (dx.abs() > 8.0 || dy > 0.0);
                            bm.set(x, y, if inside { [140, 40, 40, 255] } else { [255, 255, 255, 255] });
                        }
                    }
                    let f = std::fs::File::create(&png_path).unwrap();
                    let mut enc = png::Encoder::new(std::io::BufWriter::new(f), 96, 96);
                    enc.set_color(png::ColorType::Rgba);
                    enc.set_depth(png::BitDepth::Eight);
                    enc.write_header().unwrap().write_image_data(&bm.rgba).unwrap();
                    self.import_files(vec![png_path]);
                } else if self.demo_stage == 3 && (self.library.get("project/isoline_demo_import").is_some() || self.frames_since_install > 400) {
                    self.demo_stage = 4;
                    let w = self.doc.width() as f32;
                    let h = self.doc.height() as f32;
                    let before = self.doc.placements.clone();
                    if let Some(p) = self.make_placement("project/isoline_demo_import", [w * 0.55, h * 0.30], 70.0, PlacementLayer::Manual) {
                        self.doc.placements.push(p);
                    }
                    self.doc.commit_placements("Imported symbol", before);
                    self.instances_dirty = true;
                }
            }
        }

        // UI.
        let raw = self.egui_state.take_egui_input(&self.window);
        let ppp = self.egui_ctx.pixels_per_point();
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
        let overlay = self.build_overlay(ppp);
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
                has_last_procedural: self.last_proc.as_ref().map(|l| l.tool),
                water_selected: self.water_edit.selected,
                overlay,
                library: &self.library,
                atlas_tex: self.atlas_egui,
                symbols_running: self.symbol_job.is_some(),
                selected_placement: self.selected_placement,
                sprite_count: self.sprites.last_instances,
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
        {
            let mut pending = self.doc.pending_readback_mut(FieldKind::Elevation).take();
            self.field.encode_readback(&self.gpu.device, &mut encoder, &mut pending);
            self.doc.pending_readback_mut(FieldKind::Elevation).union_with(&pending);
            if self.doc.baked.is_some() {
                let mut pending = self.doc.pending_readback_mut(FieldKind::Moisture).take();
                self.derived_tex.moisture.encode_readback(&self.gpu.device, &mut encoder, &mut pending);
                self.doc.pending_readback_mut(FieldKind::Moisture).union_with(&pending);
            }
        }
        self.cpu.sections.insert("readback encode", t.elapsed().as_secs_f32() * 1000.0);

        let frame = match self.surface.get_current_texture() {
            wgpu::CurrentSurfaceTexture::Success(t) | wgpu::CurrentSurfaceTexture::Suboptimal(t) => t,
            wgpu::CurrentSurfaceTexture::Timeout | wgpu::CurrentSurfaceTexture::Occluded => {
                self.gpu.queue.submit([encoder.finish()]);
                self.field.after_submit();
                self.derived_tex.moisture.after_submit();
                return;
            }
            _ => {
                self.surface.configure(&self.gpu.device, &self.config);
                self.gpu.queue.submit([encoder.finish()]);
                self.field.after_submit();
                self.derived_tex.moisture.after_submit();
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
        let egui_over = self.egui_ctx.is_pointer_over_egui();
        let show_cursor = (self.tools.tool.is_dab_brush() || self.tools.tool.is_procedural()) && self.input.cursor.is_some() && !egui_over && !self.input.panning;
        if show_cursor {
            flags |= FLAG_CURSOR;
        }
        let (temp_min, temp_max) = match &self.doc.derived {
            Some(d) => {
                let (tlo, thi) = d.temperature.min_max();
                (tlo, thi.max(tlo + 1.0))
            }
            None => (-20.0, 30.0),
        };
        let mut palette = [[0f32; 4]; 16];
        for (i, b) in Biome::ALL.iter().enumerate() {
            let c = b.color();
            palette[i] = [c[0], c[1], c[2], 1.0];
        }
        let fw = self.doc.width() as f32;
        let fh = self.doc.height() as f32;
        let th: &Theme = &self.doc.render.theme;
        let view = ViewUniform {
            screen_size: ss.to_array(),
            field_size: [fw, fh],
            origin: origin.to_array(),
            scale: self.camera.zoom,
            sea_level: self.doc.sea_level,
            sun_dir: [az.sin() * alt.cos(), -az.cos() * alt.cos(), alt.sin()],
            exaggeration: self.doc.render.vertical_exaggeration,
            shade_strength: if th.style == ThemeStyle::Modern { self.doc.render.hillshade_strength } else { th.hillshade_strength },
            contour_interval: self.doc.render.contour_interval,
            coast_width: if self.doc.render.theme.style == ThemeStyle::Modern { self.doc.render.coast_line_width } else { self.doc.render.theme.coast_line_width },
            flags,
            cursor: cursor_field.unwrap_or(Vec2::ZERO).to_array(),
            cursor_radius: self.tools.radius(),
            meters_per_texel: self.doc.meters_per_texel,
            elev_min: self.doc.stats.min,
            elev_max: self.doc.stats.max,
            time: self.start.elapsed().as_secs_f32(),
            view_mode: self.view_mode as u32,
            temp_min,
            temp_max,
            _pad_a: [0.0; 2],
            moist_scale: [self.derived_tex.moisture.width() as f32 / fw, self.derived_tex.moisture.height() as f32 / fh],
            temp_scale: [self.derived_tex.temperature.width() as f32 / fw, self.derived_tex.temperature.height() as f32 / fh],
            paper: th.paper,
            theme_style: th.style as u32,
            paper_dark: th.paper_dark,
            relief_style: th.relief as u32,
            ink: th.ink,
            forest_style: th.forest as u32,
            sea_fill: th.sea_fill,
            coast_rings: th.coast_rings,
            sea_ink: th.sea_ink,
            land_tint: th.land_tint,
            river_ink: th.river_ink,
            paper_grain: th.paper_grain,
            forest_fill: th.forest_fill,
            vignette: th.vignette,
            ring_spacing: th.ring_spacing,
            hatch_strength: th.hatch_strength,
            hatch_spacing: th.hatch_spacing,
            forest_scale: th.forest_scale,
            forest_threshold: th.forest_threshold,
            _pad_b: [0.0; 7],
            palette,
        };
        let _ = (ReliefStyle::Shaded, ForestStyle::None);
        self.map.render(&self.gpu.queue, &mut encoder, &target, &view, &mut self.profiler);
        if self.view_mode == ViewMode::Map {
            let t = Instant::now();
            self.sprites.render(&self.gpu.queue, &mut encoder, &target, ss.to_array(), origin.to_array(), self.camera.zoom, self.doc.symbols.shadow);
            self.cpu.sections.insert("sprites encode", t.elapsed().as_secs_f32() * 1000.0);
        }

        // egui on top.
        let t = Instant::now();
        let paint_jobs = self.egui_ctx.tessellate(full.shapes, full.pixels_per_point);
        let screen = egui_wgpu::ScreenDescriptor { size_in_pixels: [self.config.width, self.config.height], pixels_per_point: full.pixels_per_point };
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
        self.derived_tex.moisture.after_submit();
        self.profiler.after_submit();
        self.window.pre_present_notify();
        let take_shot = self.screenshot.is_some()
            && self.frames_since_install >= 20
            && self.gen_job.is_none()
            && self.load_job.is_none()
            && self.derived_job.is_none()
            && self.symbol_job.is_none()
            && !self.doc.symbols_stale
            && !self.doc.derived_stale
            && self.doc.derived.is_some()
            && (!self.demo || self.demo_stage >= 4)
            && self.save_job.is_none();
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

        // Sync mirrors.
        let t = Instant::now();
        let _ = self.gpu.device.poll(wgpu::PollType::Poll);
        let landed = self.field.collect(&mut self.doc.elevation);
        if !landed.is_empty() {
            self.doc.on_tiles_landed(FieldKind::Elevation, &landed);
        }
        if let Some(b) = self.doc.baked.as_mut() {
            let landed = self.derived_tex.moisture.collect(&mut b.moisture);
            if !landed.is_empty() {
                self.doc.on_tiles_landed(FieldKind::Moisture, &landed);
            }
        }
        let in_flight = self.field.has_in_flight() || self.derived_tex.moisture.has_in_flight();
        let n = self.doc.try_finalize_strokes(in_flight);
        if n > 0 {
            self.ui.status = format!("{} · {} dabs", self.doc.undo.undo_label().unwrap_or(""), self.tools.stroke_dabs);
        }
        self.cpu.sections.insert("mirror sync", t.elapsed().as_secs_f32() * 1000.0);

        if self.wants_redraw() {
            self.window.request_redraw();
        }
    }
}
