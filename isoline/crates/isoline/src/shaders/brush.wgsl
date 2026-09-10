// Brush kernel. Mirrors `isoline_core::brush` exactly: one dispatch applies a
// batch of dabs, in order, to every texel of the batch's bounding rect.
// `src` is a copy of the field taken before the dispatch, used for
// neighbourhood reads (smooth) so results do not depend on thread order.

struct Dab {
    pos: vec2<f32>,
    radius: f32,
    strength: f32,
    hardness: f32,
    target_value: f32,
    mode: u32,
    falloff: u32,
};

struct Params {
    rect_origin: vec2<u32>,
    rect_size: vec2<u32>,
    field_size: vec2<u32>,
    dab_offset: u32,
    dab_count: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> dabs: array<Dab>;
@group(0) @binding(2) var field: texture_storage_2d<r32float, read_write>;
@group(0) @binding(3) var src: texture_storage_2d<r32float, read>;

fn kernel_weight(d: f32, hardness: f32, falloff: u32) -> f32 {
    if d >= 1.0 {
        return 0.0;
    }
    let soft = max(1.0 - hardness, 1e-3);
    let t = clamp((1.0 - d) / soft, 0.0, 1.0);
    switch falloff {
        case 0u: { return t * t * (3.0 - 2.0 * t); }
        case 1u: { return t; }
        case 2u: {
            let u = (1.0 - t) * 3.0;
            let g = exp(-0.5 * u * u);
            let g0 = 0.011108996;
            return (g - g0) / (1.0 - g0);
        }
        default: { return 1.0; }
    }
}

fn src_at(p: vec2<i32>) -> f32 {
    let c = clamp(p, vec2<i32>(0), vec2<i32>(params.field_size) - vec2<i32>(1));
    return textureLoad(src, c).r;
}

fn blur3(p: vec2<i32>) -> f32 {
    var s = 0.0;
    for (var oy = -1; oy <= 1; oy++) {
        for (var ox = -1; ox <= 1; ox++) {
            s += src_at(p + vec2<i32>(ox, oy));
        }
    }
    return s / 9.0;
}

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
    if gid.x >= params.rect_size.x || gid.y >= params.rect_size.y {
        return;
    }
    let p = params.rect_origin + gid.xy;
    if p.x >= params.field_size.x || p.y >= params.field_size.y {
        return;
    }
    let pi = vec2<i32>(p);
    let pc = vec2<f32>(p) + vec2<f32>(0.5, 0.5);
    var v = textureLoad(field, pi).r;
    var touched = false;
    for (var i = 0u; i < params.dab_count; i++) {
        let d = dabs[params.dab_offset + i];
        let dist = length(pc - d.pos) / max(d.radius, 1e-3);
        let w = kernel_weight(dist, d.hardness, d.falloff);
        if w <= 0.0 {
            continue;
        }
        touched = true;
        switch d.mode {
            case 0u: { v = v + w * d.strength; }
            case 1u: { v = v - w * d.strength; }
            case 2u: { v = v + (d.target_value - v) * clamp(w * d.strength, 0.0, 1.0); }
            case 3u: { v = v + (min(v, d.target_value) - v) * clamp(w * d.strength, 0.0, 1.0); }
            case 4u: { v = v + (max(v, d.target_value) - v) * clamp(w * d.strength, 0.0, 1.0); }
            default: { v = v + (blur3(pi) - v) * clamp(w * d.strength, 0.0, 1.0); }
        }
    }
    if touched {
        textureStore(field, pi, vec4<f32>(v, 0.0, 0.0, 0.0));
    }
}
