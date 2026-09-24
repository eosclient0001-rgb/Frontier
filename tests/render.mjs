// Tiny software rasterizer: renders the real skeleton meshes to PNG without a
// browser (orthographic, z-buffered, Lambert-shaded). Used to eyeball the
// skeleton against published skeletal diagrams, and to snapshot gait poses.
//   node tests/render.mjs [view=side|front|top|threeq] [t=seconds] [speed] [out.png] [flesh]
import { MeshStandardMaterial, Vector3, Matrix4, Box3 } from 'three';
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { buildSkeleton } from '../trex/js/skeleton.js';
import { buildFlesh } from '../trex/js/flesh.js';
import { Animator } from '../trex/js/animator.js';

const [view = 'side', tArg = '0', spArg = '0', out = 'render.png', fleshArg] = process.argv.slice(2);
const W = 1400, H = 560;
const mats = { bone: new MeshStandardMaterial(), tooth: new MeshStandardMaterial() };
mats.tooth.userData.tooth = true;
const skel = buildSkeleton(mats);
const flesh = fleshArg ? buildFlesh(skel, new MeshStandardMaterial()) : [];
const anim = new Animator(skel);
const actArg = process.env.ACTION;            // e.g. ACTION=roar / bite / tailSwipe
const turnArg = process.env.TURN;              // optional in-place turn in degrees
anim.setTargetSpeed(+spArg);
anim.speed = +spArg;
if (turnArg) anim.turnBy(+turnArg * Math.PI / 180);
if (actArg) {
  for (let t = 0; t < 0.5; t += 1 / 60) anim.update(1 / 60);
  if (actArg === 'bite' && process.env.TARGET) {
    const T = process.env.TARGET.split(',').map(Number);
    anim.aimTarget = new Vector3(...T); anim.aimWeight = 1;
    for (let t = 0; t < 1.5; t += 1 / 60) anim.update(1 / 60);
    anim.startAction('bite', { target: anim.aimTarget, reach: -T[2] });
  } else anim.startAction(actArg, { side: 1 });
}
for (let t = 0; t < +tArg; t += 1 / 60) anim.update(1 / 60);
anim.update(1 / 60);
if (!actArg && !turnArg) { skel.rig.position.set(0, 0, 0); skel.rig.rotation.set(0, 0, 0); }
skel.rig.updateMatrixWorld(true);

// view transform: world -> screen axes (u right, v up, depth toward viewer)
const views = {
  side: (p) => [-p.z, p.y, -p.x],                 // left side, head on the right
  front: (p) => [p.x, p.y, -p.z],
  top: (p) => [-p.z, -p.x, p.y],
  threeq: (p) => { const c = Math.cos(0.6), s = Math.sin(0.6); const x = -p.z * c - p.x * s, d = p.z * s - p.x * c; return [x, p.y + d * 0.18, d]; },
};
const onlySkull = view === 'skull' || view === 'skullfront' || view === 'chest' || view === 'chestside';
const V = views[view === 'skull' || view === 'chestside' ? 'side' : view === 'skullfront' ? 'threeq' : view === 'chest' ? 'front' : view];
const chestNode = skel.trunk[skel.trunk.length - 2];
const root = view.startsWith('chest') ? chestNode : onlySkull ? skel.head : skel.rig;
const box = new Box3().setFromObject(root);
const corners = [];
for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(V(new Vector3(x, y, z)));
const uMin = Math.min(...corners.map((c) => c[0])), uMax = Math.max(...corners.map((c) => c[0]));
const vMin = Math.min(...corners.map((c) => c[1]), onlySkull ? 1e9 : 0), vMax = Math.max(...corners.map((c) => c[1]));
const scale = Math.min((W - 60) / (uMax - uMin), (H - 60) / (vMax - vMin));
const ox = (W - (uMax - uMin) * scale) / 2 - uMin * scale, oy = H - 30 + vMin * scale;

const img = new Uint8Array(W * H * 3);
const zb = new Float32Array(W * H).fill(-1e9);
for (let i = 0; i < W * H; i++) { const g = 236 - Math.floor((i / W / H) * 30); img.set([g, g - 6, g - 16], i * 3); }
// 1 m grid + ground line
for (let m = Math.ceil(uMin * 10) / 10; m <= uMax; m += onlySkull ? 0.1 : 1) { const x = Math.round(ox + m * scale); for (let y = 0; y < H; y++) if (x >= 0 && x < W) img.set([214, 206, 190], (y * W + x) * 3); }
for (let m = Math.ceil(vMin * 10) / 10; m <= vMax; m += onlySkull ? 0.1 : 1) { const y = Math.round(oy - m * scale); for (let x = 0; x < W; x++) if (y >= 0 && y < H) img.set([214, 206, 190], (y * W + x) * 3); }
const gy = Math.round(oy); if (gy >= 0 && gy < H) for (let x = 0; x < W; x++) img.set([120, 100, 80], (gy * W + x) * 3);

const light = new Vector3(-0.4, 0.8, 0.45).normalize();
const a = new Vector3(), b = new Vector3(), c = new Vector3(), n = new Vector3(), e1 = new Vector3(), e2 = new Vector3();
let tris = 0;
root.traverse((o) => {
  if (!o.isMesh || !o.visible) return;
  const isFlesh = !!o.userData.flesh;
  const col = isFlesh ? [150, 140, 110] : o.material.userData.tooth ? [245, 235, 210] : [120, 84, 56];
  const g = o.geometry, pos = g.attributes.position, idx = g.index;
  const M = o.matrixWorld;
  const cnt = idx ? idx.count : pos.count;
  for (let i = 0; i < cnt; i += 3) {
    const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
    a.fromBufferAttribute(pos, ia).applyMatrix4(M); b.fromBufferAttribute(pos, ib).applyMatrix4(M); c.fromBufferAttribute(pos, ic).applyMatrix4(M);
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
    const shade = 0.35 + 0.65 * Math.abs(n.dot(light));
    const A = V(a), B = V(b), C = V(c);
    const P = [A, B, C].map((p) => [ox + p[0] * scale, oy - p[1] * scale, p[2]]);
    const minX = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
    const minY = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
    const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]);
    if (Math.abs(area) < 1e-9) continue;
    tris++;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w0 = ((P[1][0] - px) * (P[2][1] - py) - (P[2][0] - px) * (P[1][1] - py)) / area;
      const w1 = ((P[2][0] - px) * (P[0][1] - py) - (P[0][0] - px) * (P[2][1] - py)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * P[0][2] + w1 * P[1][2] + w2 * P[2][2];
      const k = y * W + x;
      if (z <= zb[k]) continue;
      zb[k] = z;
      const depthTint = 0.85 + 0.15 * Math.tanh(z);
      img.set(col.map((v) => Math.min(255, v * shade * depthTint * 1.25)), k * 3);
    }
  }
});

// PNG encode
const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) { raw[y * (W * 3 + 1)] = 0; Buffer.from(img.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1); }
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (buf) => { let c = -1; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const l = Buffer.alloc(4); l.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td)); return Buffer.concat([l, td, cr]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
writeFileSync(out, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
console.log(`wrote ${out} (${tris} tris, ${(box.max.z - box.min.z).toFixed(2)} m long)`);
