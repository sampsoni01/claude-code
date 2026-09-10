//! egui panels drawn over the map viewport.

use crate::camera::Camera;
use crate::document::Document;
use crate::gpu::field::ReadbackStats;
use crate::gpu::map_render::ViewMode;
use crate::gpu::profiler::CpuStats;
use crate::tools::{Tool, ToolState};
use glam::Vec2;
use isoline_core::biome::{Biome, MOIST_BINS, MOIST_BIN_LABELS, TEMP_BINS, TEMP_BIN_LABELS};
use isoline_core::brush::Falloff;
use isoline_core::project::Manifest;
use isoline_core::terrain::{TerrainParams, TerrainPreset};
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

pub fn draw(root: &mut egui::Ui, st: &mut UiState, c: UiContext) -> Vec<UiAction> {
    let mut actions = Vec::new();
    let ctx = root.ctx().clone();
    let ctx = &ctx;

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

    egui::Panel::left("tools").default_size(230.0).show(root, |ui| {
        ui.heading("Tools");
        ui.horizontal_wrapped(|ui| {
            for t in Tool::ALL {
                let r = ui.selectable_label(c.tools.tool == t, t.label()).on_hover_text(format!("Hotkey: {}", t.hotkey()));
                if r.clicked() {
                    c.tools.tool = t;
                }
            }
        });
        ui.separator();
        ui.heading("Brush");
        let b = &mut c.tools.brush;
        ui.add(egui::Slider::new(&mut b.radius, 1.0..=1024.0).logarithmic(true).text("Radius (texels)"));
        ui.add(egui::Slider::new(&mut b.strength, 0.0..=1.0).text("Strength"));
        if matches!(c.tools.tool, Tool::Raise | Tool::Lower) {
            ui.add(egui::Slider::new(&mut b.amount, 1.0..=500.0).logarithmic(true).text("Metres per dab"));
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
        ui.separator();
        ui.small("Left-drag: paint. Middle/right-drag or Space: pan. Wheel: zoom. [ ]: radius.");
    });

    egui::Panel::right("map").default_size(260.0).show(root, |ui| {
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
        if let Some(p) = c.derived_running {
            ui.add(egui::ProgressBar::new(p).text("computing rivers & biomes"));
        } else if let Some(d) = &c.doc.derived {
            ui.small(format!("{} rivers, {} lakes · {:.0} ms", d.rivers.len(), d.lakes.len(), d.timings.total_ms));
        }
        ui.separator();
        egui::CollapsingHeader::new("Climate").default_open(true).show(ui, |ui| {
            let cl = &mut c.doc.params.climate;
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
        egui::CollapsingHeader::new("Hydrology").default_open(true).show(ui, |ui| {
            let hy = &mut c.doc.params.hydrology;
            let mut changed = false;
            changed |= ui.checkbox(&mut hy.enabled, "Rivers").changed();
            changed |= ui.checkbox(&mut hy.lakes_enabled, "Lakes").changed();
            changed |= ui.checkbox(&mut hy.deltas, "Deltas").changed();
            let mut thr = hy.river_threshold_frac * 1e4;
            if ui.add(egui::Slider::new(&mut thr, 0.1..=50.0).logarithmic(true).text("River threshold")).drag_stopped() {
                changed = true;
            }
            hy.river_threshold_frac = thr * 1e-4;
            changed |= ui.add(egui::Slider::new(&mut hy.river_width_scale, 0.2..=5.0).text("River width")).drag_stopped();
            changed |= ui.add(egui::Slider::new(&mut hy.arid_loss, 0.0..=0.05).text("Arid loss")).drag_stopped();
            changed |= ui.add(egui::Slider::new(&mut hy.braid_strength, 0.0..=2.0).text("Braiding")).drag_stopped();
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
        ui.label(format!("{:.0} m / texel  ({:.0} × {:.0} km)", c.doc.meters_per_texel,
            c.doc.width() as f32 * c.doc.meters_per_texel / 1000.0,
            c.doc.height() as f32 * c.doc.meters_per_texel / 1000.0));
        ui.label(format!("Elevation {:.0} … {:.0} m", c.doc.stats.min, c.doc.stats.max));
        ui.label(format!("Mirror: {}", fmt_bytes(c.doc.elevation.byte_len() as u64)));
        ui.separator();
        ui.heading("History");
        ui.label(format!("{} entries, {} in RAM, {} on disk", c.doc.undo.len(),
            fmt_bytes(c.doc.undo.loaded_bytes() as u64), fmt_bytes(c.doc.undo.spilled_bytes() as u64)));
        ui.horizontal(|ui| {
            if ui.add_enabled(c.doc.undo.can_undo(), egui::Button::new("Undo")).clicked() {
                actions.push(UiAction::Undo);
            }
            if ui.add_enabled(c.doc.undo.can_redo(), egui::Button::new("Redo")).clicked() {
                actions.push(UiAction::Redo);
            }
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
                        ui.separator();
                        ui.monospace(format!(
                            "{}  moist {:.2}  {:.1} °C  flow {:.0}",
                            Biome::from_u8(d.biome[i]).label(),
                            d.moisture.data()[i],
                            d.temperature.data()[i],
                            d.flow.data()[i]
                        ));
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
        egui::Window::new("Profiler").open(&mut open).default_width(340.0).default_pos((250.0, 40.0)).show(ctx, |ui| {
            ui.label(format!("GPU: {} ({})  timestamps: {}", c.gpu_name, c.gpu_backend, if c.timestamps_supported { "yes" } else { "no" }));
            ui.label(format!("Frame: avg {:.2} ms  max {:.2} ms  ({:.0} fps)", c.cpu.avg_frame_ms(), c.cpu.max_frame_ms(),
                if c.cpu.avg_frame_ms() > 0.0 { 1000.0 / c.cpu.avg_frame_ms() } else { 0.0 }));
            // Frame-time graph.
            let (rect, _) = ui.allocate_exact_size(egui::vec2(ui.available_width(), 60.0), egui::Sense::hover());
            let painter = ui.painter_at(rect);
            painter.rect_filled(rect, 2.0, egui::Color32::from_black_alpha(140));
            let n = c.cpu.frame_ms.len().max(1) as f32;
            let scale = 40.0f32; // ms at full height
            let pts: Vec<egui::Pos2> = c
                .cpu
                .frame_ms
                .iter()
                .enumerate()
                .map(|(i, ms)| {
                    egui::pos2(rect.left() + rect.width() * i as f32 / n, rect.bottom() - rect.height() * (ms / scale).min(1.0))
                })
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
                ui.label("derived recompute");
                ui.label(format!("{:.3}", c.doc.last_derived_ms));
                ui.end_row();
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
            ui.label(format!("Pending readback: {} tiles", c.doc.pending_readback.len()));
            ui.label(format!(
                "VRAM: field textures + staging {}{}",
                fmt_bytes(c.device_bytes),
                c.allocated_bytes.map(|b| format!(", allocator total {}", fmt_bytes(b))).unwrap_or_default()
            ));
            ui.label(format!(
                "Threads: {} rayon workers, {} background job(s) running",
                rayon::current_num_threads(),
                crate::jobs::running_jobs()
            ));
            ui.label(format!("Max texture dimension: {}", c.max_field_dim));
            ui.separator();
            if let Some(d) = &c.doc.derived {
                let t = &d.timings;
                ui.label(format!(
                    "Derived job {:.0} ms: moisture {:.0}, temp {:.0}, fill {:.0}, flow {:.0}, lakes {:.0}, rivers {:.0}, water {:.0}, biome {:.0}",
                    t.total_ms, t.moisture_ms, t.temperature_ms, t.fill_ms, t.flow_ms, t.lakes_ms, t.rivers_ms, t.water_ms, t.biome_ms
                ));
                ui.label(format!("Derived textures {} on GPU, last upload {} tiles", fmt_bytes(c.derived_device_bytes), c.derived_upload_tiles));
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
            ui.label(format!(
                "An autosave of \"{}\" from {} is newer than the last save.",
                rp.manifest.name, rp.manifest.saved_at
            ));
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
            ui.label("Milestone 1: field engine, hillshade, sea-level coastline, terrain brushes.");
            ui.label("Nothing here is a tile. The coast is the isoline of elevation == sea level.");
        });
        st.show_about = open;
    }

    actions
}
