//! Small 2D geometry helpers shared by water, brushes and (later) labels.

use serde::{Deserialize, Serialize};

pub type P2 = [f32; 2];

#[inline]
pub fn sub(a: P2, b: P2) -> P2 {
    [a[0] - b[0], a[1] - b[1]]
}
#[inline]
pub fn dot(a: P2, b: P2) -> f32 {
    a[0] * b[0] + a[1] * b[1]
}
#[inline]
pub fn len(a: P2) -> f32 {
    dot(a, a).sqrt()
}
#[inline]
pub fn lerp(a: P2, b: P2, t: f32) -> P2 {
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
}

/// Squared distance from `p` to segment `ab` and the parameter along it.
pub fn seg_dist2(p: P2, a: P2, b: P2) -> (f32, f32) {
    let ab = sub(b, a);
    let l2 = dot(ab, ab);
    let t = if l2 <= 1e-12 { 0.0 } else { (dot(sub(p, a), ab) / l2).clamp(0.0, 1.0) };
    let q = lerp(a, b, t);
    let d = sub(p, q);
    (dot(d, d), t)
}

/// Douglas–Peucker simplification with `tol` maximum deviation.
pub fn simplify(points: &[P2], tol: f32) -> Vec<usize> {
    let n = points.len();
    if n <= 2 {
        return (0..n).collect();
    }
    let mut keep = vec![false; n];
    keep[0] = true;
    keep[n - 1] = true;
    let mut stack = vec![(0usize, n - 1)];
    let tol2 = tol * tol;
    while let Some((a, b)) = stack.pop() {
        if b <= a + 1 {
            continue;
        }
        let mut worst = 0.0f32;
        let mut wi = a;
        for i in a + 1..b {
            let (d2, _) = seg_dist2(points[i], points[a], points[b]);
            if d2 > worst {
                worst = d2;
                wi = i;
            }
        }
        if worst > tol2 {
            keep[wi] = true;
            stack.push((a, wi));
            stack.push((wi, b));
        }
    }
    (0..n).filter(|&i| keep[i]).collect()
}

/// One round of Chaikin corner cutting (open polyline keeps its endpoints).
pub fn chaikin(points: &[P2], closed: bool) -> Vec<P2> {
    let n = points.len();
    if n < 3 {
        return points.to_vec();
    }
    let mut out = Vec::with_capacity(n * 2);
    if !closed {
        out.push(points[0]);
    }
    let segs = if closed { n } else { n - 1 };
    for i in 0..segs {
        let a = points[i];
        let b = points[(i + 1) % n];
        out.push(lerp(a, b, 0.25));
        out.push(lerp(a, b, 0.75));
    }
    if !closed {
        out.push(points[n - 1]);
    }
    out
}

/// Cumulative arc length per vertex.
pub fn arc_lengths(points: &[P2]) -> Vec<f32> {
    let mut out = Vec::with_capacity(points.len());
    let mut acc = 0.0;
    for i in 0..points.len() {
        if i > 0 {
            acc += len(sub(points[i], points[i - 1]));
        }
        out.push(acc);
    }
    out
}

/// A closed polygon in field coordinates.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Polygon {
    pub points: Vec<P2>,
}

impl Polygon {
    pub fn area(&self) -> f32 {
        let n = self.points.len();
        let mut a = 0.0;
        for i in 0..n {
            let p = self.points[i];
            let q = self.points[(i + 1) % n];
            a += p[0] * q[1] - q[0] * p[1];
        }
        a.abs() * 0.5
    }

    pub fn bbox(&self) -> ([f32; 2], [f32; 2]) {
        let mut lo = [f32::INFINITY; 2];
        let mut hi = [f32::NEG_INFINITY; 2];
        for p in &self.points {
            lo[0] = lo[0].min(p[0]);
            lo[1] = lo[1].min(p[1]);
            hi[0] = hi[0].max(p[0]);
            hi[1] = hi[1].max(p[1]);
        }
        (lo, hi)
    }

    pub fn contains(&self, p: P2) -> bool {
        let n = self.points.len();
        let mut inside = false;
        let mut j = n - 1;
        for i in 0..n {
            let a = self.points[i];
            let b = self.points[j];
            if (a[1] > p[1]) != (b[1] > p[1]) {
                let x = a[0] + (p[1] - a[1]) / (b[1] - a[1]) * (b[0] - a[0]);
                if p[0] < x {
                    inside = !inside;
                }
            }
            j = i;
        }
        inside
    }

