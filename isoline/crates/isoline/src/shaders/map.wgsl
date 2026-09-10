// Map view: a full-screen pass that samples the live elevation field and
// derives hillshade, hypsometric tint, water depth and the sea-level isoline
// (the coastline) per pixel. Nothing here is cached: change the field or the
// sea level and the next frame shows it.

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
    _pad: f32,
    view_mode: u32,
    flow_max: f32,
    temp_min: f32,
    temp_max: f32,
    palette: array<vec4<f32>, 16>,
};

const FLAG_CONTOURS: u32 = 1u;
const FLAG_CURSOR: u32 = 2u;
const FLAG_HYPSO: u32 = 4u;
const FLAG_WATER: u32 = 8u;
const FLAG_HAS_DERIVED: u32 = 16u;

const MODE_BIOME_SHADED: u32 = 0u;
const MODE_HYPSO: u32 = 1u;
const MODE_BIOME_FLAT: u32 = 2u;
const MODE_MOISTURE: u32 = 3u;
const MODE_TEMPERATURE: u32 = 4u;
const MODE_FLOW: u32 = 5u;

@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var elev: texture_2d<f32>;
@group(0) @binding(2) var water_tex: texture_2d<f32>;
@group(0) @binding(3) var moist_tex: texture_2d<f32>;
@group(0) @binding(4) var temp_tex: texture_2d<f32>;
@group(0) @binding(5) var biome_tex: texture_2d<f32>;
@group(0) @binding(6) var flow_tex: texture_2d<f32>;

struct VsOut {
    @builtin(position) pos: vec4<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
    // Full-screen triangle.
    var out: VsOut;
    let x = f32(i32(vi & 1u) * 4 - 1);
    let y = f32(i32(vi >> 1u) * 4 - 1);
    out.pos = vec4<f32>(x, y, 0.0, 1.0);
    return out;
}

fn load(p: vec2<i32>) -> f32 {
    let c = clamp(p, vec2<i32>(0), vec2<i32>(view.field_size) - vec2<i32>(1));
    return textureLoad(elev, c, 0).r;
}

fn clampc(p: vec2<i32>) -> vec2<i32> {
    return clamp(p, vec2<i32>(0), vec2<i32>(view.field_size) - vec2<i32>(1));
}

fn bilinear_water(fp: vec2<f32>) -> f32 {
    let f = fp - vec2<f32>(0.5);
    let i = floor(f);
    let t = f - i;
    let p = vec2<i32>(i);
    let a = textureLoad(water_tex, clampc(p), 0).r;
    let b = textureLoad(water_tex, clampc(p + vec2<i32>(1, 0)), 0).r;
    let c = textureLoad(water_tex, clampc(p + vec2<i32>(0, 1)), 0).r;
    let d = textureLoad(water_tex, clampc(p + vec2<i32>(1, 1)), 0).r;
    return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
}

