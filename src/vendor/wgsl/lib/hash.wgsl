// Frontier Terrain Forge — hash + PRNG primitives (Jarzynski & Olano 2020).

fn pcg1d(v: u32) -> u32 {
  var s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}

fn pcg2d(v: vec2u) -> vec2u {
  var s = v * vec2u(1664525u) + vec2u(1013904223u);
  s = s + (s.yx * vec2u(1664525u));
  s = s ^ (s >> vec2u(16u));
  s = s + (s.yx * vec2u(1664525u));
  s = s ^ (s >> vec2u(16u));
  return s;
}

fn pcg3d(v: vec3u) -> vec3u {
  var s = v * vec3u(1664525u) + vec3u(1013904223u);
  s = s + vec3u(dot(s, s.yzx + vec3u(33u)));
  s = s ^ (s >> vec3u(16u));
  s = s + vec3u(dot(s, s.yzx + vec3u(33u)));
  s = s ^ (s >> vec3u(16u));
  s = s + vec3u(dot(s, s.yzx + vec3u(33u)));
  return s;
}

/// Uniform float in [0,1).
fn hash1(v: u32) -> f32 { return f32(pcg1d(v)) * (1.0 / 4294967296.0); }

/// Two independent uniforms in [0,1).
fn hash2(v: u32) -> vec2f { return vec2f(pcg2d(vec2u(v, v ^ 0x9e3779b9u))) * (1.0 / 4294967296.0); }

fn hash2i(v: vec2i, seed: u32) -> vec2f {
  let u = vec2u(bitcast<u32>(v.x), bitcast<u32>(v.y));
  return vec2f(pcg2d(u ^ vec2u(seed, seed * 2654435761u))) * (1.0 / 4294967296.0);
}

fn hash3i(v: vec3i, seed: u32) -> vec3f {
  let u = vec3u(bitcast<u32>(v.x), bitcast<u32>(v.y), bitcast<u32>(v.z));
  return vec3f(pcg3d(u ^ vec3u(seed, seed * 2654435761u, seed * 40503u))) * (1.0 / 4294967296.0);
}

/// Common hex-trick hash used for cheap per-texel jitter.
fn hash12(p: vec2f) -> f32 {
  var x = fract(p * 0.1031);
  x = x + vec2f(dot(x, x.yx + vec2f(33.33)));
  return fract((x.x + x.y) * x.x);
}

fn hash22(p: vec2f) -> vec2f {
  var x = fract(p * vec2f(0.1031, 0.1030));
  x = x + vec2f(dot(x, x.yx + vec2f(33.33)));
  return fract((x.xx + x.yy) * x.xy);
}
