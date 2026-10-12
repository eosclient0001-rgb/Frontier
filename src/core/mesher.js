// Frontier Road Editor — world mesher
// Turns the Network graph into merged indexed BufferGeometry (clean topology,
// minimal draw calls) plus InstancedMeshes for repeated street furniture.
import * as THREE from 'three';
import { GeoBin, clamp } from './util.js';
import { PROFILES, profileOf, markBetween } from './profiles.js';
import { makePropGeometries } from './props.js';

const DRIVE_FLAT = new Set(['lane', 'bus', 'bike', 'parking', 'shared']);
const MAJOR = new Set(['avenue', 'highway', 'expressway', 'boulevard']);
const MINOR = new Set(['street', 'oneway', 'alley', 'country', 'mountain', 'cobble', 'dirt', 'cycle', 'promenade']);

// lateral right vector for tangent (tx,tz): R = (-tz, 0, tx)
function ribbon(bin, S, arc, d0, d1, yOff = 0, uShift = 0) {
  const n = S.length;
  const base = bin.vcount;
  for (let i = 0; i < n; i++) {
    const s = S[i];
    const x0 = s.x + s.rx * (d0 - s.half), x1 = s.x + s.rx * (d1 - s.half);
    const z0 = s.z + s.rz * (d0 - s.half), z1 = s.z + s.rz * (d1 - s.half);
    const y = s.y + yOff;
    bin.vert(x0, y, z0, 0, 1, 0, d0 + uShift, arc[i]);
    bin.vert(x1, y, z1, 0, 1, 0, d1 + uShift, arc[i]);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2, b = a + 1, c = a + 3, d = a + 2;
    bin.quad(a, b, c, d);
  }
}

// Vertical wall along samples at lateral offset d, between y0(s) and y1(s).
// dir=+1 → normal faces left (−R), dir=-1 → faces right (+R)
function wall(bin, S, arc, d, y0f, y1f, dir = 1) {
  const n = S.length;
  const base = bin.vcount;
  for (let i = 0; i < n; i++) {
    const s = S[i];
    const px = s.x + s.rx * (d - s.half), pz = s.z + s.rz * (d - s.half);
    const Nx = -dir * s.rx, Nz = -dir * s.rz;
    const y0 = y0f(s, i), y1 = y1f(s, i);
    bin.vert(px, y0, pz, Nx, 0, Nz, arc[i], y0);
    bin.vert(px, y1, pz, Nx, 0, Nz, arc[i], y1);
  }
  for (let i = 0; i < n - 1; i++) {
    const A = base + i * 2, B = A + 1, C = A + 3, D = A + 2;
    if (dir === 1) bin.quad(A, B, C, D);
    else bin.quad(A, D, C, B);
  }
}

function underside(bin, S, arc, d0, d1, yOff) {
  // top-facing ribbon flipped → normal down
  const n = S.length;
  const base = bin.vcount;
  for (let i = 0; i < n; i++) {
    const s = S[i];
    const x0 = s.x + s.rx * (d0 - s.half), x1 = s.x + s.rx * (d1 - s.half);
    const z0 = s.z + s.rz * (d0 - s.half), z1 = s.z + s.rz * (d1 - s.half);
    const y = s.y + yOff;
    bin.vert(x0, y, z0, 0, -1, 0, d0, arc[i]);
    bin.vert(x1, y, z1, 0, -1, 0, d1, arc[i]);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2, b = a + 1, c = a + 3, d = a + 2;
    bin.quad(a, d, c, b); // normal down
  }
}

