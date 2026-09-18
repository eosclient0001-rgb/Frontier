/* Field-pass erosion — the large-scale landscape shaper, hybrid CPU/GPU.
 *
 * Pipeline:
 *   1. GPU extracts the SDF surface as a 128×128 height/mask grid.
 *   2. CPU runs the geomorphology: priority-flood depression routing, D8
 *      flow accumulation with a meander bias, stream-power incision,
 *      capacity-limited sediment routing, FLOW-GATED hillslope diffusion,
 *      and thermal talus relaxation.
 *   3. The net height delta is uploaded and applied back into the 3D SDF
 *      near the surface, with an optional detail-sharpen re-injection.
 *   4. Eikonal repair re-normalizes the volume.
 *
 * ── Why this does NOT blur (the failure mode of pure field solvers) ─────
 *  · Diffusion only runs where drainage area is small (hillslopes); channel
 *    cells are never smoothed, so the network keeps knife edges.
 *  · Incision uses a sharp slope exponent (n up to 2), so channels deepen
 *    as crisp threads instead of broad bowls.
 *  · The detail pass re-adds ridge micro-relief proportional to slope and
 *    rock hardness — the high frequencies that diffusion would erase.
 *  · The final image ray-marches the SDF itself (no mesh smoothing).
 */
import { glslHeader, fullscreenVertex, ATLAS_W, ATLAS_H, DIM, LO, CELL } from "./volume.js";
import { program, makeTarget, makeTexture, drawFullscreen, bindTarget, uploadTexture } from "./gl.js";

const N = DIM[0]; // 128 (columns per side; DIM.x === DIM.z here)

/* ── surface extraction: topmost solid per column, sub-voxel accurate ─── */
const extractFragment =
  glslHeader +
  `
uniform sampler2D terrain;
uniform sampler2D soil;
out vec4 outField; // h (world y), hardness, sediment, slopeMag
void main() {
  ivec2 col = ivec2(gl_FragCoord.xy); // x, z voxel indices
  float h = LO.y;
  float hard = .4, sed = 0.;
  for (int y = DIM.y - 1; y >= 0; y--) {
    vec4 v = voxel(terrain, ivec3(col.x, y, col.y));
    if (v.a > .5) {
      // interface between this solid voxel and the one above
      float dBelow = v.r;
      float dAbove = y + 1 < DIM.y ? voxel(terrain, ivec3(col.x, y + 1, col.y)).r : BAND;
      float t = .5;
      if (dAbove - dBelow > 1e-6) t = clamp(-dBelow / (dAbove - dBelow), 0., 1.);
      h = LO.y + (float(y) + t) * CELL.y;
      hard = v.g;
      sed = voxel(soil, ivec3(col.x, y, col.y)).a;
      break;
    }
  }
  // cheap slope estimate from the 4-neighbour heights of the previous scan?
  // we compute slope after extraction on the CPU instead; store placeholder.
  outField = vec4(h, hard, sed, 0.);
}`;

/* ── apply the CPU-computed height delta back into the volume ─────────── */
const applyDeltaFragment =
  glslHeader +
  `
uniform sampler2D terrain;
uniform sampler2D delta;   // r = dh (m, +deposit/-incision), g = slope, b = hard, a = detailGate
uniform vec4 knobs;        // detailAmp, detailFreq, spare, spare
out vec4 outTerrain;

float ridged(vec2 p) {
  float a = .5, s = 0., n = 0.;
  for (int i = 0; i < 4; i++) {
    float v = 1. - abs(2. * vnoise(vec3(p, 7.31)) - 1.);
    s += a * v * v; n += a; a *= .55; p = p * 2.13 + 3.7;
  }
  return s / n;
}

void main() {
  ivec2 uv = ivec2(gl_FragCoord.xy);
  ivec3 q = voxelAt(uv);
  vec4 v = texelFetch(terrain, uv, 0);
  vec4 dl = texelFetch(delta, ivec2(q.x, q.z), 0);
  vec3 p = worldAt(q);

  // detail sharpen: crisp ridge micro-relief on steep, hard, freshly worked
  // rock — re-injects the frequencies the field passes round off.
  float detail = 0.;
  if (knobs.x > 0. && dl.a > .01) {
    float r = ridged(p.xz * knobs.y + vec2(p.y * .35));
    detail = knobs.x * (r - .5) * .42 * dl.g * dl.b * dl.a;
  }

  float dh = dl.r + detail;
  if (abs(dh) < 1e-6) { outTerrain = v; return; }

  // shift the near-surface band by dh; weight fades with distance above the
  // surface so air voxels far away are untouched.
  float w = 1. - smoothstep(0., CELL.y * 5., max(v.r, 0.));
  float d = clamp(v.r - dh * w, -BAND, BAND);
  outTerrain = vec4(d, v.g, v.b, solidOf(d));
}`;

