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
use glam::Vec2;
use isoline_core::biome::{Biome, MOIST_BINS, MOIST_BIN_LABELS, TEMP_BINS, TEMP_BIN_LABELS};
use isoline_core::brush::Falloff;
use isoline_core::procedural::{CoastPreset, LandSide};
use isoline_core::project::Manifest;
use isoline_core::terrain::{TerrainParams, TerrainPreset};
use crate::export::{ExportSettings, Reference};
use isoline_core::borders::{BorderKind, BorderStyle};
use isoline_core::settlement::{District, GrowthModel, SettlementKind};
use isoline_core::theme::{Theme, ThemeStyle};
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
    pub borders: Vec<BorderDraw>,
    /// Capital markers with their realm colour (Realms tool only).
    pub capitals: Vec<(egui::Pos2, egui::Color32)>,
    pub settlements: Vec<SettlementDraw>,
    /// Grid overlay: (hex?, cell size in points, screen origin of field (0,0), points per texel).
    pub grid: Option<(bool, f32, egui::Pos2, f32)>,
}

/// A town layout in screen points, ready to draw.
pub struct SettlementDraw {
    pub center: egui::Pos2,
    pub radius_px: f32,
    pub alpha: f32,
    /// Full detail (strokes, towers, handles) rather than the simplified look.
    pub detail: bool,
    pub selected: bool,
    pub handles: bool,
    pub roads: Vec<(Vec<egui::Pos2>, bool)>,
    pub buildings: Vec<(Vec<egui::Pos2>, District, bool)>,
    pub walls: Vec<(Vec<egui::Pos2>, Vec<egui::Pos2>, Vec<egui::Pos2>)>,
    pub plaza: Option<Vec<egui::Pos2>>,
    pub keep: Option<(egui::Pos2, f32)>,
    pub docks: Vec<[egui::Pos2; 2]>,
    pub bridges: Vec<[egui::Pos2; 2]>,
    pub fields: Vec<Vec<egui::Pos2>>,
    pub cemetery: Option<Vec<egui::Pos2>>,
    /// Screen points per texel.
    pub scale: f32,
}

/// A border ready to draw, in screen points.
pub struct BorderDraw {
    pub points: Vec<egui::Pos2>,
    pub style: BorderStyle,
    pub selected: bool,
    pub handles: bool,
    pub color: egui::Color32,
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
            borders: Vec::new(),
            capitals: Vec::new(),
            settlements: Vec::new(),
            grid: None,
        }
    }
}

/// Square or hex grid over the sheet, clipped to the map rectangle.
fn draw_grid(painter: &egui::Painter, ov: &Overlay, hex: bool, spacing: f32, origin: egui::Pos2, scale: f32) {
    let r = ov.map_rect;
    let sp = spacing * scale;
    if sp < 4.0 {
        return;
    }
    let stroke = egui::Stroke::new(0.7, ov.ink.gamma_multiply(0.28));
    let painter = painter.with_clip_rect(r);
    if hex {
        let rad = sp / 2.0;
        let dx = rad * 3f32.sqrt();
        let mut row = 0;
        let mut y = origin.y;
        while y < r.bottom() + rad {
            if y > r.top() - rad {
                let mut x = origin.x + if row % 2 == 0 { 0.0 } else { dx * 0.5 };
                while x < r.right() + dx {
                    if x > r.left() - dx {
                        let pts: Vec<egui::Pos2> = (0..6).map(|k| {
                            let a = (k as f32 + 0.5) * std::f32::consts::FRAC_PI_3;
                            egui::pos2(x + a.cos() * rad, y + a.sin() * rad)
                        }).collect();
                        painter.add(egui::Shape::closed_line(pts, stroke));
                    }
                    x += dx;
                }
            }
            y += rad * 1.5;
            row += 1;
        }
    } else {
        let mut x = origin.x;
        while x <= r.right() {
            if x >= r.left() {
                painter.line_segment([egui::pos2(x, r.top()), egui::pos2(x, r.bottom())], stroke);
            }
            x += sp;
        }
        let mut y = origin.y;
        while y <= r.bottom() {
            if y >= r.top() {
                painter.line_segment([egui::pos2(r.left(), y), egui::pos2(r.right(), y)], stroke);
            }
            y += sp;
        }
    }
}

fn district_fill(d: District, paper: egui::Color32) -> egui::Color32 {
    let k = |c: egui::Color32, m: f32| egui::Color32::from_rgb((c.r() as f32 * m) as u8, (c.g() as f32 * m) as u8, (c.b() as f32 * m) as u8);
    match d {
        District::Market => k(paper, 0.93),
        District::Temple => k(paper, 1.0),
        District::Docks => egui::Color32::from_rgb((paper.r() as f32 * 0.84) as u8, (paper.g() as f32 * 0.86) as u8, (paper.b() as f32 * 0.9) as u8),
        District::Craft => egui::Color32::from_rgb((paper.r() as f32 * 0.9) as u8, (paper.g() as f32 * 0.84) as u8, (paper.b() as f32 * 0.78) as u8),
        District::Noble => k(paper, 0.97),
        District::Slums => k(paper, 0.78),
        District::Garrison => k(paper, 0.82),
        District::Farmland => paper,
        District::Residential => k(paper, 0.88),
    }
}

