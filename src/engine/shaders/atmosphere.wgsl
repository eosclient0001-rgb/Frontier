// =================================================================================================
//  atmosphere.wgsl — Rayleigh / Mie / ozone scattering
// -------------------------------------------------------------------------------------------------
//  Included by the sky LUT passes and by the terrain and water shaders so that the light arriving
//  at a surface and the light seen in the sky come from the same model.
//
//  The world is flat (a heightfield on a plane) but the sky is spherical: the planet centre sits at
//  y = -planetRadius, so world altitude is y and the zenith at any point is the local +Y. Over a
//  few kilometres of terrain the curvature error is centimetres; over the sky it matters completely.
//
//  Transmission from a point to the top of the atmosphere is tabulated (it depends only on altitude
//  and cos(zenith), so a 2D LUT is exact). Everything else is marched analytically, which keeps the
//  model valid at any camera altitude without rebuilding three-dimensional tables.
// =================================================================================================

struct AtmoParams {
  p0: vec4f,   // planetRadius(m), atmoTop(m), rayleighScaleH(m), mieScaleH(m)
  p1: vec4f,   // betaRayleigh.rgb, miePhaseG
  p2: vec4f,   // betaMieScatter.rgb, betaMieExtinction(scalar, grey)
  p3: vec4f,   // ozoneAbsorption.rgb, ozoneCentreAlt(m)
  p4: vec4f,   // sunDirection.xyz, sunIntensity
  p5: vec4f,   // ozoneWidth(m), marchSteps, referenceAlt(m), sunDiscAngularRadius(rad)
  p6: vec4f,   // groundAlbedo.rgb, exposure
};

// --- LUT parameterisation -------------------------------------------------------------------------
// mu is remapped with a square root so the LUT keeps resolution near the horizon, where
// transmittance changes fastest; altitude uses the standard square-root radius mapping.

fn muToU(mu: f32) -> f32 {
  return 0.5 + 0.5 * sign(mu) * sqrt(abs(clamp(mu, -1.0, 1.0)));
}

fn uToMu(u: f32) -> f32 {
  let s = clamp(u, 0.0, 1.0) * 2.0 - 1.0;
  return sign(s) * s * s;
}

fn altToV(alt: f32, P: AtmoParams) -> f32 {
  return sqrt(clamp(alt / max(P.p0.y, 1.0), 0.0, 1.0));
}

fn vToAlt(v: f32, P: AtmoParams) -> f32 {
  return clamp(v, 0.0, 1.0) * clamp(v, 0.0, 1.0) * P.p0.y;
}

fn sampleTransmittance(t: texture_2d<f32>, s: sampler, P: AtmoParams, alt: f32, mu: f32) -> vec3f {
  let uv = vec2f(muToU(mu), altToV(alt, P));
  return max(textureSampleLevel(t, s, uv, 0.0).rgb, vec3f(0.0));
}

// --- density profile ------------------------------------------------------------------------------
// Returns (rayleigh, mie, ozone) as fractions of their sea-level / peak values.

fn atmoDensity(alt: f32, P: AtmoParams) -> vec3f {
  let a = max(alt, 0.0);
  let rayleigh = exp(-a / max(P.p0.z, 1.0));
  let mie = exp(-a / max(P.p0.w, 1.0));
  // Ozone lives in a layer; a triangular profile around its centre altitude is close enough and
  // avoids a second exponential integral.
  let oz = max(0.0, 1.0 - abs(a - P.p3.w) / max(P.p5.x, 1.0));
  return vec3f(rayleigh, mie, oz);
}

fn extinction(P: AtmoParams, d: vec3f) -> vec3f {
  // (rayleigh amount, mie amount, ozone amount) -> per-wavelength optical depth per metre
  return P.p1.xyz * d.x + vec3f(P.p2.w * d.y) + P.p3.xyz * d.z;
}

// --- ray / sphere ---------------------------------------------------------------------------------

