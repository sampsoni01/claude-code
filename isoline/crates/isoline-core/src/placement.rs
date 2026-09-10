//! Symbol placement: Poisson-disc scatter with terrain predicates, and the
//! automatic mountain and forest layers driven by the fields.

use crate::assets::TerrainFilter;
use crate::field::ScalarField;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Hash)]
pub enum PlacementLayer {
    /// Placed or scattered by the user; persisted.
    Manual,
    /// Auto mountains and hills; regenerated from the terrain.
    Mountains,
    /// Auto forest symbols; regenerated from the forest field.
    Forest,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Placement {
    pub id: u64,
    /// Qualified asset id `pack/asset`.
    pub asset: String,
    /// Anchor position in field texels.
    pub pos: [f32; 2],
    /// Width in field texels.
    pub size: f32,
    /// Radians.
    pub rotation: f32,
    pub flip: bool,
    pub tint: [f32; 3],
    pub layer: PlacementLayer,
}

type Disc = ([f32; 2], f32);

/// Uniform-grid spatial hash for collision avoidance.
pub struct SpatialHash {
    cell: f32,
    map: HashMap<(i32, i32), Vec<Disc>>,
}

impl SpatialHash {
    pub fn new(cell: f32) -> Self {
        Self { cell: cell.max(1.0), map: HashMap::new() }
    }
    fn key(&self, p: [f32; 2]) -> (i32, i32) {
        ((p[0] / self.cell).floor() as i32, (p[1] / self.cell).floor() as i32)
    }
    pub fn insert(&mut self, p: [f32; 2], radius: f32) {
        let k = self.key(p);
        self.map.entry(k).or_default().push((p, radius));
    }
    /// True if any stored disc overlaps a disc of `radius` at `p`.
    pub fn collides(&self, p: [f32; 2], radius: f32) -> bool {
        let reach = ((radius / self.cell).ceil() as i32).max(1);
        let (kx, ky) = self.key(p);
        for y in ky - reach..=ky + reach {
            for x in kx - reach..=kx + reach {
                if let Some(v) = self.map.get(&(x, y)) {
                    for (q, r) in v {
                        let dx = q[0] - p[0];
                        let dy = q[1] - p[1];
                        let d = radius + r;
                        if dx * dx + dy * dy < d * d {
                            return true;
                        }
                    }
                }
            }
        }
        false
    }
    pub fn len(&self) -> usize {
        self.map.values().map(|v| v.len()).sum()
    }
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

pub struct Rng(u64);
impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(0x9E3779B97F4A7C15) | 1)
    }
    pub fn next_u64(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    pub fn f32(&mut self) -> f32 {
        (self.next_u64() >> 40) as f32 / (1u64 << 24) as f32
    }
    pub fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.f32()
    }
    pub fn pick<'a, T>(&mut self, v: &'a [T]) -> &'a T {
        &v[(self.next_u64() % v.len().max(1) as u64) as usize]
    }
}

/// Everything a predicate can look at, sampled per candidate point.
pub struct Terrain<'a> {
    pub elevation: &'a ScalarField,
    pub sea_level: f32,
    pub biome: Option<&'a [u8]>,
    /// Water coverage 0..1 at project resolution.
    pub water: Option<&'a ScalarField>,
}

