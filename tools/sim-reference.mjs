/**
 * CPU reference implementation of the hydraulic erosion core.
 *
 * The sandbox has no GPU, so this is how the physics gets verified before it
 * ever runs in a browser. It mirrors the arithmetic in hydro_flux / _update /
 * _erode / thermal on a small grid and checks that the model actually produces
 * canyon morphology rather than just "not crashing":
 *
 *   1. mass conservation of water in a closed basin
 *   2. stability: no NaN/blowup at an aggressive time step
 *   3. drainage networks form (flow concentrates, it does not sheet uniformly)
 *   4. DIFFERENTIAL EROSION: hard beds end up standing above soft beds,
 *      which is the entire basis of the cliff-and-bench canyon profile
 *   5. talus: the angle-of-repose rule actually limits slope angles
 *
 *   node tools/sim-reference.mjs
 */

const N = 64;               // grid is N x N
const CELL = 8.0;           // metres per cell
const GRAV = 9.81;

function idx(x, z) { return z * N + x; }
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function makeState() {
  return {
    h: new Float64Array(N * N),
    water: new Float64Array(N * N),
    sed: new Float64Array(N * N),
    reg: new Float64Array(N * N),
    fluxL: new Float64Array(N * N),
    fluxR: new Float64Array(N * N),
    fluxD: new Float64Array(N * N),
    fluxU: new Float64Array(N * N),
    vx: new Float64Array(N * N),
    vz: new Float64Array(N * N),
  };
}

// --- the stratigraphy: alternating hard/soft beds, exactly as in geology.wgsl
function bedHardness(y, bedThickness = 18, capFrac = 0.3, contrast = 2.6) {
  const t = y / bedThickness;
  const bi = Math.floor(t);
  // deterministic pseudo-random per bed
  let r = Math.abs(Math.sin(bi * 12.9898) * 43758.5453);
  r -= Math.floor(r);
  const thr = 1 - capFrac;
  let h = r > thr ? 0.62 + 0.38 * (r - thr) / (1 - thr) : r * thr * 0.55;
  return clamp(0.5 + (h - 0.5) * contrast, 0.02, 1);
}

function initTerrain(S, { slope = 0.35, rough = 12, incision = 40 } = {}) {
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = idx(x, z);
      let h = 220 - (z / N) * slope * 200;
      // gentle noise
      h += rough * (Math.sin(x * 0.31) * Math.cos(z * 0.27) + 0.5 * Math.sin(x * 0.13 + z * 0.17));
      // seed channel down the middle
      const cx = N * 0.5 + Math.sin((z / N) * Math.PI * 2) * 5;
      const d = Math.abs(x - cx) / 6;
      h -= incision * Math.max(0, 1 - d * d);
      S.h[i] = h;
    }
  }
}

