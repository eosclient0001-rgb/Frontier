// ─────────────────────────────────────────────────────────────────────────────
//  Atmosphere — flat-earth exponential scattering model.
//
//  The scene is a local patch (a few km across) so the plane-parallel
//  approximation is exact enough and gives *closed-form* optical depth:
//      ∫ exp(-(h0 + c·s)/H) ds  =  H·(e^(-h0/H) - e^(-h1/H)) / c
//  which means every transmittance query costs three exponentials instead of a
//  ray march, and the only marching left is the single-scattering integral
//  (which we bake into a LUT).
// ─────────────────────────────────────────────────────────────────────────────

#include "lib.wgsl"

struct Atmo {
  betaR: vec3<f32>,   // Rayleigh scattering coefficient at sea level (1/m)
  HR: f32,            // Rayleigh scale height (m)
  betaM: vec3<f32>,   // Mie scattering
  HM: f32,
  betaO: vec3<f32>,   // Ozone absorption
  HO: f32,
  sunRad: vec3<f32>,  // extra-terrestrial solar radiance
  g: f32,             // Mie phase asymmetry
  top: f32,           // atmosphere top (m)
  msStrength: f32,    // multiple-scattering boost
  mieScale: f32,      // Mie density scale (turbidity)
  skyInt: f32,        // overall sky intensity
}

/// Sea-level coefficients, per metre. Rayleigh and ozone are physical;
/// Mie is driven by turbidity.
fn atmoMake(turbidity: f32, g: f32, sunRad: vec3<f32>, ms: f32, skyInt: f32, ozone: f32) -> Atmo {
  var a: Atmo;
  a.betaR = vec3<f32>(5.802e-6, 13.558e-6, 33.100e-6);
  a.HR = 8000.0;
  a.betaM = vec3<f32>(21.0e-6) * turbidity;
  a.HM = 1200.0;
  a.betaO = vec3<f32>(0.650e-6, 1.881e-6, 0.085e-6) * ozone;
  a.HO = 25000.0;
  a.sunRad = sunRad;
  a.g = g;
  a.top = 80000.0;
  a.msStrength = ms;
  a.mieScale = 1.0;
  a.skyInt = skyInt;
  return a;
}

/// Column density of one exponential species between two heights along a ray
/// whose vertical direction component is c, over path length L.
fn colDens(H: f32, h0: f32, h1: f32, c: f32, L: f32) -> f32 {
  let x = (h1 - h0) / H;
  if (abs(x) < 2.0e-3) {
    return L * 0.5 * (exp(-h0 / H) + exp(-h1 / H));
  }
  return H * (exp(-h0 / H) - exp(-h1 / H)) / c;
}

fn atmoColumn(a: Atmo, h0: f32, h1: f32, c: f32, L: f32) -> vec3<f32> {
  return vec3<f32>(
    colDens(a.HR, h0, h1, c, L),
    colDens(a.HM, h0, h1, c, L) * a.mieScale,
    colDens(a.HO, h0, h1, c, L));
}

fn atmoDensity(a: Atmo, h: f32) -> vec3<f32> {
  let hr = max(h, 0.0);
  return vec3<f32>(exp(-hr / a.HR), exp(-hr / a.HM) * a.mieScale, exp(-hr / a.HO));
}

/// Transmittance between two heights along direction with vertical component c.
fn atmoTransmit(a: Atmo, h0: f32, h1: f32, c: f32, L: f32) -> vec3<f32> {
  let col = atmoColumn(a, h0, h1, c, L);
  return exp(-(a.betaR * col.x + a.betaM * col.y + a.betaO * col.z));
}

/// Transmittance from height h to the top of the atmosphere looking along a
/// direction with vertical component c. c is floored so a horizon-grazing ray
/// sees a finite (large) air mass instead of infinity.
fn atmoTransmitToSpace(a: Atmo, h: f32, c: f32) -> vec3<f32> {
  let ce = max(c, 0.0085);
  let L = (a.top - h) / ce;
  return atmoTransmit(a, h, a.top, ce, L);
}

/// Transmittance of the direct solar beam at height h. Neatly produces the
/// warm, dim red sun of a low elevation for free.
fn atmoSunTransmit(a: Atmo, h: f32, sunY: f32) -> vec3<f32> {
  let ce = max(sunY, 0.0125);
  return atmoTransmitToSpace(a, h, ce);
}

/// How much of the solar disc is above the horizon (0 below, 1 above).
fn atmoSunVisible(sunY: f32) -> f32 {
  return smoothstep(-0.045, 0.012, sunY);
}

fn phaseRayleigh(mu: f32) -> f32 {
  return 3.0 / (16.0 * PI) * (1.0 + mu * mu);
}

fn phaseMieHG(mu: f32, g: f32) -> f32 {
  let gg = g * g;
  let d = 1.0 + gg - 2.0 * g * mu;
  return (1.0 - gg) / (4.0 * PI * pow(max(d, 1e-5), 1.5));
}

