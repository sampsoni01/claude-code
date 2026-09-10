//! Hydrology derived from the elevation field: depression fill, flow
//! direction and accumulation, lakes, rivers.
//!
//! Everything here works on the *filled* surface produced by a priority-flood
//! fill (Barnes et al. 2014) with an epsilon gradient, so every land cell has
//! a strictly lower neighbour and drainage is total. Lakes are where the
//! filled surface sits above the terrain; rivers are where precipitation-
//! weighted accumulation exceeds a threshold.
//!
//! Flow accumulation, flow direction and the filled surface are internals of
//! the water system: only [`crate::water`] consumes them. Downstream systems
//! read [`crate::water::WaterOutput`].

use crate::field::ScalarField;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BinaryHeap, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering as AtomicOrdering};

/// Gradient imposed on flat, filled regions so water still drains.
pub const FILL_EPSILON: f32 = 0.002;

/// D8 neighbour offsets, index = direction code 0..8 (8 = none / sink).
pub const D8: [(i32, i32); 8] = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)];
pub const NO_FLOW: u8 = 8;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HydrologyParams {
    pub enabled: bool,
    /// Accumulation threshold for a channel, as a fraction of the map area.
    pub river_threshold_frac: f32,
    /// River width in texels at the threshold; width grows with sqrt(flow).
    pub river_width_scale: f32,
    pub max_river_width: f32,
    /// Minimum lake depth (elevation units) for a filled pit to be drawn.
    pub min_lake_depth: f32,
    /// Minimum lake area in texels.
    pub min_lake_area: u32,
    /// Fraction of flow lost per texel in fully arid cells.
    pub arid_loss: f32,
    pub lakes_enabled: bool,
    /// Lakes whose mean precipitation is below this dry up (salt flats).
    pub lake_min_moisture: f32,
}

impl Default for HydrologyParams {
    fn default() -> Self {
        Self {
            enabled: true,
            river_threshold_frac: 1.2e-4,
            river_width_scale: 1.2,
            max_river_width: 36.0,
            min_lake_depth: 12.0,
            min_lake_area: 24,
            arid_loss: 0.015,
            lakes_enabled: true,
            lake_min_moisture: 0.12,
        }
    }
}

#[derive(Copy, Clone)]
struct HeapItem {
    h: f32,
    idx: u32,
}
impl PartialEq for HeapItem {
    fn eq(&self, o: &Self) -> bool {
        self.h == o.h && self.idx == o.idx
    }
}
impl Eq for HeapItem {}
impl PartialOrd for HeapItem {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> {
        Some(self.cmp(o))
    }
}
impl Ord for HeapItem {
    fn cmp(&self, o: &Self) -> Ordering {
        // Min-heap on height, then index for determinism.
        o.h.partial_cmp(&self.h).unwrap_or(Ordering::Equal).then(o.idx.cmp(&self.idx))
    }
}

/// Priority-flood depression fill. Cells at or below `sea_level` are the
/// drainage base and are left untouched; land on the map border also drains
/// off-map. Returns the filled surface. `cancel` aborts early with a partial
/// (but valid) surface.
pub(crate) fn fill_depressions(elev: &ScalarField, sea_level: f32, cancel: &AtomicBool) -> ScalarField {
    let (w, h) = (elev.width() as usize, elev.height() as usize);
    let n = w * h;
    let src = elev.data();
    let mut filled = src.to_vec();
    let mut closed = vec![false; n];
    let mut open = BinaryHeap::new();
    let mut pit: VecDeque<u32> = VecDeque::new();

    // Seed: sea cells are closed; land cells adjacent to sea or on the border are open.
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            if src[i] <= sea_level {
                closed[i] = true;
            }
        }
    }
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            if closed[i] {
                continue;
            }
            let border = x == 0 || y == 0 || x == w - 1 || y == h - 1;
            let mut seed = border;
            if !seed {
                for (dx, dy) in D8 {
                    let nx = x as i32 + dx;
                    let ny = y as i32 + dy;
                    if src[ny as usize * w + nx as usize] <= sea_level {
                        seed = true;
                        break;
                    }
                }
            }
            if seed {
                closed[i] = true;
                open.push(HeapItem { h: filled[i], idx: i as u32 });
            }
        }
    }

    let mut counter = 0u32;
    loop {
        let c = if let Some(c) = pit.pop_front() {
            c as usize
        } else if let Some(item) = open.pop() {
            item.idx as usize
        } else {
            break;
        };
        counter = counter.wrapping_add(1);
        if counter & 0xFFFF == 0 && cancel.load(AtomicOrdering::Relaxed) {
            break;
        }
        let cx = (c % w) as i32;
        let cy = (c / w) as i32;
        let hc = filled[c];
        for (dx, dy) in D8 {
            let nx = cx + dx;
            let ny = cy + dy;
            if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                continue;
            }
            let ni = ny as usize * w + nx as usize;
            if closed[ni] {
                continue;
            }
            closed[ni] = true;
            if filled[ni] <= hc + FILL_EPSILON {
                filled[ni] = hc + FILL_EPSILON;
                pit.push_back(ni as u32);
            } else {
                open.push(HeapItem { h: filled[ni], idx: ni as u32 });
            }
        }
    }
    ScalarField::from_vec(elev.width(), elev.height(), filled)
}

