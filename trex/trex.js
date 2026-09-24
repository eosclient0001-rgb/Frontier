// Tyrannosaurus rex — procedurally modelled, articulated skeleton with an IK-driven gait engine.
// Units: metres. Body frame: +X forward, +Y up, +Z = animal's left.
// Proportions follow published skeletal reconstructions of FMNH PR 2081 ("Sue") —
// skull ≈1.41 m, femur 1.32 m, tibia 1.16 m, metatarsal III 0.66 m, total length ≈12.3 m.

import * as THREE from 'three';
import { OrbitControls } from './lib/OrbitControls.js';
import { mergeGeometries, mergeVertices } from './lib/BufferGeometryUtils.js';
import { RoomEnvironment } from './lib/RoomEnvironment.js';

const params = new URLSearchParams(location.search);
const CALIB = params.has('calib');
const SIL = params.has('sil');

// ───────────────────────────────────────────────────────── utilities
const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const V2 = (x = 0, y = 0) => new THREE.Vector2(x, y);
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const frac = (x) => x - Math.floor(x);
const TAU = Math.PI * 2;
const approach = (x, target, maxStep) => x + clamp(target - x, -maxStep, maxStep);
function table(tab, x) { // piecewise-linear lookup [[x,y],...]
  if (x <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) if (x <= tab[i][0]) {
    const [x0, y0] = tab[i - 1], [x1, y1] = tab[i];
    return lerp(y0, y1, (x - x0) / (x1 - x0));
  }
  return tab[tab.length - 1][1];
}
// cheap smooth 1-D noise
function noise1(x) { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  const h = (n) => frac(Math.sin(n * 127.1 + 311.7) * 43758.5453) * 2 - 1; return lerp(h(i), h(i + 1), u); }

let elementCount = 0; // anatomical elements modelled
const count = (n = 1) => { elementCount += n; };

// ───────────────────────────────────────────────────────── geometry helpers
function finalize(g) { // ensure indexed-free geometry w/ position+normal+uv for merging
  if (!g.attributes.normal) g.computeVertexNormals();
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.clearGroups();
  return g;
}
function merge(list) { const g = mergeGeometries(list.filter(Boolean).map(finalize)); g.computeBoundingSphere(); return g; }
function smoothNormals(g) {
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  g = mergeVertices(g, 1e-5); g.computeVertexNormals(); return g;
}
function mirrorZ(g) { g = g.clone(); const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, -p.getZ(i)); p.needsUpdate = true; g.computeVertexNormals(); return g; }

// Sweep an (elliptical) cross-section along a polyline with parallel-transport frames.
// rf(t) → radius or [lateral, normal] radii.
function sweep(pts, rf, seg = 10, up = V3(0, 1, 0), caps = true) {
  if (typeof rf !== 'function') { const k = rf; rf = () => k; }
  const n = pts.length, T = [], N = [], B = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    T.push(b.clone().sub(a).normalize());
  }
  let u = up.clone();
  if (Math.abs(u.dot(T[0])) > 0.98) u = Math.abs(T[0].x) < 0.9 ? V3(1, 0, 0) : V3(0, 0, 1);
  let nn = u.clone().sub(T[0].clone().multiplyScalar(u.dot(T[0]))).normalize();
  for (let i = 0; i < n; i++) {
    if (i > 0) { nn = nn.clone().sub(T[i].clone().multiplyScalar(nn.dot(T[i]))).normalize(); }
    N.push(nn); B.push(T[i].clone().cross(nn));
  }
  const pos = [], idx = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1); const r = rf(t);
    const a = Array.isArray(r) ? r[0] : r, b = Array.isArray(r) ? r[1] : r;
    for (let j = 0; j < seg; j++) {
      const ang = j / seg * TAU, c = Math.cos(ang), s = Math.sin(ang);
      pos.push(pts[i].x + B[i].x * c * a + N[i].x * s * b,
               pts[i].y + B[i].y * c * a + N[i].y * s * b,
               pts[i].z + B[i].z * c * a + N[i].z * s * b);
    }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) {
    const a = i * seg + j, b = i * seg + (j + 1) % seg, c = (i + 1) * seg + j, d = (i + 1) * seg + (j + 1) % seg;
    idx.push(a, b, c, b, d, c);
  }
  if (caps) {
    const c0 = pos.length / 3; pos.push(pts[0].x, pts[0].y, pts[0].z);
    const c1 = pos.length / 3; pos.push(pts[n - 1].x, pts[n - 1].y, pts[n - 1].z);
    for (let j = 0; j < seg; j++) {
      idx.push(c0, (j + 1) % seg, j);
      idx.push(c1, (n - 1) * seg + j, (n - 1) * seg + (j + 1) % seg);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return g;
}
const curve = (arr, n = 16) => new THREE.CatmullRomCurve3(arr.map(p => Array.isArray(p) ? V3(...p) : p), false, 'centripetal').getPoints(n);
const line = (a, b, n = 8) => { const A = V3(...a), Bv = V3(...b); const r = []; for (let i = 0; i <= n; i++) r.push(A.clone().lerp(Bv, i / n)); return r; };
function rod(a, b, rf, seg = 8, n = 8, up) { return sweep(line(a, b, n), typeof rf === 'number' ? () => rf : rf, seg, up); }
function ellip(c, rx, ry, rz, ws = 12, hs = 9) {
  const g = new THREE.SphereGeometry(1, ws, hs); g.scale(rx, ry, rz); g.translate(c[0], c[1], c[2]); return g;
}
function ellipRot(c, r, rot) { const g = new THREE.SphereGeometry(1, 12, 9); g.scale(r[0], r[1], r[2]);
  g.rotateX(rot[0] || 0); g.rotateY(rot[1] || 0); g.rotateZ(rot[2] || 0); g.translate(c[0], c[1], c[2]); return g; }
// Bone "spool": profile along +X
function spool(L, r0, rMid, r1, seg = 10) {
  return sweep(line([0, 0, 0], [L, 0, 0], 10), (t) => {
    const w = 1 - Math.sin(Math.PI * t) * 0.9; // 1 at ends 0.1 mid
    const r = t < 0.5 ? lerp(rMid, r0, w) : lerp(rMid, r1, w);
    const cap = Math.sqrt(Math.max(0.05, 1 - Math.pow(Math.abs(t - 0.5) * 2, 8)));
    return r * cap;
  }, seg);
}
function smoothClosed(arr, n) {
  const c = new THREE.CatmullRomCurve3(arr.map(p => V3(p[0], p[1], 0)), true, 'centripetal');
  return c.getSpacedPoints(n).slice(0, n).map(p => V2(p.x, p.y));
}
function ellipsePts(cx, cy, rx, ry, rot = 0, n = 28) {
  const r = []; for (let i = 0; i < n; i++) { const a = i / n * TAU, x = Math.cos(a) * rx, y = Math.sin(a) * ry;
    r.push([cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)]); } return r;
}
function plate(outline, holes = [], depth = 0.04, bevel = 0.012, bevelT = 0.012) {
  const sh = new THREE.Shape(outline);
  for (const h of holes) sh.holes.push(new THREE.Path(h));
  let g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bevelT, bevelSize: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return smoothNormals(g);
}
function profileRange(poly, x) { // poly Vector2[] closed; return [minY,maxY] at x
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if ((a.x - x) * (b.x - x) <= 0 && a.x !== b.x) { const y = lerp(a.y, b.y, (x - a.x) / (b.x - a.x)); lo = Math.min(lo, y); hi = Math.max(hi, y); }
  }
  return [lo, hi];
}
// closed loft through rings of equal size
function loft(rings) {
  const m = rings[0].length, n = rings.length, pos = [], idx = [];
  for (const r of rings) for (const p of r) pos.push(p.x, p.y, p.z);
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < m; j++) {
    const a = i * m + j, b = i * m + (j + 1) % m, c = (i + 1) * m + j, d = (i + 1) * m + (j + 1) % m;
    idx.push(a, c, b, b, c, d);
  }
  for (const [ri, flip] of [[0, false], [n - 1, true]]) {
    const cen = V3(); rings[ri].forEach(p => cen.add(p)); cen.multiplyScalar(1 / m);
    const ci = pos.length / 3; pos.push(cen.x, cen.y, cen.z);
    for (let j = 0; j < m; j++) { const a = ri * m + j, b = ri * m + (j + 1) % m; flip ? idx.push(ci, a, b) : idx.push(ci, b, a); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
// curved conical tooth / claw along +dir with backward curvature
function cone(len, r, curl = 0.25, flat = 0.8, dir = -1, seg = 8) {
  const pts = []; for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(V3(-curl * len * t * t, dir * len * t, 0)); }
  return sweep(pts, (t) => { const k = Math.pow(1 - t, 0.85) * r + 0.002; return [k * flat, k]; }, seg, V3(1, 0, 0));
}

// ───────────────────────────────────────────────────────── renderer / scene
const canvas = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: CALIB && !SIL, preserveDrawingBuffer: CALIB || SIL });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const BG = new THREE.Color(0x1d2127);
scene.background = (CALIB || SIL) ? (SIL ? new THREE.Color(0x000000) : null) : BG;
scene.fog = (CALIB || SIL) ? null : new THREE.Fog(BG, 28, 75);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;
scene.environmentIntensity = 0.35;

const camera = (CALIB || SIL)
  ? new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
  : new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 300);
