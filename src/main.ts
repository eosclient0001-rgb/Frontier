import './style.css';
import { createIcons, ArrowUpRight, CircleHelp, Box, Droplets, SlidersHorizontal, ChartNoAxesCombined, BookOpen, Download, ChevronDown, Image, FileJson, Scan, Grid2x2, Maximize, Waves, ScatterChart, Mouse, Pause, Play, RotateCcw, Check, Sparkles, Droplet, Tornado, FlaskConical, X, Atom, Aperture, Activity, MonitorX } from 'lucide';
import '@fontsource/dm-sans/latin-400.css';
import '@fontsource/dm-sans/latin-500.css';
import '@fontsource/dm-sans/latin-600.css';
import '@fontsource/dm-sans/latin-700.css';
import '@fontsource/space-grotesk/latin-400.css';
import '@fontsource/space-grotesk/latin-500.css';
import '@fontsource/space-grotesk/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-400.css';
const icons = { ArrowUpRight, CircleHelp, Box, Droplets, SlidersHorizontal, ChartNoAxesCombined, BookOpen, Download, ChevronDown, Image, FileJson, Scan, Grid2x2, Maximize, Waves, ScatterChart, Mouse, Pause, Play, RotateCcw, Check, Sparkles, Droplet, Tornado, FlaskConical, X, Atom, Aperture, Activity, MonitorX };
import { FluidSolver, materials, type MaterialKey } from './physics';
import { FluidRenderer } from './renderer';

