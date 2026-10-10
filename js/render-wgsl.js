/* ═══════════════════════════════════════════════════════════════
   Render-side WGSL: analytic atmosphere, sky, PBR terrain,
   water plane and the composite (FXAA + ACES) pass.
   ═══════════════════════════════════════════════════════════════ */
import { NOISE_LIB } from './wgsl.js';

/* Physically-based single-scattering atmosphere (Rayleigh + Mie,
   exponential height falloff, planet occlusion along sun rays). */
export const ATMO_LIB = /* wgsl */`
const ATMO_Rg = 6360e3;
const ATMO_Ra = 6420e3;
const ATMO_Hr = 7994.0;
const ATMO_Hm = 1200.0;
const betaR = vec3f(5.802e-6, 13.558e-6, 33.1e-6);
const betaM0 = 21e-6;

fn atmoRaySphere(orig: vec3f, dir: vec3f, radius: f32) -> vec2f {
  let b = dot(orig, dir);
  let c = dot(orig, orig) - radius * radius;
  let d = b * b - c;
  if (d < 0.0) { return vec2f(-1.0, -1.0); }
  let s = sqrt(d);
  return vec2f(-b - s, -b + s);
}
fn phaseRaleigh(mu: f32) -> f32 {
  return 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu);
}
fn phaseMie(mu: f32, g: f32) -> f32 {
  let g2 = g * g;
  return 3.0 / (8.0 * 3.14159265) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * mu, 1e-4), 1.5));
}
fn atmosphere(orig: vec3f, dir: vec3f, sunDir: vec3f, sunIntensity: f32, mieAmount: f32, primarySteps: i32, lightSteps: i32) -> vec3f {
  let tAtm = atmoRaySphere(orig, dir, ATMO_Ra);
  if (tAtm.y < 0.0) { return vec3f(0.0); }
  var tMax = tAtm.y;
  let tGnd = atmoRaySphere(orig, dir, ATMO_Rg);
  if (tGnd.x > 0.0) { tMax = tGnd.x; }
  var t = max(tAtm.x, 0.0);
  if (t >= tMax) { return vec3f(0.0); }
  let stepSize = (tMax - t) / f32(primarySteps);
  let mu = dot(dir, sunDir);
  let pr = phaseRaleigh(mu);
  let pm = phaseMie(mu, 0.76);
  var sumR = vec3f(0.0);
  var sumM = vec3f(0.0);
  for (var i = 0; i < primarySteps; i++) {
    let p = orig + dir * (t + (f32(i) + 0.5) * stepSize);
    let h = max(length(p) - ATMO_Rg, 0.0);
    let odRs = exp(-h / ATMO_Hr) * stepSize;
    let odMs = exp(-h / ATMO_Hm) * stepSize;
    let tL = atmoRaySphere(p, sunDir, ATMO_Ra);
    var lMax = tL.y;
    let tLg = atmoRaySphere(p, sunDir, ATMO_Rg);
    if (tLg.x > 0.0 && tLg.x < lMax) { lMax = tLg.x; }
    let lStart = max(tL.x, 0.0);
    let lStep = max(lMax - lStart, 0.0) / f32(lightSteps);
    var lodR = 0.0;
    var lodM = 0.0;
    for (var j = 0; j < lightSteps; j++) {
      let lp = p + sunDir * (lStart + (f32(j) + 0.5) * lStep);
      let lh = max(length(lp) - ATMO_Rg, 0.0);
      lodR += exp(-lh / ATMO_Hr) * lStep;
      lodM += exp(-lh / ATMO_Hm) * lStep;
    }
    let atten = exp(-(betaR * lodR + vec3f(betaM0 * mieAmount) * lodM));
    sumR += odRs * atten;
    sumM += odMs * atten;
  }
  return sunIntensity * (sumR * betaR * pr + sumM * vec3f(betaM0 * mieAmount) * pm);
}
/* Value-noise fBm — cheap, used for material patterns and water. */
fn vhash(p: vec2f) -> f32 {
  var p3 = fract(p.xyx * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = vhash(i);
  let b = vhash(i + vec2f(1.0, 0.0));
  let c = vhash(i + vec2f(0.0, 1.0));
  let d = vhash(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
fn vfbm(p: vec2f, octaves: i32) -> f32 {
  var amp = 0.5;
  var freq = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  for (var i = 0; i < octaves; i++) {
    sum += amp * vnoise(p * freq);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / max(norm, 1e-5);
}
fn acesFilmic(x: vec3f) -> vec3f {
  let a = 2.51; let b = 0.03; let c = 2.43; let d = 0.59; let e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), vec3f(0.0), vec3f(1.0));
}
fn linearToSRGB(c: vec3f) -> vec3f {
  let lin = c * 12.92;
  let srgb = pow(max(c, vec3f(1e-5)), vec3f(1.0 / 2.4)) * 1.055 - 0.055;
  return select(lin, srgb, c > vec3f(0.0031308));
}
`;

