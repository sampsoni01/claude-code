//! The derived-system chain: elevation (+ sea level, climate and hydrology
//! settings) → moisture → temperature → fill/flow/lakes/rivers → biomes →
//! forest density. Runs on a snapshot of the elevation field, on a background
//! thread, and returns a complete [`Derived`] set that the app swaps in.

use crate::biome::{self, BiomeMatrix};
use crate::climate::{self, ClimateParams};
use crate::field::ScalarField;
use crate::hydrology::{self, HydrologyParams, Lake, River};
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Instant;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct DerivedParams {
    pub hydrology: HydrologyParams,
    pub climate: ClimateParams,
    pub biomes: BiomeMatrix,
}

#[derive(Clone, Debug, Default)]
pub struct DerivedTimings {
    pub moisture_ms: f32,
    pub temperature_ms: f32,
    pub fill_ms: f32,
    pub flow_ms: f32,
    pub lakes_ms: f32,
    pub rivers_ms: f32,
    pub water_ms: f32,
    pub biome_ms: f32,
    pub total_ms: f32,
}

/// Everything derived from the elevation field.
#[derive(Clone, Debug)]
pub struct Derived {
    /// Precipitation, 0..1.
    pub moisture: ScalarField,
    /// °C.
    pub temperature: ScalarField,
    /// Depression-filled surface.
    pub filled: ScalarField,
    /// Precipitation-weighted flow accumulation.
    pub flow: ScalarField,
    /// Water coverage 0..1 from lakes and rivers (sea excluded).
    pub water: ScalarField,
    /// Biome id per texel (see [`crate::biome::Biome`]).
    pub biome: Vec<u8>,
    /// Tree cover 0..1 before user painting.
    pub forest: ScalarField,
    pub lake_ids: Vec<u32>,
    pub lakes: Vec<Lake>,
    pub rivers: Vec<River>,
    pub river_threshold: f32,
    pub timings: DerivedTimings,
    /// Set when the computation was cancelled part-way (results are partial).
    pub cancelled: bool,
}

fn ms(t: Instant) -> f32 {
    t.elapsed().as_secs_f32() * 1000.0
}

pub fn compute(elev: &ScalarField, sea_level: f32, p: &DerivedParams, cancel: &AtomicBool, progress: &AtomicU32) -> Derived {
    let t_all = Instant::now();
    let n = elev.data().len();
    let mut timings = DerivedTimings::default();
    let set = |v: u32| progress.store(v, Ordering::Relaxed);

    let t = Instant::now();
    let moisture = climate::moisture(elev, sea_level, &p.climate, cancel);
    timings.moisture_ms = ms(t);
    set(150);
    let t = Instant::now();
    let temperature = climate::temperature(elev, sea_level, &p.climate);
    timings.temperature_ms = ms(t);
    set(200);

    let t = Instant::now();
    let filled = hydrology::fill_depressions(elev, sea_level, cancel);
    timings.fill_ms = ms(t);
    set(550);

    let t = Instant::now();
    let dirs = hydrology::flow_directions(&filled, sea_level);
    // Runoff weight is precipitation; arid ground loses flow.
    let m = moisture.data();
    let loss: Vec<f32> = m.par_iter().map(|&mv| p.hydrology.arid_loss * (1.0 - mv).powi(2)).collect();
    let flow = hydrology::flow_accumulation(&filled, &dirs, m, &loss);
    timings.flow_ms = ms(t);
    set(750);

    let t = Instant::now();
    let (lake_ids, lakes) = hydrology::find_lakes(elev, &filled, Some(moisture.data()), &p.hydrology);
    timings.lakes_ms = ms(t);
    set(800);

    let t = Instant::now();
    let net = hydrology::trace_rivers(&filled, &dirs, &flow, &lake_ids, sea_level, &p.hydrology);
    timings.rivers_ms = ms(t);
    set(870);

    let t = Instant::now();
    let water = hydrology::rasterize_water(elev, &dirs, &lake_ids, &net, sea_level, &p.hydrology);
    timings.water_ms = ms(t);
    set(930);

    let t = Instant::now();
    let (biome, forest) = biome::classify(elev, sea_level, &moisture, &temperature, &lake_ids, &p.biomes);
    timings.biome_ms = ms(t);
    set(1000);
    timings.total_ms = ms(t_all);
    let _ = n;

    Derived {
        moisture,
        temperature,
        filled,
        flow: ScalarField::from_vec(elev.width(), elev.height(), flow),
        water,
        biome,
        forest,
        lake_ids,
        lakes,
        rivers: net.rivers,
        river_threshold: net.threshold,
        timings,
        cancelled: cancel.load(Ordering::Relaxed),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::terrain::{generate, TerrainParams};

    #[test]
    fn chain_runs_on_generated_terrain() {
        let e = generate(256, 256, &TerrainParams::default(), &AtomicU32::new(0), &AtomicBool::new(false));
        let d = compute(&e, 0.0, &DerivedParams::default(), &AtomicBool::new(false), &AtomicU32::new(0));
        assert!(!d.cancelled);
        assert!(!d.rivers.is_empty(), "a continent should have rivers");
        assert!(d.water.data().iter().any(|v| *v > 0.5));
        let land = e.data().iter().filter(|v| **v > 0.0).count();
        let ocean = d.biome.iter().filter(|b| **b == 0).count();
        assert_eq!(ocean, e.data().len() - land);
        assert!(d.biome.iter().any(|b| *b != 0 && *b != 1));
    }
}
