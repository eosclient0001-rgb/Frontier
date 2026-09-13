/*  Frontier · PlantGenerator · app.js — panel wiring (SolidArc shell: Outliner · Viewport · Inspector) */
import * as THREE from './vendor/three.module.min.js';
import { OrbitControls } from './vendor/jsm/controls/OrbitControls.js';
import { GLTFExporter } from './vendor/jsm/exporters/GLTFExporter.js';
import { OBJExporter } from './vendor/jsm/exporters/OBJExporter.js';
import { SPECIES, PALETTE, CATALOGUE, generatePlant, randomParams, connectedComponents, variantOf, hex } from './plant.js';

const $ = (s, r = document) => r.querySelector(s);
const ICON = {
  palm: '<svg class="i" viewBox="0 0 24 24"><path d="M12 21V9M12 9c-3-4-7-4-9-2 3 0 5 1 9 2M12 9c3-4 7-4 9-2-3 0-5 1-9 2M12 9c-1-4 0-7 3-8-1 3-1 5-3 8M12 9c1-4 0-7-3-8 1 3 1 5 3 8"/></svg>',
  banana: '<svg class="i" viewBox="0 0 24 24"><path d="M12 21V8M12 8c-4-3-8-1-9 3 4-1 7 0 9-3M12 8c4-3 8-1 9 3-4-1-7 0-9-3M12 8c-2-4-1-6 0-7 1 1 2 3 0 7"/></svg>',
  aroid: '<svg class="i" viewBox="0 0 24 24"><path d="M12 22V10M12 10C7 10 3 7 4 3c4 0 7 2 8 7 1-5 4-7 8-7 1 4-3 7-8 7"/></svg>',
  fern: '<svg class="i" viewBox="0 0 24 24"><path d="M12 21C10 14 8 8 4 5M12 21c2-7 4-13 8-16M12 21V6M9 12l-3-1M9 9L7 7M15 12l3-1M15 9l2-2M12 10c-2 0-3-1-4-3M12 10c2 0 3-1 4-3"/></svg>',
};
const ICO_PART = { trunk: 'trunk', pseudostem: 'stem', crown: 'crown' };

/* ───────── state ───────── */
const S = { species: 'palm', variant: 'coconut', plants: [], sel: null, shade: 'flat', layout: 'focus', wind: false, ref: true, filter: '' };
const persist = () => { try { localStorage.setItem('flora.doc', JSON.stringify({ species: S.species, variant: S.variant, plants: S.plants.map(p => ({ species: p.species, params: p.params, name: p.info.name, hidden: !!p.hidden, colors: p.colors })) })); } catch { } };

/* ───────── three ───────── */
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene(); scene.background = null;
const camera = new THREE.PerspectiveCamera(38, 1, .05, 500); camera.position.set(9, 6, 12);
const controls = new OrbitControls(camera, canvas); controls.enableDamping = true; controls.dampingFactor = .08; controls.target.set(0, 3, 0); controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
canvas.addEventListener('contextmenu', e => { e.preventDefault(); if (!canvas._d || Math.hypot(e.clientX - canvas._d[0], e.clientY - canvas._d[1]) < 4) toggleCat(true, e.clientX, e.clientY); });
const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x3a3326, .9); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff1dc, 2.6); sun.position.set(10, 18, 8); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -.0004; sun.shadow.normalBias = .02; sun.shadow.camera.near = 1; sun.shadow.camera.far = 80;
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16 }); scene.add(sun); scene.add(sun.target);
const fill = new THREE.DirectionalLight(0x9ec7ff, .5); fill.position.set(-10, 6, -8); scene.add(fill);
// ground disc + lattice (studio look, solid colours)
const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x151618, roughness: 1, metalness: 0 })); ground.receiveShadow = true; scene.add(ground);
const grid = new THREE.GridHelper(40, 40, 0x2a2c30, 0x1d1f23); grid.position.y = .002; scene.add(grid);
// 1.8 m human reference silhouette (flat solid)
const human = new THREE.Group(); {
  const m = new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: .9 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(.17, 1.05, 4, 8), m); body.position.y = .95; human.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(.11, 12, 8), m); head.position.y = 1.69; human.add(head);
  human.traverse(o => { if (o.isMesh) o.castShadow = true; });
} scene.add(human);
const plantsGroup = new THREE.Group(); scene.add(plantsGroup);
const mats = {
  flat: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .78, metalness: 0, side: THREE.DoubleSide }),
  smooth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .78, metalness: 0, side: THREE.DoubleSide }),
  wire: new THREE.MeshBasicMaterial({ vertexColors: true, wireframe: true }),
  parts: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .9, side: THREE.DoubleSide }),
};
const selHelper = new THREE.Box3Helper(new THREE.Box3(), 0x4fd8e0); selHelper.visible = false; scene.add(selHelper);

function resize() { const r = canvas.parentElement.getBoundingClientRect(); renderer.setSize(r.width, r.height, false); camera.aspect = r.width / r.height; camera.updateProjectionMatrix(); }
new ResizeObserver(resize).observe(canvas.parentElement); resize();

