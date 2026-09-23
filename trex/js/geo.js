/**
 * geo.js — Geometry toolkit for sculpting fossil bone.
 *
 * Bones are not cylinders.  This module builds them out of:
 *   • swept tubes with a rotation-minimising frame and elliptical, flared
 *     cross-sections (long bones, ribs, teeth, phalanges, neural spines)
 *   • bevelled extrusions of lateral-view outlines (skull bones, ilium,
 *     scapula, pubis, ischium, gastralia)
 *   • composite vertebrae (spool-shaped centrum + neural arch + spine +
 *     transverse processes + zygapophyses + chevrons)
 *
 * Everything is merged down to as few BufferGeometries as possible: one draw
 * call per bone rather than one per lump.
 */

import {
  BufferGeometry, BufferAttribute, Float32BufferAttribute, Vector3,
  Matrix4, Euler, Shape, Path, Vector2, ExtrudeGeometry, SphereGeometry, BoxGeometry,
  CylinderGeometry,
} from 'three';

const DEG = Math.PI / 180;

/* ------------------------------------------------------------------ merge */

/** Merge geometries that already carry normals + uvs. Non-indexed output. */
export function mergeGeoms(geoms) {
  const list = geoms.filter(Boolean);
  let count = 0;
  for (const g of list) {
    const ng = g.index ? g.toNonIndexed() : g;
    if (ng !== g) g.userData.__ni = ng;
    count += (ng.attributes.position ? ng.attributes.position.count : 0);
  }
  const pos = new Float32Array(count * 3);
  const nrm = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let o = 0;
  for (const g of list) {
    const ng = g.userData.__ni || (g.index ? g.toNonIndexed() : g);
    const p = ng.attributes.position, n = ng.attributes.normal, t = ng.attributes.uv;
    if (!p) continue;
    pos.set(p.array.subarray(0, p.count * 3), o * 3);
    if (n) nrm.set(n.array.subarray(0, n.count * 3), o * 3);
    if (t) uv.set(t.array.subarray(0, t.count * 2), o * 2);
    o += p.count;
    delete g.userData.__ni;
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new BufferAttribute(pos, 3));
  out.setAttribute('normal', new BufferAttribute(nrm, 3));
  out.setAttribute('uv', new BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

/* --------------------------------------------------------------- helpers */

export function transformGeom(geom, { pos, rot, scale } = {}) {
  const m = new Matrix4();
  const q = new Matrix4();
  if (rot) q.makeRotationFromEuler(new Euler(rot[0] || 0, rot[1] || 0, rot[2] || 0));
  m.identity();
  if (scale) m.scale(new Vector3(scale[0], scale[1], scale[2]));
  m.premultiply(q);
  if (pos) m.premultiply(new Matrix4().makeTranslation(pos[0], pos[1], pos[2]));
  const g = geom.clone();
  g.applyMatrix4(m);
  return g;
}

export function ellipsoidGeom(rx, ry, rz, seg = 16) {
  const g = new SphereGeometry(1, seg, Math.max(8, Math.round(seg * 0.6)));
  g.scale(rx, ry, rz);
  return g;
}

export function boxGeom(w, h, d) {
  return new BoxGeometry(w, h, d, 1, 1, 1);
}

export function cylGeom(rTop, rBottom, h, seg = 12) {
  return new CylinderGeometry(rTop, rBottom, h, seg, 1, false);
}

/* ------------------------------------------------------------------ tube */

/**
 * Sweep a tube along a polyline.
 * @param {Vector3[]} points        centreline samples
 * @param {Array} radii             per-sample [rx, rz] or a number
 * @param {Object} opts             { radialSegments, caps, up0, uvScale }
 * Uses a rotation-minimising (parallel transport) frame so the tube never
 * twists unexpectedly — essential for bowed bones and curved ribs.
 */
export function tubeGeometry(points, radii, opts = {}) {
  const radialSegments = opts.radialSegments ?? 10;
  const caps = opts.caps !== false;
  const up0 = (opts.up0 || new Vector3(0, 0, 1)).clone();
  const uvScale = opts.uvScale ?? 1;
  const n = points.length;

  // tangents
  const tangents = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    const t = new Vector3().subVectors(b, a);
    if (t.lengthSq() < 1e-12) t.set(0, 1, 0);
    tangents.push(t.normalize());
  }

  // parallel transport frame
  const normals = [];
  let nrm = up0.clone().addScaledVector(tangents[0], -up0.dot(tangents[0]));
  if (nrm.lengthSq() < 1e-9) nrm.set(1, 0, 0);
  nrm.normalize();
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      nrm = nrm.clone().addScaledVector(tangents[i], -nrm.dot(tangents[i]));
      if (nrm.lengthSq() < 1e-9) nrm.copy(normals[i - 1]);
      nrm.normalize();
    }
    normals.push(nrm.clone());
  }

  const pos = [], uv = [], idx = [];
  let vLen = 0;
  const vAcc = [0];
  for (let i = 1; i < n; i++) {
    vLen += points[i].distanceTo(points[i - 1]);
    vAcc.push(vLen);
  }

  for (let i = 0; i < n; i++) {
    const t = tangents[i];
    const nn = normals[i];
    const bb = new Vector3().crossVectors(t, nn).normalize();
    const r = typeof radii[i] === 'number' ? [radii[i], radii[i]] : radii[i];
    for (let j = 0; j <= radialSegments; j++) {
      const phi = (j / radialSegments) * Math.PI * 2;
      const c = Math.cos(phi), s = Math.sin(phi);
      const v = new Vector3()
        .addScaledVector(nn, r[0] * c)
        .addScaledVector(bb, r[1] * s);
      pos.push(points[i].x + v.x, points[i].y + v.y, points[i].z + v.z);
      uv.push(j / radialSegments, (vAcc[i] / Math.max(1e-6, vLen)) * uvScale);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < radialSegments; j++) {
      const a = i * (radialSegments + 1) + j;
      const b = a + radialSegments + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }

  const sides = new BufferGeometry();
  sides.setAttribute('position', new Float32BufferAttribute(pos, 3));
  sides.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  sides.setIndex(idx);
  sides.computeVertexNormals();

  if (!caps) return sides;

  const capsGeoms = [];
  for (const end of [0, n - 1]) {
    const t = tangents[end];
    const sign = end === 0 ? -1 : 1;
    const r = typeof radii[end] === 'number' ? [radii[end], radii[end]] : radii[end];
    const cp = [], cuv = [], cidx = [];
    const centre = points[end];
    cp.push(centre.x, centre.y, centre.z); cuv.push(0.5, 0.5);
    const nn = normals[end];
    const bb = new Vector3().crossVectors(t, nn).normalize();
    for (let j = 0; j <= radialSegments; j++) {
      const phi = (j / radialSegments) * Math.PI * 2;
      const v = new Vector3()
        .addScaledVector(nn, r[0] * Math.cos(phi))
        .addScaledVector(bb, r[1] * Math.sin(phi));
      cp.push(centre.x + v.x, centre.y + v.y, centre.z + v.z);
      cuv.push(0.5 + 0.5 * Math.cos(phi), 0.5 + 0.5 * Math.sin(phi));
    }
    for (let j = 0; j < radialSegments; j++) {
      if (sign > 0) cidx.push(0, 1 + j, 2 + j);
      else cidx.push(0, 2 + j, 1 + j);
    }
    const g = new BufferGeometry();
    g.setAttribute('position', new Float32BufferAttribute(cp, 3));
    g.setAttribute('uv', new Float32BufferAttribute(cuv, 2));
    g.setIndex(cidx);
    g.computeVertexNormals();
    capsGeoms.push(g);
  }
  return mergeGeoms([sides, ...capsGeoms]);
}

