import * as THREE from 'three';
import { buildTrainModel } from './trains.js';

/* ============================================================
   TRACK.JS — Infinite procedural wide-track generator
   - Spine frames every STEP metres, grouped into chunks
   - Y-splits (lateral fork) + Up/Down splits (bridge line)
   - Parallel ground railway (oncoming) + air monorail (same dir)
   - Perpendicular ground level-crossings + aerial rail bridges
   - Overhead gantries, bridge pillars, modern-city buildings
   ============================================================ */

export const STEP = 10;              // metres between spine frames
export const TRACK_WIDTH = 19;       // main track width (wide!)
const HALF = TRACK_WIDTH / 2;
const CHUNK = 6;                     // frames per chunk (60 m)

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
const sstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------------- textures (canvas, no external assets) ---------------- */
function roadTexture() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#3a414e'; x.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 2600; i++) { // asphalt speckle
    x.fillStyle = Math.random() > .5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.09)';
    x.fillRect(Math.random() * 512, Math.random() * 256, 2, 2);
  }
  // red / white chevron kerbs (alternates every tile along v)
  for (let i = 0; i < 2; i++) {
    x.fillStyle = i ? '#e8ecf1' : '#d8402e';
    x.fillRect(0, i * 128, 20, 128); x.fillRect(492, i * 128, 20, 128);
  }
  x.fillStyle = '#f06423'; x.fillRect(28, 0, 7, 256); x.fillRect(477, 0, 7, 256);   // WipEout edge strips
  x.fillStyle = '#eef2f7'; x.fillRect(46, 0, 6, 256); x.fillRect(460, 0, 6, 256);   // edge lines
  x.fillStyle = 'rgba(238,242,247,.92)'; x.fillRect(248, 26, 16, 120);             // centre dash
  x.fillStyle = 'rgba(255,255,255,.05)'; x.fillRect(128, 0, 3, 256); x.fillRect(381, 0, 3, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function facadeTexture(base, win, seed) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d'); const r = mulberry32(seed);
  x.fillStyle = base; x.fillRect(0, 0, 256, 256);
  for (let fy = 8; fy < 244; fy += 22) for (let fx = 8; fx < 244; fx += 20) {
    const lit = r();
    x.fillStyle = lit > .82 ? '#ffe9b0' : win;
    x.globalAlpha = .55 + r() * .45; x.fillRect(fx, fy, 13, 14);
  }
  x.globalAlpha = 1; x.fillStyle = 'rgba(0,0,0,.18)'; x.fillRect(0, 248, 256, 8);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function signTexture(text, sub, color = '#f06423') {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const x = c.getContext('2d');
  x.fillStyle = '#1c2735'; x.fillRect(0, 0, 512, 128);
  x.fillStyle = color; x.fillRect(0, 0, 512, 10); x.fillRect(0, 118, 512, 10);
  x.fillStyle = '#fff'; x.font = '900 44px Arial'; x.textAlign = 'center';
  x.fillText(text, 256, 62);
  x.fillStyle = '#ffb38f'; x.font = '700 22px Arial'; x.fillText(sub, 256, 98);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function groundTexture() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 256;
  const x = c.getContext('2d');
  x.fillStyle = '#878d94'; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) { x.fillStyle = Math.random() > .5 ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.07)'; x.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
  x.strokeStyle = 'rgba(50,58,68,.55)'; x.lineWidth = 5; x.strokeRect(0, 0, 256, 256);
  x.strokeStyle = 'rgba(255,255,255,.28)'; x.lineWidth = 2; x.setLineDash([14, 12]);
  x.beginPath(); x.moveTo(128, 0); x.lineTo(128, 256); x.stroke();
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(220, 220); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function makeGround() {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400),
    new THREE.MeshStandardMaterial({ map: groundTexture(), roughness: .96, metalness: 0 })
  );
  m.rotation.x = -Math.PI / 2; m.position.y = -0.08; m.receiveShadow = true;
  return m;
}

