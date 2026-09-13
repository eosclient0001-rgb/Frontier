/*  Frontier · PlantGenerator · plant.js
 *  Procedural ferns, banana plants and palms as ONE watertight-joined mesh each.
 *
 *  Joining rule ("L, not |_"): a child part is never a separate shell dropped
 *  onto its parent. It is either
 *    • extruded out of a parent face  (the face is removed, its 4 corners become
 *      the first ring of the child tube), or
 *    • grown from a parent edge       (a blade strip's first row *is* two ring
 *      vertices of the stem it hangs on).
 *  So every plant is a single connected 2-manifold-ish surface with shared
 *  vertices — verified by Verification/plant_smoke.mjs (1 connected component).
 *
 *  No textures: colour is a per-vertex solid fill (flat colour per element).
 *  Units: metres, Y-up (game convention).  Pure geometry, no DOM — runs in Node.
 */
import * as THREE from './vendor/three.module.min.js';

/* ───────────────────────── utilities ───────────────────────── */
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  const r = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  r.range = (lo, hi) => lo + (hi - lo) * r();
  r.int = (lo, hi) => Math.floor(r.range(lo, hi + 1));
  r.sign = () => (r() < .5 ? -1 : 1);
  r.pick = (arr) => arr[Math.floor(r() * arr.length)];
  return r;
}
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const UP = V3(0, 1, 0);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const D2R = Math.PI / 180;
const GOLD = 137.507764 * D2R;

/** solid colour helpers – colours are [r,g,b] in 0..1 (linear-ish sRGB values) */
export const hex = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
export function shade(col, hueShift = 0, satMul = 1, lightMul = 1) {
  const c = new THREE.Color(col[0], col[1], col[2]); const hsl = {}; c.getHSL(hsl);
  c.setHSL((hsl.h + hueShift + 1) % 1, clamp(hsl.s * satMul, 0, 1), clamp(hsl.l * lightMul, 0, 1));
  return [c.r, c.g, c.b];
}

/* ───────────────────────── mesh builder ───────────────────────── */
class Tube {
  constructor(mb, rings, frames, sides, part) { this.mb = mb; this.rings = rings; this.frames = frames; this.sides = sides; this.skip = new Set(); this.part = part; }
  get length() { return this.rings.length; }
  /** Claim face (j,i) for extrusion: removes it from the shell, returns its corner ring. */
  face(j, i) {
    const A = this.rings[j], B = this.rings[j + 1]; const n = A.length;
    if (!B || B.length !== n) throw new Error('face(): ring counts differ');
    i = ((i % n) + n) % n; this.skip.add(j * 4096 + i);
    const ring = [A[i], A[(i + 1) % n], B[(i + 1) % n], B[i]];
    const P = ring.map(k => this.mb.p(k));
    const center = P[0].clone().add(P[1]).add(P[2]).add(P[3]).multiplyScalar(.25);
    const normal = P[1].clone().sub(P[0]).cross(P[3].clone().sub(P[0])).normalize();
    return { ring, center, normal };
  }
  /** Ring edge on the +B (sign=+1) or −B (sign=−1) side at station j: [idxA, idxB] plus their midpoint. */
  sideEdge(j, sign) {
    const R = this.rings[j], f = this.frames[j], n = R.length; let best = -Infinity, bi = 0;
    for (let i = 0; i < n; i++) {
      const m = this.mb.p(R[i]).add(this.mb.p(R[(i + 1) % n])).multiplyScalar(.5).sub(f.p);
      const d = m.dot(f.B) * sign; if (d > best) { best = d; bi = i; }
    }
    const a = R[bi], b = R[(bi + 1) % n];
    return { a, b, mid: this.mb.p(a).add(this.mb.p(b)).multiplyScalar(.5) };
  }
  emit() {
    const mb = this.mb;
    for (let j = 0; j < this.rings.length - 1; j++) {
      const A = this.rings[j], B = this.rings[j + 1];
      if (A.length !== B.length || B.length === 1 || A.length === 1) { mb.bridge(A, B, true); continue; }
      const n = A.length;
      for (let i = 0; i < n; i++) {
        if (this.skip.has(j * 4096 + i)) continue;
        const i1 = (i + 1) % n;
        mb.tri(A[i], A[i1], B[i]); mb.tri(A[i1], B[i1], B[i]);
      }
    }
  }
}