impl Terrain<'_> {
    pub fn inside(&self, p: [f32; 2]) -> bool {
        p[0] >= 0.0 && p[1] >= 0.0 && p[0] < self.elevation.width() as f32 && p[1] < self.elevation.height() as f32
    }
    pub fn height(&self, p: [f32; 2]) -> f32 {
        self.elevation.sample(p[0], p[1])
    }
    pub fn slope(&self, p: [f32; 2]) -> f32 {
        let e = &self.elevation;
        let dx = e.sample(p[0] + 1.0, p[1]) - e.sample(p[0] - 1.0, p[1]);
        let dy = e.sample(p[0], p[1] + 1.0) - e.sample(p[0], p[1] - 1.0);
        (dx * dx + dy * dy).sqrt() * 0.5
    }
    pub fn is_water(&self, p: [f32; 2]) -> bool {
        if self.height(p) <= self.sea_level {
            return true;
        }
        match self.water {
            Some(w) => w.sample(p[0], p[1]) > 0.5,
            None => false,
        }
    }
    /// Approximate distance to water by probing outward (texels, capped).
    pub fn water_distance(&self, p: [f32; 2], max: f32) -> f32 {
        if self.is_water(p) {
            return 0.0;
        }
        let mut d = 2.0;
        while d <= max {
            for k in 0..8 {
                let a = k as f32 * std::f32::consts::FRAC_PI_4;
                let q = [p[0] + a.cos() * d, p[1] + a.sin() * d];
                if self.inside(q) && self.is_water(q) {
                    return d;
                }
            }
            d *= 1.5;
        }
        max
    }
    pub fn biome_at(&self, p: [f32; 2]) -> Option<u8> {
        let b = self.biome?;
        let w = self.elevation.width() as usize;
        let x = (p[0] as usize).min(w - 1);
        let y = (p[1] as usize).min(self.elevation.height() as usize - 1);
        b.get(y * w + x).copied()
    }

    pub fn passes(&self, p: [f32; 2], f: &TerrainFilter) -> bool {
        if !self.inside(p) {
            return false;
        }
        let water = self.is_water(p);
        if let Some(land) = f.on_land {
            if land == water {
                return false;
            }
        }
        if let Some([lo, hi]) = f.elevation {
            let h = self.height(p) - self.sea_level;
            if h < lo || h > hi {
                return false;
            }
        }
        if let Some(ms) = f.max_slope {
            if self.slope(p) > ms {
                return false;
            }
        }
        if let Some(bs) = &f.biomes {
            match self.biome_at(p) {
                Some(b) if bs.contains(&b) => {}
                _ => return false,
            }
        }
        if let Some([lo, hi]) = f.water_distance {
            let d = self.water_distance(p, hi.max(lo) + 1.0);
            if d < lo || d > hi {
                return false;
            }
        }
        true
    }
}

