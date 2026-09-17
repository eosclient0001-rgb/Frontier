/* ============================================================
 * Frontier · SDF Terrain Lab — main pipeline
 *
 *   MULTIFRACTAL MOUNTAIN   →  HYDRAULIC SDF EROSION   →  SPLATMAPS
 *   (fBm + ridge + peak     (thermal drops + D8 flow   (height/slope/curve/
 *    gradient mask)          accumulation, voxel-matched  flow/erosion/sediment/
 *                             cut depth)                 peaks/points → 5 layers)
 * ============================================================ */

import { buildMountain } from './mountain.js';
import { runErosion } from './erosion.js';
import { computeChannels, computeSplatWeights, previewField } from './splats.js';
import { bakeAllTextures } from './textures.js';
import { TerrainView } from './terrain.js';
import {
  mkSection, mkSlider, mkSelect, mkCheck, mkSeed, mkReadout, mkStat,
} from './ui.js';

// ---------------------------------------------------------------- params
const P = {
  // mountain
  N: 320, seed: 1337, frequency: 2.4, octaves: 5, gain: 0.48, ridge: 0.38,
  peakHeight: 50, peakRadius: 28, peakSharp: 1.5, warp: 0.55, tilt: 0.42, seaLevel: -7,
  // erosion
  erodeSeed: 42, drops: 8192, dropSize: 1.6, erodibility: 0.60,
  traversal: 90, cutFrac: 0.22,
  thermalOn: true, hydOn: true, flowPasses: 8, flowExp: 1.1, sedimentOn: true,
  // splats
  preview: 'blended', snowLine: 28,
  // view
  waterOn: true, wireframe: false, autoOrbit: false,
};

const WORLD = 100; // 100 m × 100 m test terrain

// ---------------------------------------------------------------- state
const S = {
  baseH: null,      // fresh mountain (pre-erosion), Float32Array
  h: null,          // live field (mutated by erosion)
  N: 0, voxel: 0,
  channels: null,
  erodeStats: null,
  // last erosion fields (kept so live rebuilds don't lose flow/sediment)
  lastFlow: null, lastFlowMax: 1,
  lastErosionMap: null, lastDepositMap: null, lastPointsMap: null,
  lastWater: null, waterInfo: null,
  genMs: 0, erodeMs: 0,
  busy: false,
};

// ---------------------------------------------------------------- DOM
const $ = (id) => document.getElementById(id);
const viewport = $('viewport');
const els = {
  fps: $('fps'), busy: $('busy'), clock: $('clock'), probe: $('probe'),
};

const view = new TerrainView(viewport, {
  onProbe: (p) => {
    els.probe.textContent = p
      ? `x ${p.x.toFixed(1)} m · z ${p.z.toFixed(1)} m · elev ${p.elev.toFixed(2)} m · slope ${p.slope.toFixed(1)}°`
      : 'probe: hover terrain';
  },
  onFps: (f) => { els.fps.textContent = f.toFixed(0) + ' fps'; },
});

// ---------------------------------------------------------------- UI build
const left = $('leftPanel');
const right = $('rightPanel');
const C = {}; // control registry

// ---- Mountain section ----
{
  const b = mkSection(left, 'MOUNTAIN · MULTIFRACTAL', 'fBm gradient noise + peak gradient');
  C.seed = mkSeed(b, { id: 'seed', label: 'Seed', value: P.seed });
  C.N = mkSelect(b, {
    id: 'N', label: 'Grid (100 m × 100 m)', value: P.N,
    options: [[160, '160 × 160'], [224, '224 × 224'], [320, '320 × 320'], [384, '384 × 384'], [448, '448 × 448']],
  });
  C.voxelRo = mkReadout(b, 'Voxel size');
  C.frequency = mkSlider(b, { id: 'frequency', label: 'Feature frequency', min: 1, max: 8, step: 0.1, value: P.frequency });
  C.octaves = mkSlider(b, { id: 'octaves', label: 'Octaves', min: 2, max: 8, step: 1, value: P.octaves });
  C.gain = mkSlider(b, { id: 'gain', label: 'Multifractal gain', min: 0.3, max: 0.65, step: 0.01, value: P.gain });
  C.ridge = mkSlider(b, { id: 'ridge', label: 'Ridged blend', min: 0, max: 1, step: 0.05, value: P.ridge });
  C.peakHeight = mkSlider(b, { id: 'peakHeight', label: 'Peak height', min: 15, max: 90, step: 1, value: P.peakHeight, unit: ' m' });
  C.peakRadius = mkSlider(b, { id: 'peakRadius', label: 'Peak radius', min: 14, max: 40, step: 1, value: P.peakRadius, unit: ' m' });
  C.peakSharp = mkSlider(b, { id: 'peakSharp', label: 'Peak gradient', min: 0.9, max: 2.6, step: 0.05, value: P.peakSharp });
  C.warp = mkSlider(b, { id: 'warp', label: 'Domain warp', min: 0, max: 1, step: 0.05, value: P.warp });
  C.tilt = mkSlider(b, { id: 'tilt', label: 'Flank tilt', min: 0, max: 1, step: 0.05, value: P.tilt });
  C.seaLevel = mkSlider(b, { id: 'seaLevel', label: 'Sea level', min: -14, max: 0, step: 0.5, value: P.seaLevel, unit: ' m' });
}

