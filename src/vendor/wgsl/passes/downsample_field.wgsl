// Area-average down/up-sampling of a scalar field.
//   group 1 binding 0: source   group 2 binding 0: outField
// Used to prepare the coarser simulation grid and to fold the eroded result
// back onto the full-resolution field as a delta.
//#include "../lib/mathx.wgsl"
//#include "../lib/params.wgsl"
//#include "../lib/heightf.wgsl"

struct ResampleParams {
  srcDims: vec2u,
  dstDims: vec2u,
  pad0: f32,
  pad1: f32,
};

@group(0) @binding(0) var<uniform> P: ResampleParams;
@group(1) @binding(0) var inField: texture_2d<f32>;
@group(2) @binding(0) var outField: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.dstDims.x || gid.y >= P.dstDims.y) { return; }
  let uv = (vec2f(gid.xy) + vec2f(0.5)) / vec2f(P.dstDims);
  let scale = vec2f(P.srcDims) / vec2f(P.dstDims);
  var sum = 0.0;
  var count = 0.0;
  // 3x3 importance-weighted taps: cheap, and it removes the aliasing that a
  // single bilinear tap would fold into the simulation's initial condition.
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let w = select(1.0, 0.5, x != 0 && y != 0);
      let uvOff = uv + vec2f(f32(x), f32(y)) * scale / vec2f(P.srcDims);
      sum = sum + hSample(inField, P.srcDims, clamp(uvOff, vec2f(0.0), vec2f(1.0))) * w;
      count = count + w;
    }
  }
  textureStore(outField, vec2i(gid.xy), vec4f(sum / count, 0.0, 0.0, 1.0));
}