camera.position.set(10.5, 4.8, 12.5);
const controls = new OrbitControls(camera, canvas);
controls.target.set(0.2, 2.0, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 3; controls.maxDistance = 45;

scene.add(new THREE.HemisphereLight(0xdde6f5, 0x3b3226, 0.75));
const sun = new THREE.DirectionalLight(0xfff0dc, 2.6);
sun.position.set(7, 14, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 9, bottom: -9, near: 1, far: 40 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const rim = new THREE.DirectionalLight(0x9fb8ff, 1.1); rim.position.set(-9, 6, -10); scene.add(rim);

// materials — shared uniform lets us swap "fresh bone" ↔ "fossil cast" finish
const U = { uFossil: { value: 0 } };
function boneMaterial(color, rough) {
  const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0, side: THREE.DoubleSide });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uFossil = U.uFossil;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLP;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLP = position;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vLP; uniform float uFossil;
        float h3(vec3 p){ p = fract(p*0.3183099 + 0.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        float n3(vec3 x){ vec3 i=floor(x), f=fract(x); f=f*f*(3.0-2.0*f);
          return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x), mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
                     mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x), mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y), f.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float nA = n3(vLP*11.0)*0.5 + n3(vLP*29.0)*0.3 + n3(vLP*83.0)*0.2;
        float nB = n3(vLP*2.7 + 5.0);
        vec3 boneC = diffuseColor.rgb * (0.80 + 0.32*nA) * mix(vec3(1.0), vec3(1.05,0.97,0.86), nB);
        vec3 fosC = mix(vec3(0.16,0.12,0.09), vec3(0.50,0.39,0.28), smoothstep(0.2,0.85,nA)) * (0.75 + 0.45*nB);
        diffuseColor.rgb = mix(boneC, fosC, uFossil);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = clamp(roughnessFactor + (nA - 0.5)*0.3 + uFossil*0.08, 0.05, 1.0);`);
  };
  return m;
}
const BONE = boneMaterial(0xe9dfc8, 0.6);
const TOOTH = boneMaterial(0xf3ecdc, 0.32);

function mesh(geo, parent, mat = BONE) {
  const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
function joint(parent, x = 0, y = 0, z = 0, name = '') {
  const g = new THREE.Group(); g.name = name; g.position.set(x, y, z); parent.add(g);
  g.userData.base = V3(); return g;
}
const setRot = (j, x, y, z) => j.rotation.set(j.userData.base.x + x, j.userData.base.y + y, j.userData.base.z + z);

// ───────────────────────────────────────────────────────── skeleton construction
const dino = new THREE.Group(); scene.add(dino);
const pelvis = joint(dino, 0, 2.8, 0, 'pelvis');
pelvis.rotation.order = 'YXZ';
const COL_Y = 0.31;           // vertebral column height above acetabulum
const HIP_Z = 0.34;           // acetabulum lateral offset

// ---------- vertebra builder (built along +X from posterior face x=0 to anterior x=L)
function vertebra(o) {
  const { L, R } = o, parts = [];
  // centrum (spool, slightly wider than tall in cervicals)
  const cz = o.wide || 1;
  parts.push(sweep(line([0, 0, 0], [L, 0, 0], 8), (t) => {
    const r = R * (1 - 0.2 * Math.sin(Math.PI * t)) * (t < 0.06 || t > 0.94 ? 0.92 : 1);
    return [r * cz, r];
  }, 12));
  const archY = R * 0.85, archH = R * 0.8;
  // neural arch
  const ab = new THREE.BoxGeometry(L * 0.72, archH, R * 1.25); ab.translate(L * 0.5, archY + archH * 0.4, 0); parts.push(ab);
  const topY = archY + archH * 0.8;
  // neural spine blade
  if (o.spineH > 0.004) {
    const w0 = o.spineW0 ?? L * 0.6, w1 = o.spineW1 ?? L * 0.55, tilt = o.tilt || 0, H = o.spineH;
    const cx = L * 0.5 + (o.spineShift || 0), sx = Math.tan(tilt) * H;
    const shp = [V2(cx - w0 / 2, topY - 0.01), V2(cx + w0 / 2, topY - 0.01),
      V2(cx + w1 / 2 - sx, topY + H * 0.97), V2(cx + w1 * 0.3 - sx, topY + H), V2(cx - w1 * 0.3 - sx, topY + H), V2(cx - w1 / 2 - sx, topY + H * 0.95)];
    const th = o.spineT ?? Math.max(0.012, R * 0.28);
    parts.push(plate(shp, [], th, Math.min(0.01, th * 0.35), Math.min(0.01, th * 0.35)));
    // rugose cap
    if (H > 0.08) parts.push(ellip([cx - sx, topY + H, 0], w1 * 0.36, 0.022, th * 0.9, 8, 6));
  }
  // zygapophyses
  const zr = R * 0.28;
  for (const s of [1, -1]) {
    parts.push(ellip([L * 0.98, topY - 0.005, s * R * 0.42], zr * 1.3, zr * 0.7, zr));
    parts.push(ellip([L * 0.02, topY - 0.005, s * R * 0.42], zr * 1.3, zr * 0.7, zr));
  }
  // transverse processes
  if (o.tpLen > 0.01) for (const s of [1, -1]) {
    const up = o.tpUp || 0, back = o.tpBack || 0;
    const a = [L * 0.5, archY + archH * 0.5, s * R * 0.55];
    const b = [L * 0.5 - back, a[1] + Math.sin(up) * o.tpLen, s * (R * 0.55 + Math.cos(up) * o.tpLen)];
    parts.push(rod(a, b, (t) => [lerp(R * 0.42, R * 0.22, t) * (o.tpFlat || 1.6), lerp(R * 0.22, R * 0.12, t)], 8, 6, V3(0, 1, 0)));
  }
  // chevron (haemal arch) at posterior end, pointing down/back (in build space "back" = -X)
  if (o.chev > 0.01) {
    const H = o.chev, tb = o.chevTilt ?? 0.45;
    for (const s of [1, -1]) parts.push(rod([L * 0.05, -R * 0.8, s * R * 0.35], [L * 0.05 - H * 0.2 * Math.sin(tb), -R * 0.8 - H * 0.2, s * R * 0.12], R * 0.13, 6, 4));
    const top = [L * 0.05 - H * 0.2 * Math.sin(tb), -R * 0.8 - H * 0.2, 0];
    const bot = [top[0] - H * 0.8 * Math.sin(tb), top[1] - H * 0.8 * Math.cos(tb), 0];
    parts.push(rod(top, bot, (t) => [lerp(R * 0.14, R * 0.08, t), lerp(R * 0.3, R * 0.2, t) + Math.sin(t * Math.PI) * R * 0.1], 8, 6, V3(0, 0, 1)));
  }
  // cervical ribs (pointing backward)
  if (o.cRib > 0.01) for (const s of [1, -1]) {
    parts.push(sweep(curve([[L * 0.75, -R * 0.55, s * R * 1.0], [L * 0.3, -R * 0.9, s * R * 1.35], [L * 0.3 - o.cRib, -R * 1.25, s * R * 1.25]], 10),
      (t) => lerp(R * 0.2, R * 0.05, t), 6));
    // epipophysis
    parts.push(ellip([L * 0.15, topY + R * 0.15, s * R * 0.55], R * 0.35, R * 0.22, R * 0.2));
  }
  return merge(parts);
}

// ---------- sacrum + pelvic girdle (in pelvis frame, acetabulum = origin)
(function buildPelvis() {
  const parts = [];
  // 5 fused sacrals
  const SL = 0.19;
  for (let i = 0; i < 5; i++) {
    const g = vertebra({ L: SL, R: 0.085, spineH: 0.0, tpLen: 0.16, tpUp: -0.2, tpFlat: 2.2 });
    g.translate(-0.40 + i * SL, COL_Y, 0); parts.push(g);
  }
  count(5);
  // fused sacral spines form a continuous plate
  parts.push(plate([V2(-0.38, COL_Y + 0.12), V2(0.53, COL_Y + 0.12), V2(0.52, 0.64), V2(0.40, 0.67), V2(-0.28, 0.66), V2(-0.38, 0.60)], [], 0.035, 0.01, 0.01));
  // ilium (left), perforate acetabulum under the arch, then tilted so dorsal margins converge at midline
  const ilOut = smoothClosed([
    [0.38, -0.12], [0.46, 0.00], [0.60, 0.04], [0.76, 0.03], [0.90, 0.13], [0.94, 0.30], [0.90, 0.48], [0.74, 0.60],
    [0.40, 0.67], [0.0, 0.69], [-0.40, 0.65], [-0.62, 0.56], [-0.76, 0.42], [-0.78, 0.27], [-0.68, 0.17], [-0.50, 0.12],
    [-0.38, 0.04], [-0.31, -0.10], [-0.22, -0.09], [-0.17, 0.05], [-0.09, 0.14], [0.0, 0.17], [0.09, 0.14], [0.16, 0.05],
    [0.22, -0.10], [0.30, -0.15]], 140);
  let il = plate(ilOut, [], 0.045, 0.014, 0.014);
  // supraacetabular crest (hood over the hip socket) + faint vertical ridge, hugging the blade surface
  il = merge([il, ellipRot([0.0, 0.16, 0.022], [0.24, 0.045, 0.03], [0, 0, 0]), ellipRot([0.0, 0.40, 0.02], [0.022, 0.2, 0.018], [0, 0, 0.05])]);
  il.rotateX(-0.28); il.translate(0, 0, 0.29);
  // pubis (left)
  const pub = sweep(curve([[0.28, -0.11, 0.28], [0.40, -0.45, 0.22], [0.55, -0.80, 0.12], [0.62, -0.98, 0.06]], 14),
    (t) => [lerp(0.06, 0.045, t), lerp(0.08, 0.06, t)], 10);
  // ischium (left)
  const isc = sweep(curve([[-0.27, -0.10, 0.27], [-0.44, -0.36, 0.20], [-0.62, -0.58, 0.11], [-0.78, -0.72, 0.05]], 14),
    (t) => [lerp(0.045, 0.028, t), lerp(0.07, 0.04, t)], 10);
  const obt = ellipRot([-0.37, -0.28, 0.22], [0.09, 0.03, 0.012], [0, 0, 0.9]);
  const iscEnd = ellip([-0.79, -0.74, 0.04], 0.07, 0.035, 0.03);
  const left = merge([il, pub, isc, obt, iscEnd]);
  parts.push(left, mirrorZ(left));
  count(6);
  // pubic apron + boot (fused)
  parts.push(plate([V2(0.46, -0.55), V2(0.53, -0.55), V2(0.67, -0.96), V2(0.55, -0.96)], [], 0.05, 0.015, 0.015));
  const boot = merge([ellip([0.50, -1.03, 0], 0.42, 0.075, 0.13, 16, 10), ellip([0.78, -1.02, 0], 0.16, 0.07, 0.11), ellip([0.18, -1.035, 0], 0.14, 0.065, 0.1)]);
  parts.push(boot);
  mesh(merge(parts), pelvis);
})();

// ---------- dorsal column (3 flexible trunk segments), ribs, gastralia
const DL = 0.162;               // dorsal centrum length
const trunk = [];
const ribs = [];
const segCounts = [4, 5, 4];     // D13-D10 | D9-D5 | D4-D1
(function buildTrunk() {
  let parent = pelvis, pos = V3(0.53, COL_Y, 0), dIndex = 13; // start with most posterior dorsal
  const basePitch = [0.02, -0.03, -0.12];
  const ribD = [0.80, 1.05, 1.25, 1.36, 1.40, 1.38, 1.30, 1.17, 1.0, 0.82, 0.62, 0.42]; // D2..D13
  const ribW = [0.44, 0.52, 0.58, 0.62, 0.64, 0.64, 0.62, 0.60, 0.56, 0.52, 0.46, 0.38];
  const ribB = [0.10, 0.14, 0.20, 0.26, 0.30, 0.34, 0.37, 0.39, 0.40, 0.38, 0.34, 0.28];
  for (let s = 0; s < 3; s++) {
    const j = joint(parent, pos.x, pos.y, pos.z, 'trunk' + s);
    j.userData.base.z = basePitch[s];
    trunk.push(j);
    const parts = [];
    for (let k = 0; k < segCounts[s]; k++) {
      const d = dIndex; // D number
      const f = (13 - d) / 12;
      const g = vertebra({ L: DL, R: lerp(0.09, 0.085, f), spineH: lerp(0.09, 0.07, f), spineW0: DL * 0.6, spineW1: DL * 0.62,
        tilt: -0.05, tpLen: 0.17, tpUp: 0.35, tpBack: 0.02, tpFlat: 1.8 });
      g.translate(k * DL, 0, 0); parts.push(g); count();
      // ribs on D2..D13
      if (d >= 2) {
        const ri = d - 2; const D = ribD[ri], W = ribW[ri], b = ribB[ri];
        for (const side of [1, -1]) {
          const rg = joint(j, k * DL + DL * 0.5, 0.13, side * 0.2, 'rib');
          rg.userData.side = side;
          const pts = curve([[0, 0, 0], [-0.04 * b, -0.04, side * 0.72 * (W - 0.2)], [-0.25 * b, -0.36 * D, side * (W - 0.2)],
            [-0.58 * b, -0.72 * D, side * ((W - 0.2) * 0.84)], [-b, -D, side * ((W - 0.2) * 0.45)]], 22);
          const rib = merge([sweep(pts, (t) => [lerp(0.024, 0.011, t), lerp(0.03, 0.013, t)], 7),
            rod([0, 0, 0], [0.01, -0.12, -side * 0.13], 0.016, 6, 4)]);   // capitulum toward centrum
          mesh(rib, rg); ribs.push(rg); count();
        }
      }
      dIndex--;
    }
    mesh(merge(parts), j);
    parent = j; pos = V3(segCounts[s] * DL, 0, 0);
  }
})();
const neckBaseParent = trunk[2];
const neckBaseOffset = V3(segCounts[2] * DL, 0, 0);

// gastralia basket (pelvis frame)
(function buildGastralia() {
  const parts = []; const rows = 18;
  for (let i = 0; i < rows; i++) {
    const t = i / (rows - 1);
    const x = lerp(0.95, 2.55, t);
    const yb = -1.02 - 0.12 * Math.sin(Math.PI * Math.min(1, t * 1.15)) + 0.12 * smooth(0.8, 1, t);
    const W = lerp(0.38, 0.56, Math.sin(Math.PI * t * 0.9 + 0.2));
    for (const s of [1, -1]) {
      parts.push(sweep(curve([[x - 0.06, yb + 0.30, s * W], [x - 0.02, yb + 0.08, s * W * 0.8], [x + 0.03, yb, s * W * 0.4], [x + 0.08, yb - 0.005, -s * 0.03]], 12),
        (u) => lerp(0.012, 0.008, u), 5));
    }
  }
  count(rows * 4);
  mesh(merge(parts), pelvis);
})();

// ---------- pectoral girdle + forelimbs (on front trunk segment)
const arms = [];
(function buildArms() {
  const T = trunk[2];
  // Glenoid in trunk2 frame
  for (const s of [1, -1]) {
    const parts = [];
    const gl = [0.34, -0.70, 0.46];
    // scapula blade: long strap sweeping up/back over ribcage
    const sc = sweep(curve([[gl[0] + 0.02, gl[1] + 0.02, gl[2]], [0.18, -0.46, 0.47], [-0.05, -0.20, 0.45], [-0.36, 0.02, 0.38]], 18),
      (t) => [lerp(0.10, 0.05, Math.min(1, t * 1.6)) + 0.035 * smooth(0.7, 1, t), 0.017], 10, V3(0, 0, 1));
    const acro = ellipRot([0.30, -0.56, 0.47], [0.1, 0.05, 0.02], [0, 0, 0.8]);
    const cor = ellipRot([0.44, -0.80, 0.44], [0.14, 0.10, 0.022], [0.1, 0.25, 0.3]);
    const glen = ellip(gl, 0.06, 0.05, 0.05);
    let g = merge([sc, acro, cor, glen]);
    if (s < 0) g = mirrorZ(g);
    parts.push(g);
    mesh(merge(parts), T); count(2);
    // arm chain
    const sh = joint(T, gl[0], gl[1] - 0.02, s * (gl[2] + 0.03), 'shoulder'); sh.userData.base.set(s * 0.15, 0, -0.2);
    let hum = merge([spool(0.39, 0.055, 0.03, 0.045).rotateZ(-Math.PI / 2), ellip([0.02, -0.02, 0], 0.06, 0.05, 0.05), // head
      ellipRot([0.035, -0.11, 0], [0.025, 0.06, 0.018], [0, 0, 0])]);                                              // deltopectoral crest
    const el = joint(sh, 0, -0.39, 0, 'elbow'); el.userData.base.set(0, 0, 1.25);
    let fore = merge([spool(0.22, 0.03, 0.02, 0.027).rotateZ(-Math.PI / 2).translate(0, 0, 0.02),
      spool(0.22, 0.032, 0.018, 0.024).rotateZ(-Math.PI / 2).translate(-0.005, 0, -0.022),
      ellip([-0.03, 0.0, -0.02], 0.03, 0.035, 0.025)]);                 // olecranon
    const wr = joint(el, 0, -0.22, 0, 'wrist'); wr.userData.base.set(0, 0, 0.35);
    // manus: 2 functional digits + metacarpal III splint
    const hand = [];
    hand.push(ellip([0, -0.015, 0], 0.03, 0.02, 0.04));
    const d1 = [spool(0.07, 0.022, 0.015, 0.02), spool(0.085, 0.02, 0.012, 0.017).translate(0.07, 0, 0), cone(0.08, 0.017, 0.35, 0.55, -1).rotateZ(Math.PI / 2).rotateZ(Math.PI).translate(0.155, 0, 0)];
    const g1 = merge(d1); g1.rotateZ(-Math.PI / 2 - 0.25); g1.translate(0.0, -0.02, 0.022); hand.push(g1);
    const d2 = [spool(0.115, 0.022, 0.014, 0.02), spool(0.10, 0.02, 0.012, 0.017).translate(0.115, 0, 0), spool(0.06, 0.017, 0.011, 0.015).translate(0.215, 0, 0),
      cone(0.09, 0.016, 0.35, 0.55, -1).rotateZ(Math.PI / 2).rotateZ(Math.PI).translate(0.275, 0, 0)];
    const g2 = merge(d2); g2.rotateZ(-Math.PI / 2 + 0.1); g2.translate(0.0, -0.02, -0.018); hand.push(g2);
    hand.push(rod([0, -0.02, -0.04], [-0.01, -0.08, -0.045], (t) => lerp(0.01, 0.004, t), 5, 4));
    let handG = merge(hand);
    if (s < 0) { hum = mirrorZ(hum); fore = mirrorZ(fore); handG = mirrorZ(handG); }
    mesh(hum, sh); mesh(fore, el); mesh(handG, wr);
    count(3 + 2 + 3 + 4 + 1);
    arms.push({ side: s, sh, el, wr });
  }
  // furcula (wishbone)
  mesh(sweep(curve([[0.32, -0.60, 0.43], [0.52, -0.82, 0.25], [0.60, -0.90, 0], [0.52, -0.82, -0.25], [0.32, -0.60, -0.43]], 20),
    (t) => 0.018 + 0.008 * Math.sin(Math.PI * t), 7), T); count();
})();

// ---------- neck (10 cervicals) and head
const neck = [];
let headJoint, jawJoint;
(function buildNeck() {
  const lens = [0.132, 0.132, 0.129, 0.126, 0.123, 0.120, 0.118, 0.115, 0.142, 0.068]; // C10 … C2(axis), C1(atlas)
  const base = [0.36, 0.22, 0.12, 0.01, -0.09, -0.19, -0.27, -0.31, -0.21, -0.10];
  let parent = neckBaseParent, pos = neckBaseOffset.clone();
  for (let i = 0; i < 10; i++) {
    const j = joint(parent, pos.x, pos.y, pos.z, 'neck' + i); j.userData.base.z = base[i];
    const f = i / 9;
    const R = lerp(0.1, 0.075, f), L = lens[i];
    const isAtlas = i === 9, isAxis = i === 8;
    const g = vertebra({ L, R, wide: 1.3, spineH: isAtlas ? 0.0 : isAxis ? 0.11 : lerp(0.11, 0.06, f), spineW0: L * 0.55, spineW1: isAxis ? L * 0.9 : L * 0.45,
      tilt: 0.25, spineT: 0.03, tpLen: isAtlas ? 0.04 : 0.1, tpUp: -0.35, tpBack: -0.02, tpFlat: 1.8, cRib: isAtlas ? 0 : lerp(0.34, 0.2, f) });
    mesh(g, j); count(isAtlas ? 1 : 3);
    neck.push(j); parent = j; pos = V3(L, 0, 0);
  }
  headJoint = joint(parent, pos.x, pos.y, 0, 'head'); headJoint.userData.base.z = -0.12;
})();

// ---------- skull (traced from lateral-view reference, 1 px = 2.49 mm, origin at occipital condyle)
(function buildSkull() {
  const S = 0.00249, OX = 135, OY = 400;
  const P = (a) => a.map(([x, y]) => [(x - OX) * S, (OY - y) * S]);
  const outlineRaw = smoothClosed(P([[135, 442], [124, 420], [118, 390], [110, 360], [100, 332], [97, 305], [108, 280], [128, 262], [152, 246], [172, 226],
    [184, 202], [193, 188], [205, 196], [214, 210], [245, 212], [290, 222], [340, 238], [400, 252], [460, 264], [520, 278], [572, 292], [612, 308],
    [640, 328], [658, 352], [666, 380], [664, 408], [655, 430], [640, 442], [610, 438], [570, 436], [520, 432], [470, 426], [425, 418], [395, 412],
    [365, 412], [338, 420], [314, 436], [298, 452], [286, 458], [272, 448], [254, 432], [225, 421], [195, 417], [165, 424], [148, 440]]), 260);
  // the resampling spline overshoots at the sharp step behind the quadrate — clamp it back
  // to the traced silhouette (premaxilla → occipital condyle = 1.30 m, → quadrate = 1.46 m)
  const outline = outlineRaw.map((p) => V2(clamp(p.x, -0.115, 1.328), clamp(p.y, -0.112, 0.452)));
  const holes = [
    smoothClosed(P([[282, 250], [300, 242], [318, 250], [326, 272], [318, 300], [308, 325], [298, 345], [290, 335], [286, 305], [278, 275]]), 50),    // orbit (keyhole)
    smoothClosed(P([[160, 250], [190, 238], [222, 252], [226, 275], [212, 305], [208, 340], [218, 375], [205, 392], [178, 392], [163, 365], [158, 320], [156, 285]]), 60), // lateral temporal fenestra
    smoothClosed(P([[362, 296], [395, 280], [440, 279], [466, 292], [462, 330], [448, 362], [422, 378], [392, 378], [368, 362], [356, 332]]), 60),   // antorbital fenestra
    smoothClosed(P(ellipsePts(498, 360, 15, 15, 0, 20)), 24),   // maxillary fenestra
    smoothClosed(P(ellipsePts(624, 330, 20, 9, 0.6, 20)), 24),  // external naris
  ];
  const wB = [[-0.12, 0.44], [0.0, 0.46], [0.22, 0.45], [0.34, 0.40], [0.45, 0.33], [0.60, 0.28], [0.80, 0.23], [1.0, 0.20], [1.15, 0.17], [1.25, 0.14], [1.30, 0.10], [1.335, 0.04]];
  const wT = [[-0.12, 0.34], [0.1, 0.37], [0.25, 0.34], [0.36, 0.28], [0.48, 0.17], [0.60, 0.11], [0.80, 0.085], [1.0, 0.075], [1.15, 0.065], [1.25, 0.055], [1.30, 0.04], [1.335, 0.02]];
  const yr = (x) => profileRange(outline, clamp(x, -0.09, 1.318));
  const wAt = (x, y) => { const [lo, hi] = yr(x); const t = clamp((y - lo) / Math.max(0.05, hi - lo), 0, 1); return lerp(table(wB, x), table(wT, x), t * t * (3 - 2 * t)); };
  const parts = [];
  // lateral walls (left) — bend the traced plate around the skull's width profile
  let wall = plate(outline, holes, 0.04, 0.012, 0.012);
  { const p = wall.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i); p.setZ(i, p.getZ(i) + wAt(x, y) - 0.02); } wall.computeVertexNormals(); }
  parts.push(wall, mirrorZ(wall));
  // skull roof (frontals + fused, rugose nasals) lofted between the wall tops
  const rings = [];
  for (let i = 0; i <= 26; i++) {
    const x = lerp(0.36, 1.30, i / 26), top = yr(x)[1], w = table(wT, x) - 0.005, ring = [];
    for (let k = 0; k < 14; k++) { const a = Math.PI * k / 13; ring.push(V3(x, top - 0.035 + Math.sin(a) * 0.045, Math.cos(a) * w)); }
    for (let k = 13; k >= 0; k--) { const a = Math.PI * k / 13; ring.push(V3(x, top - 0.065 + Math.sin(a) * 0.03, Math.cos(a) * w * 0.92)); }
    rings.push(ring);
  }
  parts.push(loft(rings));
  for (let i = 0; i < 9; i++) { const x = lerp(0.62, 1.2, i / 8); parts.push(ellip([x, yr(x)[1] + 0.012, 0], 0.035, 0.018, 0.04, 8, 6)); }
  // postorbital-frontal bar, postorbital bosses, lacrimal horns
  parts.push(sweep(curve([[0.37, yr(0.37)[1] - 0.03, -0.28], [0.36, yr(0.36)[1] + 0.005, 0], [0.37, yr(0.37)[1] - 0.03, 0.28]], 16), 0.035, 8));
  for (const s of [1, -1]) {
    parts.push(ellip([0.30, yr(0.30)[1] - 0.02, s * 0.32], 0.07, 0.035, 0.05));
    parts.push(ellip([0.53, yr(0.53)[1] - 0.005, s * 0.15], 0.05, 0.03, 0.035));
  }
  // sagittal crest & nuchal crest (leaves dorsotemporal fenestrae open)
  parts.push(sweep(curve([[0.37, yr(0.37)[1] - 0.01, 0], [0.22, 0.49, 0], [0.06, 0.52, 0]], 12), (t) => [0.02, lerp(0.03, 0.05, t)], 8));
  parts.push(plate([V2(-0.38, 0.28), V2(-0.30, 0.42), V2(-0.12, 0.50), V2(0, 0.535), V2(0.12, 0.50), V2(0.30, 0.42), V2(0.38, 0.28), V2(0.30, 0.30), V2(0, 0.36), V2(-0.30, 0.30)], [], 0.04, 0.012, 0.012).rotateY(Math.PI / 2).translate(0.03, 0, 0));
  // occiput with foramen magnum, occipital condyle, paroccipital processes
  const occ = plate([V2(-0.28, -0.02), V2(0.28, -0.02), V2(0.33, 0.28), V2(0, 0.38), V2(-0.33, 0.28)], [ellipsePts(0, 0.08, 0.045, 0.05, 0, 18).map(p => V2(...p))], 0.035, 0.01, 0.01);
  parts.push(occ.rotateY(Math.PI / 2).translate(-0.05, 0, 0));
  parts.push(ellip([-0.035, 0.0, 0], 0.06, 0.055, 0.065));
  for (const s of [1, -1]) {
    parts.push(rod([-0.05, 0.12, s * 0.12], [-0.04, 0.05, s * 0.42], (t) => [lerp(0.03, 0.05, t), 0.025], 8, 6));
    parts.push(rod([0.0, -0.105, s * 0.43], [-0.01, 0.20, s * 0.35], (t) => lerp(0.05, 0.03, t), 8, 6)); // quadrate
    parts.push(ellip([0.0, -0.105, s * 0.43], 0.055, 0.04, 0.06));
    parts.push(rod([0.05, 0.02, s * 0.30], [0.55, 0.04, s * 0.13], (t) => [0.02, lerp(0.07, 0.03, t)], 8, 6)); // pterygoid
    parts.push(rod([0.33, -0.02, s * 0.33], [0.36, -0.16, s * 0.28], (t) => lerp(0.035, 0.02, t), 6, 4)); // ectopterygoid hook
  }
  parts.push(ellip([0.15, 0.2, 0], 0.2, 0.15, 0.14, 14, 10)); // braincase
  // secondary palate
  const pal = [];
  for (let i = 0; i <= 14; i++) {
    const x = lerp(0.62, 1.28, i / 14), y = yr(x)[0] + 0.10, w = table(wB, x) - 0.04, ring = [];
    for (let k = 0; k < 10; k++) { const a = TAU * k / 10; ring.push(V3(x, y + Math.sin(a) * 0.015, Math.cos(a) * w)); }
    pal.push(ring);
  }
  parts.push(loft(pal));
  mesh(merge(parts), headJoint); count(20); // cranium ≈ 20 paired/unpaired elements represented

  // upper teeth: 4 premaxillary (D-shaped) + 12 maxillary per side
  const teeth = [];
  const pmx = [[1.300, 0.030], [1.285, 0.055], [1.265, 0.075], [1.240, 0.092]];
  const mxLen = [0.10, 0.12, 0.13, 0.135, 0.13, 0.12, 0.11, 0.10, 0.088, 0.076, 0.064, 0.05];
  for (const s of [1, -1]) {
    for (const [x, z] of pmx) { const g = cone(0.06, 0.013, 0.2, 0.8, -1); g.translate(x, yr(x)[0] + 0.025, s * z); teeth.push(g); }
    for (let i = 0; i < 12; i++) {
      const x = lerp(1.20, 0.63, i / 11), L = mxLen[i];
      const g = cone(L, L * 0.17, 0.25, 0.75, -1); g.rotateX(-s * 0.06); g.translate(x, yr(x)[0] + 0.03, s * (table(wB, x) - 0.035)); teeth.push(g);
    }
  }
  mesh(merge(teeth), headJoint, TOOTH); count(32);

  // mandible (reference is drawn open — rotate about the articular glenoid into occlusion)
  const hingeImg = V2(125, 465), tipImg = V2(626, 600), hingeT = V2(135, 446), tipT = V2(628, 462);
  const a1 = Math.atan2(tipImg.y - hingeImg.y, tipImg.x - hingeImg.x), a2 = Math.atan2(tipT.y - hingeT.y, tipT.x - hingeT.x);
  const rot = a2 - a1, sc = tipT.distanceTo(hingeT) / tipImg.distanceTo(hingeImg);
  const J = [(hingeT.x - OX) * S, (OY - hingeT.y) * S];
  const MT = (arr) => arr.map(([x, y]) => { const dx = x - hingeImg.x, dy = y - hingeImg.y;
    const X = hingeT.x + sc * (dx * Math.cos(rot) - dy * Math.sin(rot)), Y = hingeT.y + sc * (dx * Math.sin(rot) + dy * Math.cos(rot));
    return [(X - OX) * S - J[0], (OY - Y) * S - J[1]]; });
  const mOut = smoothClosed(MT([[95, 462], [110, 455], [150, 452], [200, 458], [250, 468], [300, 478], [345, 490], [380, 505], [410, 524], [440, 538], [480, 548],
    [530, 558], [580, 568], [615, 577], [628, 590], [625, 605], [612, 615], [560, 625], [500, 632], [440, 640], [400, 640], [340, 628], [280, 612], [250, 600],
    [220, 580], [180, 552], [150, 527], [120, 502], [100, 486], [92, 472]]), 200);
  const mHole = smoothClosed(MT(ellipsePts(192, 490, 34, 9, 0.12, 20)), 28);
  const wM = [[-0.1, 0.43], [0.1, 0.42], [0.35, 0.32], [0.6, 0.20], [0.8, 0.15], [1.0, 0.115], [1.15, 0.085], [1.25, 0.055], [1.32, 0.03]];
  const wMj = (xj) => table(wM, xj + J[0]);
  jawJoint = joint(headJoint, J[0], J[1], 0, 'jaw');
  let mand = plate(mOut, [mHole], 0.04, 0.012, 0.012);
  { const p = mand.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i); p.setZ(i, p.getZ(i) + wMj(x) - 0.01); } mand.computeVertexNormals(); }
  const jparts = [mand, mirrorZ(mand)];
  const mr = (x) => profileRange(mOut, x);
  // symphysis + medial splenial/prearticular strip
  const tipX = Math.max(...mOut.map(p => p.x)) - 0.05;
  jparts.push(sweep(curve([[tipX - 0.05, mr(tipX - 0.05)[0] + 0.05, wMj(tipX - 0.05)], [tipX + 0.02, mr(tipX)[0] + 0.05, 0], [tipX - 0.05, mr(tipX - 0.05)[0] + 0.05, -wMj(tipX - 0.05)]], 10), 0.035, 8));
  for (const s of [1, -1]) {
    const pts = []; for (let i = 0; i <= 16; i++) { const x = lerp(0.1, tipX - 0.1, i / 16); pts.push(V3(x, lerp(mr(x)[0], mr(x)[1], 0.35), s * (wMj(x) - 0.05))); }
    jparts.push(sweep(pts, (t) => [0.012, lerp(0.07, 0.035, t)], 6, V3(0, 1, 0)));
    jparts.push(ellip([0.0, 0.0, s * 0.43], 0.05, 0.035, 0.06)); // glenoid/articular
  }
  mesh(merge(jparts), jawJoint); count(12);
  const lt = [];
  const dLen = [0.06, 0.09, 0.11, 0.115, 0.11, 0.10, 0.095, 0.09, 0.08, 0.07, 0.06, 0.05];
  for (const s of [1, -1]) for (let i = 0; i < 12; i++) {
    const x = lerp(tipX - 0.02, 0.66 - J[0], i / 11), L = dLen[i];
    const g = cone(L, L * 0.16, 0.2, 0.75, 1); g.rotateX(s * 0.08); g.translate(x, mr(x)[1] - 0.03, s * (wMj(x) - 0.012)); lt.push(g);
  }
  mesh(merge(lt), jawJoint, TOOTH); count(24);
})();

// ---------- tail (40 caudals)
const tail = [];
(function buildTail() {
  let parent = pelvis, pos = V3(-0.40, COL_Y, 0);
  for (let i = 0; i < 40; i++) {
    const L = i <= 12 ? lerp(0.175, 0.241, smooth(0, 12, i)) : lerp(0.241, 0.071, (i - 12) / 27);
    const f = i / 39;
    const R = lerp(0.085, 0.014, Math.pow(f, 0.8));
    const j = joint(parent, pos.x, pos.y, pos.z, 'tail' + i);
    j.userData.base.z = i === 0 ? 0.07 : i < 10 ? 0.024 : i < 27 ? 0.0 : 0.006;  // tail runs along -X: +Z pitch arcs it down
    const g = vertebra({ L, R, spineH: Math.max(0, lerp(0.30, 0.0, Math.pow(Math.min(1, i / 30), 0.85))), spineW0: L * 0.45, spineW1: L * 0.4,
      tilt: -0.55, spineShift: 0.0, tpLen: Math.max(0, lerp(0.30, 0.0, i / 16)), tpUp: 0.05, tpBack: -0.04, tpFlat: 1.5,
      chev: i >= 1 ? Math.max(0, lerp(0.46, 0.02, Math.pow((i - 1) / 34, 0.8))) : 0, chevTilt: -0.55 });
    // built toward +X with "back" tilts negative → rotate π about Y so it extends along −X from the joint
    g.rotateY(Math.PI);
    mesh(g, j); count(i >= 1 && i <= 35 ? 2 : 1);
    tail.push(j); parent = j; pos = V3(-L, 0, 0);
  }
})();

// ---------- hind limbs (IK-driven; segments are direct children of the pelvis)
const LF = 1.321, LT = 1.245, LM = 0.671;   // femur / tibiotarsus / MT III of FMNH PR 2081
const PH0 = 0.575, PH_L0 = 0.175;                      // proximal phalanx pitch & length (digit III)
const J1 = V2(PH_L0 * Math.cos(PH0), -PH_L0 * Math.sin(PH0)); // J1 relative to MTP in flat foot frame
const MTP_H = 0.14;                                     // MTP joint height above ground (foot flat)
const J1_H = MTP_H + J1.y;                              // interphalangeal joint height when planted
const legs = [];
(function buildLegs() {
  const femurG = () => {
    const shaft = sweep(curve([[0.0, -0.06, 0.10], [0.035, -0.45, 0.085], [0.04, -0.85, 0.06], [0.0, -1.22, 0.035]], 18),
      (t) => { const r = lerp(0.085, 0.07, Math.sin(Math.PI * Math.min(1, t * 1.2))) + 0.04 * smooth(0.8, 1, t); return [r * 1.1, r]; }, 12);
    return merge([shaft,
      ellip([0, 0, -0.015], 0.085, 0.08, 0.09),                         // femoral head (medial)
      rod([0, -0.01, -0.01], [0.0, -0.06, 0.10], 0.075, 10, 4),          // neck
      ellip([-0.02, -0.03, 0.12], 0.11, 0.09, 0.07),                    // greater trochanter
      ellipRot([0.08, -0.13, 0.10], [0.04, 0.09, 0.05], [0, 0, 0.2]),    // lesser trochanter
      ellipRot([-0.075, -0.48, 0.06], [0.035, 0.12, 0.03], [0, 0, 0.1]), // fourth trochanter
      ellip([-0.035, -1.285, -0.03], 0.11, 0.075, 0.065),               // medial condyle
      ellip([-0.03, -1.285, 0.075], 0.10, 0.075, 0.06),                 // lateral condyle
    ]);
  };
  const tibiaG = () => merge([
    sweep(curve([[0.0, -0.06, 0], [0.01, -0.55, 0], [0.02, -1.08, 0.01]], 14), (t) => [lerp(0.08, 0.065, Math.min(1, t * 2)) + 0.07 * smooth(0.75, 1, t), lerp(0.08, 0.065, Math.min(1, t * 2)) - 0.015 * smooth(0.75, 1, t)], 12),
    ellip([-0.02, -0.04, 0], 0.13, 0.065, 0.11),                         // proximal condyles
    ellipRot([0.13, -0.11, 0.0], [0.09, 0.14, 0.035], [0, 0, -0.35]),   // cnemial crest
    sweep(curve([[-0.02, -0.06, 0.12], [0.0, -0.6, 0.11], [0.03, -1.08, 0.11]], 10), (t) => lerp(0.04, 0.02, t) + 0.015 * smooth(0.8, 1, t), 7), // fibula
    ellip([0.0, -1.14, 0.0], 0.085, 0.055, 0.14),                        // astragalus
    plate([V2(-0.07, -1.16), V2(0.07, -1.16), V2(0.03, -0.92), V2(-0.02, -0.92)], [], 0.02, 0.006, 0.006).rotateY(Math.PI / 2).translate(0.085, 0, 0), // ascending process
    ellip([-0.01, -1.13, 0.12], 0.05, 0.045, 0.04),                      // calcaneum
  ]);
  const metaG = () => merge([
    sweep(curve([[0.035, -0.10, 0], [0.04, -0.4, 0], [0.04, -0.63, 0]], 10), (t) => [lerp(0.012, 0.05, Math.pow(t, 0.7)), lerp(0.018, 0.042, t)], 10), // MT III (pinched: arctometatarsus)
    sweep(curve([[-0.01, -0.02, -0.045], [0.0, -0.3, -0.055], [0.01, -0.59, -0.068]], 10), (t) => [0.035, 0.045], 10),   // MT II
    sweep(curve([[-0.01, -0.02, 0.045], [0.0, -0.32, 0.055], [0.0, -0.61, 0.07]], 10), (t) => [0.035, 0.045], 10),       // MT IV
    ellip([0.035, -0.655, 0], 0.055, 0.05, 0.055), ellip([0.01, -0.615, -0.075], 0.05, 0.045, 0.045), ellip([0.0, -0.635, 0.078], 0.05, 0.045, 0.045),
    ellip([-0.01, -0.03, 0], 0.07, 0.05, 0.1),                                        // proximal tarsals
    rod([-0.05, -0.04, 0.07], [-0.055, -0.26, 0.085], (t) => lerp(0.02, 0.006, t), 6, 4), // MT V splint
    rod([-0.06, -0.42, -0.06], [-0.06, -0.54, -0.075], (t) => lerp(0.01, 0.02, t), 6, 4), // MT I
    spool(0.08, 0.02, 0.013, 0.017).rotateZ(Math.PI + 0.9).translate(-0.06, -0.54, -0.078), // hallux phalanx
    cone(0.07, 0.015, 0.3, 0.6, -1).rotateZ(-0.9).translate(-0.12, -0.59, -0.08),        // hallux ungual
  ]);
  const digits = [ // lengths of non-ungual phalanges, ungual length, radius, z, yaw
    { L: [0.15, 0.12], U: 0.12, r: 0.042, z: -0.075, yaw: 0.30, x: -0.02 },          // II
    { L: [0.175, 0.13, 0.10], U: 0.13, r: 0.045, z: 0, yaw: 0.0, x: 0 },             // III
    { L: [0.12, 0.09, 0.07, 0.06], U: 0.11, r: 0.038, z: 0.075, yaw: -0.32, x: -0.02 }, // IV
  ];
  for (const s of [1, -1]) {
    const leg = { side: s, hip: V3(0, 0, s * HIP_Z) };
    const mk = (geo) => { const g = new THREE.Group(); pelvis.add(g); mesh(s > 0 ? geo : mirrorZ(geo), g); return g; };
    leg.femur = mk(femurG()); leg.tibia = mk(tibiaG()); leg.meta = mk(metaG());
    count(1 + 3 + 2 + 5 + 2);
    // foot: toe chains
    leg.foot = new THREE.Group(); pelvis.add(leg.foot);
    leg.toes = [];
    for (const d of digits) {
      const root = new THREE.Group(); root.position.set(d.x, 0, s * d.z); root.rotation.y = s * d.yaw; leg.foot.add(root);
      const chain = []; let par = root;
      d.L.forEach((L, k) => {
        const jt = new THREE.Group(); if (k > 0) jt.position.x = d.L[k - 1]; par.add(jt);
        const r = d.r * (1 - k * 0.12);
        mesh(spool(L, r * 1.15, r * 0.78, r), jt); count();
        chain.push(jt); par = jt;
      });
      const uj = new THREE.Group(); uj.position.x = d.L[d.L.length - 1]; par.add(uj);
      const ug = cone(d.U, d.r * 0.85, 0.28, 0.75, -1); ug.rotateZ(Math.PI / 2); mesh(ug, uj); count();
      chain.push(uj);
      leg.toes.push(chain);
    }
    // state
    leg.C = V3(0.30, J1_H, s * 0.36); leg.p = 0; leg.stance = true; leg.curl = 0; leg.off = { C: leg.C.clone(), p: 0 };
    leg.K = V3(); leg.A = V3(); leg.M = V3();
      leg.pathLength = LF + LT * 0.92;   // budget for how far the hip may drop toward a planted foot
    legs.push(leg);
  }
})();

// ───────────────────────────────────────────────────────── environment
const GROUND_TILE = 6;
const groundTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#6f6150'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) { const v = 90 + Math.random() * 60 | 0; g.fillStyle = `rgba(${v + 30},${v + 18},${v},${Math.random() * 0.35})`;
    const r = Math.random() * 2.2; g.fillRect(Math.random() * 512, Math.random() * 512, r, r); }
  for (let i = 0; i < 70; i++) { g.fillStyle = `rgba(40,32,24,${Math.random() * 0.12})`; g.beginPath(); g.arc(Math.random() * 512, Math.random() * 512, 10 + Math.random() * 50, 0, TAU); g.fill(); }
  g.strokeStyle = 'rgba(255,240,210,0.10)'; g.lineWidth = 2; // 1 m survey grid
  for (let k = 0; k <= GROUND_TILE; k++) { const q = k * 512 / GROUND_TILE; g.beginPath(); g.moveTo(q, 0); g.lineTo(q, 512); g.stroke(); g.beginPath(); g.moveTo(0, q); g.lineTo(512, q); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
  t.repeat.set(200 / GROUND_TILE, 200 / GROUND_TILE); t.anisotropy = 8; return t;
})();
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.95 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
if (!CALIB && !SIL) scene.add(ground);
// The animal is drawn at the origin and the ground slides under it, but everything else that
// exists in the world (rocks, footprints, the ball) is stored in TRUE world coordinates inside
// this group. The group is offset by −travel, so an object planted in the world stays put while
// the animal actually walks, runs and turns through it.
const world = new THREE.Group(); scene.add(world);
// Where the animal is in the world and which way it faces. Kept separate from `state` because the
// scenery is built before the gait engine exists.
const NAV = { h: 0, travel: new THREE.Vector3() };
// scattered rocks drift with the ground so motion reads clearly
const rocks = [];
{ const rm = new THREE.MeshStandardMaterial({ color: 0x5d544a, roughness: 0.9, flatShading: true });
  const place = (r, ahead) => {
    const a = ahead ? NAV.h + (Math.random() - 0.5) * 2.0 : Math.random() * TAU;
    const d = ahead ? lerp(46, 66, Math.random()) : lerp(9, 60, Math.sqrt(Math.random()));
    r.position.set(NAV.travel.x + Math.cos(a) * d, 0.02, NAV.travel.z - Math.sin(a) * d);
  };
  for (let i = 0; i < 70; i++) {
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1 + Math.random() * 0.35, 0), rm);
    place(r, false); r.scale.y = 0.5 + Math.random() * 0.4;
    r.rotation.set(Math.random(), Math.random() * 6, Math.random()); r.castShadow = r.receiveShadow = true;
    if (!CALIB && !SIL) world.add(r); rocks.push(r);
  }
  rocks.place = place; }
// footprints
const printTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.translate(64, 64); g.fillStyle = 'rgba(30,22,15,0.75)';
  g.beginPath(); g.ellipse(-28, 0, 16, 13, 0, 0, TAU); g.fill();
  for (const a of [-0.42, 0, 0.42]) { g.save(); g.rotate(a); g.beginPath(); g.ellipse(8, 0, 38, 7.5, 0, 0, TAU); g.fill(); g.restore(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
const prints = [];
const printGeo = new THREE.PlaneGeometry(0.9, 0.9).rotateX(-Math.PI / 2);
// x/z are given in the animal's own frame; they are stored in world coordinates (see `world`).
function addPrint(x, z) {
  const m = new THREE.Mesh(printGeo, new THREE.MeshBasicMaterial({ map: printTex, transparent: true, depthWrite: false, opacity: 0.8 }));
  const c = Math.cos(NAV.h), s = Math.sin(NAV.h);
  m.position.set(NAV.travel.x + x * c + z * s, 0.006, NAV.travel.z - x * s + z * c);
  m.rotation.y = NAV.h; m.renderOrder = 1; world.add(m); prints.push({ m, age: 0 });
}

// ───────────────────────────────────────────────────────────────── the ball
// A 1.4 m play ball: big enough that the 1.45 m skull can just get its jaws around it, and
// heavy enough to read against the ground. Physics runs in world coordinates.
const BALL_R = 0.70;
const BALL_E = 0.5;         // restitution
const BALL_ROLL = 0.85;     // rolling resistance on dirt (m/s²)
const BALL_MAXV = 5.0;      // … so a solid hit still leaves it catchable
const ball = { r: BALL_R, pos: V3(8.5, BALL_R, 3.0), vel: V3(), live: true, mesh: null, touch: -9 };
(function buildBall() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#b5512e'; g.fillRect(0, 0, 512, 256);
  for (let i = 0; i < 8; i++) { g.fillStyle = i % 2 ? '#c66b3d' : '#a14225'; g.fillRect(i * 64, 0, 64, 256); }
  for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(72,44,26,${Math.random() * 0.11})`; g.fillRect(Math.random() * 512, Math.random() * 256, 3, 3); }
  g.strokeStyle = 'rgba(32,17,9,0.72)'; g.lineWidth = 7;
  for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, 256); g.stroke(); }
  g.lineWidth = 6; for (const y of [56, 128, 200]) { g.beginPath(); g.moveTo(0, y); g.lineTo(512, y); g.stroke(); }
  g.fillStyle = 'rgba(255,240,214,0.15)'; g.beginPath(); g.ellipse(150, 92, 48, 30, -0.4, 0, TAU); g.fill();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const m = new THREE.Mesh(new THREE.SphereGeometry(BALL_R, 40, 28),
    new THREE.MeshStandardMaterial({ map: t, roughness: 0.62, metalness: 0.02 }));
  m.castShadow = true; m.receiveShadow = true;
  ball.mesh = m;
  if (!CALIB && !SIL) world.add(m);
})();