export class MeshBuilder {
  constructor() { this.pos = []; this.col = []; this.idx = []; this.tubes = []; this.parts = {}; this.curPart = 'body'; }
  part(name) { this.curPart = name; return this; }
  v(p, c) {
    const i = this.pos.length / 3;
    this.pos.push(p.x, p.y, p.z); this.col.push(c[0], c[1], c[2]);
    this.parts[this.curPart] = (this.parts[this.curPart] || 0) + 1;
    return i;
  }
  p(i) { return V3(this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]); }
  tri(a, b, c) { if (a === b || b === c || a === c) return; this.idx.push(a, b, c); }
  /** Bridge two vertex rows/rings with possibly different counts (fan when one side is a single vertex). */
  bridge(A, B, closed = false) {
    const n = A.length, m = B.length;
    if (m === 1) { const e = closed ? n : n - 1; for (let i = 0; i < e; i++) this.tri(A[i], A[(i + 1) % n], B[0]); return; }
    if (n === 1) { const e = closed ? m : m - 1; for (let i = 0; i < e; i++) this.tri(B[(i + 1) % m], B[i], A[0]); return; }
    const sa = closed ? n : n - 1, sb = closed ? m : m - 1;
    let ia = 0, ib = 0;
    while (ia < sa || ib < sb) {
      const advA = ib >= sb || (ia < sa && (ia + 1) / sa <= (ib + 1) / sb);
      if (advA) { this.tri(A[ia % n], A[(ia + 1) % n], B[ib % m]); ia++; }
      else { this.tri(A[ia % n], B[(ib + 1) % m], B[ib % m]); ib++; }
    }
  }
  /** Bridge a list of open rows in sequence (a blade / strip). */
  strip(rows) { for (let i = 0; i < rows.length - 1; i++) this.bridge(rows[i], rows[i + 1], false); }

  /**
   * Generalised tube / lathe.
   * path: [{p:Vector3, r:number}] ring centres + radii (r=0 → the ring collapses to a single vertex = cap).
   * opts: {sides, color, colorAt(j)→color, start:{ring:[idx], center}, up:Vector3 (frame hint), theta0}
   */
  tube(path, opts) {
    const sides = opts.sides || 6, colorAt = opts.colorAt || (() => opts.color);
    const full = opts.start ? [{ p: opts.start.center, r: 0 }, ...path] : path;
    const frames = computeFrames(full.map(s => s.p), opts.up || UP);
    const rings = []; let theta0 = opts.theta0 ?? 0;
    if (opts.start) {
      // order the seed ring CCW about the outgoing direction so it bridges cleanly
      const f = frames[0];
      const ordered = opts.start.ring.map(k => { const d = this.p(k).sub(f.p); return { k, a: Math.atan2(d.dot(f.B), d.dot(f.N)) }; }).sort((x, y) => x.a - y.a);
      rings.push(ordered.map(o => o.k)); theta0 = ordered[0].a;
    } else rings.push(ringAt(this, full[0], frames[0], sides, theta0, colorAt(0)));
    for (let j = 1; j < full.length; j++) rings.push(ringAt(this, full[j], frames[j], sides, theta0, colorAt(j)));
    const t = new Tube(this, rings, frames, sides, this.curPart); this.tubes.push(t); return t;
  }
  build() {
    for (const t of this.tubes) t.emit();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setIndex(this.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeVertexNormals(); g.computeBoundingBox();
    return g;
  }
}
function ringAt(mb, s, f, sides, theta0, color) {
  if (s.r <= 1e-6) return [mb.v(s.p, color)];
  const out = [];
  for (let k = 0; k < sides; k++) {
    const th = theta0 + k * 2 * Math.PI / sides;
    out.push(mb.v(f.p.clone().addScaledVector(f.N, Math.cos(th) * s.r).addScaledVector(f.B, Math.sin(th) * s.r), color));
  }
  return out;
}
/** parallel-transport frames; (N,B,T) right-handed so angle N→B is CCW about T */
function computeFrames(pts, up) {
  const n = pts.length, out = [];
  for (let i = 0; i < n; i++) {
    const T = (i < n - 1 ? pts[i + 1].clone().sub(pts[i]) : pts[i].clone().sub(pts[i - 1]));
    if (T.lengthSq() < 1e-12) T.copy(i > 0 ? out[i - 1].T : UP); T.normalize();
    let N;
    if (i === 0) { N = up.clone().addScaledVector(T, -up.dot(T)); if (N.lengthSq() < 1e-6) N = V3(1, 0, 0).addScaledVector(T, -T.x); N.normalize(); }
    else { N = out[i - 1].N.clone().addScaledVector(T, -out[i - 1].N.dot(T)); if (N.lengthSq() < 1e-8) N = out[i - 1].B.clone().cross(T); N.normalize(); }
    const B = T.clone().cross(N).normalize();
    out.push({ p: pts[i].clone(), T, N, B });
  }
  return out;
}
/** gravity arc: start c, unit direction d, length L, droop (0..2) — returns nStations+1 points */
function arcPath(c, d, L, droop, n, extraBend = 0) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = c.clone().addScaledVector(d, L * t).addScaledVector(UP, -droop * L * t * t * .5 - extraBend * L * t * t * t);
    pts.push(p);
  }
  return pts;
}
const dirFrom = (az, el) => V3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));

/* ───────────────────────── species: PALM (Cocos nucifera) ───────────────────────── */
export const PALETTE = {
  palm: { trunk: '#8f8272', scar: '#776a5c', sheath: '#6f5b40', rachis: '#b6b64f', frond: '#3d7d2f', frondYoung: '#6fa93c', dead: '#8c6a3c', coconut: '#9cb34a', spear: '#b9c65b' },
  banana: { stem: '#aab86e', stemOld: '#8f8a5a', petiole: '#a5c355', midrib: '#d3d878', leaf: '#4f9c2c', leafYoung: '#7dc043', leafOld: '#7f9a3b', cigar: '#b7d36a', peduncle: '#6d8a3a', fruit: '#86b449', bud: '#7a2c4d' },
  fern: { crown: '#3d2f22', stipe: '#4d3a2b', rachis: '#5d7a33', frond: '#2f7d2c', frondYoung: '#5fae3f', crozier: '#7aa84c' },
};

