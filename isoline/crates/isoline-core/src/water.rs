//! The water system boundary. Runs moisture and hydrology at a capped
//! simulation resolution on a downsampled elevation and exposes only what
//! downstream systems may read: river polylines with widths and tributary
//! links, lake polygons, and the moisture field.

use crate::climate::{self, ClimateParams};
use crate::field::ScalarField;
use crate::geometry::{self, Polygon, P2};
use crate::hydrology::{self, HydrologyParams, River};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

/// When hydrology recomputes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum RecomputeMode {
    /// Restart as soon as anything changes, even mid-stroke.
    Live,
    /// Recompute ~500 ms after the last edit; the previous result stays visible.
    AfterStroke,
    /// Only on an explicit "Recompute water" command.
    Manual,
}

impl RecomputeMode {
    pub const ALL: [RecomputeMode; 3] = [RecomputeMode::Live, RecomputeMode::AfterStroke, RecomputeMode::Manual];
    pub fn label(self) -> &'static str {
        match self {
            RecomputeMode::Live => "Live",
            RecomputeMode::AfterStroke => "After stroke",
            RecomputeMode::Manual => "Manual",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WaterParams {
    pub mode: RecomputeMode,
    /// Longest edge of the simulation grid (2048 or 1024).
    pub sim_resolution: u32,
    /// Drop to 1024 automatically when a run exceeds the 1 s budget.
    pub auto_downgrade: bool,
    pub hydrology: HydrologyParams,
    pub climate: ClimateParams,
}

impl Default for WaterParams {
    fn default() -> Self {
        Self {
            mode: RecomputeMode::AfterStroke,
            sim_resolution: 2048,
            auto_downgrade: true,
            hydrology: HydrologyParams::default(),
            climate: ClimateParams::default(),
        }
    }
}

/// A lake as a polygon in project coordinates.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct LakePolygon {
    pub id: u32,
    pub level: f32,
    pub polygon: Polygon,
}

/// Everything downstream systems may read from the water system.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct WaterOutput {
    /// Polylines in project coordinates with per-vertex width (project texels).
    pub rivers: Vec<River>,
    pub lakes: Vec<LakePolygon>,
    /// Precipitation 0..1 at the simulation resolution.
    #[serde(skip)]
    pub moisture: Option<ScalarField>,
}

#[derive(Clone, Debug, Default)]
pub struct WaterTimings {
    pub downsample_ms: f32,
    pub moisture_ms: f32,
    pub fill_ms: f32,
    pub flow_ms: f32,
    pub lakes_ms: f32,
    pub rivers_ms: f32,
    pub vector_ms: f32,
    pub total_ms: f32,
    pub sim_width: u32,
    pub sim_height: u32,
    /// Peak-ish CPU bytes held by simulation-resolution intermediates.
    pub sim_bytes: u64,
}

/// Simulation grid size for a project of `w × h` texels.
pub fn sim_size(w: u32, h: u32, max_edge: u32) -> (u32, u32) {
    let longest = w.max(h);
    if longest <= max_edge {
        return (w, h);
    }
    let s = max_edge as f32 / longest as f32;
    (((w as f32 * s).round() as u32).max(16), ((h as f32 * s).round() as u32).max(16))
}

