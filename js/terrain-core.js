/* ============================================================================
 * Frontier — SDF Terrain Core
 * ----------------------------------------------------------------------------
 * Pure JS terrain mathematics (no DOM / no three.js), shared by the browser
 * Web Worker and the Node test harness.
 *
 * Pipeline:
 *   1. generateMountain()  — multi-fractal (ridged + fBm) mountain built from
 *                            Perlin *gradient noise* with domain warping and a
 *                            radial peak falloff. The result is an implicit
 *                            height surface: the zero set of the SDF
 *                                d(x, y, z) = z − h(x, y)
 *                            i.e. a 2.5-D signed distance field where every
 *                            vertical ray crosses the surface at z = h(x, y).
 *
 *   2. runHydraulic()      — particle-based HYDRAULIC erosion on the SDF.
 *                            No mesh is used anywhere: particles live on the
 *                            implicit surface, always move along −∇h (the
 *                            steepest descent of the SDF), erode/deposit by
 *                            bilinear "splat" carves into the field, and every
 *                            carve is clamped to a fraction of the voxel size.
 *                            Voxel resolution and cut depth are coupled:
 *                                max cut per step  = cutVoxels  * cell
 *                                max deposit      = depVoxels  * cell
 *                                particle step    = stepVoxels * cell
 *                            so a finer grid erodes in finer increments.
 *
 *   3. computeSplatMaps()  — derives five splat-map material channels exactly
 *                            as the user specified:  FLOW · SEDIMENT · PEAK ·
 *                            PINES · HEIGHT — normalizes them, and bakes a
 *                            detailed per-pixel albedo texture (rock, silt,
 *                            wet mud, pine canopy, grass) with curvature AO,
 *                            micro-noise detail and slope-based rock exposure.
 * ==========================================================================*/
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (typeof self !== 'undefined') self.TerrainCore = api;
})(this, function () {
  'use strict';

  /* ----------------------------- RNG ----------------------------------- */

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ----------------------- Perlin gradient noise ------------------------ */

  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + (b - a) * t;

  function smoothstep(e0, e1, x) {
    const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  function makePerm(seed) {
    const base = new Uint8Array(256);
    for (let i = 0; i < 256; i++) base[i] = i;
    const rand = mulberry32((seed ^ 0x1234ABCD) >>> 0);
    for (let i = 255; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      const t = base[i]; base[i] = base[j]; base[j] = t;
    }
    const p = new Uint8Array(512);
    for (let i = 0; i < 512; i++) p[i] = base[i & 255];
    return p;
  }

  function grad2(hash, x, y) {
    switch (hash & 7) {
      case 0: return x + y;
      case 1: return x - y;
      case 2: return -x + y;
      case 3: return -x - y;
      case 4: return x;
      case 5: return -x;
      case 6: return y;
      default: return -y;
    }
  }

  /** Perlin-style 2D gradient noise, output ~[-1, 1]. */
  function gnoise(perm, x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = fade(xf), v = fade(yf);
    const x0 = xi & 255, x1 = (xi + 1) & 255, y0 = yi & 255, y1 = (yi + 1) & 255;
    const aa = perm[perm[x0] + y0], ab = perm[perm[x0] + y1];
    const ba = perm[perm[x1] + y0], bb = perm[perm[x1] + y1];
    const x1_ = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
    const x2_ = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
    return (lerp(x1_, x2_, v) * 0.74); // scale: 1/sqrt(1.85) ≈ normalised
  }

  /** Fractal Brownian motion of gradient noise, normalised to ~[-1, 1]. */
  function fbm(perm, x, y, oct, pers, lac) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      sum += gnoise(perm, x * freq, y * freq) * amp;
      norm += amp;
      amp *= pers;
      freq *= lac;
    }
    return sum / norm;
  }

  /** Ridged multi-fractal (sharp crests), normalised to [0, 1]. */
  function ridged(perm, x, y, oct, pers, lac, exp) {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < oct; o++) {
      const n = gnoise(perm, x * freq, y * freq);
      let r = 1 - Math.abs(n);
      r = Math.pow(r, exp);
      sum += r * amp;
      norm += amp;
      amp *= pers;
      freq *= lac;
    }
    return sum / norm;
  }

  /* --------------------------- 1 · MOUNTAIN ----------------------------- */

  /**
   * Build the mountain as an implicit surface (the SDF zero-set).
   * Multi-fractal composition:
   *   relief = (1−ridgedMix) · smooth fBm  +  ridgedMix · ridged multi-fractal
   * with low-frequency domain warping (swirling valleys) and a radial peak
   * falloff shaped by `sharpness`, which concentrates the highest relief in
   * one dominant peak.
   *
   * @returns {{h: Float32Array, n: number, stats: object}}
   */
  function generateMountain(params) {
    const n = params.n | 0;
    const H = params.heightM;
    const perm = makePerm(params.seed | 0);
    const h = new Float32Array(n * n);

    const size = params.baseFreq;                 // noise cells across domain
    const rand = mulberry32((params.seed ^ 0x9E3779B9) >>> 0);
    const cx = 0.5 + (rand() - 0.5) * 0.26;       // peak centre jitter
    const cy = 0.5 + (rand() - 0.5) * 0.26;
    const warp = params.warp;
    const oct = params.octaves | 0;
    const pers = params.persistence;
    const rMix = params.ridgedMix;
    const rExp = params.ridgeExp;
    const sharp = params.sharpness;

    let min = Infinity, max = -Infinity, acc = 0;

    for (let j = 0; j < n; j++) {
      const v = j / (n - 1);
      const pyBase = v * size;
      const dy = (v - cy) * 2;
      for (let i = 0; i < n; i++) {
        const u = i / (n - 1);
        const pxBase = u * size;

        // -- low-frequency domain warp (swirls the crests & valleys) ------
        const w1 = fbm(perm, u * size * 0.55 + 13.7, v * size * 0.55 + 91.2, 3, 0.5, 2.0);
        const w2 = fbm(perm, u * size * 0.55 + 53.1, v * size * 0.55 + 23.4, 3, 0.5, 2.0);
        const px = pxBase + warp * w1;
        const py = pyBase + warp * w2;

        // -- multi-fractal relief ----------------------------------------
        const base = fbm(perm, px, py, oct, pers, 2.0);            // [-1,1]
        const ridge = ridged(perm, px * 1.35 + 7.7, py * 1.35 + 3.1,
          oct + 1, pers, 2.0, rExp);                                // [0,1]
        const relief = (1 - rMix) * (0.5 + 0.5 * base) + rMix * ridge; // [0,1]

        // -- radial peak falloff: one dominant peak, clean flat edges ----
        const dx = (u - cx) * 2;
        const r = Math.sqrt(dx * dx + dy * dy);
        // anisotropic falloff radius → a few dominant valley directions
        // instead of a perfectly radial star
        const radN = 0.5 + 0.5 * fbm(perm, u * 3.1 + 19.3, v * 3.1 + 42.7, 3, 0.5, 2.0);
        const rMod = r * (0.80 + 0.40 * radN);
        const fall = 1 - smoothstep(0.16, 1.04, rMod);
        const peak = Math.pow(fall, sharp);

        // -- secondary ridges carved radially (notch field) --------------
        const notch = 0.5 + 0.5 * fbm(perm, u * size * 2.4 + 5.2, v * size * 2.4 + 8.8, 3, 0.5, 2.0);

        let hh = H * peak * (0.22 + 0.78 * relief) * (0.82 + 0.36 * notch);
        if (hh < 0) hh = 0;
        const idx = j * n + i;
        h[idx] = hh;
        if (hh < min) min = hh;
        if (hh > max) max = hh;
        acc += hh;
      }
    }

    return {
      h, n,
      stats: { min, max, mean: acc / (n * n) }
    };
  }

  /* ---------------------- 2 · HYDRAULIC EROSION ------------------------- */

  /**
   * In-place bilinear sample of the surface (SDF zero-set height).
   */
  function makeSampler(h, n) {
    return function (x, y) {
      let ix = x | 0;
      if (ix < 0) ix = 0; else if (ix > n - 2) ix = n - 2;
      let iy = y | 0;
      if (iy < 0) iy = 0; else if (iy > n - 2) iy = n - 2;
      const fx = x - ix, fy = y - iy;
      const o = iy * n + ix;
      const a = h[o], b = h[o + 1], c = h[o + n], d = h[o + n + 1];
      return lerp(lerp(a, b, fx), lerp(c, d, fx), fy);
    };
  }

  /**
   * Bilinear "splat" write — carves/deposits a height delta distributed over
   * the four neighbouring voxels. This is the SDF equivalent of digging:
   * it shifts the implicit surface by delta along the vertical axis, so the
   * actual carve depth through the surface is delta / cos(slope).
   */
  function makeSplat(h, n) {
    return function (x, y, delta) {
      let ix = Math.floor(x);
      if (ix < 0) ix = 0; else if (ix > n - 2) ix = n - 2;
      let iy = Math.floor(y);
      if (iy < 0) iy = 0; else if (iy > n - 2) iy = n - 2;
      const fx = x - ix, fy = y - iy;
      const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy, w11 = fx * fy;
      const o = iy * n + ix;
      h[o] += delta * w00;
      h[o + 1] += delta * w10;
      h[o + n] += delta * w01;
      h[o + n + 1] += delta * w11;
    };
  }

  /**
   * Hydraulic (hydraulic-like) erosion on the SDF surface, particle based.
   *
   * Model per particle step:
   *   · velocity direction = −∇h (steepest descent of the SDF)
   *   · step distance      = stepVoxels × cell          (resolution-coupled)
   *   · capacity C         = K · water · (0.12 + 2.4·min(slope,1.2))
   *   · if load < C → erode e = min(C−load, available, cutVoxels·cell)
   *   · if load ≥ C → deposit d = min(load−C, depVoxels·cell)
   *   · slope > slideLimit → unstable talus: deposit, do not erode
   *   · moving uphill or leaving the domain → deposit remainder, kill
   *   · flow accumulation is splatted onto a wetness map (channels)
   *
   * @param {Float32Array} h      heights, in metres (modified in place)
   * @param {number}       n      grid size (n×n)
   * @param {object}       p      parameters
   * @param {function}     [onProgress]  ({iteration, iterations, eroded, deposited, alive})
   */
  function runHydraulic(h, n, p, onProgress) {
    const cell = p.sizeM / (n - 1);
    const cut = p.cutVoxels * cell;        // ← matched to voxel resolution
    const depCap = p.depVoxels * cell;     // ← matched to voxel resolution
    const stepCells = p.stepVoxels;        // particle travel per step, in cells
    const P = p.particles | 0;

    const px = new Float32Array(P);
    const py = new Float32Array(P);
    const pw = new Float32Array(P);
    const pl = new Float32Array(P);
    const alive = new Uint8Array(P);
    const rand = mulberry32((p.seed ^ 0x51AB) >>> 0);

    const flow = new Float32Array(n * n);  // wetness / flow accumulation
    const dep = new Float32Array(n * n);   // net deposited sediment

    const sample = makeSampler(h, n);
    const splat = makeSplat(h, n);

    function spawn(k) {
      px[k] = 0.5 + rand() * (n - 1.0);
      py[k] = 0.5 + rand() * (n - 1.0);
      pw[k] = p.rain * (0.6 + 0.8 * rand());
      pl[k] = 0;
      alive[k] = 1;
    }
    for (let k = 0; k < P; k++) spawn(k);

    let eroded = 0, deposited = 0;

    const iters = p.iterations | 0;
    for (let it = 0; it < iters; it++) {
      // rainfall: re-wet a fraction of dead particles each iteration
      let budget = (P * p.respawnFrac) | 0;
      if (budget > 0) {
        for (let k = 0; k < P && budget > 0; k++) {
          if (!alive[k]) { spawn(k); budget--; }
        }
      }

      let aliveCount = 0;
      for (let k = 0; k < P; k++) {
        if (!alive[k]) continue;
        aliveCount++;

        for (let s = 0; s < p.stepsPerIter; s++) {
          const x = px[k], y = py[k];
          const w0 = pw[k];
          const h0 = sample(x, y);

          // -- steepest descent of the SDF (central differences) ---------
          const gx = sample(x + 0.5, y) - sample(x - 0.5, y);
          const gy = sample(x, y + 0.5) - sample(x, y - 0.5);
          const s2 = gx * gx + gy * gy;

          // -- flow accumulation splat (wetness map) ---------------------
          const ci = x | 0, cj = y | 0;
          if (ci >= 0 && ci < n && cj >= 0 && cj < n) {
            flow[cj * n + ci] += w0 * 0.05;
          }

          if (s2 < 1e-10) {
            // flat ground: drop sediment if over capacity, drain water
            if (pl[k] > 0) {
              const d = Math.min(pl[k], depCap);
              splat(x, y, d);
              dep[cj * n + ci] += d;
              pl[k] -= d;
              deposited += d;
            }
            pw[k] *= p.evap;
            if (pw[k] < 0.05) {
              if (pl[k] > 1e-6) { splat(x, y, Math.min(pl[k], depCap)); deposited += pl[k]; }
              alive[k] = 0;
            }
            break;
          }

          const slope = Math.sqrt(s2);
          const inv = 1 / slope;
          const cap = p.capacityK * w0 * (0.12 + 2.4 * Math.min(slope, 1.2));

          if (slope < p.slideLimit) {
            if (pl[k] < cap) {
              // -- erode: carve bounded by voxel-matched cut depth -------
              const avail = h0; // never carve below the datum plane (z = 0)
              const e = Math.min(cap - pl[k], avail, cut);
              if (e > 0) {
                splat(x, y, -e);
                pl[k] += e;
                eroded += e;
              }
            } else {
              // -- deposit ------------------------------------------------
              const d = Math.min(pl[k] - cap, depCap);
              if (d > 0) {
                splat(x, y, d);
                dep[cj * n + ci] += d;
                pl[k] -= d;
                deposited += d;
              }
            }
          } else {
            // -- unstable slope: talus behaviour (deposit, no erode) -----
            const d = Math.min(pl[k] * 0.6, depCap * 2);
            if (d > 0) {
              splat(x, y, d);
              dep[cj * n + ci] += d;
              pl[k] -= d;
              deposited += d;
            }
          }

          // -- advance along −∇h with slight meander (organic gullies) ---
          const jf = (rand() - 0.5) * 0.55;
          let ndx = -gx * inv - (-gy * inv) * jf;
          let ndy = -gy * inv + (-gx * inv) * jf;
          const nl = Math.sqrt(ndx * ndx + ndy * ndy) || 1;
          const mx = x + (ndx / nl) * stepCells;
          const my = y + (ndy / nl) * stepCells;

          if (mx < 0.25 || my < 0.25 || mx > n - 1.25 || my > n - 1.25) {
            // left the domain: drain out (last sediment dumped on the lip)
            const ex = Math.min(n - 1.5, Math.max(0.5, mx));
            const ey = Math.min(n - 1.5, Math.max(0.5, my));
            if (pl[k] > 1e-6) {
              const d = Math.min(pl[k], depCap);
              splat(ex, ey, d);
              deposited += d;
            }
            alive[k] = 0;
            break;
          }

          const hn = sample(mx, my);
          if (hn > h0) {
            // hit an uphill barrier: drop the load and stop
            if (pl[k] > 1e-6) {
              const d = Math.min(pl[k], depCap * 2);
              splat(x, y, d);
              deposited += d;
            }
            alive[k] = 0;
            break;
          }

          px[k] = mx;
          py[k] = my;
          pw[k] *= p.evap;
          if (pw[k] < 0.05) {
            if (pl[k] > 1e-6) { splat(mx, my, Math.min(pl[k], depCap)); deposited += pl[k]; }
            alive[k] = 0;
            break;
          }
        }
      }

      if (onProgress && (it % 2 === 0 || it === iters - 1)) {
        onProgress({
          iteration: it + 1, iterations: iters,
          eroded, deposited, alive: aliveCount
        });
      }
    }

    // smooth the wetness map so channels read as continuous flow
    boxBlur(flow, n, 1, 2);
    boxBlur(dep, n, 1, 1);

    return {
      flow, dep,
      stats: {
        erodedVol: eroded * cell * cell,      // m³
        depositedVol: deposited * cell * cell // m³
      }
    };
  }

  /** In-place separable box blur (radius 1, `passes` iterations). */
  function boxBlur(src, n, radius, passes) {
    const tmp = new Float32Array(n * n);
    for (let p = 0; p < passes; p++) {
      // horizontal
      for (let j = 0; j < n; j++) {
        const row = j * n;
        let acc = src[row + Math.min(n - 1, radius)] + src[row] + (src[row] * 2);
        for (let i = 0; i < n; i++) {
          tmp[row + i] = acc / 4;
          const add = src[row + Math.min(n - 1, i + radius)];
          acc += add - src[row + Math.max(0, i - radius)];
        }
      }
      // vertical
      for (let i = 0; i < n; i++) {
        let acc = tmp[i + radius * n] + tmp[i] + (tmp[i] * 2);
        for (let j = 0; j < n; j++) {
          src[j * n + i] = acc / 4;
          const add = tmp[Math.min(n - 1, j + radius) * n + i];
          acc += add - tmp[Math.max(0, j - radius) * n + i];
        }
      }
    }
  }

  /**
   * Optional mass-wasting pass: slope-limited diffusion that rounds sharp
   * numerical crests (talus smoothing). Bounded per pass to keep the surface
   * stable (max change = maxDh).
   */
  function massWaste(h, n, passes, maxDh) {
    let a = h.slice();
    let b = new Float32Array(n * n);
    const inner = n - 2;
    for (let p = 0; p < passes; p++) {
      for (let j = 1; j < inner + 1; j++) {
        const row = j * n;
        for (let i = 1; i < inner + 1; i++) {
          const c = a[row + i];
          const avg = (a[row + i - 1] + a[row + i + 1] + a[row - n + i] + a[row + n + i]) * 0.25;
          let d = (avg - c) * 0.35;
          if (d > maxDh) d = maxDh; else if (d < -maxDh) d = -maxDh;
          b[row + i] = c + d;
        }
      }
      for (let i = 0; i < n; i++) {
        b[i] = a[i];
        b[(n - 1) * n + i] = a[(n - 1) * n + i];
        b[i * n] = a[i * n];
        b[i * n + n - 1] = a[i * n + n - 1];
      }
      const t = a; a = b; b = t;
    }
    h.set(a);
  }

  /* ------------------------ 3 · SPLAT MAPS ------------------------------ */

  function percentile95(arr) {
    let max = 0;
    for (let i = 0; i < arr.length; i++) if (arr[i] > max) max = arr[i];
    if (max <= 1e-9) return 1;
    const bins = new Float64Array(100);
    const scale = 100 / max;
    for (let i = 0; i < arr.length; i++) {
      let b = (arr[i] * scale) | 0;
      if (b > 99) b = 99;
      bins[b]++;
    }
    const target = arr.length * 0.95;
    let acc = 0;
    for (let b = 0; b < 100; b++) {
      acc += bins[b];
      if (acc >= target) return ((b + 0.5) * max) / 100;
    }
    return max;
  }

  // fast integer-hash value noise (for material micro-detail)
  function h2(x, y, seed) {
    let h = (x * 374761393 + y * 668265263 + seed * 1442695187) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function vnoise(x, y, seed) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const fx = x - xi, fy = y - yi;
    const u = fade(fx), v = fade(fy);
    const a = h2(xi, yi, seed), b = h2(xi + 1, yi, seed);
    const c = h2(xi, yi + 1, seed), d = h2(xi + 1, yi + 1, seed);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }

  /**
   * Compute the five splat-map channels  FLOW · SEDIMENT · PEAK · PINES ·
   * HEIGHT, normalise them into material weights, and bake:
   *   · albedo  — n×n RGB per-pixel textured albedo (Uint8Array)
   *   · vis     — n×n RGBA debug/splat-view texture (R flow, G sediment,
   *               B peak, A pines)
   *
   * @returns {{weights: Float32Array, albedo: Uint8Array, vis: Uint8Array,
   *            stats: object}}
   */
  function computeSplatMaps(h, flow, dep, n, p, sizeM) {
    const cell = sizeM / (n - 1);
    const Hmax = p.Hmax > 0 ? p.Hmax : 1;
    const flowRef = percentile95(flow);
    const depRef = percentile95(dep);

    const weights = new Float32Array(n * n * 5);
    const albedo = new Uint8Array(n * n * 3);
    const vis = new Uint8Array(n * n * 4);
    const seedD = (p.seed | 0) & 0xffff;

    const I = p.intensities;

    for (let j = 0; j < n; j++) {
      const row = j * n;
      const v = j / (n - 1);
      for (let i = 0; i < n; i++) {
        const idx = row + i;
        const hh = h[idx];
        const hN = Math.min(1, hh / Hmax);

        const f = Math.min(1.25, Math.log1p(flow[idx]) / Math.log1p(flowRef));
        const s = Math.min(1.25, dep[idx] / depRef);

        // slope in m/m
        const hl = h[idx - (i > 0 ? 1 : 0)];
        const hr = h[idx + (i < n - 1 ? 1 : 0)];
        const hd = h[idx - (j > 0 ? n : 0)];
        const hu = h[idx + (j < n - 1 ? n : 0)];
        const sMM = 0.5 * Math.sqrt((hr - hl) * (hr - hl) + (hu - hd) * (hu - hd)) / cell;

        // ---- the five channels ----------------------------------------
        const peak = smoothstep(0.40, 0.70, hN);
        const slopeFlat = 1 - smoothstep(0.50, 0.95, sMM);
        const pines = (1 - peak)
          * smoothstep(0.08, 0.30, hN)
          * (1 - smoothstep(0.55, 0.72, hN))
          * slopeFlat
          * (1 - 0.85 * Math.min(f, 1))
          * (1 - 0.75 * Math.min(s, 1));
        const base = (1 - peak) * (1 - 0.6 * pines) * (1 - 0.4 * Math.min(s, 1));
        const flowC = Math.pow(f, 1.1);

        let a0 = I.flow * flowC;   // wet mud / channel
        let a1 = I.sediment * s;   // silt / sand fan
        let a2 = I.peak * peak;    // bare rock
        let a3 = I.pines * pines;  // pine forest
        let a4 = I.base * base;    // grassland / height
        const sum = a0 + a1 + a2 + a3 + a4 + 1e-6;
        a0 /= sum; a1 /= sum; a2 /= sum; a3 /= sum; a4 /= sum;

        const wIdx = idx * 5;
        weights[wIdx] = a0; weights[wIdx + 1] = a1; weights[wIdx + 2] = a2;
        weights[wIdx + 3] = a3; weights[wIdx + 4] = a4;

        vis[idx * 4] = Math.min(255, (f / 1.25) * 255) | 0;
        vis[idx * 4 + 1] = Math.min(255, (s / 1.25) * 255) | 0;
        vis[idx * 4 + 2] = (peak * 255) | 0;
        vis[idx * 4 + 3] = (pines * 255) | 0;

        // ---- bake detailed albedo --------------------------------------
        const u = i / (n - 1);
        // two octaves of value noise kill the single-scale grid look
        const n1 = vnoise(u * 64, v * 64, seedD) * 0.62 +
          vnoise(u * 128 + 5.3, v * 128 + 9.1, seedD + 31) * 0.38;
        const n2 = vnoise(u * 140 + 9.7, v * 140 + 3.1, seedD + 7) * 0.6 +
          vnoise(u * 280 + 3.3, v * 280 + 7.9, seedD + 43) * 0.4;

        // curvature AO (concave = darker)
        const lap = (hl + hr + hd + hu - 4 * hh) / Hmax;
        let ao = 1 + lap * 8;
        if (ao < 0.62) ao = 0.62; else if (ao > 1.22) ao = 1.22;

        // rock (granite, speckle + strata)
        const strata = Math.sin(hh * 2.8 + n2 * 3.0) * 7;
        let rR = (139 * (0.82 + 0.36 * n1) + strata) * ao;
        let rG = (133 * (0.82 + 0.36 * n1) + strata) * ao;
        let rB = (120 * (0.82 + 0.36 * n1) + strata * 0.8) * ao;

        // silt / sediment
        let sR = 196 * (0.88 + 0.24 * n2) * ao;
        let sG = 172 * (0.88 + 0.24 * n2) * ao;
        let sB = 126 * (0.88 + 0.24 * n2) * ao;

        // wet mud (darkened by flow)
        const wet = 1 - 0.30 * Math.min(f, 1);
        let mR = 92 * wet * ao, mG = 82 * wet * ao, mB = 68 * wet * ao;

        // pine canopy (mottled, bright needles)
        let pR = 52 + n1 * 22, pG = 84 + n1 * 26, pB = 47 + n1 * 14;
        if (n2 > 0.72) { pR = 94; pG = 124; pB = 74; }
        pR *= ao; pG *= ao; pB *= ao;

        // grass
        let gR = lerp(95, 122, n1) * ao;
        let gG = lerp(122, 142, n1) * ao;
        let gB = lerp(69, 79, n1) * ao;

        let R = a0 * mR + a1 * sR + a2 * rR + a3 * pR + a4 * gR;
        let G = a0 * mG + a1 * sG + a2 * rG + a3 * pG + a4 * gG;
        let B = a0 * mB + a1 * sB + a2 * rB + a3 * pB + a4 * gB;

        // steep slopes expose bedrock
        const rockBoost = smoothstep(0.75, 1.40, sMM) * (1 - a3) * 0.55;
        R = lerp(R, rR, rockBoost);
        G = lerp(G, rG, rockBoost);
        B = lerp(B, rB, rockBoost);

        albedo[idx * 3] = Math.max(0, Math.min(255, R | 0));
        albedo[idx * 3 + 1] = Math.max(0, Math.min(255, G | 0));
        albedo[idx * 3 + 2] = Math.max(0, Math.min(255, B | 0));
      }
    }

    return { weights, albedo, vis, stats: { flowRef, depRef } };
  }

  return {
    mulberry32, makePerm, gnoise, fbm, ridged, smoothstep,
    generateMountain, runHydraulic, massWaste, boxBlur,
    computeSplatMaps, percentile95
  };
});
