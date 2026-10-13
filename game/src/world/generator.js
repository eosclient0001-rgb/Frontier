// Procedural route blocks. Each call returns a "plan": raw sample arrays for one or more
// sections, plus the state at the block's end. Route.js decides whether to accept it.
//
// Geometry is integrated in plan view (heading + curvature), heights are set directly by
// profile functions, so ramps / viaducts / up-down splits stay smooth and continuous.
import { ELEV_HIGH } from './constants.js';
import { clamp, smoothstep01 } from '../core/math.js';

const TAU = Math.PI * 2;
const KAPPA_MAX = 0.0034; // max road curvature (1/m) => min radius ~290 m, comfortable at speed

/** Integrate a path of `L` one-metre steps. kappa(i) = heading change per metre. */
function integrate(x0, z0, h0, L, kappa, height) {
  const n = Math.round(L) + 1;
  const xs = new Array(n);
  const ys = new Array(n);
  const zs = new Array(n);
  const bs = new Array(n);
  let x = x0;
  let z = z0;
  let h = h0;
  for (let i = 0; i < n; i++) {
    const k = kappa(i);
    xs[i] = x;
    zs[i] = z;
    ys[i] = height(i);
    // Banking leans the road into the bend (positive = right side up for right turns).
    bs[i] = clamp(k * 60, -0.14, 0.14);
    if (i < n - 1) {
      h += k;
      x += Math.cos(h);
      z += Math.sin(h);
    }
  }
  return { xs, ys, zs, bs, x, z, h };
}

function singleBlock(st, L, kappa, elev1, kind) {
  const h0 = st.elev;
  const height = (i) => h0 + (elev1 - h0) * smoothstep01(i / L);
  const g = integrate(st.x, st.z, st.h, L, kappa, height);
  return {
    isY: false,
    lastKind: kind,
    specs: [{ kind, xs: g.xs, ys: g.ys, zs: g.zs, bs: g.bs, elev: elev1, dist0Off: 0 }],
    end: { x: g.x, z: g.z, h: g.h, elev: elev1 },
    advance: L,
    openIdx: [0],
  };
}

function planStraight(st, rng, { L, elev1, wander = true }) {
  const a = wander ? rng.range(-0.0009, 0.0009) : 0;
  const kind = elev1 !== st.elev ? 'ramp' : 'straight';
  return singleBlock(st, L, (i) => a * Math.sin((TAU * i) / L), elev1, kind);
}

function planCurve(st, rng, { L, elev1 }) {
  const aMax = Math.min(0.7, (2 * L * KAPPA_MAX) / Math.PI);
  const mag = rng.range(0.25, Math.max(0.3, aMax));
  let sign = rng.chance(0.5) ? 1 : -1;
  // keep the overall heading bounded so the infinite route can't loop back on itself
  if (Math.abs(st.h) > 0.45 && rng.chance(0.85)) sign = st.h > 0 ? -1 : 1;
  const A = sign * mag;
  const K = (A * Math.PI) / (2 * L);
  const kind = elev1 !== st.elev ? 'ramp' : 'curve';
  return singleBlock(st, L, (i) => K * Math.sin((Math.PI * i) / L), elev1, kind);
}

/** Smooth plateau: 0 at both ends, 1 in the middle, ramps of length `rr`. */
function plateau(i, L, rr) {
  return smoothstep01(i / rr) * smoothstep01((L - i) / rr);
}

/**
 * Y-split: a short straight stub, then two branches that diverge and re-merge.
 * Each branch heading follows theta(u) = ±Θ·sin(2πu/L), so the lateral offset is a clean
 * lens shape that returns exactly to the centre line at the merge point.
 * Up/down variant: one branch climbs onto the viaduct while the other stays at street level
 * (or drops to street level when we're already elevated).
 */
function planY(st, rng) {
  const h0 = st.elev;
  const updown = rng.chance(0.55);
  const L = updown ? 660 : 520;
  const rr = 250;
  const d = rng.range(26, 31); // lateral offset of each branch from the axis
  const theta = (d * Math.PI) / L;
  const sigma = rng.chance(0.5) ? 1 : -1;
  const kappaFor = (sg) => (i) => sg * theta * (TAU / L) * Math.cos((TAU * i) / L);

  // stub
  const stubL = 60;
  const stub = integrate(st.x, st.z, st.h, stubL, () => 0, () => h0);

  let hA;
  let hB;
  if (updown) {
    hA = (i) => h0 + (ELEV_HIGH - h0) * plateau(i, L, rr); // upper branch
    hB = (i) => h0 + (0 - h0) * plateau(i, L, rr); // lower branch
  } else {
    hA = () => h0;
    hB = () => h0;
  }

  const A = integrate(stub.x, stub.z, stub.h, L, kappaFor(sigma), hA);
  const B = integrate(stub.x, stub.z, stub.h, L, kappaFor(-sigma), hB);

  // Both branches must land exactly on the merge point; spread the (tiny) error linearly.
  const tx = stub.x + L * Math.cos(stub.h);
  const tz = stub.z + L * Math.sin(stub.h);
  const fix = (br) => {
    const ex = tx - br.x;
    const ez = tz - br.z;
    for (let i = 0; i < br.xs.length; i++) {
      const f = i / (br.xs.length - 1);
      br.xs[i] += ex * f;
      br.zs[i] += ez * f;
    }
  };
  fix(A);
  fix(B);

  const pre = { kind: 'ysplit-pre', xs: stub.xs, ys: stub.ys, zs: stub.zs, bs: stub.bs, elev: h0, dist0Off: 0 };
  const brA = {
    kind: 'ysplit-a',
    xs: A.xs,
    ys: A.ys,
    zs: A.zs,
    bs: A.bs,
    elev: Math.max(...A.ys),
    dist0Off: stubL,
    isY: true,
  };
  const brB = {
    kind: 'ysplit-b',
    xs: B.xs,
    ys: B.ys,
    zs: B.zs,
    bs: B.bs,
    elev: Math.max(...B.ys),
    dist0Off: stubL,
    isY: true,
  };
  pre.isY = true;
  return {
    isY: true,
    lastKind: 'ysplit',
    specs: [pre, brA, brB],
    end: { x: tx, z: tz, h: stub.h, elev: h0 },
    advance: stubL + L,
    openIdx: [1, 2],
  };
}

/**
 * Pick the next block. `opts.forceStraight` is used for the opening stretch.
 */
export function planBlock(st, rng, opts = {}) {
  if (opts.forceStraight) {
    const p = planStraight(st, rng, { L: 200, elev1: st.elev, wander: false });
    p.lastKind = 'straight';
    return p;
  }
  const flip = st.elev === 0 ? ELEV_HIGH : 0;
  const weights = {
    straight: 3,
    curve: 3.2,
    ramp: st.lastKind === 'ramp' || st.lastKind === 'ysplit' ? 0 : 0.8,
    ysplit: st.lastKind === 'ysplit' ? 0 : 1.0,
  };
  const kind = rng.weighted(weights);
  if (kind === 'ysplit') return planY(st, rng);
  if (kind === 'ramp') {
    const p = planStraight(st, rng, { L: 260, elev1: flip, wander: false });
    p.lastKind = 'ramp';
    return p;
  }
  if (kind === 'curve') {
    const L = Math.round(rng.range(200, 300));
    const p = planCurve(st, rng, { L, elev1: st.elev });
    p.lastKind = 'curve';
    return p;
  }
  const L = Math.round(rng.range(110, 220));
  const p = planStraight(st, rng, { L, elev1: st.elev, wander: true });
  p.lastKind = 'straight';
  return p;
}
