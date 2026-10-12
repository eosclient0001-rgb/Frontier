// Vehicle routes over the road / railway graph.
//
// A route is a chain of edges walked through the graph: at every node the walk continues on the
// most nearly straight unused edge, so trains follow their line through switches and junctions
// without any separate timetable data. Loops (a ring that returns to its start) are flagged so
// vehicles can run round them; other routes are shuttles that reverse at each end.
//
// Each route stores its centreline as flat typed arrays sampled about once per metre, plus a
// lateral base offset per sample (the lane or track centre, signed to the walking direction).
// Lateral offsets are smoothed over the joints, so a tram that changes lane position at a junction
// slides across instead of jumping.

import { getProfile } from './profiles.js';

const SMOOTH_RADIUS = 6;      // samples (≈ metres) either side for the lateral smoothing
const MIN_LENGTH = 30;        // routes shorter than this are not worth running

// accept(edge) -> boolean; lateral(edge, forward) -> base offset along the edge's normal, signed
// to the walking direction (the default is the centreline itself).
export function buildRoutes(net, { accept, lateral = () => 0 }) {
  const adj = new Map();
  for (const e of net.edges.values()) {
    if (!accept(e)) continue;
    for (const nid of [e.a, e.b]) { if (!adj.has(nid)) adj.set(nid, []); adj.get(nid).push(e); }
  }
  const used = new Set();
  const routes = [];
  // start from dead ends first so chains are walked end to end
  const starts = [...adj.keys()].sort((p, q) => adj.get(p).length - adj.get(q).length);
  for (const start of starts) {
    for (const first of adj.get(start)) {
      if (used.has(first.id)) continue;
      const seq = [];
      let node = start, e = first, loop = false;
      while (e && !used.has(e.id)) {
        const forward = e.a === node;
        used.add(e.id);
        seq.push({ e, forward });
        const next = forward ? e.b : e.a;
        if (next === start) { loop = true; break; }
        const tin = travelTangent(net, e, forward, true);
        let best = null, bestDot = -2;
        for (const x of adj.get(next) || []) {
          if (used.has(x.id)) continue;
          const tout = travelTangent(net, x, x.a === next, false);
          const d = tin[0] * tout[0] + tin[1] * tout[1];
          if (d > bestDot) { bestDot = d; best = x; }
        }
        node = next;
        e = best;
      }
      const route = makeRoute(net, seq, lateral, loop, routes.length);
      if (route && route.length >= MIN_LENGTH) routes.push(route);
    }
  }
  return routes;
}

// Walking direction (xz) of an edge at the end where the walk arrives (arriving=true) or leaves.
function travelTangent(net, edge, forward, arriving) {
  const c = net.centerline(edge), L = c.X.length - 1;
  const i = arriving ? (forward ? L : 0) : (forward ? 0 : L);
  const sgn = forward ? 1 : -1;
  return [c.TX[i] * sgn, c.TZ[i] * sgn];
}

function makeRoute(net, seq, lateral, loop, index) {
  const X = [], Y = [], Z = [], TX = [], TZ = [], B = [], S = [];
  const edges = [];
  let s = 0, speedSum = 0, speedN = 0;
  for (const { e, forward } of seq) {
    const c = net.centerline(e), n = c.X.length;
    const base = lateral(e, forward);
    speedSum += getProfile(e).speed || 40; speedN++;
    edges.push(e.id);
    for (let k = 0; k < n; k++) {
      if (k === 0 && X.length) continue;                 // shared joint sample
      const i = forward ? k : n - 1 - k;
      const x = c.X[i], z = c.Z[i];
      if (X.length) s += Math.hypot(x - X[X.length - 1], z - Z[Z.length - 1]);
      X.push(x); Y.push(c.Y[i]); Z.push(z);
      TX.push(forward ? c.TX[i] : -c.TX[i]); TZ.push(forward ? c.TZ[i] : -c.TZ[i]);
      B.push(forward ? base : -base);
      S.push(s);
    }
  }
  if (X.length < 2) return null;
  const Bs = smooth(B, SMOOTH_RADIUS);
  return {
    id: 'r' + index, X: Float64Array.from(X), Y: Float64Array.from(Y), Z: Float64Array.from(Z),
    TX: Float64Array.from(TX), TZ: Float64Array.from(TZ), B: Float64Array.from(Bs), S: Float64Array.from(S),
    length: s, loop, edges,
    speed: speedN ? speedSum / speedN : 40,        // km/h, mean of the edges' profile speeds
  };
}

function smooth(a, r) {
  const n = a.length, out = new Array(n);
  let acc = 0, lo = 0, hi = -1;
  for (let i = 0; i < n; i++) {
    const L = Math.max(0, i - r), H = Math.min(n - 1, i + r);
    while (hi < H) { hi++; acc += a[hi]; }
    while (lo < L) { acc -= a[lo]; lo++; }
    out[i] = acc / (H - L + 1);
  }
  return out;
}

// Sample a route at arc length s (clamped to its extent when not looping).
// Returns { x, y, z, tx, tz, b } where (tx, tz) is the walking direction.
export function sampleRoute(route, s, out = {}) {
  const S = route.S, n = S.length;
  let t = s;
  if (route.loop) { t = ((s % route.length) + route.length) % route.length; }
  t = Math.max(0, Math.min(route.length, t));
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m] <= t) lo = m; else hi = m; }
  const span = S[hi] - S[lo] || 1, f = (t - S[lo]) / span;
  const lerp = (A) => A[lo] + (A[hi] - A[lo]) * f;
  let tx = lerp(route.TX), tz = lerp(route.TZ);
  const l = Math.hypot(tx, tz) || 1;
  out.x = lerp(route.X); out.y = lerp(route.Y); out.z = lerp(route.Z);
  out.tx = tx / l; out.tz = tz / l; out.b = lerp(route.B);
  return out;
}
