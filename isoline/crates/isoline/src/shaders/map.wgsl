// Map view: a full-screen pass that samples the live elevation field and
// derives relief, the sea-level isoline coastline, water and the theme's
// paper, ink and hatching per pixel. Nothing here is cached: change the
// field, the sea level or the theme and the next frame shows it.

struct View {
    screen_size: vec2<f32>,
    field_size: vec2<f32>,
    origin: vec2<f32>,      // field coords at screen pixel (0, 0)
    scale: f32,             // screen px per field texel
    sea_level: f32,
    sun_dir: vec3<f32>,
    exaggeration: f32,
    shade_strength: f32,
    contour_interval: f32,
    coast_width: f32,
    flags: u32,
    cursor: vec2<f32>,
    cursor_radius: f32,
    meters_per_texel: f32,
    elev_min: f32,
    elev_max: f32,
    time: f32,
    view_mode: u32,
    temp_min: f32,
    temp_max: f32,
    _pad_a: vec2<f32>,
    moist_scale: vec2<f32>,
    temp_scale: vec2<f32>,
    // Theme.
    paper: vec3<f32>,
    theme_style: u32,
    paper_dark: vec3<f32>,
    relief_style: u32,
    ink: vec3<f32>,
    forest_style: u32,
    sea_fill: vec3<f32>,
    coast_rings: u32,
    sea_ink: vec3<f32>,
    land_tint: f32,
    river_ink: vec3<f32>,
    paper_grain: f32,
    forest_fill: vec3<f32>,
    vignette: f32,
    ring_spacing: f32,
    hatch_strength: f32,
    hatch_spacing: f32,
    forest_scale: f32,
    forest_threshold: f32,
    _pad_b: vec3<f32>,
    palette: array<vec4<f32>, 16>,
};

const FLAG_CONTOURS: u32 = 1u;
const FLAG_CURSOR: u32 = 2u;
const FLAG_HYPSO: u32 = 4u;
const FLAG_WATER: u32 = 8u;
const FLAG_HAS_DERIVED: u32 = 16u;

const MODE_MAP: u32 = 0u;
const MODE_HYPSO: u32 = 1u;
const MODE_BIOME_FLAT: u32 = 2u;
const MODE_MOISTURE: u32 = 3u;
const MODE_TEMPERATURE: u32 = 4u;

const STYLE_MODERN: u32 = 0u;
const STYLE_INK: u32 = 1u;
const STYLE_ILLUMINATED: u32 = 2u;

const RELIEF_SHADED: u32 = 0u;
const RELIEF_HATCHED: u32 = 1u;
const RELIEF_BOTH: u32 = 2u;

const FOREST_NONE: u32 = 0u;
const FOREST_CLUMPS: u32 = 1u;
const FOREST_STIPPLE: u32 = 2u;

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var elev: texture_2d<f32>;
@group(0) @binding(2) var water_tex: texture_2d<f32>;
@group(0) @binding(3) var moist_tex: texture_2d<f32>;
@group(0) @binding(4) var temp_tex: texture_2d<f32>;
@group(0) @binding(5) var biome_tex: texture_2d<f32>;
@group(0) @binding(6) var forest_tex: texture_2d<f32>;

struct VsOut {
    @builtin(position) pos: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
    var out: VsOut;
    let x = f32(i32(vi & 1u) * 4 - 1);
    let y = f32(i32(vi >> 1u) * 4 - 1);
    out.pos = vec4<f32>(x, y, 0.0, 1.0);
    return out;
}

// ---- sampling -------------------------------------------------------------

fn clampc(p: vec2<i32>) -> vec2<i32> {
    return clamp(p, vec2<i32>(0), vec2<i32>(view.field_size) - vec2<i32>(1));
}

fn load(p: vec2<i32>) -> f32 {
    return textureLoad(elev, clampc(p), 0).r;
}

fn sample(fp: vec2<f32>) -> f32 {
    let f = fp - vec2<f32>(0.5);
    let i = floor(f);
    let t = f - i;
    let p = vec2<i32>(i);
    let a = load(p);
    let b = load(p + vec2<i32>(1, 0));
    let c = load(p + vec2<i32>(0, 1));
    let d = load(p + vec2<i32>(1, 1));
    return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}

fn sample_aa(fp: vec2<f32>) -> f32 {
    if view.scale >= 0.75 {
        return sample(fp);
    }
    let o = 0.25 / view.scale;
    return 0.25 * (sample(fp + vec2<f32>(-o, -o)) + sample(fp + vec2<f32>(o, -o))
                 + sample(fp + vec2<f32>(-o, o)) + sample(fp + vec2<f32>(o, o)));
}

