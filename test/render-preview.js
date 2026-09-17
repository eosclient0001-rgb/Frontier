/* Offline verification render: runs the full pipeline in Node and composites
 * albedo + hillshade into a PNG (out/preview.png) for visual inspection. */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const T = require('../js/terrain-core.js');

const n = 512, sizeM = 100, cell = sizeM / (n - 1);

const g = T.generateMountain({
  n, seed: 1337, heightM: 38, octaves: 6, persistence: 0.5,
  ridgedMix: 0.55, ridgeExp: 2.2, warp: 0.55, sharpness: 1.9, baseFreq: 2.6, sizeM
});
console.log(`generate: peak ${g.stats.max.toFixed(1)} m`);

const e = T.runHydraulic(g.h, n, {
  seed: 1337, sizeM, particles: 300000, iterations: 24, stepsPerIter: 2,
  rain: 1.0, capacityK: 0.9, cutVoxels: 0.25, depVoxels: 0.35, stepVoxels: 1.0,
  evap: 0.995, respawnFrac: 0.25, slideLimit: 1.1
}, (p) => { if (p.iteration % 6 === 0) console.log(`  erode ${p.iteration}/${p.iterations}`); });
T.massWaste(g.h, n, 2, 0.5 * cell);
let hMax = 0; for (let i = 0; i < g.h.length; i++) if (g.h[i] > hMax) hMax = g.h[i];
console.log(`erode: −${e.stats.erodedVol.toFixed(0)} m³ / +${e.stats.depositedVol.toFixed(0)} m³ · peak now ${hMax.toFixed(1)} m`);

const s = T.computeSplatMaps(g.h, e.flow, e.dep, n,
  { seed: 1337, Hmax: hMax, sizeM, intensities: { flow: 1.4, sediment: 1.2, peak: 1.0, pines: 1.0, base: 1.0 } }, sizeM);
console.log('splat: baked albedo + vis');

/* ---------- hillshade composite ---------- */
const out = new Uint8Array(n * n * 3);
// sun direction (world: x→east(+), y→up, z→south(+)); light from NW-above
let Lx = -0.55, Ly = 0.75, Lz = -0.35;
const Llen = Math.hypot(Lx, Ly, Lz);
Lx /= Llen; Ly /= Llen; Lz /= Llen;

for (let j = 1; j < n - 1; j++) {
  for (let i = 1; i < n - 1; i++) {
    const o = j * n + i;
    const gx = (g.h[o + 1] - g.h[o - 1]) / (2 * cell);
    const gz = (g.h[o + n] - g.h[o - n]) / (2 * cell);
    // surface normal of z = h(x, z): n = (-gx, 1, -gz)
    let nx = -gx, ny = 1, nz = -gz;
    const nl = Math.hypot(nx, ny, nz);
    nx /= nl; ny /= nl; nz /= nl;
    let dot = nx * Lx + ny * Ly + nz * Lz;
    if (dot < 0) dot = 0;
    const shade = 0.30 + 0.85 * Math.pow(dot, 0.85);
    // sky light fill
    const fill = 0.25 + 0.15 * ny;
    const light = Math.min(1.35, shade + fill * (1 - dot));

    out[o * 3] = Math.min(255, (s.albedo[o * 3] * light) | 0);
    out[o * 3 + 1] = Math.min(255, (s.albedo[o * 3 + 1] * light) | 0);
    out[o * 3 + 2] = Math.min(255, (s.albedo[o * 3 + 2] * light) | 0);
  }
}

/* ---------- minimal PNG encoder ---------- */
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let c = 0; c < 256; c++) {
    let h = c;
    for (let k = 0; k < 8; k++) h = (h & 1) ? (0xEDB88320 ^ (h >>> 1)) : (h >>> 1);
    t[c] = h >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let h = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) h = crcTable[(h ^ buf[i]) & 0xFF] ^ (h >>> 8);
  return (h ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.from(type, 'ascii');
  const body = Buffer.concat([td, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(n, 0);
ihdr.writeUInt32BE(n, 4);
ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
const raw = Buffer.alloc((n * 3 + 1) * n);
for (let y = 0; y < n; y++) {
  raw[y * (n * 3 + 1)] = 0;
  Buffer.from(out.buffer, y * n * 3, n * 3).copy(raw, y * (n * 3 + 1) + 1);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

fs.mkdirSync(path.join(__dirname, '..', 'out'), { recursive: true });
fs.writeFileSync(path.join(__dirname, '..', 'out', 'preview.png'), png);
console.log(`wrote out/preview.png (${(png.length / 1024).toFixed(0)} KB)`);
