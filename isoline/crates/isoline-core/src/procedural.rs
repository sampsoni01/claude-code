//! Stroke-level procedural brushes: the ridge brush and the coastline brush.
//!
//! Both take the finished stroke path, generate elevation over the affected
//! rect on the CPU (rayon rows), and write it into the field. They go through
//! the same tile-delta undo as any other edit, so the whole range or coast
//! is one undo step and can be re-applied with new parameters.

use crate::field::ScalarField;
use crate::geometry::{self, P2};
use crate::noise::Simplex2;
use crate::tiles::PixelRect;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

/// A polyline with a uniform grid of segment buckets for fast nearest-segment
/// queries: signed distance (positive on the left of travel in y-down space
/// flips to "right" as documented per brush), arc-length parameter, and the
/// segment's tangent.
pub struct PathField {
    segs: Vec<(P2, P2)>,
    arc: Vec<f32>,
    total: f32,
    cell: f32,
    origin: [f32; 2],
    nx: usize,
    ny: usize,
    buckets: Vec<Vec<u32>>,
}

pub struct PathSample {
    /// Signed distance: positive to the right of the direction of travel.
    pub signed: f32,
    /// Arc length at the nearest point.
    pub t: f32,
    pub tangent: P2,
}

impl PathField {
    /// `reach` is the largest distance queries will care about; segments are
    /// bucketed so any query within `reach` finds them.
    pub fn new(path: &[P2], reach: f32) -> Self {
        let pts: Vec<P2> = dedup(path);
        let arc = geometry::arc_lengths(&pts);
        let total = *arc.last().unwrap_or(&0.0);
        let segs: Vec<(P2, P2)> = pts.windows(2).map(|w| (w[0], w[1])).collect();
        let cell = (reach.max(8.0)).max(32.0);
        let mut lo = [f32::INFINITY; 2];
        let mut hi = [f32::NEG_INFINITY; 2];
        for p in &pts {
            lo[0] = lo[0].min(p[0]);
            lo[1] = lo[1].min(p[1]);
            hi[0] = hi[0].max(p[0]);
            hi[1] = hi[1].max(p[1]);
        }
        if pts.is_empty() {
            lo = [0.0, 0.0];
            hi = [0.0, 0.0];
        }
        let origin = [lo[0] - reach - cell, lo[1] - reach - cell];
        let nx = (((hi[0] + reach + cell - origin[0]) / cell).ceil() as usize).max(1);
        let ny = (((hi[1] + reach + cell - origin[1]) / cell).ceil() as usize).max(1);
        let mut buckets = vec![Vec::new(); nx * ny];
        for (i, (a, b)) in segs.iter().enumerate() {
            let x0 = (((a[0].min(b[0]) - reach - origin[0]) / cell).floor().max(0.0)) as usize;
            let y0 = (((a[1].min(b[1]) - reach - origin[1]) / cell).floor().max(0.0)) as usize;
            let x1 = (((a[0].max(b[0]) + reach - origin[0]) / cell).floor() as usize).min(nx - 1);
            let y1 = (((a[1].max(b[1]) + reach - origin[1]) / cell).floor() as usize).min(ny - 1);
            for y in y0..=y1 {
                for x in x0..=x1 {
                    buckets[y * nx + x].push(i as u32);
                }
            }
        }
        Self { segs, arc, total, cell, origin, nx, ny, buckets }
    }

    pub fn total_length(&self) -> f32 {
        self.total
    }

    pub fn is_empty(&self) -> bool {
        self.segs.is_empty()
    }

    /// Nearest segment sample, or None if nothing is within reach.
    pub fn sample(&self, p: P2) -> Option<PathSample> {
        let cx = ((p[0] - self.origin[0]) / self.cell).floor();
        let cy = ((p[1] - self.origin[1]) / self.cell).floor();
        if cx < 0.0 || cy < 0.0 || cx as usize >= self.nx || cy as usize >= self.ny {
            return None;
        }
        let bucket = &self.buckets[cy as usize * self.nx + cx as usize];
        let mut best = f32::INFINITY;
        let mut best_i = usize::MAX;
        let mut best_t = 0.0;
        for &i in bucket {
            let (a, b) = self.segs[i as usize];
            let (d2, t) = geometry::seg_dist2(p, a, b);
            if d2 < best {
                best = d2;
                best_i = i as usize;
                best_t = t;
            }
        }
        if best_i == usize::MAX {
            return None;
        }
        let (a, b) = self.segs[best_i];
        let d = geometry::sub(b, a);
        let l = geometry::len(d).max(1e-6);
        let tangent = [d[0] / l, d[1] / l];
        let rel = geometry::sub(p, a);
        let cross = tangent[0] * rel[1] - tangent[1] * rel[0];
        let dist = best.sqrt();
        Some(PathSample {
            signed: if cross >= 0.0 { dist } else { -dist },
            t: self.arc[best_i] + best_t * l,
            tangent,
        })
    }
}