function step(S, P) {
  const { dt, rain, inflow, evap, pipeA, kC, kE, kD, minSlope, repose } = P;
  const area = CELL * CELL;

  // ---- 1. rain + inflow --------------------------------------------------
  for (let i = 0; i < N * N; i++) S.water[i] += rain * dt;
  for (let x = 0; x < N; x++) {
    const cx = N * 0.5;
    const d = Math.abs(x - cx) / 6;
    S.water[idx(x, 0)] += inflow * Math.exp(-d * d * 2.5) * dt;
  }

  // ---- 2. flux -----------------------------------------------------------
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = idx(x, z);
      const surf = S.h[i] + S.water[i];
      const sAt = (xx, zz) => {
        if (xx < 0 || zz < 0 || xx >= N || zz >= N) return surf;
        const j = idx(xx, zz);
        return S.h[j] + S.water[j];
      };
      let fL = Math.max(0, S.fluxL[i] + dt * pipeA * GRAV * (surf - sAt(x - 1, z)) / CELL);
      let fR = Math.max(0, S.fluxR[i] + dt * pipeA * GRAV * (surf - sAt(x + 1, z)) / CELL);
      let fD = Math.max(0, S.fluxD[i] + dt * pipeA * GRAV * (surf - sAt(x, z - 1)) / CELL);
      let fU = Math.max(0, S.fluxU[i] + dt * pipeA * GRAV * (surf - sAt(x, z + 1)) / CELL);

      if (x === 0) fL = 0;
      if (x === N - 1) fR = 0;
      if (z === 0) fD = 0;
      // z === N-1 is the outlet

      const total = (fL + fR + fD + fU) * dt;
      const avail = S.water[i] * area;
      if (total > 1e-12) {
        const k = Math.min(1, avail / total);
        fL *= k; fR *= k; fD *= k; fU *= k;
      }
      S.fluxL[i] = fL; S.fluxR[i] = fR; S.fluxD[i] = fD; S.fluxU[i] = fU;
    }
  }

  // ---- 3. apply flux -----------------------------------------------------
  const newW = new Float64Array(N * N);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = idx(x, z);
      const g = (xx, zz, which) => {
        if (xx < 0 || zz < 0 || xx >= N || zz >= N) return 0;
        const j = idx(xx, zz);
        return which === 'R' ? S.fluxR[j] : which === 'L' ? S.fluxL[j] : which === 'U' ? S.fluxU[j] : S.fluxD[j];
      };
      const inflowSum = g(x - 1, z, 'R') + g(x + 1, z, 'L') + g(x, z - 1, 'U') + g(x, z + 1, 'D');
      const out = S.fluxL[i] + S.fluxR[i] + S.fluxD[i] + S.fluxU[i];
      const w0 = S.water[i];
      let w1 = Math.max(0, w0 + (inflowSum - out) * dt / area);

      const wAvg = Math.max(0.5 * (w0 + w1), 0.004);
      let vx = 0.5 * (g(x - 1, z, 'R') - S.fluxL[i] + S.fluxR[i] - g(x + 1, z, 'L')) / (CELL * wAvg);
      let vz = 0.5 * (g(x, z - 1, 'U') - S.fluxD[i] + S.fluxU[i] - g(x, z + 1, 'D')) / (CELL * wAvg);
      const vlen = Math.hypot(vx, vz);
      if (vlen > 24) { vx *= 24 / vlen; vz *= 24 / vlen; }
      S.vx[i] = vx; S.vz[i] = vz;

      w1 = Math.max(0, w1 - evap * dt * 0.35);
      w1 *= Math.max(0, 1 - evap * dt * 0.15);
      newW[i] = w1;
    }
  }
  S.water.set(newW);

  // ---- 4. erode / deposit ------------------------------------------------
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = idx(x, z);
      const dhdx = (S.h[idx(x - 1, z)] - S.h[idx(x + 1, z)]) / (2 * CELL);
      const dhdz = (S.h[idx(x, z - 1)] - S.h[idx(x, z + 1)]) / (2 * CELL);
      const slopeMag = Math.hypot(dhdx, dhdz);
      const sinA = Math.max(slopeMag / Math.sqrt(1 + slopeMag * slopeMag), minSlope);

      const speed = Math.hypot(S.vx[i], S.vz[i]);
      const depth = S.water[i];
      const depthFactor = 1 - Math.exp(-depth * 6);
      const shield = 1 / (1 + depth * 0.35);
      let C = kC * sinA * speed * depthFactor * shield;
      if (depth < 1e-4) C = 0;

      const hard = bedHardness(S.h[i]);
      const resist = 1 / (0.12 + hard * hard * 2.6);

      let dh = 0;
      if (C > S.sed[i]) {
        const amount = kE * (C - S.sed[i]) * dt;
        const fromReg = Math.min(S.reg[i], amount);
        S.reg[i] -= fromReg;
        const intoRock = (amount - fromReg) * resist;
        dh = -(fromReg + intoRock);
        S.sed[i] += fromReg + intoRock;
      } else {
        const amount = kD * (S.sed[i] - C) * dt;
        dh = amount;
        S.sed[i] -= amount;
        S.reg[i] += amount;
      }
      dh = clamp(dh, -0.45 * dt * 30, 0.45 * dt * 30);
      S.h[i] += dh;
    }
  }

  // ---- 5. sediment advection (semi-Lagrangian) ---------------------------
  const ns = new Float64Array(N * N);
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = idx(x, z);
      const fx = clamp(x - S.vx[i] * dt / CELL, 0, N - 1.001);
      const fz = clamp(z - S.vz[i] * dt / CELL, 0, N - 1.001);
      const x0 = Math.floor(fx), z0 = Math.floor(fz);
      const tx = fx - x0, tz = fz - z0;
      const s00 = S.sed[idx(x0, z0)], s10 = S.sed[idx(Math.min(x0 + 1, N - 1), z0)];
      const s01 = S.sed[idx(x0, Math.min(z0 + 1, N - 1))], s11 = S.sed[idx(Math.min(x0 + 1, N - 1), Math.min(z0 + 1, N - 1))];
      ns[i] = Math.max(0, (s00 * (1 - tx) + s10 * tx) * (1 - tz) + (s01 * (1 - tx) + s11 * tx) * tz);
    }
  }
  S.sed.set(ns);

  // ---- 6. thermal / talus ------------------------------------------------
  const maxDrop = Math.tan(repose * Math.PI / 180) * CELL;
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = idx(x, z);
      const nb = [idx(x - 1, z), idx(x + 1, z), idx(x, z - 1), idx(x, z + 1)];
      let total = 0;
      const ex = nb.map((j) => {
        const d = S.h[i] - S.h[j];
        const e = d > maxDrop ? d - maxDrop : 0;
        total += e;
        return e;
      });
      if (total > 1e-9) {
        const budget = Math.min(total * 0.5, total) * clamp(P.talusRate * dt * 4, 0, 1);
        let moved = 0;
        nb.forEach((j, k) => {
          if (ex[k] <= 0) return;
          const amt = budget * (ex[k] / total);
          S.h[j] += amt; S.reg[j] += amt; moved += amt;
        });
        S.h[i] -= moved;
        S.reg[i] = Math.max(0, S.reg[i] - moved);
      }
    }
  }
}