/* ---------------- shared materials / geometry ---------------- */
let MATS = null;
function mats() {
  if (MATS) return MATS;
  const facades = [
    ['#c8ccd2', '#31435c', 11], ['#9fb4c8', '#22384f', 23], ['#d8d2c4', '#3c4c5e', 37],
    ['#aebfd2', '#1f3247', 41], ['#c2c9d4', '#46586c', 53],
  ].map(([b, w, s]) => new THREE.MeshStandardMaterial({ map: facadeTexture(b, w, s), roughness: .85 }));
  MATS = {
    road: new THREE.MeshStandardMaterial({ map: roadTexture(), roughness: .82, metalness: .12 }),
    barrier: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .55, metalness: .25, side: THREE.DoubleSide }),
    skirt: new THREE.MeshStandardMaterial({ color: 0x272d38, roughness: .9, side: THREE.DoubleSide }),
    accent: new THREE.MeshStandardMaterial({ color: 0x381a08, emissive: 0xf06423, emissiveIntensity: 1.5, roughness: .4 }),
    accentBlue: new THREE.MeshStandardMaterial({ color: 0x0a2038, emissive: 0x1f6fd6, emissiveIntensity: 1.1, roughness: .4 }),
    pillar: new THREE.MeshStandardMaterial({ color: 0xb9c1ca, roughness: .85 }),
    ballast: new THREE.MeshStandardMaterial({ color: 0x6e7379, roughness: 1, side: THREE.DoubleSide }),
    sleeper: new THREE.MeshStandardMaterial({ color: 0x3a3632, roughness: 1, side: THREE.DoubleSide }),
    steel: new THREE.MeshStandardMaterial({ color: 0xc7cfd8, roughness: .3, metalness: .85, side: THREE.DoubleSide }),
    beam: new THREE.MeshStandardMaterial({ color: 0xd6dce3, roughness: .6, metalness: .2, side: THREE.DoubleSide }),
    gantry: new THREE.MeshStandardMaterial({ color: 0x39434f, roughness: .6, metalness: .5 }),
    roof: new THREE.MeshStandardMaterial({ color: 0x596270, roughness: .95 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x4d8a4a, roughness: 1 }),
    lampOff: new THREE.MeshStandardMaterial({ color: 0x330d0d, emissive: 0x550000, emissiveIntensity: .4 }),
    facades,
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(.5, .5, 1, 8),
  };
  return MATS;
}
function box(mat, sx, sy, sz, x, y, z, ry = 0, parent = null) {
  const m = new THREE.Mesh(mats().box, mat);
  m.scale.set(sx, sy, sz); m.position.set(x, y, z); m.rotation.y = ry;
  if (parent) parent.add(m);
  return m;
}

/* ============================================================ TRACK SYSTEM */
export class TrackSystem {
  constructor(scene) {
    this.scene = scene;
    this.frames = new Map();          // index -> frame
    this.firstFrame = 0; this.lastFrame = -1;
    this.chunks = new Map();          // startIndex -> Group
    this.nextChunk = 0;
    this.crossings = [];              // active perpendicular crossings
    this.rng = mulberry32(20261013);

    // generator state
    this.gPos = new THREE.Vector3(0, 0, 0);
    this.gYaw = 0; this.gPitch = 0; this.gBank = 0;
    this.gYawRate = 0; this.gYawTarget = 0; this.curveTimer = 6;
    this.gPitchTarget = 0; this.elevTargetY = 0; this.elevTimer = 10;
    this.split = { active: false, type: 'y', t: 0, len: 30, nextIn: 42 };
    this.levelTimer = 0;                       // forced flat/straight for ground crossing
    this.nextGroundIn = 78; this.nextAirIn = 40;
    this.sector = 1;

    for (let i = 0; i < 170; i++) this.genFrame();
  }