fn dedup(path: &[P2]) -> Vec<P2> {
    let mut out: Vec<P2> = Vec::with_capacity(path.len());
    for &p in path {
        if let Some(last) = out.last() {
            if geometry::len(geometry::sub(p, *last)) < 0.5 {
                continue;
            }
        }
        out.push(p);
    }
    out
}

fn smoothstep(a: f32, b: f32, x: f32) -> f32 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn path_bbox(path: &[P2]) -> ([f32; 2], [f32; 2]) {
    let mut lo = [f32::INFINITY; 2];
    let mut hi = [f32::NEG_INFINITY; 2];
    for p in path {
        lo[0] = lo[0].min(p[0]);
        lo[1] = lo[1].min(p[1]);
        hi[0] = hi[0].max(p[0]);
        hi[1] = hi[1].max(p[1]);
    }
    (lo, hi)
}

fn rect_for(path: &[P2], reach: f32, w: u32, h: u32) -> PixelRect {
    let (lo, hi) = path_bbox(path);
    PixelRect::new(
        (lo[0] - reach).floor().max(0.0) as u32,
        (lo[1] - reach).floor().max(0.0) as u32,
        ((hi[0] + reach).ceil().max(0.0) as u32).min(w),
        ((hi[1] + reach).ceil().max(0.0) as u32).min(h),
    )
}

/// Apply `f(x, y, old) -> new` over `rect`, row-parallel.
fn apply_rect(field: &mut ScalarField, rect: &PixelRect, f: impl Fn(u32, u32, f32) -> f32 + Sync) {
    if rect.is_empty() {
        return;
    }
    let w = field.width() as usize;
    let x0 = rect.x0 as usize;
    let x1 = rect.x1 as usize;
    let data = field.data_mut();
    let rows = &mut data[rect.y0 as usize * w..rect.y1 as usize * w];
    rows.par_chunks_mut(w).enumerate().for_each(|(ry, row)| {
        let y = rect.y0 + ry as u32;
        for (x, v) in row.iter_mut().enumerate().take(x1).skip(x0) {
            *v = f(x as u32, y, *v);
        }
    });
}

// ---------------------------------------------------------------------------
// Ridge brush
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RidgeParams {
    /// Half-width of the main range in texels.
    pub width: f32,
    /// Peak height above the existing terrain (elevation units).
    pub height: f32,
    pub roughness: f32,
    pub sharpness: f32,
    /// -1..1: negative makes the left flank gentler, positive the right.
    pub asymmetry: f32,
    pub spur_frequency: f32,
    /// 0 young and jagged … 1 old, low and rounded.
    pub weathering: f32,
    pub seed: u64,
}

impl Default for RidgeParams {
    fn default() -> Self {
        Self { width: 40.0, height: 1800.0, roughness: 0.5, sharpness: 0.55, asymmetry: 0.0, spur_frequency: 0.5, weathering: 0.2, seed: 7 }
    }
}

/// Reach of the ridge brush beyond the spine (foothills).
pub fn ridge_reach(p: &RidgeParams) -> f32 {
    p.width * (3.5 + 1.5 * p.asymmetry.abs())
}

