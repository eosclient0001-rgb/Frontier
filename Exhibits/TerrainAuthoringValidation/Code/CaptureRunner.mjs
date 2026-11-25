// Scratch runner: loads the prototype in headless Chromium (SwiftShader), prints console errors, captures a screenshot.
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
const [, , Url = 'http://127.0.0.1:8080/?example', Shot = '/tmp/shot.png', WaitMs = '6000', Script = ''] = process.argv;
const exe = await chromium.executablePath();
const browser = await puppeteer.launch({ env: { ...process.env, LD_LIBRARY_PATH: process.cwd() + '/al/lib:/tmp' }, executablePath: exe, headless: true,
    args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl'],
    defaultViewport: { width: 1680, height: 960 }, protocolTimeout: 600000 });
const page = await browser.newPage();
const seen = new Set();
page.on('console', m => { const t = m.type(); const s = m.text(); if ((t === 'error' || t === 'warning' || s.startsWith('[T]')) && !seen.has(s)) { seen.add(s); console.log(`[${t}]`, s.slice(0, 3000)); } });
page.on('pageerror', e => console.log('[pageerror]', e.message.slice(0, 3000)));
await page.goto(Url, { waitUntil: 'load' });
await new Promise(r => setTimeout(r, +WaitMs));
if (Script) { const { default: Run } = await import(Script); await Run(page); }
await page.screenshot({ path: Shot });
const fatal = await page.evaluate(() => document.querySelector('.fatal')?.textContent || '');
if (fatal) console.log('[fatal]', fatal);
await browser.close();
