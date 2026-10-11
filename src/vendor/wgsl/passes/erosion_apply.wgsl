// Folds the simulation back onto the full-resolution field.
//
// The erosion solver runs on a coarser grid; here its *delta* is upsampled and
// added to the (untouched) full-resolution height field. That is why a 4K field
// keeps its rock detail while paying for a 2K simulation, and it is also why the
// eroded macro shapes stay perfectly registered with the detail.
//   group 1: 0 full height  1 coarse pre-erosion  2 coarse eroded
//            3 coarse flow (rgba32f: .x wetness, .y deposited mass)
//            4 previous wetness map  5 previous deposit map
//
// An erosion layer is just another entry in the terrain stack, so several of
// them can run in sequence; each one folds its own delta in and merges its
// wetness and deposit contributions with what earlier entries produced (max,
// so a second pass cannot double-count the same river).
//   group 2: 0 out height  1 out flow  2 out deposit
//#include "../lib/mathx.wgsl"
//#include "../lib/params.wgsl"
//#include "../lib/heightf.wgsl"

struct ApplyParams {
  dims: vec2u,
  simDims: vec2u,
  flowGain: f32,
  depositGain: f32,
  blend: f32,
  detailScale: f32,
  pad0: f32,
  pad1: f32,
};

@group(0) @binding(0) var<uniform> P: ApplyParams;
@group(1) @binding(0) var inHeight: texture_2d<f32>;
@group(1) @binding(1) var inCoarseBase: texture_2d<f32>;
@group(1) @binding(2) var inCoarseEroded: texture_2d<f32>;
@group(1) @binding(3) var inCoarseFlow: texture_2d<f32>;
@group(1) @binding(4) var inPrevFlow: texture_2d<f32>;
@group(1) @binding(5) var inPrevDeposit: texture_2d<f32>;
@group(2) @binding(0) var outHeight: texture_storage_2d<r32float, write>;
@group(2) @binding(1) var outFlow: texture_storage_2d<r32float, write>;
@group(2) @binding(2) var outDeposit: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.dims.x || gid.y >= P.dims.y) { return; }
  let uv = (vec2f(gid.xy) + vec2f(0.5)) / vec2f(P.dims);
  let base = hFetch(inHeight, vec2i(gid.xy), P.dims);
  let coarseBase = hSample(inCoarseBase, P.simDims, uv);
  let coarseEroded = hSample(inCoarseEroded, P.simDims, uv);
  let delta = (coarseEroded - coarseBase) * P.blend;
  let h = clamp(base + delta, -0.25, 1.9);

  // Wetness and deposit are upsampled with a soft response curve so masks get a
  // perceptually even 0..1 field instead of a linear one dominated by outliers.
  let flowDep = hSample2(inCoarseFlow, P.simDims, uv);
  let prevFlow = hSample(inPrevFlow, P.dims, uv);
  let prevDep = hSample(inPrevDeposit, P.dims, uv);
  let flow01 = max(prevFlow, saturate(1.0 - exp(-max(flowDep.x, 0.0) * P.flowGain)));
  let dep01 = max(prevDep, saturate(1.0 - exp(-max(flowDep.y, 0.0) * P.depositGain * 900.0)));

  textureStore(outHeight, vec2i(gid.xy), vec4f(h, 0.0, 0.0, 1.0));
  textureStore(outFlow, vec2i(gid.xy), vec4f(flow01, 0.0, 0.0, 1.0));
  textureStore(outDeposit, vec2i(gid.xy), vec4f(dep01, 0.0, 0.0, 1.0));
}
