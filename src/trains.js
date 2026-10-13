import * as THREE from 'three';

/* ============================================================
   TRAINS.JS — modern passenger trains + parallel traffic system
   - 'ground' trains: parallel ground railway, ONCOMING
   - 'mono' trains:   elevated monorail in the air, SAME direction
   - 'cross'/'air':   used by perpendicular crossings (track.js)
   Models face +Z, origin at rail-top centre of the consist.
   ============================================================ */

const MAT = {
  body: new THREE.MeshStandardMaterial({ color: 0xe9edf2, roughness: .35, metalness: .45 }),
  bodyMono: new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: .3, metalness: .4 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x182635, roughness: .15, metalness: .7 }),
  dark: new THREE.MeshStandardMaterial({ color: 0x232830, roughness: .8 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x1f6fd6, roughness: .4, metalness: .3 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xf06423, roughness: .4, metalness: .3 }),
  red: new THREE.MeshStandardMaterial({ color: 0xd8402e, roughness: .4, metalness: .3 }),
  light: new THREE.MeshStandardMaterial({ color: 0x443b20, emissive: 0xffd98a, emissiveIntensity: 2.4 }),
  tail: new THREE.MeshStandardMaterial({ color: 0x330000, emissive: 0xff2a2a, emissiveIntensity: 1.6 }),
};
const unitBox = new THREE.BoxGeometry(1, 1, 1);
function bx(mat, sx, sy, sz, x, y, z, parent) {
  const m = new THREE.Mesh(unitBox, mat);
  m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.castShadow = true;
  parent.add(m); return m;
}

function vehicle(kind, len, isLoco) {
  const g = new THREE.Group();
  const stripe = kind === 'mono' ? MAT.orange : kind === 'cross' ? MAT.red : MAT.blue;
  const body = kind === 'mono' ? MAT.bodyMono : MAT.body;
  const W = kind === 'mono' ? 3.0 : 2.9, H = kind === 'mono' ? 2.9 : 3.1;
  bx(body, W, H, len, 0, H / 2 + .55, 0, g);                       // body
  bx(MAT.glass, W + .06, .95, len * .82, 0, H * .68 + .55, 0, g);  // window band
  bx(stripe, W + .08, .5, len * .99, 0, 1.05, 0, g);               // livery stripe
  bx(MAT.dark, W * .8, .5, len * .8, 0, .3, 0, g);                 // underframe / bogies
  if (kind === 'mono') bx(MAT.dark, 1.4, .9, len * .86, 0, .1, 0, g); // beam saddle
  if (isLoco) {
    const nose = bx(body, W * .92, H * .8, 2.6, 0, H * .45 + .55, len / 2 + .7, g);
    nose.rotation.x = .28;
    bx(MAT.glass, W * .8, .8, .3, 0, H * .72 + .55, len / 2 + 1.55, g);
    const hl = new THREE.Mesh(new THREE.SphereGeometry(.17, 8, 8), MAT.light);
    hl.position.set(-.8, 1.15, len / 2 + 1.9); g.add(hl);
    const hr = hl.clone(); hr.position.x = .8; g.add(hr);
    const tl = new THREE.Mesh(new THREE.SphereGeometry(.13, 8, 8), MAT.tail);
    tl.position.set(-.9, 1.15, -len / 2 - .05); g.add(tl);
    const tr = tl.clone(); tr.position.x = .9; g.add(tr);
  }
  return g;
}

export function buildTrainModel(kind) {
  const train = new THREE.Group();
  const locoLen = 15, carLen = 12, gap = 1.2;
  const parts = [locoLen, carLen, carLen, carLen];
  let total = parts.reduce((a, b) => a + b, 0) + gap * (parts.length - 1);
  let z = total / 2;
  parts.forEach((len, i) => {
    z -= len / 2;
    const v = vehicle(kind, len, i === 0);
    v.position.z = z; train.add(v);
    z -= len / 2 + gap;
  });
  train.userData.length = total;
  return train;
}

/* ---------------- parallel traffic (ground + monorail) ---------------- */
export class ParallelTrains {
  constructor(scene, track) {
    this.track = track;
    this.trains = [];
    const defs = [
      { kind: 'ground', s: 130, speed: -40 },   // oncoming
      { kind: 'ground', s: 430, speed: -40 },   // oncoming
      { kind: 'mono', s: 190, speed: 27 },      // same direction, air
      { kind: 'mono', s: 520, speed: 27 },      // same direction, air
      { kind: 'mono', s: -140, speed: 27 },
    ];
    defs.forEach(d => {
      const group = buildTrainModel(d.kind);
      scene.add(group);
      this.trains.push({ ...d, group });
    });
  }

  update(dt, playerS) {
    for (const t of this.trains) {
      t.s += t.speed * dt;
      let rel = t.s - playerS;
      if (rel > 520) t.s -= 780;
      if (rel < -260) t.s += 780;
      const f = this.track.frameAt(t.s);
      if (!f) { t.group.visible = false; continue; }
      const pose = this.track.railPose(t.kind, f);
      if (!pose) { t.group.visible = false; continue; }
      t.group.visible = true;
      t.group.position.copy(pose.p);
      const sameDir = t.speed >= 0;
      const zAxis = new THREE.Vector3(Math.sin(pose.yaw), 0, Math.cos(pose.yaw));
      if (!sameDir) zAxis.negate();
      const xAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), zAxis).normalize();
      const yAxis = new THREE.Vector3().crossVectors(zAxis, xAxis);
      const m = new THREE.Matrix4().makeBasis(xAxis, yAxis, zAxis);
      t.group.quaternion.setFromRotationMatrix(m);
    }
  }
}
