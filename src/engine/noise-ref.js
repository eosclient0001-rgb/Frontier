// =================================================================================================
//  noise-ref.js — a JavaScript mirror of noise.wgsl
// -------------------------------------------------------------------------------------------------
//  Used to draw the thumbnail previews in the inspector. It is a literal transcription of the
//  shader, bit for bit, so the preview is the noise the GPU will actually produce rather than an
//  approximation of it — which matters, because a preview that only resembles the result is worse
//  than no preview at all when the user is choosing a noise type by eye.
// =================================================================================================

const u32 = (x) => x >>> 0;
const imul = (a, b) => Math.imul(a, b) >>> 0;

function uhash(a0) {
  let x = u32(a0);
  x = u32(x ^ (x >>> 16));
  x = imul(x, 0x7feb352d);
  x = u32(x ^ (x >>> 15));
  x = imul(x, 0x846ca68b);
  x = u32(x ^ (x >>> 16));
  return x;
}

function hash2v(ix, iy, seed) {
  const h = uhash(u32(imul(u32(ix), 0x27d4eb2d) ^ imul(u32(iy), 0x165667b1) ^ imul(u32(seed), 0x9e3779b9)));
  return [(h & 0xffff) / 32767.5 - 1, (h >>> 16) / 32767.5 - 1];
}

function grad2(ix, iy, seed) {
  const [a, b] = hash2v(ix, iy, seed);
  const l = Math.hypot(a + 1e-6, b + 1e-6) || 1;
  return [(a + 1e-6) / l, (b + 1e-6) / l];
}

export function noised2(x, y, seed) {
  const px = Math.floor(x);
  const py = Math.floor(y);
  const wx = x - px;
  const wy = y - py;
  const ux = wx * wx * wx * (wx * (wx * 6 - 15) + 10);
  const uy = wy * wy * wy * (wy * (wy * 6 - 15) + 10);

  const ga = grad2(px, py, seed);
  const gb = grad2(px + 1, py, seed);
  const gc = grad2(px, py + 1, seed);
  const gd = grad2(px + 1, py + 1, seed);

  const va = ga[0] * wx + ga[1] * wy;
  const vb = gb[0] * (wx - 1) + gb[1] * wy;
  const vc = gc[0] * wx + gc[1] * (wy - 1);
  const vd = gd[0] * (wx - 1) + gd[1] * (wy - 1);

  const k0 = va;
  const k1 = vb - va;
  const k2 = vc - va;
  const k4 = va - vb - vc + vd;

  return [k0 + k1 * ux + k2 * uy + k4 * ux * uy, 0, 0];
}

const SEED_STRIDE = 8191;

export function fbmd2(x, y, octaves, lacunarity, gain, seed) {
  let qx = x;
  let qy = y;
  let f = 1;
  let a = 0.5;
  let sum = 0;
  let amp = 0;
  for (let i = 0; i < octaves; i++) {
    sum += a * noised2(qx * f, qy * f, (seed + i * SEED_STRIDE) >>> 0)[0];
    amp += a;
    f *= lacunarity;
    a *= gain;
    const nx = qx * 0.8 - qy * 0.6 + 17.31;
    const ny = qx * 0.6 + qy * 0.8 + 9.07;
    qx = nx;
    qy = ny;
  }
  return sum / Math.max(amp, 1e-5);
}

export function ridged2(x, y, octaves, lacunarity, gain, sharpness, seed) {
  let qx = x;
  let qy = y;
  let f = 1;
  let a = 0.5;
  let sum = 0;
  let amp = 0;
  let weight = 1;
  for (let i = 0; i < octaves; i++) {
    const n = noised2(qx * f, qy * f, (seed + i * SEED_STRIDE) >>> 0)[0];
    const folded = Math.max(1 - Math.abs(n), 1e-5);
    const powed = Math.pow(folded, sharpness);
    const w = Math.min(1, Math.max(0, weight));
    sum += a * powed * powed * w;
    amp += a;
    weight = Math.min(1, Math.max(0, powed * 2));
    f *= lacunarity;
    a *= gain;
    const nx = qx * 0.8 - qy * 0.6 + 17.31;
    const ny = qx * 0.6 + qy * 0.8 + 9.07;
    qx = nx;
    qy = ny;
  }
  return sum / Math.max(amp, 1e-5);
}

