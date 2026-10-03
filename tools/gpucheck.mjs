#!/usr/bin/env node
/**
 * Optional GPU smoke test: loads the demo in a real (headless) Chrome, records
 * console output / WebGPU validation errors and writes a screenshot.
 *
 *   npm i -D puppeteer
 *   npm run dev &
 *   node tools/gpucheck.mjs http://127.0.0.1:8080/ --out shot.png --wait 8000
 *
 * Needs a machine with a working WebGPU stack (a GPU, or Dawn on SwiftShader).
 * It is not part of `npm test` - the shader + structural checks cover CI.
 */
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith('http')) ?? 'http://127.0.0.1:8080/';
const flag = (name, fallback) => {
  const i = args.indexOf('--' + name);
  return i === -1 ? fallback : args[i + 1];
};
const out = flag('out', 'shot.png');
const waitMs = Number(flag('wait', 8000));
const [width, height] = String(flag('size', '1280x720')).split('x').map(Number);

let puppeteer;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  console.error('puppeteer is not installed. Run:  npm i -D puppeteer');
  process.exit(2);
}

const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--enable-unsafe-webgpu',
    '--enable-features=Vulkan',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--window-size=' + width + ',' + height,
  ],
});

const page = await browser.newPage();
await page.setViewport({ width, height, deviceScaleFactor: 1 });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
const gpu = await page.evaluate(async () => {
  if (!navigator.gpu) return { supported: false };
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return { supported: false, reason: 'no adapter' };
  const device = await adapter.requestDevice();
  return {
    supported: true,
    info: adapter.info ?? {},
    maxTextureDimension3D: adapter.limits.maxTextureDimension3D,
    maxStorageTexturesPerShaderStage: adapter.limits.maxStorageTexturesPerShaderStage,
  };
});
logs.push('[gpu] ' + JSON.stringify(gpu));

await new Promise((r) => setTimeout(r, waitMs));

const state = await page.evaluate(() => ({
  fatal: document.getElementById('fatal')?.hidden === false,
  fatalMsg: document.getElementById('fatal-msg')?.textContent ?? '',
  stats: {
    fps: document.getElementById('fps')?.textContent,
    grid: document.getElementById('grid')?.textContent,
    field: document.getElementById('field')?.textContent,
  },
}));
logs.push('[state] ' + JSON.stringify(state));

await page.screenshot({ path: out });
logs.push('[screenshot] ' + out);

await browser.close();

const text = logs.join('\n');
console.log(text);
writeFileSync(out.replace(/\.[a-z]+$/i, '') + '.log.txt', text);

const bad = /\[error\]|pageerror|Validation Error|WGSL|Tint|invalid/i.test(text) || state.fatal;
process.exit(bad ? 1 : 0);
