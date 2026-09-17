import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/* ═══════════════ parameter schema ═══════════════ */
// key, label, min, max, step, kind(int/float/select), options?
const SCHEMA = {
  mountain: [
    ['seed', 'Seed', 0, 99999, 1, 'int'],
    ['res', 'Grid resolution', 0, 0, 0, 'select', [256, 384, 512, 768, 1024]],
    ['peak_height', 'Massif scale (m)', 5, 45, 0.5],
    ['mountain_radius', 'Massif radius (m)', 15, 49, 0.5],
    ['peak_sharpness', 'Peak sharpness', 0.8, 2.6, 0.05],
    ['base_height', 'Plains datum (m)', 0, 8, 0.1],
    ['octaves', 'Ridged octaves (req.)', 3, 10, 1, 'int'],
    ['lacunarity', 'Lacunarity', 1.8, 2.6, 0.01],
    ['gain', 'Ridge persistence', 0.3, 0.8, 0.01],
    ['ridge_offset', 'Ridge offset', 0.7, 1.1, 0.01],
    ['base_freq', 'Base frequency', 1.5, 6, 0.1],
    ['ridge_weight', 'Ridge modulation', 0.2, 1, 0.01],
    ['warp_strength', 'Domain warp', 0, 1, 0.01],
    ['warp_octaves', 'Warp octaves', 1, 5, 1, 'int'],
    ['crevice', 'Crevice deepening', 0, 0.8, 0.01],
    ['valley_carve', 'Flank valleys', 0, 0.6, 0.01],
    ['hills_amp', 'Plains hills (m)', 0, 3, 0.05],
    ['peak_offset_x', 'Peak offset X (m)', -15, 15, 0.5],
    ['peak_offset_z', 'Peak offset Z (m)', -15, 15, 0.5],
  ],
  erosion: [
    ['seed', 'Seed', 0, 99999, 1, 'int'],
    ['num_particles', 'Droplets', 20000, 1200000, 10000, 'int'],
    ['max_lifetime', 'Droplet lifetime', 10, 100, 1, 'int'],
    ['brush_radius_world', 'Brush radius (m)', 0.1, 2.0, 0.05],
    ['cfl_voxels', 'CFL limit (voxels)', 0.1, 1.5, 0.05],
    ['erode_speed', 'Erode speed', 0.05, 0.9, 0.01],
    ['deposit_speed', 'Deposit speed', 0.05, 0.9, 0.01],
    ['capacity_factor', 'Capacity factor', 1, 10, 0.1],
    ['min_slope', 'Min slope (m/m)', 0, 0.1, 0.002],
    ['inertia', 'Inertia', 0, 0.5, 0.01],
    ['gravity', 'Gravity', 1, 12, 0.1],
    ['evaporation', 'Evaporation', 0.001, 0.05, 0.001],
    ['thermal_iterations', 'Talus passes', 0, 40, 1, 'int'],
    ['talus_angle_deg', 'Talus angle (°)', 25, 45, 0.5],
    ['talus_rate', 'Talus rate', 0.1, 1, 0.01],
    ['sdf_relax_passes', 'SDF relax passes', 0, 5, 1, 'int'],
    ['sdf_relax_strength', 'Relax strength', 0, 1, 0.01],
  ],
  satmaps: [
    ['ao_distance_m', 'AO distance (m)', 2, 15, 0.5],
    ['ao_directions', 'AO directions', 4, 16, 1, 'int'],
    ['peak_window_m', 'Peak window (m)', 1, 8, 0.25],
    ['peak_blur_m', 'Peak blur (m)', 0, 4, 0.1],
    ['flow_gamma', 'Flow gamma', 0.3, 1, 0.01],
    ['wetness_flat_boost', 'Wetness flat boost', 0.5, 3, 0.05],
  ],
  texture: [
    ['palette', 'Palette', 0, 0, 0, 'select', ['alpine', 'desert', 'volcanic', 'arctic']],
    ['seed', 'Seed', 0, 99999, 1, 'int'],
    ['snowline', 'Snowline', 0.2, 0.9, 0.01],
    ['snow_slope_limit', 'Snow slope limit', 0.2, 0.9, 0.01],
    ['snow_amount', 'Snow amount', 0, 1.5, 0.01],
    ['grassline', 'Grassline', 0.15, 0.8, 0.01],
    ['wet_darkening', 'Wet darkening', 0, 0.8, 0.01],
    ['ao_strength', 'AO strength', 0, 1, 0.01],
    ['strata_strength', 'Strata banding', 0, 0.8, 0.01],
    ['variation', 'Albedo variation', 0, 0.4, 0.01],
  ],
};

