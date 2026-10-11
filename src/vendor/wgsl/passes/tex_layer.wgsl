// Generic material (texture) layer pass. The per-type generator is injected
// where {{MATERIAL}} appears; masks, blending and the output packing are shared.
//
//   group 1 : 0 height  1 slope  2 curvature  3 flow  4 deposit  5 paint
//             6 sketch  7 ao
//   group 2 : 0 outWeight (r8unorm)  1 outColor (rgba8unorm, sRGB encoded)
//             2 outMaterial (r: roughness, g: metallic, b: detail, a: wear)
//
// Colour is stored sRGB-encoded in a plain rgba8unorm texture and decoded by the
// sampler view at draw time, which is exactly how a shipped albedo map behaves.
//#include "../lib/mathx.wgsl"
//#include "../lib/noise.wgsl"
//#include "../lib/params.wgsl"
//#include "../lib/mask.wgsl"

@group(0) @binding(0) var<uniform> P: LayerUniforms;

@group(1) @binding(0) var inHeight: texture_2d<f32>;
@group(1) @binding(1) var inSlope: texture_2d<f32>;
@group(1) @binding(2) var inCurvature: texture_2d<f32>;
@group(1) @binding(3) var inFlow: texture_2d<f32>;
@group(1) @binding(4) var inDeposit: texture_2d<f32>;
@group(1) @binding(5) var inPaint: texture_2d<f32>;
@group(1) @binding(6) var inSketch: texture_2d<f32>;
@group(1) @binding(7) var inAo: texture_2d<f32>;

@group(2) @binding(0) var outWeight: texture_storage_2d<r8unorm, write>;
@group(2) @binding(1) var outColor: texture_storage_2d<rgba8unorm, write>;
@group(2) @binding(2) var outMaterial: texture_storage_2d<rgba8unorm, write>;

// Injected generator: fn materialShape(ctx: MatCtx) -> MatSample
//#include "../templates/{{MATERIAL}}.wgsl"

fn packSrgb(c: vec3f) -> vec3f { return linearToSrgb(clamp(c, vec3f(0.0), vec3f(1.0))); }

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.dims.x || gid.y >= P.dims.y) { return; }
  let uv = (vec2f(gid.xy) + vec2f(0.5)) / vec2f(P.dims);

  var ctx: MatCtx;
  ctx.uv = uv;
  ctx.world = P.worldSize;
  ctx.height = maskFetch(inHeight, P.textureRes, uv);
  ctx.slope = maskFetch(inSlope, P.textureRes, uv);
  ctx.flow = maskFetch(inFlow, P.textureRes, uv);
  ctx.deposit = maskFetch(inDeposit, P.textureRes, uv);
  ctx.curvature = maskFetch(inCurvature, P.textureRes, uv);
  ctx.ao = maskFetch(inAo, P.textureRes, uv);
  ctx.seed = fract(P.seed * 7.31);
  ctx.rampCount = P.rampCount;
  ctx.padU = 0u;
  ctx.padF = 0.0;
  ctx.lp = P.lp;
  ctx.ramp = P.ramp;
  ctx.tint = P.tint;
  ctx.detail = P.detail;
  ctx.extras = P.extras;

  let sample0 = materialShape(ctx);

  let m = evalMaskSet(
    P.masks, P.maskCount, uv, P.textureRes,
    inHeight, inSlope, inCurvature, inFlow, inDeposit, inPaint, inSketch);

  // Wetness keeps material influence alive along rivers and shorelines even
  // when the mask stack does not mention it.
  let weight = saturate(m * saturate(P.amount) * mix(1.0, saturate(ctx.flow * 2.5 + 0.35), P.extras.z));

  var color = shiftHue(sample0.albedo, ctx.tint.x, ctx.tint.y, ctx.tint.z);
  color = clamp(color, vec3f(0.0), vec3f(1.0));

  let rough = clamp(mix(P.roughRange.x, P.roughRange.y, sample0.variation) * sample0.roughMod, 0.03, 1.0);
  let metal = clamp(P.roughRange.z * sample0.metalMod, 0.0, 1.0);
  let detail = saturate(sample0.detail) * P.roughRange.w;
  let wear = saturate(sample0.wear) * P.extras.y;

  textureStore(outWeight, vec2i(gid.xy), vec4f(weight, 0.0, 0.0, 1.0));
  textureStore(outColor, vec2i(gid.xy), vec4f(packSrgb(color), 1.0));
  textureStore(outMaterial, vec2i(gid.xy), vec4f(rough, metal, detail, wear));
}