// Prepare samples with tangent/right vectors & half width
function prepare(S, half) {
  const n = S.length;
  for (let i = 0; i < n; i++) {
    const p = S[Math.max(0, i - 1)], q = S[Math.min(n - 1, i + 1)];
    let tx = q.x - p.x, tz = q.z - p.z;
    const l = Math.hypot(tx, tz) || 1;
    tx /= l; tz /= l;
    S[i].tx = tx; S[i].tz = tz;
    S[i].rx = -tz; S[i].rz = tx; // right vector
    S[i].half = half;
  }
  const arc = new Array(n); arc[0] = 0;
  for (let i = 1; i < n; i++) arc[i] = arc[i - 1] + Math.hypot(S[i].x - S[i - 1].x, S[i].z - S[i - 1].z);
  return arc;
}

// Marking strip along boundary at absolute lateral position d (0..W).
// style: sw | sy | dw | dy. `bin` is the material-bin allocator.
function marking(bin, S, arc, d, style) {
  if (style === 'none') return;
  const half = S[0].half;
  const Wm = 0.13;
  // point interpolated along the polyline at arc distance a
  const at = a => {
    let i = 0;
    while (i < S.length - 2 && arc[i + 1] < a) i++;
    const seg = arc[i + 1] - arc[i] || 1;
    const t = clamp((a - arc[i]) / seg, 0, 1);
    const s = S[i], s2 = S[i + 1];
    return {
      x: s.x + (s2.x - s.x) * t,
      z: s.z + (s2.z - s.z) * t,
      y: s.y + (s2.y - s.y) * t,
      rx: s.rx, rz: s.rz,
    };
  };
  const emit = (targetBin, dd0, dd1, a0, a1) => {
    if (a1 - a0 < 0.2) return;
    const steps = Math.max(1, Math.ceil((a1 - a0) / 1.5));
    const base = targetBin.vcount;
    for (let k = 0; k <= steps; k++) {
      const a = a0 + (a1 - a0) * (k / steps);
      const p = at(a);
      const y = p.y + 0.025;
      targetBin.vert(p.x + p.rx * (dd0 - half), y, p.z + p.rz * (dd0 - half), 0, 1, 0, dd0, a);
      targetBin.vert(p.x + p.rx * (dd1 - half), y, p.z + p.rz * (dd1 - half), 0, 1, 0, dd1, a);
    }
    for (let k = 0; k < steps; k++) {
      const a = base + k * 2;
      targetBin.quad(a, a + 1, a + 3, a + 2);
    }
  };
  const A0 = arc[0], A1 = arc[arc.length - 1];
  if (style === 'sw') emit(bin('markWhite'), d - Wm / 2, d + Wm / 2, A0, A1);
  else if (style === 'sy') emit(bin('markYellow'), d - Wm / 2, d + Wm / 2, A0, A1);
  else if (style === 'dy') {
    emit(bin('markYellow'), d - 0.21, d - 0.09, A0, A1);
    emit(bin('markYellow'), d + 0.09, d + 0.21, A0, A1);
  } else if (style === 'dw') {
    const cycle = 6, dash = 3;
    for (let a = A0; a < A1; a += cycle) emit(bin('markWhite'), d - Wm / 2, d + Wm / 2, a, Math.min(a + dash, A1));
  }
}

function diskInto(bin, cx, cy, cz, r, mat) {
  const seg = Math.max(24, Math.round(r * 4));
  const base = bin.vcount;
  bin.vert(cx, cy, cz, 0, 1, 0, cx, cz);
  for (let i = 0; i <= seg; i++) {
    const a = (i / seg) * Math.PI * 2;
    const x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    bin.vert(x, cy, z, 0, 1, 0, x, z);
  }
  for (let i = 0; i < seg; i++) bin.idx.push(base, base + 2 + i, base + 1 + i);
  void mat;
}

