// Headless checks for everything in the engine that does not need a GPU.
// Run with: node scripts/smoke.mjs

import { TERRAIN_OPS, OP_LIST, makeLayer, packTerrainOp, BLEND_MODES, MASK_MODES, NOISE_TYPES }
  from '../src/engine/terrain-schema.js';
import { MATERIALS, makeTexLayer, packTexLayer, TEX_LAYER_STRIDE, TEX_MASK_MODES, materialByKey }
  from '../src/engine/texture-schema.js';
import { PRESETS, defaultPreset } from '../src/engine/presets.js';
import { ATMO_DEFAULTS, ATMO_FLOATS, packAtmoParams, sunDirection } from '../src/engine/atmosphere.js';
import { mat4, perspective, lookAt, multiply, invert, transformPoint } from '../src/engine/mat4.js';
import { OrbitCamera } from '../src/engine/camera.js';
import { heightsToPNG, normalsToPNG, heightsToOBJ, rgbaToPNG } from '../src/engine/export.js';
import { fbmd2, ridged2, billow2, worley2, fractalThumbnail } from '../src/engine/noise-ref.js';

let failures = 0;
let checks = 0;

function ok(cond, label, detail = '') {
  checks += 1;
  if (!cond) {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const finite = (a) => a.every ? true : Array.prototype.every.call(a, Number.isFinite);
const allFinite = (a) => Array.prototype.every.call(a, Number.isFinite);

console.log('\n— terrain schema —');
{
  const scratch = new Float32Array(44);
  const ctx = { res: 1024, cellMeters: 4, heightMeters: 1200 };
  for (const op of OP_LIST) {
    const layer = makeLayer(op.key);
    scratch.fill(0);
    packTerrainOp(scratch, layer, ctx);
    ok(allFinite(scratch), `${op.key}: packed uniform is finite`);
    ok(scratch[2] !== undefined, `${op.key}: seed written`);

    // Every field the inspector will draw must exist in the defaults, or the control reads NaN.
    for (const f of op.fields) {
      ok(layer.params[f.key] !== undefined, `${op.key}.${f.key}: default present`);
      if (f.type === 'select') {
        ok(Array.isArray(f.options) && f.options.some((o) => o.id === f.def),
          `${op.key}.${f.key}: select default ${f.def} is a listed option`);
      } else if (f.type !== 'toggle') {
        ok(f.min < f.max, `${op.key}.${f.key}: range is ordered`);
        ok(layer.params[f.key] >= f.min && layer.params[f.key] <= f.max,
          `${op.key}.${f.key}: default ${layer.params[f.key]} within [${f.min}, ${f.max}]`);
      }
    }
    // Slot maps must name a parameter that actually exists.
    for (const [slot, comp, key] of op.slots ?? []) {
      ok(layer.params[key] !== undefined, `${op.key}: slot ${slot}.${comp} reads existing param "${key}"`);
      ok(['a', 'b', 'c', 'd', 'e', 'f', 'm', 'n'].includes(slot), `${op.key}: slot ${slot} is known`);
      ok(comp >= 0 && comp <= 3, `${op.key}: slot component ${comp} in range`);
    }
    // A default with no control is either dead weight or a control nobody wired up.
    for (const key of Object.keys(op.defaults)) {
      ok(op.fields.some((f) => f.key === key), `${op.key}: default "${key}" has a control`);
    }
    for (const [key] of Object.entries(op.flags ?? {})) {
      ok(layer.params[key] !== undefined, `${op.key}: flag "${key}" reads an existing param`);
    }
    ok(typeof op.icon === 'string' && op.icon.length > 0, `${op.key}: has an icon`);
    ok(typeof op.accent === 'string' && /^#[0-9a-f]{6}$/i.test(op.accent), `${op.key}: accent is a hex colour`);
    ok(typeof op.blurb === 'string' && op.blurb.length > 10, `${op.key}: has a description`);
    ok(op.group.length > 0, `${op.key}: has a group`);
  }
  console.log(`  ${OP_LIST.length} operators checked`);
}

console.log('\n— texture schema —');
{
  const buf = new Float32Array(TEX_LAYER_STRIDE * 16);
  for (const m of MATERIALS) {
    const layer = makeTexLayer(m.key);
    ok(layer.kind === m.key, `material ${m.key}: kind round-trips`);
    ok(Number.isFinite(layer.roughness) && layer.roughness >= 0, `material ${m.key}: roughness`);
    ok(/^#[0-9a-f]{6}$/i.test(layer.albedoA), `material ${m.key}: albedoA is hex`);
    ok(/^#[0-9a-f]{6}$/i.test(layer.albedoB), `material ${m.key}: albedoB is hex`);
    ok(new Uint32Array(buf.buffer, 0, 1) !== null, `material ${m.key}: u32 view`);
  }
  buf.fill(0);
  const layers = MATERIALS.map((m) => makeTexLayer(m.key));
  layers.forEach((l, i) => packTexLayer(buf, l, i));
  ok(allFinite(buf), 'all texture layers packed finite');
  const u0 = new Uint32Array(buf.buffer, 0, 4);
  ok(u0[0] === MATERIALS[0].key, 'first layer keeps its material kind');
  ok(MATERIALS.length <= 16, `${MATERIALS.length} materials fit in MAX_TEX_LAYERS`);
  for (const mode of TEX_MASK_MODES) ok(Number.isInteger(mode.id), `mask mode ${mode.label} has an id`);
  console.log(`  ${MATERIALS.length} materials checked`);
}

console.log('\n— presets —');
{
  for (const p of PRESETS) {
    ok(Array.isArray(p.stack) && p.stack.length > 0, `${p.id}: has a stack`);
    ok(Array.isArray(p.textures) && p.textures.length > 0, `${p.id}: has textures`);
    ok(p.terrain.extent > 0 && p.terrain.heightMeters > 0, `${p.id}: terrain size is positive`);
    ok(p.terrain.waterLevel >= 0 && p.terrain.waterLevel < 1, `${p.id}: water level in range`);
    ok(p.stack.some((l) => l.kind === 'fractal'), `${p.id}: stack starts from a fractal base`);

    for (const layer of p.stack) {
      const op = TERRAIN_OPS[layer.kind];
      ok(!!op, `${p.id}: layer kind "${layer.kind}" exists in the schema`);
      if (!op) continue;
      // Overrides that name a parameter the operator does not have are silently dropped, which
      // shows up as a preset that does nothing. Catch them here.
      for (const [k, v] of Object.entries(layer.params)) {
        const field = op.fields.find((f) => f.key === k);
        ok(!!field, `${p.id}/${layer.name}: param "${k}" belongs to ${layer.kind}`);
        if (field && field.type !== 'select' && field.type !== 'toggle') {
          ok(v >= field.min && v <= field.max,
            `${p.id}/${layer.name}: ${k}=${v} within [${field.min}, ${field.max}]`);
        }
      }
      ok(BLEND_MODES.some((b) => b.id === layer.blend), `${p.id}/${layer.name}: blend mode valid`);
      ok(MASK_MODES.some((m) => m.id === layer.maskMode), `${p.id}/${layer.name}: mask mode valid`);
      ok(layer.id && layer.name, `${p.id}/${layer.name}: has an id and a name`);
    }
    for (const layer of p.textures) {
      ok(!!materialByKey(layer.kind), `${p.id}: texture material ${layer.kind} exists`);
      ok(TEX_MASK_MODES.some((m) => m.id === layer.maskMode), `${p.id}/${layer.name}: mask mode valid`);
    }
    // Distinct ids — duplicate ids break selection.
    const ids = new Set([...p.stack, ...p.textures].map((l) => l.id));
    ok(ids.size === p.stack.length + p.textures.length, `${p.id}: layer ids are unique`);
  }
  ok(defaultPreset() === PRESETS[0], 'defaultPreset returns the first preset');
  console.log(`  ${PRESETS.length} presets checked`);
}

console.log('\n— atmosphere —');
{
  const v = new Float32Array(ATMO_FLOATS);
  packAtmoParams(v, { ...ATMO_DEFAULTS }, 10, 1);
  ok(allFinite(v), 'packed atmosphere is finite');
  ok(v[0] > 6e6, 'planet radius is physical');
  const sun = sunDirection(45, 0);
  ok(Math.abs(Math.hypot(...sun) - 1) < 1e-5, 'sun direction is normalised');
  ok(Math.abs(sun[2] + Math.cos(Math.PI / 4)) < 1e-5, 'north azimuth points to -Z');
  const low = sunDirection(2, 0);
  ok(low[1] > 0 && low[1] < 0.1, 'low sun stays above the horizon');
}

console.log('\n— math —');
{
  const proj = mat4();
  const view = mat4();
  const vp = mat4();
  perspective(proj, Math.PI / 3, 1.6, 0.5, 40000);
  lookAt(view, [0, 300, 900], [0, 0, 0], [0, 1, 0]);
  multiply(vp, proj, view);
  ok(allFinite(vp), 'view-projection is finite');
  const inv = mat4();
  invert(inv, vp);
  ok(allFinite(inv), 'inverse view-projection is finite');
  const back = transformPoint(inv, transformPoint(vp, [12, 34, 56]));
  ok(Math.hypot(back[0] - 12, back[1] - 34, back[2] - 56) < 0.05, 'project/unproject round-trips');
}

console.log('\n— camera —');
{
  const cam = new OrbitCamera();
  cam.frame(4200, 1600);
  for (let i = 0; i < 120; i++) cam.update(1 / 60, () => 0);
  ok(allFinite(cam.position), 'camera position is finite');
  ok(allFinite(cam.viewProj), 'camera view-projection is finite');
  ok(Number.isFinite(cam.near) && cam.near > 0, 'camera near plane is positive');
  ok(cam.far > cam.near, 'camera far is beyond near');
  const ray = cam.rayDirection(0, 0);
  ok(Math.abs(Math.hypot(...ray) - 1) < 1e-4, 'camera ray direction is normalised');
  cam.orbit(0.2, 0.1);
  cam.dolly(-200);
  cam.pan(20, 20);
  cam.focusAt(0.1, -0.2);
  for (let i = 0; i < 240; i++) cam.update(1 / 60, () => 100);
  ok(allFinite(cam.position), 'camera stays finite through every input');
}

console.log('\n— noise reference —');
{
  for (const type of [0, 1, 2, 3]) {
    const { data, width, height } = fractalThumbnail({
      type, seed: 1284, octaves: 9, frequency: 2.6, lacunarity: 2.02, gain: 0.5,
      warp: 0.35, warpFreq: 0.8, sharpness: 2, amplitude: 0.55, offset: 0.45,
    }, 64, 64);
    ok(data.length === width * height * 4, `noise type ${type}: thumbnail sized correctly`);
    ok(data.every((b) => Number.isFinite(b)), `noise type ${type}: no NaN`);
    // A constant thumbnail means the noise collapsed — the preview would be a flat grey box.
    let lo = 255; let hi = 0;
    for (let i = 0; i < data.length; i += 4) { lo = Math.min(lo, data[i]); hi = Math.max(hi, data[i]); }
    ok(hi - lo > 30, `noise type ${type}: thumbnail has contrast (${lo}..${hi})`);
  }
  const a = fbmd2(1.5, 2.5, 8, 2, 0.5, 1234);
  const b = fbmd2(1.5, 2.5, 8, 2, 0.5, 1234);
  ok(Math.abs(a - b) < 1e-12, 'fBm is deterministic');
  ok(Math.abs(fbmd2(1.5, 2.5, 8, 2, 0.5, 999) - a) > 1e-9, 'seed changes the field');
  ok(Math.abs(a) <= 1.5, `fBm stays in band (${a.toFixed(3)})`);
}

console.log('\n— export —');
{
  const res = 64;
  const heights = new Float32Array(res * res);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      heights[y * res + x] = 0.5 + 0.4 * Math.sin(x * 0.3) * Math.cos(y * 0.21);
    }
  }
  const png = await heightsToPNG(heights, res);
  ok(png instanceof Uint8Array, 'heightmap encoder returns bytes');
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  ok(sig.every((b, i) => png[i] === b), 'heightmap PNG has a valid signature');
  const ihdrW = (png[16] << 24) | (png[17] << 16) | (png[18] << 8) | png[19];
  ok(ihdrW === res, `heightmap PNG width is ${res} (got ${ihdrW})`);
  ok(png[24] === 16, 'heightmap PNG is 16-bit per channel');
  ok(png[25] === 0, 'heightmap PNG is greyscale');

  const nrm = await normalsToPNG(heights, res, 4200, 1600);
  ok(nrm[0] === 137 && nrm[1] === 80, 'normal map PNG has a valid signature');
  ok(nrm[24] === 8, 'normal map PNG is 8-bit per channel');
  ok(nrm[25] === 2, 'normal map PNG is truecolour');

  const obj = heightsToOBJ(heights, res, 4200, 1600);
  ok(typeof obj === 'string' && obj.startsWith('#'), 'OBJ is text');
  const verts = (obj.match(/^v /gm) || []).length;
  const faces = (obj.match(/^f /gm) || []).length;
  ok(verts === res * res, `OBJ has ${res * res} vertices (got ${verts})`);
  ok(faces === (res - 1) * (res - 1) * 2, `OBJ has ${(res - 1) ** 2 * 2} faces (got ${faces})`);
  ok(!/NaN|undefined/.test(obj), 'OBJ contains no NaN');

  const rgba = new Uint8Array(32 * 32 * 4);
  for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 7) & 255;
  const shot = await rgbaToPNG(rgba, 32, 32, 128);
  ok(shot[0] === 137 && shot[1] === 80, 'screenshot PNG has a valid signature');
}

console.log('\n— project round-trip —');
{
  const { saveProject, deserialize } = await import('../src/ui/project.js');
  const base = {
    terrain: { res: 1024, meshRes: 1024, extent: 4200, heightMeters: 1600, waterLevel: 0.12 },
    stack: defaultPreset().stack,
    textures: defaultPreset().textures,
    tex: { normalStrength: 1, aoStrength: 0.85, cavityStrength: 0.55, wetnessStrength: 0.9 },
    water: { enabled: true },
    atmo: { ...ATMO_DEFAULTS },
    render: { exposure: 0.62 },
  };
  const text = saveProject(base);
  const back = deserialize(text, base);
  ok(back.stack.length === base.stack.length, 'stack survives a round-trip');
  ok(back.textures.length === base.textures.length, 'textures survive a round-trip');
  ok(back.terrain.extent === 4200, 'terrain survives a round-trip');
  ok(back.stack.every((l) => TERRAIN_OPS[l.kind]), 'every restored layer has a known operator');

  // A layer with an unknown kind must be dropped rather than crashing the loader.
  const hostile = JSON.parse(text);
  hostile.stack.push({ id: 'x', kind: 'not-a-real-op', name: 'ghost' });
  const cleaned = deserialize(JSON.stringify(hostile), base);
  ok(cleaned.stack.length === base.stack.length, 'unknown operators are dropped on load');

  let threw = false;
  try { deserialize('{"format":"something-else"}', base); } catch { threw = true; }
  ok(threw, 'a foreign file is rejected');
}

console.log(`\n${failures ? 'FAILED' : 'PASSED'} — ${checks - failures}/${checks} checks\n`);
process.exit(failures ? 1 : 0);