fn bilinear_of(tex: texture_2d<f32>, fp: vec2<f32>) -> f32 {
    let f = fp - vec2<f32>(0.5);
    let i = floor(f);
    let t = f - i;
    let p = vec2<i32>(i);
    let a = textureLoad(tex, clampc(p), 0).r;
    let b = textureLoad(tex, clampc(p + vec2<i32>(1, 0)), 0).r;
    let c = textureLoad(tex, clampc(p + vec2<i32>(0, 1)), 0).r;
    let d = textureLoad(tex, clampc(p + vec2<i32>(1, 1)), 0).r;
    return mix(mix(a, b, t.x), mix(c, d, t.x), t.y);
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

// When zoomed out, average a few taps so the field does not shimmer.
fn sample_aa(fp: vec2<f32>) -> f32 {
    if view.scale >= 0.75 {
        return sample(fp);
    }
    let o = 0.25 / view.scale;
    return 0.25 * (sample(fp + vec2<f32>(-o, -o)) + sample(fp + vec2<f32>(o, -o))
                 + sample(fp + vec2<f32>(-o, o)) + sample(fp + vec2<f32>(o, o)));
}

fn normal_at(fp: vec2<f32>) -> vec3<f32> {
    // Gradient step of one screen pixel, never below one texel.
    let e = max(1.0, 1.0 / view.scale);
    let hx = sample_aa(fp + vec2<f32>(e, 0.0)) - sample_aa(fp - vec2<f32>(e, 0.0));
    let hy = sample_aa(fp + vec2<f32>(0.0, e)) - sample_aa(fp - vec2<f32>(0.0, e));
    let run = 2.0 * e * view.meters_per_texel;
    let dx = hx / run * view.exaggeration;
    let dy = hy / run * view.exaggeration;
    return normalize(vec3<f32>(-dx, -dy, 1.0));
}

fn hypso(t: f32) -> vec3<f32> {
    // t in 0..1 above sea level.
    let c0 = vec3<f32>(0.53, 0.66, 0.42); // lowland
    let c1 = vec3<f32>(0.78, 0.76, 0.52); // hills
    let c2 = vec3<f32>(0.62, 0.50, 0.36); // uplands
    let c3 = vec3<f32>(0.60, 0.58, 0.56); // rock
    let c4 = vec3<f32>(0.96, 0.96, 0.97); // snow
    if t < 0.15 { return mix(c0, c1, t / 0.15); }
    if t < 0.40 { return mix(c1, c2, (t - 0.15) / 0.25); }
    if t < 0.75 { return mix(c2, c3, (t - 0.40) / 0.35); }
    return mix(c3, c4, (t - 0.75) / 0.25);
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let paper = vec3<f32>(0.90, 0.87, 0.80);
    let fp = view.origin + in.pos.xy / view.scale;
    if fp.x < 0.0 || fp.y < 0.0 || fp.x >= view.field_size.x || fp.y >= view.field_size.y {
        // Soft shadow under the map edge.
        let d = max(max(-fp.x, fp.x - view.field_size.x), max(-fp.y, fp.y - view.field_size.y)) * view.scale;
        let s = 1.0 - 0.18 * (1.0 - smoothstep(0.0, 14.0, d));
        return vec4<f32>(paper * s, 1.0);
    }

    let h = sample_aa(fp);
    let dh = h - view.sea_level;
    let n = normal_at(fp);
    let lambert = max(dot(n, normalize(view.sun_dir)), 0.0);
    let shade = mix(1.0, 0.45 + 0.75 * lambert, view.shade_strength);

    var color: vec3<f32>;
    let has_derived = (view.flags & FLAG_HAS_DERIVED) != 0u;
    let mode = select(MODE_HYPSO, view.view_mode, has_derived);
    let ti = clampc(vec2<i32>(floor(fp)));
    if dh > 0.0 {
        let range = max(view.elev_max - view.sea_level, 1.0);
        let t = clamp(dh / range, 0.0, 1.0);
        switch mode {
            case MODE_BIOME_SHADED: {
                let b = u32(textureLoad(biome_tex, ti, 0).r + 0.5);
                let bc = view.palette[b & 15u].rgb;
                // A touch of hypsometric lightening toward peaks.
                color = mix(bc, hypso(t), 0.25 * t) * shade;
            }
            case MODE_BIOME_FLAT: {
                let b = u32(textureLoad(biome_tex, ti, 0).r + 0.5);
                color = view.palette[b & 15u].rgb * mix(1.0, shade, 0.25);
            }
            case MODE_MOISTURE: {
                color = ramp_moisture(bilinear_of(moist_tex, fp)) * mix(1.0, shade, 0.3);
            }
            case MODE_TEMPERATURE: {
                let tt = (bilinear_of(temp_tex, fp) - view.temp_min) / max(view.temp_max - view.temp_min, 1.0);
                color = ramp_temperature(clamp(tt, 0.0, 1.0)) * mix(1.0, shade, 0.3);
            }
            case MODE_FLOW: {
                let f = textureLoad(flow_tex, ti, 0).r;
                let v = log(f + 1.0) / log(view.flow_max + 1.0);
                color = mix(vec3<f32>(0.95, 0.94, 0.90), vec3<f32>(0.05, 0.15, 0.45), clamp(v, 0.0, 1.0)) * mix(1.0, shade, 0.3);
            }
            default: {
                if (view.flags & FLAG_HYPSO) != 0u {
                    color = hypso(t);
                } else {
                    color = mix(vec3<f32>(0.86, 0.82, 0.70), vec3<f32>(0.98, 0.98, 0.98), t);
                }
                color *= shade;
            }
        }
        // Lakes and rivers.
        if (view.flags & FLAG_WATER) != 0u && has_derived {
            let wc = bilinear_water(fp);
            // Keep thin channels visible when zoomed out by lowering the threshold.
            let thr = 0.5 * clamp(view.scale, 0.25, 1.0);
            let aa = max(fwidth(wc), 0.02);
            let a = smoothstep(thr - aa, thr + aa, wc);
            let river_col = vec3<f32>(0.36, 0.58, 0.76);
            let edge = 1.0 - smoothstep(thr, thr + aa * 3.0, wc);
            var wcol = river_col * mix(1.0, shade, 0.2);
            wcol = mix(wcol, vec3<f32>(0.12, 0.20, 0.32), edge * 0.6);
            color = mix(color, wcol, a);
        }
    } else {
        let depth_range = max(view.sea_level - view.elev_min, 1.0);
        let t = clamp(-dh / depth_range, 0.0, 1.0);
        let shallow = vec3<f32>(0.62, 0.80, 0.84);
        let deep = vec3<f32>(0.16, 0.30, 0.50);
        color = mix(shallow, deep, sqrt(t));
        // Faint bathymetric relief, fading out in deep water.
        color *= mix(1.0, shade, 0.12 * (1.0 - t));
        if mode == MODE_FLOW && has_derived {
            let f = textureLoad(flow_tex, ti, 0).r;
            let v = log(f + 1.0) / log(view.flow_max + 1.0);
            color = mix(color, vec3<f32>(0.05, 0.15, 0.45), clamp(v, 0.0, 1.0) * 0.8);
        }
    }

    // Coastline: the sea-level isoline, anti-aliased with screen-space derivatives.
    let aa = max(fwidth(dh), 1e-4);
    let coast = 1.0 - smoothstep(0.0, aa * view.coast_width, abs(dh));
    let ink = vec3<f32>(0.16, 0.12, 0.09);
    color = mix(color, ink, coast * 0.85);

    // Optional contours on land.
    if (view.flags & FLAG_CONTOURS) != 0u && dh > 0.0 {
        let c = dh / max(view.contour_interval, 1.0);
        let g = max(fwidth(c), 1e-5);
        let f = abs(fract(c + 0.5) - 0.5);
        var line = 1.0 - smoothstep(0.0, g * 1.4, f);
        line *= 1.0 - smoothstep(0.25, 0.6, g); // fade when contours crowd
        color = mix(color, ink, line * 0.35);
    }

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