/* ───────────────────────── CPU geomorphology ─────────────────────────── */

const NEI = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [-1, -1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2],
];

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Priority-flood fill (bucket Dijkstra) from the grid rim — returns pour
 * levels so enclosed basins drain over their lowest spill. */
function priorityFlood(h, n) {
  const size = n * n;
  const fill = new Float64Array(size).fill(Infinity);
  let hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < size; i++) { const v = h[i]; if (v < hMin) hMin = v; if (v > hMax) hMax = v; }
  const B = 2048, span = Math.max(hMax - hMin, 1e-9);
  const bucketOf = (v) => { const b = (((v - hMin) / span) * B) | 0; return b < 0 ? 0 : b >= B ? B - 1 : b; };
  const q = new Array(B);
  for (let b = 0; b < B; b++) q[b] = [];
  const done = new Uint8Array(size);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    if (i === 0 || j === 0 || i === n - 1 || j === n - 1) {
      const idx = j * n + i;
      fill[idx] = h[idx];
      q[bucketOf(h[idx])].push(idx);
    }
  }
  let qmin = 0;
  for (;;) {
    while (qmin < B && q[qmin].length === 0) qmin++;
    if (qmin >= B) break;
    const idx = q[qmin].pop();
    if (done[idx]) continue;
    done[idx] = 1;
    const fv = fill[idx];
    const cx = idx % n, cy = (idx / n) | 0;
    for (let k = 0; k < 4; k++) {
      const nx = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
      const ny = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const ni = ny * n + nx;
      if (done[ni]) continue;
      const nf = h[ni] > fv ? h[ni] : fv;
      if (nf < fill[ni] - 1e-12) {
        fill[ni] = nf;
        q[bucketOf(nf)].push(ni);
      }
    }
  }
  return fill;
}

/** D8 flow directions + accumulation on the filled surface, with a coherent
 * low-frequency meander bias so channels wander instead of running straight. */
function flowField(h, fill, n, rng, meanderAmp = 0.45) {
  const size = n * n;
  const flow = new Float64Array(size).fill(1);
  const down = new Int32Array(size).fill(-1);
  const order = new Uint32Array(size);
  for (let i = 0; i < size; i++) order[i] = i;
  // sort descending by (fill, then height) — outlet-first processing
  const key = new Float64Array(size);
  for (let i = 0; i < size; i++) key[i] = fill[i];
  order.sort((a, b) => (key[b] - key[a]) || (h[b] - h[a]));

  const ANG = NEI.map(([dx, dy]) => Math.atan2(dy, dx));
  // simple coherent bias field from two hashes (cheap "perlin-like")
  const phase = new Float32Array(size);
  for (let i = 0; i < size; i++) phase[i] = (rng() - 0.5) * 2;
  const smoothPhase = new Float32Array(size);
  for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
    const idx = j * n + i;
    smoothPhase[idx] = (phase[idx] * 4 + phase[idx - 1] + phase[idx + 1] + phase[idx - n] + phase[idx + n]) / 8;
  }

  for (let oi = 0; oi < size; oi++) {
    const idx = order[oi];
    const cx = idx % n, cy = (idx / n) | 0;
    const cur = fill[idx];
    let best = -1, bestScore = -Infinity;
    const phi = smoothPhase[idx] * Math.PI * meanderAmp;
    for (let k = 0; k < 8; k++) {
      const nx = cx + NEI[k][0], ny = cy + NEI[k][1];
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      const ni = ny * n + nx;
      const nf = fill[ni];
      if (nf > cur - 1e-12) {
        // ties inside flats: break with height then a stable jitter
        if (!(Math.abs(nf - cur) < 1e-9 && h[ni] < h[idx] - 1e-9)) continue;
      }
      const score = (cur - nf) * (1 + 0.5 * Math.cos(ANG[k] - phi)) + (cur - h[ni]) * 1e-6 - (ni * 1e-12);
      if (score > bestScore) { bestScore = score; best = ni; }
    }
    if (best < 0) continue;
    down[idx] = best;
    flow[best] += flow[idx];
  }
  return { flow, down, order };
}

/** Mutable state for a chunked field-erosion run. */
export function initFieldState({ h, hard, n, voxel, seed, seaLevel }) {
  const hh = Float64Array.from(h);
  return {
    h, hard, n, voxel, seed, seaLevel,
    hh,
    it: 0,
    rng: mulberry32((seed ^ 0x9e3779b9) >>> 0),
    bedrock: hh.reduce((m, v) => Math.min(m, v), Infinity) - 4,
    ff: null,
    carved: 0,
    deposited: 0,
    erosionMap: new Float32Array(n * n),
    depositMap: new Float32Array(n * n),
  };
}

