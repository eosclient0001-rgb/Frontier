// Fill a field with a constant — used to reset water/sediment/flux between runs.
//   group 1: (unused)   group 2 binding 0: outField
//#include "../lib/params.wgsl"

struct ClearParams {
  dims: vec2u,
  value: f32,
  pad0: f32,
};

@group(0) @binding(0) var<uniform> P: ClearParams;
@group(2) @binding(0) var outField: texture_storage_2d<r32float, write>;

struct VSOut { @builtin(global_invocation_id) gid: vec3u };

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.dims.x || gid.y >= P.dims.y) { return; }
  textureStore(outField, vec2i(gid.xy), vec4f(P.value, 0.0, 0.0, 1.0));
}
