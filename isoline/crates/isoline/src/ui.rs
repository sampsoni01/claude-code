//! egui panels drawn over the map viewport.

use crate::camera::Camera;
use crate::document::Document;
use crate::gpu::field::ReadbackStats;
use crate::gpu::map_render::ViewMode;
use crate::gpu::profiler::CpuStats;
use crate::library::Library;
use crate::labels::LabelEngine;
use isoline_core::entity::{Entity, EntityKind};
use isoline_core::names::Culture;
use crate::tools::{MoistureMode, Tool, ToolState};
use isoline_core::theme::ForestStyle as FS;
use glam::Vec2;
use isoline_core::biome::{Biome, MOIST_BINS, MOIST_BIN_LABELS, TEMP_BINS, TEMP_BIN_LABELS};
use isoline_core::brush::Falloff;
use isoline_core::procedural::{CoastPreset, LandSide};
use isoline_core::project::Manifest;
use isoline_core::terrain::{TerrainParams, TerrainPreset};
use isoline_core::theme::{ForestStyle, ReliefStyle, Theme, ThemeStyle};
use isoline_core::water::RecomputeMode;
use std::collections::HashMap;
use std::path::PathBuf;

pub const SIZES: [u32; 6] = [512, 1024, 2048, 4096, 6144, 8192];

#[derive(Clone, Debug)]
pub struct NewProjectParams {
    pub name: String,
    pub size: u32,
    pub terrain: TerrainParams,
}

impl Default for NewProjectParams {
    fn default() -> Self {
        Self { name: "Untitled".into(), size: 2048, terrain: TerrainParams::default() }
    }
}

#[derive(Clone, Debug)]
pub struct RecoveryPrompt {
    pub autosave_dir: PathBuf,
    pub manifest: Manifest,
    pub project_dir: Option<PathBuf>,
}

/// A selected vertex in baked water geometry.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WaterSel {
    River { river: usize, vertex: usize },
    Lake { lake: usize, vertex: usize },
}

/// Screen-space (egui points) geometry drawn over the map.
pub struct Overlay {
    pub path: Vec<egui::Pos2>,
    pub path_is_coast: bool,
    pub rivers: Vec<Vec<egui::Pos2>>,
    pub lakes: Vec<Vec<egui::Pos2>>,
    pub selected: Option<egui::Pos2>,
    pub map_rect: egui::Rect,
    pub title: String,
    pub show_ornaments: bool,
    pub sun_azimuth_deg: f32,
    pub ink: egui::Color32,
    pub paper: egui::Color32,
}

impl Default for Overlay {
    fn default() -> Self {
        Self {
            path: Vec::new(),
            path_is_coast: false,
            rivers: Vec::new(),
            lakes: Vec::new(),
            selected: None,
            map_rect: egui::Rect::NOTHING,
            title: String::new(),
            show_ornaments: false,
            sun_azimuth_deg: 315.0,
            ink: egui::Color32::BLACK,
            paper: egui::Color32::WHITE,
        }
    }
}

pub const SERIF: &str = "serif";
pub const SERIF_ITALIC: &str = "serif-italic";

pub fn serif(size: f32) -> egui::FontId {
    egui::FontId::new(size, egui::FontFamily::Name(SERIF.into()))
}
pub fn serif_italic(size: f32) -> egui::FontId {
    egui::FontId::new(size, egui::FontFamily::Name(SERIF_ITALIC.into()))
}

/// Register the embedded serif faces (Liberation Serif, SIL OFL).
pub fn install_fonts(ctx: &egui::Context) {
    let mut fonts = egui::FontDefinitions::default();
    fonts.font_data.insert("LiberationSerif".into(), std::sync::Arc::new(egui::FontData::from_static(include_bytes!("../assets/fonts/LiberationSerif-Regular.ttf"))));
    fonts.font_data.insert("LiberationSerifItalic".into(), std::sync::Arc::new(egui::FontData::from_static(include_bytes!("../assets/fonts/LiberationSerif-Italic.ttf"))));
    fonts.font_data.insert("LiberationSerifBold".into(), std::sync::Arc::new(egui::FontData::from_static(include_bytes!("../assets/fonts/LiberationSerif-Bold.ttf"))));
    fonts.families.insert(egui::FontFamily::Name(SERIF.into()), vec!["LiberationSerifBold".into(), "LiberationSerif".into()]);
    fonts.families.insert(egui::FontFamily::Name(SERIF_ITALIC.into()), vec!["LiberationSerifItalic".into()]);
    ctx.set_fonts(fonts);
}

/// Warm "map room" chrome.
pub fn apply_style(ctx: &egui::Context) {
    use egui::{Color32, CornerRadius, Stroke};
    let mut v = egui::Visuals::dark();
    let panel = Color32::from_rgb(41, 34, 28);
    let raised = Color32::from_rgb(58, 48, 39);
    let hover = Color32::from_rgb(78, 64, 50);
    let active = Color32::from_rgb(112, 88, 58);
    let text = Color32::from_rgb(226, 212, 186);
    let gold = Color32::from_rgb(206, 166, 92);
    v.panel_fill = panel;
    v.window_fill = Color32::from_rgb(47, 39, 32);
    v.extreme_bg_color = Color32::from_rgb(28, 23, 19);
    v.faint_bg_color = Color32::from_rgb(50, 42, 35);
    v.code_bg_color = Color32::from_rgb(30, 25, 21);
    v.override_text_color = Some(text);
    v.window_stroke = Stroke::new(1.0, gold.gamma_multiply(0.5));
    v.window_corner_radius = CornerRadius::same(10);
    v.menu_corner_radius = CornerRadius::same(8);
    v.selection.bg_fill = active;
    v.selection.stroke = Stroke::new(1.0, gold);
    v.hyperlink_color = gold;
    v.warn_fg_color = Color32::from_rgb(230, 170, 80);
    v.widgets.noninteractive.bg_fill = panel;
    v.widgets.noninteractive.weak_bg_fill = panel;
    v.widgets.noninteractive.bg_stroke = Stroke::new(1.0, Color32::from_rgb(70, 58, 46));
    v.widgets.noninteractive.fg_stroke = Stroke::new(1.0, text);
    v.widgets.inactive.bg_fill = raised;
    v.widgets.inactive.weak_bg_fill = raised;
    v.widgets.inactive.fg_stroke = Stroke::new(1.0, text);
    v.widgets.hovered.bg_fill = hover;
    v.widgets.hovered.weak_bg_fill = hover;
    v.widgets.hovered.bg_stroke = Stroke::new(1.0, gold);
    v.widgets.hovered.fg_stroke = Stroke::new(1.5, Color32::from_rgb(245, 232, 205));
    v.widgets.active.bg_fill = active;
    v.widgets.active.weak_bg_fill = active;
    v.widgets.active.bg_stroke = Stroke::new(1.0, gold);
    v.widgets.open.bg_fill = hover;
    v.widgets.open.weak_bg_fill = hover;
    for w in [&mut v.widgets.noninteractive, &mut v.widgets.inactive, &mut v.widgets.hovered, &mut v.widgets.active, &mut v.widgets.open] {
        w.corner_radius = CornerRadius::same(6);
    }
    ctx.set_visuals(v);
    ctx.all_styles_mut(|style| {
        style.spacing.item_spacing = egui::vec2(8.0, 6.0);
        style.spacing.slider_width = 130.0;
        style.spacing.button_padding = egui::vec2(8.0, 4.0);
        style.text_styles.insert(egui::TextStyle::Heading, serif(19.0));
    });
}

#[derive(Clone, Debug)]
#[allow(clippy::large_enum_variant)]
pub enum UiAction {
    New(NewProjectParams),
    Open,
    Save,
    SaveAs,
    Undo,
    Redo,
    Quit,
    FitView,
    Recover(RecoveryPrompt),
    DiscardRecovery,
    SeaLevelCommit { from: f32, to: f32 },
    SettingsChanged,
    ViewMode(ViewMode),
    ShowWater(bool),
    RecomputeWater,
    BakeWater,
    UnbakeWater,
    ReapplyLastStroke,
    DeleteSelectedWater,
    SelectTool(Tool),
    SelectAsset { qid: String, additive: bool },
    ToggleFavorite(String),
    ImportImages,
    AddPackDir,
    RemovePackDir(PathBuf),
    SymbolsChanged,
    DeleteSelectedPlacement,
    NameEverything,
    ClearAutoNames,
    ExportGazetteer { json: bool },
    /// The inspector changed an entity in place; `before` is the list before the edit.
    EntityEdit { before: Vec<Entity> },
    EntityGenerateName(u64),
    DeleteEntity(u64),
    SelectEntity(Option<u64>),
}

#[derive(Default)]
pub struct UiState {
    pub show_profiler: bool,
    pub show_new: bool,
    pub show_about: bool,
    pub show_biome_matrix: bool,
    pub new_params: NewProjectParams,
    pub recovery: Option<RecoveryPrompt>,
    pub status: String,
    pub error: Option<String>,
    pub sea_drag_start: Option<f32>,
    pub asset_query: String,
    pub asset_category: Option<String>,
    pub asset_favorites_only: bool,
    pub show_packs: bool,
    pub show_typography: bool,
    /// Snapshot taken when an inspector edit starts, committed on release.
    pub entity_edit_before: Option<Vec<Entity>>,
}