/* ── Sky ─────────────────────────────────────────────────────── */
export const SKY_SHADER = /* wgsl */`
${ATMO_LIB}
struct SkyU {
  invViewProj: mat4x4f,
  camPos: vec4f,
  sunDir: vec4f,
  sunColor: vec4f,
  sunIntensity: f32,
  mieAmount: f32,
  night: f32,
  time: f32,
};
@group(0) @binding(0) var<uniform> u: SkyU;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) ndc: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var xy = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  var out: VOut;
  out.pos = vec4f(xy[vi], 0.999999, 1.0);
  out.ndc = xy[vi];
  return out;
}

fn starField(dir: vec3f) -> f32 {
  let s = vec2f(atan2(dir.z, dir.x) * 2.2, dir.y * 3.4) * 42.0;
  let cell = floor(s);
  let f = fract(s) - 0.5;
  let h = vhash(cell);
  if (h < 0.986) { return 0.0; }
  let d = length(f - (vhash(cell + 7.7) - 0.5) * 0.6);
  let star = smoothstep(0.09, 0.0, d);
  let tw = 0.65 + 0.35 * sin(u.time * (1.5 + h * 5.0) + h * 40.0);
  return star * tw * (h - 0.986) / 0.014;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let dir = normalize((u.invViewProj * vec4f(in.ndc, 1.0, 1.0)).xyz);
  var col = atmosphere(u.camPos.xyz, dir, u.sunDir.xyz, u.sunIntensity, u.mieAmount, 24, 8);
  // sun disc + limb darkening + forward-scatter glow
  let mu = dot(dir, u.sunDir.xyz);
  let sunAngular = 0.00465; // ~0.53 degrees
  let disc = smoothstep(cos(sunAngular * 1.12), cos(sunAngular), mu);
  let limb = 0.55 + 0.45 * pow(clamp((mu - cos(sunAngular * 1.12)) / max(1.0 - cos(sunAngular * 1.12), 1e-5), 0.0, 1.0), 0.6);
  let glow = pow(max(mu, 0.0), 900.0) * 0.6 + pow(max(mu, 0.0), 180.0) * 0.12;
  // transmittance toward the sun from the camera
  let tL = atmoRaySphere(u.camPos.xyz, u.sunDir.xyz, ATMO_Ra);
  var lMax = tL.y;
  let tLg = atmoRaySphere(u.camPos.xyz, u.sunDir.xyz, ATMO_Rg);
  if (tLg.x > 0.0 && tLg.x < lMax) { lMax = tLg.x; }
  let lStart = max(tL.x, 0.0);
  let lStep = max(lMax - lStart, 0.0) / 6.0;
  var lodR = 0.0;
  var lodM = 0.0;
  for (var j = 0; j < 6; j++) {
    let lp = u.camPos.xyz + u.sunDir.xyz * (lStart + (f32(j) + 0.5) * lStep);
    let lh = max(length(lp) - ATMO_Rg, 0.0);
    lodR += exp(-lh / ATMO_Hr) * lStep;
    lodM += exp(-lh / ATMO_Hm) * lStep;
  }
  let sunTrans = exp(-(betaR * lodR + vec3f(betaM0 * u.mieAmount) * lodM));
  col += u.sunColor.xyz * disc * limb * 2.2 * sunTrans;
  col += u.sunColor.xyz * glow * sunTrans * 0.55;
  // night stars
  let stars = starField(dir) * u.night * 2.2;
  col += vec3f(0.9, 0.93, 1.0) * stars;
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`;

