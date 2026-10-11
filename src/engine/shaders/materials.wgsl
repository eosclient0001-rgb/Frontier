// =================================================================================================

#include "noise.wgsl"
//  materials.wgsl — procedural PBR surface library for the TEXTURE STACK
// -------------------------------------------------------------------------------------------------
//  Every material is a signed height field H(p) evaluated in WORLD SPACE, together with its exact
//  gradient. That single evaluation gives, at no extra cost:
//      • a bump/normal perturbation      from grad(H)
//      • an albedo break-up              from H
//      • a cavity term                   from H, which supplies contact darkening
//      • a height-blend weight           from H, so gravel settles into the hollows of rock
//
//  World-space 3D noise is used instead of triplanar projection: there is no seam, no blend
//  weight, and vertical cliff faces are sampled with exactly the same fidelity as flats.
//
//  Frequencies are distance-faded. Without that, every distant slope turns into a shimmering
//  aliasing carpet, which is the single most recognisable failure of procedural terrain shading.
// =================================================================================================

struct MatProfile {
  macroAmp: f32,
  macroScale: f32,
  detailAmp: f32,
  detailScale: f32,
  detailFold: f32,     // 0 = smooth fBm, 1 = ridged (rock), -1 = billow (rounded)
  strataAmp: f32,
  strataFreq: f32,
  crackAmp: f32,
  crackScale: f32,
  crackSharp: f32,
  clumpAmp: f32,
  clumpScale: f32,
  rippleAmp: f32,
  rippleScale: f32,
  colorMix: f32,       // how strongly H drives the A->B albedo ramp
  grainRough: f32,     // roughness pushed around by the pattern
  sparkle: f32,
};

