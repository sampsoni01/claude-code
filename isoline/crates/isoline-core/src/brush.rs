//! Brush pipeline: stroke sampling → falloff kernel → blend mode.
//!
//! The [`Dab`] struct and the kernel math here are mirrored exactly by
//! `brush.wgsl` in the app crate. [`apply_dabs`] is the CPU reference
//! implementation; the app uses it in headless mode and in tests to validate
//! that GPU results and the CPU mirror agree after readback.

use crate::field::ScalarField;
use crate::tiles::PixelRect;
use bytemuck::{Pod, Zeroable};
use glam::Vec2;
use serde::{Deserialize, Serialize};

/// How a dab combines with the field. Discriminants are shared with WGSL.
#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum BlendMode {
    /// `h += w * strength` (negative strength lowers).
    Add = 0,
    /// `h -= w * strength`.
    Subtract = 1,
    /// `h = mix(h, target, w * strength)`.
    Set = 2,
    /// `h = mix(h, min(h, target), w * strength)`.
    Min = 3,
    /// `h = mix(h, max(h, target), w * strength)`.
    Max = 4,
    /// `h = mix(h, blur3x3(h), w * strength)`.
    Smooth = 5,
}

/// Radial falloff shape. Discriminants are shared with WGSL.
#[repr(u32)]
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Falloff {
    Smooth = 0,
    Linear = 1,
    Gaussian = 2,
    Flat = 3,
}

impl Falloff {
    pub const ALL: [Falloff; 4] = [Falloff::Smooth, Falloff::Linear, Falloff::Gaussian, Falloff::Flat];
    pub fn label(self) -> &'static str {
        match self {
            Falloff::Smooth => "Smooth",
            Falloff::Linear => "Linear",
            Falloff::Gaussian => "Gaussian",
            Falloff::Flat => "Flat",
        }
    }
}

/// One brush sample. 32 bytes, `repr(C)`, uploaded verbatim to the GPU.
#[repr(C)]
#[derive(Clone, Copy, Debug, Pod, Zeroable, PartialEq)]
pub struct Dab {
    /// Centre in field pixels.
    pub pos: [f32; 2],
    /// Radius in field pixels.
    pub radius: f32,
    /// Blend strength: elevation units for Add/Subtract, a 0..1 mix factor otherwise.
    pub strength: f32,
    /// 0 = fully soft, 1 = hard-edged disc.
    pub hardness: f32,
    /// Target value for Set/Min/Max.
    pub target: f32,
    pub mode: u32,
    pub falloff: u32,
}

impl Dab {
    pub fn rect(&self, width: u32, height: u32) -> PixelRect {
        PixelRect::around(self.pos[0], self.pos[1], self.radius, width, height)
    }
}

/// Radial kernel weight in [0, 1] for a normalised distance `d = dist / radius`.
/// Mirrors `kernel_weight` in `brush.wgsl`.
pub fn kernel_weight(d: f32, hardness: f32, falloff: Falloff) -> f32 {
    if d >= 1.0 {
        return 0.0;
    }
    let soft = (1.0 - hardness).max(1e-3);
    let t = ((1.0 - d) / soft).clamp(0.0, 1.0);
    match falloff {
        Falloff::Smooth => t * t * (3.0 - 2.0 * t),
        Falloff::Linear => t,
        Falloff::Gaussian => {
            let u = (1.0 - t) * 3.0;
            let g = (-0.5 * u * u).exp();
            const G0: f32 = 0.011_108_996; // exp(-4.5)
            (g - G0) / (1.0 - G0)
        }
        Falloff::Flat => 1.0,
    }
}

