/**
 * Verify the default camera is actually outside the terrain.
 *
 * The orbit camera's pitch sign has to agree between position() and orbit().
 * When it did not, the default view sat 38 m UNDERGROUND: every ray started
 * inside rock, the marcher reported an immediate hit at t~0, and the screen
 * rendered as one flat white surface that looked exactly like a dead renderer.
 * Cheap to assert, so assert it.
 *
 *   node tools/check-camera.mjs
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const R = (p) => readFileSync(join(here, '..', p), 'utf8');

const cam = R('src/render/camera.ts');
const main = R('src/main.ts');
const cfg = R('src/config.ts');

// World dims from the Medium preset.
const med = cfg.match(/Medium:\s*\{[^}]*worldW:\s*([\d.]+),\s*worldH:\s*([\d.]+),\s*worldD:\s*([\d.]+)/);
const [W, H, D] = [ +med[1], +med[2], +med[3] ];

// Default camera construction in main.ts.
const ctor = main.match(/new OrbitCamera\(\s*\[([^\]]+)\],\s*([^,]+),\s*([-\d.]+),\s*([-\d.]+),?\s*\)/s);
if (!ctor) { console.log('  ✗ could not find the OrbitCamera construction in main.ts'); process.exit(1); }

const eval1 = (e) => Function('grid', `"use strict";const g=grid;return (${e.replace(/grid\./g, 'g.')});`)({ worldW: W, worldH: H, worldD: D });
const target = ctor[1].split(',').map((t) => eval1(t.trim()));
const distance = eval1(ctor[2].trim());
const yaw = +ctor[3];
const pitch = +ctor[4];

// Mirror the sign convention actually used in camera.ts.
const posBody = cam.match(/get position\(\)[\s\S]*?return \[([\s\S]*?)\];/)[1];
const ySign = /this\.target\[1\]\s*-\s*this\.distance/.test(posBody) ? -1 : +1;

const cp = Math.cos(pitch);
const pos = [
  target[0] + distance * cp * Math.sin(yaw),
  target[1] + ySign * distance * Math.sin(pitch),
  target[2] + distance * cp * Math.cos(yaw),
];

// Highest ground the initial landform can reach: plateau + uplift + roughness.
const num = (re) => { const m = R('src/params.ts').match(re); return m ? +m[1] : 0; };
const baseHeight = num(/name:\s*'baseHeight'[^}]*value:\s*([\d.]+)/);
const upliftAmp  = num(/name:\s*'upliftAmp'[^}]*value:\s*([\d.]+)/);
const initRough  = num(/name:\s*'initRough'[^}]*value:\s*([\d.]+)/);
const maxGround  = (baseHeight + upliftAmp + initRough) * H;

let fail = 0;
const ok = (c, m, d = '') => { console.log(`  ${c ? '✓' : '✗'} ${m}${d ? `  ${d}` : ''}`); if (!c) fail++; };

console.log('Default camera placement');
console.log(`    world ${W}x${H}x${D}   target [${target.map((v) => v.toFixed(1))}]   dist ${distance.toFixed(1)}`);
console.log(`    yaw ${yaw}  pitch ${pitch}  (position uses ${ySign > 0 ? '+' : '-'}sin(pitch))`);
console.log(`    camera [${pos.map((v) => v.toFixed(1)).join(', ')}]`);
console.log(`    highest possible ground ${maxGround.toFixed(1)} m`);

ok(pos[1] > 0, 'camera is above y = 0', `y = ${pos[1].toFixed(1)}`);
ok(pos[1] > maxGround, 'camera is above the highest possible terrain',
   `y = ${pos[1].toFixed(1)} vs ground ${maxGround.toFixed(1)}`);

// Sign agreement: dragging down must not invert relative to position().
const orbitBody = cam.match(/orbit\(dx: number, dy: number\)[\s\S]*?\n  \}/)[0];
const orbitMinus = /pitch\s*-\s*dy/.test(orbitBody);
ok((ySign > 0) === orbitMinus,
   'orbit() pitch sign agrees with position()',
   `position ${ySign > 0 ? '+' : '-'}sin, orbit ${orbitMinus ? '-' : '+'}dy`);

console.log(fail === 0 ? '\nCamera starts outside the terrain.' : `\n${fail} camera problem(s).`);
process.exit(fail === 0 ? 0 : 1);
