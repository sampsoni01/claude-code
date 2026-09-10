//! Borders and regions.
//!
//! A terrain **cost field** (at a capped working resolution) makes rivers,
//! coasts and ridgelines cheap and mountains, lakes and open sea expensive.
//! The border brush routes between its control points by least-cost A*,
//! blended toward straight segments by a *naturalness* value. Territories
//! grow from capital seeds by travel cost over the same field (multi-source
//! Dijkstra), enclaves are folded into their neighbours, and the label grid
//! is turned into shared **border arcs** between junctions. Region polygons
//! are assembled from those arcs, so dragging a border vertex moves the
//! boundary of both regions at once and they can never drift apart.

use crate::field::ScalarField;
use crate::geometry::{simplify, Polygon, P2};
use crate::water::WaterOutput;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, HashMap};

pub const FEAT_SEA: u8 = 1;
pub const FEAT_RIVER: u8 = 2;
pub const FEAT_LAKE: u8 = 4;
pub const FEAT_COAST: u8 = 8;
pub const FEAT_RIDGE: u8 = 16;

/// Per-feature cost multipliers and terms. Costs are relative to open,
/// flat land (1.0 per cell).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct CostParams {
    /// Multiplier along rivers (< 1 = borders like to follow them).
    pub river: f32,
    pub coast: f32,
    pub ridge: f32,
    /// Added cost per metre of elevation change between neighbouring cells.
    pub slope: f32,
    /// Extra cost at the very top of the land height range.
    pub mountain: f32,
    /// Fraction of the land height range where the mountain term starts.
    pub mountain_start: f32,
    /// Cost of a lake cell (borders skirt lakes, realms rarely cross them).
    pub lake: f32,
    /// Cost of a sea cell: travel is possible so islands get claimed, but it
    /// never beats a land route of similar length.
    pub sea: f32,
    /// Working resolution cap (cells along the longer side).
    pub max_size: u32,
}

impl Default for CostParams {
    fn default() -> Self {
        Self { river: 0.25, coast: 0.35, ridge: 0.3, slope: 0.02, mountain: 6.0, mountain_start: 0.45, lake: 5.0, sea: 12.0, max_size: 1024 }
    }
}

/// The travel-cost grid and the feature flags it was built from.
#[derive(Clone, Debug)]
pub struct CostField {
    pub width: u32,
    pub height: u32,
    /// Project texels per cell.
    pub scale: f32,
    pub cost: Vec<f32>,
    pub feature: Vec<u8>,
}