/// CPU reference for one batch of dabs. Semantics match one GPU dispatch:
/// the neighbourhood used by `Smooth` is the state *before* the batch.
pub fn apply_dabs(field: &mut ScalarField, dabs: &[Dab]) -> PixelRect {
    let (w, h) = (field.width(), field.height());
    let mut rect = PixelRect::EMPTY;
    for d in dabs {
        rect = rect.union(&d.rect(w, h));
    }
    if rect.is_empty() {
        return rect;
    }
    let needs_src = dabs.iter().any(|d| d.mode == BlendMode::Smooth as u32);
    let src_rect = rect.dilate(1, w, h);
    let src = if needs_src { Some((src_rect, field.read_rect(&src_rect))) } else { None };
    let src_at = |x: i64, y: i64| -> f32 {
        let (r, buf) = src.as_ref().unwrap();
        let xx = x.clamp(r.x0 as i64, r.x1 as i64 - 1) as usize - r.x0 as usize;
        let yy = y.clamp(r.y0 as i64, r.y1 as i64 - 1) as usize - r.y0 as usize;
        buf[yy * r.width() as usize + xx]
    };

    for y in rect.y0..rect.y1 {
        for x in rect.x0..rect.x1 {
            let px = x as f32 + 0.5;
            let py = y as f32 + 0.5;
            let mut v = field.get(x, y);
            for d in dabs {
                let dx = px - d.pos[0];
                let dy = py - d.pos[1];
                let dist = (dx * dx + dy * dy).sqrt() / d.radius.max(1e-3);
                let falloff = match d.falloff {
                    0 => Falloff::Smooth,
                    1 => Falloff::Linear,
                    2 => Falloff::Gaussian,
                    _ => Falloff::Flat,
                };
                let wgt = kernel_weight(dist, d.hardness, falloff);
                if wgt <= 0.0 {
                    continue;
                }
                v = blend(v, wgt, d, || {
                    let (x, y) = (x as i64, y as i64);
                    let mut s = 0.0;
                    for oy in -1..=1 {
                        for ox in -1..=1 {
                            s += src_at(x + ox, y + oy);
                        }
                    }
                    s / 9.0
                });
            }
            field.set(x, y, v);
        }
    }
    rect
}

#[inline]
fn blend(v: f32, w: f32, d: &Dab, blur: impl FnOnce() -> f32) -> f32 {
    match d.mode {
        0 => v + w * d.strength,
        1 => v - w * d.strength,
        2 => v + (d.target - v) * (w * d.strength).clamp(0.0, 1.0),
        3 => v + (v.min(d.target) - v) * (w * d.strength).clamp(0.0, 1.0),
        4 => v + (v.max(d.target) - v) * (w * d.strength).clamp(0.0, 1.0),
        _ => {
            let b = blur();
            v + (b - v) * (w * d.strength).clamp(0.0, 1.0)
        }
    }
}

/// User-facing brush settings shared by all field brushes.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BrushSettings {
    /// Radius in field pixels.
    pub radius: f32,
    /// 0..1 user strength. Scaled by `amount` for Add/Subtract.
    pub strength: f32,
    /// Elevation units applied per dab at strength 1 (Add/Subtract only).
    pub amount: f32,
    pub hardness: f32,
    pub falloff: Falloff,
    /// Dab spacing as a fraction of radius.
    pub spacing: f32,
    /// 0 = raw input, 1 = heavy stroke smoothing.
    pub smoothing: f32,
    /// Random dab offset as a fraction of radius.
    pub scatter: f32,
    pub pressure_size: bool,
    pub pressure_strength: bool,
    /// 0 = ignore velocity, 1 = fast strokes fade to nothing.
    pub velocity_influence: f32,
}

impl Default for BrushSettings {
    fn default() -> Self {
        Self {
            radius: 48.0,
            strength: 0.5,
            amount: 60.0,
            hardness: 0.25,
            falloff: Falloff::Smooth,
            spacing: 0.2,
            smoothing: 0.35,
            scatter: 0.0,
            pressure_size: false,
            pressure_strength: true,
            velocity_influence: 0.0,
        }
    }
}

