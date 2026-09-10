//! Incremental per-tile statistics: the first CPU-side derived node.
//!
//! Keeps min/max/land-count per tile so that after a local edit only the
//! dirty tiles are rescanned; the global summary is a cheap reduction over
//! the per-tile table.

use crate::field::ScalarField;
use crate::tiles::TileSet;
use rayon::prelude::*;

#[derive(Clone, Copy, Debug, Default)]
pub struct TileStats {
    pub min: f32,
    pub max: f32,
    pub land: u32,
    pub texels: u32,
}

#[derive(Clone, Debug)]
pub struct FieldStats {
    tiles: Vec<TileStats>,
    tiles_x: u32,
    pub min: f32,
    pub max: f32,
    pub land_fraction: f32,
    /// Texels rescanned by the most recent update (for the profiler).
    pub last_update_texels: u64,
}

impl FieldStats {
    pub fn new(field: &ScalarField, sea_level: f32) -> Self {
        let mut s = Self {
            tiles: vec![TileStats::default(); field.tile_count() as usize],
            tiles_x: field.tiles_x(),
            min: 0.0,
            max: 0.0,
            land_fraction: 0.0,
            last_update_texels: 0,
        };
        let mut all = field.empty_tileset();
        all.fill();
        s.update(field, &all, sea_level);
        s
    }

    fn scan_tile(field: &ScalarField, index: u32, sea_level: f32) -> TileStats {
        let r = field.tile_rect_index(index);
        let mut t = TileStats { min: f32::INFINITY, max: f32::NEG_INFINITY, land: 0, texels: r.area() as u32 };
        for y in r.y0..r.y1 {
            let off = y as usize * field.width() as usize;
            for &v in &field.data()[off + r.x0 as usize..off + r.x1 as usize] {
                t.min = t.min.min(v);
                t.max = t.max.max(v);
                t.land += (v > sea_level) as u32;
            }
        }
        t
    }

    /// Rescan only the given tiles, then refresh the global summary.
    pub fn update(&mut self, field: &ScalarField, dirty: &TileSet, sea_level: f32) {
        let _ = self.tiles_x;
        let idx: Vec<u32> = dirty.iter_indices().collect();
        let scanned: Vec<(u32, TileStats)> =
            idx.par_iter().map(|&i| (i, Self::scan_tile(field, i, sea_level))).collect();
        let mut texels = 0u64;
        for (i, t) in scanned {
            texels += t.texels as u64;
            self.tiles[i as usize] = t;
        }
        self.last_update_texels = texels;
        let (mut lo, mut hi, mut land, mut total) = (f32::INFINITY, f32::NEG_INFINITY, 0u64, 0u64);
        for t in &self.tiles {
            lo = lo.min(t.min);
            hi = hi.max(t.max);
            land += t.land as u64;
            total += t.texels as u64;
        }
        self.min = lo;
        self.max = hi;
        self.land_fraction = if total > 0 { land as f32 / total as f32 } else { 0.0 };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn incremental_matches_full() {
        let mut f = ScalarField::new(300, 200, -10.0);
        let mut st = FieldStats::new(&f, 0.0);
        assert_eq!(st.land_fraction, 0.0);
        f.set(299, 199, 500.0);
        let mut d = f.empty_tileset();
        d.insert(4, 3);
        st.update(&f, &d, 0.0);
        let full = FieldStats::new(&f, 0.0);
        assert_eq!(st.max, 500.0);
        assert_eq!(st.land_fraction, full.land_fraction);
        assert!((st.land_fraction - 1.0 / 60000.0).abs() < 1e-9);
    }
}