/* ───────── plants ───────── */
const PART_COLORS = { flower: '#ffb454', boots: '#b48cff', trunk: '#b08a5a', pseudostem: '#b08a5a', crown: '#b08a5a', frond: '#34c759', leaf: '#34c759', deadFrond: '#ffb454', coconut: '#e5d33a', fruit: '#e5d33a', spear: '#4fd8e0', cigar: '#4fd8e0', crozier: '#4fd8e0' };
function makePlant(species, params, opts = {}) {
  const r = generatePlant(species, params);
  const g = r.geometry;
  // parts colour buffer (for the Parts shading mode)
  const pc = new Float32Array(g.attributes.color.count * 3); let off = 0;
  for (const [name, cnt] of Object.entries(r.stats.parts)) { const c = hex(PART_COLORS[name] || '#b48cff'); for (let i = 0; i < cnt; i++) { pc[(off + i) * 3] = c[0]; pc[(off + i) * 3 + 1] = c[1]; pc[(off + i) * 3 + 2] = c[2]; } off += cnt; }
  g.setAttribute('partColor', new THREE.BufferAttribute(pc, 3));
  g.setAttribute('baseColor', g.attributes.color.clone());
  const mesh = new THREE.Mesh(g, mats[S.shade]); mesh.castShadow = true; mesh.receiveShadow = true;
  const p = { id: crypto.randomUUID ? crypto.randomUUID() : String(Math.random()), species, params, stats: r.stats, info: r.info, mesh, hidden: !!opts.hidden, components: connectedComponents(g), colors: opts.colors || null };
  if (opts.name) p.info.name = opts.name;
  if (p.colors) applyColors(p);
  mesh.userData.plant = p; mesh.visible = !p.hidden; plantsGroup.add(mesh);
  return p;
}
function regen(p) {
  const old = p.mesh; plantsGroup.remove(old); old.geometry.dispose();
  const np = makePlant(p.species, p.params, { name: p.info.name, hidden: p.hidden, colors: p.colors });
  Object.assign(p, { mesh: np.mesh, stats: np.stats, components: np.components, info: { ...np.info, name: p.info.name } }); np.mesh.userData.plant = p;
  layout(); refresh();
}
/** per-plant colour overrides: recolour vertices by nearest palette key (solid fills) */
function applyColors(p) {
  const g = p.mesh.geometry, base = g.attributes.baseColor.array, col = g.attributes.color.array; const pal = PALETTE[p.species];
  const keys = Object.keys(pal).map(k => ({ k, c: hex(pal[k]) }));
  const cache = new Map();
  for (let i = 0; i < col.length; i += 3) {
    const key = (base[i] * 255 | 0) << 16 | (base[i + 1] * 255 | 0) << 8 | (base[i + 2] * 255 | 0);
    let out = cache.get(key);
    if (!out) {
      // nearest palette entry in hue/lightness-relaxed RGB space, keep relative luminance offset (shade variation)
      let best = null, bd = 1e9; for (const e of keys) { const d = Math.abs(e.c[0] - base[i]) + Math.abs(e.c[1] - base[i + 1]) + Math.abs(e.c[2] - base[i + 2]); if (d < bd) { bd = d; best = e; } }
      const ov = p.colors && p.colors[best.k]; const oc = ov ? hex(ov) : best.c;
      const lum = (base[i] + base[i + 1] + base[i + 2]) / Math.max(1e-4, best.c[0] + best.c[1] + best.c[2]);
      out = [oc[0] * lum, oc[1] * lum, oc[2] * lum]; cache.set(key, out);
    }
    col[i] = out[0]; col[i + 1] = out[1]; col[i + 2] = out[2];
  }
  g.attributes.color.needsUpdate = true;
}
function addPlant(species, seed, focus = true, variant = S.variant, overrides = null) {
  seed = Number.isFinite(seed) ? seed : (Math.random() * 1e6 | 0);
  if (!SPECIES[species].variants[variant]) variant = Object.keys(SPECIES[species].variants)[0];
  const params = randomParams(species, seed, variant); if (overrides) Object.assign(params, overrides);
  const p = makePlant(species, params); S.plants.push(p); S.sel = p.id;
  layout(); refresh(); if (focus) focusSel(); persist(); toast(`${variantOf(species, variant).label} · seed ${seed} · ${p.stats.triangles.toLocaleString()} tris · ${p.components === 1 ? 'one merged mesh' : p.components + ' pieces'}`);
  return p;
}
function deleteSel() { const i = S.plants.findIndex(p => p.id === S.sel); if (i < 0) return; const p = S.plants[i]; plantsGroup.remove(p.mesh); p.mesh.geometry.dispose(); S.plants.splice(i, 1); S.sel = S.plants[Math.min(i, S.plants.length - 1)]?.id || null; layout(); refresh(); persist(); }
function layout() {
  const vis = S.plants.filter(p => !p.hidden);
  if (S.layout === 'focus') { for (const p of S.plants) p.mesh.position.set(0, 0, 0), (p.mesh.visible = p.id === S.sel && !p.hidden); human.position.set(2.2, 0, 1.2); }
  else { let x = 0; const gap = 1.2; const tot = vis.reduce((a, p) => a + p.stats.width, 0) + gap * (vis.length - 1); x = -tot / 2; for (const p of S.plants) { p.mesh.visible = !p.hidden; if (p.hidden) continue; p.mesh.position.set(x + p.stats.width / 2, 0, 0); x += p.stats.width + gap; } human.position.set(x + 1, 0, 0); }
  human.visible = S.ref;
  const sp = S.plants.find(p => p.id === S.sel);
  if (sp && sp.mesh.visible) { selHelper.box.setFromObject(sp.mesh); selHelper.visible = S.layout === 'lineup'; } else selHelper.visible = false;
}
function focusSel() {
  const p = S.plants.find(x => x.id === S.sel); const box = new THREE.Box3();
  if (p && p.mesh.visible) box.setFromObject(p.mesh); else if (plantsGroup.children.some(c => c.visible)) box.setFromObject(plantsGroup); else box.set(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 4, 2));
  const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()); const d = Math.max(sz.x, sz.y, sz.z) / (2 * Math.tan(camera.fov * Math.PI / 360)) * 1.25;
  const dir = camera.position.clone().sub(controls.target).normalize(); controls.target.copy(c); camera.position.copy(c).addScaledVector(dir, d); controls.update();
}
function setView(v) {
  const p = S.plants.find(x => x.id === S.sel); const box = new THREE.Box3(); if (p && p.mesh.visible) box.setFromObject(p.mesh); else box.set(new THREE.Vector3(-2, 0, -2), new THREE.Vector3(2, 4, 2));
  const c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()); const d = Math.max(sz.x, sz.y, sz.z) / (2 * Math.tan(camera.fov * Math.PI / 360)) * 1.3;
  const dirs = { front: [0, 0, 1], right: [1, 0, 0], top: [0, 1, .0001], iso: [.65, .45, .62] }; const dv = new THREE.Vector3(...dirs[v]).normalize();
  controls.target.copy(c); camera.position.copy(c).addScaledVector(dv, d); controls.update(); $('#vname').textContent = v === 'iso' ? 'Perspective' : v[0].toUpperCase() + v.slice(1);
  document.querySelectorAll('#views button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
}