const UPY = V3(0, 1, 0), tmpAxis = V3();
function stepBall(dt) {
  const b = ball;
  if (!b.live) return;
  b.vel.y -= 9.81 * dt;
  b.pos.addScaledVector(b.vel, dt);
  if (b.pos.y < b.r) {
    b.pos.y = b.r;
    if (b.vel.y < 0) b.vel.y = -b.vel.y * BALL_E;
    if (Math.abs(b.vel.y) < 0.8) b.vel.y = 0;
  }
  let sp = Math.hypot(b.vel.x, b.vel.z);
  if (sp > BALL_MAXV) { const k = BALL_MAXV / sp; b.vel.x *= k; b.vel.z *= k; sp = BALL_MAXV; }
  if (sp > 1e-5) {
    const dec = (b.pos.y <= b.r + 0.02 ? BALL_ROLL : 0.03) * dt + 0.05 * sp * dt;
    const k = Math.max(0, 1 - dec / sp);
    b.vel.x *= k; b.vel.z *= k;
    if (b.mesh) b.mesh.rotateOnWorldAxis(tmpAxis.set(b.vel.z, 0, -b.vel.x).normalize(), sp * dt / b.r);
  }
  if (b.mesh) b.mesh.position.copy(b.pos);
}
// lob the ball so it lands on a world point (x,z)
function throwBall(tx, tz) {
  const b = ball;
  b.pos.y = Math.max(b.pos.y, b.r);
  const dx = tx - b.pos.x, dz = tz - b.pos.z, d = Math.hypot(dx, dz);
  const T = clamp(0.45 + d / 13, 0.5, 2.2);
  b.vel.set(dx / T, (0.5 * 9.81 * T) + Math.max(0, b.r - b.pos.y) / T - (b.vel.y * 0), dz / T);
  b.vel.y = Math.max(1.5, 0.5 * 9.81 * T);
  b.live = true;
}
// drop the ball somewhere in front of the animal so it has to go and get it
function placeBall(dist = lerp(11, 20, Math.random())) {
  const a = NAV.h + (Math.random() - 0.5) * 1.7;
  ball.pos.set(NAV.travel.x + Math.cos(a) * dist, BALL_R, NAV.travel.z - Math.sin(a) * dist);
  ball.vel.set(0, 0, 0);
}

