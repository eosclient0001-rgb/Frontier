// Final normal map: the macro surface normal from the height field, perturbed by
// procedural micro detail whose strength comes from the material stack, plus a
// cavity term in alpha. Sediment is stretched along the flow direction, which is
// what makes river beds and dune flanks read correctly under a moving sun.
//
//   group 1 : 0 height  1 material  2 flow  3 ao
//   group 2 : 0 out normal (rgba8unorm, tangent space, +Y up)
//#include "../lib/mathx.wgsl"
//#include "../lib/noise.wgsl"
//#include "../lib/params.wgsl"
//#include "../lib/heightf.wgsl"

struct NormalBakeParams {
  dims: vec2u,
  cellMeters: f32,
  heightScale: f32,
  exaggeration: f32,
  microScale: f32,
  microStrength: f32,
  seed: f32,
  pad0: f32,
};

@group(0) @binding(0) var<uniform> P: NormalBakeParams;
@group(1) @binding(0) var inHeight: texture_2d<f32>;
@group(1) @binding(1) var inMaterial: texture_2d<f32>;
@group(1) @binding(2) var inFlow: texture_2d<f32>;
@group(1) @binding(3) var inAo: texture_2d<f32>;
@group(2) @binding(0) var outNormal: texture_storage_2d<rgba8unorm, write>;

/// Height of the micro-detail surface, evaluated on the fly so the bump field can
/// depend on material data (frequency, anisotropy, strength) per texel.
fn microHeight(uv: vec2f, freq: f32, flowAmt: f32, seed: f32) -> f32 {
  // Anisotropy: stretch along the flow/streak direction so the grain follows
  // water and wind transport instead of sitting in a uniform fuzz.
  let ang = flowAmt * 3.14159;
  let q = rot2(uv * freq, ang);
  let a = vnoise2(q * vec2f(1.0, 0.35 + 0.65 * (1.0 - flowAmt)), seedOf(seed, 11u));
  let b = vnoise2(uv * freq * 2.7 + vec2f(17.3, 5.1), seedOf(seed, 29u));
  let c = worley2(uv * freq * 0.55, seedOf(seed, 47u));
  return a * 0.55 + b * 0.3 + (1.0 - saturate(c.x)) * 0.15;
}

@compute @workgroup_size(8, 8, 1)
fn main(@builtin(global_invocation_id) gid: vec3u) {
  if (gid.x >= P.dims.x || gid.y >= P.dims.y) { return; }
  let c = vec2i(gid.xy);
  let uv = (vec2f(gid.xy) + vec2f(0.5)) / vec2f(P.dims);
  let mat = textureLoad(inMaterial, c, 0);
  let flowAmt = textureLoad(inFlow, c, 0).x;

  // Macro normal from the height field.
  let nMacro = hNormal(inHeight, P.dims, vec2f(gid.xy), P.cellMeters, P.heightScale, P.exaggeration);

  // Micro normal by central differences of the procedural bump field, at a
  // frequency that follows the material's own detail scale.
  let freq = max(P.microScale, 4.0);
  let strength = saturate(mat.z) * P.microStrength * 0.02;
  let du = 1.0 / f32(P.dims.x);
  let hL = microHeight(uv - vec2f(du, 0.0), freq, flowAmt, P.seed);
  let hR = microHeight(uv + vec2f(du, 0.0), freq, flowAmt, P.seed);
  let hU = microHeight(uv - vec2f(0.0, du), freq, flowAmt, P.seed);
  let hD = microHeight(uv + vec2f(0.0, du), freq, flowAmt, P.seed);
  let bump = vec3f((hL - hR) * strength * P.cellMeters, (hU - hD) * strength * P.cellMeters, 1.0);

  // Blend the bump onto the macro normal (whiteout blending keeps the result a
  // unit vector without a second normalize).
  let n = normalize(vec3f(nMacro.xy * bump.z + bump.xy * nMacro.z, nMacro.z * bump.z));
  let enc = vec3f(n.x * 0.5 + 0.5, -n.y * 0.5 + 0.5, n.z * 0.5 + 0.5);
  let cavity = saturate(0.5 - hCurvature(inHeight, P.dims, vec2f(gid.xy), P.cellMeters) * 0.6);
  textureStore(outNormal, c, vec4f(enc, cavity));
}