/* ───────── UI: species grid ───────── */
const spGrid = $('#spGrid');
for (const [k, d] of Object.entries(SPECIES)) { const b = document.createElement('div'); b.className = 'sp' + (k === S.species ? ' on' : ''); b.style.setProperty('--acc', d.accent); b.dataset.sp = k; b.innerHTML = ICON[k] + d.label; b.onclick = () => { setCurrent(k, S.species === k ? S.variant : Object.keys(d.variants)[0]); }; spGrid.appendChild(b); }
function setCurrent(species, variant) {
  S.species = species; S.variant = SPECIES[species].variants[variant] ? variant : Object.keys(SPECIES[species].variants)[0];
  document.querySelectorAll('.sp').forEach(x => x.classList.toggle('on', x.dataset.sp === species));
  const chip = $('#curChip'); chip.style.setProperty('--acc', SPECIES[species].accent); chip.querySelector('b').textContent = variantOf(species, S.variant).label;
  document.querySelectorAll('#tree .row.child').forEach(r => r.classList.toggle('sel', r.querySelector('.name')?.textContent === variantOf(species, S.variant).label));
  persist();
}
$('#curChip').onclick = () => toggleCat(true);
$('#btnAdd').onclick = () => toggleCat(true);
$('#btnGen').onclick = () => addPlant(S.species, parseInt($('#seed').value));
$('#btnBatch').onclick = () => { const base = parseInt($('#seed').value); const l0 = S.layout; S.layout = 'lineup'; document.querySelectorAll('#layout button').forEach(b => b.classList.toggle('on', b.dataset.l === 'lineup')); for (let i = 0; i < 6; i++) addPlant(S.species, Number.isFinite(base) ? base + i : undefined, false); focusSel(); void l0; };
$('#q').oninput = e => { S.filter = e.target.value.toLowerCase(); if (S.filter) libOpen = true; refresh(); };
$('#q').placeholder = 'Search library & scene…';

/* ───────── UI: outliner tree ───────── */
let libOpen = true;
function libraryGroup() {
  const g = document.createElement('div'); g.className = 'grp' + (libOpen ? '' : ' closed');
  g.innerHTML = `<div class="grp-h"><svg class="i car" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>Library · all plants<span class="cnt">${CATALOGUE.length}</span></div><div class="kids"></div>`;
  g.querySelector('.grp-h').onclick = () => { libOpen = !libOpen; g.classList.toggle('closed', !libOpen); };
  const kids = g.querySelector('.kids');
  for (const f of Object.keys(SPECIES)) {
    const list = CATALOGUE.filter(c => c.species === f); if (S.filter && !list.some(c => (c.label + c.latin + f).toLowerCase().includes(S.filter))) continue;
    const h = document.createElement('div'); h.className = 'grp-h'; h.style.cssText = 'height:22px;padding-left:18px;color:' + SPECIES[f].accent; h.innerHTML = `${SPECIES[f].label}s<span class="cnt">${list.length}</span>`; kids.appendChild(h);
    for (const c of list) {
      if (S.filter && !(c.label + c.latin + f).toLowerCase().includes(S.filter)) continue;
      const inScene = S.plants.filter(p => p.species === c.species && p.params.variant === c.variant).length;
      const row = document.createElement('div'); row.className = 'row child' + (S.species === c.species && S.variant === c.variant ? ' sel' : ''); row.style.setProperty('--acc', c.accent); row.title = 'click: make current · double-click / + : add to scene';
      row.innerHTML = `<div class="ico">${ICON[f]}</div><div class="txt"><div class="name">${c.label}</div><div class="meta">${c.latin}${inScene ? ' · ' + inScene + ' in scene' : ''}</div></div><button class="eye" style="opacity:1" title="add to scene"><svg class="i" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>`;
      row.onclick = () => setCurrentAndRefresh(c);
      row.ondblclick = () => addPlant(c.species, undefined, true, c.variant);
      row.querySelector('.eye').onclick = e => { e.stopPropagation(); setCurrent(c.species, c.variant); addPlant(c.species, parseInt($('#seed').value), true, c.variant); };
      kids.appendChild(row);
    }
  }
  return g;
}
function setCurrentAndRefresh(c) { setCurrent(c.species, c.variant); refresh(); }
function refresh() {
  const tree = $('#tree'); tree.innerHTML = '';
  const groups = {}; for (const p of S.plants) (groups[p.species] ||= []).push(p);
  let tri = 0;
  for (const [sp, arr] of Object.entries(groups)) {
    const g = document.createElement('div'); g.className = 'grp'; const d = SPECIES[sp];
    g.innerHTML = `<div class="grp-h"><svg class="i car" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>Scene · ${d.label}s<span class="cnt">${arr.length}</span></div><div class="kids"></div>`;
    g.querySelector('.grp-h').onclick = () => g.classList.toggle('closed');
    const kids = g.querySelector('.kids');
    for (const p of arr) {
      tri += p.stats.triangles;
      if (S.filter && !(p.info.name + p.info.latin + sp).toLowerCase().includes(S.filter)) continue;
      const row = document.createElement('div'); row.className = 'row' + (p.id === S.sel ? ' sel' : '') + (p.hidden ? ' hid' : ''); row.style.setProperty('--acc', d.accent);
      row.innerHTML = `<div class="ico">${ICON[sp]}</div><div class="txt"><div class="name">${p.info.name}</div><div class="meta">${variantOf(sp, p.params.variant).label} · seed ${p.params.seed} · ${p.stats.triangles.toLocaleString()} tri · ${p.stats.height} m</div></div>
        <div class="badges"><span class="st ${p.components === 1 ? 'ok' : 'err'}" title="${p.components === 1 ? 'single merged mesh' : p.components + ' disconnected pieces'}"><svg class="i" viewBox="0 0 24 24"><path d="M8 12h8M12 8v8"/><circle cx="12" cy="12" r="9"/></svg></span></div>
        <button class="eye" title="hide / show"><svg class="i" viewBox="0 0 24 24">${p.hidden ? '<path d="M3 3l18 18M10 6a10 10 0 0 1 11 6 10 10 0 0 1-3 3.6M6.6 6.6A10 10 0 0 0 3 12a10 10 0 0 0 11 6"/>' : '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'}</svg></button>`;
      row.onclick = () => { S.sel = p.id; layout(); refresh(); if (S.layout === 'focus') focusSel(); };
      row.querySelector('.eye').onclick = e => { e.stopPropagation(); p.hidden = !p.hidden; layout(); refresh(); persist(); };
      kids.appendChild(row);
    }
    tree.appendChild(g);
  }
  if (!S.plants.length) tree.insertAdjacentHTML('beforeend', `<div class="empty"><b>Scene is empty</b>Open <b>Construct</b> (Tab) and click a plant — it lands here.</div>`);
  $('#tPl').textContent = S.plants.length; $('#tTri').textContent = tri > 999 ? (tri / 1000).toFixed(1) + 'k' : tri;
  $('#tTriT').className = 'tile' + (tri > 400000 ? ' warn' : tri ? ' ok' : '');
  const sel = S.plants.find(p => p.id === S.sel);
  $('#ofoot').innerHTML = `<div class="foot-census">${Object.entries(groups).map(([sp, a]) => `<i style="--acc:${SPECIES[sp].accent};width:${100 * a.length / S.plants.length}%"></i>`).join('')}</div>
    <div class="foot-row">${Object.entries(groups).map(([sp, a]) => `<span class="kv" style="color:${SPECIES[sp].accent}"><b>${a.length}</b> ${sp}</span>`).join('')}<span class="sp"></span><span class="kv ${S.plants.every(p => p.components === 1) ? 'ok' : 'err'}"><b>${S.plants.filter(p => p.components === 1).length}/${S.plants.length}</b> merged</span></div>`;
  inspector(sel);
}

