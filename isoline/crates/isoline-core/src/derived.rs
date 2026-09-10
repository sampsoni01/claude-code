//! The derived chain: water (moisture + hydrology at simulation resolution)
//! → temperature → biomes → forest density. Runs on a snapshot of the
//! elevation field on a background thread; the app swaps the result in.
//!
//! When the water is *baked*, moisture and hydrology are skipped and the
//! chain reads the baked geometry and moisture field instead.

use crate::biome::{self, BiomeMatrix};
use crate::climate;
use crate::field::ScalarField;
use crate::water::{self, WaterOutput, WaterParams, WaterTimings};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Instant;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct DerivedParams {
    pub water: WaterParams,
    pub biomes: BiomeMatrix,
}

/// User-owned water after "Bake water": geometry that recomputation no
/// longer touches, and a paintable moisture field at project resolution.
#[derive(Clone, Debug)]
pub struct BakedWater {
    pub rivers: Vec<crate::hydrology::River>,
    pub lakes: Vec<water::LakePolygon>,
    pub moisture: ScalarField,
}

#[derive(Clone, Debug, Default)]
pub struct DerivedTimings {
    pub water: WaterTimings,
    pub water_raster_ms: f32,
    pub temperature_ms: f32,
    pub biome_ms: f32,
    pub total_ms: f32,
}

#[derive(Clone, Debug)]
pub struct Derived {
    /// Rivers, lakes and moisture — the only water data downstream may read.
    pub water: WaterOutput,
    /// Water coverage 0..1 at project resolution, for rendering.
    pub water_cov: ScalarField,
    /// °C at the simulation resolution of the moisture field.
    pub temperature: ScalarField,
    /// Biome id per texel at project resolution.
    pub biome: Vec<u8>,
    /// Tree cover 0..1 at project resolution.
    pub forest: ScalarField,
    pub timings: DerivedTimings,
    pub cancelled: bool,
    pub baked: bool,
}

impl Derived {
    /// Bytes held by this result on the CPU.
    pub fn cpu_bytes(&self) -> u64 {
        let moist = self.water.moisture.as_ref().map(|m| m.byte_len()).unwrap_or(0);
        let geom: usize = self.water.rivers.iter().map(|r| r.points.len() * 12).sum::<usize>()
            + self.water.lakes.iter().map(|l| l.polygon.points.len() * 8).sum::<usize>();
        (moist + geom + self.water_cov.byte_len() + self.temperature.byte_len() + self.biome.len() + self.forest.byte_len()) as u64
    }
}

fn ms(t: Instant) -> f32 {
    t.elapsed().as_secs_f32() * 1000.0
}

pub fn compute(
    elev: &ScalarField,
    sea_level: f32,
    p: &DerivedParams,
    baked: Option<&BakedWater>,
    cancel: &AtomicBool,
    progress: &AtomicU32,
) -> Derived {
    let t_all = Instant::now();
    let mut timings = DerivedTimings::default();
    let set = |v: u32| progress.store(v, Ordering::Relaxed);

    let (water_out, moisture_for_biomes) = match baked {
        Some(b) => {
            let out = WaterOutput { rivers: b.rivers.clone(), lakes: b.lakes.clone(), moisture: None };
            set(300);
            (out, b.moisture.clone())
        }
        None => {
            let (out, tm) = water::compute(elev, sea_level, &p.water, cancel);
            timings.water = tm;
            set(700);
            let m = out.moisture.clone().unwrap_or_else(|| ScalarField::new(16, 16, 0.5));
            (out, m)
        }
    };
    if cancel.load(Ordering::Relaxed) {
        return Derived {
            water: water_out,
            water_cov: ScalarField::new(1, 1, 0.0),
            temperature: ScalarField::new(1, 1, 0.0),
            biome: Vec::new(),
            forest: ScalarField::new(1, 1, 0.0),
            timings,
            cancelled: true,
            baked: baked.is_some(),
        };
    }

    let t = Instant::now();
    let water_cov = water::rasterize(&water_out, elev, sea_level);
    timings.water_raster_ms = ms(t);
    set(800);

    // Temperature at the simulation resolution (biomes sample it bilinearly).
    let t = Instant::now();
    let (sw, sh) = water::sim_size(elev.width(), elev.height(), p.water.sim_resolution.max(256));
    let elev_sim = elev.downsample(sw, sh);
    let temperature = climate::temperature(&elev_sim, sea_level, &p.water.climate);
    timings.temperature_ms = ms(t);
    set(870);

    let t = Instant::now();
    let lake_mask = water::lake_mask(&water_out, elev.width(), elev.height());
    let (biome, forest) = biome::classify(elev, sea_level, &moisture_for_biomes, &temperature, &lake_mask, &p.biomes);
    timings.biome_ms = ms(t);
    set(1000);
    timings.total_ms = ms(t_all);

    Derived {
        water: water_out,
        water_cov,
        temperature,
        biome,
        forest,
        timings,
        cancelled: cancel.load(Ordering::Relaxed),
        baked: baked.is_some(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terrain::{generate, TerrainParams};

    #[test]
    fn chain_runs_on_generated_terrain() {
        let e = generate(256, 256, &TerrainParams::default(), &AtomicU32::new(0), &AtomicBool::new(false));
        let d = compute(&e, 0.0, &DerivedParams::default(), None, &AtomicBool::new(false), &AtomicU32::new(0));
        assert!(!d.cancelled);
        assert!(!d.water.rivers.is_empty(), "a continent should have rivers");
        assert!(d.water_cov.data().iter().any(|v| *v > 0.5));
        let land = e.data().iter().filter(|v| **v > 0.0).count();
        let ocean = d.biome.iter().filter(|b| **b == 0).count();
        assert_eq!(ocean, e.data().len() - land);
        assert!(d.biome.iter().any(|b| *b != 0 && *b != 1));
        // Baked path reuses geometry and skips hydrology.
        let baked = BakedWater { rivers: d.water.rivers.clone(), lakes: d.water.lakes.clone(), moisture: d.water.moisture.clone().unwrap().resample(256, 256) };
        let d2 = compute(&e, 0.0, &DerivedParams::default(), Some(&baked), &AtomicBool::new(false), &AtomicU32::new(0));
        assert!(d2.baked);
        assert_eq!(d2.water.rivers.len(), d.water.rivers.len());
        assert_eq!(d2.timings.water.total_ms, 0.0);
    }
}
