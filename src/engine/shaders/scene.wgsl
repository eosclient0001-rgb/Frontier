// =================================================================================================

#include "noise.wgsl"
#include "atmosphere.wgsl"
//  scene.wgsl — shared frame bindings and lighting helpers
// -------------------------------------------------------------------------------------------------
//  One bind group, one layout, shared by the sky, terrain, wireframe and water pipelines. The
//  layout is declared explicitly on the host because the height texture is r32float, which is not
//  filterable and therefore cannot be inferred reliably by an automatic layout.
// =================================================================================================

struct Camera {
  viewProj: mat4x4f,
  invViewProj: mat4x4f,
  view: mat4x4f,
  position: vec4f,      // xyz = world position, w = exposure
  params: vec4f,        // near, far, tanHalfFovY, aspect
};

struct Terrain {
  p0: vec4f,   // extent(m), heightMeters, fieldRes, meshRes
  p1: vec4f,   // waterLevel(norm), debugView, time(s), texelWorld(m)
  p2: vec4f,   // aoStrength, cavityStrength, wetnessStrength, layerCount
  p3: vec4f,   // normalStrength, lodBias, shadowStrength, subsurface
  p4: vec4f,   // wireStep, cascadeCount, atmoQuality, renderScale
};

struct Shadow {
  lightViewProj: array<mat4x4f, 3>,
  cascadeSplits: vec4f,   // view space distances
  params: vec4f,          // 1/shadowDim, strength, normalBias(m), count
  spare: vec4f,
};

const DEBUG_NONE: u32 = 0u;
const DEBUG_HEIGHT: u32 = 1u;
const DEBUG_SLOPE: u32 = 2u;
const DEBUG_NORMAL: u32 = 3u;
const DEBUG_AO: u32 = 4u;
const DEBUG_CURV: u32 = 5u;
const DEBUG_FLOW: u32 = 6u;
const DEBUG_ROUGH: u32 = 7u;
const DEBUG_ALBEDO: u32 = 8u;
const DEBUG_WIRE: u32 = 9u;

@group(0) @binding(0) var<uniform> Cam: Camera;
@group(0) @binding(1) var<uniform> Ter: Terrain;
@group(0) @binding(2) var<uniform> Atmo: AtmoParams;
@group(0) @binding(3) var<uniform> Sha: Shadow;
@group(0) @binding(4) var heightTex: texture_2d<f32>;
@group(0) @binding(5) var normalTex: texture_2d<f32>;
@group(0) @binding(6) var surfTex: texture_2d<f32>;
@group(0) @binding(7) var linearSampler: sampler;
@group(0) @binding(8) var shadowSampler: sampler_comparison;
@group(0) @binding(9) var shadowTex: texture_depth_2d_array;
@group(0) @binding(10) var<storage, read> layers: array<LayerData>;
@group(0) @binding(11) var<storage, read> SH: SkySH;
@group(0) @binding(12) var transLut: texture_2d<f32>;
@group(0) @binding(13) var lutSampler: sampler;

const INV_PI: f32 = 0.318309886;

// --- height field ---------------------------------------------------------------------------------

fn fieldRes() -> f32 { return Ter.p0.z; }

fn heightAtUV(uv: vec2f) -> f32 {
  let r = fieldRes();
  let x = clamp(uv.x, 0.0, 1.0) * r - 0.5;
  let y = clamp(uv.y, 0.0, 1.0) * r - 0.5;
  let x0 = i32(floor(x));
  let y0 = i32(floor(y));
  let tx = x - floor(x);
  let ty = y - floor(y);
  let ri = i32(r);
  let h00 = textureLoad(heightTex, vec2i(clamp(x0, 0, ri - 1), clamp(y0, 0, ri - 1)), 0).x;
  let h10 = textureLoad(heightTex, vec2i(clamp(x0 + 1, 0, ri - 1), clamp(y0, 0, ri - 1)), 0).x;
  let h01 = textureLoad(heightTex, vec2i(clamp(x0, 0, ri - 1), clamp(y0 + 1, 0, ri - 1)), 0).x;
  let h11 = textureLoad(heightTex, vec2i(clamp(x0 + 1, 0, ri - 1), clamp(y0 + 1, 0, ri - 1)), 0).x;
  return mix(mix(h00, h10, tx), mix(h01, h11, tx), ty);
}

fn worldPosFromUV(uv: vec2f, h: f32) -> vec3f {
  return vec3f((uv.x - 0.5) * Ter.p0.x, h * Ter.p0.y, (uv.y - 0.5) * Ter.p0.x);
}

// --- view ray -------------------------------------------------------------------------------------

fn viewRay(ndc: vec2f) -> vec3f {
  let far4 = Cam.invViewProj * vec4f(ndc, 1.0, 1.0);
  return normalize(far4.xyz / far4.w - Cam.position.xyz);
}

