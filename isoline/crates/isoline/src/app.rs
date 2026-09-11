//! Window, input, and the per-frame pipeline.

use crate::camera::Camera;
use crate::document::{Document, FieldKind};
use crate::gpu::brush::{BrushPass, MAX_DABS_PER_FRAME};
use crate::gpu::field::GpuField;
use crate::export::{ExportJob, ExportSettings, Reference};
use crate::svg::{SvgGlyph, SvgInput, SvgLabel, SvgSymbol};
use crate::themes::ThemeLibrary;
use crate::gpu::map_render::{DerivedViews, MapRenderer, ViewMode, ViewUniform, FLAG_CONTOURS, FLAG_CURSOR, FLAG_HAS_DERIVED, FLAG_HYPSO, FLAG_TRANSPARENT, FLAG_WATER};
use crate::gpu::profiler::{CpuStats, GpuProfiler};
use crate::gpu::sprites::{Atlas, SpriteInstance, SpritePass};
use crate::library::Library;
use crate::labels::LabelEngine;
use crate::autoname::{self, AutoNameInput, AutoNameParams};
use isoline_core::entity::{Entity, EntityKind, EntityRef};
use isoline_core::names::{self, Culture, NameRng};
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
use isoline_core::borders::{self, Border, BorderKind, CostField, CostParams, Seed, REGION_PALETTE};
use isoline_core::settlement::{self, District, Settlement, SettlementKind, Site, VertexRef};
use isoline_core::undo::{GeometrySnapshot, RegionSnapshot};
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
    pub export: Option<PathBuf>,
    pub export_scale: f32,
}

impl Default for StartupOptions {
    fn default() -> Self {
        Self { open: None, size: 2048, demo: false, screenshot: None, theme: None, zoom: None, center: None, export: None, export_scale: 2.0 }
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
    /// Region id + border band at the border working resolution.
    regions: GpuField,
    uploaded: Option<UploadedDerived>,
    last_upload_tiles: u32,
}

/// Working resolution of the border cost field and region fill texture.
fn region_res(w: u32, h: u32) -> (u32, u32) {
    let cap = CostParams::default().max_size;
    let scale = (w.max(h) as f32 / cap as f32).max(1.0);
    (((w as f32 / scale).round() as u32).max(2), ((h as f32 / scale).round() as u32).max(2))
}

impl DerivedTextures {
    fn new(device: &wgpu::Device, w: u32, h: u32) -> Self {
        let (rw, rh) = region_res(w, h);
        Self {
            water: GpuField::new_labelled(device, w, h, "water"),
            biome: GpuField::new_labelled(device, w, h, "biome"),
            forest: GpuField::new_labelled(device, w, h, "forest"),
            moisture: GpuField::new_labelled(device, 64, 64, "moisture"),
            temperature: GpuField::new_labelled(device, 64, 64, "temperature"),
            regions: GpuField::new_labelled(device, rw, rh, "regions"),
            uploaded: None,
            last_upload_tiles: 0,
        }
    }

    fn views(&self) -> DerivedViews<'_> {
        DerivedViews { water: &self.water.view, moisture: &self.moisture.view, temperature: &self.temperature.view, biome: &self.biome.view, forest: &self.forest.view, regions: &self.regions.view }
    }

    fn device_bytes(&self) -> u64 {
        self.water.device_bytes + self.moisture.device_bytes + self.temperature.device_bytes + self.biome.device_bytes + self.forest.device_bytes + self.regions.device_bytes
    }
}

/// A realm's palette colour as an egui colour.
pub fn region_color(index: u32) -> egui::Color32 {
    let c = REGION_PALETTE[index as usize % REGION_PALETTE.len()];
    egui::Color32::from_rgb((c[0] * 255.0) as u8, (c[1] * 255.0) as u8, (c[2] * 255.0) as u8)
}

/// Zoom below which towns show as their symbol only.
const TOWN_ICON_ZOOM: f32 = 1.6;

enum SettleDragKind {
    Vertex(VertexRef),
    /// Building id and the grab offset from its centre.
    Building(u32, [f32; 2]),
    Paint,
}

struct SettleDrag {
    before: Vec<Settlement>,
    settlement: u64,
    kind: SettleDragKind,
}

/// A border vertex being dragged: every arc vertex that shared the grabbed
/// point moves together, so junctions stay joined.
struct BorderDrag {
    before: RegionSnapshot,
    targets: Vec<(u64, usize)>,
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
    /// Territory growth runs off-thread; the result is the new set of grown arcs.
    territory_job: Option<Job<Vec<Border>>>,
    /// Cost field cache keyed by (derived run, sea level).
    cost_field: Option<(u64, f32, CostField)>,
    selected_border: Option<u64>,
    selected_region: Option<u64>,
    border_drag: Option<BorderDrag>,
    selected_settlement: Option<u64>,
    selected_building: Option<u32>,
    settle_drag: Option<SettleDrag>,
    town_icons_visible: bool,
    instances_dirty: bool,
    instance_key: (usize, usize),
    selected_placement: Option<u64>,
    place_drag: Option<Vec<Placement>>,
    labels: LabelEngine,
    cultures: Vec<Culture>,
    themes: ThemeLibrary,
    selected_entity: Option<u64>,
    label_drag: Option<(Vec<Entity>, Vec2, [f32; 2])>,
    name_rng: NameRng,
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
    /// Headless export requested from the command line (path, scale).
    startup_export: Option<(PathBuf, f32)>,
    export: Option<ExportJob>,
    /// Quit once the command-line export has been written.
    exit_after_export: bool,
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
            territory_job: None,
            cost_field: None,
            selected_border: None,
            selected_region: None,
            border_drag: None,
            selected_settlement: None,
            selected_building: None,
            settle_drag: None,
            town_icons_visible: true,
            instances_dirty: true,
            instance_key: (usize::MAX, usize::MAX),
            selected_placement: None,
            place_drag: None,
            labels: LabelEngine::default(),
            cultures: names::load_cultures(&names::builtin_culture_dirs()),
            themes: ThemeLibrary::load(),
            selected_entity: None,
            label_drag: None,
            name_rng: NameRng::new(1234),
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
            startup_export: opts.export.clone().map(|p| (p, opts.export_scale)),
            export: None,
            exit_after_export: false,
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
        self.selected_entity = None;
        self.label_drag = None;
        self.selected_border = None;
        self.selected_region = None;
        self.border_drag = None;
        self.selected_settlement = None;
        self.selected_building = None;
        self.settle_drag = None;
        self.cost_field = None;
        self.territory_job = None;
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

