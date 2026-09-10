//! Biome classification: an editable matrix over temperature × moisture bins.

use crate::field::ScalarField;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};

#[repr(u8)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Hash)]
pub enum Biome {
    Ocean = 0,
    Lake = 1,
    Ice = 2,
    Tundra = 3,
    Taiga = 4,
    ColdDesert = 5,
    Steppe = 6,
    TemperateGrassland = 7,
    TemperateForest = 8,
    TemperateRainforest = 9,
    Shrubland = 10,
    Desert = 11,
    Savanna = 12,
    TropicalSeasonalForest = 13,
    TropicalRainforest = 14,
    Alpine = 15,
}

impl Biome {
    pub const COUNT: usize = 16;
    pub const ALL: [Biome; 16] = [
        Biome::Ocean,
        Biome::Lake,
        Biome::Ice,
        Biome::Tundra,
        Biome::Taiga,
        Biome::ColdDesert,
        Biome::Steppe,
        Biome::TemperateGrassland,
        Biome::TemperateForest,
        Biome::TemperateRainforest,
        Biome::Shrubland,
        Biome::Desert,
        Biome::Savanna,
        Biome::TropicalSeasonalForest,
        Biome::TropicalRainforest,
        Biome::Alpine,
    ];

    pub fn from_u8(v: u8) -> Biome {
        Biome::ALL.get(v as usize).copied().unwrap_or(Biome::Ocean)
    }

    pub fn label(self) -> &'static str {
        match self {
            Biome::Ocean => "Ocean",
            Biome::Lake => "Lake",
            Biome::Ice => "Ice",
            Biome::Tundra => "Tundra",
            Biome::Taiga => "Taiga",
            Biome::ColdDesert => "Cold desert",
            Biome::Steppe => "Steppe",
            Biome::TemperateGrassland => "Temperate grassland",
            Biome::TemperateForest => "Temperate forest",
            Biome::TemperateRainforest => "Temperate rainforest",
            Biome::Shrubland => "Shrubland",
            Biome::Desert => "Desert",
            Biome::Savanna => "Savanna",
            Biome::TropicalSeasonalForest => "Tropical seasonal forest",
            Biome::TropicalRainforest => "Tropical rainforest",
            Biome::Alpine => "Alpine",
        }
    }

    /// Display colour (sRGB 0..1).
    pub fn color(self) -> [f32; 3] {
        match self {
            Biome::Ocean => [0.30, 0.45, 0.62],
            Biome::Lake => [0.40, 0.62, 0.78],
            Biome::Ice => [0.93, 0.95, 0.97],
            Biome::Tundra => [0.72, 0.74, 0.62],
            Biome::Taiga => [0.36, 0.52, 0.40],
            Biome::ColdDesert => [0.76, 0.72, 0.60],
            Biome::Steppe => [0.78, 0.74, 0.48],
            Biome::TemperateGrassland => [0.66, 0.74, 0.42],
            Biome::TemperateForest => [0.38, 0.58, 0.32],
            Biome::TemperateRainforest => [0.26, 0.48, 0.30],
            Biome::Shrubland => [0.72, 0.66, 0.40],
            Biome::Desert => [0.90, 0.82, 0.58],
            Biome::Savanna => [0.80, 0.76, 0.38],
            Biome::TropicalSeasonalForest => [0.44, 0.62, 0.26],
            Biome::TropicalRainforest => [0.16, 0.44, 0.22],
            Biome::Alpine => [0.60, 0.58, 0.56],
        }
    }

    /// Base tree cover 0..1 for the forest-density field.
    pub fn forest_density(self) -> f32 {
        match self {
            Biome::TropicalRainforest => 1.0,
            Biome::TemperateRainforest => 0.95,
            Biome::TemperateForest => 0.8,
            Biome::Taiga => 0.75,
            Biome::TropicalSeasonalForest => 0.7,
            Biome::Shrubland => 0.25,
            Biome::Savanna => 0.2,
            Biome::TemperateGrassland => 0.1,
            Biome::Steppe => 0.05,
            Biome::Tundra => 0.02,
            _ => 0.0,
        }
    }
}

pub const TEMP_BINS: usize = 5;
pub const MOIST_BINS: usize = 5;
pub const TEMP_BIN_LABELS: [&str; TEMP_BINS] = ["Polar", "Cold", "Cool", "Warm", "Tropical"];
pub const MOIST_BIN_LABELS: [&str; MOIST_BINS] = ["Arid", "Semi-arid", "Sub-humid", "Humid", "Wet"];

