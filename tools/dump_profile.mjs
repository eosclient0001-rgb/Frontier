// Dump wave profile samples to JSON for the Python preview renderer.
// Usage: node tools/dump_profile.mjs > /tmp/profile.json
import * as W from '../src/waveshape.js';
import { foldCP, foldKnots, foldEval, faceY, faceGeom, crestX, heightAt, lipFallOf } from '../src/waveshape.js';

const p = W.makeConditions(() => 0.5); // deterministic mid values
p.H = 3.2; p.faceAspect = 0.9; p.curlR = 3.2 * 0.44; p.shrink = 0.28;
p.TBreak = 2.3; p.vPeel = 8.5;

const H = p.H;
const stages = [-0.5, 0.0, 0.35, 0.7, 1.0, 1.3, 1.8, 3.0];
const profiles = [];
for (const b of stages) {
  const t = 10;
  const z = W.zB(t, p) - b * (p.vPeel * p.TBreak);
  const g = faceGeom(z, t, p);
  const cp = foldCP(new Float64Array(16), g.pitch, lipFallOf(g.b, p), g.foam, g.Hf, p.curlR, p.shrink, g.soupK);

  const pts = [];
  const push = (X, y) => pts.push([X, y]);
  const xf = g.Wf;
  for (let i = 0; i <= 12; i++) {
    const X = xf + (14 - xf) * (i / 12);
    push(X, W.dipY(X, g.Wf, g.Hf));
  }
  for (let i = 0; i <= 24; i++) {
    const w = 1 - Math.pow(1 - i / 24, 1.45);
    const X = g.Wf * (1 - w);
    push(X, faceY(X, g.Hf, g.Wf));
  }
  for (let i = 0; i <= 36; i++) {
    const P = foldEval(cp, i / 36, [0, 0]);
    push(P[0], W.pileSkirtClamp(P[0], P[1], g.Hf, g.Wf, g.foam));
  }
  const sX = cp[14], sY = cp[15];
  for (let i = 0; i <= 14; i++) {
    const X = sX + (-3.6 * g.Hf - sX) * Math.pow(i / 14, 1.25);
    push(X, W.backY(X, sX, sY, g.Hf));
  }
  for (let i = 0; i <= 8; i++) {
    const X = -3.6 * g.Hf - Math.pow(i / 8, 1.7) * 12;
    push(X, W.backY(X, sX, sY, g.Hf));
  }
  profiles.push({ b, Hf: g.Hf, Wf: g.Wf, pitch: g.pitch, foam: g.foam, pts });
}

// --- heightfield grid for the physics surface ---
const t = 10;
const zB = W.zB(t, p);
const grid = [];
const NZ = 90, NX = 110;
const zs = [], Xws = [];
for (let j = 0; j < NZ; j++) zs.push(zB - 55 + (j / (NZ - 1)) * 85);
for (let i = 0; i < NX; i++) Xws.push(p.xC0 + p.c * t - 18 + (i / (NX - 1)) * 30);
for (let j = 0; j < NZ; j++) {
  const row = [];
  for (let i = 0; i < NX; i++) row.push(heightAt(Xws[i], zs[j], t, p));
  grid.push(row);
}

// --- full sheet mesh (incl. fold overhang) for a shaded perspective ---
const rowsSpec = [
  ['FLATF', 14], ['FACE', 18], ['ROLLO', 10], ['ROLLI', 8], ['BACK', 10], ['FLATB', 6],
];
const cols = 120;
const mesh = [];
for (const [name, nRows] of rowsSpec) {
  for (let r = 0; r < nRows; r++) {
    const tt = nRows === 1 ? 0 : r / (nRows - 1);
    const row = [];
    for (let j = 0; j < cols; j++) {
      const vv = j / (cols - 1);
      const p2 = vv * 2 - 1;
      const zRef = zB + 10;
      const z = p2 < 0
        ? zRef + (140 / Math.sinh(2.2)) * Math.sinh(2.2 * p2)
        : zRef + (75 / Math.sinh(2.2)) * Math.sinh(2.2 * p2);
      const zz = Math.max(p.zPeel0 - 60, Math.min(p.zLineEnd + 20, z));
      const g = faceGeom(zz, t, p);
      const cp = foldCP(new Float64Array(16), g.pitch, lipFallOf(g.b, p), g.foam, g.Hf, p.curlR, p.shrink, g.soupK);
      let X, y;
      if (name === 'FLATF') {
        const xShoreLoc = p.xShore - crestX(zz, t, p);
        X = g.Wf + (xShoreLoc - g.Wf) * Math.pow(tt, 1.55);
        y = W.dipY(X, g.Wf, g.Hf);
      } else if (name === 'FACE') {
        const w = 1 - Math.pow(1 - tt, 1.45);
        X = g.Wf * (1 - w);
        y = faceY(X, g.Hf, g.Wf);
      } else if (name === 'ROLLO') {
        const sTip = foldKnots(cp, new Float64Array(8));
        const P = foldEval(cp, sTip * tt, [0, 0]); X = P[0];
        y = W.pileSkirtClamp(P[0], P[1], g.Hf, g.Wf, g.foam);
      } else if (name === 'ROLLI') {
        const sTip = foldKnots(cp, new Float64Array(8));
        const P = foldEval(cp, sTip + (1 - sTip) * tt, [0, 0]); X = P[0];
        y = W.pileSkirtClamp(P[0], P[1], g.Hf, g.Wf, g.foam);
      } else if (name === 'BACK') {
        const sX = cp[14], sY = cp[15];
        X = sX + (-3.6 * g.Hf - sX) * Math.pow(tt, 1.25);
        y = W.backY(X, sX, sY, g.Hf);
      } else {
        const sX = cp[14], sY = cp[15];
        X = -3.6 * g.Hf - Math.pow(tt, 1.7) * 60;
        y = W.backY(X, sX, sY, g.Hf);
      }
      const cx = crestX(zz, t, p);
      const swellAmt = name === 'FACE' ? 0.15 : (name === 'ROLLO' || name === 'ROLLI') ? 0.05 : name === 'BACK' ? 0.3 : 1;
      y += W.swellY(cx + X, zz, t) * swellAmt;
      row.push([cx + X, y, zz]);
    }
    mesh.push(row);
  }
}

process.stdout.write(JSON.stringify({ p, H, stages, profiles, Xws, zs, grid, mesh }));