const icon = (name: string, cls = '') => `<i data-lucide="${name}" class="${cls}"></i>`;
const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `
<header class="app-header">
  <a href="#" class="brand" aria-label="Flux home"><span class="brand-mark"><span></span><span></span><span></span></span>flux<span class="brand-dot">®</span></a>
  <span class="header-divider"></span><span class="product-name">FLUID ENGINE <span class="version">v0.3</span></span>
  <nav class="top-nav"><button class="nav-tab active" data-nav="playground">Playground</button><button class="nav-tab" data-nav="benchmarks">Benchmarks ${icon('arrow-up-right')}</button><button class="nav-tab" data-nav="docs">Documentation ${icon('arrow-up-right')}</button></nav>
  <div class="header-right"><span class="engine-badge"><span class="status-dot"></span>WebGL 2</span><button class="icon-button help-btn" title="Help & keyboard shortcuts" aria-label="Help and keyboard shortcuts">${icon('circle-help')}</button><span class="avatar">F</span></div>
</header>
<div class="workspace">
  <aside class="tool-rail" aria-label="Workspace tools">
    <div class="rail-top"><button class="rail-button selected" title="Fluid playground" aria-label="Fluid playground">${icon('box')}</button><button class="rail-button" id="rail-materials" title="Material library" aria-label="Material library">${icon('droplets')}</button><button class="rail-button" id="rail-scene" title="Scene settings" aria-label="Scene settings">${icon('sliders-horizontal')}</button><div class="rail-rule"></div><button class="rail-button" id="rail-bench" title="Performance benchmark" aria-label="Performance benchmark">${icon('chart-no-axes-combined')}</button></div>
    <div class="rail-bottom"><button class="rail-button" id="rail-info" title="About the solver" aria-label="About the solver">${icon('book-open')}</button><span class="rail-label">FLUX LAB</span></div>
  </aside>
  <main class="main-workspace">
    <div class="page-heading"><div><div class="eyebrow"><span></span>THE FLUID PLAYGROUND</div><h1>Matter, in motion<span>.</span></h1><p>Explore surfaces, boundaries, and material response.</p></div><button class="outline-button" id="export-btn">${icon('download')}<span>Export scene</span>${icon('chevron-down')}</button><div class="export-menu hidden" id="export-menu"><button id="download-image">${icon('image')}Save viewport image <span>PNG</span></button><button id="download-scene">${icon('file-json')}Export configuration <span>JSON</span></button></div></div>
    <section class="viewport-card" aria-label="Interactive three dimensional fluid simulation">
      <div id="canvas-container"></div>
      <div class="viewport-top"><div class="scene-name">${icon('box')}<select id="experiment" aria-label="Fluid experiment"><option value="basin">Liquid basin</option><option value="wetting">Wetting drop</option><option value="suspended">Suspended drop</option></select><span class="small-separator">/</span><span class="muted">Scene 01</span></div><span class="live-badge"><span class="status-dot"></span><span id="live-state">LIVE</span></span></div>
      <div class="scene-caption"><span class="mono-label">CPU PBF / ANISOTROPIC SURFACE</span><span id="pressure-caption">CPU density projection · initializing</span></div>
      <div class="viewport-tools"><button class="canvas-button" id="camera-reset" title="Reset camera" aria-label="Reset camera">${icon('scan')}</button><button class="canvas-button active" id="grid-toggle" title="Toggle ground grid" aria-label="Toggle ground grid" aria-pressed="true">${icon('grid-2x2')}</button><button class="canvas-button" id="fullscreen-btn" title="Fullscreen viewport" aria-label="Fullscreen viewport">${icon('maximize')}</button></div>
      <div class="axis-indicator"><svg viewBox="0 0 60 60" aria-label="3D orientation axes"><path d="M29 34 L29 10" stroke="#b7dba4"/><path d="M29 34 L50 45" stroke="#d59987"/><path d="M29 34 L9 45" stroke="#86afcd"/><circle cx="29" cy="34" r="3" fill="#98a598"/><text x="26" y="8" fill="#b7dba4">Y</text><text x="52" y="50" fill="#d59987">X</text><text x="1" y="50" fill="#86afcd">Z</text></svg></div>
      <div class="viewport-bottom"><div class="render-modes" role="group" aria-label="Render mode"><button class="active" data-mode="0">${icon('waves')}Surface</button><button data-mode="1">${icon('scatter-chart')}Particles</button><button data-mode="2">Normals</button></div><div class="camera-hint">${icon('mouse')}Drag to orbit <span>·</span> Scroll to zoom</div></div>
      <div class="loading-panel" id="loading-panel"><div class="loader"></div><strong>Setting matter in motion</strong><span>Initializing the 3D solver…</span></div>
    </section>
    <section class="transport-panel" aria-label="Simulation playback and statistics">
      <div class="playback"><button id="play-pause" class="play-button" title="Pause simulation (Space)" aria-label="Pause simulation">${icon('pause')}</button><button id="reset" class="icon-button" title="Reset simulation (R)" aria-label="Reset simulation">${icon('rotate-ccw')}</button><div class="playback-time"><span id="elapsed">00:00.00</span><span>SIMULATION TIME</span></div></div>
      <div class="performance-graph"><div class="graph-top"><span><span class="status-dot"></span>Frame history</span><span id="frame-ms">— ms</span></div><div class="graph-bars" id="graph-bars">${Array.from({ length: 45 }, () => '<span style="height:3px"></span>').join('')}</div></div>
      <div class="stat"><span><b id="fps">—</b><small>FPS</small></span><span>FRAME RATE</span></div><div class="stat particle-stat"><span><b id="particle-count">1,440</b></span><span>PARTICLES</span></div>
    </section>
    <footer class="main-footer"><span><span class="status-dot"></span>Built for the curious. Powered by physics.</span><span>3D PBF solver <span class="footer-dot">·</span> WebGL 2 surface renderer</span></footer>
  </main>
  <aside class="inspector">
    <div class="inspector-heading"><div>${icon('sliders-horizontal')}<h2>Scene controls</h2></div><button class="icon-button" id="settings-reset" title="Reset scene controls" aria-label="Reset scene controls">${icon('rotate-ccw')}</button></div>
    <div class="inspector-scroll">
      <section class="control-section material-section" id="material-section"><div class="section-label"><h3>Material library</h3><span>04 MATERIALS</span></div><p class="section-description">Same world. Different possibilities.</p>
        <div class="material-grid">${(Object.keys(materials) as MaterialKey[]).map((key) => `<button class="material-card ${key === 'water' ? 'selected' : ''}" data-material="${key}" aria-pressed="${key === 'water'}"><span class="material-art ${key}"><span class="liquid-orb"></span><span class="orb-shadow"></span></span><span class="material-name">${materials[key].name}<span class="material-check">${icon('check')}</span></span></button>`).join('')}</div>
        <div class="material-note">${icon('sparkles')}<span id="material-note">Crystal clear. Naturally dynamic.</span></div>
      </section>
      <section class="control-section"><div class="section-label"><h3>Fluid properties</h3><span class="small-tag">LIVE</span></div>
        <label class="select-row" for="viscosity-model"><span>Viscosity model</span><span class="select-wrap"><select id="viscosity-model" title="Compare the new implicit radial SPH viscosity with the original velocity averaging"><option value="implicit" selected>Implicit SPH</option><option value="xsph">Legacy XSPH</option></select>${icon('chevron-down')}</span></label>
        <div class="slider-control"><label for="viscosity">Base viscosity <span class="value-field" id="viscosity-value">0.018</span></label><input type="range" id="viscosity" min="0" max="100" value="1.8" step="0.1"><div class="range-labels"><span>Free-flowing</span><span>Thick</span></div></div>
        <div class="slider-control"><label for="cohesion">Surface tension <span class="value-field" id="cohesion-value">0.018</span></label><input type="range" id="cohesion" title="Dimensionless surface-tension scale, not N/m" min="0" max="15" value="1.8" step="0.1"></div>
        <div class="slider-control"><label for="wetting">Wall wetting <span class="value-field" id="wetting-value">0.45</span></label><input type="range" id="wetting" min="0" max="2" value="0.45" step="0.05" title="Boundary adhesion strength; this is not a calibrated contact angle"><div class="range-labels"><span>Low adhesion</span><span>Spreading</span></div></div>
        <div class="slider-control"><label for="gravity">Gravity <span class="value-field"><span id="gravity-value">9.81</span><small>m/s²</small></span></label><input type="range" id="gravity" min="0" max="20" value="9.81" step="0.01"></div>
        <div class="slider-control"><label for="vorticity">Vorticity recovery <span class="value-field" id="vorticity-value">0.060</span></label><input type="range" id="vorticity" min="0" max="0.15" value="0.06" step="0.005" title="Restores existing curl lost through numerical damping. Zero disables recovery."></div>
        <div class="research-hint">${icon('atom')}<button id="research-notes">Research-backed upgrades</button><span id="viscosity-iterations" title="Iterations used by the latest implicit viscosity solve">— iters</span></div>
      </section>
      <details class="control-section response-section" id="material-response" open><summary class="section-label"><h3>Material response</h3><span>CPU RHEOLOGY</span></summary>
        <div class="slider-control"><label for="temperature">Fluid temperature <span class="value-field"><span id="temperature-value">20</span><small>°C</small></span></label><input type="range" id="temperature" min="10" max="80" value="20" step="1" title="Prescribed uniform fluid temperature, not heat conduction or melting"></div>
        <div class="slider-control"><label for="shear-thinning">Shear thinning <span class="value-field" id="shear-thinning-value">0.00</span></label><input type="range" id="shear-thinning" min="0" max="1" value="0" step="0.05"><div class="range-labels"><span>Newtonian</span><span>Shear-thinning</span></div></div>
        <div class="solver-readout"><div><span>Mean effective ν</span><b id="effective-viscosity">—</b></div><div><span>Mean shear rate</span><b id="shear-rate">—</b></div><p>Illustrative Carreau + temperature model.<br>Viscosity is in solver units, not Pa·s.</p></div>
      </details>
      <details class="control-section pressure-section" id="boundary-controls" open><summary class="section-label"><h3>Boundaries & pressure</h3><span id="pressure-status">WAITING</span></summary>
        <label class="select-row" for="pressure-quality"><span>Pressure target</span><span class="select-wrap"><select id="pressure-quality"><option value="fast">Fast · 6%</option><option value="balanced" selected>Balanced · 3%</option><option value="precise">Precise · 1%</option></select>${icon('chevron-down')}</span></label>
        <div class="toggle-row"><label for="boundary-support">Boundary density support</label><label class="toggle"><input type="checkbox" id="boundary-support" checked aria-label="Boundary density support"><span></span></label></div>
        <div class="toggle-row"><label for="obstacle-toggle">Sphere obstacle</label><label class="toggle"><input type="checkbox" id="obstacle-toggle" aria-label="Sphere obstacle"><span></span></label></div>
        <div class="toggle-row"><label for="boundary-debug">Show solid samples</label><label class="toggle"><input type="checkbox" id="boundary-debug" aria-label="Show solid samples"><span></span></label></div>
        <div class="solver-readout"><div><span>Mean / peak compression</span><b id="compression-error">— / —</b></div><div><span>Pressure passes</span><b id="pressure-iterations">—</b></div><p id="pressure-detail">Measured after projection. Targets are not guarantees.</p></div>
      </details>
      <section class="control-section emitter-section"><div class="section-label"><h3>Emitter</h3><label class="toggle"><input type="checkbox" id="emitter-toggle" checked aria-label="Enable liquid emitter"><span></span></label></div>
        <div class="slider-control"><label for="flow">Flow rate <span class="value-field"><span id="flow-value">78</span><small>p/s</small></span></label><input type="range" id="flow" min="0.2" max="2" value="0.65" step="0.05"></div>
        <div class="action-row"><button class="primary-button" id="pour-btn">${icon('pause')}<span>Pause flow</span></button><button class="stir-button" id="stir-btn" title="Stir the fluid (S)">${icon('tornado')}Stir</button></div><p class="capacity-note" id="capacity-note">Pour, stir, and see what happens.</p>
      </section>
      <section class="control-section rendering-section"><div class="section-label"><h3>Rendering</h3><span class="renderer-dot"></span></div><label class="select-row" for="reconstruction"><span>Reconstruction</span><span class="select-wrap"><select id="reconstruction" title="Compare ellipsoids with fixed-radius spheres on exactly the same simulation state"><option value="anisotropic" selected>Anisotropic</option><option value="spheres">Spheres</option></select>${icon('chevron-down')}</span></label><label class="select-row" for="quality"><span>Surface quality</span><span class="select-wrap"><select id="quality"><option value="0.6">Performance</option><option value="0.85" selected>High</option><option value="1">Ultra</option></select>${icon('chevron-down')}</span></label><div class="render-feature">Screen-space refraction<span>ON</span></div><div class="render-feature">Fresnel reflections<span>ON</span></div></section>
      <div class="inspector-note">${icon('flask-conical')}<p>An experiment in real-time.<br><span>Browser-native. Beautifully fluid.</span></p><span class="beta-pill">LAB</span></div>
    </div>
  </aside>
</div>
<div id="toast" role="status"></div>
<dialog id="modal"><div class="modal-heading"><span class="eyebrow">FLUX / FLUID LAB</span><button id="close-modal" class="icon-button" aria-label="Close dialog">${icon('x')}</button></div><div id="modal-content"></div></dialog>
`;
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s)!;
function refreshIcons() { createIcons({ icons, attrs: { 'stroke-width': 1.6 } }); }
refreshIcons();
let solver: FluidSolver;
let view: FluidRenderer;
let paused = false, pouring = true, flow = .65, gridVisible = true;
let experiment: 'basin' | 'wetting' | 'suspended' = 'basin';
let materialResponseDirty = false;
let toastTimer: ReturnType<typeof setTimeout>;
function toast(message: string) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3000); }
function updateRange(input: HTMLInputElement) { const percent = (Number(input.value) - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100; input.style.setProperty('--progress', `${percent}%`); }
document.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(input => { updateRange(input); input.addEventListener('input', () => updateRange(input)); });
function updatePour() {
  $('#pour-btn').innerHTML = `${icon(pouring ? 'pause' : 'droplet')}<span>${pouring ? 'Pause flow' : 'Pour liquid'}</span>`;
  $<HTMLInputElement>('#emitter-toggle').checked = pouring;
  view?.setEmitter(pouring || experiment === 'basin');
  $('#capacity-note').textContent = solver.count >= solver.maxParticles ? 'Basin capacity reached. Reset to pour again.' : 'Pour, stir, and see what happens.';
  refreshIcons();
}
function selectMaterial(key: MaterialKey) {
  solver.setMaterial(key); view.setMaterial(key); materialResponseDirty = true;
  document.querySelectorAll<HTMLButtonElement>('[data-material]').forEach(b => { b.classList.toggle('selected', b.dataset.material === key); b.setAttribute('aria-pressed', String(b.dataset.material === key)); });
  $<HTMLInputElement>('#viscosity').value = String(solver.viscosity * 100); $('#viscosity-value').textContent = solver.viscosity.toFixed(3);
  $<HTMLInputElement>('#cohesion').value = String(solver.cohesion * 100); $('#cohesion-value').textContent = solver.cohesion.toFixed(3);
  $<HTMLInputElement>('#vorticity').value = String(solver.vorticity); $('#vorticity-value').textContent = solver.vorticity.toFixed(3);
  syncMaterialResponse();
  updateRange($('#viscosity')); updateRange($('#cohesion')); updateRange($('#vorticity'));
  const notes = { water: 'Crystal clear. Naturally dynamic.', milk: 'Soft scattering. Silky movement.', honey: 'Golden light. A slower kind of flow.', chocolate: 'Rich, glossy, and irresistibly thick.' };
  $('#material-note').textContent = notes[key];
}
function syncMaterialResponse() {
  $<HTMLInputElement>('#temperature').value = String(solver.temperature); $('#temperature-value').textContent = solver.temperature.toFixed(0);
  $<HTMLInputElement>('#shear-thinning').value = String(solver.shearThinning); $('#shear-thinning-value').textContent = solver.shearThinning.toFixed(2);
  $<HTMLInputElement>('#wetting').value = String(solver.wetting); $('#wetting-value').textContent = solver.wetting.toFixed(2);
  updateRange($('#temperature')); updateRange($('#shear-thinning')); updateRange($('#wetting'));
}
function reset() { solver.reset(experiment === 'basin' ? 'basin' : 'droplet'); pouring = experiment === 'basin'; view.setEmitter(experiment === 'basin'); paused = false; updatePause(); updatePour(); toast('A fresh start. Scene reset.'); }
function updateClock() {
  const t = solver.time;
  $('#elapsed').textContent = `${Math.floor(t / 60).toString().padStart(2, '0')}:${Math.floor(t % 60).toString().padStart(2, '0')}.${Math.floor(t * 100 % 100).toString().padStart(2, '0')}`;
}
function updatePause() {
  updateClock();
  $('#play-pause').innerHTML = icon(paused ? 'play' : 'pause'); $('#play-pause').setAttribute('aria-label', paused ? 'Resume simulation' : 'Pause simulation'); $('#play-pause').title = `${paused ? 'Resume' : 'Pause'} simulation (Space)`;
  $('#live-state').textContent = paused ? 'PAUSED' : 'LIVE'; $('.live-badge').classList.toggle('is-paused', paused); refreshIcons();
}
const modal = $<HTMLDialogElement>('#modal');
function openModal(content: string) { $('#modal-content').innerHTML = content; if (!modal.open) modal.showModal(); refreshIcons(); }
$('#close-modal').onclick = () => modal.close();
modal.addEventListener('click', e => { if (e.target === modal) { const r = modal.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) modal.close(); } });
function docs() {
  openModal(`<h2>Surfaces. Solids. Softer chocolate.</h2><p class="modal-lead">The simulation runs on the CPU. These are bounded research-based adaptations, not full paper reproductions or calibrated material measurements.</p><div class="docs-grid"><article>${icon('droplets')}<h3>Surface tension & wetting</h3><p>Akinci-style pairwise cohesion/repulsion and normal-difference forces replace the old linear attraction. Volume-weighted solid samples exert short-range adhesion. Wetting controls adhesion strength, not a guaranteed contact angle.</p><a class="paper-link" href="https://cg.informatik.uni-freiburg.de/publications/2013_SIGGRAPHASIA_surfaceTensionAdhesion.pdf" target="_blank" rel="noopener noreferrer">Akinci et al. · 2013 ↗</a></article><article>${icon('box')}<h3>Boundary-aware pressure</h3><p>Static basin and sphere samples contribute to density, density gradients, adhesion, and implicit viscosity. PBF uses exact density-kernel gradients, refreshed neighborhoods, and an adaptive iteration budget. The displayed mean and peak compression are measured after projection.</p><a class="paper-link" href="https://cg.informatik.uni-freiburg.de/publications/2012_SIGGRAPH_rigidFluidCoupling.pdf" target="_blank" rel="noopener noreferrer">Akinci et al. · 2012 ↗</a></article></div><h3>Temperature- and shear-dependent viscosity</h3><p>A weighted least-squares local velocity gradient estimates the strain rate without treating rigid rotation as shear. A bounded Carreau law lowers apparent viscosity with shear; an Arrhenius-style temperature shift makes warmer material less viscous. Pair coefficients use a symmetric harmonic mean before the implicit solve. Chocolate defaults to strong shear thinning at 40°C; honey defaults to temperature-sensitive Newtonian flow.</p><div class="honesty-note">Temperature is imposed uniformly—there is no heat equation, melting, crystallization, or thermal expansion. The coefficients are illustrative solver units, not measured Pa·s. This Carreau model has no yield stress or thixotropic memory. Chocolate recipes require their own measured rheology.</div><h3>Three experiments</h3><p><b>Liquid basin:</b> normal gravity and continuous pouring; enable the sphere to inspect flow around a solid.<br><b>Wetting drop:</b> reduced gravity of 1 m/s² and tension 0.080 make capillary behavior easier to inspect at this coarse scene scale. Compare wall wetting 0 and 2, resetting between trials.<br><b>Suspended drop:</b> zero gravity with the same tension setting. Watch the initially elongated drop relax. These experiments explicitly change the visible gravity and tension controls.</p><h3>Pressure accuracy is measured, not promised</h3><p>Fast, Balanced, and Precise modes target maximum positive density errors of 6%, 3%, and 1%, with 3, 6, and 12 pressure passes respectively. “Budget limit” means the target was not reached. Free-surface underdensity is not counted as compression. Boundary-density support can be disabled for comparison; geometric collision protection stays on.</p><h3>What remains approximate</h3><p>Capillary acceleration is globally limited for stability. The stationary solids use one-way coupling, not rigid-body dynamics. A sphere SDF and box projection prevent penetration; arbitrary mesh collisions and spill-out over the rim are not modeled. The solver remains PBF, not DFSPH. Surface reconstruction still uses PCA ellipsoid splats and screen-space optics, not a volumetric path tracer.</p><h3>Earlier upgrades</h3><p>Anisotropic / Spheres compares surface reconstruction on the same paused state. Implicit SPH / Legacy XSPH compares viscosity operators; the legacy mode does not have implicit boundary viscosity. Both use the new local apparent-viscosity field. Vorticity recovery remains available.</p><a class="paper-link" href="https://dankoschier.github.io/resources/papers/WKBB18.pdf" target="_blank" rel="noopener noreferrer">Weiler et al. · Implicit viscosity, 2018 ↗</a><h3>Make a little motion</h3><div class="shortcut-list"><span>Pause / resume <kbd>Space</kbd></span><span>Reset current experiment <kbd>R</kbd></span><span>Stir fluid <kbd>S</kbd></span><span>Orbit camera <kbd>Drag</kbd></span><span>Zoom <kbd>Scroll</kbd></span><span>Stir fluid <kbd>Double-click</kbd></span></div>`);
}

