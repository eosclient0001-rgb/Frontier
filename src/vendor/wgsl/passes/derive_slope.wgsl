// Slope and curvature maps. These are what most masks key off, so they are
// derived from the final height field at full resolution in one pass.
//   group 1 binding 0: height    group 2 binding 0: outSlope  1: outCurvature
//#include "../lib/mathx.wgsl"
//#include "../lib/params.wgsl"
//#include "../lib/heightf.wgsl"

struct SlopeParams {
  dims: vec2u,
  cellMeters: f32,
  heightScale: f32,
  curvatureScale: f32,
  pad0: f32,
};

@group(0) @binding(0) var<uniform> P: SlopeParams;
@group(1) @binding(0) var inHeight: texture_2d<f32>;
@group(2) @binding(0) var outSlope: texture_storage_2d<r32float, write>;
@group(2) @binding(1) var outCurvature: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.dims.x || gid.y >= P.dims.y) { return; }
  let pix = vec2f(gid.xy);
  let g = hGradient(inHeight, P.dims, pix, P.cellMeters, P.heightScale);
  // Normalised slope: 0 = flat, 1 = vertical wall.
  let slope = saturate(atan(length(g)) / 1.55334303);   // /(PI/2)
  let curv = clamp(hCurvature(inHeight, P.dims, pix, P.cellMeters) * P.curvatureScale, -1.0, 1.0);
  textureStore(outSlope, vec2i(gid.xy), vec4f(slope, 0.0, 0.0, 1.0));
  textureStore(outCurvature, vec2i(gid.xy), vec4f(curv, 0.0, 0.0, 1.0));
}
