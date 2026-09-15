import {
  generateCanyon, makeSharedNoise, TYPES,
  STRATA_PRESETS, getStrata, resolveStrata, createErosionEngine, mulberry32, makeRiverFn,
} from '../js/terrain.js';

let failures = 0;
const ok = (cond, msg) => {
  console.log((cond ? 'PASS' : 'FAIL') + '  ' + msg);
  if (!cond) failures++;
};

const sn = makeSharedNoise();
ok(sn.fbm3(3.7, -12.2) === sn.fbm3(3.7, -12.2), 'shared noise deterministic');

// strata presets
const presetIds = Object.keys(STRATA_PRESETS);
ok(presetIds.length >= 6, `strata presets >= 6 (got ${presetIds.length})`);
for (const p of presetIds) {
  const s = getStrata('grand', -380, p);
  const asc = s.bounds.length === 13 && s.bounds.every((v, i, a) => i === 0 || v >= a[i - 1]);
  ok(asc && s.cols.length === 12 && s.hard.length === 12, `preset ${p}: 13 bounds + 12 layers`);
}
ok(resolveStrata('grand', null) === 'classic', 'auto strata grand=classic');
ok(resolveStrata('slot', null) === 'antelope', 'auto strata slot=antelope');
ok(resolveStrata('wadi', 'basalt') === 'basalt', 'explicit strata respected');

for (const type of ['grand', 'slot', 'wadi']) {
  console.log(`--- type: ${type} ---`);
  const data = await generateCanyon({ type, seed: 2026, size: 128, erosion: 0.6, onProgress: null });
  const { heights: H, ao, size: N, world, waterY, bedBase, rimY, strata } = data;
  void ao; void rimY; void strata;
  let finite = true;
  for (let k = 0; k < H.length; k++) { if (!Number.isFinite(H[k])) { finite = false; break; } }
  ok(finite, 'all heights finite');

  // lakes
  const cfg = TYPES[type];
  ok(data.lakes.length <= cfg.lakeCount, `lakes <= ${cfg.lakeCount} (got ${data.lakes.length})`);
  for (const lk of data.lakes) {
    ok(Number.isFinite(lk.waterY) && lk.waterY > bedBase, `lake waterY sane (${lk.waterY.toFixed(1)})`);
  }
  if (cfg.lakeCount > 0) ok(data.lakes.length > 0, 'expected lakes placed');

  // flow map
  const fl = data.flow;
  ok(fl && fl.data.length === N * N * 4, `flow texture ${N}x${N} RGBA`);
  let depthInChannel = 0, rows = 0;
  for (let j = 8; j < N - 8; j += 4) {
    let minH = Infinity, minI = 0;
    for (let i = 0; i < N; i++) { const h = H[j * N + i]; if (h < minH) { minH = h; minI = i; } }
    rows++;
    if (fl.data[(j * N + minI) * 4 + 3] > 10) depthInChannel++;
  }
  ok(depthInChannel / rows > 0.85, `flow depth>0 in channel ${(100 * depthInChannel / rows).toFixed(0)}%`);
  // flow direction mostly downstream (+z => G > 127) inside channel
  let downstream = 0, tot = 0;
  for (let j = 8; j < N - 8; j += 4) {
    for (let i = 0; i < N; i++) {
      if (data.distMain[j * N + i] < cfg.bedHalf * 2) {
        tot++;
        if (fl.data[(j * N + i) * 4 + 1] > 127) downstream++;
      }
    }
  }
  ok(tot === 0 || downstream / tot > 0.6, `channel flow downstream ${(100 * downstream / Math.max(tot, 1)).toFixed(0)}%`);

  // river fn
  const rf = makeRiverFn(data);
  ok(Number.isFinite(rf(0)) && Math.abs(rf(0)) < world / 2, `riverFn sane (${rf(0).toFixed(1)})`);

  // live erosion engine
  const eng = createErosionEngine({
    G: data.erosion.G, hardGrid: data.erosion.hardGrid,
    distMain: data.distMain, N, bedHalf: cfg.bedHalf, lakes: data.lakes,
  });
  eng.runDroplets(300, mulberry32(42), 3, true, null);
  let dirtyCount = 0;
  for (let k = 0; k < eng.dirty.length; k++) dirtyCount += eng.dirty[k];
  ok(dirtyCount > 100, `engine marks dirty cells (${dirtyCount})`);
  ok(eng.protection(0, 0) >= 0, 'protection query works');

  console.log(`    stats: min ${data.stats.minH.toFixed(1)} max ${data.stats.maxH.toFixed(1)} ` +
    `lakes ${data.lakes.length} time ${data.stats.genMs}ms`);
}
console.log(failures === 0 ? 'ALL TESTS PASSED' : `${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
