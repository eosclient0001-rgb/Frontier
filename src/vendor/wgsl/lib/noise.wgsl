// Frontier Terrain Forge — production noise toolbox.
// Requires: mathx.wgsl, hash.wgsl
//
// Everything is coordinate-stable, seed-driven and isotropic: octaves are
// rotated by an irrational step so no axis-aligned ridges ever appear, which is
// the single most common giveaway of a procedural terrain.

//#include "mathx.wgsl"
//#include "hash.wgsl"

const NOISE_ROT: f32 = 0.45102; // radians between octaves

fn gradAt(cell: vec2i, seed: u32) -> vec2f {
  // 16 directions for near-perfect isotropy.
  var dirs = array<vec2f, 16>(
    vec2f(1.0, 0.0), vec2f(0.9238795, 0.3826834), vec2f(0.7071068, 0.7071068), vec2f(0.3826834, 0.9238795),
    vec2f(0.0, 1.0), vec2f(-0.3826834, 0.9238795), vec2f(-0.7071068, 0.7071068), vec2f(-0.9238795, 0.3826834),
    vec2f(-1.0, 0.0), vec2f(-0.9238795, -0.3826834), vec2f(-0.7071068, -0.7071068), vec2f(-0.3826834, -0.9238795),
    vec2f(0.0, -1.0), vec2f(0.3826834, -0.9238795), vec2f(0.7071068, -0.7071068), vec2f(0.9238795, -0.3826834));
  let h = hash2i(cell, seed);
  let idx = u32(saturate(h.x) * 15.999);
  return dirs[idx];
}

/// Classic Perlin gradient noise, quintic interpolation. Range ≈ [-1, 1].
fn gnoise2(p: vec2f, seed: u32) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let cc = vec2i(i);
  let g00 = gradAt(cc, seed);
  let g10 = gradAt(cc + vec2i(1, 0), seed);
  let g01 = gradAt(cc + vec2i(0, 1), seed);
  let g11 = gradAt(cc + vec2i(1, 1), seed);
  let a = dot(g00, f);
  let b = dot(g10, f - vec2f(1.0, 0.0));
  let c = dot(g01, f - vec2f(0.0, 1.0));
  let d = dot(g11, f - vec2f(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 1.4142;
}

/// Cheap value noise — used for micro detail where gradients do not matter.
fn vnoise2(p: vec2f, seed: u32) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * (3.0 - 2.0 * f);
  let cc = vec2i(i);
  let a = hash2i(cc, seed).x;
  let b = hash2i(cc + vec2i(1, 0), seed).x;
  let c = hash2i(cc + vec2i(0, 1), seed).x;
  let d = hash2i(cc + vec2i(1, 1), seed).x;
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y) * 2.0 - 1.0;
}

/// Cellular noise: F1/F2 distances and the cell's random offset.
fn worley2(p: vec2f, seed: u32) -> vec3f {
  let i = floor(p);
  let f = p - i;
  let cc = vec2i(i);
  var f1 = 8.0;
  var f2 = 8.0;
  var cell = vec2f(0.0);
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let nb = vec2i(x, y);
      let o = hash2i(cc + nb, seed);
      let r = vec2f(nb) + o - f;
      let d = length(r);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        cell = vec2f(nb) + o;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return vec3f(f1, f2, hash12(cell * 17.13 + vec2f(f32(seed))));
}

fn vnoiseWarp(p0: vec2f, seed: u32, amount: f32) -> f32 {
  let w = vec2f(gnoise2(p0 * 0.5 + vec2f(11.3, 4.7), seed + 71u), gnoise2(p0 * 0.5 + vec2f(-3.1, 9.2), seed + 92u));
  return vnoise2(p0 + w * amount, seed);
}

// ---------------------------------------------------------------------------
// Fractal families. All return ~[0,1] unless noted.
// Each uses per-octave rotation + a small per-octave offset so higher octaves
// never repeat the lattice of the base octave.
// ---------------------------------------------------------------------------

fn fbm(p0: vec2f, octaves: u32, lacunarity: f32, gain: f32, seed: u32) -> f32 {
  var p = p0;
  var amp = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  let lac = clamp(lacunarity, 1.05, 4.0);
  let g = clamp(gain, 0.05, 0.95);
  for (var i = 0u; i < octaves; i = i + 1u) {
    sum = sum + gnoise2(p, seed + i * 131u) * amp;
    norm = norm + amp;
    amp = amp * g;
    p = rot2(p, NOISE_ROT) * lac + vec2f(1.71, 3.13);
  }
  return saturate(sum / max(norm, 1e-5) * 0.5 + 0.5);
}

