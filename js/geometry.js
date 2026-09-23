/* ═══════════════ FRONTIER TYRE FORGE — procedural 3D geometry ═══════════════
 * The tyre is a lathe of the 2D cross-section (see tiremath.buildProfile),
 * revolved around the X axis with two material groups:
 *   group 0 — tread band   (uv: u = circumference, v = across tread)
 *   group 1 — sidewalls    (uv: planar projection for branding texture)
 */
import * as THREE from 'three';
import { buildProfile } from './tiremath.js';

export function buildTireGeometry(sz) {
  const { pts, zone } = buildProfile(sz);
  const P = pts.length;
  const SEG = 180;
  const Ro = sz.Ro;

  const positions = new Float32Array((SEG + 1) * P * 3);
  const uvs = new Float32Array((SEG + 1) * P * 2);

  const i0 = zone.indexOf(1), i1 = zone.lastIndexOf(1);

  let vp = 0, vt = 0;
  for (let i = 0; i <= SEG; i++) {
    const a = (i / SEG) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let j = 0; j < P; j++) {
      const { x, r } = pts[j];
      positions[vp++] = x;
      positions[vp++] = r * ca;
      positions[vp++] = r * sa;
      let u = i / SEG, v;
      if (zone[j] === 1) {
        v = (j - i0) / (i1 - i0);
      } else {
        u = 0.5 + (r * ca) / (2 * Ro);     // planar sidewall map
        v = 0.5 + (r * sa) / (2 * Ro);
      }
      uvs[vt++] = u; uvs[vt++] = v;
    }
  }

  const idxTread = [], idxSide = [];
  for (let i = 0; i < SEG; i++) {
    for (let j = 0; j < P - 1; j++) {
      const a = i * P + j, b = (i + 1) * P + j;
      const c = (i + 1) * P + j + 1, d = i * P + j + 1;
      const arr = (zone[j] === 1 && zone[j + 1] === 1) ? idxTread : idxSide;
      arr.push(a, b, d, b, c, d);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  const idx = new Uint32Array(idxTread.length + idxSide.length);
  idx.set(idxTread, 0);
  idx.set(idxSide, idxTread.length);
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.addGroup(0, idxTread.length, 0);
  geo.addGroup(idxTread.length, idxSide.length, 1);
  geo.computeVertexNormals();
  return geo;
}

/* ── procedural rim ──────────────────────────────────────────── */
export function buildRim(sz, opts = {}) {
  const g = new THREE.Group();
  const R = sz.Rr * 0.995;
  const Wd = sz.W * 0.80;
  const spokes = opts.spokes ?? 5;

  const metal = new THREE.MeshStandardMaterial({
    color: opts.color ?? 0x383d45, metalness: 0.82, roughness: 0.32, side: THREE.DoubleSide,
  });
  const dark = new THREE.MeshStandardMaterial({
    color: 0x17191c, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide,
  });
  const accent = new THREE.MeshStandardMaterial({
    color: opts.accent ?? 0xe23b2e, metalness: 0.4, roughness: 0.4,
  });

  /* barrel */
  const barrel = new THREE.Mesh(
    new THREE.CylinderGeometry(R, R, Wd, 48, 1, true).rotateZ(Math.PI / 2), metal);
  g.add(barrel);

  /* rim lips */
  for (const s of [-1, 1]) {
    const lip = new THREE.Mesh(
      new THREE.TorusGeometry(R, 3.4, 10, 48).rotateY(Math.PI / 2), metal);
    lip.position.x = s * Wd / 2;
    g.add(lip);
  }

  /* spokes */
  for (let k = 0; k < spokes; k++) {
    const holder = new THREE.Group();
    const sp = new THREE.Mesh(new THREE.BoxGeometry(Wd * 0.72, R * 0.92, sz.W * 0.13), metal);
    sp.position.y = R * 0.5;
    const taper = new THREE.Mesh(new THREE.BoxGeometry(Wd * 0.5, R * 0.55, sz.W * 0.17), dark);
    taper.position.y = R * 0.42;
    holder.add(sp, taper);
    holder.rotation.x = (k / spokes) * Math.PI * 2;
    g.add(holder);
  }

  /* hub + centre cap */
  const hub = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.30, R * 0.34, Wd * 0.78, 28).rotateZ(Math.PI / 2), metal);
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(R * 0.13, R * 0.13, Wd * 0.82, 20).rotateZ(Math.PI / 2), accent);
  g.add(hub, cap);

  return g;
}