function genPalm(P, rnd, mb) {
  const C = PALETTE.palm; const hue = (P.hue || 0) * .06;
  const colTrunk = hex(C.trunk), colScar = hex(C.scar);
  const H = P.height, R = P.trunkRadius, sides = 12;
  const leanAz = rnd.range(0, Math.PI * 2), lean = P.lean, wob = rnd.range(0, 6.28);
  // ── trunk
  const path = []; const scarStep = .17; const nR = Math.max(24, Math.round(H / scarStep));
  const crownRings = 5, crownH = .55;
  const trunkH = H - crownH;
  for (let j = 0; j <= nR; j++) {
    const t = j / nR, y = t * trunkH;
    const sx = Math.sin(t * 5.1 + wob) * .06 * H * t, sz = Math.cos(t * 3.7 + wob) * .04 * H * t;
    const p = V3(Math.cos(leanAz) * (lean * H * t * t) + sx, y, Math.sin(leanAz) * (lean * H * t * t) + sz);
    const bulge = 1 + .55 * Math.exp(-y / .45);
    const scar = (j % 2 === 0 ? 1.04 : .965);
    path.push({ p, r: R * (1 - .22 * t) * bulge * scar });
  }
  const top = path[path.length - 1].p.clone(), topR = path[path.length - 1].r;
  const dirTop = top.clone().sub(path[path.length - 3].p).normalize();
  for (let j = 1; j <= crownRings; j++) {
    const t = j / crownRings;
    path.push({ p: top.clone().addScaledVector(dirTop, crownH * t), r: topR * (1.05 + .25 * Math.sin(t * Math.PI)) });
  }
  mb.part('trunk');
  const trunk = mb.tube(path, { sides, colorAt: (j) => j <= nR ? (j % 2 === 0 ? colScar : colTrunk) : hex(C.sheath) });
  const j0 = nR; // first crown ring index
  // ── spear (unopened central leaf) closes the top
  mb.part('spear');
  const spearTop = path[path.length - 1].p; const spearDir = dirTop.clone().addScaledVector(UP, .6).normalize();
  const spear = [];
  for (let k = 1; k <= 6; k++) { const t = k / 6; spear.push({ p: spearTop.clone().addScaledVector(spearDir, P.frondLength * .45 * t), r: topR * .85 * (1 - t) * (1 - t) * (k === 6 ? 0 : 1) }); }
  mb.tube(spear, { sides, start: { ring: trunk.rings[trunk.length - 1], center: spearTop }, color: hex(C.spear) });

  // ── fronds
  const N = Math.round(P.fronds), perRing = Math.ceil((N + P.coconuts) / crownRings);
  const used = new Set(); const facesInfo = [];
  const pickFace = (ring, slot) => { for (let k = 0; k < sides; k++) { const s = (slot + (k % 2 ? -(k + 1) / 2 : k / 2) + sides * 3) % sides; const key = ring * 64 + s; if (!used.has(key)) { used.add(key); return s; } } return null; };
  const dead = Math.round(P.deadFronds);
  const segs = Math.round(lerp(14, 26, P.detail)), leafletsPerStation = 1;
  for (let i = 0; i < N; i++) {
    const age = i / (N - 1);                       // 0 oldest (bottom), 1 youngest (top)
    const ring = j0 + Math.min(crownRings - 1, Math.floor(i / perRing));
    const az = i * GOLD + rnd.range(-.15, .15);
    const slot = pickFace(ring, Math.round(az / (2 * Math.PI / sides)));
    if (slot === null) continue;
    const f = trunk.face(ring, slot);
    const isDead = i < dead;
    const el = isDead ? rnd.range(-85, -70) * D2R : lerp(-48, 78, Math.pow(age, 1.15)) * D2R + rnd.range(-7, 7) * D2R;
    const faceAz = Math.atan2(f.normal.z, f.normal.x);
    const d = dirFrom(faceAz + rnd.range(-.25, .25), el);
    const L = P.frondLength * (isDead ? .8 : rnd.range(.85, 1.1)) * (age > .9 ? .7 : 1);
    const droop = isDead ? .2 : P.droop * lerp(1.1, .55, age);
    const pts = arcPath(f.center, d, L, droop, segs);
    const rPet = R * .32;
    const stations = pts.slice(1).map((p, k) => ({ p, r: rPet * (1 - .92 * (k + 1) / segs) + .006 }));
    stations[stations.length - 1].r = 0;
    const colR = isDead ? hex(C.dead) : shade(hex(C.rachis), hue, 1, rnd.range(.9, 1.1));
    const colF = isDead ? shade(hex(C.dead), rnd.range(-.02, .02), 1, rnd.range(.85, 1.1)) : shade(age > .82 ? hex(C.frondYoung) : hex(C.frond), hue + rnd.range(-.015, .015), 1, rnd.range(.9, 1.08));
    mb.part(isDead ? 'deadFrond' : 'frond');
    const rach = mb.tube(stations, { sides: 4, start: { ring: f.ring, center: f.center }, color: colR });
    // leaflets: from ~22% of the rachis to the tip, both sides, hanging (coconut leaflets droop)
    const first = Math.round(rach.length * .22);
    for (let j = first; j < rach.length - 1; j++) {
      const u = (j - first) / (rach.length - 1 - first);
      const ll = P.leafletLength * Math.pow(Math.sin(Math.PI * (0.08 + .84 * u)), .6) * (isDead ? .8 : 1);
      const fr = rach.frames[j];
      const perStation = Math.round(lerp(3, 5, P.detail));
      const segLen = rach.frames[j + 1].p.distanceTo(fr.p);
      for (const sgn of [1, -1]) for (let q = 0; q < perStation; q++) {
        const e = rach.sideEdge(j, sgn);
        const side = fr.B.clone().multiplyScalar(sgn);
        const fwd = fr.T.clone();
        const along = (q + .5) / perStation * segLen;
        const jitter = rnd.range(-.08, .08);
        const dir0 = side.clone().multiplyScalar(Math.cos((34 + jitter * 60) * D2R)).addScaledVector(fwd, Math.sin((34 + jitter * 60) * D2R)).normalize();
        const w0 = clamp(.03 * ll / .8, .016, .045);
        // the strip's root row is the shared rachis edge; the next row is placed a little along the segment so
        // successive leaflets fan out from the same edge without overlapping
        const root = e.mid.clone().addScaledVector(fwd, along);
        const rows = [[e.a, e.b]];
        const sag = (isDead ? 1.4 : lerp(.9, 1.6, u) * .9) * rnd.range(.85, 1.15);
        const nCol = 4;
        for (let c = 1; c <= nCol; c++) {
          const s = c / nCol;
          const pt = root.clone().addScaledVector(dir0, ll * s).addScaledVector(UP, ll * (.18 * s - sag * s * s * .55));
          const w = w0 * (1 - Math.pow(s, 2.2)) + .0005;
          const across = fwd.clone(); const fold = dir0.clone().cross(across).normalize();
          if (c === nCol) rows.push([mb.v(pt, colF)]);
          else rows.push([mb.v(pt.clone().addScaledVector(across, -w), colF), mb.v(pt.clone().addScaledVector(fold, w * .55), colF), mb.v(pt.clone().addScaledVector(across, w), colF)]);
        }
        mb.strip(rows);
      }
    }
    facesInfo.push(ring);
  }
  // ── coconut clusters (stalk from a crown face, nuts extruded from stalk faces)
  for (let c = 0; c < Math.round(P.coconuts); c++) {
    const ring = j0 + (c % 2); const slot = pickFace(ring, Math.round(rnd.range(0, sides)));
    if (slot === null) break;
    const f = trunk.face(ring, slot);
    mb.part('coconut');
    const d = f.normal.clone().addScaledVector(UP, -.35).normalize();
    const stalk = mb.tube([1, 2, 3, 4].map(k => ({ p: f.center.clone().addScaledVector(d, .09 * k).addScaledVector(UP, -.02 * k * k), r: .035 })), { sides: 4, start: { ring: f.ring, center: f.center }, color: hex(C.sheath) });
    const nuts = rnd.int(4, 8);
    for (let n = 0; n < nuts; n++) {
      const jj = 1 + (n % 3), ii = Math.floor(n / 3) + (n % 2);
      if (jj >= stalk.length - 1) break;
      let ff; try { ff = stalk.face(jj, ii); } catch { continue; }
      const nd = ff.normal.clone().addScaledVector(UP, -.9).normalize();
      const len = rnd.range(.22, .3), rad = len * .45;
      const prof = [[.08, .55], [.28, .95], [.55, 1], [.8, .72], [1, 0]];
      mb.tube(prof.map(([t, r]) => ({ p: ff.center.clone().addScaledVector(nd, len * t), r: rad * r })), { sides: 8, start: { ring: ff.ring, center: ff.center }, color: shade(hex(C.coconut), rnd.range(-.03, .03), 1, rnd.range(.9, 1.1)) });
    }
  }
  return { latin: 'Cocos nucifera', common: 'Coconut palm' };
}

