// Frontier Terrain Forge — scalar / vector / color math shared by every stage.
// Conventions: heights are normalised shape space in the CPU graph, metres in
// the erosion stack, and everything spatial is measured in world metres.

const PI: f32 = 3.14159265358979;
const TAU: f32 = 6.28318530717959;

fn saturate(v: f32) -> f32 { return clamp(v, 0.0, 1.0); }

/// Derive a stable integer seed for a sub-generator from the field seed.
fn seedOf(seed: f32, salt: u32) -> u32 {
  return u32(saturate(abs(seed)) * 4294000000.0) ^ (salt * 2654435761u);
}
fn saturate2(v: vec2f) -> vec2f { return clamp(v, vec2f(0.0), vec2f(1.0)); }
fn saturate3(v: vec3f) -> vec3f { return clamp(v, vec3f(0.0), vec3f(1.0)); }
fn saturate4(v: vec4f) -> vec4f { return clamp(v, vec4f(0.0), vec4f(1.0)); }

fn remap(v: f32, lo: f32, hi: f32, nlo: f32, nhi: f32) -> f32 {
  if (abs(hi - lo) < 1e-9) { return nlo; }
  return nlo + (v - lo) / (hi - lo) * (nhi - nlo);
}

fn remapClamped(v: f32, lo: f32, hi: f32, nlo: f32, nhi: f32) -> f32 {
  return remap(saturate(remap(v, lo, hi, 0.0, 1.0)), 0.0, 1.0, nlo, nhi);
}

fn smootherstep(e0: f32, e1: f32, x: f32) -> f32 {
  let t = saturate((x - e0) / max(e1 - e0, 1e-6));
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn gainCurve(v: f32, k: f32) -> f32 {
  // Gaea-style gain: k < 1 flattens, k > 1 sharpens, symmetric around 0.5.
  let g = clamp(k, 0.001, 8.0);
  if (v < 0.5) { return 0.5 * pow(saturate(v * 2.0), g); }
  return 1.0 - 0.5 * pow(saturate((1.0 - v) * 2.0), g);
}

fn terraceCurve(v: f32, steps: f32, sharpness: f32) -> f32 {
  let n = max(steps, 1.0);
  let s = floor(v * n);
  let f = fract(v * n);
  let shaped = pow(f, clamp(sharpness, 1.0, 16.0));
  return saturate((s + shaped) / n);
}

fn smin(a: f32, b: f32, k: f32) -> f32 {
  let h = saturate(0.5 + 0.5 * (b - a) / max(k, 1e-5));
  return mix(b, a, h) - k * h * (1.0 - h);
}

fn smax(a: f32, b: f32, k: f32) -> f32 { return -smin(-a, -b, k); }

fn rot2(p: vec2f, angle: f32) -> vec2f {
  let c = cos(angle);
  let s = sin(angle);
  return vec2f(c * p.x - s * p.y, s * p.x + c * p.y);
}

fn luminance(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }

fn hsv2rgb(c: vec3f) -> vec3f {
  let k = vec4f(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  let p = abs(fract(vec3f(c.x) + vec3f(k.x, k.y, k.z)) * 6.0 - vec3f(k.w));
  return c.z * mix(vec3f(k.x), clamp(p - vec3f(k.x), vec3f(0.0), vec3f(1.0)), c.y);
}

fn rgb2hsv(c: vec3f) -> vec3f {
  let k = vec4f(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  let p = select(vec4f(c.bg, k.wz), vec4f(c.gb, k.xy), c.g < c.b);
  let q = select(vec4f(p.xyw, c.r), vec4f(c.r, p.yzx), c.r < p.x);
  let d = q.x - min(q.w, q.y);
  let e = 1e-10;
  return vec3f(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

fn shiftHue(c: vec3f, shift: f32, satMul: f32, valueMul: f32) -> vec3f {
  var hsv = rgb2hsv(max(c, vec3f(0.0)));
  hsv.x = fract(hsv.x + shift);
  hsv.y = saturate(hsv.y * satMul);
  hsv.z = saturate(hsv.z * valueMul);
  return hsv2rgb(hsv);
}

/// Piecewise linear ramp over up to 8 (rgb, position) stops.
/// Positions must be sorted ascending; the last stop is the outer clamp.
fn rampColor(stops: array<vec4f, 8>, count: u32, t: f32) -> vec3f {
  var st = stops;
  let x = saturate(t);
  if (count == 0u) { return vec3f(x); }
  if (count == 1u) { return st[0].rgb; }
  if (x <= st[0].w) { return st[0].rgb; }
  for (var i = 1u; i < count; i = i + 1u) {
    let lo = st[i - 1u];
    let hi = st[i];
    if (x <= hi.w) {
      let f = (x - lo.w) / max(hi.w - lo.w, 1e-4);
      return mix(lo.rgb, hi.rgb, saturate(f));
    }
  }
  return st[count - 1u].rgb;
}

/// Same ramp with smooth (smootherstep) blending between stops — the default
/// for rock and soil palettes, where hard segment edges read as banding.
fn rampColorSmooth(stops: array<vec4f, 8>, count: u32, t: f32) -> vec3f {
  var st = stops;
  let x = saturate(t);
  if (count == 0u) { return vec3f(x); }
  if (count == 1u) { return st[0].rgb; }
  if (x <= st[0].w) { return st[0].rgb; }
  for (var i = 1u; i < count; i = i + 1u) {
    let lo = st[i - 1u];
    let hi = st[i];
    if (x <= hi.w) {
      return mix(lo.rgb, hi.rgb, smootherstep(lo.w, hi.w, x));
    }
  }
  return st[count - 1u].rgb;
}

fn acesFilm(x: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return saturate3((x * (a * x + vec3f(b))) / (x * (c * x + vec3f(d)) + vec3f(e)));
}

fn linearToSrgb(c: vec3f) -> vec3f {
  let lo = c * 12.92;
  let hi = 1.055 * pow(max(c, vec3f(0.0)), vec3f(1.0 / 2.4)) - vec3f(0.055);
  return select(hi, lo, c <= vec3f(0.0031308));
}

fn srgbToLinear(c: vec3f) -> vec3f {
  let lo = c / 12.92;
  let hi = pow((c + vec3f(0.055)) / 1.055, vec3f(2.4));
  return select(hi, lo, c <= vec3f(0.04045));
}

/// Cool-to-warm grade used by the viewport's "cinematic" toggle.
fn colorGrade(c: vec3f, contrast: f32, saturation: f32, lift: vec3f, gain: vec3f) -> vec3f {
  var v = (c - vec3f(0.18)) * contrast + vec3f(0.18);
  v = v * gain + lift;
  let l = luminance(v);
  return mix(vec3f(l), v, saturation);
}
