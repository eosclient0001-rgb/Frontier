// ===========================================================================
//  render.wgsl — full-screen SDF ray-marcher.
//
//  Sphere-traces the eroded distance field, shades it with the geology, then
//  composites the simulated water on top.
//
//  Micro-detail is added ANALYTICALLY during the march rather than baked into
//  the grid. A 208³ volume cannot resolve centimetre-scale rock texture, but
//  the marcher can perturb the surface as it approaches it, so the rock stays
//  crisp right up to the camera without any increase in memory. And because
//  that detail is generated from the same strata and joint fields that drove
//  the erosion, it agrees with the macro form instead of fighting it — which
//  is precisely what tiled photo-textures cannot do.
// ===========================================================================

#include "volume.wgsl"
#include "water.wgsl"

struct SimCellRO {
  h: f32, water: f32, sed: f32, reg: f32,
  flux: vec4f,
  vel: vec2f, hard: f32, sedNext: f32,
  h0: f32, wet: f32, flowAcc: f32, talus: f32,
}

@group(0) @binding(1) var  volTex:  texture_3d<f32>;
@group(0) @binding(2) var  volSamp: sampler;
@group(0) @binding(3) var<storage, read> simRO: array<SimCellRO>;

struct Camera {
  invViewProj: mat4x4f,
  pos:         vec4f,
  forward:     vec4f,
  resolution:  vec4f,  // xy = size, z = time, w = frame
}
@group(1) @binding(0) var<uniform> Cam: Camera;

// ---------------------------------------------------------------------------
//  Volume sampling
// ---------------------------------------------------------------------------
fn sampleVol(p: vec3f) -> vec4f {
  let uvw = p / WORLD_SIZE;
  return textureSampleLevel(volTex, volSamp, uvw, 0.0);
}

fn sampleDist(p: vec3f) -> f32 {
  return sampleVol(p).r;
}

/// Cheap 3-tap forward-difference gradient. Half the fetches of a central
/// difference, and the bias is irrelevant here because it is only used to get
/// a steepness weight for the detail function.
fn gradCheap(p: vec3f, d0: f32) -> vec3f {
  let e = VOXEL_SIZE * 0.75;
  return vec3f(
    sampleDist(p + vec3f(e.x, 0.0, 0.0)) - d0,
    sampleDist(p + vec3f(0.0, e.y, 0.0)) - d0,
    sampleDist(p + vec3f(0.0, 0.0, e.z)) - d0,
  );
}

/// Distance including analytic micro-detail.
///
/// PERFORMANCE: the detail term is several octaves of 3D noise plus extra
/// texture fetches, and the march runs this up to `maxSteps` times per pixel.
/// Evaluating it far from the surface is pure waste — displacement of at most
/// `amp` metres cannot possibly change where the ray first crosses zero if the
/// ray is still many metres out. So the detail is gated to a thin shell around
/// the isosurface. In practice this skips it on the overwhelming majority of
/// steps and is the difference between an interactive frame rate and a
/// slideshow.
fn mapDetailed(p: vec3f, dist: f32) -> f32 {
  // One fetch gives distance AND the sediment channel, so the talus rubble
  // detail below is free.
  let v = sampleVol(p);
  let d = v.r;
  let amp = detailScale(dist);
  if (amp <= 1e-4) { return d; }

  // Largest OUTWARD displacement rockDetail can produce. Its terms are all
  // non-negative except the grain term, so the most negative value the
  // expression can reach is (-0.315 - 0.6) ~ -0.92 before the detailAmp
  // scale. Outside the shell we return that conservative lower bound rather
  // than the raw distance: it can never overshoot the displaced surface, so
  // the march stays watertight while skipping the expensive noise on almost
  // every step.
  let maxOut = amp * max(U.detailAmp, 1e-3) * 0.92;
  if (d > maxOut * 3.0 + VOXEL_SIZE.x) { return d - maxOut; }

  let n = normalize(gradCheap(p, d) + vec3f(0.0, 1e-6, 0.0));
  let hard = rockHardnessFast(p);
  return d + rockDetail(p, n, hard, v.g) * amp;
}

