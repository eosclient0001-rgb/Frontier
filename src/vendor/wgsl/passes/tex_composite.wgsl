// Chains one material layer into the accumulated result (source-over, in stack
// order). Running one small pass per layer keeps each dispatch cheap and mirrors
// the layer stack exactly — layer N blends onto the result of layers 1..N-1.
//
//   group 1 : 0 weight  1 color  2 material  3 prev albedo  4 prev material
//   group 2 : 0 out albedo  1 out material
//#include "../lib/mathx.wgsl"
//#include "../lib/params.wgsl"

struct CompositeParams {
  dims: vec2u,
  blend: f32,
  pad0: f32,
  pad1: f32,
};

@group(0) @binding(0) var<uniform> P: CompositeParams;
@group(1) @binding(0) var inWeight: texture_2d<f32>;
@group(1) @binding(1) var inColor: texture_2d<f32>;
@group(1) @binding(2) var inMaterial: texture_2d<f32>;
@group(1) @binding(3) var inAlbedo: texture_2d<f32>;
@group(1) @binding(4) var inPrevMaterial: texture_2d<f32>;
@group(2) @binding(0) var outAlbedo: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(1) var outMaterial: texture_storage_2d<rgba8unorm, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.dims.x || gid.y >= P.dims.y) { return; }
  let c = vec2i(gid.xy);
  let w = saturate(textureLoad(inWeight, c, 0).x * P.blend);
  let layerColor = srgbToLinear(textureLoad(inColor, c, 0).rgb);
  let layerMat = textureLoad(inMaterial, c, 0);
  let prevColor = srgbToLinear(textureLoad(inAlbedo, c, 0).rgb);
  let prevMat = textureLoad(inPrevMaterial, c, 0);

  let color = mix(prevColor, layerColor, w);
  // Detail strength and wear stack with coverage weight; roughness/metallic are
  // coverage-weighted averages, which is what a splat blend does on the GPU.
  let mat = mix(prevMat, layerMat, w);

  textureStore(outAlbedo, c, vec4f(linearToSrgb(color), 1.0));
  textureStore(outMaterial, c, mat);
}