/// A raw pointer sample in field coordinates.
#[derive(Clone, Copy, Debug)]
pub struct StrokeInput {
    pub pos: Vec2,
    /// 0..1, 1.0 for devices without pressure.
    pub pressure: f32,
    /// Tilt in radians (x, y); zero when unavailable.
    pub tilt: Vec2,
    pub time: f64,
}

/// Turns a sequence of pointer samples into evenly spaced dabs, with
/// exponential path smoothing, spacing, scatter and pressure/velocity dynamics.
pub struct StrokeSampler {
    settings: BrushSettings,
    mode: BlendMode,
    target: f32,
    filtered: Vec2,
    last_emit: Vec2,
    last_input: StrokeInput,
    started: bool,
    rng: u64,
    total_length: f32,
    dab_count: u32,
}

impl StrokeSampler {
    pub fn new(settings: BrushSettings, mode: BlendMode, target: f32, seed: u64) -> Self {
        Self {
            settings,
            mode,
            target,
            filtered: Vec2::ZERO,
            last_emit: Vec2::ZERO,
            last_input: StrokeInput { pos: Vec2::ZERO, pressure: 1.0, tilt: Vec2::ZERO, time: 0.0 },
            started: false,
            rng: seed | 1,
            total_length: 0.0,
            dab_count: 0,
        }
    }

    pub fn dab_count(&self) -> u32 {
        self.dab_count
    }
    pub fn total_length(&self) -> f32 {
        self.total_length
    }

    fn rand(&mut self) -> f32 {
        // xorshift64*
        self.rng ^= self.rng >> 12;
        self.rng ^= self.rng << 25;
        self.rng ^= self.rng >> 27;
        ((self.rng.wrapping_mul(0x2545F4914F6CDD1D) >> 40) as f32) / (1u64 << 24) as f32
    }

    fn make_dab(&mut self, pos: Vec2, pressure: f32, speed: f32) -> Dab {
        let s = self.settings.clone();
        let mut radius = s.radius;
        if s.pressure_size {
            radius *= 0.2 + 0.8 * pressure;
        }
        let mut strength = s.strength;
        if s.pressure_strength {
            strength *= pressure;
        }
        if s.velocity_influence > 0.0 {
            // 2000 px/s counts as "fast".
            let f = (1.0 - speed / 2000.0).clamp(0.0, 1.0);
            strength *= 1.0 - s.velocity_influence * (1.0 - f);
        }
        let strength = match self.mode {
            BlendMode::Add | BlendMode::Subtract => strength * s.amount,
            _ => strength,
        };
        let mut p = pos;
        if s.scatter > 0.0 {
            let a = self.rand() * std::f32::consts::TAU;
            let r = self.rand().sqrt() * s.scatter * s.radius;
            p += Vec2::new(a.cos(), a.sin()) * r;
        }
        self.dab_count += 1;
        Dab {
            pos: p.to_array(),
            radius: radius.max(0.5),
            strength,
            hardness: s.hardness,
            target: self.target,
            mode: self.mode as u32,
            falloff: s.falloff as u32,
        }
    }

    /// Feed a pointer sample; returns the dabs to apply (possibly none).
    pub fn feed(&mut self, input: StrokeInput) -> Vec<Dab> {
        let mut out = Vec::new();
        if !self.started {
            self.started = true;
            self.filtered = input.pos;
            self.last_emit = input.pos;
            self.last_input = input;
            let d = self.make_dab(input.pos, input.pressure, 0.0);
            out.push(d);
            return out;
        }
        let dt = (input.time - self.last_input.time).max(1e-4) as f32;
        let speed = (input.pos - self.last_input.pos).length() / dt;
        // Exponential smoothing; alpha shrinks as smoothing grows.
        let alpha = 1.0 - self.settings.smoothing.clamp(0.0, 0.95);
        self.filtered += (input.pos - self.filtered) * alpha;

        let spacing = (self.settings.spacing.max(0.02) * self.settings.radius).max(0.5);
        let mut from = self.last_emit;
        let to = self.filtered;
        let seg = to - from;
        let len = seg.length();
        if len >= spacing {
            let dir = seg / len;
            let n = (len / spacing).floor() as u32;
            let start = from;
            for i in 1..=n {
                let p = start + dir * (spacing * i as f32);
                let t = i as f32 / n as f32;
                let pressure = self.last_input.pressure + (input.pressure - self.last_input.pressure) * t;
                out.push(self.make_dab(p, pressure, speed));
                from = p;
            }
            self.total_length += spacing * n as f32;
            self.last_emit = from;
        }
        self.last_input = input;
        out
    }