/* ───────── UI: inspector ───────── */
function inspector(p) {
  const el = $('#insp'); $('#inspBadge').textContent = p ? `${variantOf(p.species, p.params.variant).label} · ${p.info.latin}` : 'nothing selected';
  if (!p) { el.innerHTML = `<div class="empty"><b>Nothing selected</b>Generate or click a plant in the Outliner.</div>`; return; }
  const d = SPECIES[p.species]; const parts = Object.entries(p.stats.parts);
  el.innerHTML = `
  <div class="hero" style="--acc:${d.accent}">
    <div class="c-top"><div class="ico">${ICON[p.species]}</div><div class="t"><div class="n"><input class="cname" id="pname" value="${p.info.name}" style="color:var(--text);font-family:var(--font);font-size:14px;background:none;border:0;padding:0;height:auto"></div><div class="m">${p.info.latin} · seed ${p.params.seed}</div></div></div>
    <div class="big"><span class="v">${p.stats.height}</span><span class="u">m</span><span class="lab">tall<br>${p.stats.width} m wide</span></div>
    <div class="side"><div><span class="k">triangles</span><span class="v2">${p.stats.triangles.toLocaleString()}</span></div><div><span class="k">vertices</span><span class="v2">${p.stats.vertices.toLocaleString()}</span></div><div><span class="k">topology</span><span class="v2" style="color:${p.components === 1 ? 'var(--green)' : 'var(--red)'}">${p.components === 1 ? '1 shell · merged' : p.components + ' shells'}</span></div></div>
  </div>
  <div class="actions"><button class="abtn" id="aRe" title="new seed, same species">reseed</button><button class="abtn" id="aDup">duplicate</button><button class="abtn" id="aExp">export</button><button class="abtn danger" id="aDel">delete</button></div>
  <div class="sec" id="secP"><div class="sec-head">Properties<span class="hint">${d.params.length} unique</span><svg class="i car" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></div><div class="sec-body" id="props"></div></div>
  <div class="sec"><div class="sec-head">Solid colours<span class="hint">vertex fill · no textures</span><svg class="i car" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></div><div class="sec-body" id="cols" style="grid-template-columns:1fr"></div></div>
  <div class="sec"><div class="sec-head">Parts<span class="hint">extruded from parent faces</span><svg class="i car" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></div><div class="sec-body" style="grid-template-columns:1fr"><div class="kv2">${parts.map(([k, v]) => `<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${PART_COLORS[k] || '#b48cff'};margin-right:6px"></span>${k}</span><b>${v.toLocaleString()} v</b>`).join('')}</div></div></div>
  <div class="sec closed"><div class="sec-head">Export<span class="hint">glb · obj · json</span><svg class="i car" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></div><div class="sec-body" style="grid-template-columns:1fr 1fr 1fr;gap:6px;padding-top:8px"><button class="abtn" data-x="glb">.glb</button><button class="abtn" data-x="obj">.obj</button><button class="abtn" data-x="json">.json</button></div></div>`;
  el.querySelectorAll('.sec-head').forEach(h => h.onclick = () => h.parentElement.classList.toggle('closed'));
  $('#pname').onchange = e => { p.info.name = e.target.value || p.info.name; refresh(); persist(); };
  $('#aRe').onclick = () => { p.params = randomParams(p.species, Math.random() * 1e6 | 0, p.params.variant); p.info.name = generatePlant(p.species, p.params).info.name; regen(p); persist(); };
  $('#aDup').onclick = () => { const np = makePlant(p.species, { ...p.params }, { colors: p.colors }); np.info.name = p.info.name + ' copy'; S.plants.push(np); S.sel = np.id; layout(); refresh(); persist(); };
  $('#aDel').onclick = deleteSel; $('#aExp').onclick = () => exportPlant(p, 'glb');
  el.querySelectorAll('[data-x]').forEach(b => b.onclick = () => exportPlant(p, b.dataset.x));
  // property sliders (the SolidArc trk-bar control)
  const props = $('#props');
  for (const s of d.params) {
    if (s.key === 'trunk' && !(variantOf(p.species, p.params.variant).over || {}).trunk) continue;
    const c = document.createElement('div'); c.className = 'ctl'; const v = p.params[s.key];
    const pct = 100 * (v - s.min) / (s.max - s.min);
    c.innerHTML = `<div class="ctl-top"><span class="lab">${s.label}</span><span class="val">${fmt(v, s)}<small>${s.unit || ''}</small></span></div><div class="trk-bar" style="--p:${pct}%"><div class="ticks"></div><div class="fill"></div><div class="thumb"></div></div>`;
    const bar = c.querySelector('.trk-bar'), val = c.querySelector('.val');
    let raf = 0;
    const setFrom = (clientX) => { const r = bar.getBoundingClientRect(); let t = (clientX - r.left) / r.width; t = Math.max(0, Math.min(1, t)); let nv = s.min + t * (s.max - s.min); nv = Math.round(nv / s.step) * s.step; nv = +nv.toFixed(4); if (nv === p.params[s.key]) return; p.params[s.key] = nv; bar.style.setProperty('--p', 100 * (nv - s.min) / (s.max - s.min) + '%'); val.innerHTML = fmt(nv, s) + `<small>${s.unit || ''}</small>`; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => regenLive(p)); };
    bar.onpointerdown = e => { bar.setPointerCapture(e.pointerId); bar.classList.add('drag'); setFrom(e.clientX); bar.onpointermove = ev => setFrom(ev.clientX); bar.onpointerup = () => { bar.classList.remove('drag'); bar.onpointermove = null; refresh(); persist(); }; };
    props.appendChild(c);
  }
  // colours
  const cols = $('#cols'); const pal = PALETTE[p.species];
  for (const [k, hx] of Object.entries(pal)) {
    const cur = (p.colors && p.colors[k]) || hx;
    const r = document.createElement('div'); r.className = 'swl'; r.innerHTML = `<span class="swatch" style="background:${cur}"><input type="color" value="${cur}"></span><span class="k">${k}</span><span style="font-family:var(--mono);font-size:10px;color:var(--t3)">${cur}</span>`;
    r.querySelector('input').oninput = e => { p.colors = { ...(p.colors || {}), [k]: e.target.value }; r.querySelector('.swatch').style.background = e.target.value; r.lastElementChild.textContent = e.target.value; applyColors(p); persist(); };
    cols.appendChild(r);
  }
  const reset = document.createElement('button'); reset.className = 'abtn'; reset.textContent = 'reset colours'; reset.style.marginTop = '6px'; reset.onclick = () => { p.colors = null; applyColorsReset(p); inspector(p); persist(); }; cols.appendChild(reset);
}
function applyColorsReset(p) { const g = p.mesh.geometry; g.attributes.color.array.set(g.attributes.baseColor.array); g.attributes.color.needsUpdate = true; }
const fmt = (v, s) => s.step >= 1 ? String(Math.round(v)) : v.toFixed(s.step < .01 ? 3 : 2);
function regenLive(p) { // fast path during slider drags: rebuild the geometry only
  const old = p.mesh; plantsGroup.remove(old); old.geometry.dispose();
  const np = makePlant(p.species, p.params, { name: p.info.name, hidden: p.hidden, colors: p.colors });
  Object.assign(p, { mesh: np.mesh, stats: np.stats, components: np.components }); np.mesh.userData.plant = p; layout();
  $('#insp .big .v').textContent = p.stats.height; $('#insp .side .v2').textContent = p.stats.triangles.toLocaleString();
}

/* ───────── export ───────── */
function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
function exportPlant(p, kind) {
  const g = p.mesh.geometry.clone(); g.deleteAttribute('partColor'); g.deleteAttribute('baseColor');
  const mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .8, side: THREE.DoubleSide, name: 'flora_vertexcolour' })); mesh.name = p.info.name;
  const fname = `${p.species}_${p.info.name}_${p.params.seed}`;
  if (kind === 'glb') new GLTFExporter().parse(mesh, (buf) => download(fname + '.glb', new Blob([buf], { type: 'model/gltf-binary' })), (e) => toast('export failed: ' + e), { binary: true });
  else if (kind === 'obj') download(fname + '.obj', new Blob([new OBJExporter().parse(mesh)], { type: 'text/plain' }));
  else download(fname + '.json', new Blob([JSON.stringify({ species: p.species, params: p.params, colors: p.colors, info: p.info, stats: p.stats }, null, 2)], { type: 'application/json' }));
  toast(`exported ${fname}.${kind}`);
}

/* ───────── viewport toolbar ───────── */
document.querySelectorAll('#shade button').forEach(b => b.onclick = () => { S.shade = b.dataset.s; document.querySelectorAll('#shade button').forEach(x => x.classList.toggle('on', x === b)); for (const p of S.plants) { p.mesh.material = mats[S.shade]; const g = p.mesh.geometry; g.setAttribute('color', S.shade === 'parts' ? g.attributes.partColor : (g.attributes.color === g.attributes.partColor ? g.attributes.baseColor.clone() : g.attributes.color)); if (S.shade !== 'parts' && p.colors) applyColors(p); } });
document.querySelectorAll('#layout button').forEach(b => b.onclick = () => { S.layout = b.dataset.l; document.querySelectorAll('#layout button').forEach(x => x.classList.toggle('on', x === b)); layout(); focusSel(); });
document.querySelectorAll('#views button').forEach(b => b.onclick = () => setView(b.dataset.v));
$('#wind').onclick = e => { S.wind = !S.wind; e.currentTarget.classList.toggle('on', S.wind); if (!S.wind) for (const p of S.plants) p.mesh.rotation.set(0, 0, 0); };
$('#scale').onclick = e => { S.ref = !S.ref; e.currentTarget.classList.toggle('on', S.ref); layout(); };
// pick
canvas.addEventListener('pointerdown', e => { canvas._d = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', e => { if (!canvas._d || Math.hypot(e.clientX - canvas._d[0], e.clientY - canvas._d[1]) > 4) return; const r = canvas.getBoundingClientRect(); const m = new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); const rc = new THREE.Raycaster(); rc.setFromCamera(m, camera); const hit = rc.intersectObjects(plantsGroup.children.filter(c => c.visible), false)[0]; if (hit) { S.sel = hit.object.userData.plant.id; layout(); refresh(); } });

/* ───────── keyboard + command line ───────── */
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') { if (e.key === 'Enter' && e.target.id === 'seed') addPlant(S.species, parseInt(e.target.value)); return; }
  const k = e.key.toLowerCase();
  if (e.key === 'Tab') { e.preventDefault(); toggleCat(); return; }
  if (e.key === 'Escape') { toggleCat(false); return; }
  if (k === 'g' && !e.shiftKey) addPlant(S.species, parseInt($('#seed').value));
  else if (k === 'g' && e.shiftKey) $('#btnBatch').click();
  else if (k === 'f') focusSel();
  else if (k === 'e') { const p = S.plants.find(x => x.id === S.sel); if (p) exportPlant(p, 'glb'); }
  else if (k === 'backspace' || k === 'delete') deleteSel();
  else if (k === '1' || k === '2' || k === '3') document.querySelectorAll('.sp')[+k - 1].click();
  else if (k === '7') setView('top');
});
$('#cmdIn').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return; const t = e.target.value.trim().split(/\s+/); e.target.value = ''; if (!t[0]) return;
  const c = t[0].toLowerCase();
  const hit = CATALOGUE.find(x => x.id === c || x.variant === c) || (SPECIES[c] && CATALOGUE.find(x => x.species === c));
  if (hit) { setCurrent(hit.species, hit.variant); const p = addPlant(hit.species, parseInt(t[1]), true, hit.variant); let dirty = false; for (let i = 1; i + 1 < t.length; i += 2) if (isNaN(+t[i])) { p.params[t[i]] = +t[i + 1]; dirty = true; } if (dirty) regen(p); }
  else if (c === 'export') { const p = S.plants.find(x => x.id === S.sel); if (p) exportPlant(p, t[1] || 'glb'); }
  else if (c === 'clear') { while (S.plants.length) { S.sel = S.plants[0].id; deleteSel(); } }
  else if (c === 'set') { const p = S.plants.find(x => x.id === S.sel); if (p && t[1] in p.params) { p.params[t[1]] = +t[2]; regen(p); persist(); } }
  else if (c === 'list') toast(CATALOGUE.map(x => x.variant).join(' · '));
  else toast('unknown: ' + c + ' — try: ' + CATALOGUE.slice(0, 5).map(x => x.variant).join(', ') + '…');
});
let toastT; function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2600); }

/* ───────── construct catalogue (same widget as the sketcher: rail → tiles → options slide) ───────── */
const FAMILY_BLURB = { palm: 'Arecaceae · tropical & subtropical', banana: 'Musaceae / Zingiberales · tropical', aroid: 'Araceae · giant-leaf tropical understory', fern: 'Polypodiopsida · tropical to temperate' };
const prevRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); prevRenderer.setSize(176, 176, false); prevRenderer.setPixelRatio(1); prevRenderer.outputColorSpace = THREE.SRGBColorSpace;
const prevScene = new THREE.Scene(); prevScene.add(new THREE.HemisphereLight(0xdfe9ff, 0x3a3326, 1.2)); const pl = new THREE.DirectionalLight(0xfff1dc, 2.2); pl.position.set(3, 6, 4); prevScene.add(pl);
const prevCam = new THREE.PerspectiveCamera(30, 1, .05, 200);
const prevCache = new Map();
/** render a thumbnail for a catalogue entry onto a 2-D canvas (cached by id+seed) */
function thumb(entry, seed, target, size = 88) {
  const key = entry.id + ':' + seed + ':' + size; const ctx = target.getContext('2d'); target.width = target.height = size;
  if (prevCache.has(key)) { ctx.drawImage(prevCache.get(key), 0, 0); return; }
  const r = generatePlant(entry.species, randomParams(entry.species, seed, entry.variant));
  const mesh = new THREE.Mesh(r.geometry, mats.flat); prevScene.add(mesh);
  const bb = r.geometry.boundingBox, c = bb.getCenter(new THREE.Vector3()), sz = bb.getSize(new THREE.Vector3()); const d = Math.max(sz.x, sz.y, sz.z) / (2 * Math.tan(prevCam.fov * Math.PI / 360)) * 1.15;
  prevCam.position.copy(c).add(new THREE.Vector3(.7, .35, .65).normalize().multiplyScalar(d)); prevCam.lookAt(c); prevRenderer.setSize(size, size, false); prevRenderer.render(prevScene, prevCam);
  prevScene.remove(mesh); r.geometry.dispose();
  const snap = document.createElement('canvas'); snap.width = snap.height = size; snap.getContext('2d').drawImage(prevRenderer.domElement, 0, 0, size, size);
  prevCache.set(key, snap); ctx.drawImage(snap, 0, 0);
}
const catState = { fam: 'palm', entry: null, seed: '', count: 1, over: {} };
function buildCat() {
  const rail = $('#catRail'), grid = $('#catGrid');
  const fams = Object.keys(SPECIES);
  rail.innerHTML = fams.map(f => `<div class="rail-item ${f === catState.fam ? 'on' : ''}" data-f="${f}" style="--acc:${SPECIES[f].accent}">${ICON[f]}${SPECIES[f].label}s<span class="n">${Object.keys(SPECIES[f].variants).length}</span></div>`).join('') + `<div class="rail-item soon">Shrubs<span class="n">soon</span></div><div class="rail-item soon">Grasses<span class="n">soon</span></div>`;
  const show = (f) => {
    catState.fam = f; rail.querySelectorAll('.rail-item').forEach(x => x.classList.toggle('on', x.dataset.f === f));
    const list = CATALOGUE.filter(c => c.species === f);
    grid.innerHTML = list.map((c, i) => `<div class="tile" data-id="${c.id}" title="${c.latin} — click to add"><span class="t-key t-opt" title="options (seed, count, size)">⋯</span><div class="t-prev"><canvas></canvas></div><span class="t-lbl">${c.label}</span><span class="t-lat">${c.latin}</span></div>`).join('');
    grid.querySelectorAll('.tile').forEach((tl, i) => {
      const c = list[i]; requestAnimationFrame(() => thumb(c, 3, tl.querySelector('canvas'), 88));
      tl.onclick = (e) => { if (e.target.closest('.t-opt')) { openOptions(c); return; } setCurrent(c.species, c.variant); addPlant(c.species, undefined, true, c.variant); tl.classList.add('added'); setTimeout(() => tl.classList.remove('added'), 500); if (!e.shiftKey) toggleCat(false); };
    });
    $('#catFoot').innerHTML = `<span>${FAMILY_BLURB[f]}</span><span style="flex:1"></span><span><kbd>click</kbd> adds to the Outliner · <kbd>⇧click</kbd> keeps this open · <kbd>⋯</kbd> options</span>`;
  };
  rail.querySelectorAll('.rail-item[data-f]').forEach(r => r.onclick = () => show(r.dataset.f));
  show(catState.fam);
  $('#catHead').innerHTML = `<span class="ttl"><span class="dot"></span>Construct</span><span class="stchip" id="catCur" style="--acc:${SPECIES[S.species].accent}"><span class="kd"></span><b>${variantOf(S.species, S.variant).label}</b></span><span class="sp"></span><button class="hbtn" id="catClose" title="close (Esc)"><svg class="i" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>`;
  $('#catClose').onclick = () => toggleCat(false);
  const head = $('#catHead'), cat = $('#cat'); head.onpointerdown = e => { if (e.target.closest('button,.stchip')) return; const r = cat.getBoundingClientRect(); const dx = e.clientX - r.left, dy = e.clientY - r.top; head.setPointerCapture(e.pointerId); head.onpointermove = ev => { cat.style.left = (ev.clientX - dx) + 'px'; cat.style.top = (ev.clientY - dy) + 'px'; }; head.onpointerup = () => head.onpointermove = null; };
}
function openOptions(c) {
  catState.entry = c; catState.over = {}; const cat = $('#cat'); cat.classList.add('opts');
  const V = variantOf(c.species, c.variant); const d = SPECIES[c.species];
  $('#optHead').innerHTML = `<button class="back" id="optBack"><svg class="i" viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg></button><div class="h-ic" style="--acc:${d.accent}">${ICON[c.species]}</div><div class="h-txt"><span class="n">${c.label}</span><span class="m">${c.latin} · ${V.common}</span></div>`;
  $('#optBack').onclick = () => cat.classList.remove('opts');
  const seed0 = Number.isFinite(parseInt(catState.seed)) ? parseInt(catState.seed) : 3;
  const P = randomParams(c.species, seed0, c.variant);
  const keyParams = d.params.filter(p => p.key !== 'hue' && p.key !== 'detail' && (p.key !== 'trunk' || (V.over || {}).trunk)).slice(0, 6);
  $('#optBody').innerHTML = `<div class="opt-prev"><canvas id="optPrev"></canvas></div>
    <div class="opt-row"><span>seed</span><input id="optSeed" value="${catState.seed}" placeholder="auto"></div>
    <div class="opt-row"><span>count</span><input id="optCount" value="${catState.count}"></div>
    ${keyParams.map(p => `<div class="opt-row"><span>${p.label}</span><input data-k="${p.key}" value="${fmt(P[p.key], p)}" title="${p.min}–${p.max}${p.unit || ''}"></div>`).join('')}
    <div class="opt-row" style="color:var(--t3);font-size:11px;border-top:0">values are randomised per seed within this plant's own range — edit to pin one. Everything stays live-editable in the Inspector.</div>`;
  const prev = $('#optPrev'); const drawPrev = () => { const sd = parseInt($('#optSeed').value); thumb(c, Number.isFinite(sd) ? sd : 3, prev, 300); };
  drawPrev();
  $('#optSeed').oninput = e => { catState.seed = e.target.value; drawPrev(); const sd = parseInt(e.target.value); const P2 = randomParams(c.species, Number.isFinite(sd) ? sd : 3, c.variant); $('#optBody').querySelectorAll('input[data-k]').forEach(i => { if (!(i.dataset.k in catState.over)) i.value = fmt(P2[i.dataset.k], d.params.find(p => p.key === i.dataset.k)); }); };
  $('#optCount').oninput = e => catState.count = Math.max(1, Math.min(12, parseInt(e.target.value) || 1));
  $('#optBody').querySelectorAll('input[data-k]').forEach(i => i.onchange = () => { const v = parseFloat(i.value); if (Number.isFinite(v)) catState.over[i.dataset.k] = v; else delete catState.over[i.dataset.k]; });
  $('#optFoot').innerHTML = `<span class="steps"><i class="on"></i><i class="on"></i>${c.label}</span><button class="abtn" id="optRnd">random seed</button><button class="abtn primary" id="optAdd">Add to Outliner</button>`;
  $('#optRnd').onclick = () => { $('#optSeed').value = Math.random() * 1e6 | 0; $('#optSeed').oninput({ target: $('#optSeed') }); };
  $('#optAdd').onclick = () => {
    setCurrent(c.species, c.variant); const base = parseInt($('#optSeed').value); const n = catState.count;
    if (n > 1) { S.layout = 'lineup'; document.querySelectorAll('#layout button').forEach(b => b.classList.toggle('on', b.dataset.l === 'lineup')); }
    for (let i = 0; i < n; i++) addPlant(c.species, Number.isFinite(base) ? base + i : undefined, false, c.variant, Object.keys(catState.over).length ? catState.over : null);
    focusSel(); toggleCat(false); cat.classList.remove('opts');
  };
}
function toggleCat(force, x, y) {
  const c = $('#cat'); const show = force !== undefined ? force : !c.classList.contains('show');
  c.classList.toggle('show', show);
  if (show) { const vp = $('#viewport').getBoundingClientRect(); c.style.left = (x ? Math.min(x, innerWidth - 660) : vp.left + 40) + 'px'; c.style.top = (y ? Math.min(y, innerHeight - 490) : vp.top + 60) + 'px'; const cur = $('#catCur'); if (cur) { cur.style.setProperty('--acc', SPECIES[S.species].accent); cur.querySelector('b').textContent = variantOf(S.species, S.variant).label; } }
}
$('#catBtn').onclick = () => toggleCat();