// ---- Erosion section ----
{
  const b = mkSection(left, 'HYDRAULIC EROSION', 'SDF-domain · particle + flow');
  C.thermalOn = mkCheck(b, { id: 'thermalOn', label: 'Thermal drops', value: P.thermalOn, hint: 'water particles' });
  C.hydOn = mkCheck(b, { id: 'hydOn', label: 'Hydraulic flow', value: P.hydOn, hint: 'D8 accumulation' });
  C.erodeSeed = mkSeed(b, { id: 'erodeSeed', label: 'Erosion seed', value: P.erodeSeed });
  C.drops = mkSlider(b, { id: 'drops', label: 'Drop count', min: 2048, max: 24576, step: 512, value: P.drops, fmt: (v) => v.toLocaleString() });
  C.dropSize = mkSlider(b, { id: 'dropSize', label: 'Drop size', min: 0.5, max: 4, step: 0.1, value: P.dropSize });
  C.erodibility = mkSlider(b, { id: 'erodibility', label: 'Erodibility', min: 0.1, max: 1, step: 0.05, value: P.erodibility });
  C.traversal = mkSlider(b, { id: 'traversal', label: 'Drop path length', min: 20, max: 140, step: 2, value: P.traversal, unit: ' m' });
  C.cutFrac = mkSlider(b, { id: 'cutFrac', label: 'Max cut / step', min: 0.05, max: 0.45, step: 0.01, value: P.cutFrac, fmt: (v) => (v * 100).toFixed(0) + '% vox' });
  C.cutRo = mkReadout(b, 'Cut ↔ voxel match');
  C.flowPasses = mkSlider(b, { id: 'flowPasses', label: 'Flow passes', min: 1, max: 12, step: 1, value: P.flowPasses });
  C.flowExp = mkSlider(b, { id: 'flowExp', label: 'Flow exponent', min: 0.5, max: 2, step: 0.05, value: P.flowExp });
  C.sedimentOn = mkCheck(b, { id: 'sedimentOn', label: 'Sedimentation', value: P.sedimentOn, hint: 'sediment routing + alluvial fans' });
}

// ---- Splatmaps section ----
{
  const b = mkSection(left, 'SPLATMAPS', 'Gaea-style channels → 5 layers');
  C.preview = mkSelect(b, {
    id: 'preview', label: 'Channel preview', value: P.preview,
    options: [
      ['blended', 'Blended albedo'], ['height', 'Height'], ['slope', 'Slope'],
      ['curvature', 'Curvature'], ['flow', 'Flow'], ['erosion', 'Erosion'],
      ['sediment', 'Sediment'], ['peaks', 'Peaks'], ['points', 'Points'],
      ['water', 'Water bodies'],
    ],
  });
  C.snowLine = mkSlider(b, { id: 'snowLine', label: 'Snow line', min: 15, max: 60, step: 1, value: P.snowLine, unit: ' m' });
}

// ---- View section ----
{
  const b = mkSection(left, 'VIEW');
  C.waterOn = mkCheck(b, { id: 'waterOn', label: 'Water plane', value: P.waterOn });
  C.wireframe = mkCheck(b, { id: 'wireframe', label: 'Wireframe (voxels)', value: P.wireframe });
  C.autoOrbit = mkCheck(b, { id: 'autoOrbit', label: 'Auto orbit', value: P.autoOrbit });
}