fn raySphere(o: vec3f, d: vec3f, radius: f32) -> vec2f {
  let b = dot(o, d);
  let c = dot(o, o) - radius * radius;
  let disc = b * b - c;
  if (disc < 0.0) { return vec2f(1.0, -1.0); }
  let s = sqrt(disc);
  return vec2f(-b - s, -b + s);
}

// --- phase functions ------------------------------------------------------------------------------

fn phaseRayleigh(cosT: f32) -> f32 {
  return 3.0 / (16.0 * 3.14159265) * (1.0 + cosT * cosT);
}

fn phaseMie(cosT: f32, g: f32) -> f32 {
  let gg = g * g;
  return (1.0 - gg) / (4.0 * 3.14159265 * pow(max(1.0 + gg - 2.0 * g * cosT, 1e-4), 1.5));
}

// --- single scattering ----------------------------------------------------------------------------
// `camAlt` is the observer's altitude in metres, `dir` a normalised world direction (y = up).
// `rayleigh` and `mie` are the accumulated in-scattering integrals; the caller scales them.

fn skyIntegrals(
  tLut: texture_2d<f32>,
  s: sampler,
  P: AtmoParams,
  camAlt: f32,
  dir: vec3f,
  steps: i32
) -> vec3f {
  let R = P.p0.x;
  let top = R + P.p0.y;
  let o = vec3f(0.0, R + max(camAlt, 1.0), 0.0);
  let hit = raySphere(o, dir, top);
  if (hit.y <= hit.x) { return vec3f(0.0); }

  let t0 = max(hit.x, 0.0);
  var t1 = hit.y;
  // A downward ray leaves through the ground, not through the far side of the atmosphere.
  let ground = raySphere(o, dir, R);
  if (ground.y > ground.x && ground.x > 0.0) { t1 = min(t1, ground.x); }
  if (t1 <= t0) { return vec3f(0.0); }
  let n = max(steps, 2);
  let dt = (t1 - t0) / f32(n);

  var odR = 0.0;
  var odM = 0.0;
  var odO = 0.0;
  var acc = vec3f(0.0);

  for (var i = 0; i < n; i = i + 1) {
    let tm = t0 + dt * (f32(i) + 0.5);
    let q = o + dir * tm;
    let alt = max(length(q) - R, 0.0);
    let d = atmoDensity(alt, P);
    let stepR = d.x * dt;
    let stepM = d.y * dt;
    let stepO = d.z * dt;
    odR = odR + stepR;
    odM = odM + stepM;
    odO = odO + stepO;
    let tau = extinction(P, vec3f(odR, odM, odO));
    let tView = exp(-tau);
    let zenith = normalize(q);
    let muS = dot(zenith, P.p4.xyz);
    let tSun = sampleTransmittance(tLut, s, P, alt, muS);
    acc = acc + tView * tSun * vec3f(stepR, stepM, stepO);
  }

  return acc;
}

// Radiance of the sky along `dir`, including a limb-darkened solar disc.
fn skyRadiance(
  tLut: texture_2d<f32>,
  s: sampler,
  P: AtmoParams,
  camAlt: f32,
  dir: vec3f,
  steps: i32,
  withSun: bool
) -> vec3f {
  let acc = skyIntegrals(tLut, s, P, camAlt, dir, steps);
  let cosT = dot(dir, P.p4.xyz);
  var L = P.p4.w * (
      P.p1.xyz * phaseRayleigh(cosT) * acc.x
    + P.p2.xyz * phaseMie(cosT, P.p1.w) * acc.y
  );

  if (withSun) {
    let ang = acos(clamp(cosT, -1.0, 1.0));
    let r = max(P.p5.w, 1e-5);
    let d = ang / r;
    if (d < 1.6) {
      // limb darkening: 0.35 at the centre falling to 0 at the edge
      let mu = sqrt(max(1.0 - d * d, 0.0));
      let limb = 0.35 + 0.65 * mu;
      let disc = smoothstep(1.0, 0.985, d) * limb;
      let tView = sampleTransmittance(tLut, s, P, camAlt, dir.y);
      L = L + P.p4.w * disc * tView * 900.0;
    }
  }
  return max(L, vec3f(0.0));
}