const VIEW_MODES = [
  ['textured', 'Textured'], ['shaded', 'Shaded'], ['height', 'Height'],
  ['slope', 'Slope'], ['flow', 'Flow'], ['sediment', 'Sediment'],
  ['wear', 'Wear'], ['deposition', 'Deposition'], ['pointiness', 'Pointiness'],
  ['peak', 'Peak'], ['wetness', 'Wetness'], ['ao', 'AO'], ['normals', 'Normals'],
];
const MODE_TO_PREVIEW = {
  textured: 'albedo', shaded: 'shaded', height: 'height', slope: 'slope',
  flow: 'flow', sediment: 'sediment', wear: 'wear', deposition: 'deposition',
  pointiness: 'pointiness', peak: 'peak', wetness: 'wetness', ao: 'ao',
  normals: 'normals',
};
const GALLERY = ['height', 'slope', 'flow', 'sediment', 'wear', 'deposition',
  'pointiness', 'concavity', 'peak', 'wetness', 'ao', 'normals'];

const S = {
  params: null, presets: [],
  viewMode: 'textured', wireframe: false, shadows: true,
  jobTimer: null, cacheBust: Date.now(),
};

/* ═══════════════ three.js viewport ═══════════════ */
let renderer, scene, camera, controls, terrainMesh, terrainMat, sunLight;

function initViewport() {
  const el = document.getElementById('viewport');
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(el.clientWidth, el.clientHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  el.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0b0e13, 170, 420);
  camera = new THREE.PerspectiveCamera(45, el.clientWidth / el.clientHeight, 0.5, 2000);
  camera.position.set(72, 58, 72);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 9, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 15;
  controls.maxDistance = 320;
  controls.autoRotateSpeed = 0.7;

  const hemi = new THREE.HemisphereLight(0xbdd3f5, 0x2a2620, 0.85);
  scene.add(hemi);
  sunLight = new THREE.DirectionalLight(0xfff1dd, 2.0);
  sunLight.position.set(-60, 90, 30);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.left = -70; sunLight.shadow.camera.right = 70;
  sunLight.shadow.camera.top = 70; sunLight.shadow.camera.bottom = -70;
  sunLight.shadow.camera.far = 300;
  sunLight.shadow.bias = -0.0004;
  scene.add(sunLight);

  const grid = new THREE.GridHelper(100, 20, 0x2a3a4d, 0x1a2330);
  grid.position.y = -0.15;
  scene.add(grid);

  // soft ground disc to catch shadows beyond the tile
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(160, 48),
    new THREE.ShadowMaterial({ opacity: 0.35 })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = -0.2;
  disc.receiveShadow = true;
  scene.add(disc);

  window.addEventListener('resize', () => {
    const w = el.clientWidth, h = el.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });

  (function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  })();
}

function b64ToFloat32(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

async function refreshMesh() {
  const r = await fetch('/api/mesh?res=320');
  const j = await r.json();
  const h = b64ToFloat32(j.data_b64);
  const res = j.res, ext = j.extent;

  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(res * res * 3);
  const uv = new Float32Array(res * res * 2);
  for (let i = 0; i < res; i++) {
    for (let k = 0; k < res; k++) {
      const v = i * res + k;
      pos[v * 3] = (k / (res - 1) - 0.5) * ext;
      pos[v * 3 + 1] = h[v];
      pos[v * 3 + 2] = (i / (res - 1) - 0.5) * ext;
      uv[v * 2] = k / (res - 1);
      uv[v * 2 + 1] = 1 - i / (res - 1);
    }
  }
  const idx = [];
  for (let i = 0; i < res - 1; i++) {
    for (let k = 0; k < res - 1; k++) {
      const a = i * res + k, b = a + 1, c = a + res, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();

  if (!terrainMat) {
    terrainMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.96, metalness: 0.0,
    });
  }
  if (terrainMesh) {
    terrainMesh.geometry.dispose();
    terrainMesh.geometry = geo;
  } else {
    terrainMesh = new THREE.Mesh(geo, terrainMat);
    terrainMesh.castShadow = true;
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);
  }
  applyHeightScale();
  await applyViewMode();
}

