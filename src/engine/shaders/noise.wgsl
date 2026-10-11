// =================================================================================================
//  noise.wgsl — gradient noise with analytic derivatives
// -------------------------------------------------------------------------------------------------
//  Every material in the texture stack needs a height field AND its gradient (to build a normal).
//  Evaluating a field three times for finite differences triples the cost of the most expensive
//  part of the frame, so all noise here returns (value, d/dx, d/dy[, d/dz]) in a single evaluation.
//  Interpolation is quintic (C2) so gradients are continuous and normals stay smooth.
//
//  Fractal sums track the accumulated domain transform so the returned derivative is with respect
//  to the ORIGINAL sample point, not the rotated/translated point handed to the last octave.
// =================================================================================================

const NOISE_SEED_STRIDE: u32 = 8191u;

// --- integer hashes ------------------------------------------------------------------------------
// A sin() hash drifts between GPU vendors and breaks seed reproducibility, which is unacceptable
// in an authoring tool. These are exact integer mixes.

fn uhash(a0: u32) -> u32 {
  var x = a0;
  x = x ^ (x >> 16u);
  x = x * 0x7feb352du;
  x = x ^ (x >> 15u);
  x = x * 0x846ca68bu;
  x = x ^ (x >> 16u);
  return x;
}

fn hash2v(ip: vec2i, seed: u32) -> vec2f {
  let h = uhash(u32(ip.x) * 0x27d4eb2du ^ u32(ip.y) * 0x165667b1u ^ seed * 0x9e3779b9u);
  let a = f32(h & 0xffffu) / 32767.5 - 1.0;
  let b = f32(h >> 16u) / 32767.5 - 1.0;
  return vec2f(a, b);
}

fn hash3v(ip: vec3i, seed: u32) -> vec3f {
  let h = uhash(
    u32(ip.x) * 0x27d4eb2du ^ u32(ip.y) * 0x165667b1u ^ u32(ip.z) * 0x9e3779b9u ^ seed * 0x85ebca6bu
  );
  let h2 = uhash(h ^ 0xc2b2ae35u);
  let a = f32(h & 0x3ffu) / 511.5 - 1.0;
  let b = f32((h >> 10u) & 0x3ffu) / 511.5 - 1.0;
  let c = f32(h2 & 0x3ffu) / 511.5 - 1.0;
  return vec3f(a, b, c);
}

// Gradients are normalised so every field has a predictable amplitude of ~1.
fn grad2(ip: vec2i, seed: u32) -> vec2f {
  return normalize(hash2v(ip, seed) + vec2f(1e-6));
}

fn grad3(ip: vec3i, seed: u32) -> vec3f {
  return normalize(hash3v(ip, seed) + vec3f(1e-6));
}

// --- 2D gradient noise + derivatives --------------------------------------------------------------

fn noised2(x_in: vec2f, seed: u32) -> vec3f {
  let p = floor(x_in);
  let w = x_in - p;
  let u = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
  let du = 30.0 * w * w * (w * (w - 2.0) + 1.0);

  let ip = vec2i(p);
  let ga = grad2(ip + vec2i(0, 0), seed);
  let gb = grad2(ip + vec2i(1, 0), seed);
  let gc = grad2(ip + vec2i(0, 1), seed);
  let gd = grad2(ip + vec2i(1, 1), seed);

  let va = dot(ga, w - vec2f(0.0, 0.0));
  let vb = dot(gb, w - vec2f(1.0, 0.0));
  let vc = dot(gc, w - vec2f(0.0, 1.0));
  let vd = dot(gd, w - vec2f(1.0, 1.0));

  let k0 = va;
  let k1 = vb - va;
  let k2 = vc - va;
  let k4 = va - vb - vc + vd;

  let v = k0 + k1 * u.x + k2 * u.y + k4 * u.x * u.y;

  let d = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd)
        + du * vec2f(k1 + k4 * u.y, k2 + k4 * u.x);

  return vec3f(v, d);
}

// --- 3D gradient noise + derivatives --------------------------------------------------------------

