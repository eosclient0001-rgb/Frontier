/**
 * Re-renders the retained Candy City gallery.
 *
 * Prerequisites (not tracked in the repository):
 *   npm i puppeteer-core@23 @sparticuz/chromium@131     # headless Chromium build
 *   python3 -m http.server 8099 --bind 0.0.0.0          # run from Experimental/CandyCity
 *
 * Usage:
 *   node capture.mjs http://127.0.0.1:8099/ ./Images
 *
 * The browser is whatever puppeteer can launch; this repository's retained captures were produced
 * with the bundled @sparticuz/chromium build on SwiftShader (CPU rasterisation), so frame rates are
 * not representative of a real GPU.
 */

import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';
import { mkdirSync } from 'node:fs';

const base = process.argv[2] || 'http://127.0.0.1:8099/';
const outDir = process.argv[3] || './Images';
mkdirSync(outDir, { recursive: true });

const SHOTS = [
  ['CandyCityOverview', 'overview', 0.06],
  ['CandyCityStreet', 'street', 0.06],
  ['CandyCityHomes', 'homes', 0.06],
  ['CandyCityPlazaCake', 'plaza', 0.06],
  ['CandyCityDetail', 'closeup', 0.06],
  ['CandyCityAerial', 'aerial', 0.06],
  ['CandyCityGolden', 'overview', 0.34],
  ['CandyCitySunset', 'homes', 0.52],
  ['CandyCityNight', 'overview', 0.88],
];

const browser = await puppeteer.launch({
  executablePath: await chromium.executablePath(),
  args: [
    ...chromium.args,
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--disable-dev-shm-usage',
  ],
  headless: true,
  defaultViewport: { width: 1600, height: 900, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));

await page.goto(`${base}?ui=1`, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction('window.__candy && window.__candy.stats', { timeout: 240000 });
await new Promise((r) => setTimeout(r, 2500));

for (const [name, view, tod] of SHOTS) {
  await page.evaluate((v, t) => {
    window.__candy.setTimeOfDay(t);
    window.__candy.setView(v, true);
  }, view, tod);
  await new Promise((r) => setTimeout(r, 2200));
  await page.screenshot({ path: `${outDir}/${name}.png` });
  console.log('saved', `${outDir}/${name}.png`);
}

const meta = await page.evaluate(() => {
  const c = window.__candy;
  const gl = c.renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    three: c.THREE.REVISION,
    glVersion: gl.getParameter(gl.VERSION),
    glRenderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unavailable',
    drawCallsLastFrame: c.drawCalls,
    generatorStats: c.stats,
    canvas: [c.renderer.domElement.width, c.renderer.domElement.height],
  };
});

console.log(JSON.stringify(meta, null, 2));
if (problems.length) console.log(problems.slice(0, 20).join('\n'));
await browser.close();
