// Renders every preset through the full post chain (TAA / bloom / auto-exposure /
// tone map), at several quality settings and two viewport sizes, then bakes three
// maps through the export path. All against the mock device.
//
//   node tools/smoke-render.mjs

import { installGlobals, makeDevice, Recorder, ROOT } from './mock-gpu.mjs';

installGlobals();
Object.defineProperty(globalThis, 'navigator', {
  value: { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } },
  configurable: true,
});

const rec = new Recorder();
const device = makeDevice(rec);

const { TerrainEngine } = await import(`file://${ROOT}/src/js/core/terrain.js`);
const { Renderer } = await import(`file://${ROOT}/src/js/core/renderer.js`);
const { createProject, PRESETS } = await import(`file://${ROOT}/src/js/core/state.js`);
const { Camera } = await import(`file://${ROOT}/src/js/core/camera.js`);
const { encodePNG } = await import(`file://${ROOT}/src/js/core/png.js`);

const engine = new TerrainEngine(device);
await engine.init();

const canvas = {
  width: 1280, height: 720, style: {},
  getContext: () => ({
    configure: () => {},
    getCurrentTexture: () => device.createTexture({
      size: [canvas.width, canvas.height, 1], format: 'bgra8unorm',
      usage: GPUTextureUsage.RENDER_ATTACHMENT, label: 'swapchain',
    }),
  }),
};

const renderer = new Renderer(device, canvas, engine);
await renderer.init();
renderer.configureContext();
console.log(`pipelines: ${Object.keys(renderer.terrainPipe).length} terrain, ` +
  `${Object.keys(renderer.postPipes).length} post, ${Object.keys(renderer.skyPipes).length} sky`);

const camera = new Camera();
const variants = [
  { taa: true, bloom: 0.3, exposure: 0, debugMode: 0, waterOn: true },
  { taa: false, bloom: 0, exposure: 1.2, debugMode: 0, waterOn: true },
  { taa: true, bloom: 1.2, exposure: 0, debugMode: 5, waterOn: false },
  { taa: true, bloom: 0.3, exposure: 0, debugMode: 2, waterOn: true },
];

let frames = 0;
for (const key of Object.keys(PRESETS)) {
  const project = createProject(key);
  await engine.build(project, () => {});
  camera.frame(project.globals.worldSize, project.globals.heightScale);
  for (const v of variants) {
    Object.assign(project.globals, v);
    for (let i = 0; i < 3; i++) { camera.update(0); renderer.render(project, camera, frames * 0.016, 0.016); frames++; }
  }
  for (const [w, h] of [[900, 500], [1920, 1080], [640, 360]]) {
    canvas.width = w; canvas.height = h;
    renderer.resize(w, h);
    renderer.render(project, camera, 1, 0.016);
    frames++;
  }
  canvas.width = 1280; canvas.height = 720;
  renderer.resize(1280, 720);
  console.log(`  ${key.padEnd(10)} rendered`);
}

// ── export
const project = createProject('canyon');
await engine.build(project, () => {});
const maps = [];
await renderer.exportMaps(project, ['height', 'normal', 'ao', 'albedo'], 512,
  (name, blob) => maps.push([name, blob.size]));
console.log(`  export: ${maps.map(([n, s]) => `${n}=${s}B`).join(' ')}`);
if (maps.length !== 4) rec.note('export produced the wrong number of maps');
for (const [n, size] of maps) if (size < 500) rec.note(`export "${n}" suspiciously small (${size}B)`);

// ── PNG sanity
const px = new Uint16Array(8 * 8);
for (let i = 0; i < px.length; i++) px[i] = i * 100;
const blob = await encodePNG(8, 8, 1, px, 16);
const bytes = new Uint8Array(await blob.arrayBuffer());
const sig = [...bytes.slice(0, 8)].join(',');
if (sig !== '137,80,78,71,13,10,26,10') rec.note('bad PNG signature');
const ihdr = String.fromCharCode(...bytes.slice(12, 16));
if (ihdr !== 'IHDR') rec.note('PNG is missing its IHDR chunk');
console.log(`  png: ${bytes.length}B, first chunk ${ihdr}`);

console.log(`\nframes: ${frames}`);
console.log(rec.problems.length ? `FAIL — ${rec.problems.length} problem(s)` : 'PASS — render graph is sound');
for (const p of rec.problems) console.log('  !', p);
process.exit(rec.problems.length ? 1 : 0);
