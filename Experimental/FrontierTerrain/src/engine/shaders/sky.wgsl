// Full-screen sky background (single-scattering atmosphere + sun disc).
@group(0) @binding(0) var<uniform> V: View;
@group(0) @binding(1) var<storage, read> PR: array<vec4<f32>>;

@vertex
fn vs_sky(@builtin(vertex_index) vid: u32) -> @builtin(position) vec4<f32> {
  var p = array<vec2<f32>, 3>(vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  return vec4<f32>(p[vid], 1.0, 1.0);
}

@fragment
fn fs_sky(@builtin(position) fc: vec4<f32>) -> @location(0) vec4<f32> {
  let uv = fc.xy / V.ext.xy;
  let ndc = vec2<f32>(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0);
  let far = V.invVp * vec4<f32>(ndc, 1.0, 1.0);
  let dir = normalize(far.xyz / far.w - V.cam.xyz);
  let sunD = normalize(V.sun.xyz);
  let org = vec3<f32>(0.0, EARTH_R + 50.0, 0.0);
  var L = skyRad(dir, sunD, V.world.y, org);
  let mu = dot(dir, sunD);
  L = L + smoothstep(0.99985, 0.99998, mu) * PR[2].rgb * 0.6;
  let col = aces(L * V.world.z);
  return vec4<f32>(pow(col, vec3<f32>(1.0 / 2.2)), 1.0);
}
