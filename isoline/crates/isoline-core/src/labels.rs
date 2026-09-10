//! Label geometry: where a label's baseline runs, in field coordinates.
//! Text measurement, collision and drawing live in the app (they need
//! fonts); this module only produces candidate baselines.

use crate::entity::{Entity, EntityRef, LabelOverride};
use crate::geometry::{self, P2};

/// A baseline the text is laid along, as a polyline in field texels.
#[derive(Clone, Debug)]
pub struct Baseline {
    pub points: Vec<P2>,
    /// Cumulative arc length per point.
    pub arc: Vec<f32>,
}

impl Baseline {
    pub fn new(points: Vec<P2>) -> Self {
        let arc = geometry::arc_lengths(&points);
        Self { points, arc }
    }
    pub fn length(&self) -> f32 {
        *self.arc.last().unwrap_or(&0.0)
    }
    /// Position and unit tangent at arc length `s`.
    pub fn at(&self, s: f32) -> (P2, P2) {
        let n = self.points.len();
        if n == 0 {
            return ([0.0, 0.0], [1.0, 0.0]);
        }
        if n == 1 {
            return (self.points[0], [1.0, 0.0]);
        }
        let s = s.clamp(0.0, self.length());
        let mut i = 0;
        while i + 2 < n && self.arc[i + 1] < s {
            i += 1;
        }
        let a = self.points[i];
        let b = self.points[i + 1];
        let seg = (self.arc[i + 1] - self.arc[i]).max(1e-6);
        let t = ((s - self.arc[i]) / seg).clamp(0.0, 1.0);
        let d = geometry::sub(b, a);
        let l = geometry::len(d).max(1e-6);
        (geometry::lerp(a, b, t), [d[0] / l, d[1] / l])
    }
    /// Reverse direction (so text reads left to right on screen).
    pub fn reversed(&self) -> Baseline {
        let mut p = self.points.clone();
        p.reverse();
        Baseline::new(p)
    }
    /// Offset every point perpendicular to the local tangent by `d` texels.
    pub fn offset(&self, d: f32) -> Baseline {
        let n = self.points.len();
        let mut out = Vec::with_capacity(n);
        for i in 0..n {
            let (_, t) = self.at(self.arc[i].min(self.length() - 1e-3).max(0.0));
            let nrm = [-t[1], t[0]];
            out.push([self.points[i][0] + nrm[0] * d, self.points[i][1] + nrm[1] * d]);
        }
        Baseline::new(out)
    }
    /// Extend both ends along their tangents so the baseline is at least
    /// `min_len` long (text longer than its feature still lays out).
    pub fn extended_to(&self, min_len: f32) -> Baseline {
        let cur = self.length();
        if cur >= min_len || self.points.len() < 2 {
            return self.clone();
        }
        let extra = (min_len - cur) * 0.5 + 1.0;
        let (p0, t0) = self.at(0.0);
        let (p1, t1) = self.at(cur);
        let mut pts = Vec::with_capacity(self.points.len() + 2);
        pts.push([p0[0] - t0[0] * extra, p0[1] - t0[1] * extra]);
        pts.extend(self.points.iter().copied());
        pts.push([p1[0] + t1[0] * extra, p1[1] + t1[1] * extra]);
        Baseline::new(pts)
    }

    /// Net direction of travel on screen (x right, y down).
    pub fn reads_backwards(&self) -> bool {
        match (self.points.first(), self.points.last()) {
            (Some(a), Some(b)) => b[0] < a[0],
            _ => false,
        }
    }
}

/// An arc of chord length `width` centred at `c`, bending by `curvature`
/// (-1..1; positive bows upward on screen).
pub fn arc_baseline(c: P2, width: f32, curvature: f32, angle: f32) -> Baseline {
    let n = 24;
    let sag = -curvature * width * 0.22;
    let (s, co) = angle.sin_cos();
    let pts: Vec<P2> = (0..=n)
        .map(|i| {
            let t = i as f32 / n as f32 - 0.5;
            let x = t * width;
            let y = sag * (1.0 - 4.0 * t * t);
            [c[0] + x * co - y * s, c[1] + x * s + y * co]
        })
        .collect();
    Baseline::new(pts)
}

/// Smooth a path for lettering: resample at `step`, then average.
pub fn smooth_path(points: &[P2], step: f32) -> Vec<P2> {
    if points.len() < 2 {
        return points.to_vec();
    }
    let base = Baseline::new(points.to_vec());
    let n = ((base.length() / step.max(1.0)).ceil() as usize).max(2);
    let mut pts: Vec<P2> = (0..=n).map(|i| base.at(base.length() * i as f32 / n as f32).0).collect();
    for _ in 0..3 {
        let prev = pts.clone();
        for i in 1..pts.len() - 1 {
            pts[i] = [(prev[i - 1][0] + 2.0 * prev[i][0] + prev[i + 1][0]) / 4.0, (prev[i - 1][1] + 2.0 * prev[i][1] + prev[i + 1][1]) / 4.0];
        }
    }
    pts
}