// ===========================================================================
//  Tests
// ===========================================================================
const P = {
  dt: 0.028, rain: 0.010, inflow: 0.55, evap: 0.016, pipeA: 1.0,
  kC: 1.5, kE: 0.55, kD: 0.55, minSlope: 0.030, repose: 33, talusRate: 0.55,
};

let failures = 0;
const ok = (cond, label, detail = '') => {
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? `  ${detail}` : ''}`);
  if (!cond) failures++;
};

const finite = (arr) => arr.every(Number.isFinite);

// ---- Test 1: closed-basin water conservation -----------------------------
console.log('\n1. Water mass conservation (closed basin, no rain/evap/outlet)');
{
  const S = makeState();
  initTerrain(S, { slope: 0, incision: 0 });
  // bowl so nothing needs to leave
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const dx = (x - N / 2) / (N / 2), dz = (z - N / 2) / (N / 2);
    S.h[idx(x, z)] = 100 + 220 * (dx * dx + dz * dz);
  }
  for (let i = 0; i < N * N; i++) S.water[i] = 2.0;
  const before = S.water.reduce((a, b) => a + b, 0);
  const Pc = { ...P, rain: 0, inflow: 0, evap: 0 };
  // seal the outlet by making the last row a wall
  for (let i = 0; i < 260; i++) {
    step(S, Pc);
    // re-zero flux leaving the downstream edge to emulate a fully closed basin
    for (let x = 0; x < N; x++) S.fluxU[idx(x, N - 1)] = 0;
  }
  const after = S.water.reduce((a, b) => a + b, 0);
  const err = Math.abs(after - before) / before;
  ok(finite([...S.water]), 'water field stays finite');
  ok(err < 0.02, 'total water conserved within 2%', `drift ${(err * 100).toFixed(3)}%`);
}

// ---- Test 2: stability at an aggressive timestep -------------------------
console.log('\n2. Stability at aggressive settings (dt=0.08, heavy rain)');
{
  const S = makeState();
  initTerrain(S);
  const Ph = { ...P, dt: 0.08, rain: 0.08, inflow: 3.0, kC: 8, kE: 3, kD: 3 };
  for (let i = 0; i < 400; i++) step(S, Ph);
  ok(finite([...S.h]), 'terrain stays finite');
  ok(finite([...S.water]), 'water stays finite');
  ok(finite([...S.sed]), 'sediment stays finite');
  const maxH = Math.max(...S.h), minH = Math.min(...S.h);
  ok(maxH < 1e4 && minH > -1e4, 'terrain bounded', `range ${minH.toFixed(1)}..${maxH.toFixed(1)}`);
}

// ---- Test 3: drainage networks form --------------------------------------
console.log('\n3. Flow concentrates into channels (not uniform sheet flow)');
{
  const S = makeState();
  initTerrain(S);
  for (let i = 0; i < 600; i++) step(S, P);
  // Look at a mid-domain row: discharge should be strongly non-uniform.
  const row = [];
  for (let x = 0; x < N; x++) {
    const i = idx(x, Math.floor(N * 0.6));
    row.push(Math.hypot(S.vx[i], S.vz[i]) * S.water[i]);
  }
  const mean = row.reduce((a, b) => a + b, 0) / row.length;
  const peak = Math.max(...row);
  const ratio = peak / Math.max(mean, 1e-12);
  ok(ratio > 3, 'peak discharge >> mean (channelised)', `peak/mean = ${ratio.toFixed(1)}x`);
}

// ---- Test 4: DIFFERENTIAL EROSION (the canyon-forming mechanism) ---------
console.log('\n4. Differential erosion: hard beds stand above soft beds');
{
  const S = makeState();
  initTerrain(S);
  const h0 = Float64Array.from(S.h);
  for (let i = 0; i < 900; i++) step(S, P);

  // For each cell, correlate the hardness of the rock it started in against
  // how much was removed. Harder rock must erode less.
  let nHard = 0, nSoft = 0, eHard = 0, eSoft = 0;
  for (let i = 0; i < N * N; i++) {
    const hard = bedHardness(h0[i]);
    const eroded = h0[i] - S.h[i];
    if (hard > 0.6) { nHard++; eHard += eroded; }
    else if (hard < 0.35) { nSoft++; eSoft += eroded; }
  }
  const avgHard = eHard / Math.max(nHard, 1);
  const avgSoft = eSoft / Math.max(nSoft, 1);
  ok(nHard > 50 && nSoft > 50, 'both hard and soft beds sampled', `${nHard} hard / ${nSoft} soft cells`);
  ok(avgSoft > avgHard, 'soft rock eroded more than hard rock',
     `soft ${avgSoft.toFixed(3)} m vs hard ${avgHard.toFixed(3)} m`);
  const contrast = avgSoft / Math.max(avgHard, 1e-6);
  ok(contrast > 1.15, 'erosion contrast is significant (>1.15x)', `${contrast.toFixed(2)}x`);
}

// ---- Test 5: angle of repose limits slopes -------------------------------
console.log('\n5. Talus: angle of repose caps slope angles');
{
  const S = makeState();
  // A single vertical spike that must collapse into a cone.
  for (let i = 0; i < N * N; i++) S.h[i] = 50;
  S.h[idx(N / 2, N / 2)] = 400;
  const Pt = { ...P, rain: 0, inflow: 0, talusRate: 2.0 };
  for (let i = 0; i < 3000; i++) step(S, Pt);

  let maxAngle = 0;
  for (let z = 1; z < N - 1; z++) {
    for (let x = 1; x < N - 1; x++) {
      const i = idx(x, z);
      for (const j of [idx(x - 1, z), idx(x + 1, z), idx(x, z - 1), idx(x, z + 1)]) {
        const a = Math.atan2(Math.abs(S.h[i] - S.h[j]), CELL) * 180 / Math.PI;
        maxAngle = Math.max(maxAngle, a);
      }
    }
  }
  ok(finite([...S.h]), 'terrain finite after collapse');
  ok(maxAngle < P.repose + 6, `max slope near the ${P.repose}° repose angle`, `got ${maxAngle.toFixed(1)}°`);
}

console.log(failures === 0
  ? '\nAll physics checks passed.\n'
  : `\n${failures} physics check(s) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