  /* ---------------- spine generation ---------------- */
  genFrame() {
    const r = this.rng, i = this.lastFrame + 1;

    // --- splits state machine ---
    let splitType = 'none', splitAmt = 0;
    if (!this.split.active) {
      if (--this.split.nextIn <= 0) {
        this.split.active = true; this.split.t = 0;
        this.split.type = (i % 2 === 0) ? 'y' : 'ud';
        if (r() < .5) this.split.type = this.split.type === 'y' ? 'ud' : 'y';
      }
    }
    if (this.split.active) {
      const t = this.split.t++, L = this.split.len;
      splitType = this.split.type;
      splitAmt = t < 8 ? sstep(t / 8) : (t > L - 9 ? sstep((L - t) / 9) : 1);
      if (t >= L) { this.split.active = false; this.split.nextIn = 52 + Math.floor(r() * 38); }
    }

    // --- crossings scheduling ---
    let crossing = null;
    if (--this.nextGroundIn === 22) this.levelTimer = 22;         // level out & straighten
    if (this.nextGroundIn <= 0 && !this.split.active) {
      crossing = 'ground'; this.nextGroundIn = 95 + Math.floor(r() * 70);
    } else if (this.nextGroundIn <= 0) this.nextGroundIn = 6;
    if (--this.nextAirIn <= 0 && splitAmt < .1) {
      crossing = crossing || 'air'; this.nextAirIn = 68 + Math.floor(r() * 55);
    } else if (this.nextAirIn <= 0) this.nextAirIn = 5;
    if (this.levelTimer > 0) this.levelTimer--;

    // --- curve / elevation targets ---
    if (--this.curveTimer <= 0) {
      this.curveTimer = 7 + Math.floor(r() * 9);
      const roll = r();
      this.gYawTarget = roll < .34 ? 0 : (r() < .5 ? -1 : 1) * (0.012 + r() * 0.036);
    }
    if (--this.elevTimer <= 0) {
      this.elevTimer = 12 + Math.floor(r() * 16);
      const roll = r(), y = this.gPos.y;
      if (roll < .38) this.elevTargetY = clamp(y + (r() - .5) * 4, 0, 30);
      else if (roll < .69) this.elevTargetY = clamp(y + 9 + r() * 15, 4, 34);   // climb -> bridges
      else this.elevTargetY = clamp(y - 9 - r() * 14, 0, 30);                  // descend
    }
    const levelling = this.levelTimer > 0 || this.nextGroundIn < 26;
    if (levelling) { this.gYawTarget = 0; this.elevTargetY = 0; }
    if (splitType !== 'none') this.gYawTarget = clamp(this.gYawTarget, -.016, .016);

    this.gYawRate += clamp(this.gYawTarget - this.gYawRate, -.0022, .0022);
    const pitchWant = levelling
      ? clamp((0 - this.gPos.y) * .02, -.07, .02)
      : clamp((this.elevTargetY - this.gPos.y) * .016, -.088, .098);
    this.gPitch += (pitchWant - this.gPitch) * .12;
    this.gYaw += this.gYawRate;
    const bankWant = clamp(-this.gYawRate * 6.5, -.38, .38);
    this.gBank += (bankWant - this.gBank) * .08;

    const fwd = new THREE.Vector3(
      Math.sin(this.gYaw) * Math.cos(this.gPitch), Math.sin(this.gPitch),
      Math.cos(this.gYaw) * Math.cos(this.gPitch)).normalize();
    if (i > 0) {
      this.gPos.addScaledVector(fwd, STEP);
      if (this.gPos.y < 0) { this.gPos.y = 0; this.gPitch = Math.max(this.gPitch, 0); }
    }
    const rightH = new THREE.Vector3(Math.cos(this.gYaw), 0, -Math.sin(this.gYaw));
    const right = rightH.clone();
    const up = new THREE.Vector3().crossVectors(fwd, right).normalize();
    // apply banking (roll right/up around forward)
    const cb = Math.cos(this.gBank), sb = Math.sin(this.gBank);
    const bRight = right.clone().multiplyScalar(cb).addScaledVector(up, sb);
    const bUp = up.clone().multiplyScalar(cb).addScaledVector(right, -sb);

    const frame = {
      i, p: this.gPos.clone(), yaw: this.gYaw, pitch: this.gPitch, bank: this.gBank,
      fwd, right: bRight, up: bUp, rightH,
      splitType, splitAmt, crossing,
      elevated: this.gPos.y > 3.2,
    };
    this.frames.set(i, frame);
    this.lastFrame = i;
    return frame;
  }

  frame(idx) { return this.frames.get(idx); }