// ─────────────────────────────────────────────── chase / strike behaviour
// The animal steers with its whole body, but the yaw is shared out along the column: trunk leads
// into the turn, neck leads further, tail lags and swings wide. Nothing snaps rigidly.
const STRIKES = ['bite', 'angled', 'shove', 'scoop'];
const ai = {
  on: false, gazeW: 0, aimW: 0, dip: 0, crouch: 0, roll: 0, jaw: 0, jawW: 0, jawRate: 0, jawPrev: 0,
  st: null, cool: 0, watch: 0, gazeYaw: 0, gazePitch: 0, bearing: 0, dist: 0,
  aim: V3(), ballLocal: V3(), ballVelL: V3(), hit: 0, n: 0, lastType: '', label: '',
};
const TURN_HIST = new Float32Array(48); let turnIdx = 0, turnAcc = 0;
function turnDelayed(sec) {  // turn rate `sec` seconds ago → a wave that travels down the tail
  const k = clamp(Math.round(sec * 30), 0, TURN_HIST.length - 1);
  return TURN_HIST[(turnIdx - k + TURN_HIST.length * 2) % TURN_HIST.length];
}
function pickStrike() {
  const sp = Math.hypot(ball.vel.x, ball.vel.z), r = Math.random();
  let t;
  if (sp > 2.4 && r < 0.5) t = 'shove';                        // ball running at it → swipe aside
  else if (r < 0.46) t = 'bite';
  else if (r < 0.80) t = 'angled';
  else if (r < 0.92) t = 'shove';
  else t = 'scoop';
  if (t === ai.lastType && Math.random() < 0.75) t = STRIKES[(STRIKES.indexOf(t) + 1 + (Math.random() * 3 | 0)) % STRIKES.length];
  return t;
}
function startStrike(type) {
  const dur = { bite: 1.15, angled: 1.30, shove: 1.35, scoop: 1.40 }[type];
  ai.st = { type, t: 0, dur: dur * (0.9 + Math.random() * 0.28), side: Math.random() < 0.5 ? 1 : -1,
    amp: 0.84 + Math.random() * 0.32, roll: 0.24 + Math.random() * 0.30 };
  ai.lastType = type; ai.n++;
}
// Where the mouth should be driven, and what the jaws do, at normalised time u of a strike.
function strikeFrame(st) {
  const u = clamp(st.t / st.dur, 0, 1), s = st.side, A = st.amp;
  const o = { off: V3(0, 0, 0), dip: 0, crouch: 0, roll: 0, jaw: 0.1, aimW: 0 };
  if (st.type === 'shove') {                    // head swings through the ball, jaws shut
    const sw = smooth(0.26, 0.74, u);
    o.dip = 0.60 * A * smooth(0.04, 0.30, u) * (1 - smooth(0.76, 1, u));
    o.off.z = lerp(-1.05, 1.05, sw) * s;
    o.off.y = -0.05;
    o.aimW = smooth(0.10, 0.28, u) * (1 - smooth(0.78, 1, u));
    o.jaw = lerp(0.20, 0.05, smooth(0.15, 0.55, u));
    o.crouch = 0.44 * smooth(0.08, 0.36, u) * (1 - smooth(0.72, 1, u));
    o.roll = -0.17 * s * Math.sin(Math.PI * clamp((u - 0.18) / 0.62, 0, 1));
  } else if (st.type === 'scoop') {             // dip under it and lift
    o.dip = 0.95 * A * smooth(0.05, 0.32, u) * (1 - 0.55 * smooth(0.60, 1, u));
    o.off.y = lerp(-0.42, 0.80, smooth(0.34, 0.66, u));
    o.off.x = lerp(-0.30, 0.22, smooth(0.28, 0.62, u));
    o.aimW = smooth(0.08, 0.26, u) * (1 - smooth(0.66, 0.98, u));
    o.jaw = 0.70 * smooth(0.03, 0.22, u) * (1 - smooth(0.30, 0.48, u)) + 0.06 * smooth(0.5, 0.9, u);
    o.crouch = 0.84 * smooth(0.08, 0.34, u) * (1 - smooth(0.55, 0.92, u));
  } else {                                      // straight or angled bite
    const ang = st.type === 'angled' ? 1 : 0;
    o.dip = (0.88 + 0.10 * ang) * A * smooth(0.04, 0.34, u) * (1 - smooth(0.52, 0.95, u));
    o.off.z = ang ? lerp(0.60 * s, -0.12 * s, smooth(0.22, 0.52, u)) : 0;
    o.off.x = lerp(-0.22, 0.62, smooth(0.26, 0.52, u));
    o.off.y = ang ? -0.08 : -0.16;
    o.aimW = smooth(0.08, 0.28, u) * (1 - smooth(0.56, 0.96, u));
    o.jaw = 0.78 * smooth(0.02, 0.26, u) * (1 - smooth(0.32, 0.47, u)) + 0.05 * smooth(0.5, 0.9, u);
    o.crouch = (0.72 + 0.12 * ang) * smooth(0.06, 0.32, u) * (1 - smooth(0.50, 0.90, u));
    o.roll = ang ? st.roll * s * smooth(0.10, 0.40, u) * (1 - smooth(0.55, 0.95, u)) : 0;
  }
  return o;
}

