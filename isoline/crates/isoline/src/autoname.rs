//! "Name everything": turn the map's features into named entities.

use isoline_core::derived::Derived;
use isoline_core::entity::{Entity, EntityKind, EntityRef};
use isoline_core::field::ScalarField;
use isoline_core::geometry::{self, P2};
use isoline_core::names::{Culture, NameRng};
use isoline_core::placement::{Placement, PlacementLayer};

pub struct AutoNameInput<'a> {
    pub elevation: &'a ScalarField,
    pub sea_level: f32,
    pub derived: &'a Derived,
    pub placements: &'a [Placement],
    pub auto_symbols: &'a [Placement],
    /// (placement id, asset tags) for settlement-ish placements.
    pub settlement_tags: Vec<(u64, Vec<String>)>,
    pub existing: &'a [Entity],
}

pub struct AutoNameParams {
    pub max_rivers: usize,
    pub max_lakes: usize,
    pub max_ranges: usize,
    pub max_forests: usize,
    pub seed: u64,
}

impl Default for AutoNameParams {
    fn default() -> Self {
        Self { max_rivers: 10, max_lakes: 8, max_ranges: 6, max_forests: 6, seed: 7 }
    }
}

/// Cluster points by proximity (union-find). Returns clusters of indices.
fn clusters(points: &[P2], link: f32) -> Vec<Vec<usize>> {
    let n = points.len();
    let mut parent: Vec<usize> = (0..n).collect();
    fn find(p: &mut [usize], i: usize) -> usize {
        let mut r = i;
        while p[r] != r {
            r = p[r];
        }
        let mut c = i;
        while p[c] != r {
            let nx = p[c];
            p[c] = r;
            c = nx;
        }
        r
    }
    // Grid bucketing to keep it near-linear.
    let cell = link.max(1.0);
    let mut grid: std::collections::HashMap<(i32, i32), Vec<usize>> = std::collections::HashMap::new();
    for (i, p) in points.iter().enumerate() {
        grid.entry(((p[0] / cell).floor() as i32, (p[1] / cell).floor() as i32)).or_default().push(i);
    }
    let l2 = link * link;
    for (i, p) in points.iter().enumerate() {
        let (cx, cy) = ((p[0] / cell).floor() as i32, (p[1] / cell).floor() as i32);
        for y in cy - 1..=cy + 1 {
            for x in cx - 1..=cx + 1 {
                if let Some(v) = grid.get(&(x, y)) {
                    for &j in v {
                        if j > i {
                            let q = points[j];
                            if (q[0] - p[0]).powi(2) + (q[1] - p[1]).powi(2) <= l2 {
                                let a = find(&mut parent, i);
                                let b = find(&mut parent, j);
                                if a != b {
                                    parent[a] = b;
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    let mut map: std::collections::HashMap<usize, Vec<usize>> = std::collections::HashMap::new();
    for i in 0..n {
        let r = find(&mut parent, i);
        map.entry(r).or_default().push(i);
    }
    map.into_values().collect()
}

/// Principal axis of a point set → a path through the cluster.
fn principal_path(points: &[P2]) -> (P2, Vec<P2>, f32) {
    let n = points.len().max(1) as f32;
    let mut c = [0.0f32, 0.0];
    for p in points {
        c[0] += p[0] / n;
        c[1] += p[1] / n;
    }
    let (mut sxx, mut sxy, mut syy) = (0.0f32, 0.0f32, 0.0f32);
    for p in points {
        let dx = p[0] - c[0];
        let dy = p[1] - c[1];
        sxx += dx * dx;
        sxy += dx * dy;
        syy += dy * dy;
    }
    let angle = 0.5 * (2.0 * sxy).atan2(sxx - syy);
    let dir = [angle.cos(), angle.sin()];
    let mut lo = f32::INFINITY;
    let mut hi = f32::NEG_INFINITY;
    for p in points {
        let t = (p[0] - c[0]) * dir[0] + (p[1] - c[1]) * dir[1];
        lo = lo.min(t);
        hi = hi.max(t);
    }
    let (lo, hi) = (lo * 0.85, hi * 0.85);
    let steps = 12;
    let path: Vec<P2> = (0..=steps)
        .map(|i| {
            let t = lo + (hi - lo) * i as f32 / steps as f32;
            // Slight bow so the label reads as a range rather than a rule.
            let bow = -0.08 * (hi - lo) * (1.0 - (2.0 * i as f32 / steps as f32 - 1.0).powi(2));
            [c[0] + dir[0] * t - dir[1] * bow, c[1] + dir[1] * t + dir[0] * bow]
        })
        .collect();
    let extent = (hi - lo).max(1.0);
    (c, path, extent)
}

pub fn name_everything(input: &AutoNameInput<'_>, culture: &Culture, p: &AutoNameParams, next_id: &mut u64) -> Vec<Entity> {
    let mut rng = NameRng::new(p.seed ^ *next_id);
    let mut out = Vec::new();
    // Roots already used on this map (first five letters), so lakes do not
    // all become "Lake Gravnsdal", "Lake Gravnsdalga"…
    let mut used: std::collections::HashSet<String> = input.existing.iter().map(|e| e.name.to_lowercase().chars().take(5).collect()).collect();
    let mut mk = |kind: EntityKind, geometry: EntityRef, importance: f32, next_id: &mut u64| -> Entity {
        *next_id += 1;
        let mut name = String::new();
        for _ in 0..8 {
            let root = culture.root(&mut rng);
            let key: String = root.to_lowercase().chars().take(5).collect();
            if used.insert(key) {
                name = culture.apply_template(kind.name_key(), &root, &mut rng);
                break;
            }
        }
        if name.is_empty() {
            name = culture.name_for(kind.name_key(), &mut rng);
        }
        let mut e = Entity::new(*next_id, kind, name, geometry);
        e.importance = importance;
        e.culture = culture.id.clone();
        e.auto = true;
        e
    };
    let has_kind = |kind: EntityKind, near: P2, dist: f32| -> bool {
        input.existing.iter().any(|e| e.kind == kind && geometry::len(geometry::sub(e.geometry.anchor(), near)) < dist)
    };
    let d = input.derived;
    let (w, h) = (input.elevation.width() as f32, input.elevation.height() as f32);
    let short = w.min(h);

    // Settlements from placed symbols.
    for (id, tags) in &input.settlement_tags {
        let Some(pl) = input.placements.iter().find(|p| p.id == *id) else { continue };
        if input.existing.iter().any(|e| matches!(e.geometry, EntityRef::Placement { id: pid, .. } if pid == *id)) {
            continue;
        }
        let imp = if tags.iter().any(|t| t == "city") {
            1.0
        } else if tags.iter().any(|t| t == "town" || t == "castle") {
            0.7
        } else if tags.iter().any(|t| t == "village") {
            0.45
        } else {
            0.35
        };
        let kind = if tags.iter().any(|t| t == "settlement" || t == "castle") { EntityKind::Settlement } else { EntityKind::Marker };
        out.push(mk(kind, EntityRef::Placement { id: *id, pos: pl.pos }, imp, next_id));
    }

    // Lakes by area.
    let mut lakes: Vec<_> = d.water.lakes.iter().map(|l| (l.polygon.area(), l)).collect();
    lakes.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
    for (area, l) in lakes.into_iter().take(p.max_lakes) {
        let c = EntityRef::Polygon(l.polygon.clone()).anchor();
        if has_kind(EntityKind::Lake, c, 20.0) {
            continue;
        }
        let imp = (0.35 + 0.5 * (area / (short * short * 0.01)).sqrt()).clamp(0.3, 0.9);
        out.push(mk(EntityKind::Lake, EntityRef::Polygon(l.polygon.clone()), imp, next_id));
    }

    // Rivers by length (trunks only).
    let mut rivers: Vec<_> = d
        .water
        .rivers
        .iter()
        .map(|r| {
            let len: f32 = r.points.windows(2).map(|w| geometry::len(geometry::sub(w[1], w[0]))).sum();
            (len, r)
        })
        .collect();
    rivers.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap());
    let mut taken = 0;
    for (len, r) in rivers {
        if taken >= p.max_rivers || len < short * 0.08 {
            break;
        }
        let mid = r.points[r.points.len() / 2];
        if has_kind(EntityKind::River, mid, 40.0) {
            continue;
        }
        let imp = (0.3 + 0.5 * (len / (short * 0.6))).clamp(0.3, 0.85);
        out.push(mk(EntityKind::River, EntityRef::Path(r.points.clone()), imp, next_id));
        taken += 1;
    }

    // Ranges from mountain symbols.
    let peaks: Vec<P2> = input.auto_symbols.iter().filter(|s| s.layer == PlacementLayer::Mountains && s.asset.contains("mountain")).map(|s| s.pos).collect();
    let mut ranges: Vec<Vec<usize>> = clusters(&peaks, short * 0.035).into_iter().filter(|c| c.len() >= 4).collect();
    ranges.sort_by_key(|c| std::cmp::Reverse(c.len()));
    for c in ranges.into_iter().take(p.max_ranges) {
        let pts: Vec<P2> = c.iter().map(|&i| peaks[i]).collect();
        let (centre, mut path, extent) = principal_path(&pts);
        if has_kind(EntityKind::Range, centre, short * 0.05) {
            continue;
        }
        // Lift the label above the peak symbols.
        let lift = input.auto_symbols.iter().filter(|s| s.layer == PlacementLayer::Mountains).map(|s| s.size).fold(0.0f32, f32::max) * 0.75;
        for pt in path.iter_mut() {
            pt[1] -= lift;
        }
        let imp = (0.5 + 0.4 * (extent / (short * 0.5))).clamp(0.5, 0.95);
        out.push(mk(EntityKind::Range, EntityRef::Path(path), imp, next_id));
    }

    // Forests from tree symbols (or the density field when no symbols).
    let trees: Vec<P2> = input.auto_symbols.iter().filter(|s| s.layer == PlacementLayer::Forest).map(|s| s.pos).collect();
    let mut woods: Vec<Vec<usize>> = clusters(&trees, short * 0.03).into_iter().filter(|c| c.len() >= 12).collect();
    woods.sort_by_key(|c| std::cmp::Reverse(c.len()));
    for c in woods.into_iter().take(p.max_forests) {
        let pts: Vec<P2> = c.iter().map(|&i| trees[i]).collect();
        let (centre, _, extent) = principal_path(&pts);
        if has_kind(EntityKind::Forest, centre, short * 0.05) {
            continue;
        }
        let imp = (0.4 + 0.4 * (c.len() as f32 / 300.0)).clamp(0.4, 0.8);
        out.push(mk(EntityKind::Forest, EntityRef::Area { center: centre, radius: extent * 0.4 }, imp, next_id));
    }

    // The sea: the sea texel farthest from land on a coarse grid.
    if !input.existing.iter().any(|e| e.kind == EntityKind::Sea) {
        let e = input.elevation;
        let step = (short / 48.0).max(4.0);
        let mut best = None;
        let mut best_d = 0.0f32;
        let mut y = step * 0.5;
        while y < h {
            let mut x = step * 0.5;
            while x < w {
                if e.sample(x, y) <= input.sea_level {
                    // Distance to land by probing rings.
                    let mut dmin = short;
                    for k in 0..12 {
                        let a = k as f32 * std::f32::consts::TAU / 12.0;
                        let mut dist = step;
                        while dist < dmin {
                            let qx = x + a.cos() * dist;
                            let qy = y + a.sin() * dist;
                            if qx < 0.0 || qy < 0.0 || qx >= w || qy >= h || e.sample(qx, qy) > input.sea_level {
                                dmin = dmin.min(dist);
                                break;
                            }
                            dist += step;
                        }
                    }
                    // Prefer open water that is also away from the sheet edge.
                    let border = x.min(w - x).min(y).min(h - y);
                    let score = dmin.min(border * 0.8);
                    if score > best_d {
                        best_d = score;
                        best = Some([x, y]);
                    }
                }
                x += step;
            }
            y += step;
        }
        if let Some(c) = best {
            if best_d > short * 0.06 {
                out.push(mk(EntityKind::Sea, EntityRef::Area { center: c, radius: best_d }, 0.9, next_id));
            }
        }
    }
    out
}
