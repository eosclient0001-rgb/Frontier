// ===========================================================================
//  geology.wgsl — the stratigraphic model.
//
//  This is the heart of the whole look. Every bed in the rock column has a
//  hardness, and hardness drives BOTH how fast erosion removes the rock AND
//  what colour it is. Because they come from one analytic function:
//
//    * ledges always form on resistant beds and never in the wrong place;
//    * the colour banding always follows the geometry exactly;
//    * bed contacts stay perfectly sharp no matter how coarse the voxel grid
//      is, because hardness is never stored — it is evaluated on demand.
//
//  That last point is why this does not look like a heightmap with a texture
//  on it. The strata are a genuine 3D volumetric property of the rock.
// ===========================================================================

#include "common.wgsl"

/// Stratigraphic coordinate: "how far up the rock column am I".
/// Constant along a bedding plane, increasing upward through the sequence.
fn strataCoord(p: vec3f) -> f32 {
  // Bedding-plane normal from dip + dip azimuth.
  let az = radians(U.strataAzim);
  let dip = radians(U.strataDip);
  let n = vec3f(sin(az) * sin(dip), cos(dip), cos(az) * sin(dip));

  var s = dot(p, n);

  // Broad tectonic warping: monoclines, gentle folds.
  s += U.foldAmp * fbm2(p.xz * U.foldFreq + vec2f(U.seed * 3.1, U.seed * 1.7), 3);

  // Individual beds are not perfectly planar.
  s += U.strataWarp * fbm3(p * U.strataWarpFreq + vec3f(U.seed * 0.7), 3);

  return s;
}

/// Intrinsic hardness of the bed at stratigraphic height `s`, in 0..1.
/// A fraction `capFrac` of beds are resistant caprock; the rest are recessive.
fn bedHardness(s: f32) -> f32 {
  let t = s / max(U.bedThickness, 0.5);
  let bi = floor(t);
  let frac = t - bi;

  // Two adjacent beds so we can smooth the contact by a small amount.
  let r0 = hash11(bi * 1.0 + U.seed * 13.7);
  let r1 = hash11(bi + 1.0 + U.seed * 13.7);

  // Map the random draw through the resistant-fraction threshold.
  // Values above (1 - capFrac) become caprock.
  let thr = 1.0 - saturate(U.capFrac);
  let h0 = select(r0 * thr * 0.55, 0.62 + 0.38 * (r0 - thr) / max(1.0 - thr, 1e-3), r0 > thr);
  let h1 = select(r1 * thr * 0.55, 0.62 + 0.38 * (r1 - thr) / max(1.0 - thr, 1e-3), r1 > thr);

  // Bed contacts are sharp, but not infinitely so — a thin transition zone
  // keeps the level-set solver stable and mimics gradational contacts.
  let w = 0.06;
  let m = smoothstep(1.0 - w, 1.0, frac);
  var h = mix(h0, h1, m);

  // Sub-bed lamination: fine internal layering within each bed.
  h += 0.05 * sin(t * TAU * 3.0 + hash11(bi) * TAU);

  return saturate(h);
}

/// Joint / fracture network. Returns 1 in intact rock, falling toward 0 on a
/// fracture plane. Joints are why desert cliffs break into fins, columns and
/// slot canyons instead of eroding into smooth mounds.
fn jointFactor(p: vec3f) -> f32 {
  let q = p.xz * U.jointDensity;

  // Primary joint set.
  let e1 = voronoiEdge(q + vec2f(U.seed * 2.3, U.seed * 5.1), U.jointJitter);
  // Secondary set, rotated and at a different scale — gives the cross-hatched
  // block pattern seen on real cliff faces.
  let r = 0.7071;
  let q2 = vec2f(q.x * r - q.y * r, q.x * r + q.y * r) * 1.63;
  let e2 = voronoiEdge(q2 + vec2f(U.seed * 1.1, U.seed * 7.7), U.jointJitter);

  // Joints do not run the full height — they tip out vertically.
  let vfade = 0.65 + 0.35 * fbm3(p * 0.006 + vec3f(0.0, U.seed, 0.0), 2);

  let w = 0.055;
  let j1 = smoothstep(0.0, w, e1);
  let j2 = smoothstep(0.0, w * 0.8, e2);
  let j = min(j1, mix(1.0, j2, 0.6));

  return mix(1.0, j, saturate(U.jointDepth) * vfade);
}