// How a reach-down is shared out along the ten cervicals (both sum to 1): the neck carries about
// half the skull's yaw, and DIP_N is the total ventral flexion (rad) at full stretch.
const NECK_YAW_W = (() => { const w = [0.10, 0.22, 0.34, 0.46, 0.58, 0.68, 0.70, 0.64, 0.52, 0.38], s = w.reduce((a, b) => a + b, 0); return w.map((v) => v / s); })();
const NECK_PITCH_W = (() => { const w = [0.25, 0.40, 0.60, 0.85, 1.10, 1.30, 1.30, 1.15, 0.90, 0.60], s = w.reduce((a, b) => a + b, 0); return w.map((v) => v / s); })();
const DIP_N = 1.85;                 // radians of neck flexion at full reach for the ball

const tmpE2 = V3(), tmpF = V3(), tmpG = V3(), tmpH = V3(), tmpI = V3();
function updateAI(dt) {
  const S = state, b = ball;
  stepBall(dt);
  // the ball as the animal sees it: its own frame, +X forward
  tmpE2.copy(b.pos).sub(NAV.travel).applyAxisAngle(UPY, -NAV.h);
  const bL = ai.ballLocal.copy(tmpE2);
  const bvL = ai.ballVelL.copy(b.vel).applyAxisAngle(UPY, -NAV.h);
  ai.bearing = Math.atan2(-bL.z, bL.x);            // >0 → head must swing toward −Z
  ai.dist = Math.hypot(bL.x, bL.z);

  if (ai.on && ai.dist > 45) placeBall(lerp(11, 17, Math.random()));   // don't chase it out of the world
  ai.cool = Math.max(0, ai.cool - dt);
  ai.watch = Math.max(0, ai.watch - dt);
  ai.hit = Math.max(0, ai.hit - dt * 2.5);

  if (ai.st) {
    ai.st.t += dt;
    if (ai.st.t >= ai.st.dur) { ai.st = null; ai.cool = 0.2 + Math.random() * 0.3; ai.watch = 0.55 + Math.random() * 0.9; }
  }
  const striking = !!ai.st;
  const STOPD = 3.50;                                // ball distance at which the jaws can reach
  if (ai.on && !ai.st && ai.cool <= 0 && ai.watch <= 0 &&
      ai.dist > 2.8 && ai.dist < 4.1 && Math.abs(ai.bearing) < 0.40 && S.v < 1.5) startStrike(pickStrike());

  // ---- steering: rate limited, and slower the faster it is going
  const wmax = striking ? 0.10 : lerp(0.90, 0.30, smooth(0, 4.6, S.v));
  const want = ai.on ? clamp(ai.bearing * 2.2, -wmax, wmax) : 0;
  S.turn = approach(S.turn, want, dt * 4.5);
  NAV.h += S.turn * dt;
  if (NAV.h > Math.PI) NAV.h -= TAU; else if (NAV.h < -Math.PI) NAV.h += TAU;

  // ---- speed: close the gap, ease off while turning hard, stop dead to strike
  let vT = 0;
  if (ai.on && !striking && ai.watch <= 0) {
    const err = ai.dist - STOPD;
    if (ai.dist < 2.85) vT = -0.55;                  // too close to get the jaws on → shuffle back
    else {
      vT = clamp(err * 0.95, 0, 5.2);
      if (err > 0.4) vT = Math.max(vT, 1.35);
      vT *= clamp(1 - 0.60 * Math.abs(ai.bearing) / 1.25, 0.18, 1);
    }
  }
  S.chaseV = ai.on ? vT : null;

  // ---- where the jaws should go
  const fr = ai.st ? strikeFrame(ai.st) : null;
  ai.aim.copy(bL).addScaledVector(bvL, 0.14);
  if (fr) {
    ai.aim.add(fr.off);
    ai.dip = fr.dip; ai.crouch = fr.crouch; ai.roll = fr.roll;
    ai.aimW = fr.aimW; ai.jaw = fr.jaw; ai.jawW = 1;
  } else {
    ai.dip = approach(ai.dip, 0, dt * 3.2);
    ai.crouch = approach(ai.crouch, 0, dt * 2.6);
    ai.roll = approach(ai.roll, 0, dt * 3);
    ai.aimW = approach(ai.aimW, 0, dt * 3);
    ai.jaw = 0.16; ai.jawW = ai.on ? 0.4 : 0;
  }
  ai.gazeW = approach(ai.gazeW, ai.on ? 1 : 0, dt * 2);
  ai.label = ai.st ? ai.st.type : ai.watch > 0 ? 'watching' : ai.dist > 5.9 ? 'chasing' : 'closing in';
}