        if let Some(job) = &self.territory_job {
            if let Some(arcs) = job.try_take() {
                let ms = job.started.elapsed().as_secs_f32() * 1000.0;
                self.territory_job = None;
                self.cpu.sections.insert("realms job", ms);
                log::info!("realms grown in {ms:.0} ms: {} arcs", arcs.len());
                self.finish_territory_job(arcs);
            }
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
                // Towns keep a clearing around them.
                let clearings: Vec<([f32; 2], f32)> = self.doc.settlements.iter().map(|s| (s.layout.center, s.layout.radius * 1.3 + 8.0)).collect();
                self.symbol_job = Some(Job::spawn("Placing symbols", move |_, _| {
                    let t = Terrain { elevation: &elev, sea_level: sea, biome: Some(&biome), water: Some(&water) };
                    let (mut out, peaks) = placement::place_mountains(&t, &params.mountains, &sets, Some(&temperature), Some(&forest), &clearings, &mut next_id);
                    out.extend(placement::place_forest(&t, &forest, Some(&temperature), &params.forest, &sets, &peaks, &clearings, &mut next_id));
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
        if tool == Tool::Name {
            self.name_press(pos_screen, fp);
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
        if tool == Tool::Border || tool == Tool::Territory {
            self.border_press(pos_screen, fp);
            return;
        }
        if tool == Tool::Settlement {
            self.settlement_press(pos_screen, fp);
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
        if self.border_drag.is_some() {
            self.border_drag_move(fp);
            return;
        }
        if self.settle_drag.is_some() {
            self.settlement_drag_move(fp);
            return;
        }
        if self.tools.tool.is_procedural() || (self.tools.tool == Tool::Border && self.input.stroke) {
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
        if let Some((_, start, base)) = &self.label_drag {
            let delta = (fp - *start).to_array();
            if let Some(id) = self.selected_entity {
                if let Some(e) = self.doc.entity_mut(id) {
                    e.label.offset = [base[0] + delta[0], base[1] + delta[1]];
                    e.label.pinned = true;
                }
            }
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
        if self.border_drag.is_some() {
            self.border_release();
            return;
        }
        if self.settle_drag.is_some() {
            self.settlement_release();
            return;
        }
        if self.tools.tool == Tool::Border && self.input.stroke {
            self.input.stroke = false;
            let path = std::mem::take(&mut self.tools.path);
            self.apply_border_stroke(path);
            return;
        }
        if let Some(before) = self.place_drag.take() {
            self.input.stroke = false;
            self.doc.commit_placements("Move symbol", before);
            return;
        }
        if let Some((before, _, _)) = self.label_drag.take() {
            self.input.stroke = false;
            self.doc.commit_entities("Move label", before);
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
        if self.town_icons_visible {
            for st in &self.doc.settlements {
                let qid = match st.params.kind {
                    SettlementKind::Homestead => "default/homestead",
                    SettlementKind::Hamlet => "default/hamlet",
                    SettlementKind::Village => "default/village",
                    SettlementKind::Town => "default/town",
                    SettlementKind::City => "default/city",
                };
                let Some(a) = self.library.get(qid) else { continue };
                let Some(rect) = a.rect else { continue };
                let (uv0, uv1) = rect.uv();
                let size = (st.layout.radius * 1.1).max(24.0);
                let h = size / rect.aspect().max(0.05);
                let sel = self.selected_settlement == Some(st.id);
                inst.push(SpriteInstance { pos: st.layout.center, size: [size, h], pivot: [0.5, 0.6], uv0, uv1, rot_flip: [0.0, 0.0], tint: [1.0, 1.0, if sel { 0.6 } else { 1.0 }, 1.0] });
            }
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

    // ---- naming ----------------------------------------------------------------

    fn culture(&self) -> Option<&Culture> {
        self.cultures.iter().find(|c| c.id == self.doc.culture).or(self.cultures.first())
    }

    fn generated_name(&mut self, kind: EntityKind) -> String {
        let Some(c) = self.culture() else { return "Nameless".into() };
        let c = c.clone();
        c.name_for(kind.name_key(), &mut self.name_rng)
    }

    /// Click with the Name tool: pick a label, or name the feature under the cursor.
    fn name_press(&mut self, screen: Vec2, fp: Vec2) {
        let ppp = self.egui_ctx.pixels_per_point();
        if let Some(id) = self.labels.hit(egui::pos2(screen.x / ppp, screen.y / ppp)) {
            self.selected_entity = Some(id);
            let base = self.doc.entity(id).map(|e| e.label.offset).unwrap_or([0.0; 2]);
            self.label_drag = Some((self.doc.entities.clone(), fp, base));
            self.input.stroke = true;
            return;
        }
        // A placed symbol?
        if let Some(pid) = self.placement_under(screen) {
            if let Some(e) = self.doc.entities.iter().find(|e| matches!(e.geometry, EntityRef::Placement { id, .. } if id == pid)) {
                self.selected_entity = Some(e.id);
                return;
            }
            let pos = self.doc.placements.iter().find(|p| p.id == pid).map(|p| p.pos).unwrap_or(fp.to_array());
            let tags = self.doc.placements.iter().find(|p| p.id == pid).and_then(|p| self.library.get(&p.asset)).map(|a| a.def.tags.clone()).unwrap_or_default();
            let kind = if tags.iter().any(|t| t == "settlement" || t == "castle") { EntityKind::Settlement } else { EntityKind::Marker };
            self.create_entity(kind, EntityRef::Placement { id: pid, pos });
            return;
        }
        // A lake or river under the cursor?
        if let Some(d) = &self.doc.derived {
            for l in &d.water.lakes {
                if l.polygon.contains(fp.to_array()) {
                    let c = EntityRef::Polygon(l.polygon.clone()).anchor();
                    if let Some(e) = self.doc.entities.iter().find(|e| e.kind == EntityKind::Lake && isoline_core::geometry::len(isoline_core::geometry::sub(e.geometry.anchor(), c)) < 10.0) {
                        self.selected_entity = Some(e.id);
                    } else {
                        let poly = l.polygon.clone();
                        self.create_entity(EntityKind::Lake, EntityRef::Polygon(poly));
                    }
                    return;
                }
            }
            let tol = 6.0 / self.camera.zoom.max(0.05);
            let mut best: Option<(f32, usize)> = None;
            for (i, r) in d.water.rivers.iter().enumerate() {
                for w in r.points.windows(2) {
                    let (d2, _) = isoline_core::geometry::seg_dist2(fp.to_array(), w[0], w[1]);
                    if d2 < tol * tol && best.map(|b| d2 < b.0).unwrap_or(true) {
                        best = Some((d2, i));
                    }
                }
            }
            if let Some((_, i)) = best {
                let pts = d.water.rivers[i].points.clone();
                let mid = pts[pts.len() / 2];
                if let Some(e) = self.doc.entities.iter().find(|e| e.kind == EntityKind::River && matches!(&e.geometry, EntityRef::Path(p) if p.len() == pts.len() && p[p.len() / 2] == mid)) {
                    self.selected_entity = Some(e.id);
                } else {
                    self.create_entity(EntityKind::River, EntityRef::Path(pts));
                }
                return;
            }
        }
        // A town: its label.
        if let Some(eid) = self.settlement_under(fp).and_then(|id| self.doc.settlement(id)).and_then(|s| s.entity) {
            if self.doc.entity(eid).is_some() {
                self.selected_entity = Some(eid);
                return;
            }
        }
        // Inside a realm: its label.
        if let Some(eid) = self.doc.region_at(fp.to_array()).and_then(|r| self.doc.regions.iter().find(|x| x.id == r)).and_then(|r| r.entity) {
            if self.doc.entity(eid).is_some() {
                self.selected_entity = Some(eid);
                return;
            }
        }
        // Otherwise a marker on the spot (sea → bay/sea style name on water).
        let on_water = self.doc.elevation.sample(fp.x, fp.y) <= self.doc.sea_level;
        let kind = if on_water { EntityKind::Bay } else { EntityKind::Marker };
        self.create_entity(kind, EntityRef::Point(fp.to_array()));
    }

    fn create_entity(&mut self, kind: EntityKind, geometry: EntityRef) {
        let before = self.doc.entities.clone();
        let name = self.generated_name(kind);
        let id = self.doc.next_entity_id;
        self.doc.next_entity_id += 1;
        let mut e = Entity::new(id, kind, name, geometry);
        e.culture = self.doc.culture.clone();
        self.doc.entities.push(e);
        self.doc.commit_entities("Name feature", before);
        self.selected_entity = Some(id);
    }

    fn name_everything(&mut self) {
        let Some(d) = self.doc.derived.as_ref() else {
            self.ui.status = "Wait for rivers and biomes before naming".into();
            return;
        };
        let Some(c) = self.culture().cloned() else { return };
        let settlement_tags: Vec<(u64, Vec<String>)> = self
            .doc
            .placements
            .iter()
            .filter_map(|p| self.library.get(&p.asset).map(|a| (p.id, a.def.tags.clone())))
            .filter(|(_, t)| t.iter().any(|g| g == "settlement" || g == "castle" || g == "marker"))
            .collect();
        let input = AutoNameInput {
            elevation: &self.doc.elevation,
            sea_level: self.doc.sea_level,
            derived: d,
            placements: &self.doc.placements,
            auto_symbols: &self.doc.auto_symbols,
            settlement_tags,
            existing: &self.doc.entities,
        };
        let mut next = self.doc.next_entity_id;
        let params = AutoNameParams { seed: self.name_rng.below(1 << 30) as u64, ..Default::default() };
        let new = autoname::name_everything(&input, &c, &params, &mut next);
        let n = new.len();
        let before = self.doc.entities.clone();
        self.doc.entities.extend(new);
        self.doc.next_entity_id = next + 1;
        self.doc.commit_entities("Name everything", before);
        self.ui.status = format!("Named {n} features in the {} tongue", c.pack.name);
    }

    fn clear_auto_names(&mut self) {
        let before = self.doc.entities.clone();
        self.doc.entities.retain(|e| !e.auto);
        self.doc.commit_entities("Clear generated names", before);
        self.selected_entity = None;
    }

    fn export_gazetteer(&mut self, json: bool) {
        let ext = if json { "json" } else { "csv" };
        let Some(path) = rfd::FileDialog::new().set_title("Export gazetteer").set_file_name(format!("{}-gazetteer.{ext}", self.doc.name)).save_file() else { return };
        let text = if json { isoline_core::entity::gazetteer_json(&self.doc.entities) } else { isoline_core::entity::gazetteer_csv(&self.doc.entities) };
        match std::fs::write(&path, text) {
            Ok(()) => self.ui.status = format!("Gazetteer written to {}", path.display()),
            Err(e) => self.ui.error = Some(format!("Export failed: {e}")),
        }
    }

    // ---- borders and realms --------------------------------------------------

    /// The terrain cost field, rebuilt when the water system or sea level changed.
    fn cost_field(&mut self) -> Option<&CostField> {
        let key = (self.doc.derived_runs, self.doc.sea_level);
        let stale = self.cost_field.as_ref().map(|(r, s, _)| (*r, *s) != key).unwrap_or(true);
        if stale {
            let t = Instant::now();
            let water = self.doc.derived.as_ref().map(|d| &d.water);
            let cf = CostField::build(&self.doc.elevation, self.doc.sea_level, water, &CostParams::default());
            let ms = t.elapsed().as_secs_f32() * 1000.0;
            log::info!("cost field {}×{} built in {ms:.0} ms", cf.width, cf.height);
            self.cpu.sections.insert("cost field", ms);
            self.cost_field = Some((key.0, key.1, cf));
        }
        self.cost_field.as_ref().map(|(_, _, cf)| cf)
    }

    /// Nearest border vertex within `px` screen pixels.
    fn border_vertex_under(&self, screen: Vec2, px: f32) -> Option<(u64, usize)> {
        let ss = self.screen_size();
        let mut best = px * px;
        let mut hit = None;
        for b in &self.doc.borders {
            for (i, p) in b.points.iter().enumerate() {
                let d2 = (self.camera.field_to_screen(Vec2::from(*p), ss) - screen).length_squared();
                if d2 < best {
                    best = d2;
                    hit = Some((b.id, i));
                }
            }
        }
        hit
    }

    /// Nearest border line within `px` screen pixels.
    fn border_under(&self, fp: Vec2, px: f32) -> Option<u64> {
        let tol = px / self.camera.zoom.max(0.01);
        let mut best = tol * tol;
        let mut hit = None;
        for b in &self.doc.borders {
            for w in b.points.windows(2) {
                let (d2, _) = isoline_core::geometry::seg_dist2(fp.to_array(), w[0], w[1]);
                if d2 < best {
                    best = d2;
                    hit = Some(b.id);
                }
            }
        }
        hit
    }

    fn border_press(&mut self, screen: Vec2, fp: Vec2) {
        // A vertex: drag it (and every arc that shares the point).
        if let Some((bid, vi)) = self.border_vertex_under(screen, 9.0) {
            let p = self.doc.borders.iter().find(|b| b.id == bid).map(|b| b.points[vi]).unwrap();
            let mut targets = Vec::new();
            for b in &self.doc.borders {
                for (i, q) in b.points.iter().enumerate() {
                    if (q[0] - p[0]).abs() < 0.01 && (q[1] - p[1]).abs() < 0.01 {
                        targets.push((b.id, i));
                    }
                }
            }
            self.selected_border = Some(bid);
            self.border_drag = Some(BorderDrag { before: self.doc.region_snapshot(), targets });
            self.input.stroke = true;
            return;
        }
        // A line: select it.
        if let Some(bid) = self.border_under(fp, 7.0) {
            self.selected_border = Some(bid);
            return;
        }
        match self.tools.tool {
            Tool::Border => {
                self.selected_border = None;
                self.tools.path.clear();
                self.tools.path.push(fp.to_array());
                self.input.stroke = true;
            }
            Tool::Territory => {
                self.selected_border = None;
                self.add_capital(fp.to_array());
            }
            _ => {}
        }
    }

    fn border_drag_move(&mut self, fp: Vec2) {
        let Some(d) = &self.border_drag else { return };
        let w = self.doc.width() as f32 - 1.0;
        let h = self.doc.height() as f32 - 1.0;
        let p = [fp.x.clamp(0.0, w), fp.y.clamp(0.0, h)];
        for (bid, vi) in &d.targets {
            if let Some(b) = self.doc.borders.iter_mut().find(|b| b.id == *bid) {
                if let Some(q) = b.points.get_mut(*vi) {
                    *q = p;
                }
            }
        }
        self.doc.rebuild_region_rings();
    }

    fn border_release(&mut self) {
        self.input.stroke = false;
        if let Some(d) = self.border_drag.take() {
            self.doc.commit_regions("Move border", d.before);
        }
    }

    /// The border brush: route the stroke over the cost field. A stroke that
    /// ends near where it began closes into a new region.
    fn apply_border_stroke(&mut self, path: Vec<[f32; 2]>) {
        if path.len() < 2 {
            return;
        }
        let naturalness = self.tools.border_naturalness;
        let style = self.tools.border_style;
        let Some(cf) = self.cost_field() else { return };
        let (mut pts, mut control) = borders::border_from_stroke(cf, &path, naturalness);
        let mut total = 0.0;
        for w in pts.windows(2) {
            total += isoline_core::geometry::len(isoline_core::geometry::sub(w[1], w[0]));
        }
        let gap = isoline_core::geometry::len(isoline_core::geometry::sub(*pts.last().unwrap(), pts[0]));
        let closes = pts.len() > 3 && gap < (total * 0.08).max(16.0);
        let before = self.doc.region_snapshot();
        let mut left = 0;
        if closes {
            // Snap the loop shut through the cost field too.
            let cf = self.cost_field().unwrap();
            let last = *pts.last().unwrap();
            let tail = borders::least_cost_path(cf, last, pts[0], naturalness);
            pts.extend(tail.into_iter().skip(1));
            control.push(pts[0]);
            let id = self.doc.new_region_id();
            let color = (self.doc.regions.len() as u32) % REGION_PALETTE.len() as u32;
            let seed = pts.iter().fold([0.0, 0.0], |a, p| [a[0] + p[0] / pts.len() as f32, a[1] + p[1] / pts.len() as f32]);
            self.doc.regions.push(borders::Region { id, seed, color, entity: None });
            left = id;
        }
        let id = self.doc.new_border_id();
        self.doc.borders.push(Border { id, left, right: 0, points: pts, kind: BorderKind::Drawn, style, naturalness, control });
        self.selected_border = Some(id);
        self.doc.commit_regions(if closes { "Draw region" } else { "Draw border" }, before);
        if closes {
            self.ensure_region_entities();
        }
    }

    /// Re-route the selected drawn border with the current naturalness and
    /// style (its control points are kept).
    fn reroute_selected_border(&mut self) {
        let Some(bid) = self.selected_border else { return };
        let Some(b) = self.doc.borders.iter().find(|b| b.id == bid) else { return };
        if b.kind != BorderKind::Drawn {
            let before = self.doc.region_snapshot();
            let style = self.tools.border_style;
            if let Some(b) = self.doc.borders.iter_mut().find(|b| b.id == bid) {
                b.style = style;
            }
            self.doc.commit_regions("Border style", before);
            return;
        }
        let control = b.control.clone();
        let n = self.tools.border_naturalness;
        let style = self.tools.border_style;
        let Some(cf) = self.cost_field() else { return };
        let pts = borders::route_control_points(cf, &control, n);
        let before = self.doc.region_snapshot();
        if let Some(b) = self.doc.borders.iter_mut().find(|b| b.id == bid) {
            b.points = pts;
            b.naturalness = n;
            b.style = style;
        }
        self.doc.commit_regions("Re-route border", before);
    }

    fn delete_selected_border(&mut self) {
        let Some(bid) = self.selected_border.take() else { return };
        let before = self.doc.region_snapshot();
        let Some(b) = self.doc.borders.iter().find(|b| b.id == bid).cloned() else { return };
        if b.kind == BorderKind::Grown {
            self.ui.status = "Realm borders come from the capitals: remove a realm from the list instead".into();
            self.selected_border = Some(bid);
            return;
        }
        self.doc.borders.retain(|x| x.id != bid);
        // A closed drawn border owned a region; remove that too.
        if b.left != 0 {
            self.remove_region_entity(b.left);
            self.doc.regions.retain(|r| r.id != b.left);
        }
        self.doc.commit_regions("Delete border", before);
    }

    fn add_capital(&mut self, p: [f32; 2]) {
        if self.doc.elevation.sample(p[0], p[1]) <= self.doc.sea_level {
            self.ui.status = "A capital must stand on land".into();
            return;
        }
        let before = self.doc.region_snapshot();
        let id = self.doc.new_region_id();
        let color = (self.doc.regions.len() as u32) % REGION_PALETTE.len() as u32;
        self.doc.regions.push(borders::Region { id, seed: p, color, entity: None });
        self.selected_region = Some(id);
        self.doc.commit_regions("Place capital", before);
        self.grow_realms();
    }

    fn remove_region_entity(&mut self, region: u64) {
        if let Some(eid) = self.doc.regions.iter().find(|r| r.id == region).and_then(|r| r.entity) {
            let before = self.doc.entities.clone();
            self.doc.entities.retain(|e| e.id != eid);
            self.doc.commit_entities("Remove realm name", before);
            if self.selected_entity == Some(eid) {
                self.selected_entity = None;
            }
        }
    }

    fn remove_region(&mut self, region: u64) {
        let before = self.doc.region_snapshot();
        self.remove_region_entity(region);
        self.doc.regions.retain(|r| r.id != region);
        // Drawn regions own one closed border; grown ones are regrown.
        self.doc.borders.retain(|b| !(b.kind == BorderKind::Drawn && b.left == region));
        if self.selected_region == Some(region) {
            self.selected_region = None;
        }
        self.doc.commit_regions("Remove realm", before);
        self.grow_realms();
    }

    fn clear_realms(&mut self) {
        let before = self.doc.region_snapshot();
        let ids: Vec<u64> = self.doc.regions.iter().map(|r| r.id).collect();
        for id in ids {
            self.remove_region_entity(id);
        }
        self.doc.regions.clear();
        self.doc.borders.clear();
        self.selected_region = None;
        self.selected_border = None;
        self.territory_job = None;
        self.doc.commit_regions("Clear realms", before);
    }

    /// Grow every capital's realm over the cost field (off-thread).
    fn grow_realms(&mut self) {
        let seeds: Vec<Seed> = self.doc.regions.iter().filter(|r| !self.doc.borders.iter().any(|b| b.kind == BorderKind::Drawn && b.left == r.id)).map(|r| Seed { region: r.id, pos: r.seed }).collect();
        if seeds.is_empty() {
            let before = self.doc.region_snapshot();
            self.doc.borders.retain(|b| b.kind != BorderKind::Grown);
            self.doc.commit_regions("Grow realms", before);
            return;
        }
        let Some(cf) = self.cost_field() else { return };
        let cf = cf.clone();
        self.territory_job = Some(Job::spawn("Growing realms", move |_, _| {
            let labels = borders::grow_territories(&cf, &seeds);
            let mut next = 0;
            borders::arcs_from_labels(&cf, &labels, cf.scale * 1.2, &mut next)
        }));
    }

    fn finish_territory_job(&mut self, mut arcs: Vec<Border>) {
        let before = self.doc.region_snapshot();
        self.doc.borders.retain(|b| b.kind != BorderKind::Grown);
        for a in arcs.iter_mut() {
            a.id = self.doc.new_border_id();
        }
        self.doc.borders.extend(arcs);
        self.doc.commit_regions("Grow realms", before);
        self.ensure_region_entities();
    }

    /// Every realm gets a label entity (auto-named in the current language)
    /// centred on its territory.
    fn ensure_region_entities(&mut self) {
        let before = self.doc.entities.clone();
        let mut changed = false;
        let ids: Vec<u64> = self.doc.regions.iter().map(|r| r.id).collect();
        for rid in ids {
            let existing = self.doc.regions.iter().find(|r| r.id == rid).and_then(|r| r.entity).filter(|eid| self.doc.entities.iter().any(|e| e.id == *eid));
            let Some((c, radius)) = borders::region_extent(self.doc.region_rings_of(rid)) else { continue };
            match existing {
                Some(eid) => {
                    if let Some(e) = self.doc.entities.iter_mut().find(|e| e.id == eid) {
                        e.geometry = EntityRef::Area { center: c, radius };
                    }
                }
                None => {
                    let name = self.generated_name(EntityKind::Region);
                    let id = self.doc.next_entity_id;
                    self.doc.next_entity_id += 1;
                    let mut e = Entity::new(id, EntityKind::Region, name, EntityRef::Area { center: c, radius });
                    e.culture = self.doc.culture.clone();
                    e.auto = true;
                    e.importance = 0.65;
                    self.doc.entities.push(e);
                    if let Some(r) = self.doc.regions.iter_mut().find(|r| r.id == rid) {
                        r.entity = Some(id);
                    }
                    changed = true;
                }
            }
        }
        if changed {
            self.doc.commit_entities("Name realms", before);
        }
    }

    /// Rename the generated features inside a realm in that realm's
    /// language, so a region reads as one culture.
    fn propagate_region_names(&mut self, entity_id: u64) {
        let Some(region) = self.doc.regions.iter().find(|r| r.entity == Some(entity_id)).map(|r| r.id) else { return };
        let Some(label) = self.doc.entity(entity_id).cloned() else { return };
        let culture = self.cultures.iter().find(|c| c.id == label.culture).or_else(|| self.culture()).cloned();
        let Some(culture) = culture else { return };
        let rings = self.doc.region_rings_of(region).to_vec();
        let before = self.doc.entities.clone();
        let mut n = 0;
        let mut rng = NameRng::new(self.name_rng.below(1 << 30) as u64);
        for e in self.doc.entities.iter_mut() {
            if e.id == entity_id || !e.auto || !borders::rings_contain(&rings, e.geometry.anchor()) {
                continue;
            }
            e.name = culture.name_for(e.kind.name_key(), &mut rng);
            e.culture = culture.id.clone();
            let tag = format!("in:{}", label.name);
            if !e.tags.contains(&tag) {
                e.tags.retain(|t| !t.starts_with("in:"));
                e.tags.push(tag);
            }
            n += 1;
        }
        self.doc.commit_entities("Rename features in realm", before);
        self.ui.status = format!("Renamed {n} features inside {} in the {} tongue", label.name, culture.pack.name);
    }

    /// Re-rasterize the region fill texture after any region change.
    fn upload_regions(&mut self) {
        self.doc.regions_dirty = false;
        let tex = &self.derived_tex.regions;
        let scale = self.doc.width() as f32 / tex.width() as f32;
        let field = borders::rasterize_regions(&self.doc.region_rings, tex.width(), tex.height(), scale, 6);
        tex.upload_all(&self.gpu.queue, &field);
    }

    // ---- towns -----------------------------------------------------------------

    fn river_paths(&self) -> Vec<Vec<[f32; 2]>> {
        match (&self.doc.baked, &self.doc.derived) {
            (Some(b), _) => b.rivers.iter().map(|r| r.points.clone()).collect(),
            (None, Some(d)) => d.water.rivers.iter().map(|r| r.points.clone()).collect(),
            _ => Vec::new(),
        }
    }

    fn generate_layout(&self, pos: [f32; 2], params: &settlement::SettlementParams) -> settlement::Layout {
        let rivers = self.river_paths();
        let water = self.doc.derived.as_ref().map(|d| &d.water_cov);
        let site = Site { elevation: &self.doc.elevation, sea_level: self.doc.sea_level, water, rivers: &rivers };
        settlement::generate(&site, pos, params)
    }

    fn settlement_under(&self, fp: Vec2) -> Option<u64> {
        let mut best: Option<(f32, u64)> = None;
        for st in &self.doc.settlements {
            let d = (Vec2::from(st.layout.center) - fp).length();
            if d <= st.layout.radius * 1.15 && best.map(|b| d < b.0).unwrap_or(true) {
                best = Some((d, st.id));
            }
        }
        best.map(|b| b.1)
    }

    fn place_settlement(&mut self, fp: Vec2) {
        let lake = self.doc.derived.as_ref().map(|d| d.water_cov.sample(fp.x, fp.y) > 0.5).unwrap_or(false);
        if self.doc.elevation.sample(fp.x, fp.y) <= self.doc.sea_level || lake {
            self.ui.status = "A town needs dry land".into();
            return;
        }
        let mut params = self.tools.settlement.clone();
        params.seed = self.name_rng.below(1 << 30) as u64;
        let layout = self.generate_layout(fp.to_array(), &params);
        let before = self.doc.settlements.clone();
        let id = self.doc.new_settlement_id();
        self.doc.settlements.push(Settlement { id, pos: fp.to_array(), params, layout, entity: None });
        self.doc.commit_settlements("Place town", before);
        self.selected_settlement = Some(id);
        self.selected_building = None;
        self.instances_dirty = true;
        self.doc.symbols_changed();
        self.ensure_settlement_entity(id);
    }

    /// Rebuild the selected town from the tool's parameters (seed kept).
    fn regenerate_selected_settlement(&mut self, new_seed: bool) {
        let Some(id) = self.selected_settlement else { return };
        let Some(st) = self.doc.settlement(id).cloned() else { return };
        let mut params = self.tools.settlement.clone();
        params.seed = if new_seed { self.name_rng.below(1 << 30) as u64 } else { st.params.seed };
        params.district_seeds = st.params.district_seeds;
        let t = Instant::now();
        let layout = self.generate_layout(st.pos, &params);
        self.cpu.sections.insert("town generate", t.elapsed().as_secs_f32() * 1000.0);
        let before = self.doc.settlements.clone();
        if let Some(s) = self.doc.settlement_mut(id) {
            s.params = params;
            s.layout = layout;
        }
        self.doc.commit_settlements(if new_seed { "Re-roll town" } else { "Edit town" }, before);
        self.selected_building = None;
        self.instances_dirty = true;
        self.doc.symbols_changed();
        self.ensure_settlement_entity(id);
    }

    fn reroll_district(&mut self, district: District) {
        let Some(id) = self.selected_settlement else { return };
        let Some(mut st) = self.doc.settlement(id).cloned() else { return };
        {
            let rivers = self.river_paths();
            let water = self.doc.derived.as_ref().map(|d| &d.water_cov);
            let site = Site { elevation: &self.doc.elevation, sea_level: self.doc.sea_level, water, rivers: &rivers };
            settlement::reroll_district(&site, &mut st, district);
        }
        let before = self.doc.settlements.clone();
        if let Some(s) = self.doc.settlement_mut(id) {
            *s = st;
        }
        self.doc.commit_settlements("Re-roll district", before);
        self.selected_building = None;
    }

    fn delete_selected_settlement(&mut self) {
        let Some(id) = self.selected_settlement.take() else { return };
        if let Some(eid) = self.doc.settlement(id).and_then(|s| s.entity) {
            let before = self.doc.entities.clone();
            self.doc.entities.retain(|e| e.id != eid);
            self.doc.commit_entities("Remove town name", before);
            if self.selected_entity == Some(eid) {
                self.selected_entity = None;
            }
        }
        let before = self.doc.settlements.clone();
        self.doc.settlements.retain(|s| s.id != id);
        self.doc.commit_settlements("Delete town", before);
        self.selected_building = None;
        self.instances_dirty = true;
        self.doc.symbols_changed();
    }

    fn delete_selected_building(&mut self) {
        let (Some(id), Some(bid)) = (self.selected_settlement, self.selected_building.take()) else { return };
        let before = self.doc.settlements.clone();
        if let Some(s) = self.doc.settlement_mut(id) {
            s.layout.buildings.retain(|b| b.id != bid);
        }
        self.doc.commit_settlements("Delete building", before);
    }

    fn set_building_district(&mut self, district: District) {
        let (Some(id), Some(bid)) = (self.selected_settlement, self.selected_building) else { return };
        let before = self.doc.settlements.clone();
        if let Some(b) = self.doc.settlement_mut(id).and_then(|s| s.layout.buildings.iter_mut().find(|b| b.id == bid)) {
            b.district = district;
        }
        self.doc.commit_settlements("Repaint district", before);
    }

    /// A town's label entity, created on first need and kept on its centre.
    fn ensure_settlement_entity(&mut self, id: u64) {
        let Some(st) = self.doc.settlement(id).cloned() else { return };
        let before = self.doc.entities.clone();
        match st.entity.filter(|e| self.doc.entities.iter().any(|x| x.id == *e)) {
            Some(eid) => {
                if let Some(e) = self.doc.entity_mut(eid) {
                    e.geometry = EntityRef::Point(st.layout.center);
                    e.importance = st.params.kind.importance();
                }
                self.doc.commit_entities("Move town name", before);
            }
            None => {
                let name = self.generated_name(EntityKind::Settlement);
                let eid = self.doc.next_entity_id;
                self.doc.next_entity_id += 1;
                let mut e = Entity::new(eid, EntityKind::Settlement, name, EntityRef::Point(st.layout.center));
                e.culture = self.doc.culture.clone();
                e.auto = true;
                e.importance = st.params.kind.importance();
                // The name hangs below the town rather than across its houses.
                e.label.offset = [0.0, st.layout.radius * 0.9 + 3.0];
                self.doc.entities.push(e);
                if let Some(s) = self.doc.settlement_mut(id) {
                    s.entity = Some(eid);
                }
                self.doc.commit_entities("Name town", before);
            }
        }
    }

    fn settlement_press(&mut self, _screen: Vec2, fp: Vec2) {
        let zoom = self.camera.zoom;
        // Inside the selected town at detail zoom: grab a vertex, a building, or paint.
        if let Some(id) = self.selected_settlement {
            if let Some(st) = self.doc.settlement(id) {
                if (Vec2::from(st.layout.center) - fp).length() <= st.layout.radius * 1.3 {
                    if self.tools.paint_district {
                        self.settle_drag = Some(SettleDrag { before: self.doc.settlements.clone(), settlement: id, kind: SettleDragKind::Paint });
                        self.input.stroke = true;
                        self.settlement_drag_move(fp);
                        return;
                    }
                    let tol = 7.0 / zoom.max(0.05);
                    if zoom >= 2.4 {
                        if let Some(v) = st.layout.vertex_near(fp.to_array(), tol) {
                            self.settle_drag = Some(SettleDrag { before: self.doc.settlements.clone(), settlement: id, kind: SettleDragKind::Vertex(v) });
                            self.input.stroke = true;
                            return;
                        }
                    }
                    if let Some(bid) = st.layout.building_at(fp.to_array()) {
                        let c = st.layout.buildings.iter().find(|b| b.id == bid).map(|b| b.centre()).unwrap();
                        self.selected_building = Some(bid);
                        self.settle_drag = Some(SettleDrag { before: self.doc.settlements.clone(), settlement: id, kind: SettleDragKind::Building(bid, [c[0] - fp.x, c[1] - fp.y]) });
                        self.input.stroke = true;
                        return;
                    }
                    self.selected_building = None;
                    return;
                }
            }
        }
        // Another town: select it. Empty land: a new town.
        match self.settlement_under(fp) {
            Some(id) => {
                self.selected_settlement = Some(id);
                self.selected_building = None;
                if let Some(st) = self.doc.settlement(id) {
                    self.tools.settlement = st.params.clone();
                }
            }
            None => self.place_settlement(fp),
        }
    }

    fn settlement_drag_move(&mut self, fp: Vec2) {
        let Some(d) = &self.settle_drag else { return };
        let id = d.settlement;
        match d.kind {
            SettleDragKind::Vertex(v) => {
                if let Some(s) = self.doc.settlement_mut(id) {
                    s.layout.move_vertex(v, fp.to_array());
                }
            }
            SettleDragKind::Building(bid, off) => {
                if let Some(b) = self.doc.settlement_mut(id).and_then(|s| s.layout.buildings.iter_mut().find(|b| b.id == bid)) {
                    let c = b.centre();
                    let target = [fp.x + off[0], fp.y + off[1]];
                    let dx = target[0] - c[0];
                    let dy = target[1] - c[1];
                    for q in b.quad.iter_mut() {
                        q[0] += dx;
                        q[1] += dy;
                    }
                }
            }
            SettleDragKind::Paint => {
                let r = self.tools.paint_radius;
                let kind = self.tools.paint_kind;
                if let Some(s) = self.doc.settlement_mut(id) {
                    for b in s.layout.buildings.iter_mut() {
                        let c = b.centre();
                        if (c[0] - fp.x).powi(2) + (c[1] - fp.y).powi(2) <= r * r {
                            b.district = kind;
                        }
                    }
                }
            }
        }
    }

    fn settlement_release(&mut self) {
        self.input.stroke = false;
        if let Some(d) = self.settle_drag.take() {
            let label = match d.kind {
                SettleDragKind::Vertex(_) => "Move street",
                SettleDragKind::Building(..) => "Move building",
                SettleDragKind::Paint => "Paint district",
            };
            self.doc.commit_settlements(label, d.before);
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
                UiAction::NameEverything => self.name_everything(),
                UiAction::ClearAutoNames => self.clear_auto_names(),
                UiAction::ExportGazetteer { json } => self.export_gazetteer(json),
                UiAction::EntityEdit { before } => self.doc.commit_entities("Edit name", before),
                UiAction::EntityGenerateName(id) => {
                    let before = self.doc.entities.clone();
                    let kind = self.doc.entity(id).map(|e| e.kind).unwrap_or(EntityKind::Marker);
                    let name = self.generated_name(kind);
                    let culture = self.doc.culture.clone();
                    if let Some(e) = self.doc.entity_mut(id) {
                        e.name = name;
                        e.culture = culture;
                        e.auto = false;
                    }
                    self.doc.commit_entities("Generate name", before);
                }
                UiAction::DeleteEntity(id) => {
                    let before = self.doc.entities.clone();
                    self.doc.entities.retain(|e| e.id != id);
                    self.doc.commit_entities("Delete name", before);
                    self.selected_entity = None;
                    for r in self.doc.regions.iter_mut() {
                        if r.entity == Some(id) {
                            r.entity = None;
                        }
                    }
                }
                UiAction::SelectEntity(id) => self.selected_entity = id,
                UiAction::BorderSettingsChanged => self.reroute_selected_border(),
                UiAction::GrowRealms => self.grow_realms(),
                UiAction::RemoveRegion(id) => self.remove_region(id),
                UiAction::ClearRealms => self.clear_realms(),
                UiAction::DeleteSelectedBorder => self.delete_selected_border(),
                UiAction::PropagateRegionNames(id) => self.propagate_region_names(id),
                UiAction::ExportImage(settings) => {
                    let name = crate::export::default_name(&self.doc.name, &settings);
                    let filter = if settings.jpeg { ("JPEG image", &["jpg", "jpeg"][..]) } else { ("PNG image", &["png"][..]) };
                    if let Some(path) = rfd::FileDialog::new().set_title("Export image").add_filter(filter.0, filter.1).set_file_name(name).save_file() {
                        self.start_export(settings, path);
                    }
                }
                UiAction::ImportTheme => {
                    if let Some(path) = rfd::FileDialog::new().set_title("Import theme").add_filter("Theme JSON", &["json"]).pick_file() {
                        match self.themes.import(&path) {
                            Ok(t) => {
                                self.doc.render.theme = t;
                                self.doc.modified = true;
                                self.doc.symbols_changed();
                                self.ui.status = format!("Theme \"{}\" imported", self.doc.render.theme.name);
                            }
                            Err(e) => self.ui.error = Some(format!("Theme import failed: {e:#}")),
                        }
                    }
                }
                UiAction::ExportTheme => {
                    let name = format!("{}.json", self.doc.render.theme.name.to_lowercase().replace(' ', "-").replace('&', "and"));
                    if let Some(path) = rfd::FileDialog::new().set_title("Export theme").add_filter("Theme JSON", &["json"]).set_file_name(name).save_file() {
                        let mut t = self.doc.render.theme.clone();
                        if let Some(stem) = path.file_stem() {
                            t.name = stem.to_string_lossy().replace(['-', '_'], " ");
                        }
                        match crate::themes::write_theme(&path, &t) {
                            Ok(()) => self.ui.status = format!("Theme written to {}", path.display()),
                            Err(e) => self.ui.error = Some(format!("Theme export failed: {e:#}")),
                        }
                    }
                }
                UiAction::ApplyTheme(name) => {
                    if let Some(t) = self.themes.themes.iter().find(|t| t.name == name) {
                        self.doc.render.theme = t.clone();
                        self.doc.modified = true;
                        self.doc.symbols_changed();
                    }
                }
                UiAction::ExportSvg => {
                    if let Some(path) = rfd::FileDialog::new().set_title("Export vector").add_filter("SVG", &["svg"]).set_file_name(format!("{}.svg", self.doc.name)).save_file() {
                        self.export_svg(path);
                    }
                }
                UiAction::SettlementParamsChanged => self.regenerate_selected_settlement(false),
                UiAction::RerollSettlement => self.regenerate_selected_settlement(true),
                UiAction::RerollDistrict(d) => self.reroll_district(d),
                UiAction::DeleteSettlement => self.delete_selected_settlement(),
                UiAction::DeleteBuilding => self.delete_selected_building(),
                UiAction::SetBuildingDistrict(d) => self.set_building_district(d),
                UiAction::SelectSettlement(id) => {
                    self.selected_settlement = id;
                    self.selected_building = None;
                    self.instances_dirty = true;
                    if let Some(st) = id.and_then(|i| self.doc.settlement(i)) {
                        self.tools.settlement = st.params.clone();
                    }
                }
                UiAction::SelectRegion(id) => {
                    self.selected_region = id;
                    if let Some(eid) = id.and_then(|r| self.doc.regions.iter().find(|x| x.id == r)).and_then(|r| r.entity) {
                        self.selected_entity = Some(eid);
                    }
                }
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
            KeyCode::KeyN if !ctrl => self.tools.tool = Tool::Name,
            KeyCode::KeyB if !ctrl => self.tools.tool = Tool::Border,
            KeyCode::KeyT if !ctrl => self.tools.tool = Tool::Territory,
            KeyCode::KeyS if !ctrl => self.tools.tool = Tool::Settlement,
            KeyCode::BracketLeft => self.scale_radius(1.0 / 1.2),
            KeyCode::BracketRight => self.scale_radius(1.2),
            KeyCode::Delete | KeyCode::Backspace => {
                if self.tools.tool == Tool::WaterEdit {
                    self.delete_selected_water();
                } else if self.tools.tool == Tool::Place {
                    self.delete_selected_placement();
                } else if self.tools.tool == Tool::Name {
                    if let Some(id) = self.selected_entity {
                        self.handle_actions(vec![UiAction::DeleteEntity(id)], event_loop);
                    }
                } else if self.tools.tool == Tool::Border || self.tools.tool == Tool::Territory {
                    self.delete_selected_border();
                } else if self.tools.tool == Tool::Settlement {
                    if self.selected_building.is_some() {
                        self.delete_selected_building();
                    } else {
                        self.delete_selected_settlement();
                    }
                }
            }
            KeyCode::Escape => {
                if self.input.stroke {
                    if self.tools.tool.is_procedural() || self.tools.tool == Tool::Border {
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

    /// The map pass uniform for a view of `ss` pixels whose top-left pixel
    /// is field point `origin` at `scale` pixels per texel.
    fn view_uniform(&self, ss: Vec2, origin: Vec2, scale: f32, flags: u32, cursor_field: Option<Vec2>) -> ViewUniform {
        let az = self.doc.render.sun_azimuth_deg.to_radians();
        let alt = self.doc.render.sun_altitude_deg.to_radians();
        let mut flags = flags;
        if self.derived_tex.uploaded.is_some() {
            flags |= FLAG_HAS_DERIVED;
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
        let mut region_palette = [[0.0f32; 4]; 32];
        for r in &self.doc.regions {
            let c = REGION_PALETTE[r.color as usize % REGION_PALETTE.len()];
            region_palette[(r.id % 32) as usize] = [c[0], c[1], c[2], 1.0];
        }
        let _ = (ReliefStyle::Shaded, ForestStyle::None);
        ViewUniform {
            screen_size: ss.to_array(),
            field_size: [fw, fh],
            origin: origin.to_array(),
            scale,
            sea_level: self.doc.sea_level,
            sun_dir: [az.sin() * alt.cos(), -az.cos() * alt.cos(), alt.sin()],
            exaggeration: self.doc.render.vertical_exaggeration,
            shade_strength: if th.style == ThemeStyle::Modern { self.doc.render.hillshade_strength } else { th.hillshade_strength },
            contour_interval: self.doc.render.contour_interval,
            coast_width: if th.style == ThemeStyle::Modern { self.doc.render.coast_line_width } else { th.coast_line_width },
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
            region_fill: if self.doc.regions.is_empty() { 0.0 } else if th.style == ThemeStyle::Modern { 0.2 } else { 0.16 },
            region_scale: [self.derived_tex.regions.width() as f32 / fw, self.derived_tex.regions.height() as f32 / fh],
            _pad_b: [0.0; 4],
            palette,
            region_palette,
        }
    }

    // ---- export ------------------------------------------------------------------

    /// Lay out labels and overlays for the whole sheet at the export scale
    /// and start a band-by-band export that the frame loop advances.
    fn start_export(&mut self, settings: ExportSettings, path: PathBuf) {
        if self.export.is_some() {
            self.ui.status = "An export is already running".into();
            return;
        }
        let scale = settings.scale.max(0.05);
        let fw = self.doc.width() as f32;
        let fh = self.doc.height() as f32;
        let width = ((fw + 2.0 * settings.bleed) * scale).round().max(1.0);
        let height = ((fh + 2.0 * settings.bleed) * scale).round().max(1.0);
        let ss = Vec2::new(width, height);
        let cam = Camera::new(Vec2::new(fw * 0.5, fh * 0.5), scale);
        // Labels, ornaments and town detail are laid out in points as they
        // appear on screen at the reference zoom; the pixel ratio then
        // carries the whole overlay up to the export resolution.
        let screen_ppp = self.egui_ctx.pixels_per_point();
        let ref_zoom = match settings.reference {
            Reference::Fit => Camera::fit(Vec2::new(fw, fh), self.screen_size()).zoom,
            Reference::Current => self.camera.zoom,
        } / screen_ppp;
        let ppp = (scale / ref_zoom.max(0.01)).max(0.01);
        let ctx = egui::Context::default();
        ui::install_fonts(&ctx);
        ctx.set_pixels_per_point(ppp);
        let mut renderer = egui_wgpu::Renderer::new(&self.gpu.device, self.config.format, egui_wgpu::RendererOptions { msaa_samples: 1, ..Default::default() });
        // Fonts only exist after a first pass.
        let raw = egui::RawInput { screen_rect: Some(egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(width / ppp, height / ppp))), ..Default::default() };
        let warm = ctx.run_ui(raw.clone(), |_| {});
        for (id, delta) in &warm.textures_delta.set {
            renderer.update_texture(&self.gpu.device, &self.gpu.queue, *id, delta);
        }
        let mut engine = LabelEngine::default();
        {
            let lib = &self.library;
            let placements = &self.doc.placements;
            let symbol_half = |e: &Entity| -> f32 {
                match &e.geometry {
                    EntityRef::Placement { id, .. } => placements.iter().find(|p| p.id == *id).and_then(|p| lib.get(&p.asset).map(|a| p.size / a.aspect.max(0.1) * 0.5)).unwrap_or(0.0),
                    _ => 0.0,
                }
            };
            if self.view_mode == ViewMode::Map {
                engine.layout(&ctx, &self.doc.entities, &self.doc.render.theme, &cam, ss, Vec2::new(fw, fh), ppp, symbol_half, None);
            }
        }
        let ov = self.build_overlay_for(&cam, ss, ppp, true);
        let full = ctx.run_ui(raw, |ui| {
            let c = ui.ctx().clone();
            ui::draw_overlay(&c, &ov);
            let painter = c.layer_painter(egui::LayerId::background());
            engine.draw(&painter, ov.paper, None);
        });
        for (id, delta) in &full.textures_delta.set {
            renderer.update_texture(&self.gpu.device, &self.gpu.queue, *id, delta);
        }
        // Town icons follow the reference zoom, not the screen's.
        self.town_icons_visible = ref_zoom < TOWN_ICON_ZOOM;
        self.rebuild_instances();
        match ExportJob::new(&self.gpu.device, self.config.format, settings, path, self.doc.width(), self.doc.height(), self.gpu.max_field_dim(), full.shapes, ctx, renderer, ppp) {
            Ok(job) => {
                self.ui.status = format!("Exporting {}×{}…", job.width, job.height);
                self.export = Some(job);
            }
            Err(e) => self.ui.error = Some(format!("Export failed: {e:#}")),
        }
    }

    /// Vector export: a terrain raster is rendered first (one band per
    /// frame), then embedded under the vector layers.
    fn export_svg(&mut self, path: PathBuf) {
        let tmp = std::env::temp_dir().join(format!("isoline-svg-terrain-{}.png", std::process::id()));
        self.start_export(ExportSettings { scale: 1.0, terrain_only: true, ..Default::default() }, tmp);
        if let Some(job) = self.export.as_mut() {
            job.svg_after = Some(path);
        }
    }

    /// Everything vector on the sheet, in texels.
    fn write_svg(&mut self, path: &Path, terrain_png: Option<Vec<u8>>) -> Result<()> {
        let fw = self.doc.width() as f32;
        let fh = self.doc.height() as f32;
        let fs = Vec2::new(fw, fh);
        let t = Instant::now();
        // Coast at sea level, sampled every other texel.
        let step = if fw.max(fh) > 4096.0 { 4 } else { 2 };
        let coast: Vec<Vec<[f32; 2]>> = isoline_core::geometry::isolines(&self.doc.elevation, self.doc.sea_level, step)
            .into_iter()
            .map(|l| {
                let keep = isoline_core::geometry::simplify(&l, 0.8);
                keep.into_iter().map(|i| l[i]).collect::<Vec<_>>()
            })
            .filter(|l| l.len() >= 3)
            .collect();
        type RiverList = Vec<(Vec<[f32; 2]>, f32)>;
        let (rivers, lakes): (RiverList, Vec<isoline_core::geometry::Polygon>) = match (&self.doc.baked, &self.doc.derived) {
            (Some(b), _) => (b.rivers.iter().map(|r| (r.points.clone(), r.widths.iter().sum::<f32>() / r.widths.len().max(1) as f32)).collect(), b.lakes.iter().map(|l| l.polygon.clone()).collect()),
            (None, Some(d)) => (d.water.rivers.iter().map(|r| (r.points.clone(), r.widths.iter().sum::<f32>() / r.widths.len().max(1) as f32)).collect(), d.water.lakes.iter().map(|l| l.polygon.clone()).collect()),
            _ => (Vec::new(), Vec::new()),
        };
        let regions: Vec<([f32; 3], Vec<isoline_core::geometry::Polygon>)> = self.doc.regions.iter().map(|r| (REGION_PALETTE[r.color as usize % REGION_PALETTE.len()], self.doc.region_rings_of(r.id).to_vec())).collect();
        // Labels as on the fitted view.
        let screen_ppp = self.egui_ctx.pixels_per_point();
        let ref_zoom = Camera::fit(fs, self.screen_size()).zoom / screen_ppp;
        let cam = Camera::new(fs * 0.5, ref_zoom);
        let ss = fs * ref_zoom;
        let ctx = egui::Context::default();
        ui::install_fonts(&ctx);
        ctx.set_pixels_per_point(1.0);
        let raw = egui::RawInput { screen_rect: Some(egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(ss.x, ss.y))), ..Default::default() };
        let _ = ctx.run_ui(raw, |_| {});
        let mut engine = LabelEngine::default();
        {
            let lib = &self.library;
            let placements = &self.doc.placements;
            let symbol_half = |e: &Entity| -> f32 {
                match &e.geometry {
                    EntityRef::Placement { id, .. } => placements.iter().find(|p| p.id == *id).and_then(|p| lib.get(&p.asset).map(|a| p.size / a.aspect.max(0.1) * 0.5)).unwrap_or(0.0),
                    _ => 0.0,
                }
            };
            engine.layout(&ctx, &self.doc.entities, &self.doc.render.theme, &cam, ss, fs, 1.0, symbol_half, None);
        }
        let to_field = |p: egui::Pos2| -> [f32; 2] { [(p.x - ss.x * 0.5) / ref_zoom + fw * 0.5, (p.y - ss.y * 0.5) / ref_zoom + fh * 0.5] };
        let labels: Vec<SvgLabel> = engine
            .placed
            .iter()
            .filter(|l| l.visible)
            .map(|l| {
                let mut italic = false;
                let bold = false;
                let glyphs = l
                    .glyphs
                    .iter()
                    .map(|g| {
                        let fmt = g.galley.job.sections.first().map(|s| s.format.clone());
                        let size = fmt.as_ref().map(|f| f.font_id.size).unwrap_or(12.0);
                        if let Some(f) = &fmt {
                            if let egui::FontFamily::Name(n) = &f.font_id.family {
                                italic |= n.as_ref() == ui::SERIF_ITALIC;
                            }
                        }
                        SvgGlyph { text: g.galley.job.text.clone(), pos: to_field(g.pos), angle: g.angle, size: size / ref_zoom }
                    })
                    .collect();
                let c = l.color;
                SvgLabel { glyphs, color: [c.r() as f32 / 255.0, c.g() as f32 / 255.0, c.b() as f32 / 255.0], halo: l.halo / ref_zoom, italic, bold }
            })
            .collect();
        // Symbols: placed and automatic, plus town icons at this zoom.
        let mut symbols: Vec<SvgSymbol> = Vec::new();
        for p in self.doc.all_symbols() {
            if let Some(a) = self.library.get(&p.asset) {
                symbols.push(SvgSymbol { path: a.path.clone(), pos: p.pos, size: p.size, aspect: a.aspect, pivot: a.def.pivot, rotation: p.rotation, flip: p.flip });
            }
        }
        if ref_zoom < TOWN_ICON_ZOOM {
            for st in &self.doc.settlements {
                let qid = match st.params.kind {
                    SettlementKind::Homestead => "default/homestead",
                    SettlementKind::Hamlet => "default/hamlet",
                    SettlementKind::Village => "default/village",
                    SettlementKind::Town => "default/town",
                    SettlementKind::City => "default/city",
                };
                if let Some(a) = self.library.get(qid) {
                    symbols.push(SvgSymbol { path: a.path.clone(), pos: st.layout.center, size: (st.layout.radius * 1.1).max(24.0), aspect: a.aspect, pivot: [0.5, 0.6], rotation: 0.0, flip: false });
                }
            }
        }
        let grid = if self.doc.render.grid.kind != isoline_core::project::GridKind::None { Some((self.doc.render.grid.kind == isoline_core::project::GridKind::Hex, self.doc.render.grid.spacing)) } else { None };
        let input = SvgInput {
            width: self.doc.width(),
            height: self.doc.height(),
            theme: &self.doc.render.theme,
            coast: &coast,
            rivers: &rivers,
            lakes: &lakes,
            regions: &regions,
            borders: &self.doc.borders,
            settlements: &self.doc.settlements,
            symbols: &symbols,
            labels: &labels,
            terrain_png: terrain_png.as_deref(),
            grid,
        };
        let text = crate::svg::write(&input);
        std::fs::write(path, text).with_context(|| format!("write {}", path.display()))?;
        let ms = t.elapsed().as_secs_f32() * 1000.0;
        self.cpu.sections.insert("svg export", ms);
        self.ui.status = format!("Exported {} ({} coast lines, {} labels, {} symbols) in {:.1} s", path.display(), coast.len(), labels.len(), symbols.len(), ms / 1000.0);
        log::info!("{}", self.ui.status);
        Ok(())
    }

    /// Render and write one band of the running export.
    fn export_step(&mut self) {
        let Some(mut job) = self.export.take() else { return };
        let layer = job.layer();
        let transparent = layer.transparent(&job.settings);
        let rows = job.band_rows();
        let scale = job.settings.scale.max(0.05);
        let mut flags = FLAG_HYPSO;
        if self.doc.render.show_contours {
            flags |= FLAG_CONTOURS;
        }
        if self.show_water {
            flags |= FLAG_WATER;
        }
        if transparent {
            flags |= FLAG_TRANSPARENT;
        }
        let result: Result<bool> = (|| {
            for (x, w) in job.tiles() {
                let origin = job.tile_origin(x);
                let ss = Vec2::new(w as f32, rows as f32);
                let mut enc = self.gpu.device.create_command_encoder(&wgpu::CommandEncoderDescriptor { label: Some("export tile") });
                if layer.draws_terrain() {
                    let view = self.view_uniform(ss, origin, scale, flags, None);
                    self.map.render(&self.gpu.queue, &mut enc, &job.tile_view, &view, &mut self.profiler);
                } else {
                    let pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("export clear"),
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: &job.tile_view,
                            depth_slice: None,
                            resolve_target: None,
                            ops: wgpu::Operations { load: wgpu::LoadOp::Clear(wgpu::Color::TRANSPARENT), store: wgpu::StoreOp::Store },
                        })],
                        depth_stencil_attachment: None,
                        timestamp_writes: None,
                        occlusion_query_set: None,
                        multiview_mask: None,
                    });
                    drop(pass);
                }
                if layer.draws_symbols() && self.view_mode == ViewMode::Map {
                    self.sprites.render(&self.gpu.queue, &mut enc, &job.tile_view, [job.tile_w as f32, job.band_h as f32], origin.to_array(), scale, self.doc.symbols.shadow);
                }
                if layer.draws_overlay() {
                    let shapes = job.tile_shapes(x, w);
                    let jobs = job.ctx.tessellate(shapes, job.ppp);
                    let screen = egui_wgpu::ScreenDescriptor { size_in_pixels: [job.tile_w, job.band_h], pixels_per_point: job.ppp };
                    job.renderer.update_buffers(&self.gpu.device, &self.gpu.queue, &mut enc, &jobs, &screen);
                    let pass = enc.begin_render_pass(&wgpu::RenderPassDescriptor {
                        label: Some("export overlay"),
                        color_attachments: &[Some(wgpu::RenderPassColorAttachment {
                            view: &job.tile_view,
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
                    job.renderer.render(&mut pass, &jobs, &screen);
                }
                self.gpu.queue.submit([enc.finish()]);
                job.read_tile(&self.gpu.device, &self.gpu.queue, x, w, transparent)?;
            }
            job.finish_band()
        })();
        match result {
            Ok(true) => {
                let ms = job.started.elapsed().as_secs_f32() * 1000.0;
                let paths = job.written_paths();
                self.cpu.sections.insert("export", ms);
                self.ui.status = crate::export::describe(&paths[0], job.width, job.height, ms);
                log::info!("{}", self.ui.status);
                self.instances_dirty = true;
                let svg_after = job.svg_after.take();
                self.export = None;
                if let Some(svg_path) = svg_after {
                    let png = std::fs::read(&paths[0]).ok();
                    let _ = std::fs::remove_file(&paths[0]);
                    if let Err(e) = self.write_svg(&svg_path, png) {
                        self.ui.error = Some(format!("SVG export failed: {e:#}"));
                    }
                }
            }
            Ok(false) => {
                self.ui.status = format!("Exporting… {:.0}%", job.progress() * 100.0);
                self.export = Some(job);
            }
            Err(e) => {
                self.ui.error = Some(format!("Export failed: {e:#}"));
                self.instances_dirty = true;
                self.export = None;
            }
        }
        self.window.request_redraw();
    }

    // ---- frame -----------------------------------------------------------------

    fn build_overlay(&self, ppp: f32) -> Overlay {
        self.build_overlay_for(&self.camera, self.screen_size(), ppp, false)
    }

    /// Everything drawn over the map in screen points for a given camera.
    /// `export` leaves out editing chrome: brush paths, handles, selection
    /// and capitals.
    fn build_overlay_for(&self, camera: &Camera, ss: Vec2, ppp: f32, export: bool) -> Overlay {
        let to = |p: [f32; 2]| {
            let s = camera.field_to_screen(Vec2::from(p), ss) / ppp;
            egui::pos2(s.x, s.y)
        };
        let mut ov = Overlay::default();
        let a = to([0.0, 0.0]);
        let b = to([self.doc.width() as f32, self.doc.height() as f32]);
        ov.map_rect = egui::Rect::from_two_pos(a, b);
        ov.view_rect = if export { None } else { self.ui.map_view_rect };
        ov.title = self.doc.name.clone();
        if self.doc.render.grid.kind != isoline_core::project::GridKind::None && self.view_mode == ViewMode::Map {
            ov.grid = Some((self.doc.render.grid.kind == isoline_core::project::GridKind::Hex, self.doc.render.grid.spacing, a, camera.zoom / ppp));
        }
        ov.show_ornaments = self.doc.render.theme.show_ornaments && self.doc.render.theme.style != ThemeStyle::Modern && self.view_mode == ViewMode::Map;
        ov.sun_azimuth_deg = self.doc.render.sun_azimuth_deg;
        let ink = self.doc.render.theme.ink;
        let paper = self.doc.render.theme.paper;
        ov.ink = egui::Color32::from_rgb((ink[0] * 255.0) as u8, (ink[1] * 255.0) as u8, (ink[2] * 255.0) as u8);
        ov.paper = egui::Color32::from_rgb((paper[0] * 255.0) as u8, (paper[1] * 255.0) as u8, (paper[2] * 255.0) as u8);
        if !export && (self.tools.tool.is_procedural() || self.tools.tool == Tool::Border) && !self.tools.path.is_empty() {
            ov.path = self.tools.path.iter().map(|p| to(*p)).collect();
            ov.path_is_coast = self.tools.tool == Tool::Coast;
        }
        if self.view_mode == ViewMode::Map {
            let editing = !export && matches!(self.tools.tool, Tool::Border | Tool::Territory);
            let modern = self.doc.render.theme.style == ThemeStyle::Modern;
            for b in &self.doc.borders {
                // Grown arcs along the coast are the coastline itself.
                if b.points.len() < 2 || (b.kind == BorderKind::Grown && (b.left == 0 || b.right == 0)) {
                    continue;
                }
                let selected = !export && self.selected_border == Some(b.id);
                let region_sel = !export && self.selected_region.is_some() && (Some(b.left) == self.selected_region || Some(b.right) == self.selected_region);
                ov.borders.push(ui::BorderDraw {
                    points: b.points.iter().map(|p| to(*p)).collect(),
                    style: b.style,
                    selected: selected || region_sel,
                    handles: editing && (selected || camera.zoom > 1.5),
                    color: if modern { egui::Color32::from_rgb(96, 52, 120) } else { egui::Color32::from_rgb(112, 38, 32) },
                });
            }
            // Towns: symbol below TOWN_ICON_ZOOM, streets above; a short crossfade.
            // Judged in points per texel so HiDPI screens and exports match.
            let z = camera.zoom / ppp;
            if z >= TOWN_ICON_ZOOM * 0.8 {
                let alpha = ((z - TOWN_ICON_ZOOM * 0.8) / (TOWN_ICON_ZOOM * 0.4)).clamp(0.0, 1.0);
                let detail = z >= 2.8;
                let town_tool = !export && self.tools.tool == Tool::Settlement;
                let view = egui::Rect::from_min_size(egui::Pos2::ZERO, egui::vec2(ss.x / ppp, ss.y / ppp)).expand(40.0);
                for st in &self.doc.settlements {
                    let c = to(st.layout.center);
                    let rp = st.layout.radius * z;
                    if !view.intersects(egui::Rect::from_center_size(c, egui::vec2(rp * 3.4, rp * 3.4))) {
                        continue;
                    }
                    let l = &st.layout;
                    let selected = town_tool && self.selected_settlement == Some(st.id);
                    let pts = |v: &[[f32; 2]]| v.iter().map(|p| to(*p)).collect::<Vec<_>>();
                    ov.settlements.push(ui::SettlementDraw {
                        center: c,
                        radius_px: rp,
                        alpha,
                        detail,
                        selected,
                        handles: selected && detail,
                        roads: l.roads.iter().map(|r| (pts(&r.points), r.primary)).collect(),
                        buildings: l.buildings.iter().map(|b| (pts(&b.quad), b.district, selected && self.selected_building == Some(b.id))).collect(),
                        walls: l.walls.iter().map(|w| (pts(&w.points), pts(&w.towers), pts(&w.gates))).collect(),
                        plaza: l.plaza.as_ref().map(|p| pts(&p.points)),
                        keep: l.keep.map(|(p, r)| (to(p), r * z)),
                        docks: l.docks.iter().map(|d| [to(d[0]), to(d[1])]).collect(),
                        bridges: l.bridges.iter().map(|d| [to(d[0]), to(d[1])]).collect(),
                        fields: l.fields.iter().map(|f| pts(f)).collect(),
                        cemetery: l.cemetery.map(|q| pts(&q)),
                        scale: z,
                    });
                }
            }
            if editing {
                for r in &self.doc.regions {
                    if !self.doc.borders.iter().any(|b| b.kind == BorderKind::Drawn && b.left == r.id) {
                        ov.capitals.push((to(r.seed), region_color(r.color)));
                    }
                }
            }
        }
        if !export && self.tools.tool == Tool::Place {
            if let Some(id) = self.selected_placement {
                if let Some(p) = self.doc.placements.iter().find(|p| p.id == id) {
                    ov.selected = Some(to(p.pos));
                }
            }
        }
        if !export && self.tools.tool == Tool::WaterEdit {
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
        if self.export.is_some() {
            self.export_step();
        }
        let icons = self.camera.zoom / self.egui_ctx.pixels_per_point() < TOWN_ICON_ZOOM;
        if self.export.is_none() && icons != self.town_icons_visible {
            self.town_icons_visible = icons;
            self.instances_dirty = true;
        }
        if self.instances_dirty || self.instance_key != (self.doc.placements.len(), self.doc.auto_symbols.len()) {
            let t = Instant::now();
            self.rebuild_instances();
            self.cpu.sections.insert("symbol instances", t.elapsed().as_secs_f32() * 1000.0);
        }
        if self.needs_fit {
            self.fit_view();
        }
        if self.doc.regions_dirty {
            self.upload_regions();
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
                    for (qid, x, y, size) in [("default/castle", 0.45, 0.48, 110.0), ("default/ship", 0.15, 0.30, 90.0), ("default/sea_serpent", 0.82, 0.78, 120.0), ("default/ruins", 0.36, 0.72, 80.0)] {
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
                            // A ring of standing stones drawn in ink on white.
                            let r = (dx * dx + dy * dy).sqrt();
                            let ang = dy.atan2(dx);
                            let stone = (r - 30.0).abs() < 6.0 && ((ang * 4.0 / std::f32::consts::PI).rem_euclid(1.0) - 0.5).abs() < 0.22;
                            let centre = r < 5.0;
                            bm.set(x, y, if stone || centre { [42, 31, 20, 255] } else { [255, 255, 255, 255] });
                        }
                    }
                    let f = std::fs::File::create(&png_path).unwrap();
                    let mut enc = png::Encoder::new(std::io::BufWriter::new(f), 96, 96);
                    enc.set_color(png::ColorType::Rgba);
                    enc.set_depth(png::BitDepth::Eight);
                    enc.write_header().unwrap().write_image_data(&bm.rgba).unwrap();
                    self.import_files(vec![png_path]);
                } else if self.demo_stage == 4 && self.symbol_job.is_none() && !self.doc.symbols_stale {
                    self.demo_stage = 5;
                    self.name_everything();
                    // Three capitals grow realms over the cost field.
                    let w = self.doc.width() as f32;
                    let h = self.doc.height() as f32;
                    for (x, y) in [(0.45, 0.48), (0.62, 0.55), (0.70, 0.40)] {
                        let before = self.doc.region_snapshot();
                        let id = self.doc.new_region_id();
                        let color = (self.doc.regions.len() as u32) % REGION_PALETTE.len() as u32;
                        self.doc.regions.push(borders::Region { id, seed: [w * x, h * y], color, entity: None });
                        self.doc.commit_regions("Place capital", before);
                    }
                    self.grow_realms();
                    self.tools.tool = Tool::Territory;
                } else if self.demo_stage == 5 && self.territory_job.is_none() {
                    self.demo_stage = 6;
                    // A hand-drawn border across the south, half natural.
                    let w = self.doc.width() as f32;
                    let h = self.doc.height() as f32;
                    self.tools.border_naturalness = 0.7;
                    let path: Vec<[f32; 2]> = (0..30).map(|i| {
                        let k = i as f32 / 29.0;
                        [w * (0.40 + 0.25 * k), h * (0.62 + 0.06 * (k * 4.0).sin())]
                    }).collect();
                    self.apply_border_stroke(path);
                    self.selected_border = None;
                    // A city and a village with generated layouts.
                    for (x, y, kind, model) in [
                        (0.62, 0.55, SettlementKind::City, settlement::GrowthModel::Organic),
                        (0.70, 0.40, SettlementKind::Village, settlement::GrowthModel::Organic),
                        (0.645, 0.585, SettlementKind::Homestead, settlement::GrowthModel::Organic),
                        (0.665, 0.515, SettlementKind::Hamlet, settlement::GrowthModel::Organic),
                    ] {
                        self.tools.settlement = settlement::SettlementParams { kind, model, ..Default::default() };
                        // Step a little if the spot is water.
                        for k in 0..6 {
                            let n = self.doc.settlements.len();
                            self.place_settlement(Vec2::new(w * (x + 0.012 * k as f32), h * (y - 0.008 * k as f32)));
                            if self.doc.settlements.len() > n {
                                break;
                            }
                        }
                    }
                    self.selected_settlement = None;
                    self.instances_dirty = true;
                    self.tools.tool = Tool::Name;
                    let dir = std::env::temp_dir().join("isoline-demo.isoline");
                    self.save_to(dir);
                } else if self.demo_stage == 3 && (self.library.get("project/isoline_demo_import").is_some() || self.frames_since_install > 400) {
                    self.demo_stage = 4;
                    let w = self.doc.width() as f32;
                    let h = self.doc.height() as f32;
                    let before = self.doc.placements.clone();
                    if let Some(p) = self.make_placement("project/isoline_demo_import", [w * 0.30, h * 0.58], 60.0, PlacementLayer::Manual) {
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
            self.export.as_ref().map(|e| ("Exporting".to_string(), e.progress())),
            self.gen_job.as_ref().map(|j| (j.name.clone(), j.progress01())),
            self.load_job.as_ref().map(|j| (j.name.clone(), 0.5)),
            self.save_job.as_ref().map(|j| (j.name.clone(), 0.5)),
            self.autosave_job.as_ref().map(|j| (j.name.clone(), 0.5)),
            self.derived_job.as_ref().map(|j| (j.name.clone(), j.progress01())),
        ]
        .into_iter()
        .flatten()
        .next();
        {
            let t = Instant::now();
            let ss = self.screen_size();
            let lib = &self.library;
            let placements = &self.doc.placements;
            let symbol_half = |e: &Entity| -> f32 {
                match &e.geometry {
                    EntityRef::Placement { id, .. } => placements.iter().find(|p| p.id == *id).and_then(|p| lib.get(&p.asset).map(|a| p.size / a.aspect.max(0.1) * 0.5)).unwrap_or(0.0),
                    _ => 0.0,
                }
            };
            if self.view_mode == ViewMode::Map {
                let fs = Vec2::new(self.doc.width() as f32, self.doc.height() as f32);
                self.labels.layout(&self.egui_ctx, &self.doc.entities, &self.doc.render.theme, &self.camera, ss, fs, ppp, symbol_half, self.selected_entity);
            } else {
                self.labels.placed.clear();
            }
            self.cpu.sections.insert("labels layout", t.elapsed().as_secs_f32() * 1000.0);
        }
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
                labels: &self.labels,
                cultures: &self.cultures,
                themes: &self.themes.themes,
                selected_entity: self.selected_entity,
                selected_border: self.selected_border,
                selected_region: self.selected_region,
                realms_running: self.territory_job.is_some(),
                selected_settlement: self.selected_settlement,
                selected_building: self.selected_building,
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
        let mut flags = FLAG_HYPSO;
        if self.doc.render.show_contours {
            flags |= FLAG_CONTOURS;
        }
        if self.show_water {
            flags |= FLAG_WATER;
        }
        let egui_over = self.egui_ctx.is_pointer_over_egui();
        let show_cursor = (self.tools.tool.is_dab_brush() || self.tools.tool.is_procedural()) && self.input.cursor.is_some() && !egui_over && !self.input.panning;
        if show_cursor {
            flags |= FLAG_CURSOR;
        }
        let view = self.view_uniform(ss, origin, self.camera.zoom, flags, cursor_field);
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
        let ready = self.frames_since_install >= 20
            && self.gen_job.is_none()
            && self.load_job.is_none()
            && self.derived_job.is_none()
            && self.symbol_job.is_none()
            && !self.doc.symbols_stale
            && !self.doc.derived_stale
            && self.doc.derived.is_some()
            && (!self.demo || self.demo_stage >= 6)
            && self.territory_job.is_none()
            && self.save_job.is_none();
        if ready && self.export.is_none() {
            if let Some((path, scale)) = self.startup_export.take() {
                let separate_layers = std::env::var("ISOLINE_EXPORT_LAYERS").is_ok();
                let transparent = std::env::var("ISOLINE_EXPORT_TRANSPARENT").is_ok();
                let jpeg = path.extension().map(|e| e.eq_ignore_ascii_case("jpg") || e.eq_ignore_ascii_case("jpeg")).unwrap_or(false);
                let svg = path.extension().map(|e| e.eq_ignore_ascii_case("svg")).unwrap_or(false);
                if svg {
                    self.export_svg(path);
                } else {
                    self.start_export(ExportSettings { scale, separate_layers, transparent, jpeg, ..Default::default() }, path);
                }
                self.exit_after_export = true;
                self.window.request_redraw();
            } else if self.exit_after_export && self.screenshot.is_none() {
                event_loop.exit();
            }
        }
        let take_shot = self.screenshot.is_some()
            && self.frames_since_install >= 20
            && self.gen_job.is_none()
            && self.load_job.is_none()
            && self.derived_job.is_none()
            && self.symbol_job.is_none()
            && !self.doc.symbols_stale
            && !self.doc.derived_stale
            && self.doc.derived.is_some()
            && (!self.demo || self.demo_stage >= 6)
            && self.territory_job.is_none()
            && self.save_job.is_none();
        if take_shot {
            let path = self.screenshot.take().unwrap();
            let mut keys: Vec<_> = self.cpu.sections.keys().copied().collect();
            keys.sort();
            let parts: Vec<String> = keys.iter().map(|k| format!("{k} {:.1}", self.cpu.sections[k])).collect();
            log::info!("perf: frame avg {:.1} ms; {}", self.cpu.avg_frame_ms(), parts.join(", "));
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
