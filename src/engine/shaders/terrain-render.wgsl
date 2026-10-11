// =================================================================================================

#include "scene.wgsl"
#include "materials.wgsl"
//  terrain-render.wgsl — sky, terrain surface, wireframe overlay, shadow depth
// -------------------------------------------------------------------------------------------------
//  The terrain is displaced in the vertex stage from the height texture, so the mesh carries no
//  position data at all — only an index buffer. That keeps a 1024² grid at 12 MB instead of 36 MB
//  and lets the mesh resolution change without rebuilding anything.
//
//  The fragment stage walks the texture stack bottom to top, evaluates each visible layer's
//  procedural material once, and composites with a height blend.
// =================================================================================================

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) uv: vec2f,
  @location(2) viewDepth: f32,
};

fn vertexWorld(vi: u32) -> vec3f {
  let m = i32(Ter.p0.w);
  let x = i32(vi) % m;
  let y = i32(vi) / m;
  let uv = vec2f(f32(x), f32(y)) / f32(m - 1);
  let h = heightAtUV(uv);
  return worldPosFromUV(uv, h);
}

@vertex
fn vsTerrain(@builtin(vertex_index) vi: u32) -> VSOut {
  let m = i32(Ter.p0.w);
  let x = i32(vi) % m;
  let y = i32(vi) / m;
  let uv = vec2f(f32(x), f32(y)) / f32(m - 1);
  let world = vertexWorld(vi);
  var out: VSOut;
  out.pos = Cam.viewProj * vec4f(world, 1.0);
  out.world = world;
  out.uv = uv;
  out.viewDepth = -(Cam.view * vec4f(world, 1.0)).z;
  return out;
}

// --- shadow depth ---------------------------------------------------------------------------------
// Group 1 carries one view-projection matrix per cascade, so the same pipeline draws all three.

@group(1) @binding(0) var<uniform> lightViewProj: mat4x4f;

@vertex
fn vsShadow(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  return lightViewProj * vec4f(vertexWorld(vi), 1.0);
}

// --- sky ------------------------------------------------------------------------------------------

struct SkyOut {
  @builtin(position) pos: vec4f,
  @location(0) ndc: vec2f,
};

@vertex
fn vsSky(@builtin(vertex_index) vi: u32) -> SkyOut {
  var tri = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var out: SkyOut;
  out.ndc = tri[vi];
  out.pos = vec4f(tri[vi], 1.0, 1.0);
  return out;
}

@fragment
fn fsSky(in: SkyOut) -> @location(0) vec4f {
  let dir = viewRay(in.ndc);
  let steps = clamp(i32(Ter.p4.z), 4, 32);
  let L = skyRadiance(transLut, lutSampler, Atmo, Cam.position.y, dir, steps, true);
  return vec4f(L, 1.0);
}

// --- layer masks ----------------------------------------------------------------------------------
// 0 everywhere · 1 altitude · 2 slope · 3 curvature · 4 fractal noise · 5 flow / wetness ·
// 6 aspect · 7 below water level

fn layerWeight(
  L: LayerData,
  world: vec3f,
  N: vec3f,
  slope: f32,
  curv: f32,
  wet: f32,
  hNorm: f32,
  pixelWorld: f32
) -> f32 {
  let mode = L.p0.z;
  let feather = max(L.msk.z, 1e-3);
  var lo = L.msk.x;
  var hi = L.msk.y;
  var v = 1.0;

  if (mode == 1u) {
    v = hNorm;
  } else if (mode == 2u) {
    v = slope;
  } else if (mode == 3u) {
    v = 0.5 + 0.5 * curv;
    lo = lo * 0.5 + 0.5;
    hi = hi * 0.5 + 0.5;
  } else if (mode == 4u) {
    let nz = fbmd3(world / max(L.msk2.x, 0.5), 3, 2.0, 0.5, u32(L.msk2.z)).x;
    v = clamp(0.5 + 0.5 * nz * L.msk2.y, 0.0, 1.0);
  } else if (mode == 5u) {
    v = wet;
  } else if (mode == 6u) {
    let d = vec2f(cos(L.msk2.w), sin(L.msk2.w));
    let horiz = N.xz;
    let len = max(length(horiz), 1e-4);
    v = clamp(dot(horiz / len, d) * 0.5 + 0.5, 0.0, 1.0);
  } else if (mode == 7u) {
    v = clamp((Ter.p1.x - hNorm) * 8.0, 0.0, 1.0);
  } else {
    return 1.0;
  }

  var m: f32;
  if (mode == 6u) {
    // Aspect is directional, not a band: the power widens or narrows the lobe.
    m = pow(clamp(v, 0.0, 1.0), max(L.msk3.y, 0.05));
    m = smoothstepv(lo - feather, min(lo + feather, 1.0), m);
  } else {
    m = smoothstepv(lo - feather, lo + feather, v) * (1.0 - smoothstepv(hi - feather, hi + feather, v));
  }

  // Contrast pivots the mask around 0.5.
  m = clamp((m - 0.5) * max(L.msk.w, 0.01) + 0.5, 0.0, 1.0);
  if ((L.p0.w & 1u) != 0u) { m = 1.0 - m; }

  let si = clamp(L.msk3.z, 0.0, 1.0);
  m = m * mix(1.0, smoothstepv(0.12, 0.72, slope), si);
  return m;
}