// 0 granite · 1 sandstone · 2 basalt · 3 scree · 4 cobble · 5 sand · 6 cracked earth · 7 soil ·
// 8 grass · 9 moss · 10 snow · 11 ice · 12 mud · 13 ash · 14 cliff rock
fn matProfile(kind: u32) -> MatProfile {
  var m: MatProfile;
  m.macroAmp = 0.35; m.macroScale = 9.0;
  m.detailAmp = 0.45; m.detailScale = 0.7; m.detailFold = 0.0;
  m.strataAmp = 0.0; m.strataFreq = 0.0;
  m.crackAmp = 0.0; m.crackScale = 3.0; m.crackSharp = 6.0;
  m.clumpAmp = 0.0; m.clumpScale = 0.4;
  m.rippleAmp = 0.0; m.rippleScale = 1.0;
  m.colorMix = 0.7; m.grainRough = 0.15; m.sparkle = 0.0;

  if (kind == 0u) {
    // Granite: crystalline grit, blocky jointing, specular flecks from quartz.
    m.macroAmp = 0.42; m.macroScale = 7.5;
    m.detailAmp = 0.5; m.detailScale = 0.55; m.detailFold = 0.6;
    m.crackAmp = 0.3; m.crackScale = 2.6; m.crackSharp = 7.0;
    m.colorMix = 0.85; m.grainRough = 0.22; m.sparkle = 0.25;
  } else if (kind == 1u) {
    // Sandstone: sedimentary banding is the signature; everything else is subordinate.
    m.macroAmp = 0.2; m.macroScale = 22.0;
    m.detailAmp = 0.22; m.detailScale = 1.4; m.detailFold = 0.0;
    m.strataAmp = 0.75; m.strataFreq = 0.85;
    m.crackAmp = 0.12; m.crackScale = 4.0; m.crackSharp = 8.0;
    m.colorMix = 0.95; m.grainRough = 0.1;
  } else if (kind == 2u) {
    // Basalt: columnar jointing plus vesicular pitting.
    m.macroAmp = 0.3; m.macroScale = 11.0;
    m.detailAmp = 0.55; m.detailScale = 0.38; m.detailFold = -0.5;
    m.crackAmp = 0.55; m.crackScale = 1.15; m.crackSharp = 5.0;
    m.colorMix = 0.6; m.grainRough = 0.3;
  } else if (kind == 3u) {
    // Scree: angular debris at every scale, no structure at all.
    m.macroAmp = 0.55; m.macroScale = 6.0;
    m.detailAmp = 0.95; m.detailScale = 0.33; m.detailFold = 0.7;
    m.crackAmp = 0.15; m.crackScale = 0.9; m.crackSharp = 4.0;
    m.colorMix = 0.8; m.grainRough = 0.25;
  } else if (kind == 4u) {
    // Cobble: rounded clasts, the inverse character of scree.
    m.macroAmp = 0.4; m.macroScale = 5.0;
    m.detailAmp = 0.9; m.detailScale = 0.5; m.detailFold = -0.85;
    m.clumpAmp = 0.5; m.clumpScale = 0.62;
    m.colorMix = 0.9; m.grainRough = 0.28;
  } else if (kind == 5u) {
    // Sand: wind ripples riding on large dune forms, grains finer than any other material.
    m.macroAmp = 0.5; m.macroScale = 26.0;
    m.detailAmp = 0.12; m.detailScale = 0.13; m.detailFold = 0.0;
    m.rippleAmp = 0.45; m.rippleScale = 0.42;
    m.colorMix = 0.35; m.grainRough = 0.08; m.sparkle = 0.15;
  } else if (kind == 6u) {
    // Cracked earth: polygonal desiccation polygons with curled edges.
    m.macroAmp = 0.35; m.macroScale = 14.0;
    m.detailAmp = 0.2; m.detailScale = 0.5; m.detailFold = 0.0;
    m.crackAmp = 0.95; m.crackScale = 0.62; m.crackSharp = 3.4;
    m.colorMix = 0.55; m.grainRough = 0.18;
  } else if (kind == 7u) {
    // Soil: aggregated crumbs, organic, slightly damp.
    m.macroAmp = 0.4; m.macroScale = 8.0;
    m.detailAmp = 0.35; m.detailScale = 0.11; m.detailFold = -0.2;
    m.clumpAmp = 0.65; m.clumpScale = 0.34;
    m.colorMix = 0.75; m.grainRough = 0.2;
  } else if (kind == 8u) {
    // Grass: tufts at two scales; the fine level is nearly noise-like and fades fast with distance.
    m.macroAmp = 0.45; m.macroScale = 5.0;
    m.detailAmp = 0.5; m.detailScale = 0.055; m.detailFold = 0.3;
    m.clumpAmp = 0.8; m.clumpScale = 0.26;
    m.colorMix = 0.9; m.grainRough = 0.1;
  } else if (kind == 9u) {
    // Moss: soft, fine, water-retentive.
    m.macroAmp = 0.45; m.macroScale = 4.0;
    m.detailAmp = 0.55; m.detailScale = 0.045; m.detailFold = -0.3;
    m.clumpAmp = 0.7; m.clumpScale = 0.19;
    m.colorMix = 0.85; m.grainRough = 0.12;
  } else if (kind == 10u) {
    // Snow: wind-packed sastrugi over drift; bright but not glossy, with a little sparkle.
    m.macroAmp = 0.6; m.macroScale = 18.0;
    m.detailAmp = 0.22; m.detailScale = 0.07; m.detailFold = 0.0;
    m.rippleAmp = 0.3; m.rippleScale = 0.75;
    m.colorMix = 0.4; m.grainRough = 0.14; m.sparkle = 0.7;
  } else if (kind == 11u) {
    // Ice: contraction cracks and internal fracture, blue in the depths.
    m.macroAmp = 0.5; m.macroScale = 16.0;
    m.detailAmp = 0.18; m.detailScale = 0.6; m.detailFold = 0.0;
    m.crackAmp = 0.7; m.crackScale = 2.2; m.crackSharp = 6.5;
    m.colorMix = 0.5; m.grainRough = -0.25; m.sparkle = 0.3;
  } else if (kind == 12u) {
    // Mud: plastic, wet, rippled where it flowed.
    m.macroAmp = 0.5; m.macroScale = 9.0;
    m.detailAmp = 0.22; m.detailScale = 0.2; m.detailFold = -0.4;
    m.rippleAmp = 0.4; m.rippleScale = 0.55;
    m.colorMix = 0.45; m.grainRough = -0.3;
  } else if (kind == 13u) {
    // Ash: fine, structureless, drifted.
    m.macroAmp = 0.6; m.macroScale = 20.0;
    m.detailAmp = 0.28; m.detailScale = 0.1; m.detailFold = -0.2;
    m.clumpAmp = 0.3; m.clumpScale = 1.1;
    m.colorMix = 0.5; m.grainRough = 0.05;
  } else if (kind == 14u) {
    // Cliff rock: vertical sheeting and bedding planes exposed on the face.
    m.macroAmp = 0.4; m.macroScale = 13.0;
    m.detailAmp = 0.4; m.detailScale = 0.5; m.detailFold = 0.75;
    m.strataAmp = 0.5; m.strataFreq = 0.5;
    m.crackAmp = 0.45; m.crackScale = 1.1; m.crackSharp = 6.0;
    m.colorMix = 0.9; m.grainRough = 0.2;
  }
  return m;
}