fn bilinear_of(tex: texture_2d<f32>, fp: vec2<f32>, scale: vec2<f32>) -> f32 {
    let dims = vec2<i32>(textureDimensions(tex));
    let f = fp * scale - vec2<f32>(0.5);
    let i = floor(f);
    let t = f - i;
    let p = vec2<i32>(i);
    let lo = vec2<i32>(0);
    let hi = dims - vec2<i32>(1);
    let a = textureLoad(tex, clamp(p, lo, hi), 0).r;
    let b = textureLoad(tex, clamp(p + vec2<i32>(1, 0), lo, hi), 0).r;
    let c = textureLoad(tex, clamp(p + vec2<i32>(0, 1), lo, hi), 0).r;
    let d = textureLoad(tex, clamp(p + vec2<i32>(1, 1), lo, hi), 0).r;
    return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}

fn normal_at(fp: vec2<f32>) -> vec3<f32> {
    let e = max(1.0, 1.0 / view.scale);
    let hx = sample_aa(fp + vec2<f32>(e, 0.0)) - sample_aa(fp - vec2<f32>(e, 0.0));
    let hy = sample_aa(fp + vec2<f32>(0.0, e)) - sample_aa(fp - vec2<f32>(0.0, e));
    let run = 2.0 * e * view.meters_per_texel;
    let dx = hx / run * view.exaggeration;
    let dy = hy / run * view.exaggeration;
    return normalize(vec3<f32>(-dx, -dy, 1.0));
}

// ---- noise ----------------------------------------------------------------

fn hash21(p: vec2<f32>) -> f32 {
    var q = fract(p * vec2<f32>(123.34, 456.21));
    q += dot(q, q + 45.32);
    return fract(q.x * q.y);
}

fn hash22(p: vec2<f32>) -> vec2<f32> {
    let h = hash21(p);
    return vec2<f32>(h, hash21(p + vec2<f32>(h, 7.13)));
}