impl CostField {
    pub fn build(elev: &ScalarField, sea_level: f32, water: Option<&WaterOutput>, p: &CostParams) -> CostField {
        let longer = elev.width().max(elev.height());
        let scale = (longer as f32 / p.max_size as f32).max(1.0);
        let w = ((elev.width() as f32 / scale).round() as u32).max(2);
        let h = ((elev.height() as f32 / scale).round() as u32).max(2);
        let scale = elev.width() as f32 / w as f32;
        let e = elev.downsample(w, h);
        let ed = e.data();
        let n = (w * h) as usize;
        let mut feature = vec![0u8; n];
        let idx = |x: i32, y: i32| (y as usize) * w as usize + x as usize;
        let inb = |x: i32, y: i32| x >= 0 && y >= 0 && x < w as i32 && y < h as i32;
        // Sea and coast.
        for y in 0..h as i32 {
            for x in 0..w as i32 {
                if ed[idx(x, y)] <= sea_level {
                    feature[idx(x, y)] |= FEAT_SEA;
                }
            }
        }
        for y in 0..h as i32 {
            for x in 0..w as i32 {
                if feature[idx(x, y)] & FEAT_SEA != 0 {
                    continue;
                }
                let coast = [(1, 0), (-1, 0), (0, 1), (0, -1)].iter().any(|(dx, dy)| inb(x + dx, y + dy) && feature[idx(x + dx, y + dy)] & FEAT_SEA != 0);
                if coast {
                    feature[idx(x, y)] |= FEAT_COAST;
                }
            }
        }
        // Rivers and lakes from the water system's vector output.
        if let Some(wo) = water {
            for r in &wo.rivers {
                for seg in r.points.windows(2) {
                    let a = [seg[0][0] / scale, seg[0][1] / scale];
                    let b = [seg[1][0] / scale, seg[1][1] / scale];
                    let len = ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2)).sqrt();
                    let steps = (len * 2.0).ceil().max(1.0) as usize;
                    for i in 0..=steps {
                        let t = i as f32 / steps as f32;
                        let x = (a[0] + (b[0] - a[0]) * t).floor() as i32;
                        let y = (a[1] + (b[1] - a[1]) * t).floor() as i32;
                        if inb(x, y) {
                            feature[idx(x, y)] |= FEAT_RIVER;
                        }
                    }
                }
            }
            for l in &wo.lakes {
                let pg = Polygon { points: l.polygon.points.iter().map(|q| [q[0] / scale, q[1] / scale]).collect() };
                pg.fill(w, h, |x, y| feature[idx(x as i32, y as i32)] |= FEAT_LAKE);
            }
        }
        // Ridgelines: cells higher than both neighbours across at least two
        // of the four axes on a lightly smoothed surface, then thickened by
        // one cell so a route can follow them without stepping off.
        let mut sm = vec![0f32; n];
        for y in 0..h as i32 {
            for x in 0..w as i32 {
                let mut s = 0.0;
                let mut k = 0.0;
                for dy in -1..=1 {
                    for dx in -1..=1 {
                        if inb(x + dx, y + dy) {
                            s += ed[idx(x + dx, y + dy)];
                            k += 1.0;
                        }
                    }
                }
                sm[idx(x, y)] = s / k;
            }
        }
        let (_, emax) = e.min_max();
        let land_range = (emax - sea_level).max(1.0);
        let margin = (land_range * 0.004).max(0.5);
        let mut ridge = vec![false; n];
        for y in 1..h as i32 - 1 {
            for x in 1..w as i32 - 1 {
                let c = sm[idx(x, y)];
                if c <= sea_level + land_range * 0.08 {
                    continue;
                }
                let mut axes = 0;
                for (dx, dy) in [(1, 0), (0, 1), (1, 1), (1, -1)] {
                    if c > sm[idx(x + dx, y + dy)] + margin && c > sm[idx(x - dx, y - dy)] + margin {
                        axes += 1;
                    }
                }
                if axes >= 2 {
                    ridge[idx(x, y)] = true;
                }
            }
        }
        for y in 0..h as i32 {
            for x in 0..w as i32 {
                let near = (-1..=1).any(|dy| (-1..=1).any(|dx| inb(x + dx, y + dy) && ridge[idx(x + dx, y + dy)]));
                if near && feature[idx(x, y)] & FEAT_SEA == 0 {
                    feature[idx(x, y)] |= FEAT_RIDGE;
                }
            }
        }
        // Cost.
        let mut cost = vec![1f32; n];
        for y in 0..h as i32 {
            for x in 0..w as i32 {
                let i = idx(x, y);
                let f = feature[i];
                if f & FEAT_SEA != 0 {
                    cost[i] = p.sea;
                    continue;
                }
                if f & FEAT_LAKE != 0 {
                    cost[i] = p.lake;
                    continue;
                }
                let mut grad: f32 = 0.0;
                for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                    if inb(x + dx, y + dy) {
                        grad = grad.max((ed[idx(x + dx, y + dy)] - ed[i]).abs());
                    }
                }
                let mut c = 1.0 + p.slope * grad;
                let e01 = ((ed[i] - sea_level) / land_range).clamp(0.0, 1.0);
                if e01 > p.mountain_start {
                    let t = (e01 - p.mountain_start) / (1.0 - p.mountain_start);
                    c += p.mountain * t * t;
                }
                let mut factor: f32 = 1.0;
                if f & FEAT_RIVER != 0 {
                    factor = factor.min(p.river);
                }
                if f & FEAT_COAST != 0 {
                    factor = factor.min(p.coast);
                }
                if f & FEAT_RIDGE != 0 {
                    factor = factor.min(p.ridge);
                }
                cost[i] = (c * factor).max(0.05);
            }
        }
        CostField { width: w, height: h, scale, cost, feature }
    }

    pub fn to_cell(&self, p: P2) -> (i32, i32) {
        (((p[0] / self.scale).floor() as i32).clamp(0, self.width as i32 - 1), ((p[1] / self.scale).floor() as i32).clamp(0, self.height as i32 - 1))
    }
    pub fn cell_centre(&self, x: i32, y: i32) -> P2 {
        [(x as f32 + 0.5) * self.scale, (y as f32 + 0.5) * self.scale]
    }
    pub fn is_land(&self, x: i32, y: i32) -> bool {
        x >= 0 && y >= 0 && x < self.width as i32 && y < self.height as i32 && self.feature[(y as u32 * self.width + x as u32) as usize] & FEAT_SEA == 0
    }
    pub fn land_at(&self, p: P2) -> bool {
        let (x, y) = self.to_cell(p);
        self.is_land(x, y)
    }
}

