// Sky probe: once per sun change, integrate the sky for ambient light, the
// horizon colour used for aerial perspective and the sun colour at ground level.
struct PU {
  sun: vec4<f32>,
  haze: vec4<f32>,
};
@group(0) @binding(0) var<uniform> PUd: PU;
@group(0) @binding(1) var<storage, read_write> PR: array<vec4<f32>>;

@compute @workgroup_size(1)
fn probe_main() {
  let sunD = normalize(PUd.sun.xyz);
  let haze = PUd.haze.x;
  let org = vec3<f32>(0.0, EARTH_R + 50.0, 0.0);
  var amb = vec3<f32>(0.0);
  for (var i: u32 = 0u; i < 64u; i = i + 1u) {
    let z = (f32(i) + 0.5) / 64.0;
    let r = sqrt(max(0.0, 1.0 - z * z));
    let phi = f32(i) * 2.39996323;
    let dir = vec3<f32>(r * cos(phi), z, r * sin(phi));
    amb = amb + skyRad(dir, sunD, haze, org) * z;
  }
  // Uniform hemisphere pdf 1/(2pi): E/pi = 2 * mean(L cos).
  PR[0] = vec4<f32>(amb * 2.0 / 64.0, 1.0);
  var hor = vec3<f32>(0.0);
  for (var i: u32 = 0u; i < 16u; i = i + 1u) {
    let a = f32(i) / 16.0 * 6.2831853;
    let d = normalize(vec3<f32>(cos(a), 0.04, sin(a)));
    hor = hor + skyRad(d, sunD, haze, org);
  }
  PR[1] = vec4<f32>(hor / 16.0, 1.0);
  PR[2] = vec4<f32>(sunTrans(org, sunD, haze) * SUN_I, 1.0);
  PR[3] = vec4<f32>(skyRad(vec3<f32>(0.0, 1.0, 0.0), sunD, haze, org), 1.0);
}
