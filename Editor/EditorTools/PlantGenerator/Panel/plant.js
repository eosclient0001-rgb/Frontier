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
    i = ((i % n) + n) % n;
    if (this.skip.has(j * 4096 + i)) throw new Error('face(): already claimed');
    let left = 0; for (let k = 0; k < n; k++) if (!this.skip.has(j * 4096 + k)) left++;
    if (left <= 2) throw new Error('face(): band would lose its last faces');   // keeps every ring attached → single shell
    this.skip.add(j * 4096 + i);
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
  rosette: { core: '#5a4a38', leaf: '#3f8a36', leafYoung: '#62a64a', spine: '#4a3020', stalk: '#8a9a4a', fruitCol: '#c8a23a' },
  bamboo: { base: '#5a4a32', culm: '#8fa84a', node: '#6f8a34', branch: '#8f9a4a', leaf: '#4f9a3a' },
  broadleaf: { bark: '#7a6a58', twig: '#6a7a4a', leaf: '#2f7a2c', leafYoung: '#52a03f', flower: '#ffffff', flowerCenter: '#f5c842', fruit: '#6fa83a' },
  aroid: { crown: '#4a3a2a', petiole: '#5f8f3c', petioleDark: '#3f5a2a', vein: '#9ec86a', leaf: '#2f7a2c', leafYoung: '#5fae3f', leafBack: '#3f8a34', flower: '#f0eee0', spadix: '#e8d27a' },
  fern: { crown: '#3d2f22', stipe: '#4d3a2b', rachis: '#5d7a33', frond: '#2f7d2c', frondYoung: '#5fae3f', crozier: '#7aa84c' },
};

