// Project-Ocean O0 — gradient sky + sun disc, fullscreen pass behind the water.
struct SkyU {
  invViewProj : mat4x4<f32>,
  camPos : vec3<f32>,
  pad0 : f32,
  sunDir : vec3<f32>,
  sunSize : f32,
  zenith : vec3<f32>,
  haze : f32,
  horizon : vec3<f32>,
  pad1 : f32,
  sunColor : vec3<f32>,
  pad2 : f32,
};
@group(0) @binding(0) var<uniform> u : SkyU;

struct SOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) ndc : vec2<f32>,
};

@vertex
fn vsSky(@builtin(vertex_index) vi : u32) -> SOut {
  var p = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0));
  var o : SOut;
  o.clip = vec4<f32>(p[vi], 1.0, 1.0);
  o.ndc = p[vi];
  return o;
}

@fragment
fn fsSky(f : SOut) -> @location(0) vec4<f32> {
  let w4 = u.invViewProj * vec4<f32>(f.ndc, 1.0, 1.0);
  let dir = normalize(w4.xyz / max(w4.w, 0.0001) - u.camPos);
  var col = mix(u.horizon, u.zenith, pow(max(dir.y, 0.0), 0.55));
  col = mix(u.horizon, col, smoothstep(-0.05, 0.02, dir.y));
  let d = max(dot(dir, u.sunDir), 0.0);
  col = col + u.sunColor * (smoothstep(0.9993, 0.9997, d) * 4.0 +
    pow(d, 350.0) * 0.9 + pow(d, 8.0) * 0.12);
  col = mix(col, u.horizon, (1.0 - smoothstep(0.0, 0.18, abs(dir.y))) * u.haze * 0.6);
  col = pow(max(col, vec3<f32>(0.0)), vec3<f32>(0.4545));
  return vec4<f32>(col, 1.0);
}
