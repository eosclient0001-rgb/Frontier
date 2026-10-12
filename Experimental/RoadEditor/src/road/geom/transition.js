// Lane-count transitions and angled merges at junction nodes.
//
// Taper (2 roads, end to end, different lane layouts): the two cross-sections are aligned lane by
// lane (dynamic programming over lane types, so a sidewalk meets a sidewalk and a travel lane meets
// a travel lane). A loft morphs one section into the other over the taper length: lanes that exist
// on one arm only grow from zero width (hatched, with a dashed lane-gain line), kerbs get vertical
// faces where their height changes, and lane lines run through the taper.
//
// Merge / diverge (3 roads, two near-opposite majors, one minor at an acute angle): the minor's
// lanes fan into a merge point on the major's kerb, the gore between the minor's inner traffic
// lane and the major's outer lane is hatched, and a dashed lane-add line continues down the major.
//
// Every triangle is oriented by an explicit "want" normal, so the pieces are visible from both
// sides regardless of the order the points are supplied in.
import { PAINT_LIFT, dashed } from './markings.js';
import { tri, quad } from './tri.js';

const STATIONS = 8;
const UP = [0, 1, 0];

// ------------------------------------------------------------------ primitives
// Horizontal strip along a world polyline [[x,y,z]] of width w (dash: skip alternate segments).
function ribbonAlong(out, mat, pts, w, dash = false) {
  for (let i = 0; i < pts.length - 1; i++) {
    if (dash && i % 2 === 1) continue;
    const a = pts[i], b = pts[i + 1];
    const dx = b[0] - a[0], dz = b[2] - a[2], l = Math.hypot(dx, dz) || 1;
    const nx = -dz / l * w / 2, nz = dx / l * w / 2;
    quad(out, mat,
      [a[0] - nx, a[1], a[2] - nz], [a[0] + nx, a[1], a[2] + nz],
      [b[0] + nx, b[1], b[2] + nz], [b[0] - nx, b[1], b[2] - nz], UP);
  }
}

// Vertical face between two absolute-height profiles over xz samples (ylo[i] ≤ yhi[i]).
function faceAlong(out, mat, xz, ylo, yhi, want) {
  for (let i = 0; i < xz.length - 1; i++) {
    const a = xz[i], b = xz[i + 1];
    quad(out, mat,
      [a[0], ylo[i], a[1]], [b[0], ylo[i + 1], b[1]],
      [b[0], yhi[i + 1], b[1]], [a[0], yhi[i], a[1]], want[i]);
  }
}

// ------------------------------------------------------------------ sections
// Cross-section of one arm at `dist` from the node. Lanes are described by λ, the lateral
// coordinate measured along R (a shared reference direction), so lanes from different arms can be
// compared directly. A point at λ on the section is centre + (λ·sg) along the section normal.
function section(E, dist, R) {
  const c = E.c, L = c.length;
  const s = Math.max(0, Math.min(L, E.atA ? dist : L - dist));
  const f = c.frameAt(s);
  const sg = Math.sign(f.nx * R[0] + f.nz * R[1]) || 1;
  const lanes = E.lay.lanes.map(l => {
    const a = l.o0 * sg, b = l.o1 * sg;
    return { type: l.type, traffic: !!l.meta.traffic, dir: l.dir, level: l.level, h: l.h, mat: l.mat, lo: Math.min(a, b), hi: Math.max(a, b) };
  }).sort((p, q) => (p.lo + p.hi) - (q.lo + q.hi));
  return { f, sg, lanes };
}
const xzAt = (sec, lam) => [sec.f.x + sec.f.nx * lam * sec.sg, sec.f.z + sec.f.nz * lam * sec.sg];
const pointAt = (sec, lam, h) => { const [x, z] = xzAt(sec, lam); return [x, sec.f.y + h, z]; };

// Global alignment of two lane lists (both ordered by λ). Pairs carry {a, b}; a null side means
// the lane does not exist on that arm.
function align(A, B) {
  const n = A.length, m = B.length, GAP = -1.5;
  const score = (a, b) => {
    if (a.type === b.type) return 3;
    if (a.traffic && b.traffic) return 1.5;
    if (a.level === b.level) return 1;
    return -1;
  };
  const M = Array.from({ length: n + 1 }, () => new Float64Array(m + 1));
  for (let i = 1; i <= n; i++) M[i][0] = i * GAP;
  for (let j = 1; j <= m; j++) M[0][j] = j * GAP;
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) {
    M[i][j] = Math.max(M[i - 1][j - 1] + score(A[i - 1], B[j - 1]), M[i - 1][j] + GAP, M[i][j - 1] + GAP);
  }
  const pairs = [];
  let i = n, j = m;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && M[i][j] === M[i - 1][j - 1] + score(A[i - 1], B[j - 1])) { pairs.push({ a: A[i - 1], b: B[j - 1] }); i--; j--; }
    else if (i > 0 && M[i][j] === M[i - 1][j] + GAP) { pairs.push({ a: A[i - 1], b: null }); i--; }
    else { pairs.push({ a: null, b: B[j - 1] }); j--; }
  }
  return pairs.reverse();
}

