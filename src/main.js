import * as THREE from 'three';

/* ============================================================
   FRONTIER — infinite procedural city circuit
   - Wide ribbon track generated forever ahead of the car
   - Y-splits (flat) + up/down splits (branches rejoin)
   - Bridges, overhead sign gantries, perpendicular rail crossings
   - Railways: parallel ground (both directions), elevated monorail
     (both directions), and trains crossing PERPENDICULAR to the
     track — at grade (dangerous) and overhead (in the air)
   - Car: NFS-style arcade physics. Free steering, velocity split
     into forward/lateral, grip vs handbrake drift. NOT a lane runner.
   ============================================================ */

const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc3dd); // modern-city daylight, NOT neon night
scene.fog = new THREE.Fog(0xa8c4d8, 90, 620);

const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 2000);

const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -120; sun.shadow.camera.right = 120;
sun.shadow.camera.top = 120; sun.shadow.camera.bottom = -120;
sun.shadow.camera.far = 600;
scene.add(sun, sun.target);
scene.add(new THREE.HemisphereLight(0xcfe6f5, 0x5c6658, 1.15));

// ---------- seeded RNG (deterministic-ish procedural world) ----------
let seed = 1337;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const rr = (a, b) => a + rnd() * (b - a);
const pick = a => a[Math.floor(rnd() * a.length)];