  /** Interpolated frame at arc-distance s (metres). Returns null if not generated. */
  frameAt(s) {
    const f0 = Math.floor(s / STEP), fr = (s - f0 * STEP) / STEP;
    const a = this.frames.get(f0), b = this.frames.get(f0 + 1);
    if (!a) return null;
    if (!b) return { p: a.p, yaw: a.yaw, pitch: a.pitch, fwd: a.fwd, right: a.right, rightH: a.rightH, up: a.up };
    let dy = b.yaw - a.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
    return {
      p: a.p.clone().lerp(b.p, fr),
      yaw: a.yaw + dy * fr, pitch: lerp(a.pitch, b.pitch, fr),
      fwd: a.fwd.clone().lerp(b.fwd, fr).normalize(),
      right: a.right.clone().lerp(b.right, fr).normalize(),
      rightH: a.rightH.clone().lerp(b.rightH, fr).normalize(),
      up: a.up.clone().lerp(b.up, fr).normalize(),
    };
  }

  /** Branch ('A' main / 'B' split) pose at a frame. */
  branchPose(f, branch) {
    let lat = 0, upOff = 0, width = TRACK_WIDTH;
    if (f.splitAmt > 0.001) {
      const a = f.splitAmt;
      if (f.splitType === 'y') {
        lat = (branch === 'A' ? -1 : 1) * a * 11.5;
        width = lerp(TRACK_WIDTH, 12.5, a);
      } else { // ud
        lat = (branch === 'A' ? -1 : 1) * a * 2.5;
        upOff = branch === 'B' ? a * 11 : 0;
        width = lerp(TRACK_WIDTH, branch === 'B' ? 13 : 16, a);
      }
    }
    const pos = f.p.clone().addScaledVector(f.right, lat).addScaledVector(f.up, upOff);
    return { pos, halfW: width / 2, width, lat, upOff };
  }

  railPose(kind, f) { // pose for parallel trains
    if (!f) return null;
    if (kind === 'ground') {
      const p = f.p.clone().addScaledVector(f.rightH, -(HALF + 10.5)); p.y = 0.55;
      return { p, yaw: f.yaw };
    }
    const p = f.p.clone().addScaledVector(f.rightH, HALF + 10.5);
    p.y = Math.max(f.p.y + 1.0, 7.5) + .95;
    return { p, yaw: f.yaw };
  }