/** Radius profile helper: shaft with flared epiphyses. */
function flareProfile(t, shaftR, proxR, distR, pFlare, dFlare) {
  const bump = (u) => (u <= 1 ? Math.pow(1 - u, 2.3) : 0);
  return shaftR + (proxR - shaftR) * bump(t / pFlare) + (distR - shaftR) * bump((1 - t) / dFlare);
}

/**
 * A long bone along +Y, proximal end at the origin, distal end at y = length.
 * @param {Object} o { length, shaft, prox, dist, proxFlare, distFlare,
 *                     bow (Vector3 offset at mid-shaft), ellipse [ex,ez],
 *                     radialSegments, samples, twist }
 */
export function longBone(o) {
  const length = o.length;
  const samples = o.samples ?? 14;
  const shaft = o.shaft ?? length * 0.06;
  const prox = o.prox ?? shaft * 2.0;
  const dist = o.dist ?? shaft * 1.8;
  const pFlare = o.proxFlare ?? 0.30;
  const dFlare = o.distFlare ?? 0.28;
  const ex = o.ellipse ? o.ellipse[0] : 1;
  const ez = o.ellipse ? o.ellipse[1] : 1;
  const bow = o.bow || new Vector3();
  const twist = (o.twist || 0) * DEG;

  const pts = [], radii = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const y = t * length;
    const s = Math.sin(Math.PI * t);
    pts.push(new Vector3(bow.x * s, y + (bow.y || 0) * s, bow.z * s));
    const r = flareProfile(t, shaft, prox, dist, pFlare, dFlare);
    radii.push([r * ex, r * ez]);
  }
  const g = tubeGeometry(pts, radii, {
    radialSegments: o.radialSegments ?? 12,
    up0: o.up0 || new Vector3(0, 0, 1),
  });
  if (twist) g.rotateY(twist);
  return g;
}