// ---- right panel: stats ----
const stats = {};
{
  const t = mkSection(right, 'TERRAIN', '100 m × 100 m');
  stats.grid = mkStat(t, 'Grid');
  stats.voxel = mkStat(t, 'Voxel');
  stats.verts = mkStat(t, 'Vertices');
  stats.tris = mkStat(t, 'Triangles');
  stats.minH = mkStat(t, 'Min elev');
  stats.maxH = mkStat(t, 'Max elev');
  stats.meanH = mkStat(t, 'Mean elev');

  const e = mkSection(right, 'HYDRAULIC EROSION');
  stats.carved = mkStat(e, 'Carved');
  stats.deposited = mkStat(e, 'Deposited');
  stats.stops = mkStat(e, 'Drop stops');
  stats.flowMax = mkStat(e, 'Max flow (cells)');
  stats.water = mkStat(e, 'Water bodies');
  stats.genMs = mkStat(e, 'Mountain time');
  stats.erodeMs = mkStat(e, 'Erosion time');

  const h = mkSection(right, 'ELEVATION HISTOGRAM');
  const cv = document.createElement('canvas');
  cv.id = 'histCanvas';
  cv.width = 232; cv.height = 88;
  h.appendChild(cv);
}

// ---------------------------------------------------------------- helpers
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

function setBusy(txt) {
  S.busy = true;
  els.busy.textContent = txt || 'working…';
  els.busy.classList.add('on');
  document.body.classList.add('working');
}
function clearBusy() {
  S.busy = false;
  els.busy.textContent = '';
  els.busy.classList.remove('on');
  document.body.classList.remove('working');
}

function updateVoxelReadouts() {
  const voxel = WORLD / (P.N - 1);
  C.voxelRo.set((voxel * 100).toFixed(2) + ' cm');
  const cut = voxel * P.cutFrac;
  const steps = Math.max(16, Math.round(P.traversal / voxel));
  C.cutRo.set(`${(cut * 100).toFixed(1)} cm = ${(P.cutFrac * 100).toFixed(0)}% · path ${steps} steps`);
}

function baseChannels() {
  const size = S.N * S.N;
  return computeChannels({
    h: S.h, N: S.N, voxel: S.voxel,
    flow: null, flowMax: 1, pits: null,
    erosionMap: new Float32Array(size),
    depositMap: new Float32Array(size),
    pointsMap: new Float32Array(size),
  });
}

function rebuildMesh() {
  let pf = null;
  if (P.preview !== 'blended') {
    pf = P.preview === 'water' ? S.lastWater : previewField(P.preview, S.channels);
  }
  view.rebuild({
    h: S.h, N: S.N, voxel: S.voxel,
    weights: computeSplatWeights({ channels: S.channels, h: S.h, N: S.N, seaLevel: P.seaLevel, snowLine: P.snowLine }),
    channels: S.channels,
    previewField: pf,
    seaLevel: P.seaLevel,
    water: S.lastWater,
  });
  drawHistogram();
  updateTerrainStats();
}

function updateTerrainStats() {
  if (!S.h) return;
  let min = Infinity, max = -Infinity, sum = 0;
  for (let i = 0; i < S.h.length; i++) { const v = S.h[i]; if (v < min) min = v; if (v > max) max = v; sum += v; }
  stats.grid.set(`${S.N} × ${S.N}`);
  stats.voxel.set((S.voxel * 100).toFixed(2) + ' cm');
  stats.verts.set((S.N * S.N).toLocaleString());
  stats.tris.set(((S.N - 1) * (S.N - 1) * 2).toLocaleString());
  stats.minH.set(min.toFixed(2) + ' m');
  stats.maxH.set(max.toFixed(2) + ' m');
  stats.meanH.set((sum / S.h.length).toFixed(2) + ' m');
}