/// User-editable Whittaker-style matrix.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BiomeMatrix {
    /// Upper temperature bound (°C) of bins 0..TEMP_BINS-1 (last bin is open).
    pub temp_edges: [f32; TEMP_BINS - 1],
    /// Upper moisture bound of bins 0..MOIST_BINS-1.
    pub moist_edges: [f32; MOIST_BINS - 1],
    /// `cells[temp_bin][moist_bin]`.
    pub cells: [[Biome; MOIST_BINS]; TEMP_BINS],
    /// Land above this temperature-derived line with steep slope becomes Alpine.
    pub alpine_slope: f32,
}

impl Default for BiomeMatrix {
    fn default() -> Self {
        use Biome::*;
        Self {
            temp_edges: [-6.0, 3.0, 12.0, 20.0],
            moist_edges: [0.1, 0.25, 0.5, 0.75],
            cells: [
                [Ice, Ice, Tundra, Tundra, Tundra],
                [ColdDesert, Tundra, Taiga, Taiga, Taiga],
                [ColdDesert, Steppe, TemperateGrassland, TemperateForest, TemperateRainforest],
                [Desert, Shrubland, TemperateGrassland, TemperateForest, TemperateRainforest],
                [Desert, Savanna, Savanna, TropicalSeasonalForest, TropicalRainforest],
            ],
            alpine_slope: 60.0,
        }
    }
}

impl BiomeMatrix {
    pub fn temp_bin(&self, t: f32) -> usize {
        self.temp_edges.iter().position(|&e| t < e).unwrap_or(TEMP_BINS - 1)
    }
    pub fn moist_bin(&self, m: f32) -> usize {
        self.moist_edges.iter().position(|&e| m < e).unwrap_or(MOIST_BINS - 1)
    }
    pub fn classify(&self, t: f32, m: f32) -> Biome {
        self.cells[self.temp_bin(t)][self.moist_bin(m)]
    }
}

/// Per-cell biome ids and the derived forest-density field.
pub fn classify(
    elev: &ScalarField,
    sea_level: f32,
    moisture: &ScalarField,
    temperature: &ScalarField,
    lake_ids: &[u32],
    matrix: &BiomeMatrix,
) -> (Vec<u8>, ScalarField) {
    let (w, h) = (elev.width() as usize, elev.height() as usize);
    let e = elev.data();
    let m = moisture.data();
    let t = temperature.data();
    let mut biome = vec![0u8; w * h];
    let mut density = vec![0f32; w * h];
    biome
        .par_chunks_mut(w)
        .zip(density.par_chunks_mut(w))
        .enumerate()
        .for_each(|(y, (brow, drow))| {
            for x in 0..w {
                let i = y * w + x;
                let b = if e[i] <= sea_level {
                    Biome::Ocean
                } else if lake_ids[i] != 0 {
                    Biome::Lake
                } else {
                    // Slope from central differences.
                    let xl = e[y * w + x.saturating_sub(1)];
                    let xr = e[y * w + (x + 1).min(w - 1)];
                    let yu = e[y.saturating_sub(1) * w + x];
                    let yd = e[(y + 1).min(h - 1) * w + x];
                    let slope = ((xr - xl).abs() + (yd - yu).abs()) * 0.5;
                    let b = matrix.classify(t[i], m[i]);
                    if slope > matrix.alpine_slope && t[i] < 8.0 && b != Biome::Ice {
                        Biome::Alpine
                    } else {
                        b
                    }
                };
                brow[x] = b as u8;
                // Treeline: fade cover as temperature drops toward -4 °C.
                let treeline = ((t[i] + 4.0) / 6.0).clamp(0.0, 1.0);
                drow[x] = b.forest_density() * treeline;
            }
        });
    (biome, ScalarField::from_vec(elev.width(), elev.height(), density))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matrix_bins() {
        let m = BiomeMatrix::default();
        assert_eq!(m.classify(-10.0, 0.5), Biome::Tundra);
        assert_eq!(m.classify(25.0, 0.05), Biome::Desert);
        assert_eq!(m.classify(25.0, 0.9), Biome::TropicalRainforest);
        assert_eq!(m.classify(8.0, 0.6), Biome::TemperateForest);
    }
}