struct SurfaceHit {
  height: f32,
  grad: vec3f,
  albedo: vec3f,
  rough: f32,
  metal: f32,
  cavity: f32,
};

struct LayerData {
  p0: vec4u,     // kind, enabled, maskMode, flags
  colA: vec4f,   // albedo A (rgb), roughness
  colB: vec4f,   // albedo B (rgb), metalness
  prm: vec4f,    // normalStrength, detailScale (m), macroScale (m), heightContrast
  prm2: vec4f,   // opacity, colorVariation, roughVariation, heightOffset
  msk: vec4f,    // maskMin, maskMax, maskFeather, maskContrast
  msk2: vec4f,   // noiseScale (m), noiseContrast, seed, aspectDir (rad)
  msk3: vec4f,   // aspectSpread, aspectFeather, slopeInfluence, macroVariation
};

//-octave count shrinks as the pixel footprint grows past the feature size.
fn octavesFor(featureSize: f32, pixelWorld: f32, base: i32) -> i32 {
  let ratio = pixelWorld / max(featureSize, 1e-4);
  var drop = 0;
  if (ratio > 0.9) { drop = 3; }
  else if (ratio > 0.45) { drop = 2; }
  else if (ratio > 0.2) { drop = 1; }
  return max(base - drop, 1);
}

