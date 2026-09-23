import test from 'node:test';
import assert from 'node:assert/strict';
import { sparseLayout, sparseBrickKey, sparseAddress, sparseHash, sparseProbe } from '../src/sparse-sdf-layout.js';
import { terrainDomain } from '../src/domain.js';

test('adaptive spacing is physical, not multiplied by kilometre-world scale', () => {
  const layout = sparseLayout();
  for (const width of [1000, 2000, 4000]) {
    const d = terrainDomain({ worldEnabled: true, preset: 4, terrainWidth: width, terrainLength: width });
    const point = d.min.map(v => v + 101.125);
    assert.deepEqual(sparseBrickKey(point, d.min, layout.cell), [50, 50, 50]);
    assert.equal(layout.cell, 0.25);
    assert.equal(layout.brickSize, 2);
  }
});
test('sparse XYZ pages cover all physical atlas texels exactly once', () => {
  const L = sparseLayout({ capacity: 16 });
  const seen = new Set();
  for (let s = 0; s < L.capacity; s++) for (let z = 0; z < 8; z++) for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const uv = sparseAddress(s, [x,y,z], L);
    assert(uv[0] >= 0 && uv[0] < L.width && uv[1] >= 0 && uv[1] < L.height);
    seen.add(uv.join(','));
  }
  assert.equal(seen.size, L.voxels);
});
test('bounded probing visits distinct slots, including high-coordinate XYZ keys', () => {
  for (const key of [[0,0,0], [12,10,33], [20000,15000,14000]]) {
    assert.equal(sparseHash(key), sparseHash([...key]));
    const seen = new Set(Array.from({ length: 32 }, (_, i) => sparseProbe(key,i,4096)));
    assert.equal(seen.size,32);
    assert([...seen].every(n => n >= 0 && n < 4096));
  }
});
test('sparse memory is bounded and invalid layouts fail explicitly', () => {
  assert(sparseLayout().bytes < 66 * 1024 ** 2);
  for (const capacity of [0, 15, 31, 8192, Infinity]) assert.throws(() => sparseLayout({capacity}));
  for (const cell of [0, 0.001, 2, NaN]) assert.throws(() => sparseLayout({cell}));
});

test('live resolution disclosure reports the real coarse kernel, not the nominal diameter', async () => {
  const { erosionResolution, erosionResolutionText } = await import('../src/erosion-resolution.js');
  const d = terrainDomain({worldEnabled:true,preset:4,terrainWidth:1000,terrainLength:1000});
  const r=erosionResolution({agentDiameter:3,footprint:.45},d);
  assert.equal(r.adaptiveActive,false);
  assert.equal(r.nominalDiameterMm,3);
  assert(Math.abs(r.supportDiameter[0]-15.31875)<1e-9);
  assert.match(erosionResolutionText({agentDiameter:3},d),/weather workflow uses the coarse base grid/);
});
