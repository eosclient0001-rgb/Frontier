/**
 * Demo app: material-specific real-time fracture.
 *
 * Click the object to strike it. Severity is the induced strain as a multiple
 * of the material's own failure strain, so the same slider position means
 * "half its strength" or "twelve times its strength" for every material —
 * which is the physically meaningful way to author a hit.
 */

import { FractureSystem } from './core/FractureSystem.ts';
import { MaterialType } from './materials.ts';
import type { PrefabShape } from './sdf/SDF.ts';
import type { Vec3 } from './fracture/CrackNetwork.ts';

interface Preset {
  label: string;
  material: MaterialType;
  shape: PrefabShape;
  size: [number, number, number];
  anchored: boolean;
  blurb: string;
}

const PRESETS: Record<string, Preset> = {
  glass: {
    label: 'Glass', material: MaterialType.GLASS, shape: 'plate',
    size: [0.5, 0.4, 0.024], anchored: true,
    blurb: 'Brittle, optically smooth fracture. Radial cracks from the contact, then concentric rings from the reflected bending wave. Wallner lines on the fracture faces.',
  },
  wood: {
    label: 'Wood', material: MaterialType.WOOD, shape: 'beam',
    size: [0.8, 0.12, 0.05], anchored: false,
    blurb: '~20x weaker across the grain than along it, so it splits instead of shattering. Fracture faces are torn fibre bundles.',
  },
  concrete: {
    label: 'Concrete', material: MaterialType.CONCRETE, shape: 'brick',
    size: [0.34, 0.34, 0.34], anchored: false,
    blurb: 'Heterogeneous: cracks deflect around aggregate, giving tortuous paths and chunky irregular fragments with exposed pebbles.',
  },
  plastic: {
    label: 'Plastic', material: MaterialType.PLASTIC, shape: 'bar',
    size: [0.45, 0.1, 0.1], anchored: false,
    blurb: 'Ductile. Yields before it tears, so it bends, whitens and draws into fibrils rather than fragmenting. Cracks barely branch.',
  },
  rock: {
    label: 'Rock', material: MaterialType.ROCK, shape: 'rock',
    size: [0.34, 0.3, 0.3], anchored: false,
    blurb: 'Conchoidal fracture along bedding. Smooth curved shell facets with sharp steps, and lots of small chips.',
  },
};

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const system = new FractureSystem(canvas, {
  material: PRESETS.glass.material,
  shape: PRESETS.glass.shape,
  size: PRESETS.glass.size,
  detail: 3,
  anchored: true,
  toughnessScale: 0.3,
});

// ---------------------------------------------------------------------------
// UI
// ---------------------------------------------------------------------------

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

let current = 'glass';
let severity = 22;
let energyScale = 1;

/**
 * One-click aggressive settings.
 *
 * A single point strike on a large plate genuinely does not shatter it — the
 * radial crack family has to *span* the body before anything separates, and on
 * a 50 cm pane that needs a harder hit than you would think. This button sets
 * the two knobs that control it (severity, and the dynamic toughness factor)
 * to values that reliably produce a multi-fragment break, so the first thing
 * you see is the full effect rather than a two-piece split.
 */
function applyShatterPreset(): void {
  sevSlider.value = '38';
  setSev();
  toughSlider.value = '0.15';
  toughValue.textContent = '0.15';
  system.setToughnessScale(0.15);
}

const grid = $('materialGrid');
grid.innerHTML = '';
for (const [key, p] of Object.entries(PRESETS)) {
  const b = document.createElement('button');
  b.className = 'material-btn' + (key === current ? ' active' : '');
  b.textContent = p.label;
  b.dataset.key = key;
  b.onclick = () => {
    current = key;
    for (const el of Array.from(grid.children)) el.classList.remove('active');
    b.classList.add('active');
    system.setMaterial(p.material, p.shape, p.size, p.anchored);
    $('blurb').textContent = p.blurb;
    $('materialStat').textContent = p.label.toUpperCase();
  };
  grid.appendChild(b);
}
$('blurb').textContent = PRESETS.glass.blurb;

const sevSlider = $('energySlider') as HTMLInputElement;
const sevValue = $('energyValue');
const setSev = (): void => {
  severity = Number(sevSlider.value);
  sevValue.textContent = `${severity}x`;
};
sevSlider.oninput = setSev;
sevSlider.value = '22';
sevSlider.max = '40';
setSev();

