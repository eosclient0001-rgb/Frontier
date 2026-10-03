// CPU mirror of the WGSL solver: verifies the collision projection agrees with
// the analytic body surface, then runs the full XPBD loop and checks stability.
// Run: node tools/sim-test.mjs
import { buildBodySpec, packCollision, bodySigned, bodySurface } from '../src/body.js';
import { buildDress } from '../src/dress.js';
import { buildConstraints, buildState, CON_STRIDE } from '../src/physics.js';
import { clamp, lerp } from '../src/math.js';

let failures = 0;
const ok = (cond, msg, extra = '') => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { failures++; console.log(`  ✗ ${msg} ${extra}`); }
};

const P = {
  height: 1.70, shoulders: 1.0, bust: 1.0, waist: 0.92, hips: 1.06,
  bustHeight: 1.0, armAngle: 16, legSpread: 0, bodySegments: 44,
  style: 'aline', length: 0.60, fit: 1.030, ease: 1.0, flare: 1.0,
  pleats: 14, pleatDepth: 0.020, neckline: 'sweetheart', straps: 1,
  strapWidth: 0.030, strapInset: 0, strapPinRange: 0.16, neckDrop: 1.0,
  hemSweep: 1.0, tierAmp: 1.0, resolution: 64, pinTopRows: 2, arealDensity: 0.20,
  constraintParams: { stretchComp: 1.5e-6, shearComp: 3e-5, bendComp: 8e-4, stitchComp: 1e-7 },
};

const spec = buildBodySpec(P);
const col = packCollision(spec);

// ---------------------------------------------------------------- WGSL mirror
function wgslProjectLoft(p, thickness) {
  const rings = spec.rings;
  const n = rings.length;
  if (p[1] < rings[0].y || p[1] > rings[n - 1].y) return p;
  const y = p[1];
  let i = 0;
  for (let k = 0; k + 1 < n; k++) {
    if (rings[k].y <= y && y <= rings[k + 1].y) { i = k; break; }
  }
  const A = rings[i], B = rings[i + 1];
  const t = clamp((y - A.y) / Math.max(B.y - A.y, 1e-6), 0, 1);
  const rx = lerp(A.rx, B.rx, t), rz = lerp(A.rz, B.rz, t);
  const cx = lerp(A.cx, B.cx, t), cz = lerp(A.cz, B.cz, t);
  const e = lerp(A.e, B.e, t), ft = lerp(A.front, B.front, t), bk = lerp(A.back, B.back, t);
  const lx = p[0] - cx, lz = p[2] - cz;
  const len = Math.hypot(lx, lz);
  const theta = Math.atan2(lz, lx);
  const sr = Math.pow(Math.pow(Math.abs(Math.cos(theta)) / rx, e) + Math.pow(Math.abs(Math.sin(theta)) / rz, e), -1 / e);
  const dirZ = Math.sin(theta);
  const bulge = dirZ > 0 ? 1 + ft * dirZ * dirZ : 1 + bk * dirZ * dirZ;
  const target = sr * bulge + thickness;
  if (len >= target || len < 1e-6) return p;
  const sc = target / len;
  return [cx + lx * sc, p[1], cz + lz * sc];
}

console.log('\n== collision projection vs analytic surface ==');
{
  const th = 0.006;
  let worst = 0;
  let worstPt = null;
  for (let i = 0; i < 4000; i++) {
    const y = 0.8 + Math.random() * 0.7;
    const ang = Math.random() * Math.PI * 2;
    const depth = Math.random() * 0.06;
    const s = bodySurface(spec, y, ang);
    const px = s[0] * (1 - depth / 0.15);
    const pz = s[1] * (1 - depth / 0.15);
    if (y < spec.rings[0].y || y > spec.rings[spec.rings.length - 1].y) continue;
    const before = [px, y, pz];
    if (bodySigned(spec, y, px, pz) > th) continue; // already outside
    const after = wgslProjectLoft(before, th);
    const sd = bodySigned(spec, after[1], after[0], after[2]);
    const err = Math.abs(sd - th);
    if (err > worst) { worst = err; worstPt = before; }
  }
  ok(worst < 0.004, `WGSL projection lands on the analytic surface (max err ${(worst * 1000).toFixed(2)} mm)`,
    worstPt ? worstPt.map(v => v.toFixed(3)).join(',') : '');

  let outsideOk = true;
  for (let i = 0; i < 2000; i++) {
    const y = spec.rings[0].y + 0.02 + Math.random() * (spec.rings[spec.rings.length - 1].y - spec.rings[0].y - 0.06);
    const ang = Math.random() * Math.PI * 2;
    const s = bodySurface(spec, y, ang);
    const k = 0.5 + Math.random() * 0.7;
    const p = [s[0] * k, y, s[1] * k];
    const after = wgslProjectLoft(p, 0.006);
    if (bodySigned(spec, after[1], after[0], after[2]) < -0.002) { outsideOk = false; break; }
  }
  ok(outsideOk, 'deep interior points are pushed outside the surface');
}

