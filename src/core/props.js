// Frontier Road Editor — instanced street furniture & detail props
// Each prop type = baked unit geometry parts (origin at ground center, facing +Z),
// referenced by material key from the shared material library.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const box = (w, h, d, x = 0, y = 0, z = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
};
const cyl = (rt, rb, h, x = 0, y = 0, z = 0, seg = 10) => {
  const g = new THREE.CylinderGeometry(rt, rb, h, seg);
  g.translate(x, y, z);
  return g;
};
const merge = geos => mergeGeometries(geos, false);

export function makePropGeometries() {
  const defs = {};

  defs.lamp = { parts: [
    { geo: merge([cyl(0.07, 0.12, 9, 0, 4.5, 0), box(0.09, 0.09, 2.1, 0, 8.86, 0.95)]), mat: 'steelDark' },
    { geo: box(0.6, 0.15, 1.15, 0, 8.8, 1.85), mat: 'lampGlow' },
  ]};

  defs.bollard = { parts: [
    { geo: cyl(0.075, 0.08, 0.92, 0, 0.46, 0), mat: 'white' },
    { geo: cyl(0.076, 0.076, 0.14, 0, 0.86, 0), mat: 'reflectRed' },
  ]};

  defs.bump = { parts: [
    { geo: box(1, 0.09, 0.44, 0, 0.045, 0), mat: 'markYellow' },
  ]};

  defs.signal = { parts: [
    { geo: merge([cyl(0.09, 0.12, 6.4, 0, 3.2, 0), box(0.36, 1.12, 0.34, 0, 5.85, 0.12)]), mat: 'steelDark' },
    { geo: box(0.2, 0.2, 0.07, 0, 6.22, 0.32), mat: 'sigRed' },
    { geo: box(0.2, 0.2, 0.07, 0, 5.5, 0.32), mat: 'sigGreen' },
  ]};

  defs.stop = { parts: [
    { geo: cyl(0.05, 0.05, 2.5, 0, 1.25, 0), mat: 'steelDark' },
    { geo: (() => { const g = new THREE.CylinderGeometry(0.5, 0.5, 0.035, 8); g.rotateX(Math.PI / 2); g.translate(0, 2.35, 0); return g; })(), mat: 'white' },
    { geo: (() => { const g = new THREE.CylinderGeometry(0.42, 0.42, 0.04, 8); g.rotateX(Math.PI / 2); g.translate(0, 2.35, 0.012); return g; })(), mat: 'red' },
  ]};

  defs.crossbuck = { parts: [
    { geo: cyl(0.06, 0.07, 3.8, 0, 1.9, 0), mat: 'steelDark' },
    { geo: merge([
      (() => { const g = box(2.6, 0.3, 0.06, 0, 3.4, 0.06); g.rotateZ(Math.PI / 4.4); return g; })(),
      (() => { const g = box(2.6, 0.3, 0.06, 0, 3.4, 0.06); g.rotateZ(-Math.PI / 4.4); return g; })(),
    ]), mat: 'white' },
    { geo: merge([box(0.14, 0.14, 0.08, -0.16, 2.6, 0.1), box(0.14, 0.14, 0.08, 0.16, 2.6, 0.1)]), mat: 'reflectRed' },
  ]};

  defs.gate = { parts: [
    { geo: merge([cyl(0.1, 0.12, 1.15, 0, 0.57, 0), box(0.55, 0.66, 0.45, 0, 0.95, 0)]), mat: 'steelDark' },
    { geo: (() => { // raised striped arm
      const segs = [];
      for (let i = 0; i < 6; i++) segs.push(box(0.92, 0.13, 0.09, 0.75 + i * 0.92, 1.28, 0));
      const m = merge(segs);
      m.translate(-0.3, -1.28, 0); m.rotateZ(0.52); m.translate(0.3, 1.28, 0);
      return m;
    })(), mat: 'red' },
    { geo: (() => {
      const segs = [];
      for (let i = 0; i < 6; i += 2) segs.push(box(0.46, 0.135, 0.095, 0.98 + i * 0.92, 1.28, 0));
      const m = merge(segs);
      m.translate(-0.3, -1.28, 0); m.rotateZ(0.52); m.translate(0.3, 1.28, 0);
      return m;
    })(), mat: 'white' },
  ]};

  defs.sleeper = { parts: [
    { geo: box(2.6, 0.14, 0.26, 0, 0.07, 0), mat: 'trunk' },
  ]};

  defs.pier = { parts: [
    { geo: box(1, 1, 1, 0, 0, 0), mat: 'concreteSmooth' },
  ]};

  defs.gpost = { parts: [
    { geo: box(0.09, 0.6, 0.09, 0, 0.3, 0), mat: 'steelDark' },
  ]};

  defs.tree = { parts: [
    { geo: cyl(0.11, 0.2, 2.3, 0, 1.15, 0), mat: 'trunk' },
    { geo: (() => { const g = new THREE.IcosahedronGeometry(1.55, 1); g.translate(0, 3.35, 0); return g; })(), mat: 'foliage' },
  ]};

  defs.cone = { parts: [
    { geo: merge([cyl(0.03, 0.16, 0.62, 0, 0.33, 0, 14), box(0.44, 0.045, 0.44, 0, 0.02, 0)]), mat: 'orange' },
  ]};

  defs.portal = { parts: [
    { geo: merge([
      box(0.9, 5.4, 11, -4.35, 2.2, -1.5),
      box(0.9, 5.4, 11, 4.35, 2.2, -1.5),
      box(9.6, 0.95, 11, 0, 5.3, -1.5),
      box(5.4, 2.9, 0.8, -7.3, 0.95, 3.2),
      box(5.4, 2.9, 0.8, 7.3, 0.95, 3.2),
      box(0.7, 1.1, 11.6, -4.7, 6.3, -1.5),
      box(0.7, 1.1, 11.6, 4.7, 6.3, -1.5),
    ]), mat: 'concreteSmooth' },
    { geo: box(7.8, 4.6, 10.6, 0, 1.85, -1.6), mat: 'black' },
  ]};

  defs.vent = { parts: [
    { geo: box(3.2, 1.5, 2.1, 0, 0.75, 0), mat: 'concreteSmooth' },
    { geo: merge([box(2.8, 0.14, 1.7, 0, 1.56, 0), box(2.4, 0.3, 1.3, 0, 1.7, 0)]), mat: 'dark' },
  ]};

  defs.hydrant = { parts: [
    { geo: merge([cyl(0.13, 0.16, 0.62, 0, 0.31, 0), cyl(0.09, 0.09, 0.16, 0, 0.68, 0), box(0.34, 0.12, 0.12, 0, 0.42, 0)]), mat: 'red' },
  ]};

  defs.bench = { parts: [
    { geo: merge([box(1.8, 0.08, 0.5, 0, 0.46, 0), box(0.1, 0.46, 0.4, -0.8, 0.23, 0), box(0.1, 0.46, 0.4, 0.8, 0.23, 0), box(1.8, 0.5, 0.07, 0, 0.75, -0.24)]), mat: 'trunk' },
  ]};

  return defs;
}

export const PROP_PALETTE = [
  { type: 'lamp', name: 'Street lamp', desc: '9 m mast · warm LED head' },
  { type: 'bollard', name: 'Bollard', desc: 'protects corners & medians' },
  { type: 'bump', name: 'Speed bump', desc: 'paint tool: click a road' },
  { type: 'signal', name: 'Traffic signal', desc: 'pole head, R/G lamps' },
  { type: 'stop', name: 'Stop sign', desc: 'octagon on mast' },
  { type: 'crossbuck', name: 'Railway crossbuck', desc: 'X-sign with lights' },
  { type: 'gate', name: 'Level-crossing gate', desc: 'striped arm, raised' },
  { type: 'portal', name: 'Subway portal', desc: 'metro tunnel mouth' },
  { type: 'vent', name: 'Subway vent shaft', desc: 'underground air shaft' },
  { type: 'tree', name: 'Street tree', desc: 'canopy + trunk' },
  { type: 'cone', name: 'Traffic cone', desc: 'PvP chicane material' },
  { type: 'hydrant', name: 'Hydrant', desc: 'red fire hydrant' },
  { type: 'bench', name: 'Bench', desc: 'wooden street bench' },
];