function updateErosionStats() {
  const s = S.erodeStats;
  stats.carved.set(s ? s.carvedM3.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' m³' : '—');
  stats.deposited.set(s ? s.depositedM3.toLocaleString(undefined, { maximumFractionDigits: 0 }) + ' m³' : '—');
  stats.stops.set(s && s.thermal ? s.thermal.stops.toLocaleString() : '—');
  stats.flowMax.set(s && s.hydraulic ? s.hydraulic.flowMax.toLocaleString() : '—');
  const wi = S.waterInfo;
  stats.water.set(wi ? `${wi.lakes} lakes · ${wi.rivers} rivers` : '—');
  stats.genMs.set(S.genMs ? S.genMs.toFixed(0) + ' ms' : '—');
  stats.erodeMs.set(S.erodeMs ? S.erodeMs.toFixed(0) + ' ms' : '—');
}

function drawHistogram() {
  const cv = document.getElementById('histCanvas');
  if (!cv) return;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  ctx.clearRect(0, 0, W, H);
  if (!S.h) return;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < S.h.length; i++) { const v = S.h[i]; if (v < min) min = v; if (v > max) max = v; }
  const span = Math.max(max - min, 1e-6);
  const B = 96;
  const bins = new Float32Array(B);
  for (let i = 0; i < S.h.length; i++) {
    const k = Math.min(B - 1, ((S.h[i] - min) / span * B) | 0);
    bins[k]++;
  }
  let bmax = 0;
  for (let k = 0; k < B; k++) if (bins[k] > bmax) bmax = bins[k];
  const barW = W / B;
  for (let k = 0; k < B; k++) {
    const v = bins[k] / bmax;
    const hgt = v * (H - 14);
    const hue = 195 - (k / B) * 150;
    ctx.fillStyle = `hsl(${hue} 45% ${30 + v * 35}%)`;
    ctx.fillRect(k * barW, H - 8 - hgt, Math.max(1, barW - 1), hgt);
  }
  // sea level marker
  const seaY = H - 8 - ((0 - min) / span) * (H - 14);
  if (seaY > 0 && seaY < H - 8) {
    ctx.strokeStyle = 'rgba(120, 190, 255, 0.8)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(0, seaY); ctx.lineTo(W, seaY); ctx.stroke();
    ctx.setLineDash([]);
  }
  // snow line marker
  const snowY = H - 8 - ((P.snowLine - min) / span) * (H - 14);
  if (snowY > 0 && snowY < H - 8) {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(0, snowY); ctx.lineTo(W, snowY); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = 'rgba(200, 214, 228, 0.75)';
  ctx.font = '9px monospace';
  ctx.fillText(min.toFixed(0) + ' m', 2, 9);
  ctx.textAlign = 'right';
  ctx.fillText(max.toFixed(0) + ' m', W - 2, 9);
  ctx.textAlign = 'left';
}

// ---------------------------------------------------------------- pipeline
async function generateMountain() {
  setBusy('building mountain…');
  await nextFrame();
  const t0 = performance.now();
  const m = buildMountain({
    N: P.N, worldSize: WORLD, seed: P.seed,
    frequency: P.frequency, octaves: P.octaves, gain: P.gain, ridge: P.ridge,
    peakHeight: P.peakHeight, peakRadius: P.peakRadius, peakSharp: P.peakSharp,
    warp: P.warp, tilt: P.tilt, seaLevel: P.seaLevel,
  });
  S.baseH = m.h.slice();
  S.h = m.h;
  S.N = m.N;
  S.voxel = m.voxel;
  S.genMs = performance.now() - t0;
  S.erodeStats = null;
  S.lastFlow = null; S.lastFlowMax = 1;
  S.lastErosionMap = null; S.lastDepositMap = null; S.lastPointsMap = null;
  S.lastWater = null; S.waterInfo = null;

  setBusy('computing splat channels…');
  await nextFrame();
  S.channels = baseChannels();
  updateVoxelReadouts();
  rebuildMesh();
  updateErosionStats();
  clearBusy();
}