/* ───────────────────────── species: BANANA (Musa) ───────────────────────── */
function genBanana(P, rnd, mb) {
  const C = PALETTE.banana; const hue = (P.hue || 0) * .06;
  const H = P.height, R = P.stemRadius, sides = 10;
  const leanAz = rnd.range(0, 6.28);
  const path = []; const nR = Math.max(10, Math.round(H / .16)); const crownRings = 4, crownH = .5;
  for (let j = 0; j <= nR; j++) {
    const t = j / nR; const y = t * (H - crownH);
    const p = V3(Math.cos(leanAz) * P.lean * H * t * t, y, Math.sin(leanAz) * P.lean * H * t * t);
    path.push({ p, r: R * (1 - .35 * t) * (1 + .25 * Math.exp(-y / .3)) });
  }
  const top = path[nR].p.clone(); const topR = path[nR].r; const dirTop = top.clone().sub(path[nR - 2].p).normalize();
  for (let j = 1; j <= crownRings; j++) path.push({ p: top.clone().addScaledVector(dirTop, crownH * j / crownRings), r: topR * (1 - .08 * j / crownRings) });
  mb.part('pseudostem');
  const stem = mb.tube(path, { sides, colorAt: (j) => shade(hex(C.stem), hue, 1, j < nR * .4 ? .9 : 1) });
  // cigar leaf (rolled new leaf) closes the top
  mb.part('cigar');
  const cig = []; const cigDir = dirTop.clone().addScaledVector(UP, .8).normalize();
  for (let k = 1; k <= 6; k++) { const t = k / 6; cig.push({ p: path[path.length - 1].p.clone().addScaledVector(cigDir, P.leafLength * .55 * t), r: k === 6 ? 0 : topR * (.55 * (1 - t) + .12) }); }
  mb.tube(cig, { sides, start: { ring: stem.rings[stem.length - 1], center: path[path.length - 1].p }, color: hex(C.cigar) });

  const used = new Set(); const j0 = nR;
  const pickFace = (ring, slot) => { for (let k = 0; k < sides; k++) { const s = (slot + (k % 2 ? -(k + 1) / 2 : k / 2) + sides * 3) % sides; const key = ring * 64 + s; if (!used.has(key)) { used.add(key); return s; } } return null; };
  const N = Math.round(P.leaves); const perRing = Math.ceil((N + 1) / crownRings);
  const segs = Math.round(lerp(14, 26, P.detail)), across = Math.round(lerp(3, 5, P.detail));
  for (let i = 0; i < N; i++) {
    const age = i / Math.max(1, N - 1);
    const ring = j0 + Math.min(crownRings - 1, Math.floor(i / perRing));
    const az = i * GOLD + rnd.range(-.2, .2);
    const slot = pickFace(ring, Math.round(az / (2 * Math.PI / sides)));
    if (slot === null) continue;
    const f = stem.face(ring, slot);
    const faceAz = Math.atan2(f.normal.z, f.normal.x);
    const el = lerp(5, 62, Math.pow(age, .9)) * D2R + rnd.range(-6, 6) * D2R;
    const d = dirFrom(faceAz + rnd.range(-.2, .2), el);
    const petL = lerp(.45, .8, rnd()) * (H / 3), Llam = P.leafLength * rnd.range(.85, 1.1) * (age > .9 ? .75 : 1);
    const droop = P.droop * lerp(1.3, .5, age);
    const nPet = 4;
    const pts = arcPath(f.center, d, petL + Llam, droop, nPet + segs, .15 * P.droop);
    const stations = pts.slice(1).map((p, k) => ({ p, r: k < nPet ? R * .22 : R * .22 * (1 - .8 * (k - nPet) / segs) }));
    stations[stations.length - 1].r = 0;
    const colPet = shade(hex(C.petiole), hue, 1, rnd.range(.92, 1.06));
    const colMid = shade(hex(C.midrib), hue, 1, 1);
    const base = age > .85 ? hex(C.leafYoung) : age < .25 ? hex(C.leafOld) : hex(C.leaf);
    const colLeaf = shade(base, hue + rnd.range(-.012, .012), 1, rnd.range(.92, 1.08));
    mb.part('leaf');
    const mid = mb.tube(stations, { sides: 4, start: { ring: f.ring, center: f.center }, colorAt: (j) => (j <= nPet ? colPet : colMid) });
    const W = P.leafWidth * rnd.range(.9, 1.1);
    const tear = P.tear * lerp(1.25, .25, age);
    for (const sgn of [1, -1]) {
      const asym = sgn > 0 ? 0 : .06;                       // banana laminae are offset at the base
      let cols = [];                                        // each: {k, row}
      let prevRow = null;
      const rowAt = (j, dAng, dTw) => {
        const u = (j - nPet) / segs; const fr = mid.frames[j];
        const e = mid.sideEdge(j, sgn);
        const uu = clamp((u - asym) / (1 - asym), 0, 1);
        let hw = W * .5 * (uu < .22 ? lerp(.3, 1, smooth(uu / .22)) : uu < .72 ? 1 : Math.sqrt(Math.max(0, 1 - Math.pow((uu - .72) / .28, 2))));
        if (uu <= 0) hw = W * .05;
        const side = fr.B.clone().multiplyScalar(sgn);
        // lamina plane: 'side' (perpendicular to midrib) × world-up projected, so leaves lie flat regardless of pitch
        const upL = UP.clone().addScaledVector(side, -UP.dot(side)); if (upL.lengthSq() < 1e-6) upL.copy(fr.N); upL.normalize();
        const rise = 8 * D2R, droopA = lerp(18, 42, P.droop) * D2R * lerp(.5, 1.4, uu) + dAng;
        const row = [e.a];
        for (let a = 1; a <= across; a++) {
          const s = a / across, r = hw * s;
          const ang = rise - droopA * s * s;
          const p = e.mid.clone().addScaledVector(side, r * Math.cos(ang)).addScaledVector(upL, r * Math.sin(ang)).addScaledVector(fr.T, dTw * s);
          row.push(mb.v(p, colLeaf));
        }
        return row;
      };
      for (let j = nPet; j < mid.length - 1; j++) {
        const u = (j - nPet) / segs;
        const row = rowAt(j, 0, 0);
        if (prevRow) mb.strip([prevRow, row]);
        prevRow = row;
        const tearHere = j > nPet + 1 && j < mid.length - 3 && rnd() < tear * (0.12 + .5 * u);
        if (tearHere) prevRow = rowAt(j, rnd.range(-.12, .35), rnd.range(-.03, .03));
      }
      mb.bridge(prevRow, [mid.rings[mid.length - 1][0]], false);
    }
  }
  // fruit bunch
  if (P.fruit > .5) {
    const slot = pickFace(j0 + crownRings - 1, rnd.int(0, sides - 1));
    if (slot !== null) {
      const f = stem.face(j0 + crownRings - 1, slot);
      mb.part('fruit');
      const d0 = f.normal.clone().addScaledVector(UP, .5).normalize();
      const pts = arcPath(f.center, d0, 1.1 * (H / 3), 2.4, 10);
      const ped = mb.tube(pts.slice(1).map((p) => ({ p, r: R * .16 })), { sides: 4, start: { ring: f.ring, center: f.center }, color: hex(C.peduncle) });
      for (let j = 2; j < ped.length - 3; j++) {
        for (let i = 0; i < 4; i++) {
          let ff; try { ff = ped.face(j, i); } catch { continue; }
          const dn = ff.normal.clone().addScaledVector(UP, .2).normalize();
          const len = rnd.range(.15, .21), rad = .022;
          const prof = [[.1, .75], [.35, 1], [.7, 1], [.92, .7], [1, 0]];
          mb.tube(prof.map(([t, r]) => ({ p: ff.center.clone().addScaledVector(dn, len * t).addScaledVector(UP, len * t * t * .9), r: rad * r })), { sides: 6, start: { ring: ff.ring, center: ff.center }, color: shade(hex(C.fruit), 0, 1, rnd.range(.92, 1.08)) });
        }
      }
      // bud
      const end = ped.rings[ped.length - 1], ec = ped.frames[ped.length - 1].p; const bd = V3(0, -1, 0);
      const bud = [[.15, 2.2], [.45, 3.2], [.8, 2.1], [1, 0]].map(([t, r]) => ({ p: ec.clone().addScaledVector(bd, .28 * t), r: R * .16 * r }));
      mb.tube(bud, { sides: 8, start: { ring: end, center: ec }, color: hex(C.bud) });
    }
  }
  return { latin: 'Musa × paradisiaca', common: 'Banana plant' };
}