#[derive(Clone, Copy, PartialEq)]
struct HeapItem {
    f: f32,
    idx: u32,
}
impl Eq for HeapItem {}
impl Ord for HeapItem {
    fn cmp(&self, other: &Self) -> Ordering {
        other.f.total_cmp(&self.f)
    }
}
impl PartialOrd for HeapItem {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

const SQ2: f32 = std::f32::consts::SQRT_2;
const NB8: [(i32, i32, f32); 8] = [(1, 0, 1.0), (-1, 0, 1.0), (0, 1, 1.0), (0, -1, 1.0), (1, 1, SQ2), (-1, 1, SQ2), (1, -1, SQ2), (-1, -1, SQ2)];

/// Least-cost route between two project-space points. `naturalness` 0 is a
/// straight surveyed segment; 1 follows the terrain cost fully; in between
/// the cost is blended toward uniform so the route straightens gradually.
pub fn least_cost_path(cf: &CostField, from: P2, to: P2, naturalness: f32) -> Vec<P2> {
    let n = naturalness.clamp(0.0, 1.0);
    if n < 0.02 {
        return vec![from, to];
    }
    let (ax, ay) = cf.to_cell(from);
    let (bx, by) = cf.to_cell(to);
    if (ax, ay) == (bx, by) {
        return vec![from, to];
    }
    // Search window around the segment.
    let dist = (((bx - ax).pow(2) + (by - ay).pow(2)) as f32).sqrt();
    let margin = (dist * 1.0).max(48.0) as i32;
    let x0 = (ax.min(bx) - margin).max(0);
    let y0 = (ay.min(by) - margin).max(0);
    let x1 = (ax.max(bx) + margin).min(cf.width as i32 - 1);
    let y1 = (ay.max(by) + margin).min(cf.height as i32 - 1);
    let ww = (x1 - x0 + 1) as usize;
    let hh = (y1 - y0 + 1) as usize;
    let local = |x: i32, y: i32| ((y - y0) as usize) * ww + (x - x0) as usize;
    let blended = |x: i32, y: i32| (1.0 - n) + n * cf.cost[(y as u32 * cf.width + x as u32) as usize];
    let mut min_c = f32::INFINITY;
    for y in y0..=y1 {
        for x in x0..=x1 {
            min_c = min_c.min(blended(x, y));
        }
    }
    let mut g = vec![f32::INFINITY; ww * hh];
    let mut came = vec![u32::MAX; ww * hh];
    let mut closed = vec![false; ww * hh];
    let mut heap = BinaryHeap::new();
    let start = local(ax, ay);
    let goal = local(bx, by);
    g[start] = 0.0;
    let heur = |x: i32, y: i32| (((bx - x).pow(2) + (by - y).pow(2)) as f32).sqrt() * min_c;
    heap.push(HeapItem { f: heur(ax, ay), idx: start as u32 });
    while let Some(HeapItem { idx, .. }) = heap.pop() {
        let i = idx as usize;
        if closed[i] {
            continue;
        }
        closed[i] = true;
        if i == goal {
            break;
        }
        let x = x0 + (i % ww) as i32;
        let y = y0 + (i / ww) as i32;
        let cc = blended(x, y);
        for (dx, dy, step) in NB8 {
            let (nx, ny) = (x + dx, y + dy);
            if nx < x0 || ny < y0 || nx > x1 || ny > y1 {
                continue;
            }
            let j = local(nx, ny);
            if closed[j] {
                continue;
            }
            let ng = g[i] + step * 0.5 * (cc + blended(nx, ny));
            if ng < g[j] {
                g[j] = ng;
                came[j] = i as u32;
                heap.push(HeapItem { f: ng + heur(nx, ny), idx: j as u32 });
            }
        }
    }
    if came[goal] == u32::MAX && goal != start {
        return vec![from, to];
    }
    let mut cells = vec![goal];
    let mut cur = goal;
    while cur != start {
        cur = came[cur] as usize;
        cells.push(cur);
    }
    cells.reverse();
    let mut pts: Vec<P2> = cells.iter().map(|&i| cf.cell_centre(x0 + (i % ww) as i32, y0 + (i / ww) as i32)).collect();
    if let Some(p) = pts.first_mut() {
        *p = from;
    }
    if let Some(p) = pts.last_mut() {
        *p = to;
    }
    let keep = simplify(&pts, cf.scale * 0.6);
    keep.into_iter().map(|i| pts[i]).collect()
}

/// The border brush: control points are the stroke simplified to a
/// tolerance that grows as naturalness drops (surveyed borders have few
/// corners); consecutive control points are joined by least-cost routes.
pub fn border_from_stroke(cf: &CostField, stroke: &[P2], naturalness: f32) -> (Vec<P2>, Vec<P2>) {
    if stroke.len() < 2 {
        return (stroke.to_vec(), stroke.to_vec());
    }
    let mut total = 0.0;
    for w in stroke.windows(2) {
        total += ((w[1][0] - w[0][0]).powi(2) + (w[1][1] - w[0][1]).powi(2)).sqrt();
    }
    let tol = (total * (0.03 + 0.05 * (1.0 - naturalness))).max(cf.scale * 2.0);
    let keep = simplify(stroke, tol);
    let control: Vec<P2> = keep.into_iter().map(|i| stroke[i]).collect();
    (route_control_points(cf, &control, naturalness), control)
}

/// Join control points by least-cost routes.
pub fn route_control_points(cf: &CostField, control: &[P2], naturalness: f32) -> Vec<P2> {
    let mut out: Vec<P2> = Vec::new();
    for w in control.windows(2) {
        let seg = least_cost_path(cf, w[0], w[1], naturalness);
        if out.is_empty() {
            out.extend(seg);
        } else {
            out.extend(seg.into_iter().skip(1));
        }
    }
    if out.is_empty() {
        out.extend_from_slice(control);
    }
    out
}

/// A realm's capital: where its territory grows from.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Seed {
    pub region: u64,
    pub pos: P2,
}

