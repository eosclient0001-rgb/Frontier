// ─────────────────────────────────────────────────────────────────────────────
//  Shared shading core — included by the terrain pass and the water pass.
//
//  Height is read from a two-channel 16-bit split encoding so it can be
//  hardware-filtered at float precision everywhere (rgba16float is filterable
//  on every adapter; r32float is not guaranteed to be).
// ─────────────────────────────────────────────────────────────────────────────

#include "frame.wgsl"
#include "atmosphere.wgsl"
#include "materials.wgsl"

@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var heightTex: texture_2d<f32>;
@group(0) @binding(2) var surfTex: texture_2d<f32>;
@group(0) @binding(3) var samp: sampler;
@group(0) @binding(4) var<storage, read> MAT: array<LayerParams>;
@group(0) @binding(5) var skyTex: texture_2d<f32>;
@group(0) @binding(6) var<storage, read> SHBUF: array<vec4<f32>>;

// ── terrain access ───────────────────────────────────────────────────────────
fn res_f() -> f32 { return F.terr.x; }
fn heightScale() -> f32 { return F.terr.y; }
fn worldSize() -> f32 { return F.terr.z; }

fn worldToUv(p: vec3<f32>) -> vec2<f32> { return p.xz / F.terr.z + 0.5; }

/// Normalised height (0..1) at a uv, from the split 16-bit encoding.
fn hUv(uv: vec2<f32>) -> f32 {
  let t = textureSampleLevel(heightTex, samp, uv, 0.0);
  return t.x + t.y;
}

/// Height in metres at a world XZ position.
fn hWorld(xz: vec2<f32>) -> f32 { return hUv(xz / F.terr.z + 0.5) * F.terr.y; }

/// World-space terrain normal from the packed channels.
fn nUv(uv: vec2<f32>) -> vec3<f32> {
  let t = textureSampleLevel(heightTex, samp, uv, 0.0);
  return normalize(vec3<f32>(-t.z, 1.0, -t.w));
}

fn surfAt(uv: vec2<f32>) -> vec4<f32> {
  return textureSampleLevel(surfTex, samp, uv, 0.0);
}

// ── atmosphere plumbing ──────────────────────────────────────────────────────
fn atmo() -> Atmo {
  return atmoMake(F.atmo.x, F.atmo.y, F.sunRad.xyz * F.sunDir.w, F.atmo.z, F.atmo.w, F.sunRad.w);
}

fn skyRadiance(dir: vec3<f32>) -> vec3<f32> {
  let uv = skyLUT_uv(dir, F.sunDir.xyz);
  return textureSampleLevel(skyTex, samp, uv, 0.0).rgb;
}

/// Order-2 spherical-harmonic irradiance for a normal, in the same units as
/// `skyRadiance`, converted to an outgoing radiance factor by 1/pi.
fn skyIrradiance(n: vec3<f32>) -> vec3<f32> {
  let c1 = 0.429043; let c2 = 0.511664; let c3 = 0.743125;
  let c4 = 0.886227; let c5 = 0.247708;
  let L00 = SHBUF[0].xyz;
  let L1m1 = SHBUF[1].xyz;
  let L10 = SHBUF[2].xyz;
  let L11 = SHBUF[3].xyz;
  let L2m2 = SHBUF[4].xyz;
  let L2m1 = SHBUF[5].xyz;
  let L20 = SHBUF[6].xyz;
  let L21 = SHBUF[7].xyz;
  let L22 = SHBUF[8].xyz;
  let x = n.x; let y = n.y; let z = n.z;
  let e = c1 * L22 * (x * x - y * y) + c3 * L20 * z * z + c4 * L00 - c5 * L20
        + 2.0 * c1 * (L2m2 * x * y + L21 * x * z + L2m1 * y * z)
        + 2.0 * c2 * (L11 * x + L1m1 * y + L10 * z);
  return max(e, vec3<f32>(0.0)) * F.atmo.w;
}