/// High-quality normal including micro-detail, for shading.
fn shadeNormal(p: vec3f, dist: f32) -> vec3f {
  let e = VOXEL_SIZE.x * 0.55;
  let k = vec2f(1.0, -1.0);
  var n = k.xyy * mapDetailed(p + k.xyy * e, dist)
        + k.yyx * mapDetailed(p + k.yyx * e, dist)
        + k.yxy * mapDetailed(p + k.yxy * e, dist)
        + k.xxx * mapDetailed(p + k.xxx * e, dist);
  let l = length(n);
  return select(vec3f(0.0, 1.0, 0.0), n / l, l > 1e-8);
}

// ---------------------------------------------------------------------------
//  Sim grid lookup (bilinear)
// ---------------------------------------------------------------------------
fn simAtF(xz: vec2f) -> SimCellRO {
  let f = clamp(worldXZToSimF(xz), vec2f(0.0), vec2f(f32(SIMX - 1), f32(SIMZ - 1)));
  let i = vec2i(floor(f));
  return simRO[simIndex(i)];
}

fn waterDepthAt(xz: vec2f) -> f32 {
  let f = clamp(worldXZToSimF(xz), vec2f(0.0), vec2f(f32(SIMX - 1), f32(SIMZ - 1)));
  let i = vec2i(floor(f));
  let w = f - vec2f(i);
  let a = simRO[simIndex(i + vec2i(0, 0))].water;
  let b = simRO[simIndex(i + vec2i(1, 0))].water;
  let c = simRO[simIndex(i + vec2i(0, 1))].water;
  let d = simRO[simIndex(i + vec2i(1, 1))].water;
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

fn waterSurfaceAt(xz: vec2f) -> f32 {
  let f = clamp(worldXZToSimF(xz), vec2f(0.0), vec2f(f32(SIMX - 1), f32(SIMZ - 1)));
  let i = vec2i(floor(f));
  let w = f - vec2f(i);
  let a = simRO[simIndex(i + vec2i(0, 0))];
  let b = simRO[simIndex(i + vec2i(1, 0))];
  let c = simRO[simIndex(i + vec2i(0, 1))];
  let d = simRO[simIndex(i + vec2i(1, 1))];
  let sa = a.h + a.water; let sb = b.h + b.water;
  let sc = c.h + c.water; let sd2 = d.h + d.water;
  return mix(mix(sa, sb, w.x), mix(sc, sd2, w.x), w.y);
}

// ---------------------------------------------------------------------------
//  Ray marching
// ---------------------------------------------------------------------------
struct Hit {
  t:      f32,
  hit:    bool,
  steps:  i32,
}

fn march(ro: vec3f, rd: vec3f, tMin: f32, tMax: f32) -> Hit {
  var t = tMin;
  var res: Hit;
  res.hit = false;
  res.t = tMax;
  res.steps = 0;

  let relax = U.marchRelax;
  let maxSteps = i32(U.maxSteps);

  for (var i = 0; i < maxSteps; i++) {
    let p = ro + rd * t;
    let d = mapDetailed(p, t);
    res.steps = i;

    // Surface tolerance grows with distance to avoid over-marching far away.
    let eps = max(VOXEL_SIZE.x * 0.12, t * 0.0016);

    if (d < eps) {
      res.hit = true;
      res.t = t;
      return res;
    }
    t += max(d * relax, eps * 0.65);
    if (t > tMax) { break; }
  }
  res.t = t;
  return res;
}

/// Cone-traced soft shadow (Inigo Quilez). Cheap and gives the long, soft
/// canyon shadows that a hard shadow test would miss entirely.
fn softShadow(ro: vec3f, rd: vec3f, tMin: f32, tMax: f32, k: f32) -> f32 {
  if (U.shadowSteps == 0u) { return 1.0; }
  var res = 1.0;
  var t = tMin;
  let steps = i32(U.shadowSteps);
  for (var i = 0; i < steps; i++) {
    let p = ro + rd * t;
    let d = sampleDist(p);
    if (d < 0.0015) { return 0.0; }
    res = min(res, k * d / t);
    t += clamp(d, VOXEL_SIZE.x * 0.6, 14.0);
    if (t > tMax) { break; }
  }
  return saturate(res);
}

/// Ambient occlusion by marching a short way along the normal.
fn ambientOcclusion(p: vec3f, n: vec3f) -> f32 {
  if (U.aoSteps == 0u) { return 1.0; }
  var occ = 0.0;
  var sca = 1.0;
  let steps = i32(U.aoSteps);
  for (var i = 0; i < steps; i++) {
    let h = 0.35 + 1.9 * f32(i) / f32(steps);
    let d = sampleDist(p + n * h);
    occ += (h - d) * sca;
    sca *= 0.82;
  }
  return saturate(1.0 - occ * 0.55 * U.aoStrength);
}

// ---------------------------------------------------------------------------
//  Rock shading
// ---------------------------------------------------------------------------
struct Surface {
  albedo:    vec3f,
  roughness: f32,
  wetness:   f32,
}

fn rockSurface(p: vec3f, n: vec3f, vox: vec4f) -> Surface {
  var s: Surface;

  let hard = rockHardness(p);
  let sedAmt = saturate(vox.g);
  let damage = saturate(vox.b);
  let wet = saturate(vox.a);

  var alb = rockAlbedo(p, hard, sedAmt);

  // --- desert varnish ------------------------------------------------------
  // Dark manganese/iron streaks running down cliff faces below points where
  // water spills over. Utterly characteristic of the Southwest, and it only
  // appears on steep, stable, long-exposed faces.
  if (U.desertVarnish > 0.0) {
    let steep = smoothstep(0.35, 0.85, 1.0 - abs(n.y));
    // Vertical streaking: high frequency across, stretched along the fall line.
    let streak = fbm2(vec2f(p.x * 0.30 + p.z * 0.22, p.y * 0.035), 4) * 0.5 + 0.5;
    let runoff = smoothstep(0.35, 0.9, streak);
    let varnish = steep * runoff * saturate(U.desertVarnish) * (0.35 + hard * 0.65);
    alb = mix(alb, vec3f(0.115, 0.082, 0.062), varnish * 0.72);
  }

  // --- dust and sand on flat surfaces -------------------------------------
  if (U.dustCover > 0.0) {
    let flat = smoothstep(0.55, 0.95, n.y);
    let dustN = fbm3(p * 0.09, 3) * 0.5 + 0.5;
    let dust = flat * saturate(U.dustCover) * (0.45 + 0.55 * dustN);
    alb = mix(alb, vec3f(0.60, 0.50, 0.375), dust * 0.62);
  }

  // --- loose sediment / talus ---------------------------------------------
  alb = mix(alb, vec3f(0.52, 0.43, 0.33), sedAmt * 0.55 * saturate(U.sedimentTint));

  // --- weathering damage darkens and dulls --------------------------------
  alb *= (1.0 - damage * 0.20);

  // --- sparse desert vegetation -------------------------------------------
  if (U.vegetation > 0.0) {
    // Plants need a bench to sit on, a bit of moisture, and no cliff.
    let bench = smoothstep(0.42, 0.88, n.y);
    let moisture = saturate(wet * 1.4 + 0.10);
    // North-facing slopes hold moisture in the northern hemisphere.
    let aspect = saturate(-n.z * 0.5 + 0.5);
    let patch = fbm2(p.xz * 0.11 + vec2f(U.seed * 3.0), 4) * 0.5 + 0.5;
    let clump = smoothstep(0.52, 0.80, patch);
    let veg = bench * clump * saturate(U.vegetation) * (0.35 + moisture * 0.65) * (0.55 + aspect * 0.45);
    let vegCol = mix(vec3f(0.115, 0.135, 0.070), vec3f(0.180, 0.190, 0.105), patch);
    alb = mix(alb, vegCol, saturate(veg) * 0.80);
  }

  // --- active drainage darkens the bed ------------------------------------
  // The simulation knows exactly where water concentrates (flowAcc), so the
  // channel network can be drawn from the physics rather than painted on:
  // scoured, damp, sediment-washed rock in the washes, dry rock on the ribs
  // between them. This is what makes the drainage pattern legible from above.
  let cellS = simAtF(p.xz);
  let channel = saturate(cellS.flowAcc * 9.0);
  let onBed = smoothstep(2.5, 0.0, abs(p.y - cellS.h));
  alb = mix(alb, alb * vec3f(0.62, 0.60, 0.58), channel * onBed * 0.85);

  // --- wet rock is darker and shinier -------------------------------------
  let wetF = saturate(max(wet, cellS.wet * onBed) * 1.2);
  alb *= mix(1.0, 0.52, wetF);

  s.albedo = alb;
  s.roughness = clamp(mix(U.rockRough, 0.22, wetF * 0.75) * (1.0 - damage * 0.12), 0.06, 1.0);
  s.wetness = wetF;
  return s;
}

/// GGX specular.
fn specGGX(n: vec3f, v: vec3f, l: vec3f, rough: f32) -> f32 {
  let h = normalize(v + l);
  let a = max(rough * rough, 1e-3);
  let ndh = saturate(dot(n, h));
  let ndv = saturate(dot(n, v));
  let ndl = saturate(dot(n, l));
  let den = ndh * ndh * (a * a - 1.0) + 1.0;
  let D = (a * a) / max(PI * den * den, 1e-6);
  let k = a * 0.5;
  let gv = ndv / (ndv * (1.0 - k) + k);
  let gl = ndl / (ndl * (1.0 - k) + k);
  return D * gv * gl * 0.25 / max(ndv * ndl, 1e-4);
}

fn shadeRock(p: vec3f, n: vec3f, rd: vec3f, dist: f32) -> vec3f {
  let vox = sampleVol(p);
  let surf = rockSurface(p, n, vox);
  let sd = sunDir();
  let v = -rd;

  let ndl = saturate(dot(n, sd));
  var shadow = 1.0;
  if (ndl > 0.001) {
    shadow = softShadow(p + n * VOXEL_SIZE.x * 1.2, sd, VOXEL_SIZE.x * 1.5, 900.0, U.shadowSoft);
  }

  let ao = ambientOcclusion(p, n);

  // Direct sun.
  var col = surf.albedo * sunLight() * ndl * shadow / PI;

  // Specular — subtle on rock, stronger where wet.
  let specAmt = mix(0.020, 0.16, surf.wetness);
  col += sunLight() * specGGX(n, v, sd, surf.roughness) * ndl * shadow * specAmt;

  // Sky ambient, occluded.
  col += surf.albedo * skyAmbient(n) * ao;

  // Warm bounce from sunlit rock into the shadows.
  col += surf.albedo * bounceLight(n, surf.albedo) * ao;

  return col;
}

// ---------------------------------------------------------------------------
//  Vertex: full-screen triangle
// ---------------------------------------------------------------------------
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var out: VSOut;
  let x = f32((vi << 1u) & 2u);
  let y = f32(vi & 2u);
  let uv = vec2f(x, y);
  out.uv = uv;
  out.pos = vec4f(uv * 2.0 - 1.0, 0.0, 1.0);
  return out;
}