/* ── Terrain vertex (shared with shadow pass) ─────────────────── */
export const TERRAIN_VERT = /* wgsl */`
${NOISE_LIB}
struct TerrainVertU {
  viewProj: mat4x4f,
  worldSize: f32,
  heightScale: f32,
  resX: f32,
  resY: f32,
};
@group(0) @binding(0) var hTex: texture_2d<f32>;
@group(0) @binding(9) var<uniform> u: TerrainVertU;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) uv: vec2f,
};

@vertex
fn vs(@location(0) grid: vec2f) -> VOut {
  var out: VOut;
  let h = sampleHeightBilinear(hTex, vec2f(u.resX, u.resY), grid);
  let world = vec3f((grid.x - 0.5) * u.worldSize, h * u.heightScale, (grid.y - 0.5) * u.worldSize);
  out.world = world;
  out.uv = grid;
  out.pos = u.viewProj * vec4f(world, 1.0);
  return out;
}
`;

/* ── Terrain fragment: PBR + splat materials + shadows + aerial perspective ── */
export const TERRAIN_FRAG = /* wgsl */`
${ATMO_LIB}
struct TerrainFragU {
  viewProj: mat4x4f,
  camPos: vec4f,
  sunDir: vec4f,
  sunColor: vec4f,
  ambZenith: vec4f,
  ambHorizon: vec4f,
  fogDensity: f32,
  heightScale: f32,
  worldSize: f32,
  exposure: f32,
  viewMode: u32,
  waterLevel: f32,
  time: f32,
  aoStrength: f32,
  shadowTexel: f32,
  mieAmount: f32,
  sunIntensity: f32,
  resX: f32,
  resY: f32,
  worldPerTexel: f32,
  waterEnabled: u32,
  pad0: u32,
  pad1: u32,
  pad2: u32,
  sunViewProj: mat4x4f,
};
struct MatU {
  albedoRough: vec4f,
  pattern: vec4f,
};
@group(0) @binding(0) var hTex: texture_2d<f32>;
@group(0) @binding(1) var aoTex: texture_2d<f32>;
@group(0) @binding(2) var flowTex: texture_2d<f32>;
@group(0) @binding(3) var splatA: texture_2d<f32>;
@group(0) @binding(4) var splatB: texture_2d<f32>;
@group(0) @binding(5) var shadowTex: texture_depth_2d;
@group(0) @binding(6) var shadowSampler: sampler_comparison;
@group(0) @binding(7) var<uniform> u: TerrainFragU;
@group(0) @binding(8) var<uniform> mats: array<MatU, 8>;

struct FIn {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) uv: vec2f,
};

fn terrainNormal(uv: vec2f) -> vec3f {
  let texel = vec2f(1.0 / u.resX, 1.0 / u.resY);
  let hL = sampleHeightBilinear(hTex, vec2f(u.resX, u.resY), uv - vec2f(texel.x, 0.0));
  let hR = sampleHeightBilinear(hTex, vec2f(u.resX, u.resY), uv + vec2f(texel.x, 0.0));
  let hD = sampleHeightBilinear(hTex, vec2f(u.resX, u.resY), uv - vec2f(0.0, texel.y));
  let hU = sampleHeightBilinear(hTex, vec2f(u.resX, u.resY), uv + vec2f(0.0, texel.y));
  let sx = (hR - hL) * u.heightScale / (2.0 * u.worldPerTexel);
  let sz = (hU - hD) * u.heightScale / (2.0 * u.worldPerTexel);
  return normalize(vec3f(-sx, 1.0, -sz));
}

fn shadowFactor(world: vec3f, nDotL: f32) -> f32 {
  if (u.shadows == 0u) { return 1.0; }
  let lp = u.sunViewProj * vec4f(world, 1.0);
  if (lp.w <= 0.0) { return 1.0; }
  var proj = lp.xyz / lp.w;
  proj = vec3f(proj.x * 0.5 + 0.5, 0.5 - proj.y * 0.5, proj.z);
  if (proj.x < 0.003 || proj.x > 0.997 || proj.y < 0.003 || proj.y > 0.997 || proj.z > 1.0) { return 1.0; }
  let bias = clamp(0.0016 * (1.0 - nDotL), 0.0004, 0.004) + 0.0004;
  var s = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let off = vec2f(f32(x), f32(y)) * u.shadowTexel;
      s += textureSampleCompare(shadowTex, shadowSampler, proj.xy + off, clamp(proj.z - bias, 0.0, 1.0));
    }
  }
  return s / 9.0;
}

fn distributionGGX(nDotH: f32, rough: f32) -> f32 {
  let a = rough * rough;
  let a2 = a * a;
  let d = nDotH * nDotH * (a2 - 1.0) + 1.0;
  return a2 / max(3.14159265 * d * d, 1e-6);
}
fn geometrySmith(nDotV: f32, nDotL: f32, rough: f32) -> f32 {
  let a = rough * rough;
  let gv = nDotV / (nDotV * (1.0 - a) + a);
  let gl = nDotL / (nDotL * (1.0 - a) + a);
  return gv * gl;
}
fn fresnelSchlick(cosTheta: f32, f0: f32) -> f32 {
  return f0 + (1.0 - f0) * pow(clamp(1.0 - cosTheta, 0.0, 1.0), 5.0);
}

@fragment
fn fs(in: FIn) -> @location(0) vec4f {
  let uv = in.uv;
  let h = sampleHeightBilinear(hTex, vec2f(u.resX, u.resY), uv);
  let n = terrainNormal(uv);
  let ao = textureLoad(aoTex, vec2i(uv * vec2f(u.resX, u.resY)), 0).r;
  let flow = textureLoad(flowTex, vec2i(uv * vec2f(u.resX, u.resY)), 0).r;
  let slopeDeg = acos(clamp(n.y, 0.0, 1.0)) * 57.2957795;

  // ── splat weights (built from the two coverage maps; no dynamic vector indexing) ──
  let tc = vec2i(uv * vec2f(u.resX, u.resY));
  let sa = textureLoad(splatA, tc, 0);
  let sb = textureLoad(splatB, tc, 0);
  var w = array<f32, 8>(sa.x, sa.y, sa.z, sa.w, sb.x, sb.y, sb.z, sb.w);
  var total = sa.x + sa.y + sa.z + sa.w + sb.x + sb.y + sb.z + sb.w;
  if (total < 1e-4) { w[0] = 1.0; total = 1.0; }

  // ── material evaluation ──
  var albedo = vec3f(0.35);
  var rough = 0.9;
  var nDetail = vec3f(0.0, 0.0, 0.0);
  var dAccum = vec3f(0.0, 0.0, 0.0);
  let wxz = vec2f(in.world.x, in.world.z);
  for (var i = 0; i < 8; i++) {
    let wi = w[i] / total;
    if (wi < 0.004) { continue; }
    let m = mats[i];
    let pscale = max(m.pattern.x, 1.0);
    let q = wxz / pscale + vec2f(m.pattern.w, m.pattern.w * 1.7);
    let p = vfbm(q, 4);
    let pc = m.pattern.y;
    let tint = 1.0 + (p - 0.5) * 2.0 * pc;
    albedo += wi * m.albedoRough.rgb * tint;
    rough += wi * m.albedoRough.a;
    // analytic detail normal (forward differences in world XZ)
    let e = pscale * 0.045;
    let px = vfbm((wxz + vec2f(e, 0.0)) / pscale + vec2f(m.pattern.w, m.pattern.w * 1.7), 4);
    let pz = vfbm((wxz + vec2f(0.0, e)) / pscale + vec2f(m.pattern.w, m.pattern.w * 1.7), 4);
    let gx = (px - p) / e;
    let gz = (pz - p) / e;
    let amp = m.pattern.z * wi * 0.55;
    dAccum += vec3f(-gx, 0.0, -gz) * amp;
    nDetail += wi * vec3f(0.0);
  }
  var nrm = normalize(n - dAccum * 0.06);
  albedo = clamp(albedo, vec3f(0.0), vec3f(1.2));
  rough = clamp(rough, 0.08, 1.0);

  // ── debug views ──
  var debugCol = vec3f(0.0);
  var isDebug = true;
  switch u.viewMode {
    case 1u: { debugCol = albedo; }
    case 2u: { debugCol = nrm * 0.5 + vec3f(0.5); }
    case 3u: {
      let t = clamp(h, 0.0, 1.0);
      debugCol = mix(vec3f(0.05, 0.09, 0.16), vec3f(0.16, 0.42, 0.24), smoothstep(0.0, 0.35, t));
      debugCol = mix(debugCol, vec3f(0.45, 0.4, 0.3), smoothstep(0.3, 0.62, t));
      debugCol = mix(debugCol, vec3f(0.62, 0.6, 0.58), smoothstep(0.6, 0.85, t));
      debugCol = mix(debugCol, vec3f(0.95, 0.96, 0.98), smoothstep(0.85, 1.0, t));
    }
    case 4u: {
      let s = clamp(slopeDeg / 70.0, 0.0, 1.0);
      debugCol = mix(vec3f(0.12, 0.16, 0.12), vec3f(0.85, 0.35, 0.2), s);
    }
    case 5u: { debugCol = vec3f(ao); }
    case 6u: { debugCol = mix(vec3f(0.07, 0.1, 0.12), vec3f(0.25, 0.6, 0.9), clamp(flow * 1.4, 0.0, 1.0)); }
    case 7u: {
      debugCol = vec3f(w[0], w[1], w[2]) / max(total, 1e-4);
      let w4 = select(0.0, w[4], total > 0.0);
      debugCol = mix(debugCol, vec3f(0.1, 0.1, 0.14), clamp(w4, 0.0, 1.0) * 0.5);
    }
    default: { isDebug = false; }
  }
  if (isDebug) {
    let viewDir = normalize(u.camPos.xyz - in.world);
    let fogD = 1.0 - exp(-length(in.world - u.camPos.xyz) * u.fogDensity);
    let skyDebug = atmosphere(u.camPos.xyz, viewDir, u.sunDir.xyz, u.sunIntensity, u.mieAmount, 10, 4);
    let lit = debugCol * (0.35 + 0.65 * max(nDot(nrm, u.sunDir.xyz), 0.0)) * mix(1.0, ao, u.aoStrength);
    return vec4f(mix(lit, skyDebug, fogD * 0.85), 1.0);
  }

  // ── lighting ──
  let v = normalize(u.camPos.xyz - in.world);
  let l = u.sunDir.xyz;
  let nDotL = max(dot(nrm, l), 0.0);
  let shadow = shadowFactor(in.world, nDotL);
  let sun = u.sunColor.xyz;

  // ambient: sky dome + ground bounce
  let hemi = clamp(nrm.y * 0.5 + 0.5, 0.0, 1.0);
  let skyAmb = mix(u.ambHorizon.xyz, u.ambZenith.xyz, hemi);
  let bounce = albedo * u.ambHorizon.xyz * 0.22;
  let ambient = (skyAmb + bounce) * mix(1.0, ao, u.aoStrength);

  // direct with wrapped diffuse for soil/rock scatter
  let wrapped = clamp((dot(nrm, l) + 0.12) / 1.12, 0.0, 1.0);
  let diffuse = albedo * sun * wrapped * nDotL * shadow;

  // specular (GGX)
  let hv = normalize(l + v);
  let nDotV = max(dot(nrm, v), 1e-4);
  let nDotH = max(dot(nrm, hv), 0.0);
  let vDotH = max(dot(v, hv), 0.0);
  let dTerm = distributionGGX(nDotH, rough);
  let gTerm = geometrySmith(nDotV, nDotL, rough);
  let fTerm = fresnelSchlick(vDotH, 0.04);
  let spec = sun * shadow * dTerm * gTerm * fTerm * nDotL;

  var color = diffuse + ambient + spec;

  // ── aerial perspective ──
  let dist = length(in.world - u.camPos.xyz);
  let heightFall = exp(-max(u.camPos.xyz.y, 0.0) / 1400.0);
  let fogT = 1.0 - exp(-dist * u.fogDensity * heightFall);
  let inscatter = atmosphere(u.camPos.xyz, v, u.sunDir.xyz, u.sunIntensity, u.mieAmount, 10, 4);
  color = mix(color, inscatter, clamp(fogT, 0.0, 0.92));

  return vec4f(max(color, vec3f(0.0)), 1.0);
}
`;