/// Direct sun radiance reaching a point at height h.
fn sunRadiance(h: f32) -> vec3<f32> {
  let a = atmo();
  return a.sunRad * atmoSunTransmit(a, max(h, 0.0), F.sunDir.y) * atmoSunVisible(F.sunDir.y);
}

/// Aerial perspective: attenuate toward the sky colour along the view ray.
fn aerial(color: vec3<f32>, p: vec3<f32>, camY: f32) -> vec3<f32> {
  let a = atmo();
  let d = p - F.camPos.xyz;
  let dist = length(d);
  let dirv = d / max(dist, 1e-4);
  let c = dirv.y;
  let T = atmoTransmit(a, max(camY, 0.0), max(p.y, 0.0), c, dist);
  let sky = skyRadiance(dirv);
  // Rayleigh haze reads slightly bluer than the raw sky integral
  return color * T + sky * (1.0 - T) * 0.92;
}

// ── shadows ──────────────────────────────────────────────────────────────────
/// Heightfield ray march toward the sun with a geometrically growing step so
/// near-field contact shadows stay sharp while distant ridges still occlude.
fn sunShadow(p: vec3<f32>, n: vec3<f32>, dither: f32) -> f32 {
  let L = F.sunDir.xyz;
  if (L.y <= 0.001) { return 0.0; }
  let soft = max(F.terr1.z, 0.0005);
  let cell = F.terr.z / res_f();
  let maxT = F.terr.z * 1.1;
  let steps = 96;

  let o = p + n * max(cell * 0.9, 0.35) + L * cell * 0.6;
  var t = 0.0;
  var dt = max(cell * 0.75, 0.25);
  var res = 1.0;
  let r = 1.055;
  t += dt * dither;
  for (var i = 0; i < steps; i = i + 1) {
    t = t + dt;
    let q = o + L * t;
    let uv = worldToUv(q);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { break; }
    let dh = q.y - hWorld(q.xz);
    if (dh <= 0.0) { return 0.0; }
    res = min(res, dh / (t * soft + 1e-4));
    dt = dt * r;
    if (t > maxT) { break; }
  }
  return sat(res);
}

/// March a ray against the heightfield. Returns (t, hit).
fn marchTerrain(o: vec3<f32>, d: vec3<f32>, maxT: f32, steps: i32) -> vec2<f32> {
  if (d.y > -0.0001 && o.y > hWorld(o.xz)) {
    // travelling upward from above the surface: only a descending ray can hit
    if (d.y >= 0.0) { return vec2<f32>(-1.0, 0.0); }
  }
  var t = 0.0;
  let dt = maxT / f32(steps);
  var prevD = o.y - hWorld(o.xz);
  for (var i = 0; i < steps; i = i + 1) {
    let tn = t + dt;
    let q = o + d * tn;
    let uv = worldToUv(q);
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) { return vec2<f32>(-1.0, 0.0); }
    let dd = q.y - hWorld(q.xz);
    if (dd <= 0.0) {
      // bisect for a crisp silhouette
      var a = t; var b = tn;
      for (var k = 0; k < 6; k = k + 1) {
        let m = (a + b) * 0.5;
        let qm = o + d * m;
        if (qm.y - hWorld(qm.xz) > 0.0) { a = m; } else { b = m; }
      }
      return vec2<f32>(b, 1.0);
    }
    prevD = dd;
    t = tn;
  }
  return vec2<f32>(-1.0, 0.0);
}