async function applyViewMode() {
  if (!terrainMat) return;
  const prev = MODE_TO_PREVIEW[S.viewMode];
  const url = `/api/preview/${prev}?size=1024&v=${S.cacheBust}`;
  const tex = await new THREE.TextureLoader().loadAsync(url);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  if (terrainMat.map) terrainMat.map.dispose();
  terrainMat.map = tex;
  terrainMat.wireframe = S.wireframe;
  terrainMat.needsUpdate = true;
  document.querySelectorAll('#view-modes button').forEach(b =>
    b.classList.toggle('on', b.dataset.mode === S.viewMode));
  document.querySelectorAll('.sat-card').forEach(c =>
    c.classList.toggle('on', c.dataset.name === S.viewMode ||
      (S.viewMode === 'textured' && c.dataset.name === 'albedo')));
}

function applyHeightScale() {
  const v = parseFloat(document.getElementById('opt-hscale').value);
  if (terrainMesh) terrainMesh.scale.y = v;
}

/* ═══════════════ parameter panel ═══════════════ */
function fmtVal(kind, v) {
  if (kind === 'int' || Number.isInteger(v)) return Number(v).toLocaleString('en-US');
  return Number(v).toFixed(Math.abs(v) < 1 ? 3 : 2);
}

function buildPanel() {
  for (const [section, fields] of Object.entries(SCHEMA)) {
    const host = document.getElementById('sec-' + section);
    host.innerHTML = '';
    for (const [key, label, lo, hi, step, kind, opts] of fields) {
      const val = S.params[section][key];
      const div = document.createElement('div');
      div.className = 'ctl';
      if (kind === 'select') {
        div.innerHTML = `<label><span>${label}</span></label>`;
        const sel = document.createElement('select');
        sel.dataset.section = section; sel.dataset.key = key;
        for (const o of opts) {
          const op = document.createElement('option');
          op.value = o; op.textContent = o;
          if (String(o) === String(val)) op.selected = true;
          sel.appendChild(op);
        }
        sel.addEventListener('change', () => {
          S.params[section][key] = isNaN(Number(sel.value)) ? sel.value : Number(sel.value);
        });
        div.appendChild(sel);
      } else {
        div.innerHTML = `<label><span>${label}</span><b data-val></b></label>`;
        const inp = document.createElement('input');
        inp.type = 'range'; inp.min = lo; inp.max = hi; inp.step = step; inp.value = val;
        inp.dataset.section = section; inp.dataset.key = key;
        const b = div.querySelector('[data-val]');
        b.textContent = fmtVal(kind, val);
        inp.addEventListener('input', () => {
          const v = kind === 'int' ? parseInt(inp.value) : parseFloat(inp.value);
          S.params[section][key] = v;
          b.textContent = fmtVal(kind, v);
        });
        // double-click a slider label to type an exact value
        b.style.cursor = 'text';
        b.title = 'Double-click to type an exact value';
        b.addEventListener('dblclick', () => {
          const cur = S.params[section][key];
          const nv = prompt(`${label} [${lo} … ${hi}]`, cur);
          if (nv === null) return;
          const v = kind === 'int' ? parseInt(nv) : parseFloat(nv);
          if (isFinite(v)) {
            S.params[section][key] = v;
            inp.value = v; b.textContent = fmtVal(kind, v);
          }
        });
        div.appendChild(inp);
      }
      host.appendChild(div);
    }
  }
}

