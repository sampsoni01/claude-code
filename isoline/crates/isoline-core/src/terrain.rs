//! Initial terrain synthesis for new projects. Elevation is in metres;
//! sea level for new projects is 0.

use crate::field::ScalarField;
use crate::noise::Simplex2;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TerrainPreset {
    Continent,
    Archipelago,
    Highlands,
    Flat,
    Ocean,
}

impl TerrainPreset {
    pub const ALL: [TerrainPreset; 5] = [
        TerrainPreset::Continent,
        TerrainPreset::Archipelago,
        TerrainPreset::Highlands,
        TerrainPreset::Flat,
        TerrainPreset::Ocean,
    ];
    pub fn label(self) -> &'static str {
        match self {
            TerrainPreset::Continent => "Continent",
            TerrainPreset::Archipelago => "Archipelago",
            TerrainPreset::Highlands => "Highlands (all land)",
            TerrainPreset::Flat => "Flat land",
            TerrainPreset::Ocean => "Empty ocean",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TerrainParams {
    pub preset: TerrainPreset,
    pub seed: u64,
    /// Size of the largest features as a fraction of the field's short edge.
    pub feature_scale: f32,
    /// 0..1, how much high-frequency detail and ridging.
    pub roughness: f32,
    /// Peak height in metres.
    pub max_height: f32,
    /// Ocean floor depth in metres (positive number).
    pub max_depth: f32,
}

impl Default for TerrainParams {
    fn default() -> Self {
        Self {
            preset: TerrainPreset::Continent,
            seed: 1337,
            feature_scale: 0.55,
            roughness: 0.55,
            max_height: 3200.0,
            max_depth: 3000.0,
        }
    }
}

/// Generate an elevation field. `progress` receives 0..=1000 as rows complete;
/// `cancel` aborts early (the returned field is then partial).
pub fn generate(width: u32, height: u32, p: &TerrainParams, progress: &AtomicU32, cancel: &AtomicBool) -> ScalarField {
    let mut field = ScalarField::new(width, height, 0.0);
    match p.preset {
        TerrainPreset::Flat => {
            field.par_map_inplace(|_, _, _| 120.0);
            progress.store(1000, Ordering::Relaxed);
            return field;
        }
        TerrainPreset::Ocean => {
            field.par_map_inplace(|_, _, _| -600.0);
            progress.store(1000, Ordering::Relaxed);
            return field;
        }
        _ => {}
    }

    let base = Simplex2::new(p.seed);
    let warp = Simplex2::new(p.seed ^ 0x51ED_C0DE);
    let ridge = Simplex2::new(p.seed ^ 0x00B1_D6E5);
    let short = width.min(height) as f32;
    let scale = 1.0 / (short * p.feature_scale.max(0.05));
    let octaves = 6 + (p.roughness * 4.0) as u32;
    let rough = p.roughness;
    let (w, h) = (width as f32, height as f32);
    let preset = p.preset;
    let (max_h, max_d) = (p.max_height, p.max_depth);
    let rows_done = AtomicU32::new(0);

    let data = field.data_mut();
    data.par_chunks_mut(width as usize).enumerate().for_each(|(y, row)| {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        let fy = y as f32 + 0.5;
        for (x, v) in row.iter_mut().enumerate() {
            let fx = x as f32 + 0.5;
            // Domain warp.
            let wx = warp.fbm(fx * scale * 0.7 + 3.1, fy * scale * 0.7 + 7.7, 3, 2.0, 0.5);
            let wy = warp.fbm(fx * scale * 0.7 - 5.3, fy * scale * 0.7 + 1.9, 3, 2.0, 0.5);
            let px = fx * scale + wx * 0.6;
            let py = fy * scale + wy * 0.6;
            let mut n = base.fbm(px, py, octaves, 2.05, 0.48); // -1..1
            // Ridged detail that grows with roughness and with base height.
            let r = ridge.ridged(px * 2.3, py * 2.3, 5, 2.1, 0.55); // 0..1
            n += (r - 0.5) * 0.55 * rough * (0.5 + 0.5 * n).clamp(0.0, 1.0);

            // Continental mask: 1 at the centre, 0 at the edge, shaped by the warp.
            let nx = (fx / w) * 2.0 - 1.0;
            let ny = (fy / h) * 2.0 - 1.0;
            let edge = 1.0 - (nx * nx + ny * ny).sqrt().min(1.0) + wx * 0.12;
            let smooth = |a: f32, b: f32, x: f32| {
                let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
                t * t * (3.0 - 2.0 * t)
            };
            let (mask, mask_strength, land_bias) = match preset {
                TerrainPreset::Continent => (smooth(0.12, 0.72, edge), 0.9, 0.42),
                TerrainPreset::Archipelago => (0.5, 0.0, 0.62),
                TerrainPreset::Highlands => (0.5, 0.0, 0.0),
                _ => (0.5, 0.0, 0.5),
            };
            let hgt = n * 0.5 + 0.5; // 0..1
            let t = hgt - land_bias + (mask - 0.5) * mask_strength + if preset == TerrainPreset::Highlands { 0.03 } else { 0.0 };
            let t_max = (1.0 - land_bias + 0.5 * mask_strength).max(1e-3);
            let t_min = (land_bias + 0.5 * mask_strength).max(1e-3);
            *v = if t >= 0.0 {
                // Ease so that most land is lowland; peaks reach max_h.
                let u = (t / t_max).clamp(0.0, 1.0);
                (u.powf(1.7) * max_h) + u * 60.0 + 2.0
            } else {
                let u = (-t / t_min).clamp(0.0, 1.0);
                -(u.powf(0.8) * max_d) - 2.0
            };
        }
        let done = rows_done.fetch_add(1, Ordering::Relaxed) + 1;
        progress.store((done as u64 * 1000 / height as u64) as u32, Ordering::Relaxed);
    });
    field
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn continent_has_land_and_sea() {
        let p = TerrainParams::default();
        let f = generate(256, 256, &p, &AtomicU32::new(0), &AtomicBool::new(false));
        let (lo, hi) = f.min_max();
        assert!(lo < -500.0 && hi > 500.0, "range {lo}..{hi}");
        let land = f.data().iter().filter(|v| **v > 0.0).count() as f32 / f.data().len() as f32;
        assert!(land > 0.15 && land < 0.85, "land fraction {land}");
        // Edges of a continent map should be sea.
        assert!(f.get(0, 0) < 0.0 && f.get(255, 255) < 0.0);
    }
}
