//! Scalar fields: `f32` rasters with tile bookkeeping.

use crate::tiles::{PixelRect, TileSet};
use rayon::prelude::*;

/// Edge length of a tile in field pixels. 64 × 4 bytes = 256 bytes per row,
/// which is exactly wgpu's `COPY_BYTES_PER_ROW_ALIGNMENT`, so a tile copies to
/// and from a staging buffer without padding.
pub const TILE: u32 = 64;

/// Number of texels in a tile.
pub const TILE_TEXELS: usize = (TILE * TILE) as usize;

/// A dense, row-major `f32` raster. This is the CPU mirror of a GPU field
/// texture; the two are kept in sync by tile-granular readback (GPU → CPU)
/// and tile-granular upload (CPU → GPU).
#[derive(Clone, Debug)]
pub struct ScalarField {
    width: u32,
    height: u32,
    data: Vec<f32>,
}

impl ScalarField {
    pub fn new(width: u32, height: u32, fill: f32) -> Self {
        assert!(width > 0 && height > 0, "field dimensions must be non-zero");
        Self { width, height, data: vec![fill; width as usize * height as usize] }
    }

    pub fn from_vec(width: u32, height: u32, data: Vec<f32>) -> Self {
        assert_eq!(data.len(), width as usize * height as usize);
        Self { width, height, data }
    }

    pub fn width(&self) -> u32 {
        self.width
    }
    pub fn height(&self) -> u32 {
        self.height
    }
    pub fn tiles_x(&self) -> u32 {
        self.width.div_ceil(TILE)
    }
    pub fn tiles_y(&self) -> u32 {
        self.height.div_ceil(TILE)
    }
    pub fn tile_count(&self) -> u32 {
        self.tiles_x() * self.tiles_y()
    }
    pub fn bounds(&self) -> PixelRect {
        PixelRect::new(0, 0, self.width, self.height)
    }
    pub fn data(&self) -> &[f32] {
        &self.data
    }
    pub fn data_mut(&mut self) -> &mut [f32] {
        &mut self.data
    }
    pub fn into_vec(self) -> Vec<f32> {
        self.data
    }
    pub fn byte_len(&self) -> usize {
        self.data.len() * 4
    }
    pub fn empty_tileset(&self) -> TileSet {
        TileSet::for_field(self.width, self.height)
    }

    #[inline]
    pub fn get(&self, x: u32, y: u32) -> f32 {
        self.data[y as usize * self.width as usize + x as usize]
    }

    #[inline]
    pub fn set(&mut self, x: u32, y: u32, v: f32) {
        self.data[y as usize * self.width as usize + x as usize] = v;
    }

    /// Clamped integer lookup.
    #[inline]
    pub fn get_clamped(&self, x: i64, y: i64) -> f32 {
        let x = x.clamp(0, self.width as i64 - 1) as usize;
        let y = y.clamp(0, self.height as i64 - 1) as usize;
        self.data[y * self.width as usize + x]
    }

    /// Bilinear sample at continuous pixel coordinates (texel centres at `i + 0.5`).
    pub fn sample(&self, x: f32, y: f32) -> f32 {
        let fx = x - 0.5;
        let fy = y - 0.5;
        let x0 = fx.floor();
        let y0 = fy.floor();
        let tx = fx - x0;
        let ty = fy - y0;
        let (x0, y0) = (x0 as i64, y0 as i64);
        let a = self.get_clamped(x0, y0);
        let b = self.get_clamped(x0 + 1, y0);
        let c = self.get_clamped(x0, y0 + 1);
        let d = self.get_clamped(x0 + 1, y0 + 1);
        let top = a + (b - a) * tx;
        let bot = c + (d - c) * tx;
        top + (bot - top) * ty
    }

    /// Pixel rect of tile `(tx, ty)`, clamped to the field.
    pub fn tile_rect(&self, tx: u32, ty: u32) -> PixelRect {
        TileSet::tile_rect(tx, ty, self.width, self.height)
    }

    pub fn tile_rect_index(&self, index: u32) -> PixelRect {
        let tx = index % self.tiles_x();
        let ty = index / self.tiles_x();
        self.tile_rect(tx, ty)
    }