// ─────────────────────────────────────────────────────────────────────────
export function buildWorld(net, mats, opt = {}) {
  const bins = {};
  const bin = k => (bins[k] ||= new GeoBin());
  const inst = {}; // key → {parts, mats:[...]} collected matrices
  const instAdd = (key, x, y, z, rot, sx = 1, sy = 1, sz = 1) => (inst[key] ||= []).push({ x, y, z, rot, sx, sy, sz });

  const furniture = opt.furniture !== false;

  // node radii
  const nodeR = new Map();
  for (const [nid, n] of net.nodes) {
    const es = net.edgesAt(nid);
    if (!es.length) continue;
    let r = 0;
    for (const e of es) {
      const P = profileOf(e.profile);
      const half = P.bands.reduce((s, b) => s + b.w, 0) / 2;
      r = Math.max(r, half);
    }
    nodeR.set(nid, es.length >= 2 ? r + 0.7 : r * 0.75);
  }

  const edgePolys = new Map(); // edgeId → coarse polyline for picking

  // ── edges ──────────────────────────────────────────────────────────────
  for (const e of net.edges.values()) {
    const P = profileOf(e.profile);
    const bands = P.bands;
    const W = bands.reduce((s, b) => s + b.w, 0);
    const half = W / 2;
    const rA = nodeR.get(e.a) ?? 1, rB = nodeR.get(e.b) ?? 1;

    let S = net.sampleEdge(e, e.kind === 'rail' ? 3 : 2.5);
    if (S.length < 2) continue;
    const arcFull = prepare(S, half);
    const L = arcFull[arcFull.length - 1];
    if (L < rA + rB + 4) continue; // too short to materialize
    // trim to junction plates
    const trimEnd = L - rB;
    let i0 = 0; while (i0 < S.length - 2 && arcFull[i0] < rA) i0++;
    let i1 = S.length - 1; while (i1 > 1 && arcFull[i1] > trimEnd) i1--;
    S = S.slice(i0, i1 + 1);
    const arc = prepare(S, half);

    // coarse polyline for picking / crossings
    {
      const poly = [];
      for (let i = 0; i < S.length; i += Math.max(1, Math.floor(S.length / 40))) {
        poly.push({ x: S[i].x, z: S[i].z, y: S[i].y, half });
      }
      poly.push({ x: S[S.length - 1].x, z: S[S.length - 1].z, y: S[S.length - 1].y, half });
      edgePolys.set(e.id, poly);
    }

    if (e.kind === 'rail') { buildRail(e, S, arc, half, inst, bin); continue; }

    // surface ribbons + curbs
    let d = 0;
    const binfo = []; // {d0,d1,band}
    for (const b of bands) { binfo.push({ d0: d, d1: d + b.w, band: b }); d += b.w; }

    for (const { d0, d1, band: b } of binfo) {
      if (b.role === 'barrier') {
        // jersey barrier wall
        const bb = bin(b.t);
        wall(bb, S, arc, d0, () => 0, s => b.h, 1);
        wall(bb, S, arc, d1, () => 0, s => b.h, -1);
        ribbon(bb, S, arc, d0, d1, b.h);
        continue;
      }
      ribbon(bin(b.t), S, arc, d0, d1, b.h);
    }
    // curb (vertical) faces between height changes
    for (let j = 1; j < binfo.length; j++) {
      const bl = binfo[j - 1].band, br = binfo[j].band;
      const hl = bl.role === 'barrier' ? 0 : bl.h, hr = br.role === 'barrier' ? 0 : br.h;
      if (Math.abs(hl - hr) < 0.01) continue;
      const dEdge = binfo[j].d0;
      const matKey = hr > hl ? br.t : bl.t; // face belongs to raised side visually; use its texture
      const cb = bin(matKey === 'grass' ? 'concrete' : matKey);
      if (hr > hl) wall(cb, S, arc, dEdge, () => hl, () => hr, 1);
      else wall(cb, S, arc, dEdge, () => hr, () => hl, -1);
    }

    // elevated deck (bridge) treatment
    const maxElev = S.reduce((m, s) => Math.max(m, s.y), 0);
    if (maxElev > 0.4) {
      const dk = bin('concreteSmooth');
      const isUp = s => s.y > 0.35;
      wall(dk, S, arc, 0, s => s.y - 0.85, s => s.y, 1);
      wall(dk, S, arc, W, s => s.y - 0.85, s => s.y, -1);
      underside(bin('dark'), S, arc, 0, W, -0.85);
      // parapets (only where elevated; zero-height elsewhere)
      wall(dk, S, arc, 0, s => s.y, s => s.y + (isUp(s) ? 0.9 : 0), 1);
      wall(dk, S, arc, W, s => s.y, s => s.y + (isUp(s) ? 0.9 : 0), -1);
      // piers
      const spacing = 26;
      for (let a = spacing; a < L - spacing; a += spacing) {
        let i = 0; while (i < S.length - 2 && arc[i] < a) i++;
        const s = S[i];
        if (s.y <= 0.8) continue;
        instAdd('pier', s.x, (s.y - 0.85) / 2, s.z, Math.atan2(s.tx, s.tz), Math.min(W * 0.42, 7), s.y - 0.85, 1.9);
      }
    }

    // lane markings at band boundaries
    for (let j = 0; j <= binfo.length; j++) {
      const bLeft = j > 0 ? binfo[j - 1].band : null;
      const bRight = j < binfo.length ? binfo[j].band : null;
      const style = markBetween(bLeft, bRight);
      if (style === 'none') continue;
      const at = j < binfo.length ? binfo[j].d0 : W;
      const hL = bLeft ? (bLeft.role === 'barrier' ? 0 : bLeft.h) : 0;
      const hR = bRight ? (bRight.role === 'barrier' ? 0 : bRight.h) : 0;
      if (Math.min(hL, hR) > 0.06) continue; // no paint on raised surfaces
      marking(bin, S, arc, at, style);
    }

    // ── street furniture along the edge ─────────────────────────────────
    const details = e.opts.details !== false && furniture;
    if (details && P.lampSpacing) {
      const off = half - 1.1;
      const both = W > 22;
      let sideToggle = 0;
      for (let a = P.lampSpacing * 0.5; a < L; a += P.lampSpacing) {
        let i = 0; while (i < S.length - 2 && arc[i] < a) i++;
        const s = S[i];
        const rotBase = Math.atan2(s.tx, s.tz);
        const faceRoad = r => Math.atan2(-Math.sin(r), -Math.cos(r));
        const sides = both ? [1, -1] : [(sideToggle++ % 2 === 0 ? 1 : -1)];
        for (const sgn of sides) {
          instAdd('lamp', s.x + s.rx * (sgn * off), s.y, s.z + s.rz * (sgn * off),
            sgn > 0 ? faceRoad(rotBase) : rotBase);
        }
      }
    }
    if (details && P.trees) {
      // find verge bands, place trees along their centers
      let dAcc = 0;
      const verges = [];
      for (const b of bands) { if (b.role === 'verge' && b.w >= 1.0) verges.push(dAcc + b.w / 2); dAcc += b.w; }
      for (let k = 0; k < verges.length; k++) {
        const dv = verges[k];
        for (let a = 8 + k * 5; a < L; a += 13) {
          let i = 0; while (i < S.length - 2 && arc[i] < a) i++;
          const s = S[i];
          instAdd('tree', s.x + s.rx * (dv - half), s.y + 0.05, s.z + s.rz * (dv - half), (a * 7.3) % 6.28, 0.9 + ((a * 13.7) % 1) * 0.5);
        }
      }
    }
    // guardrails
    if (P.guardrail) {
      const gb = bin('metal');
      // find outer drivable edges: place just outside shoulders
      let dL = 0, dR = W;
      for (const { d0, band: b } of binfo) if (DRIVE_FLAT.has(b.role)) { dL = d0; break; }
      for (let j = binfo.length - 1; j >= 0; j--) if (DRIVE_FLAT.has(binfo[j].band.role)) { dR = binfo[j].d1; break; }
      wall(gb, S, arc, Math.max(0, dL - 0.9), () => 0.42, () => 0.78, 1);
      wall(gb, S, arc, Math.min(W, dR + 0.9), () => 0.42, () => 0.78, -1);
      for (let a = 2; a < L; a += 4) {
        let i = 0; while (i < S.length - 2 && arc[i] < a) i++;
        const s = S[i];
        for (const dd of [Math.max(0.15, dL - 0.9), Math.min(W - 0.15, dR + 0.9)]) {
          instAdd('gpost', s.x + s.rx * (dd - half), s.y, s.z + s.rz * (dd - half), 0);
        }
      }
    }
    // speed bumps
    if (e.opts.bumps && P.bumpable) {
      const spots = L > 90 ? [0.33, 0.66] : [0.5];
      for (const f of spots) {
        const a = L * f;
        let i = 0; while (i < S.length - 2 && arc[i] < a) i++;
        const s = S[i];
        // span across flat driving bands
        let d0 = half, d1 = -half;
        for (const { d0: b0, d1: b1, band: b } of binfo) {
          if (DRIVE_FLAT.has(b.role) && b.h <= 0.02 && b.role !== 'shared') { d0 = Math.min(d0, b0); d1 = Math.max(d1, b1); }
        }
        if (d1 > d0) instAdd('bump', s.x, s.y, s.z, Math.atan2(s.tx, s.tz), d1 - d0);
      }
    }

    // approach end details (crosswalk, stop line, bollards) are handled in junction pass below
    e._S = S; e._arc = arc; e._W = W; e._binfo = binfo;
  }

  // ── junction plates + crossing furniture ──────────────────────────────
  for (const [nid, n] of net.nodes) {
    const es = net.edgesAt(nid).filter(e => e.kind === 'road');
    if (!es.length) continue;
    const r = nodeR.get(nid) ?? 1;
    const allCobble = es.every(e => e.profile === 'cobble');
    diskInto(bin(allCobble ? 'cobble' : 'asphalt'), n.x, n.elev + 0.012, n.z, r);

    const isMajor = es.filter(e => MAJOR.has(e.profile)).length >= 2 && es.length >= 3;
    const allMinor = es.every(e => MINOR.has(e.profile));
    const hasWalk = es.some(e => profileOf(e.profile).bands.some(b => b.role === 'sidewalk' || b.role === 'walk'));

    for (const e of es) {
      const S = e._S, arc = e._arc, W = e._W, binfo = e._binfo;
      if (!S) continue;
      const atStart = e.a === nid;
      const s0 = atStart ? S[0] : S[S.length - 1];
      // outward direction (away from node)
      const s1 = atStart ? S[Math.min(2, S.length - 1)] : S[Math.max(0, S.length - 3)];
      let ox = s1.x - s0.x, oz = s1.z - s0.z;
      const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
      if (atStart) { ox = -ox; oz = -oz; }
      const Rx = -oz, Rz = ox; // right of outward dir

      // drivable lateral extent (flat bands)
      let d0 = W, d1 = 0;
      for (const { d0: b0, d1: b1, band: b } of binfo) {
        if (DRIVE_FLAT.has(b.role) && b.h <= 0.06) { d0 = Math.min(d0, b0); d1 = Math.max(d1, b1); }
      }
      if (d1 <= d0) continue;

      const dCross = r + 1.3, dStop = r + 0.35;
      // place details along outward direction using local frame at s0
      const frame = (dist, dl) => ({
        x: s0.x + ox * dist + Rx * (dl - W / 2),
        z: s0.z + oz * dist + Rz * (dl - W / 2),
        y: s0.y,
      });

      if (furniture && hasWalk && W > 6) {
        // zebra crossing (stripes parallel to road axis)
        for (let dl = d0 + 0.35; dl < d1 - 0.3; dl += 1.0) {
          const p0 = frame(dCross - 1.2, dl), p1 = frame(dCross + 1.2, dl), p2 = frame(dCross + 1.2, dl + 0.52), p3 = frame(dCross - 1.2, dl + 0.52);
          const mb = bins.markWhite ||= new GeoBin();
          const base = mb.vcount;
          const y = s0.y + 0.03;
          mb.vert(p0.x, y, p0.z, 0, 1, 0, dl, dCross - 1.2);
          mb.vert(p3.x, y, p3.z, 0, 1, 0, dl, dCross + 1.2);
          mb.vert(p2.x, y, p2.z, 0, 1, 0, dl + 0.52, dCross + 1.2);
          mb.vert(p1.x, y, p1.z, 0, 1, 0, dl + 0.52, dCross - 1.2);
          mb.quad(base, base + 1, base + 2, base + 3);
        }
        // bollards at both ends of the crossing
        for (const dl of [d0 - 0.55, d1 + 0.55]) {
          if (dl < 0.4 || dl > W - 0.4) continue;
          const p = frame(dCross, dl);
          instAdd('bollard', p.x, p.y + 0.14, p.z, 0);
        }
      }
      if (furniture && W > 6) {
        // stop line: bands whose travel approaches this node
        for (const { d0: b0, d1: b1, band: b } of binfo) {
          if (!DRIVE_FLAT.has(b.role) || b.role === 'shared' || b.h > 0.06 || !b.dir) continue;
          const approaches = atStart ? b.dir < 0 : b.dir > 0;
          if (!approaches) continue;
          const mb = bins.markWhite ||= new GeoBin();
          const base = mb.vcount;
          const y = s0.y + 0.03;
          const p0 = frame(dStop, b0 + 0.12), p1 = frame(dStop, b1 - 0.12), p2 = frame(dStop + 0.45, b1 - 0.12), p3 = frame(dStop + 0.45, b0 + 0.12);
          mb.vert(p0.x, y, p0.z, 0, 1, 0, b0, dStop);
          mb.vert(p1.x, y, p1.z, 0, 1, 0, b1, dStop);
          mb.vert(p2.x, y, p2.z, 0, 1, 0, b1, dStop + 0.45);
          mb.vert(p3.x, y, p3.z, 0, 1, 0, b0, dStop + 0.45);
          mb.quad(base, base + 1, base + 2, base + 3);
        }
      }
      if (furniture && isMajor) {
        const p = frame(r + 1.1, d1 + 1.15);
        instAdd('signal', p.x, s0.y, p.z, Math.atan2(-ox, -oz));
      } else if (furniture && allMinor && es.length >= 3 && W > 5 && W < 20) {
        const p = frame(r + 0.9, d1 + 1.05);
        instAdd('stop', p.x, s0.y, p.z, Math.atan2(-ox, -oz));
      }
    }
  }

  // ── railway ↔ road level crossings ────────────────────────────────────
  const rails = [...net.edges.values()].filter(e => e.kind === 'rail');
  for (const re of rails) {
    const rp = edgePolys.get(re.id); if (!rp) continue;
    for (const [eid, poly] of edgePolys) {
      const e = net.edges.get(eid);
      if (!e || e.kind !== 'road') continue;
      for (let i = 0; i < rp.length - 1; i++) {
        for (let j = 0; j < poly.length - 1; j++) {
          const hit = segX(rp[i], rp[i + 1], poly[j], poly[j + 1]);
          if (!hit) continue;
            const tx = poly[j + 1].x - poly[j].x, tz = poly[j + 1].z - poly[j].z;
            const tl = Math.hypot(tx, tz) || 1;
            const dx = tx / tl, dz = tz / tl;
            const Rxv = -dz, Rzv = dx;
            const hw = poly[j].half;
            const rot = Math.atan2(dx, dz);
            for (const sgn of [1, -1]) {
              instAdd('crossbuck', hit.x + Rxv * sgn * (hw + 2.2), hit.y, hit.z + Rzv * sgn * (hw + 2.2), sgn > 0 ? rot : rot + Math.PI);
              instAdd('gate', hit.x + Rxv * sgn * (hw + 1.1) - dx * sgn * 2.2, hit.y, hit.z + Rzv * sgn * (hw + 1.1) - dz * sgn * 2.2, sgn > 0 ? rot + Math.PI / 2 : rot - Math.PI / 2);
            }
        }
      }
    }
  }

  // ── manually placed props ─────────────────────────────────────────────
  for (const p of net.props) {
    if (p.type === 'bump') instAdd('bump', p.x, p.y ?? 0, p.z, p.rot, p.w || 7);
    else instAdd(p.type, p.x, p.y ?? 0, p.z, p.rot, p.s || 1);
  }

  // ── bake bins → meshes ────────────────────────────────────────────────
  const group = new THREE.Group();
  let tris = 0;
  for (const [key, b] of Object.entries(bins)) {
    if (!b.idx.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    g.setIndex(b.idx);
    const mesh = new THREE.Mesh(g, mats[key] || mats.asphalt);
    mesh.name = 'surface:' + key;
    group.add(mesh);
    tris += b.idx.length / 3;
  }

  // ── bake instanced props ──────────────────────────────────────────────
  const propGeo = makePropGeometries();
  let instCount = 0;
  for (const [key, list] of Object.entries(inst)) {
    const def = propGeo[key];
    if (!def || !list.length) continue;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), upV = new THREE.Vector3(0, 1, 0);
    def.parts.forEach((part, pi) => {
      const im = new THREE.InstancedMesh(part.geo, mats[part.mat] || mats.dark, list.length);
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        q.setFromAxisAngle(upV, it.rot || 0);
        const sc = key === 'bump'
          ? new THREE.Vector3(it.sx || 7, 1, 1)
          : (key === 'tree' ? new THREE.Vector3(it.sx || 1, it.sx || 1, it.sx || 1) : new THREE.Vector3(it.sx || 1, it.sy || 1, it.sz || 1));
        m4.compose(new THREE.Vector3(it.x, it.y, it.z), q, sc);
        im.setMatrixAt(i, m4);
      }
      im.instanceMatrix.needsUpdate = true;
      im.name = 'inst:' + key + ':' + pi;
      group.add(im);
      instCount += list.length;
      tris += part.geo.index ? (part.geo.index.count / 3) * list.length : list.length * 12;
    });
  }

  return { group, edgePolys, stats: { tris: Math.round(tris), instanced: instCount } };
}

