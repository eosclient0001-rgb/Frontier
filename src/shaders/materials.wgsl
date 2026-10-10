// ─────────────────────────────────────────────────────────────────────────────
//  Procedural surface materials.
//
//  Every material returns albedo + roughness + the *world-space gradient* of
//  its relief, so the shading pass can build exact bump normals instead of
//  finite-differencing. Relief is expressed in metres, which keeps the look
//  consistent when the terrain scale changes.
// ─────────────────────────────────────────────────────────────────────────────

#include "lib.wgsl"

struct MatSample {
  albedo: vec3<f32>,
  rough: f32,
  grad: vec3<f32>,    // d(relief)/d(world), metres per metre
  height: f32,        // 0..1 relief proxy, for height-blending between layers
  occ: f32,           // small-scale occlusion baked into the relief
  metal: f32,
}

// material ids
const MAT_ROCK: u32 = 0u;
const MAT_SEDIMENT: u32 = 1u;
const MAT_BASALT: u32 = 2u;
const MAT_SCREE: u32 = 3u;
const MAT_GRAVEL: u32 = 4u;
const MAT_SAND: u32 = 5u;
const MAT_DUNE: u32 = 6u;
const MAT_DIRT: u32 = 7u;
const MAT_DRYGRASS: u32 = 8u;
const MAT_GRASS: u32 = 9u;
const MAT_MOSS: u32 = 10u;
const MAT_FOREST: u32 = 11u;
const MAT_SNOW: u32 = 12u;
const MAT_ICE: u32 = 13u;
const MAT_MUD: u32 = 14u;
const MAT_RIVERSTONE: u32 = 15u;
const MAT_ASH: u32 = 16u;
const MAT_BEACHSAND: u32 = 17u;
const MAT_CLAY: u32 = 18u;

// ── shared helpers ───────────────────────────────────────────────────────────

/// Triplanar fBm with a world-space gradient. `freq` is cycles per metre.
fn triFbm(p: vec3<f32>, n: vec3<f32>, freq: f32, oct: f32) -> vec4<f32> {
  let w = pow(abs(n) + 1e-4, vec3<f32>(4.0));
  let ws = w.x + w.y + w.z;
  let fx = fbm2(p.zy * freq, oct, 2.03, 0.5);
  let fy = fbm2(p.xz * freq, oct, 2.03, 0.5);
  let fz = fbm2(p.xy * freq, oct, 2.03, 0.5);
  let v = (fx.x * w.x + fy.x * w.y + fz.x * w.z) / ws;
  let gx = vec3<f32>(0.0, fx.z, fx.y) * freq * w.x;
  let gy = vec3<f32>(fy.y, 0.0, fy.z) * freq * w.y;
  let gz = vec3<f32>(fz.y, fz.z, 0.0) * freq * w.z;
  return vec4<f32>(v, (gx + gy + gz) / ws);
}

/// Triplanar ridged fBm with gradient — sharp crests for rock and scree.
fn triRidged(p: vec3<f32>, n: vec3<f32>, freq: f32, oct: f32, sharp: f32) -> vec4<f32> {
  let w = pow(abs(n) + 1e-4, vec3<f32>(4.0));
  let ws = w.x + w.y + w.z;
  let fx = ridged2(p.zy * freq, oct, 2.03, 0.5, sharp);
  let fy = ridged2(p.xz * freq, oct, 2.03, 0.5, sharp);
  let fz = ridged2(p.xy * freq, oct, 2.03, 0.5, sharp);
  let v = (fx.x * w.x + fy.x * w.y + fz.x * w.z) / ws;
  let gx = vec3<f32>(0.0, fx.z, fx.y) * freq * w.x;
  let gy = vec3<f32>(fy.y, 0.0, fy.z) * freq * w.y;
  let gz = vec3<f32>(fz.y, fz.z, 0.0) * freq * w.z;
  return vec4<f32>(v, (gx + gy + gz) / ws);
}