/// Grow territories from seeds by travel cost. Returns a label per cell
/// (0 = unclaimed; sea cells are never claimed) with enclaves folded into
/// the neighbour they share the longest boundary with.
pub fn grow_territories(cf: &CostField, seeds: &[Seed]) -> Vec<u64> {
    let n = (cf.width * cf.height) as usize;
    let mut label = vec![0u64; n];
    if seeds.is_empty() {
        return label;
    }
    let w = cf.width as i32;
    let h = cf.height as i32;
    let mut dist = vec![f32::INFINITY; n];
    let mut heap = BinaryHeap::new();
    for s in seeds {
        let (x, y) = cf.to_cell(s.pos);
        let i = (y * w + x) as usize;
        if dist[i] > 0.0 {
            dist[i] = 0.0;
            label[i] = s.region;
            heap.push(HeapItem { f: 0.0, idx: i as u32 });
        }
    }
    let mut done = vec![false; n];
    while let Some(HeapItem { f, idx }) = heap.pop() {
        let i = idx as usize;
        if done[i] || f > dist[i] {
            continue;
        }
        done[i] = true;
        let x = i as i32 % w;
        let y = i as i32 / w;
        let cc = cf.cost[i];
        for (dx, dy, step) in NB8 {
            let (nx, ny) = (x + dx, y + dy);
            if nx < 0 || ny < 0 || nx >= w || ny >= h {
                continue;
            }
            let j = (ny * w + nx) as usize;
            if done[j] {
                continue;
            }
            let nd = dist[i] + step * 0.5 * (cc + cf.cost[j]);
            if nd < dist[j] {
                dist[j] = nd;
                label[j] = label[i];
                heap.push(HeapItem { f: nd, idx: j as u32 });
            }
        }
    }
    for (l, f) in label.iter_mut().zip(&cf.feature) {
        if f & FEAT_SEA != 0 {
            *l = 0;
        }
    }
    resolve_enclaves(cf, &mut label, seeds);
    label
}

