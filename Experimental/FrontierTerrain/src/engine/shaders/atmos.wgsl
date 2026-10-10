// ---------------------------------------------------------------------------
// Shared constants, the render-view uniform layout and a single-scattering
// Rayleigh + Mie atmosphere (Preetham-style scale heights, ray-marched).
// ---------------------------------------------------------------------------
const PI: f32 = 3.14159265;
const EARTH_R: f32 = 6360000.0;
const ATMO_R: f32 = 6420000.0;
const BETA_R: vec3<f32> = vec3<f32>(5.8e-6, 13.5e-6, 33.1e-6);
const BETA_M: f32 = 21e-6;
const SUN_I: f32 = 20.0;
const H_R: f32 = 7994.0;
const H_M: f32 = 1200.0;

struct View {
  vp: mat4x4<f32>,
  invVp: mat4x4<f32>,
  cam: vec4<f32>,    // xyz camera, w time (s)
  sun: vec4<f32>,    // xyz unit vector towards the sun
  grid: vec4<f32>,   // N, cell (m), maxH (m), sea level (m)
  world: vec4<f32>,  // half extent (m), haze, exposure, unused
  misc: vec4<f32>,   // viewMode, skirt depth (m), showWater, showRivers
  ext: vec4<f32>,    // viewport width, height, unused, unused
};

fn raySphere(o: vec3<f32>, d: vec3<f32>, r: f32) -> vec2<f32> {
  let b = dot(o, d);
  let c = dot(o, o) - r * r;
  let disc = b * b - c;
  if (disc < 0.0) { return vec2<f32>(-1.0, -1.0); }
  let s = sqrt(disc);
  return vec2<f32>(-b - s, -b + s);
}

// Radiance seen along `dir` from `org` (a point near sea level), in units where
// the sun contributes SUN_I * transmittance.
fn skyRad(dir: vec3<f32>, sunD: vec3<f32>, haze: f32, org: vec3<f32>) -> vec3<f32> {
  let bm = BETA_M * haze;
  let t = raySphere(org, dir, ATMO_R);
  if (t.y < 0.0) { return vec3<f32>(0.0); }
  var tEnd = t.y;
  let tg = raySphere(org, dir, EARTH_R);
  if (tg.x > 0.0) { tEnd = min(tEnd, tg.x); }
  let tStart = max(t.x, 0.0);
  let seg = (tEnd - tStart) / 16.0;
  var odR = 0.0;
  var odM = 0.0;
  var sumR = vec3<f32>(0.0);
  var sumM = vec3<f32>(0.0);
  let mu = dot(dir, sunD);
  let phR = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
  let g = 0.76;
  let g2 = g * g;
  let phM = 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + mu * mu)) / ((2.0 + g2) * pow(1.0 + g2 - 2.0 * g * mu, 1.5));
  for (var i: u32 = 0u; i < 16u; i = i + 1u) {
    let p = org + dir * (tStart + (f32(i) + 0.5) * seg);
    let h = length(p) - EARTH_R;
    let hr = exp(-h / H_R) * seg;
    let hm = exp(-h / H_M) * seg;
    odR = odR + hr;
    odM = odM + hm;
    let tg2 = raySphere(p, sunD, EARTH_R);
    if (tg2.x > 0.0) { continue; } // sample lies in the Earth's shadow
    let tl = raySphere(p, sunD, ATMO_R).y;
    let segL = tl / 4.0;
    var lR = 0.0;
    var lM = 0.0;
    for (var j: u32 = 0u; j < 4u; j = j + 1u) {
      let pl = p + sunD * ((f32(j) + 0.5) * segL);
      let hl = length(pl) - EARTH_R;
      lR = lR + exp(-hl / H_R) * segL;
      lM = lM + exp(-hl / H_M) * segL;
    }
    let tau = BETA_R * (odR + lR) + vec3<f32>(bm * 1.1 * (odM + lM));
    let att = exp(-tau);
    sumR = sumR + hr * att;
    sumM = sumM + hm * att;
  }
  return (sumR * BETA_R * phR + sumM * vec3<f32>(bm) * phM) * SUN_I;
}

// Transmittance from `org` towards the sun (fraction of sun light reaching org).
fn sunTrans(org: vec3<f32>, sunD: vec3<f32>, haze: f32) -> vec3<f32> {
  let t = raySphere(org, sunD, ATMO_R);
  let L = max(t.y, 0.0);
  var odR = 0.0;
  var odM = 0.0;
  for (var j: u32 = 0u; j < 24u; j = j + 1u) {
    let p = org + sunD * ((f32(j) + 0.5) * L / 24.0);
    let h = length(p) - EARTH_R;
    odR = odR + exp(-h / H_R) * L / 24.0;
    odM = odM + exp(-h / H_M) * L / 24.0;
  }
  return exp(-(BETA_R * odR + vec3<f32>(BETA_M * haze * 1.1 * odM)));
}

fn aces(x: vec3<f32>) -> vec3<f32> {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), vec3<f32>(0.0), vec3<f32>(1.0));
}