// ---------------------------------------------------------------------------
//  Fragment
// ---------------------------------------------------------------------------
fn rayFromUV(uv: vec2f) -> vec3f {
  let ndc = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 1.0, 1.0);
  let world = Cam.invViewProj * ndc;
  return normalize(world.xyz / world.w - Cam.pos.xyz);
}

/// ACES filmic tonemap (Narkowicz fit).
fn tonemapACES(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return saturate((x * (a * x + b)) / (x * (c * x + d) + e));
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let uv = in.uv;
  let ro = Cam.pos.xyz;
  let rd = rayFromUV(uv);
  let time = Cam.resolution.z;

  var col = vec3f(0.0);

  // Restrict marching to the domain box.
  let hitBox = intersectBox(ro, rd, vec3f(0.0), WORLD_SIZE);
  let tNear = max(hitBox.x, 0.0);
  let tFar = hitBox.y;

  // If the camera is INSIDE rock, every ray starts with d < 0 and the marcher
  // reports an immediate hit at t~0. The normal is then garbage and the whole
  // screen renders as one flat, blown-out surface. Rather than show that, skip
  // forward to where the ray actually leaves the rock, so the view recovers by
  // itself instead of looking like the renderer has died.
  var tStartOffset = 0.0;
  if (sampleDist(ro) < 0.0) {
    var tp = tNear;
    for (var i = 0; i < 128; i++) {
      tp += VOXEL_SIZE.x * 1.5;
      if (tp > tFar) { break; }
      if (sampleDist(ro + rd * tp) > 0.0) { break; }
    }
    tStartOffset = tp;
  }

  // -------------------------------------------------------------------------
  //  debugView 7 — RAW SDF probe.
  //
  //  Deliberately bypasses lighting, shadows, AO, fog, dust and the tonemapper.
  //  It answers exactly one question: does the volume contain a surface where
  //  the ray expects one? Anything that renders here is real geometry, so if
  //  this shows terrain but Beauty is blank, the fault is in shading, not in
  //  the sim. Colours are raw, not tonemapped, so they cannot blow out.
  //
  //    magenta = ray never entered the domain box
  //    green   = hit, brightness is depth through the box
  //    blue    = passed through the box without ever finding rock (empty volume)
  //    red     = camera started inside rock
  // -------------------------------------------------------------------------
  if (U.debugView == 7u) {
    if (tFar <= tNear) { return vec4f(1.0, 0.0, 1.0, 1.0); }
    if (sampleDist(ro) < 0.0) { return vec4f(1.0, 0.0, 0.0, 1.0); }
    var t = max(tNear + 0.01, 0.0);
    var minD = 1e9;
    for (var i = 0; i < 512; i++) {
      let p = ro + rd * t;
      let d = sampleDist(p);
      minD = min(minD, d);
      if (d < VOXEL_SIZE.x * 0.5) {
        let shade = 1.0 - saturate((t - tNear) / max(tFar - tNear, 1.0));
        return vec4f(0.0, 0.25 + shade * 0.75, 0.0, 1.0);
      }
      t += max(d * 0.9, VOXEL_SIZE.x * 0.5);
      if (t > tFar) { break; }
    }
    // No surface anywhere along the ray: show how close it got.
    let near = saturate(1.0 - minD / (WORLD_H * 0.5));
    return vec4f(0.0, 0.0, 0.25 + near * 0.75, 1.0);
  }

  var sceneDist = 1e9;
  var hitRock = false;
  var rockCol = vec3f(0.0);
  var rockPos = vec3f(0.0);

  if (tFar > tNear) {
    let h = march(ro, rd, max(tNear + 0.01, tStartOffset), tFar);
    if (h.hit) {
      hitRock = true;
      sceneDist = h.t;
      rockPos = ro + rd * h.t;
      let n = shadeNormal(rockPos, h.t);
      rockCol = shadeRock(rockPos, n, rd, h.t);

      // Debug views.
      if (U.debugView == 1u) { rockCol = vec3f(rockHardness(rockPos)); }
      if (U.debugView == 2u) { rockCol = n * 0.5 + 0.5; }
      if (U.debugView == 3u) { rockCol = vec3f(f32(h.steps) / f32(U.maxSteps)); }
      if (U.debugView == 4u) {
        let s = simAtF(rockPos.xz);
        rockCol = vec3f(saturate(s.flowAcc * 12.0), saturate(s.water * 3.0), saturate(s.sed));
      }
      if (U.debugView == 5u) { rockCol = vec3f(saturate(sampleVol(rockPos).g)); }
      if (U.debugView == 6u) { rockCol = vec3f(saturate(sampleVol(rockPos).b)); }
    }
  }

  col = select(skyColor(rd) + sunDisc(rd), rockCol, hitRock);

  // -------------------------------------------------------------------------
  //  Water
  //
  //  Intersect the ray with the water surface. The surface is nearly flat
  //  within a cell, so a short secant search along the ray converges fast and
  //  handles the sloping river surface correctly.
  // -------------------------------------------------------------------------
  if (U.showWater == 1u && U.debugView == 0u) {
    var tW = -1.0;
    var prevGap = 0.0;
    var first = true;

    let tStart = max(tNear, 0.0);
    let tEnd = min(select(tFar, sceneDist, hitRock), tFar);
    let nSteps = 96;
    let dtStep = (tEnd - tStart) / f32(nSteps);

    if (dtStep > 0.0) {
      for (var i = 0; i <= nSteps; i++) {
        let t = tStart + dtStep * f32(i);
        let p = ro + rd * t;
        if (p.x < 0.0 || p.z < 0.0 || p.x > WORLD_W || p.z > WORLD_D) {
          first = true;
          continue;
        }
        let depth = waterDepthAt(p.xz);
        if (depth < U.waterMinDepth) { first = true; continue; }
        let ws = waterSurfaceAt(p.xz);
        let gap = p.y - ws;
        if (!first && prevGap > 0.0 && gap <= 0.0) {
          // Linear refine of the crossing.
          let f = prevGap / max(prevGap - gap, 1e-6);
          tW = t - dtStep * (1.0 - f);
          break;
        }
        prevGap = gap;
        first = false;
      }
    }

    if (tW > 0.0 && (!hitRock || tW < sceneDist)) {
      let wp = ro + rd * tW;
      let cell = simAtF(wp.xz);
      let depth = waterDepthAt(wp.xz);

      // How far the ray travels through water before reaching the bed.
      let bedT = select(tFar, sceneDist, hitRock);
      let through = max(bedT - tW, 0.0);

      // Bed colour: what we already shaded, or a dim floor if nothing was hit.
      let bedCol = select(vec3f(0.10, 0.07, 0.05), rockCol, hitRock);

      var wcol = shadeWater(wp, rd, depth, cell.vel, bedCol,
                            min(through, depth * 4.0), cell.sed, time);

      wcol = applyFog(wcol, tW, rd);
      col = wcol;
      sceneDist = tW;
    } else if (hitRock) {
      col = applyFog(col, sceneDist, rd);
    }
  } else if (hitRock) {
    col = applyFog(col, sceneDist, rd);
  }

  // -------------------------------------------------------------------------
  //  Wind-blown dust
  //
  //  A thin drifting haze layer that thickens toward the ground. Sells both
  //  the scale and the dryness of the air.
  // -------------------------------------------------------------------------
  if (U.dustAmount > 0.0 && U.debugView == 0u) {
    let far = min(sceneDist, 2400.0);
    let w = windVec();
    var acc = 0.0;
    let N = 6;
    for (var i = 0; i < N; i++) {
      let t = far * (f32(i) + 0.5) / f32(N);
      let p = ro + rd * t;
      let hFall = exp(-max(p.y - 20.0, 0.0) / 110.0);
      let d = fbm3(p * 0.0045 + vec3f(w.x, 0.0, w.y) * time * 0.06, 3) * 0.5 + 0.5;
      acc += hFall * d;
    }
    acc /= f32(N);
    let dustCol = mix(vec3f(0.52, 0.44, 0.36), vec3f(0.92, 0.78, 0.60),
                      saturate(dot(rd, sunDir()) * 0.5 + 0.5));
    let amt = saturate(acc * U.dustAmount * 0.30 * (far / 900.0));
    col = mix(col, dustCol * U.skyIntensity * 0.9, amt);
  }

  // -------------------------------------------------------------------------
  //  Tonemap and grade
  // -------------------------------------------------------------------------
  col *= U.exposure;
  col = tonemapACES(col);

  let l = luma(col);
  col = mix(vec3f(l), col, U.satBoost);

  // Slight vignette.
  let vc = uv - 0.5;
  col *= 1.0 - dot(vc, vc) * 0.30;

  // Dither to break up banding in the sky gradient.
  let dither = (hash21(uv * Cam.resolution.xy + vec2f(time)) - 0.5) / 255.0;
  col += dither;

  return vec4f(pow(max(col, vec3f(0.0)), vec3f(1.0 / 2.2)), 1.0);
}
