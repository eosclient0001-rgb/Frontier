// Paint brush — writes to a single-channel 0..1 field (layer mask, sketch or
// erosion "protection" map).
//   group 1: 0 field (read)   group 2 binding 0: outField
//#include "../lib/mathx.wgsl"
//#include "../lib/params.wgsl"

struct PaintParams {
  dims: vec2u,
  center: vec2f,
  radius: f32,
  strength: f32,
  falloff: f32,
  mode: u32,      // 0 add, 1 subtract, 2 replace, 3 smooth
  value: f32,
  pad0: f32,
  origin: vec2i,  // top-left texel of this dispatch (bounding-box brushes)
};

@group(0) @binding(0) var<uniform> P: PaintParams;
@group(1) @binding(0) var inField: texture_2d<f32>;
@group(2) @binding(0) var outField: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  let c = vec2i(gid.xy) + P.origin;
  if (c.x < 0 || c.y < 0 || c.x >= i32(P.dims.x) || c.y >= i32(P.dims.y)) { return; }
  let uv = (vec2f(c) + vec2f(0.5)) / vec2f(P.dims);
  let d = length((uv - P.center) * vec2f(P.dims));
  let r = max(P.radius * f32(P.dims.x), 1.0);
  var v = textureLoad(inField, c, 0).x;
  if (d <= r) {
    let w = pow(saturate(1.0 - d / r), max(P.falloff, 0.05)) * P.strength;
    switch (P.mode) {
      case 1u: { v = v - w * P.value; }
      case 2u: { v = mix(v, P.value, saturate(w)); }
      case 3u: { v = mix(v, P.value, saturate(w * 0.5)); }
      default: { v = v + w * P.value; }
    }
  }
  textureStore(outField, c, vec4f(saturate(v), 0.0, 0.0, 1.0));
}