pub struct UiContext<'a> {
    pub doc: &'a mut Document,
    pub tools: &'a mut ToolState,
    pub camera: &'a Camera,
    pub cpu: &'a CpuStats,
    pub gpu_ms: &'a HashMap<String, f32>,
    pub gpu_name: &'a str,
    pub gpu_backend: &'a str,
    pub timestamps_supported: bool,
    pub device_bytes: u64,
    pub allocated_bytes: Option<u64>,
    pub readback: ReadbackStats,
    pub brush_dispatches: u32,
    pub brush_texels: u64,
    pub brush_dabs: u32,
    pub cursor_field: Option<Vec2>,
    pub job: Option<(String, f32)>,
    pub max_field_dim: u32,
    pub view_mode: ViewMode,
    pub show_water: bool,
    pub derived_running: Option<f32>,
    pub derived_device_bytes: u64,
    pub derived_upload_tiles: u32,
    pub has_last_procedural: Option<Tool>,
    pub water_selected: Option<WaterSel>,
    pub overlay: Overlay,
    pub library: &'a Library,
    pub atlas_tex: Option<egui::TextureId>,
    pub symbols_running: bool,
    pub selected_placement: Option<u64>,
    pub sprite_count: u32,
    pub labels: &'a LabelEngine,
    pub cultures: &'a [Culture],
    pub selected_entity: Option<u64>,
}

fn fmt_bytes(b: u64) -> String {
    if b >= 1 << 30 {
        format!("{:.2} GiB", b as f64 / (1u64 << 30) as f64)
    } else if b >= 1 << 20 {
        format!("{:.1} MiB", b as f64 / (1u64 << 20) as f64)
    } else {
        format!("{:.0} KiB", b as f64 / 1024.0)
    }
}

fn draw_ornaments(painter: &egui::Painter, ov: &Overlay) {
    let r = ov.map_rect;
    if r.width() < 200.0 || r.height() < 200.0 {
        return;
    }
    let ink = ov.ink;
    let paper = ov.paper;
    // Compass rose, top right.
    let size = (r.width().min(r.height()) * 0.07).clamp(36.0, 90.0);
    let c = egui::pos2(r.right() - size * 1.2, r.top() + size * 1.2);
    painter.circle(c, size * 0.98, paper.gamma_multiply(0.85), egui::Stroke::new(1.5, ink));
    painter.circle_stroke(c, size * 0.86, egui::Stroke::new(0.8, ink));
    for i in 0..16 {
        let a = i as f32 / 16.0 * std::f32::consts::TAU;
        let (sa, ca) = a.sin_cos();
        let (lo, hi) = if i % 4 == 0 { (0.55, 0.86) } else if i % 2 == 0 { (0.72, 0.86) } else { (0.80, 0.86) };
        painter.line_segment([c + egui::vec2(sa, -ca) * size * lo, c + egui::vec2(sa, -ca) * size * hi], egui::Stroke::new(if i % 4 == 0 { 1.4 } else { 0.7 }, ink));
    }
    // Eight-point star: long north/south/east/west points and short diagonals.
    for (k, len) in [(0.0f32, 0.92f32), (0.125, 0.5), (0.25, 0.92), (0.375, 0.5), (0.5, 0.92), (0.625, 0.5), (0.75, 0.92), (0.875, 0.5)] {
        let a = k * std::f32::consts::TAU;
        let tip = c + egui::vec2(a.sin(), -a.cos()) * size * len;
        let w = size * 0.11;
        let l = c + egui::vec2((a - std::f32::consts::FRAC_PI_2).sin(), -(a - std::f32::consts::FRAC_PI_2).cos()) * w;
        let rr = c + egui::vec2((a + std::f32::consts::FRAC_PI_2).sin(), -(a + std::f32::consts::FRAC_PI_2).cos()) * w;
        painter.add(egui::Shape::convex_polygon(vec![tip, l, c], ink, egui::Stroke::new(0.8, ink)));
        painter.add(egui::Shape::convex_polygon(vec![tip, c, rr], paper, egui::Stroke::new(0.8, ink)));
    }
    painter.text(c + egui::vec2(0.0, -size * 1.08), egui::Align2::CENTER_BOTTOM, "N", serif(size * 0.36), ink);
    // Title cartouche, bottom left.
    if !ov.title.is_empty() {
        let font = serif_italic((size * 0.55).clamp(16.0, 34.0));
        let galley = painter.layout_no_wrap(ov.title.clone(), font.clone(), ink);
        let pad = egui::vec2(size * 0.45, size * 0.3);
        let tl = egui::pos2(r.left() + size * 0.6, r.bottom() - size * 0.6 - galley.size().y - pad.y * 2.0);
        let rect = egui::Rect::from_min_size(tl, galley.size() + pad * 2.0);
        painter.rect(rect, egui::CornerRadius::same(4), paper.gamma_multiply(0.9), egui::Stroke::new(1.6, ink), egui::StrokeKind::Outside);
        painter.rect_stroke(rect.shrink(4.0), egui::CornerRadius::same(2), egui::Stroke::new(0.7, ink), egui::StrokeKind::Inside);
        // Corner flourishes.
        for (cx, cy) in [(rect.left(), rect.top()), (rect.right(), rect.top()), (rect.left(), rect.bottom()), (rect.right(), rect.bottom())] {
            painter.circle_filled(egui::pos2(cx, cy), 3.2, ink);
            painter.circle_filled(egui::pos2(cx, cy), 1.6, paper);
        }
        painter.galley(rect.min + pad, galley, ink);
    }
}

fn draw_overlay(ctx: &egui::Context, ov: &Overlay) {
    let painter = ctx.layer_painter(egui::LayerId::background());
    if ov.show_ornaments {
        draw_ornaments(&painter, ov);
    }
    if ov.path.len() >= 2 {
        let col = if ov.path_is_coast { egui::Color32::from_rgb(90, 200, 255) } else { egui::Color32::from_rgb(255, 190, 80) };
        painter.add(egui::Shape::line(ov.path.clone(), egui::Stroke::new(2.0, col)));
        painter.circle_filled(ov.path[0], 4.0, col);
    }
    for r in &ov.rivers {
        if r.len() >= 2 {
            painter.add(egui::Shape::line(r.clone(), egui::Stroke::new(1.0, egui::Color32::from_rgba_unmultiplied(40, 120, 255, 200))));
        }
    }
    for l in &ov.lakes {
        if l.len() >= 3 {
            painter.add(egui::Shape::closed_line(l.clone(), egui::Stroke::new(1.0, egui::Color32::from_rgba_unmultiplied(80, 200, 255, 220))));
        }
    }
    if let Some(p) = ov.selected {
        painter.circle_stroke(p, 6.0, egui::Stroke::new(2.0, egui::Color32::YELLOW));
    }
}