// ---------------------------------------------------------------- XPBD loop
const dress = buildDress(spec, P, P.resolution);
const state = buildState(dress, P, dress.pins);
const cons = buildConstraints(dress, P.constraintParams);
const n = state.count;

const pos = Array.from({ length: n }, (_, i) => [state.pos[i * 4], state.pos[i * 4 + 1], state.pos[i * 4 + 2]]);
const vel = Array.from({ length: n }, () => [0, 0, 0]);
const prev = pos.map((p) => [...p]);
const invMass = Float64Array.from({ length: n }, (_, i) => state.pos[i * 4 + 3]);
const lam = new Float64Array(cons.count);
const ci = new Int32Array(cons.count);
const cj = new Int32Array(cons.count);
const crest = new Float64Array(cons.count);
const ccomp = new Float64Array(cons.count);
for (let k = 0; k < cons.count; k++) {
  ci[k] = cons.u32[k * CON_STRIDE];
  cj[k] = cons.u32[k * CON_STRIDE + 1];
  crest[k] = cons.f32[k * CON_STRIDE + 2];
  ccomp[k] = cons.f32[k * CON_STRIDE + 3];
}
const pinIdx = Array.from(state.pinIndices);
const pinTargets = [];
for (let k = 0; k < pinIdx.length; k++) {
  pinTargets.push([state.pinPos[k * 4], state.pinPos[k * 4 + 1], state.pinPos[k * 4 + 2]]);
}

const caps = [];
for (let i = 0; i < col.capsuleCount; i++) {
  caps.push({
    a: [col.capsules[i * 8], col.capsules[i * 8 + 1], col.capsules[i * 8 + 2]], ra: col.capsules[i * 8 + 3],
    b: [col.capsules[i * 8 + 4], col.capsules[i * 8 + 5], col.capsules[i * 8 + 6]], rb: col.capsules[i * 8 + 7],
  });
}

function projectCapsules(p, thickness) {
  for (const c of caps) {
    const ab = [c.b[0] - c.a[0], c.b[1] - c.a[1], c.b[2] - c.a[2]];
    const abLen2 = Math.max(ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2, 1e-9);
    const d0 = [p[0] - c.a[0], p[1] - c.a[1], p[2] - c.a[2]];
    const t = clamp((d0[0] * ab[0] + d0[1] * ab[1] + d0[2] * ab[2]) / abLen2, 0, 1);
    const closest = [c.a[0] + ab[0] * t, c.a[1] + ab[1] * t, c.a[2] + ab[2] * t];
    const r = lerp(c.ra, c.rb, t) + thickness;
    const d = [p[0] - closest[0], p[1] - closest[1], p[2] - closest[2]];
    const dl = Math.hypot(...d);
    if (dl < r) {
      if (dl < 1e-5) p = [closest[0], closest[1], closest[2] + r];
      else p = [closest[0] + d[0] / dl * r, closest[1] + d[1] / dl * r, closest[2] + d[2] / dl * r];
    }
  }
  return p;
}

const SIM = { gravity: [0, -9.81, 0], damping: 0.008, thickness: 0.006, friction: 0.55, restitution: 0.02 };
const iterations = 6, substeps = 2, pinEvery = 2;
const dt = 1 / 60 / substeps;