/** Advance the field simulation by `count` iterations (mutates state). */
export function stepFieldIterations(st, count, params) {
  const { n, voxel, hh, hard } = st;
  const size = n * n;
  const cellArea = voxel * voxel;
  const K = params.K;
  const nExp = params.nExp;
  const D = params.D;
  const thermal = params.thermal;
  const seaLevel = st.seaLevel;
  const { erosionMap, depositMap } = st;

  for (let c = 0; c < count; c++, st.it++) {
    const it = st.it;
    if (it % 3 === 0 || !st.ff) {
      const fill = priorityFlood(hh, n);
      st.ff = flowField(hh, fill, n, st.rng);
    }
    const { flow, down, order } = st.ff;
    const load = new Float64Array(size);

    // ── incision + sediment routing (high → low) ──
    for (let oi = 0; oi < size; oi++) {
      const idx = order[oi];
      const dwn = down[idx];
      if (dwn < 0) continue;
      const cur = hh[idx];
      if (cur < seaLevel + 0.25) { load[dwn] += load[idx]; continue; }

      const cx = idx % n, cy = (idx / n) | 0;
      const dxn = (dwn % n) - cx, dyn = ((dwn / n) | 0) - cy;
      const dist = (dxn !== 0 && dyn !== 0) ? voxel * Math.SQRT2 : voxel;
      const drop = cur - hh[dwn];
      if (drop <= 0) { load[dwn] += load[idx]; continue; }
      const S = drop / dist;
      const A = flow[idx] * cellArea;

      // stream power: e = K·A^m·S^n — slope-controlled, so channels stop
      // cutting where the gradient relaxes (no runaway pits here either).
      const hardF = 1 - 0.62 * hard[idx];
      let e = K * 0.028 * Math.pow(A, 0.45) * Math.pow(S, nExp) * hardF;
      const cap = voxel * 0.22;
      if (e > cap) e = cap;
      if (cur - e < st.bedrock) e = Math.max(0, cur - st.bedrock);

      // sediment: capacity ∝ A^0.6·(S + floor); excess deposits locally with
      // a 3×3 spread so fans form instead of point piles.
      const capTransport = 0.05 * Math.pow(A, 0.6) * (S + 0.06);
      const incoming = load[idx] + e * 0.55;
      let carried = incoming;
      if (incoming > capTransport) {
        const excess = incoming - capTransport;
        const put = Math.min(excess, cap);
        hh[idx] += put;
        depositMap[idx] += put;
        st.deposited += put * cellArea;
        carried = incoming - put;
        if (excess > capTransport) {
          const spill = (excess - capTransport) * 0.25;
          for (let s = 0; s < 4; s++) {
            const nx = cx + NEI[s][0], ny = cy + NEI[s][1];
            if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
            const si = ny * n + nx;
            hh[si] += spill * 0.25;
            depositMap[si] += spill * 0.25;
            st.deposited += spill * 0.25 * cellArea;
          }
        }
      }
      load[dwn] += carried;

      if (e > 1e-9) {
        hh[idx] -= e;
        erosionMap[idx] += e;
        st.carved += e * cellArea;
      }
    }

    // ── flow-GATED hillslope diffusion: never smooths channel cells ──
    if (D > 0.001) {
      const gateFlow = 10 * cellArea; // below this drainage area = hillslope
      const src = Float64Array.from(hh);
      for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
        const idx = j * n + i;
        if (hh[idx] < seaLevel + 0.2) continue;
        const A = flow[idx] * cellArea;
        const gate = Math.max(0, Math.min(1, (gateFlow - A) / (gateFlow * 0.6)));
        if (gate <= 0.01) continue;
        const lap = src[idx - 1] + src[idx + 1] + src[idx - n] + src[idx + n] - 4 * src[idx];
        hh[idx] += D * gate * lap * 0.9;
      }
    }

    // ── thermal talus: move material only where slope exceeds repose ──
    if (thermal > 0.001) {
      const repose = Math.tan((32 * Math.PI) / 180);
      const src = Float64Array.from(hh);
      for (let j = 1; j < n - 1; j++) for (let i = 1; i < n - 1; i++) {
        const idx = j * n + i;
        for (let k = 0; k < 4; k++) {
          const nx = i + NEI[k][0], ny = j + NEI[k][1];
          const ni = ny * n + nx;
          const distK = voxel * NEI[k][2];
          const slope = (src[idx] - src[ni]) / distK;
          if (slope > repose) {
            const move = (slope - repose) * distK * 0.22 * thermal;
            hh[idx] -= move;
            hh[ni] += move;
          }
        }
      }
    }
  }
}

