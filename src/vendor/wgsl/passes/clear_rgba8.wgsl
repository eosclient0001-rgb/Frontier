// Fill an rgba8unorm field with a constant. Used to lay down the base surface
// the material stack blends onto (untextured substrate, default roughness).
//#include "../lib/params.wgsl"

struct ClearRgbaParams {
  dims: vec2u,
  pad0: f32,
  pad1: f32,
  value: vec4f,
};

@group(0) @binding(0) var<uniform> P: ClearRgbaParams;
@group(2) @binding(0) var outField: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.dims.x || gid.y >= P.dims.y) { return; }
  textureStore(outField, vec2i(gid.xy), clamp(P.value, vec4f(0.0), vec4f(1.0)));
}
