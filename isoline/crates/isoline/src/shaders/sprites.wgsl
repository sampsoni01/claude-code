// Instanced symbol sprites over the map. Positions and sizes are in field
// texels; the view maps them to the screen exactly like the map pass.

struct SpriteView {
    screen_size: vec2<f32>,
    origin: vec2<f32>,
    scale: f32,
    shadow_pass: f32,   // 1 = draw the drop shadow (offset, darkened)
    shadow_offset: vec2<f32>,
    shadow_alpha: f32,
    _pad: vec3<f32>,
};

struct Inst {
    @location(0) pos: vec2<f32>,
    @location(1) size: vec2<f32>,
    @location(2) pivot: vec2<f32>,
    @location(3) uv0: vec2<f32>,
    @location(4) uv1: vec2<f32>,
    @location(5) rot_flip: vec2<f32>,
    @location(6) tint: vec4<f32>,
};

struct VsOut {
    @builtin(position) pos: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) tint: vec4<f32>,
};

@group(0) @binding(0) var<uniform> view: SpriteView;
@group(0) @binding(1) var atlas: texture_2d<f32>;
@group(0) @binding(2) var atlas_sampler: sampler;

@vertex
fn vs_main(@builtin(vertex_index) vi: u32, inst: Inst) -> VsOut {
    // Two triangles: 0,1,2 / 2,1,3 over corners (0,0) (1,0) (0,1) (1,1).
    var corners = array<vec2<f32>, 6>(
        vec2<f32>(0.0, 0.0), vec2<f32>(1.0, 0.0), vec2<f32>(0.0, 1.0),
        vec2<f32>(0.0, 1.0), vec2<f32>(1.0, 0.0), vec2<f32>(1.0, 1.0));
    let c = corners[vi];
    var local = (c - inst.pivot) * inst.size;
    if inst.rot_flip.y > 0.5 {
        local.x = -local.x;
    }
    let s = sin(inst.rot_flip.x);
    let cs = cos(inst.rot_flip.x);
    let rotated = vec2<f32>(local.x * cs - local.y * s, local.x * s + local.y * cs);
    var world = inst.pos + rotated;
    if view.shadow_pass > 0.5 {
        world += view.shadow_offset * inst.size.y;
    }
    let screen = (world - view.origin) * view.scale;
    let ndc = vec2<f32>(screen.x / view.screen_size.x * 2.0 - 1.0, 1.0 - screen.y / view.screen_size.y * 2.0);
    var out: VsOut;
    out.pos = vec4<f32>(ndc, 0.0, 1.0);
    var uv = mix(inst.uv0, inst.uv1, c);
    if inst.rot_flip.y > 0.5 {
        uv.x = mix(inst.uv1.x, inst.uv0.x, c.x);
    }
    out.uv = uv;
    out.tint = inst.tint;
    return out;
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4<f32> {
    let t = textureSample(atlas, atlas_sampler, in.uv);
    if view.shadow_pass > 0.5 {
        return vec4<f32>(0.1, 0.07, 0.04, t.a * view.shadow_alpha * in.tint.a);
    }
    if t.a < 0.01 {
        discard;
    }
    return vec4<f32>(t.rgb * in.tint.rgb, t.a * in.tint.a);
}