// --- shadows -------------------------------------------------------------------------------------
// Three cascades with a short cross-fade at the boundary; without the fade the seam between two
// resolutions is visible as a hard line across the terrain whenever the sun is low.

fn shadowAt(worldPos: vec3f, N: vec3f, viewDepth: f32) -> f32 {
  if (Sha.params.y <= 0.0) { return 1.0; }
  var c = 0;
  if (viewDepth > Sha.cascadeSplits.x) { c = 1; }
  if (viewDepth > Sha.cascadeSplits.y) { c = 2; }
  let count = max(i32(Sha.params.w), 1);
  if (c >= count) { c = count - 1; }
  if (c < 0) { c = 0; }

  let biasPos = worldPos + N * max(Sha.params.z, 0.0);
  let texel = Sha.params.x;

  let lp = Sha.lightViewProj[c] * vec4f(biasPos, 1.0);
  if (lp.w <= 0.0) { return 1.0; }
  let proj = lp.xyz / lp.w;
  let uv = vec2f(proj.x * 0.5 + 0.5, 0.5 - proj.y * 0.5);
  if (uv.x < 0.001 || uv.x > 0.999 || uv.y < 0.001 || uv.y > 0.999 || proj.z > 1.0) { return 1.0; }

  let d = proj.z;
  var sum = 0.0;
  let rot = 2.39996323;
  for (var k = 0; k < 9; k = k + 1) {
    let a = f32(k) * rot;
    let rad = select(1.35, 0.75, k == 0);
    let off = vec2f(cos(a), sin(a)) * rad * texel;
    sum += textureSampleCompareLevel(shadowTex, shadowSampler, uv + off, c, d);
  }
  var s = sum / 9.0;

  // cross-fade into the next cascade over the last 12% of this one's range
  let split = select(Sha.cascadeSplits.x, select(Sha.cascadeSplits.y, 1e9, c >= 2), c >= 1);
  let t = (viewDepth - split * 0.88) / max(split * 0.12, 1.0);
  if (t > 0.0 && c + 1 < count) {
    let lp2 = Sha.lightViewProj[c + 1] * vec4f(biasPos, 1.0);
    let proj2 = lp2.xyz / lp2.w;
    let uv2 = vec2f(proj2.x * 0.5 + 0.5, 0.5 - proj2.y * 0.5);
    var sum2 = 0.0;
    for (var k = 0; k < 5; k = k + 1) {
      let a = f32(k) * rot + 1.0;
      let off = vec2f(cos(a), sin(a)) * 1.2 * texel;
      sum2 += textureSampleCompareLevel(shadowTex, shadowSampler, uv2 + off, c + 1, proj2.z);
    }
    s = mix(s, sum2 / 5.0, clamp(t, 0.0, 1.0));
  }
  return mix(1.0, clamp(s, 0.0, 1.0), clamp(Sha.params.y, 0.0, 1.0));
}

// --- BRDF -----------------------------------------------------------------------------------------

fn distributionGGX(NdotH: f32, alpha: f32) -> f32 {
  let a2 = alpha * alpha;
  let d = NdotH * NdotH * (a2 - 1.0) + 1.0;
  return a2 / max(3.14159265 * d * d, 1e-7);
}

fn visibilitySmith(NdotV: f32, NdotL: f32, alpha: f32) -> f32 {
  let a2 = alpha * alpha;
  let gv = NdotL * sqrt(NdotV * NdotV * (1.0 - a2) + a2);
  let gl = NdotV * sqrt(NdotL * NdotL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-7);
}

fn fresnelSchlick(f0: vec3f, VdotH: f32) -> vec3f {
  return f0 + (vec3f(1.0) - f0) * pow(clamp(1.0 - VdotH, 0.0, 1.0), 5.0);
}

fn applyBump(N: vec3f, grad: vec3f, strength: f32) -> vec3f {
  // Remove the component along the normal: only the tangential part of the gradient tilts it.
  let t = grad - N * dot(grad, N);
  return normalize(N - t * strength);
}

// --- debug colour ramps ---------------------------------------------------------------------------

fn rampHeight(t: f32) -> vec3f {
  let c1 = vec3f(0.09, 0.20, 0.38);
  let c2 = vec3f(0.13, 0.42, 0.30);
  let c3 = vec3f(0.72, 0.66, 0.34);
  let c4 = vec3f(0.82, 0.55, 0.35);
  let c5 = vec3f(0.98, 0.97, 0.96);
  var c = mix(c1, c2, smoothstep(0.0, 0.25, t));
  c = mix(c, c3, smoothstep(0.25, 0.5, t));
  c = mix(c, c4, smoothstep(0.5, 0.75, t));
  c = mix(c, c5, smoothstep(0.75, 1.0, t));
  return c;
}