fn noised3(x_in: vec3f, seed: u32) -> vec4f {
  let p = floor(x_in);
  let w = x_in - p;
  let u = w * w * w * (w * (w * 6.0 - 15.0) + 10.0);
  let du = 30.0 * w * w * (w * (w - 2.0) + 1.0);

  let ip = vec3i(p);
  let ga = grad3(ip + vec3i(0, 0, 0), seed);
  let gb = grad3(ip + vec3i(1, 0, 0), seed);
  let gc = grad3(ip + vec3i(0, 1, 0), seed);
  let gd = grad3(ip + vec3i(1, 1, 0), seed);
  let ge = grad3(ip + vec3i(0, 0, 1), seed);
  let gf = grad3(ip + vec3i(1, 0, 1), seed);
  let gg = grad3(ip + vec3i(0, 1, 1), seed);
  let gh = grad3(ip + vec3i(1, 1, 1), seed);

  let va = dot(ga, w - vec3f(0.0, 0.0, 0.0));
  let vb = dot(gb, w - vec3f(1.0, 0.0, 0.0));
  let vc = dot(gc, w - vec3f(0.0, 1.0, 0.0));
  let vd = dot(gd, w - vec3f(1.0, 1.0, 0.0));
  let ve = dot(ge, w - vec3f(0.0, 0.0, 1.0));
  let vf = dot(gf, w - vec3f(1.0, 0.0, 1.0));
  let vg = dot(gg, w - vec3f(0.0, 1.0, 1.0));
  let vh = dot(gh, w - vec3f(1.0, 1.0, 1.0));

  let k0 = va;
  let k1 = vb - va;
  let k2 = vc - va;
  let k3 = ve - va;
  let k4 = va - vb - vc + vd;
  let k5 = va - vc - ve + vg;
  let k6 = va - vb - ve + vf;
  let k7 = -va + vb + vc - vd + ve - vf - vg + vh;

  let v = k0 + k1 * u.x + k2 * u.y + k3 * u.z + k4 * u.x * u.y + k5 * u.y * u.z
        + k6 * u.z * u.x + k7 * u.x * u.y * u.z;

  let d = ga
        + u.x * (gb - ga) + u.y * (gc - ga) + u.z * (ge - ga)
        + u.x * u.y * (ga - gb - gc + gd)
        + u.y * u.z * (ga - gc - ge + gg)
        + u.z * u.x * (ga - gb - ge + gf)
        + u.x * u.y * u.z * (-ga + gb + gc - gd + ge - gf - gg + gh)
        + du * (vec3f(k1, k2, k3)
              + u.yzx * vec3f(k4, k5, k6)
              + u.zxy * vec3f(k6, k4, k5)
              + u.yzx * u.zxy * k7);

  return vec4f(v, d);
}

// --- fractal sums ---------------------------------------------------------------------------------
// Octave rotation kills the axis-aligned grid a plain fBm shows at high octave counts. `m` is the
// accumulated domain transform; gradients are pulled back through transpose(m).

// Octave rotation matrices. Declared inside the sums as `let` so the module stays free of
// composite `const` declarations (portable across every WGSL implementation).

// Returns (value, dx, dy). Value is normalised to roughly [-1,1] at any octave count.
fn fbmd2(p: vec2f, octaves: i32, lacunarity: f32, gain: f32, seed: u32) -> vec3f {
  let R2 = mat2x2f(vec2f(0.8, 0.6), vec2f(-0.6, 0.8));
  var q = p;
  var m = mat2x2f(1.0, 0.0, 0.0, 1.0);
  var f = 1.0;
  var a = 0.5;
  var sum = 0.0;
  var amp = 0.0;
  var d = vec2f(0.0);
  for (var i = 0; i < octaves; i = i + 1) {
    let n = noised2(q * f, seed + u32(i) * NOISE_SEED_STRIDE);
    sum += a * n.x;
    d += a * f * (transpose(m) * n.yz);
    amp += a;
    f *= lacunarity;
    a *= gain;
    q = R2 * q + vec2f(17.31, 9.07);
    m = R2 * m;
  }
  let inv = select(1.0, 1.0 / max(amp, 1e-5), amp > 1e-5);
  return vec3f(sum * inv, d * inv);
}

fn fbmd3(p: vec3f, octaves: i32, lacunarity: f32, gain: f32, seed: u32) -> vec4f {
  let R3 = mat3x3f(vec3f(0.00, 0.80, 0.60), vec3f(-0.80, 0.36, -0.48), vec3f(-0.60, -0.48, 0.64));
  var q = p;
  var m = mat3x3f(1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0);
  var f = 1.0;
  var a = 0.5;
  var sum = 0.0;
  var amp = 0.0;
  var d = vec3f(0.0);
  for (var i = 0; i < octaves; i = i + 1) {
    let n = noised3(q * f, seed + u32(i) * NOISE_SEED_STRIDE);
    sum += a * n.x;
    d += a * f * (transpose(m) * n.yzw);
    amp += a;
    f *= lacunarity;
    a *= gain;
    q = R3 * q + vec3f(19.19, 7.77, 23.13);
    m = R3 * m;
  }
  let inv = select(1.0, 1.0 / max(amp, 1e-5), amp > 1e-5);
  return vec4f(sum * inv, d * inv);
}