let frameHistory: number[] = [], physicsHistory: number[] = [];
let benchmark: { start: number; frames: number[]; physics: number[]; reconstruction: number[] } | null = null;
function benchmarks() {
  openModal(`<h2>Performance, not promises.</h2><p class="modal-lead">Measure this scene on your device. Results depend on browser, viewport, particle count, and hardware.</p><div class="benchmark-result" id="benchmark-result"><div class="benchmark-empty">${icon('activity')}<p>A 5-second live test of the current scene.</p></div></div><button class="primary-button benchmark-start" id="benchmark-start">${icon('play')}Run benchmark</button><p class="fine-print">Measures requestAnimationFrame intervals and CPU solver and surface-reconstruction time. It does not measure GPU execution time or compare against other engines. Keep this tab visible during the test.</p>`);
  $('#benchmark-start').onclick = () => {
    if (paused) { paused = false; updatePause(); }
    benchmark = { start: performance.now(), frames: [], physics: [], reconstruction: [] };
    $<HTMLButtonElement>('#benchmark-start').disabled = true; $('#benchmark-start').textContent = 'Measuring… 5 seconds';
    $('#benchmark-result').innerHTML = '<div class="benchmark-empty"><div class="loader"></div><p>Let the fluid do its thing.</p></div>';
  };
}
document.querySelectorAll<HTMLElement>('[data-nav]').forEach(b => b.onclick = () => { if (b.dataset.nav === 'docs') docs(); else if (b.dataset.nav === 'benchmarks') benchmarks(); else { modal.close(); } });
$('#research-notes').onclick = docs; $('.help-btn').onclick = docs; $('#rail-info').onclick = docs; $('#rail-bench').onclick = benchmarks;
$('#rail-materials').onclick = () => { $('#material-section').scrollIntoView({ behavior: 'smooth' }); $('#material-section').classList.add('highlight'); setTimeout(() => $('#material-section').classList.remove('highlight'), 1200); };
$('#rail-scene').onclick = () => { $('.rendering-section').scrollIntoView({ behavior: 'smooth' }); $('.rendering-section').classList.add('highlight'); setTimeout(() => $('.rendering-section').classList.remove('highlight'), 1200); };
$('.rail-button.selected').onclick = () => { modal.close(); view?.resetCamera(); };
$('#export-btn').onclick = () => $('#export-menu').classList.toggle('hidden');
document.addEventListener('click', e => { if (!(e.target as HTMLElement).closest('#export-btn, #export-menu')) $('#export-menu').classList.add('hidden'); });