// ── contact. The ball is batted by whatever part of the animal touches it: the jaws shove,
// dribble or bite it, and the legs/tail/body simply block it (and can kick it if they move).
const colPts = [];
function refreshColliders() {
  colPts.length = 0;
  const add = (o, x, y, z, r) => {
    const v = V3(x, y, z); o.updateWorldMatrix(true, false); v.applyMatrix4(o.matrixWorld).add(NAV.travel);
    colPts.push({ p: v, r });
  };
  add(pelvis, 0.40, 0.02, 0, 0.50); add(pelvis, -0.40, 0.02, 0, 0.46);
  add(trunk[0], 0.32, 0.05, 0, 0.52); add(trunk[1], 0.32, 0.05, 0, 0.52); add(trunk[2], 0.36, 0.05, 0, 0.46);
  add(headJoint, 0.55, -0.05, 0, 0.40);
  add(tail[3], -0.20, 0, 0, 0.30); add(tail[9], -0.20, 0, 0, 0.24);
  add(tail[19], -0.15, 0, 0, 0.16); add(tail[30], -0.10, 0, 0, 0.10);
  for (const leg of legs) {
    const k = pelvis.localToWorld(leg.tibia.position.clone()).add(NAV.travel); colPts.push({ p: k, r: 0.22 });
    const a = pelvis.localToWorld(leg.meta.position.clone()).add(NAV.travel); colPts.push({ p: a, r: 0.20 });
    const f = leg.M.clone().applyMatrix4(dino.matrixWorld).add(NAV.travel); f.y += 0.12; colPts.push({ p: f, r: 0.26 });
  }
}
function resolveBall(dt) {
  const b = ball, S = state;
  if (!b.live) return;
  const dinoV = tmpF.set(Math.cos(NAV.h) * S.v, 0, -Math.sin(NAV.h) * S.v);   // the animal, world frame
  // ---- jaws
  const mw = tmpG.copy(S.mouthW);
  const d = tmpE2.copy(b.pos).sub(mw);
  const dist = d.length(), R = b.r + 0.20;
  if (dist < R) {
    const n = d.multiplyScalar(1 / Math.max(1e-4, dist));
    b.pos.addScaledVector(n, R - dist);
    const closing = -tmpAxis.copy(b.vel).sub(S.mouthVelW).dot(n);       // >0 = mouth driving into ball
    const away = tmpH.copy(b.pos).sub(NAV.travel); away.y = 0;           // … and always away from it
    if (away.lengthSq() < 1e-4) away.set(Math.cos(NAV.h), 0, -Math.sin(NAV.h)); else away.normalize();
    const dir = tmpI.copy(n).multiplyScalar(0.40).addScaledVector(away, 0.60).normalize();
    if (closing > 0) b.vel.addScaledVector(dir, Math.min(closing, 2.8) * 1.00);
    if (ai.jawRate > 0.6) {                                            // jaws snapping shut → launch it
      const k = Math.min(ai.jawRate, 5);
      b.vel.addScaledVector(n, k * 0.22);
      b.vel.y += k * 0.26;
      ai.hit = 1;
    }
    b.touch = S.t;
  }
  // ---- rest of the animal
  for (const c of colPts) {
    const dd = tmpE2.copy(b.pos).sub(c.p);
    let dl = dd.length(); const RR = b.r + c.r;
    if (dl > RR) continue;
    if (dl < 1e-4) { dd.set(0, 1, 0); dl = 1e-4; } else dd.multiplyScalar(1 / dl);
    b.pos.copy(c.p).addScaledVector(dd, RR + 0.003);
    const vn = tmpAxis.copy(b.vel).sub(dinoV).dot(dd);
    if (vn < 0) b.vel.addScaledVector(dd, -vn * 1.25);
    b.touch = S.t;
  }
}

// ───────────────────────────────────────────────────────── gait engine
const GAITS = { idle: 0, walk: 1.45, run: 5.2 };  // m/s
const state = {
  v: 0, target: 0, custom: null, chaseV: null, tailDroop: 0.6, gait: 'idle', phase: 0, stepping: false, t: 0,
  groundX: 0, roar: -1, breath: 0, timeScale: 1, auto: !CALIB, autoT: 0,
  turn: 0,                                   // yaw rate (rad/s), +ve swings the head toward −Z
  headYawRel: 0, headPitchW: 0,              // skull orientation the animal is holding (world pitch)
  mouthLocal: new THREE.Vector3(), mouthW: new THREE.Vector3(), mouthVelW: new THREE.Vector3(),
  mouthInit: false,
};
// gait parameters as a function of speed (m/s)
function gaitParams(v) {
  return {
    f: table([[0, 0.45], [1.45, 0.43], [3, 0.62], [5.2, 0.86]], v),          // stride frequency (Hz)
    duty: table([[0, 0.7], [1.45, 0.64], [3, 0.52], [5.2, 0.42]], v),        // fraction of cycle on ground
    hipH: table([[0, 3.02], [1.45, 2.98], [5.2, 2.88]], v),
    lift: table([[0, 0.16], [1.45, 0.30], [5.2, 0.52]], v),
    pitch: table([[0, 0.02], [1.45, 0.0], [5.2, -0.04]], v),
    heel: table([[0, 0.05], [1.45, 0.35], [5.2, 0.62]], v),
    footZ: table([[0, 0.37], [1.45, 0.30], [5.2, 0.26]], v),
    sway: table([[0, 0.0], [1.45, 0.075], [5.2, 0.045]], v),
    yaw: table([[0, 0.0], [1.45, 0.05], [5.2, 0.075]], v),
    neutral: table([[0, 0.30], [1.45, 0.34], [5.2, 0.42]], v),                // mid-stance J1 position ahead of hip
  };
}
const legPhase = (leg) => frac(state.phase + (leg.side > 0 ? 0 : 0.5));

const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpQ2 = new THREE.Quaternion(), tmpQ3 = new THREE.Quaternion(), invP = new THREE.Matrix4();
function basisQuat(dir, n, out) {
  const y = dir.clone().normalize().negate();
  const z = n.clone().sub(y.clone().multiplyScalar(n.dot(y))).normalize();
  const x = y.clone().cross(z);
  tmpM.makeBasis(x, y, z); return out.setFromRotationMatrix(tmpM);
}
function solve2(H, A, l1, l2, pole) {
  const d = A.clone().sub(H); let dist = d.length(); const dir = d.normalize();
  const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
  const a = Math.acos(cosA);
  dist = clamp(dist, Math.abs(l1 - l2) + 1e-3, (l1 + l2) * 0.9995);
  const bend = pole.clone().sub(dir.clone().multiplyScalar(pole.dot(dir)));
  if (bend.lengthSq() < 1e-8) bend.set(1, 0, 0); else bend.normalize();
  return H.clone().add(dir.multiplyScalar(Math.cos(a) * l1)).add(bend.multiplyScalar(Math.sin(a) * l1));
}
function footM(C, p) { // MTP from control point (distal end of proximal phalanx) and heel-lift angle
  const c = Math.cos(-p), s = Math.sin(-p), x = -J1.x, y = -J1.y;
  return V3(C.x + x * c - y * s, C.y + x * s + y * c, C.z);
}

function stepLegs(dt, P, mw) {
  const L = state.v / P.f;               // stride length
  const turnN = clamp(state.turn / 0.5, -1, 1);
  for (const leg of legs) {
    const lp = legPhase(leg);
    const stance = !state.stepping || lp < P.duty;
    if (stance) {
      if (!leg.stance) { leg.stance = true; leg.C.y = J1_H; if (mw > 0.05 || Math.abs(state.v) > 0.05) addPrint(leg.C.x + 0.02, leg.C.z); }
      leg.C.x -= state.v * dt;
      // a planted foot is fixed in the world, so while the body yaws it sweeps around the hips
      // in the animal's own frame — which is exactly what makes the outside leg take the longer
      // stride and the inside leg the shorter one.
      const dh = state.turn * dt;
      leg.C.x -= leg.C.z * dh;
      leg.C.z += leg.C.x * dh;
      const sf = state.stepping ? lp / P.duty : 0;
      leg.pTarget = P.heel * smooth(0.45, 1.0, sf) * clamp(state.v / 0.8, 0, 1);
      leg.p = approach(leg.p, leg.pTarget, dt * 3);
      leg.curl = approach(leg.curl, 0, dt * 4);
      leg.bend = 0.32;
    } else {
      if (leg.stance) { leg.stance = false; leg.off = { C: leg.C.clone(), p: leg.p }; }
      const s = (lp - P.duty) / (1 - P.duty);
      const landX = P.neutral + P.duty * L / 2;
      const e = s - Math.sin(TAU * s) / TAU;
      leg.C.x = lerp(leg.off.C.x, landX, e);
      leg.C.z = lerp(leg.off.C.z, leg.side * P.footZ - 0.13 * turnN, e);   // reach into the turn
      // floor the clearance: marching on the spot (a strike, or a shuffle backwards) still has to
      // lift the foot clear, otherwise the curled toes hook through the ground
      leg.C.y = J1_H + Math.max(P.lift * 1.12, 0.32) * Math.pow(Math.sin(Math.PI * Math.pow(s, 0.85)), 1.1);
      leg.p = lerp(leg.off.p, -0.04, smooth(0.0, 0.85, s)) + 0.35 * Math.sin(Math.PI * s) * clamp(P.lift / 0.3, 0.3, 1.4);
      leg.curl = 0.55 * Math.sin(Math.PI * Math.min(1, s * 1.15));
      leg.bend = 0.32 + 0.45 * Math.sin(Math.PI * s);
    }
  }
}