function step() {
  // ---- predict
  for (let i = 0; i < n; i++) {
    if (invMass[i] <= 0) continue;
    let v = vel[i];
    v[1] += SIM.gravity[1] * dt;
    const d = 1 - SIM.damping;
    v[0] *= d; v[1] *= d; v[2] *= d;
    prev[i][0] = pos[i][0]; prev[i][1] = pos[i][1]; prev[i][2] = pos[i][2];
    pos[i][0] += v[0] * dt; pos[i][1] += v[1] * dt; pos[i][2] += v[2] * dt;
  }
  lam.fill(0);

  // ---- solve
  const dt2 = dt * dt;
  for (let it = 0; it < iterations; it++) {
    for (let k = 0; k < cons.count; k++) {
      const i = ci[k], j = cj[k];
      const wi = invMass[i], wj = invMass[j];
      const wsum = wi + wj;
      if (wsum <= 0) continue;
      const alphaT = ccomp[k] / Math.max(dt2, 1e-9);
      let d = [pos[i][0] - pos[j][0], pos[i][1] - pos[j][1], pos[i][2] - pos[j][2]];
      const len = Math.hypot(...d);
      if (len < 1e-9) continue;
      d = [d[0] / len, d[1] / len, d[2] / len];
      const C = len - crest[k];
      const dlam = (-C - alphaT * lam[k]) / (wsum + alphaT);
      if (wi > 0) { pos[i][0] += d[0] * dlam * wi; pos[i][1] += d[1] * dlam * wi; pos[i][2] += d[2] * dlam * wi; }
      if (wj > 0) { pos[j][0] -= d[0] * dlam * wj; pos[j][1] -= d[1] * dlam * wj; pos[j][2] -= d[2] * dlam * wj; }
      lam[k] += dlam;
    }
    if (it % pinEvery === pinEvery - 1) {
      for (let k = 0; k < pinIdx.length; k++) {
        const vi = pinIdx[k];
        pos[vi][0] = pinTargets[k][0];
        pos[vi][1] = pinTargets[k][1];
        pos[vi][2] = pinTargets[k][2];
      }
    }
  }

  // ---- collide
  let hits = 0;
  for (let i = 0; i < n; i++) {
    if (invMass[i] <= 0) continue;
    let p = pos[i];
    const before = [...p];
    let q = wgslProjectLoft(p, SIM.thickness);
    q = projectCapsules(q, SIM.thickness);
    let nrm = [0, 0, 0];
    let hit = false;
    const dist = Math.hypot(q[0] - before[0], q[1] - before[1], q[2] - before[2]);
    if (dist > 1e-7) {
      nrm = [(q[0] - before[0]) / dist, (q[1] - before[1]) / dist, (q[2] - before[2]) / dist];
      hit = true;
    }
    p = q;
    if (p[1] < SIM.thickness) { p = [p[0], SIM.thickness, p[2]]; nrm = [0, 1, 0]; hit = true; }
    pos[i] = p;
    if (hit) {
      hits++;
      const v = vel[i];
      const vn = v[0] * nrm[0] + v[1] * nrm[1] + v[2] * nrm[2];
      let vN = [nrm[0] * vn, nrm[1] * vn, nrm[2] * vn];
      let vT = [v[0] - vN[0], v[1] - vN[1], v[2] - vN[2]];
      if (vn < 0) { vN = vN.map((c) => c * -SIM.restitution); }
      vT = vT.map((c) => c * (1 - SIM.friction));
      const vNew = [vN[0] + vT[0], vN[1] + vT[1], vN[2] + vT[2]];
      prev[i] = [p[0] - vNew[0] * dt, p[1] - vNew[1] * dt, p[2] - vNew[2] * dt];
    }
  }

  // ---- finalize
  for (let i = 0; i < n; i++) {
    if (invMass[i] <= 0) continue;
    vel[i] = [
      (pos[i][0] - prev[i][0]) / dt,
      (pos[i][1] - prev[i][1]) / dt,
      (pos[i][2] - prev[i][2]) / dt,
    ];
  }
  return hits;
}