/* ───────── triad ───────── */

const triad = $('#triad'); const tctx = triad.getContext('2d'); triad.width = triad.height = 152;
function drawTriad() {
  tctx.clearRect(0, 0, 152, 152); const q = camera.quaternion.clone().invert(); const ax = [['#ff6b6b', 'X', new THREE.Vector3(1, 0, 0)], ['#6fe38a', 'Y', new THREE.Vector3(0, 1, 0)], ['#5db3ff', 'Z', new THREE.Vector3(0, 0, 1)]];
  ax.map(([c, l, v]) => [c, l, v.applyQuaternion(q)]).sort((a, b) => a[2].z - b[2].z).forEach(([c, l, v]) => { tctx.strokeStyle = c; tctx.lineWidth = 3; tctx.beginPath(); tctx.moveTo(76, 76); tctx.lineTo(76 + v.x * 50, 76 - v.y * 50); tctx.stroke(); tctx.fillStyle = c; tctx.font = '600 20px JetBrains Mono, monospace'; tctx.fillText(l, 70 + v.x * 62, 82 - v.y * 62); });
}

/* ───────── loop ───────── */
let last = performance.now(), frames = 0, acc = 0;
function tick(now) {
  requestAnimationFrame(tick); const dt = (now - last) / 1000; last = now;
  controls.update();
  if (S.wind) for (const p of S.plants) { if (!p.mesh.visible) continue; const a = now / 1000 + p.params.seed; p.mesh.rotation.z = Math.sin(a * .9) * .012 + Math.sin(a * 2.3) * .004; p.mesh.rotation.x = Math.cos(a * .7) * .008; }
  const sp = S.plants.find(p => p.id === S.sel); if (sp && sp.mesh.visible) { sun.target.position.copy(sp.mesh.position); sun.position.copy(sp.mesh.position).add(new THREE.Vector3(10, 18, 8)); const h = Math.max(6, sp.stats.height); Object.assign(sun.shadow.camera, { left: -h, right: h, top: h, bottom: -h }); sun.shadow.camera.updateProjectionMatrix(); }
  renderer.render(scene, camera); drawTriad();
  const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)); $('#camPill').textContent = `orbit · az ${Math.round(THREE.MathUtils.radToDeg(sph.theta))}° · el ${Math.round(90 - THREE.MathUtils.radToDeg(sph.phi))}° · ${sph.radius.toFixed(1)} m`;
  frames++; acc += dt; if (acc > .5) { $('#fps').textContent = Math.round(frames / acc); frames = 0; acc = 0; }
}
requestAnimationFrame(tick);