/// Fold every land component of a label that does not contain its seed
/// into the neighbouring label it touches most. Islands that touch only
/// sea keep their label.
fn resolve_enclaves(cf: &CostField, label: &mut [u64], seeds: &[Seed]) {
    let w = cf.width as i32;
    let h = cf.height as i32;
    let n = (w * h) as usize;
    let seed_cell: HashMap<u64, usize> = seeds
        .iter()
        .map(|s| {
            let (x, y) = cf.to_cell(s.pos);
            (s.region, (y * w + x) as usize)
        })
        .collect();
    for _round in 0..4 {
        let mut comp = vec![u32::MAX; n];
        let mut comps: Vec<(u64, Vec<usize>)> = Vec::new();
        let mut stack = Vec::new();
        for start in 0..n {
            if comp[start] != u32::MAX || label[start] == 0 {
                continue;
            }
            let id = comps.len() as u32;
            let l = label[start];
            let mut cells = Vec::new();
            comp[start] = id;
            stack.push(start);
            while let Some(i) = stack.pop() {
                cells.push(i);
                let x = i as i32 % w;
                let y = i as i32 / w;
                for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                    let (nx, ny) = (x + dx, y + dy);
                    if nx < 0 || ny < 0 || nx >= w || ny >= h {
                        continue;
                    }
                    let j = (ny * w + nx) as usize;
                    if comp[j] == u32::MAX && label[j] == l {
                        comp[j] = id;
                        stack.push(j);
                    }
                }
            }
            comps.push((l, cells));
        }
        let mut changed = false;
        for (l, cells) in &comps {
            let holds_seed = seed_cell.get(l).map(|&s| comp[s] == comp[cells[0]]).unwrap_or(false);
            if holds_seed {
                continue;
            }
            // Count boundary contacts by neighbouring label.
            let mut contact: HashMap<u64, u32> = HashMap::new();
            for &i in cells {
                let x = i as i32 % w;
                let y = i as i32 / w;
                for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                    let (nx, ny) = (x + dx, y + dy);
                    if nx < 0 || ny < 0 || nx >= w || ny >= h {
                        continue;
                    }
                    let j = (ny * w + nx) as usize;
                    if label[j] != 0 && label[j] != *l {
                        *contact.entry(label[j]).or_default() += 1;
                    }
                }
            }
            if let Some((&best, _)) = contact.iter().max_by_key(|(_, &c)| c) {
                for &i in cells {
                    label[i] = best;
                }
                changed = true;
            }
        }
        if !changed {
            break;
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum BorderKind {
    /// Produced by territory growth; the two sides are regions.
    Grown,
    /// Drawn with the border brush.
    Drawn,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum BorderStyle {
    Dashed,
    DashDot,
    Dotted,
    Solid,
}

impl BorderStyle {
    pub const ALL: [BorderStyle; 4] = [BorderStyle::Dashed, BorderStyle::DashDot, BorderStyle::Dotted, BorderStyle::Solid];
    pub fn label(self) -> &'static str {
        match self {
            BorderStyle::Dashed => "Dashed",
            BorderStyle::DashDot => "Dash-dot",
            BorderStyle::Dotted => "Dotted",
            BorderStyle::Solid => "Solid",
        }
    }
}

/// One border arc between two junctions (or a closed loop). `left` and
/// `right` are region ids (0 = no region) by a fixed convention: walking
/// the points in order, `left` is the region on the +x side when heading
/// +y. Region polygons are assembled from arcs, so an arc is shared.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Border {
    pub id: u64,
    pub left: u64,
    pub right: u64,
    pub points: Vec<P2>,
    pub kind: BorderKind,
    #[serde(default = "default_style")]
    pub style: BorderStyle,
    /// Border brush settings, kept so the route can be rebuilt.
    #[serde(default)]
    pub naturalness: f32,
    #[serde(default)]
    pub control: Vec<P2>,
}

fn default_style() -> BorderStyle {
    BorderStyle::Dashed
}

/// A realm: a seed, a palette slot and the entity that labels it. Its
/// outline is whatever the arcs say.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Region {
    pub id: u64,
    pub seed: P2,
    pub color: u32,
    #[serde(default)]
    pub entity: Option<u64>,
}

