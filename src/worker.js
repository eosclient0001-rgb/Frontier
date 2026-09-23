// ============================================================================
//  worker.js — pipeline orchestrator (runs off the main thread)
//
//  Stages: multifractal terrain -> SDF voxelisation -> particle hydraulic
//  erosion (SDF-native) -> drainage/fluvial incision -> talus relaxation
//  -> redistancing -> SAT maps -> audit -> exports.
// ============================================================================

import { buildBaseTerrain } from './core/terrain.js';
import { erodeSDF } from './core/erosion.js';
import { computeSatMaps, SAT_CHANNELS } from './core/satmaps.js';
import { pngGray8, pngGray16 } from './core/png.js';
import { makeZip } from './core/zip.js';

const post = (type, payload, transfer) => self.postMessage({ type, ...payload }, transfer || []);

let cancelled = false;

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'run') {
    cancelled = false;
    run(msg.params, msg.id).catch(err => {
      post('error', { id: msg.id, message: String(err && err.stack || err) });
    });
  } else if (msg.type === 'cancel') {
    cancelled = true;
  }
};

async function run(p, id) {
  const t0 = performance.now();
  const log = (s, ms) => post('log', { id, message: s, elapsed: ms === undefined ? undefined : (performance.now() - t0) | 0 });

  // ---------- stage 1: terrain + SDF -------------------------------------
  const base = buildBaseTerrain(p, (f, m) => {
    post('progress', { id, stage: 'terrain', frac: f, label: m });
  });
  const voxMM = base.voxel * 1000;
  log(`Terrain synthesised — grid ${base.grid[0]}×${base.grid[1]}×${base.grid[2]}, voxel ${voxMM.toFixed(1)} mm, ${base.octavesUsed} octaves, detail floor ≈ ${(base.detailCap * 1000).toFixed(0)} mm`);
  post('progress', { id, stage: 'terrain', frac: 1, label: 'SDF voxel grid ready' });

  // resolution contract check (voxel vs intended detail)
  const contract = {
    voxel: base.voxel,
    voxelMM: voxMM,
    grid: base.grid,
    detailCapMM: base.detailCap * 1000,
    maxCutM: (4 + 6 * (p.erosionDepth || 1)) * base.voxel,
    chanTargetVox: 1.0
  };
  post('contract', { id, contract });

  // ---------- stage 2: erosion --------------------------------------------
  const er = erodeSDF(base.vol, p, {
    colH: base.colH,
    onProgress: (f, m, ms) => post('progress', { id, stage: 'erosion', frac: f * 0.82, label: m }),
    isCancelled: () => cancelled
  });
  if (cancelled) { post('cancelled', { id }); return; }
  const a = er.audit;
  log(`Hydraulics — ${p.droplets.toLocaleString()} droplets · ${(a.activeSteps / 1000 | 0)}k active steps · carved ${a.carveVolume.toFixed(0)} m³ · deposited ${a.depositVolume.toFixed(0)} m³`);
  log(`Cut audit — mean ${a.meanCut.toFixed(3)} m · channel mean ${a.channelMeanCut.toFixed(3)} m (${(a.channelMeanCut / a.voxMax).toFixed(2)} vox) · max ${a.maxCut.toFixed(2)} m (budget ${contract.maxCutM.toFixed(2)} m)`);

  // ---------- stage 3: SAT maps -------------------------------------------
  post('progress', { id, stage: 'sat', frac: 0.2, label: 'Deriving SAT maps' });
  const sat = computeSatMaps(base.vol, er.colH, { flow: er.flow, sediment: er.sediment, wear: er.wear });
  log(`SAT maps derived — flow, sediment, wear, peaks, pointiness, slope, height, wetness (packed 2×RGBA8)`);

  const elapsed = ((performance.now() - t0) / 1000).toFixed(1);

  // ---------- audit report --------------------------------------------------
  const report = buildReport(p, base, a, contract, sat, elapsed);

  // ---------- exports (ZIP) -------------------------------------------------
  post('progress', { id, stage: 'export', frac: 0.4, label: 'Encoding exports' });
  const nx = base.vol.nx, nz = base.vol.nz;
  const files = [];

  // 16-bit heightmap
  let hMin = Infinity, hMax = -Infinity;
  for (let i = 0; i < er.colH.length; i++) { if (er.colH[i] < hMin) hMin = er.colH[i]; if (er.colH[i] > hMax) hMax = er.colH[i]; }
  const u16 = new Uint16Array(nx * nz);
  for (let i = 0; i < u16.length; i++) u16[i] = Math.max(0, Math.min(65535, ((er.colH[i] - hMin) / (hMax - hMin)) * 65535));
  files.push({ name: 'heightmap_16bit.png', data: pngGray16(nx, nz, u16) });

  // SAT map PNGs
  for (const c of SAT_CHANNELS) {
    files.push({ name: `satmaps/${c.key}.png`, data: pngGray8(nx, nz, sat.maps[c.key]) });
  }

  // surface mesh (heightfield of the eroded SDF, world-metre OBJ with normals + UVs)
  post('progress', { id, stage: 'export', frac: 0.55, label: 'Building OBJ mesh' });
  files.push({ name: 'surface.obj', data: buildOBJ(base.vol, er.colH) });

  // raw SDF volume + header (u16 quantised across the clamp band)
  post('progress', { id, stage: 'export', frac: 0.7, label: 'Packing SDF volume' });
  const clampM = base.bandDist;
  const nVox = base.vol.data.length;
  const sdfQ = new Uint16Array(nVox);
  for (let i = 0; i < nVox; i++) {
    const d = Math.max(-clampM, Math.min(clampM, base.vol.data[i]));
    sdfQ[i] = ((d / clampM) * 0.5 + 0.5) * 65535 | 0;
  }
  files.push({ name: 'sdf/volume_u16.raw', data: new Uint8Array(sdfQ.buffer) });
  const header = {
    format: 'Frontier SDF v1', order: 'x fastest: idx=(z*ny+y)*nx+x', units: 'metres',
    sign: 'negative inside rock', storage: 'u16, d = (v/65535*2-1)*clampM',
    clampM, dims: base.grid, size: p.size, voxel: base.vol.vox,
    heightRange: [hMin, hMax], params: p, audit: a, generated: new Date().toISOString()
  };
  files.push({ name: 'sdf/header.json', data: new TextEncoder().encode(JSON.stringify(header, null, 2)) });
  files.push({ name: 'params.json', data: new TextEncoder().encode(JSON.stringify(p, null, 2)) });
  files.push({ name: 'AUDIT.md', data: new TextEncoder().encode(report) });

  const zip = makeZip(files);

  // cut/fill map (diverging u8: 128 = unchanged, >128 eroded, <128 deposited)
  let cAbs = 0;
  for (let i = 0; i < er.cut.length; i++) { const v = Math.abs(er.cut[i]); if (v > cAbs) cAbs = v; }
  const cutMap = new Uint8Array(er.cut.length);
  const cS = 127 / Math.max(1e-4, cAbs);
  for (let i = 0; i < cutMap.length; i++)
    cutMap[i] = Math.max(0, Math.min(255, 128 + er.cut[i] * cS)) | 0;

  // droplet trail overlay (log-normed particle flow)
  let fMax = 0;
  for (let i = 0; i < er.dropletFlow.length; i++) if (er.dropletFlow[i] > fMax) fMax = er.dropletFlow[i];
  const trail = new Uint8Array(er.dropletFlow.length);
  const lMax = Math.log1p(fMax) || 1;
  for (let i = 0; i < trail.length; i++)
    trail[i] = Math.min(255, 255 * Math.pow(Math.log1p(er.dropletFlow[i]) / lMax, 0.65));

  // ---------- ship results (zero-copy transfers) -----------------------------
  post('done', {
    id,
    sdf: { dims: base.grid, size: p.size, voxel: base.vol.vox, clamp: base.bandDist, data: base.vol.data.buffer },
    satA: sat.satA.buffer,
    satB: sat.satB.buffer,
    colH: er.colH.buffer,
    trail: trail.buffer,
    cutMap: cutMap.buffer,
    heightRange: [hMin, hMax],
    audit: a,
    contract,
    zip: zip.buffer,
    elapsed: Number(elapsed)
  }, [base.vol.data.buffer, sat.satA.buffer, sat.satB.buffer, er.colH.buffer, trail.buffer, cutMap.buffer, zip.buffer]);
}

