// Headless self-test for the T. rex rig. Measures foot contact, IK validity,
// stance slip (foot sliding), gait-transition continuity and overall dimensions.
//
// Requires puppeteer-core + @sparticuz/chromium (or any Chrome) and the NSS libs.
//   npm i puppeteer-core@23 @sparticuz/chromium@131
//   node -e "..."  # see README of this folder for extracting al2023.tar.br -> /tmp/libs
//   LD_LIBRARY_PATH=/tmp/libs/lib:/tmp node tools/selftest.mjs
//
// Usage from repo root:  node trex/tools/selftest.mjs
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };
const srv = http.createServer((q, r) => {
  const f = path.join(root, decodeURIComponent(q.url.split('?')[0]));
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  r.end(fs.readFileSync(f));
}).listen(8899);

const browser = await puppeteer.launch({
  args: [...chromium.args, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  executablePath: await chromium.executablePath(), headless: true, defaultViewport: { width: 900, height: 600 },
});
const page = await browser.newPage();
const problems = [];
page.on('pageerror', (e) => problems.push('PAGEERROR ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') problems.push('CONSOLE ' + m.text().slice(0, 160)); });
await page.goto('http://localhost:8899/index.html', { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 2000));

const out = await page.evaluate(() => {
  const T = window.__trex, S = T.state, THREE = T.THREE, legs = T.legs;
  S.auto = false; window.__trexPaused = true;
  const LF = 1.321, LT = 1.245;   // femur / tibiotarsus (FMNH PR 2081)
  const res = {};

  // world-space Y of every toe tip + the metatarso-phalangeal joint
  function contacts() {
    const r = [];
    for (const leg of legs) {
      for (const chain of leg.toes) {
        const j = chain[chain.length - 1]; j.updateWorldMatrix(true, false);
        r.push({ y: j.localToWorld(new THREE.Vector3(0.09, 0, 0)).y, stance: leg.stance });
      }
      r.push({ y: leg.foot.getWorldPosition(new THREE.Vector3()).y, stance: leg.stance });
    }
    return r;
  }
  function run(gait, frames, warm) {
    T.setGait(gait);
    T.sim(1 / 60, warm);
    let minStance = 1e9, minAll = 1e9, maxClear = -1e9, pen = 0, worst = 0, reachBad = 0, resid = 0, maxHip = 0, reach = 0;
    for (let i = 0; i < frames; i++) {
      T.sim(1 / 60, 1);
      for (const c of contacts()) {
        if (c.y < minAll) minAll = c.y;
        if (c.y > maxClear) maxClear = c.y;
        if (c.stance && c.y < minStance) minStance = c.y;
        if (c.y < -0.02) { pen++; worst = Math.min(worst, c.y); }
      }
      for (const leg of legs) {
        resid = Math.max(resid, Math.abs(leg.tibia.position.distanceTo(leg.meta.position) - LT));
        if (leg.femur.position.distanceTo(leg.meta.position) > LF + LT - 1e-3) reachBad++;
        reach = Math.max(reach, leg.ankleErr || 0);   // metres the foot fell short of its target
      }
      maxHip = Math.max(maxHip, T.pelvis.position.y);
    }
    return { minStance: +minStance.toFixed(3), minAny: +minAll.toFixed(3), maxToeLift: +maxClear.toFixed(3),
      penetrationFrames: pen, worstPenetration: +worst.toFixed(3), ikLengthError: +resid.toFixed(4),
      unreachableFrames: reachBad, outOfReach_m: +reach.toFixed(3), hipHeight: +maxHip.toFixed(2), speed: +S.v.toFixed(2) };
  }
  res.idle = run('idle', 300, 150);
  res.walk = run('walk', 500, 400);
  res.run = run('run', 500, 500);

  // planted feet must travel backwards at exactly the ground speed
  T.setGait('walk'); T.sim(1 / 60, 400);
  let n = 0, err = 0;
  for (let i = 0; i < 500; i++) {
    const before = legs.map((l) => l.M.x); T.sim(1 / 60, 1);
    legs.forEach((l, k) => { if (l.stance) { err += Math.abs((l.M.x - before[k]) * 60 + S.v); n++; } });
  }
  res.stanceSlip = +(err / Math.max(1, n)).toFixed(4); // m/s of unwanted slide

  // transition: pelvis must never jump, and the rig must settle into a square stance
  T.setGait('run'); T.sim(1 / 60, 500);
  let jump = 0, prev = null; T.setGait('idle');
  for (let i = 0; i < 1200; i++) {
    T.sim(1 / 60, 1);
    const c = T.pelvis.getWorldPosition(new THREE.Vector3());
    if (prev) jump = Math.max(jump, c.distanceTo(prev)); prev = c;
  }
  res.pelvisMaxStepPerFrame = +jump.toFixed(4);
  res.settledToIdle = !S.stepping && S.v < 0.02;
  res.footSymmetry = +Math.abs(legs[0].C.x - legs[1].C.x).toFixed(3);

  T.dino.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(T.dino);
  res.size = { length: +(box.max.x - box.min.x).toFixed(2), height: +(box.max.y - box.min.y).toFixed(2), width: +(box.max.z - box.min.z).toFixed(2) };
  res.lowestPoint = +box.min.y.toFixed(3);
  res.bones = +document.getElementById('i-bones').textContent;
  res.triangles = T.renderer.info.render.triangles;
  return res;
});

console.log(JSON.stringify(out, null, 1));
if (problems.length) console.log('PROBLEMS:\n' + problems.join('\n'));
await browser.close(); srv.close();