/// Steepest-descent D8 directions on the filled surface. Sea cells and cells
/// with no lower neighbour get `NO_FLOW`.
pub(crate) fn flow_directions(filled: &ScalarField, sea_level: f32) -> Vec<u8> {
    let (w, h) = (filled.width() as usize, filled.height() as usize);
    let data = filled.data();
    let mut dirs = vec![NO_FLOW; w * h];
    dirs.par_chunks_mut(w).enumerate().for_each(|(y, row)| {
        for (x, d) in row.iter_mut().enumerate() {
            let i = y * w + x;
            let hc = data[i];
            if hc <= sea_level {
                continue;
            }
            let mut best = 0.0f32;
            let mut best_dir = NO_FLOW;
            for (k, &(dx, dy)) in D8.iter().enumerate() {
                let nx = x as i32 + dx;
                let ny = y as i32 + dy;
                if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                    continue;
                }
                let hn = data[ny as usize * w + nx as usize];
                let dist = if dx != 0 && dy != 0 { std::f32::consts::SQRT_2 } else { 1.0 };
                let s = (hc - hn) / dist;
                if s > best {
                    best = s;
                    best_dir = k as u8;
                }
            }
            *d = best_dir;
        }
    });
    dirs
}

/// Downstream cell index for a direction, if any.
#[inline]
pub(crate) fn downstream(i: usize, dir: u8, w: usize, h: usize) -> Option<usize> {
    if dir >= NO_FLOW {
        return None;
    }
    let (dx, dy) = D8[dir as usize];
    let x = (i % w) as i32 + dx;
    let y = (i / w) as i32 + dy;
    if x < 0 || y < 0 || x >= w as i32 || y >= h as i32 {
        None
    } else {
        Some(y as usize * w + x as usize)
    }
}

/// Accumulate `weight` (precipitation) downstream. Each cell passes on
/// `(inflow + weight) * (1 - loss)` where `loss` is per-cell runoff loss
/// (arid ground). Cells are processed from highest to lowest, which is a
/// valid topological order on the epsilon-filled surface.
pub(crate) fn flow_accumulation(filled: &ScalarField, dirs: &[u8], weight: &[f32], loss: &[f32]) -> Vec<f32> {
    let (w, h) = (filled.width() as usize, filled.height() as usize);
    let n = w * h;
    let data = filled.data();
    // Pack (descending-height key, index) into one u64 so the sort touches
    // contiguous memory instead of chasing indices into `data`.
    let mut order: Vec<u64> = (0..n)
        .into_par_iter()
        .map(|i| {
            let b = data[i].to_bits();
            let key = if b & 0x8000_0000 != 0 { !b } else { b | 0x8000_0000 };
            ((!key) as u64) << 32 | i as u64
        })
        .collect();
    order.par_sort_unstable();
    let mut acc = vec![0f32; n];
    for &packed in &order {
        let i = (packed & 0xFFFF_FFFF) as usize;
        let total = acc[i] + weight[i];
        acc[i] = total;
        if let Some(d) = downstream(i, dirs[i], w, h) {
            acc[d] += total * (1.0 - loss[i]);
        }
    }
    acc
}

/// A lake: a filled region deeper than the minimum depth.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Lake {
    pub id: u32,
    /// Water surface elevation.
    pub level: f32,
    pub area: u32,
    pub centroid: [f32; 2],
    pub max_depth: f32,
}