pub fn apply_ridge(field: &mut ScalarField, path: &[P2], p: &RidgeParams) -> PixelRect {
    let reach = ridge_reach(p);
    let pf = PathField::new(path, reach);
    if pf.is_empty() {
        return PixelRect::EMPTY;
    }
    let rect = rect_for(path, reach, field.width(), field.height());
    let n1 = Simplex2::new(p.seed);
    let n2 = Simplex2::new(p.seed ^ 0x5bd1e995);
    let n3 = Simplex2::new(p.seed ^ 0x1b873593);
    let age = p.weathering.clamp(0.0, 1.0);
    let height = p.height * (1.0 - 0.35 * age);
    let k = (0.7 + 1.8 * p.sharpness.clamp(0.0, 1.0)) / (1.0 + 0.8 * age);
    let octaves = (5 - (age * 3.0) as u32).max(2);
    let total = pf.total_length();
    let w = p.width.max(1.0);

    apply_rect(field, &rect, |x, y, old| {
        let pt = [x as f32 + 0.5, y as f32 + 0.5];
        let Some(s) = pf.sample(pt) else { return old };
        let sd = s.signed;
        let ad = sd.abs();
        if ad > reach {
            return old;
        }
        // Flank widths: asymmetry widens one side and narrows the other.
        let side = if sd >= 0.0 { 1.0 } else { -1.0 };
        let w_side = w * (1.0 + 0.6 * p.asymmetry * side);
        let u = ad / w_side.max(1.0);
        // Spine height varies along the range; ends taper.
        let along = 1.0 + 0.35 * p.roughness * n1.fbm(s.t / (2.5 * w) + 11.3, 0.37, 3, 2.0, 0.5);
        let taper = smoothstep(0.0, 1.2 * w, s.t) * smoothstep(0.0, 1.2 * w, total - s.t);
        // Cross profile: peaked core plus exponential foothills.
        let core = if u < 1.0 { (1.0 - u).powf(k) } else { 0.0 };
        let foot = (-(ad / (1.6 * w))).exp();
        let mut profile = 0.72 * core + 0.28 * foot;
        // Secondary spurs running off the flanks, perpendicular to the spine.
        if p.spur_frequency > 0.0 {
            let period = w * (0.5 + 2.0 * (1.0 - p.spur_frequency));
            let spur = n2.ridged(s.t / period + 3.7, sd / (1.4 * w), 3, 2.0, 0.5);
            let mask = smoothstep(0.12, 0.55, u) * (-(ad / (2.2 * w))).exp();
            profile += 0.45 * p.spur_frequency * (spur - 0.35) * mask;
        }
        // Surface roughness scaled with how much range is here.
        let rough = 0.1 * p.roughness * n3.fbm(pt[0] / (0.35 * w), pt[1] / (0.35 * w), octaves, 2.1, 0.5);
        profile = (profile + rough * profile.max(0.05).sqrt()).max(0.0);
        old + height * along * taper * profile
    });
    rect
}

// ---------------------------------------------------------------------------
// Coastline brush
// ---------------------------------------------------------------------------

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum CoastPreset {
    Custom,
    Fjord,
    DrownedValley,
    BarrierLagoon,
    Cliffed,
    Deltaic,
    Dune,
}