/// Worley cell edges (F2 - F1) — cracks, plates, pebble outlines.
fn cellEdge(p: vec2<f32>, scale: f32) -> f32 {
  let w = worley2(p * scale);
  return sat(w.y - w.x);
}

/// Cheap high-frequency grain that does not alias too badly.
fn grain(p: vec3<f32>, freq: f32) -> f32 {
  return vnoise2(p.xz * freq + p.y * 0.37) * 0.6 + vnoise2(p.zx * freq * 2.13 - p.y * 0.19) * 0.4;
}

fn tint(c: vec3<f32>, satAdj: f32, valAdj: f32) -> vec3<f32> {
  let l = dot(c, vec3<f32>(0.2126, 0.7152, 0.0722));
  return sat3(mix(vec3<f32>(l), c, satAdj) * valAdj);
}

/// Blend two colours with a noisy mask, keeping gradients well behaved.
fn mixn(a: vec3<f32>, b: vec3<f32>, t: f32) -> vec3<f32> { return mix(a, b, sat(t)); }

/// Distance-based fade of high-frequency detail. `pw` = world size of a pixel.
fn detailFade(pw: f32, feature: f32) -> f32 {
  return 1.0 - sat(smoothstep(feature * 0.35, feature * 2.2, pw));
}

// ─────────────────────────────────────────────────────────────────────────────
//  Individual materials
//
//  a0 = (freq, detailFreq, macroFreq, seed)
//  a1 = (relief, roughness, roughVar, metalness)
//  a2 = (contrast, colourVar, saturation, wetness)
//  a3 = (featureFreq, featureSharp, bandFreq, bandAmp)
//  a4 = (grainFreq, grainAmp, sparkle, spare)
//  c0 = colour A      c1 = colour B
// ─────────────────────────────────────────────────────────────────────────────

struct MatIn {
  p: vec3<f32>,     // world position
  n: vec3<f32>,     // geometric normal
  a: array<vec4<f32>, 10>,
  c: array<vec4<f32>, 2>,
  pw: f32,          // pixel world footprint
  slope: f32,
}