/** Finish a chunked run: produce the net height delta. */
export function finishFieldState(st) {
  const size = st.n * st.n;
  const dh = new Float32Array(size);
  for (let i = 0; i < size; i++) dh[i] = st.hh[i] - st.h[i];
  return { dh, erosionMap: st.erosionMap, depositMap: st.depositMap, carved: st.carved, deposited: st.deposited };
}

/* ───────────────────────── GPU glue ──────────────────────────────────── */

export class FieldErosion {
  constructor(gl, volumePP, soilPP, repair) {
    this.gl = gl;
    this.volumePP = volumePP;
    this.soilPP = soilPP;
    this.repair = repair;
    this.extractProg = program(gl, fullscreenVertex, extractFragment, "extract");
    this.applyProg = program(gl, fullscreenVertex, applyDeltaFragment, "applyDelta");
    this.fieldTarget = makeTarget(gl, N, N, 1, { internal: gl.RGBA32F });
    this.deltaTex = makeTexture(gl, N, N, { internal: gl.RGBA32F });
    this.busy = false;
  }

  /** Extract heightfield from the current volume. Returns {h, hard, sed}. */
  extract() {
    const gl = this.gl;
    bindTarget(gl, this.fieldTarget);
    gl.useProgram(this.extractProg.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.volumePP.src().textures[0]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.soilPP.src().textures[0]);
    gl.uniform1i(this.extractProg.u("terrain"), 0);
    gl.uniform1i(this.extractProg.u("soil"), 1);
    gl.viewport(0, 0, N, N);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    const buf = new Float32Array(N * N * 4);
    gl.readPixels(0, 0, N, N, gl.RGBA, gl.FLOAT, buf);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const h = new Float32Array(N * N), hard = new Float32Array(N * N), sed = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) {
      h[i] = buf[i * 4];
      hard[i] = buf[i * 4 + 1];
      sed[i] = buf[i * 4 + 2];
    }
    return { h, hard, sed };
  }

  /** Async chunked run with live progress; resolves with stats. */
  run(params, onProgress) {
    if (this.busy) return Promise.reject(new Error("field erosion already running"));
    this.busy = true;
    const { h, hard } = this.extract();
    const st = initFieldState({
      h, hard, n: N, voxel: CELL[0],
      seed: params.seed,
      seaLevel: params.waterLevel,
    });
    return new Promise((resolve) => {
      const chunk = () => {
        const remaining = params.iterations - st.it;
        if (remaining > 0) {
          stepFieldIterations(st, Math.min(3, remaining), params);
          if (onProgress) onProgress(st.it / params.iterations);
          setTimeout(chunk, 0);
          return;
        }
        const result = finishFieldState(st);
        this.applyDelta(result.dh, h, hard, params.detail);
        this.busy = false;
        resolve(result);
      };
      setTimeout(chunk, 20);
    });
  }

  applyDelta(dh, h, hard, detailAmp) {
    const gl = this.gl;
    // pack delta grid: r=dh, g=slope, b=hard, a=detailGate
    const data = new Float32Array(N * N * 4);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      const iL = Math.max(i - 1, 0), iR = Math.min(i + 1, N - 1);
      const jU = Math.max(j - 1, 0), jD = Math.min(j + 1, N - 1);
      const gx = (h[j * N + iR] - h[j * N + iL]) / ((iR - iL) * CELL[0]);
      const gz = (h[jD * N + i] - h[jU * N + i]) / ((jD - jU) * CELL[2]);
      const slope = Math.min(1.5, Math.hypot(gx, gz));
      const worked = Math.abs(dh[idx]) > CELL[1] * 0.04 ? 1 : 0.25; // sharpen freshly cut rock most
      data[idx * 4] = dh[idx];
      data[idx * 4 + 1] = slope;
      data[idx * 4 + 2] = hard[idx];
      data[idx * 4 + 3] = worked;
    }
    uploadTexture(gl, this.deltaTex, N, N, data, { internal: gl.RGBA32F });

    bindTarget(gl, this.volumePP.dst());
    gl.useProgram(this.applyProg.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.volumePP.src().textures[0]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.deltaTex);
    gl.uniform1i(this.applyProg.u("terrain"), 0);
    gl.uniform1i(this.applyProg.u("delta"), 1);
    gl.uniform4f(this.applyProg.u("knobs"), detailAmp, 0.9, 0, 0);
    drawFullscreen(gl, this.applyProg, ATLAS_W, ATLAS_H);
    this.volumePP.swap();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.repair.repair(this.volumePP, 3);
  }
}