try {
  solver = new FluidSolver();
  view = new FluidRenderer($('#canvas-container'), solver);
  $('#loading-panel').classList.add('hidden');
  document.querySelectorAll<HTMLButtonElement>('[data-material]').forEach(b => b.onclick = () => selectMaterial(b.dataset.material as MaterialKey));
  $('#viscosity').addEventListener('input', e => { solver.viscosity = Number((e.target as HTMLInputElement).value) / 100; $('#viscosity-value').textContent = solver.viscosity.toFixed(3); materialResponseDirty = true; });
  $('#cohesion').addEventListener('input', e => { solver.cohesion = Number((e.target as HTMLInputElement).value) / 100; $('#cohesion-value').textContent = solver.cohesion.toFixed(3); });
  $('#gravity').addEventListener('input', e => { solver.gravity = Number((e.target as HTMLInputElement).value); $('#gravity-value').textContent = solver.gravity.toFixed(2); });
  $('#viscosity-model').onchange = () => { solver.implicitViscosity = $<HTMLSelectElement>('#viscosity-model').value === 'implicit'; toast(solver.implicitViscosity ? 'Implicit viscosity enabled. Physics stays on the CPU.' : 'Legacy XSPH velocity averaging enabled.'); };
  $('#reconstruction').onchange = () => { view.anisotropic = $<HTMLSelectElement>('#reconstruction').value === 'anisotropic'; $('.mono-label').textContent = `CPU PBF / ${view.anisotropic ? 'ANISOTROPIC SURFACE' : 'SPHERICAL SURFACE'}`; };
  $('#vorticity').addEventListener('input', e => { solver.vorticity = Number((e.target as HTMLInputElement).value); $('#vorticity-value').textContent = solver.vorticity.toFixed(3); });
  $('#temperature').addEventListener('input', e => { solver.temperature = Number((e.target as HTMLInputElement).value); $('#temperature-value').textContent = solver.temperature.toFixed(0); materialResponseDirty = true; });
  $('#shear-thinning').addEventListener('input', e => { solver.shearThinning = Number((e.target as HTMLInputElement).value); $('#shear-thinning-value').textContent = solver.shearThinning.toFixed(2); materialResponseDirty = true; });
  $('#wetting').addEventListener('input', e => { solver.wetting = Number((e.target as HTMLInputElement).value); $('#wetting-value').textContent = solver.wetting.toFixed(2); });
  $('#pressure-quality').onchange = () => { solver.pressureQuality = $<HTMLSelectElement>('#pressure-quality').value as FluidSolver['pressureQuality']; };
  $('#boundary-support').onchange = () => { solver.boundarySupport = $<HTMLInputElement>('#boundary-support').checked; };
  $('#obstacle-toggle').onchange = () => { solver.setObstacle($<HTMLInputElement>('#obstacle-toggle').checked); if (paused) { paused = false; updatePause(); } toast(solver.obstacle.enabled ? 'Static sphere added: sampled density, adhesion, and viscosity coupling.' : 'Sphere removed.'); };
  $('#boundary-debug').onchange = () => { view.showBoundaries = $<HTMLInputElement>('#boundary-debug').checked; };
  $('#experiment').onchange = () => {
    experiment = $<HTMLSelectElement>('#experiment').value as typeof experiment;
    solver.gravity = experiment === 'basin' ? 9.81 : experiment === 'wetting' ? 1 : 0;
    solver.cohesion = experiment === 'basin' ? materials[solver.material].cohesion : .08;
    solver.setObstacle(false); $<HTMLInputElement>('#obstacle-toggle').checked = false;
    $<HTMLInputElement>('#gravity').value = String(solver.gravity); $('#gravity-value').textContent = solver.gravity.toFixed(2);
    $<HTMLInputElement>('#cohesion').value = String(solver.cohesion*100); $('#cohesion-value').textContent = solver.cohesion.toFixed(3);
    updateRange($('#gravity')); updateRange($('#cohesion')); reset();
    if (experiment !== 'basin') toast(`Capillary experiment: gravity ${solver.gravity.toFixed(1)} m/s², tension 0.080. Both remain adjustable.`);
  };
  $('#flow').addEventListener('input', e => { flow = Number((e.target as HTMLInputElement).value); $('#flow-value').textContent = String(Math.round(flow * 120)); });
  $('#pour-btn').onclick = () => { if (solver.count >= solver.maxParticles) { toast('The basin is full. Reset the scene to pour again.'); return; } pouring = !pouring; updatePour(); };
  $('#emitter-toggle').onchange = () => { pouring = $<HTMLInputElement>('#emitter-toggle').checked && solver.count < solver.maxParticles; updatePour(); };
  $('#stir-btn').onclick = () => { if (paused) { paused = false; updatePause(); } solver.stir(); toast('A little turbulence, coming right up.'); };
  view.renderer.domElement.addEventListener('dblclick', () => { solver.stir(2); if (paused) { paused = false; updatePause(); } });
  $('#play-pause').onclick = () => { paused = !paused; updatePause(); };
  $('#reset').onclick = reset;
  $('#camera-reset').onclick = () => { view.resetCamera(); toast('Camera returned to the studio view.'); };
  $('#grid-toggle').onclick = () => { gridVisible = !gridVisible; view.setGrid(gridVisible); $('#grid-toggle').classList.toggle('active', gridVisible); $('#grid-toggle').setAttribute('aria-pressed', String(gridVisible)); };
  $('#fullscreen-btn').onclick = async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await $('.viewport-card').requestFullscreen(); } catch { toast('Fullscreen is unavailable in this browser.'); } };
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(b => b.onclick = () => { view.debug = Number(b.dataset.mode); document.querySelectorAll('[data-mode]').forEach(v => v.classList.toggle('active', v === b)); });
  $('#quality').onchange = () => { view.setQuality(Number($<HTMLSelectElement>('#quality').value)); toast(`Surface quality: ${$<HTMLSelectElement>('#quality').selectedOptions[0].text}`); };
  $('#settings-reset').onclick = () => {
    experiment = 'basin'; $<HTMLSelectElement>('#experiment').value = 'basin'; solver.setObstacle(false); solver.boundarySupport = true; view.showBoundaries = false; solver.pressureQuality = 'balanced';
    $<HTMLInputElement>('#obstacle-toggle').checked = false; $<HTMLInputElement>('#boundary-support').checked = true; $<HTMLInputElement>('#boundary-debug').checked = false; $<HTMLSelectElement>('#pressure-quality').value = 'balanced';
    selectMaterial('water'); solver.implicitViscosity = true; view.anisotropic = true;
    $<HTMLSelectElement>('#viscosity-model').value = 'implicit'; $<HTMLSelectElement>('#reconstruction').value = 'anisotropic'; $('.mono-label').textContent = 'CPU PBF / ANISOTROPIC SURFACE';
    solver.gravity = 9.81; flow = .65;
    $<HTMLInputElement>('#gravity').value = '9.81'; $('#gravity-value').textContent = '9.81';
    $<HTMLInputElement>('#flow').value = '.65'; $('#flow-value').textContent = '78';
    $<HTMLSelectElement>('#quality').value = '0.85'; view.setQuality(.85);
    document.querySelectorAll<HTMLInputElement>('input[type=range]').forEach(updateRange);
    reset(); view.resetCamera();
  };
  $('#download-image').onclick = () => { view.screenshot(); $('#export-menu').classList.add('hidden'); toast('Viewport saved as a PNG.'); };
  $('#download-scene').onclick = () => {
    const data = { engine: 'Flux', version: '0.3', solver: 'CPU 3D PBF', renderer: 'WebGL2 screen-space fluid', material: solver.material, viscosity: solver.viscosity, surfaceTension: solver.cohesion, wetting: solver.wetting, temperatureCelsius: solver.temperature, shearThinning: solver.shearThinning, experiment, pressureQuality: solver.pressureQuality, boundarySupport: solver.boundarySupport, obstacle: { ...solver.obstacle }, pressureDiagnostics: { ...solver.pressure }, rheologyDiagnostics: { ...solver.rheology }, vorticityRecovery: solver.vorticity, viscosityModel: solver.implicitViscosity ? 'implicit-radial-SPH' : 'XSPH', reconstruction: view.anisotropic ? 'anisotropic-PCA' : 'spherical', gravity: solver.gravity, emissionRate: flow * 120, particleCount: solver.count, capacity: solver.maxParticles, bounds: solver.bounds, camera: { position: view.camera.position.toArray(), target: view.controls.target.toArray() }, note: 'Configuration only, not a simulation snapshot. Coefficients are uncalibrated solver parameters. Temperature is a prescribed uniform bath, not heat transport. Compression diagnostics are dimensionless fractions.' };
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'flux-scene.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    $('#export-menu').classList.add('hidden'); toast('Scene configuration exported.');
  };
  document.addEventListener('keydown', e => {
    if (modal.open || (e.target as HTMLElement).matches('input,select,textarea,button')) return;
    if (e.code === 'Space') { e.preventDefault(); paused = !paused; updatePause(); }
    if (e.key.toLowerCase() === 'r') reset();
    if (e.key.toLowerCase() === 's') { solver.stir(); if (paused) { paused = false; updatePause(); } }
  });
  let last = performance.now(), statsTime = last, accumulator = 0;
  const bars = Array.from(document.querySelectorAll<HTMLElement>('#graph-bars span'));
  function animate(now: number) {
    requestAnimationFrame(animate);
    if (document.hidden) { last = now; accumulator = 0; return; }
    const realDt = now - last; last = now;
    if (realDt <= 0) return;
    const physicsStart = performance.now();
    if (!paused) {
      accumulator = Math.min(accumulator + realDt / 1000, .034);
      while (accumulator >= 1 / 60) {
        if (pouring) solver.pour(1 / 60, flow);
        solver.step(1 / 60); accumulator -= 1 / 60;
      }
      if (solver.count >= solver.maxParticles && pouring) { pouring = false; updatePour(); }
    } else {
      accumulator = 0;
      if (materialResponseDirty) solver.updateRheology();
    }
    materialResponseDirty = false;
    const physicsMs = performance.now() - physicsStart;
    view.render();
    frameHistory.push(realDt); physicsHistory.push(physicsMs); if (frameHistory.length > 90) { frameHistory.shift(); physicsHistory.shift(); }
    if (benchmark) {
      benchmark.frames.push(realDt); benchmark.physics.push(physicsMs); benchmark.reconstruction.push(view.reconstructionMs);
      if (now - benchmark.start >= 5000) {
        const avg = benchmark.frames.reduce((a, b) => a + b, 0) / benchmark.frames.length;
        const cpu = benchmark.physics.reduce((a, b) => a + b, 0) / benchmark.physics.length;
        const surface = benchmark.reconstruction.reduce((a, b) => a + b, 0) / benchmark.reconstruction.length;
        const sorted = [...benchmark.frames].sort((a, b) => a - b); const p95 = sorted[Math.floor(sorted.length * .95)];
        if ($('#benchmark-result')) {
          $('#benchmark-result').innerHTML = `<div class="bench-stats"><div><b>${(1000 / avg).toFixed(1)}</b><span>AVERAGE FPS</span></div><div><b>${cpu.toFixed(1)}<small>ms</small></b><span>CPU SOLVER</span></div><div><b>${p95.toFixed(1)}<small>ms</small></b><span>P95 FRAME</span></div><div><b>${surface.toFixed(1)}<small>ms</small></b><span>CPU SURFACE</span></div></div><p class="fine-print">${benchmark.frames.length} frames · ${solver.count.toLocaleString()} particles · ${view.renderer.domElement.width} × ${view.renderer.domElement.height} output · ${materials[solver.material].name} · ${view.anisotropic ? 'Anisotropic' : 'Spheres'} · ${solver.implicitViscosity ? 'Implicit SPH' : 'XSPH'}</p>`;
          $<HTMLButtonElement>('#benchmark-start').disabled = false; $('#benchmark-start').textContent = 'Run again';
        }
        benchmark = null;
      }
    }
    if (now - statsTime > 350) {
      const avg = frameHistory.reduce((a, b) => a + b, 0) / frameHistory.length;
      $('#fps').textContent = String(Math.round(1000 / avg)); $('#frame-ms').textContent = `${avg.toFixed(1)} ms`;
      $('#particle-count').textContent = solver.count.toLocaleString();
      $('#viscosity-iterations').textContent = solver.implicitViscosity ? `${solver.viscositySolver.iterations} iters` : 'XSPH';
      $('#viscosity-iterations').title = solver.implicitViscosity ? `Latest implicit solve: ${solver.viscositySolver.iterations} iterations; relative residual ${solver.viscositySolver.relativeResidual.toExponential(1)}` : 'Legacy explicit velocity averaging';
      const pressure = solver.pressure;
      $('#pressure-caption').textContent = `Compression ${(pressure.mean*100).toFixed(1)}% mean / ${(pressure.peak*100).toFixed(1)}% peak · ${pressure.iterations} passes`;
      $('#compression-error').textContent = `${(pressure.mean*100).toFixed(2)}% / ${(pressure.peak*100).toFixed(2)}%`;
      $('#pressure-iterations').textContent = String(pressure.iterations);
      $('#pressure-status').textContent = paused ? 'PAUSED' : !pressure.iterations ? 'WAITING' : pressure.converged ? 'TARGET MET' : 'BUDGET LIMIT';
      $('#pressure-status').classList.toggle('budget-limit', !paused && !!pressure.iterations && !pressure.converged);
      $('#pressure-detail').textContent = pressure.overflow ? `Neighbor capacity exceeded (${pressure.overflow} entries). Estimate may undercount density.` : `Measured after projection. ${solver.boundaries.count.toLocaleString()} static solid samples.`;
      $('#effective-viscosity').textContent = solver.rheology.meanViscosity.toFixed(4);
      $('#effective-viscosity').title = `Local range: ${solver.rheology.minViscosity.toFixed(4)}–${solver.rheology.maxViscosity.toFixed(4)} solver units`;
      $('#shear-rate').textContent = `${solver.rheology.meanShear.toFixed(1)} s⁻¹`;
      updateClock();
      bars.forEach((bar, i) => { const value = frameHistory[Math.max(0, frameHistory.length - bars.length + i)] || 0; bar.style.height = `${Math.max(3, Math.min(24, value / 2))}px`; });
      statsTime = now;
    }
  }
  requestAnimationFrame(animate);
} catch (error) {
  console.error(error);
  $('#loading-panel').innerHTML = `${icon('monitor-x')}<strong>This browser needs a little more GPU.</strong><p>${error instanceof Error ? error.message : 'WebGL 2 could not be initialized.'}</p><span>Enable hardware acceleration, then reload the page.</span>`;
  $('#live-state').textContent = 'UNAVAILABLE';
  document.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLSelectElement>('.inspector button,.inspector input,.inspector select,.transport-panel button,.viewport-tools button,.render-modes button,#export-btn').forEach(el => el.disabled = true);
  refreshIcons();
}