/** Heightfield OBJ: eroded surface at grid resolution, world metres. */
function buildOBJ(vol, colH) {
  const { nx, nz } = vol;
  const vox = vol.vox;
  const L = [];
  L.push('# Frontier SDF terrain lab — eroded surface');
  L.push(`# grid ${nx}x${nz}  domain ${vol.size[0]}x${vol.size[2]} m`);
  L.push('mtllib frontier.mtl');
  const at = (i, k) => colH[Math.min(nz - 1, Math.max(0, k)) * nx + Math.min(nx - 1, Math.max(0, i))];
  for (let k = 0; k < nz; k++) {
    for (let i = 0; i < nx; i++) {
      const h = colH[k * nx + i];
      const dx = (at(i + 1, k) - at(i - 1, k)) / (2 * vox[0]);
      const dz = (at(i, k + 1) - at(i, k - 1)) / (2 * vox[2]);
      const l = Math.hypot(dx, 1, dz);
      L.push(`v ${vol.worldX(i).toFixed(3)} ${h.toFixed(3)} ${vol.worldZ(k).toFixed(3)}`);
      L.push(`vn ${(dx / l).toFixed(4)} ${(1 / l).toFixed(4)} ${(dz / l).toFixed(4)}`);
      L.push(`vt ${(i / (nx - 1)).toFixed(5)} ${(1 - k / (nz - 1)).toFixed(5)}`);
    }
  }
  for (let k = 0; k < nz - 1; k++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = k * nx + i + 1, b = a + 1, c = a + nx + 1, d = a + nx;
      L.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
      L.push(`f ${a}/${a}/${a} ${c}/${c}/${c} ${d}/${d}/${d}`);
    }
  }
  return new TextEncoder().encode(L.join('\n'));
}