    /// Scanline-fill into `f(x, y)` for texel centres inside the polygon.
    pub fn fill(&self, width: u32, height: u32, mut f: impl FnMut(u32, u32)) {
        let n = self.points.len();
        if n < 3 {
            return;
        }
        let (lo, hi) = self.bbox();
        let y0 = lo[1].floor().max(0.0) as i64;
        let y1 = (hi[1].ceil() as i64).min(height as i64 - 1);
        let mut xs: Vec<f32> = Vec::new();
        for y in y0..=y1 {
            let yc = y as f32 + 0.5;
            xs.clear();
            let mut j = n - 1;
            for i in 0..n {
                let a = self.points[i];
                let b = self.points[j];
                if (a[1] > yc) != (b[1] > yc) {
                    xs.push(a[0] + (yc - a[1]) / (b[1] - a[1]) * (b[0] - a[0]));
                }
                j = i;
            }
            xs.sort_by(|a, b| a.partial_cmp(b).unwrap());
            for pair in xs.chunks_exact(2) {
                let xa = (pair[0] - 0.5).ceil().max(0.0) as i64;
                let xb = ((pair[1] - 0.5).floor() as i64).min(width as i64 - 1);
                for x in xa..=xb {
                    f(x as u32, y as u32);
                }
            }
        }
    }
}

/// Trace the outer boundary of a labelled region in a mask as a polygon of
/// cell-corner vertices (square tracing over the edge graph). Returns the
/// largest loop found for the label.
pub fn trace_region(width: usize, height: usize, is_inside: impl Fn(usize, usize) -> bool) -> Vec<P2> {
    // Collect directed boundary edges (inside on the left when walking).
    use std::collections::HashMap;
    let mut next: HashMap<(i32, i32), Vec<(i32, i32)>> = HashMap::new();
    let mut count = 0usize;
    let inside = |x: i32, y: i32| x >= 0 && y >= 0 && (x as usize) < width && (y as usize) < height && is_inside(x as usize, y as usize);
    for y in 0..height as i32 {
        for x in 0..width as i32 {
            if !inside(x, y) {
                continue;
            }
            // Edges of this cell whose neighbour is outside, oriented so the
            // interior is on the right (clockwise in y-down screen space).
            if !inside(x, y - 1) {
                next.entry((x, y)).or_default().push((x + 1, y));
                count += 1;
            }
            if !inside(x + 1, y) {
                next.entry((x + 1, y)).or_default().push((x + 1, y + 1));
                count += 1;
            }
            if !inside(x, y + 1) {
                next.entry((x + 1, y + 1)).or_default().push((x, y + 1));
                count += 1;
            }
            if !inside(x - 1, y) {
                next.entry((x, y + 1)).or_default().push((x, y));
                count += 1;
            }
        }
    }
    if count == 0 {
        return Vec::new();
    }
    // Follow loops; keep the longest.
    let mut best: Vec<P2> = Vec::new();
    let mut keys: Vec<(i32, i32)> = next.keys().copied().collect();
    keys.sort();
    for start in keys {
        while let Some(first) = next.get_mut(&start).and_then(|v| v.pop()) {
            let mut poly = vec![[start.0 as f32, start.1 as f32]];
            let mut cur = first;
            let mut guard = 0;
            while cur != start && guard < count + 1 {
                poly.push([cur.0 as f32, cur.1 as f32]);
                let Some(n) = next.get_mut(&cur).and_then(|v| v.pop()) else { break };
                cur = n;
                guard += 1;
            }
            if poly.len() > best.len() {
                best = poly;
            }
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn polygon_fill_and_contains() {
        let p = Polygon { points: vec![[1.0, 1.0], [5.0, 1.0], [5.0, 4.0], [1.0, 4.0]] };
        assert!((p.area() - 12.0).abs() < 1e-5);
        assert!(p.contains([2.0, 2.0]));
        assert!(!p.contains([6.0, 2.0]));
        let mut n = 0;
        p.fill(8, 8, |_, _| n += 1);
        assert_eq!(n, 12);
    }

    #[test]
    fn trace_square_region() {
        let poly = trace_region(8, 8, |x, y| (2..5).contains(&x) && (3..6).contains(&y));
        assert_eq!(poly.len(), 12);
        let pg = Polygon { points: poly };
        assert!((pg.area() - 9.0).abs() < 1e-5);
        let simp = simplify(&pg.points, 0.1);
        assert!(simp.len() <= 5);
    }

    #[test]
    fn simplify_keeps_corners() {
        let pts: Vec<P2> = (0..10).map(|i| [i as f32, 0.0]).chain((0..10).map(|i| [10.0, i as f32])).collect();
        let k = simplify(&pts, 0.5);
        assert_eq!(k.len(), 3);
    }
}