export function billow2(x, y, octaves, lacunarity, gain, seed) {
  let qx = x;
  let qy = y;
  let f = 1;
  let a = 0.5;
  let sum = 0;
  let amp = 0;
  for (let i = 0; i < octaves; i++) {
    const n = noised2(qx * f, qy * f, (seed + i * SEED_STRIDE) >>> 0)[0];
    sum += a * (Math.abs(n) * 2 - 1);
    amp += a;
    f *= lacunarity;
    a *= gain;
    const nx = qx * 0.8 - qy * 0.6 + 17.31;
    const ny = qx * 0.6 + qy * 0.8 + 9.07;
    qx = nx;
    qy = ny;
  }
  return sum / Math.max(amp, 1e-5);
}

export function worley2(x, y, seed) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  let best = 1e9;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const [a, b] = hash2v(ix + i, iy + j, seed);
      const cx = i + 0.5 + 0.5 * a;
      const cy = j + 0.5 + 0.5 * b;
      const d = (cx - fx) ** 2 + (cy - fy) ** 2;
      if (d < best) best = d;
    }
  }
  return Math.sqrt(best);
}

function warp2(x, y, strength, freq, octaves, seed) {
  const qx = fbmd2(x * freq, y * freq + 5.2, octaves, 2, 0.5, (seed + 101) >>> 0);
  const qy = fbmd2(x * freq + 5.2, y * freq, octaves, 2, 0.5, (seed + 337) >>> 0);
  const rx = fbmd2(x * freq + qx * strength + 1.7, y * freq + qx * strength + 9.2, octaves, 2, 0.5, (seed + 337) >>> 0);
  const ry = fbmd2(x * freq + qy * strength + 1.7, y * freq + qy * strength + 9.2, octaves, 2, 0.5, (seed + 401) >>> 0);
  return [x + rx * strength, y + ry * strength];
}

// Produces a greyscale height thumbnail for a fractal layer's current settings.
export function fractalThumbnail(opts, w = 132, h = 76) {
  const {
    type = 0, seed = 1, octaves = 8, frequency = 2.5, lacunarity = 2.0, gain = 0.5,
    warp = 0, warpFreq = 0.8, sharpness = 2, amplitude = 0.55, offset = 0.45, invert = false,
  } = opts;
  const out = new Float32Array(w * h);
  const oct = Math.min(octaves, 10);
  let lo = Infinity;
  let hi = -Infinity;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = (x + 0.5) / w;
      const v = (y + 0.5) / h;
      let px = u * frequency + seed * 0.0137;
      let py = v * frequency + seed * 0.0071;
      if (warp > 1e-5) {
        [px, py] = warp2(px, py, warp, Math.max(warpFreq, 0.001), 4, seed);
      }
      let v0 = 0;
      if (type === 1) v0 = ridged2(px, py, oct, lacunarity, gain, Math.max(sharpness, 0.05), seed) * 2 - 1;
      else if (type === 2) v0 = billow2(px, py, oct, lacunarity, gain, seed);
      else if (type === 3) v0 = Math.min(1, Math.max(-1, worley2(px, py, seed) * 2.6 - 1));
      else v0 = fbmd2(px, py, oct, lacunarity, gain, seed);
      if (invert) v0 = -v0;
      const val = v0 * amplitude + offset;
      out[y * w + x] = val;
      if (val < lo) lo = val;
      if (val > hi) hi = val;
    }
  }
  const span = Math.max(hi - lo, 1e-4);
  const img = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const t = (out[i] - lo) / span;
    const c = 22 + t * 208;
    img[i * 4] = c * 1.0;
    img[i * 4 + 1] = c * 0.97;
    img[i * 4 + 2] = c * 0.92;
    img[i * 4 + 3] = 255;
  }
  return { data: img, width: w, height: h, min: lo, max: hi };
}