async function runErosionPipeline() {
  if (!S.h) return;
  if (!P.thermalOn && !P.hydOn) { clearBusy(); return; }
  // always erode from the fresh mountain so runs are reproducible
  S.h = S.baseH.slice();

  setBusy(`thermal: ${P.drops.toLocaleString()} drops…`);
  await nextFrame();
  const t0 = performance.now();
  const res = runErosion({
    h: S.h, N: S.N, voxel: S.voxel, seed: P.erodeSeed,
    thermalOn: P.thermalOn, hydOn: P.hydOn,
    drops: P.drops, dropSize: P.dropSize, erodibility: P.erodibility,
    traversal: P.traversal, cutFraction: P.cutFrac,
    flowPasses: P.flowPasses, flowExp: P.flowExp,
    sedimentOn: P.sedimentOn, seaLevel: P.seaLevel,
  });
  S.erodeMs = performance.now() - t0;
  S.erodeStats = res.stats;
  S.lastFlow = res.flow; S.lastFlowMax = res.flowMax;
  S.lastErosionMap = res.erosionMap; S.lastDepositMap = res.depositMap; S.lastPointsMap = res.pointsMap;
  S.lastWater = res.water || null;
  S.waterInfo = { lakes: res.lakeCount, rivers: res.riverCount };

  setBusy('computing splat channels…');
  await nextFrame();
  S.channels = computeChannels({
    h: S.h, N: S.N, voxel: S.voxel,
    flow: res.flow, flowMax: res.flowMax, pits: res.pits,
    erosionMap: res.erosionMap, depositMap: res.depositMap, pointsMap: res.pointsMap,
  });
  rebuildMesh();
  updateErosionStats();
  clearBusy();
}

async function fullPipeline() {
  if (S.busy) return;
  const t0 = performance.now();
  await generateMountain();
  await runErosionPipeline();
  els.clock.textContent = ((performance.now() - t0) / 1000).toFixed(2) + ' s pipeline';
}

// ---------------------------------------------------------------- wiring
function bindChange(id, fn) {
  const el = C[id].row;
  el.addEventListener('ui:change', (e) => {
    P[id] = e.detail.value;
    fn && fn(e.detail.value);
  });
}

// Rebuild channels without discarding the last erosion's flow/erosion fields.
const liveRebuild = () => {
  if (!S.h) return;
  S.channels = computeChannels({
    h: S.h, N: S.N, voxel: S.voxel,
    flow: S.lastFlow, flowMax: S.lastFlowMax,
    erosionMap: S.lastErosionMap, depositMap: S.lastDepositMap, pointsMap: S.lastPointsMap,
  });
  rebuildMesh();
};

bindChange('seed');
bindChange('N', () => updateVoxelReadouts());
bindChange('frequency');
bindChange('octaves');
bindChange('gain');
bindChange('ridge');
bindChange('peakHeight');
bindChange('peakRadius');
bindChange('peakSharp');
bindChange('warp');
bindChange('tilt');
bindChange('seaLevel', () => { view.setWaterVisible(P.waterOn); if (S.h) rebuildMesh(); });
bindChange('erodeSeed');
bindChange('thermalOn');
bindChange('hydOn');
bindChange('drops');
bindChange('dropSize');
bindChange('erodibility');
bindChange('traversal', () => updateVoxelReadouts());
bindChange('cutFrac', () => updateVoxelReadouts());
bindChange('flowPasses');
bindChange('flowExp');
bindChange('sedimentOn');
bindChange('preview', () => { if (S.h) rebuildMesh(); });
bindChange('snowLine', liveRebuild);
bindChange('waterOn', (v) => view.setWaterVisible(v));
bindChange('wireframe', (v) => view.setWireframe(v));
bindChange('autoOrbit', (v) => view.setAutoOrbit(v));

$('btnGenerate').addEventListener('click', generateMountain);
$('btnErode').addEventListener('click', runErosionPipeline);
$('btnFull').addEventListener('click', fullPipeline);
$('btnCamera').addEventListener('click', () => view.resetCamera());

window.addEventListener('keydown', (e) => {
  if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'g') generateMountain();
  else if (k === 'e') runErosionPipeline();
  else if (k === 'p') fullPipeline();
  else if (k === 'r') view.resetCamera();
  else if (k === 'w') { P.wireframe = !P.wireframe; C.wireframe.set(P.wireframe); view.setWireframe(P.wireframe); }
  else if (k === ' ') { e.preventDefault(); fullPipeline(); }
});

// ---------------------------------------------------------------- boot
(async function boot() {
  const t0 = performance.now();
  setBusy('baking surface textures…');
  await nextFrame();
  const textures = bakeAllTextures(P.seed, (name, p) => {
    els.busy.textContent = `baking textures — ${name} ${(p * 100) | 0}%`;
  });
  view.setTextures(textures);
  console.log(`[Frontier] textures baked in ${(performance.now() - t0).toFixed(0)} ms`);
  await fullPipeline();
})();
