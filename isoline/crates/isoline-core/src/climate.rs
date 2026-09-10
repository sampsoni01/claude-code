//! Climate fields: orographic moisture and temperature.

use crate::field::ScalarField;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct ClimateParams {
    pub moisture_enabled: bool,
    /// Direction the wind blows *towards*, degrees clockwise from north.
    pub wind_deg: f32,
    /// Distance (fraction of the short edge) over which air loses ~63 % of its
    /// moisture on flat land.
    pub continentality: f32,
    /// Extra rain per unit of uplift, 0..1.
    pub orographic: f32,
    /// Elevation gain (units) that produces full orographic effect.
    pub orographic_scale: f32,
    /// Moisture carried by air entering the map.
    pub boundary_moisture: f32,
    /// Uniform moisture used when the coupling is disabled.
    pub uniform_moisture: f32,
    pub lat_north: f32,
    pub lat_south: f32,
    /// °C lost per 1000 elevation units.
    pub lapse_rate: f32,
    /// Global temperature offset in °C.
    pub temperature_offset: f32,
}

impl Default for ClimateParams {
    fn default() -> Self {
        Self {
            moisture_enabled: true,
            wind_deg: 250.0,
            continentality: 0.45,
            orographic: 0.7,
            orographic_scale: 900.0,
            boundary_moisture: 0.85,
            uniform_moisture: 0.5,
            lat_north: 62.0,
            lat_south: 22.0,
            lapse_rate: 6.5,
            temperature_offset: 0.0,
        }
    }
}

/// Precipitation field in 0..1. Air parcels advect along the wind; over sea
/// they recharge, over land they rain at a base rate plus an orographic term
/// proportional to uplift, and dry out in the lee of ranges.
///
/// The field is resampled into a wind-aligned grid so every wind line is a
/// row, rows sweep independently in parallel, and the result is resampled
/// back. Two bilinear passes cost far less than a cache-hostile diagonal walk.
pub fn moisture(elev: &ScalarField, sea_level: f32, p: &ClimateParams, cancel: &AtomicBool) -> ScalarField {
    let (w, h) = (elev.width() as usize, elev.height() as usize);
    if !p.moisture_enabled {
        return ScalarField::new(elev.width(), elev.height(), p.uniform_moisture);
    }
    let a = p.wind_deg.to_radians();
    // Wind vector in field space (y down, north = -y) and its perpendicular.
    let d = [a.sin(), -a.cos()];
    let perp = [-d[1], d[0]];
    let short = w.min(h) as f32;
    let decay_len = (p.continentality.max(0.02) * short).max(4.0);
    let base_rain = 1.0 - (-1.0 / decay_len).exp();
    let recharge = 1.0 - (-1.0 / (decay_len * 0.35)).exp();

    // Rotated grid extent: project the corners onto (d, perp).
    let cx = w as f32 * 0.5;
    let cy = h as f32 * 0.5;
    let (mut umin, mut umax, mut vmin, mut vmax) = (f32::INFINITY, f32::NEG_INFINITY, f32::INFINITY, f32::NEG_INFINITY);
    for (x, y) in [(0.0, 0.0), (w as f32, 0.0), (0.0, h as f32), (w as f32, h as f32)] {
        let rx = x - cx;
        let ry = y - cy;
        let u = rx * d[0] + ry * d[1];
        let v = rx * perp[0] + ry * perp[1];
        umin = umin.min(u);
        umax = umax.max(u);
        vmin = vmin.min(v);
        vmax = vmax.max(v);
    }
    let nu = ((umax - umin).ceil() as usize + 2).max(2);
    let nv = ((vmax - vmin).ceil() as usize + 2).max(2);
    let to_field = |u: f32, v: f32| -> [f32; 2] {
        let uu = umin + u;
        let vv = vmin + v;
        [cx + uu * d[0] + vv * perp[0], cy + uu * d[1] + vv * perp[1]]
    };
    let inside = |q: [f32; 2]| q[0] >= 0.0 && q[1] >= 0.0 && q[0] < w as f32 && q[1] < h as f32;

    // Sweep each wind line (row v) along u.
    let mut rain_rot = vec![0f32; nu * nv];
    rain_rot.par_chunks_mut(nu).enumerate().for_each(|(vi, row)| {
        if cancel.load(Ordering::Relaxed) {
            return;
        }
        let v = vi as f32 + 0.5;
        let mut m = p.boundary_moisture;
        let mut h_up = f32::NAN;
        for (ui, out) in row.iter_mut().enumerate() {
            let u = ui as f32 + 0.5;
            let q = to_field(u, v);
            if !inside(q) {
                // Off-map: air recharges slowly toward the boundary value.
                m += (p.boundary_moisture - m) * 0.02;
                h_up = f32::NAN;
                *out = 0.0;
                continue;
            }
            let hc = elev.sample(q[0], q[1]);
            let prev = if h_up.is_nan() { hc } else { h_up };
            let r;
            if hc <= sea_level {
                m += (1.0 - m) * recharge;
                r = m * base_rain;
            } else {
                let uplift = ((hc - prev.max(sea_level)) / p.orographic_scale.max(1.0)).max(0.0);
                let rate = (base_rain + p.orographic * uplift * 0.125).min(0.5);
                r = m * rate;
                let descent = ((prev - hc) / p.orographic_scale.max(1.0)).max(0.0);
                m = ((m - r) * (1.0 - 0.08 * descent.min(1.0))).max(0.0);
            }
            h_up = hc;
            *out = r;
        }
    });

    // Resample back into field space.
    let norm = 1.0 / (2.0 * base_rain);
    let rot = ScalarField::from_vec(nu as u32, nv as u32, rain_rot);
    let mut out = vec![0f32; w * h];
    out.par_chunks_mut(w).enumerate().for_each(|(y, row)| {
        for (x, o) in row.iter_mut().enumerate() {
            let rx = x as f32 + 0.5 - cx;
            let ry = y as f32 + 0.5 - cy;
            let u = rx * d[0] + ry * d[1] - umin;
            let v = rx * perp[0] + ry * perp[1] - vmin;
            *o = (rot.sample(u, v) * norm).clamp(0.0, 1.0);
        }
    });
    for _ in 0..2 {
        out = box_blur(&out, w, h);
    }
    ScalarField::from_vec(elev.width(), elev.height(), out)
}