/* ───────────────────────── species: FERN (Dryopteris) ───────────────────────── */
function genFern(P, rnd, mb) {
  const C = PALETTE.fern; const hue = (P.hue || 0) * .06;
  const sides = 10, crownRings = 4; const cr = lerp(.035, .07, P.frondLength / 1.3);
  mb.part('crown');
  const prof = [[-.03, 0], [0, .8], [.02, 1], [.04, .9], [.06, .6], [.075, 0]];
  const crown = mb.tube(prof.map(([y, r]) => ({ p: V3(0, y, 0), r: cr * r })), { sides, color: hex(C.crown) });
  const used = new Set();
  const pickFace = (ring, slot) => { for (let k = 0; k < sides; k++) { const s = (slot + (k % 2 ? -(k + 1) / 2 : k / 2) + sides * 3) % sides; const key = ring * 64 + s; if (!used.has(key)) { used.add(key); return s; } } return null; };
  const N = Math.round(P.fronds), pairs = Math.round(P.pinnaPairs * lerp(.6, 1, P.detail)), pinn = Math.round(P.pinnules * lerp(.6, 1, P.detail));
  const perRing = Math.ceil(N / (crownRings - 1));
  for (let i = 0; i < N; i++) {
    const age = i / Math.max(1, N - 1);                 // outer/older first
    const ring = 1 + Math.min(crownRings - 2, Math.floor(i / perRing));
    const az = i * GOLD + rnd.range(-.2, .2);
    const slot = pickFace(ring, Math.round(az / (2 * Math.PI / sides)));
    if (slot === null) continue;
    const f = crown.face(ring, slot);
    const faceAz = Math.atan2(f.normal.z, f.normal.x);
    const el = (P.spread + lerp(0, 40, age)) * D2R + rnd.range(-8, 8) * D2R;
    const d = dirFrom(faceAz + rnd.range(-.25, .25), el);
    const L = P.frondLength * rnd.range(.8, 1.1) * (age > .9 ? .6 : 1);
    const stations = pairs + 6;
    const pts = arcPath(f.center, d, L, P.arch * lerp(1.2, .7, age), stations, P.curl * .35);
    const stipe = 5;
    const st = pts.slice(1).map((p, k) => ({ p, r: cr * .09 * (1 - .85 * k / stations) + .0015 }));
    st[st.length - 1].r = 0;
    const colSt = hex(C.stipe), colRa = shade(hex(C.rachis), hue, 1, 1);
    const colF = shade(age > .85 ? hex(C.frondYoung) : hex(C.frond), hue + rnd.range(-.015, .015), 1, rnd.range(.9, 1.1));
    mb.part('frond');
    const rach = mb.tube(st, { sides: 4, start: { ring: f.ring, center: f.center }, colorAt: (j) => (j <= stipe ? colSt : colRa) });
    for (let j = stipe; j < rach.length - 1; j++) {
      const u = (j - stipe) / (rach.length - 1 - stipe);
      const shape = u < .35 ? lerp(.42, 1, smooth(u / .35)) : Math.pow(1 - (u - .35) / .65, .85);
      const pl = L * .21 * shape + .01;
      const fr = rach.frames[j];
      for (const sgn of [1, -1]) {
        if (sgn < 0 && j === stipe) continue;            // alternate pinnae slightly
        const e = rach.sideEdge(j, sgn);
        const side = fr.B.clone().multiplyScalar(sgn);
        const dir0 = side.clone().multiplyScalar(Math.cos(22 * D2R)).addScaledVector(fr.T, Math.sin(22 * D2R)).addScaledVector(fr.N, .18).normalize();
        const acr = fr.T.clone();
        const pw = pl * .24;                              // pinna half-width at its widest
        const rows = [[e.a, e.b]];
        const nP = Math.max(4, Math.round(pinn * shape));
        for (let q = 0; q < nP; q++) {
          for (const [dv, wf] of [[.3, 1], [.8, .55]]) {
            const v = (q + dv) / nP;
            const taper = Math.pow(1 - v, .7) * (v < .12 ? lerp(.7, 1, v / .12) : 1);
            const w = pw * wf * taper + .0008;
            const pt = e.mid.clone().addScaledVector(dir0, pl * v).addScaledVector(UP, -pl * v * v * .35 * P.arch);
            rows.push([mb.v(pt.clone().addScaledVector(acr, -w), colF), mb.v(pt.clone().addScaledVector(fr.N, w * .25), colF), mb.v(pt.clone().addScaledVector(acr, w), colF)]);
          }
        }
        rows.push([mb.v(e.mid.clone().addScaledVector(dir0, pl).addScaledVector(UP, -pl * .35 * P.arch), colF)]);
        mb.strip(rows);
      }
    }
  }
  // croziers (fiddleheads) from the top crown ring
  mb.part('crozier');
  for (let c = 0; c < 3; c++) {
    const slot = pickFace(crownRings - 1, rnd.int(0, sides - 1)); if (slot === null) break;
    const f = crown.face(crownRings - 1, slot);
    const h = P.frondLength * rnd.range(.18, .3); const pts = [];
    const az = Math.atan2(f.normal.z, f.normal.x);
    for (let k = 1; k <= 12; k++) { const t = k / 12; const spiral = Math.max(0, t - .6) / .4 * Math.PI * 1.6; const r = .05 * h; pts.push({ p: f.center.clone().addScaledVector(UP, h * Math.min(t, .6) / .6 + r * Math.sin(spiral) + (t > .6 ? r * .3 : 0)).addScaledVector(dirFrom(az, 0), h * .25 * t + r * (1 - Math.cos(spiral))), r: k === 12 ? 0 : cr * .12 * (1 - .5 * t) }); }
    mb.tube(pts, { sides: 5, start: { ring: f.ring, center: f.center }, color: hex(C.crozier) });
  }
  return { latin: 'Dryopteris filix-mas', common: 'Wood fern' };
}