/* ═══════════════ pipeline + jobs ═══════════════ */
function log(msg) {
  const line = document.getElementById('log-line');
  const full = document.getElementById('log-full');
  const stamp = new Date().toTimeString().slice(0, 8);
  line.textContent = msg;
  full.textContent += `[${stamp}] ${msg}\n`;
  full.scrollTop = full.scrollHeight;
}

async function runPipeline(skipErosion) {
  const btn = document.getElementById('btn-pipeline');
  btn.disabled = true;
  document.getElementById('progress-overlay').classList.remove('hidden');
  setProgress(0, skipErosion ? 'raw peak: synthesizing…' : 'starting…');
  log(skipErosion ? 'raw peak requested (erosion skipped).' : 'full pipeline requested.');
  try {
    const body = {
      mountain: S.params.mountain, erosion: S.params.erosion,
      texture: S.params.texture, satmaps: S.params.satmaps,
      skip_erosion: !!skipErosion,
    };
    const r = await fetch('/api/pipeline', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('server: ' + (await r.text()).slice(0, 200));
    const { job_id } = await r.json();
    await pollJob(job_id);
  } catch (e) {
    log('ERROR: ' + e.message);
    setProgress(1, 'error');
  } finally {
    btn.disabled = false;
    setTimeout(() => document.getElementById('progress-overlay').classList.add('hidden'), 500);
  }
}

function setProgress(f, stage) {
  document.getElementById('progress-fill').style.width = (f * 100).toFixed(1) + '%';
  document.getElementById('progress-pct').textContent = (f * 100).toFixed(0) + '%';
  document.getElementById('progress-stage').textContent = stage || '';
}

async function pollJob(jid) {
  let lastLog = 0;
  for (;;) {
    await new Promise(r => setTimeout(r, 400));
    const r = await fetch('/api/jobs/' + jid);
    const job = await r.json();
    setProgress(job.progress, job.stage);
    for (const line of job.log.slice(lastLog)) {
      lastLog++;
      if (!/droplets \d/.test(line) || lastLog % 4 === 0) log('[job] ' + line);
    }
    if (job.status === 'done') {
      log(`done in ${(job.elapsed_s || 0).toFixed(1)}s.`);
      S.cacheBust = Date.now();
      await refreshAll(job.result_summary);
      return;
    }
    if (job.status === 'error') {
      log('ERROR: ' + (job.error || 'unknown').split('\n')[0]);
      return;
    }
  }
}

async function refreshAll(summary) {
  summary = summary || (await (await fetch('/api/state')).json()).summary;
  if (!summary) return;
  document.getElementById('empty-state').style.display = 'none';
  renderVoxel(summary);
  renderStats(summary);
  buildGallery();
  try {
    await refreshMesh();
  } catch (e) {
    log('mesh refresh failed: ' + e.message);
  }
}

/* ═══════════════ right panel ═══════════════ */
function kv(k, v, cls) {
  return `<div class="kv"><span>${k}</span><b class="${cls || ''}">${v}</b></div>`;
}

function renderVoxel(s) {
  const pre = s.voxel_precheck, post = s.voxel_postcheck;
  const el = document.getElementById('voxel-body');
  const badge = document.getElementById('voxel-badge');
  const rep = post || pre;
  badge.className = 'voxel-badge ' + rep.status;
  document.getElementById('voxel-badge-text').textContent =
    rep.status === 'ok' ? 'voxels matched' : rep.status === 'warn' ? 'check cuts' : 'mismatch';
  let html = `<div style="margin-bottom:8px"><span class="status-pill ${rep.status}">${rep.status.toUpperCase()}</span></div>`;
  html += kv('voxel XZ', rep.voxel_xz_m.toFixed(4) + ' m');
  html += kv('voxel Y', rep.voxel_y_m.toFixed(4) + ' m');
  html += kv('detail limit (2 vox)', rep.nyquist_m.toFixed(3) + ' m');
  html += kv('brush radius', `${rep.brush_radius_m.toFixed(2)} m = ${rep.brush_radius_voxels.toFixed(2)} vox`,
    rep.brush_radius_voxels < 1.5 ? 'bad' : rep.brush_radius_voxels < 2 ? 'warn' : 'ok');
  html += kv('CFL step cap', `${rep.max_step_cut_m.toFixed(3)} m (${rep.cfl_voxels} vox)`);
  if (post && post.measured_max_cut_m != null) {
    html += kv('deepest cut', `${post.measured_max_cut_m.toFixed(2)} m = ${post.measured_max_cut_voxels.toFixed(1)} vox`,
      post.measured_max_cut_voxels < 1 ? 'bad' : 'ok');
    html += kv('mean cut', `${post.measured_mean_cut_m.toFixed(3)} m`);
    html += kv('sub-voxel waste', post.subvoxel_waste_pct.toFixed(0) + ' %',
      post.subvoxel_waste_pct > 60 ? 'warn' : 'ok');
    html += kv('CFL clamp rate', post.clamp_rate_pct.toFixed(0) + ' %',
      post.clamp_rate_pct > 25 ? 'warn' : 'ok');
  }
  const m = s.mountain_stats;
  html += kv('octaves used', `${m.effective_octaves} / ${m.requested_octaves}${m.octaves_clamped ? ' (Nyquist-clamped)' : ''}`,
    m.octaves_clamped ? 'warn' : 'ok');
  html += kv('finest wavelength', m.finest_wavelength_m.toFixed(3) + ' m');
  for (const issue of rep.issues || []) {
    html += `<div class="issue ${rep.status === 'bad' ? 'bad' : ''}">${issue}</div>`;
  }
  el.innerHTML = html;
}

function renderStats(s) {
  const el = document.getElementById('stats-body');
  let html = '';
  const m = s.mountain_stats;
  html += kv('tile', `${m.extent_m} × ${m.extent_m} m @ ${m.res}²`);
  html += kv('voxel', m.voxel_m.toFixed(4) + ' m');
  html += kv('peak height', m.peak_height_m.toFixed(2) + ' m');
  html += kv('mean height', m.mean_height_m.toFixed(2) + ' m');
  if (s.erosion_stats) {
    const e = s.erosion_stats;
    html += kv('droplets', e.num_particles.toLocaleString('en-US'));
    html += kv('eroded', e.eroded_volume_m3.toFixed(0) + ' m³');
    html += kv('deposited', e.deposited_volume_m3.toFixed(0) + ' m³');
    html += kv('talus moved', e.thermal_volume_m3.toFixed(0) + ' m³');
    html += kv('peak after', e.peak_after_m.toFixed(2) + ' m');
    html += kv('erosion time', e.runtime_s.toFixed(1) + ' s' + (e.numba ? ' (numba)' : ''));
  } else {
    html += `<p class="muted">erosion skipped (raw multifractal peak).</p>`;
  }
  el.innerHTML = html;
}

function buildGallery() {
  const grid = document.getElementById('satmap-grid');
  grid.innerHTML = '';
  for (const name of GALLERY) {
    const d = document.createElement('div');
    d.className = 'sat-card';
    d.dataset.name = name;
    d.innerHTML = `<img loading="lazy" src="/api/preview/${name}?size=192&v=${S.cacheBust}" alt="${name}" /><span>${name}</span>`;
    d.addEventListener('click', () => {
      if (MODE_TO_PREVIEW[name] !== undefined || name === 'concavity') {
        S.viewMode = name === 'concavity' ? S.viewMode : name;
        if (name === 'concavity') {
          window.open(`/api/preview/concavity?size=768&v=${S.cacheBust}`, '_blank');
          return;
        }
        applyViewMode();
      }
    });
    grid.appendChild(d);
  }
}

/* ═══════════════ boot ═══════════════ */
async function boot() {
  initViewport();

  // view mode buttons
  const vm = document.getElementById('view-modes');
  for (const [mode, label] of VIEW_MODES) {
    const b = document.createElement('button');
    b.textContent = label;
    b.dataset.mode = mode;
    if (mode === S.viewMode) b.classList.add('on');
    b.addEventListener('click', () => {
      if (!terrainMesh) return;
      S.viewMode = mode;
      applyViewMode();
    });
    vm.appendChild(b);
  }

  // collapsible sections
  document.querySelectorAll('.ctl-section').forEach(sec => {
    sec.querySelector('.section-head').addEventListener('click', () =>
      sec.classList.toggle('closed'));
  });
  document.querySelector('[data-section="satmaps"]').classList.add('closed');

  // toolbar options
  document.getElementById('opt-hscale').addEventListener('input', applyHeightScale);
  const wire = document.getElementById('opt-wire');
  wire.addEventListener('click', () => {
    S.wireframe = !S.wireframe;
    wire.classList.toggle('on', S.wireframe);
    if (terrainMat) { terrainMat.wireframe = S.wireframe; terrainMat.needsUpdate = true; }
  });
  const rot = document.getElementById('opt-rotate');
  rot.addEventListener('click', () => {
    controls.autoRotate = !controls.autoRotate;
    rot.classList.toggle('on', controls.autoRotate);
  });
  const sh = document.getElementById('opt-shadow');
  sh.addEventListener('click', () => {
    S.shadows = !S.shadows;
    sh.classList.toggle('on', S.shadows);
    renderer.shadowMap.enabled = S.shadows;
    sunLight.castShadow = S.shadows;
    scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  });
  const sdfBtn = document.getElementById('opt-sdf');
  sdfBtn.addEventListener('click', () => {
    if (!terrainMesh) { log('run the pipeline first.'); return; }
    document.getElementById('sdf-img').src = `/api/preview/sdf-slice?size=900&v=${S.cacheBust}`;
    document.getElementById('sdf-overlay').classList.remove('hidden');
  });
  document.getElementById('sdf-close').addEventListener('click', () =>
    document.getElementById('sdf-overlay').classList.add('hidden'));

  // actions
  document.getElementById('btn-pipeline').addEventListener('click', () => runPipeline(false));
  document.getElementById('btn-pipeline-2').addEventListener('click', () => runPipeline(false));
  document.getElementById('btn-noerosion').addEventListener('click', () => runPipeline(true));
  document.getElementById('btn-retexture').addEventListener('click', async () => {
    if (!terrainMesh) { log('nothing to retexture yet.'); return; }
    log('retexturing from current SATMAPs…');
    await fetch('/api/retexture', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(S.params.texture),
    });
    S.cacheBust = Date.now();
    await applyViewMode();
    log('retexture done.');
  });
  const expBtn = document.getElementById('btn-export');
  const expMenu = document.getElementById('export-menu');
  expBtn.addEventListener('click', () => expMenu.classList.toggle('hidden'));
  document.addEventListener('click', e => {
    if (!e.target.closest('.dropdown')) expMenu.classList.add('hidden');
  });
  expMenu.querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
    expMenu.classList.add('hidden');
    if (!terrainMesh) { log('nothing to export yet.'); return; }
    log(`exporting ${b.dataset.export}…`);
    const r = await fetch('/api/export/' + b.dataset.export);
    const j = await r.json();
    log('saved: ' + JSON.stringify(j.files).slice(0, 300));
  }));
  document.getElementById('log-toggle').addEventListener('click', () => {
    const f = document.getElementById('log-full');
    f.classList.toggle('hidden');
    document.getElementById('log-toggle').textContent =
      f.classList.contains('hidden') ? '▲ console' : '▼ console';
  });

  // presets + initial params
  const pr = await fetch('/api/presets');
  const { presets } = await pr.json();
  S.presets = presets;
  const sel = document.getElementById('preset-select');
  for (const p of presets) {
    const o = document.createElement('option');
    o.value = p.name; o.textContent = p.label;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () => {
    const p = presets.find(x => x.name === sel.value);
    if (!p) return;
    S.params.mountain = { ...p.mountain };
    S.params.erosion = { ...p.erosion };
    S.params.texture = { ...p.texture };
    buildPanel();
    log('preset loaded: ' + p.label);
  });

  const st = await fetch('/api/state');
  const state = await st.json();
  S.params = state.params;
  buildPanel();
  if (state.summary) {
    await refreshAll(state.summary);
  } else {
    log('ready. pick a preset and Generate Terrain.');
  }
}

boot().catch(e => {
  console.error(e);
  document.getElementById('log-line').textContent = 'boot failed: ' + e.message;
});