/// Turn a label grid into shared arcs between junction nodes. Each arc is
/// simplified once (endpoints kept), so both regions along it agree on
/// every vertex. `tol` is in project texels.
pub fn arcs_from_labels(cf: &CostField, label: &[u64], tol: f32, next_id: &mut u64) -> Vec<Border> {
    let w = cf.width as i32;
    let h = cf.height as i32;
    let at = |x: i32, y: i32| if x < 0 || y < 0 || x >= w || y >= h { 0 } else { label[(y * w + x) as usize] };
    // Edges between nodes (grid corners). Vertical edge at x between cells
    // (x-1, y) and (x, y): walking +y, left = cell (x, y) (+x side).
    // Horizontal edge at y between cells (x, y-1) and (x, y): walking +x,
    // left = cell (x, y-1)... we keep the convention "left is the +x side
    // when heading +y", which for a +x heading puts left on the -y side.
    struct Edge {
        a: (i32, i32),
        b: (i32, i32),
        left: u64,
        right: u64,
    }
    let mut edges: Vec<Edge> = Vec::new();
    for y in 0..h {
        for x in 0..=w {
            let (l, r) = (at(x, y), at(x - 1, y));
            if l != r {
                edges.push(Edge { a: (x, y), b: (x, y + 1), left: l, right: r });
            }
        }
    }
    for y in 0..=h {
        for x in 0..w {
            let (l, r) = (at(x, y - 1), at(x, y));
            if l != r {
                edges.push(Edge { a: (x, y), b: (x + 1, y), left: l, right: r });
            }
        }
    }
    let mut incident: HashMap<(i32, i32), Vec<usize>> = HashMap::new();
    for (i, e) in edges.iter().enumerate() {
        incident.entry(e.a).or_default().push(i);
        incident.entry(e.b).or_default().push(i);
    }
    let mut used = vec![false; edges.len()];
    let mut out = Vec::new();
    let mut walk = |start_edge: usize, start_node: (i32, i32), used: &mut Vec<bool>, out: &mut Vec<Border>| {
        let e = &edges[start_edge];
        let (mut node, forward) = if e.a == start_node { (e.b, true) } else { (e.a, false) };
        let (left, right) = if forward { (e.left, e.right) } else { (e.right, e.left) };
        let mut pts = vec![start_node, node];
        used[start_edge] = true;
        loop {
            let inc = &incident[&node];
            if inc.len() != 2 || node == start_node {
                break;
            }
            let Some(&ne) = inc.iter().find(|&&k| !used[k]) else { break };
            used[ne] = true;
            let e = &edges[ne];
            node = if e.a == node { e.b } else { e.a };
            pts.push(node);
        }
        let ptsf: Vec<P2> = pts.iter().map(|(x, y)| [*x as f32 * cf.scale, *y as f32 * cf.scale]).collect();
        let keep = simplify(&ptsf, tol);
        let points: Vec<P2> = keep.into_iter().map(|i| ptsf[i]).collect();
        *next_id += 1;
        out.push(Border { id: *next_id, left, right, points, kind: BorderKind::Grown, style: BorderStyle::Dashed, naturalness: 1.0, control: Vec::new() });
    };
    // Arcs between junctions first, then closed loops with no junction.
    let mut nodes: Vec<_> = incident.keys().copied().collect();
    nodes.sort();
    for &node in &nodes {
        if incident[&node].len() == 2 {
            continue;
        }
        for &ei in &incident[&node].clone() {
            if !used[ei] {
                walk(ei, node, &mut used, &mut out);
            }
        }
    }
    for ei in 0..edges.len() {
        if !used[ei] {
            let start = edges[ei].a;
            walk(ei, start, &mut used, &mut out);
        }
    }
    out
}

/// Assemble a region's outline rings from the arcs that border it.
pub fn region_rings(borders: &[Border], region: u64) -> Vec<Polygon> {
    if region == 0 {
        return Vec::new();
    }
    let key = |p: P2| ((p[0] * 4.0).round() as i64, (p[1] * 4.0).round() as i64);
    // Directed arcs with the region on the left.
    let mut arcs: Vec<Vec<P2>> = Vec::new();
    for b in borders {
        if b.points.len() < 2 {
            continue;
        }
        if b.left == region {
            arcs.push(b.points.clone());
        } else if b.right == region {
            let mut p = b.points.clone();
            p.reverse();
            arcs.push(p);
        }
    }
    let mut by_start: HashMap<(i64, i64), Vec<usize>> = HashMap::new();
    for (i, a) in arcs.iter().enumerate() {
        by_start.entry(key(a[0])).or_default().push(i);
    }
    let mut used = vec![false; arcs.len()];
    let mut rings = Vec::new();
    for i in 0..arcs.len() {
        if used[i] {
            continue;
        }
        used[i] = true;
        let mut ring: Vec<P2> = arcs[i].clone();
        let start = key(arcs[i][0]);
        let mut guard = 0;
        while key(*ring.last().unwrap()) != start && guard < arcs.len() + 1 {
            guard += 1;
            let end = key(*ring.last().unwrap());
            let Some(next) = by_start.get(&end).and_then(|v| v.iter().copied().find(|&k| !used[k])) else { break };
            used[next] = true;
            ring.extend(arcs[next].iter().skip(1).copied());
        }
        if ring.len() >= 4 {
            ring.pop();
            rings.push(Polygon { points: ring });
        }
    }
    rings
}