console.log('\n== XPBD stability (CPU mirror of the GPU shaders) ==');
let maxSpeed = 0;
let nan = false;
const t0 = Date.now();
let totalHits = 0;
for (let f = 0; f < 150; f++) {
  for (let s = 0; s < substeps; s++) totalHits += step();
  for (let i = 0; i < n; i++) {
    const sp = Math.hypot(...vel[i]);
    if (!Number.isFinite(sp) || !Number.isFinite(pos[i][0])) nan = true;
    if (sp > maxSpeed) maxSpeed = sp;
  }
  if (nan) break;
  if (process.env.VERBOSE && f % 15 === 0) {
    const rowTop = pos.slice(0, dress.cols).reduce((a,p)=>a+p[1],0)/dress.cols;
    const hemRow = pos.slice((dress.rows-1)*dress.cols, dress.rows*dress.cols).reduce((a,p)=>a+p[1],0)/dress.cols;
    const rad = pos.slice((dress.rows-1)*dress.cols, dress.rows*dress.cols)
      .reduce((a,p)=>a+Math.hypot(p[0],p[2]),0)/dress.cols;
    // stretch on structural constraints
    let worst = 1, worstInfo = '';
    for (let k=0;k<cons.count;k++){
      if (cons.f32[k*CON_STRIDE+4]!==0) continue;
      const L=Math.hypot(pos[ci[k]][0]-pos[cj[k]][0], pos[ci[k]][1]-pos[cj[k]][1], pos[ci[k]][2]-pos[cj[k]][2]);
      const r = crest[k]||1e-6; const ratio = L/r;
      if (ratio>worst){ worst=ratio; worstInfo=`rest=${r.toFixed(4)} now=${L.toFixed(4)} v=${ci[k]}->${cj[k]}`; }
    }
    console.log(`   f${String(f).padStart(3)} topY=${rowTop.toFixed(3)} hemY=${hemRow.toFixed(3)} hemR=${rad.toFixed(3)} maxStretch=${worst.toFixed(2)} [${worstInfo}]`);
  }
}
const ms = Date.now() - t0;
ok(!nan, 'no NaN/Inf after 150 frames of XPBD');
ok(maxSpeed < 25, `velocities stay bounded (max ${maxSpeed.toFixed(2)} m/s)`);

// penetration check against the analytic body
let penetrations = 0;
let worstPen = Infinity;
for (let i = 0; i < n; i++) {
  const p = pos[i];
  if (p[1] < spec.rings[0].y) continue; // below the crotch: legs only
  const sd = bodySigned(spec, p[1], p[0], p[2]);
  if (sd < -0.001) { penetrations++; worstPen = Math.min(worstPen, sd); }
}
ok(penetrations === 0, `cloth never penetrates the mannequin (${penetrations} bad points)`,
  Number.isFinite(worstPen) ? `worst ${worstPen.toFixed(4)}` : '');

// the dress should still be roughly where it started (pinned) rather than sliding off
// pinned vertices must stay glued to their targets
let worstPin = 0;
for (let k = 0; k < pinIdx.length; k++) {
  const vi = pinIdx[k];
  const d = Math.hypot(pos[vi][0] - pinTargets[k][0], pos[vi][1] - pinTargets[k][1], pos[vi][2] - pinTargets[k][2]);
  if (d > worstPin) worstPin = d;
}
ok(worstPin < 0.02, `pinned shoulder/strap points hold their targets (max slip ${(worstPin * 1000).toFixed(1)} mm)`);
if (process.env.VERBOSE) {
  const slips = pinIdx.map((vi, k) => ({ vi, d: Math.hypot(pos[vi][0]-pinTargets[k][0], pos[vi][1]-pinTargets[k][1], pos[vi][2]-pinTargets[k][2]), t: pinTargets[k], p: pos[vi] }))
    .sort((a,b)=>b.d-a.d).slice(0,4);
  for (const s of slips) console.log(`     pin v${s.vi} slip ${(s.d*1000).toFixed(1)}mm target ${s.t.map(v=>v.toFixed(3))} now ${s.p.map(v=>v.toFixed(3))} strap=${dress.meta[s.vi].strap}`);
}

const hemNow = Math.min(...pos.filter((_, i) => i % 7 === 0).map((p) => p[1]));
ok(hemNow > -0.01, `hem stays above the floor (${hemNow.toFixed(3)} m)`);

const drift = pos.reduce((acc, p, i) => acc + Math.hypot(p[0] - state.pos[i * 4], p[1] - state.pos[i * 4 + 1], p[2] - state.pos[i * 4 + 2]), 0) / n;
ok(drift < 0.12, `dress settles near its authored shape (mean drift ${(drift * 100).toFixed(1)} cm)`);

console.log(`  · ${(ms / 150).toFixed(1)} ms/frame in JS for ${n} points / ${cons.count} constraints ` +
  `(GPU runs this in parallel; ${totalHits} contact responses total)`);

console.log(`\n${failures === 0 ? '✅ simulation checks passed' : `❌ ${failures} problem(s)`}\n`);
process.exit(failures === 0 ? 0 : 1);