function genPalm(P, rnd, mb, V = PALM_VARIANTS.coconut) {
  if (V.clump && !P._stem) {
    // multi-stem clump: a low basal mound, each stem extruded from one of its faces
    const n = V.clump; const C = { ...PALETTE.palm, ...(V.palette || {}) };
    mb.part('trunk');
    const mound = mb.tube([[-.05, 0], [0, 1], [.12, 1.05], [.3, .9], [.42, .55], [.5, 0]].map(([y, r]) => ({ p: V3(0, y, 0), r: P.trunkRadius * 2.6 * r })), { sides: 12, color: shade(hex(C.trunk), 0, 1, .8) });
    let info;
    for (let k = 0; k < n; k++) {
      const face = mound.face(1 + (k % 2), Math.round(k * 12 / n));
      const sub = new MeshBuilder(); sub.curPart = 'trunk';
      const Pk = { ...P, _stem: true, height: P.height * rnd.range(.6, 1.05), lean: P.lean + .12, fronds: Math.round(P.fronds / 1.6), detail: Math.min(P.detail, .7) };
      info = genPalm(Pk, rnd, sub, V);
      // graft: append sub-mesh vertices into mb, rotated to the face normal & sitting on its centre, then bridge its base ring to the face ring
      const off = mb.pos.length / 3; const q = new THREE.Quaternion().setFromUnitVectors(UP, face.normal.clone().addScaledVector(UP, 2.2).normalize());
      for (let i = 0; i < sub.pos.length; i += 3) { const p = V3(sub.pos[i], sub.pos[i + 1], sub.pos[i + 2]).applyQuaternion(q).add(face.center); mb.pos.push(p.x, p.y, p.z); }
      for (const c of sub.col) mb.col.push(c);
      for (const name in sub.parts) mb.parts[name] = (mb.parts[name] || 0) + sub.parts[name];
      for (const t of sub.tubes) t.emit();
      for (const i of sub.idx) mb.idx.push(i + off);
      const baseRing = sub.tubes[0].rings[0].map(i => i + off);
      mb.bridge(face.ring, baseRing, true);
    }
    return info;
  }
  const C = { ...PALETTE.palm, ...(V.palette || {}) }; const hue = (P.hue || 0) * .06;
  const colTrunk = hex(C.trunk), colScar = hex(C.scar);
  const H = P.height, R = P.trunkRadius, sides = 12;
  const fan = V.fan || false, bootsOn = V.boots || false;
  const leanAz = rnd.range(0, Math.PI * 2), lean = P.lean, wob = rnd.range(0, 6.28);
  // ── trunk
  const path = []; const scarStep = .17; const nR = Math.max(24, Math.round(H / scarStep));
  const crownRings = 5, crownH = .55;
  const trunkH = H - crownH;
  for (let j = 0; j <= nR; j++) {
    const t = j / nR, y = t * trunkH;
    const sx = Math.sin(t * 5.1 + wob) * .06 * H * t, sz = Math.cos(t * 3.7 + wob) * .04 * H * t;
    const p = V3(Math.cos(leanAz) * (lean * H * t * t) + sx, y, Math.sin(leanAz) * (lean * H * t * t) + sz);
    const bulge = 1 + (V.bulge ?? .55) * Math.exp(-y / .45) + (V.belly ? .5 * Math.sin(Math.PI * t) : 0);
    const scar = (V.scar ?? .04) ? (j % 2 === 0 ? 1 + (V.scar ?? .04) : 1 - (V.scar ?? .04) * .9) : 1;
    path.push({ p, r: R * (1 - (V.taper ?? .22) * t) * bulge * scar });
  }
  const top = path[path.length - 1].p.clone(), topR = path[path.length - 1].r;
  const dirTop = top.clone().sub(path[path.length - 3].p).normalize();
  for (let j = 1; j <= crownRings; j++) {
    const t = j / crownRings;
    path.push({ p: top.clone().addScaledVector(dirTop, crownH * t), r: topR * (1.05 + .25 * Math.sin(t * Math.PI)) });
  }
  mb.part('trunk');
  const trunk = mb.tube(path, { sides, colorAt: (j) => j <= nR ? ((j % 2 === 0 || !(V.scar ?? .04)) ? colScar : colTrunk) : hex(C.sheath) });
  // persistent leaf bases ("boots") on date palms — short stubs extruded from trunk faces
  if (bootsOn) { mb.part('boots'); for (let j = Math.round(nR * .25); j < nR - 1; j += 2) for (let i = (j >> 1) % 2; i < sides; i += 2) { const f = trunk.face(j, i); const d = f.normal.clone().addScaledVector(UP, .7).normalize(); mb.tube([{ p: f.center.clone().addScaledVector(d, R * .35), r: R * .22 }, { p: f.center.clone().addScaledVector(d, R * .55), r: 0 }], { sides: 4, start: { ring: f.ring, center: f.center }, color: shade(hex(C.sheath), 0, 1, .9) }); } }
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
  const pickFace = (ring, slot) => { let cnt = 0; for (let k = 0; k < sides; k++) if (used.has(ring * 64 + k)) cnt++; if (cnt >= sides - 2) return null; for (let k = 0; k < sides; k++) { const s = (slot + (k % 2 ? -(k + 1) / 2 : k / 2) + sides * 3) % sides; const key = ring * 64 + s; if (!used.has(key)) { used.add(key); return s; } } return null; };
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
    const el = isDead ? rnd.range(-85, -70) * D2R : lerp(V.elMin ?? -48, V.elMax ?? 78, Math.pow(age, 1.15)) * D2R + rnd.range(-7, 7) * D2R;
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
    if (fan) {
      // costapalmate fan: stiff petiole, then pleated segments radiating from a short costa
      const petSt = stations.slice(0, Math.round(segs * .5)); petSt[petSt.length - 1].r = rPet * .6;
      const pet = mb.tube(petSt, { sides: 4, start: { ring: f.ring, center: f.center }, color: colR });
      const fr = pet.frames[pet.length - 1]; const hub = pet.rings[pet.length - 1];
      const nSeg = Math.round(lerp(16, 28, P.detail)); const span = (V.fanSpan ?? 160) * D2R;
      const fanR = P.frondLength * .55 * (isDead ? .85 : 1);
      const upF = fr.N.clone();                           // fan plane normal-ish (pleats go ± along it)
      const rows = [];                                    // rows[k] = 4 vertices along segment k
      for (let k = 0; k <= nSeg; k++) {
        const a = -span / 2 + span * k / nSeg;
        const dir = fr.T.clone().multiplyScalar(Math.cos(a)).addScaledVector(fr.B, Math.sin(a)).normalize();
        const len = fanR * (.62 + .38 * Math.cos(a * .8));
        const pleat = (k % 2 ? 1 : -1) * fanR * .035;
        const row = [];
        for (let c = 1; c <= 4; c++) {
          const t = c / 4;
          const drop = (isDead ? 1.3 : .35) * len * t * t * t * (Math.abs(a) / (span / 2) * .7 + .3);
          const split = c === 4 ? .5 : 0;                 // segment tips split and droop (Washingtonia threads)
          row.push(mb.v(fr.p.clone().addScaledVector(dir, len * t * (1 + split * .06)).addScaledVector(UP, -drop).addScaledVector(upF, pleat * Math.sin(Math.PI * t)), colF));
        }
        rows.push(row);
      }
      // hub triangles share the petiole's last ring (4 verts) → fan is one shell with the petiole
      for (let k = 0; k < nSeg; k++) { mb.tri(hub[0], rows[k][0], rows[k + 1][0]); mb.tri(hub[1], rows[k + 1][0], rows[k][0]); }
      for (let k = 0; k < nSeg; k++) mb.strip([rows[k], rows[k + 1]]);
      mb.tri(hub[0], hub[1], hub[2]); mb.tri(hub[0], hub[2], hub[3]);
      continue;
    }
    const rach = mb.tube(stations, { sides: 4, start: { ring: f.ring, center: f.center }, color: colR });
    // leaflets: from ~22% of the rachis to the tip, both sides, hanging (coconut leaflets droop)
    const first = Math.round(rach.length * .22);
    for (let j = first; j < rach.length - 1; j++) {
      const u = (j - first) / (rach.length - 1 - first);
      const ll = P.leafletLength * Math.pow(Math.sin(Math.PI * (0.08 + .84 * u)), .6) * (isDead ? .8 : 1);
      const fr = rach.frames[j];
      const perStation = Math.max(2, Math.round(lerp(3, 5, P.detail) * (V.leafletDensity ?? 1) * (N > 28 ? 28 / N : 1)));
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
        const sag = (isDead ? 1.4 : lerp(.9, 1.6, u) * (V.leafletSag ?? .9)) * rnd.range(.85, 1.15);
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
  // ── fruit clusters (stalk from a crown face, fruit extruded from stalk faces): coconuts, or date strands
  for (let c = 0; c < Math.round(P.coconuts); c++) {
    if (V.dates) {
      const ring = j0 + (c % 2); const slot = pickFace(ring, Math.round(rnd.range(0, sides))); if (slot === null) break;
      const f = trunk.face(ring, slot); mb.part('coconut');
      const d = f.normal.clone().addScaledVector(UP, -.15).normalize();
      const stalk = mb.tube([1, 2, 3, 4, 5].map(k => ({ p: f.center.clone().addScaledVector(d, .16 * k).addScaledVector(UP, -.05 * k * k), r: .03 })), { sides: 4, start: { ring: f.ring, center: f.center }, color: hex(C.coconut) });
      for (let j = 1; j < stalk.length - 1; j++) for (let i = 0; i < 4; i += 1) {
        let ff; try { ff = stalk.face(j, i); } catch { continue; }
        const L = rnd.range(.5, .9); const pts = []; for (let k = 1; k <= 5; k++) pts.push({ p: ff.center.clone().addScaledVector(ff.normal, .12 * k * (1 - k / 8)).addScaledVector(UP, -L * k / 5), r: k === 5 ? 0 : .028 * (1 - k / 7) });
        mb.tube(pts, { sides: 4, start: { ring: ff.ring, center: ff.center }, color: shade(hex(C.coconut), rnd.range(-.02, .02), 1, rnd.range(.9, 1.1)) });
      }
      continue;
    }
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
  return { latin: V.latin, common: V.common };
}
export const PALM_VARIANTS = {
  coconut: { label: 'Coconut palm', latin: 'Cocos nucifera', common: 'Coconut palm', bulge: .55, scar: .04, taper: .22 },
  royal: { label: 'Royal palm', latin: 'Roystonea regia', common: 'Royal palm', bulge: .2, belly: true, scar: 0, taper: .3, elMin: -20, elMax: 70, leafletSag: .5, palette: { trunk: '#b9b6ab', scar: '#c4c1b6', sheath: '#7fae4c', frond: '#3f8a34' }, over: { lean: [0, .05], fronds: [14, 20], coconuts: [0, 0], deadFronds: [0, 0], frondLength: [3, 4.5] } },
  date: { label: 'Date palm', latin: 'Phoenix dactylifera', common: 'Date palm', bulge: .3, scar: .02, taper: .1, boots: true, dates: true, leafletDensity: .6, elMin: -35, elMax: 65, leafletSag: .15, palette: { trunk: '#8a7658', scar: '#6f5d45', frond: '#5d8a5a', frondYoung: '#7fa37a', rachis: '#a8a860', coconut: '#c98a3a' }, over: { height: [6, 12], fronds: [26, 36], leafletLength: [.35, .55], droop: [.2, .5], coconuts: [1, 3], deadFronds: [0, 2] } },
  fan: { label: 'Fan palm', latin: 'Washingtonia robusta', common: 'Mexican fan palm', bulge: .4, scar: .015, taper: .12, fan: true, fanSpan: 160, elMin: -30, elMax: 75, palette: { trunk: '#9a8a74', scar: '#8c7c66', frond: '#4c8c3a', rachis: '#9aa050' }, over: { height: [8, 15], fronds: [18, 30], leafletLength: [.8, 1.2], coconuts: [0, 0], deadFronds: [2, 5], trunkRadius: [.16, .24] } },
  queen: { label: 'Queen palm', latin: 'Syagrus romanzoffiana', common: 'Queen palm', bulge: .15, scar: .02, taper: .2, elMin: -30, elMax: 75, leafletSag: 1.3, palette: { trunk: '#9a9385', scar: '#8b8477', frond: '#3a7d33', rachis: '#8fa84e', coconut: '#d9902e' }, over: { height: [8, 15], trunkRadius: [.18, .26], lean: [0, .08], fronds: [12, 18], frondLength: [3.5, 5], leafletLength: [.6, .9], droop: [.7, 1.2], coconuts: [0, 2], deadFronds: [0, 1] } },
  bismarck: { label: 'Bismarck palm', latin: 'Bismarckia nobilis', common: 'Bismarck palm', bulge: .35, scar: .02, taper: .12, fan: true, fanSpan: 175, elMin: -20, elMax: 70, palette: { trunk: '#8d8578', scar: '#7e766a', frond: '#8fa8a0', frondYoung: '#a6bfb6', rachis: '#7d8b6a' }, over: { height: [5, 10], trunkRadius: [.24, .34], fronds: [18, 26], frondLength: [3, 4], coconuts: [0, 0], deadFronds: [0, 2] } },
  sago: { label: 'Sago palm', latin: 'Cycas revoluta', common: 'Sago palm (cycad)', bulge: .1, scar: .08, taper: .05, elMin: -15, elMax: 60, leafletSag: 0, leafletDensity: 1.2, palette: { trunk: '#5a4a38', scar: '#4a3c2c', sheath: '#6a5a45', frond: '#2f6b2a', frondYoung: '#4d8a3a', rachis: '#5f7d3a' }, over: { height: [.6, 2], trunkRadius: [.14, .22], lean: [0, .1], fronds: [20, 36], frondLength: [.9, 1.5], leafletLength: [.12, .2], droop: [.2, .5], coconuts: [0, 0], deadFronds: [0, 0] } },
  areca: { label: 'Areca palm', latin: 'Dypsis lutescens', common: 'Areca (butterfly) palm', clump: 5, leafletDensity: .5, bulge: .25, scar: .03, taper: .25, elMin: 5, elMax: 80, leafletSag: .35, palette: { trunk: '#b8b26a', scar: '#9c9650', sheath: '#c2b45a', frond: '#5a9e3c', rachis: '#d1c75a' }, over: { height: [2.6, 5], trunkRadius: [.05, .08], fronds: [9, 14], frondLength: [1.6, 2.4], leafletLength: [.35, .55], droop: [.3, .7], coconuts: [0, 0], deadFronds: [0, 1] } },
};

/* ───────────────────────── species: BANANA (Musa) ───────────────────────── */
function genBanana(P, rnd, mb, V = BANANA_VARIANTS.cavendish) {
  const C = { ...PALETTE.banana, ...(V.palette || {}) }; const hue = (P.hue || 0) * .06;
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
  const pickFace = (ring, slot) => { let cnt = 0; for (let k = 0; k < sides; k++) if (used.has(ring * 64 + k)) cnt++; if (cnt >= sides - 2) return null; for (let k = 0; k < sides; k++) { const s = (slot + (k % 2 ? -(k + 1) / 2 : k / 2) + sides * 3) % sides; const key = ring * 64 + s; if (!used.has(key)) { used.add(key); return s; } } return null; };
  const N = Math.round(P.leaves); const perRing = Math.ceil((N + 1) / crownRings);
  const segs = Math.round(lerp(14, 26, P.detail)), across = Math.round(lerp(3, 5, P.detail));
  for (let i = 0; i < N; i++) {
    const age = i / Math.max(1, N - 1);
    const ring = j0 + Math.min(crownRings - 1, Math.floor(i / perRing));
    const az = V.fanned ? (i % 2 ? Math.PI / 2 : -Math.PI / 2) + rnd.range(-.06, .06) : i * GOLD + rnd.range(-.2, .2);
    const slot = pickFace(ring, Math.round(az / (2 * Math.PI / sides)));
    if (slot === null) continue;
    const f = stem.face(ring, slot);
    const faceAz = V.fanned ? az : Math.atan2(f.normal.z, f.normal.x);
    const el = lerp(V.elMin ?? 5, V.elMax ?? 62, Math.pow(age, .9)) * D2R + rnd.range(-6, 6) * D2R;
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
    let colLeaf = shade(base, hue + rnd.range(-.012, .012), 1, rnd.range(.92, 1.08));
    if (V.variegate && rnd() < .5) colLeaf = shade(colLeaf, -.03, .7, 1.25);
    if (V.fanned) { /* traveller's palm: leaves in one plane */ }
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
  return { latin: V.latin, common: V.common };
}
export const BANANA_VARIANTS = {
  cavendish: { label: 'Banana', latin: 'Musa acuminata (Cavendish)', common: 'Banana plant' },
  plantain: { label: 'Plantain', latin: 'Musa × paradisiaca', common: 'Plantain', palette: { leaf: '#3f8a2a', leafOld: '#6e8a36', stem: '#9aa562' }, over: { height: [3, 5], leafLength: [2.2, 3], leafWidth: [.6, .95], tear: [.4, 1] } },
  redbanana: { label: 'Red banana', latin: 'Musa acuminata "Red Dacca"', common: 'Red banana', palette: { stem: '#7a3b3f', stemOld: '#5e2f33', petiole: '#8c4a4a', midrib: '#b06a58', leaf: '#4b8a2e', leafYoung: '#6ea24a', fruit: '#8f3b3a', bud: '#5e1f36' }, over: { height: [2.5, 4.5], fruit: [1, 1] } },
  ensete: { label: 'Ensete', latin: 'Ensete ventricosum "Maurelii"', common: 'Red Abyssinian banana', elMin: 20, elMax: 75, palette: { stem: '#8e5c4c', petiole: '#7d3f3c', midrib: '#c6684f', leaf: '#5a7e3a', leafYoung: '#7a4e48', leafOld: '#6b3a3a' }, over: { height: [2.5, 4], stemRadius: [.2, .3], leaves: [6, 10], leafLength: [2.2, 3], leafWidth: [.7, 1], fruit: [0, 0], tear: [.1, .5] } },
  heliconia: { label: 'Heliconia', latin: 'Heliconia bihai', common: 'Lobster-claw', palette: { stem: '#6f9a3e', petiole: '#6f9a3e', midrib: '#a9c85f', leaf: '#3f8a34', leafYoung: '#62a64a', fruit: '#e0372f', bud: '#e8b23a', peduncle: '#d0432c' }, over: { height: [1.8, 3], stemRadius: [.1, .14], leaves: [5, 8], leafLength: [1.2, 1.8], leafWidth: [.4, .55], tear: [0, .3], fruit: [1, 1], droop: [.1, .4] } },
  strelitzia: { label: 'Bird of paradise', latin: 'Strelitzia nicolai', common: 'Giant white bird of paradise', fanned: true, elMin: 20, elMax: 80, palette: { stem: '#8a8a72', petiole: '#7f9a4a', midrib: '#c0cc74', leaf: '#3b7f33', fruit: '#f2f2ea', bud: '#3a4a8a', peduncle: '#5f7f4a' }, over: { height: [2.5, 5], stemRadius: [.14, .22], leaves: [8, 12], leafLength: [1.4, 2.2], leafWidth: [.45, .7], fruit: [1, 1], tear: [.2, .8], droop: [.1, .3] } },
  canna: { label: 'Canna lily', latin: 'Canna indica', common: 'Indian shot', elMin: 25, elMax: 80, palette: { stem: '#6f9a3e', petiole: '#6f9a3e', midrib: '#9fc25c', leaf: '#3f8a34', leafYoung: '#67ad4c', fruit: '#e0452f', bud: '#e04a2f', peduncle: '#6f9a3e' }, over: { height: [1.2, 2.2], stemRadius: [.03, .05], leaves: [5, 8], leafLength: [.5, .8], leafWidth: [.2, .3], tear: [0, .1], fruit: [1, 1], droop: [.1, .3] } },
  traveller: { label: "Traveller's palm", latin: 'Ravenala madagascariensis', common: "Traveller's palm", fanned: true, elMin: 15, elMax: 80, palette: { stem: '#9d9a78', petiole: '#a8b862', leaf: '#3e8a30' }, over: { height: [3.5, 5], stemRadius: [.2, .3], leaves: [10, 13], leafLength: [2.4, 3], leafWidth: [.55, .8], fruit: [0, 0], tear: [.2, .8], droop: [.1, .35] } },
};

/* ───────────────────────── species: FERN (Dryopteris) ───────────────────────── */
function genFern(P, rnd, mb, V = FERN_VARIANTS.wood) {
  const C = { ...PALETTE.fern, ...(V.palette || {}) }; const hue = (P.hue || 0) * .06;
  const sides = 10; const trunkH = P.trunk || 0; const crownRings = 4;
  const cr = trunkH > 0 ? lerp(.09, .16, P.frondLength / 3) : lerp(.035, .07, P.frondLength / 1.3);
  mb.part('crown');
  const prof = trunkH > 0
    ? (() => { const n = Math.max(6, Math.round(trunkH / .25)); const a = []; for (let k = 0; k <= n; k++) { const t = k / n; a.push([t * trunkH, 1.15 - .25 * t]); } return [...a, [trunkH + .02, 1], [trunkH + .05, .85], [trunkH + .08, .55], [trunkH + .1, 0]]; })()
    : [[-.03, 0], [0, .8], [.02, 1], [.04, .9], [.06, .6], [.075, 0]];
  const nTr = prof.length - 6; // last full-radius trunk ring; crown rings nTr+1 … nTr+4, then the cap
  const crown = mb.tube(prof.map(([y, r]) => ({ p: V3(rnd.range(-.02, .02) * y, y, rnd.range(-.02, .02) * y), r: cr * r })), { sides, color: hex(C.crown) });
  const used = new Set();
  const pickFace = (ring, slot) => { let cnt = 0; for (let k = 0; k < sides; k++) if (used.has(ring * 64 + k)) cnt++; if (cnt >= sides - 2) return null; for (let k = 0; k < sides; k++) { const s = (slot + (k % 2 ? -(k + 1) / 2 : k / 2) + sides * 3) % sides; const key = ring * 64 + s; if (!used.has(key)) { used.add(key); return s; } } return null; };
  const N = Math.round(P.fronds), pairs = Math.round(P.pinnaPairs * lerp(.6, 1, P.detail)), pinn = Math.round(P.pinnules * lerp(.6, 1, P.detail));
  const perRing = Math.ceil(N / (crownRings - 1));
  for (let i = 0; i < N; i++) {
    const age = i / Math.max(1, N - 1);                 // outer/older first
    const ring = (trunkH > 0 ? nTr : 0) + 1 + Math.min(crownRings - 2, Math.floor(i / perRing));
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
      const pl = L * (V.pinnaLen ?? .21) * shape + .01;
      const fr = rach.frames[j];
      for (const sgn of [1, -1]) {
        if (sgn < 0 && j === stipe) continue;            // alternate pinnae slightly
        const e = rach.sideEdge(j, sgn);
        const side = fr.B.clone().multiplyScalar(sgn);
        // frond lamina plane = (rachis tangent, side). Pinnae lie in it and sweep forward ~25°.
        const sweep = (V.sweep ?? 25) * D2R;
        const dir0 = side.clone().multiplyScalar(Math.cos(sweep)).addScaledVector(fr.T, Math.sin(sweep)).normalize();
        const nrm = dir0.clone().cross(fr.T).normalize();          // lamina normal (for slight cupping)
        if (nrm.dot(UP) < 0) nrm.negate();
        const acr = fr.T.clone();                                   // "across" the pinna
        const pinnaGap = rach.frames[j + 1].p.distanceTo(fr.p);    // spacing along rachis
        const pw = Math.min(pl * (V.pinnaW ?? .24), pinnaGap * .95) * .5;  // half-width, never overlapping the neighbour
        const droopP = P.arch * .3;
        const at = (v) => e.mid.clone().addScaledVector(dir0, pl * v).addScaledVector(UP, -pl * v * v * droopP);
        if (V.simple) {
          // entire (undivided) pinna: a flat lanceolate blade — 3 verts across, tapered
          const rows = [[e.a, e.b]]; const nR = 5;
          for (let q = 1; q <= nR; q++) {
            const v = q / nR; const w = pw * Math.sin(Math.PI * Math.pow(v, .8)) * 1.15 + .0005; const pt = at(v);
            if (q === nR) rows.push([mb.v(pt, colF)]);
            else rows.push([mb.v(pt.clone().addScaledVector(acr, -w), colF), mb.v(pt.clone().addScaledVector(nrm, w * .12), colF), mb.v(pt.clone().addScaledVector(acr, w), colF)]);
          }
          mb.strip(rows); continue;
        }
        // divided pinna: slender costa (midrib) strip with separate pinnule lobes on both sides
        const nP = Math.max(4, Math.round(pinn * shape));
        const costaW = pw * .12 + .0006;
        const rows = [[e.a, e.b]];
        for (let q = 1; q <= nP; q++) { const v = q / nP; const pt = at(v); rows.push(q === nP ? [mb.v(pt, colRa)] : [mb.v(pt.clone().addScaledVector(acr, -costaW), colRa), mb.v(pt.clone().addScaledVector(acr, costaW), colRa)]); }
        mb.strip(rows);
        for (let q = 0; q < nP - 1; q++) {
          const v0 = (q + .15) / nP, v1 = (q + .85) / nP;             // this pinnule's footprint along the costa
          const taper = Math.pow(1 - (q + .5) / nP, .6);
          const len = pw * 2 * taper * (V.pinnuleLen ?? 1);           // pinnule length (across)
          if (len < .004) continue;
          for (const sg of [1, -1]) {
            const rowIdx = q + 1;                                      // costa row q+1 has [left,right]
            const base = rows[rowIdx]; if (base.length < 2) continue;
            const nb = rows[rowIdx + 1]; if (!nb || nb.length < 2) continue;
            const rootA = sg > 0 ? base[1] : base[0], rootB = sg > 0 ? nb[1] : nb[0];
            const p0 = mb.p(rootA), p1 = mb.p(rootB); const mid = p0.clone().add(p1).multiplyScalar(.5);
            const out = acr.clone().multiplyScalar(sg).addScaledVector(dir0, .35).normalize();   // pinnules angle toward the pinna tip
            const along = p1.clone().sub(p0).normalize();
            const tip = mid.clone().addScaledVector(out, len).addScaledVector(nrm, len * .18);
            const midP = mid.clone().addScaledVector(out, len * .5).addScaledVector(nrm, len * .1);
            const hw = (p1.distanceTo(p0)) * .5 * (V.lobeW ?? .95);
            // rounded lobe: root edge (shared with costa) → wide mid row → tip
            const m0 = mb.v(midP.clone().addScaledVector(along, -hw), colF), m1 = mb.v(midP.clone().addScaledVector(along, hw), colF);
            const t0 = mb.v(tip, colF);
            mb.strip([[rootA, rootB], [m0, m1], [t0]]);
            if (V.serrate) { const sp = midP.clone().addScaledVector(along, hw * 1.35).addScaledVector(out, len * .15); const sv = mb.v(sp, colF); mb.tri(m1, sv, t0); }
          }
        }
      }
    }
  }
  // croziers (fiddleheads) from the top crown ring
  mb.part('crozier');
  for (let c = 0; c < 3; c++) {
    const cring = (trunkH > 0 ? nTr : 0) + crownRings - 1;
    const slot = pickFace(cring, rnd.int(0, sides - 1)); if (slot === null) break;
    const f = crown.face(cring, slot);
    const h = P.frondLength * rnd.range(.18, .3); const pts = [];
    const az = Math.atan2(f.normal.z, f.normal.x);
    for (let k = 1; k <= 12; k++) { const t = k / 12; const spiral = Math.max(0, t - .6) / .4 * Math.PI * 1.6; const r = .05 * h; pts.push({ p: f.center.clone().addScaledVector(UP, h * Math.min(t, .6) / .6 + r * Math.sin(spiral) + (t > .6 ? r * .3 : 0)).addScaledVector(dirFrom(az, 0), h * .25 * t + r * (1 - Math.cos(spiral))), r: k === 12 ? 0 : cr * .12 * (1 - .5 * t) }); }
    mb.tube(pts, { sides: 5, start: { ring: f.ring, center: f.center }, color: hex(C.crozier) });
  }
  return { latin: V.latin, common: V.common };
}
export const FERN_VARIANTS = {
  wood: { label: 'Wood fern', latin: 'Dryopteris filix-mas', common: 'Male fern' },
  boston: { label: 'Boston fern', latin: 'Nephrolepis exaltata', common: 'Sword fern', simple: true, pinnaLen: .1, pinnaW: .9, sweep: 15, palette: { frond: '#3f9a33', frondYoung: '#74c04a', rachis: '#8fb14a' }, over: { fronds: [14, 22], frondLength: [.6, 1.1], arch: [.6, 1.2], spread: [25, 60], pinnaPairs: [28, 34] } },
  birdsnest: { label: "Bird's-nest fern", latin: 'Asplenium nidus', common: "Bird's-nest fern", simple: true, pinnaLen: .19, pinnaW: 1.6, sweep: 60, palette: { frond: '#5fb040', frondYoung: '#8ed15c', rachis: '#2f2a24', stipe: '#2f2a24' }, over: { fronds: [9, 16], frondLength: [.6, 1.2], arch: [.15, .45], spread: [40, 70], pinnaPairs: [10, 14], pinnules: [5, 5], curl: [0, .2] } },
  tree: { label: 'Tree fern', latin: 'Cyathea cooperi', common: 'Australian tree fern', pinnaLen: .19, pinnaW: .26, palette: { crown: '#4a3a2a', stipe: '#5a4530', frond: '#3a8a30' }, over: { trunk: [1.5, 4], fronds: [10, 18], frondLength: [2, 3.2], arch: [.5, 1], spread: [20, 45], pinnaPairs: [22, 34] } },
  maidenhair: { label: 'Maidenhair', latin: 'Adiantum raddianum', common: 'Maidenhair fern', pinnaLen: .3, pinnaW: 1.2, lobeW: 1.2, pinnuleLen: .9, palette: { frond: '#69b84a', frondYoung: '#9ad86a', rachis: '#1d1a17', stipe: '#1d1a17' }, over: { fronds: [12, 22], frondLength: [.3, .55], arch: [.5, 1.1], spread: [30, 60], pinnaPairs: [8, 14], pinnules: [5, 8], detail: [.5, .7] } },
  ostrich: { label: 'Ostrich fern', latin: 'Matteuccia struthiopteris', common: 'Ostrich / shuttlecock fern', pinnaLen: .17, pinnaW: .3, palette: { frond: '#3c8f2f', frondYoung: '#6dbf47' }, over: { fronds: [9, 14], frondLength: [.9, 1.4], arch: [.25, .6], spread: [50, 70], pinnaPairs: [26, 34], pinnules: [8, 12] } },
  asparagus: { label: 'Asparagus fern', latin: 'Asparagus setaceus', common: 'Lace fern', pinnaLen: .28, pinnaW: .5, lobeW: .5, pinnuleLen: .7, palette: { frond: '#5aa63a', frondYoung: '#84c95a', rachis: '#4c6a2a', stipe: '#4c6a2a' }, over: { fronds: [10, 18], frondLength: [.5, .9], arch: [.6, 1.2], spread: [15, 45], pinnaPairs: [14, 22], pinnules: [10, 16], detail: [.4, .6] } },
  tassel: { label: 'Tassel fern', latin: 'Polystichum polyblepharum', common: 'Japanese tassel fern', pinnaLen: .16, pinnaW: .3, serrate: true, palette: { frond: '#1f5e26', frondYoung: '#3f8a3a', stipe: '#3a2a1c', rachis: '#4c5a2a' }, over: { fronds: [10, 18], frondLength: [.5, .8], arch: [.5, .9], spread: [20, 45], pinnaPairs: [22, 30], curl: [.4, 1] } },
  staghorn: { label: 'Staghorn', latin: 'Platycerium bifurcatum', common: 'Staghorn fern', simple: true, pinnaLen: .4, pinnaW: 1.3, sweep: 40, palette: { frond: '#7fa86a', frondYoung: '#a4c58a', rachis: '#7fa86a', stipe: '#8a7f60', crown: '#8a7f60' }, over: { fronds: [5, 9], frondLength: [.5, .9], arch: [.6, 1.2], spread: [10, 35], pinnaPairs: [4, 6], pinnules: [5, 5] } },
};

/* ───────────────────────── species: AROIDS (giant-leaf tropicals) ───────────────────────── */
/**
 * Leaf = one strip mesh grown from the petiole's tip edge; the outline is a 2-D radial function
 * r(θ) sampled around the leaf's attachment point:
 *   'heart'  — cordate/sagittate (elephant ear, taro, philodendron): broad, deep basal lobes
 *   'split'  — pinnatifid with fenestrations (Monstera, Thaumatophyllum): heart with deep side cuts
 *   'oval'   — entire ovate (Calathea, Alocasia 'Amazonica' style is heart+veins)
 */
function genAroid(P, rnd, mb, V = AROID_VARIANTS.elephant) {
  const C = { ...PALETTE.aroid, ...(V.palette || {}) }; const hue = (P.hue || 0) * .06;
  const sides = 10, crownRings = 4; const cr = P.stemRadius;
  mb.part('crown');
  const trunkH = P.trunk || 0;
  const prof = [[-.03, 0], [0, .9], [trunkH * .5 + .04, 1]];
  const n = Math.max(3, Math.round(trunkH / .15)); for (let k = 1; k <= n; k++) prof.push([trunkH * .5 + .04 + (trunkH * .5) * k / n, 1 - .1 * k / n]);
  prof.push([trunkH + .07, .9], [trunkH + .1, .65], [trunkH + .12, 0]);
  const nTr = prof.length - 6;
  const crown = mb.tube(prof.map(([y, r]) => ({ p: V3(0, y, 0), r: cr * r })), { sides, color: hex(C.crown) });
  const used = new Set();
  const pickFace = (ring, slot) => { let cnt = 0; for (let k = 0; k < sides; k++) if (used.has(ring * 64 + k)) cnt++; if (cnt >= sides - 2) return null; for (let k = 0; k < sides; k++) { const s = (slot + (k % 2 ? -(k + 1) / 2 : k / 2) + sides * 3) % sides; const key = ring * 64 + s; if (!used.has(key)) { used.add(key); return s; } } return null; };
  const N = Math.round(P.leaves); const perRing = Math.ceil(N / 3);
  const rings = Math.round(lerp(10, 18, P.detail)), spokes = Math.round(lerp(18, 34, P.detail));
  for (let i = 0; i < N; i++) {
    const age = i / Math.max(1, N - 1);
    const ring = nTr + 1 + Math.min(2, Math.floor(i / perRing));
    const az = i * GOLD + rnd.range(-.2, .2);
    const slot = pickFace(ring, Math.round(az / (2 * Math.PI / sides))); if (slot === null) continue;
    const f = crown.face(ring, slot);
    const faceAz = Math.atan2(f.normal.z, f.normal.x);
    const el = lerp(V.elMin ?? 20, V.elMax ?? 75, Math.pow(age, .9)) * D2R + rnd.range(-6, 6) * D2R;
    const d = dirFrom(faceAz + rnd.range(-.2, .2), el);
    const petL = P.petiole * rnd.range(.85, 1.1) * (age > .9 ? .7 : 1);
    const nPet = 8; const pts = arcPath(f.center, d, petL, P.droop * .9, nPet);
    const st = pts.slice(1).map((p, k) => ({ p, r: cr * .22 * (1 - .45 * k / nPet) + .004 }));
    const colPet = shade(hex(V.darkPetiole ? C.petioleDark : C.petiole), hue, 1, rnd.range(.92, 1.06));
    mb.part('leaf');
    const pet = mb.tube(st, { sides: 4, start: { ring: f.ring, center: f.center }, color: colPet });
    const fr = pet.frames[pet.length - 1];
    // leaf frame: forward = petiole tangent flattened toward horizontal then tilted by 'hang'
    const hang = lerp(V.hangMin ?? 10, V.hangMax ?? 55, P.droop) * D2R * lerp(.6, 1.2, age);
    const flat = fr.T.clone().addScaledVector(UP, -fr.T.dot(UP)).normalize();
    const fwd = flat.clone().multiplyScalar(Math.cos(hang)).addScaledVector(UP, -Math.sin(hang)).normalize();
    const right = fwd.clone().cross(UP).normalize(); if (right.lengthSq() < .5) right.set(1, 0, 0);
    const nrm = right.clone().cross(fwd).normalize();
    const L = P.leafLength * rnd.range(.85, 1.1) * (age > .9 ? .6 : 1), W = L * P.leafWidth;
    const colLeaf = shade(age > .85 ? hex(C.leafYoung) : hex(C.leaf), hue + rnd.range(-.01, .01), 1, rnd.range(.93, 1.07));
    const colVein = shade(hex(C.vein), hue, 1, 1);
    const peltate = V.peltate ?? 0;                      // attachment point moved inside the blade (elephant ear)
    const lobe = V.lobe ?? .35;                           // basal lobe depth (fraction of L behind the attachment)
    const splits = V.splits || 0, splitDepth = V.splitDepth ?? .55, holes = V.holes || 0;
    // outline r(θ): θ=0 forward tip, ±π backward (basal lobes / sinus)
    const outline = (th) => {
      const a = Math.abs(th);
      let r;
      if (V.shape === 'oval') r = (L * .5) / Math.sqrt(Math.pow(Math.cos(th) / 1, 2) + Math.pow(Math.sin(th) / (W / L), 2)) * (1 + .1 * Math.cos(th));
      else {
        // cordate / sagittate: pointed (acuminate) tip, widest ~35% back, two rounded basal lobes with a sinus at θ=±π
        const Lf = L * (1 - lobe), hw = W * .5;
        // superellipse-ish front half with exponent < 2 → pointed tip
        const cA = Math.cos(th), sA = Math.abs(Math.sin(th));
        const pE = 1.55, front = 1 / Math.pow(Math.pow(Math.abs(cA) / Lf, pE) + Math.pow(sA / hw, pE), 1 / pE);
        // basal lobes: circles of radius hw*.55 centred at (−lobe·L·.35, ±hw·.5)
        const lr = hw * .55, lcx = -L * lobe * .35, lcy = hw * .5;
        const ux = Math.cos(th), uy = Math.sin(th); const cy = uy > 0 ? lcy : -lcy;
        const bq = -2 * (ux * lcx + uy * cy), cq = lcx * lcx + cy * cy - lr * lr; const disc = bq * bq - 4 * cq;
        const lobeR = disc > 0 ? (-bq + Math.sqrt(disc)) / 2 : 0;
        const sinusR = W * .06 * (1 - (V.sinus ?? .8)) + W * .05;
        r = a < Math.PI * .5 ? front : Math.max(lobeR, sinusR, a < Math.PI * .62 ? front * (1 - (a - Math.PI * .5) / (Math.PI * .12)) : 0);
        if (a >= Math.PI * .5) r = Math.max(r, front * Math.max(0, 1 - (a - Math.PI * .5) / (Math.PI * .2)));
      }
      if (splits) { const k = Math.abs(Math.sin(th * splits)); const cut = Math.pow(k, 8) * splitDepth * (a > .25 && a < Math.PI * .85 ? 1 : 0); r *= 1 - cut; }
      return Math.max(r, .01);
    };
    const origin = fr.p.clone().addScaledVector(fwd, peltate * L);
    const cup = V.cup ?? .25, ripple = V.ripple ?? 0;
    const pointAt = (th, s) => {
      const r = outline(th) * s;
      const x = Math.cos(th) * r, y = Math.sin(th) * r;
      // blade droops away from the midrib (cup) and along the tip
      const sag = cup * Math.abs(y) * Math.abs(y) / (W * .5) + .35 * cup * Math.max(0, x) * Math.max(0, x) / L;
      const rip = ripple ? Math.sin(th * spokes * .5) * .015 * L * s : 0;
      return origin.clone().addScaledVector(fwd, x).addScaledVector(right, y).addScaledVector(nrm, -sag + rip);
    };
    const hubIdx = pet.rings[pet.length - 1]; const hubCenter = mb.v(origin, colVein);
    const rowsR = [];
    for (let q = 1; q <= rings; q++) {
      const sr = q / rings; const row = [];
      for (let k = 0; k <= spokes; k++) {
        const th = -Math.PI + 2 * Math.PI * k / spokes;
        let col = colLeaf;
        const nearVein = Math.abs(Math.sin(th)) < .06 || (V.veins && Math.abs(Math.sin(th * V.veins)) < .05);
        if (nearVein && sr < .9) col = colVein;
        if (holes && sr > .35 && sr < .8) { const hk = Math.sin(th * holes * 2) * Math.sin(sr * Math.PI * 3); if (hk > .93) col = null; }
        row.push(col ? mb.v(pointAt(th, sr), col) : null);
      }
      rowsR.push(row);
    }
    // stitch: hub → ring 1 (petiole tip ring vertices are part of the hub fan → single shell)
    for (let k = 0; k < spokes; k++) { const a = rowsR[0][k], b = rowsR[0][k + 1]; if (a != null && b != null) mb.tri(hubCenter, a, b); }
    for (let h = 0; h < hubIdx.length; h++) mb.tri(hubCenter, hubIdx[(h + 1) % hubIdx.length], hubIdx[h]);
    // bridge the petiole ring to the hub centre + first-row point nearest to each ring vertex
    for (let h = 0; h < hubIdx.length; h++) { const pv = mb.p(hubIdx[h]); let best = 0, bd = 1e9; for (let k = 0; k < spokes; k++) { const idx = rowsR[0][k]; if (idx == null) continue; const dd = mb.p(idx).distanceToSquared(pv); if (dd < bd) { bd = dd; best = idx; } } mb.tri(hubIdx[h], hubCenter, best); }
    for (let q = 0; q < rings - 1; q++) for (let k = 0; k < spokes; k++) {
      const a = rowsR[q][k], b = rowsR[q][k + 1], c = rowsR[q + 1][k], d2 = rowsR[q + 1][k + 1];
      if (a != null && b != null && c != null) mb.tri(a, b, c); if (b != null && d2 != null && c != null) mb.tri(b, d2, c);
    }
  }
  // spathe + spadix (peace-lily style inflorescence) for some
  if (V.flower && P.flower > .5) {
    const slot = pickFace(nTr + 3, rnd.int(0, sides - 1));
    if (slot !== null) {
      const f = crown.face(nTr + 3, slot); mb.part('flower');
      const d = f.normal.clone().addScaledVector(UP, 2).normalize(); const h = P.petiole * .9;
      const stalk = mb.tube([1, 2, 3, 4, 5].map(k => ({ p: f.center.clone().addScaledVector(d, h * k / 5), r: cr * .12 })), { sides: 4, start: { ring: f.ring, center: f.center }, color: hex(C.petiole) });
      const top = stalk.frames[stalk.length - 1].p, tr = stalk.rings[stalk.length - 1];
      const spadix = [[.3, 1.6], [.7, 1.4], [1, 0]].map(([t, r]) => ({ p: top.clone().addScaledVector(UP, .22 * t), r: cr * .12 * r }));
      mb.tube(spadix, { sides: 6, start: { ring: tr, center: top }, color: hex(C.spadix) });
      // spathe: a single cupped blade from a stalk face
      let ff; try { ff = stalk.face(stalk.length - 3, 1); } catch { ff = null; }
      if (ff) { const rows = [ff.ring.slice(0, 2)]; const back = ff.normal.clone(); for (let q = 1; q <= 5; q++) { const t = q / 5; const w = .11 * Math.sin(Math.PI * Math.pow(t, .7)) + .001; const c = ff.center.clone().addScaledVector(UP, .34 * t).addScaledVector(back, .06 * Math.sin(Math.PI * t)); const side = back.clone().cross(UP).normalize(); rows.push(q === 5 ? [mb.v(c, hex(C.flower))] : [mb.v(c.clone().addScaledVector(side, -w), hex(C.flower)), mb.v(c.clone().addScaledVector(back, -w * .5), hex(C.flower)), mb.v(c.clone().addScaledVector(side, w), hex(C.flower))]); } mb.strip(rows); }
    }
  }
  return { latin: V.latin, common: V.common };
}
export const AROID_VARIANTS = {
  elephant: { label: 'Elephant ear', latin: 'Colocasia esculenta', common: 'Taro / elephant ear', shape: 'heart', peltate: .2, lobe: .3, sinus: .5, cup: .3, veins: 4, hangMin: 25, hangMax: 65, over: { leaves: [6, 10], leafLength: [.7, 1.2] } },
  giant: { label: 'Giant taro', latin: 'Alocasia macrorrhizos', common: 'Giant upright elephant ear', shape: 'heart', peltate: .05, lobe: .3, sinus: .9, cup: .15, veins: 5, elMin: 40, elMax: 80, hangMin: -25, hangMax: 10, palette: { leaf: '#3a8a30', vein: '#78b85a' }, over: { trunk: [.3, 1], leafLength: [1, 1.6], leafWidth: [.75, .95], petiole: [1, 1.8], leaves: [5, 8] } },
  monstera: { label: 'Monstera', latin: 'Monstera deliciosa', common: 'Swiss-cheese plant', shape: 'heart', lobe: .25, sinus: .95, cup: .12, splits: 7, splitDepth: .5, holes: 3, veins: 7, elMin: 30, elMax: 80, hangMin: -5, hangMax: 30, palette: { leaf: '#2c6f2a', leafYoung: '#4f9a3a', petiole: '#4c7a36' }, over: { trunk: [.2, .8], leafLength: [.7, 1.1], leafWidth: [.8, 1], petiole: [.7, 1.2], leaves: [6, 10] } },
  selloum: { label: 'Split-leaf philodendron', latin: 'Thaumatophyllum bipinnatifidum', common: 'Tree philodendron', shape: 'heart', lobe: .3, sinus: .7, cup: .2, splits: 11, splitDepth: .7, veins: 11, elMin: 10, elMax: 70, hangMin: 5, hangMax: 45, palette: { leaf: '#33802e', vein: '#7dbb60' }, over: { trunk: [.2, 1.2], leafLength: [.8, 1.3], leafWidth: [.75, .95], petiole: [.8, 1.4], leaves: [8, 14] } },
  calathea: { label: 'Calathea', latin: 'Calathea orbifolia', common: 'Prayer plant', shape: 'oval', cup: .18, ripple: 1, veins: 12, elMin: 30, elMax: 85, hangMin: 5, hangMax: 35, palette: { leaf: '#4f9a4a', vein: '#c5dcc3', petiole: '#6f8a4a', crown: '#4a3a2a' }, over: { trunk: [0, 0], stemRadius: [.03, .05], leafLength: [.3, .45], leafWidth: [.8, 1], petiole: [.3, .5], leaves: [8, 14], droop: [.1, .4] } },
  peacelily: { label: 'Peace lily', latin: 'Spathiphyllum wallisii', common: 'Peace lily', shape: 'oval', cup: .2, veins: 0, flower: true, elMin: 25, elMax: 80, hangMin: 0, hangMax: 30, palette: { leaf: '#2d6f2c', leafYoung: '#4f9a3a', petiole: '#3f6a30' }, over: { trunk: [0, 0], stemRadius: [.03, .05], leafLength: [.35, .55], leafWidth: [.35, .5], petiole: [.35, .6], leaves: [10, 16], droop: [.1, .4], flower: [1, 1] } },
  xanadu: { label: 'Philodendron Xanadu', latin: 'Thaumatophyllum xanadu', common: 'Xanadu', shape: 'heart', lobe: .2, sinus: .6, cup: .15, splits: 9, splitDepth: .55, veins: 9, elMin: 15, elMax: 75, hangMin: 0, hangMax: 35, palette: { leaf: '#3c8a34', vein: '#88c26a' }, over: { trunk: [0, .2], stemRadius: [.05, .08], leafLength: [.35, .55], leafWidth: [.6, .8], petiole: [.4, .7], leaves: [10, 16] } },
  blackmagic: { label: 'Black taro', latin: 'Colocasia "Black Magic"', common: 'Black elephant ear', shape: 'heart', peltate: .28, lobe: .32, sinus: .5, cup: .35, veins: 4, darkPetiole: true, palette: { leaf: '#2c2233', leafYoung: '#4a3550', vein: '#3d2f45', petioleDark: '#2a1e2f' }, over: { leafLength: [.6, .9] } },
};

/* ───────────────────────── shared leaf helper ─────────────────────────
 * simpleLeaf: an entire (undivided) blade grown from a shared root edge [a,b] of the parent tube.
 * shape: 'lance' (long narrow), 'ovate' (egg), 'obovate' (wide near tip), 'elliptic', 'strap' (yucca/bromeliad)
 */
function simpleLeaf(mb, rootA, rootB, root, fwd, side, nrm, L, W, col, opts = {}) {
  const shape = opts.shape || 'ovate', nR = opts.rows || 5, across = opts.across || 3, droop = opts.droop ?? .35, cup = opts.cup ?? .15, twist = opts.twist || 0, colMid = opts.colMid || col;
  const prof = (v) => {
    switch (shape) {
      case 'lance': return Math.sin(Math.PI * Math.pow(v, .55)) * Math.pow(1 - v, .25);
      case 'strap': return v < .85 ? 1 : (1 - (v - .85) / .15);
      case 'obovate': return Math.sin(Math.PI * Math.pow(v, 1.3));
      case 'elliptic': return Math.sin(Math.PI * v);
      case 'needle': return v < .9 ? .6 + .4 * (1 - v) : (1 - v) / .1 * .6;
      default: return Math.sin(Math.PI * Math.pow(v, .8));
    }
  };
  const rows = [[rootA, rootB]];
  for (let q = 1; q <= nR; q++) {
    const v = q / nR; const hw = W * .5 * prof(v) + .0006;
    const c = root.clone().addScaledVector(fwd, L * v).addScaledVector(nrm, -droop * L * v * v);
    if (q === nR) { rows.push([mb.v(c, col)]); break; }
    const row = [];
    for (let k = 0; k < across; k++) {
      const t = across === 1 ? 0 : (k / (across - 1)) * 2 - 1;
      const tw = twist * v; const s = side.clone().multiplyScalar(Math.cos(tw)).addScaledVector(nrm, Math.sin(tw));
      const n2 = nrm.clone().multiplyScalar(Math.cos(tw)).addScaledVector(side, -Math.sin(tw));
      row.push(mb.v(c.clone().addScaledVector(s, t * hw).addScaledVector(n2, cup * hw * (1 - t * t) * (opts.cupDown ? -1 : 1)), k === (across - 1) / 2 && across % 2 ? colMid : col));
    }
    rows.push(row);
  }
  mb.strip(rows);
}
/** generic pickFace closure for a tube with `sides` sides */
const facePicker = (sides) => { const used = new Set(); return (ring, slot) => { let cnt = 0; for (let k = 0; k < sides; k++) if (used.has(ring * 64 + k)) cnt++; if (cnt >= sides - 2) return null; for (let k = 0; k < sides; k++) { const s = (slot + (k % 2 ? -(k + 1) / 2 : k / 2) + sides * 3) % sides; const key = ring * 64 + s; if (!used.has(key)) { used.add(key); return s; } } return null; }; };

/* ───────────────────────── species: ROSETTE (bromeliads, agaves, yuccas, pineapple) ───────────────────────── */
function genRosette(P, rnd, mb, V = ROSETTE_VARIANTS.bromeliad) {
  const C = { ...PALETTE.rosette, ...(V.palette || {}) }; const hue = (P.hue || 0) * .06;
  const sides = 12; const cr = P.coreRadius; const trunkH = P.trunk || 0;
  mb.part('crown');
  const prof = [[-.03, 0], [0, 1.1]]; const n = Math.max(2, Math.round(trunkH / .15));
  for (let k = 1; k <= n; k++) prof.push([trunkH * k / n, 1.1 - .15 * k / n]);
  const rings = Math.round(lerp(4, 7, P.leaves / 40)); for (let k = 1; k <= rings; k++) prof.push([trunkH + .05 * k, 1 - .12 * k]); prof.push([trunkH + .05 * rings + .03, 0]);
  const core = mb.tube(prof.map(([y, r]) => ({ p: V3(0, y, 0), r: cr * r })), { sides, color: hex(C.core) });
  const pick = facePicker(sides); const N = Math.round(P.leaves); const first = n + 1;
  for (let i = 0; i < N; i++) {
    const age = i / Math.max(1, N - 1);
    const ring = first + Math.min(rings - 2, Math.floor(age * (rings - 1)));
    const az = i * GOLD; const slot = pick(ring, Math.round(az / (2 * Math.PI / sides))); if (slot === null) continue;
    const f = core.face(ring, slot);
    const faceAz = Math.atan2(f.normal.z, f.normal.x);
    const el = lerp(V.elMin ?? 10, V.elMax ?? 80, Math.pow(age, .8)) * D2R + rnd.range(-5, 5) * D2R;
    const d = dirFrom(faceAz + rnd.range(-.12, .12), el);
    const side = d.clone().cross(UP).normalize(); const nrm = side.clone().cross(d).normalize();
    const L = P.leafLength * rnd.range(.85, 1.1) * (age > .85 ? lerp(.5, 1, (1 - age) / .15) : 1), W = P.leafWidth * rnd.range(.9, 1.1);
    const base = age > .8 ? hex(C.leafYoung) : hex(C.leaf);
    let col = shade(base, hue + rnd.range(-.01, .01), 1, rnd.range(.92, 1.08));
    if (V.stripe && i % 2) col = shade(col, 0, .6, 1.3);
    mb.part('leaf');
    simpleLeaf(mb, f.ring[0], f.ring[1], f.center, d, side, nrm, L, W, col, { shape: V.shape || 'strap', rows: Math.round(lerp(4, 8, P.detail)), across: 3, droop: P.droop * lerp(1.2, .4, age) * (V.stiff ? .25 : 1), cup: V.cup ?? .35, cupDown: false, colMid: V.midStripe ? shade(col, 0, .5, 1.35) : col });
    // rigid spine tips on agaves
  }
  // central fruit / inflorescence
  if (V.fruit && P.fruit > .5) {
    const topRing = core.rings[core.length - 2], topC = core.frames[core.length - 2].p; mb.part('fruit');
    const stalkH = V.fruit === 'pineapple' ? P.leafLength * .35 : P.leafLength * (V.fruit === 'agave' ? 4 : .9);
    const stalk = mb.tube([1, 2, 3, 4].map(k => ({ p: topC.clone().addScaledVector(UP, stalkH * k / 4), r: cr * (V.fruit === 'agave' ? .25 : .3) * (1 - .3 * k / 4) })), { sides: 8, start: { ring: topRing, center: topC }, color: hex(C.stalk) });
    const top = stalk.frames[stalk.length - 1].p, tr = stalk.rings[stalk.length - 1];
    if (V.fruit === 'pineapple') {
      const fh = P.leafLength * .45, frad = cr * 1.6;
      const fr = mb.tube([[.05, .7], [.3, 1], [.6, 1], [.85, .8], [1, .45]].map(([t, r]) => ({ p: top.clone().addScaledVector(UP, fh * t), r: frad * r })), { sides: 8, start: { ring: tr, center: top }, color: hex(C.fruitCol) });
      // eyes: bump each face outward
      for (let j = 1; j < fr.length - 1; j++) for (let i = (j % 2); i < 8; i += 2) { let ff; try { ff = fr.face(j, i); } catch { continue; } mb.tube([{ p: ff.center.clone().addScaledVector(ff.normal, .012), r: .014 }, { p: ff.center.clone().addScaledVector(ff.normal, .02), r: 0 }], { sides: 4, start: { ring: ff.ring, center: ff.center }, color: shade(hex(C.fruitCol), 0, 1, .8) }); }
      // crown tuft
      const crownTop = fr.frames[fr.length - 1].p, crownRing = fr.rings[fr.length - 1];
      const tuft = mb.tube([{ p: crownTop.clone().addScaledVector(UP, .02), r: frad * .4 }, { p: crownTop.clone().addScaledVector(UP, .06), r: frad * .3 }, { p: crownTop.clone().addScaledVector(UP, .08), r: 0 }], { sides: 8, start: { ring: crownRing, center: crownTop }, color: hex(C.core) });
      for (let k = 0; k < 6; k++) { let f; try { f = tuft.face(0, k); } catch { continue; } const d = f.normal.clone().addScaledVector(UP, 1.8).normalize(); const side = d.clone().cross(UP).normalize(); simpleLeaf(mb, f.ring[0], f.ring[1], f.center, d, side, side.clone().cross(d).normalize(), P.leafLength * .3, .03, hex(C.leaf), { shape: 'lance', rows: 4, droop: .2 }); }
    } else if (V.fruit === 'agave') {
      // candelabra flower stalk
      for (let k = 0; k < 4; k++) { let ff; try { ff = stalk.face(2 + (k % 2), k * 2); } catch { continue; } const d = ff.normal.clone().addScaledVector(UP, 1.2).normalize(); const b = mb.tube([1, 2, 3].map(q => ({ p: ff.center.clone().addScaledVector(d, .35 * q), r: .02 * (1 - .2 * q) })), { sides: 4, start: { ring: ff.ring, center: ff.center }, color: hex(C.stalk) }); const e = b.frames[b.length - 1].p; mb.tube([[.2, 1.5], [.6, 2.2], [1, 0]].map(([t, r]) => ({ p: e.clone().addScaledVector(UP, .12 * t), r: .02 * r })), { sides: 6, start: { ring: b.rings[b.length - 1], center: e }, color: hex(C.fruitCol) }); }
      mb.tube([[.2, 1.5], [.6, 2.2], [1, 0]].map(([t, r]) => ({ p: top.clone().addScaledVector(UP, .14 * t), r: cr * .25 * r })), { sides: 6, start: { ring: tr, center: top }, color: hex(C.fruitCol) });
    } else {
      // bromeliad bract spike: coloured bracts around the stalk top
      const bracts = 10;
      const tip = mb.tube([{ p: top.clone().addScaledVector(UP, .15), r: cr * .18 }, { p: top.clone().addScaledVector(UP, .2), r: 0 }], { sides: 8, start: { ring: tr, center: top }, color: hex(C.stalk) });
      for (let k = 0; k < bracts; k++) { const src = k < 8 ? stalk : tip; const j = k < 8 ? 3 : 0; let ff; try { ff = src.face(j, k % 8); } catch { continue; } const d = ff.normal.clone().addScaledVector(UP, k < 8 ? .9 : 2).normalize(); const side = d.clone().cross(UP).normalize(); simpleLeaf(mb, ff.ring[0], ff.ring[1], ff.center, d, side, side.clone().cross(d).normalize(), P.leafLength * .35, P.leafWidth * 1.2, hex(C.fruitCol), { shape: 'lance', rows: 4, droop: .1, cup: .5 }); }
    }
  }
  return { latin: V.latin, common: V.common };
}
export const ROSETTE_VARIANTS = {
  bromeliad: { label: 'Bromeliad', latin: 'Guzmania lingulata', common: 'Scarlet star', shape: 'strap', cup: .5, fruit: 'bract', elMin: 15, elMax: 80, palette: { leaf: '#3f8f36', leafYoung: '#62ac48', fruitCol: '#e0322a', stalk: '#d84a2a' }, over: { leaves: [18, 30], leafLength: [.35, .55], leafWidth: [.05, .07], coreRadius: [.03, .045], fruit: [1, 1], droop: [.3, .7] } },
  pineapple: { label: 'Pineapple', latin: 'Ananas comosus', common: 'Pineapple', shape: 'strap', cup: .55, fruit: 'pineapple', stiff: true, elMin: 10, elMax: 80, palette: { leaf: '#5a8a3c', leafYoung: '#7aa64e', fruitCol: '#c8a23a', stalk: '#8a9a4a' }, over: { leaves: [28, 40], leafLength: [.6, 1], leafWidth: [.04, .06], coreRadius: [.04, .06], fruit: [1, 1], droop: [.3, .6] } },
  agave: { label: 'Agave', latin: 'Agave americana', common: 'Century plant', shape: 'lance', cup: .45, stiff: true, spine: true, fruit: 'agave', elMin: 5, elMax: 75, palette: { leaf: '#7f9a86', leafYoung: '#94ad9a', spine: '#4a3020', stalk: '#8a7a5a', fruitCol: '#d8c84a' }, over: { leaves: [20, 34], leafLength: [1, 1.8], leafWidth: [.18, .26], coreRadius: [.1, .16], fruit: [0, 1], droop: [.05, .2] } },
  yucca: { label: 'Yucca', latin: 'Yucca elephantipes', common: 'Spineless yucca', shape: 'lance', cup: .3, stiff: true, elMin: -30, elMax: 85, palette: { leaf: '#3f7f3a', leafYoung: '#5f9a4a', core: '#8a7a62' }, over: { trunk: [.5, 1.4], leaves: [36, 50], leafLength: [.7, 1], leafWidth: [.06, .08], coreRadius: [.08, .11], fruit: [0, 0], droop: [.1, .4] } },
  dracaena: { label: 'Dragon tree', latin: 'Dracaena marginata', common: 'Madagascar dragon tree', shape: 'lance', cup: .2, elMin: -35, elMax: 80, midStripe: false, palette: { leaf: '#3a6f36', leafYoung: '#5a8f46', core: '#8f8272' }, over: { trunk: [.8, 1.8], leaves: [40, 50], leafLength: [.5, .7], leafWidth: [.03, .04], coreRadius: [.05, .07], fruit: [0, 0], droop: [.3, .8] } },
  aechmea: { label: 'Urn plant', latin: 'Aechmea fasciata', common: 'Silver vase bromeliad', shape: 'strap', cup: .6, stripe: true, fruit: 'bract', elMin: 20, elMax: 80, palette: { leaf: '#6f9a80', leafYoung: '#8ab598', fruitCol: '#e88ab0', stalk: '#d87a9a' }, over: { leaves: [14, 22], leafLength: [.4, .6], leafWidth: [.07, .1], coreRadius: [.04, .06], fruit: [1, 1], droop: [.3, .6] } },
};

/* ───────────────────────── species: BAMBOO ───────────────────────── */
function genBamboo(P, rnd, mb, V = BAMBOO_VARIANTS.golden) {
  const C = { ...PALETTE.bamboo, ...(V.palette || {}) }; const hue = (P.hue || 0) * .06;
  const sides = 8; const nC = Math.round(P.culms);
  // clump base: a low mound each culm is extruded from (single shell)
  mb.part('crown');
  const mound = mb.tube([[-.04, 0], [0, 1], [.1, 1.05], [.22, .8], [.3, 0]].map(([y, r]) => ({ p: V3(0, y, 0), r: P.clumpRadius * r })), { sides: 16, color: hex(C.base) });
  const leavesPer = Math.round(lerp(3, 6, P.detail));
  for (let c = 0; c < nC; c++) {
    const az = c * GOLD; const ring = c % 2 ? 1 : 0; const slot = Math.round(az / (2 * Math.PI / 16) + c * 3) % 16;
    let f; try { f = mound.face(ring, slot); } catch { continue; }
    const H = P.height * rnd.range(.7, 1.1), R = P.culmRadius * rnd.range(.8, 1.1);
    const leanDir = f.normal.clone().addScaledVector(UP, -f.normal.dot(UP)).normalize();
    const lean = P.lean * rnd.range(.6, 1.2);
    const nodes = Math.max(6, Math.round(H / P.internode)); const path = [];
    for (let k = 1; k <= nodes * 2; k++) {
      const t = k / (nodes * 2); const y = H * t;
      const p = f.center.clone().addScaledVector(UP, y).addScaledVector(leanDir, lean * H * t * t * .8).addScaledVector(V3(Math.sin(c * 2.1 + t * 3), 0, Math.cos(c * 1.3 + t * 2.4)), .03 * H * t);
      const node = k % 2 === 0; path.push({ p, r: R * (1 - .55 * t) * (node ? 1.08 : 1) });
    }
    path.push({ p: path[path.length - 1].p.clone().addScaledVector(UP, .05), r: 0 });
    mb.part('culm');
    const culm = mb.tube(path, { sides, start: { ring: f.ring, center: f.center }, colorAt: (j) => (j % 2 === 0 && j > 0 ? hex(C.node) : shade(hex(C.culm), hue, 1, rnd.range(.95, 1.05))) });
    // branches with leaf fans from upper nodes
    for (let j = Math.round(culm.length * .35); j < culm.length - 2; j += 2) {
      const nb = rnd.int(2, 3);
      for (let b = 0; b < nb; b++) {
        let ff; try { ff = culm.face(j, (b * 3 + j) % sides); } catch { continue; }
        const d = ff.normal.clone().addScaledVector(UP, rnd.range(.6, 1.3)).normalize();
        const bl = P.internode * rnd.range(1.8, 3);
        const pts = arcPath(ff.center, d, bl, .7, 5);
        mb.part('branch');
        const br = mb.tube(pts.slice(1).map((p, k) => ({ p, r: R * .12 * (1 - .6 * k / 4) + .002 })), { sides: 4, start: { ring: ff.ring, center: ff.center }, color: hex(C.branch) });
        mb.part('leaf');
        for (let l = 0; l < leavesPer * 2; l++) {
          const jj = 1 + (l % (br.length - 2)); const sgn = l % 2 ? 1 : -1;
          const e = br.sideEdge(jj, sgn); const fr = br.frames[jj];
          const dir = fr.B.clone().multiplyScalar(sgn).multiplyScalar(.8).addScaledVector(fr.T, .6).addScaledVector(UP, -.35 * l / leavesPer).normalize();
          const side = dir.clone().cross(UP).normalize(); const nrm = side.clone().cross(dir).normalize();
          simpleLeaf(mb, e.a, e.b, e.mid, dir, side, nrm, P.leafLength * rnd.range(.8, 1.15), P.leafLength * .2, shade(hex(C.leaf), hue + rnd.range(-.01, .01), 1, rnd.range(.9, 1.1)), { shape: 'lance', rows: 4, across: 3, droop: .5, cup: .1 });
        }
      }
    }
  }
  return { latin: V.latin, common: V.common };
}
export const BAMBOO_VARIANTS = {
  golden: { label: 'Golden bamboo', latin: 'Bambusa vulgaris "Vittata"', common: 'Golden bamboo', palette: { culm: '#d2b04a', node: '#a98a34', leaf: '#4f9a3a', branch: '#b09a40', base: '#5a4a32' } },
  giant: { label: 'Giant bamboo', latin: 'Dendrocalamus giganteus', common: 'Giant timber bamboo', palette: { culm: '#6f8a4a', node: '#556a38', leaf: '#3f8a34', branch: '#7f9050' }, over: { height: [12, 20], culmRadius: [.1, .16], culms: [4, 8], internode: [.4, .6], clumpRadius: [.6, 1], leafLength: [.25, .35] } },
  black: { label: 'Black bamboo', latin: 'Phyllostachys nigra', common: 'Black bamboo', palette: { culm: '#2a2226', node: '#3f3438', leaf: '#4a9a3c', branch: '#3a2f33' }, over: { height: [4, 8], culmRadius: [.02, .035], culms: [10, 20], internode: [.22, .3], clumpRadius: [.3, .6], lean: [.05, .2] } },
  buddha: { label: "Buddha's belly", latin: 'Bambusa ventricosa', common: "Buddha's belly bamboo", palette: { culm: '#8fa84a', node: '#6f8a34', leaf: '#4f9a3a', branch: '#8f9a4a' }, over: { height: [3, 6], culmRadius: [.04, .06], culms: [6, 12], internode: [.15, .22], clumpRadius: [.3, .5] } },
  lucky: { label: 'Green bamboo', latin: 'Bambusa multiplex', common: 'Hedge bamboo', palette: { culm: '#7fa84f', node: '#5f8a3a', leaf: '#5aa843', branch: '#7f9a4a' }, over: { height: [3, 6], culmRadius: [.015, .03], culms: [16, 30], internode: [.18, .26], clumpRadius: [.25, .5], leafLength: [.1, .15] } },
};

/* ───────────────────────── species: BROADLEAF (tropical shrubs & small trees) ───────────────────────── */
function genBroadleaf(P, rnd, mb, V = BROADLEAF_VARIANTS.plumeria) {
  const C = { ...PALETTE.broadleaf, ...(V.palette || {}) }; const hue = (P.hue || 0) * .06;
  const sides = 8; const R = P.trunkRadius;
  const leafShape = V.leafShape || 'ovate';
  const colBark = hex(C.bark);
  const leafAt = (tube, j, i, L, W, col, opts) => { let f; try { f = tube.face(j, i); } catch { return; } const d = f.normal.clone().addScaledVector(UP, opts.up ?? .3).normalize(); const side = d.clone().cross(UP).normalize(); if (side.lengthSq() < .5) side.set(1, 0, 0); const nrm = side.clone().cross(d).normalize(); simpleLeaf(mb, f.ring[0], f.ring[1], f.center, d, side, nrm, L, W, col, opts); };
  // recursive branching from faces
  const branch = (parent, j, i, depth, len, rad, dirHint) => {
    let f; try { f = parent.face(j, i); } catch { return; }
    const d = f.normal.clone().multiplyScalar(V.spread ?? .9).addScaledVector(UP, V.upright ?? 1).addScaledVector(dirHint || V3(), .3).normalize();
    const n = 5; const pts = arcPath(f.center, d, len, V.droopBr ?? .15, n, 0);
    const st = pts.slice(1).map((p, k) => ({ p, r: rad * (1 - .35 * k / n) + .003 }));
    st.push({ p: st[st.length - 1].p.clone().addScaledVector(d, .02), r: 0 });   // always capped → no open ring can orphan
    mb.part('branch');
    const t = mb.tube(st, { sides: depth >= 2 ? 5 : sides, start: { ring: f.ring, center: f.center }, color: depth >= 2 ? hex(C.twig) : colBark });
    const isTip = depth >= P.levels;
    if (isTip || V.leavesOnAll) {
      mb.part('leaf');
      const nl = Math.round(P.leafDensity * lerp(.6, 1, P.detail));
      const LS = t.length - 2;
      for (let q = 0; q < nl; q++) {
        const jj = isTip ? Math.max(0, LS - 1 - Math.floor(q / t.sides)) : rnd.int(1, LS - 1);
        const ii = (q * 3 + jj) % t.sides;
        const ageT = q / nl;
        const col = shade(q < 2 ? hex(C.leafYoung) : hex(C.leaf), hue + rnd.range(-.012, .012), 1, rnd.range(.9, 1.08));
        const colMid = V.midVein ? shade(col, 0, .8, 1.35) : col;
        if (V.whorl && isTip && q === 0) {
          // rosette of leaves at the shoot tip (plumeria, schefflera, papaya)
          const tipRing = t.rings[LS - 1] || t.rings[LS]; const centre = t.frames[LS - 1].p;
          for (let w = 0; w < nl; w++) {
            let ff; try { ff = t.face(LS - 1 - (w % 2), (w * 2) % t.sides); } catch { continue; }
            const d2 = ff.normal.clone().addScaledVector(UP, lerp(-.3, .6, (w % 4) / 3)).normalize(); const sd = d2.clone().cross(UP).normalize(); const nm = sd.clone().cross(d2).normalize();
            if (V.palmate) palmateLeaf(mb, ff, d2, sd, nm, P.leafLength, col, V, P);
            else simpleLeaf(mb, ff.ring[0], ff.ring[1], ff.center, d2, sd, nm, P.leafLength * rnd.range(.85, 1.1), P.leafLength * P.leafWidth, col, { shape: leafShape, rows: Math.round(lerp(4, 7, P.detail)), across: 3, droop: V.leafDroop ?? .3, cup: V.cup ?? .15, colMid, twist: V.twist || 0 });
          }
          break;
        }
        leafAt(t, jj, ii, P.leafLength * rnd.range(.85, 1.1), P.leafLength * P.leafWidth, col, { shape: leafShape, rows: Math.round(lerp(4, 7, P.detail)), across: 3, droop: V.leafDroop ?? .3, cup: V.cup ?? .15, up: V.leafUp ?? .3, colMid, twist: V.twist || 0 });
      }
      if (isTip && V.flower && P.flower > .5) flowerAt(t, LS - 1, C, V, mb, rnd);
    }
    if (!isTip) {
      const kids = rnd.int(V.kidsMin ?? 2, V.kidsMax ?? 3);
      for (let k = 0; k < kids; k++) branch(t, t.length - 3 - (k % 2), (k * Math.round(t.sides / kids) + j) % t.sides, depth + 1, len * (V.lenRatio ?? .72), rad * .65, d);
    }
  };
  // trunk
  const H = P.height; mb.part('trunk');
  const nT = 8; const tp = []; const leanAz = rnd.range(0, 6.28);
  for (let k = 0; k <= nT; k++) { const t = k / nT; tp.push({ p: V3(Math.cos(leanAz) * P.lean * H * t * t, H * t, Math.sin(leanAz) * P.lean * H * t * t), r: R * (1 - .3 * t) * (1 + .3 * Math.exp(-t * 6)) }); }
  const single = V.singleStem;
  if (!single) tp.push({ p: tp[nT].p.clone().addScaledVector(UP, .05), r: 0 });
  const trunk = mb.tube(tp, { sides, color: colBark });
  const kids0 = rnd.int(V.kidsMin ?? 2, V.kidsMax ?? 3) + (V.extraTop || 0);
  if (single) {
    // papaya-like: crown of leaves straight from the trunk top ring
    const capTop = tp[nT].p.clone().addScaledVector(UP, .08); mb.tube([{ p: capTop, r: 0 }], { sides, start: { ring: trunk.rings[nT], center: tp[nT].p }, color: colBark });
    mb.part('leaf');
    const nl = Math.round(P.leafDensity);
    for (let q = 0; q < nl; q++) { let ff; try { ff = trunk.face(nT - 1 - (q % 3), (q * 3) % sides); } catch { continue; } const age = q / nl; const d2 = ff.normal.clone().addScaledVector(UP, lerp(-.4, .9, age)).normalize(); const sd = d2.clone().cross(UP).normalize(); const nm = sd.clone().cross(d2).normalize();
      // petiole then palmate blade
      const pts = arcPath(ff.center, d2, P.leafLength * 1.2, .5, 4); const pet = mb.tube(pts.slice(1).map((p, k) => ({ p, r: R * .12 * (1 - .3 * k / 4) + .003 })), { sides: 4, start: { ring: ff.ring, center: ff.center }, color: hex(C.twig) });
      const fr = pet.frames[pet.length - 1]; const flat = fr.T.clone().addScaledVector(UP, -fr.T.dot(UP)).normalize(); const fw = flat.clone().addScaledVector(UP, -.25).normalize(); const sd2 = fw.clone().cross(UP).normalize(); const nm2 = sd2.clone().cross(fw).normalize();
      palmateLeaf(mb, { ring: pet.rings[pet.length - 1], center: fr.p }, fw, sd2, nm2, P.leafLength, shade(hex(C.leaf), hue, 1, rnd.range(.92, 1.08)), V, P, true);
    }
    if (V.fruit && P.flower > .5) { mb.part('fruit'); for (let q = 0; q < 7; q++) { let ff; try { ff = trunk.face(nT - 2 - (q % 2), (q * 5 + 1) % sides); } catch { continue; } const d = ff.normal.clone().addScaledVector(UP, -.3).normalize(); mb.tube([[.15, .8], [.5, 1], [.85, .8], [1, 0]].map(([t, r]) => ({ p: ff.center.clone().addScaledVector(d, .22 * t), r: .06 * r })), { sides: 7, start: { ring: ff.ring, center: ff.center }, color: shade(hex(C.fruit), 0, 1, rnd.range(.9, 1.1)) }); } }
  } else {
    for (let k = 0; k < kids0; k++) branch(trunk, nT - 1 - (k % 2), Math.round(k * sides / kids0), 1, P.branchLength, R * .6, null);
  }
  return { latin: V.latin, common: V.common };
}
/** palmately-lobed blade (papaya, schefflera compound leaf, castor bean) built as N radiating lance leaflets sharing the hub edge */
function palmateLeaf(mb, f, fwd, side, nrm, L, col, V, P, hub = false) {
  const n = V.lobes || 7; const span = (V.lobeSpan || 300) * D2R;
  for (let k = 0; k < n; k++) {
    const a = -span / 2 + span * k / (n - 1);
    const d = fwd.clone().multiplyScalar(Math.cos(a)).addScaledVector(side, Math.sin(a)).normalize();
    const sd = d.clone().cross(nrm).normalize();
    const ia = k % f.ring.length, ib = (k + 1) % f.ring.length;
    simpleLeaf(mb, f.ring[ia], f.ring[ib], f.center, d, sd, nrm, L * (.6 + .4 * Math.cos(a * .6)), L * (V.lobeW || .22), col, { shape: V.lobeShape || 'lance', rows: 4, across: 3, droop: V.leafDroop ?? .35, cup: .1 });
  }
}
function flowerAt(t, j, C, V, mb, rnd) {
  mb.part('flower');
  const n = V.flowersPer || 3;
  for (let q = 0; q < n; q++) {
    let ff; try { ff = t.face(j - (q % 2), (q * 3 + 1) % t.sides); } catch { continue; }
    const d = ff.normal.clone().addScaledVector(UP, .8).normalize();
    const stalk = mb.tube([{ p: ff.center.clone().addScaledVector(d, .03), r: .004 }, { p: ff.center.clone().addScaledVector(d, .06), r: .006 }], { sides: 4, start: { ring: ff.ring, center: ff.center }, color: hex(C.twig) });
    const c = stalk.frames[stalk.length - 1].p, ring = stalk.rings[stalk.length - 1];
    const cone = mb.tube([{ p: c.clone().addScaledVector(d, .01), r: .008 }, { p: c.clone().addScaledVector(d, .02), r: 0 }], { sides: 4, start: { ring, center: c }, color: hex(C.flowerCenter || C.flower) });
    const petals = V.petals || 5; const pr = V.petalLen || .05;
    for (let p = 0; p < petals; p++) { const k = p % 4; let pf; try { pf = k < 4 ? cone.face(0, k) : null; } catch { pf = null; } if (!pf) continue; const pd = pf.normal.clone().multiplyScalar(.8).addScaledVector(d, .8).normalize(); const sd = pd.clone().cross(d).normalize(); simpleLeaf(mb, pf.ring[0], pf.ring[1], pf.center, pd, sd, d.clone(), pr, pr * .7, shade(hex(C.flower), 0, 1, rnd.range(.95, 1.05)), { shape: 'obovate', rows: 3, across: 3, droop: -.2, cup: .3 }); }
  }
}
export const BROADLEAF_VARIANTS = {
  plumeria: { label: 'Frangipani', latin: 'Plumeria rubra', common: 'Frangipani', leafShape: 'obovate', whorl: true, midVein: true, kidsMin: 2, kidsMax: 3, lenRatio: .8, upright: 1.2, spread: .8, flower: true, petals: 5, petalLen: .05, flowersPer: 4, palette: { bark: '#9a9284', twig: '#8a9a6a', leaf: '#3f8a34', leafYoung: '#62a64a', flower: '#fff3e0', flowerCenter: '#f5c842' }, over: { height: [1.2, 2.5], trunkRadius: [.08, .14], levels: [2, 3], branchLength: [.6, 1], leafLength: [.3, .45], leafWidth: [.28, .35], leafDensity: [7, 11], flower: [1, 1] } },
  hibiscus: { label: 'Hibiscus', latin: 'Hibiscus rosa-sinensis', common: 'Chinese hibiscus', leafShape: 'ovate', leavesOnAll: true, kidsMin: 2, kidsMax: 4, lenRatio: .7, upright: 1.4, spread: 1, flower: true, petals: 5, petalLen: .07, flowersPer: 3, palette: { bark: '#6f5f4a', twig: '#5f7a3a', leaf: '#2f7a2c', leafYoung: '#4f9a3a', flower: '#e63946', flowerCenter: '#ffd166' }, over: { height: [.5, 1.2], trunkRadius: [.03, .05], levels: [3, 3], branchLength: [.4, .7], leafLength: [.08, .12], leafWidth: [.6, .75], leafDensity: [6, 10], flower: [1, 1] } },
  croton: { label: 'Croton', latin: 'Codiaeum variegatum', common: 'Garden croton', leafShape: 'elliptic', leavesOnAll: true, kidsMin: 2, kidsMax: 3, lenRatio: .75, upright: 1.6, spread: .7, midVein: true, palette: { bark: '#6a5a48', twig: '#8a6a3a', leaf: '#7a4a2a', leafYoung: '#c8a02a', flower: '#fff' }, over: { height: [.4, .9], trunkRadius: [.025, .04], levels: [2, 3], branchLength: [.3, .5], leafLength: [.15, .25], leafWidth: [.3, .4], leafDensity: [8, 14], flower: [0, 0] } },
  ti: { label: 'Ti plant', latin: 'Cordyline fruticosa', common: 'Hawaiian ti', leafShape: 'lance', whorl: true, kidsMin: 1, kidsMax: 2, lenRatio: .8, upright: 2, spread: .4, leafDroop: .45, twist: .3, palette: { bark: '#8a7a68', twig: '#7a4a5a', leaf: '#7a2a4a', leafYoung: '#c8506a', flower: '#fff' }, over: { height: [.6, 1.6], trunkRadius: [.03, .05], levels: [1, 2], branchLength: [.3, .6], leafLength: [.4, .6], leafWidth: [.18, .24], leafDensity: [10, 16], flower: [0, 0] } },
  schefflera: { label: 'Umbrella tree', latin: 'Schefflera actinophylla', common: 'Queensland umbrella tree', whorl: true, palmate: true, lobes: 8, lobeSpan: 330, lobeW: .28, lobeShape: 'obovate', kidsMin: 2, kidsMax: 3, lenRatio: .75, upright: 1.5, spread: .7, palette: { bark: '#8a8272', twig: '#7a9a5a', leaf: '#2f7a2c', leafYoung: '#52a03f' }, over: { height: [1.5, 3], trunkRadius: [.07, .12], levels: [2, 3], branchLength: [.7, 1.1], leafLength: [.25, .35], leafDensity: [5, 8], flower: [0, 0] } },
  papaya: { label: 'Papaya', latin: 'Carica papaya', common: 'Papaya', singleStem: true, palmate: true, lobes: 7, lobeSpan: 320, lobeW: .3, lobeShape: 'lance', fruit: true, palette: { bark: '#8f8a78', twig: '#a8b070', leaf: '#3f8a34', fruit: '#6fa83a' }, over: { height: [2, 4], trunkRadius: [.08, .13], leafLength: [.35, .5], leafDensity: [9, 14], flower: [1, 1] } },
  rubberfig: { label: 'Rubber fig', latin: 'Ficus elastica', common: 'Rubber plant', leafShape: 'elliptic', leavesOnAll: true, midVein: true, kidsMin: 2, kidsMax: 3, extraTop: 1, lenRatio: .8, upright: 1.6, spread: .5, cup: .25, leafDroop: .25, palette: { bark: '#7a7060', twig: '#6a7a4a', leaf: '#1f4f26', leafYoung: '#8a3a4a' }, over: { height: [.8, 1.6], trunkRadius: [.04, .07], levels: [2, 3], branchLength: [.4, .7], leafLength: [.22, .3], leafWidth: [.45, .55], leafDensity: [10, 16], flower: [0, 0] } },
  bougainvillea: { label: 'Bougainvillea', latin: 'Bougainvillea glabra', common: 'Paper flower', leafShape: 'ovate', leavesOnAll: true, kidsMin: 3, kidsMax: 4, lenRatio: .7, upright: .8, spread: 1.2, droopBr: .5, flower: true, petals: 3, petalLen: .04, flowersPer: 6, palette: { bark: '#6a5a4a', twig: '#7a6a3a', leaf: '#3f8a34', leafYoung: '#5fa348', flower: '#e0308a', flowerCenter: '#fff5d0' }, over: { height: [.6, 1.4], trunkRadius: [.03, .05], levels: [3, 3], branchLength: [.5, .9], leafLength: [.05, .08], leafWidth: [.6, .7], leafDensity: [8, 14], flower: [1, 1] } },
};

/* ───────────────────────── schema / api ───────────────────────── */
export const SPECIES = {
  palm: {
    label: 'Palm', accent: '#e5d33a', gen: genPalm, variants: PALM_VARIANTS,
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
    label: 'Banana', accent: '#34c759', gen: genBanana, variants: BANANA_VARIANTS,
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
  aroid: {
    label: 'Aroid', accent: '#b48cff', gen: genAroid, variants: AROID_VARIANTS,
    params: [
      { key: 'leaves', label: 'Leaves', min: 3, max: 16, step: 1, rnd: [5, 9] },
      { key: 'leafLength', label: 'Leaf length', min: .25, max: 1.8, step: .05, unit: 'm', rnd: [.7, 1.2] },
      { key: 'leafWidth', label: 'Width ratio', min: .3, max: 1.1, step: .05, rnd: [.75, .95] },
      { key: 'petiole', label: 'Petiole length', min: .2, max: 2, step: .05, unit: 'm', rnd: [.6, 1.1] },
      { key: 'stemRadius', label: 'Stem radius', min: .02, max: .2, step: .005, unit: 'm', rnd: [.06, .1] },
      { key: 'trunk', label: 'Trunk height', min: 0, max: 2, step: .05, unit: 'm', rnd: [0, .15] },
      { key: 'droop', label: 'Droop', min: 0, max: 1, step: .05, rnd: [.3, .8] },
      { key: 'flower', label: 'Flower', min: 0, max: 1, step: 1, rnd: [0, 0] },
      { key: 'hue', label: 'Hue shift', min: -1, max: 1, step: .05, rnd: [-.5, .5] },
      { key: 'detail', label: 'Detail', min: .3, max: 1, step: .05, rnd: [.6, .85] },
    ],
  },
  rosette: {
    label: 'Rosette', accent: '#ff8a80', gen: genRosette, variants: ROSETTE_VARIANTS,
    params: [
      { key: 'leaves', label: 'Leaves', min: 8, max: 50, step: 1, rnd: [18, 30] },
      { key: 'leafLength', label: 'Leaf length', min: .2, max: 2, step: .05, unit: 'm', rnd: [.4, .6] },
      { key: 'leafWidth', label: 'Leaf width', min: .02, max: .3, step: .005, unit: 'm', rnd: [.05, .07] },
      { key: 'coreRadius', label: 'Core radius', min: .02, max: .2, step: .005, unit: 'm', rnd: [.03, .05] },
      { key: 'trunk', label: 'Trunk height', min: 0, max: 3, step: .05, unit: 'm', rnd: [0, 0] },
      { key: 'droop', label: 'Droop', min: 0, max: 1, step: .05, rnd: [.3, .7] },
      { key: 'fruit', label: 'Fruit / flower', min: 0, max: 1, step: 1, rnd: [1, 1] },
      { key: 'hue', label: 'Hue shift', min: -1, max: 1, step: .05, rnd: [-.5, .5] },
      { key: 'detail', label: 'Detail', min: .3, max: 1, step: .05, rnd: [.6, .85] },
    ],
  },
  bamboo: {
    label: 'Bamboo', accent: '#d8c84a', gen: genBamboo, variants: BAMBOO_VARIANTS,
    params: [
      { key: 'height', label: 'Height', min: 2, max: 20, step: .1, unit: 'm', rnd: [5, 9] },
      { key: 'culms', label: 'Culms', min: 1, max: 30, step: 1, rnd: [6, 14] },
      { key: 'culmRadius', label: 'Culm radius', min: .01, max: .16, step: .005, unit: 'm', rnd: [.035, .06] },
      { key: 'internode', label: 'Internode', min: .1, max: .6, step: .01, unit: 'm', rnd: [.25, .4] },
      { key: 'clumpRadius', label: 'Clump radius', min: .1, max: 1.2, step: .05, unit: 'm', rnd: [.3, .6] },
      { key: 'lean', label: 'Lean', min: 0, max: .4, step: .01, rnd: [.05, .25] },
      { key: 'leafLength', label: 'Leaf length', min: .08, max: .5, step: .01, unit: 'm', rnd: [.2, .3] },
      { key: 'hue', label: 'Hue shift', min: -1, max: 1, step: .05, rnd: [-.5, .5] },
      { key: 'detail', label: 'Detail', min: .3, max: 1, step: .05, rnd: [.5, .8] },
    ],
  },
  broadleaf: {
    label: 'Shrub & tree', accent: '#ffb454', gen: genBroadleaf, variants: BROADLEAF_VARIANTS,
    params: [
      { key: 'height', label: 'Trunk height', min: .3, max: 5, step: .05, unit: 'm', rnd: [1, 2] },
      { key: 'trunkRadius', label: 'Trunk radius', min: .02, max: .2, step: .005, unit: 'm', rnd: [.05, .1] },
      { key: 'lean', label: 'Lean', min: 0, max: .3, step: .01, rnd: [0, .12] },
      { key: 'levels', label: 'Branch levels', min: 1, max: 3, step: 1, rnd: [2, 3] },
      { key: 'branchLength', label: 'Branch length', min: .2, max: 1.5, step: .05, unit: 'm', rnd: [.5, .9] },
      { key: 'leafLength', label: 'Leaf length', min: .04, max: .6, step: .01, unit: 'm', rnd: [.2, .35] },
      { key: 'leafWidth', label: 'Width ratio', min: .15, max: .9, step: .05, rnd: [.3, .5] },
      { key: 'leafDensity', label: 'Leaves / shoot', min: 3, max: 16, step: 1, rnd: [6, 10] },
      { key: 'flower', label: 'Flowers / fruit', min: 0, max: 1, step: 1, rnd: [1, 1] },
      { key: 'hue', label: 'Hue shift', min: -1, max: 1, step: .05, rnd: [-.5, .5] },
      { key: 'detail', label: 'Detail', min: .3, max: 1, step: .05, rnd: [.6, .85] },
    ],
  },
  fern: {
    label: 'Fern', accent: '#4fd8e0', gen: genFern, variants: FERN_VARIANTS,
    params: [
      { key: 'fronds', label: 'Fronds', min: 5, max: 22, step: 1, rnd: [8, 18] },
      { key: 'frondLength', label: 'Frond length', min: .4, max: 1.4, step: .02, unit: 'm', rnd: [.55, 1.2] },
      { key: 'arch', label: 'Arch', min: .1, max: 1.2, step: .02, rnd: [.35, 1] },
      { key: 'spread', label: 'Base elevation', min: 10, max: 70, step: 1, unit: '°', rnd: [20, 50] },
      { key: 'pinnaPairs', label: 'Pinna pairs', min: 10, max: 34, step: 1, rnd: [16, 28] },
      { key: 'pinnules', label: 'Pinnules / pinna', min: 5, max: 16, step: 1, rnd: [7, 13] },
      { key: 'curl', label: 'Tip curl', min: 0, max: 1, step: .05, rnd: [0, .8] },
      { key: 'trunk', label: 'Trunk height', min: 0, max: 5, step: .1, unit: 'm', rnd: [0, 0] },
      { key: 'hue', label: 'Hue shift', min: -1, max: 1, step: .05, rnd: [-.6, .6] },
      { key: 'detail', label: 'Detail', min: .3, max: 1, step: .05, rnd: [.6, .85] },
    ],
  },
};

/** Flat catalogue: every concrete plant = family (species) + variant. */
export const CATALOGUE = Object.entries(SPECIES).flatMap(([species, d]) => Object.entries(d.variants).map(([variant, v]) => ({ id: `${species}.${variant}`, species, variant, label: v.label, latin: v.latin, accent: d.accent })));
export function variantOf(species, variant) { const vs = SPECIES[species].variants; return vs[variant] || vs[Object.keys(vs)[0]]; }

export function randomParams(species, seed, variant) {
  const rnd = makeRng(seed * 7919 + 17); const P = { seed, variant: variant || Object.keys(SPECIES[species].variants)[0] };
  const over = (variantOf(species, P.variant).over) || {};
  for (const s of SPECIES[species].params) { const r = over[s.key] || s.rnd; let v = rnd.range(r[0], r[1]); v = Math.round(v / s.step) * s.step; P[s.key] = +v.toFixed(4); }
  return P;
}

export function plantName(species, seed) {
  const syll = { palm: ['Ko', 'Pa', 'Lau', 'Ni', 'Ma'], banana: ['Mu', 'Sa', 'Ke', 'La', 'Pi'], fern: ['Fi', 'Dry', 'Ath', 'Pol', 'Ne'], aroid: ['Ta', 'Alo', 'Mon', 'Phi', 'Ca'], rosette: ['Bro', 'Ana', 'Aga', 'Yu', 'Dra'], bamboo: ['Bam', 'Phy', 'Den', 'Tak', 'Chu'], broadleaf: ['Plu', 'Hib', 'Cro', 'Fic', 'Sch'] }[species];
  const rnd = makeRng(seed ^ 0x9e37); return syll[rnd.int(0, syll.length - 1)] + ['ra', 'lo', 'ni', 'ka', 'su'][rnd.int(0, 4)] + '-' + (seed % 4096).toString(16).toUpperCase().padStart(3, '0');
}

/** Generate a plant → { geometry, stats, info } */
export function generatePlant(species, P) {
  const def = SPECIES[species]; if (!def) throw new Error('unknown species ' + species);
  const rnd = makeRng(P.seed); const mb = new MeshBuilder();
  const info = def.gen(P, rnd, mb, variantOf(species, P.variant));
  const g = mb.build();
  const bb = g.boundingBox; const size = bb.getSize(V3());
  const stats = {
    vertices: g.attributes.position.count, triangles: g.index.count / 3,
    height: +size.y.toFixed(2), width: +Math.max(size.x, size.z).toFixed(2),
    parts: mb.parts, tubes: mb.tubes.length,
  };
  return { geometry: g, stats, info: { ...info, name: plantName(species, P.seed), variant: P.variant }, species, params: P };
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
