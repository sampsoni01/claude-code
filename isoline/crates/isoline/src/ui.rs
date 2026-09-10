//! egui panels drawn over the map viewport.

use crate::camera::Camera;
use crate::document::Document;
use crate::gpu::field::ReadbackStats;
use crate::gpu::map_render::ViewMode;
use crate::gpu::profiler::CpuStats;
use crate::tools::{MoistureMode, Tool, ToolState};
use glam::Vec2;
use isoline_core::biome::{Biome, MOIST_BINS, MOIST_BIN_LABELS, TEMP_BINS, TEMP_BIN_LABELS};
use isoline_core::brush::Falloff;
use isoline_core::procedural::{CoastPreset, LandSide};
use isoline_core::project::Manifest;
use isoline_core::terrain::{TerrainParams, TerrainPreset};
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
#[derive(Default)]
pub struct Overlay {
    pub path: Vec<egui::Pos2>,
    pub path_is_coast: bool,
    pub rivers: Vec<Vec<egui::Pos2>>,
    pub lakes: Vec<Vec<egui::Pos2>>,
    pub selected: Option<egui::Pos2>,
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

fn draw_overlay(ctx: &egui::Context, ov: &Overlay) {
    let painter = ctx.layer_painter(egui::LayerId::background());
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

    egui::Panel::left("tools").default_size(250.0).show(root, |ui| {
        egui::ScrollArea::vertical().show(ui, |ui| {
            ui.heading("Tools");
            ui.horizontal_wrapped(|ui| {
                for t in Tool::ALL {
                    let enabled = !t.needs_baked_water() || c.doc.baked.is_some();
                    let r = ui.add_enabled(enabled, egui::Button::selectable(c.tools.tool == t, t.label())).on_hover_text(format!("Hotkey: {}", t.hotkey()));
                    if r.clicked() {
                        actions.push(UiAction::SelectTool(t));
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
                Tool::Pan => {
                    ui.label("Drag to pan. Wheel to zoom.");
                }
            }
            ui.separator();
            ui.small("Left-drag: use tool. Middle/right-drag or Space: pan. Wheel: zoom. [ ]: size.");
        });
    });

    egui::Panel::right("map").default_size(280.0).show(root, |ui| {
        egui::ScrollArea::vertical().show(ui, |ui| {
            ui.heading("Sea level");
            let (lo, hi) = (c.doc.stats.min.min(-1.0), c.doc.stats.max.max(1.0));
            let mut sea = c.doc.sea_level;
            let r = ui.add(egui::Slider::new(&mut sea, lo..=hi).suffix(" m").text("Sea level"));
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
            ui.label(format!("Land: {:.1}%", c.doc.stats.land_fraction * 100.0));
            ui.separator();

            ui.heading("View");
            let mut vm = c.view_mode;
            egui::ComboBox::from_id_salt("view_mode").selected_text(vm.label()).show_ui(ui, |ui| {
                for m in ViewMode::ALL {
                    ui.selectable_value(&mut vm, m, m.label());
                }
            });
            if vm != c.view_mode {
                actions.push(UiAction::ViewMode(vm));
            }
            let mut sw = c.show_water;
            if ui.checkbox(&mut sw, "Rivers and lakes").changed() {
                actions.push(UiAction::ShowWater(sw));
            }
            ui.separator();

            egui::CollapsingHeader::new("Water").default_open(true).show(ui, |ui| {
                let wp = &mut c.doc.params.water;
                let mut changed = false;
                let mut mode = wp.mode;
                egui::ComboBox::from_label("Recompute").selected_text(mode.label()).show_ui(ui, |ui| {
                    for m in RecomputeMode::ALL {
                        ui.selectable_value(&mut mode, m, m.label());
                    }
                });
                if mode != wp.mode {
                    wp.mode = mode;
                    changed = true;
                }
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
                ui.horizontal(|ui| {
                    if ui.button("Recompute water").clicked() {
                        actions.push(UiAction::RecomputeWater);
                    }
                    if c.doc.baked.is_none() {
                        if ui.add_enabled(c.doc.derived.is_some(), egui::Button::new("Bake water")).on_hover_text("Turn rivers and lakes into editable geometry and moisture into a paintable field").clicked() {
                            actions.push(UiAction::BakeWater);
                        }
                    } else if ui.button("Unbake").clicked() {
                        actions.push(UiAction::UnbakeWater);
                    }
                });
                if let Some(p) = c.derived_running {
                    ui.add(egui::ProgressBar::new(p).text("computing"));
                } else if let Some(d) = &c.doc.derived {
                    let state = if c.doc.baked.is_some() {
                        "baked".to_string()
                    } else if c.doc.derived_stale {
                        "out of date".to_string()
                    } else {
                        format!("{}×{} sim", d.timings.water.sim_width, d.timings.water.sim_height)
                    };
                    ui.small(format!("{} rivers, {} lakes · {:.0} ms · {state}", d.water.rivers.len(), d.water.lakes.len(), d.timings.total_ms));
                }
                if changed {
                    actions.push(UiAction::SettingsChanged);
                }
            });

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
                let hy = &mut c.doc.params.water.hydrology;
                let mut changed = false;
                changed |= ui.checkbox(&mut hy.enabled, "Rivers").changed();
                changed |= ui.checkbox(&mut hy.lakes_enabled, "Lakes").changed();
                let mut thr = hy.river_threshold_frac * 1e4;
                if ui.add(egui::Slider::new(&mut thr, 0.1..=50.0).logarithmic(true).text("River threshold")).drag_stopped() {
                    changed = true;
                }
                hy.river_threshold_frac = thr * 1e-4;
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
            ui.separator();
            ui.heading("Shading");
            let rs = &mut c.doc.render;
            ui.add(egui::Slider::new(&mut rs.sun_azimuth_deg, 0.0..=360.0).suffix("°").text("Sun azimuth"));
            ui.add(egui::Slider::new(&mut rs.sun_altitude_deg, 5.0..=85.0).suffix("°").text("Sun altitude"));
            ui.add(egui::Slider::new(&mut rs.hillshade_strength, 0.0..=1.0).text("Hillshade"));
            ui.add(egui::Slider::new(&mut rs.vertical_exaggeration, 0.1..=8.0).logarithmic(true).text("Exaggeration"));
            ui.add(egui::Slider::new(&mut rs.coast_line_width, 0.0..=4.0).text("Coast line"));
            ui.checkbox(&mut rs.show_contours, "Contours");
            if rs.show_contours {
                ui.add(egui::Slider::new(&mut rs.contour_interval, 10.0..=1000.0).logarithmic(true).suffix(" m").text("Interval"));
            }
            ui.separator();
            ui.heading("Field");
            ui.label(format!("{} × {} texels", c.doc.width(), c.doc.height()));
            ui.label(format!(
                "{:.0} m / texel  ({:.0} × {:.0} km, display only)",
                c.doc.meters_per_texel,
                c.doc.width() as f32 * c.doc.meters_per_texel / 1000.0,
                c.doc.height() as f32 * c.doc.meters_per_texel / 1000.0
            ));
            ui.label(format!("Elevation {:.0} … {:.0} m", c.doc.stats.min, c.doc.stats.max));
            ui.separator();
            ui.heading("History");
            ui.label(format!(
                "{} entries, {} in RAM, {} on disk",
                c.doc.undo.len(),
                fmt_bytes(c.doc.undo.loaded_bytes() as u64),
                fmt_bytes(c.doc.undo.spilled_bytes() as u64)
            ));
            ui.horizontal(|ui| {
                if ui.add_enabled(c.doc.undo.can_undo(), egui::Button::new("Undo")).clicked() {
                    actions.push(UiAction::Undo);
                }
                if ui.add_enabled(c.doc.undo.can_redo(), egui::Button::new("Redo")).clicked() {
                    actions.push(UiAction::Redo);
                }
            });
        });
    });

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
            ui.label(&st.status);
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.monospace(format!("{:.1} ms", c.cpu.avg_frame_ms()));
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