/* --------------------------------------------------------- flat bones ---- */

/**
 * Bevelled extrusion of a lateral-view outline.
 * Outline coordinates: x = anterior (mm-style, but metres here), y = dorsal.
 * The extrusion runs along +X (the animal's right) after placement.
 */
export function extrudeLateral(outline, thickness, opts = {}) {
  const shape = new Shape();
  shape.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) shape.lineTo(outline[i][0], outline[i][1]);
  shape.closePath();
  const bevel = opts.bevel ?? Math.min(0.02, thickness * 0.35);
  const g = new ExtrudeGeometry(shape, {
    depth: Math.max(0.001, thickness - 2 * bevel),
    bevelEnabled: bevel > 0.0005,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: 2,
    curveSegments: 4,
  });
  // centre the extrusion on the shape's z axis when asked (midline bones)
  g.translate(0, 0, opts.centered ? -thickness / 2 : bevel);
  return g;
}

/**
 * Mirror a (non-indexed or indexed) geometry across the sagittal plane,
 * keeping the winding order correct so normals stay outward-facing.
 */
export function mirrorX(geom) {
  const g = geom.index ? geom.toNonIndexed() : geom.clone();
  const p = g.attributes.position;
  const n = g.attributes.normal;
  const t = g.attributes.uv;
  for (let i = 0; i < p.count; i++) p.setX(i, -p.getX(i));
  if (n) for (let i = 0; i < n.count; i++) n.setX(i, -n.getX(i));
  // reverse triangle winding: swap vertex 1 and 2 of every triangle
  const swap = (attr) => {
    if (!attr) return;
    const arr = attr.array, comp = attr.itemSize;
    for (let i = 0; i + 2 < attr.count; i += 3) {
      for (let c = 0; c < comp; c++) {
        const a = (i + 1) * comp + c, b = (i + 2) * comp + c;
        const tmp = arr[a]; arr[a] = arr[b]; arr[b] = tmp;
      }
    }
    attr.needsUpdate = true;
  };
  swap(p); swap(n); swap(t);
  return g;
}

/**
 * Place a lateral-frame geometry (x = anterior, y = dorsal, z = thickness)
 * into the body frame (+X right, +Y up, -Z forward).
 * @param {BufferGeometry} g
 * @param {Object} o { ant, dor, lat, side, rot, taperEnds }
 *   ant: anterior offset (metres, + = towards the snout)
 *   dor: dorsal offset
 *   lat: lateral offset (0 = midline); side +1 = right, -1 = left
 */
export function placeLateral(g, o) {
  const side = o.side ?? 1;
  // lateral frame -> body frame: x(ant) -> -Z, y(dor) -> +Y, z(thick) -> +X
  const m = new Matrix4().makeRotationY(Math.PI / 2);
  m.premultiply(new Matrix4().makeTranslation(o.lat ?? 0, o.dor ?? 0, -(o.ant ?? 0)));
  let out = g.clone();
  out.applyMatrix4(m);
  if (side < 0) out = mirrorX(out);
  if (o.rot) {
    const e = new Euler((o.rot[0] || 0) * DEG, (o.rot[1] || 0) * DEG, (o.rot[2] || 0) * DEG);
    out.applyMatrix4(new Matrix4().makeRotationFromEuler(e));
  }
  return out;
}

/**
 * Convenience: extrude a lateral-view outline and place it in the body frame.
 * @param {Array} outline [anterior, dorsal] pairs
 */
export function lateralPlate(outline, thickness, o = {}) {
  const g = extrudeLateral(outline, thickness, o);
  return placeLateral(g, o);
}