fn evalMaterial(L: LayerData, p: vec3f, N: vec3f, pixelWorld: f32, seedBase: u32) -> SurfaceHit {
  let prof = matProfile(L.p0.x);
  let seed = seedBase ^ u32(L.msk2.z);

  let detailScale = max(L.prm.y, 0.01);
  let macroScale = max(L.prm.z, 0.1);

  var h = 0.0;
  var g = vec3f(0.0);

  // --- macro form ---------------------------------------------------------------------------------
  {
    let oct = octavesFor(macroScale, pixelWorld, 3);
    let n = fbmd3(p / macroScale, oct, 2.07, 0.5, seed + 101u);
    h += prof.macroAmp * n.x;
    g += prof.macroAmp * n.yzw / macroScale;
  }

  // --- detail -------------------------------------------------------------------------------------
  {
    let oct = octavesFor(detailScale, pixelWorld, 4);
    let n = fbmd3(p / detailScale, oct, 2.13, 0.52, seed + 907u);
    var v = n.x;
    var dv = n.yzw / detailScale;
    if (prof.detailFold > 0.05) {
      // ridged: fold away from zero to make creases instead of blobs
      let f = 1.0 - abs(n.x);
      let k = mix(1.0, 2.0, prof.detailFold);
      v = pow(max(f, 1e-4), k) * 2.0 - 0.75;
      dv = (2.0 * k * pow(max(f, 1e-4), k - 1.0) * -sign(n.x)) * n.yzw / detailScale;
    } else if (prof.detailFold < -0.05) {
      // billow: rounded lobes
      let k = mix(1.0, 2.0, -prof.detailFold);
      v = pow(max(abs(n.x), 1e-4), 1.0 / k) * 2.0 - 0.9;
      let dvRaw = (2.0 / k) * pow(max(abs(n.x), 1e-4), 1.0 / k - 1.0) * sign(n.x);
      dv = dvRaw * n.yzw / detailScale;
    }
    let fade = clamp(1.0 - pixelWorld * 2.0 / detailScale, 0.0, 1.0);
    h += prof.detailAmp * v * fade;
    g += prof.detailAmp * dv * fade;
  }

  // --- sedimentary banding ----------------------------------------------------------------------
  if (prof.strataAmp > 0.001) {
    let warp = fbmd3(p / (macroScale * 1.7), 2, 2.0, 0.5, seed + 313u);
    // Bedding thickness varies, which is what makes strata read as geology rather than wallpaper.
    let thick = 0.55 + 0.45 * fbmd3(p / 140.0, 2, 2.0, 0.5, seed + 77u).x;
    let phase = p.y * prof.strataFreq * thick + warp.x * 1.6;
    let s = sin(phase);
    h += prof.strataAmp * s * 0.35;
    let dWarp = warp.yzw * (1.6 / (macroScale * 1.7));
    let dphase = dWarp + vec3f(0.0, prof.strataFreq * thick, 0.0);
    g += prof.strataAmp * cos(phase) * 0.35 * dphase;
  }

  // --- cracks / jointing -------------------------------------------------------------------------
  if (prof.crackAmp > 0.001) {
    let fade = clamp(1.0 - pixelWorld * 2.0 / prof.crackScale, 0.0, 1.0);
    if (fade > 0.001) {
      let n = noised3(p / prof.crackScale, seed + 2213u);
      let f = max(1.0 - abs(n.x), 1e-4);
      let k = prof.crackSharp;
      let crack = pow(f, k);
      h -= prof.crackAmp * crack * 0.6 * fade;
      g -= prof.crackAmp * 0.6 * fade * (k * pow(f, k - 1.0) * -sign(n.x)) * n.yzw / prof.crackScale;
    }
  }

  // --- clumping -----------------------------------------------------------------------------------
  if (prof.clumpAmp > 0.001) {
    let fade = clamp(1.0 - pixelWorld * 2.0 / prof.clumpScale, 0.0, 1.0);
    if (fade > 0.001) {
      let n = noised3(p / prof.clumpScale, seed + 4409u);
      let t = smoothstep(-0.25, 0.45, n.x);
      // derivative of smoothstep's cubic, zero once the ramp saturates
      let dt = 1.428571 * (0.75 - 0.75 * (2.0 * t - 1.0) * (2.0 * t - 1.0)) * select(0.0, 1.0, t > 0.0 && t < 1.0);
      h += prof.clumpAmp * (t - 0.5) * 0.8 * fade;
      g += prof.clumpAmp * 0.8 * fade * dt * n.yzw / prof.clumpScale;
    }
  }

  // --- ripples / sastrugi ------------------------------------------------------------------------
  if (prof.rippleAmp > 0.001) {
    let fade = clamp(1.0 - pixelWorld * 2.0 / prof.rippleScale, 0.0, 1.0);
    if (fade > 0.001) {
      let n = noised3(p / (prof.rippleScale * 4.0), seed + 6607u);
      // Crests run perpendicular to the prevailing wind, and wander.
      let dirv = normalize(vec2f(1.0, 0.35));
      let phase = dot(p.xz, dirv) * 6.2831853 / prof.rippleScale + n.x * 2.4;
      let s = sin(phase);
      h += prof.rippleAmp * s * 0.25 * fade;
      let dphase = vec3f(dirv.x, 0.0, dirv.y) * 6.2831853 / prof.rippleScale + n.yzw * 2.4 / (prof.rippleScale * 4.0);
      g += prof.rippleAmp * 0.25 * fade * cos(phase) * dphase;
    }
  }

  // --- albedo -------------------------------------------------------------------------------------
  let macroVar = fbmd3(p / (macroScale * 3.5), 2, 2.0, 0.5, seed + 8819u).x;
  let t = clamp(0.5 + 0.5 * h * prof.colorMix + macroVar * L.msk3.w * 0.5, 0.0, 1.0);
  var albedo = mix(L.colA.xyz, L.colB.xyz, t);
  // Per-grain speckle: real ground is never a smooth gradient of two colours.
  let speck = fbmd3(p / max(detailScale * 0.6, 0.02), 2, 2.1, 0.55, seed + 9973u).x;
  albedo = albedo * (1.0 + speck * L.prm2.y * 0.35);
  albedo = clamp(albedo, vec3f(0.0), vec3f(4.0));

  // Sparkle (quartz in granite, facets in snow) is a glint, not metalness: it reads as a local
  // dip in roughness on the peaks of the speckle field.
  let glint = max(speck, 0.0) * prof.sparkle;
  let rough = clamp(L.colA.w + prof.grainRough * speck * 0.5 + (t - 0.5) * L.prm2.z * 0.3 - glint * 0.14, 0.015, 1.0);
  let metal = clamp(L.colB.w, 0.0, 1.0);

  var out: SurfaceHit;
  out.height = clamp(h * 0.5 + 0.5, 0.0, 1.0);
  out.grad = g;
  out.albedo = albedo;
  out.rough = rough;
  out.metal = metal;
  out.cavity = clamp(h * 0.6, -1.0, 1.0);
  return out;
}