// λ boundaries of each pair on one arm. A missing lane collapses onto its neighbour's boundary,
// so consecutive pairs always share the boundary between them.
function bounds(pairs, key) {
  const K = pairs.length, lo = new Array(K), hi = new Array(K);
  const first = pairs.find(p => p[key]);
  let cur = first ? first[key].lo : 0;
  for (let k = 0; k < K; k++) {
    const l = pairs[k][key];
    if (l) { lo[k] = l.lo; hi[k] = l.hi; cur = l.hi; } else { lo[k] = cur; hi[k] = cur; }
  }
  return { lo, hi };
}

// Height of a pair on one arm; a missing lane follows its nearest real neighbour.
function heightOf(pairs, k, key) {
  if (pairs[k][key]) return pairs[k][key].h;
  for (let d = 1; d < pairs.length; d++) {
    if (k - d >= 0 && pairs[k - d][key]) return pairs[k - d][key].h;
    if (k + d < pairs.length && pairs[k + d][key]) return pairs[k + d][key].h;
  }
  return 0;
}

// ------------------------------------------------------------------ taper
export function buildTaper(out, J) {
  const [EA, EB] = J.ends;
  const R = [-EB.dz, EB.dx];                          // right-of-outward of the B arm
  const SA = section(EA, EA.setback, R), SB = section(EB, EB.setback, R);
  const pairs = align(SA.lanes, SB.lanes);
  const K = pairs.length;
  const bA = bounds(pairs, 'a'), bB = bounds(pairs, 'b');
  const hA = pairs.map((_, k) => heightOf(pairs, k, 'a'));
  const hB = pairs.map((_, k) => heightOf(pairs, k, 'b'));
  const U = Array.from({ length: STATIONS + 1 }, (_, i) => i / STATIONS);

  // morphed quantities at station u
  const hAt = (k, u) => hA[k] + (hB[k] - hA[k]) * u;
  const yAt = u => SA.f.y + (SB.f.y - SA.f.y) * u;
  const bxz = (side, k, u) => {
    const pa = xzAt(SA, side === 'lo' ? bA.lo[k] : bA.hi[k]);
    const pb = xzAt(SB, side === 'lo' ? bB.lo[k] : bB.hi[k]);
    return [pa[0] + (pb[0] - pa[0]) * u, pa[1] + (pb[1] - pa[1]) * u];
  };
  // boundary point (xz + absolute y at pair height)
  const bp = (side, k, u) => { const q = bxz(side, k, u); return [q[0], yAt(u) + hAt(k, u), q[1]]; };

  // --- lane surfaces
  for (let k = 0; k < K; k++) {
    const p = pairs[k];
    if (bA.hi[k] - bA.lo[k] < 0.02 && bB.hi[k] - bB.lo[k] < 0.02) continue;
    for (let i = 0; i < STATIONS; i++) {
      const u0 = U[i], u1 = U[i + 1], um = (u0 + u1) / 2;
      const mat = um < 0.5 ? (p.a ? p.a.mat : p.b.mat) : (p.b ? p.b.mat : p.a.mat);
      quad(out, mat, bp('lo', k, u0), bp('hi', k, u0), bp('hi', k, u1), bp('lo', k, u1), UP);
    }
    // a lane that exists on one arm only is hatched in paint (alternate stations)
    if ((!p.a || !p.b) && (p.a?.traffic || p.b?.traffic)) {
      for (let i = 1; i < STATIONS; i += 2) {
        const q = [bp('lo', k, U[i]), bp('hi', k, U[i]), bp('hi', k, U[i + 1]), bp('lo', k, U[i + 1])]
          .map(v => [v[0], v[1] + PAINT_LIFT, v[2]]);
        quad(out, 'markWhite', q[0], q[1], q[2], q[3], UP);
      }
    }
  }

  // --- kerbs: vertical faces where neighbouring pairs step in height, and at the outer edges
  for (let k = 1; k < K; k++) {
    if (Math.abs(hA[k - 1] - hA[k]) < 0.02 && Math.abs(hB[k - 1] - hB[k]) < 0.02) continue;
    const xz = U.map(u => bxz('lo', k, u));
    const ylo = U.map(u => yAt(u) + Math.min(hAt(k - 1, u), hAt(k, u)));
    const yhi = U.map(u => yAt(u) + Math.max(hAt(k - 1, u), hAt(k, u)));
    // the face is seen from the lower lane
    const want = U.map(u => {
      const lower = hAt(k - 1, u) < hAt(k, u) ? k - 1 : k;
      const cl = bxz('lo', lower, u), ch = bxz('hi', lower, u);
      const cen = [(cl[0] + ch[0]) / 2, (cl[1] + ch[1]) / 2];
      return [cen[0] - xz[U.indexOf(u)][0], 0, cen[1] - xz[U.indexOf(u)][1]];
    });
    faceAlong(out, 'curb', xz, ylo, yhi, want);
  }
  // outer edges (raised kerb at the outermost lane rising out of the ground)
  for (const [k, side] of [[0, 'lo'], [K - 1, 'hi']]) {
    if (hA[k] < 0.02 && hB[k] < 0.02) continue;
    const xz = U.map(u => bxz(side, k, u));
    const ylo = U.map(u => yAt(u) - 0.06);
    const yhi = U.map(u => yAt(u) + hAt(k, u));
    const want = U.map(u => {
      const q = bxz(side, k, u), c = bxz('lo', k, u), d = bxz('hi', k, u);
      const cen = [(c[0] + d[0]) / 2, (c[1] + d[1]) / 2];
      return [q[0] - cen[0], 0, q[1] - cen[1]];
    });
    faceAlong(out, 'curb', xz, ylo, yhi, want);
  }

  // --- lane lines through the taper: dashed between two traffic lanes, solid otherwise
  for (let k = 1; k < K; k++) {
    const L = pairs[k - 1], Rp = pairs[k];
    const tl = !!(L.a?.traffic || L.b?.traffic), tr = !!(Rp.a?.traffic || Rp.b?.traffic);
    if (!tl && !tr) continue;
    const pts = U.map(u => {
      const q = bxz('lo', k, u);
      return [q[0], yAt(u) + Math.max(hAt(k - 1, u), hAt(k, u)) + PAINT_LIFT, q[1]];
    });
    ribbonAlong(out, 'markWhite', pts, 0.12, tl && tr);
  }
}