fn vnoise(p: vec2<f32>) -> f32 {
    let i = floor(p);
    let f = fract(p);
    let u = f * f * (3.0 - 2.0 * f);
    let a = hash21(i);
    let b = hash21(i + vec2<f32>(1.0, 0.0));
    let c = hash21(i + vec2<f32>(0.0, 1.0));
    let d = hash21(i + vec2<f32>(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// ---- palettes -------------------------------------------------------------

fn hypso(t: f32) -> vec3<f32> {
    let c0 = vec3<f32>(0.53, 0.66, 0.42);
    let c1 = vec3<f32>(0.78, 0.76, 0.52);
    let c2 = vec3<f32>(0.62, 0.50, 0.36);
    let c3 = vec3<f32>(0.60, 0.58, 0.56);
    let c4 = vec3<f32>(0.96, 0.96, 0.97);
    if t < 0.15 { return mix(c0, c1, t / 0.15); }
    if t < 0.40 { return mix(c1, c2, (t - 0.15) / 0.25); }
    if t < 0.75 { return mix(c2, c3, (t - 0.40) / 0.35); }
    return mix(c3, c4, (t - 0.75) / 0.25);
}

fn ramp_moisture(m: f32) -> vec3<f32> {
    let dry = vec3<f32>(0.85, 0.72, 0.45);
    let mid = vec3<f32>(0.55, 0.70, 0.45);
    let wet = vec3<f32>(0.10, 0.35, 0.55);
    if m < 0.5 { return mix(dry, mid, m * 2.0); }
    return mix(mid, wet, (m - 0.5) * 2.0);
}

fn ramp_temperature(t: f32) -> vec3<f32> {
    let cold = vec3<f32>(0.20, 0.30, 0.75);
    let mild = vec3<f32>(0.90, 0.90, 0.80);
    let hot = vec3<f32>(0.80, 0.20, 0.15);
    if t < 0.5 { return mix(cold, mild, t * 2.0); }
    return mix(mild, hot, (t - 0.5) * 2.0);
}

// Paper with grain, darkened toward the map edges.
fn paper_at(sp: vec2<f32>, fp: vec2<f32>) -> vec3<f32> {
    var col = view.paper;
    if view.paper_grain > 0.0 {
        let g = vnoise(fp * 0.35) * 0.6 + vnoise(fp * 1.7) * 0.25 + vnoise(sp * 0.9) * 0.15;
        let blotch = vnoise(fp * 0.02 + vec2<f32>(3.1, 7.7));
        col = mix(col, view.paper_dark, view.paper_grain * (0.55 * (g - 0.5) + 0.35 * (blotch - 0.5)) + 0.5 * view.paper_grain * 0.0);
        col = mix(col, view.paper_dark, view.paper_grain * 0.25 * (blotch - 0.35));
    }
    if view.vignette > 0.0 {
        let uv = fp / view.field_size;
        let d = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
        let edge = 1.0 - smoothstep(0.0, 0.16, d);
        let burn = edge * edge * (0.7 + 0.3 * vnoise(fp * 0.05));
        col = mix(col, view.paper_dark * 0.8, view.vignette * burn);
    }
    return col;
}

// Engraving hatching: lines that thicken with darkness.
fn hatch(sp: vec2<f32>, darkness: f32) -> f32 {
    let s = max(view.hatch_spacing, 2.0);
    let d = clamp(darkness, 0.0, 1.0);
    // Primary diagonal lines.
    let l1 = fract((sp.x + sp.y) / (s * 1.4142));
    let w1 = clamp((d - 0.18) / 0.55, 0.0, 0.9);
    let h1 = smoothstep(w1, w1 - 0.18, abs(l1 - 0.5) * 2.0 - (1.0 - w1)) * step(0.001, w1);
    // Cross-hatch in deep shadow.
    let l2 = fract((sp.x - sp.y) / (s * 1.4142));
    let w2 = clamp((d - 0.55) / 0.45, 0.0, 0.8);
    let h2 = smoothstep(w2, w2 - 0.18, abs(l2 - 0.5) * 2.0 - (1.0 - w2)) * step(0.001, w2);
    return max(h1, h2);
}

// Hand-drawn tree clumps from the forest-density field. Returns (coverage, outline).
fn forest_marks(fp: vec2<f32>, ti: vec2<i32>) -> vec2<f32> {
    // Clumps live in field space but never shrink below ~11 px on screen.
    let fs = max(view.forest_scale, 11.0 / view.scale);
    var cover = 0.0;
    var outline = 0.0;
    let cell = floor(fp / fs);
    for (var oy = -1; oy <= 1; oy++) {
        for (var ox = -1; ox <= 1; ox++) {
            let c = cell + vec2<f32>(f32(ox), f32(oy));
            let j = hash22(c);
            let centre = (c + 0.2 + 0.6 * j) * fs;
            let ci = clampc(vec2<i32>(centre));
            let dens = textureLoad(forest_tex, ci, 0).r;
            let hc = textureLoad(elev, ci, 0).r;
            if hc <= view.sea_level { continue; }
            let thr = view.forest_threshold + 0.5 * hash21(c + 11.0);
            if dens < thr { continue; }
            let r = fs * (0.32 + 0.16 * hash21(c + 3.0));
            let d = length(fp - centre);
            // Screen-space AA width in field units.
            let aa = 1.2 / view.scale;
            if view.forest_style == FOREST_STIPPLE {
                let rr = r * 0.35;
                cover = max(cover, 1.0 - smoothstep(rr - aa, rr + aa, d));
                continue;
            }
            // Bumpy canopy: radius wobbles with angle.
            let ang = atan2(fp.y - centre.y, fp.x - centre.x);
            let wob = r * (1.0 + 0.16 * sin(ang * 5.0 + j.x * 6.28) + 0.08 * sin(ang * 9.0 + j.y * 6.28));
            let fill = 1.0 - smoothstep(wob - aa, wob + aa, d);
            cover = max(cover, fill);
            // Ink outline, strongest on the lower (shadow) side.
            let lw = 0.9 / view.scale;
            let ring = 1.0 - smoothstep(0.0, lw + aa, abs(d - wob));
            let below = 0.55 + 0.45 * clamp((fp.y - centre.y) / max(r, 1e-3), -1.0, 1.0);
            outline = max(outline, ring * below);
        }
    }
    return vec2<f32>(cover, outline);
}

fn isoline(v: f32, width: f32) -> f32 {
    let aa = max(fwidth(v), 1e-4);
    return 1.0 - smoothstep(0.0, aa * width, abs(v));
}

// ---- fragment -------------------------------------------------------------

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let sp = in.pos.xy;
    let fp = view.origin + sp / view.scale;
    let fantasy = view.theme_style != STYLE_MODERN;
    let desk = mix(view.paper_dark, vec3<f32>(0.18, 0.15, 0.12), 0.75);

    if fp.x < 0.0 || fp.y < 0.0 || fp.x >= view.field_size.x || fp.y >= view.field_size.y {
        // Outside the sheet: a dark desk with a soft shadow under the map edge.
        let d = max(max(-fp.x, fp.x - view.field_size.x), max(-fp.y, fp.y - view.field_size.y)) * view.scale;
        let s = 1.0 - 0.35 * (1.0 - smoothstep(0.0, 18.0, d));
        return vec4<f32>(desk * s, 1.0);
    }

    let h = sample_aa(fp);
    let dh = h - view.sea_level;
    let n = normal_at(fp);
    let lambert = max(dot(n, normalize(view.sun_dir)), 0.0);
    let shade_amt = view.shade_strength;
    let shade = mix(1.0, 0.45 + 0.75 * lambert, shade_amt);
    let darkness = 1.0 - lambert;
    let has_derived = (view.flags & FLAG_HAS_DERIVED) != 0u;
    let mode = select(MODE_HYPSO, view.view_mode, has_derived || view.view_mode == MODE_HYPSO);
    let ti = clampc(vec2<i32>(floor(fp)));
    let paper = paper_at(sp, fp);
    let range = max(view.elev_max - view.sea_level, 1.0);
    let t_up = clamp(dh / range, 0.0, 1.0);

    var color: vec3<f32>;
    var ink_mask = 0.0; // accumulated ink coverage drawn last

    if dh > 0.0 {
        // ---- land ----
        switch mode {
            case MODE_BIOME_FLAT: {
                let b = u32(textureLoad(biome_tex, ti, 0).r + 0.5);
                color = view.palette[b & 15u].rgb * mix(1.0, shade, 0.25);
            }
            case MODE_MOISTURE: {
                color = ramp_moisture(bilinear_of(moist_tex, fp, view.moist_scale)) * mix(1.0, shade, 0.3);
            }
            case MODE_TEMPERATURE: {
                let tt = (bilinear_of(temp_tex, fp, view.temp_scale) - view.temp_min) / max(view.temp_max - view.temp_min, 1.0);
                color = ramp_temperature(clamp(tt, 0.0, 1.0)) * mix(1.0, shade, 0.3);
            }
            case MODE_HYPSO: {
                color = hypso(t_up) * shade;
            }
            default: {
                if fantasy {
                    // Parchment land, optionally washed with biome colour and
                    // lightened toward the peaks.
                    var tint = paper;
                    if has_derived && view.land_tint > 0.0 {
                        let b = u32(textureLoad(biome_tex, ti, 0).r + 0.5);
                        let bc = view.palette[b & 15u].rgb;
                        // Wash: multiply so the paper shows through.
                        tint = mix(paper, paper * (0.55 + 0.7 * bc), view.land_tint);
                    }
                    tint = mix(tint, paper * 1.06, 0.35 * t_up);
                    color = tint;
                    if view.relief_style != RELIEF_HATCHED {
                        color *= mix(1.0, shade, 0.7);
                    }
                    if view.relief_style != RELIEF_SHADED && view.hatch_strength > 0.0 {
                        // Slope gates the hatching so flat land stays clean.
                        let slope = 1.0 - n.z;
                        let gate = smoothstep(0.02, 0.18, slope * view.exaggeration);
                        let hk = hatch(sp, darkness * gate + 0.15 * gate);
                        ink_mask = max(ink_mask, hk * view.hatch_strength * 0.85);
                    }
                } else {
                    let b = u32(textureLoad(biome_tex, ti, 0).r + 0.5);
                    let bc = view.palette[b & 15u].rgb;
                    if has_derived {
                        color = mix(bc, hypso(t_up), 0.25 * t_up) * shade;
                    } else {
                        color = hypso(t_up) * shade;
                    }
                }
            }
        }
        // Woods.
        if has_derived && fantasy && mode == MODE_MAP && view.forest_style != FOREST_NONE {
            let fm = forest_marks(fp, ti);
            color = mix(color, view.forest_fill * (0.9 + 0.1 * shade), fm.x * 0.85);
            ink_mask = max(ink_mask, fm.y * 0.8);
        }
        // Lakes and rivers.
        if (view.flags & FLAG_WATER) != 0u && has_derived {
            let wc = bilinear_of(water_tex, fp, vec2<f32>(1.0));
            let thr = 0.5 * clamp(view.scale, 0.25, 1.0);
            let aa = max(fwidth(wc), 0.02);
            let a = smoothstep(thr - aa, thr + aa, wc);
            let edge = 1.0 - smoothstep(thr, thr + aa * 3.0, wc);
            if fantasy {
                color = mix(color, view.sea_fill, a);
                ink_mask = max(ink_mask, a * edge * 0.9);
                // Thin rivers read as ink strokes.
                let thin = smoothstep(0.35, 0.65, wc) * (1.0 - smoothstep(0.65, 1.0, wc));
                color = mix(color, view.river_ink, thin * a * 0.7);
            } else {
                var wcol = view.river_ink * mix(1.0, shade, 0.2);
                wcol = mix(wcol, vec3<f32>(0.12, 0.20, 0.32), edge * 0.6);
                color = mix(color, wcol, a);
            }
        }
    } else {
        // ---- sea ----
        let depth_range = max(view.sea_level - view.elev_min, 1.0);
        let t = clamp(-dh / depth_range, 0.0, 1.0);
        if fantasy {
            color = mix(paper, view.sea_fill, 0.85);
            color = mix(color, view.sea_fill * 0.92, 0.25 * sqrt(t));
            // Concentric shoreline rings that fade seaward, spaced by an
            // estimate of the distance to the shore (depth / sea-floor slope).
            if view.coast_rings > 0u {
                let e = max(1.0, 1.0 / view.scale);
                let gx = sample_aa(fp + vec2<f32>(e, 0.0)) - sample_aa(fp - vec2<f32>(e, 0.0));
                let gy = sample_aa(fp + vec2<f32>(0.0, e)) - sample_aa(fp - vec2<f32>(0.0, e));
                let slope = max(length(vec2<f32>(gx, gy)) / (2.0 * e), 0.05);
                let dist = -dh / slope;
                let k = dist / max(view.ring_spacing, 1.0);
                if k < f32(view.coast_rings) {
                    let ring = isoline(fract(k + 0.5) - 0.5, 1.3);
                    let fade = 1.0 - k / f32(view.coast_rings);
                    ink_mask = max(ink_mask, ring * fade * fade * 0.5);
                }
            }
            if view.theme_style == STYLE_INK {
                // Faint wave stipple in open water.
                let wv = vnoise(fp * 0.09 + vec2<f32>(0.0, view.time * 0.0));
                color = mix(color, view.sea_ink, 0.05 * smoothstep(0.62, 0.8, wv) * smoothstep(1.5, 4.0, -dh / max(view.ring_spacing, 1.0)));
            }
        } else {
            let shallow = vec3<f32>(0.62, 0.80, 0.84);
            let deep = vec3<f32>(0.16, 0.30, 0.50);
            color = mix(shallow, deep, sqrt(t));
            color *= mix(1.0, shade, 0.12 * (1.0 - t));
        }
        if mode == MODE_MOISTURE && has_derived {
            color = mix(color, ramp_moisture(bilinear_of(moist_tex, fp, view.moist_scale)), 0.5);
        }
    }

    // Coastline: the sea-level isoline.
    let coast_w = select(view.coast_width, view.coast_width * 1.15, fantasy);
    let coast = isoline(dh, coast_w);
    ink_mask = max(ink_mask, coast * 0.95);

    // Optional contours on land.
    if (view.flags & FLAG_CONTOURS) != 0u && dh > 0.0 {
        let c = dh / max(view.contour_interval, 1.0);
        let g = max(fwidth(c), 1e-5);
        let f = abs(fract(c + 0.5) - 0.5);
        var line = 1.0 - smoothstep(0.0, g * 1.4, f);
        line *= 1.0 - smoothstep(0.25, 0.6, g);
        ink_mask = max(ink_mask, line * 0.35);
    }

    let ink_col = select(vec3<f32>(0.16, 0.12, 0.09), view.ink, fantasy);
    let sea_ink_col = select(ink_col, view.sea_ink, fantasy && dh <= 0.0);
    color = mix(color, sea_ink_col, ink_mask);

    // Brush cursor ring.
    if (view.flags & FLAG_CURSOR) != 0u && view.cursor_radius > 0.0 {
        let dpx = length(fp - view.cursor) * view.scale;
        let rpx = view.cursor_radius * view.scale;
        let ring = 1.0 - smoothstep(0.0, 1.6, abs(dpx - rpx));
        let halo = 1.0 - smoothstep(1.6, 3.2, abs(dpx - rpx));
        color = mix(color, vec3<f32>(0.0), halo * 0.5);
        color = mix(color, vec3<f32>(1.0), ring * 0.9);
    }

    return vec4<f32>(color, 1.0);
}