/* ───────── boot ───────── */
(function boot() {
  let doc = null; try { doc = JSON.parse(localStorage.getItem('flora.doc') || 'null'); } catch { }
  if (doc && doc.plants?.length) { S.species = doc.species || 'palm'; S.variant = doc.variant || 'coconut'; for (const d of doc.plants) { const p = makePlant(d.species, d.params, { name: d.name, hidden: d.hidden, colors: d.colors }); S.plants.push(p); } S.sel = S.plants[0].id; document.querySelectorAll('.sp').forEach(x => x.classList.toggle('on', x.dataset.sp === S.species)); layout(); refresh(); focusSel(); }
  else { addPlant('palm', 1337, true, 'coconut'); }
  setCurrent(S.species, S.variant); buildCat();
  if (new URLSearchParams(location.search).has('demo')) { S.layout = 'lineup'; document.querySelectorAll('#layout button').forEach(b => b.classList.toggle('on', b.dataset.l === 'lineup')); addPlant('banana', 21, false, 'cavendish'); addPlant('fern', 8, false, 'wood'); focusSel(); }
  if (new URLSearchParams(location.search).has('all')) { S.layout = 'lineup'; document.querySelectorAll('#layout button').forEach(b => b.classList.toggle('on', b.dataset.l === 'lineup')); for (const c of CATALOGUE) addPlant(c.species, 3, false, c.variant); focusSel(); }
})();
window.flora = { S, addPlant, generatePlant, SPECIES };
