// Software rasteriser: renders the mannequin + dress to ASCII so the geometry
// can be inspected without a browser. Run: node tools/preview.mjs [view]
//   views: front | side | three-quarter
import { buildBodySpec, buildBodyMesh, packCollision } from '../src/body.js';
import { buildDress } from '../src/dress.js';
import { buildState } from '../src/physics.js';
import { m4, v3 } from '../src/math.js';
import { DEFAULT_FABRIC, packFabric } from '../src/fabric.js';

const P = {
  height: 1.70, shoulders: 1.0, bust: 1.0, waist: 0.92, hips: 1.06,
  bustHeight: 1.0, armAngle: 16, legSpread: 0, bodySegments: 44,
  style: (process.env.STYLE ?? 'aline'), length: 0.60, fit: 1.030, ease: 1.0, flare: 1.0,
  pleats: 14, pleatDepth: 0.020, neckline: 'sweetheart', straps: 1,
  strapWidth: 0.030, strapInset: 0, strapPinRange: 0.16, neckDrop: 1.0,
  hemSweep: 1.0, tierAmp: 1.0, resolution: 96, pinTopRows: 2, arealDensity: 0.20,
  constraintParams: { stretchComp: 1.5e-6, shearComp: 3e-5, bendComp: 8e-4, stitchComp: 1e-7 },
};
if (process.env.LENGTH) P.length = parseFloat(process.env.LENGTH);
if (process.env.NECKLINE) P.neckline = process.env.NECKLINE;
if (process.env.FLARE) P.flare = parseFloat(process.env.FLARE);
if (process.env.STRAPS !== undefined) P.straps = Number(process.env.STRAPS);

const W = Number(process.env.W ?? 92);
const H = Number(process.env.H ?? 44);

const spec = buildBodySpec(P);
const body = buildBodyMesh(spec, P.bodySegments, 14);
const dress = buildDress(spec, P, P.resolution);

const views = {
  front: [0, 0.03, 2.7, 0.9],
  side: [Math.PI / 2, 0.03, 2.7, 0.9],
  three: [0.62, 0.12, 2.7, 0.92],
  close: [0.35, 0.22, 1.5, 1.28],
};
const [yaw, pitch, dist, ty] = views[process.argv[2] ?? 'front'] ?? views.front;

const target = [0, ty, 0];
const eye = [
  target[0] + dist * Math.sin(yaw) * Math.cos(pitch),
  target[1] + dist * Math.sin(pitch),
  target[2] + dist * Math.cos(yaw) * Math.cos(pitch),
];
// character cells are ~2x taller than wide, so the projection aspect is W/(2H)
const proj = m4.perspective(38 * Math.PI / 180, W / (2 * H), 0.05, 60);
const view = m4.lookAt(eye, target, [0, 1, 0]);
const vp = m4.mul(proj, view);
const light = v3.norm([0.45, 0.72, 0.62]);

const zbuf = new Float32Array(W * H).fill(Infinity);
const cbuf = new Array(W * H).fill(null);

function project(p) {
  const x = vp[0] * p[0] + vp[4] * p[1] + vp[8] * p[2] + vp[12];
  const y = vp[1] * p[0] + vp[5] * p[1] + vp[9] * p[2] + vp[13];
  const z = vp[2] * p[0] + vp[6] * p[1] + vp[10] * p[2] + vp[14];
  const w = vp[3] * p[0] + vp[7] * p[1] + vp[11] * p[2] + vp[15];
  if (w <= 0) return null;
  return [
    (x / w * 0.5 + 0.5) * W,
    (1 - (y / w * 0.5 + 0.5)) * H,
    z / w,
  ];
}

function raster(pos, idx, kind) {
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const A = project([pos[a], pos[a + 1], pos[a + 2]]);
    const B = project([pos[b], pos[b + 1], pos[b + 2]]);
    const C = project([pos[c], pos[c + 1], pos[c + 2]]);
    if (!A || !B || !C) continue;
    const minX = Math.max(0, Math.floor(Math.min(A[0], B[0], C[0])));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(A[0], B[0], C[0])));
    const minY = Math.max(0, Math.floor(Math.min(A[1], B[1], C[1])));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(A[1], B[1], C[1])));
    const area = (B[0] - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (B[1] - A[1]);
    if (Math.abs(area) < 1e-9) continue;
    // face normal (world space) for lambert shading
    const e1 = [pos[b] - pos[a], pos[b + 1] - pos[a + 1], pos[b + 2] - pos[a + 2]];
    const e2 = [pos[c] - pos[a], pos[c + 1] - pos[a + 1], pos[c + 2] - pos[a + 2]];
    let n = v3.norm(v3.cross(e1, e2));
    const toEye = v3.norm(v3.sub(eye, [pos[a], pos[a + 1], pos[a + 2]]));
    if (v3.dot(n, toEye) < 0) n = v3.scale(n, -1);
    const lam = Math.max(0, v3.dot(n, light)) * 0.85 + 0.15;
    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const cx = px + 0.5, cy = py + 0.5;
        const w0 = ((B[0] - A[0]) * (cy - A[1]) - (cx - A[0]) * (B[1] - A[1])) / area;
        const w1 = ((cx - A[0]) * (C[1] - A[1]) - (C[0] - A[0]) * (cy - A[1])) / area;
        if (w0 < 0 || w1 < 0 || w0 + w1 > 1) continue;
        const z = A[2] + w1 * (C[2] - A[2]) + w0 * (B[2] - A[2]);
        const o = py * W + px;
        if (z < zbuf[o]) { zbuf[o] = z; cbuf[o] = { lam, kind }; }
      }
    }
  }
}

raster(body.positions, body.indices, 'body');
raster(dress.positions, dress.indices, 'cloth');

const RAMP = ' .:-=+*#%@';
let out = '';
for (let y = 0; y < H; y++) {
  let line = '';
  for (let x = 0; x < W; x++) {
    const c = cbuf[y * W + x];
    if (!c) { line += ' '; continue; }
    const lv = Math.min(RAMP.length - 1, Math.max(0, Math.round(c.lam * (RAMP.length - 1))));
    let ch = RAMP[lv];
    if (c.kind === 'cloth') ch = 'abcdefghij'[lv]; // cloth uses letters, body symbols
    line += ch;
  }
  out += line + '\n';
}

const fabric = packFabric(DEFAULT_FABRIC);
console.log(`\n${P.style} / ${P.neckline} / length=${P.length} / flare=${P.flare} / straps=${P.straps} / fabric=${DEFAULT_FABRIC.name}`);
console.log(out);
const dressVerts = dress.positions.length / 3;
let minY = Infinity, maxY = -Infinity, maxR = 0;
for (let i = 0; i < dressVerts; i++) {
  minY = Math.min(minY, dress.positions[i * 3 + 1]);
  maxY = Math.max(maxY, dress.positions[i * 3 + 1]);
  maxR = Math.max(maxR, Math.hypot(dress.positions[i * 3], dress.positions[i * 3 + 2]));
}
console.log(`cloth: ${dressVerts} pts, y ${minY.toFixed(3)}..${maxY.toFixed(3)} m, max radius ${maxR.toFixed(3)} m`);
console.log(`body:  ${body.positions.length / 3} pts, ${body.indices.length / 3} tris | fabric pattern type ${fabric[28]}`);
void packCollision; void buildState; void light;