    /// Copy the contents of a tile out into a `TILE×TILE` buffer (row-major,
    /// TILE floats per row, padded with the last valid values on the edge tiles).
    pub fn read_tile(&self, index: u32, out: &mut [f32]) {
        debug_assert_eq!(out.len(), TILE_TEXELS);
        let r = self.tile_rect_index(index);
        for ty in 0..TILE {
            let y = (r.y0 + ty).min(self.height - 1);
            let row = &self.data[(y as usize * self.width as usize + r.x0 as usize)..];
            let w = r.width() as usize;
            let dst = &mut out[(ty * TILE) as usize..((ty + 1) * TILE) as usize];
            dst[..w].copy_from_slice(&row[..w]);
            for v in dst[w..].iter_mut() {
                *v = row[w.saturating_sub(1)];
            }
        }
    }

    pub fn read_tile_boxed(&self, index: u32) -> Box<[f32]> {
        let mut v = vec![0f32; TILE_TEXELS].into_boxed_slice();
        self.read_tile(index, &mut v);
        v
    }

    /// Write a `TILE×TILE` buffer into a tile, ignoring the padded region on edge tiles.
    pub fn write_tile(&mut self, index: u32, src: &[f32]) {
        debug_assert_eq!(src.len(), TILE_TEXELS);
        let r = self.tile_rect_index(index);
        let w = r.width() as usize;
        for ty in 0..r.height() {
            let y = r.y0 + ty;
            let dst_off = y as usize * self.width as usize + r.x0 as usize;
            self.data[dst_off..dst_off + w].copy_from_slice(&src[(ty * TILE) as usize..(ty * TILE) as usize + w]);
        }
    }

    /// Copy a pixel rect out as a tightly packed row-major buffer.
    pub fn read_rect(&self, r: &PixelRect) -> Vec<f32> {
        let mut out = Vec::with_capacity(r.area() as usize);
        for y in r.y0..r.y1 {
            let off = y as usize * self.width as usize;
            out.extend_from_slice(&self.data[off + r.x0 as usize..off + r.x1 as usize]);
        }
        out
    }

    pub fn write_rect(&mut self, r: &PixelRect, src: &[f32]) {
        let w = r.width() as usize;
        for (i, y) in (r.y0..r.y1).enumerate() {
            let off = y as usize * self.width as usize + r.x0 as usize;
            self.data[off..off + w].copy_from_slice(&src[i * w..(i + 1) * w]);
        }
    }

    /// Apply `f` to every texel in parallel (row-parallel).
    pub fn par_map_inplace(&mut self, f: impl Fn(u32, u32, f32) -> f32 + Sync) {
        let w = self.width as usize;
        self.data.par_chunks_mut(w).enumerate().for_each(|(y, row)| {
            for (x, v) in row.iter_mut().enumerate() {
                *v = f(x as u32, y as u32, *v);
            }
        });
    }

    pub fn min_max(&self) -> (f32, f32) {
        self.data
            .par_chunks(1 << 16)
            .map(|c| c.iter().fold((f32::INFINITY, f32::NEG_INFINITY), |(lo, hi), &v| (lo.min(v), hi.max(v))))
            .reduce(|| (f32::INFINITY, f32::NEG_INFINITY), |a, b| (a.0.min(b.0), a.1.max(b.1)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tile_round_trip_on_edge_tiles() {
        let mut f = ScalarField::new(100, 70, 0.0);
        f.par_map_inplace(|x, y, _| (x * 1000 + y) as f32);
        let orig = f.clone();
        let n = f.tile_count();
        assert_eq!(n, 4);
        for i in 0..n {
            let t = f.read_tile_boxed(i);
            f.write_tile(i, &t);
        }
        assert_eq!(f.data(), orig.data());
    }

    #[test]
    fn bilinear_sample_is_exact_at_centres() {
        let mut f = ScalarField::new(4, 4, 0.0);
        f.set(1, 1, 5.0);
        assert_eq!(f.sample(1.5, 1.5), 5.0);
        assert!((f.sample(2.0, 1.5) - 2.5).abs() < 1e-6);
    }
}