// Aerial perspective: inscattering and transmittance between the camera and a point at distance d.
// `sampleAlt` is the altitude of the surface point, which lets fog thin out correctly when looking
// down from a peak or up from a valley.
struct AerialResult {
  inscatter: vec3f,
  transmittance: vec3f,
};

fn aerialPerspective(
  tLut: texture_2d<f32>,
  s: sampler,
  P: AtmoParams,
  camAlt: f32,
  dir: vec3f,
  dist: f32,
  steps: i32
) -> AerialResult {
  var out: AerialResult;
  let R = P.p0.x;
  let top = R + P.p0.y;
  let o = vec3f(0.0, R + max(camAlt, 1.0), 0.0);
  // Stop at the surface, or at the atmosphere if the surface is somehow beyond it.
  var far = min(dist, raySphere(o, dir, top).y);
  let ground = raySphere(o, dir, R);
  if (ground.y > ground.x && ground.x > 0.0) { far = min(far, ground.x); }
  let farC = max(far, 0.0);
  let n = max(steps, 2);
  let dt = farC / f32(n);
  var odR = 0.0;
  var odM = 0.0;
  var odO = 0.0;
  var acc = vec3f(0.0);

  for (var i = 0; i < n; i = i + 1) {
    let tm = dt * (f32(i) + 0.5);
    let q = o + dir * tm;
    let alt = max(length(q) - R, 0.0);
    let d = atmoDensity(alt, P);
    let stepR = d.x * dt;
    let stepM = d.y * dt;
    let stepO = d.z * dt;
    odR = odR + stepR;
    odM = odM + stepM;
    odO = odO + stepO;
    let tView = exp(-extinction(P, vec3f(odR, odM, odO)));
    let zenith = normalize(q);
    let muS = dot(zenith, P.p4.xyz);
    let tSun = sampleTransmittance(tLut, s, P, alt, muS);
    acc = acc + tView * tSun * vec3f(stepR, stepM, stepO);
  }

  let cosT = dot(dir, P.p4.xyz);
  out.inscatter = P.p4.w * (
      P.p1.xyz * phaseRayleigh(cosT) * acc.x
    + P.p2.xyz * phaseMie(cosT, P.p1.w) * acc.y
  );
  out.transmittance = exp(-extinction(P, vec3f(odR, odM, odO)));
  return out;
}

// --- spherical harmonic evaluation ---------------------------------------------------------------
// Nine coefficients, Ramamoorthi's irradiance-environment-map convention: E(n) is returned already
// convolved with the cosine lobe, so the diffuse response is albedo * E(n) / PI.

struct SkySH {
  c: array<vec4f, 9>,
};

fn shIrradiance(sh: SkySH, n: vec3f) -> vec3f {
  let x = n.x;
  let y = n.y;
  let z = n.z;
  let L00 = sh.c[0].xyz;
  let L1m1 = sh.c[1].xyz;
  let L10 = sh.c[2].xyz;
  let L11 = sh.c[3].xyz;
  let L2m2 = sh.c[4].xyz;
  let L2m1 = sh.c[5].xyz;
  let L20 = sh.c[6].xyz;
  let L21 = sh.c[7].xyz;
  let L22 = sh.c[8].xyz;

  let c1 = 0.429043;
  let c2 = 0.511664;
  let c3 = 0.743125;
  let c4 = 0.886227;
  let c5 = 0.247708;

  return c4 * L00 - c5 * L20 + c3 * L20 * z * z
       + 2.0 * c1 * (L2m2 * x * y + L21 * x * z + L2m1 * y * z)
       + 2.0 * c2 * (L11 * x + L1m1 * y + L10 * z)
       + c1 * L22 * (x * x - y * y);
}