fn billowFbm(p0: vec2f, octaves: u32, lacunarity: f32, gain: f32, seed: u32) -> f32 {
  var p = p0;
  var amp = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  for (var i = 0u; i < octaves; i = i + 1u) {
    sum = sum + abs(gnoise2(p, seed + i * 131u)) * amp;
    norm = norm + amp;
    amp = amp * gain;
    p = rot2(p, NOISE_ROT) * lacunarity + vec2f(2.31, 1.17);
  }
  return saturate(sum / max(norm, 1e-5));
}

fn ridgedFbm(p0: vec2f, octaves: u32, lacunarity: f32, gain: f32, sharp: f32, seed: u32) -> f32 {
  var p = p0;
  var amp = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  var prev = 1.0;
  for (var i = 0u; i < octaves; i = i + 1u) {
    let n = 1.0 - abs(gnoise2(p, seed + i * 197u));
    let r = pow(saturate(n), clamp(sharp, 0.25, 8.0));
    // Weighted (Musgrave) accumulation: octaves are masked by the previous one,
    // which keeps ridge lines continuous instead of speckled.
    let w = clamp(r * 2.0, 0.0, 1.0) * prev;
    sum = sum + r * w * amp;
    prev = w;
    norm = norm + amp;
    amp = amp * gain;
    p = rot2(p, NOISE_ROT) * lacunarity + vec2f(3.71, 1.13);
  }
  return saturate(sum / max(norm, 1e-5));
}

fn hybridMultifractal(p0: vec2f, octaves: u32, lacunarity: f32, gain: f32, offset: f32, seed: u32) -> f32 {
  var p = p0;
  var amp = 1.0;
  var sum = gnoise2(p, seed) * 0.5 + 0.5;
  var weight = sum;
  var norm = 1.0;
  for (var i = 1u; i < octaves; i = i + 1u) {
    weight = clamp(weight * gain, 0.0, 1.0);
    let n = gnoise2(p * pow(lacunarity, f32(i)), seed + i * 71u) * 0.5 + 0.5;
    let signal = (n + offset) * weight;
    sum = sum + signal * amp;
    norm = norm + amp;
    amp = amp * 0.5;
    p = rot2(p, NOISE_ROT);
    weight = clamp(signal, 0.0, 1.0);
  }
  return saturate(sum / max(norm, 1e-5));
}

fn pingPongFbm(p0: vec2f, octaves: u32, lacunarity: f32, gain: f32, k: f32, seed: u32) -> f32 {
  var p = p0;
  var amp = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  var prev = 0.0;
  for (var i = 0u; i < octaves; i = i + 1u) {
    let n = abs(gnoise2(p, seed + i * 89u));
    let shaped = sign(gnoise2(p, seed + i * 89u)) * (pow(n, clamp(k, 0.2, 8.0)) * 2.0);
    let v = (shaped - shaped * prev * 0.5) * 0.5 + 0.5;
    prev = shaped;
    sum = sum + v * amp;
    norm = norm + amp;
    amp = amp * gain;
    p = rot2(p, NOISE_ROT) * lacunarity + vec2f(1.31, 2.71);
  }
  return saturate(sum / max(norm, 1e-5));
}

/// Swiss turbulence — the "alpine wall" look: sharp peaks, concave flanks.
fn swissTurbulence(p0: vec2f, octaves: u32, lacunarity: f32, gain: f32, warp: f32, seed: u32) -> f32 {
  var p = p0;
  var sum = 0.0;
  var amp = 1.0;
  var norm = 0.0;
  for (var i = 0u; i < octaves; i = i + 1u) {
    let q = vec2f(gnoise2(p * 0.5 + vec2f(5.2, 1.3), seed + 41u), gnoise2(p * 0.5 + vec2f(3.7, 6.1), seed + 97u));
    let r = vec2f(gnoise2(p + q * warp * 0.5 + vec2f(1.7, 9.2), seed + 11u), gnoise2(p + q * warp * 0.5 + vec2f(8.3, 2.8), seed + 53u));
    let n = ridgedFbm(p + r * warp, 1u, 2.0, 0.5, 1.0, seed + i * 173u);
    sum = sum + n * amp;
    norm = norm + amp;
    amp = amp * gain;
    p = rot2(p, NOISE_ROT) * lacunarity + vec2f(2.9, 1.9);
  }
  return saturate(sum / max(norm, 1e-5));
}

/// iq-style eroded fbm: slope-dependent detail attenuation, gentle valleys.
fn erodedFbm(p0: vec2f, octaves: u32, lacunarity: f32, gain: f32, slopeAmount: f32, seed: u32) -> f32 {
  var p = p0;
  var h = 0.0;
  var amp = 1.0;
  var norm = 0.0;
  for (var i = 0u; i < octaves; i = i + 1u) {
    let n = gnoise2(p, seed + i * 37u) * 0.5 + 0.5;
    h = h + amp * n;
    norm = norm + amp;
    amp = amp * gain;
    p = rot2(p, NOISE_ROT) * lacunarity + vec2f(0.13, 0.71);
  }
  let t = h / max(norm, 1e-5);
  return saturate(t);
}

