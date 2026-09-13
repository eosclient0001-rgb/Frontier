// node Verification/render.mjs [species] [seed] [out.png] — software raster of a generated plant (no GPU needed).
// Used to eyeball silhouettes against reference photos. Writes a PPM then converts to PNG via python3/PIL if available.
import { generatePlant, randomParams } from '../plant.js';
import { writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
const [sp = 'palm', seedS = '1', out = `/tmp/${sp}_${seedS}.png`, view = 'side'] = process.argv.slice(2);
const r = generatePlant(sp, randomParams(sp, +seedS));
const g = r.geometry, pos = g.attributes.position.array, col = g.attributes.color.array, nor = g.attributes.normal.array, idx = g.index.array;
const W = 900, H = 900; const img = new Uint8Array(W * H * 3).fill(0); const z = new Float32Array(W * H).fill(Infinity);
for (let i = 0; i < img.length; i += 3) { img[i] = 18; img[i + 1] = 19; img[i + 2] = 22; }
const bb = g.boundingBox; const c = bb.getCenter(new (await import('../vendor/three.module.min.js')).Vector3()); const s = Math.max(bb.max.x - bb.min.x, bb.max.y - bb.min.y, bb.max.z - bb.min.z) * 1.08;
const L = [0.4, 0.8, 0.5]; const ll = Math.hypot(...L); L[0] /= ll; L[1] /= ll; L[2] /= ll;
const proj = (x, y, zz) => {
  x -= c.x; y -= c.y; zz -= c.z;
  let X, Y, Z;
  if (view === 'top') { X = x; Y = zz; Z = -y; }
  else { const a = 0.6; X = x * Math.cos(a) + zz * Math.sin(a); Z = -x * Math.sin(a) + zz * Math.cos(a); Y = y; }
  return [(X / s + .5) * W, (0.5 - Y / s) * H, Z];
};
for (let t = 0; t < idx.length; t += 3) {
  const a = idx[t], b = idx[t + 1], cc = idx[t + 2];
  const P = [a, b, cc].map(i => proj(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]));
  // flat colour: average vertex colour, lit by face normal (two-sided)
  const e1 = [pos[b * 3] - pos[a * 3], pos[b * 3 + 1] - pos[a * 3 + 1], pos[b * 3 + 2] - pos[a * 3 + 2]], e2 = [pos[cc * 3] - pos[a * 3], pos[cc * 3 + 1] - pos[a * 3 + 1], pos[cc * 3 + 2] - pos[a * 3 + 2]];
  let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]; const nl = Math.hypot(...n) || 1;
  const ndl = Math.abs((n[0] * L[0] + n[1] * L[1] + n[2] * L[2]) / nl); const lit = .35 + .75 * ndl;
  const cr = (col[a * 3] + col[b * 3] + col[cc * 3]) / 3, cg = (col[a * 3 + 1] + col[b * 3 + 1] + col[cc * 3 + 1]) / 3, cb = (col[a * 3 + 2] + col[b * 3 + 2] + col[cc * 3 + 2]) / 3;
  const minX = Math.max(0, Math.floor(Math.min(P[0][0], P[1][0], P[2][0]))), maxX = Math.min(W - 1, Math.ceil(Math.max(P[0][0], P[1][0], P[2][0])));
  const minY = Math.max(0, Math.floor(Math.min(P[0][1], P[1][1], P[2][1]))), maxY = Math.min(H - 1, Math.ceil(Math.max(P[0][1], P[1][1], P[2][1])));
  const area = (P[1][0] - P[0][0]) * (P[2][1] - P[0][1]) - (P[2][0] - P[0][0]) * (P[1][1] - P[0][1]); if (Math.abs(area) < 1e-9) continue;
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const px = x + .5, py = y + .5;
    const w0 = ((P[1][0] - px) * (P[2][1] - py) - (P[2][0] - px) * (P[1][1] - py)) / area;
    const w1 = ((P[2][0] - px) * (P[0][1] - py) - (P[0][0] - px) * (P[2][1] - py)) / area;
    const w2 = 1 - w0 - w1; if (w0 < -1e-4 || w1 < -1e-4 || w2 < -1e-4) continue;
    const zz = w0 * P[0][2] + w1 * P[1][2] + w2 * P[2][2]; const k = y * W + x;
    if (zz < z[k]) { z[k] = zz; img[k * 3] = Math.min(255, cr * lit * 255); img[k * 3 + 1] = Math.min(255, cg * lit * 255); img[k * 3 + 2] = Math.min(255, cb * lit * 255); }
  }
}
const ppm = out.replace(/\.png$/, '.ppm');
writeFileSync(ppm, Buffer.concat([Buffer.from(`P6\n${W} ${H}\n255\n`), Buffer.from(img)]));
try { execSync(`python3 -c "from PIL import Image; Image.open('${ppm}').save('${out}')"`); console.log(out, r.stats); } catch { console.log(ppm, r.stats); }