fn box_blur(src: &[f32], w: usize, h: usize) -> Vec<f32> {
    let mut tmp = vec![0f32; w * h];
    tmp.par_chunks_mut(w).enumerate().for_each(|(y, row)| {
        let s = &src[y * w..(y + 1) * w];
        for x in 0..w {
            let a = s[x.saturating_sub(1)];
            let b = s[x];
            let c = s[(x + 1).min(w - 1)];
            row[x] = (a + b + c) / 3.0;
        }
    });
    let mut out = vec![0f32; w * h];
    out.par_chunks_mut(w).enumerate().for_each(|(y, row)| {
        let y0 = y.saturating_sub(1);
        let y1 = (y + 1).min(h - 1);
        for x in 0..w {
            row[x] = (tmp[y0 * w + x] + tmp[y * w + x] + tmp[y1 * w + x]) / 3.0;
        }
    });
    out
}

/// Temperature in °C from latitude and elevation.
pub fn temperature(elev: &ScalarField, sea_level: f32, p: &ClimateParams) -> ScalarField {
    let h = elev.height() as f32;
    let mut t = elev.clone();
    t.par_map_inplace(|_, y, e| {
        let lat = p.lat_north + (p.lat_south - p.lat_north) * ((y as f32 + 0.5) / h);
        let sea_t = 27.0 - 0.42 * lat.abs();
        let above = (e - sea_level).max(0.0);
        sea_t - p.lapse_rate * above / 1000.0 + p.temperature_offset
    });
    t
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rain_shadow_forms_leeward_of_a_ridge() {
        // Sea on the west, a north–south ridge in the middle, land east of it.
        let mut e = ScalarField::new(256, 256, 0.0);
        e.par_map_inplace(|x, _, _| {
            if x < 40 {
                -100.0
            } else if (90..110).contains(&x) {
                50.0 + (x - 90) as f32 * 125.0
            } else if (110..120).contains(&x) {
                2550.0
            } else {
                50.0
            }
        });
        let p = ClimateParams { wind_deg: 90.0, ..Default::default() };
        let m = moisture(&e, 0.0, &p, &AtomicBool::new(false));
        let windward = m.get(86, 128);
        let ridge = m.get(96, 128);
        let leeward = m.get(160, 128);
        assert!(ridge > windward, "ridge {ridge} should be wetter than plain {windward}");
        assert!(leeward < windward * 0.6, "leeward {leeward} should be much drier than windward {windward}");
        let t = temperature(&e, 0.0, &p);
        assert!(t.get(115, 128) < t.get(70, 128) - 10.0);
        assert!(t.get(70, 250) > t.get(70, 3));
    }
}