/// Cornette–Shanks: a stronger, more natural forward lobe than plain HG.
fn phaseMie(mu: f32, g: f32) -> f32 {
  let gg = g * g;
  let d = 1.0 + gg - 2.0 * g * mu;
  return 3.0 / (8.0 * PI) * ((1.0 - gg) * (1.0 + mu * mu)) /
         ((2.0 + gg) * pow(max(d, 1e-5), 1.5));
}

/// Single-scattering radiance along a ray. `steps` should be 24..96.
/// `jitter` in [0,1) dithers the first sample to hide step banding.
fn atmoInscatter(a: Atmo, h0: f32, dir: vec3<f32>, sunDir: vec3<f32>, steps: i32, jitter: f32) -> vec3<f32> {
  let mu = dot(dir, sunDir);
  let pR = phaseRayleigh(mu);
  let pM = phaseMie(mu, a.g);

  // Where does the ray leave the atmosphere (or reach the ground)?
  var tMax: f32;
  if (dir.y > 0.0015) {
    tMax = (a.top - h0) / dir.y;
  } else {
    tMax = 500000.0;
  }
  if (dir.y < -0.0005) {
    tMax = min(tMax, -h0 / dir.y);       // stop at the ground plane
  }
  tMax = min(tMax, 900000.0);

  let dt = tMax / f32(steps);
  var t = dt * jitter;
  var sumSS = vec3<f32>(0.0);
  var sumMS = vec3<f32>(0.0);

  for (var i = 0; i < steps; i++) {
    let hMid = h0 + dir.y * (t + dt * 0.5);
    let dens = atmoDensity(a, hMid);
    let L = t + dt * 0.5;
    let tv = atmoColumn(a, h0, hMid, dir.y, L);
    let ts = atmoColumn(a, hMid, a.top, max(sunDir.y, 0.0085), (a.top - hMid) / max(sunDir.y, 0.0085));
    let tau = a.betaR * (tv.x + ts.x) + a.betaM * (tv.y + ts.y) + a.betaO * (tv.z + ts.z);
    let T = exp(-tau);
    let w = dens * dt;
    sumSS += w * T;
    sumMS += w * exp(-(a.betaR * tv.x + a.betaM * tv.y + a.betaO * tv.z));
    t += dt;
  }

  let ss = a.sunRad * (a.betaR * pR + a.betaM * pM) * sumSS;
  // Multiple scattering: same integral with the sun path replaced by an
  // isotropic average. Lifts shadowed snow and the dark side of cliffs.
  let ms = a.sunRad * (a.betaR * 0.85 + a.betaM * 0.9) * (1.0 / (4.0 * PI)) * sumMS * a.msStrength;
  return (ss + ms) * a.skyInt * atmoSunVisible(sunDir.y);
}

/// Radiance of the solar disc with limb darkening, attenuated by the atmosphere.
fn atmoSunDisk(a: Atmo, h: f32, dir: vec3<f32>, sunDir: vec3<f32>, sunAngularRadius: f32) -> vec3<f32> {
  let cosT = dot(dir, sunDir);
  let cosR = cos(sunAngularRadius);
  if (cosT <= cosR) { return vec3<f32>(0.0); }
  let edge = smoothstep(cosR, cos(0.85 * sunAngularRadius), cosT);
  // simple limb darkening
  let mu = sqrt(max(1.0 - (1.0 - cosT) / max(1.0 - cosR, 1e-6), 0.0));
  let limb = mix(0.35, 1.0, pow(mu, 0.55));
  return a.sunRad * atmoSunTransmit(a, h, sunDir.y) * edge * limb * a.skyInt * atmoSunVisible(sunDir.y);
}

// ── sky LUT parameterisation ─────────────────────────────────────────────────
//  u : view zenith angle, warped for extra resolution at the horizon
//  v : cos(angle between view and sun), cubed for extra resolution near the sun
const SKY_THETA_MAX: f32 = 1.8208;   // ~104°

fn skyLUT_uv(dir: vec3<f32>, sunDir: vec3<f32>) -> vec2<f32> {
  let theta = acos(clamp(dir.y, -1.0, 1.0));
  let u = pow(sat(theta / SKY_THETA_MAX), 0.8);
  let cg = clamp(dot(dir, sunDir), -1.0, 1.0);
  let v = 0.5 + 0.5 * cg * cg * cg;
  return vec2<f32>(u, v);
}

fn skyLUT_dir(uv: vec2<f32>, sunDir: vec3<f32>) -> vec3<f32> {
  let theta = pow(sat(uv.x), 1.0 / 0.8) * SKY_THETA_MAX;
  let cg = clamp(sign(uv.y - 0.5) * pow(abs(uv.y - 0.5) * 2.0, 1.0 / 3.0), -1.0, 1.0);

  // Build a frame around the sun: dir = cos(theta)*up' + sin(theta)*(perp rotated by gamma)
  let up = vec3<f32>(0.0, 1.0, 0.0);
  var t1 = normalize(cross(up, sunDir));
  if (length(cross(up, sunDir)) < 1e-4) { t1 = vec3<f32>(1.0, 0.0, 0.0); }
  let t2 = cross(sunDir, t1);

  let gamma = acos(cg);
  let st = sin(theta);
  let radial = cos(gamma) * t1 + sin(gamma) * t2;
  return normalize(up * cos(theta) + radial * st);
}