function segX(a, b, c, d) {
  const rx = b.x - a.x, rz = b.z - a.z, sx = d.x - c.x, sz = d.z - c.z;
  const den = rx * sz - rz * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c.x - a.x) * sz - (c.z - a.z) * sx) / den;
  const u = ((c.x - a.x) * rz - (c.z - a.z) * rx) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { x: a.x + rx * t, z: a.z + rz * t, y: a.y + (b.y - a.y) * t };
}

function buildRail(e, S, arc, half, inst, bin) {
  // ballast bed
  ribbon(bin('gravel'), S, arc, half - 2.1, half + 2.1, 0.05);
  // sleepers + rails
  const L = arc[arc.length - 1];
  for (let a = 0.4; a < L; a += 0.72) {
    let i = 0; while (i < S.length - 2 && arc[i] < a) i++;
    const s = S[i];
    inst['sleeper'] ||= [];
    inst['sleeper'].push({ x: s.x, y: s.y + 0.05, z: s.z, rot: Math.atan2(s.rx, s.rz), sx: 1, sy: 1, sz: 1 });
  }
  const rb = bin('railSteel');
  for (const off of [-0.7175, 0.7175]) {
    const d = half + off;
    // rail: vertical sides + head top
    wall(rb, S, arc, d - 0.04, () => 0.05, () => 0.21, 1);
    wall(rb, S, arc, d + 0.04, () => 0.05, () => 0.21, -1);
    ribbon(rb, S, arc, d - 0.04, d + 0.04, 0.21);
  }
  void e;
}