/// Run moisture + hydrology on a downsampled copy of the elevation and
/// return vector geometry in project coordinates.
pub fn compute(elev: &ScalarField, sea_level: f32, p: &WaterParams, cancel: &AtomicBool) -> (WaterOutput, WaterTimings) {
    let t_all = Instant::now();
    let mut tm = WaterTimings::default();
    let (sw, sh) = sim_size(elev.width(), elev.height(), p.sim_resolution.max(256));
    tm.sim_width = sw;
    tm.sim_height = sh;
    let scale = elev.width() as f32 / sw as f32;

    let t = Instant::now();
    let sim = elev.downsample(sw, sh);
    tm.downsample_ms = ms(t);

    let t = Instant::now();
    let moisture = climate::moisture(&sim, sea_level, &p.climate, cancel);
    tm.moisture_ms = ms(t);
    if cancel.load(Ordering::Relaxed) {
        return (WaterOutput { moisture: Some(moisture), ..Default::default() }, tm);
    }

    let t = Instant::now();
    let filled = hydrology::fill_depressions(&sim, sea_level, cancel);
    tm.fill_ms = ms(t);
    if cancel.load(Ordering::Relaxed) {
        return (WaterOutput { moisture: Some(moisture), ..Default::default() }, tm);
    }

    let t = Instant::now();
    let dirs = hydrology::flow_directions(&filled, sea_level);
    let m = moisture.data();
    let loss: Vec<f32> = m.par_iter().map(|&mv| p.hydrology.arid_loss * (1.0 - mv).powi(2)).collect();
    let flow = hydrology::flow_accumulation(&filled, &dirs, m, &loss);
    tm.flow_ms = ms(t);

    let t = Instant::now();
    let (lake_ids, lakes) = hydrology::find_lakes(&sim, &filled, Some(m), &p.hydrology);
    tm.lakes_ms = ms(t);

    let t = Instant::now();
    let net = hydrology::trace_rivers(&filled, &dirs, &flow, &lake_ids, sea_level, &p.hydrology);
    tm.rivers_ms = ms(t);

    // Vectorise: simplify and scale rivers, trace lake outlines.
    let t = Instant::now();
    let rivers: Vec<River> = net
        .rivers
        .into_par_iter()
        .map(|r| {
            let keep = geometry::simplify(&r.points, 0.6);
            let pts: Vec<P2> = keep.iter().map(|&i| [r.points[i][0] * scale, r.points[i][1] * scale]).collect();
            let wds: Vec<f32> = keep.iter().map(|&i| r.widths[i] * scale).collect();
            let pts = geometry::chaikin(&pts, false);
            let wds = expand_widths(&wds, pts.len());
            River { id: r.id, points: pts, widths: wds, mouth_flow: r.mouth_flow, joins: r.joins }
        })
        .collect();
    let (w, h) = (sw as usize, sh as usize);
    // Bounding boxes per lake so tracing touches only the lake's neighbourhood.
    let mut bbox: Vec<[usize; 4]> = vec![[usize::MAX, usize::MAX, 0, 0]; lakes.len() + 1];
    for (i, &id) in lake_ids.iter().enumerate() {
        if id != 0 && (id as usize) < bbox.len() {
            let (x, y) = (i % w, i / w);
            let b = &mut bbox[id as usize];
            b[0] = b[0].min(x);
            b[1] = b[1].min(y);
            b[2] = b[2].max(x);
            b[3] = b[3].max(y);
        }
    }
    let lake_polys: Vec<LakePolygon> = lakes
        .par_iter()
        .filter_map(|lk| {
            let b = bbox[lk.id as usize];
            if b[0] == usize::MAX {
                return None;
            }
            let (x0, y0) = (b[0].saturating_sub(1), b[1].saturating_sub(1));
            let (bw, bh) = ((b[2] + 2).min(w) - x0, (b[3] + 2).min(h) - y0);
            let ring = geometry::trace_region(bw, bh, |x, y| lake_ids[(y + y0) * w + (x + x0)] == lk.id);
            if ring.len() < 4 {
                return None;
            }
            let keep = geometry::simplify(&ring, 0.7);
            let pts: Vec<P2> = keep.iter().map(|&i| [(ring[i][0] + x0 as f32) * scale, (ring[i][1] + y0 as f32) * scale]).collect();
            let pts = geometry::chaikin(&pts, true);
            Some(LakePolygon { id: lk.id, level: lk.level, polygon: Polygon { points: pts } })
        })
        .collect();
    tm.vector_ms = ms(t);
    tm.sim_bytes = (sim.byte_len() + moisture.byte_len() + filled.byte_len() + dirs.len() + flow.len() * 4 + loss.len() * 4 + lake_ids.len() * 4 + net.width.len() * 4) as u64;
    tm.total_ms = ms(t_all);
    (WaterOutput { rivers, lakes: lake_polys, moisture: Some(moisture) }, tm)
}

/// Chaikin doubles the vertex count; interpolate widths to match.
fn expand_widths(w: &[f32], n: usize) -> Vec<f32> {
    if w.is_empty() {
        return vec![1.0; n];
    }
    (0..n)
        .map(|i| {
            let t = if n <= 1 { 0.0 } else { i as f32 / (n - 1) as f32 * (w.len() - 1) as f32 };
            let a = t.floor() as usize;
            let b = (a + 1).min(w.len() - 1);
            w[a] + (w[b] - w[a]) * (t - a as f32)
        })
        .collect()
}