/* ───────────────────────── schema / api ───────────────────────── */
export const SPECIES = {
  palm: {
    label: 'Palm', accent: '#e5d33a', gen: genPalm,
    params: [
      { key: 'height', label: 'Height', min: 5, max: 15, step: .1, unit: 'm', rnd: [6, 13] },
      { key: 'trunkRadius', label: 'Trunk radius', min: .14, max: .34, step: .005, unit: 'm', rnd: [.17, .3] },
      { key: 'lean', label: 'Lean', min: 0, max: .4, step: .01, rnd: [0, .3] },
      { key: 'fronds', label: 'Fronds', min: 16, max: 36, step: 1, rnd: [22, 32] },
      { key: 'frondLength', label: 'Frond length', min: 2.5, max: 6, step: .1, unit: 'm', rnd: [3.6, 5.2] },
      { key: 'leafletLength', label: 'Leaflet length', min: .4, max: 1.2, step: .02, unit: 'm', rnd: [.6, 1] },
      { key: 'droop', label: 'Droop', min: .2, max: 1.2, step: .02, rnd: [.5, 1] },
      { key: 'coconuts', label: 'Coconut clusters', min: 0, max: 3, step: 1, rnd: [0, 3] },
      { key: 'deadFronds', label: 'Dead fronds', min: 0, max: 5, step: 1, rnd: [0, 4] },
      { key: 'hue', label: 'Hue shift', min: -1, max: 1, step: .05, rnd: [-.6, .6] },
      { key: 'detail', label: 'Detail', min: .3, max: 1, step: .05, rnd: [.7, .9] },
    ],
  },
  banana: {
    label: 'Banana', accent: '#34c759', gen: genBanana,
    params: [
      { key: 'height', label: 'Height', min: 1.8, max: 5, step: .1, unit: 'm', rnd: [2.2, 4.3] },
      { key: 'stemRadius', label: 'Stem radius', min: .1, max: .3, step: .005, unit: 'm', rnd: [.13, .25] },
      { key: 'lean', label: 'Lean', min: 0, max: .3, step: .01, rnd: [0, .2] },
      { key: 'leaves', label: 'Leaves', min: 5, max: 13, step: 1, rnd: [7, 12] },
      { key: 'leafLength', label: 'Leaf length', min: 1.2, max: 3, step: .05, unit: 'm', rnd: [1.6, 2.6] },
      { key: 'leafWidth', label: 'Leaf width', min: .4, max: 1, step: .02, unit: 'm', rnd: [.5, .85] },
      { key: 'tear', label: 'Wind tearing', min: 0, max: 1, step: .05, rnd: [.15, .9] },
      { key: 'droop', label: 'Droop', min: .1, max: 1, step: .02, rnd: [.3, .9] },
      { key: 'fruit', label: 'Fruit bunch', min: 0, max: 1, step: 1, rnd: [0, 1] },
      { key: 'hue', label: 'Hue shift', min: -1, max: 1, step: .05, rnd: [-.6, .6] },
      { key: 'detail', label: 'Detail', min: .3, max: 1, step: .05, rnd: [.7, .9] },
    ],
  },
  fern: {
    label: 'Fern', accent: '#4fd8e0', gen: genFern,
    params: [
      { key: 'fronds', label: 'Fronds', min: 5, max: 22, step: 1, rnd: [8, 18] },
      { key: 'frondLength', label: 'Frond length', min: .4, max: 1.4, step: .02, unit: 'm', rnd: [.55, 1.2] },
      { key: 'arch', label: 'Arch', min: .1, max: 1.2, step: .02, rnd: [.35, 1] },
      { key: 'spread', label: 'Base elevation', min: 10, max: 70, step: 1, unit: '°', rnd: [20, 50] },
      { key: 'pinnaPairs', label: 'Pinna pairs', min: 10, max: 34, step: 1, rnd: [16, 28] },
      { key: 'pinnules', label: 'Pinnules / pinna', min: 5, max: 16, step: 1, rnd: [7, 13] },
      { key: 'curl', label: 'Tip curl', min: 0, max: 1, step: .05, rnd: [0, .8] },
      { key: 'hue', label: 'Hue shift', min: -1, max: 1, step: .05, rnd: [-.6, .6] },
      { key: 'detail', label: 'Detail', min: .3, max: 1, step: .05, rnd: [.6, .85] },
    ],
  },
};