// --- surface --------------------------------------------------------------------------------------

@fragment
fn fsTerrain(in: VSOut) -> @location(0) vec4f {
  let uv = in.uv;
  let world = in.world;

  let surf = textureSampleLevel(surfTex, linearSampler, uv, 0.0);
  let nrm = textureSampleLevel(normalTex, linearSampler, uv, 0.0);
  var N = normalize(nrm.xyz);
  let slope = clamp(nrm.w, 0.0, 1.0);
  let hNorm = heightAtUV(uv);
  let alt = world.y;
  let curv = clamp(surf.y, -1.0, 1.0);
  let wet = clamp(surf.z, 0.0, 1.0);
  let cavity = clamp(surf.w, -1.0, 1.0);
  let ao = pow(clamp(surf.x, 0.0, 1.0), max(Ter.p2.x, 0.05));

  let camPos = Cam.position.xyz;
  let toEye = camPos - world;
  let dist = length(toEye);
  let V = toEye / max(dist, 1e-4);
  let pixelWorld = max(length(dpdx(world)), length(dpdy(world))) * exp2(Ter.p3.y);

  // --- texture stack ------------------------------------------------------------------------------
  var accAlbedo = vec3f(0.0);
  var accRough = 0.85;
  var accMetal = 0.0;
  var accGrad = vec3f(0.0);
  var accHeight = 0.0;
  var accStrength = 1.0;
  var accWeight = 0.0;

  let count = min(i32(Ter.p2.w), i32(arrayLength(&layers)));
  for (var i = 0; i < count; i = i + 1) {
    let L = layers[i];
    if (L.p0.y == 0u) { continue; }
    let m = layerWeight(L, world, N, slope, curv, wet, hNorm, pixelWorld);
    if (m <= 0.002) { continue; }
    let S = evalMaterial(L, world, N, pixelWorld, 7471u);
    let w = m * clamp(L.prm2.x, 0.0, 1.0);
    // Height blend: a layer wins where it physically sits higher, so gravel settles into the
    // hollows of the rock beneath it instead of being painted over it.
    let dh = (S.height - accHeight) * L.prm.w + L.prm2.w;
    let t = clamp(w + dh, 0.0, 1.0);
    accAlbedo = mix(accAlbedo, S.albedo, t);
    accRough = mix(accRough, S.rough, t);
    accMetal = mix(accMetal, S.metal, t);
    accGrad = mix(accGrad, S.grad, t);
    accStrength = mix(accStrength, L.prm.x, t);
    accHeight = mix(accHeight, S.height, t);
    accWeight = accWeight + t * (1.0 - accWeight);
  }

  // Anything the stack did not cover falls back to a neutral base rock rather than to black.
  if (accWeight < 0.999) {
    let k = 1.0 - accWeight;
    accAlbedo = mix(accAlbedo, vec3f(0.30, 0.28, 0.26), k);
    accRough = mix(accRough, 0.88, k);
    accGrad = mix(accGrad, vec3f(0.0), k);
    accStrength = mix(accStrength, 1.0, k);
  }

  // Wetness: water in the pore space darkens the albedo and sharpens the reflection. Sources are
  // the solver's flow field and proximity to the water plane.
  let belowWater = clamp((Ter.p1.x - hNorm) * 6.0, 0.0, 1.0);
  let wetK = clamp(max(wet, belowWater) * Ter.p2.z, 0.0, 1.0);
  accAlbedo = accAlbedo * mix(1.0, 0.52, wetK);
  accRough = mix(accRough, accRough * 0.4 + 0.03, wetK);
  accStrength = accStrength * mix(1.0, 0.55, wetK);

  N = applyBump(N, accGrad, accStrength * Ter.p3.x);

  // --- occlusion ----------------------------------------------------------------------------------
  let ambOcc = clamp(ao * (1.0 + cavity * Ter.p2.y) * mix(1.0, 0.78, max(-curv, 0.0)), 0.0, 1.0);
  let NdotV = max(dot(N, V), 1e-4);

  // --- sun ----------------------------------------------------------------------------------------
  let sunDir = Atmo.p4.xyz;
  let sunT = sampleTransmittance(transLut, lutSampler, Atmo, alt, sunDir.y);
  let sunRadiance = Atmo.p4.w * sunT;
  let shadow = shadowAt(world, N, in.viewDepth);
  let NdotLraw = dot(N, sunDir);
  // A touch of wrap lighting: soil, grass and snow all transmit a little.
  let wrap = clamp(Ter.p3.w, 0.0, 1.0);
  let NdotL = max(0.0, (NdotLraw + wrap) / (1.0 + wrap));

  var color = accAlbedo * INV_PI * sunRadiance * NdotL * shadow;

  let H = normalize(V + sunDir);
  let NdotH = max(dot(N, H), 0.0);
  let VdotH = max(dot(V, H), 0.0);
  let alpha = max(accRough * accRough, 0.0015);
  let F0 = mix(vec3f(0.04), accAlbedo, accMetal);
  let F = fresnelSchlick(F0, VdotH);
  color += distributionGGX(NdotH, alpha) * visibilitySmith(NdotV, max(NdotL, 0.0), alpha)
         * F * sunRadiance * max(NdotLraw, 0.0) * shadow;

  // --- sky ambient --------------------------------------------------------------------------------
  let E = shIrradiance(SH, N);
  color += accAlbedo * INV_PI * E * ambOcc;

  // Ground bounce: the lower hemisphere is terrain, not sky, and it is lit.
  let EUp = shIrradiance(SH, vec3f(0.0, 1.0, 0.0));
  let down = clamp(0.5 - 0.5 * N.y, 0.0, 1.0);
  color += accAlbedo * Atmo.p6.xyz * (EUp * INV_PI) * down * ambOcc * 0.7;

  // Specular sky reflection, only where it can be seen: rough terrain has no coherent reflection.
  if (accRough < 0.5) {
    let R = reflect(-V, N);
    if (R.y > -0.01) {
      let env = skyRadiance(transLut, lutSampler, Atmo, alt, R, 4, false);
      let Fenv = F0 + (vec3f(1.0) - F0) * pow(1.0 - NdotV, 4.0);
      color += env * Fenv * (1.0 - accRough) * ambOcc;
    }
  }

  // --- aerial perspective -------------------------------------------------------------------------
  let steps = clamp(i32(Ter.p4.z), 4, 16);
  let ap = aerialPerspective(transLut, lutSampler, Atmo, camPos.y, -V, dist, steps);
  color = color * ap.transmittance + ap.inscatter;

  // --- diagnostics --------------------------------------------------------------------------------
  let dbg = u32(Ter.p1.y);
  if (dbg == DEBUG_HEIGHT) { color = rampHeight(clamp(hNorm, 0.0, 1.0)) * 1.4; }
  else if (dbg == DEBUG_SLOPE) { color = rampHeight(clamp(slope * 1.6, 0.0, 1.0)); }
  else if (dbg == DEBUG_NORMAL) { color = N * 0.5 + vec3f(0.5); }
  else if (dbg == DEBUG_AO) { color = vec3f(ao); }
  else if (dbg == DEBUG_CURV) { color = vec3f(0.5 + 0.5 * curv); }
  else if (dbg == DEBUG_FLOW) { color = rampHeight(1.0 - clamp(wet * 1.5, 0.0, 1.0)) * 1.2; }
  else if (dbg == DEBUG_ROUGH) { color = vec3f(accRough); }
  else if (dbg == DEBUG_ALBEDO) { color = accAlbedo; }

  return vec4f(max(color, vec3f(0.0)), 1.0);
}

// --- wireframe overlay ----------------------------------------------------------------------------

@fragment
fn fsWire(in: VSOut) -> @location(0) vec4f {
  let h = heightAtUV(in.uv);
  let t = clamp(h, 0.0, 1.0);
  let c = mix(vec3f(0.25, 0.42, 0.55), vec3f(0.95, 0.72, 0.42), t);
  return vec4f(c * 1.5, 1.0);
}
