//! Tile geometry and dirty-tile bitsets.

use crate::field::TILE;
use serde::{Deserialize, Serialize};

/// An axis-aligned rectangle in field pixel coordinates. `max` is exclusive.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct PixelRect {
    pub x0: u32,
    pub y0: u32,
    pub x1: u32,
    pub y1: u32,
}

impl PixelRect {
    pub const EMPTY: PixelRect = PixelRect { x0: 0, y0: 0, x1: 0, y1: 0 };

    pub fn new(x0: u32, y0: u32, x1: u32, y1: u32) -> Self {
        Self { x0, y0, x1, y1 }
    }

    /// Build a rect from a floating-point centre and radius, clamped to the field.
    pub fn around(cx: f32, cy: f32, radius: f32, width: u32, height: u32) -> Self {
        let r = radius.max(0.0) + 1.0;
        let x0 = (cx - r).floor().max(0.0) as u32;
        let y0 = (cy - r).floor().max(0.0) as u32;
        let x1 = ((cx + r).ceil().max(0.0) as u32).min(width);
        let y1 = ((cy + r).ceil().max(0.0) as u32).min(height);
        Self { x0: x0.min(x1), y0: y0.min(y1), x1, y1 }
    }

    pub fn is_empty(&self) -> bool {
        self.x1 <= self.x0 || self.y1 <= self.y0
    }
    pub fn width(&self) -> u32 {
        self.x1.saturating_sub(self.x0)
    }
    pub fn height(&self) -> u32 {
        self.y1.saturating_sub(self.y0)
    }
    pub fn area(&self) -> u64 {
        self.width() as u64 * self.height() as u64
    }

    pub fn union(&self, o: &PixelRect) -> PixelRect {
        if self.is_empty() {
            return *o;
        }
        if o.is_empty() {
            return *self;
        }
        PixelRect {
            x0: self.x0.min(o.x0),
            y0: self.y0.min(o.y0),
            x1: self.x1.max(o.x1),
            y1: self.y1.max(o.y1),
        }
    }

    pub fn intersect(&self, o: &PixelRect) -> PixelRect {
        let r = PixelRect {
            x0: self.x0.max(o.x0),
            y0: self.y0.max(o.y0),
            x1: self.x1.min(o.x1),
            y1: self.y1.min(o.y1),
        };
        if r.is_empty() {
            PixelRect::EMPTY
        } else {
            r
        }
    }

    /// Grow by `r` pixels on each side, clamped to `[0, w) × [0, h)`.
    pub fn dilate(&self, r: u32, w: u32, h: u32) -> PixelRect {
        if self.is_empty() {
            return *self;
        }
        PixelRect {
            x0: self.x0.saturating_sub(r),
            y0: self.y0.saturating_sub(r),
            x1: (self.x1 + r).min(w),
            y1: (self.y1 + r).min(h),
        }
    }

    /// Snap outward to tile boundaries.
    pub fn to_tile_aligned(&self, w: u32, h: u32) -> PixelRect {
        if self.is_empty() {
            return *self;
        }
        PixelRect {
            x0: self.x0 / TILE * TILE,
            y0: self.y0 / TILE * TILE,
            x1: (self.x1.div_ceil(TILE) * TILE).min(w),
            y1: (self.y1.div_ceil(TILE) * TILE).min(h),
        }
    }
}

/// A dense bitset over the tiles of a field. Used as the dirty region type
/// throughout the engine.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TileSet {
    tiles_x: u32,
    tiles_y: u32,
    bits: Vec<u64>,
    count: u32,
}

impl TileSet {
    pub fn new(tiles_x: u32, tiles_y: u32) -> Self {
        let n = (tiles_x as usize * tiles_y as usize).div_ceil(64);
        Self { tiles_x, tiles_y, bits: vec![0; n], count: 0 }
    }

    pub fn for_field(width: u32, height: u32) -> Self {
        Self::new(width.div_ceil(TILE), height.div_ceil(TILE))
    }

    pub fn tiles_x(&self) -> u32 {
        self.tiles_x
    }
    pub fn tiles_y(&self) -> u32 {
        self.tiles_y
    }
    pub fn total_tiles(&self) -> u32 {
        self.tiles_x * self.tiles_y
    }
    pub fn len(&self) -> u32 {
        self.count
    }
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    pub fn contains(&self, tx: u32, ty: u32) -> bool {
        if tx >= self.tiles_x || ty >= self.tiles_y {
            return false;
        }
        let i = (ty * self.tiles_x + tx) as usize;
        self.bits[i / 64] & (1u64 << (i % 64)) != 0
    }

    pub fn contains_index(&self, i: u32) -> bool {
        let i = i as usize;
        i / 64 < self.bits.len() && self.bits[i / 64] & (1u64 << (i % 64)) != 0
    }

    pub fn insert(&mut self, tx: u32, ty: u32) -> bool {
        if tx >= self.tiles_x || ty >= self.tiles_y {
            return false;
        }
        self.insert_index(ty * self.tiles_x + tx)
    }

    pub fn insert_index(&mut self, i: u32) -> bool {
        let i = i as usize;
        let w = &mut self.bits[i / 64];
        let m = 1u64 << (i % 64);
        if *w & m == 0 {
            *w |= m;
            self.count += 1;
            true
        } else {
            false
        }
    }