const sizeSlider = $('sizeSlider') as HTMLInputElement;
const sizeValue = $('sizeValue');
sizeSlider.oninput = () => {
  const s = Number(sizeSlider.value);
  sizeValue.textContent = s.toFixed(2);
  const p = PRESETS[current];
  const scale = s / p.size[0];
  p.size = [p.size[0] * scale, p.size[1] * scale, p.size[2] * scale];
  system.setMaterial(p.material, p.shape, p.size, p.anchored);
};

const detailSlider = $('detailSlider') as HTMLInputElement;
const detailValue = $('detailValue');
detailSlider.oninput = () => {
  detailValue.textContent = detailSlider.value;
  system.setDetail(Number(detailSlider.value));
};

const toughSlider = $('toughSlider') as HTMLInputElement;
const toughValue = $('toughValue');
toughSlider.oninput = () => {
  toughValue.textContent = Number(toughSlider.value).toFixed(2);
  system.setToughnessScale(Number(toughSlider.value));
};

$('shatterBtn').onclick = () => {
  applyShatterPreset();
  const p = PRESETS[current];
  const pt: Vec3 = [-p.size[0] * 0.32, p.size[1] * 0.24, p.size[2] * 0.45];
  system.strike(pt, [1, 0.2, -0.4], severity);
  $('phaseStat').textContent = 'SHATTERING';
};

$('resetBtn').onclick = () => {
  system.reset();
  $('phaseStat').textContent = 'READY';
};

let paused = false;
$('fractureBtn').onclick = () => {
  const p = PRESETS[current];
  // strike at a fixed, visually good spot on the object
  const pt: Vec3 = [-p.size[0] * 0.32, p.size[1] * 0.24, p.size[2] * 0.55];
  const dir: Vec3 = [1, 0.2, -0.4];
  system.strike(pt, dir, severity);
  $('phaseStat').textContent = 'FRACTURING';
};

canvas.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  const hit = system.pick(e.clientX, e.clientY);
  if (!hit) return;
  const dir = [0, 0, 1] as Vec3;
  // direction of travel: from the camera into the surface
  system.strike(hit, dir, severity);
  $('phaseStat').textContent = 'FRACTURING';
});

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { paused = !paused; e.preventDefault(); }
  if (e.code === 'KeyR') system.reset();
});

window.addEventListener('resize', () => system.resize());

// ---------------------------------------------------------------------------
// HUD
// ---------------------------------------------------------------------------

system.onPhase = (phase, detail) => {
  $('phaseStat').textContent = phase.toUpperCase() + (detail ? ` · ${detail}` : '');
};

system.onFragments = (r) => {
  $('fragmentStat').textContent = String(r.fragments.length);
  const tris = r.stats.triangles;
  $('triStat').textContent = `${(tris / 1000).toFixed(0)}k`;
  const vol = r.fragments.reduce((a, f) => a + f.volume, 0);
  const total = system.options.size[0] * system.options.size[1] * system.options.size[2];
  $('volStat').textContent = `${((vol / total) * 100).toFixed(1)}%`;
};

let acc = 0;
function hud(): void {
  if (!paused) {
    system.update();
  }
  acc++;
  if (acc % 12 === 0) {
    const s = system.stats();
    $('fpsStat').textContent = s.fps.toFixed(0);
    $('nodeStat').textContent = `${(s.latticeNodes / 1000).toFixed(1)}k`;
    $('bondStat').textContent = `${(s.latticeBonds / 1000).toFixed(0)}k`;
    $('damageStat').textContent = `${(s.damage * 100).toFixed(1)}%`;
    $('frontStat').textContent = `${s.activeFronts}/${s.crackFronts}`;
    $('lenStat').textContent = `${(s.crackLength * 1000).toFixed(0)}mm`;
    $('speedStat').textContent = `${s.maxCrackSpeed.toFixed(0)}m/s`;
    $('msStat').textContent = `${s.solveMs.toFixed(1)}ms`;
    $('subStepStat').textContent = String(s.substeps);
    if (s.state !== 'idle') $('phaseStat').textContent = s.state.toUpperCase();
  }
  requestAnimationFrame(hud);
}

system.resize();
hud();