/// Rasterize region rings at a working resolution as `id + band` where the
/// fractional band rises toward each region's border (0 outside any region).
pub fn rasterize_regions(rings: &[(u64, Vec<Polygon>)], width: u32, height: u32, scale: f32, band_cells: u32) -> ScalarField {
    let n = (width * height) as usize;
    let mut id = vec![0u64; n];
    // Even-odd across a region's rings so holes (an inland sea) stay out
    // and islands inside them come back in.
    let mut parity = vec![false; n];
    for (rid, polys) in rings {
        parity.iter_mut().for_each(|b| *b = false);
        for pg in polys {
            let scaled = Polygon { points: pg.points.iter().map(|p| [p[0] / scale, p[1] / scale]).collect() };
            scaled.fill(width, height, |x, y| parity[(y * width + x) as usize] ^= true);
        }
        for i in 0..n {
            if parity[i] {
                id[i] = *rid;
            }
        }
    }
    // Distance (in cells) to the nearest cell of another id, by BFS from
    // the boundary, capped at band_cells.
    let w = width as i32;
    let h = height as i32;
    let mut d = vec![u32::MAX; n];
    let mut queue = std::collections::VecDeque::new();
    for y in 0..h {
        for x in 0..w {
            let i = (y * w + x) as usize;
            if id[i] == 0 {
                continue;
            }
            let edge = [(1, 0), (-1, 0), (0, 1), (0, -1)].iter().any(|(dx, dy)| {
                let (nx, ny) = (x + dx, y + dy);
                nx < 0 || ny < 0 || nx >= w || ny >= h || id[(ny * w + nx) as usize] != id[i]
            });
            if edge {
                d[i] = 0;
                queue.push_back(i);
            }
        }
    }
    while let Some(i) = queue.pop_front() {
        if d[i] >= band_cells {
            continue;
        }
        let x = i as i32 % w;
        let y = i as i32 / w;
        for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
            let (nx, ny) = (x + dx, y + dy);
            if nx < 0 || ny < 0 || nx >= w || ny >= h {
                continue;
            }
            let j = (ny * w + nx) as usize;
            if id[j] == id[i] && d[j] == u32::MAX {
                d[j] = d[i] + 1;
                queue.push_back(j);
            }
        }
    }
    let data: Vec<f32> = (0..n)
        .map(|i| {
            if id[i] == 0 {
                0.0
            } else {
                let band = if d[i] == u32::MAX { 0.0 } else { (1.0 - d[i] as f32 / band_cells as f32).clamp(0.0, 0.99) };
                id[i] as f32 + band
            }
        })
        .collect();
    ScalarField::from_vec(width, height, data)
}

/// Centre and radius for a region label: area-weighted centroid of its
/// rings and the radius of the equal-area disc.
pub fn region_extent(rings: &[Polygon]) -> Option<(P2, f32)> {
    let mut area = 0.0;
    let mut c = [0.0f32, 0.0];
    let mut best: Option<(f32, &Polygon)> = None;
    for pg in rings {
        let a = pg.area();
        if best.map(|b| a > b.0).unwrap_or(true) {
            best = Some((a, pg));
        }
        area += pg.signed_area();
    }
    let area = area.abs();
    let (a, pg) = best?;
    if a <= 0.0 {
        return None;
    }
    let n = pg.points.len() as f32;
    for p in &pg.points {
        c[0] += p[0] / n;
        c[1] += p[1] / n;
    }
    // Pull the centroid inside if the ring is concave enough to leave it out.
    if !pg.contains(c) {
        let mut best_d = f32::INFINITY;
        let mut best_p = c;
        for p in &pg.points {
            let d = (p[0] - c[0]).powi(2) + (p[1] - c[1]).powi(2);
            if d < best_d {
                best_d = d;
                best_p = *p;
            }
        }
        c = [(c[0] + best_p[0]) * 0.5, (c[1] + best_p[1]) * 0.5];
    }
    Some((c, (area / std::f32::consts::PI).sqrt()))
}

/// Is a point inside the region (even-odd over its rings, so holes count
/// as outside)?
pub fn rings_contain(rings: &[Polygon], p: P2) -> bool {
    rings.iter().filter(|r| r.contains(p)).count() % 2 == 1
}

/// Ten hand-coloured atlas tints for region fills (linear RGB 0..1).
pub const REGION_PALETTE: [[f32; 3]; 10] = [
    [0.82, 0.42, 0.36],
    [0.40, 0.58, 0.78],
    [0.55, 0.68, 0.36],
    [0.85, 0.66, 0.30],
    [0.62, 0.45, 0.70],
    [0.36, 0.66, 0.62],
    [0.80, 0.50, 0.62],
    [0.66, 0.60, 0.40],
    [0.45, 0.52, 0.72],
    [0.78, 0.55, 0.42],
];

#[cfg(test)]
mod tests {
    use super::*;

    fn wall_terrain() -> ScalarField {
        // Land with a tall east-west wall across the middle, gapped at x=32.
        let (w, h) = (128u32, 128u32);
        let mut d = vec![100.0f32; (w * h) as usize];
        for y in 60..68 {
            for x in 0..w {
                if !(28..36).contains(&x) {
                    d[(y * w + x) as usize] = 3000.0;
                }
            }
        }
        ScalarField::from_vec(w, h, d)
    }