// ── BRDF ─────────────────────────────────────────────────────────────────────
fn D_GGX(NoH: f32, a: f32) -> f32 {
  let a2 = a * a;
  let d = NoH * NoH * (a2 - 1.0) + 1.0;
  return a2 / max(PI * d * d, 1e-7);
}
fn V_SmithGGX(NoV: f32, NoL: f32, a: f32) -> f32 {
  let a2 = a * a;
  let gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  let gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  return 0.5 / max(gv + gl, 1e-6);
}
fn F_Schlick(f0: vec3<f32>, VoH: f32) -> vec3<f32> {
  let f = pow(1.0 - VoH, 5.0);
  return f0 + (vec3<f32>(1.0) - f0) * f;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Material stack
// ─────────────────────────────────────────────────────────────────────────────
struct Surface {
  albedo: vec3<f32>,
  rough: f32,
  normal: vec3<f32>,
  occ: f32,
  sss: f32,
  wet: f32,
  metal: f32,
}

fn evalStack(p: vec3<f32>, nGeo: vec3<f32>, uv: vec2<f32>, pw: f32, waterLevel: f32) -> Surface {
  let sf = surfAt(uv);
  let flow = sf.g;
  let deposit = sf.b;
  let curv = sf.a;
  let ao = mix(1.0, sf.r, F.terr1.w);

  var c: MaskCtx;
  c.h = hUv(uv);
  c.slope = sat(acos(clamp(nGeo.y, 0.0, 1.0)) / (PI * 0.5));
  c.curv = curv;
  c.flow = flow;
  c.deposit = deposit;
  c.ao = sf.r;
  c.aspect = fract(atan2(-nGeo.z, -nGeo.x) / TAU + 1.0);
  c.wxz = p.xz;

  var accAlb = vec3<f32>(0.0);
  var accRough = 0.0;
  var accGrad = vec3<f32>(0.0);
  var accOcc = 0.0;
  var accSSS = 0.0;
  var accMetal = 0.0;
  var wsum = 0.0;
  let count = i32(F.terr2.y);
  let hbStrength = F.terr2.z;

  for (var i = 0; i < count; i = i + 1) {
    let m = MAT[i];
    if (m.f.w == 0u) { continue; }
    let wm = evalMask(&MAT[i].m, m.f.z, c);
    if (wm <= 0.0015) { continue; }
    var min: MatIn;
    min.p = p;
    min.n = nGeo;
    min.a = m.a;
    min.c = m.c;
    min.pw = pw;
    min.slope = c.slope;
    let s = matSample(min, m.f.x);

    var w = sat(wm * m.a[8].x);
    // height blending: the taller relief eats into its neighbours
    w = sat(w + (s.height - 0.5) * hbStrength * m.a[8].y);
    if (w <= 0.0) { continue; }

    accAlb += s.albedo * w;
    accRough += s.rough * w;
    accGrad += s.grad * w;
    accOcc += s.occ * w;
    accMetal += s.metal * w;
    let isSnow = select(0.0, 1.0, m.f.x == MAT_SNOW);
    accSSS += isSnow * w;
    wsum += w;
  }

  var out: Surface;
  if (wsum <= 1e-5) {
    out.albedo = vec3<f32>(0.32, 0.30, 0.28);
    out.rough = 0.9;
    out.normal = nGeo;
    out.occ = ao;
    out.sss = 0.0;
    out.wet = 0.0;
    out.metal = 0.0;
    return out;
  }
  let inv = 1.0 / wsum;
  out.albedo = accAlb * inv;
  out.rough = sat(accRough * inv);
  out.occ = sat(accOcc * inv) * ao;
  out.sss = sat(accSSS * inv);
  out.metal = sat(accMetal * inv);
  let grad = accGrad * inv;

  // surface-gradient bump mapping
  let n = nGeo;
  let g = grad;
  out.normal = normalize(n - (g - dot(n, g) * n));

  // wetness: below the water line and along channels
  let depth = waterLevel * F.terr.y - p.y;
  let nearWater = sat(1.0 - depth / 2.5);
  let wetness = sat(max(nearWater * select(0.0, 1.0, F.terr1.y > 0.5), sat(flow * 1.4 - 0.35)));
  out.wet = wetness;
  out.albedo = out.albedo * mix(1.0, 0.62, wetness * 0.85);
  out.rough = mix(out.rough, min(out.rough, 0.28), wetness);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
//  Direct + indirect lighting for a surface point
// ─────────────────────────────────────────────────────────────────────────────
fn shadePoint(p: vec3<f32>, n: vec3<f32>, s: Surface, dither: f32, ao: f32) -> vec3<f32> {
  let V = normalize(F.camPos.xyz - p);
  let L = F.sunDir.xyz;
  let NoV = max(dot(n, V), 1e-4);
  let NoL = max(dot(n, L), 0.0);
  let a = max(s.rough * s.rough, 0.002);
  let f0 = mix(vec3<f32>(0.04), s.albedo, s.metal);

  var radiance = vec3<f32>(0.0);

  // ── sun
  if (NoL > 0.0) {
    let sh = sunShadow(p, n, dither);
    if (sh > 0.0) {
      let H = normalize(L + V);
      let NoH = max(dot(n, H), 0.0);
      let VoH = max(dot(V, H), 0.0);
      let spec = F_Schlick(f0, VoH) * D_GGX(NoH, a) * V_SmithGGX(NoV, NoL, a);
      let kd = (vec3<f32>(1.0) - F_Schlick(f0, VoH)) * (1.0 - s.metal);
      let diffuse = kd * s.albedo * INV_PI;
      radiance += (diffuse + spec) * sunRadiance(p.y) * NoL * sh;
    }
  }

  // ── sky (order-2 SH irradiance, occluded by the baked horizon term)
  let irr = skyIrradiance(n);
  radiance += s.albedo * INV_PI * irr * mix(1.0, ao * ao, F.terr1.w);

  // ── one bounce of light off the surrounding terrain
  let groundN = normalize(n + vec3<f32>(0.0, 1.6, 0.0));
  let bounce = skyIrradiance(groundN) * 0.22 * s.albedo;
  radiance += s.albedo * INV_PI * bounce * (1.0 - ao) * 1.6;

  // ── cheap wrap-lighting so snow does not read as plastic
  if (s.sss > 0.001) {
    let wrap = pow(sat(dot(V, -L) * 0.5 + 0.5), 3.0);
    radiance += s.albedo * INV_PI * sunRadiance(p.y) * wrap * s.sss * F.misc.y * ao;
  }

  // ── specular sky reflection
  let R = reflect(-V, n);
  let skyR = skyRadiance(R);
  let fres = F_Schlick(f0, NoV);
  let specAO = mix(1.0, ao, 0.6);
  radiance += skyR * fres * (1.0 - s.rough * 0.85) * specAO;

  return radiance;
}

/// Full terrain evaluation at a world position (used by water too).
fn shadeTerrain(p: vec3<f32>, dither: f32, lodScale: f32) -> vec3<f32> {
  let uv = worldToUv(p);
  let nGeo = nUv(uv);
  let sf = surfAt(uv);
  let s = evalStack(p, nGeo, uv, lodScale, F.terr1.x);
  let ao = mix(1.0, sf.r, F.terr1.w) * s.occ;
  var col = shadePoint(p, s.normal, s, dither, ao);
  col = aerial(col, p, max(F.camPos.y, 0.0));
  return col;
}

// ── debug visualisations ─────────────────────────────────────────────────────
fn debugView(mode: f32, p: vec3<f32>, uv: vec2<f32>, col: vec3<f32>, s: Surface) -> vec3<f32> {
  let sf = surfAt(uv);
  if (mode < 0.5) { return col; }
  if (mode < 1.5) { return s.albedo; }
  if (mode < 2.5) { return s.normal * 0.5 + 0.5; }
  if (mode < 3.5) { return vec3<f32>(s.rough); }
  if (mode < 4.5) { return vec3<f32>(hUv(uv)); }
  if (mode < 5.5) { return vec3<f32>(sf.r); }
  if (mode < 6.5) { return vec3<f32>(sf.g); }
  if (mode < 7.5) { return vec3<f32>(sf.b); }
  if (mode < 8.5) { return vec3<f32>(sf.a); }
  if (mode < 9.5) { return vec3<f32>(sunShadow(p, vec3<f32>(0.0, 1.0, 0.0), 0.5)); }
  if (mode < 10.5) { return vec3<f32>(sat(acos(clamp(nUv(uv).y, 0.0, 1.0)) / (PI * 0.5))); }
  return col;
}