/* ── Water plane ─────────────────────────────────────────────── */
export const WATER_VERT = /* wgsl */`
struct WaterVertU {
  viewProj: mat4x4f,
  level: f32,
  worldSize: f32,
  time: f32,
};
@group(0) @binding(0) var<uniform> u: WaterVertU;
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) ndc: vec4f,
};
@vertex
fn vs(@location(0) corner: vec2f) -> VOut {
  let world = vec3f(corner.x * u.worldSize * 0.5, u.level, corner.y * u.worldSize * 0.5);
  var out: VOut;
  out.world = world;
  out.ndc = u.viewProj * vec4f(world, 1.0);
  out.pos = out.ndc;
  return out;
}
`;

export const WATER_FRAG = /* wgsl */`
${ATMO_LIB}
struct WaterFragU {
  viewProj: mat4x4f,
  invViewProj: mat4x4f,
  camPos: vec4f,
  sunDir: vec4f,
  sunColor: vec4f,
  ambZenith: vec4f,
  ambHorizon: vec4f,
  level: f32,
  heightScale: f32,
  worldSize: f32,
  time: f32,
  ripple: f32,
  clarity: f32,
  foam: f32,
  fogDensity: f32,
  mieAmount: f32,
  sunIntensity: f32,
  screenW: f32,
  screenH: f32,
};
@group(0) @binding(1) var sceneColor: texture_2d<f32>;
@group(0) @binding(2) var sceneDepth: texture_depth_2d;
@group(0) @binding(3) var sceneSampler: sampler;
@group(0) @binding(4) var<uniform> u: WaterFragU;

struct FIn {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) ndc: vec4f,
};

fn waterNormal(wxz: vec2f, t: f32) -> vec3f {
  let ripple = max(u.ripple, 0.001);
  let e = 0.6;
  let q1 = wxz * vec2f(0.055, 0.075) + vec2f(t * 0.035, t * 0.021);
  let q2 = wxz * vec2f(0.13, -0.11) + vec2f(-t * 0.05, t * 0.032);
  let h0 = vfbm(q1, 4) + vfbm(q2, 3) * 0.6;
  let hx = vfbm(q1 + vec2f(e * 0.02, 0.0), 4) + vfbm(q2 + vec2f(e * 0.02, 0.0), 3) * 0.6;
  let hz = vfbm(q1 + vec2f(0.0, e * 0.02), 4) + vfbm(q2 + vec2f(0.0, e * 0.02), 3) * 0.6;
  let gx = (hx - h0) / (e * 0.02);
  let gz = (hz - h0) / (e * 0.02);
  let amp = ripple * 0.55;
  return normalize(vec3f(-gx * amp, 1.0, -gz * amp));
}

@fragment
fn fs(in: FIn) -> @location(0) vec4f {
  let uv = in.pos.xy / vec2f(u.screenW, u.screenH);
  // terrain behind the water surface via depth
  let depthRaw = textureLoad(sceneDepth, vec2i(uv * vec2f(u.screenW, u.screenH)), 0);
  let ndc = vec4f(uv.x * 2.0 - 1.0, (1.0 - uv.y) * 2.0 - 1.0, depthRaw, 1.0);
  let world4 = u.invViewProj * ndc;
  let terrainPos = world4.xyz / max(world4.w, 1e-5);
  let depth = u.level - terrainPos.y;
  if (depth <= 0.0) { discard; }

  let wxz = vec2f(in.world.x, in.world.z);
  let n = waterNormal(wxz, u.time);
  let v = normalize(u.camPos.xyz - in.world);
  let l = u.sunDir.xyz;

  // refraction: distort scene uv by the wave normal
  let distort = clamp(depth * 0.09, 0.0, 1.0);
  let refrUv = clamp(uv + n.xz * 0.018 * distort, vec2f(0.001), vec2f(0.999));
  var scene = textureSampleLevel(sceneColor, sceneSampler, refrUv, 0.0).rgb;

  // water body: Beer-Lambert absorption
  let absorb = exp(-depth * (0.35 + (1.0 - u.clarity) * 1.6));
  let shallowTint = vec3f(0.10, 0.24, 0.26);
  let deepColor = vec3f(0.012, 0.055, 0.09);
  let body = mix(shallowTint, deepColor, 1.0 - absorb);

  // sky reflection
  let r = reflect(-v, n);
  r.y = abs(r.y);
  let skyRefl = atmosphere(u.camPos.xyz, r, u.sunDir.xyz, u.sunIntensity, u.mieAmount, 12, 4);
  let fres = 0.02 + 0.98 * pow(clamp(1.0 - max(dot(n, v), 0.0), 0.0, 1.0), 5.0);

  // sun glitter
  let hv = normalize(l + v);
  let nDotH = max(dot(n, hv), 0.0);
  let spec = pow(nDotH, 620.0) * 2.6 + pow(nDotH, 90.0) * 0.12;

  // shoreline foam + wet sand
  let foamBand = 1.0 - smoothstep(0.0, 1.1 + u.foam * 1.4, depth);
  let foamNoise = vfbm(wxz * vec2f(0.5, 0.4) + vec2f(u.time * 0.03, 0.0), 4);
  let foam = clamp((foamBand - 0.25) * (0.55 + foamNoise * 0.8), 0.0, 1.0) * u.foam * 1.6;
  let wet = (1.0 - smoothstep(0.0, 0.5, depth)) * 0.5;

  var color = mix(scene * (1.0 - wet * 0.45), body, absorb * 0.85 + 0.12);
  color = mix(color, skyRefl, fres * 0.9);
  color += u.sunColor.xyz * spec * (0.4 + 0.6 * absorb);
  color = mix(color, vec3f(0.85, 0.9, 0.92), clamp(foam, 0.0, 1.0) * 0.75);

  // aerial perspective
  let dist = length(in.world - u.camPos.xyz);
  let heightFall = exp(-max(u.camPos.xyz.y, 0.0) / 1400.0);
  let fogT = 1.0 - exp(-dist * u.fogDensity * heightFall);
  let inscatter = atmosphere(u.camPos.xyz, v, u.sunDir.xyz, u.sunIntensity, u.mieAmount, 10, 4);
  color = mix(color, inscatter, clamp(fogT, 0.0, 0.9));
  return vec4f(max(color, vec3f(0.0)), 1.0);
}
`;

