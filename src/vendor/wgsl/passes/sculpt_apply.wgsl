// Applies the hand-sculpt buffer to the height field.
//   sculpt.rgba32float: R = height delta (normalised), G = flatten weight,
//   B = flatten target (normalised), A = last stroke strength.
//   group 1: 0 height  1 sculpt     group 2 binding 0: outHeight
// Sculpt data lives outside the layer stack, so it survives regeneration — the
// same contract as a sculpt layer in a DCC tool.
//#include "../lib/mathx.wgsl"
//#include "../lib/params.wgsl"

struct SculptParams {
  dims: vec2u,
  strength: f32,
  pad0: f32,
};

@group(0) @binding(0) var<uniform> P: SculptParams;
@group(1) @binding(0) var inHeight: texture_2d<f32>;
@group(1) @binding(1) var inSculpt: texture_2d<f32>;
@group(2) @binding(0) var outHeight: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.dims.x || gid.y >= P.dims.y) { return; }
  let c = vec2i(gid.xy);
  let h = textureLoad(inHeight, c, 0).x;
  let s = textureLoad(inSculpt, c, 0);
  let delta = s.x * P.strength;
  let raiseAmt = h + delta;
  // Flatten pulls the surface toward the recorded goal height; otherwise the
  // stored delta applies. Both live in the sculpt buffer, never in the layers.
  let flush = saturate(s.y);
  let goal = s.z;
  let out = mix(raiseAmt, goal, flush);
  textureStore(outHeight, c, vec4f(clamp(out, -0.25, 1.9), 0.0, 0.0, 1.0));
}