  /* ---------------- geometry builders ---------------- */
  stripGeo(list, uvScale = 12) {
    // list: array of frames each = array of {pos, color?, uv?}
    const n = list[0].length, pos = [], col = [], uv = [], idx = [];
    list.forEach((row, j) => row.forEach((v, k) => {
      pos.push(v.pos.x, v.pos.y, v.pos.z);
      const c = v.color || { r: 1, g: 1, b: 1 };
      col.push(c.r, c.g, c.b);
      uv.push(v.u ?? (k / (n - 1)), (v.v ?? j * STEP / uvScale));
    }));
    for (let j = 0; j < list.length - 1; j++) for (let k = 0; k < n - 1; k++) {
      const a = j * n + k, b = a + 1, c = a + n, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }

  buildBranchRibbon(group, frames, branch) {
    const M = mats();
    const roadRows = [], barrierL = [], barrierR = [], skirtRows = [], accL = [], accR = [];
    const cRoad = new THREE.Color(1, 1, 1);
    const cBar = new THREE.Color(0xd9dfe7), cBarTop = new THREE.Color(0xf4f7fa),
      cBarFoot = new THREE.Color(0x9aa5b1), cSkirt = new THREE.Color(0x272d38),
      cShoulder = new THREE.Color(0x59626e);
    frames.forEach(f => {
      const bp = this.branchPose(f, branch), hw = bp.halfW;
      const pt = (lat, up) => bp.pos.clone().addScaledVector(f.right, lat).addScaledVector(f.up, up);
      roadRows.push([-hw, -hw * .45, 0, hw * .45, hw].map((lat, k) =>
        ({ pos: pt(lat, k === 2 ? .07 : .03), color: cRoad, u: (lat + hw) / (hw * 2), v: f.i * STEP / 12 })));
      const prof = [[-2.5, -.9, cSkirt], [-2.5, 1.0, cBar], [-2.0, 1.12, cBarTop], [-2.0, .1, cBarFoot], [0, .04, cShoulder]];
      barrierL.push(prof.map(([o, u2, c]) => ({ pos: pt(-hw + o, u2), color: c })));
      barrierR.push(prof.map(([o, u2, c]) => ({ pos: pt(hw - o, u2), color: c })));
      skirtRows.push([{ pos: pt(-hw - 2.5, -.9), color: cSkirt }, { pos: pt(hw + 2.5, -.9), color: cSkirt }]);
      accL.push([{ pos: pt(-hw + .18, .1), color: cRoad }, { pos: pt(-hw + .62, .1), color: cRoad }]);
      accR.push([{ pos: pt(hw - .62, .1), color: cRoad }, { pos: pt(hw - .18, .1), color: cRoad }]);
    });
    const add = (rows, mat) => { const m = new THREE.Mesh(this.stripGeo(rows), mat); m.receiveShadow = true; group.add(m); return m; };
    add(roadRows, M.road);
    add(barrierL, M.barrier); add(barrierR, M.barrier); add(skirtRows, M.skirt);
    add(accL, M.accent); add(accR, branch === 'B' ? M.accentBlue : M.accent);

    // pillars + under-beam when elevated
    frames.forEach((f, j) => {
      const bp = this.branchPose(f, branch);
      if (bp.pos.y > 3.4 && j % 2 === 0) {
        if (branch === 'B' && f.splitType === 'ud') {
          [-1, 1].forEach(s => {
            const base = bp.pos.clone().addScaledVector(f.right, s * (bp.halfW - .8));
            const pil = box(M.pillar, 1.1, base.y, 1.1, base.x, base.y / 2 - .5, base.z, f.yaw, group);
            pil.castShadow = false;
          });
        } else {
          const pil = box(M.pillar, 2.4, bp.pos.y, 3.2, bp.pos.x, bp.pos.y / 2 - .6, bp.pos.z, f.yaw, group);
          pil.castShadow = false;
        }
      }
    });
  }

  flatStrip(group, frames, lat, width, yFn, mat, thick = 0) {
    const rows = frames.map(f => {
      const c = f.p.clone().addScaledVector(f.rightH, lat); const y = yFn(f);
      return [-width / 2, width / 2].map(o => {
        const p = c.clone().addScaledVector(f.rightH, o); p.y = y;
        return { pos: p, color: { r: 1, g: 1, b: 1 } };
      });
    });
    const m = new THREE.Mesh(this.stripGeo(rows), mat); m.receiveShadow = true; group.add(m);
    return m;
  }

  buildParallelRails(group, frames) {
    const M = mats(), gl = -(HALF + 10.5), mr = HALF + 10.5;
    // ground railway (left): ballast, sleeper bed, 2 steel rails
    this.flatStrip(group, frames, gl, 5.8, () => .1, M.ballast);
    this.flatStrip(group, frames, gl, 2.6, () => .22, M.sleeper);
    [-0.8, 0.8].forEach(o => this.flatStrip(group, frames, gl + o, .24, () => .36, M.steel));
    // elevated monorail (right): beam top + spine + pillars
    const beamY = f => Math.max(f.p.y + 1.0, 7.5);
    this.flatStrip(group, frames, mr, 1.5, f => beamY(f) + .5, M.beam);
    this.flatStrip(group, frames, mr, 1.9, f => beamY(f) - .45, M.skirt);
    frames.forEach((f, j) => {
      if (j % 3) return;
      const c = f.p.clone().addScaledVector(f.rightH, mr), y = beamY(f);
      box(M.pillar, 1.3, y, 1.3, c.x, y / 2, c.z, f.yaw, group);
      box(M.pillar, 3.4, .8, 2.2, c.x, y - .8, c.z, f.yaw, group);
    });
    // sidewalks / service roads outside the rails
    this.flatStrip(group, frames, -(HALF + 20), 7, () => .04, M.ballast);
    this.flatStrip(group, frames, (HALF + 20), 7, () => .04, M.ballast);
  }

  buildGantry(group, f, kind) {
    const M = mats(), hw = HALF + 3.6, top = 7.4;
    const g = new THREE.Group(); g.position.copy(f.p); g.rotation.y = f.yaw; group.add(g);
    [-1, 1].forEach(s => {
      box(M.gantry, .7, top, .7, s * hw, top / 2, 0, 0, g);
      box(M.accent, .28, top * .8, .28, s * (hw - .45), top / 2, 0, 0, g);
    });
    box(M.gantry, hw * 2 + 1, .8, .8, 0, top, 0, 0, g);
    box(M.gantry, hw * 2 + 1, .35, .35, 0, top - .8, 0, 0, g);
    const texts = {
      splitY: ['Y-SPLIT AHEAD', '◂ LEFT LINE   RIGHT LINE ▸', '#f06423'],
      splitUD: ['UP / DOWN SPLIT', 'LOW LINE ▾   BRIDGE LINE ▴', '#1f6fd6'],
      ground: ['LEVEL CROSSING', '⚠ TRAINS CROSS THE TRACK ⚠', '#e23b3b'],
      air: ['AERIAL RAILWAY', 'TRAINS PASS OVERHEAD', '#1f6fd6'],
      plain: ['FRONTIER GP', 'SECTOR ' + (this.sector++), '#f06423'],
    }[kind] || ['FRONTIER GP', 'SECTOR ' + (this.sector++), '#f06423'];
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(10.5, 2.4),
      new THREE.MeshBasicMaterial({ map: signTexture(texts[0], texts[1], texts[2]), side: THREE.DoubleSide }));
    sign.position.set(0, top - 2.1, 0); sign.userData.disposeMat = true; g.add(sign);
    const sign2 = sign.clone(); sign2.position.z = -.1; sign2.rotation.y = Math.PI; g.add(sign2);
  }