    #[test]
    fn straight_when_surveyed_and_gap_when_natural() {
        let e = wall_terrain();
        let cf = CostField::build(&e, 0.0, None, &CostParams::default());
        assert_eq!(cf.scale, 1.0);
        let a = [90.0, 20.0];
        let b = [90.0, 110.0];
        let s = least_cost_path(&cf, a, b, 0.0);
        assert_eq!(s, vec![a, b]);
        let n = least_cost_path(&cf, a, b, 1.0);
        assert!(n.len() > 2);
        // The natural route crosses the wall row inside the gap.
        let cross = n.windows(2).find(|w| (w[0][1] <= 64.0) != (w[1][1] <= 64.0)).unwrap();
        assert!(cross[0][0] < 40.0 && cross[1][0] < 40.0, "crossed at {:?}", cross);
    }

    #[test]
    fn territories_partition_land_and_arcs_close() {
        let (w, h) = (96u32, 96u32);
        let mut d = vec![50.0f32; (w * h) as usize];
        // Sea on the west edge and an island in the south-east.
        for y in 0..h {
            for x in 0..8 {
                d[(y * w + x) as usize] = -10.0;
            }
        }
        for y in 70..90 {
            for x in 60..90 {
                d[(y * w + x) as usize] = -10.0;
            }
        }
        for y in 76..84 {
            for x in 70..80 {
                d[(y * w + x) as usize] = 20.0;
            }
        }
        let e = ScalarField::from_vec(w, h, d);
        let cf = CostField::build(&e, 0.0, None, &CostParams::default());
        let seeds = [Seed { region: 1, pos: [20.0, 20.0] }, Seed { region: 2, pos: [80.0, 20.0] }, Seed { region: 3, pos: [30.0, 80.0] }];
        let labels = grow_territories(&cf, &seeds);
        let land = cf.feature.iter().filter(|f| *f & FEAT_SEA == 0).count();
        let claimed = labels.iter().filter(|l| **l != 0).count();
        assert_eq!(land, claimed, "every land cell belongs to a realm");
        assert!(labels.contains(&1) && labels.contains(&2) && labels.contains(&3));
        // The island was reached across the sea.
        assert_ne!(labels[(80 * w + 75) as usize], 0);
        let mut next = 0;
        let arcs = arcs_from_labels(&cf, &labels, 0.0, &mut next);
        for r in 1..=3u64 {
            let rings = region_rings(&arcs, r);
            assert!(!rings.is_empty(), "region {r} has an outline");
            // Signed: hole rings run the other way and subtract.
            let area: f32 = rings.iter().map(|p| p.signed_area()).sum::<f32>().abs();
            let cells = labels.iter().filter(|l| **l == r).count() as f32;
            assert!((area - cells).abs() < 0.5, "region {r}: ring area {area} vs {cells} cells");
        }
        // Simplified arcs still assemble.
        let arcs2 = arcs_from_labels(&cf, &labels, 1.5, &mut next);
        assert!(!region_rings(&arcs2, 1).is_empty());
        let rings: Vec<(u64, Vec<Polygon>)> = (1..=3).map(|r| (r, region_rings(&arcs, r))).collect();
        let field = rasterize_regions(&rings, w, h, 1.0, 6);
        let v = field.data()[(20 * w + 20) as usize];
        assert_eq!(v.floor() as u64, 1);
        // The inland sea is a hole: not tinted; the island inside it is.
        assert_eq!(field.data()[(75 * w + 65) as usize], 0.0);
        assert_ne!(field.data()[(80 * w + 75) as usize], 0.0);
        assert!(!rings_contain(&region_rings(&arcs, labels[(80 * w + 30) as usize]), [65.0, 75.0]));
    }

    #[test]
    fn stroke_border_starts_and_ends_on_the_stroke() {
        let e = wall_terrain();
        let cf = CostField::build(&e, 0.0, None, &CostParams::default());
        let stroke: Vec<P2> = (0..50).map(|i| [10.0 + i as f32 * 2.0, 20.0 + (i as f32 * 0.3).sin() * 5.0]).collect();
        let (pts, control) = border_from_stroke(&cf, &stroke, 0.5);
        assert_eq!(pts[0], stroke[0]);
        assert_eq!(*pts.last().unwrap(), *stroke.last().unwrap());
        assert!(control.len() >= 2 && control.len() < stroke.len());
    }
}