/// Label lakes. Returns per-cell lake id (0 = none) and the lake list.
/// `moisture` (0..1 per cell) lets arid basins dry out; pass `None` to skip.
pub(crate) fn find_lakes(elev: &ScalarField, filled: &ScalarField, moisture: Option<&[f32]>, p: &HydrologyParams) -> (Vec<u32>, Vec<Lake>) {
    let (w, h) = (elev.width() as usize, elev.height() as usize);
    let n = w * h;
    let e = elev.data();
    let f = filled.data();
    let mut ids = vec![0u32; n];
    let mut lakes = Vec::new();
    if !p.lakes_enabled {
        return (ids, lakes);
    }
    let is_lake = |i: usize| f[i] - e[i] > p.min_lake_depth;
    let mut queue = Vec::new();
    for start in 0..n {
        if ids[start] != 0 || !is_lake(start) {
            continue;
        }
        let id = lakes.len() as u32 + 1;
        ids[start] = id;
        queue.clear();
        queue.push(start);
        let mut area = 0u32;
        let mut sx = 0f64;
        let mut sy = 0f64;
        let mut max_depth = 0f32;
        let mut moist_sum = 0f32;
        let level = f[start];
        let mut cells = Vec::new();
        while let Some(c) = queue.pop() {
            area += 1;
            sx += (c % w) as f64;
            sy += (c / w) as f64;
            max_depth = max_depth.max(f[c] - e[c]);
            if let Some(m) = moisture {
                moist_sum += m[c];
            }
            cells.push(c);
            let cx = (c % w) as i32;
            let cy = (c / w) as i32;
            for (dx, dy) in [(1, 0), (-1, 0), (0, 1), (0, -1)] {
                let nx = cx + dx;
                let ny = cy + dy;
                if nx < 0 || ny < 0 || nx >= w as i32 || ny >= h as i32 {
                    continue;
                }
                let ni = ny as usize * w + nx as usize;
                if ids[ni] == 0 && is_lake(ni) && (f[ni] - level).abs() < 1.0 {
                    ids[ni] = id;
                    queue.push(ni);
                }
            }
        }
        let too_dry = moisture.is_some() && (moist_sum / area as f32) < p.lake_min_moisture;
        if area < p.min_lake_area || too_dry {
            for c in cells {
                ids[c] = u32::MAX; // visited, rejected
            }
            continue;
        }
        lakes.push(Lake { id, level, area, centroid: [(sx / area as f64) as f32 + 0.5, (sy / area as f64) as f32 + 0.5], max_depth });
    }
    for v in ids.iter_mut() {
        if *v == u32::MAX {
            *v = 0;
        }
    }
    (ids, lakes)
}

/// A traced river channel from a source down to a junction, lake, sea or edge.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct River {
    pub id: u32,
    /// Vertex positions in field coordinates (texel centres).
    pub points: Vec<[f32; 2]>,
    /// Width in texels per vertex.
    pub widths: Vec<f32>,
    /// Flow at the last vertex.
    pub mouth_flow: f32,
    /// Id of the river this one joins, if any.
    pub joins: Option<u32>,
}

pub(crate) struct RiverNetwork {
    pub rivers: Vec<River>,
    /// Per-cell channel width (0 = no channel).
    pub width: Vec<f32>,
    #[allow(dead_code)]
    pub threshold: f32,
}

/// Width in texels for a given accumulation.
pub(crate) fn channel_width(acc: f32, threshold: f32, p: &HydrologyParams) -> f32 {
    if acc < threshold {
        return 0.0;
    }
    (p.river_width_scale * (acc / threshold).sqrt()).min(p.max_river_width)
}

/// Trace channels where accumulation exceeds the threshold.
pub(crate) fn trace_rivers(
    filled: &ScalarField,
    dirs: &[u8],
    acc: &[f32],
    lake_ids: &[u32],
    sea_level: f32,
    p: &HydrologyParams,
) -> RiverNetwork {
    let (w, h) = (filled.width() as usize, filled.height() as usize);
    let n = w * h;
    let f = filled.data();
    let threshold = (p.river_threshold_frac * n as f32).max(4.0);
    let mut width = vec![0f32; n];
    let mut rivers = Vec::new();
    if !p.enabled {
        return RiverNetwork { rivers, width, threshold };
    }
    // Channel cells and their upstream channel count.
    let is_channel: Vec<bool> = (0..n).map(|i| acc[i] >= threshold && f[i] > sea_level && lake_ids[i] == 0).collect();
    let mut inflow = vec![0u8; n];
    for i in 0..n {
        if is_channel[i] {
            if let Some(d) = downstream(i, dirs[i], w, h) {
                inflow[d] = inflow[d].saturating_add(1);
            }
        }
    }
    for i in 0..n {
        if is_channel[i] {
            width[i] = channel_width(acc[i], threshold, p);
        }
    }
    // Sources: channel cells with no channel inflow. Trace each downstream
    // until we hit a visited cell (junction), a non-channel cell (lake/sea/edge).
    let mut owner = vec![0u32; n];
    let mut sources: Vec<usize> = (0..n).filter(|&i| is_channel[i] && inflow[i] == 0).collect();
    // Larger rivers first so trunks own the junction cells.
    sources.sort_by(|a, b| {
        let fa = trunk_flow(*a, dirs, acc, &is_channel, w, h);
        let fb = trunk_flow(*b, dirs, acc, &is_channel, w, h);
        fb.partial_cmp(&fa).unwrap_or(Ordering::Equal)
    });
    for src in sources {
        let id = rivers.len() as u32 + 1;
        let mut points = Vec::new();
        let mut widths = Vec::new();
        let mut c = src;
        let mut joins = None;
        let mut last_flow;
        loop {
            points.push([(c % w) as f32 + 0.5, (c / w) as f32 + 0.5]);
            widths.push(width[c]);
            last_flow = acc[c];
            if owner[c] != 0 {
                joins = Some(owner[c]);
                break;
            }
            owner[c] = id;
            match downstream(c, dirs[c], w, h) {
                Some(d) if is_channel[d] => c = d,
                Some(d) => {
                    // Terminal vertex in the lake / sea / sink so the line reaches the water.
                    points.push([(d % w) as f32 + 0.5, (d / w) as f32 + 0.5]);
                    widths.push(width[c]);
                    last_flow = acc[d];
                    break;
                }
                None => break,
            }
        }
        if points.len() >= 2 {
            rivers.push(River { id, points, widths, mouth_flow: last_flow, joins });
        }
    }
    RiverNetwork { rivers, width, threshold }
}