export function randomParams(species, seed) {
  const rnd = makeRng(seed * 7919 + 17); const P = { seed };
  for (const s of SPECIES[species].params) { let v = rnd.range(s.rnd[0], s.rnd[1]); v = Math.round(v / s.step) * s.step; P[s.key] = +v.toFixed(4); }
  return P;
}

export function plantName(species, seed) {
  const syll = { palm: ['Ko', 'Pa', 'Lau', 'Ni', 'Ma'], banana: ['Mu', 'Sa', 'Ke', 'La', 'Pi'], fern: ['Fi', 'Dry', 'Ath', 'Pol', 'Ne'] }[species];
  const rnd = makeRng(seed ^ 0x9e37); return syll[rnd.int(0, syll.length - 1)] + ['ra', 'lo', 'ni', 'ka', 'su'][rnd.int(0, 4)] + '-' + (seed % 4096).toString(16).toUpperCase().padStart(3, '0');
}

/** Generate a plant → { geometry, stats, info } */
export function generatePlant(species, P) {
  const def = SPECIES[species]; if (!def) throw new Error('unknown species ' + species);
  const rnd = makeRng(P.seed); const mb = new MeshBuilder();
  const info = def.gen(P, rnd, mb);
  const g = mb.build();
  const bb = g.boundingBox; const size = bb.getSize(V3());
  const stats = {
    vertices: g.attributes.position.count, triangles: g.index.count / 3,
    height: +size.y.toFixed(2), width: +Math.max(size.x, size.z).toFixed(2),
    parts: mb.parts, tubes: mb.tubes.length,
  };
  return { geometry: g, stats, info: { ...info, name: plantName(species, P.seed) }, species, params: P };
}

/** connected components of an indexed geometry (union-find) — used by verification & the inspector */
export function connectedComponents(g) {
  const n = g.attributes.position.count, parent = new Int32Array(n); for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const idx = g.index.array;
  for (let i = 0; i < idx.length; i += 3) { const a = find(idx[i]), b = find(idx[i + 1]), c = find(idx[i + 2]); parent[a] = b; parent[find(b)] = c; }
  const roots = new Set(); for (let i = 0; i < n; i++) roots.add(find(i));
  return roots.size;
}