/// Pick the straightest stretch of a path of about `want` texels for a label.
pub fn straightest_window(points: &[P2], want: f32) -> Vec<P2> {
    let base = Baseline::new(points.to_vec());
    let total = base.length();
    if total <= want * 1.05 {
        return points.to_vec();
    }
    let steps = 24;
    let mut best_s = 0.0;
    let mut best_score = f32::NEG_INFINITY;
    for i in 0..=steps {
        let s0 = (total - want) * i as f32 / steps as f32;
        // Score: how close the chord is to the arc length (straightness), and
        // prefer the middle of the feature.
        let (a, _) = base.at(s0);
        let (b, _) = base.at(s0 + want);
        let chord = geometry::len(geometry::sub(b, a));
        let mid_pref = 1.0 - ((s0 + want * 0.5) / total - 0.5).abs();
        let score = chord / want + 0.15 * mid_pref;
        if score > best_score {
            best_score = score;
            best_s = s0;
        }
    }
    let n = 16;
    (0..=n).map(|i| base.at(best_s + want * i as f32 / n as f32).0).collect()
}

/// Shift a baseline so it stays inside `[0, w] × [0, h]` where possible.
pub fn clamp_to_field(b: Baseline, w: f32, h: f32) -> Baseline {
    let (mut lo, mut hi) = ([f32::INFINITY; 2], [f32::NEG_INFINITY; 2]);
    for p in &b.points {
        lo[0] = lo[0].min(p[0]);
        lo[1] = lo[1].min(p[1]);
        hi[0] = hi[0].max(p[0]);
        hi[1] = hi[1].max(p[1]);
    }
    let margin = 8.0;
    let mut dx = 0.0;
    let mut dy = 0.0;
    if lo[0] < margin {
        dx = margin - lo[0];
    } else if hi[0] > w - margin {
        dx = (w - margin) - hi[0];
    }
    if lo[1] < margin {
        dy = margin - lo[1];
    } else if hi[1] > h - margin {
        dy = (h - margin) - hi[1];
    }
    if dx == 0.0 && dy == 0.0 {
        return b;
    }
    Baseline::new(b.points.into_iter().map(|p| [p[0] + dx, p[1] + dy]).collect())
}

/// Baseline for an entity's label given the text's approximate length in
/// texels. Point labels return a straight baseline beside the anchor.
pub fn baseline_for(e: &Entity, text_len_texels: f32, text_height_texels: f32, symbol_half_height: f32) -> Baseline {
    let o: &LabelOverride = &e.label;
    let mut b = match &e.geometry {
        EntityRef::Point(p) | EntityRef::Placement { pos: p, .. } => {
            // Just below the anchor (symbols anchor at their base).
            let x0 = p[0];
            let y = p[1] + text_height_texels * 1.05 + symbol_half_height * 0.05;
            let s = o.angle.sin();
            let c = o.angle.cos();
            let half = text_len_texels * 0.5;
            Baseline::new(vec![[x0 - half * c, y - half * s], [x0 + half * c, y + half * s]])
        }
        EntityRef::Path(pts) => {
            let want = text_len_texels * 1.15;
            let window = straightest_window(pts, want);
            let sm = smooth_path(&window, 4.0);
            let mut b = Baseline::new(sm);
            if b.reads_backwards() {
                b = b.reversed();
            }
            b.extended_to(want)
        }
        EntityRef::Polygon(pg) => {
            let c = e.geometry.anchor();
            let (lo, hi) = pg.bbox();
            let w = (hi[0] - lo[0]).max(text_len_texels);
            arc_baseline(c, w.max(text_len_texels * 1.1), 0.25 + o.curvature, o.angle)
        }
        EntityRef::Area { center, radius } => arc_baseline(*center, (radius * 1.6).max(text_len_texels * 1.1), 0.35 + o.curvature, o.angle),
    };
    if o.offset != [0.0, 0.0] {
        for p in b.points.iter_mut() {
            p[0] += o.offset[0];
            p[1] += o.offset[1];
        }
        b = Baseline::new(b.points);
    }
    b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn baseline_walks_and_reverses() {
        let b = Baseline::new(vec![[0.0, 0.0], [10.0, 0.0], [10.0, 10.0]]);
        assert!((b.length() - 20.0).abs() < 1e-5);
        let (p, t) = b.at(15.0);
        assert!((p[0] - 10.0).abs() < 1e-5 && (p[1] - 5.0).abs() < 1e-5);
        assert!((t[1] - 1.0).abs() < 1e-5);
        let r = b.reversed();
        assert_eq!(r.points[0], [10.0, 10.0]);
        assert!(Baseline::new(vec![[10.0, 0.0], [0.0, 0.0]]).reads_backwards());
    }

    #[test]
    fn straightest_window_prefers_straight_part() {
        let mut pts: Vec<P2> = (0..20).map(|i| [i as f32 * 10.0, (i as f32 * 0.9).sin() * 30.0]).collect();
        pts.extend((0..20).map(|i| [200.0 + i as f32 * 10.0, 0.0]));
        let w = straightest_window(&pts, 100.0);
        assert!(w[0][0] >= 150.0, "window starts at {:?}", w[0]);
    }
}