/* ------------------------------------------------------------- vertebrae */

/**
 * One vertebra: spool-shaped centrum, neural arch + spine, transverse
 * processes, pre/post-zygapophyses, and (for caudals) a haemal arch/chevron.
 */
export function vertebraGeometry(o) {
  const len = o.length;
  const ch = o.centrumHeight ?? len * 0.62;      // centrum dorsoventral
  const cw = o.centrumWidth ?? ch * 0.82;        // centrum mediolateral
  const spineH = o.spineHeight ?? 0;
  const spineL = o.spineLength ?? len * 0.75;
  const spineT = o.spineThickness ?? Math.max(0.022, len * 0.16);
  const transL = o.transverseLength ?? 0;
  const chevronH = o.chevronHeight ?? 0;
  const parts = [];

  // --- centrum: waisted spool along the bone axis (+Y = towards the next
  //     vertebra).  Built as a tube with a radius profile.
  const samples = o.centrumSamples ?? 9;
  const pts = [], radii = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const y = (t - 0.5) * len + len / 2;   // 0 .. len
    const waist = 1 - 0.30 * Math.sin(Math.PI * t);
    const endFlare = 1 + 0.26 * Math.pow(Math.abs(t - 0.5) * 2, 3);
    pts.push(new Vector3(0, y, 0));
    radii.push([cw * 0.5 * waist * endFlare, ch * 0.5 * waist * endFlare]);
  }
  parts.push(tubeGeometry(pts, radii, { radialSegments: o.radialSegments ?? 12, up0: new Vector3(0, 0, 1) }));

  // --- neural arch pedicels + spine
  if (spineH > 0.001) {
    const spineDir = (o.spineRake ?? 0) * DEG;   // + = spine tip leans posteriorly
    const spinePts = [];
    const spineRad = [];
    const sN = 6;
    for (let i = 0; i < sN; i++) {
      const t = i / (sN - 1);
      const y = len * 0.45 - Math.sin(spineDir) * spineH * t;
      const dor = ch * 0.35 + spineH * t;
      spinePts.push(new Vector3(0, y, dor));
      const w = spineT * (1 - 0.35 * t) * (0.85 + 0.3 * Math.pow(t, 2));
      spineRad.push([w * 0.55, spineL * 0.5 * (1 - 0.18 * t)]);
    }
    parts.push(tubeGeometry(spinePts, spineRad, { radialSegments: 8, up0: new Vector3(1, 0, 0) }));

    // pedicel webs (blends the spine into the centrum)
    for (const s of [1, -1]) {
      const web = [];
      const wN = 4;
      for (let i = 0; i < wN; i++) {
        const t = i / (wN - 1);
        web.push(new Vector3(s * cw * 0.22, len * 0.25 + t * len * 0.4, ch * 0.30 + t * ch * 0.15));
      }
      parts.push(tubeGeometry(web, web.map((_, i) => Math.max(0.018, cw * 0.16 * (1 - 0.4 * i / wN))), {
        radialSegments: 6, up0: new Vector3(0, 0, 1),
      }));
    }
  }

  // --- transverse processes / sacral ribs
  if (transL > 0.005) {
    for (const s of [1, -1]) {
      const n = 4;
      const p = [], r = [];
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        p.push(new Vector3(
          s * transL * t,
          len * 0.5 - (o.transverseSweep ?? 0) * t,
          ch * (0.30 + 0.18 * t) + (o.transverseRise ?? 0) * t
        ));
        r.push([Math.max(0.016, cw * 0.20 * (1 - 0.55 * t)), Math.max(0.014, cw * 0.16 * (1 - 0.5 * t))]);
      }
      parts.push(tubeGeometry(p, r, { radialSegments: 7, up0: new Vector3(0, 0, 1) }));
    }
  }

  // --- zygapophyses (articulation tabs, fore and aft)
  const zySize = Math.max(0.018, len * 0.13);
  for (const yy of [-len * 0.02, len * 1.02]) {
    for (const s of [1, -1]) {
      const g = tubeGeometry(
        [new Vector3(s * cw * 0.18, yy, ch * 0.26), new Vector3(s * cw * 0.36, yy + (yy < 0 ? 0.03 : -0.03), ch * 0.34)],
        [zySize * 0.8, zySize * 0.55],
        { radialSegments: 6, up0: new Vector3(0, 0, 1) }
      );
      parts.push(g);
    }
  }

  // --- haemal arch (chevron) below caudal centra
  if (chevronH > 0.005) {
    for (const s of [1, -1]) {
      const p = [
        new Vector3(s * cw * 0.14, len * 0.02, -ch * 0.40),
        new Vector3(s * cw * 0.10, -len * 0.10 - chevronH * 0.18, -ch * 0.40 - chevronH * 0.5),
        new Vector3(s * cw * 0.03, -len * 0.20 - chevronH * 0.40, -ch * 0.40 - chevronH),
      ];
      parts.push(tubeGeometry(p, [Math.max(0.012, len * 0.11), Math.max(0.01, len * 0.08), Math.max(0.006, len * 0.05)], { radialSegments: 6, up0: new Vector3(0, 0, 1) }));
    }
  }

  return mergeGeoms(parts);
}