  buildCity(group, frames) {
    const M = mats(), r = mulberry32(frames[0].i * 7919 + 13);
    const unitMats = [...M.facades];
    [1, 4].forEach(fi => {
      const f = frames[Math.min(fi, frames.length - 1)]; if (!f) return;
      [-1, 1].forEach(side => {
        if (r() < .14) return;
        const off = side * (36 + r() * 34);
        const c = f.p.clone().addScaledVector(f.rightH, off);
        const w = 13 + r() * 15, d = 13 + r() * 15, h = 13 + Math.pow(r(), 1.6) * 52;
        const b = new THREE.Mesh(M.box, unitMats[Math.floor(r() * unitMats.length)]);
        b.scale.set(w, h, d); b.position.set(c.x, h / 2, c.z);
        b.rotation.y = f.yaw + (r() - .5) * .12; group.add(b);
        if (r() > .45) box(M.roof, w * .45, 2.2, d * .45, c.x, h + 1, c.z, b.rotation.y, group);
        box(M.ballast, w + 3, .5, d + 3, c.x, .25, c.z, b.rotation.y, group);
      });
      // trees on the near sidewalk
      [-1, 1].forEach(side => {
        if (r() < .4) return;
        const c = f.p.clone().addScaledVector(f.rightH, side * (HALF + 17.5));
        const t = new THREE.Group(); t.position.set(c.x, 0, c.z); group.add(t);
        const tr = new THREE.Mesh(M.cyl, M.trunk); tr.scale.set(.5, 2.4, .5); tr.position.y = 1.2; t.add(tr);
        const lf = new THREE.Mesh(new THREE.ConeGeometry(1.9, 4.6, 7), M.leaf); lf.position.y = 4.4; t.add(lf);
      });
    });
  }