/* ── Composite: FXAA + exposure + ACES + vignette + grain ────── */
export const COMPOSITE_SHADER = /* wgsl */`
struct CompU {
  exposure: f32,
  time: f32,
  vignette: f32,
  pad0: f32,
  resolution: vec2f,
  pad1: vec2f,
};
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<uniform> u: CompU;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  var xy = array<vec2f, 3>(vec2f(-1.0, -3.0), vec2f(-1.0, 1.0), vec2f(3.0, 1.0));
  var out: VOut;
  out.pos = vec4f(xy[vi], 0.0, 1.0);
  out.uv = vec2f(xy[vi].x * 0.5 + 0.5, 1.0 - (xy[vi].y * 0.5 + 0.5));
  return out;
}

fn luma(c: vec3f) -> f32 { return dot(c, vec3f(0.299, 0.587, 0.114)); }

fn fxaa(uv: vec2f, texel: vec2f) -> vec3f {
  let cM = textureSampleLevel(src, srcSampler, uv, 0.0).rgb;
  let cNW = textureSampleLevel(src, srcSampler, uv + vec2f(-1.0, -1.0) * texel, 0.0).rgb;
  let cNE = textureSampleLevel(src, srcSampler, uv + vec2f(1.0, -1.0) * texel, 0.0).rgb;
  let cSW = textureSampleLevel(src, srcSampler, uv + vec2f(-1.0, 1.0) * texel, 0.0).rgb;
  let cSE = textureSampleLevel(src, srcSampler, uv + vec2f(1.0, 1.0) * texel, 0.0).rgb;
  let lM = luma(cM);
  let lNW = luma(cNW);
  let lNE = luma(cNE);
  let lSW = luma(cSW);
  let lSE = luma(cSE);
  let lMin = min(lM, min(min(lNW, lNE), min(lSW, lSE)));
  let lMax = max(lM, max(max(lNW, lNE), max(lSW, lSE)));
  let range = clamp(lMax - lMin, 0.0, 1.0);
  if (range < max(0.0312, lMax * 0.125)) { return cM; }
  let dir = vec2f(
    -((lNW + lNE) - (lSW + lSE)),
    ((lNW + lSW) - (lNE + lSE)));
  let rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + 1e-4);
  let dirRed = clamp(dir * rcp, vec2f(-8.0), vec2f(8.0)) * texel;
  let a = textureSampleLevel(src, srcSampler, uv + dirRed * (1.0 / 3.0 - 0.5), 0.0).rgb;
  let b = textureSampleLevel(src, srcSampler, uv + dirRed * (2.0 / 3.0 - 0.5), 0.0).rgb;
  let c = textureSampleLevel(src, srcSampler, uv + dirRed * (0.0 / 3.0 - 0.5), 0.0).rgb;
  let d = textureSampleLevel(src, srcSampler, uv + dirRed * (3.0 / 3.0 - 0.5), 0.0).rgb;
  let cA = 0.5 * (a + b);
  let cB = 0.5 * c + 0.25 * d;
  let lB = luma(cB);
  return select(cA, cB, (lB < lMin) || (lB > lMax));
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let texel = vec2f(1.0 / u.resolution.x, 1.0 / u.resolution.y);
  var color = fxaa(in.uv, texel);
  color *= u.exposure;
  color = acesFilmic(color);
  // vignette
  let d = length(in.uv - vec2f(0.5)) * 1.42;
  color *= 1.0 - u.vignette * smoothstep(0.45, 1.05, d) * 0.9;
  // ordered-ish grain to kill banding
  let g = fract(sin(dot(in.uv * u.resolution + u.time, vec2f(12.9898, 78.233))) * 43758.5453);
  color += (g - 0.5) * 0.0035;
  return vec4f(linearToSRGB(clamp(color, vec3f(0.0), vec3f(1.0))), 1.0);
}
`;