function poseLeg(leg) {
  pelvis.updateMatrixWorld(true);
  const H = leg.hip.clone().applyMatrix4(pelvis.matrixWorld);
  const R = (LF + LT) * 0.992;
  let bend = leg.bend, p = leg.p, M, A;
  const Mw = V3();
  for (let it = 0; it < 14; it++) {
    M = footM(leg.C, p);                            // foot target, in the animal's own frame
    Mw.copy(M).applyMatrix4(dino.matrixWorld);      // … and in the scene frame, to compare with H
    const dx = H.x - Mw.x, dy = H.y - Mw.y, a = Math.atan2(-dx, dy) + bend;
    A = V3(Mw.x - LM * Math.sin(a), Mw.y + LM * Math.cos(a), Mw.z);
    if (H.distanceTo(A) <= R) break;
    if (bend > 0.04) bend *= 0.7; else if (leg.stance) p += 0.05; else break;
  }
  leg.p = p;
  const pelQ = pelvis.getWorldQuaternion(tmpQ2);
  const pole = V3(1, 0, 0).applyQuaternion(pelQ).add(V3(0, 0, leg.side * 0.12));
  leg.ankleErr = 0;                                  // failure count, not metres: poseLeg never leaves it short
  if (H.distanceTo(A) > R - 1e-4) leg.ankleErr = 1;  // could NOT reach → it was clamped into maximum extension
  // exact IK solve from the actual hip, so reaching deep for the ball just bends the knees further
  const K = solve2(H, A, LF, LT, pole);
  const A2 = K.clone().add(A.clone().sub(K).setLength(LT));
  // to pelvis space
  invP.copy(pelvis.matrixWorld).invert();
  const Hl = leg.hip, Kl = K.applyMatrix4(invP), Al = A2.applyMatrix4(invP), Ml = Mw.clone().applyMatrix4(invP);
  const n = Al.clone().sub(Hl).cross(V3(1, 0, 0)); if (n.lengthSq() < 1e-6) n.set(0, 0, 1); n.normalize();
  leg.femur.position.copy(Hl); basisQuat(Kl.clone().sub(Hl), n, leg.femur.quaternion);
  leg.tibia.position.copy(Kl); basisQuat(Al.clone().sub(Kl), n, leg.tibia.quaternion);
  leg.meta.position.copy(Al); basisQuat(Ml.clone().sub(Al), n, leg.meta.quaternion);
  leg.foot.position.copy(Ml);
  // heel lift happens about the animal's own lateral axis, not the world Z axis
  dino.getWorldQuaternion(tmpQ3);
  tmpQ.setFromAxisAngle(tmpAxis.set(0, 0, 1).applyQuaternion(tmpQ3), -p);
  leg.foot.quaternion.copy(pelQ).invert().multiply(tmpQ);
  // toes: proximal phalanx pitched down to the ground, rest flattened (compensating heel lift), curled in swing
  for (const chain of leg.toes) {
    chain.forEach((jt, k) => {
      let r = 0;
      if (k === 0) r = -PH0 - leg.curl * 0.4;
      else if (k === 1) r = PH0 + p - leg.curl;
      else if (k === chain.length - 1) r = -0.04 - leg.curl * 0.8;
      else r = -leg.curl * 0.6;
      jt.rotation.z = r;
    });
  }
  leg.M.copy(M);
}

// ───────────────────────────────────────────────────────── main animation
const tmpE = new THREE.Euler(0, 0, 0, 'YZX');
function animate(dt) {
  const S = state; S.t += dt;
  // ---- brain: ball physics, steering, strike timing. Sets NAV.h (heading) and S.turn.
  updateAI(dt);
  dino.rotation.y = NAV.h;
  turnAcc += dt;                                    // history of the turn rate …
  while (turnAcc > 1 / 30) { turnAcc -= 1 / 30; turnIdx = (turnIdx + 1) % TURN_HIST.length; TURN_HIST[turnIdx] = S.turn; }
  // speed with limited acceleration → smooth gait transitions
  S.target = S.chaseV != null ? S.chaseV : (S.custom != null ? S.custom : GAITS[S.gait]);
  const acc = S.target > S.v ? 1.35 : 1.9;
  S.v = approach(S.v, S.target, acc * dt);
  const P = gaitParams(S.v);
  const mw = smooth(0, 1.45, S.v), rw = smooth(1.45, 5.2, S.v);
  const turnN = clamp(S.turn / 0.5, -1, 1);         // −1 … 1, how hard it is swinging round

  // stepping control: keep stepping until feet settle into a square stance
  if (!S.stepping && (Math.abs(S.v) > 0.02 || S.target > 0)) S.stepping = true;
  if (S.stepping) S.phase += P.f * dt;
  if (S.stepping && S.target === 0 && Math.abs(S.v) < 0.02) {
    const settled = legs.every(l => l.stance && legPhase(l) < P.duty && Math.abs(l.C.x - P.neutral) < 0.16 && Math.abs(Math.abs(l.C.z) - P.footZ) < 0.1);
    if (settled) S.stepping = false;
  }
  S.groundX += S.v * dt;
  stepLegs(dt, P, mw);

  // breathing
  S.breath += dt * TAU * lerp(0.2, 0.75, S.v / 5.2);
  const br = Math.sin(S.breath);

  // roar envelope
  let roar = 0, roarOpen = 0, roarT = -1;
  if (S.roar >= 0) {
    S.roar += dt; roarT = S.roar;
    const up = smooth(0.0, 0.5, roarT), down = 1 - smooth(2.6, 3.4, roarT);
    roar = up * down; roarOpen = smooth(0.55, 0.85, roarT) * down;
    if (roarT > 3.5) S.roar = -1;
  }
  const antic = Math.sin(Math.PI * clamp(roarT / 0.6, 0, 1)) * (roarT >= 0 && roarT < 0.6 ? 1 : 0);

  // ---- pelvis
  const phiL = frac(S.phase), midL = P.duty / 2;
  const bobAmp = lerp(0.045, -0.075, rw) * mw;
  const bob = bobAmp * Math.cos(2 * TAU * (phiL - midL)) + 0.008 * br * (1 - mw);
  const idleSway = 0.05 * Math.sin(S.t * 0.33) * (1 - mw);
  const sway = P.sway * Math.cos(TAU * (phiL - midL)) + idleSway;
  const yaw = P.yaw * Math.sin(TAU * phiL);
  // bank into the turn the way any animal does, more of it the faster it is going
  const bank = -0.085 * turnN * (0.35 + 0.65 * mw);
  const roll = -0.025 * mw * Math.cos(TAU * (phiL - midL)) + idleSway * 0.25 + bank;
  const lean = clamp(0.17 * ai.dip, 0, 0.18);     // reaching down for the ball tips the trunk over it
  const pitch = P.pitch + 0.012 * mw * Math.sin(2 * TAU * (phiL - midL) + 0.6) - 0.06 * roar + 0.03 * antic - lean;
  pelvis.position.set(0.05 * rw * Math.sin(2 * TAU * phiL), P.hipH + bob - 0.05 * roar - ai.crouch, sway);
  pelvis.rotation.set(roll, yaw, pitch);

  // ---- trunk (counter-rotate lateral motion; breathing flex; lead the body into a turn)
  trunk.forEach((j, i) => setRot(j, 0,
    -yaw * 0.28 + turnN * 0.075 * ((i + 1) / 3) * (0.4 + 0.6 * mw),
    0.006 * br + 0.02 * roar * (i === 2 ? 1 : 0)));
  for (const r of ribs) r.rotation.x = r.userData.side * 0.035 * (br * 0.5 + 0.5) * (1 + rw);

  // ---- neck & head
  const look = (noise1(S.t * 0.18) * 0.55 + noise1(S.t * 0.5 + 9) * 0.12) * (1 - mw * 0.85) * (1 - roar);
  const lookP = (noise1(S.t * 0.13 + 3) * 0.08) * (1 - mw);
  // the turn is not a rigid rotation: the neck carries part of the head's yaw, and when the
  // animal reaches down for the ball the flexion is shared out along the cervical series
  const nkYaw = S.headYawRel * 0.5;
  neck.forEach((j, i) => {
    const f = i / 9;
    const extend = (rw * 0.05 + mw * 0.02) * (i < 3 ? -1 : 0.5);         // run: straighter, head forward
    const roarBend = roar * (i < 4 ? 0.07 : -0.02) - antic * (i < 4 ? -0.06 : 0.03);
    const scan = look / 10 * (1 - ai.gazeW) + yaw * 0.1 * (1 - f);
    setRot(j, 0, scan + nkYaw * NECK_YAW_W[i] + turnN * 0.018,
      extend + roarBend + lookP / 10 - DIP_N * NECK_PITCH_W[i] * ai.dip);
  });
  // stabilise head in world space (gaze stabilisation), then layer jaw
  dino.updateMatrixWorld(true);
  const headPitch = 0.02 + 0.04 * rw + lookP + roar * 0.42 - antic * 0.15 + 0.02 * Math.sin(S.t * 0.7) * (1 - mw);
  const headYaw0 = look + yaw * 0.25;
  let yawT = headYaw0, pitchT = headPitch;
  if (ai.gazeW > 0.01) {
    // Closed loop on the bite point actually measured last frame: the head swings onto the ball,
    // then — during a strike — drops onto it. Tracking, not a canned animation.
    const e = tmpE2.copy(ai.aim).sub(S.mouthLocal);
    const psi = S.headYawRel, reach = 1.32;
    const lat = e.x * -Math.sin(psi) + e.z * -Math.cos(psi);
    const ay = clamp(S.headYawRel + lat * 2.4 / reach, -1.15, 1.15);
    const ap = clamp(S.headPitchW + e.y * 2.7 / reach, -1.32, 0.55);
    const cy = clamp(ai.bearing, -0.85, 0.85) * 0.95;      // travelling: look where it is going
    const cp = 0.02 + 0.04 * rw;                          // … but keep the skull level
    yawT = lerp(headYaw0, lerp(cy, ay, ai.aimW), ai.gazeW);
    pitchT = lerp(headPitch, lerp(cp, ap, ai.aimW), ai.gazeW);
  }
  S.headYawRel = approach(S.headYawRel, yawT, lerp(1.8, 4.2, ai.aimW) * dt);
  S.headPitchW = approach(S.headPitchW, pitchT, lerp(1.8, 4.6, ai.aimW) * dt);
  tmpE.set(ai.roll, NAV.h + S.headYawRel, S.headPitchW);
  const desired = new THREE.Quaternion().setFromEuler(tmpE);
  const parentQ = headJoint.parent.getWorldQuaternion(new THREE.Quaternion());
  const stab = parentQ.clone().invert().multiply(desired);
  headJoint.quaternion.copy(stab);   // hold the gaze steady regardless of trunk motion
  const jawIdle = 0.13 + 0.06 * Math.pow(Math.max(0, Math.sin(S.t * 0.27)), 12);
  const jawRun = (0.1 + 0.03 * Math.sin(2 * TAU * S.phase)) * rw;
  let jaw = lerp(jawIdle + jawRun, 0.72 + 0.03 * Math.sin(S.t * 38), roarOpen);
  if (ai.jawW > 0.01) jaw = lerp(jaw, ai.jaw, ai.jawW);
  jawJoint.rotation.z = -jaw;
  ai.jawRate = Math.max(0, (ai.jawPrev - jaw) / Math.max(1e-4, dt));   // >0 while the jaws are snapping shut
  ai.jawPrev = jaw;

  // ---- tail: counter-yaw at base, travelling lateral + vertical waves, lift when running / roaring
  tail.forEach((j, i) => {
    const f = i / 39;
    const lat = (0.018 * mw * Math.sin(TAU * S.phase - i * 0.11 - 0.8) + 0.012 * (1 - mw) * Math.sin(S.t * 0.55 - i * 0.13)) * (0.25 + f);
    const vert = 0.006 * mw * Math.sin(2 * TAU * S.phase - i * 0.14 - 1.2) * (0.4 + f) + 0.002 * br * (1 - mw);
    const lift = (i < 16 ? -0.001 * rw - 0.005 * roar : 0) + (i < 6 ? 0.02 * antic : 0) + (i === 0 ? -(pitch - 0.025) * 0.75 : 0);
    // turning: the tail is dragged, so each joint reproduces the turn rate it had a moment ago —
    // the swing travels backwards along the tail instead of the whole thing pivoting at once
    const tl = clamp(turnDelayed(i * 0.045) / 0.5, -1, 1);
    const tYaw = tl * (i < 18 ? lerp(0.075, 0.006, i / 18) : 0);
    // state.tailDroop scales the tail's resting downward arc (tuned against the reference)
    setRot(j, 0, (i === 0 ? -yaw * 0.85 : 0) + (i < 3 ? -look * 0.04 * (1 - ai.gazeW) : 0) + lat + tYaw,
      vert + lift + j.userData.base.z * (state.tailDroop - 1));
  });

  // ---- arms (passive lag + idle fidget)
  arms.forEach((a) => {
    const lag = Math.sin(2 * TAU * S.phase - 1.3) * mw;
    setRot(a.sh, 0, 0, 0.08 * lag + 0.05 * noise1(S.t * 0.4 + a.side) * (1 - mw) + 0.25 * roar);
    setRot(a.el, 0, 0, 0.1 * lag + 0.2 * roar);
    setRot(a.wr, 0, 0, 0.1 * lag + 0.1 * Math.sin(S.t * 0.8 + a.side) * (1 - mw));
  });

  // ---- legs
  dino.updateMatrixWorld(true);
  for (const leg of legs) poseLeg(leg);

  // ---- where the jaws actually ended up (the aim loop closes on this next frame)
  dino.updateMatrixWorld(true);
  const mp = headJoint.localToWorld(V3(1.24, -0.05, 0)).lerp(jawJoint.localToWorld(V3(1.02, 0.02, 0)), 0.5);
  S.mouthLocal.copy(mp).applyAxisAngle(UPY, -NAV.h);
  mp.add(NAV.travel);
  if (S.mouthInit && dt > 1e-5) S.mouthVelW.copy(mp).sub(S.mouthW).divideScalar(dt); else S.mouthVelW.set(0, 0, 0);
  S.mouthW.copy(mp); S.mouthInit = true;

  // ---- the ball meets the animal
  refreshColliders();
  resolveBall(dt);

  // ---- world scroll: the animal really moves, the ground slides under it
  const ch = Math.cos(NAV.h), sh = Math.sin(NAV.h);
  NAV.travel.x += S.v * ch * dt; NAV.travel.z -= S.v * sh * dt;
  S.groundX += S.v * dt;
  world.position.set(-NAV.travel.x, 0, -NAV.travel.z);
  groundTex.offset.set(NAV.travel.x / GROUND_TILE, -NAV.travel.z / GROUND_TILE);
  for (const r of rocks) {
    const dx = r.position.x - NAV.travel.x, dz = r.position.z - NAV.travel.z;
    if (dx * dx + dz * dz > 70 * 70) rocks.place(r, true);
  }
  for (let i = prints.length - 1; i >= 0; i--) {
    const pr = prints[i]; pr.age += dt;
    pr.m.material.opacity = 0.8 * (1 - smooth(10, 16, pr.age));
    const dx = pr.m.position.x - NAV.travel.x, dz = pr.m.position.z - NAV.travel.z;
    if (pr.age > 16 || dx * dx + dz * dz > 60 * 60) { world.remove(pr.m); pr.m.material.dispose(); prints.splice(i, 1); }
  }
  sun.target.position.set(0, 0, 0); sun.position.set(7, 14, 9);
  return P;
}