fn draw_settlement(painter: &egui::Painter, ov: &Overlay, t: &SettlementDraw) {
    let a = |c: egui::Color32, m: f32| c.gamma_multiply(t.alpha * m);
    let ink = a(ov.ink, 1.0);
    let paper = ov.paper;
    let s = t.scale;
    // Fields: hatched rectangles on the fringe.
    for f in &t.fields {
        if f.len() == 4 {
            painter.add(egui::Shape::closed_line(f.clone(), egui::Stroke::new(0.6, a(ov.ink, 0.5))));
            for k in 1..4 {
                let u = k as f32 / 4.0;
                let p0 = f[0] + (f[3] - f[0]) * u;
                let p1 = f[1] + (f[2] - f[1]) * u;
                painter.line_segment([p0, p1], egui::Stroke::new(0.5, a(ov.ink, 0.35)));
            }
        }
    }
    if let Some(p) = &t.plaza {
        painter.add(egui::Shape::convex_polygon(p.clone(), a(paper, 1.0), egui::Stroke::new(0.7, a(ov.ink, 0.6))));
    }
    // Roads: primary as a paper strip edged in ink, secondary as a thin line.
    for (pts, primary) in &t.roads {
        if pts.len() < 2 {
            continue;
        }
        if *primary {
            painter.add(egui::Shape::line(pts.clone(), egui::Stroke::new((2.6 * s).clamp(2.0, 6.0), ink)));
            painter.add(egui::Shape::line(pts.clone(), egui::Stroke::new((1.6 * s).clamp(1.0, 4.0), a(paper, 1.0))));
        } else if t.detail {
            painter.add(egui::Shape::line(pts.clone(), egui::Stroke::new(0.9, a(ov.ink, 0.8))));
        } else {
            painter.add(egui::Shape::line(pts.clone(), egui::Stroke::new(0.7, a(ov.ink, 0.5))));
        }
    }
    for b in &t.bridges {
        let d = (b[1] - b[0]).normalized();
        let n = egui::vec2(-d.y, d.x) * (1.6 * s).max(1.5);
        painter.line_segment([b[0] + n, b[1] + n], egui::Stroke::new(1.2, ink));
        painter.line_segment([b[0] - n, b[1] - n], egui::Stroke::new(1.2, ink));
    }
    // Buildings.
    for (q, district, sel) in &t.buildings {
        let fill = a(district_fill(*district, paper), 1.0);
        let stroke = if t.detail { egui::Stroke::new(0.8, ink) } else { egui::Stroke::new(0.4, a(ov.ink, 0.7)) };
        painter.add(egui::Shape::convex_polygon(q.clone(), fill, stroke));
        if *sel {
            painter.add(egui::Shape::closed_line(q.clone(), egui::Stroke::new(2.0, egui::Color32::from_rgb(255, 210, 90))));
        }
    }
    if let Some(c) = &t.cemetery {
        painter.add(egui::Shape::closed_line(c.clone(), egui::Stroke::new(0.8, a(ov.ink, 0.8))));
        if t.detail && c.len() == 4 {
            for i in 0..3 {
                for j in 0..2 {
                    let u = (i as f32 + 0.5) / 3.0;
                    let v = (j as f32 + 0.5) / 2.0;
                    let p = c[0] + (c[1] - c[0]) * u + (c[3] - c[0]) * v;
                    let h = (1.2 * s).max(2.0);
                    painter.line_segment([p + egui::vec2(0.0, -h), p + egui::vec2(0.0, h)], egui::Stroke::new(0.8, ink));
                    painter.line_segment([p + egui::vec2(-h * 0.6, -h * 0.4), p + egui::vec2(h * 0.6, -h * 0.4)], egui::Stroke::new(0.8, ink));
                }
            }
        }
    }
    // Piers: a narrow outlined deck on posts.
    for d in &t.docks {
        let dir = (d[1] - d[0]).normalized();
        let n = egui::vec2(-dir.y, dir.x) * (1.4 * s).clamp(1.2, 4.0);
        painter.add(egui::Shape::convex_polygon(vec![d[0] + n, d[1] + n, d[1] - n, d[0] - n], a(paper, 1.0), egui::Stroke::new(1.0, ink)));
        if t.detail {
            let len = (d[1] - d[0]).length();
            let step = (3.0 * s).max(4.0);
            let mut k = step;
            while k < len {
                let p = d[0] + dir * k;
                painter.line_segment([p + n, p - n], egui::Stroke::new(0.7, ink));
                k += step;
            }
        }
    }
    // Walls with towers and gates.
    for (ring, towers, gates) in &t.walls {
        if ring.len() < 3 {
            continue;
        }
        painter.add(egui::Shape::closed_line(ring.clone(), egui::Stroke::new((2.4 * s).clamp(2.0, 7.0), ink)));
        painter.add(egui::Shape::closed_line(ring.clone(), egui::Stroke::new((0.8 * s).clamp(0.6, 2.5), a(paper, 0.9))));
        let tw = (3.2 * s).clamp(3.0, 10.0);
        for p in towers {
            painter.rect(egui::Rect::from_center_size(*p, egui::vec2(tw, tw)), egui::CornerRadius::ZERO, ink, egui::Stroke::new(0.8, a(paper, 1.0)), egui::StrokeKind::Inside);
        }
        for p in gates {
            painter.rect(egui::Rect::from_center_size(*p, egui::vec2(tw * 1.3, tw * 0.9)), egui::CornerRadius::ZERO, a(paper, 1.0), egui::Stroke::new(1.0, ink), egui::StrokeKind::Inside);
        }
    }
    if let Some((p, r)) = t.keep {
        let r = r.max(4.0);
        let sq = vec![p + egui::vec2(-r, -r * 0.7), p + egui::vec2(r, -r * 0.7), p + egui::vec2(r, r * 0.7), p + egui::vec2(-r, r * 0.7)];
        painter.add(egui::Shape::convex_polygon(sq, a(district_fill(District::Garrison, paper), 1.0), egui::Stroke::new(1.4, ink)));
        painter.rect(egui::Rect::from_center_size(p + egui::vec2(0.0, -r * 0.4), egui::vec2(r * 0.7, r * 1.1)), egui::CornerRadius::ZERO, ink, egui::Stroke::NONE, egui::StrokeKind::Inside);
    }
    if t.selected {
        painter.circle_stroke(t.center, t.radius_px * 1.15, egui::Stroke::new(1.5, egui::Color32::from_rgba_unmultiplied(255, 210, 90, 160)));
    }
    if t.handles {
        for (pts, _) in &t.roads {
            for p in pts {
                painter.rect(egui::Rect::from_center_size(*p, egui::vec2(5.0, 5.0)), egui::CornerRadius::ZERO, egui::Color32::from_rgb(250, 240, 210), egui::Stroke::new(1.0, ink), egui::StrokeKind::Inside);
            }
        }
        for (ring, _, _) in &t.walls {
            for p in ring {
                painter.circle(*p, 2.6, egui::Color32::from_rgb(250, 240, 210), egui::Stroke::new(1.0, ink));
            }
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
    /// Naturalness or style changed: re-route the selected drawn border.
    BorderSettingsChanged,
    GrowRealms,
    RemoveRegion(u64),
    ClearRealms,
    DeleteSelectedBorder,
    /// Rename generated features inside the realm labelled by this entity.
    PropagateRegionNames(u64),
    SelectRegion(Option<u64>),
    /// Town parameters changed: rebuild the selected town with its seed.
    SettlementParamsChanged,
    RerollSettlement,
    RerollDistrict(District),
    DeleteSettlement,
    DeleteBuilding,
    SetBuildingDistrict(District),
    SelectSettlement(Option<u64>),
    /// Pick a file and start a raster export with these settings.
    ExportImage(ExportSettings),
    ExportSvg,
    ImportTheme,
    ExportTheme,
    /// Apply a theme from the library by name.
    ApplyTheme(String),
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
    pub show_advanced: bool,
    pub show_export: bool,
    pub export: ExportSettings,
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
    pub themes: &'a [Theme],
    pub selected_entity: Option<u64>,
    pub selected_border: Option<u64>,
    pub selected_region: Option<u64>,
    pub realms_running: bool,
    pub selected_settlement: Option<u64>,
    pub selected_building: Option<u32>,
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

pub fn draw_overlay(ctx: &egui::Context, ov: &Overlay) {
    let painter = ctx.layer_painter(egui::LayerId::background());
    if ov.show_ornaments {
        draw_ornaments(&painter, ov);
    }
    if let Some((hex, spacing, origin, scale)) = ov.grid {
        draw_grid(&painter, ov, hex, spacing, origin, scale);
    }
    for t in &ov.settlements {
        draw_settlement(&painter, ov, t);
    }
    for b in &ov.borders {
        if b.selected {
            painter.add(egui::Shape::line(b.points.clone(), egui::Stroke::new(6.0, egui::Color32::from_rgba_unmultiplied(255, 210, 90, 90))));
        }
        let stroke = egui::Stroke::new(1.7, b.color);
        match b.style {
            BorderStyle::Solid => {
                painter.add(egui::Shape::line(b.points.clone(), stroke));
            }
            BorderStyle::Dashed => {
                painter.extend(egui::Shape::dashed_line(&b.points, stroke, 9.0, 5.0));
            }
            BorderStyle::DashDot => {
                painter.extend(egui::Shape::dashed_line_with_offset(&b.points, stroke, &[10.0, 2.0], &[5.0, 5.0], 0.0));
            }
            BorderStyle::Dotted => {
                painter.extend(egui::Shape::dotted_line(&b.points, b.color, 5.0, 1.3));
            }
        }
        if b.handles {
            for p in &b.points {
                painter.rect(egui::Rect::from_center_size(*p, egui::vec2(6.0, 6.0)), egui::CornerRadius::ZERO, egui::Color32::from_rgb(250, 240, 210), egui::Stroke::new(1.0, b.color), egui::StrokeKind::Inside);
            }
        }
    }
    for (p, col) in &ov.capitals {
        painter.circle(*p, 7.0, *col, egui::Stroke::new(1.5, egui::Color32::from_rgb(40, 30, 20)));
        painter.text(*p + egui::vec2(0.0, -1.0), egui::Align2::CENTER_CENTER, "★", egui::FontId::proportional(9.0), egui::Color32::from_rgb(250, 240, 210));
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
        Tool::Border => {
            // A dash-dot frontier with a survey point at each bend.
            let pts = [pt(-0.75, 0.5), pt(-0.3, 0.1), pt(0.1, 0.25), pt(0.4, -0.3), pt(0.75, -0.55)];
            p.extend(egui::Shape::dashed_line(&pts, egui::Stroke::new(1.8, egui::Color32::from_rgb(220, 120, 100)), 5.0, 3.5));
            for q in [pts[1], pts[3]] {
                p.circle_filled(q, 2.4, ink);
            }
        }
        Tool::Territory => {
            // Two realms sharing a border, a capital star in each.
            let a = vec![pt(-0.75, -0.6), pt(0.1, -0.7), pt(-0.05, 0.05), pt(0.15, 0.7), pt(-0.75, 0.6)];
            let b = vec![pt(0.1, -0.7), pt(0.75, -0.55), pt(0.75, 0.6), pt(0.15, 0.7), pt(-0.05, 0.05)];
            p.add(egui::Shape::convex_polygon(a, egui::Color32::from_rgba_unmultiplied(210, 110, 95, 110), egui::Stroke::new(1.2, ink)));
            p.add(egui::Shape::convex_polygon(b, egui::Color32::from_rgba_unmultiplied(105, 150, 200, 110), egui::Stroke::new(1.2, ink)));
            p.text(pt(-0.38, 0.0), egui::Align2::CENTER_CENTER, "★", egui::FontId::proportional(u * 0.5), ink);
            p.text(pt(0.42, 0.05), egui::Align2::CENTER_CENTER, "★", egui::FontId::proportional(u * 0.5), ink);
        }
        Tool::Settlement => {
            // A row of gabled houses behind a wall line.
            for (x, w, h) in [(-0.55, 0.32, 0.3), (-0.12, 0.28, 0.42), (0.3, 0.34, 0.34)] {
                let base = 0.35;
                let body = vec![pt(x - w / 2.0, base), pt(x + w / 2.0, base), pt(x + w / 2.0, base - h), pt(x, base - h - w * 0.55), pt(x - w / 2.0, base - h)];
                p.add(egui::Shape::closed_line(body, egui::Stroke::new(1.5, ink)));
            }
            p.line_segment([pt(-0.8, 0.55), pt(0.8, 0.55)], egui::Stroke::new(2.2, ink));
            for x in [-0.7, -0.35, 0.0, 0.35, 0.7] {
                p.rect_filled(egui::Rect::from_center_size(pt(x, 0.55), egui::vec2(4.0, 6.0)), 0.0, ink);
            }
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
    ui.add(egui::Slider::new(&mut b.radius, 1.0..=1024.0).logarithmic(true).text("Size"));
    ui.add(egui::Slider::new(&mut b.strength, 0.0..=1.0).text("Strength"));
    more(ui, "brush_more", |ui| {
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
    });
}

/// The rarely-needed options of a tool, folded away under one line.
fn more(ui: &mut egui::Ui, id: &str, add: impl FnOnce(&mut egui::Ui)) {
    egui::CollapsingHeader::new(egui::RichText::new("More…").small()).id_salt(id).default_open(false).show(ui, add);
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
                if ui.button("Export image…").clicked() {
                    st.show_export = true;
                    ui.close();
                }
                if ui.button("Import theme…").clicked() {
                    actions.push(UiAction::ImportTheme);
                    ui.close();
                }
                if ui.button("Export theme…").clicked() {
                    actions.push(UiAction::ExportTheme);
                    ui.close();
                }
                ui.separator();
                if ui.button("Export vector (SVG)…").clicked() {
                    actions.push(UiAction::ExportSvg);
                    ui.close();
                }
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
                let mut sw = c.show_water;
                if ui.checkbox(&mut sw, "Rivers and lakes").changed() {
                    actions.push(UiAction::ShowWater(sw));
                }
                ui.separator();
                if ui.button("Advanced settings…").clicked() {
                    st.show_advanced = true;
                    ui.close();
                }
                ui.checkbox(&mut st.show_profiler, "Profiler          F3");
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
                    ui.heading(match c.tools.tool {
                        Tool::Raise => "Raise land",
                        Tool::Lower => "Lower land",
                        Tool::Smooth => "Smooth",
                        _ => "Flatten",
                    });
                    let show_amount = matches!(c.tools.tool, Tool::Raise | Tool::Lower);
                    brush_sliders(ui, &mut c.tools.brush, show_amount, "Metres per dab", 500.0);
                }
                Tool::Moisture => {
                    ui.heading("Moisture");
                    ui.small("Wetter ground grows forest and marsh; drier ground turns to steppe and desert.");
                    ui.horizontal(|ui| {
                        ui.selectable_value(&mut c.tools.moisture_mode, MoistureMode::Wetter, "Wetter");
                        ui.selectable_value(&mut c.tools.moisture_mode, MoistureMode::Drier, "Drier");
                        ui.selectable_value(&mut c.tools.moisture_mode, MoistureMode::Smooth, "Smooth");
                    });
                    let show_amount = c.tools.moisture_mode != MoistureMode::Smooth;
                    brush_sliders(ui, &mut c.tools.moisture_brush, show_amount, "Moisture per dab", 0.5);
                }
                Tool::Ridge => {
                    ui.heading("Mountain range");
                    ui.small("Drag the spine of the range. Changing a setting rebuilds the last one.");
                    let r = &mut c.tools.ridge;
                    let mut ch = false;
                    ch |= ui.add(egui::Slider::new(&mut r.width, 4.0..=600.0).logarithmic(true).text("Width")).drag_stopped();
                    ch |= ui.add(egui::Slider::new(&mut r.height, 50.0..=6000.0).logarithmic(true).suffix(" m").text("Height")).drag_stopped();
                    ch |= ui.add(egui::Slider::new(&mut r.weathering, 0.0..=1.0).text("Young ↔ old")).drag_stopped();
                    more(ui, "ridge_more", |ui| {
                        ch |= ui.add(egui::Slider::new(&mut r.roughness, 0.0..=1.0).text("Roughness")).drag_stopped();
                        ch |= ui.add(egui::Slider::new(&mut r.sharpness, 0.0..=1.0).text("Sharpness")).drag_stopped();
                        ch |= ui.add(egui::Slider::new(&mut r.asymmetry, -1.0..=1.0).text("Asymmetry")).drag_stopped();
                        ch |= ui.add(egui::Slider::new(&mut r.spur_frequency, 0.0..=1.0).text("Spurs")).drag_stopped();
                        let mut seed = r.seed as i64;
                        if ui.add(egui::DragValue::new(&mut seed).prefix("Seed ")).drag_stopped() {
                            ch = true;
                        }
                        r.seed = seed.max(0) as u64;
                    });
                    if ch && c.has_last_procedural == Some(Tool::Ridge) {
                        actions.push(UiAction::ReapplyLastStroke);
                    }
                }
                Tool::Coast => {
                    ui.heading("Coastline");
                    ui.small("Drag a rough line where the shore should run. Land lies to one side of the stroke.");
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
                        ui.label("Land on the");
                        ch |= ui.selectable_value(&mut cp.land_side, LandSide::Left, "left").changed();
                        ch |= ui.selectable_value(&mut cp.land_side, LandSide::Right, "right").changed();
                    });
                    let mut tweak = false;
                    tweak |= ui.add(egui::Slider::new(&mut cp.band, 8.0..=800.0).logarithmic(true).text("Width")).drag_stopped();
                    more(ui, "coast_more", |ui| {
                        tweak |= ui.add(egui::Slider::new(&mut cp.roughness, 0.0..=1.0).text("Roughness")).drag_stopped();
                        tweak |= ui.add(egui::Slider::new(&mut cp.inlet_frequency, 0.0..=1.0).text("Inlets")).drag_stopped();
                        tweak |= ui.add(egui::Slider::new(&mut cp.inlet_depth, 0.0..=2.5).text("Inlet depth")).drag_stopped();
                        tweak |= ui.add(egui::Slider::new(&mut cp.headland_bias, -1.0..=1.0).text("Bays ↔ headlands")).drag_stopped();
                        tweak |= ui.add(egui::Slider::new(&mut cp.island_density, 0.0..=1.0).text("Islands")).drag_stopped();
                        tweak |= ui.add(egui::Slider::new(&mut cp.skerry_density, 0.0..=1.0).text("Skerries")).drag_stopped();
                        tweak |= ui.add(egui::Slider::new(&mut cp.gradient, 0.0..=1.0).text("Gradient")).drag_stopped();
                        tweak |= ui.add(egui::Slider::new(&mut cp.land_height, 5.0..=3000.0).logarithmic(true).suffix(" m").text("Land height")).drag_stopped();
                        tweak |= ui.add(egui::Slider::new(&mut cp.shelf_depth, 5.0..=2000.0).logarithmic(true).suffix(" m").text("Shelf depth")).drag_stopped();
                        let mut oct = cp.octaves as i32;
                        if ui.add(egui::Slider::new(&mut oct, 1..=8).text("Detail")).drag_stopped() {
                            tweak = true;
                        }
                        cp.octaves = oct as u32;
                        let mut seed = cp.seed as i64;
                        if ui.add(egui::DragValue::new(&mut seed).prefix("Seed ")).drag_stopped() {
                            tweak = true;
                        }
                        cp.seed = seed.max(0) as u64;
                    });
                    if tweak && cp.preset != CoastPreset::Custom {
                        cp.preset = CoastPreset::Custom;
                    }
                    if (ch || tweak) && c.has_last_procedural == Some(Tool::Coast) {
                        actions.push(UiAction::ReapplyLastStroke);
                    }
                }
                Tool::WaterEdit => {
                    ui.heading("Edit rivers and lakes");
                    ui.small("Drag a river or lake point to move it. Delete removes the selected feature.");
                    if let Some(sel) = c.water_selected {
                        ui.label(match sel {
                            WaterSel::River { river, .. } => format!("River {river} selected"),
                            WaterSel::Lake { lake, .. } => format!("Lake {lake} selected"),
                        });
                        if ui.button("Delete feature").clicked() {
                            actions.push(UiAction::DeleteSelectedWater);
                        }
                    }
                }
                Tool::Place => {
                    ui.heading("Place symbol");
                    ui.small("Pick a symbol below and click the map. Drag a placed symbol to move it. [ ] resize, Delete removes.");
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
                }
                Tool::Scatter => {
                    ui.heading("Scatter symbols");
                    ui.small("Paint with the selected symbols (shift-click picks several).");
                    let sc = &mut c.tools.scatter;
                    ui.add(egui::Slider::new(&mut sc.radius, 8.0..=800.0).logarithmic(true).text("Size"));
                    ui.add(egui::Slider::new(&mut sc.spacing, 3.0..=200.0).logarithmic(true).text("Spacing"));
                    ui.checkbox(&mut sc.erase, "Erase");
                    more(ui, "scatter_more", |ui| {
                        ui.add(egui::Slider::new(&mut sc.size_jitter, 0.0..=0.8).text("Size jitter"));
                        ui.add(egui::Slider::new(&mut sc.rotation_jitter_deg, 0.0..=180.0).text("Rotation jitter"));
                        ui.add(egui::Slider::new(&mut sc.max_slope, 1.0..=400.0).logarithmic(true).text("Max slope"));
                        ui.checkbox(&mut sc.flip, "Random flip");
                        ui.checkbox(&mut sc.avoid_water, "Avoid water");
                    });
                }
                Tool::Name => {
                    ui.heading("Names");
                    ui.small("Click a river, lake, symbol or the sea to name it. Drag a label to move it.");
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
                            let r = ui.add(egui::Slider::new(&mut e.label.size_mult, 0.4..=3.0).text("Label size"));
                            changed |= r.changed();
                            released |= r.drag_stopped();
                            let r = ui.checkbox(&mut e.label.hidden, "Hide label");
                            changed |= r.changed();
                            released |= r.changed();
                            more(ui, "name_more", |ui| {
                                let r = ui.add(egui::Slider::new(&mut e.importance, 0.0..=1.0).text("Importance"));
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
                                let r = ui.checkbox(&mut e.label.pinned, "Always shown");
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
                                let r = ui.add(egui::TextEdit::multiline(&mut e.notes).desired_rows(3).desired_width(f32::INFINITY));
                                changed |= r.changed();
                                released |= r.lost_focus();
                            });
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
                            if c.doc.regions.iter().any(|r| r.entity == Some(id)) && ui.button("Rename features inside in this language").on_hover_text("Generated names inside the realm are redrawn from this label's language; names you typed are kept").clicked() {
                                actions.push(UiAction::PropagateRegionNames(id));
                            }
                            if ui.button("Delete name").clicked() {
                                actions.push(UiAction::DeleteEntity(id));
                            }
                        }
                        None => {
                            ui.label(format!("{} named features", c.doc.entities.len()));
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
                Tool::Border => {
                    ui.heading("Border");
                    ui.small("Drag a rough line; the border finds its way along rivers, ridges and coasts. End near the start to close a region. Drag a point to adjust; click a border to select it.");
                    let mut ch = false;
                    ch |= ui.add(egui::Slider::new(&mut c.tools.border_naturalness, 0.0..=1.0).text("Surveyed ↔ natural")).drag_stopped();
                    let mut style = c.tools.border_style;
                    egui::ComboBox::from_label("Line").selected_text(style.label()).show_ui(ui, |ui| {
                        for st in BorderStyle::ALL {
                            ui.selectable_value(&mut style, st, st.label());
                        }
                    });
                    if style != c.tools.border_style {
                        c.tools.border_style = style;
                        ch = true;
                    }
                    if let Some(bid) = c.selected_border {
                        if let Some(b) = c.doc.borders.iter().find(|b| b.id == bid) {
                            ui.separator();
                            ui.label(match b.kind {
                                BorderKind::Drawn if b.left != 0 => "Selected: drawn region outline",
                                BorderKind::Drawn => "Selected: drawn border",
                                BorderKind::Grown => "Selected: realm border",
                            });
                            if b.kind == BorderKind::Drawn && ui.button("Delete border").clicked() {
                                actions.push(UiAction::DeleteSelectedBorder);
                            }
                        }
                    }
                    if ch && c.selected_border.is_some() {
                        actions.push(UiAction::BorderSettingsChanged);
                    }
                }
                Tool::Territory => {
                    ui.heading("Realms");
                    ui.small("Click the map to place a capital. Each capital grows a realm by travel cost: rivers and coasts carry it far, mountains hold it back. Drag border points to adjust.");
                    if c.realms_running {
                        ui.add(egui::ProgressBar::new(0.5).animate(true).text("growing realms"));
                    }
                    let regions: Vec<(u64, u32, String)> = c
                        .doc
                        .regions
                        .iter()
                        .map(|r| (r.id, r.color, r.entity.and_then(|e| c.doc.entity(e)).map(|e| e.name.clone()).unwrap_or_else(|| format!("Realm {}", r.id))))
                        .collect();
                    if regions.is_empty() {
                        ui.label("No realms yet.");
                    }
                    let mut remove = None;
                    for (id, color, name) in &regions {
                        ui.horizontal(|ui| {
                            let (rect, _) = ui.allocate_exact_size(egui::vec2(14.0, 14.0), egui::Sense::hover());
                            ui.painter().rect(rect, egui::CornerRadius::same(3), crate::app::region_color(*color), egui::Stroke::new(1.0, egui::Color32::from_rgb(60, 48, 36)), egui::StrokeKind::Inside);
                            let sel = c.selected_region == Some(*id);
                            if ui.selectable_label(sel, name).clicked() {
                                actions.push(UiAction::SelectRegion(if sel { None } else { Some(*id) }));
                            }
                            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                                if ui.small_button("✕").on_hover_text("Remove this realm").clicked() {
                                    remove = Some(*id);
                                }
                            });
                        });
                    }
                    if let Some(id) = remove {
                        actions.push(UiAction::RemoveRegion(id));
                    }
                    ui.horizontal(|ui| {
                        if ui.add_enabled(!regions.is_empty() && !c.realms_running, egui::Button::new("Regrow")).on_hover_text("Grow every realm again from its capital. Dragged borders are reset.").clicked() {
                            actions.push(UiAction::GrowRealms);
                        }
                        if ui.add_enabled(!regions.is_empty(), egui::Button::new("Clear")).clicked() {
                            actions.push(UiAction::ClearRealms);
                        }
                    });
                    ui.small("Name a realm with the Name tool; its label offers to rename the features inside it.");
                }
                Tool::Settlement => {
                    ui.heading("Towns");
                    ui.small("Click open land to found a town. Click a town to select it. Zoom in past 280% to drag streets and walls; click a building to move or delete it.");
                    let sp = &mut c.tools.settlement;
                    let has_sel = c.selected_settlement.is_some();
                    let mut ch = false;
                    let mut kind = sp.kind;
                    egui::ComboBox::from_id_salt("town_kind").selected_text(kind.label()).show_ui(ui, |ui| {
                        for k in SettlementKind::ALL {
                            ui.selectable_value(&mut kind, k, k.label());
                        }
                    });
                    if kind != sp.kind {
                        sp.kind = kind;
                        ch = true;
                    }
                    let mut model = sp.model;
                    egui::ComboBox::from_id_salt("town_model").selected_text(model.label()).show_ui(ui, |ui| {
                        for m in GrowthModel::ALL {
                            ui.selectable_value(&mut model, m, m.label());
                        }
                    });
                    if model != sp.model {
                        sp.model = model;
                        ch = true;
                    }
                    ch |= ui.add(egui::Slider::new(&mut sp.size, 0.4..=2.5).text("Size")).drag_stopped();
                    more(ui, "town_more", |ui| {
                        ch |= ui.add(egui::Slider::new(&mut sp.density, 0.1..=1.0).text("Density")).drag_stopped();
                        ch |= ui.add(egui::Slider::new(&mut sp.irregularity, 0.0..=1.0).text("Irregularity")).drag_stopped();
                        ch |= ui.checkbox(&mut sp.walls, "Walls").changed();
                        if sp.walls {
                            let mut two = sp.rings >= 2;
                            if ui.checkbox(&mut two, "Older inner wall").changed() {
                                sp.rings = if two { 2 } else { 1 };
                                ch = true;
                            }
                        }
                        let mut seed = sp.seed as i64;
                        if ui.add(egui::DragValue::new(&mut seed).prefix("Seed ")).drag_stopped() {
                            ch = true;
                        }
                        sp.seed = seed.max(0) as u64;
                    });
                    if ch && has_sel {
                        actions.push(UiAction::SettlementParamsChanged);
                    }
                    if has_sel {
                        ui.separator();
                        if let Some(st) = c.selected_settlement.and_then(|id| c.doc.settlement(id)) {
                            let name = st.entity.and_then(|e| c.doc.entity(e)).map(|e| e.name.clone()).unwrap_or_else(|| "Town".into());
                            ui.label(egui::RichText::new(format!("{name} · {} buildings", st.layout.buildings.len())).font(serif_italic(16.0)));
                        }
                        ui.horizontal(|ui| {
                            if ui.button("Re-roll").on_hover_text("New seed, same settings").clicked() {
                                actions.push(UiAction::RerollSettlement);
                            }
                            if ui.button("Delete town").clicked() {
                                actions.push(UiAction::DeleteSettlement);
                            }
                        });
                        ui.horizontal(|ui| {
                            egui::ComboBox::from_id_salt("paint_kind").selected_text(c.tools.paint_kind.label()).show_ui(ui, |ui| {
                                for d in District::ALL {
                                    ui.selectable_value(&mut c.tools.paint_kind, d, d.label());
                                }
                            });
                            if ui.button("Re-roll district").on_hover_text("Regenerate only this district's buildings").clicked() {
                                actions.push(UiAction::RerollDistrict(c.tools.paint_kind));
                            }
                        });
                        ui.checkbox(&mut c.tools.paint_district, "Paint district").on_hover_text("Drag over buildings to give them the district chosen above");
                        if c.tools.paint_district {
                            ui.add(egui::Slider::new(&mut c.tools.paint_radius, 4.0..=120.0).logarithmic(true).text("Brush"));
                        }
                        if let Some(bid) = c.selected_building {
                            if let Some(b) = c.selected_settlement.and_then(|id| c.doc.settlement(id)).and_then(|s| s.layout.buildings.iter().find(|b| b.id == bid)) {
                                ui.separator();
                                let mut d = b.district;
                                egui::ComboBox::from_label("Building").selected_text(d.label()).show_ui(ui, |ui| {
                                    for k in District::ALL {
                                        ui.selectable_value(&mut d, k, k.label());
                                    }
                                });
                                if d != b.district {
                                    actions.push(UiAction::SetBuildingDistrict(d));
                                }
                                if ui.button("Delete building").clicked() {
                                    actions.push(UiAction::DeleteBuilding);
                                }
                            }
                        }
                        if ui.small_button("Deselect").clicked() {
                            actions.push(UiAction::SelectSettlement(None));
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

    egui::Panel::right("map").default_size(272.0).show(root, |ui| {
        egui::ScrollArea::vertical().show(ui, |ui| {
            ui.add_space(4.0);
            ui.heading("Map");
            let current = c.doc.render.theme.name.clone();
            let mut pick: Option<String> = None;
            egui::ComboBox::from_label("Style").selected_text(&current).show_ui(ui, |ui| {
                for t in c.themes {
                    if ui.selectable_label(t.name == current, &t.name).clicked() {
                        pick = Some(t.name.clone());
                    }
                }
            });
            if let Some(name) = pick {
                if name != current {
                    actions.push(UiAction::ApplyTheme(name));
                }
            }
            let _ = (ThemeStyle::ALL, Theme::preset);
            ui.add_space(6.0);
            ui.label(egui::RichText::new("Sea level").strong());
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
                let hy = &mut wp.hydrology;
                // Displayed as "more rivers" = lower threshold.
                let mut more_rivers = (50.0 - hy.river_threshold_frac * 1e4).clamp(0.0, 49.9);
                let r = ui.add(egui::Slider::new(&mut more_rivers, 0.0..=49.9).text("Fewer ↔ more"));
                if r.changed() {
                    hy.river_threshold_frac = (50.0 - more_rivers) * 1e-4;
                }
                if r.drag_stopped() {
                    changed = true;
                }
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
                ui.horizontal(|ui| {
                    if ui.button("Recompute").on_hover_text("Ctrl+R").clicked() {
                        actions.push(UiAction::RecomputeWater);
                    }
                    if c.doc.baked.is_none() {
                        if ui.add_enabled(c.doc.derived.is_some(), egui::Button::new("Bake")).on_hover_text("Freeze rivers and lakes so you can edit them by hand and paint moisture").clicked() {
                            actions.push(UiAction::BakeWater);
                        }
                    } else if ui.button("Unbake").on_hover_text("Go back to rivers and lakes that follow the terrain").clicked() {
                        actions.push(UiAction::UnbakeWater);
                    }
                });
                if let Some(p) = c.derived_running {
                    ui.add(egui::ProgressBar::new(p).text("updating"));
                } else if let Some(d) = &c.doc.derived {
                    let state = if c.doc.baked.is_some() { "baked, editable" } else if c.doc.derived_stale { "out of date" } else { "up to date" };
                    ui.small(format!("{} rivers, {} lakes · {state}", d.water.rivers.len(), d.water.lakes.len()));
                }
                if changed {
                    actions.push(UiAction::SettingsChanged);
                }
            }
            ui.separator();

            ui.heading("Names");
            ui.horizontal(|ui| {
                let current = c.cultures.iter().find(|k| k.id == c.doc.culture).map(|k| k.pack.name.clone()).unwrap_or_else(|| c.doc.culture.clone());
                egui::ComboBox::from_id_salt("culture").selected_text(current).show_ui(ui, |ui| {
                    for k in c.cultures {
                        ui.selectable_value(&mut c.doc.culture, k.id.clone(), &k.pack.name).on_hover_text(&k.pack.description);
                    }
                });
                ui.label("Language");
            });
            if ui.button("Name everything").on_hover_text("Generate names for lakes, rivers, ranges, forests, settlements and the sea").clicked() {
                actions.push(UiAction::NameEverything);
            }
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

    if st.show_export {
        let mut open = true;
        let mut go = false;
        egui::Window::new("Export image").open(&mut open).collapsible(false).resizable(false).show(ctx, |ui| {
            let e = &mut st.export;
            let fw = c.doc.width() as f32;
            let fh = c.doc.height() as f32;
            ui.add(egui::Slider::new(&mut e.scale, 0.25..=8.0).logarithmic(true).text("Pixels per texel"));
            let w = ((fw + 2.0 * e.bleed) * e.scale).round() as u32;
            let h = ((fh + 2.0 * e.bleed) * e.scale).round() as u32;
            ui.label(format!("{w} × {h} pixels · {:.1} × {:.1} in at {} dpi", w as f32 / e.dpi.max(1) as f32, h as f32 / e.dpi.max(1) as f32, e.dpi));
            ui.horizontal(|ui| {
                ui.selectable_value(&mut e.jpeg, false, "PNG");
                ui.selectable_value(&mut e.jpeg, true, "JPEG");
                let mut dpi = e.dpi as i32;
                ui.add(egui::DragValue::new(&mut dpi).range(36..=1200).suffix(" dpi"));
                e.dpi = dpi.max(36) as u32;
            });
            if e.jpeg {
                let mut q = e.quality as i32;
                ui.add(egui::Slider::new(&mut q, 30..=100).text("Quality"));
                e.quality = q as u8;
            } else {
                ui.checkbox(&mut e.transparent, "Transparent outside the sheet");
            }
            ui.add(egui::Slider::new(&mut e.bleed, 0.0..=200.0).text("Bleed (texels)")).on_hover_text("Extra margin around the sheet for print trimming");
            ui.checkbox(&mut e.separate_layers, "Separate layers").on_hover_text("Terrain, symbols and labels/borders/towns as three files");
            ui.horizontal(|ui| {
                ui.label("Labels and detail as in the");
                ui.selectable_value(&mut e.reference, Reference::Fit, "fitted view");
                ui.selectable_value(&mut e.reference, Reference::Current, "current view");
            });
            if w as u64 * h as u64 > 400_000_000 {
                ui.colored_label(egui::Color32::from_rgb(230, 170, 80), "Very large: the export streams to disk but will take a while.");
            }
            ui.horizontal(|ui| {
                if ui.button("Export…").clicked() {
                    go = true;
                }
                if ui.button("Cancel").clicked() {
                    st.show_export = false;
                }
            });
        });
        if go {
            actions.push(UiAction::ExportImage(st.export.clone()));
            st.show_export = false;
        }
        if !open {
            st.show_export = false;
        }
    }

    if st.show_advanced {
        let mut open = true;
        egui::Window::new("Advanced settings").open(&mut open).default_width(340.0).default_pos((280.0, 60.0)).show(ctx, |ui| {
            ui.small("Everything here has a sensible default. Ordinary map making never needs it.");
            egui::CollapsingHeader::new("Data views").default_open(true).show(ui, |ui| {
                let mut vm = c.view_mode;
                egui::ComboBox::from_id_salt("view_mode").selected_text(vm.label()).show_ui(ui, |ui| {
                    for m in ViewMode::ALL {
                        ui.selectable_value(&mut vm, m, m.label());
                    }
                });
                if vm != c.view_mode {
                    actions.push(UiAction::ViewMode(vm));
                }
                let rs = &mut c.doc.render;
                ui.checkbox(&mut rs.show_contours, "Contour lines");
                if rs.show_contours {
                    ui.add(egui::Slider::new(&mut rs.contour_interval, 10.0..=1000.0).logarithmic(true).suffix(" m").text("Interval"));
                }
                ui.horizontal(|ui| {
                    egui::ComboBox::from_id_salt("grid_kind").selected_text(rs.grid.kind.label()).show_ui(ui, |ui| {
                        for k in isoline_core::project::GridKind::ALL {
                            ui.selectable_value(&mut rs.grid.kind, k, k.label());
                        }
                    });
                    ui.label("Grid overlay (display only)");
                });
                if rs.grid.kind != isoline_core::project::GridKind::None {
                    ui.add(egui::Slider::new(&mut rs.grid.spacing, 8.0..=512.0).logarithmic(true).text("Cell size (texels)"));
                }
            });
            egui::CollapsingHeader::new("Automatic symbols").default_open(false).show(ui, |ui| {
                let sy = &mut c.doc.symbols;
                let mut sym_changed = false;
                sym_changed |= ui.checkbox(&mut sy.mountains.enabled, "Mountain and hill symbols").changed();
                sym_changed |= ui.add(egui::Slider::new(&mut sy.mountains.spacing, 8.0..=120.0).logarithmic(true).text("Peak spacing")).drag_stopped();
                sym_changed |= ui.add(egui::Slider::new(&mut sy.mountains.size, 0.3..=3.0).text("Peak size")).drag_stopped();
                sym_changed |= ui.add(egui::Slider::new(&mut sy.forest.spacing, 4.0..=60.0).logarithmic(true).text("Tree spacing")).drag_stopped();
                sym_changed |= ui.add(egui::Slider::new(&mut sy.forest.size, 0.3..=3.0).text("Tree size")).drag_stopped();
                sym_changed |= ui.add(egui::Slider::new(&mut sy.forest.threshold, 0.0..=1.0).text("Tree cover")).drag_stopped();
                if sym_changed {
                    actions.push(UiAction::SymbolsChanged);
                }
            });
            egui::CollapsingHeader::new("Climate").default_open(false).show(ui, |ui| {
                let cl = &mut c.doc.params.water.climate;
                let mut changed = false;
                changed |= ui.checkbox(&mut cl.moisture_enabled, "Rain shadow from wind").changed();
                if cl.moisture_enabled {
                    changed |= ui.add(egui::Slider::new(&mut cl.wind_deg, 0.0..=360.0).suffix("°").text("Wind toward")).drag_stopped();
                    changed |= ui.add(egui::Slider::new(&mut cl.orographic, 0.0..=1.0).text("Rain shadow strength")).drag_stopped();
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
                changed |= ui.checkbox(&mut hy.lakes_enabled, "Lakes").changed();
                changed |= ui.add(egui::Slider::new(&mut hy.river_width_scale, 0.2..=5.0).text("River width")).drag_stopped();
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
            ui.small(format!("{} × {} texels · {:.0} m/texel (display only)", c.doc.width(), c.doc.height(), c.doc.meters_per_texel));
            ui.small(format!("Elevation {:.0} … {:.0} m", c.doc.stats.min, c.doc.stats.max));
            ui.small(format!(
                "History: {} entries, {} in RAM, {} on disk",
                c.doc.undo.len(),
                fmt_bytes(c.doc.undo.loaded_bytes() as u64),
                fmt_bytes(c.doc.undo.spilled_bytes() as u64)
            ));
        });
        st.show_advanced = open;
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