    /// Flush the remainder of the smoothed path at stroke end.
    pub fn finish(&mut self) -> Vec<Dab> {
        if !self.started {
            return Vec::new();
        }
        let target = self.last_input.pos;
        self.settings.smoothing = 0.0;
        let mut out = self.feed(StrokeInput { time: self.last_input.time + 0.001, ..self.last_input });
        // Ensure the very last position gets a dab if the stroke was short.
        if (self.last_emit - target).length() > 0.25 * self.settings.spacing * self.settings.radius {
            let pressure = self.last_input.pressure;
            let d = self.make_dab(target, pressure, 0.0);
            out.push(d);
            self.last_emit = target;
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kernel_is_monotone_and_bounded() {
        for f in Falloff::ALL {
            let mut prev = 2.0;
            for i in 0..=50 {
                let d = i as f32 / 50.0;
                let w = kernel_weight(d, 0.3, f);
                assert!((0.0..=1.0).contains(&w), "{f:?} {d} {w}");
                assert!(w <= prev + 1e-6, "{f:?} not monotone at {d}");
                prev = w;
            }
            assert_eq!(kernel_weight(1.0, 0.3, f), 0.0);
            assert!((kernel_weight(0.0, 0.3, f) - 1.0).abs() < 1e-6);
        }
    }

    #[test]
    fn add_then_subtract_round_trips() {
        let mut f = ScalarField::new(128, 128, 100.0);
        let up = Dab { pos: [64.0, 64.0], radius: 20.0, strength: 10.0, hardness: 0.5, target: 0.0, mode: 0, falloff: 0 };
        let down = Dab { mode: 1, ..up };
        apply_dabs(&mut f, &[up]);
        assert!((f.get(64, 64) - 110.0).abs() < 1e-4);
        assert_eq!(f.get(0, 0), 100.0);
        apply_dabs(&mut f, &[down]);
        for v in f.data() {
            assert!((v - 100.0).abs() < 1e-4);
        }
    }

    #[test]
    fn smooth_reduces_variance() {
        let mut f = ScalarField::new(64, 64, 0.0);
        f.par_map_inplace(|x, y, _| if (x + y) % 2 == 0 { 1.0 } else { -1.0 });
        let d = Dab { pos: [32.0, 32.0], radius: 10.0, strength: 1.0, hardness: 1.0, target: 0.0, mode: 5, falloff: 3 };
        apply_dabs(&mut f, &[d]);
        assert!(f.get(32, 32).abs() < 0.2);
        assert_eq!(f.get(0, 0).abs(), 1.0);
    }

    #[test]
    fn sampler_spacing() {
        let s = BrushSettings { radius: 10.0, spacing: 0.5, smoothing: 0.0, ..Default::default() };
        let mut samp = StrokeSampler::new(s, BlendMode::Add, 0.0, 1);
        let a = samp.feed(StrokeInput { pos: Vec2::new(0.0, 0.0), pressure: 1.0, tilt: Vec2::ZERO, time: 0.0 });
        assert_eq!(a.len(), 1);
        let b = samp.feed(StrokeInput { pos: Vec2::new(50.0, 0.0), pressure: 1.0, tilt: Vec2::ZERO, time: 0.1 });
        assert_eq!(b.len(), 10);
        assert!((b[9].pos[0] - 50.0).abs() < 1e-4);
        let c = samp.finish();
        assert!(c.is_empty());
    }
}