/// A 44×44 icon button with a drawn glyph per tool.
fn tool_button(ui: &mut egui::Ui, tool: Tool, selected: bool, enabled: bool) -> egui::Response {
    let size = egui::vec2(46.0, 46.0);
    let (rect, resp) = ui.allocate_exact_size(size, if enabled { egui::Sense::click() } else { egui::Sense::hover() });
    let resp = resp.on_hover_text(format!("{}  ({})", tool.label(), tool.hotkey()));
    let v = ui.visuals();
    let fill = if selected {
        v.selection.bg_fill
    } else if resp.hovered() && enabled {
        v.widgets.hovered.bg_fill
    } else {
        v.widgets.inactive.bg_fill
    };
    let stroke = if selected { v.selection.stroke } else { egui::Stroke::new(1.0, egui::Color32::from_rgb(70, 58, 46)) };
    let p = ui.painter();
    p.rect(rect, egui::CornerRadius::same(8), fill, stroke, egui::StrokeKind::Inside);
    let ink = if enabled { egui::Color32::from_rgb(232, 214, 176) } else { egui::Color32::from_rgb(110, 96, 80) };
    let blue = if enabled { egui::Color32::from_rgb(120, 180, 230) } else { ink };
    let s = egui::Stroke::new(1.8, ink);
    let c = rect.center();
    let u = rect.width() / 2.0;
    let pt = |x: f32, y: f32| egui::pos2(c.x + x * u, c.y + y * u);
    match tool {
        Tool::Raise => {
            p.add(egui::Shape::closed_line(vec![pt(-0.7, 0.45), pt(-0.15, -0.35), pt(0.2, 0.05), pt(0.45, -0.2), pt(0.75, 0.45)], s));
            p.line_segment([pt(0.0, -0.75), pt(0.0, -0.45)], s);
            p.line_segment([pt(-0.15, -0.6), pt(0.0, -0.78)], s);
            p.line_segment([pt(0.15, -0.6), pt(0.0, -0.78)], s);
        }
        Tool::Lower => {
            p.add(egui::Shape::closed_line(vec![pt(-0.7, -0.1), pt(-0.3, 0.35), pt(0.1, 0.0), pt(0.4, 0.4), pt(0.75, -0.1)], s));
            p.line_segment([pt(0.0, -0.75), pt(0.0, -0.4)], s);
            p.line_segment([pt(-0.15, -0.55), pt(0.0, -0.38)], s);
            p.line_segment([pt(0.15, -0.55), pt(0.0, -0.38)], s);
        }
        Tool::Smooth => {
            let pts: Vec<_> = (0..=20).map(|i| { let x = -0.75 + 1.5 * i as f32 / 20.0; pt(x, (x * 6.0).sin() * 0.25) }).collect();
            p.add(egui::Shape::line(pts, s));
            let pts: Vec<_> = (0..=20).map(|i| { let x = -0.75 + 1.5 * i as f32 / 20.0; pt(x, 0.5 + (x * 6.0).sin() * 0.06) }).collect();
            p.add(egui::Shape::line(pts, s));
        }
        Tool::Flatten => {
            p.add(egui::Shape::line(vec![pt(-0.75, 0.3), pt(-0.35, -0.3), pt(0.35, -0.3), pt(0.75, 0.3)], s));
            p.line_segment([pt(-0.45, -0.3), pt(0.45, -0.3)], egui::Stroke::new(3.0, ink));
        }
        Tool::Ridge => {
            p.add(egui::Shape::line(vec![pt(-0.8, 0.5), pt(-0.45, -0.3), pt(-0.2, 0.1), pt(0.05, -0.6), pt(0.3, 0.0), pt(0.55, -0.35), pt(0.8, 0.5)], s));
            p.add(egui::Shape::line(vec![pt(-0.45, -0.3), pt(-0.55, -0.05)], egui::Stroke::new(1.0, ink)));
            p.add(egui::Shape::line(vec![pt(0.05, -0.6), pt(-0.1, -0.2)], egui::Stroke::new(1.0, ink)));
        }
        Tool::Coast => {
            let pts: Vec<_> = (0..=24).map(|i| { let t = i as f32 / 24.0; pt(-0.75 + 1.5 * t, -0.1 + (t * 12.0).sin() * 0.16 + (t * 5.0).cos() * 0.12) }).collect();
            p.add(egui::Shape::line(pts, s));
            for (x, y) in [(-0.4, 0.45), (0.1, 0.5), (0.5, 0.4)] {
                p.circle_filled(pt(x, y), 2.0, blue);
            }
            let pts: Vec<_> = (0..=10).map(|i| { let t = i as f32 / 10.0; pt(-0.7 + 1.4 * t, 0.7 + (t * 9.0).sin() * 0.06) }).collect();
            p.add(egui::Shape::line(pts, egui::Stroke::new(1.0, blue)));
        }
        Tool::Moisture => {
            let drop: Vec<_> = (0..=24).map(|i| {
                let a = i as f32 / 24.0 * std::f32::consts::TAU;
                let r = 0.42 * (1.0 - 0.35 * a.cos().max(0.0));
                pt(a.sin() * r, 0.15 - a.cos() * r * 1.3)
            }).collect();
            p.add(egui::Shape::closed_line(drop, egui::Stroke::new(1.8, blue)));
        }
        Tool::WaterEdit => {
            p.add(egui::Shape::line(vec![pt(-0.7, 0.6), pt(-0.3, 0.1), pt(0.1, 0.2), pt(0.6, -0.6)], egui::Stroke::new(1.8, blue)));
            for (x, y) in [(-0.3, 0.1), (0.1, 0.2)] {
                p.rect_filled(egui::Rect::from_center_size(pt(x, y), egui::vec2(6.0, 6.0)), 1.0, ink);
            }
        }
        Tool::Place => {
            // A map pin.
            let head: Vec<_> = (0..=16).map(|i| { let a = i as f32 / 16.0 * std::f32::consts::TAU; pt(a.cos() * 0.35, -0.25 + a.sin() * 0.35) }).collect();
            p.add(egui::Shape::closed_line(head, s));
            p.add(egui::Shape::line(vec![pt(-0.3, -0.05), pt(0.0, 0.7), pt(0.3, -0.05)], s));
            p.circle_filled(pt(0.0, -0.25), 3.0, ink);
        }
        Tool::Scatter => {
            for (x, y, r) in [(-0.45, -0.4, 3.0), (0.2, -0.5, 2.2), (0.5, 0.0, 3.4), (-0.15, 0.1, 2.6), (-0.55, 0.5, 2.4), (0.3, 0.55, 3.0)] {
                p.circle_filled(pt(x, y), r, ink);
            }
            p.circle_stroke(c, u * 0.8, egui::Stroke::new(1.0, ink.gamma_multiply(0.5)));
        }
        Tool::Name => {
            p.text(c, egui::Align2::CENTER_CENTER, "Aa", serif_italic(u * 1.1), ink);
            p.line_segment([pt(-0.6, 0.55), pt(0.6, 0.55)], egui::Stroke::new(1.2, ink));
        }
        Tool::Pan => {
            for (dx, dy) in [(0.0f32, -1.0f32), (0.0, 1.0), (-1.0, 0.0), (1.0, 0.0)] {
                p.line_segment([pt(dx * 0.2, dy * 0.2), pt(dx * 0.7, dy * 0.7)], s);
                let tip = pt(dx * 0.75, dy * 0.75);
                let (px, py) = (-dy, dx);
                p.add(egui::Shape::convex_polygon(vec![tip, pt(dx * 0.5 + px * 0.18, dy * 0.5 + py * 0.18), pt(dx * 0.5 - px * 0.18, dy * 0.5 - py * 0.18)], ink, egui::Stroke::NONE));
            }
        }
    }
    resp
}

fn brush_sliders(ui: &mut egui::Ui, b: &mut isoline_core::brush::BrushSettings, show_amount: bool, amount_label: &str, amount_max: f32) {
    ui.add(egui::Slider::new(&mut b.radius, 1.0..=1024.0).logarithmic(true).text("Radius (texels)"));
    ui.add(egui::Slider::new(&mut b.strength, 0.0..=1.0).text("Strength"));
    if show_amount {
        ui.add(egui::Slider::new(&mut b.amount, 0.001f32.max(amount_max / 500.0)..=amount_max).logarithmic(true).text(amount_label));
    }
    ui.add(egui::Slider::new(&mut b.hardness, 0.0..=1.0).text("Hardness"));
    egui::ComboBox::from_label("Falloff").selected_text(b.falloff.label()).show_ui(ui, |ui| {
        for f in Falloff::ALL {
            ui.selectable_value(&mut b.falloff, f, f.label());
        }
    });
    ui.add(egui::Slider::new(&mut b.spacing, 0.02..=1.0).text("Spacing"));
    ui.add(egui::Slider::new(&mut b.smoothing, 0.0..=0.95).text("Stroke smoothing"));
    ui.add(egui::Slider::new(&mut b.scatter, 0.0..=2.0).text("Scatter"));
    ui.add(egui::Slider::new(&mut b.velocity_influence, 0.0..=1.0).text("Velocity fade"));
    ui.checkbox(&mut b.pressure_strength, "Pressure → strength");
    ui.checkbox(&mut b.pressure_size, "Pressure → size");
}