/* ------------------------------------------------------------------ ribs */

/**
 * A dorsal rib: a strongly curved, tapering sweep from the transverse process
 * down and forward to the sternum region.
 * @param {Object} o { length, curvature (rad of total sweep), shaft, head,
 *                     bow (anterior/posterior bow), radialSegments }
 */
export function ribGeometry(o) {
  const length = o.length;
  const sweep = (o.curvature ?? 100) * DEG;
  const shaft = o.shaft ?? length * 0.022;
  const head = o.head ?? shaft * 2.2;
  const samples = o.samples ?? 16;
  const pts = [], radii = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    // start heading laterally+ventrally, curve ventrally and medially
    const a = sweep * t;
    const lateral = Math.cos(a * 0.9) * (o.spread ?? 1) * length * 0.30;
    const ventral = -length * (0.05 + 0.80 * t);
    const ant = (o.bow ?? 0) * Math.sin(Math.PI * t) * length;
    pts.push(new Vector3(lateral * (o.side ?? 1), ventral, ant));
    const r = head + (shaft - head) * Math.min(1, t / 0.45) * (1 - 0.45 * Math.max(0, t - 0.6));
    radii.push([r * 0.85, r]);
  }
  return tubeGeometry(pts, radii, { radialSegments: o.radialSegments ?? 8, up0: new Vector3(0, 0, 1) });
}

/* ----------------------------------------------------------------- teeth */

/**
 * A tyrannosaur tooth: a recurved, labiolingually thickened cone with
 * serrated (carinate) mesial and distal edges suggested by the cross-section.
 */
export function toothGeometry(o) {
  const length = o.length;
  const base = o.base ?? length * 0.30;      // mesiodistal base length
  const thick = o.thick ?? base * 0.62;      // labiolingual thickness
  const curve = (o.curve ?? 12) * DEG;
  const samples = o.samples ?? 8;
  const pts = [], radii = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const y = -length * t;
    const z = Math.sin(curve * t * 1.6) * length * 0.16;    // recurve posteriorly (+Z = back)
    pts.push(new Vector3(0, y, z));
    const w = base * 0.5 * Math.pow(1 - t, 0.85) * (1 - 0.25 * t);
    radii.push([thick * 0.5 * Math.pow(1 - t, 0.9) * (1 - 0.2 * t), w]);
  }
  return tubeGeometry(pts, radii, { radialSegments: o.radialSegments ?? 8, up0: new Vector3(1, 0, 0) });
}


/**
 * Smooth vertex normals for a NON-indexed geometry by averaging face normals
 * of all vertices that share a position (hash-welded). Gives organic,
 * rounded shading without re-indexing (keeps uvs intact).
 */
export function smoothNormals(geom) {
  const p = geom.attributes.position;
  const n = p.count;
  const nrm = new Float32Array(n * 3);
  const map = new Map();
  const key = (i) => `${Math.round(p.getX(i) * 2e3)}|${Math.round(p.getY(i) * 2e3)}|${Math.round(p.getZ(i) * 2e3)}`;
  const acc = [];
  const ids = new Int32Array(n);
  const a = new Vector3(), b = new Vector3(), c = new Vector3(), e1 = new Vector3(), e2 = new Vector3(), fn = new Vector3();
  for (let i = 0; i < n; i++) {
    const k = key(i);
    let id = map.get(k);
    if (id === undefined) { id = acc.length / 3; map.set(k, id); acc.push(0, 0, 0); }
    ids[i] = id;
  }
  for (let i = 0; i + 2 < n; i += 3) {
    a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
    fn.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a));   // area-weighted
    for (let j = 0; j < 3; j++) {
      const id = ids[i + j] * 3;
      acc[id] += fn.x; acc[id + 1] += fn.y; acc[id + 2] += fn.z;
    }
  }
  for (let i = 0; i < n; i++) {
    const id = ids[i] * 3;
    const x = acc[id], y = acc[id + 1], z = acc[id + 2];
    const l = Math.hypot(x, y, z) || 1;
    nrm[i * 3] = x / l; nrm[i * 3 + 1] = y / l; nrm[i * 3 + 2] = z / l;
  }
  geom.setAttribute('normal', new BufferAttribute(nrm, 3));
  return geom;
}