/// Rasterize water coverage (0..1) at project resolution from the vector
/// geometry. Rivers are capsules along their segments; lakes are filled
/// polygons. Sea texels are left at zero.
pub fn rasterize(water: &WaterOutput, elev: &ScalarField, sea_level: f32) -> ScalarField {
    let (w, h) = (elev.width() as usize, elev.height() as usize);
    let e = elev.data();
    let mut cov = vec![0f32; w * h];
    for lk in &water.lakes {
        lk.polygon.fill(elev.width(), elev.height(), |x, y| {
            let i = y as usize * w + x as usize;
            if e[i] > sea_level {
                cov[i] = 1.0;
            }
        });
    }
    for r in &water.rivers {
        for k in 0..r.points.len().saturating_sub(1) {
            let a = r.points[k];
            let b = r.points[k + 1];
            let ra = (r.widths[k] * 0.5).max(0.35);
            let rb = (r.widths[k + 1] * 0.5).max(0.35);
            let rmax = ra.max(rb);
            let x0 = (a[0].min(b[0]) - rmax - 1.0).floor().max(0.0) as usize;
            let y0 = (a[1].min(b[1]) - rmax - 1.0).floor().max(0.0) as usize;
            let x1 = ((a[0].max(b[0]) + rmax + 1.0).ceil() as usize).min(w - 1);
            let y1 = ((a[1].max(b[1]) + rmax + 1.0).ceil() as usize).min(h - 1);
            for y in y0..=y1 {
                for x in x0..=x1 {
                    let pc = [x as f32 + 0.5, y as f32 + 0.5];
                    let (d2, t) = geometry::seg_dist2(pc, a, b);
                    let rr = ra + (rb - ra) * t;
                    let c = (rr - d2.sqrt() + 0.5).clamp(0.0, 1.0);
                    if c > 0.0 {
                        let i = y * w + x;
                        if e[i] > sea_level {
                            // Thin channels: guarantee a visible core.
                            cov[i] = cov[i].max(c.max(if d2 < 0.25 { 0.6 } else { 0.0 }));
                        }
                    }
                }
            }
        }
    }
    ScalarField::from_vec(elev.width(), elev.height(), cov)
}

/// Per-texel "is lake" mask at project resolution (for biome classification).
pub fn lake_mask(water: &WaterOutput, width: u32, height: u32) -> Vec<bool> {
    let mut m = vec![false; width as usize * height as usize];
    for lk in &water.lakes {
        lk.polygon.fill(width, height, |x, y| m[y as usize * width as usize + x as usize] = true);
    }
    m
}

fn ms(t: Instant) -> f32 {
    t.elapsed().as_secs_f32() * 1000.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terrain::{generate, TerrainParams};
    use std::sync::atomic::AtomicU32;

    #[test]
    fn sim_size_caps_longest_edge() {
        assert_eq!(sim_size(8192, 8192, 2048), (2048, 2048));
        assert_eq!(sim_size(4096, 2048, 2048), (2048, 1024));
        assert_eq!(sim_size(1024, 1024, 2048), (1024, 1024));
    }

    #[test]
    fn geometry_lands_in_project_coordinates() {
        let e = generate(512, 512, &TerrainParams::default(), &AtomicU32::new(0), &AtomicBool::new(false));
        let p = WaterParams { sim_resolution: 256, ..Default::default() };
        let (out, tm) = compute(&e, 0.0, &p, &AtomicBool::new(false));
        assert_eq!((tm.sim_width, tm.sim_height), (256, 256));
        assert!(!out.rivers.is_empty());
        for r in &out.rivers {
            assert_eq!(r.points.len(), r.widths.len());
            for pt in &r.points {
                assert!(pt[0] >= 0.0 && pt[0] <= 512.0 && pt[1] >= 0.0 && pt[1] <= 512.0);
            }
        }
        let cov = rasterize(&out, &e, 0.0);
        assert!(cov.data().iter().any(|v| *v > 0.5));
        assert_eq!(out.moisture.as_ref().unwrap().width(), 256);
    }
}