// ------------------------------------------------------------------ merge / diverge
export function buildMerge(out, J) {
  const N = J.node;
  const M = J.ends.find(e => e.id === J.minorId);
  const P = J.ends.find(e => e.id === J.majorId);
  if (!M || !P) return;
  const D = [P.dx, P.dz], Rm = [-P.dz, P.dx];       // outward and right-of-outward of the major
  const side = Math.sign(M.dx * Rm[0] + M.dz * Rm[1]) || 1;   // which kerb the minor leaves from
  const curb = side > 0 ? P.wr : P.wl;
  const yN = P.c.frameAt(P.atA ? 0 : P.len).y;
  const at = (t, lat) => [N.x + D[0] * t + Rm[0] * lat, N.z + D[1] * t + Rm[1] * lat];
  const MP = at(1.5, side * curb);                  // merge point on the major's kerb
  const apex = [MP[0], yN, MP[1]];

  // Minor lanes fan into the merge point.
  const Ms = section(M, M.setback, Rm);
  for (const ln of Ms.lanes) {
    tri(out, ln.mat, pointAt(Ms, ln.lo, ln.h), pointAt(Ms, ln.hi, ln.h), apex, UP);
  }

  // Major's outer traffic lane line (on the minor's side), in right-of-outward coordinates.
  const rc = v => (P.atA ? v : -v);
  let outer = null;
  for (const l of P.lay.lanes.filter(l => l.meta.traffic)) {
    const lo = Math.min(rc(l.o0), rc(l.o1)), hi = Math.max(rc(l.o0), rc(l.o1));
    if (!outer || (side > 0 ? hi > outer.hi : lo < outer.lo)) outer = { lo, hi };
  }
  if (!outer) return;
  const laneLine = side > 0 ? outer.lo : outer.hi;

  // Gore: hatched fan between the minor's major-facing traffic lane and the major's lane line.
  const ordered = side > 0 ? Ms.lanes : Ms.lanes.slice().reverse();
  const first = ordered.find(l => l.traffic);
  if (first) {
    const far = side > 0 ? first.hi : first.lo;      // the minor lane boundary away from the major
    const G1 = xzAt(Ms, far), G2 = at(13.5, laneLine);
    const ax = [MP[0], yN + PAINT_LIFT, MP[1]];
    const STEPS = 4;
    for (let j = 0; j < STEPS; j += 2) {
      const p0 = [G1[0] + (G2[0] - G1[0]) * j / STEPS, yN + PAINT_LIFT, G1[1] + (G2[1] - G1[1]) * j / STEPS];
      const p1 = [G1[0] + (G2[0] - G1[0]) * (j + 1) / STEPS, yN + PAINT_LIFT, G1[1] + (G2[1] - G1[1]) * (j + 1) / STEPS];
      tri(out, 'markWhite', ax, p0, p1, UP);
    }
  }

  // Lane-add line continuing down the major's outer lane.
  const L = P.c.length, span = Math.min(30, L - 3);
  if (span > 2) {
    const s0 = P.atA ? 1.5 : L - 1.5 - span, s1 = P.atA ? 1.5 + span : L - 1.5;
    const o = P.atA ? laneLine : -laneLine;
    dashed(out, 'markWhite', P.c, s0, s1, o, 0.12, 4, 6, PAINT_LIFT);
  }
}

// Dispatch for junction kinds with their own geometry.
export function buildTransition(out, J) {
  if (J.kind === 'taper') buildTaper(out, J);
  else if (J.kind === 'merge') buildMerge(out, J);
}