pub fn draw(root: &mut egui::Ui, st: &mut UiState, c: UiContext) -> Vec<UiAction> {
    let mut actions = Vec::new();
    let ctx = root.ctx().clone();
    let ctx = &ctx;
    draw_overlay(ctx, &c.overlay);
    {
        let painter = ctx.layer_painter(egui::LayerId::background());
        c.labels.draw(&painter, c.overlay.paper, c.selected_entity);
    }

    egui::Panel::top("menu").show(root, |ui| {
        egui::MenuBar::new().ui(ui, |ui| {
            ui.menu_button("File", |ui| {
                if ui.button("New…            Ctrl+N").clicked() {
                    st.show_new = true;
                    ui.close();
                }
                if ui.button("Open…           Ctrl+O").clicked() {
                    actions.push(UiAction::Open);
                    ui.close();
                }
                ui.separator();
                if ui.button("Save             Ctrl+S").clicked() {
                    actions.push(UiAction::Save);
                    ui.close();
                }
                if ui.button("Save As…").clicked() {
                    actions.push(UiAction::SaveAs);
                    ui.close();
                }
                ui.separator();
                if ui.button("Export gazetteer (CSV)…").clicked() {
                    actions.push(UiAction::ExportGazetteer { json: false });
                    ui.close();
                }
                if ui.button("Export gazetteer (JSON)…").clicked() {
                    actions.push(UiAction::ExportGazetteer { json: true });
                    ui.close();
                }
                ui.separator();
                if ui.button("Quit").clicked() {
                    actions.push(UiAction::Quit);
                    ui.close();
                }
            });
            ui.menu_button("Edit", |ui| {
                let undo_label = c.doc.undo.undo_label().map(|l| format!("Undo {l}")).unwrap_or("Undo".into());
                if ui.add_enabled(c.doc.undo.can_undo(), egui::Button::new(format!("{undo_label}    Ctrl+Z"))).clicked() {
                    actions.push(UiAction::Undo);
                    ui.close();
                }
                let redo_label = c.doc.undo.redo_label().map(|l| format!("Redo {l}")).unwrap_or("Redo".into());
                if ui.add_enabled(c.doc.undo.can_redo(), egui::Button::new(format!("{redo_label}    Ctrl+Shift+Z"))).clicked() {
                    actions.push(UiAction::Redo);
                    ui.close();
                }
            });
            ui.menu_button("Water", |ui| {
                if ui.button("Recompute water      Ctrl+R").clicked() {
                    actions.push(UiAction::RecomputeWater);
                    ui.close();
                }
                if c.doc.baked.is_none() {
                    if ui.add_enabled(c.doc.derived.is_some(), egui::Button::new("Bake water")).clicked() {
                        actions.push(UiAction::BakeWater);
                        ui.close();
                    }
                } else if ui.button("Unbake water").clicked() {
                    actions.push(UiAction::UnbakeWater);
                    ui.close();
                }
            });
            ui.menu_button("View", |ui| {
                if ui.button("Fit map          Home").clicked() {
                    actions.push(UiAction::FitView);
                    ui.close();
                }
                ui.checkbox(&mut c.doc.render.show_contours, "Contours");
                ui.checkbox(&mut st.show_profiler, "Profiler          F3");
                ui.checkbox(&mut st.show_biome_matrix, "Biome matrix…");
            });
            ui.menu_button("Help", |ui| {
                if ui.button("About Isoline").clicked() {
                    st.show_about = true;
                    ui.close();
                }
            });
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                let title = format!("{}{}", c.doc.name, if c.doc.modified { " •" } else { "" });
                ui.label(egui::RichText::new(title).strong());
            });
        });
    });

    egui::Panel::left("tools").default_size(262.0).show(root, |ui| {
        egui::ScrollArea::vertical().show(ui, |ui| {
            ui.add_space(4.0);
            ui.heading("Tools");
            egui::Grid::new("tool_grid").spacing(egui::vec2(6.0, 6.0)).show(ui, |ui| {
                for (i, t) in Tool::ALL.iter().enumerate() {
                    let enabled = !t.needs_baked_water() || c.doc.baked.is_some();
                    if tool_button(ui, *t, c.tools.tool == *t, enabled).clicked() {
                        actions.push(UiAction::SelectTool(*t));
                    }
                    if i % 4 == 3 {
                        ui.end_row();
                    }
                }
            });
            ui.separator();
            match c.tools.tool {
                Tool::Raise | Tool::Lower | Tool::Smooth | Tool::Flatten => {
                    ui.heading("Brush");
                    let show_amount = matches!(c.tools.tool, Tool::Raise | Tool::Lower);
                    brush_sliders(ui, &mut c.tools.brush, show_amount, "Metres per dab", 500.0);
                }
                Tool::Moisture => {
                    ui.heading("Moisture brush");
                    ui.small("Paints the baked moisture field; biomes follow.");
                    ui.horizontal(|ui| {
                        ui.selectable_value(&mut c.tools.moisture_mode, MoistureMode::Wetter, "Wetter");
                        ui.selectable_value(&mut c.tools.moisture_mode, MoistureMode::Drier, "Drier");
                        ui.selectable_value(&mut c.tools.moisture_mode, MoistureMode::Smooth, "Smooth");
                    });
                    let show_amount = c.tools.moisture_mode != MoistureMode::Smooth;
                    brush_sliders(ui, &mut c.tools.moisture_brush, show_amount, "Moisture per dab", 0.5);
                }
                Tool::Ridge => {
                    ui.heading("Ridge brush");
                    ui.small("Drag a spine. Release to build the range. Changing a parameter re-applies the last stroke.");
                    let r = &mut c.tools.ridge;
                    let mut ch = false;
                    ch |= ui.add(egui::Slider::new(&mut r.width, 4.0..=600.0).logarithmic(true).text("Half-width (texels)")).drag_stopped();
                    ch |= ui.add(egui::Slider::new(&mut r.height, 50.0..=6000.0).logarithmic(true).suffix(" m").text("Height")).drag_stopped();
                    ch |= ui.add(egui::Slider::new(&mut r.roughness, 0.0..=1.0).text("Roughness")).drag_stopped();
                    ch |= ui.add(egui::Slider::new(&mut r.sharpness, 0.0..=1.0).text("Sharpness")).drag_stopped();
                    ch |= ui.add(egui::Slider::new(&mut r.asymmetry, -1.0..=1.0).text("Asymmetry")).drag_stopped();
                    ch |= ui.add(egui::Slider::new(&mut r.spur_frequency, 0.0..=1.0).text("Spur frequency")).drag_stopped();
                    ch |= ui.add(egui::Slider::new(&mut r.weathering, 0.0..=1.0).text("Weathering age")).drag_stopped();
                    let mut seed = r.seed as i64;
                    if ui.add(egui::DragValue::new(&mut seed).prefix("Seed ")).drag_stopped() {
                        ch = true;
                    }
                    r.seed = seed.max(0) as u64;
                    if ch && c.has_last_procedural == Some(Tool::Ridge) {
                        actions.push(UiAction::ReapplyLastStroke);
                    }
                }
                Tool::Coast => {
                    ui.heading("Coastline brush");
                    ui.small("Drag a rough control line. Land lies to the chosen side of the stroke direction.");
                    let cp = &mut c.tools.coast;
                    let mut ch = false;
                    let mut preset = cp.preset;
                    egui::ComboBox::from_label("Character").selected_text(preset.label()).show_ui(ui, |ui| {
                        for p in CoastPreset::ALL {
                            ui.selectable_value(&mut preset, p, p.label());
                        }
                    });
                    if preset != cp.preset {
                        *cp = cp.with_preset(preset);
                        ch = true;
                    }
                    ui.horizontal(|ui| {
                        ui.label("Land side");
                        ch |= ui.selectable_value(&mut cp.land_side, LandSide::Left, "Left").changed();
                        ch |= ui.selectable_value(&mut cp.land_side, LandSide::Right, "Right").changed();
                    });
                    let mut tweak = false;
                    tweak |= ui.add(egui::Slider::new(&mut cp.band, 8.0..=800.0).logarithmic(true).text("Band (texels)")).drag_stopped();
                    tweak |= ui.add(egui::Slider::new(&mut cp.roughness, 0.0..=1.0).text("Roughness")).drag_stopped();
                    let mut oct = cp.octaves as i32;
                    if ui.add(egui::Slider::new(&mut oct, 1..=8).text("Octaves")).drag_stopped() {
                        tweak = true;
                    }
                    cp.octaves = oct as u32;
                    tweak |= ui.add(egui::Slider::new(&mut cp.inlet_frequency, 0.0..=1.0).text("Inlet frequency")).drag_stopped();
                    tweak |= ui.add(egui::Slider::new(&mut cp.inlet_depth, 0.0..=2.5).text("Inlet depth")).drag_stopped();
                    tweak |= ui.add(egui::Slider::new(&mut cp.headland_bias, -1.0..=1.0).text("Bays ↔ headlands")).drag_stopped();
                    tweak |= ui.add(egui::Slider::new(&mut cp.island_density, 0.0..=1.0).text("Islands")).drag_stopped();
                    tweak |= ui.add(egui::Slider::new(&mut cp.skerry_density, 0.0..=1.0).text("Skerries")).drag_stopped();
                    tweak |= ui.add(egui::Slider::new(&mut cp.gradient, 0.0..=1.0).text("Gradient")).drag_stopped();
                    tweak |= ui.add(egui::Slider::new(&mut cp.land_height, 5.0..=3000.0).logarithmic(true).suffix(" m").text("Land height")).drag_stopped();
                    tweak |= ui.add(egui::Slider::new(&mut cp.shelf_depth, 5.0..=2000.0).logarithmic(true).suffix(" m").text("Shelf depth")).drag_stopped();
                    let mut seed = cp.seed as i64;
                    if ui.add(egui::DragValue::new(&mut seed).prefix("Seed ")).drag_stopped() {
                        tweak = true;
                    }
                    cp.seed = seed.max(0) as u64;
                    if tweak && cp.preset != CoastPreset::Custom {
                        cp.preset = CoastPreset::Custom;
                    }
                    if (ch || tweak) && c.has_last_procedural == Some(Tool::Coast) {
                        actions.push(UiAction::ReapplyLastStroke);
                    }
                }
                Tool::WaterEdit => {
                    ui.heading("Water edit");
                    ui.small("Drag river or lake vertices. Delete removes the selected feature.");
                    if let Some(sel) = c.water_selected {
                        ui.label(match sel {
                            WaterSel::River { river, vertex } => format!("River {river}, vertex {vertex}"),
                            WaterSel::Lake { lake, vertex } => format!("Lake {lake}, vertex {vertex}"),
                        });
                        if ui.button("Delete feature").clicked() {
                            actions.push(UiAction::DeleteSelectedWater);
                        }
                    }
                    if let Some(b) = &c.doc.baked {
                        ui.label(format!("{} rivers, {} lakes (baked)", b.rivers.len(), b.lakes.len()));
                    }
                }
                Tool::Place => {
                    ui.heading("Place symbol");
                    ui.small("Click to stamp the selected symbol. Drag a placed symbol to move it. [ ] resize, Delete removes.");
                    let mut sz = c.tools.place_size;
                    let r = ui.add(egui::Slider::new(&mut sz, 0.0..=600.0).text("Size (0 = default)"));
                    if r.changed() {
                        c.tools.place_size = sz;
                    }
                    if let Some(qid) = c.tools.selected_assets.first() {
                        ui.label(format!("Selected: {}", c.library.get(qid).map(|a| a.def.name.clone()).unwrap_or(qid.clone())));
                    }
                    if c.selected_placement.is_some() && ui.button("Delete placed symbol").clicked() {
                        actions.push(UiAction::DeleteSelectedPlacement);
                    }
                    ui.label(format!("{} placed by hand", c.doc.placements.len()));
                }
                Tool::Scatter => {
                    ui.heading("Scatter symbols");
                    ui.small("Paint with the selected symbols (shift-click adds more). Erase mode removes placed symbols.");
                    let sc = &mut c.tools.scatter;
                    ui.add(egui::Slider::new(&mut sc.radius, 8.0..=800.0).logarithmic(true).text("Radius"));
                    ui.add(egui::Slider::new(&mut sc.spacing, 3.0..=200.0).logarithmic(true).text("Spacing"));
                    ui.add(egui::Slider::new(&mut sc.size_jitter, 0.0..=0.8).text("Size jitter"));
                    ui.add(egui::Slider::new(&mut sc.rotation_jitter_deg, 0.0..=180.0).text("Rotation jitter"));
                    ui.add(egui::Slider::new(&mut sc.max_slope, 1.0..=400.0).logarithmic(true).text("Max slope"));
                    ui.checkbox(&mut sc.flip, "Random flip");
                    ui.checkbox(&mut sc.avoid_water, "Avoid water");
                    ui.checkbox(&mut sc.erase, "Erase mode");
                    ui.label(format!("{} symbols selected", c.tools.selected_assets.len()));
                }
                Tool::Name => {
                    ui.heading("Name & label");
                    ui.small("Click a river, lake, symbol or the sea to name it; click a label to select, drag to move.");
                    ui.horizontal(|ui| {
                        if ui.button("Name everything").on_hover_text("Generate names for lakes, rivers, ranges, forests, settlements and the sea").clicked() {
                            actions.push(UiAction::NameEverything);
                        }
                        if ui.button("Clear generated").clicked() {
                            actions.push(UiAction::ClearAutoNames);
                        }
                    });
                    ui.separator();
                    match c.selected_entity.and_then(|id| c.doc.entities.iter().position(|e| e.id == id)) {
                        Some(idx) => {
                            let snapshot = c.doc.entities.clone();
                            let e = &mut c.doc.entities[idx];
                            let id = e.id;
                            let mut changed = false;
                            let mut released = false;
                            ui.label(egui::RichText::new(&e.name).font(serif_italic(18.0)));
                            let r = ui.text_edit_singleline(&mut e.name);
                            changed |= r.changed();
                            released |= r.lost_focus();
                            ui.horizontal(|ui| {
                                if ui.button("Generate").clicked() {
                                    actions.push(UiAction::EntityGenerateName(id));
                                }
                                let mut kind = e.kind;
                                egui::ComboBox::from_id_salt("ent_kind").selected_text(kind.label()).show_ui(ui, |ui| {
                                    for k in EntityKind::ALL {
                                        ui.selectable_value(&mut kind, k, k.label());
                                    }
                                });
                                if kind != e.kind {
                                    e.kind = kind;
                                    changed = true;
                                    released = true;
                                }
                            });
                            let r = ui.add(egui::Slider::new(&mut e.importance, 0.0..=1.0).text("Importance"));
                            changed |= r.changed();
                            released |= r.drag_stopped();
                            let r = ui.add(egui::Slider::new(&mut e.label.size_mult, 0.4..=3.0).text("Label size"));
                            changed |= r.changed();
                            released |= r.drag_stopped();
                            let r = ui.add(egui::Slider::new(&mut e.label.letter_spacing, -2.0..=12.0).text("Letter spacing"));
                            changed |= r.changed();
                            released |= r.drag_stopped();
                            let r = ui.add(egui::Slider::new(&mut e.label.curvature, -1.0..=1.0).text("Curve"));
                            changed |= r.changed();
                            released |= r.drag_stopped();
                            let mut deg = e.label.angle.to_degrees();
                            let r = ui.add(egui::Slider::new(&mut deg, -90.0..=90.0).suffix("°").text("Angle"));
                            if r.changed() {
                                e.label.angle = deg.to_radians();
                                changed = true;
                            }
                            released |= r.drag_stopped();
                            let r = ui.add(egui::Slider::new(&mut e.label.shift, -0.5..=0.5).text("Slide along"));
                            changed |= r.changed();
                            released |= r.drag_stopped();
                            let r = ui.checkbox(&mut e.label.hidden, "Hide label");
                            changed |= r.changed();
                            released |= r.changed();
                            let r = ui.checkbox(&mut e.label.pinned, "Pinned (never decluttered)");
                            changed |= r.changed();
                            released |= r.changed();
                            if ui.button("Reset label position").clicked() {
                                e.label.offset = [0.0; 2];
                                e.label.shift = 0.0;
                                e.label.angle = 0.0;
                                e.label.pinned = false;
                                changed = true;
                                released = true;
                            }
                            let mut tags = e.tags.join(", ");
                            let r = ui.add(egui::TextEdit::singleline(&mut tags).hint_text("tags, comma separated"));
                            if r.changed() {
                                e.tags = tags.split(',').map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect();
                                changed = true;
                            }
                            released |= r.lost_focus();
                            ui.label("Notes");
                            let r = ui.add(egui::TextEdit::multiline(&mut e.notes).desired_rows(4).desired_width(f32::INFINITY));
                            changed |= r.changed();
                            released |= r.lost_focus();
                            if changed {
                                e.auto = false;
                                if st.entity_edit_before.is_none() {
                                    st.entity_edit_before = Some(snapshot);
                                }
                            }
                            if released {
                                if let Some(before) = st.entity_edit_before.take() {
                                    actions.push(UiAction::EntityEdit { before });
                                }
                            }
                            if ui.button("Delete name").clicked() {
                                actions.push(UiAction::DeleteEntity(id));
                            }
                        }
                        None => {
                            ui.label(format!("{} named features · {} labels hidden by declutter", c.doc.entities.len(), c.labels.hidden_by_declutter));
                            egui::ScrollArea::vertical().max_height(300.0).show(ui, |ui| {
                                for e in &c.doc.entities {
                                    if ui.selectable_label(false, format!("{} · {}", e.name, e.kind.label())).clicked() {
                                        actions.push(UiAction::SelectEntity(Some(e.id)));
                                    }
                                }
                            });
                        }
                    }
                }
                Tool::Pan => {
                    ui.label("Drag to pan. Wheel to zoom.");
                }
            }
            ui.separator();
            ui.small("Left-drag: use tool. Middle/right-drag or Space: pan. Wheel: zoom. [ ]: size.");
        });
    });

    egui::Panel::right("map").default_size(300.0).show(root, |ui| {
        egui::ScrollArea::vertical().show(ui, |ui| {
            ui.add_space(4.0);
            ui.heading("Look");
            let th = &mut c.doc.render.theme;
            let mut style = th.style;
            egui::ComboBox::from_label("Theme").selected_text(style.label()).show_ui(ui, |ui| {
                for s in ThemeStyle::ALL {
                    ui.selectable_value(&mut style, s, s.label());
                }
            });
            if style != th.style {
                *th = Theme::preset(style);
            }
            if th.style != ThemeStyle::Modern {
                ui.add(egui::Slider::new(&mut th.paper_grain, 0.0..=1.0).text("Paper grain"));
                ui.add(egui::Slider::new(&mut th.vignette, 0.0..=1.0).text("Burnt edges"));
                ui.add(egui::Slider::new(&mut th.land_tint, 0.0..=1.0).text("Colour wash"));
                egui::ComboBox::from_label("Relief").selected_text(th.relief.label()).show_ui(ui, |ui| {
                    for r in ReliefStyle::ALL {
                        ui.selectable_value(&mut th.relief, r, r.label());
                    }
                });
                if th.relief != ReliefStyle::Shaded {
                    ui.add(egui::Slider::new(&mut th.hatch_strength, 0.0..=1.0).text("Hatching"));
                }
                if th.relief != ReliefStyle::Hatched {
                    ui.add(egui::Slider::new(&mut th.hillshade_strength, 0.0..=1.0).text("Shading"));
                }
                let forest_before = th.forest;
                egui::ComboBox::from_label("Woods").selected_text(th.forest.label()).show_ui(ui, |ui| {
                    for f in ForestStyle::ALL {
                        ui.selectable_value(&mut th.forest, f, f.label());
                    }
                });
                if th.forest != forest_before {
                    actions.push(UiAction::SymbolsChanged);
                }
                if th.forest != ForestStyle::None && th.forest != ForestStyle::Symbols {
                    ui.add(egui::Slider::new(&mut th.forest_scale, 3.0..=24.0).text("Tree size"));
                    ui.add(egui::Slider::new(&mut th.forest_threshold, 0.0..=1.0).text("Tree cover"));
                }
                let sy = &mut c.doc.symbols;
                let mut sym_changed = false;
                sym_changed |= ui.checkbox(&mut sy.mountains.enabled, "Mountain symbols").changed();
                if sy.mountains.enabled {
                    sym_changed |= ui.add(egui::Slider::new(&mut sy.mountains.spacing, 8.0..=120.0).logarithmic(true).text("Mountain spacing")).drag_stopped();
                    sym_changed |= ui.add(egui::Slider::new(&mut sy.mountains.size, 0.3..=3.0).text("Mountain size")).drag_stopped();
                    sym_changed |= ui.add(egui::Slider::new(&mut sy.mountains.min_relief, 50.0..=1500.0).logarithmic(true).text("Peak relief")).drag_stopped();
                }
                if th.forest == FS::Symbols {
                    sym_changed |= ui.add(egui::Slider::new(&mut sy.forest.spacing, 4.0..=60.0).logarithmic(true).text("Tree spacing")).drag_stopped();
                    sym_changed |= ui.add(egui::Slider::new(&mut sy.forest.size, 0.3..=3.0).text("Tree size")).drag_stopped();
                    sym_changed |= ui.add(egui::Slider::new(&mut sy.forest.threshold, 0.0..=1.0).text("Tree cover")).drag_stopped();
                }
                ui.add(egui::Slider::new(&mut sy.shadow, 0.0..=1.0).text("Symbol shadow"));
                if sym_changed {
                    actions.push(UiAction::SymbolsChanged);
                }
                let mut rings = th.coast_rings as i32;
                ui.add(egui::Slider::new(&mut rings, 0..=8).text("Shore rings"));
                th.coast_rings = rings as u32;
                if th.coast_rings > 0 {
                    ui.add(egui::Slider::new(&mut th.ring_spacing, 2.0..=40.0).text("Ring spacing"));
                }
                ui.add(egui::Slider::new(&mut th.coast_line_width, 0.5..=4.0).text("Coast ink"));
                ui.checkbox(&mut th.show_ornaments, "Compass and cartouche");
                ui.checkbox(&mut th.show_labels, "Labels");
                ui.horizontal(|ui| {
                    let current = c.cultures.iter().find(|k| k.id == c.doc.culture).map(|k| k.pack.name.clone()).unwrap_or_else(|| c.doc.culture.clone());
                    egui::ComboBox::from_id_salt("culture").selected_text(current).show_ui(ui, |ui| {
                        for k in c.cultures {
                            ui.selectable_value(&mut c.doc.culture, k.id.clone(), &k.pack.name).on_hover_text(&k.pack.description);
                        }
                    });
                    ui.label("Names");
                });
                ui.horizontal(|ui| {
                    if ui.button("Name everything").clicked() {
                        actions.push(UiAction::NameEverything);
                    }
                    if ui.button("Typography…").clicked() {
                        st.show_typography = true;
                    }
                });
            } else {
                ui.add(egui::Slider::new(&mut c.doc.render.hillshade_strength, 0.0..=1.0).text("Hillshade"));
                ui.add(egui::Slider::new(&mut c.doc.render.coast_line_width, 0.0..=4.0).text("Coast line"));
            }
            let rs = &mut c.doc.render;
            ui.add(egui::Slider::new(&mut rs.sun_azimuth_deg, 0.0..=360.0).suffix("°").text("Light from"));
            ui.add(egui::Slider::new(&mut rs.vertical_exaggeration, 0.1..=8.0).logarithmic(true).text("Relief strength"));
            ui.checkbox(&mut rs.show_contours, "Contour lines");
            if rs.show_contours {
                ui.add(egui::Slider::new(&mut rs.contour_interval, 10.0..=1000.0).logarithmic(true).suffix(" m").text("Interval"));
            }
            ui.separator();

            ui.heading("Sea level");
            let (lo, hi) = (c.doc.stats.min.min(-1.0), c.doc.stats.max.max(1.0));
            let mut sea = c.doc.sea_level;
            let r = ui.add(egui::Slider::new(&mut sea, lo..=hi).suffix(" m").text(""));
            if r.drag_started() {
                st.sea_drag_start = Some(c.doc.sea_level);
            }
            if r.changed() {
                if st.sea_drag_start.is_none() {
                    st.sea_drag_start = Some(c.doc.sea_level);
                }
                c.doc.set_sea_level_live(sea);
            }
            if r.drag_stopped() || (r.lost_focus() && st.sea_drag_start.is_some()) {
                if let Some(from) = st.sea_drag_start.take() {
                    actions.push(UiAction::SeaLevelCommit { from, to: c.doc.sea_level });
                }
            }
            ui.small(format!("Land {:.0}% of the map", c.doc.stats.land_fraction * 100.0));
            ui.separator();

            ui.heading("Rivers & lakes");
            {
                let wp = &mut c.doc.params.water;
                let mut changed = false;
                let mut mode = wp.mode;
                egui::ComboBox::from_label("Update").selected_text(mode.label()).show_ui(ui, |ui| {
                    for m in RecomputeMode::ALL {
                        ui.selectable_value(&mut mode, m, m.label());
                    }
                });
                if mode != wp.mode {
                    wp.mode = mode;
                    changed = true;
                }
                let hy = &mut wp.hydrology;
                // Displayed as "more rivers" = lower threshold.
                let mut more = (50.0 - hy.river_threshold_frac * 1e4).clamp(0.0, 49.9);
                let r = ui.add(egui::Slider::new(&mut more, 0.0..=49.9).text("Fewer ↔ more rivers"));
                if r.changed() {
                    hy.river_threshold_frac = (50.0 - more) * 1e-4;
                }
                if r.drag_stopped() {
                    changed = true;
                }
                changed |= ui.add(egui::Slider::new(&mut hy.river_width_scale, 0.2..=5.0).text("River width")).drag_stopped();
                changed |= ui.checkbox(&mut hy.lakes_enabled, "Lakes").changed();
                ui.horizontal(|ui| {
                    if ui.button("Recompute").on_hover_text("Ctrl+R").clicked() {
                        actions.push(UiAction::RecomputeWater);
                    }
                    if c.doc.baked.is_none() {
                        if ui.add_enabled(c.doc.derived.is_some(), egui::Button::new("Bake")).on_hover_text("Freeze rivers and lakes as editable geometry and make moisture paintable").clicked() {
                            actions.push(UiAction::BakeWater);
                        }
                    } else if ui.button("Unbake").clicked() {
                        actions.push(UiAction::UnbakeWater);
                    }
                    let mut sw = c.show_water;
                    if ui.checkbox(&mut sw, "Show").changed() {
                        actions.push(UiAction::ShowWater(sw));
                    }
                });
                if let Some(p) = c.derived_running {
                    ui.add(egui::ProgressBar::new(p).text("updating"));
                } else if let Some(d) = &c.doc.derived {
                    let state = if c.doc.baked.is_some() { "baked" } else if c.doc.derived_stale { "out of date" } else { "up to date" };
                    ui.small(format!("{} rivers, {} lakes · {state}", d.water.rivers.len(), d.water.lakes.len()));
                }
                if changed {
                    actions.push(UiAction::SettingsChanged);
                }
            }
            ui.separator();

            egui::CollapsingHeader::new("Advanced").default_open(false).show(ui, |ui| {
                ui.label(egui::RichText::new("Data views").strong());
                let mut vm = c.view_mode;
                egui::ComboBox::from_id_salt("view_mode").selected_text(vm.label()).show_ui(ui, |ui| {
                    for m in ViewMode::ALL {
                        ui.selectable_value(&mut vm, m, m.label());
                    }
                });
                if vm != c.view_mode {
                    actions.push(UiAction::ViewMode(vm));
                }
                ui.add(egui::Slider::new(&mut c.doc.render.sun_altitude_deg, 5.0..=85.0).suffix("°").text("Sun altitude"));
                egui::CollapsingHeader::new("Climate").default_open(false).show(ui, |ui| {
                    let cl = &mut c.doc.params.water.climate;
                    let mut changed = false;
                    changed |= ui.checkbox(&mut cl.moisture_enabled, "Orographic moisture").changed();
                    if cl.moisture_enabled {
                        changed |= ui.add(egui::Slider::new(&mut cl.wind_deg, 0.0..=360.0).suffix("°").text("Wind toward")).drag_stopped();
                        changed |= ui.add(egui::Slider::new(&mut cl.orographic, 0.0..=1.0).text("Orographic strength")).drag_stopped();
                        changed |= ui.add(egui::Slider::new(&mut cl.continentality, 0.05..=2.0).logarithmic(true).text("Continentality")).drag_stopped();
                        changed |= ui.add(egui::Slider::new(&mut cl.boundary_moisture, 0.0..=1.0).text("Incoming moisture")).drag_stopped();
                    } else {
                        changed |= ui.add(egui::Slider::new(&mut cl.uniform_moisture, 0.0..=1.0).text("Uniform moisture")).drag_stopped();
                    }
                    changed |= ui.add(egui::Slider::new(&mut cl.lat_north, -90.0..=90.0).suffix("°").text("Latitude north")).drag_stopped();
                    changed |= ui.add(egui::Slider::new(&mut cl.lat_south, -90.0..=90.0).suffix("°").text("Latitude south")).drag_stopped();
                    changed |= ui.add(egui::Slider::new(&mut cl.lapse_rate, 0.0..=12.0).text("Lapse °C/km")).drag_stopped();
                    changed |= ui.add(egui::Slider::new(&mut cl.temperature_offset, -20.0..=20.0).suffix(" °C").text("Temperature offset")).drag_stopped();
                    if changed {
                        actions.push(UiAction::SettingsChanged);
                    }
                });
                egui::CollapsingHeader::new("Hydrology").default_open(false).show(ui, |ui| {
                    let wp = &mut c.doc.params.water;
                    let mut changed = false;
                    let mut res = wp.sim_resolution;
                    egui::ComboBox::from_label("Simulation").selected_text(format!("{res}²")).show_ui(ui, |ui| {
                        ui.selectable_value(&mut res, 2048, "2048²");
                        ui.selectable_value(&mut res, 1024, "1024²");
                    });
                    if res != wp.sim_resolution {
                        wp.sim_resolution = res;
                        changed = true;
                    }
                    ui.checkbox(&mut wp.auto_downgrade, "Drop to 1024² if a run exceeds 1 s");
                    let hy = &mut wp.hydrology;
                    changed |= ui.checkbox(&mut hy.enabled, "Rivers").changed();
                    changed |= ui.add(egui::Slider::new(&mut hy.arid_loss, 0.0..=0.05).text("Arid loss")).drag_stopped();
                    changed |= ui.add(egui::Slider::new(&mut hy.min_lake_depth, 1.0..=200.0).logarithmic(true).text("Min lake depth")).drag_stopped();
                    let mut area = hy.min_lake_area as f32;
                    if ui.add(egui::Slider::new(&mut area, 1.0..=2000.0).logarithmic(true).text("Min lake area")).drag_stopped() {
                        changed = true;
                    }
                    hy.min_lake_area = area as u32;
                    changed |= ui.add(egui::Slider::new(&mut hy.lake_min_moisture, 0.0..=0.5).text("Lake min moisture")).drag_stopped();
                    if changed {
                        actions.push(UiAction::SettingsChanged);
                    }
                });
                if ui.button("Biome matrix…").clicked() {
                    st.show_biome_matrix = true;
                }
                ui.separator();
                ui.label(format!("{} × {} texels · {:.0} m/texel (display only)", c.doc.width(), c.doc.height(), c.doc.meters_per_texel));
                ui.label(format!("Elevation {:.0} … {:.0} m", c.doc.stats.min, c.doc.stats.max));
                ui.label(format!(
                    "History: {} entries, {} in RAM, {} on disk",
                    c.doc.undo.len(),
                    fmt_bytes(c.doc.undo.loaded_bytes() as u64),
                    fmt_bytes(c.doc.undo.spilled_bytes() as u64)
                ));
            });
        });
    });

    if c.tools.tool.uses_assets() {
        egui::Panel::bottom("assets").default_size(210.0).resizable(true).show(root, |ui| {
            ui.horizontal(|ui| {
                ui.heading("Symbols");
                ui.add(egui::TextEdit::singleline(&mut st.asset_query).hint_text("search name or tag").desired_width(160.0));
                ui.toggle_value(&mut st.asset_favorites_only, "★ favourites");
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    if ui.button("Import image…").on_hover_text("PNG, JPG, WebP or SVG. Also: drop files onto the map.").clicked() {
                        actions.push(UiAction::ImportImages);
                    }
                    if ui.button("Add pack folder…").clicked() {
                        actions.push(UiAction::AddPackDir);
                    }
                    ui.toggle_value(&mut st.show_packs, "Packs");
                });
            });
            ui.horizontal_wrapped(|ui| {
                if ui.selectable_label(st.asset_category.is_none(), "All").clicked() {
                    st.asset_category = None;
                }
                for cat in c.library.categories() {
                    let sel = st.asset_category.as_deref() == Some(cat.as_str());
                    if ui.selectable_label(sel, &cat).clicked() {
                        st.asset_category = if sel { None } else { Some(cat.clone()) };
                    }
                }
            });
            if st.show_packs {
                ui.horizontal_wrapped(|ui| {
                    for p in &c.library.packs {
                        ui.label(format!("{} ({} symbols)", p.manifest.name, p.assets.len()));
                        if c.library.config.pack_dirs.contains(&p.root) && ui.small_button("remove").clicked() {
                            actions.push(UiAction::RemovePackDir(p.root.clone()));
                        }
                        ui.separator();
                    }
                    if c.library.overflow > 0 {
                        ui.colored_label(egui::Color32::from_rgb(230, 170, 80), format!("{} symbols did not fit the atlas", c.library.overflow));
                    }
                });
            }
            if !c.library.config.recent.is_empty() && st.asset_query.is_empty() && st.asset_category.is_none() && !st.asset_favorites_only {
                ui.horizontal(|ui| {
                    ui.small("Recent:");
                    for qid in c.library.config.recent.iter().take(10) {
                        if let Some(a) = c.library.get(qid) {
                            if ui.small_button(&a.def.name).clicked() {
                                actions.push(UiAction::SelectAsset { qid: qid.clone(), additive: false });
                            }
                        }
                    }
                });
            }
            let results = c.library.search(&st.asset_query, st.asset_category.as_deref(), st.asset_favorites_only);
            let tile = 72.0;
            egui::ScrollArea::vertical().show(ui, |ui| {
                ui.horizontal_wrapped(|ui| {
                    ui.spacing_mut().item_spacing = egui::vec2(6.0, 6.0);
                    for a in results {
                        let selected = c.tools.selected_assets.contains(&a.qid);
                        let fav = c.library.config.favorites.contains(&a.qid);
                        let (rect, resp) = ui.allocate_exact_size(egui::vec2(tile, tile + 18.0), egui::Sense::click());
                        let v = ui.visuals();
                        let fill = if selected { v.selection.bg_fill } else if resp.hovered() { v.widgets.hovered.bg_fill } else { v.widgets.inactive.bg_fill };
                        let stroke = if selected { v.selection.stroke } else { egui::Stroke::new(1.0, egui::Color32::from_rgb(70, 58, 46)) };
                        let p = ui.painter();
                        p.rect(rect, egui::CornerRadius::same(6), fill, stroke, egui::StrokeKind::Inside);
                        let img_rect = egui::Rect::from_min_size(rect.min + egui::vec2(4.0, 4.0), egui::vec2(tile - 8.0, tile - 8.0));
                        p.rect_filled(img_rect, egui::CornerRadius::same(4), egui::Color32::from_rgb(236, 226, 200));
                        if let (Some(tex), Some(r)) = (c.atlas_tex, a.rect) {
                            let (uv0, uv1) = r.uv();
                            let asp = r.aspect();
                            let (w, h) = if asp >= 1.0 { (img_rect.width(), img_rect.width() / asp) } else { (img_rect.height() * asp, img_rect.height()) };
                            let fit = egui::Rect::from_center_size(img_rect.center(), egui::vec2(w, h));
                            p.image(tex, fit, egui::Rect::from_min_max(egui::pos2(uv0[0], uv0[1]), egui::pos2(uv1[0], uv1[1])), egui::Color32::WHITE);
                        }
                        p.text(egui::pos2(rect.center().x, rect.bottom() - 3.0), egui::Align2::CENTER_BOTTOM, &a.def.name, egui::FontId::proportional(10.0), v.text_color());
                        let star = egui::Rect::from_min_size(rect.right_top() + egui::vec2(-16.0, 2.0), egui::vec2(14.0, 14.0));
                        p.text(star.center(), egui::Align2::CENTER_CENTER, if fav { "★" } else { "☆" }, egui::FontId::proportional(12.0), if fav { egui::Color32::from_rgb(230, 190, 80) } else { v.text_color().gamma_multiply(0.6) });
                        let resp = resp.on_hover_text(format!("{}\n{}\ntags: {}", a.def.name, a.pack, a.def.tags.join(", ")));
                        if resp.clicked() {
                            let pos = resp.interact_pointer_pos().unwrap_or(rect.center());
                            if star.expand(3.0).contains(pos) {
                                actions.push(UiAction::ToggleFavorite(a.qid.clone()));
                            } else {
                                actions.push(UiAction::SelectAsset { qid: a.qid.clone(), additive: ui.input(|i| i.modifiers.shift) });
                            }
                        }
                    }
                });
            });
        });
    }

    egui::Panel::bottom("status").show(root, |ui| {
        ui.horizontal(|ui| {
            match c.cursor_field {
                Some(p) if p.x >= 0.0 && p.y >= 0.0 && p.x < c.doc.width() as f32 && p.y < c.doc.height() as f32 => {
                    let h = c.doc.elevation.sample(p.x, p.y);
                    ui.monospace(format!("x {:7.1}  y {:7.1}   h {:8.1} m", p.x, p.y, h));
                    if let Some(d) = &c.doc.derived {
                        let i = p.y as usize * c.doc.width() as usize + p.x as usize;
                        let moist = match (&c.doc.baked, &d.water.moisture) {
                            (Some(b), _) => b.moisture.sample(p.x, p.y),
                            (None, Some(m)) => m.sample(p.x * m.width() as f32 / c.doc.width() as f32, p.y * m.height() as f32 / c.doc.height() as f32),
                            _ => 0.0,
                        };
                        let t = &d.temperature;
                        let temp = t.sample(p.x * t.width() as f32 / c.doc.width() as f32, p.y * t.height() as f32 / c.doc.height() as f32);
                        ui.separator();
                        ui.monospace(format!("{}  moist {:.2}  {:.1} °C", d.biome.get(i).map(|b| Biome::from_u8(*b).label()).unwrap_or("—"), moist, temp));
                    }
                }
                _ => {
                    ui.monospace("x    —     y    —     h      —   ");
                }
            }
            ui.separator();
            ui.monospace(format!("zoom {:.0}%", c.camera.zoom * 100.0));
            ui.separator();
            if let Some((name, p)) = &c.job {
                ui.add(egui::ProgressBar::new(*p).desired_width(160.0).text(name.as_str()));
                ui.separator();
            }
            if c.symbols_running {
                ui.small("placing symbols…");
                ui.separator();
            }
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.monospace(format!("{:.1} ms · {} symbols", c.cpu.avg_frame_ms(), c.sprite_count));
                ui.separator();
                ui.add(egui::Label::new(&st.status).truncate());
            });
        });
    });

    if st.show_profiler {
        let mut open = true;
        egui::Window::new("Profiler").open(&mut open).default_width(360.0).default_pos((260.0, 40.0)).show(ctx, |ui| {
            ui.label(format!("GPU: {} ({})  timestamps: {}", c.gpu_name, c.gpu_backend, if c.timestamps_supported { "yes" } else { "no" }));
            ui.label(format!(
                "Frame: avg {:.2} ms  max {:.2} ms  ({:.0} fps)",
                c.cpu.avg_frame_ms(),
                c.cpu.max_frame_ms(),
                if c.cpu.avg_frame_ms() > 0.0 { 1000.0 / c.cpu.avg_frame_ms() } else { 0.0 }
            ));
            let (rect, _) = ui.allocate_exact_size(egui::vec2(ui.available_width(), 60.0), egui::Sense::hover());
            let painter = ui.painter_at(rect);
            painter.rect_filled(rect, 2.0, egui::Color32::from_black_alpha(140));
            let n = c.cpu.frame_ms.len().max(1) as f32;
            let scale = 40.0f32;
            let pts: Vec<egui::Pos2> = c
                .cpu
                .frame_ms
                .iter()
                .enumerate()
                .map(|(i, ms)| egui::pos2(rect.left() + rect.width() * i as f32 / n, rect.bottom() - rect.height() * (ms / scale).min(1.0)))
                .collect();
            let y16 = rect.bottom() - rect.height() * (16.67 / scale);
            painter.line_segment([egui::pos2(rect.left(), y16), egui::pos2(rect.right(), y16)], egui::Stroke::new(1.0, egui::Color32::from_rgb(90, 90, 40)));
            if pts.len() > 1 {
                painter.add(egui::Shape::line(pts, egui::Stroke::new(1.0, egui::Color32::from_rgb(120, 220, 120))));
            }
            ui.separator();
            egui::Grid::new("gpu passes").striped(true).show(ui, |ui| {
                ui.strong("GPU pass");
                ui.strong("ms");
                ui.end_row();
                let mut keys: Vec<_> = c.gpu_ms.keys().collect();
                keys.sort();
                for k in keys {
                    ui.label(k);
                    ui.label(format!("{:.3}", c.gpu_ms[k]));
                    ui.end_row();
                }
                ui.strong("CPU section");
                ui.strong("ms");
                ui.end_row();
                let mut keys: Vec<_> = c.cpu.sections.keys().collect();
                keys.sort();
                for k in keys {
                    ui.label(*k);
                    ui.label(format!("{:.3}", c.cpu.sections[k]));
                    ui.end_row();
                }
            });
            ui.separator();
            ui.label(format!("Brush: {} dabs, {} dispatches, {} texels this frame", c.brush_dabs, c.brush_dispatches, c.brush_texels));
            ui.label(format!(
                "Readback: {} tiles in flight, {} landed last frame, {} total ({})",
                c.readback.tiles_in_flight,
                c.readback.tiles_landed_last_frame,
                c.readback.total_tiles_landed,
                fmt_bytes(c.readback.total_bytes_landed)
            ));
            ui.label(format!(
                "VRAM: elevation + staging {}, derived textures {}{}",
                fmt_bytes(c.device_bytes),
                fmt_bytes(c.derived_device_bytes),
                c.allocated_bytes.map(|b| format!(", allocator total {}", fmt_bytes(b))).unwrap_or_default()
            ));
            ui.label(format!("Threads: {} rayon workers, {} background job(s) running", rayon::current_num_threads(), crate::jobs::running_jobs()));
            if let Some(d) = &c.doc.derived {
                let t = &d.timings;
                let w = &t.water;
                ui.separator();
                if d.baked {
                    ui.label("Water: baked (moisture and hydrology skipped)");
                } else {
                    ui.label(format!(
                        "Water {:.0} ms at {}×{}: downsample {:.0}, moisture {:.0}, fill {:.0}, flow {:.0}, lakes {:.0}, rivers {:.0}, vectorise {:.0}",
                        w.total_ms, w.sim_width, w.sim_height, w.downsample_ms, w.moisture_ms, w.fill_ms, w.flow_ms, w.lakes_ms, w.rivers_ms, w.vector_ms
                    ));
                }
                ui.label(format!(
                    "Derived {:.0} ms total: water raster {:.0}, temperature {:.0}, biome {:.0}; sim memory {} peak, result {} CPU, last upload {} tiles",
                    t.total_ms,
                    t.water_raster_ms,
                    t.temperature_ms,
                    t.biome_ms,
                    fmt_bytes(w.sim_bytes),
                    fmt_bytes(d.cpu_bytes()),
                    c.derived_upload_tiles
                ));
            }
        });
        st.show_profiler = open;
    }

    if st.show_new {
        let mut open = true;
        let mut create = false;
        egui::Window::new("New map").open(&mut open).collapsible(false).resizable(false).show(ctx, |ui| {
            let p = &mut st.new_params;
            ui.horizontal(|ui| {
                ui.label("Name");
                ui.text_edit_singleline(&mut p.name);
            });
            egui::ComboBox::from_label("Resolution").selected_text(format!("{0} × {0}", p.size)).show_ui(ui, |ui| {
                for s in SIZES {
                    if s <= c.max_field_dim {
                        ui.selectable_value(&mut p.size, s, format!("{s} × {s}"));
                    }
                }
            });
            ui.label(format!("Field memory: {} on GPU, {} mirror", fmt_bytes(p.size as u64 * p.size as u64 * 8), fmt_bytes(p.size as u64 * p.size as u64 * 4)));
            egui::ComboBox::from_label("Terrain").selected_text(p.terrain.preset.label()).show_ui(ui, |ui| {
                for t in TerrainPreset::ALL {
                    ui.selectable_value(&mut p.terrain.preset, t, t.label());
                }
            });
            let mut seed = p.terrain.seed as i64;
            ui.add(egui::DragValue::new(&mut seed).prefix("Seed "));
            p.terrain.seed = seed.max(0) as u64;
            ui.add(egui::Slider::new(&mut p.terrain.feature_scale, 0.1..=1.5).text("Feature scale"));
            ui.add(egui::Slider::new(&mut p.terrain.roughness, 0.0..=1.0).text("Roughness"));
            ui.add(egui::Slider::new(&mut p.terrain.max_height, 500.0..=8000.0).suffix(" m").text("Peak height"));
            ui.horizontal(|ui| {
                if ui.button("Create").clicked() {
                    create = true;
                }
                if ui.button("Cancel").clicked() {
                    st.show_new = false;
                }
            });
        });
        if create {
            actions.push(UiAction::New(st.new_params.clone()));
            st.show_new = false;
        }
        if !open {
            st.show_new = false;
        }
    }

    if st.show_typography {
        let mut open = true;
        egui::Window::new("Label typography").open(&mut open).default_pos((280.0, 60.0)).show(ctx, |ui| {
            let lc = &mut c.doc.render.theme.labels;
            egui::Grid::new("typo").striped(true).show(ui, |ui| {
                ui.strong("Class");
                ui.strong("Size");
                ui.strong("Spacing");
                ui.strong("Halo");
                ui.strong("Italic");
                ui.strong("Bold");
                ui.strong("CAPS");
                ui.strong("Curved");
                ui.strong("Min zoom");
                ui.end_row();
                for (name, cls) in [
                    ("Settlement", &mut lc.settlement),
                    ("River", &mut lc.river),
                    ("Lake", &mut lc.lake),
                    ("Range", &mut lc.range),
                    ("Peak", &mut lc.peak),
                    ("Forest", &mut lc.forest),
                    ("Sea", &mut lc.sea),
                    ("Region", &mut lc.region),
                    ("Bay", &mut lc.bay),
                    ("Marker", &mut lc.marker),
                ] {
                    ui.label(name);
                    ui.add(egui::DragValue::new(&mut cls.size).range(6.0..=64.0).speed(0.5));
                    ui.add(egui::DragValue::new(&mut cls.letter_spacing).range(-2.0..=20.0).speed(0.2));
                    ui.add(egui::DragValue::new(&mut cls.halo).range(0.0..=6.0).speed(0.1));
                    ui.checkbox(&mut cls.italic, "");
                    ui.checkbox(&mut cls.bold, "");
                    ui.checkbox(&mut cls.uppercase, "");
                    ui.checkbox(&mut cls.curved, "");
                    ui.add(egui::DragValue::new(&mut cls.min_zoom).range(0.0..=8.0).speed(0.02));
                    ui.end_row();
                }
            });
            ui.small("Sizes are screen pixels at importance 0.5; importance scales them 0.6×–1.4×.");
        });
        st.show_typography = open;
    }

    if st.show_biome_matrix {
        let mut open = true;
        egui::Window::new("Biome matrix").open(&mut open).default_pos((260.0, 420.0)).show(ctx, |ui| {
            let m = &mut c.doc.params.biomes;
            let mut changed = false;
            ui.label("Rows: temperature bins (cold → hot). Columns: moisture bins (dry → wet).");
            egui::Grid::new("biome_matrix").striped(true).show(ui, |ui| {
                ui.label("");
                for label in MOIST_BIN_LABELS {
                    ui.strong(label);
                }
                ui.end_row();
                for (i, row) in m.cells.iter_mut().enumerate().take(TEMP_BINS) {
                    ui.strong(TEMP_BIN_LABELS[i]);
                    for (j, cell) in row.iter_mut().enumerate().take(MOIST_BINS) {
                        egui::ComboBox::from_id_salt(("bm", i, j)).selected_text(cell.label()).width(150.0).show_ui(ui, |ui| {
                            for b in Biome::ALL.iter().skip(2) {
                                if ui.selectable_value(cell, *b, b.label()).changed() {
                                    changed = true;
                                }
                            }
                        });
                    }
                    ui.end_row();
                }
            });
            ui.separator();
            ui.horizontal(|ui| {
                ui.label("Temperature edges (°C):");
                for e in m.temp_edges.iter_mut() {
                    changed |= ui.add(egui::DragValue::new(e).speed(0.5)).drag_stopped();
                }
            });
            ui.horizontal(|ui| {
                ui.label("Moisture edges:");
                for e in m.moist_edges.iter_mut() {
                    changed |= ui.add(egui::DragValue::new(e).speed(0.01).range(0.0..=1.0)).drag_stopped();
                }
            });
            changed |= ui.add(egui::Slider::new(&mut m.alpine_slope, 5.0..=300.0).text("Alpine slope (m/texel)")).drag_stopped();
            if ui.button("Reset to default").clicked() {
                *m = Default::default();
                changed = true;
            }
            if changed {
                actions.push(UiAction::SettingsChanged);
            }
        });
        st.show_biome_matrix = open;
    }

    if let Some(rp) = st.recovery.clone() {
        egui::Window::new("Recover unsaved work?").collapsible(false).resizable(false).show(ctx, |ui| {
            ui.label(format!("An autosave of \"{}\" from {} is newer than the last save.", rp.manifest.name, rp.manifest.saved_at));
            ui.horizontal(|ui| {
                if ui.button("Recover").clicked() {
                    actions.push(UiAction::Recover(rp.clone()));
                    st.recovery = None;
                }
                if ui.button("Discard").clicked() {
                    actions.push(UiAction::DiscardRecovery);
                    st.recovery = None;
                }
            });
        });
    }

    if let Some(err) = st.error.clone() {
        let mut open = true;
        egui::Window::new("Error").open(&mut open).collapsible(false).show(ctx, |ui| {
            ui.label(err);
            if ui.button("OK").clicked() {
                st.error = None;
            }
        });
        if !open {
            st.error = None;
        }
    }

    if st.show_about {
        let mut open = true;
        egui::Window::new("About Isoline").open(&mut open).collapsible(false).show(ctx, |ui| {
            ui.label("Isoline — a field-based fantasy map maker.");
            ui.label("Nothing here is a tile. The coast is the isoline of elevation == sea level.");
        });
        st.show_about = open;
    }

    actions
}