  buildCrossing(group, f) {
    const M = mats();
    const g = new THREE.Group(); g.position.copy(f.p); g.rotation.y = f.yaw; group.add(g);
    const desc = {
      id: 'x' + f.i, type: f.crossing, frame: f.i,
      center: f.p.clone(), yaw: f.yaw, right: f.rightH.clone(), fwd: f.rightH.clone().cross(new THREE.Vector3(0, -1, 0)).normalize(),
      train: null, d: -999, state: 'idle', timer: 2 + this.rng() * 7, dir: this.rng() < .5 ? 1 : -1,
      speed: 30 + this.rng() * 10, lights: [], arms: [], crashed: false,
    };
    desc.fwd.set(Math.sin(f.yaw), 0, Math.cos(f.yaw));
    if (f.crossing === 'ground') {
      box(M.ballast, 190, .16, 6.6, 0, .1, 0, 0, g);
      box(M.sleeper, 190, .1, 2.7, 0, .22, 0, 0, g);
      [-0.8, 0.8].forEach(o => box(M.steel, 190, .2, .22, 0, .34, o, 0, g));
      // signal posts + barrier arms on all 4 corners of the road
      [[-1, -1], [1, 1], [-1, 1], [1, -1]].forEach(([sx, sz]) => {
        const px = sx * (HALF + 3.4), pz = sz * 6.5;
        box(M.gantry, .32, 3.6, .32, px, 1.8, pz, 0, g);
        const lm = M.lampOff.clone();
        const bulb = new THREE.Mesh(new THREE.SphereGeometry(.3, 10, 10), lm);
        bulb.position.set(px, 3.5, pz); g.add(bulb);
        desc.lights.push(lm);
        const pivot = new THREE.Group(); pivot.position.set(px, 3.0, pz); g.add(pivot);
        // arm reaches laterally across the road edge; swings up around Z when open
        box(new THREE.MeshStandardMaterial({ color: 0xe8ecf1, roughness: .5 }),
          7.6, .26, .26, -sx * 3.8, 0, 0, 0, pivot);
        for (let k = 0; k < 3; k++)
          box(new THREE.MeshStandardMaterial({ color: 0xd8402e }), 1.1, .28, .28, -sx * (1.5 + k * 2.3), 0, 0, 0, pivot);
        pivot.userData.closedZ = 0; pivot.userData.openZ = -sx * 1.3;
        pivot.rotation.z = pivot.userData.openZ;
        desc.arms.push(pivot);
      });
      desc.train = buildTrainModel('cross');
    } else { // air: elevated perpendicular rail bridge over the track
      const Y = 11.5;
      box(M.skirt, 190, 1.1, 6.8, 0, Y, 0, 0, g);
      box(M.beam, 190, .5, 5.6, 0, Y + .8, 0, 0, g);
      [-0.8, 0.8].forEach(o => box(M.steel, 190, .2, .22, 0, Y + 1.15, o, 0, g));
      [-70, -46, -26, 26, 46, 70].forEach(px => box(M.pillar, 1.6, Y, 1.6, px, Y / 2, 0, 0, g));
      [-1, 1].forEach(s => box(M.gantry, 190, .9, .3, 0, Y + 1.6, s * 3.1, 0, g));
      desc.train = buildTrainModel('air');
      desc.baseY = f.p.y + Y + 1.2;
    }
    if (desc.type === 'ground') desc.baseY = f.p.y + .45;
    desc.train.visible = false;
    this.scene.add(desc.train);
    this.crossings.push(desc);
    return desc;
  }

  buildChunk(start) {
    const group = new THREE.Group();
    const frames = [];
    for (let k = 0; k <= CHUNK; k++) { const f = this.frames.get(start + k); if (f) frames.push(f); }
    if (frames.length < 2) return;
    const hasB = frames.some(f => f.splitAmt > .02);
    this.buildBranchRibbon(group, frames, 'A');
    if (hasB) this.buildBranchRibbon(group, frames, 'B');
    this.buildParallelRails(group, frames);
    this.buildCity(group, frames);

    frames.forEach(f => {
      if (f.crossing && f.i < start + CHUNK) this.buildCrossing(group, f); // endpoint frame belongs to next chunk
    });
    // gantries: at chunk start + feature warnings ahead
    const f0 = frames[0];
    if (f0.i % 18 === 0) {
      let kind = 'plain';
      for (let k = 20; k < 46; k += 2) {
        const a = this.frames.get(f0.i + k); if (!a) break;
        if (a.splitAmt > .05 && a.splitType === 'y') { kind = 'splitY'; break; }
        if (a.splitAmt > .05 && a.splitType === 'ud') { kind = 'splitUD'; break; }
        if (a.crossing === 'ground') { kind = 'ground'; break; }
        if (a.crossing === 'air') { kind = 'air'; break; }
      }
      this.buildGantry(group, f0, kind);
    }
    this.scene.add(group);
    this.chunks.set(start, group);
  }