// Ridged multifractal — the classic mountain spine. The abs() fold puts a crease at zero, which is
// exactly the ridge line; the gradient flips sign across it and is handled analytically.
// Output range is [0,1].
fn ridged2(p: vec2f, octaves: i32, lacunarity: f32, gain: f32, sharpness: f32, seed: u32) -> vec3f {
  let R2 = mat2x2f(vec2f(0.8, 0.6), vec2f(-0.6, 0.8));
  var q = p;
  var m = mat2x2f(1.0, 0.0, 0.0, 1.0);
  var f = 1.0;
  var a = 0.5;
  var sum = 0.0;
  var amp = 0.0;
  var d = vec2f(0.0);
  var weight = 1.0;
  for (var i = 0; i < octaves; i = i + 1) {
    let n = noised2(q * f, seed + u32(i) * NOISE_SEED_STRIDE);
    let folded = max(1.0 - abs(n.x), 1e-5);
    let powed = pow(folded, sharpness);
    let dpowed = -sharpness * pow(folded, sharpness - 1.0) * sign(n.x) * n.yz;
    let w = clamp(weight, 0.0, 1.0);
    sum += a * powed * powed * w;
    d += a * f * w * (transpose(m) * (2.0 * powed * dpowed));
    amp += a;
    // multifractal weighting: later octaves surface mainly where the signal is already strong
    weight = clamp(powed * 2.0, 0.0, 1.0);
    f *= lacunarity;
    a *= gain;
    q = R2 * q + vec2f(17.31, 9.07);
    m = R2 * m;
  }
  let inv = select(1.0, 1.0 / max(amp, 1e-5), amp > 1e-5);
  return vec3f(sum * inv, d * inv);
}

// Billow — rounded, cloud-like lobes; the inverse character of ridged.
fn billow2(p: vec2f, octaves: i32, lacunarity: f32, gain: f32, seed: u32) -> vec3f {
  let R2 = mat2x2f(vec2f(0.8, 0.6), vec2f(-0.6, 0.8));
  var q = p;
  var m = mat2x2f(1.0, 0.0, 0.0, 1.0);
  var f = 1.0;
  var a = 0.5;
  var sum = 0.0;
  var amp = 0.0;
  var d = vec2f(0.0);
  for (var i = 0; i < octaves; i = i + 1) {
    let n = noised2(q * f, seed + u32(i) * NOISE_SEED_STRIDE);
    sum += a * (abs(n.x) * 2.0 - 1.0);
    d += a * f * (transpose(m) * (2.0 * sign(n.x) * n.yz));
    amp += a;
    f *= lacunarity;
    a *= gain;
    q = R2 * q + vec2f(17.31, 9.07);
    m = R2 * m;
  }
  let inv = select(1.0, 1.0 / max(amp, 1e-5), amp > 1e-5);
  return vec3f(sum * inv, d * inv);
}

// --- cellular noise ------------------------------------------------------------------------------
// Worley F1 with derivatives: 0 at a cell centre, ~1 at the cell border. Used for cobbles, scree
// and cracked earth. Cheap enough at one octave; never fractal-summed.

fn worleyd2(p: vec2f, seed: u32) -> vec3f {
  let ip = floor(p);
  let fp = p - ip;
  var minDist = 1e9;
  var closest = vec2f(0.0);
  for (var j = -1; j <= 1; j = j + 1) {
    for (var i = -1; i <= 1; i = i + 1) {
      let o = vec2f(f32(i), f32(j));
      let c = o + 0.5 + 0.5 * hash2v(vec2i(ip) + vec2i(i, j), seed);
      let diff = c - fp;
      let dist = dot(diff, diff);
      if (dist < minDist) {
        minDist = dist;
        closest = diff;
      }
    }
  }
  let d = sqrt(minDist);
  let grad = select(vec2f(0.0), -closest / max(d, 1e-6), d > 1e-6);
  return vec3f(d, grad);
}

fn worleyd3(p: vec3f, seed: u32) -> vec4f {
  let ip = floor(p);
  let fp = p - ip;
  var minDist = 1e9;
  var closest = vec3f(0.0);
  for (var k = -1; k <= 1; k = k + 1) {
    for (var j = -1; j <= 1; j = j + 1) {
      for (var i = -1; i <= 1; i = i + 1) {
        let o = vec3f(f32(i), f32(j), f32(k));
        let c = o + 0.5 + 0.5 * hash3v(vec3i(ip) + vec3i(i, j, k), seed);
        let diff = c - fp;
        let dist = dot(diff, diff);
        if (dist < minDist) {
          minDist = dist;
          closest = diff;
        }
      }
    }
  }
  let d = sqrt(minDist);
  let grad = select(vec3f(0.0), -closest / max(d, 1e-6), d > 1e-6);
  return vec4f(d, grad);
}

// --- domain warping ------------------------------------------------------------------------------
// Warping is what separates a credible landscape from "noise with height". Two chained warp fields
// bend ridges into the hooked, branching shapes real orogeny produces.
fn warp2(p: vec2f, strength: f32, freq: f32, octaves: i32, seed: u32) -> vec2f {
  let q = fbmd2(p * freq + vec2f(0.0, 5.2), octaves, 2.0, 0.5, seed + 101u);
  let r = fbmd2(p * freq + q.xy * strength + vec2f(1.7, 9.2), octaves, 2.0, 0.5, seed + 337u);
  return p + r.xy * strength;
}

fn smoothstepv(edge0: f32, edge1: f32, x: f32) -> f32 {
  let t = clamp((x - edge0) / max(edge1 - edge0, 1e-6), 0.0, 1.0);
  return t * t * (3.0 - 2.0 * t);
}