/// Full erosional resistance of the rock at a point, in 0..1.
/// 0 = washes away instantly, 1 = essentially immovable.
fn rockHardness(p: vec3f) -> f32 {
  let s = strataCoord(p);
  var h = bedHardness(s);

  // Apply the hardness contrast slider around the mid-point. This is the
  // single most important control for the cliff-and-bench profile.
  h = saturate(0.5 + (h - 0.5) * U.hardContrast);

  // Fractures locally destroy strength.
  h *= jointFactor(p);

  // Crystalline basement below the sedimentary pile: very hard, unlayered.
  // This is what stops a river cutting down forever and gives the inner gorge
  // its narrow, dark, steep-walled character.
  let by = U.basementY * WORLD_H;
  let bmix = 1.0 - smoothstep(by - 22.0, by + 22.0, p.y);
  let basement = U.basementHard * (0.82 + 0.18 * fbm3(p * 0.012, 3));
  h = mix(h, max(h, basement), bmix);

  return saturate(h);
}

/// Cheap hardness for use inside hot loops — skips the joint voronoi.
fn rockHardnessFast(p: vec3f) -> f32 {
  let s = strataCoord(p);
  var h = bedHardness(s);
  h = saturate(0.5 + (h - 0.5) * U.hardContrast);
  let by = U.basementY * WORLD_H;
  let bmix = 1.0 - smoothstep(by - 22.0, by + 22.0, p.y);
  return saturate(mix(h, max(h, U.basementHard), bmix));
}

// ---------------------------------------------------------------------------
//  Rock colour
//
//  Driven by the same stratigraphic field as the hardness, so colour and form
//  can never disagree. Resistant beds read as pale buff/grey limestone and
//  sandstone; recessive beds as red-brown mudstone and shale.
// ---------------------------------------------------------------------------
fn rockAlbedo(p: vec3f, hardness: f32, sediment: f32) -> vec3f {
  let s = strataCoord(p);
  let t = s / max(U.bedThickness, 0.5);
  let bi = floor(t);

  let r1 = hash11(bi * 2.17 + U.seed * 4.3);
  let r2 = hash11(bi * 5.71 + U.seed * 9.1);

  // Palette anchored on real Colorado Plateau formations.
  let redBed   = vec3f(0.396, 0.180, 0.118);  // Moenkopi / Organ Rock mudstone
  let orangeBd = vec3f(0.596, 0.318, 0.180);  // Wingate / Kayenta
  let buffBed  = vec3f(0.678, 0.569, 0.416);  // Navajo sandstone
  let paleBed  = vec3f(0.749, 0.722, 0.639);  // Kaibab limestone
  let greyBed  = vec3f(0.400, 0.388, 0.365);  // Hermit / Bright Angel shale

  // Soft beds skew red, hard beds skew pale — the real correlation.
  var c = mix(redBed, orangeBd, r1);
  c = mix(c, buffBed, smoothstep(0.35, 0.75, hardness));
  c = mix(c, paleBed, smoothstep(0.65, 0.95, hardness) * r2);
  c = mix(c, greyBed, (1.0 - smoothstep(0.1, 0.55, hardness)) * (1.0 - r1) * 0.5);

  // Per-bed colour variation slider.
  let variation = mix(vec3f(luma(c)), c, saturate(U.stratColor));
  c = mix(vec3f(luma(c)) * vec3f(1.05, 0.98, 0.92), variation, saturate(U.stratColor));

  // Iron oxide staining — the red in red rock. Concentrated in permeable beds
  // and blotchy rather than uniform.
  let ironMask = saturate(fbm3(p * 0.018 + vec3f(U.seed), 3) * 0.5 + 0.5);
  let iron = vec3f(0.52, 0.21, 0.10);
  c = mix(c, iron, saturate(U.ironStain) * ironMask * 0.45 * (1.0 - hardness * 0.4));

  // Freshly deposited sediment is lighter, duller and less saturated.
  let sedCol = mix(vec3f(0.60, 0.50, 0.38), vec3f(0.66, 0.58, 0.47), hash11(bi));
  c = mix(c, sedCol, saturate(sediment) * saturate(U.sedimentTint));

  return c;
}