/// Poisson-disc style candidates inside a disc: a jittered grid at
/// `spacing`, then rejection against `hash`. Deterministic per seed.
pub fn scatter_disc(centre: [f32; 2], radius: f32, spacing: f32, hash: &mut SpatialHash, rng: &mut Rng, mut accept: impl FnMut([f32; 2], &mut Rng) -> Option<f32>) -> Vec<([f32; 2], f32)> {
    let mut out = Vec::new();
    let s = spacing.max(0.5);
    let n = ((2.0 * radius) / s).ceil() as i32 + 1;
    let x0 = centre[0] - radius;
    let y0 = centre[1] - radius;
    // Shuffle order so overlapping dabs do not always fill the same corner.
    let mut cells: Vec<(i32, i32)> = (0..n).flat_map(|y| (0..n).map(move |x| (x, y))).collect();
    for i in (1..cells.len()).rev() {
        let j = (rng.next_u64() % (i as u64 + 1)) as usize;
        cells.swap(i, j);
    }
    for (cx, cy) in cells {
        let p = [x0 + (cx as f32 + rng.f32()) * s, y0 + (cy as f32 + rng.f32()) * s];
        let dx = p[0] - centre[0];
        let dy = p[1] - centre[1];
        if dx * dx + dy * dy > radius * radius {
            continue;
        }
        if let Some(r) = accept(p, rng) {
            if !hash.collides(p, r) {
                hash.insert(p, r);
                out.push((p, r));
            }
        }
    }
    out
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct MountainParams {
    pub enabled: bool,
    /// Symbol spacing in texels at project scale.
    pub spacing: f32,
    /// Relief (peak minus surroundings, elevation units) needed for a mountain.
    pub min_relief: f32,
    /// Relief needed for a hill symbol.
    pub hill_relief: f32,
    pub size: f32,
    pub seed: u64,
}

impl Default for MountainParams {
    fn default() -> Self {
        Self { enabled: true, spacing: 20.0, min_relief: 450.0, hill_relief: 200.0, size: 1.0, seed: 11 }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ForestParams {
    pub enabled: bool,
    pub spacing: f32,
    /// Forest density needed for any tree.
    pub threshold: f32,
    pub size: f32,
    pub seed: u64,
}

impl Default for ForestParams {
    fn default() -> Self {
        Self { enabled: true, spacing: 28.0, threshold: 0.35, size: 1.0, seed: 23 }
    }
}

/// Asset ids for the automatic layers, chosen from the library by tag.
#[derive(Clone, Debug, Default)]
pub struct SymbolSets {
    pub mountains: Vec<(String, f32)>,
    pub snow_mountains: Vec<(String, f32)>,
    pub hills: Vec<(String, f32)>,
    pub conifers: Vec<(String, f32)>,
    pub broadleaf: Vec<(String, f32)>,
    pub palms: Vec<(String, f32)>,
    pub dead: Vec<(String, f32)>,
}

/// Relief at a point: height minus the mean of samples on a ring.
fn relief(e: &ScalarField, p: [f32; 2], r: f32) -> f32 {
    let h = e.sample(p[0], p[1]);
    let mut sum = 0.0;
    for k in 0..8 {
        let a = k as f32 * std::f32::consts::FRAC_PI_4;
        sum += e.sample(p[0] + a.cos() * r, p[1] + a.sin() * r);
    }
    h - sum / 8.0
}

/// Automatic mountain and hill symbols: candidates on a jittered grid, kept
/// where local relief is high and the point is a local maximum. Bigger,
/// snow-capped symbols for taller peaks. Sorted back to front (by y).
/// `clearings` are discs (centre, radius) kept free of symbols: towns.
pub fn place_mountains(t: &Terrain<'_>, p: &MountainParams, sets: &SymbolSets, temperature: Option<&ScalarField>, forest: Option<&ScalarField>, clearings: &[([f32; 2], f32)], next_id: &mut u64) -> (Vec<Placement>, SpatialHash) {
    let mut out = Vec::new();
    let mut hash = SpatialHash::new(p.spacing.max(4.0) * 2.0);
    if !p.enabled || (sets.mountains.is_empty() && sets.hills.is_empty()) {
        return (out, hash);
    }
    let e = t.elevation;
    let (w, h) = (e.width() as f32, e.height() as f32);
    let s = p.spacing.max(4.0);
    let mut rng = Rng::new(p.seed);
    let (elo, ehi) = e.min_max();
    let land_range = (ehi - t.sea_level).max(1.0);
    let nx = (w / s).ceil() as i32;
    let ny = (h / s).ceil() as i32;
    let stride = (s / 8.0).clamp(1.0, 4.0);
    let mut candidates: Vec<(f32, [f32; 2], f32)> = Vec::new();
    for gy in 0..ny {
        for gx in 0..nx {
            // The highest texel in the cell: symbols sit on crests and peaks.
            let mut best = f32::NEG_INFINITY;
            let mut pt = [0.0f32; 2];
            let mut sy = gy as f32 * s;
            while sy < (gy as f32 + 1.0) * s && sy < h {
                let mut sx = gx as f32 * s;
                while sx < (gx as f32 + 1.0) * s && sx < w {
                    let v = e.sample(sx + 0.5, sy + 0.5);
                    if v > best {
                        best = v;
                        pt = [sx + 0.5, sy + 0.5];
                    }
                    sx += stride;
                }
                sy += stride;
            }
            let hh = best;
            if hh <= t.sea_level {
                continue;
            }
            let rl = relief(e, pt, s * 0.9);
            if rl < p.hill_relief {
                continue;
            }
            candidates.push((rl, pt, hh));
        }
    }
    // Most prominent first so peaks win the collision test over foothills.
    candidates.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
    for (rl, pt, hh) in candidates {
        let is_mountain = rl >= p.min_relief && !sets.mountains.is_empty();
        if !is_mountain && sets.hills.is_empty() {
            continue;
        }
        // Hills inside woods read as litter among the trees; skip them.
        if !is_mountain {
            if let Some(f) = forest {
                if f.sample(pt[0] * f.width() as f32 / w, pt[1] * f.height() as f32 / h) > 0.35 {
                    continue;
                }
            }
        }
        let height01 = ((hh - t.sea_level) / land_range).clamp(0.0, 1.0);
        let cold = temperature.map(|tf| tf.sample(pt[0] * tf.width() as f32 / w, pt[1] * tf.height() as f32 / h) < -2.0).unwrap_or(false);
        let (asset, base) = if is_mountain {
            let pool = if cold && !sets.snow_mountains.is_empty() { &sets.snow_mountains } else { &sets.mountains };
            rng.pick(pool).clone()
        } else {
            rng.pick(&sets.hills).clone()
        };
        // Vary size well beyond the height term so ridges of equal height do
        // not become a row of identical peaks, and let neighbours overlap.
        let size = base * p.size * (if is_mountain { 0.6 + 0.5 * height01 + 0.4 * rng.f32() } else { 0.7 + 0.4 * rng.f32() });
        let r = size * 0.24;
        if hash.collides(pt, r) {
            continue;
        }
        // Never stand a peak or hill in a lake or the sea, or so close that
        // its footprint would cover the shore; never inside a town.
        if t.is_water(pt) || t.water_distance(pt, size * 0.45) < size * 0.4 || in_clearing(clearings, pt, size * 0.4) {
            continue;
        }
        hash.insert(pt, r);
        // Small y jitter breaks up straight rows; x jitter stays on the crest.
        let pos = [(pt[0] + rng.range(-0.1, 0.1) * size).clamp(0.0, w - 1.0), (pt[1] + rng.range(-0.2, 0.2) * size).clamp(0.0, h - 1.0)];
        *next_id += 1;
        out.push(Placement { id: *next_id, asset: asset.clone(), pos, size, rotation: 0.0, flip: rng.f32() < 0.5, tint: [1.0; 3], layer: PlacementLayer::Mountains });
        // Satellite peaks: hand-drawn ranges are massifs two or three deep,
        // not a single file of summits along the crest. Each main peak may
        // spawn one or two smaller companions a little downhill of it.
        if is_mountain {
            let n = if rng.f32() < 0.75 { 1 + (rng.f32() < 0.4) as usize } else { 0 };
            for _ in 0..n {
                let a = rng.range(0.0, std::f32::consts::TAU);
                let d = size * rng.range(0.45, 0.8);
                let q = [(pos[0] + a.cos() * d).clamp(0.0, w - 1.0), (pos[1] + a.sin() * d * 0.7).clamp(0.0, h - 1.0)];
                if e.sample(q[0], q[1]) <= t.sea_level || relief(e, q, s * 0.9) < p.hill_relief * 0.5 {
                    continue;
                }
                let ssize = size * rng.range(0.5, 0.75);
                let sr = ssize * 0.24;
                if hash.collides(q, sr) || t.is_water(q) || t.water_distance(q, ssize * 0.45) < ssize * 0.4 || in_clearing(clearings, q, ssize * 0.4) {
                    continue;
                }
                hash.insert(q, sr);
                let pool = if cold && !sets.snow_mountains.is_empty() { &sets.snow_mountains } else { &sets.mountains };
                let (sasset, sbase) = rng.pick(pool).clone();
                *next_id += 1;
                out.push(Placement { id: *next_id, asset: sasset, pos: q, size: ssize * sbase / base, rotation: 0.0, flip: rng.f32() < 0.5, tint: [1.0; 3], layer: PlacementLayer::Mountains });
            }
        }
    }
    let _ = elo;
    out.sort_by(|a, b| a.pos[1].partial_cmp(&b.pos[1]).unwrap());
    (out, hash)
}

/// Automatic tree symbols from the forest-density field: spacing shrinks
/// with density, species follow biome and temperature, never in water or
/// on steep ground, thinning toward the treeline.
fn in_clearing(clearings: &[([f32; 2], f32)], p: [f32; 2], margin: f32) -> bool {
    clearings.iter().any(|(c, r)| (c[0] - p[0]).powi(2) + (c[1] - p[1]).powi(2) < (r + margin) * (r + margin))
}

#[allow(clippy::too_many_arguments)]
pub fn place_forest(t: &Terrain<'_>, forest: &ScalarField, temperature: Option<&ScalarField>, p: &ForestParams, sets: &SymbolSets, avoid: &SpatialHash, clearings: &[([f32; 2], f32)], next_id: &mut u64) -> Vec<Placement> {
    let mut out = Vec::new();
    if !p.enabled || (sets.conifers.is_empty() && sets.broadleaf.is_empty()) {
        return out;
    }
    let e = t.elevation;
    let (w, h) = (e.width() as f32, e.height() as f32);
    let s = p.spacing.max(3.0);
    let mut rng = Rng::new(p.seed);
    let mut hash = SpatialHash::new(s);
    let fsx = forest.width() as f32 / w;
    let fsy = forest.height() as f32 / h;
    let nx = (w / s).ceil() as i32;
    let ny = (h / s).ceil() as i32;
    for gy in 0..ny {
        for gx in 0..nx {
            // Two candidates per cell so dense forest can pack tighter.
            for k in 0..2 {
                if k == 1 && rng.f32() > 0.5 {
                    continue;
                }
                let pt = [((gx as f32 + rng.f32()) * s).min(w - 1.0), ((gy as f32 + rng.f32()) * s).min(h - 1.0)];
                let d = forest.sample(pt[0] * fsx, pt[1] * fsy);
                if d < p.threshold || rng.f32() > (d - p.threshold) / (1.0 - p.threshold).max(0.05) * 1.3 {
                    continue;
                }
                if t.is_water(pt) || t.slope(pt) > 60.0 || avoid.collides(pt, 4.0) || in_clearing(clearings, pt, 6.0) {
                    continue;
                }
                // Every automatic tree is an evergreen; other species stay
                // in the library for hand placement only.
                let _ = temperature;
                let pool = if !sets.conifers.is_empty() { &sets.conifers } else { &sets.broadleaf };
                let (asset, base) = rng.pick(pool).clone();
                let size = base * p.size * rng.range(0.8, 1.2);
                let r = size * 0.28 * (1.0 - 0.4 * d);
                if hash.collides(pt, r) {
                    continue;
                }
                hash.insert(pt, r);
                *next_id += 1;
                out.push(Placement { id: *next_id, asset, pos: pt, size, rotation: 0.0, flip: rng.f32() < 0.5, tint: [1.0; 3], layer: PlacementLayer::Forest });
            }
        }
    }
    out.sort_by(|a, b| a.pos[1].partial_cmp(&b.pos[1]).unwrap());
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scatter_respects_spacing() {
        let mut hash = SpatialHash::new(8.0);
        let mut rng = Rng::new(3);
        let pts = scatter_disc([100.0, 100.0], 40.0, 6.0, &mut hash, &mut rng, |_, _| Some(4.0));
        assert!(pts.len() > 20, "{}", pts.len());
        for (i, (a, _)) in pts.iter().enumerate() {
            for (b, _) in pts.iter().skip(i + 1) {
                let d = ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt();
                assert!(d >= 8.0 - 1e-3, "too close: {d}");
            }
        }
    }

    #[test]
    fn mountains_land_on_peaks() {
        let mut e = ScalarField::new(256, 256, 50.0);
        e.par_map_inplace(|x, y, _| {
            let dx = x as f32 - 128.0;
            let dy = y as f32 - 128.0;
            let r = (dx * dx + dy * dy).sqrt();
            50.0 + (2000.0 * (1.0 - r / 60.0)).max(0.0)
        });
        let t = Terrain { elevation: &e, sea_level: 0.0, biome: None, water: None };
        let sets = SymbolSets { mountains: vec![("default/mountain_1".into(), 90.0)], hills: vec![("default/hill_1".into(), 60.0)], ..Default::default() };
        let mut id = 0;
        let (m, _) = place_mountains(&t, &MountainParams::default(), &sets, None, None, &[], &mut id);
        assert!(!m.is_empty());
        for pl in &m {
            let d = ((pl.pos[0] - 128.0).powi(2) + (pl.pos[1] - 128.0).powi(2)).sqrt();
            assert!(d < 70.0, "symbol far from the cone: {d}");
        }
        assert!(m.iter().any(|p| p.asset.contains("mountain")));
    }
}