impl CoastPreset {
    pub const ALL: [CoastPreset; 7] = [
        CoastPreset::Custom,
        CoastPreset::Fjord,
        CoastPreset::DrownedValley,
        CoastPreset::BarrierLagoon,
        CoastPreset::Cliffed,
        CoastPreset::Deltaic,
        CoastPreset::Dune,
    ];
    pub fn label(self) -> &'static str {
        match self {
            CoastPreset::Custom => "Custom",
            CoastPreset::Fjord => "Fjord",
            CoastPreset::DrownedValley => "Drowned river valley",
            CoastPreset::BarrierLagoon => "Barrier island & lagoon",
            CoastPreset::Cliffed => "Cliffed",
            CoastPreset::Deltaic => "Deltaic",
            CoastPreset::Dune => "Dune coast",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum LandSide {
    Left,
    Right,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CoastParams {
    pub preset: CoastPreset,
    /// Influence band half-width in texels.
    pub band: f32,
    pub roughness: f32,
    pub octaves: u32,
    pub inlet_frequency: f32,
    pub inlet_depth: f32,
    /// -1 bays … +1 headlands.
    pub headland_bias: f32,
    pub island_density: f32,
    pub skerry_density: f32,
    /// 0 gentle … 1 cliff.
    pub gradient: f32,
    /// Height the land reaches at the inland edge of the band.
    pub land_height: f32,
    pub shelf_depth: f32,
    pub land_side: LandSide,
    pub seed: u64,
}

impl Default for CoastParams {
    fn default() -> Self {
        Self {
            preset: CoastPreset::Custom,
            band: 90.0,
            roughness: 0.5,
            octaves: 5,
            inlet_frequency: 0.4,
            inlet_depth: 0.5,
            headland_bias: 0.0,
            island_density: 0.25,
            skerry_density: 0.2,
            gradient: 0.35,
            land_height: 250.0,
            shelf_depth: 120.0,
            land_side: LandSide::Right,
            seed: 3,
        }
    }
}

impl CoastParams {
    /// Parameter bundle for a character preset (keeps band, side and seed).
    pub fn with_preset(&self, preset: CoastPreset) -> CoastParams {
        let base = CoastParams { preset, band: self.band, land_side: self.land_side, seed: self.seed, ..Default::default() };
        match preset {
            CoastPreset::Custom => CoastParams { preset, ..self.clone() },
            CoastPreset::Fjord => CoastParams {
                roughness: 0.3,
                octaves: 4,
                inlet_frequency: 0.5,
                inlet_depth: 1.6,
                headland_bias: 0.15,
                island_density: 0.35,
                skerry_density: 0.6,
                gradient: 0.85,
                land_height: 700.0,
                shelf_depth: 300.0,
                ..base
            },
            CoastPreset::DrownedValley => CoastParams {
                roughness: 0.55,
                octaves: 6,
                inlet_frequency: 0.55,
                inlet_depth: 1.1,
                headland_bias: -0.1,
                island_density: 0.15,
                skerry_density: 0.1,
                gradient: 0.3,
                land_height: 180.0,
                shelf_depth: 60.0,
                ..base
            },
            CoastPreset::BarrierLagoon => CoastParams {
                roughness: 0.2,
                octaves: 3,
                inlet_frequency: 0.15,
                inlet_depth: 0.2,
                headland_bias: -0.2,
                island_density: 0.0,
                skerry_density: 0.0,
                gradient: 0.08,
                land_height: 40.0,
                shelf_depth: 25.0,
                ..base
            },
            CoastPreset::Cliffed => CoastParams {
                roughness: 0.45,
                octaves: 5,
                inlet_frequency: 0.25,
                inlet_depth: 0.3,
                headland_bias: 0.3,
                island_density: 0.1,
                skerry_density: 0.3,
                gradient: 1.0,
                land_height: 220.0,
                shelf_depth: 150.0,
                ..base
            },
            CoastPreset::Deltaic => CoastParams {
                roughness: 0.3,
                octaves: 4,
                inlet_frequency: 0.3,
                inlet_depth: 0.25,
                headland_bias: 0.5,
                island_density: 0.2,
                skerry_density: 0.0,
                gradient: 0.05,
                land_height: 25.0,
                shelf_depth: 30.0,
                ..base
            },
            CoastPreset::Dune => CoastParams {
                roughness: 0.15,
                octaves: 3,
                inlet_frequency: 0.1,
                inlet_depth: 0.1,
                headland_bias: 0.0,
                island_density: 0.0,
                skerry_density: 0.0,
                gradient: 0.15,
                land_height: 60.0,
                shelf_depth: 40.0,
                ..base
            },
        }
    }
}

pub fn coast_reach(p: &CoastParams) -> f32 {
    p.band * 2.2
}

/// Generate a shoreline along `path`. Writes elevation so the coast stays
/// the `sea_level` isoline.
pub fn apply_coast(field: &mut ScalarField, path: &[P2], sea_level: f32, p: &CoastParams) -> PixelRect {
    let reach = coast_reach(p);
    let pf = PathField::new(path, reach);
    if pf.is_empty() {
        return PixelRect::EMPTY;
    }
    let rect = rect_for(path, reach, field.width(), field.height());
    let w = p.band.max(4.0);
    let n_warp = Simplex2::new(p.seed ^ 0x9e3779b9);
    let n_coast = Simplex2::new(p.seed);
    let n_inlet = Simplex2::new(p.seed ^ 0x85ebca6b);
    let n_isl = Simplex2::new(p.seed ^ 0xc2b2ae35);
    let n_sk = Simplex2::new(p.seed ^ 0x27d4eb2f);
    let flip = match p.land_side {
        LandSide::Right => 1.0,
        LandSide::Left => -1.0,
    };
    let preset = p.preset;
    let octaves = p.octaves.clamp(1, 8);
    let f0 = 1.0 / (w * 0.9);
    let f_warp = 1.0 / (w * 1.6);
    let inlet_period = w * (0.35 + 2.5 * (1.0 - p.inlet_frequency.clamp(0.0, 1.0)));

    apply_rect(field, &rect, |x, y, old| {
        let pt = [x as f32 + 0.5, y as f32 + 0.5];
        let Some(s) = pf.sample(pt) else { return old };
        let sd_raw = s.signed * flip; // positive = land side
        if sd_raw.abs() > reach {
            return old;
        }
        // Domain warp then coast displacement.
        let wx = n_warp.fbm(pt[0] * f_warp + 5.1, pt[1] * f_warp + 1.7, 3, 2.0, 0.5);
        let wy = n_warp.fbm(pt[0] * f_warp - 3.3, pt[1] * f_warp + 8.9, 3, 2.0, 0.5);
        let q = [pt[0] + wx * w * 0.45 * p.roughness, pt[1] + wy * w * 0.45 * p.roughness];
        let mut sd = sd_raw + p.roughness * w * 0.7 * n_coast.fbm(q[0] * f0, q[1] * f0, octaves, 2.1, 0.5) + p.headland_bias * w * 0.25;
        // Inlets: pulses along the coast pushing the shoreline inland.
        if p.inlet_depth > 0.0 && p.inlet_frequency > 0.0 {
            let pulse = n_inlet.ridged(s.t / inlet_period + 0.5, 0.31, 1, 2.0, 0.5);
            let sharp = match preset {
                CoastPreset::Fjord => 4.0,
                CoastPreset::DrownedValley => 2.0,
                _ => 1.5,
            };
            let mut inl = pulse.powf(sharp);
            if preset == CoastPreset::DrownedValley {
                // Branching: finer pulses ride on the main ones.
                let sub = n_inlet.ridged(s.t / (inlet_period * 0.33) + 9.1, 0.77, 2, 2.0, 0.5).powf(2.0);
                inl = inl.max(0.55 * inl.sqrt() * sub);
            }
            // Deeper inlets reach further inland; taper so the head is narrow.
            let depth = p.inlet_depth * w * 1.5;
            let head = (1.0 - (sd_raw / depth.max(1.0)).clamp(0.0, 1.0)).powf(0.6);
            sd -= depth * inl * head;
        }
        if preset == CoastPreset::Deltaic {
            let lobe = n_inlet.fbm(s.t / (w * 1.8) + 2.2, 0.13, 2, 2.0, 0.5);
            sd += w * 0.7 * (lobe * 0.5 + 0.5) * (1.0 - (sd_raw.abs() / (2.0 * w)).clamp(0.0, 1.0));
        }

        // Elevation profile from the displaced signed distance.
        let g = p.gradient.clamp(0.0, 1.0);
        let land_run = w * (1.0 - 0.92 * g);
        let sea_run = w * (1.0 - 0.6 * g);
        let mut h = if sd >= 0.0 {
            sea_level + p.land_height * (sd / land_run.max(1.0)).clamp(0.0, 1.0).powf(0.85) + 1.0
        } else {
            sea_level - p.shelf_depth * (-sd / sea_run.max(1.0)).clamp(0.0, 1.0).powf(0.7) - 1.0
        };
        // Offshore islands and skerries.
        if sd < -0.1 * w && sd > -1.8 * w {
            let zone = smoothstep(-1.8 * w, -1.1 * w, sd) * (1.0 - smoothstep(-0.5 * w, -0.1 * w, sd));
            if p.island_density > 0.0 {
                let v = n_isl.fbm(q[0] / (w * 0.5), q[1] / (w * 0.5), 4, 2.0, 0.5) * 0.5 + 0.5;
                let thr = 1.0 - 0.55 * p.island_density.clamp(0.0, 1.0) * (0.5 + 0.5 * zone);
                if v > thr {
                    let t = (v - thr) / (1.0 - thr).max(1e-3);
                    h = h.max(sea_level + 1.0 + p.land_height * 0.35 * t.sqrt());
                }
            }
            if p.skerry_density > 0.0 {
                let v = n_sk.fbm(q[0] / (w * 0.12), q[1] / (w * 0.12), 3, 2.0, 0.5) * 0.5 + 0.5;
                let thr = 1.0 - 0.22 * p.skerry_density.clamp(0.0, 1.0) * zone;
                if v > thr {
                    h = h.max(sea_level + 2.0 + 8.0 * (v - thr) / (1.0 - thr).max(1e-3));
                }
            }
        }
        match preset {
            CoastPreset::BarrierLagoon => {
                // A thin bar offshore with gaps; the lagoon behind stays shallow.
                let bar = (-((sd + 0.55 * w) / (0.07 * w)).powi(2)).exp();
                let gaps = n_isl.fbm(s.t / (w * 1.2), 0.9, 2, 2.0, 0.5);
                if bar > 0.25 && gaps > -0.55 {
                    h = h.max(sea_level + 2.0 + 5.0 * bar);
                }
                if sd < 0.0 && sd > -0.5 * w {
                    h = h.max(sea_level - 6.0 - 6.0 * (-sd / (0.5 * w)));
                }
            }
            CoastPreset::Dune => {
                if sd > 0.0 && sd < 0.6 * w {
                    let ridges = (sd / (0.09 * w) * std::f32::consts::TAU).sin() * 0.5 + 0.5;
                    h += 4.0 * ridges * (1.0 - sd / (0.6 * w));
                }
            }
            _ => {}
        }

        // Blend into the existing terrain at the band edges.
        let mask = if sd_raw >= 0.0 { 1.0 - smoothstep(1.0 * w, 2.1 * w, sd_raw) } else { 1.0 - smoothstep(1.3 * w, 2.1 * w, -sd_raw) };
        old + (h - old) * mask
    });
    rect
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_field_signed_distance_and_arc() {
        let pf = PathField::new(&[[10.0, 50.0], [110.0, 50.0]], 40.0);
        let s = pf.sample([60.0, 60.0]).unwrap();
        assert!((s.signed - 10.0).abs() < 1e-4, "{}", s.signed);
        assert!((s.t - 50.0).abs() < 1e-4);
        let s2 = pf.sample([60.0, 40.0]).unwrap();
        assert!((s2.signed + 10.0).abs() < 1e-4);
        assert!(pf.sample([60.0, 200.0]).is_none());
    }

    #[test]
    fn ridge_raises_along_spine() {
        let mut f = ScalarField::new(512, 256, 100.0);
        let p = RidgeParams { width: 30.0, height: 1000.0, ..Default::default() };
        let rect = apply_ridge(&mut f, &[[100.0, 128.0], [400.0, 128.0]], &p);
        assert!(!rect.is_empty());
        let peak = f.get(250, 128);
        assert!(peak > 700.0 && peak < 1600.0, "peak {peak}");
        assert!(f.get(250, 128) > f.get(250, 150));
        assert!(f.get(250, 150) > f.get(250, 200));
        assert_eq!(f.get(250, 250), 100.0, "far away untouched");
        assert_eq!(f.get(10, 128), 100.0, "beyond the ends untouched");
    }

    #[test]
    fn coast_puts_land_on_one_side() {
        let mut f = ScalarField::new(512, 256, -300.0);
        let mut p = CoastParams { band: 40.0, ..Default::default() }.with_preset(CoastPreset::Fjord);
        p.band = 40.0;
        // Travel left→right with land on the right (y-down: below the line).
        apply_coast(&mut f, &[[50.0, 128.0], [460.0, 128.0]], 0.0, &p);
        let mut land_below = 0;
        let mut land_above = 0;
        for x in 100..400 {
            for y in 150..200 {
                if f.get(x, y) > 0.0 {
                    land_below += 1;
                }
            }
            for y in 40..80 {
                if f.get(x, y) > 0.0 {
                    land_above += 1;
                }
            }
        }
        assert!(land_below > 300 * 50 / 2, "land below {land_below}");
        assert!(land_above < 300 * 40 / 4, "land above {land_above}");
        assert_eq!(f.get(250, 250), -300.0, "outside the band untouched");
        // Fjords should make the shoreline longer than a smooth coast.
        let shoreline = |f: &ScalarField| {
            let mut n = 0;
            for x in 100..400 {
                for y in 60..200 {
                    if (f.get(x, y) > 0.0) != (f.get(x, y + 1) > 0.0) {
                        n += 1;
                    }
                }
            }
            n
        };
        let fj = shoreline(&f);
        let mut g = ScalarField::new(512, 256, -300.0);
        let mut pd = p.with_preset(CoastPreset::Dune);
        pd.band = 40.0;
        apply_coast(&mut g, &[[50.0, 128.0], [460.0, 128.0]], 0.0, &pd);
        let du = shoreline(&g);
        assert!(fj > du, "fjord shoreline {fj} should exceed dune {du}");
    }
}
