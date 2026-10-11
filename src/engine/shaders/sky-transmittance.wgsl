// =================================================================================================

#include "atmosphere.wgsl"
//  sky-lut.wgsl — atmosphere tables
// -------------------------------------------------------------------------------------------------
//  transmittance : altitude x cos(zenith) -> transmittance to space. Rebuilt whenever the
//                  atmosphere or the sun moves. 256x64 rgba16float.
//  irradianceSH  : projects the sky radiance onto nine spherical harmonics at a reference altitude.
//                  This is the terrain's ambient light, so valleys facing north really are cooler
//                  than scree facing the sun instead of being lit by a flat hemisphere term.
//
//  The solar disc is deliberately excluded from the SH: it subtends 0.00006 sr and would alias
//  badly at any practical sample count. Direct sun light is evaluated analytically instead.
// =================================================================================================

const SH_THREADS: u32 = 64u;
const THETA_N: i32 = 32;
const PHI_N: i32 = 128;
const DIR_TOTAL: i32 = THETA_N * PHI_N;

// --- pass 1: transmittance ------------------------------------------------------------------------

@group(0) @binding(0) var<uniform> P: AtmoParams;
@group(0) @binding(1) var transOut: texture_storage_2d<rgba16float, write>;

@compute @workgroup_size(16, 16)
fn transmittance(@builtin(global_invocation_id) gid: vec3u) {
  let size = textureDimensions(transOut);
  if (gid.x >= size.x || gid.y >= size.y) { return; }

  let u = (f32(gid.x) + 0.5) / f32(size.x);
  let v = (f32(gid.y) + 0.5) / f32(size.y);
  let mu = uToMu(u);
  let alt = vToAlt(v, P);

  let R = P.p0.x;
  let top = R + P.p0.y;
  let o = vec3f(0.0, R + max(alt, 0.0), 0.0);
  let dir = normalize(vec3f(sqrt(max(1.0 - mu * mu, 0.0)), mu, 0.0));
  let hit = raySphere(o, dir, top);
  let tEnd = max(select(0.0, hit.y, hit.y > hit.x), 0.0);

  let n = 64;
  // Steps grow with altitude: near the ground the density changes over hundreds of metres, up high
  // it barely changes at all.
  let dt = max(tEnd, 1.0) / f32(n);
  var odR = 0.0;
  var odM = 0.0;
  var odO = 0.0;
  for (var i = 0; i < n; i = i + 1) {
    let tm = dt * (f32(i) + 0.5);
    let q = o + dir * tm;
    let a = max(length(q) - R, 0.0);
    let d = atmoDensity(a, P);
    odR = odR + d.x * dt;
    odM = odM + d.y * dt;
    odO = odO + d.z * dt;
  }
  let tau = extinction(P, vec3f(odR, odM, odO));
  let t = clamp(exp(-tau), vec3f(0.0), vec3f(1.0));
  textureStore(transOut, vec2i(gid.xy), vec4f(t, 1.0));
}