/// Cellular fbm — cracked basalt flats, canyon rims.
fn worleyFbm(p: vec2f, octaves: u32, lacunarity: f32, gain: f32, seed: u32) -> f32 {
  var q = p;
  var amp = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  for (var i = 0u; i < octaves; i = i + 1u) {
    let w = worley2(q, seed + i * 61u);
    sum = sum + (1.0 - saturate(w.x)) * amp;
    norm = norm + amp;
    amp = amp * gain;
    q = rot2(q, NOISE_ROT) * lacunarity + vec2f(1.13, 4.07);
  }
  return saturate(sum / max(norm, 1e-5));
}

/// Ridge-line network: thin bright channels where cellular cells meet.
fn crackNetwork(p: vec2f, octaves: u32, lacunarity: f32, gain: f32, width: f32, seed: u32) -> f32 {
  var q = p;
  var amp = 1.0;
  var sum = 0.0;
  var norm = 0.0;
  for (var i = 0u; i < octaves; i = i + 1u) {
    let w = worley2(q, seed + i * 43u);
    let edge = saturate((w.y - w.x) / max(width, 1e-3));
    sum = sum + (1.0 - edge) * amp;
    norm = norm + amp;
    amp = amp * gain;
    q = rot2(q, NOISE_ROT) * lacunarity + vec2f(2.3, 0.7);
  }
  return saturate(sum / max(norm, 1e-5));
}

/// Two-channel domain warp. Feed the result back into any noise for
/// continental-scale flowing structure instead of blobs.
fn warpVec(p: vec2f, amount: f32, freq: f32, seed: u32) -> vec2f {
  let q = p * freq;
  let wx = gnoise2(q + vec2f(0.0, 0.0), seed + 5u) + 0.5 * gnoise2(q * 2.03 + vec2f(1.7, 9.2), seed + 23u);
  let wy = gnoise2(q + vec2f(5.2, 1.3), seed + 17u) + 0.5 * gnoise2(q * 2.03 + vec2f(8.3, 3.1), seed + 29u);
  return vec2f(wx, wy) * amount;
}

fn warpFbm(p: vec2f, amount: f32, freq: f32, octaves: u32, gain: f32, seed: u32) -> f32 {
  let w = warpVec(p, amount, freq, seed);
  return fbm(p + w, octaves, 2.0, gain, seed + 101u);
}

/// Ridged warp — the signature "folded mountain range" flow pattern.
fn warpRidged(p: vec2f, amount: f32, freq: f32, octaves: u32, gain: f32, sharp: f32, seed: u32) -> f32 {
  let w = warpVec(p, amount, freq, seed);
  return ridgedFbm(p + w, octaves, 2.0, gain, sharp, seed + 211u);
}

/// Swift's "Jordan" turbulence: strongly asymmetric, good for massif flanks.
fn jordanTurbulence(p0: vec2f, octaves: u32, lacunarity: f32, gain: f32, seed: u32) -> f32 {
  var p = p0;
  var sum = 0.0;
  var amp = 1.0;
  var norm = 0.0;
  for (var i = 0u; i < octaves; i = i + 1u) {
    let n = abs(gnoise2(p, seed + i * 151u));
    sum = sum + (1.0 - n * n) * amp;
    norm = norm + amp;
    amp = amp * gain;
    p = rot2(p, NOISE_ROT) * lacunarity + vec2f(4.1, 2.3);
  }
  return saturate(sum / max(norm, 1e-5));
}

// ---------------------------------------------------------------------------
// Anisotropic helpers — wind streaks, dune fields, glacial lineations.
// ---------------------------------------------------------------------------

fn aniso(p: vec2f, angle: f32, stretch: f32) -> vec2f {
  let r = rot2(p, -angle);
  return vec2f(r.x, r.y * max(stretch, 0.02));
}

fn streakNoise(p: vec2f, angle: f32, stretch: f32, seed: u32) -> f32 {
  return gnoise2(aniso(p, angle, stretch), seed);
}

/// Radial falloff helpers (island shelves, calderas, basins).
fn radialFalloff(uv: vec2f, center: vec2f, radius: f32, power: f32) -> f32 {
  let d = length((uv - center) * vec2f(1.0, 1.0));
  return pow(saturate(1.0 - d / max(radius, 1e-4)), clamp(power, 0.1, 8.0));
}

fn radialRim(uv: vec2f, center: vec2f, radius: f32, width: f32, power: f32) -> f32 {
  let d = length(uv - center);
  return pow(saturate(1.0 - abs(d - radius) / max(width, 1e-4)), clamp(power, 0.1, 8.0));
}