fn trunk_flow(mut c: usize, dirs: &[u8], acc: &[f32], is_channel: &[bool], w: usize, h: usize) -> f32 {
    let mut steps = 0;
    while let Some(d) = downstream(c, dirs[c], w, h) {
        if !is_channel[d] || steps > 100_000 {
            break;
        }
        c = d;
        steps += 1;
    }
    acc[c]
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bowl(size: u32) -> ScalarField {
        // Land with a pit in the middle and sea at the left edge.
        let mut f = ScalarField::new(size, size, 0.0);
        let c = size as f32 / 2.0;
        f.par_map_inplace(|x, y, _| {
            let dx = x as f32 - c;
            let dy = y as f32 - c;
            let r = (dx * dx + dy * dy).sqrt();
            let base = 100.0 + x as f32 * 2.0; // rises to the east, drains west
            if x < 4 {
                -50.0
            } else if r < 10.0 {
                base - 80.0 + r * 3.0
            } else {
                base
            }
        });
        f
    }

    #[test]
    fn fill_removes_pit_and_drains() {
        let e = bowl(64);
        let filled = fill_depressions(&e, 0.0, &AtomicBool::new(false));
        let (fx, fy) = (32u32, 32u32);
        assert!(filled.get(fx, fy) > e.get(fx, fy) + 10.0, "pit should be filled");
        let dirs = flow_directions(&filled, 0.0);
        let (w, h) = (64usize, 64usize);
        // Every land cell drains to the sea eventually.
        for y in 0..h {
            for x in 4..w {
                let mut c = y * w + x;
                let mut steps = 0;
                while let Some(d) = downstream(c, dirs[c], w, h) {
                    c = d;
                    steps += 1;
                    assert!(steps < 10_000);
                }
                assert!(filled.get((c % w) as u32, (c / w) as u32) <= 0.0 || c % w == 0 || c % w == w - 1 || c / w == 0 || c / w == h - 1,
                    "cell {x},{y} ended at non-sea {}", c);
            }
        }
        let weight = vec![1.0; w * h];
        let loss = vec![0.0; w * h];
        let acc = flow_accumulation(&filled, &dirs, &weight, &loss);
        // Total flow entering the sea column equals the number of land cells (up to border leaks).
        let land: f32 = (0..w * h).filter(|&i| e.data()[i] > 0.0).count() as f32;
        let sea_in: f32 = (0..h).map(|y| acc[y * w + 3] - 1.0).sum();
        assert!(sea_in > land * 0.8, "sea inflow {sea_in} vs land {land}");
        let p = HydrologyParams { min_lake_depth: 5.0, min_lake_area: 4, ..Default::default() };
        let (ids, lakes) = find_lakes(&e, &filled, None, &p);
        assert_eq!(lakes.len(), 1);
        assert!(lakes[0].area > 50);
        assert_ne!(ids[32 * 64 + 32], 0);
    }

    #[test]
    fn rivers_trace_to_water() {
        let e = bowl(64);
        let filled = fill_depressions(&e, 0.0, &AtomicBool::new(false));
        let dirs = flow_directions(&filled, 0.0);
        let weight = vec![1.0; 64 * 64];
        let loss = vec![0.0; 64 * 64];
        let acc = flow_accumulation(&filled, &dirs, &weight, &loss);
        let p = HydrologyParams { river_threshold_frac: 0.005, min_lake_depth: 5.0, min_lake_area: 4, ..Default::default() };
        let (ids, _) = find_lakes(&e, &filled, None, &p);
        let net = trace_rivers(&filled, &dirs, &acc, &ids, 0.0, &p);
        assert!(!net.rivers.is_empty());
        for r in &net.rivers {
            assert_eq!(r.points.len(), r.widths.len());
            assert!(r.widths.iter().all(|w| *w > 0.0));
        }
    }
}