// ───────────────────────────────────────────────────────── UI
const ui = {
  name: document.getElementById('g-name'), speed: document.getElementById('g-speed'), stride: document.getElementById('g-stride'),
  duty: document.getElementById('g-duty'), froude: document.getElementById('g-froude'), freq: document.getElementById('g-freq'),
  strip: document.getElementById('strip'), ai: document.getElementById('g-ai'), ballct: document.getElementById('g-ball'),
};
const history = [];
const spd = document.getElementById('speed'), spdVal = document.getElementById('spd-val');
spd.addEventListener('input', () => {
  state.custom = +spd.value; state.auto = false; document.getElementById('auto').classList.remove('on');
  if (ai.on) setChase(false);
  spdVal.textContent = (state.custom * 3.6).toFixed(0) + ' km/h';
  document.querySelectorAll('[data-gait]').forEach(b => b.classList.remove('on'));
});
function setGait(g, fromUser = true) {
  state.gait = g; state.custom = null;
  spd.value = GAITS[g]; spdVal.textContent = (GAITS[g] * 3.6).toFixed(0) + ' km/h';
  if (fromUser) { state.auto = false; document.getElementById('auto').classList.remove('on'); if (ai.on) setChase(false); }
  document.querySelectorAll('[data-gait]').forEach(b => b.classList.toggle('on', b.dataset.gait === g));
}
document.querySelectorAll('[data-gait]').forEach(b => b.addEventListener('click', () => setGait(b.dataset.gait)));
document.getElementById('auto').addEventListener('click', (e) => { state.auto = !state.auto; state.autoT = 0; e.target.classList.toggle('on', state.auto); });
const doRoar = () => { if (state.roar < 0) state.roar = 0; };
document.getElementById('roar').addEventListener('click', doRoar);

// ---- the ball: throw it somewhere and let the animal go and get it
const chaseBtn = document.getElementById('chase');
function setChase(on) {
  ai.on = on;
  chaseBtn.classList.toggle('on', on);
  if (on) { state.auto = false; document.getElementById('auto').classList.remove('on'); ball.live = true; }
  else { ai.st = null; ai.dip = 0; ai.crouch = 0; ai.aimW = 0; ai.jawW = 0; ai.watch = 0; }
}
chaseBtn.addEventListener('click', () => setChase(!ai.on));
function randomSpot(dist = lerp(13, 26, Math.random())) {
  const a = NAV.h + (Math.random() - 0.5) * 1.7;
  return [NAV.travel.x + Math.cos(a) * dist, NAV.travel.z - Math.sin(a) * dist];
}
const doThrow = () => { if (!ai.on) setChase(true); throwBall(...randomSpot()); };
document.getElementById('throw').addEventListener('click', doThrow);
// click any patch of ground to lob the ball onto it
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
let dnX = 0, dnY = 0, dnT = 0;
canvas.addEventListener('pointerdown', (e) => { dnX = e.clientX; dnY = e.clientY; dnT = performance.now(); });
canvas.addEventListener('pointerup', (e) => {
  if (!ground.parent) return;
  if (Math.hypot(e.clientX - dnX, e.clientY - dnY) > 5 || performance.now() - dnT > 550) return;
  ptr.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(ptr, camera);
  const hit = ray.intersectObject(ground, false)[0];
  if (!hit) return;
  const p = hit.point;
  if (!ai.on) setChase(true);
  throwBall(p.x + NAV.travel.x, p.z + NAV.travel.z);
});
const ts = document.getElementById('timescale');
ts.addEventListener('input', () => { state.timeScale = +ts.value; document.getElementById('ts-val').textContent = (+ts.value).toFixed(1) + '×'; });
document.querySelectorAll('[data-mat]').forEach(b => b.addEventListener('click', () => {
  U.uFossil.value = b.dataset.mat === 'fossil' ? 1 : 0;
  document.querySelectorAll('[data-mat]').forEach(x => x.classList.toggle('on', x === b));
}));
const CAMS = {
  side: { p: [0.4, 2.3, 17], t: [0.0, 2.0, 0] }, three: { p: [10.5, 4.8, 12.5], t: [0.2, 2.0, 0] },
  front: { p: [15, 3.2, 1.5], t: [1.0, 2.3, 0] }, top: { p: [0.5, 21, 0.6], t: [0, 1.5, 0] }, 
};
let camAnim = null;
function setCam(k) {
  const c = CAMS[k]; camAnim = { t: 0, p0: camera.position.clone(), t0: controls.target.clone(), p1: V3(...c.p), t1: V3(...c.t) };
  document.querySelectorAll('[data-cam]').forEach(b => b.classList.toggle('on', b.dataset.cam === k));
}
document.querySelectorAll('[data-cam]').forEach(b => b.addEventListener('click', () => setCam(b.dataset.cam)));
addEventListener('keydown', (e) => {
  if (e.key === '1') setGait('idle'); if (e.key === '2') setGait('walk'); if (e.key === '3') setGait('run');
  if (e.code === 'Space') { e.preventDefault(); doRoar(); }
  if (e.key === 'b' || e.key === 'B') setChase(!ai.on);
  if (e.key === 't' || e.key === 'T') doThrow();
});
function drawStrip() {
  const c = ui.strip, g = c.getContext('2d'), W = c.width, H = c.height, span = 8;
  g.clearRect(0, 0, W, H);
  const now = state.t;
  g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(0, 6, W, 32); g.fillRect(0, 50, W, 32);
  for (let i = 1; i < history.length; i++) {
    const h0 = history[i - 1], h1 = history[i];
    const x0 = W - (now - h0.t) / span * W, x1 = W - (now - h1.t) / span * W;
    if (x1 < 0) continue;
    if (h1.L) { g.fillStyle = '#e0b872'; g.fillRect(x0, 6, x1 - x0 + 0.6, 32); }
    if (h1.R) { g.fillStyle = '#8fb3d9'; g.fillRect(x0, 50, x1 - x0 + 0.6, 32); }
  }
  while (history.length && now - history[0].t > span + 0.5) history.shift();
}
function updateUI(P) {
  const v = state.v;
  const name = v < 0.05 ? 'Idle' : v < 2.6 ? 'Walk' : 'Run';
  const trans = Math.abs(v - state.target) > 0.05 ? ' <small>transitioning</small>' : '';
  ui.name.innerHTML = name + trans;
  ui.speed.textContent = (v * 3.6).toFixed(1) + ' km/h';
  ui.stride.textContent = v > 0.05 ? 'stride ' + (v / P.f).toFixed(2) + ' m' : 'stride —';
  ui.freq.textContent = state.stepping ? P.f.toFixed(2) + ' Hz' : '—';
  ui.duty.textContent = state.stepping ? 'duty ' + P.duty.toFixed(2) : 'duty 1.00';
  ui.froude.textContent = 'Froude ' + (v * v / (9.81 * P.hipH)).toFixed(2);
  ui.ai.textContent = ai.on ? (ai.label || 'watching') : '—';
  ui.ballct.textContent = 'ball ' + ai.dist.toFixed(1) + ' m';
  history.push({ t: state.t, L: legs[0].stance, R: legs[1].stance });
  drawStrip();
}

// ───────────────────────────────────────────────────────── loop
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  if (camera.isPerspectiveCamera) { camera.aspect = innerWidth / innerHeight; }
  else { const h = 4.6, a = innerWidth / innerHeight; Object.assign(camera, { left: -h * a, right: h * a, top: h, bottom: -h }); }
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
if (CALIB) {
  camera.position.set(-0.6, 2.3, 30); controls.target.set(-0.6, 2.3, 0);
  document.querySelectorAll('.panel').forEach(p => p.style.display = 'none');
}

document.getElementById('i-bones').textContent = elementCount;
{ const box = new THREE.Box3(); animate(0.016); box.setFromObject(dino); document.getElementById('i-len').textContent = (box.max.x - box.min.x).toFixed(1) + ' m'; }
document.getElementById('loading').remove();

// Deterministic stepping hook (for screenshots/tests)
// Orthographic silhouette capture (used by tools/compare.html to score the model
// against the reference skeletal diagram).
function silhouette(w = 900, h = 340, dir = 1, target = dino) {
  const box = new THREE.Box3().setFromObject(target);
  const L = box.max.x - box.min.x, H = box.max.y - box.min.y;
  const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2;
  const vw = L * 1.02, vh = H * 1.06, a = vw / vh;
  Object.assign(camera, { left: -vw / 2, right: vw / 2, top: vh / 2, bottom: -vh / 2, near: -60, far: 60 });
  camera.position.set(cx, cy, dir * 40); camera.up.set(0, 1, 0); camera.lookAt(cx, cy, 0);
  camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
  renderer.setSize(w, Math.round(w / a), false);
  renderer.setPixelRatio(1);
  renderer.render(scene, camera);
  const gl = renderer.getContext(), W = renderer.domElement.width, Hh = renderer.domElement.height;
  const px = new Uint8Array(W * Hh * 4);
  gl.readPixels(0, 0, W, Hh, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const mask = new Uint8Array(W * Hh);
  // readPixels is bottom-up, and the model faces +X (snout) which lands on the image's right.
  // Flip both axes so the mask is top-down with the snout at the left.
  for (let y = 0; y < Hh; y++) for (let x = 0; x < W; x++) mask[y * W + x] = px[((Hh - 1 - y) * W + (W - 1 - x)) * 4] > 60 ? 1 : 0;
  return { w: W, h: Hh, data: mask, metresPerPixel: L / (box.max.x - box.min.x ? W : W), length: L, height: H };
}
if (SIL) {
  const white = new THREE.MeshBasicMaterial({ color: 0xffffff });
  dino.traverse((o) => { if (o.isMesh) o.material = white; });
  renderer.shadowMap.enabled = false;
  document.querySelectorAll('.panel').forEach((p) => (p.style.display = 'none'));
}

window.__trex = {
  state, setGait, THREE, legs, pelvis, neck, tail, arms, trunk, head: headJoint, jaw: jawJoint, renderer, scene,
  ball, ai, NAV, throwBall, placeBall, setChase, randomSpot, ground,
  sim: (dt, n) => { let P; for (let i = 0; i < n; i++) P = animate(dt); return P; },
  // Orthographic capture of a single part (e.g. the skull) with everything else hidden,
  // used to score individual bones against the reference diagrams.
  partSil: (target, w = 900, h = 400, dir = 1) => {
    const hidden = [];
    dino.traverse((o) => { if (o.isMesh && o.visible) { o.visible = false; hidden.push(o); } });
    const shown = [];
    target.traverse((o) => { if (o.isMesh) { o.visible = true; shown.push(o); } });
    const out = silhouette(w, h, dir, target);
    shown.forEach((o) => (o.visible = false));
    hidden.forEach((o) => (o.visible = true));
    out.metresPerPixel = out.length / out.w;
    return out;
  },
  silhouette, step: (dt, n) => { let P; for (let i = 0; i < n; i++) P = animate(dt); controls.update(); renderer.render(scene, camera); return P; }, setCam, U, camera, controls, dino };

const clock = new THREE.Clock();
let autoSeq = [['idle', 5], ['walk', 9], ['run', 8], ['walk', 7], ['idle', 6]], autoIdx = 0;
setGait('idle', false);
function loop() {
  const raw = Math.min(clock.getDelta(), 0.05), dt = raw * state.timeScale;
  if (state.auto) {
    state.autoT += dt;
    if (state.autoT > autoSeq[autoIdx][1]) { state.autoT = 0; autoIdx = (autoIdx + 1) % autoSeq.length; setGait(autoSeq[autoIdx][0], false); }
  }
  if (!window.__trexPaused) {
    const P = animate(dt);
    updateUI(P);
  }
  if (camAnim) {
    camAnim.t = Math.min(1, camAnim.t + raw / 1.1); const e = smooth(0, 1, camAnim.t);
    camera.position.lerpVectors(camAnim.p0, camAnim.p1, e); controls.target.lerpVectors(camAnim.t0, camAnim.t1, e);
    if (camAnim.t >= 1) camAnim = null;
  }
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}
loop();