    pub fn remove_index(&mut self, i: u32) {
        let i = i as usize;
        let w = &mut self.bits[i / 64];
        let m = 1u64 << (i % 64);
        if *w & m != 0 {
            *w &= !m;
            self.count -= 1;
        }
    }

    pub fn clear(&mut self) {
        self.bits.iter_mut().for_each(|w| *w = 0);
        self.count = 0;
    }

    pub fn fill(&mut self) {
        let total = self.total_tiles() as usize;
        for (i, w) in self.bits.iter_mut().enumerate() {
            let remaining = total.saturating_sub(i * 64);
            *w = if remaining >= 64 { u64::MAX } else { (1u64 << remaining) - 1 };
        }
        self.count = total as u32;
    }

    /// Mark every tile overlapping a pixel rect.
    pub fn insert_rect(&mut self, r: &PixelRect) {
        if r.is_empty() {
            return;
        }
        let tx0 = r.x0 / TILE;
        let ty0 = r.y0 / TILE;
        let tx1 = ((r.x1 - 1) / TILE).min(self.tiles_x.saturating_sub(1));
        let ty1 = ((r.y1 - 1) / TILE).min(self.tiles_y.saturating_sub(1));
        for ty in ty0..=ty1 {
            for tx in tx0..=tx1 {
                self.insert(tx, ty);
            }
        }
    }

    pub fn union_with(&mut self, o: &TileSet) {
        debug_assert_eq!(self.bits.len(), o.bits.len());
        let mut count = 0u32;
        for (a, b) in self.bits.iter_mut().zip(&o.bits) {
            *a |= *b;
            count += a.count_ones();
        }
        self.count = count;
    }

    pub fn take(&mut self) -> TileSet {
        let out = self.clone();
        self.clear();
        out
    }

    /// Iterate over set tiles as `(tx, ty)`.
    pub fn iter(&self) -> impl Iterator<Item = (u32, u32)> + '_ {
        let tiles_x = self.tiles_x;
        self.iter_indices().map(move |i| (i % tiles_x, i / tiles_x))
    }

    /// Iterate over set tiles as linear tile indices.
    pub fn iter_indices(&self) -> impl Iterator<Item = u32> + '_ {
        self.bits.iter().enumerate().flat_map(|(wi, &w)| {
            let mut w = w;
            std::iter::from_fn(move || {
                if w == 0 {
                    None
                } else {
                    let b = w.trailing_zeros();
                    w &= w - 1;
                    Some((wi * 64) as u32 + b)
                }
            })
        })
    }

    /// Return a new set where every set tile is grown by `r` tiles in each direction
    /// (Chebyshev dilation). This is how a consumer's kernel radius widens the
    /// dirty region as it propagates through the graph.
    pub fn dilated(&self, r: u32) -> TileSet {
        if r == 0 || self.is_empty() {
            return self.clone();
        }
        let mut out = TileSet::new(self.tiles_x, self.tiles_y);
        for (tx, ty) in self.iter() {
            let x0 = tx.saturating_sub(r);
            let y0 = ty.saturating_sub(r);
            let x1 = (tx + r).min(self.tiles_x - 1);
            let y1 = (ty + r).min(self.tiles_y - 1);
            for y in y0..=y1 {
                for x in x0..=x1 {
                    out.insert(x, y);
                }
            }
        }
        out
    }

    /// Bounding pixel rect of all set tiles (clamped to the given field size).
    pub fn bounding_rect(&self, width: u32, height: u32) -> PixelRect {
        let mut r = PixelRect::EMPTY;
        for (tx, ty) in self.iter() {
            r = r.union(&PixelRect {
                x0: tx * TILE,
                y0: ty * TILE,
                x1: ((tx + 1) * TILE).min(width),
                y1: ((ty + 1) * TILE).min(height),
            });
        }
        r
    }

    /// Pixel rect of a single tile.
    pub fn tile_rect(tx: u32, ty: u32, width: u32, height: u32) -> PixelRect {
        PixelRect {
            x0: tx * TILE,
            y0: ty * TILE,
            x1: ((tx + 1) * TILE).min(width),
            y1: ((ty + 1) * TILE).min(height),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rect_marks_overlapping_tiles() {
        let mut s = TileSet::for_field(256, 256);
        s.insert_rect(&PixelRect::new(60, 0, 70, 1));
        assert_eq!(s.len(), 2);
        assert!(s.contains(0, 0) && s.contains(1, 0));
        s.insert_rect(&PixelRect::new(0, 0, 256, 256));
        assert_eq!(s.len(), 16);
    }

    #[test]
    fn dilation_and_iteration() {
        let mut s = TileSet::for_field(640, 640);
        s.insert(5, 5);
        let d = s.dilated(1);
        assert_eq!(d.len(), 9);
        let c = s.dilated(20);
        assert_eq!(c.len(), 100);
        let v: Vec<_> = d.iter().collect();
        assert_eq!(v.len(), 9);
        assert!(v.contains(&(4, 4)) && v.contains(&(6, 6)));
    }

    #[test]
    fn fill_counts_partial_word() {
        let mut s = TileSet::new(10, 10);
        s.fill();
        assert_eq!(s.len(), 100);
        assert_eq!(s.iter_indices().count(), 100);
    }
}
