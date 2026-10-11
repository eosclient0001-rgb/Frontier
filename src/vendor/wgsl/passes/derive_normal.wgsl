// Baked tangent-space normal map (OpenGL convention, +Y up) plus a cavity term
// in alpha. Sampling this in the viewport is what carries sub-vertex detail that
// the render mesh cannot resolve.
//   group 1 binding 0: height    group 2 binding 0: outNormal (rgba8unorm)
//#include "../lib/mathx.wgsl"
//#include "../lib/params.wgsl"
//#include "../lib/heightf.wgsl"

struct NormalParams {
  dims: vec2u,
  cellMeters: f32,
  heightScale: f32,
  exaggeration: f32,
  pad0: f32,
};

@group(0) @binding(0) var<uniform> P: NormalParams;
@group(1) @binding(0) var inHeight: texture_2d<f32>;
@group(2) @binding(0) var outNormal: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.dims.x || gid.y >= P.dims.y) { return; }
  let pix = vec2f(gid.xy);
  let n = hNormal(inHeight, P.dims, pix, P.cellMeters, P.heightScale, P.exaggeration);
  // Height increases "down" the image, so flip +Y to match the terrain mesh UVs.
  let enc = vec3f(n.x * 0.5 + 0.5, -n.y * 0.5 + 0.5, n.z * 0.5 + 0.5);
  let curv = hCurvature(inHeight, P.dims, pix, P.cellMeters);
  let cavity = saturate(0.5 - curv * 0.75);
  textureStore(outNormal, vec2i(gid.xy), vec4f(enc, cavity));
}