function buildReport(p, base, a, contract, sat, elapsed) {
  const [hMin, hMax] = sat.heightRange;
  return `# Frontier — SDF Terrain Audit

## Voxelisation contract
| Metric | Value |
|---|---|
| Domain | ${p.size[0]} × ${p.size[1]} × ${p.size[2]} m |
| Grid | ${contract.grid[0]} × ${contract.grid[1]} × ${contract.grid[2]} cells |
| Voxel | ${(contract.voxelMM).toFixed(1)} mm isotropic |
| Smallest representable feature | ≈ ${contract.detailCapMM.toFixed(0)} mm (3 voxels) |
| Erosion cut budget (max) | ${contract.maxCutM.toFixed(2)} m = ${((4 + 6 * p.erosionDepth)).toFixed(0)} vox — matched to resolution |

## Hydraulic erosion (SDF-native particles)
| Metric | Value |
|---|---|
| Droplets | ${p.droplets.toLocaleString()} |
| Max steps | ${p.maxSteps} |
| Active erosion/deposition steps | ${a.activeSteps.toLocaleString()} |
| Carved volume | ${a.carveVolume.toFixed(1)} m³ |
| Deposited volume | ${a.depositVolume.toFixed(1)} m³ |
| Mean column cut | ${a.meanCut.toFixed(3)} m |
| Mean channel incision | ${a.channelMeanCut.toFixed(3)} m (${(a.channelMeanCut / a.voxMax).toFixed(2)} voxel) |
| Max column cut | ${a.maxCut.toFixed(2)} m (budget ${contract.maxCutM.toFixed(2)} m) |

## Method notes
- Erosion operates on the **signed distance field**, not a mesh: droplets flow
  on the implicit isosurface with tangent-projected gravity and are re-projected
  with Newton steps. Cuts are volumetric stamps into the field, followed by
  narrow-band fast-sweep redistancing so the SDF stays a true distance field.
- Drainage (D8 + priority-flood) drives stream-power incision \`E = K·A^m·S^n\`,
  carved into the SDF as column deltas — the flow SAT map is the accumulated
  discharge.
- SAT maps packed: **satA** = flow, sediment, wear, peaks · **satB** = pointiness,
  slope, height, wetness.

Generated in ${elapsed} s.
`;
}