  removeChunk(start) {
    const g = this.chunks.get(start); if (!g) return;
    this.scene.remove(g);
    g.traverse(o => {
      if (o.geometry && o.geometry !== mats().box && o.geometry !== mats().cyl) o.geometry.dispose();
      if (o.userData.disposeMat && o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
    // drop crossings belonging to this chunk
    this.crossings = this.crossings.filter(c => {
      const dead = c.frame >= start && c.frame < start + CHUNK;
      if (dead && c.train) this.scene.remove(c.train);
      return !dead;
    });
    this.chunks.delete(start);
  }

  /** Stream generation around the player's frame index. */
  update(playerFrame) {
    while (this.lastFrame < playerFrame + 170) this.genFrame();
    while (this.nextChunk <= this.lastFrame - CHUNK && this.nextChunk < playerFrame + 150) {
      this.buildChunk(this.nextChunk); this.nextChunk += CHUNK;
    }
    for (const start of [...this.chunks.keys()])
      if (start + CHUNK < playerFrame - 30) this.removeChunk(start);
    // prune old frames (keep a margin behind for trains)
    for (let i = this.firstFrame; i < playerFrame - 60; i++) { this.frames.delete(i); this.firstFrame = i + 1; }
  }

  /* ---------------- surface sampling for the car ---------------- */
  sample(pos, hint) {
    let best = null;
    const lo = Math.max(this.firstFrame, hint - 24), hi = Math.min(this.lastFrame, hint + 42);
    for (let i = lo; i <= hi; i++) {
      const f = this.frames.get(i); if (!f) continue;
      const branches = f.splitAmt > .02 ? ['A', 'B'] : ['A'];
      for (const br of branches) {
        const bp = this.branchPose(f, br);
        const rel = pos.clone().sub(bp.pos);
        const lat = rel.dot(f.right), along = rel.dot(f.fwd);
        const dy = pos.y - bp.pos.y;
        const score = (lat * lat) + (along * along) * .35 + (dy * dy) * 2.2;
        if (!best || score < best.score) best = { score, frame: f, branch: br, pose: bp, lat, along, dy };
      }
    }
    if (!best) return null;
    const f = best.frame;
    // road crown height at lateral position
    const crown = .03 + Math.max(0, .04 - Math.abs(best.lat) / best.pose.halfW * .04);
    best.surfaceY = best.pose.pos.y + crown;
    best.onTrack = Math.abs(best.lat) <= best.pose.halfW;
    best.atBarrier = Math.abs(best.lat) <= best.pose.halfW + 2.0;
    return best;
  }

  /* ---------------- perpendicular crossings update ---------------- */
  updateCrossings(dt, t) {
    for (const c of this.crossings) {
      const warning = c.state === 'approach';
      c.lights.forEach((lm, k) => {
        const on = warning && (Math.floor(t * 3 + k) % 2 === 0);
        lm.emissive.setHex(on ? 0xff2222 : 0x550000); lm.emissiveIntensity = on ? 3.2 : .4;
      });
      c.arms.forEach(p => {
        const target = warning ? p.userData.closedZ : p.userData.openZ;
        p.rotation.z += (target - p.rotation.z) * Math.min(1, dt * 2.5);
      });
      if (c.state === 'idle') {
        c.timer -= dt; c.train.visible = false;
        if (c.timer <= 0) {
          c.state = 'approach'; c.dir = this.rng() < .5 ? 1 : -1;
          c.d = -165 * c.dir; c.train.visible = true; c.crashed = false;
        }
      } else {
        c.d += c.dir * c.speed * dt;
        const p = c.center.clone().addScaledVector(c.right, c.d); p.y = c.baseY;
        c.train.position.copy(p);
        c.train.rotation.set(0, Math.atan2(c.right.x * c.dir, c.right.z * c.dir), 0);
        if (Math.abs(c.d) > 175) { c.state = 'idle'; c.timer = 3.5 + this.rng() * 9; c.train.visible = false; }
      }
    }
  }
}