/**
 * Split triangles (non-indexed) until no edge is longer than maxEdge.
 * Always splits the longest edge at its midpoint, so neighbouring triangles
 * split shared edges identically — no T-junction cracks.
 */
export function subdivideGeometry(geom, maxEdge) {
  const g = geom.index ? geom.toNonIndexed() : geom;
  const p = g.attributes.position, t = g.attributes.uv;
  const outP = [], outT = [];
  const m2 = maxEdge * maxEdge;
  const d2 = (A, B) => (A[0] - B[0]) ** 2 + (A[1] - B[1]) ** 2 + (A[2] - B[2]) ** 2;
  const mid = (A, B) => A.map((v, i) => (v + B[i]) / 2);
  const rec = (A, B, C, ua, ub, uc, depth) => {
    const ab = d2(A, B), bc = d2(B, C), ca = d2(C, A);
    const mx = Math.max(ab, bc, ca);
    if (mx <= m2 || depth > 14) { outP.push(...A, ...B, ...C); outT.push(...ua, ...ub, ...uc); return; }
    if (mx === ab) { const M = mid(A, B), um = mid(ua, ub); rec(A, M, C, ua, um, uc, depth + 1); rec(M, B, C, um, ub, uc, depth + 1); }
    else if (mx === bc) { const M = mid(B, C), um = mid(ub, uc); rec(A, B, M, ua, ub, um, depth + 1); rec(A, M, C, ua, um, uc, depth + 1); }
    else { const M = mid(C, A), um = mid(uc, ua); rec(A, B, M, ua, ub, um, depth + 1); rec(M, B, C, um, ub, uc, depth + 1); }
  };
  for (let i = 0; i + 2 < p.count; i += 3) {
    const P = [0, 1, 2].map((k) => [p.getX(i + k), p.getY(i + k), p.getZ(i + k)]);
    const U = [0, 1, 2].map((k) => (t ? [t.getX(i + k), t.getY(i + k)] : [0, 0]));
    rec(P[0], P[1], P[2], U[0], U[1], U[2], 0);
  }
  const out = new BufferGeometry();
  out.setAttribute('position', new Float32BufferAttribute(outP, 3));
  out.setAttribute('uv', new Float32BufferAttribute(outT, 2));
  return out;
}

/* ------------------------------------------------------------------ misc */

/** Smooth "blobby" mass used for flesh and muscle bulges. */
export function blobGeometry(rx, ry, rz, seg = 16) {
  return ellipsoidGeom(rx, ry, rz, seg);
}

/** Deterministic value noise in [0,1) — used for surface irregularity. */
export function hash3(x, y, z) {
  let h = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return h - Math.floor(h);
}

export function smoothNoise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c = (i, j, k) => hash3(xi + i, yi + j, zi + k);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w
  );
}

/** Push vertices outward by fBm noise — makes flesh and bone look organic. */
export function roughenGeometry(geom, amount, freq, seed = 0) {
  if (!geom.attributes.normal) { if (geom.index) geom.computeVertexNormals(); else smoothNormals(geom); }
  const pos = geom.attributes.position, nrm = geom.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nv = 0.5 + 0.5 * Math.sin(seed + x * freq * 3.1 + y * freq * 1.7 + z * freq * 2.3);
    const d = (smoothNoise3(x * freq + seed, y * freq, z * freq + seed) - 0.4) * 1.4 + (nv - 0.5) * 0.5;
    pos.setXYZ(
      i,
      x + nrm.getX(i) * d * amount,
      y + nrm.getY(i) * d * amount,
      z + nrm.getZ(i) * d * amount
    );
  }
  pos.needsUpdate = true;
  if (geom.index) geom.computeVertexNormals();
  else smoothNormals(geom);
  return geom;
}

export { DEG };