fn matSample(in: MatIn, id: u32) -> MatSample {
  var s: MatSample;
  s.albedo = vec3<f32>(0.5);
  s.rough = 0.85;
  s.grad = vec3<f32>(0.0);
  s.height = 0.5;
  s.occ = 1.0;
  s.metal = 0.0;

  let sd = in.a[0].w;
  let off = vec2<f32>(sd * 31.7, sd * 17.3);
  let relief = in.a[1].x;
  let rough = in.a[1].y;
  let roughVar = in.a[1].z;
  let colA = in.c[0].xyz;
  let colB = in.c[1].xyz;
  let freq = in.a[0].x;
  let dfreq = in.a[0].y;
  let mfreq = in.a[0].z;

  switch (id) {
    // ── Alpine rock: granite, fractured, with strata on cliff faces ──────────
    case MAT_ROCK: {
      let macroN = fbm2(in.p.xz * mfreq + off, 4.0, 2.0, 0.5);
      let meso = triFbm(in.p, in.n, freq, 4.0);
      let micro = triFbm(in.p, in.n, dfreq, 3.0);
      let cr = cellEdge(in.p.xz + in.p.y * 0.6, in.a[3].x);
      let crack = 1.0 - sat(smoothstep(0.0, in.a[3].y * 0.12 + 0.02, cr));
      let strata = vnoise2(vec2<f32>(in.p.y * in.a[3].z, in.p.x * 0.05)) * 0.5 + 0.5;
      let band = mix(1.0, 0.75 + 0.5 * strata, in.a[3].w * sat(in.slope * 2.0));

      var t = sat(macroN.x * 0.5 + 0.5);
      t = sat((t - 0.5) * (1.0 + in.a[2].x) + 0.5 + (micro.x * 0.18));
      var alb = mixn(colA, colB, t) * band;
      alb = mix(alb * 0.42, alb, crack);
      let speck = hash12(floor(in.p.xz * dfreq * 6.0) + floor(in.p.y * dfreq * 6.0));
      alb *= 0.86 + 0.28 * speck;
      alb *= 0.9 + 0.2 * in.a[2].y * macroN.x;

      s.albedo = tint(alb, in.a[2].z, 1.0);
      s.rough = sat(rough + roughVar * micro.x - 0.08 * (1.0 - crack));
      s.grad = (meso.yzw * 0.7 + micro.yzw * 0.3) * relief;
      s.height = sat(meso.x * 0.5 + 0.5);
      s.occ = mix(0.55, 1.0, crack);
    }
    // ── Sedimentary: warped horizontal beds, alternating tints ───────────────
    case MAT_SEDIMENT: {
      let warp = fbm2(in.p.xz * mfreq * 0.6 + off, 3.0, 2.0, 0.5).x * 1.6;
      let bedPhase = in.p.y * in.a[3].z + warp;
      var bed = fract(bedPhase);
      let bedIdx = floor(bedPhase);
      let idr = hash12(vec2<f32>(bedIdx, sd));
      // each bed has its own thickness and colour
      let thick = 0.35 + 0.65 * hash12(vec2<f32>(bedIdx * 1.7, sd * 3.1));
      let e = sat(bed / max(thick, 0.05));
      let edge = smoothstep(0.0, 0.14, e) * (1.0 - smoothstep(0.86, 1.0, e));
      let meso = triFbm(in.p, in.n, freq, 4.0);
      let micro = triFbm(in.p, in.n, dfreq, 3.0);
      let gr = grain(in.p, in.a[4].x);

      var alb = mixn(colA, colB, idr * 0.85 + 0.15 * sat(meso.x * 0.5 + 0.5));
      alb = tint(alb, in.a[2].z, 1.0);
      alb *= 0.72 + 0.28 * edge;                       // recessed bed joints
      alb *= 0.94 + 0.12 * gr * in.a[4].y;
      let cr = cellEdge(in.p.xz + in.p.y * 0.6, in.a[3].x);
      alb *= mix(1.0, 0.6, 1.0 - sat(smoothstep(0.0, 0.06, cr)));

      s.albedo = alb;
      s.rough = sat(rough + roughVar * micro.x);
      s.grad = (meso.yzw * 0.65 + micro.yzw * 0.35) * relief;
      s.grad += vec3<f32>(0.0, 1.0, 0.0) * (1.0 - edge) * relief * 0.4 * in.a[3].w;
      s.height = sat(meso.x * 0.5 + 0.5);
      s.occ = mix(0.7, 1.0, edge);
    }
    // ── Basalt: dark volcanic rock with columnar jointing ────────────────────
    case MAT_BASALT: {
      let cols = worley2id(in.p.xz * in.a[3].x + off);
      let joint = sat(smoothstep(0.0, 0.09, cols.y - cols.x));
      let meso = triFbm(in.p, in.n, freq, 4.0);
      let micro = triFbm(in.p, in.n, dfreq, 3.0);
      let ves = sat(smoothstep(0.55, 0.95, vnoise2(in.p.xz * dfreq * 3.0) * 0.5 + 0.5));

      var alb = mixn(colA, colB, cols.z * 0.5 + sat(meso.x * 0.5 + 0.5) * 0.5);
      alb *= mix(0.45, 1.0, joint);
      alb *= 1.0 - 0.35 * ves;                          // vesicles read darker
      s.albedo = tint(alb, in.a[2].z, 1.0);
      s.rough = sat(rough + roughVar * micro.x - 0.1 * (1.0 - joint));
      s.grad = (meso.yzw * 0.6 + micro.yzw * 0.4) * relief;
      s.height = sat(meso.x * 0.5 + 0.5);
      s.occ = mix(0.6, 1.0, joint);
    }
    // ── Scree / talus: angular debris ────────────────────────────────────────
    case MAT_SCREE: {
      let w = worley2id(in.p.xz * freq + off);
      let plate = 1.0 - sat(smoothstep(0.0, 0.22, w.y - w.x));
      // give every shard its own tilt
      let tilt = hash32(floor(in.p.xz * freq) + vec2<f32>(sd, sd * 2.0)) - 0.5;
      let meso = triFbm(in.p, in.n, freq * 1.7, 3.0);
      let micro = triFbm(in.p, in.n, dfreq, 2.0);

      var alb = mixn(colA, colB, w.z * 0.6 + 0.4 * sat(meso.x * 0.5 + 0.5));
      alb *= 0.78 + 0.22 * plate;
      let g = grain(in.p, in.a[4].x) * in.a[4].y;
      alb *= 1.0 + 0.16 * g;
      s.albedo = tint(alb, in.a[2].z, 1.0);
      s.rough = sat(rough + roughVar * micro.x);
      s.grad = (meso.yzw + micro.yzw * 0.4) * relief + vec3<f32>(tilt.x, 0.0, tilt.y) * relief * 1.6;
      s.height = sat(w.x * 1.4);
      s.occ = mix(0.45, 1.0, plate);
    }
    // ── Gravel: water-rounded pebbles ────────────────────────────────────────
    case MAT_GRAVEL: {
      let w = worley2id(in.p.xz * freq + off);
      let dome = sat(1.0 - w.x * 1.25);                 // rounded tops
      let gap = sat(smoothstep(0.0, 0.14, w.y - w.x));
      let micro = triFbm(in.p, in.n, dfreq, 2.0);
      let c1v = hash12(vec2<f32>(w.z * 91.0, sd));
      var alb = mixn(colA, colB, c1v * 0.7 + 0.3 * sat(micro.x * 0.5 + 0.5));
      alb *= mix(0.6, 1.0, gap);
      alb *= 0.85 + 0.3 * dome;
      s.albedo = tint(alb, in.a[2].z, 1.0);
      s.rough = sat(rough + roughVar * micro.x);
      // gradient of the dome: points away from the cell centre
      let dirv = normalize((w.x * 0.5 + 0.001) * vec2<f32>(1.0, 0.6) + 1e-5);
      s.grad = vec3<f32>(dirv.x, 0.0, dirv.y) * dome * relief * 2.4 + micro.yzw * relief * 0.5;
      s.height = dome;
      s.occ = mix(0.5, 1.0, gap);
    }
    // ── Sand: wind ripples ───────────────────────────────────────────────────
    case MAT_SAND: {
      let nz = fbm2(in.p.xz * mfreq * 0.5 + off, 3.0, 2.0, 0.5);
      let phase = in.p.x * in.a[3].x * 6.0 + in.p.z * in.a[3].x * 1.4 + nz.x * 3.4;
      let rip = sin(phase);
      let drip = vec2<f32>(in.a[3].x * 6.0, in.a[3].x * 1.4) * cos(phase) + nz.yz * 3.4 * mfreq * 0.5;
      let micro = grain(in.p, in.a[4].x);
      let macroN = fbm2(in.p.xz * mfreq * 0.25 + off, 3.0, 2.0, 0.5).x;

      var alb = mixn(colA, colB, sat(macroN * 0.5 + 0.5 + micro * 0.12 * in.a[4].y));
      alb *= 0.94 + 0.1 * rip;
      s.albedo = tint(alb, in.a[2].z, 1.0);
      s.rough = sat(rough + roughVar * micro * 0.5);
      s.grad = vec3<f32>(drip.x, 0.0, drip.y) * relief * 0.35;
      s.height = sat(rip * 0.5 + 0.5);
      s.occ = 1.0;
    }
    // ── Dune sand: large asymmetric waves with superimposed ripples ──────────
    case MAT_DUNE: {
      let nz = fbm2(in.p.xz * mfreq * 0.35 + off, 4.0, 2.0, 0.5);
      let phase = dot(in.p.xz, vec2<f32>(0.86, 0.5)) * in.a[3].x + nz.x * 4.0;
      // asymmetric sawtooth: gentle windward, steep lee
      var f = fract(phase / TAU);
      let wave = mix(sin(phase), 2.0 * abs(f - 0.5) - 0.5, 0.55);
      let dwave = vec2<f32>(0.86, 0.5) * in.a[3].x * cos(phase) + nz.yz * 4.0 * mfreq * 0.35;
      let rip = sin(dot(in.p.xz, vec2<f32>(0.86, 0.5)) * in.a[3].x * 9.0) * 0.12;
      let micro = grain(in.p, in.a[4].x);
      var alb = mixn(colA, colB, sat(wave * 0.4 + 0.5 + micro * 0.1 * in.a[4].y));
      alb *= 0.93 + 0.12 * wave;
      s.albedo = tint(alb, in.a[2].z, 1.0);
      s.rough = sat(rough + roughVar * micro * 0.5);
      s.grad = vec3<f32>(dwave.x, 0.0, dwave.y) * relief * 0.5;
      s.grad += vec3<f32>(0.86, 0.0, 0.5) * cos(dot(in.p.xz, vec2<f32>(0.86, 0.5)) * in.a[3].x * 9.0) * relief * 0.4;
      s.height = sat(wave * 0.5 + 0.5 + rip);
      s.occ = 1.0;
    }
    // ── Dirt / loam ──────────────────────────────────────────────────────────
    case MAT_DIRT: {
      let clump = billow2(in.p.xz * freq + off, 4.0, 2.0, 0.55);
      let meso = triFbm(in.p, in.n, freq * 1.3, 3.0);
      let micro = triFbm(in.p, in.n, dfreq, 2.0);
      let macroN = fbm2(in.p.xz * mfreq + off, 3.0, 2.0, 0.5).x;
      var alb = mixn(colA, colB, sat(clump.x * 0.5 + 0.55 + macroN * 0.25));
      alb *= 0.9 + 0.2 * micro.x;
      let st = vnoise2(in.p.xz * dfreq * 0.6);
      alb *= 0.95 + 0.08 * st;
      s.albedo = tint(alb, in.a[2].z, 1.0);
      s.rough = sat(rough + roughVar * micro.x);
      s.grad = (meso.yzw * 0.7 + micro.yzw * 0.3) * relief;
      s.height = sat(clump.x * 0.5 + 0.5);
      s.occ = 0.9;
    }
    // ── Dry grass: tufted steppe ─────────────────────────────────────────────
    case MAT_DRYGRASS: {
      let tuft = fbm2(in.p.xz * dfreq * 1.6 + off, 3.0, 2.1, 0.55);
      let clump = fbm2(in.p.xz * freq + off, 3.0, 2.0, 0.5);
      let macroN = fbm2(in.p.xz * mfreq * 0.7 + off, 3.0, 2.0, 0.5).x;
      let blade = sat(tuft.x * 0.6 + 0.5);
      var alb = mixn(colA, colB, sat(clump.x * 0.4 + 0.5 + macroN * 0.3));
      alb *= 0.78 + 0.42 * blade;
      // a few darker thatch streaks
      alb *= mix(1.0, 0.72, sat(smoothstep(0.45, 0.9, vnoise2(in.p.xz * dfreq * 0.35) * 0.5 + 0.5)));
      s.albedo = tint(alb, in.a[2].z, 1.0);
      s.rough = sat(rough + roughVar * (tuft.x * 0.5));
      s.grad = vec3<f32>(tuft.y, 0.0, tuft.z) * dfreq * 1.6 * relief * 0.5;
      s.grad += vec3<f32>(clump.y, 0.0, clump.z) * freq * relief * 0.25;
      s.height = blade * 0.6 + 0.2;
      s.occ = mix(0.62, 1.0, blade);
    }
    // ── Meadow grass ─────────────────────────────────────────────────────────
    case MAT_GRASS: {
      let tuft = fbm2(in.p.xz * dfreq * 2.0 + off, 3.0, 2.1, 0.55);
      let clump = fbm2(in.p.xz * freq + off, 3.0, 2.0, 0.5);
      let macroN = fbm2(in.p.xz * mfreq * 0.5 + off, 3.0, 2.0, 0.5).x;
      let blade = sat(tuft.x * 0.6 + 0.5);
      var alb = mixn(colA, colB, sat(clump.x * 0.45 + 0.5 + macroN * 0.35));
      alb *= 0.72 + 0.5 * blade;
      // slight specular sheen on the blades
      s.albedo = tint(alb, in.a[2].z, 1.0);
      s.rough = sat(rough + roughVar * tuft.x * 0.5 - 0.05 * blade);
      s.grad = vec3<f32>(tuft.y, 0.0, tuft.z) * dfreq * 2.0 * relief * 0.5;
      s.grad += vec3<f32>(clump.y, 0.0, clump.z) * freq * relief * 0.25;
      s.height = blade * 0.65 + 0.2;
      s.occ = mix(0.55, 1.0, blade);
    }
    // ── Moss ─────────────────────────────────────────────────────────────────
    case MAT_MOSS: {
      let lumps = billow2(in.p.xz * freq * 1.4 + off, 4.0, 2.0, 0.6);
      let fuzz = fbm2(in.p.xz * dfreq * 2.4 + off, 2.0, 2.0, 0.5);
      let macroN = fbm2(in.p.xz * mfreq + off, 3.0, 2.0, 0.5).x;
      var alb = mixn(colA, colB, sat(lumps.x * 0.4 + 0.5 + macroN * 0.3));
      alb *= 0.8 + 0.35 * sat(fuzz.x * 0.5 + 0.5);
      s.albedo = tint(alb, in.a[2].z, 1.0);
      s.rough = sat(rough + roughVar * fuzz.x * 0.3);
      s.grad = vec3<f32>(lumps.y, 0.0, lumps.z) * freq * 1.4 * relief * 0.6;
      s.grad += vec3<f32>(fuzz.y, 0.0, fuzz.z) * dfreq * 2.4 * relief * 0.25;
      s.height = sat(lumps.x * 0.5 + 0.5);
      s.occ = mix(0.5, 1.0, sat(lumps.x * 0.5 + 0.5));
    }
    // ── Forest floor: needle litter ──────────────────────────────────────────
    case MAT_FOREST: {
      // stretched noise reads as fallen needles
      let needles = fbm2(in.p.xz * vec2<f32>(dfreq * 2.2, dfreq * 0.5) + off, 3.0, 2.3, 0.55);
      let clump = fbm2(in.p.xz * freq + off, 3.0, 2.0, 0.5);
      let macroN = fbm2(in.p.xz * mfreq + off, 3.0, 2.0, 0.5).x;
      var alb = mixn(colA, colB, sat(clump.x * 0.4 + 0.5 + macroN * 0.3));
      alb *= 0.75 + 0.4 * sat(needles.x * 0.5 + 0.5);
      s.albedo = tint(alb, in.a[2].z, 1.0);
      s.rough = sat(rough + roughVar * needles.x * 0.4);
      s.grad = vec3<f32>(needles.y, 0.0, needles.z) * dfreq * 2.2 * relief * 0.4;
      s.grad += vec3<f32>(clump.y, 0.0, clump.z) * freq * relief * 0.3;
      s.height = sat(needles.x * 0.5 + 0.5) * 0.7 + 0.15;
      s.occ = mix(0.5, 1.0, sat(needles.x * 0.5 + 0.5));
    }
    // ── Snow: sastrugi, sparkle, subsurface glow ─────────────────────────────
    case MAT_SNOW: {
      let drift = fbm2(in.p.xz * freq * 0.5 + off, 4.0, 2.0, 0.5);
      let sas = fbm2(in.p.xz * vec2<f32>(dfreq * 1.1, dfreq * 0.28) + off, 3.0, 2.1, 0.5);
      let macroN = fbm2(in.p.xz * mfreq * 0.4 + off, 3.0, 2.0, 0.5).x;
      var alb = mixn(colA, colB, sat(drift.x * 0.35 + 0.5 + macroN * 0.25));
      alb *= 0.97 + 0.05 * sas.x;
      s.albedo = tint(alb, in.a[2].z, 1.0);
      s.rough = sat(rough + roughVar * sas.x * 0.5);
      s.grad = vec3<f32>(drift.y, 0.0, drift.z) * freq * 0.5 * relief * 0.7;
      s.grad += vec3<f32>(sas.y, 0.0, sas.z) * dfreq * 1.1 * relief * 0.3;
      // glints
      let g = hash13(floor(in.p * dfreq * 14.0));
      s.grad += (vec3<f32>(g, hash13(floor(in.p.zxy * dfreq * 14.0)), hash13(floor(in.p.yzx * dfreq * 14.0))) - 0.5) * in.a[4].z * relief * 2.0;
      s.height = sat(drift.x * 0.5 + 0.5);
      s.occ = 1.0;
    }
    // ── Ice: glacial, cracked, with trapped bubbles ──────────────────────────
    case MAT_ICE: {
      let crack = cellEdge(in.p.xz + in.p.y * 0.3, in.a[3].x);
      let cw = 1.0 - sat(smoothstep(0.0, 0.05, crack));
      let flow = fbm2(in.p.xz * freq * 0.6 + off, 4.0, 2.0, 0.5);
      let bub = sat(smoothstep(0.6, 0.95, vnoise2(in.p.xz * dfreq * 2.0) * 0.5 + 0.5));
      var alb = mixn(colA, colB, sat(flow.x * 0.4 + 0.5));
      alb = mix(alb, alb * 0.62, cw);
      alb = mix(alb, alb * 1.35 + vec3<f32>(0.02), bub * 0.5);
      s.albedo = tint(alb, in.a[2].z, 1.0);
      s.rough = sat(rough + roughVar * flow.x * 0.4 + cw * 0.4);
      s.grad = vec3<f32>(flow.y, 0.0, flow.z) * freq * 0.6 * relief * 0.6;
      s.height = sat(flow.x * 0.5 + 0.5) - cw * 0.4;
      s.occ = mix(0.55, 1.0, 1.0 - cw);
    }
    // ── Mud: wet riverbed, cracks when drying ────────────────────────────────
    case MAT_MUD: {
      let cr = cellEdge(in.p.xz, in.a[3].x);
      let dry = sat(1.0 - in.a[2].w);
      let cw = (1.0 - sat(smoothstep(0.0, 0.09 * (0.4 + dry), cr))) * dry;
      let flow = fbm2(in.p.xz * freq * 1.3 + off, 4.0, 2.0, 0.5);
      let micro = triFbm(in.p, in.n, dfreq, 2.0);
      var alb = mixn(colA, colB, sat(flow.x * 0.45 + 0.5));
      alb *= mix(1.0, 0.55, cw);
      s.albedo = tint(alb, in.a[2].z, 1.0);
      s.rough = sat(rough + roughVar * micro.x - dry * 0.25);
      s.grad = vec3<f32>(flow.y, 0.0, flow.z) * freq * 1.3 * relief * 0.5 + micro.yzw * relief * 0.3;
      s.height = sat(flow.x * 0.5 + 0.5) - cw * 0.3;
      s.occ = mix(0.6, 1.0, 1.0 - cw);
    }
    // ── River stone: smooth wet pebbles ──────────────────────────────────────
    case MAT_RIVERSTONE: {
      let w = worley2id(in.p.xz * freq + off);
      let dome = sat(1.0 - w.x * 1.15);
      let gap = sat(smoothstep(0.0, 0.16, w.y - w.x));
      let micro = triFbm(in.p, in.n, dfreq, 2.0);
      let cv = hash12(vec2<f32>(w.z * 77.0, sd));
      // rounded pebbles take on many hues; a few carry an algal film
      var alb = mixn(colA, colB, cv);
      alb *= 0.8 + 0.35 * dome;
      let algae = sat(smoothstep(0.55, 0.95, fbm2(in.p.xz * mfreq + off, 3.0, 2.0, 0.5).x * 0.5 + 0.5)) * in.a[2].y;
      alb = mix(alb, alb * vec3<f32>(0.55, 0.75, 0.5), algae);
      alb *= mix(0.45, 1.0, gap);
      s.albedo = tint(alb, in.a[2].z, 1.0);
      s.rough = sat(rough + roughVar * micro.x + algae * 0.3);
      s.grad = vec3<f32>(hash12(vec2<f32>(w.z * 13.0, 1.0)) - 0.5, 0.0, hash12(vec2<f32>(w.z * 29.0, 2.0)) - 0.5) * dome * relief * 2.6 + micro.yzw * relief * 0.4;
      s.height = dome * 0.8;
      s.occ = mix(0.5, 1.0, gap);
    }
    // ── Volcanic ash ─────────────────────────────────────────────────────────
    case MAT_ASH: {
      let soft = billow2(in.p.xz * freq * 0.8 + off, 4.0, 2.0, 0.6);
      let micro = triFbm(in.p, in.n, dfreq, 2.0);
      let macroN = fbm2(in.p.xz * mfreq + off, 3.0, 2.0, 0.5).x;
      var alb = mixn(colA, colB, sat(soft.x * 0.35 + 0.5 + macroN * 0.25));
      alb *= 0.92 + 0.14 * micro.x;
      s.albedo = tint(alb, in.a[2].z, 1.0);
      s.rough = sat(rough + roughVar * micro.x * 0.5);
      s.grad = vec3<f32>(soft.y, 0.0, soft.z) * freq * 0.8 * relief * 0.5 + micro.yzw * relief * 0.3;
      s.height = sat(soft.x * 0.5 + 0.5);
      s.occ = 0.95;
    }
    // ── Beach sand: pale, rippled, damp ──────────────────────────────────────
    case MAT_BEACHSAND: {
      let rip = sin(dot(in.p.xz, vec2<f32>(0.9, 0.44)) * in.a[3].x * 5.0 + fbm2(in.p.xz * mfreq, 2.0, 2.0, 0.5).x * 3.0);
      let dr = vec2<f32>(0.9, 0.44) * in.a[3].x * 5.0 * cos(dot(in.p.xz, vec2<f32>(0.9, 0.44)) * in.a[3].x * 5.0);
      let micro = grain(in.p, in.a[4].x);
      let macroN = fbm2(in.p.xz * mfreq * 0.3 + off, 3.0, 2.0, 0.5).x;
      var alb = mixn(colA, colB, sat(macroN * 0.5 + 0.5 + micro * 0.1));
      alb *= 0.95 + 0.09 * rip;
      s.albedo = tint(alb, in.a[2].z, 1.0);
      s.rough = sat(rough + roughVar * micro * 0.5);
      s.grad = vec3<f32>(dr.x, 0.0, dr.y) * relief * 0.3;
      s.height = sat(rip * 0.5 + 0.5);
      s.occ = 1.0;
    }
    // ── Clay: cracked polygonal crust ────────────────────────────────────────
    case MAT_CLAY: {
      let cr = cellEdge(in.p.xz, in.a[3].x);
      let cw = 1.0 - sat(smoothstep(0.0, 0.055, cr));
      let plate = hash12(floor(worley2id(in.p.xz * in.a[3].x).z * 51.0 + sd));
      let smooth_f = fbm2(in.p.xz * freq + off, 4.0, 2.0, 0.5);
      var alb = mixn(colA, colB, sat(smooth_f.x * 0.4 + 0.5 + plate * 0.15));
      alb *= mix(1.0, 0.5, cw);
      let sheen = sat(smoothstep(0.4, 0.95, smooth_f.x * 0.5 + 0.5));
      s.albedo = tint(alb, in.a[2].z, 1.0);
      s.rough = sat(rough + roughVar * smooth_f.x * 0.3 - sheen * 0.2);
      s.grad = vec3<f32>(smooth_f.y, 0.0, smooth_f.z) * freq * relief * 0.35;
      s.height = sat(smooth_f.x * 0.5 + 0.5) - cw * 0.5;
      s.occ = mix(0.45, 1.0, 1.0 - cw);
    }
    default: {
      s.albedo = mixn(colA, colB, 0.5);
      s.rough = rough;
    }
  }

  return s;
}
