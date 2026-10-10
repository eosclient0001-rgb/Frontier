// ─────────────────────────────────────────────────────────────────────────────
//  Sky LUT + spherical-harmonic irradiance.
//
//  With a plane-parallel atmosphere the radiance depends only on the view
//  zenith and the angle to the sun, so a 2D table is exact. Recomputed only
//  when the sun or the atmosphere changes.
// ─────────────────────────────────────────────────────────────────────────────

#include "frame.wgsl"
#include "atmosphere.wgsl"

@group(0) @binding(0) var<uniform> F: Frame;
@group(0) @binding(1) var skyOut: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<storage, read_write> SHBUF: array<vec4<f32>>;
@group(0) @binding(3) var skyTex: texture_2d<f32>;
@group(0) @binding(4) var samp: sampler;

const SKY_W: i32 = 256;
const SKY_H: i32 = 256;

@compute @workgroup_size(8, 8, 1)
fn skyMain(@builtin(global_invocation_id) gid: vec3<u32>) {
  if (i32(gid.x) >= SKY_W || i32(gid.y) >= SKY_H) { return; }
  let uv = (vec2<f32>(f32(gid.x), f32(gid.y)) + 0.5) / vec2<f32>(f32(SKY_W), f32(SKY_H));
  let dir = skyLUT_dir(uv, F.sunDir.xyz);
  let a = atmoMake(F.atmo.x, F.atmo.y, F.sunRad.xyz * F.sunDir.w, F.atmo.z, F.atmo.w, F.sunRad.w);
  let h0 = max(F.camPos.y, 1.0);
  let col = atmoInscatter(a, h0, dir, F.sunDir.xyz, 48, 0.5);
  textureStore(skyOut, vec2<i32>(gid.xy), vec4<f32>(col, 1.0));
}

// ── order-2 SH irradiance, integrated over the sphere from the LUT ───────────
const SH_THETA: i32 = 64;
const SH_PHI: i32 = 32;
const SH_DIRS: i32 = SH_THETA * SH_PHI;      // 2048
const SH_LANES: i32 = 64;                    // 27 * 64 * 4B = 6.9 kB of shared

var<workgroup> shAcc: array<f32, 1728>;

@compute @workgroup_size(64, 1, 1)
fn skySH(@builtin(local_invocation_index) lii: u32) {
  let li = i32(lii);
  let a = atmoMake(F.atmo.x, F.atmo.y, F.sunRad.xyz * F.sunDir.w, F.atmo.z, F.atmo.w, F.sunRad.w);
  var acc: array<vec3<f32>, 9>;
  for (var c = 0; c < 9; c = c + 1) { acc[c] = vec3<f32>(0.0); }

  let perThread = (SH_DIRS + SH_LANES - 1) / SH_LANES;
  for (var k = 0; k < perThread; k = k + 1) {
    let idx = li + k * SH_LANES;
    if (idx >= SH_DIRS) { break; }
    let i = idx % SH_THETA;
    let j = idx / SH_THETA;
    let theta = (f32(i) + 0.5) / f32(SH_THETA) * PI;
    let phi = (f32(j) + 0.5) / f32(SH_PHI) * TAU;
    let st = sin(theta);
    let d = vec3<f32>(st * cos(phi), cos(theta), st * sin(phi));
    let dOmega = st * (PI / f32(SH_THETA)) * (TAU / f32(SH_PHI));
    let w = smoothstep(-0.22, -0.02, d.y);        // nothing below the horizon
    if (w <= 0.0) { continue; }

    var rad = textureSampleLevel(skyTex, samp, skyLUT_uv(d, F.sunDir.xyz), 0.0).rgb;
    rad = rad + atmoSunDisk(a, max(F.camPos.y, 1.0), d, F.sunDir.xyz, 0.00465);
    rad = rad * w * dOmega;

    let x = d.x; let y = d.y; let z = d.z;
    acc[0] = acc[0] + rad * 0.282095;
    acc[1] = acc[1] + rad * (0.488603 * y);
    acc[2] = acc[2] + rad * (0.488603 * z);
    acc[3] = acc[3] + rad * (0.488603 * x);
    acc[4] = acc[4] + rad * (1.092548 * x * y);
    acc[5] = acc[5] + rad * (1.092548 * y * z);
    acc[6] = acc[6] + rad * (0.315392 * (3.0 * z * z - 1.0));
    acc[7] = acc[7] + rad * (1.092548 * x * z);
    acc[8] = acc[8] + rad * (0.546274 * (x * x - y * y));
  }

  // stage every lane's 27 values in shared memory, then reduce them together
  for (var c = 0; c < 9; c = c + 1) {
    shAcc[c * 3 * SH_LANES + li] = acc[c].x;
    shAcc[(c * 3 + 1) * SH_LANES + li] = acc[c].y;
    shAcc[(c * 3 + 2) * SH_LANES + li] = acc[c].z;
  }
  workgroupBarrier();

  var s = SH_LANES / 2;
  loop {
    if (s < 1) { break; }
    if (li < s) {
      for (var c = 0; c < 27; c = c + 1) {
        shAcc[c * SH_LANES + li] = shAcc[c * SH_LANES + li] + shAcc[c * SH_LANES + li + s];
      }
    }
    workgroupBarrier();
    s = s / 2;
  }

  if (li == 0) {
    for (var c = 0; c < 9; c = c + 1) {
      SHBUF[c] = vec4<f32>(shAcc[c * 3 * SH_LANES],
                           shAcc[(c * 3 + 1) * SH_LANES],
                           shAcc[(c * 3 + 2) * SH_LANES],
                           0.0);
    }
  }
}
