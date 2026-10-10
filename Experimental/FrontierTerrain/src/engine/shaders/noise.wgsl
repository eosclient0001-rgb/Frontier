// ---------------------------------------------------------------------------
// Noise library: 2D simplex, fBm (fBm / ridged / billow / hybrid multifractal),
// Worley/Voronoi with integer hashing. All deterministic and seedable.
// ---------------------------------------------------------------------------
struct Uni {
  n: u32,
  kind: u32,
  mode: u32,
  mtype: u32,
  cell: f32,
  maxH: f32,
  seed: f32,
  opacity: f32,
  p: array<vec4<f32>, 4>,
};

const ROT2: mat2x2<f32> = mat2x2<f32>(vec2<f32>(0.8, 0.6), vec2<f32>(-0.6, 0.8));

fn mod289v3(x: vec3<f32>) -> vec3<f32> { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn mod289v2(x: vec2<f32>) -> vec2<f32> { return x - floor(x * (1.0 / 289.0)) * 289.0; }
fn permute3(x: vec3<f32>) -> vec3<f32> { return mod289v3(((x * 34.0) + 1.0) * x); }

fn snoise(v: vec2<f32>) -> f32 {
  let C = vec4<f32>(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  var i = floor(v + vec2<f32>(dot(v, C.yy)));
  let x0 = v - i + vec2<f32>(dot(i, C.xx));
  var i1 = vec2<f32>(0.0, 1.0);
  if (x0.x > x0.y) { i1 = vec2<f32>(1.0, 0.0); }
  var x12 = x0.xyxy + C.xxzz;
  x12 = vec4<f32>(x12.xy - i1, x12.zw);
  i = mod289v2(i);
  let p = permute3(permute3(vec3<f32>(i.y, i.y + i1.y, i.y + 1.0)) + vec3<f32>(i.x, i.x + i1.x, i.x + 1.0));
  var m = max(vec3<f32>(0.5) - vec3<f32>(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), vec3<f32>(0.0));
  m = m * m;
  m = m * m;
  let x = 2.0 * fract(p * C.www) - 1.0;
  let h = abs(x) - 0.5;
  let ox = floor(x + 0.5);
  let a0 = x - ox;
  m = m * (1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h));
  let g = vec3<f32>(a0.x * x0.x + h.x * x0.y, a0.y * x12.x + h.y * x12.y, a0.z * x12.z + h.z * x12.w);
  return 130.0 * dot(m, g);
}

// Returns a value in [0,1].
fn fbm(p0: vec2<f32>, oct: i32, lac: f32, gain: f32, typ: i32) -> f32 {
  var q = p0;
  var amp = 0.5;
  var sum = 0.0;
  var norm = 0.0;
  var w = 1.0;
  for (var i: i32 = 0; i < oct; i = i + 1) {
    let n = snoise(q);
    var v = 0.0;
    if (typ == 0) {
      v = 0.5 + 0.5 * n;
    } else if (typ == 1) {
      v = 1.0 - abs(n);
      v = v * v;
    } else if (typ == 2) {
      v = abs(n);
    } else {
      v = 1.0 - abs(n);
      v = v * v * w;
      w = clamp(v * 2.0, 0.0, 1.0);
    }
    sum = sum + v * amp;
    norm = norm + amp;
    amp = amp * gain;
    q = ROT2 * q * lac;
  }
  return sum / max(norm, 1e-5);
}

// Band-limited fBm. f0 is the cycles-per-unit scale of p0, fmax the highest
// octave frequency (same units) that the grid can represent. Octaves above
// fmax fade out smoothly; the amplitude normalisation uses the faded weights,
// so the output stays in [0,1]. Without this, hybrid multifractal octaves
// finer than a few cells dominate and produce cell-scale spikes.
fn fbmL(p0: vec2<f32>, oct: i32, lac: f32, gain: f32, typ: i32, f0: f32, fmax: f32) -> f32 {
  var q = p0;
  var amp = 0.5;
  var sum = 0.0;
  var norm = 0.0;
  var w = 1.0;
  var f = f0;
  for (var i: i32 = 0; i < oct; i = i + 1) {
    let n = snoise(q);
    var v = 0.0;
    if (typ == 0) {
      v = 0.5 + 0.5 * n;
    } else if (typ == 1) {
      v = 1.0 - abs(n);
      v = v * v;
    } else if (typ == 2) {
      v = abs(n);
    } else {
      v = 1.0 - abs(n);
      v = v * v * w;
      w = clamp(v * 2.0, 0.0, 1.0);
    }
    let band = 1.0 - smoothstep(0.5 * fmax, fmax, f);
    let a = amp * band;
    sum = sum + v * a;
    norm = norm + a;
    amp = amp * gain;
    f = f * lac;
    q = ROT2 * q * lac;
  }
  return sum / max(norm, 1e-5);
}

fn ihash(x0: u32) -> u32 {
  var x = x0;
  x = x ^ (x >> 16u);
  x = x * 0x7feb352du;
  x = x ^ (x >> 15u);
  x = x * 0x846ca68bu;
  x = x ^ (x >> 16u);
  return x;
}

fn hcell(ix: i32, iy: i32, s: u32) -> u32 {
  return ihash(((bitcast<u32>(ix) * 0x9E3779B1u) ^ (bitcast<u32>(iy) * 0x85EBCA77u)) ^ (s * 0xC2B2AE3Du));
}

fn rnd2(ix: i32, iy: i32, s: u32) -> vec2<f32> {
  let a = hcell(ix, iy, s);
  let b = ihash(a ^ 0x68E31DA4u);
  return vec2<f32>(f32(a >> 8u), f32(b >> 8u)) * (1.0 / 16777216.0);
}

// Returns (F1, F2, cell random).
fn voronoi(p: vec2<f32>, jitter: f32, s: u32) -> vec3<f32> {
  let ip = floor(p);
  let fp = p - ip;
  var f1 = 8.0;
  var f2 = 8.0;
  var cid = 0.0;
  for (var j: i32 = -1; j <= 1; j = j + 1) {
    for (var i: i32 = -1; i <= 1; i = i + 1) {
      let g = vec2<f32>(f32(i), f32(j));
      let r = rnd2(i32(ip.x) + i, i32(ip.y) + j, s);
      let o = vec2<f32>(0.5) + (r - vec2<f32>(0.5)) * jitter;
      let d = length(g + o - fp);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        cid = r.x;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return vec3<f32>(f1, f2, cid);
}

fn band(x: f32, lo: f32, hi: f32, fe: f32) -> f32 {
  return smoothstep(lo - fe, lo + fe + 1e-5, x) * (1.0 - smoothstep(hi - fe, hi + fe + 1e-5, x));
}
