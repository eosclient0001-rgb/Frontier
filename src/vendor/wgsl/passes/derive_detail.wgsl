// Extracts the high-frequency content of the current field (height minus its
// blurred self) as a 0..1 "detail" field. Detail layers and the material stack
// reuse it, and the erosion recombination uses it to keep 4K crisp.
//   group 1 binding 0: height    group 2 binding 0: outDetail (r32float)
//#include "../lib/mathx.wgsl"
//#include "../lib/params.wgsl"
//#include "../lib/heightf.wgsl"

struct DetailParams {
  dims: vec2u,
  radiusTexels: f32,
  gain: f32,
  pad0: f32,
  pad1: f32,
};

@group(0) @binding(0) var<uniform> P: DetailParams;
@group(1) @binding(0) var inHeight: texture_2d<f32>;
@group(2) @binding(0) var outDetail: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.dims.x || gid.y >= P.dims.y) { return; }
  let pix = vec2f(gid.xy);
  let h = hSamplePix(inHeight, P.dims, pix);
  let low = hBlur(inHeight, P.dims, pix, max(P.radiusTexels, 0.5));
  let detail = saturate((h - low) * P.gain + 0.5);
  textureStore(outDetail, vec2i(gid.xy), vec4f(detail, 0.0, 0.0, 1.0));
}