// ---------- materials (muted modern city + Wipeout-style track furniture) ----------
function canvasTex(draw, w = 256, h = 256, rx = 1, ry = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  t.anisotropy = 4; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const asphaltTex = canvasTex((g, w, h) => {
  g.fillStyle = '#2e3236'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${140 + rnd() * 60},${145 + rnd() * 60},${150 + rnd() * 60},${rnd() * .12})`; g.fillRect(rnd() * w, rnd() * h, 1.5, 1.5); }
}, 256, 256, 1, 8);
const buildingTex = (base, win) => canvasTex((g, w, h) => {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  for (let y = 8; y < h - 8; y += 14) for (let x = 6; x < w - 8; x += 12) {
    g.fillStyle = rnd() > .32 ? win : 'rgba(20,26,32,.85)';
    g.fillRect(x, y, 8, 9);
  }
}, 128, 256, 1, 1);

const M = {
  track: new THREE.MeshStandardMaterial({ map: asphaltTex, roughness: .92, metalness: .05 }),
  shoulder: new THREE.MeshStandardMaterial({ color: 0xd8dde0, roughness: .8 }),
  edgeCyan: new THREE.MeshStandardMaterial({ color: 0x18b7d6, emissive: 0x0a5d70, emissiveIntensity: .55, roughness: .4 }), // restrained Wipeout accent
  edgeOrange: new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0x662a00, emissiveIntensity: .5, roughness: .4 }),
  wall: new THREE.MeshStandardMaterial({ color: 0xe9edee, roughness: .55, metalness: .15 }),
  wallRed: new THREE.MeshStandardMaterial({ color: 0xc62f2f, roughness: .55 }),
  line: new THREE.MeshStandardMaterial({ color: 0xf4f6f7, roughness: .7 }),
  chevron: new THREE.MeshStandardMaterial({ color: 0xffb02e, emissive: 0x3a2400, emissiveIntensity: .4, roughness: .6 }),
  concrete: new THREE.MeshStandardMaterial({ color: 0x9aa0a2, roughness: .95 }),
  darkMetal: new THREE.MeshStandardMaterial({ color: 0x394048, roughness: .45, metalness: .7 }),
  rail: new THREE.MeshStandardMaterial({ color: 0xb9c0c4, roughness: .3, metalness: .9 }),
  ballast: new THREE.MeshStandardMaterial({ color: 0x6d6a63, roughness: 1 }),
  pillar: new THREE.MeshStandardMaterial({ color: 0xb4b8ba, roughness: .9 }),
  island: new THREE.MeshStandardMaterial({ color: 0x565d60, roughness: .9 }),
  ground: new THREE.MeshStandardMaterial({ color: 0x8f948e, roughness: 1 }),
  grass: new THREE.MeshStandardMaterial({ color: 0x7d9b6a, roughness: 1 }),
  buildings: [
    new THREE.MeshStandardMaterial({ map: buildingTex('#7f8b96', '#cfe8f2'), roughness: .6, metalness: .25 }),
    new THREE.MeshStandardMaterial({ map: buildingTex('#a89f92', '#ffe9bd'), roughness: .8 }),
    new THREE.MeshStandardMaterial({ map: buildingTex('#5f707c', '#bfe0ee'), roughness: .35, metalness: .5 }),
    new THREE.MeshStandardMaterial({ map: buildingTex('#c2c6c8', '#d9edf5'), roughness: .7 }),
  ],
  trainA: new THREE.MeshStandardMaterial({ color: 0xd7dde2, roughness: .3, metalness: .6 }),
  trainB: new THREE.MeshStandardMaterial({ color: 0x2456a6, roughness: .35, metalness: .5 }),
  trainC: new THREE.MeshStandardMaterial({ color: 0xc8541e, roughness: .4, metalness: .4 }),
  glass: new THREE.MeshStandardMaterial({ color: 0x9fd4e8, roughness: .12, metalness: .6 }),
};

// ---------- ground plane that follows the car (modern city streets) ----------
const ground = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), M.ground);
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.08; ground.receiveShadow = true;
scene.add(ground);

// ============================================================
//  TRACK SPINE GENERATOR
// ============================================================
const DS = 4;                 // metres between spine points
const HALF = 13;              // main track half-width  -> 26 m wide
const BRANCH_HALF = 8.4;      // each split branch ~17 m wide
const BRANCH_OFF = 9.6;
const AHEAD = 760, BEHIND = 90;

const spine = [];             // {s,x,y,z,h,split,splitH,section,bridge,crossing,gantry}
let baseIdx = 0;              // spine index of spine[0]
const G = {
  x: 0, z: 0, y: 0, h: 0, s: 0, section: 'straight', t: 0, len: 20,
  curve: 0, dy: 0, splitKind: '', bridge: false, count: 0,
};
const BAG = ['curve', 'y-split', 'curve', 'crossing', 'alt-split', 'slope', 'bridge', 'curve', 'y-split', 'crossing', 'alt-split', 'gantry-run'];
let bagPos = 99;

function startSection() {
  if (bagPos >= BAG.length) { // shuffle bag so every feature recurs regularly
    for (let i = BAG.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [BAG[i], BAG[j]] = [BAG[j], BAG[i]]; }
    bagPos = 0;
  }
  const type = G.count < 2 ? 'straight' : BAG[bagPos++];
  G.section = type; G.t = 0; G.bridge = false; G.splitKind = ''; G.curve = 0; G.dy = 0;
  const dir = rnd() > .5 ? 1 : -1;
  switch (type) {
    case 'straight': G.len = Math.floor(rr(14, 24)); break;
    case 'gantry-run': G.len = Math.floor(rr(16, 24)); break;
    case 'curve': G.len = Math.floor(rr(26, 40)); G.curve = dir * rr(0.0055, 0.0095); break;
    case 'y-split': G.len = 44; G.splitKind = 'y'; break;
    case 'alt-split': G.len = 48; G.splitKind = 'alt'; break;
    case 'slope': G.len = 34; G.dy = (G.y < 4 ? 1 : (G.y > 15 ? -1 : dir)) * rr(0.10, 0.17); break;
    case 'bridge': G.len = 44; G.bridge = true; break;
    case 'crossing': G.len = 30; break;
    default: G.len = 20;
  }
  G.count++;
}
const smooth = t => t * t * (3 - 2 * t);
function splitProfile(t) { // 0 -> 1 -> 0 across a split section
  if (t < .22) return smooth(t / .22);
  if (t > .78) return smooth((1 - t) / .22);
  return 1;
}
function genPoint() {
  if (G.t >= G.len) startSection();
  const t = G.len ? G.t / G.len : 0;
  G.h += G.curve;
  if (G.section === 'slope') G.y = THREE.MathUtils.clamp(G.y + G.dy, 0, 20);
  const bridgeArc = G.bridge ? Math.sin(t * Math.PI) * 7.5 : 0;
  const split = G.splitKind ? splitProfile(t) : 0;
  const y = G.y + bridgeArc;
  const p = {
    s: G.s, x: G.x, y, z: G.z, h: G.h, split,
    splitH: G.splitKind === 'alt' ? split * 6.0 : 0,
    section: G.section, bridge: G.bridge,
    crossing: G.section === 'crossing' && G.t === Math.floor(G.len / 2),
    gantry: (G.section === 'gantry-run' && G.t % 9 === 0) || (Math.round(G.s) % 220 < DS && G.section !== 'crossing'),
    bridgeT: t,
  };
  spine.push(p);
  G.x += Math.sin(G.h) * DS; G.z += Math.cos(G.h) * DS; G.s += DS; G.t++;
  return p;
}
for (let i = 0; i < 30; i++) genPoint();
const spineAt = s => spine[THREE.MathUtils.clamp(Math.round((s - spine[0].s) / DS), 0, spine.length - 1)];
const fwd = p => ({ x: Math.sin(p.h), z: Math.cos(p.h) });
const rgt = p => ({ x: Math.cos(p.h), z: -Math.sin(p.h) });
function branchCenter(p, b) { // b: -1 left, 0 main, +1 right
  const r = rgt(p), off = b * BRANCH_OFF * p.split;
  return { x: p.x + r.x * off, z: p.z + r.z * off, y: p.y + (b ? b * p.splitH : 0) };
}

// ============================================================
//  CHUNK GEOMETRY  (8 spine segments per chunk, recycled)
// ============================================================
const chunks = new Map();     // chunkIndex -> {group, crossings:[]}
const liveCrossings = [];
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
for (const m of [M.track, M.shoulder, M.wall, M.wallRed, M.line, M.chevron, M.edgeCyan, M.edgeOrange, M.ballast, M.rail, M.concrete, M.island]) m.side = THREE.DoubleSide;

function strip(pts, getCenter, halfW, yOff, mat, vScale = 1) {
  const pos = [], uv = [], idx = [];
  pts.forEach((p, i) => {
    const c = getCenter(p), r = rgt(p);
    pos.push(c.x - r.x * halfW, c.y + yOff, c.z - r.z * halfW, c.x + r.x * halfW, c.y + yOff, c.z + r.z * halfW);
    uv.push(0, i * vScale, 1, i * vScale);
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true;
  return m;
}
function wall(pts, getCenter, side, halfW, mat) { // vertical barrier at one edge
  const pos = [], idx = [];
  pts.forEach((p, i) => {
    const c = getCenter(p), r = rgt(p), ex = c.x + r.x * halfW * side, ez = c.z + r.z * halfW * side;
    pos.push(ex, c.y, ez, ex, c.y + 1.15, ez);
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.material = mat; m.castShadow = false;
  return m;
}
function box(parent, mat, x, y, z, sx, sy, sz, ry = 0) {
  const m = new THREE.Mesh(boxGeo, mat);
  m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.rotation.y = ry;
  m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}

function makeSign(text, color = '#37c8e8') {
  const tex = canvasTex((g, w, h) => {
    g.fillStyle = '#10161d'; g.fillRect(0, 0, w, h);
    g.strokeStyle = color; g.lineWidth = 6; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#fff'; g.font = '900 44px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, w / 2, h / 2 + 2);
  }, 512, 128);
  return new THREE.Mesh(new THREE.PlaneGeometry(11, 2.75), new THREE.MeshBasicMaterial({ map: tex }));
}

function buildChunk(ci) {
  const start = ci * 8;
  while (spine.length - 1 < start + 8) genPoint();
  const pts = [];
  for (let i = 0; i <= 8; i++) pts.push(spine[start - baseIdx + i]);
  if (pts.some(p => !p)) return;
  const group = new THREE.Group();
  const chunkCrossings = [];
  const isSplit = pts.some(p => p.split > .02);
  const branches = isSplit ? [-1, 1] : [0];

  for (const b of branches) {
    const getC = p => branchCenter(p, b);
    const hw = b === 0 ? HALF : THREE.MathUtils.lerp(HALF, BRANCH_HALF, Math.max(...pts.map(p => p.split))) ;
    group.add(strip(pts, getC, b === 0 ? HALF : BRANCH_HALF, 0, M.track));
    group.add(strip(pts, getC, b === 0 ? HALF : BRANCH_HALF, -0.06, M.shoulder)); // under-skirt hides seams
    // lane lines
    for (const lo of [-0.45, 0, 0.45]) {
      const halfW2 = b === 0 ? HALF : BRANCH_HALF;
      group.add(strip(pts, p => { const c = getC(p), r = rgt(p); return { x: c.x + r.x * lo * halfW2 * 1.4, y: c.y, z: c.z + r.z * lo * halfW2 * 1.4 }; }, .16, .02, lo === 0 ? M.chevron : M.line));
    }
    // barriers + coloured top edge (Wipeout furniture, daylight-restrained)
    for (const side of [-1, 1]) {
      const halfW2 = b === 0 ? HALF : BRANCH_HALF;
      group.add(wall(pts, getC, side, halfW2, (Math.floor(ci + side) % 2 === 0) ? M.wall : M.wallRed));
      group.add(strip(pts, p => { const c = getC(p), r = rgt(p); return { x: c.x + r.x * side * halfW2, y: c.y, z: c.z + r.z * side * halfW2 }; }, .34, 1.16, side < 0 ? M.edgeCyan : M.edgeOrange));
    }
  }
  if (isSplit) { // median island between branches
    group.add(strip(pts, p => ({ x: p.x, y: p.y + (0), z: p.z }), Math.max(.1, BRANCH_OFF * pts[4].split - BRANCH_HALF + .8), .12, M.island));
  }

  // ---- parallel railways: ground both sides + elevated monorail both sides ----
  for (const side of [-1, 1]) {
    // ground railway (ballast, sleepers strip, 2 rails)
    group.add(strip(pts, p => { const r = rgt(p); return { x: p.x + r.x * side * 20.5, y: 0, z: p.z + r.z * side * 20.5 }; }, 2.6, .04, M.ballast, .25));
    for (const ro of [-0.75, 0.75])
      group.add(strip(pts, p => { const r = rgt(p); return { x: p.x + r.x * side * (20.5 + ro), y: 0, z: p.z + r.z * side * (20.5 + ro) }; }, .09, .22, M.rail));
    // elevated monorail beam + pillars
    group.add(strip(pts, p => { const r = rgt(p); return { x: p.x + r.x * side * 29, y: 0, z: p.z + r.z * side * 29 }; }, .8, 12.4, M.concrete));
    pts.forEach((p, i) => {
      if (i % 4) return; const r = rgt(p);
      box(group, M.pillar, p.x + r.x * side * 29, 6, p.z + r.z * side * 29, 1.1, 12, 1.1);
    });
  }

  // ---- per-point furniture ----
  pts.forEach((p, i) => {
    if (p.bridge && i % 2 === 0) { // bridge supports + side truss hint
      box(group, M.pillar, p.x, p.y / 2 - .2, p.z, 2.2, Math.max(1, p.y), 2.2);
      const r = rgt(p);
      for (const s2 of [-1, 1]) box(group, M.darkMetal, p.x + r.x * s2 * (HALF + .7), p.y + 1.9, p.z + r.z * s2 * (HALF + .7), .35, 1.6, 4.4, -p.h);
    }
    if (p.gantry) makeGantry(group, p);
    if (p.crossing) chunkCrossings.push(makeCrossing(group, p));
    // modern city buildings (kept clear of rails)
    if (i % 2 === 0 && !p.bridge) for (const side of [-1, 1]) {
      if (rnd() < .28) continue;
      const r = rgt(p), d = rr(42, 95), w = rr(14, 26), dep = rr(14, 24), hgt = rr(18, 78) * (rnd() > .88 ? 1.7 : 1);
      const b = box(group, pick(M.buildings), p.x + r.x * side * d, hgt / 2, p.z + r.z * side * d, w, hgt, dep, rr(-.06, .06));
      b.castShadow = false;
      if (rnd() > .5) box(group, M.concrete, b.position.x, hgt + .5, b.position.z, w * .5, 1, dep * .5); // rooftop plant
    }
    // street trees / light poles near rails
    if (i % 3 === 0) for (const side of [-1, 1]) {
      const r = rgt(p), x = p.x + r.x * side * 35, z = p.z + r.z * side * 35;
      box(group, M.darkMetal, x, 3.4 + p.y * 0, z, .18, 6.8, .18).position.y = 3.4;
    }
  });

  group.traverse(o => { if (o.isMesh) o.matrixAutoUpdate = false; o.updateMatrix?.(); });
  scene.add(group);
  chunks.set(ci, { group, crossings: chunkCrossings });
  liveCrossings.push(...chunkCrossings);
}

function makeGantry(group, p) {
  const r = rgt(p), g = new THREE.Group();
  g.position.set(p.x, p.y, p.z); g.rotation.y = p.h;
  box(g, M.darkMetal, -HALF - 1, 3.4, 0, .7, 6.8, .7);
  box(g, M.darkMetal, HALF + 1, 3.4, 0, .7, 6.8, .7);
  box(g, M.darkMetal, 0, 7.1, 0, (HALF + 1) * 2, .8, .8);
  const label = p.section === 'y-split' ? 'Y-SPLIT ⇄' : p.section === 'alt-split' ? 'SPLIT ⇅ UP / DOWN' :
    p.section === 'bridge' ? 'BRIDGE' : p.section === 'crossing' ? 'RAIL CROSSING' : `SECTOR ${Math.floor(p.s / 500)}`;
  const sign = makeSign(label, p.section.includes('split') ? '#ffb02e' : '#37c8e8');
  sign.position.set(0, 5.4, -.5); sign.rotation.y = Math.PI; g.add(sign); // face oncoming driver
  group.add(g);
}

function makeCrossing(group, p) {
  const g = new THREE.Group();
  g.position.set(p.x, p.y, p.z); g.rotation.y = p.h;
  // at-grade perpendicular railway: ballast + rails straight across the track
  box(g, M.ballast, 0, .03, 0, 190, .06, 4.6);
  for (const zo of [-0.8, 0.8]) box(g, M.rail, 0, .16, zo, 190, .1, .14);
  // crossing gates + flashing signals on both edges
  for (const sx of [-1, 1]) {
    box(g, M.darkMetal, sx * (HALF + 1.4), 1.6, -3.4, .28, 3.2, .28);
    const lamp = box(g, M.wallRed, sx * (HALF + 1.4), 3.3, -3.4, .5, .5, .5);
    lamp.material = M.wallRed;
    box(g, M.wallRed, sx * (HALF * .55), 2.6, -3.4, HALF * .8, .22, .22).rotation.z = sx * .5; // barrier arm (raised pose)
  }
  // overhead perpendicular monorail (trains in the air, crossing over you)
  box(g, M.concrete, 0, 12.9, 6.5, 190, .9, 1.4);
  for (let x = -88; x <= 88; x += 22) box(g, M.pillar, x, 6.2, 6.5, 1, 12.4, 1);
  group.add(g);
  const rec = { s: p.s, x: p.x, y: p.y, z: p.z, h: p.h, group: g, phase: rr(0, 180), speed: rr(16, 24) };
  return rec;
}

// ============================================================
//  TRAINS
// ============================================================
function makeTrain(mat, cars, carLen = 11, air = false) {
  const g = new THREE.Group();
  for (let i = 0; i < cars; i++) {
    const c = new THREE.Group();
    const body = box(c, mat, 0, 0, 0, 2.9, 2.7, carLen - .7);
    body.castShadow = true;
    box(c, M.glass, 0, .55, 0, 3.0, .8, carLen - 1.6);                 // window band
    box(c, M.darkMetal, 0, -1.55, 0, 2.4, .5, carLen - 1);             // bogies / skirt
    if (air) box(c, M.darkMetal, 0, -1.9, 0, 1.2, .7, carLen * .6);     // monorail saddle
    c.position.z = i * carLen;
    g.add(c);
  }
  g.userData.len = cars * carLen;
  scene.add(g);
  return g;
}
// parallel traffic: ground L same-dir, ground R oncoming, air L oncoming, air R same-dir
const railTrains = [
  { obj: makeTrain(M.trainB, 4), off: -20.5, y: .9, dir: 1, s: 120, speed: 26 },
  { obj: makeTrain(M.trainA, 5), off: 20.5, y: .9, dir: -1, s: 420, speed: 30 },
  { obj: makeTrain(M.trainA, 3, 10, true), off: -29, y: 14.6, dir: -1, s: 300, speed: 34 },
  { obj: makeTrain(M.trainC, 3, 10, true), off: 29, y: 14.6, dir: 1, s: 60, speed: 32 },
];
// perpendicular trains (one group reused per live crossing, pooled)
const crossTrainGround = makeTrain(M.trainC, 4);
const crossTrainAir = makeTrain(M.trainB, 3, 10, true);

function placeOnSpine(obj, s, latOff, yAbs, yRel = null) {
  const p = spineAt(s), r = rgt(p);
  obj.position.set(p.x + r.x * latOff, yRel !== null ? p.y + yRel : yAbs, p.z + r.z * latOff);
  obj.rotation.y = p.h;
}

// ============================================================
//  THE CAR — built like a car (wheels, cabin, spoiler), not a ship
// ============================================================
const carGroup = new THREE.Group();
const carBody = new THREE.Group();
carGroup.add(carBody);
{
  const paint = new THREE.MeshStandardMaterial({ color: 0xd84f1d, roughness: .28, metalness: .55 });
  const black = new THREE.MeshStandardMaterial({ color: 0x15181b, roughness: .5, metalness: .4 });
  box(carBody, paint, 0, .55, 0, 1.9, .5, 4.3);                       // lower body
  box(carBody, paint, 0, .92, -.25, 1.7, .38, 2.2);                   // upper body
  box(carBody, M.glass, 0, 1.08, -.35, 1.45, .34, 1.25);              // cabin glass
  box(carBody, black, 0, .82, 2.02, 1.86, .16, .35);                  // nose splitter
  box(carBody, black, 0, 1.02, -2.05, 1.9, .1, .4);                   // rear wing blade
  box(carBody, black, -.8, .82, -2.0, .1, .35, .3);
  box(carBody, black, .8, .82, -2.0, .1, .35, .3);
  box(carBody, new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xff2211, emissiveIntensity: 1.6 }), 0, .68, -2.18, 1.5, .14, .06); // tail light
  box(carBody, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2cc, emissiveIntensity: 2 }), -.6, .62, 2.19, .42, .12, .05);
  box(carBody, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2cc, emissiveIntensity: 2 }), .6, .62, 2.19, .42, .12, .05);
}
const wheelGeo = new THREE.CylinderGeometry(.37, .37, .3, 18);
wheelGeo.rotateZ(Math.PI / 2);
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x111315, roughness: .85 });
const wheels = [];
for (const [x, z, steer] of [[-.88, 1.42, 1], [.88, 1.42, 1], [-.88, -1.42, 0], [.88, -1.42, 0]]) {
  const w = new THREE.Mesh(wheelGeo, wheelMat);
  w.position.set(x, .37, z); w.castShadow = true;
  w.userData.steer = !!steer;
  carGroup.add(w); wheels.push(w);
}
carGroup.traverse(o => { if (o.isMesh) o.castShadow = true; });
scene.add(carGroup);

// ============================================================
//  ARCADE CAR PHYSICS (NFS-style, free driving — no lanes)
// ============================================================
const car = {
  pos: new THREE.Vector3(0, 0, 6), yaw: 0,
  vel: new THREE.Vector3(), steer: 0, speedF: 0,
  nitro: 1, driftAmt: 0, hint: 0, dist: 0, airborne: 0,
};
const keys = {};
let running = false, paused = false, camMode = 0, shake = 0, toastTimer = 0, lastSection = '';

addEventListener('keydown', e => {
  keys[e.code] = true;
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (e.code === 'KeyC') camMode = (camMode + 1) % 3;
  if (e.code === 'KeyP' && running) { paused = !paused; document.getElementById('paused').classList.toggle('hidden', !paused); }
  if (e.code === 'KeyR') resetCar();
  if (e.code === 'Enter' && !running) startGame();
});
addEventListener('keyup', e => keys[e.code] = false);
const touchKey = { left: 'ArrowLeft', right: 'ArrowRight', gas: 'ArrowUp', brake: 'ArrowDown', hand: 'Space', nitro: 'ShiftLeft' };
document.querySelectorAll('#touch button').forEach(b => {
  const code = touchKey[b.dataset.k];
  b.addEventListener('pointerdown', e => { e.preventDefault(); keys[code] = true; });
  b.addEventListener('pointerup', () => keys[code] = false);
  b.addEventListener('pointerleave', () => keys[code] = false);
});

function trackQuery(pos) {
  // nearest spine point near hint
  let best = 1e9, bi = car.hint;
  const approx = THREE.MathUtils.clamp(Math.round((car.dist) / DS) - baseIdx, 0, spine.length - 1);
  for (let i = Math.max(0, approx - 24); i < Math.min(spine.length, approx + 40); i++) {
    const p = spine[i], dx = pos.x - p.x, dz = pos.z - p.z, d = dx * dx + dz * dz;
    if (d < best) { best = d; bi = i; }
  }
  car.hint = bi;
  const p = spine[bi], r = rgt(p), f = fwd(p);
  const dx = pos.x - p.x, dz = pos.z - p.z;
  const lat = dx * r.x + dz * r.z;
  const lon = dx * f.x + dz * f.z;
  // which branch (if split)?
  let branch = 0;
  if (p.split > .03) branch = lat >= 0 ? 1 : -1;
  const bc = branchCenter(p, branch);
  const bLat = (pos.x - bc.x) * r.x + (pos.z - bc.z) * r.z;
  const next = spine[Math.min(spine.length - 1, bi + 1)];
  const slope = Math.atan2((branchCenter(next, branch).y - bc.y), DS);
  return { p, branch, lat, bLat, lon, surfY: bc.y, slope, idx: bi };
}

function resetCar() {
  const q = trackQuery(car.pos);
  const bc = branchCenter(q.p, q.branch), r = rgt(q.p);
  const cl = THREE.MathUtils.clamp(q.bLat, -(q.branch ? BRANCH_HALF - 1.3 : HALF - 1.3), (q.branch ? BRANCH_HALF - 1.3 : HALF - 1.3));
  car.pos.set(bc.x + r.x * cl, q.surfY + .02, bc.z + r.z * cl);
  car.yaw = q.p.h; car.vel.set(0, 0, 0);
}

function startGame() {
  running = true;
  document.getElementById('menu').classList.add('hidden');
  document.getElementById('hud').classList.remove('hidden');
}
document.getElementById('start').addEventListener('click', startGame);

const SECTION_LABEL = {
  'straight': 'OPEN HIGHWAY', 'curve': 'SWEEPING CURVE', 'y-split': '⇄ Y-SPLIT — CHOOSE YOUR LINE',
  'alt-split': '⇅ UP / DOWN SPLIT', 'slope': 'ELEVATION CHANGE', 'bridge': '🌉 BRIDGE DECK',
  'crossing': '✚ RAIL CROSSING', 'gantry-run': 'GANTRY STRAIGHT',
};

function updateCar(dt) {
  const up = keys.ArrowUp || keys.KeyW, down = keys.ArrowDown || keys.KeyS;
  const left = keys.ArrowLeft || keys.KeyA, right = keys.ArrowRight || keys.KeyD;
  const hand = !!keys.Space, nitroKey = keys.ShiftLeft || keys.ShiftRight;

  // --- steering (speed-sensitive, smoothed) ---
  const steerIn = (left ? 1 : 0) - (right ? 1 : 0);
  const steerTarget = steerIn * THREE.MathUtils.lerp(.62, .30, Math.min(1, Math.abs(car.speedF) / 68));
  car.steer += (steerTarget - car.steer) * Math.min(1, dt * (Math.abs(car.speedF) < 2 ? 10 : 6.5));

  // --- velocity in car space ---
  const sin = Math.sin(car.yaw), cos = Math.cos(car.yaw);
  let vf = car.vel.x * sin + car.vel.z * cos;        // forward
  let vl = car.vel.x * cos - car.vel.z * sin;        // lateral
  car.speedF = vf;

  const nitroOn = nitroKey && car.nitro > .02 && up && vf > 1;
  if (up) vf += (nitroOn ? 26 : 15.5) * dt * (vf < 0 ? 1.8 : 1);        // engine (stronger when recovering)
  if (down) vf += (vf > 1.2 ? -34 : -9) * dt;                            // brake, then reverse
  if (hand && vf > 4) vf -= 13 * dt;                                     // handbrake scrubs speed
  vf -= vf * (nitroOn ? .10 : .16) * dt;                                 // drag
  vf -= Math.sign(vf) * Math.min(Math.abs(vf), (up || down ? .4 : 2.6) * dt); // rolling resistance
  vf = THREE.MathUtils.clamp(vf, -14, nitroOn ? 76 : 61);

  // --- grip vs drift: lateral velocity killed by grip unless handbraking ---
  const drifting = hand && Math.abs(vf) > 7;
  car.driftAmt += ((drifting ? 1 : 0) - car.driftAmt) * Math.min(1, dt * 5);
  const grip = THREE.MathUtils.lerp(9.5, 1.35, car.driftAmt);
  vl -= vl * Math.min(1, grip * dt);
  if (drifting) vf -= vf * .22 * dt;

  // --- yaw: bicycle-ish arcade, drift adds counter-steer authority ---
  const yawRate = car.steer * (1.55 / (1 + Math.abs(vf) * .028)) * Math.tanh(vf / 6)
    * (drifting ? 1.45 : 1);
  car.yaw += yawRate * dt * 2.1;

  // recompose world velocity from (possibly rotated) heading
  const s2 = Math.sin(car.yaw), c2 = Math.cos(car.yaw);
  car.vel.x = s2 * vf + c2 * vl;
  car.vel.z = c2 * vf - s2 * vl;
  car.pos.x += car.vel.x * dt;
  car.pos.z += car.vel.z * dt;
  car.dist = Math.max(car.dist, trackQuery(car.pos).p.s + trackQuery(car.pos).lon);

  // --- track surface, walls, splits ---
  const q = trackQuery(car.pos);
  const halfLim = (q.branch ? BRANCH_HALF : HALF) - 1.25;
  if (Math.abs(q.bLat) > halfLim) { // Wipeout-style barrier: clamp, scrape, spark-shake
    const r = rgt(q.p), bc = branchCenter(q.p, q.branch);
    const cl = Math.sign(q.bLat) * halfLim;
    car.pos.x = bc.x + r.x * cl; car.pos.z = bc.z + r.z * cl;
    // kill outward lateral velocity, keep forward momentum (arcade wall ride)
    const vn = car.vel.x * r.x + car.vel.z * r.z;
    if (Math.sign(vn) === Math.sign(q.bLat)) { car.vel.x -= r.x * vn * 1.15; car.vel.z -= r.z * vn * 1.15; }
    car.vel.multiplyScalar(.965); shake = Math.min(1, shake + Math.abs(vn) * .06);
    if (Math.abs(vn) > 6) flash();
  }
  // smooth ride height + pitch/roll presentation
  const targetY = q.surfY;
  car.pos.y += (targetY - car.pos.y) * Math.min(1, dt * 14);
  carGroup.position.copy(car.pos);
  carGroup.rotation.set(0, 0, 0);
  carGroup.rotation.y = car.yaw; // model nose is local +Z; rotY maps +Z -> (sinYaw, cosYaw) = forward
  carGroup.rotation.x = -q.slope * .8;
  carBody.rotation.z = -car.steer * .16 - vl * .012;
  carBody.rotation.x = THREE.MathUtils.clamp(-vf * .0012, -.05, .08);
  carBody.position.y = Math.sin(performance.now() * .03) * .006 * Math.min(1, Math.abs(vf) / 30);

  for (const w of wheels) {
    w.rotation.x += vf * dt / .37;
    if (w.userData.steer) w.rotation.y = car.steer * .9;
  }

  // nitro economy
  car.nitro = THREE.MathUtils.clamp(car.nitro + (car.driftAmt > .4 ? dt * .20 : nitroOn ? -dt * .38 : dt * .05), 0, 1);

  // section toast
  if (q.p.section !== lastSection && SECTION_LABEL[q.p.section]) {
    lastSection = q.p.section;
    showToast(SECTION_LABEL[q.p.section]);
  }
  return q;
}

function flash() {
  const f = document.getElementById('flash');
  f.style.opacity = .35; setTimeout(() => f.style.opacity = 0, 60);
}
let toastTO = null;
function showToast(txt) {
  const t = document.getElementById('toast');
  t.textContent = txt; t.classList.remove('hidden');
  clearTimeout(toastTO); toastTO = setTimeout(() => t.classList.add('hidden'), 2400);
}

// ============================================================
//  WORLD STREAMING + TRAFFIC UPDATE
// ============================================================
function ensureChunks() {
  while (spine[spine.length - 1].s < car.dist + AHEAD) genPoint();
  const ciMin = Math.max(0, Math.floor((car.dist - BEHIND) / (DS * 8)));
  const ciMax = Math.floor((car.dist + AHEAD) / (DS * 8));
  for (let ci = ciMin; ci <= ciMax; ci++) if (!chunks.has(ci)) buildChunk(ci);
  for (const [ci, ch] of chunks) if (ci < ciMin - 1 || ci > ciMax + 2) {
    scene.remove(ch.group);
    ch.group.traverse(o => { if (o.isMesh && o.geometry !== boxGeo) o.geometry.dispose(); });
    for (const c of ch.crossings) { const i = liveCrossings.indexOf(c); if (i >= 0) liveCrossings.splice(i, 1); }
    chunks.delete(ci);
  }
  // drop old spine points (keep baseIdx bookkeeping for chunk building)
  while (spine.length > 40 && spine[8].s < car.dist - BEHIND - 40) { spine.splice(0, 8); baseIdx += 8; }
}

let nearestCrossing = null;
function updateTraffic(dt, t) {
  // parallel rails follow the curving spine
  for (const tr of railTrains) {
    tr.s += tr.dir * tr.speed * dt;
    const target = car.dist + 190;
    if (tr.dir > 0 && tr.s < car.dist - 140) tr.s = target + rr(0, 160);
    if (tr.dir < 0 && tr.s > car.dist + 560) tr.s = car.dist + rr(120, 300);
    if (tr.dir > 0 && tr.s > car.dist + 620) tr.s = car.dist - 60;
    placeOnSpine(tr.obj, tr.s, tr.off, tr.y);
    tr.obj.rotation.y += tr.dir > 0 ? 0 : Math.PI;
  }
  // perpendicular trains: pick nearest live crossing, run ground + air trains through it
  nearestCrossing = null; let bd = 1e9;
  for (const c of liveCrossings) { const d = Math.abs(c.s - car.dist); if (d < bd) { bd = d; nearestCrossing = c; } }
  crossTrainGround.visible = crossTrainAir.visible = !!nearestCrossing;
  if (nearestCrossing) {
    const c = nearestCrossing;
    const u = ((t * c.speed + c.phase) % 200) - 100;          // across-track position
    const airU = ((t * 30 + c.phase * 1.7) % 220) - 110;
    const r = rgt(c), f = fwd(c);
    crossTrainGround.position.set(c.x + r.x * u, c.y + .95, c.z + r.z * u);
    crossTrainGround.rotation.y = c.h + Math.PI / 2;
    crossTrainAir.position.set(c.x + r.x * airU + f.x * 6.5, c.y + 14.7, c.z + r.z * airU + f.z * 6.5);
    crossTrainAir.rotation.y = c.h - Math.PI / 2;
    c.trainU = u;
    // collision with the at-grade train
    const dx = car.pos.x - c.x, dz = car.pos.z - c.z;
    const along = dx * f.x + dz * f.z, across = dx * r.x + dz * r.z;
    if (Math.abs(along) < 3.2 && Math.abs(across - u) < 20 && Math.abs(car.pos.y - c.y) < 3 && Math.abs(car.speedF) > 2) {
      car.vel.multiplyScalar(.18); shake = 1; flash();
      car.pos.x += f.x * Math.sign(car.speedF || 1) * -4;
      showToast('💥 HIT THE CROSSING TRAIN — WATCH THE SIGNALS');
    }
  }
}

// ============================================================
//  HUD + CAMERA + MAIN LOOP
// ============================================================
const el = id => document.getElementById(id);
const camPos = new THREE.Vector3(0, 5, -10);
let last = performance.now();

function animate(now) {
  requestAnimationFrame(animate);
  let dt = Math.min(.033, (now - last) / 1000); last = now;
  const t = now / 1000;

  if (running && !paused) {
    const q = updateCar(dt);
    ensureChunks();
    updateTraffic(dt, t);

    el('kmh').textContent = Math.round(Math.abs(car.speedF) * 3.6);
    el('dist').textContent = (car.dist / 1000).toFixed(2) + ' km';
    el('nitro').style.width = (car.nitro * 100) + '%';
    el('drift').style.width = (car.driftAmt * 100) + '%';
    el('mode').textContent = car.driftAmt > .35 ? 'DRIFT' : (car.nitro > .02 && (keys.ShiftLeft || keys.ShiftRight) && car.speedF > 5 ? 'NITRO' : 'GRIP');
    el('mode').style.color = car.driftAmt > .35 ? '#ffd28a' : '#7ee2a8';
    el('feature').textContent = SECTION_LABEL[q.p.section] || q.p.section.toUpperCase();

    const warn = nearestCrossing && Math.abs(nearestCrossing.s - car.dist) < 130 && Math.abs(nearestCrossing.trainU ?? 99) < 55;
    el('warn').classList.toggle('hidden', !warn);

    // chase camera (3 modes), speed FOV kick, impact shake
    shake = Math.max(0, shake - dt * 2.4);
    const back = camMode === 2 ? 4.2 : camMode === 1 ? 13 : 8.6;
    const high = camMode === 2 ? 1.5 : camMode === 1 ? 5.2 : 3.1;
    const sin = Math.sin(car.yaw), cos = Math.cos(car.yaw);
    const desired = new THREE.Vector3(car.pos.x - sin * back, car.pos.y + high, car.pos.z - cos * back);
    camPos.lerp(desired, 1 - Math.pow(.0001, dt));
    if (camMode === 2) camPos.copy(desired);
    camera.position.copy(camPos);
    camera.position.x += (rnd() - .5) * shake * .5;
    camera.position.y += (rnd() - .5) * shake * .4;
    const look = new THREE.Vector3(car.pos.x + sin * 14, car.pos.y + 1.2, car.pos.z + cos * 14);
    camera.lookAt(look);
    camera.fov += ((66 + Math.min(16, Math.abs(car.speedF) * .22) + (car.driftAmt * 3)) - camera.fov) * Math.min(1, dt * 5);
    camera.updateProjectionMatrix();

    // sun + ground follow
    sun.position.set(car.pos.x + 70, 130, car.pos.z + 45);
    sun.target.position.copy(car.pos);
    ground.position.x = Math.round(car.pos.x / 40) * 40;
    ground.position.z = Math.round(car.pos.z / 40) * 40;
  } else {
    // menu orbit camera over the start straight
    const a = t * .07;
    camera.position.set(Math.sin(a) * 26, 9, Math.cos(a) * 26);
    camera.lookAt(0, 1, 22);
    if (camera.fov !== 62) { camera.fov = 62; camera.updateProjectionMatrix(); }
    carGroup.position.copy(car.pos);
    carGroup.rotation.y = 0;
    ensureChunks();
  }
  renderer.render(scene, camera);
}

resetCar();
car.pos.set(0, 0, 0);
ensureChunks();
requestAnimationFrame(animate);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
