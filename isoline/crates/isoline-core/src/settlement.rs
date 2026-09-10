//! Settlement layouts: towns generated as geometry on the terrain they sit
//! on, editable afterwards. Everything here is ornamental (nothing
//! downstream reads it), so the generator favours a convincing look and
//! determinism over urban-planning rigour.
//!
//! Pipeline: snap the centre to buildable ground → primary roads grown
//! outward by the growth model, steered off water and steep slopes (a road
//! that meets a river gets a bridge) → secondary streets between them →
//! lots along every street with buildings sized and typed by district →
//! walls as an offset hull of the built core with towers and gates where
//! primary roads leave → plaza, keep, docks, fields and a cemetery.
//! Building placement is hashed per (district seed, street, lot), so one
//! district can be re-rolled without touching the rest.

use crate::field::ScalarField;
use crate::geometry::{chaikin, lerp, seg_dist2, sub, Polygon, P2};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum GrowthModel {
    Organic,
    Radial,
    Grid,
    Coastal,
    Hybrid,
}

impl GrowthModel {
    pub const ALL: [GrowthModel; 5] = [GrowthModel::Organic, GrowthModel::Radial, GrowthModel::Grid, GrowthModel::Coastal, GrowthModel::Hybrid];
    pub fn label(self) -> &'static str {
        match self {
            GrowthModel::Organic => "Organic",
            GrowthModel::Radial => "Radial rings",
            GrowthModel::Grid => "Grid",
            GrowthModel::Coastal => "Coastal strip",
            GrowthModel::Hybrid => "Hybrid",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum SettlementKind {
    Village,
    Town,
    City,
}

impl SettlementKind {
    pub const ALL: [SettlementKind; 3] = [SettlementKind::Village, SettlementKind::Town, SettlementKind::City];
    pub fn label(self) -> &'static str {
        match self {
            SettlementKind::Village => "Village",
            SettlementKind::Town => "Town",
            SettlementKind::City => "City",
        }
    }
    /// Base radius in project texels.
    pub fn radius(self) -> f32 {
        match self {
            SettlementKind::Village => 34.0,
            SettlementKind::Town => 80.0,
            SettlementKind::City => 150.0,
        }
    }
    pub fn importance(self) -> f32 {
        match self {
            SettlementKind::Village => 0.35,
            SettlementKind::Town => 0.6,
            SettlementKind::City => 0.9,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum District {
    Market,
    Temple,
    Docks,
    Craft,
    Noble,
    Slums,
    Garrison,
    Farmland,
    Residential,
}

impl District {
    pub const ALL: [District; 9] = [
        District::Market,
        District::Temple,
        District::Docks,
        District::Craft,
        District::Noble,
        District::Slums,
        District::Garrison,
        District::Farmland,
        District::Residential,
    ];
    pub fn label(self) -> &'static str {
        match self {
            District::Market => "Market",
            District::Temple => "Temple precinct",
            District::Docks => "Docks",
            District::Craft => "Craft quarter",
            District::Noble => "Noble estates",
            District::Slums => "Slums",
            District::Garrison => "Garrison",
            District::Farmland => "Farmland",
            District::Residential => "Residential",
        }
    }
    fn index(self) -> usize {
        District::ALL.iter().position(|d| *d == self).unwrap()
    }
    /// Building footprint (width, depth) in texels and how irregular lots are.
    fn footprint(self) -> (f32, f32, f32) {
        match self {
            District::Market => (5.0, 5.5, 0.35),
            District::Temple => (9.0, 12.0, 0.15),
            District::Docks => (4.5, 8.0, 0.4),
            District::Craft => (5.5, 6.5, 0.45),
            District::Noble => (10.0, 9.0, 0.2),
            District::Slums => (3.2, 3.2, 0.7),
            District::Garrison => (7.0, 9.0, 0.1),
            District::Farmland => (5.0, 5.0, 0.3),
            District::Residential => (4.5, 5.5, 0.4),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SettlementParams {
    pub seed: u64,
    pub model: GrowthModel,
    pub kind: SettlementKind,
    /// Radius multiplier on the kind's base radius.
    pub size: f32,
    /// 0..1: how tightly lots pack along streets.
    pub density: f32,
    /// 0..1: street wander and lot jitter.
    pub irregularity: f32,
    pub walls: bool,
    /// 1 or 2 wall rings (an older inner ring for staged growth).
    pub rings: u32,
    /// Per-district re-roll seeds (index by District::ALL order).
    #[serde(default)]
    pub district_seeds: [u32; 9],
}

impl Default for SettlementParams {
    fn default() -> Self {
        Self { seed: 1, model: GrowthModel::Organic, kind: SettlementKind::Town, size: 1.0, density: 0.65, irregularity: 0.5, walls: true, rings: 1, district_seeds: [0; 9] }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Road {
    pub points: Vec<P2>,
    pub primary: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Building {
    pub id: u32,
    /// Footprint corners, clockwise.
    pub quad: [P2; 4],
    pub district: District,
}

impl Building {
    pub fn centre(&self) -> P2 {
        let q = &self.quad;
        [(q[0][0] + q[1][0] + q[2][0] + q[3][0]) * 0.25, (q[0][1] + q[1][1] + q[2][1] + q[3][1]) * 0.25]
    }
    pub fn contains(&self, p: P2) -> bool {
        Polygon { points: self.quad.to_vec() }.contains(p)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Wall {
    /// Closed ring.
    pub points: Vec<P2>,
    pub towers: Vec<P2>,
    pub gates: Vec<P2>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct Layout {
    pub center: P2,
    pub radius: f32,
    pub roads: Vec<Road>,
    pub buildings: Vec<Building>,
    pub walls: Vec<Wall>,
    pub plaza: Option<Polygon>,
    pub keep: Option<(P2, f32)>,
    pub docks: Vec<[P2; 2]>,
    pub bridges: Vec<[P2; 2]>,
    pub fields: Vec<[P2; 4]>,
    pub cemetery: Option<[P2; 4]>,
    pub next_building_id: u32,
}

/// What the generator reads from the map.
pub struct Site<'a> {
    pub elevation: &'a ScalarField,
    pub sea_level: f32,
    /// Water coverage 0..1 at project resolution (rivers and lakes).
    pub water: Option<&'a ScalarField>,
    /// River centrelines for bridges and docks.
    pub rivers: &'a [Vec<P2>],
}

impl Site<'_> {
    fn inside(&self, p: P2) -> bool {
        p[0] >= 0.0 && p[1] >= 0.0 && p[0] < self.elevation.width() as f32 && p[1] < self.elevation.height() as f32
    }
    fn height(&self, p: P2) -> f32 {
        if !self.inside(p) {
            return self.sea_level - 1.0;
        }
        self.elevation.sample(p[0], p[1])
    }
    pub fn is_water(&self, p: P2) -> bool {
        if self.height(p) <= self.sea_level {
            return true;
        }
        match self.water {
            Some(w) => w.sample(p[0], p[1]) > 0.5,
            None => false,
        }
    }
    /// Metres of rise per texel.
    fn slope(&self, p: P2) -> f32 {
        let d = 2.0;
        let gx = self.height([p[0] + d, p[1]]) - self.height([p[0] - d, p[1]]);
        let gy = self.height([p[0], p[1] + d]) - self.height([p[0], p[1] - d]);
        (gx * gx + gy * gy).sqrt() / (2.0 * d)
    }
    fn buildable(&self, p: P2, max_slope: f32) -> bool {
        self.inside(p) && !self.is_water(p) && self.slope(p) <= max_slope
    }
    /// Direction (unit) and distance to the nearest water within `max`.
    fn nearest_water(&self, p: P2, max: f32) -> Option<(P2, f32)> {
        let mut d = 3.0;
        while d <= max {
            for k in 0..16 {
                let a = k as f32 / 16.0 * std::f32::consts::TAU;
                let q = [p[0] + a.cos() * d, p[1] + a.sin() * d];
                if self.is_water(q) {
                    return Some(([a.cos(), a.sin()], d));
                }
            }
            d *= 1.3;
        }
        None
    }
}

/// Small deterministic hash-based RNG so every stream is independent.
#[derive(Clone)]
struct H(u64);
impl H {
    fn new(seed: u64, stream: u64) -> Self {
        let mut h = H(seed ^ stream.wrapping_mul(0x9E37_79B9_7F4A_7C15));
        h.next();
        h
    }
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    fn f(&mut self) -> f32 {
        (self.next() >> 40) as f32 / (1u64 << 24) as f32
    }
    fn range(&mut self, lo: f32, hi: f32) -> f32 {
        lo + (hi - lo) * self.f()
    }
}

fn norm(v: P2) -> P2 {
    let l = (v[0] * v[0] + v[1] * v[1]).sqrt().max(1e-6);
    [v[0] / l, v[1] / l]
}
fn perp(v: P2) -> P2 {
    [-v[1], v[0]]
}
fn add(a: P2, b: P2) -> P2 {
    [a[0] + b[0], a[1] + b[1]]
}
fn mul(a: P2, k: f32) -> P2 {
    [a[0] * k, a[1] * k]
}
fn dist(a: P2, b: P2) -> f32 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2)).sqrt()
}

/// Segment intersection point, if the segments cross.
fn seg_cross(a: P2, b: P2, c: P2, d: P2) -> Option<P2> {
    let r = sub(b, a);
    let s = sub(d, c);
    let den = r[0] * s[1] - r[1] * s[0];
    if den.abs() < 1e-9 {
        return None;
    }
    let qp = sub(c, a);
    let t = (qp[0] * s[1] - qp[1] * s[0]) / den;
    let u = (qp[0] * r[1] - qp[1] * r[0]) / den;
    if (0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u) {
        Some(add(a, mul(r, t)))
    } else {
        None
    }
}

/// Convex hull (Andrew's monotone chain), clockwise in y-down space.
pub fn convex_hull(mut pts: Vec<P2>) -> Vec<P2> {
    pts.sort_by(|a, b| a[0].partial_cmp(&b[0]).unwrap().then(a[1].partial_cmp(&b[1]).unwrap()));
    pts.dedup();
    if pts.len() < 3 {
        return pts;
    }
    let cross = |o: P2, a: P2, b: P2| (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    let mut lower: Vec<P2> = Vec::new();
    for p in &pts {
        while lower.len() >= 2 && cross(lower[lower.len() - 2], lower[lower.len() - 1], *p) <= 0.0 {
            lower.pop();
        }
        lower.push(*p);
    }
    let mut upper: Vec<P2> = Vec::new();
    for p in pts.iter().rev() {
        while upper.len() >= 2 && cross(upper[upper.len() - 2], upper[upper.len() - 1], *p) <= 0.0 {
            upper.pop();
        }
        upper.push(*p);
    }
    lower.pop();
    upper.pop();
    lower.extend(upper);
    lower
}

/// Grow a road from `from` along `dir`, wandering by `wander`, steering
/// around water and steep ground; stops when blocked or after `len`.
#[allow(clippy::too_many_arguments)]
fn grow_road(site: &Site<'_>, rng: &mut H, from: P2, dir: P2, len: f32, step: f32, wander: f32, max_slope: f32) -> (Vec<P2>, Option<[P2; 2]>) {
    let mut pts = vec![from];
    let mut heading = dir[1].atan2(dir[0]);
    let mut travelled = 0.0;
    let mut bridge = None;
    while travelled < len {
        let mut placed = false;
        for attempt in 0..5 {
            let turn = if attempt == 0 { rng.range(-wander, wander) } else { rng.range(-0.9, 0.9) * attempt as f32 * 0.5 };
            let h = heading + turn;
            let last = *pts.last().unwrap();
            let next = [last[0] + h.cos() * step, last[1] + h.sin() * step];
            if !site.inside(next) {
                continue;
            }
            // A narrow river may be crossed once: a bridge.
            if site.is_water(next) {
                let beyond = [last[0] + h.cos() * step * 2.5, last[1] + h.sin() * step * 2.5];
                if bridge.is_none() && site.buildable(beyond, max_slope) && site.height(next) > site.sea_level {
                    bridge = Some([last, beyond]);
                    pts.push(beyond);
                    heading = h;
                    travelled += step * 2.5;
                    placed = true;
                    break;
                }
                continue;
            }
            if site.slope(next) > max_slope {
                continue;
            }
            pts.push(next);
            heading = h;
            travelled += step;
            placed = true;
            break;
        }
        if !placed {
            break;
        }
    }
    (pts, bridge)
}

/// The generator.
pub fn generate(site: &Site<'_>, at: P2, p: &SettlementParams) -> Layout {
    let radius = p.kind.radius() * p.size.max(0.2);
    let max_slope = 28.0;
    let mut rng = H::new(p.seed, 1);
    // 1. Snap the centre to the flattest buildable ground nearby.
    let mut center = at;
    let mut best = f32::INFINITY;
    let n = 9;
    for iy in 0..n {
        for ix in 0..n {
            let q = [at[0] + (ix as f32 / (n - 1) as f32 - 0.5) * radius, at[1] + (iy as f32 / (n - 1) as f32 - 0.5) * radius];
            if !site.buildable(q, max_slope * 0.6) {
                continue;
            }
            let score = site.slope(q) + dist(q, at) / radius * 6.0;
            if score < best {
                best = score;
                center = q;
            }
        }
    }
    let mut layout = Layout { center, radius, ..Default::default() };
    if !site.inside(center) {
        return layout;
    }
    // Orientation: along the coast or river if one is close.
    let water = site.nearest_water(center, radius * 1.4);
    let base_dir: P2 = match water {
        Some((to_water, _)) => perp(to_water),
        None => {
            let a = rng.range(0.0, std::f32::consts::TAU);
            [a.cos(), a.sin()]
        }
    };
    let wander = 0.08 + 0.5 * p.irregularity;
    let step = (radius / 7.0).max(4.0);

    // 2. Primary roads.
    let mut roads: Vec<Road> = Vec::new();
    let mut bridges = Vec::new();
    let push_road = |pts: Vec<P2>, primary: bool, roads: &mut Vec<Road>| {
        if pts.len() >= 2 {
            roads.push(Road { points: pts, primary });
        }
    };
    let model = if p.model == GrowthModel::Coastal && water.is_none() { GrowthModel::Organic } else { p.model };
    match model {
        GrowthModel::Organic | GrowthModel::Hybrid | GrowthModel::Radial => {
            let n = match p.kind {
                SettlementKind::Village => 3,
                SettlementKind::Town => 4 + (rng.f() * 2.0) as usize,
                SettlementKind::City => 6 + (rng.f() * 2.0) as usize,
            };
            let base_a = base_dir[1].atan2(base_dir[0]);
            let w = if model == GrowthModel::Radial { wander * 0.3 } else { wander };
            for i in 0..n {
                let a = base_a + i as f32 / n as f32 * std::f32::consts::TAU + rng.range(-0.25, 0.25) * (1.0 + p.irregularity);
                let (pts, br) = grow_road(site, &mut rng, center, [a.cos(), a.sin()], radius * 1.35, step, w, max_slope);
                if let Some(b) = br {
                    bridges.push(b);
                }
                push_road(pts, true, &mut roads);
            }
        }
        GrowthModel::Grid => {
            let d = base_dir;
            let q = perp(d);
            for (axis, other) in [(d, q), (q, d)] {
                for side in [-1.0, 1.0] {
                    let (pts, br) = grow_road(site, &mut rng, center, mul(axis, side), radius * 1.3, step, wander * 0.15, max_slope);
                    if let Some(b) = br {
                        bridges.push(b);
                    }
                    push_road(pts, true, &mut roads);
                }
                let _ = other;
            }
        }
        GrowthModel::Coastal => {
            // Main street parallel to the shore, set back from it.
            let (to_water, dw) = water.unwrap();
            let inland = mul(to_water, -1.0);
            let start = add(center, mul(inland, (radius * 0.3 - dw).max(0.0)));
            for side in [-1.0, 1.0] {
                let (pts, _) = grow_road(site, &mut rng, start, mul(base_dir, side), radius * 1.4, step, wander * 0.2, max_slope);
                push_road(pts, true, &mut roads);
            }
            let (pts, br) = grow_road(site, &mut rng, start, inland, radius * 0.9, step, wander, max_slope);
            if let Some(b) = br {
                bridges.push(b);
            }
            push_road(pts, true, &mut roads);
        }
    }

    // 3. Secondary streets.
    let primary: Vec<Road> = roads.clone();
    let ring = |r: f32, rng: &mut H, jitter: f32| -> Vec<P2> {
        let n = ((r * 2.0) as usize).clamp(12, 64);
        let mut pts = Vec::new();
        for i in 0..n {
            let a = i as f32 / n as f32 * std::f32::consts::TAU;
            let rr = r * (1.0 + rng.range(-jitter, jitter));
            pts.push([center[0] + a.cos() * rr, center[1] + a.sin() * rr]);
        }
        pts
    };
    // Clip a polyline to buildable ground, splitting it where it leaves.
    let clip = |pts: Vec<P2>, roads: &mut Vec<Road>| {
        let mut cur: Vec<P2> = Vec::new();
        for q in pts {
            if site.buildable(q, max_slope) {
                cur.push(q);
            } else {
                if cur.len() >= 2 {
                    roads.push(Road { points: std::mem::take(&mut cur), primary: false });
                }
                cur.clear();
            }
        }
        if cur.len() >= 2 {
            roads.push(Road { points: cur, primary: false });
        }
    };
    match model {
        GrowthModel::Radial => {
            let rings: &[f32] = match p.kind {
                SettlementKind::Village => &[0.6],
                SettlementKind::Town => &[0.45, 0.85],
                SettlementKind::City => &[0.3, 0.6, 0.9],
            };
            for r in rings {
                let mut pts = ring(radius * r, &mut rng, 0.04 * p.irregularity);
                pts.push(pts[0]);
                clip(pts, &mut roads);
            }
        }
        GrowthModel::Grid => {
            let d = base_dir;
            let q = perp(d);
            let spacing = (radius / 4.0).max(9.0);
            let k = (radius / spacing) as i32;
            for (axis, other) in [(d, q), (q, d)] {
                for i in -k..=k {
                    if i == 0 {
                        continue;
                    }
                    let off = i as f32 * spacing * (1.0 + rng.range(-0.1, 0.1) * p.irregularity);
                    let o = add(center, mul(other, off));
                    let half = (radius * radius - off * off).max(0.0).sqrt();
                    let pts: Vec<P2> = (0..=12).map(|t| add(o, mul(axis, -half + half * 2.0 * t as f32 / 12.0))).collect();
                    clip(pts, &mut roads);
                }
            }
        }
        GrowthModel::Organic | GrowthModel::Hybrid | GrowthModel::Coastal => {
            // Wandering connectors between neighbouring primary roads, and
            // one partial ring for the hybrid.
            let n = primary.len();
            let connectors = match p.kind {
                SettlementKind::Village => 2,
                SettlementKind::Town => 5,
                SettlementKind::City => 10,
            };
            for c in 0..connectors {
                if n < 2 {
                    break;
                }
                let i = (rng.f() * n as f32) as usize % n;
                let j = (i + 1) % n;
                let t = rng.range(0.25, 0.9);
                let a = &primary[i].points;
                let b = &primary[j].points;
                let pa = a[((a.len() - 1) as f32 * t) as usize];
                let pb = b[((b.len() - 1) as f32 * t.min(0.95)) as usize];
                let segs = 6;
                let mut pts = Vec::new();
                let mut rr = H::new(p.seed, 100 + c as u64);
                for s in 0..=segs {
                    let u = s as f32 / segs as f32;
                    let mut q = lerp(pa, pb, u);
                    if s > 0 && s < segs {
                        let side = perp(norm(sub(pb, pa)));
                        q = add(q, mul(side, rr.range(-1.0, 1.0) * radius * 0.08 * p.irregularity));
                    }
                    pts.push(q);
                }
                clip(pts, &mut roads);
            }
            if model == GrowthModel::Hybrid {
                let mut pts = ring(radius * 0.55, &mut rng, 0.05);
                pts.truncate(pts.len() * 2 / 3);
                clip(pts, &mut roads);
            }
            if model == GrowthModel::Coastal {
                // Streets running inland from the main street.
                let (to_water, _) = water.unwrap();
                let inland = mul(to_water, -1.0);
                let main = &primary[0].points;
                let main2 = primary.get(1).map(|r| r.points.clone()).unwrap_or_default();
                let all: Vec<P2> = main.iter().rev().copied().chain(main2.iter().copied()).collect();
                let every = 3;
                for (k, q) in all.iter().enumerate() {
                    if k % every != 1 {
                        continue;
                    }
                    let pts: Vec<P2> = (0..=5).map(|t| add(*q, mul(inland, radius * 0.7 * t as f32 / 5.0))).collect();
                    clip(pts, &mut roads);
                    let toward: Vec<P2> = (0..=3).map(|t| add(*q, mul(to_water, radius * 0.25 * t as f32 / 3.0))).collect();
                    clip(toward, &mut roads);
                }
            }
        }
    }
    layout.roads = roads;
    layout.bridges = bridges;

    // 4/5. Lots and buildings along every street.
    let keep_at = highest_point(site, center, radius * 0.7, max_slope);
    let plaza_r = radius * 0.13;
    let dock_reach = 14.0f32.max(radius * 0.12);
    let mut hash: Vec<(P2, f32)> = Vec::new();
    let collides = |hash: &[(P2, f32)], c: P2, r: f32| hash.iter().any(|(q, qr)| dist(*q, c) < r + qr);
    let mut buildings = Vec::new();
    let mut next_id = 1u32;
    let road_snapshot = layout.roads.clone();
    for (ri, road) in road_snapshot.iter().enumerate() {
        let half_w = if road.primary { 2.6 } else { 1.7 };
        let mut along = 0.0;
        let spacing_base = 3.0 + 6.0 * (1.0 - p.density);
        for w in road.points.windows(2) {
            let seg_len = dist(w[0], w[1]);
            let dir = norm(sub(w[1], w[0]));
            let side_v = perp(dir);
            let mut t = 0.0;
            while t < seg_len {
                let at_pt = add(w[0], mul(dir, t));
                let lot_i = ((along + t) / spacing_base) as u64;
                for (si, side) in [-1.0f32, 1.0].iter().enumerate() {
                    let d0 = dist(at_pt, center);
                    let district = classify(site, at_pt, center, radius, plaza_r, keep_at, dock_reach, d0);
                    let (bw, bd, irr) = district.footprint();
                    let mut h = H::new(p.seed ^ (p.district_seeds[district.index()] as u64) << 20, (ri as u64) << 24 | lot_i << 2 | si as u64);
                    // Density gate and district-specific sparseness.
                    let keep_prob = match district {
                        District::Farmland => 0.08,
                        District::Noble => 0.45,
                        District::Temple => 0.5,
                        District::Slums => 0.7,
                        _ => 0.55 + 0.45 * p.density,
                    };
                    if h.f() > keep_prob {
                        continue;
                    }
                    let scale_k = match p.kind {
                        SettlementKind::Village => 0.85,
                        SettlementKind::Town => 1.0,
                        SettlementKind::City => 1.1,
                    };
                    let jitter = irr * p.irregularity;
                    let bw = bw * scale_k * (1.0 + h.range(-jitter, jitter));
                    let bd = bd * scale_k * (1.0 + h.range(-jitter, jitter));
                    let rows = if district == District::Farmland || district == District::Temple { 1 } else { 1 + (h.f() < p.density * 0.6) as usize };
                    for row in 0..rows {
                        let off = half_w + bd * 0.5 + row as f32 * (bd + 1.5) + h.range(0.0, 1.0) * jitter;
                        let c = add(at_pt, mul(side_v, *side * off));
                        let c = add(c, mul(dir, h.range(-0.3, 0.3) * jitter * bw));
                        if !site.buildable(c, max_slope) {
                            break;
                        }
                        // The whole footprint must be dry, not just its centre.
                        let dry = |q: P2| !site.is_water(q);
                        let (fw, fdp) = if district == District::Farmland { (bw * 1.5, bd * 1.1) } else { (bw * 0.5, bd * 0.5) };
                        if !(dry(add(c, mul(dir, fw))) && dry(sub(c, mul(dir, fw))) && dry(add(c, mul(side_v, fdp))) && dry(sub(c, mul(side_v, fdp)))) {
                            break;
                        }
                        if dist(c, center) < plaza_r || dist(c, center) > radius * 1.6 {
                            break;
                        }
                        if district != District::Farmland && dist(c, center) > radius * 1.08 {
                            break;
                        }
                        let (qw, qd) = if district == District::Farmland { (bw * 3.0, bd * 2.2) } else { (bw, bd) };
                        let r = (qw.max(qd)) * 0.5;
                        if collides(&hash, c, r * 0.95) {
                            break;
                        }
                        let ang = h.range(-0.12, 0.12) * jitter;
                        let (s, cs) = ang.sin_cos();
                        let dx = [dir[0] * cs - dir[1] * s, dir[0] * s + dir[1] * cs];
                        let dy = perp(dx);
                        let hw = mul(dx, qw * 0.5);
                        let hd = mul(dy, qd * 0.5);
                        let quad = [add(add(c, hw), hd), add(sub(c, hw), hd), sub(sub(c, hw), hd), sub(add(c, hw), hd)];
                        hash.push((c, r));
                        if district == District::Farmland {
                            layout.fields.push(quad);
                        } else {
                            buildings.push(Building { id: next_id, quad, district });
                            next_id += 1;
                        }
                    }
                }
                t += spacing_base * (1.0 + h_spacing(p.seed, ri as u64, lot_i) * p.irregularity * 0.5);
            }
            along += seg_len;
        }
    }

    // 6. Walls: offset hull of the core, towers, gates.
    if p.walls && p.kind != SettlementKind::Village {
        let rings: Vec<f32> = if p.rings >= 2 { vec![1.0, 0.55] } else { vec![1.0] };
        for (k, rf) in rings.iter().enumerate() {
            let core: Vec<P2> = buildings.iter().map(|b| b.centre()).filter(|c| dist(*c, center) <= radius * rf * 0.98).collect();
            if core.len() < 6 {
                continue;
            }
            let hull = convex_hull(core);
            let offset = 5.0 + 2.0 * (1.0 - k as f32);
            let hc = hull.iter().fold([0.0, 0.0], |a, q| [a[0] + q[0] / hull.len() as f32, a[1] + q[1] / hull.len() as f32]);
            let pushed: Vec<P2> = hull.iter().map(|q| add(*q, mul(norm(sub(*q, hc)), offset))).collect();
            let mut ring_pts = chaikin(&pushed, true);
            // Land only: a wall that would stand in water stops at the shore.
            let mut wr = H::new(p.seed, 700 + k as u64);
            for q in ring_pts.iter_mut() {
                *q = add(*q, mul([wr.range(-1.0, 1.0), wr.range(-1.0, 1.0)], 0.8 * p.irregularity));
            }
            ring_pts.retain(|q| !site.is_water(*q));
            if ring_pts.len() < 4 {
                continue;
            }
            let mut towers = Vec::new();
            let mut acc = 0.0;
            let tower_every = (radius * 0.28).max(12.0);
            for i in 0..ring_pts.len() {
                let a = ring_pts[i];
                let b = ring_pts[(i + 1) % ring_pts.len()];
                acc += dist(a, b);
                if acc >= tower_every {
                    towers.push(a);
                    acc = 0.0;
                }
            }
            let mut gates = Vec::new();
            for road in layout.roads.iter().filter(|r| r.primary) {
                'seg: for rs in road.points.windows(2) {
                    for i in 0..ring_pts.len() {
                        let a = ring_pts[i];
                        let b = ring_pts[(i + 1) % ring_pts.len()];
                        if let Some(x) = seg_cross(rs[0], rs[1], a, b) {
                            gates.push(x);
                            break 'seg;
                        }
                    }
                }
            }
            layout.walls.push(Wall { points: ring_pts, towers, gates });
        }
        // Slums lie outside the outer wall; a garrison guards the first gate.
        if let Some(outer) = layout.walls.first() {
            let poly = Polygon { points: outer.points.clone() };
            let gate = outer.gates.first().copied();
            for b in buildings.iter_mut() {
                let c = b.centre();
                if !poly.contains(c) && !matches!(b.district, District::Docks) {
                    b.district = District::Slums;
                } else if let Some(g) = gate {
                    if dist(c, g) < radius * 0.14 && b.district == District::Residential {
                        b.district = District::Garrison;
                    }
                }
            }
        }
    }

    // 7. Plaza, keep, docks, cemetery.
    let mut pr = H::new(p.seed, 900);
    let plaza: Vec<P2> = (0..8).map(|i| {
        let a = i as f32 / 8.0 * std::f32::consts::TAU;
        let r = plaza_r * (1.0 + pr.range(-0.15, 0.15) * p.irregularity);
        [center[0] + a.cos() * r, center[1] + a.sin() * r]
    }).collect();
    layout.plaza = Some(Polygon { points: plaza });
    if p.kind != SettlementKind::Village {
        if let Some(k) = keep_at {
            layout.keep = Some((k, (radius * 0.07).max(5.0)));
            buildings.retain(|b| dist(b.centre(), k) > radius * 0.09);
        }
    }
    if let Some((to_water, dw)) = water {
        if dw < radius * 1.2 {
            let n = match p.kind {
                SettlementKind::Village => 1,
                SettlementKind::Town => 3,
                SettlementKind::City => 5,
            };
            let along = perp(to_water);
            let mut dr = H::new(p.seed, 901);
            for i in 0..n {
                let off = (i as f32 - (n as f32 - 1.0) / 2.0) * radius * 0.22 + dr.range(-3.0, 3.0);
                let start = add(center, mul(along, off));
                // Walk toward the water until the shore.
                let mut q = start;
                let mut found = None;
                for s in 0..60 {
                    let qq = add(start, mul(to_water, s as f32 * 2.0));
                    if site.is_water(qq) {
                        found = Some(q);
                        break;
                    }
                    q = qq;
                }
                if let Some(shore) = found {
                    // Only a real water body takes a pier, not a brook.
                    let wide = site.is_water(add(shore, mul(to_water, 5.0))) && site.is_water(add(shore, mul(to_water, 10.0)));
                    if wide {
                        let end = add(shore, mul(to_water, (radius * 0.09).max(6.0)));
                        layout.docks.push([shore, end]);
                    }
                }
            }
        }
    }
    // Cemetery on the edge away from water.
    let away = match water {
        Some((tw, _)) => mul(tw, -1.0),
        None => base_dir,
    };
    let cc = add(center, mul(away, radius * 0.95));
    if site.buildable(cc, max_slope) {
        let w = (radius * 0.16).max(6.0);
        let h = (radius * 0.11).max(4.0);
        let dx = perp(away);
        layout.cemetery = Some([add(add(cc, mul(dx, w)), mul(away, h)), add(sub(cc, mul(dx, w)), mul(away, h)), sub(sub(cc, mul(dx, w)), mul(away, h)), sub(add(cc, mul(dx, w)), mul(away, h))]);
        buildings.retain(|b| dist(b.centre(), cc) > w.max(h) + 2.0);
    }
    layout.buildings = buildings;
    layout.next_building_id = next_id;
    layout
}

/// Re-roll one district: regenerate with a fresh seed for it and take only
/// that district's new buildings, keeping every other building, road and
/// wall exactly as it was (new ones that would overlap kept ones are dropped).
pub fn reroll_district(site: &Site<'_>, s: &mut Settlement, district: District) {
    s.params.district_seeds[district.index()] = s.params.district_seeds[district.index()].wrapping_add(1);
    let fresh = generate(site, s.pos, &s.params);
    let kept: Vec<Building> = s.layout.buildings.iter().filter(|b| b.district != district).cloned().collect();
    let mut out = kept.clone();
    let mut next = s.layout.next_building_id;
    'cand: for b in fresh.buildings.into_iter().filter(|b| b.district == district) {
        let c = b.centre();
        let r = dist(b.quad[0], b.quad[2]) * 0.5;
        for k in &kept {
            let kc = k.centre();
            let kr = dist(k.quad[0], k.quad[2]) * 0.5;
            if dist(c, kc) < (r + kr) * 0.85 {
                continue 'cand;
            }
        }
        out.push(Building { id: next, ..b });
        next += 1;
    }
    s.layout.buildings = out;
    s.layout.next_building_id = next;
}

fn h_spacing(seed: u64, road: u64, lot: u64) -> f32 {
    let mut h = H::new(seed, 5000 + road * 1000 + lot);
    h.range(-1.0, 1.0)
}

/// The highest buildable point within `r` of the centre.
fn highest_point(site: &Site<'_>, center: P2, r: f32, max_slope: f32) -> Option<P2> {
    let mut best: Option<(f32, P2)> = None;
    let n = 13;
    for iy in 0..n {
        for ix in 0..n {
            let q = [center[0] + (ix as f32 / (n - 1) as f32 - 0.5) * 2.0 * r, center[1] + (iy as f32 / (n - 1) as f32 - 0.5) * 2.0 * r];
            if dist(q, center) > r || !site.buildable(q, max_slope * 1.3) {
                continue;
            }
            let h = site.height(q);
            if best.map(|b| h > b.0).unwrap_or(true) {
                best = Some((h, q));
            }
        }
    }
    best.map(|b| b.1)
}

#[allow(clippy::too_many_arguments)]
fn classify(site: &Site<'_>, at: P2, center: P2, radius: f32, plaza_r: f32, keep: Option<P2>, dock_reach: f32, d0: f32) -> District {
    if d0 > radius * 1.08 {
        return District::Farmland;
    }
    if let Some((_, dw)) = site.nearest_water(at, dock_reach) {
        if dw <= dock_reach {
            return District::Docks;
        }
    }
    if d0 < plaza_r * 2.2 {
        return District::Market;
    }
    if let Some(k) = keep {
        if dist(at, k) < radius * 0.2 {
            return District::Temple;
        }
    }
    // Uphill side: nobles. Downhill mid-ring: crafts.
    let up = site.height(at) - site.height(center);
    if up > 6.0 && d0 < radius * 0.6 {
        return District::Noble;
    }
    if d0 > radius * 0.45 && d0 < radius * 0.85 && up < 0.0 {
        return District::Craft;
    }
    District::Residential
}

/// Hit-test helpers for the editor.
impl Layout {
    pub fn building_at(&self, p: P2) -> Option<u32> {
        self.buildings.iter().find(|b| b.contains(p)).map(|b| b.id)
    }
    /// Nearest road or wall vertex within `tol` texels: (road index or wall index, vertex).
    pub fn vertex_near(&self, p: P2, tol: f32) -> Option<VertexRef> {
        let mut best = tol * tol;
        let mut hit = None;
        for (ri, r) in self.roads.iter().enumerate() {
            for (vi, q) in r.points.iter().enumerate() {
                let d2 = (q[0] - p[0]).powi(2) + (q[1] - p[1]).powi(2);
                if d2 < best {
                    best = d2;
                    hit = Some(VertexRef::Road(ri, vi));
                }
            }
        }
        for (wi, w) in self.walls.iter().enumerate() {
            for (vi, q) in w.points.iter().enumerate() {
                let d2 = (q[0] - p[0]).powi(2) + (q[1] - p[1]).powi(2);
                if d2 < best {
                    best = d2;
                    hit = Some(VertexRef::Wall(wi, vi));
                }
            }
        }
        hit
    }
    pub fn move_vertex(&mut self, v: VertexRef, to: P2) {
        match v {
            VertexRef::Road(ri, vi) => {
                if let Some(q) = self.roads.get_mut(ri).and_then(|r| r.points.get_mut(vi)) {
                    *q = to;
                }
            }
            VertexRef::Wall(wi, vi) => {
                if let Some(q) = self.walls.get_mut(wi).and_then(|w| w.points.get_mut(vi)) {
                    *q = to;
                }
            }
        }
    }
    /// Distance from a point to the nearest road, for hit-testing.
    pub fn road_dist(&self, p: P2) -> f32 {
        let mut best = f32::INFINITY;
        for r in &self.roads {
            for w in r.points.windows(2) {
                best = best.min(seg_dist2(p, w[0], w[1]).0);
            }
        }
        best.sqrt()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VertexRef {
    Road(usize, usize),
    Wall(usize, usize),
}

/// A placed settlement: where, how it was generated, and its (editable) layout.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Settlement {
    pub id: u64,
    pub pos: P2,
    pub params: SettlementParams,
    pub layout: Layout,
    /// The entity carrying its name.
    #[serde(default)]
    pub entity: Option<u64>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn site_field() -> ScalarField {
        // Gentle slope up to the north-east, a river down the middle.
        let (w, h) = (256u32, 256u32);
        let mut d = vec![0f32; (w * h) as usize];
        for y in 0..h {
            for x in 0..w {
                let mut v = 50.0 + x as f32 * 0.15 - y as f32 * 0.1;
                if (x as i32 - 128).abs() < 3 {
                    v = -5.0;
                }
                d[(y * w + x) as usize] = v;
            }
        }
        ScalarField::from_vec(w, h, d)
    }

    #[test]
    fn town_has_roads_buildings_walls_and_a_bridge() {
        let e = site_field();
        let site = Site { elevation: &e, sea_level: 0.0, water: None, rivers: &[] };
        let p = SettlementParams { seed: 7, kind: SettlementKind::Town, ..Default::default() };
        let l = generate(&site, [110.0, 128.0], &p);
        assert!(l.roads.iter().filter(|r| r.primary).count() >= 3);
        assert!(l.buildings.len() > 40, "{} buildings", l.buildings.len());
        assert!(!l.walls.is_empty());
        assert!(l.walls[0].towers.len() >= 3);
        assert!(!l.walls[0].gates.is_empty());
        assert!(l.plaza.is_some());
        // Nothing stands in the river.
        for b in &l.buildings {
            assert!(!site.is_water(b.centre()), "building in water at {:?}", b.centre());
        }
        // Deterministic.
        let l2 = generate(&site, [110.0, 128.0], &p);
        assert_eq!(l, l2);
    }

    #[test]
    fn district_reroll_leaves_other_districts_alone() {
        let e = site_field();
        let site = Site { elevation: &e, sea_level: 0.0, water: None, rivers: &[] };
        let p = SettlementParams { seed: 3, kind: SettlementKind::City, walls: false, ..Default::default() };
        let a = generate(&site, [70.0, 128.0], &p);
        let mut st = Settlement { id: 1, pos: [70.0, 128.0], params: p.clone(), layout: a.clone(), entity: None };
        reroll_district(&site, &mut st, District::Residential);
        let b = &st.layout;
        let non_res = |l: &Layout| l.buildings.iter().filter(|b| b.district != District::Residential).cloned().collect::<Vec<_>>();
        assert_eq!(non_res(&a), non_res(b));
        assert_eq!(a.roads, b.roads);
        assert_ne!(a.buildings, b.buildings);
        assert!(b.buildings.iter().filter(|x| x.district == District::Residential).count() > 10);
    }

    #[test]
    fn every_model_generates() {
        let e = site_field();
        let site = Site { elevation: &e, sea_level: 0.0, water: None, rivers: &[] };
        for m in GrowthModel::ALL {
            let p = SettlementParams { seed: 11, model: m, kind: SettlementKind::City, ..Default::default() };
            let l = generate(&site, [120.0, 120.0], &p);
            assert!(l.buildings.len() > 30, "{m:?}: {} buildings", l.buildings.len());
        }
    }

    #[test]
    fn hull_is_convex_and_clockwise_consistent() {
        let pts = vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0], [0.0, 10.0], [5.0, 5.0], [2.0, 8.0]];
        let h = convex_hull(pts);
        assert_eq!(h.len(), 4);
    }
}
