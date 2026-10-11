// Frontier Terrain Forge — generic terrain layer pass.
//
// One pipeline serves every layer type: the per-type generator is injected where
// {{LAYER}} appears. Masks, blend ops, bias/contrast and the erosion feedback
// fields are shared by all of them.
//
// Bindings (auto-derived by tools/gen-layout.mjs → src/gen/gpu_layout.js)
//   group 0  binding 0 : LayerUniforms
//   group 1  binding 0 : height     previous stack result      (r32float)
//                  1 : slope      0..1 from the simulation grid
//                  2 : curvature  -1..1
//                  3 : flow       0..1 wetness
//                  4 : deposit    0..1
//                  5 : paint      0..1 painted mask for this layer
//                  6 : sketch     0..1 painted height sketch
//                  7 : detail     0..1 retained high-frequency detail
//   group 2  binding 0 : outHeight (r32float)

//#include "../lib/mathx.wgsl"
//#include "../lib/noise.wgsl"
//#include "../lib/params.wgsl"
//#include "../lib/mask.wgsl"
//#include "../lib/heightf.wgsl"

@group(0) @binding(0) var<uniform> P: LayerUniforms;

@group(1) @binding(0) var inHeight: texture_2d<f32>;
@group(1) @binding(1) var inSlope: texture_2d<f32>;
@group(1) @binding(2) var inCurvature: texture_2d<f32>;
@group(1) @binding(3) var inFlow: texture_2d<f32>;
@group(1) @binding(4) var inDeposit: texture_2d<f32>;
@group(1) @binding(5) var inPaint: texture_2d<f32>;
@group(1) @binding(6) var inSketch: texture_2d<f32>;
@group(1) @binding(7) var inDetail: texture_2d<f32>;

@group(2) @binding(0) var outHeight: texture_storage_2d<r32float, write>;

/// Sampling helpers the injected generators may use — transform layers (Warp,
/// Smooth, Strata, Detail) read the current field back through these.
fn prevHeight(uv: vec2f) -> f32 { return hSample(inHeight, P.dims, uv); }
fn prevSlope(uv: vec2f) -> f32 { return maskFetch(inSlope, P.textureRes, uv); }
fn prevFlow(uv: vec2f) -> f32 { return maskFetch(inFlow, P.textureRes, uv); }
fn prevDetail(uv: vec2f) -> f32 { return maskFetch(inDetail, P.textureRes, uv); }

// The injected generator: fn layerShape(c: ShapeCtx) -> f32
//#include "../templates/{{LAYER}}.wgsl"

fn blendLayer(prev: f32, shape: f32, op: u32, amount: f32) -> f32 {
  let a = saturate(amount);
  switch (op) {
    case 1u: { return prev - shape * a; }                          // subtract
    case 2u: { return prev * mix(1.0, shape, a); }                  // multiply
    case 3u: { return max(prev, mix(0.0, shape, a)); }              // max
    case 4u: { return min(prev, mix(1.0, shape, a)); }              // min
    case 5u: { return mix(prev, shape, a); }                        // replace
    case 6u: { return mix(prev, shape, a); }                        // mix
    case 7u: {                                                      // overlay
      let ov = select(2.0 * prev * shape, 1.0 - 2.0 * (1.0 - prev) * (1.0 - shape), prev > 0.5);
      return mix(prev, ov, a);
    }
    case 8u: { return mix(prev, 1.0 - (1.0 - prev) * (1.0 - shape * a), a); } // screen
    default: { return prev + shape * a; }                           // add
  }
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.dims.x || gid.y >= P.dims.y) { return; }
  let uv = (vec2f(gid.xy) + vec2f(0.5)) / vec2f(P.dims);

  let prev = hFetch(inHeight, vec2i(gid.xy), P.dims);

  var ctx: ShapeCtx;
  ctx.uv = uv;
  ctx.freq = P.worldSize / max(P.lp[0].x, 1e-3);
  ctx.seed = fract(P.seed * 13.71);
  ctx.world = P.worldSize;
  ctx.lp = P.lp;

  let shape = layerShape(ctx);

  // Slope feedback: layer types can fade themselves out on steep ground, which
  // is how cliff faces stay rocky instead of carrying rolling-hill noise.
  var shaped = shape;
  let slopeParam = P.lp[3].w;
  if (slopeParam > 0.001) {
    shaped = shaped * (1.0 - saturate(maskFetch(inSlope, P.textureRes, uv) * slopeParam));
  }

  let blended = blendLayer(prev, shaped, P.blend, P.amount);
  let biased = clamp((blended - 0.5) * clamp(P.contrast, 0.05, 8.0) + 0.5 + P.bias, -0.5, 1.9);

  let m = evalMaskSet(
    P.masks, P.maskCount, uv, P.textureRes,
    inHeight, inSlope, inCurvature, inFlow, inDeposit, inPaint, inSketch);

  // A painted sketch lifts the terrain directly — the terrain equivalent of
  // drawing the silhouette with a brush before sculpting detail into it.
  let sketchLift = maskFetch(inSketch, P.textureRes, uv) * P.extras.w;
  let result = clamp(mix(prev, biased, m) + sketchLift, -0.25, 1.9);

  textureStore(outHeight, vec2i(gid.xy), vec4f(result, 0.0, 0.0, 1.0));
}
