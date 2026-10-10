/* ═══════════════════════════════════════════════════════════════
   Terrain Forge — UI layer
   Frontier editor design language: outliner rail, layer stack,
   inspector cards, property switches, Construct-style add dialog.
   ═══════════════════════════════════════════════════════════════ */
import { Icons, layerGlyphSVG } from './icons.js';
import {
  TERRAIN_TYPES, TEXTURE_TYPES, terrainType, textureType, BLEND_MODES,
  presetStack, presetTextureStack,
} from './state.js';
import { $, $$, el, clamp, lerp, fmt, debounce, uid, downloadBlob } from './util.js';

/* ── deterministic mini-profile art for shape previews ── */
function hash1(n) { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); }
function vnoise1(x, seed) {
  const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f);
  return lerp(hash1(i + seed * 17.3), hash1(i + 1 + seed * 17.3), u);
}
function fbm1(x, oct, seed) {
  let a = 0.5, fr = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise1(x * fr, seed + i * 31.7); n += a; a *= 0.5; fr *= 2.03; }
  return s / n;
}
function ridged1(x, oct, seed) {
  let a = 0.5, fr = 1, s = 0, n = 0, prev = 1;
  for (let i = 0; i < oct; i++) {
    let v = 1 - Math.abs(vnoise1(x * fr, seed + i * 31.7) * 2 - 1);
    v *= v; v *= prev; prev = clamp(v, 0, 1);
    s += a * v; n += a; a *= 0.5; fr *= 2.03;
  }
  return s / n;
}
function profilePath(type, seed = 1, w = 240, h = 62) {
  const N = 72;
  const pts = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    let v = 0.5;
    const x = t * 5.5 + seed * 0.13;
    switch (type) {
      case 'mountain': v = ridged1(x, 6, seed) * 0.92 + 0.06; break;
      case 'hills': v = fbm1(x, 5, seed) * 0.7 + 0.24; break;
      case 'dunes': {
        const n = vnoise1(x, seed) * 2 - 1;
        const shaped = n * 0.35 + Math.pow(clamp(n * 0.5 + 0.5, 0, 1), 2.6) * 1.3 - 0.42;
        v = Math.pow(clamp(1 - Math.abs(shaped), 0, 1), 1.7) * 0.95 + 0.05; break;
      }
      case 'canyon': v = Math.pow(clamp(1 - ridged1(x, 5, seed + 3), 0, 1), 1.35); break;
      case 'volcano': {
        const d = Math.abs(t - 0.5) * 2;
        let cone = clamp(1 - d / 0.36, 0, 1); cone = Math.pow(cone, 1.35);
        cone -= Math.pow(clamp(1 - d / 0.12, 0, 1), 1.6) * 0.5;
        v = clamp(cone, 0, 1) * 0.9 + 0.05 + fbm1(x * 3, 4, seed) * 0.06; break;
      }
      case 'plateau': {
        const n = clamp(fbm1(x, 5, seed) * 0.5 + 0.5, 0, 1);
        const xs = n * 7, f = xs - Math.floor(xs);
        v = (Math.floor(xs) + Math.pow(f * f * (3 - 2 * f), 1.6)) / 7; break;
      }
      case 'craters': {
        const cx = Math.floor(t * 4) / 4 + 0.125;
        const d = Math.abs(t - cx) / 0.125;
        v = 0.55 - (1 - Math.min(d * 3.2, 1)) * 0.45 + Math.exp(-Math.pow((d - 1) * 2.4, 2)) * 0.18; break;
      }
      case 'archipelago': v = Math.pow(clamp(1 - Math.abs(vnoise1(x, seed) * 2 - 1), 0, 1), 1.7) * (0.6 + fbm1(x * 2, 4, seed) * 0.5); break;
      case 'perlin': v = clamp(fbm1(x, 6, seed) * 0.5 + 0.5, 0, 1); break;
      case 'worley': {
        const c = Math.floor(t * 5), f = (t * 5) - c;
        v = clamp(Math.abs(f - 0.5) * 1.6, 0, 1) * 0.8 + 0.1; break;
      }
      case 'gradient': v = t; break;
      case 'constant': v = 0.5; break;
      case 'warp': v = fbm1(x * 1.4, 5, seed) * 0.5 + 0.5; break;
      case 'erosion': v = clamp(fbm1(x, 4, seed) * 0.5 + 0.5, 0, 1) * 0.7 + 0.15; break;
      case 'thermal': v = clamp(fbm1(x, 5, seed) * 0.5 + 0.5, 0, 1); break;
      case 'smooth': v = 0.5 + Math.sin(t * 3.1) * 0.08; break;
      case 'terrace': {
        const xs = t * 8, f = xs - Math.floor(xs);
        v = (Math.floor(xs) + f * f * (3 - 2 * f) * 0.3) / 8 + 0.1; break;
      }
      case 'levels': v = Math.pow(t, 1.6) * 0.85 + 0.08; break;
      case 'clamp': v = 0.32; break;
      case 'detail': v = 0.5 + (fbm1(x * 4, 5, seed) - 0.5) * 0.5; break;
      case 'slant': v = t * 0.7 + 0.2; break;
      case 'curvature': v = fbm1(x, 4, seed) * 0.4 + 0.5; break;
      default: v = 0.5;
    }
    pts.push([(t * w).toFixed(1), (h - clamp(v, 0.02, 1) * h).toFixed(1)]);
  }
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]} ${p[1]}`).join(' ');
  return { line, area: `${line} L${w} ${h} L0 ${h} Z` };
}
function profileSVG(type, seed) {
  const { line, area } = profilePath(type, seed);
  const gid = 'pg' + Math.random().toString(36).slice(2, 7);
  return `<svg viewBox="0 0 240 62" preserveAspectRatio="none" style="width:100%;height:62px;display:block">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="currentColor" stop-opacity=".22"/><stop offset="1" stop-color="currentColor" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${area}" fill="url(#${gid})"/>
    <path d="${line}" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" opacity=".9"/>
  </svg>`;
}

/* ═══════════════ UI ═══════════════ */
export function createUI({ state, engine, hooks }) {
  const sel = { tab: 'terrain', id: null };
  let splatPreviewDirty = true;

  /* ── helpers ── */
  const icon = (name, size = 16) => (Icons[name] || Icons.custom).replace('<svg ', `<svg width="${size}" height="${size}" `);
  function sliderHTML({ key, min, max, step, value, digits = 0, unit = '', label, lo, hi, wide, target }) {
    const pct = ((value - min) / (max - min)) * 100;
    return `<label class="${wide ? 'card-wide-row' : ''}" style="display:block">
      ${label ? `<div class="control-line"><span>${label}</span><strong>${fmt(value, digits)}<small>${unit}</small></strong></div>` : ''}
      <input type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-param="${key}" data-target="${target || ''}" style="--progress:${pct}%">
      ${lo || hi ? `<div class="range-labels"><span>${lo || ''}</span><span>${hi || ''}</span></div>` : ''}
    </label>`;
  }
  function card(title, iconName, body, cls = '') {
    return `<section class="card ${cls}" style="--accent:${accentFor()}">
      <div class="card-heading"><span>${icon(iconName, 16)}${title}</span></div>
      <div class="card-body">${body}</div>
    </section>`;
  }
  function accentFor() {
    if (sel.tab === 'environment') return '#99aafa';
    if (sel.tab === 'texture') return textureType(currentLayer()?.type)?.color || '#a8a8a8';
    return terrainType(currentLayer()?.type)?.color || '#d6a078';
  }
  const currentLayer = () => (sel.tab === 'texture' ? state.texture.layers : state.terrain.layers).find(l => l.id === sel.id);

  /* ── left rail: world tree ── */
  const WORLD_GROUPS = [
    { group: 'World', rows: [
      { id: 'tab-terrain-row', name: 'Terrain stack', sub: 'Elevation layers', icon: 'mountain', color: '#d6a078', action: () => selectTab('terrain') },
      { id: 'tab-texture-row', name: 'Texture stack', sub: 'Surface layers', icon: 'layers', color: '#a8a8a8', action: () => selectTab('texture') },
    ] },
    { group: 'Environment', rows: [
      { id: 'env-sun', name: 'Sun & sky', sub: 'Light & atmosphere', icon: 'sun', color: '#e8b65f', action: () => selectEnvironment('sun') },
      { id: 'env-water', name: 'Water', sub: 'Sea plane', icon: 'water', color: '#74bdd4', action: () => selectEnvironment('water') },
      { id: 'env-terrain', name: 'Terrain & camera', sub: 'Domain & lens', icon: 'ruler', color: '#b5816f', action: () => selectEnvironment('terrain') },
    ] },
    { group: 'Presets', rows: [
      { id: 'p-alpine', name: 'Alpine Ridge', sub: 'Eroded massif', icon: 'mountain', color: '#d6a078', action: () => hooks.applyPreset('alpine') },
      { id: 'p-canyon', name: 'Desert Canyon', sub: 'Carved mesa', icon: 'canyon', color: '#c98f6a', action: () => hooks.applyPreset('canyon') },
      { id: 'p-volcanic', name: 'Volcanic Isle', sub: 'Basalt island', icon: 'volcano', color: '#b5816f', action: () => hooks.applyPreset('volcanic') },
      { id: 'p-dunes', name: 'Highland Dunes', sub: 'Warped dunes', icon: 'dunes', color: '#d8c08a', action: () => hooks.applyPreset('dunes') },
      { id: 'p-glacial', name: 'Glacial Spires', sub: 'Terraced peaks', icon: 'snow', color: '#a4c6e6', action: () => hooks.applyPreset('glacial') },
      { id: 'p-plains', name: 'Rolling Plains', sub: 'Soft relief', icon: 'hills', color: '#a9c48b', action: () => hooks.applyPreset('plains') },
    ] },
    { group: 'Export', rows: [
      { id: 'x-height', name: 'Heightmap 16-bit', sub: 'PNG · grayscale', icon: 'download', color: '#9aa8c0', action: () => hooks.exportKind('height') },
      { id: 'x-splat', name: 'Splat map', sub: 'PNG · coverage', icon: 'image', color: '#9aa8c0', action: () => hooks.exportKind('splat') },
      { id: 'x-shot', name: 'Viewport capture', sub: 'PNG · render', icon: 'camera', color: '#bb9ae4', action: () => hooks.exportKind('screenshot') },
      { id: 'x-save', name: 'Save project', sub: '.terrain file', icon: 'file', color: '#8fc2c6', action: () => hooks.saveProject() },
      { id: 'x-open', name: 'Open project', sub: 'Load .terrain', icon: 'folder', color: '#8fc2c6', action: () => hooks.loadProject() },
    ] },
  ];
  function renderWorldTree() {
    const tree = $('#world-tree');
    const q = ($('#search-input').value || '').toLowerCase();
    let html = '';
    let count = 0;
    for (const section of WORLD_GROUPS) {
      const rows = section.rows.filter(r => !q || r.name.toLowerCase().includes(q) || r.sub.toLowerCase().includes(q));
      if (!rows.length) continue;
      count += rows.length;
      html += `<div class="group"><button class="group-label" data-group="${section.group}">
        <span class="group-chevron">${Icons.chevronDown.replace('<svg ', '<svg width="11" height="11" ')}</span>
        <span>${section.group}</span><span class="group-count">${String(rows.length).padStart(2, '0')}</span></button>`;
      for (const r of rows) {
        const active = (sel.tab === 'environment' && sel.id === r.id) || (sel.tab === 'terrain' && r.id === 'tab-terrain-row') || (sel.tab === 'texture' && r.id === 'tab-texture-row');
        html += `<div class="tree-row ${active ? 'selected' : ''}" style="--row-accent:${r.color}" data-row="${r.id}">
          <button class="object-button">${layerGlyphSVG(r.icon, 16)}<span>${r.name}</span><small>${r.sub}</small></button>
        </div>`;
      }
      html += '</div>';
    }
    tree.innerHTML = html || '<p class="empty">No matches.</p>';
    $('#outliner-count').textContent = String(count).padStart(2, '0');
  }

  /* ── layer stack ── */
  function renderStack() {
    const stack = $('#layerstack');
    const layers = sel.tab === 'texture' ? state.texture.layers : state.terrain.layers;
    $('#tab-terrain').classList.toggle('is-active', sel.tab === 'terrain');
    $('#tab-texture').classList.toggle('is-active', sel.tab === 'texture');
    $('#terrain-count').textContent = state.terrain.layers.length;
    $('#texture-count').textContent = state.texture.layers.length;
    if (!layers.length) {
      stack.innerHTML = `<div class="layer-empty">No layers yet.<br>Add a shape layer to start building elevation.</div>`;
      return;
    }
    // top of list = top of stack
    let html = '';
    [...layers].reverse().forEach((layer, ri) => {
      const idx = layers.length - 1 - ri;
      const t = sel.tab === 'texture' ? textureType(layer.type) : terrainType(layer.type);
      const color = t?.color || '#a8a8a8';
      html += `<div class="layer-row ${sel.id === layer.id ? 'selected' : ''} ${layer.enabled ? '' : 'layer-hidden'}" draggable="true"
        data-layer="${layer.id}" data-index="${idx}" style="--layer-color:${color}">
        <span class="layer-grip">${Icons.grip.replace('<svg ', '<svg width="10" height="14" ')}</span>
        <span class="layer-glyph">${layerGlyphSVG(t?.icon || 'custom', 16)}</span>
        <div class="layer-main">
          <div class="layer-name-row"><span class="layer-name">${layer.name}</span><span class="layer-kind">${t?.name || layer.type}</span></div>
          <div class="layer-meta">
            <input class="layer-weight" type="range" min="0" max="1" step="0.01" value="${layer.weight}" data-weight="${layer.id}" style="--progress:${layer.weight * 100}%" title="Weight">
            <select class="layer-blend" data-blend="${layer.id}" title="Blend mode">
              ${BLEND_MODES.map(b => `<option value="${b.id}" ${layer.blend === b.id ? 'selected' : ''}>${b.label}</option>`).join('')}
            </select>
          </div>
        </div>
        <div class="layer-tools">
          <button data-tool="visibility" data-layer="${layer.id}" class="${layer.enabled ? '' : 'is-off'}" title="${layer.enabled ? 'Disable' : 'Enable'} layer">${(layer.enabled ? Icons.eye : Icons.eyeOff).replace('<svg ', '<svg width="13" height="13" ')}</button>
          <button data-tool="up" data-layer="${layer.id}" title="Move up">${Icons.arrowUp.replace('<svg ', '<svg width="13" height="13" ')}</button>
          <button data-tool="down" data-layer="${layer.id}" title="Move down">${Icons.arrowDown.replace('<svg ', '<svg width="13" height="13" ')}</button>
          <button data-tool="duplicate" data-layer="${layer.id}" title="Duplicate">${Icons.copy.replace('<svg ', '<svg width="13" height="13" ')}</button>
          <button data-tool="delete" data-layer="${layer.id}" title="Delete">${Icons.trash.replace('<svg ', '<svg width="13" height="13" ')}</button>
        </div>
      </div>`;
    });
    stack.innerHTML = html;
  }

  /* ── inspector ── */
  function renderInspector() {
    const crumb = $('#inspector-crumb'), eyebrow = $('#object-eyebrow'), name = $('#object-name');
    const switches = $('#property-switches'), cards = $('#property-cards');
    const desc = $('#section-desc'), kind = $('#section-kind');
    $('#object-icon').innerHTML = layerGlyphSVG(sel.tab === 'texture' ? (textureType(currentLayer()?.type)?.icon) : (terrainType(currentLayer()?.type)?.icon) || 'mountain', 26);
    $('#object-icon').style.color = accentFor();

    if (sel.tab === 'environment') {
      crumb.textContent = 'Environment';
      kind.textContent = 'WORLD';
      eyebrow.textContent = 'World';
      name.textContent = { sun: 'Sun & sky', water: 'Water', terrain: 'Terrain & camera' }[sel.id] || 'Environment';
      desc.textContent = 'Global scene settings · apply in real time';
      switches.innerHTML = '';
      cards.innerHTML = environmentCards();
      $('#footer-name').textContent = name.textContent;
      $('#footer-type').textContent = 'Environment';
      return;
    }
    const layer = currentLayer();
    if (!layer) {
      crumb.textContent = sel.tab === 'texture' ? 'Texture' : 'Terrain';
      eyebrow.textContent = sel.tab === 'texture' ? 'Surface' : 'Landscape';
      name.textContent = sel.tab === 'texture' ? 'No texture layer' : 'No terrain layer';
      desc.textContent = 'Add a layer from the stack';
      switches.innerHTML = '';
      cards.innerHTML = '';
      return;
    }
    const t = sel.tab === 'texture' ? textureType(layer.type) : terrainType(layer.type);
    crumb.textContent = sel.tab === 'texture' ? 'Texture' : 'Terrain';
    kind.textContent = 'PROPERTIES';
    eyebrow.textContent = t?.name || layer.type;
    name.textContent = layer.name;
    desc.textContent = t?.blurb || '';
    $('#footer-name').textContent = layer.name;
    $('#footer-type').textContent = t?.name || layer.type;

    // property switches
    const sw = (t?.switches || []);
    if (!sw.length) {
      switches.innerHTML = '<span class="section-label" style="opacity:.55"><span>No toggles for this layer</span><span>Parameters below</span></span>';
    }
    switches.innerHTML = sw.map(s => `<button class="property-switch ${layer.switches?.[s.key] !== false ? 'is-on' : ''}" data-switch="${s.key}" data-layer="${layer.id}" aria-pressed="${layer.switches?.[s.key] !== false}">
      <span class="switch-icon">${icon(s.icon, 16)}</span><span class="switch-name">${s.label}</span><span class="switch-state">${layer.switches?.[s.key] !== false ? 'ON' : 'OFF'}</span></button>`).join('');

    cards.innerHTML = sel.tab === 'texture' ? textureLayerCards(layer) : terrainLayerCards(layer, t);
    if (sel.tab === 'texture') splatPreviewDirty = true;
  }

  function terrainLayerCards(layer, t) {
    const p = layer.params;
    const seed = layer.seed;
    let html = '';
    // shape / hero card
    if (t?.cat === 'shape') {
      html += card('Shape', t.icon, `
        <div class="scattering-top"><div><div class="metric" id="hero-metric">${fmt(p.height ?? 0.5, 2)}<small>height</small></div>
        <p class="muted">${t.blurb}</p></div><span class="small-pill">${t.name}</span></div>
        <div class="art-panel" style="color:${t.color}">${profileSVG(layer.type, seed)}</div>`, 'card-wide');
    } else if (t?.cat === 'erode' && layer.type === 'erosion') {
      html += card('Hydraulic simulation', 'erosion', `
        <div class="scattering-top"><div><div class="metric" id="hero-metric">${Math.round(p.iterations)}<small>iterations</small></div>
        <p class="muted">${t.blurb}</p></div><span class="small-pill">Virtual pipes</span></div>
        <div class="art-panel" style="color:#7fb8c8">${profileSVG('erosion', seed)}</div>`, 'card-wide');
    } else {
      html += card(t?.name || layer.type, t?.icon || 'sliders', `
        <div class="scattering-top"><div><p class="muted" style="margin-top:0">${t?.blurb || ''}</p></div></div>
        <div class="art-panel" style="color:${t?.color || '#999'}">${profileSVG(layer.type, seed)}</div>`, 'card-wide');
    }
    // parameter cards grouped
    const params = t?.params || [];
    const shapeParams = params.filter(pd => ['height', 'depth', 'scale', 'steps', 'radius', 'angle'].includes(pd.key));
    const detailParams = params.filter(pd => !['height', 'depth', 'scale', 'steps', 'radius', 'angle'].includes(pd.key));
    if (shapeParams.length) {
      html += card('Dimensions', 'ruler', shapeParams.map(pd => sliderHTML({
        key: pd.key, min: pd.min, max: pd.max, step: pd.step, value: p[pd.key], digits: pd.digits ?? 0,
        unit: pd.unit || '', lo: pd.lo, hi: pd.hi, target: layer.id,
      })).join(''));
    }
    if (detailParams.length) {
      html += card('Character', 'sliders', detailParams.map(pd => sliderHTML({
        key: pd.key, min: pd.min, max: pd.max, step: pd.step, value: p[pd.key], digits: pd.digits ?? 0,
        unit: pd.unit || '', lo: pd.lo, hi: pd.hi, target: layer.id,
      })).join(''));
    }
    // blend + seed card
    html += card('Blend & seed', 'sparkle', `
      <div class="seg" data-blend-seg="${layer.id}">
        ${BLEND_MODES.map(b => `<button data-blendmode="${b.id}" class="${layer.blend === b.id ? 'is-active' : ''}">${b.label}</button>`).join('')}
      </div>
      ${sliderHTML({ key: '__weight', min: 0, max: 1, step: 0.01, value: layer.weight, label: 'Weight', digits: 2, target: layer.id })}
      <div class="control-line seed"><span>Distribution seed</span><button data-reseed="${layer.id}">${layer.seed}${Icons.reset.replace('<svg ', '<svg width="12" height="12" ')}</button></div>
    `);
    return html;
  }

  function textureLayerCards(layer) {
    const p = layer.params;
    const t = textureType(layer.type);
    const rgb = p.albedo;
    const num = hex => parseInt(hex.replace('#', ''), 16);
    return `
      ${card('Material', t?.icon || 'custom', `
        <div class="scattering-top"><div><div class="metric" style="font-size:30px">${t?.name || 'Custom'}<small>surface</small></div>
        <p class="muted">Albedo, roughness and procedural detail of this surface.</p></div>
        <span class="small-pill">${layer.blend}</span></div>
        <div class="color-row">
          <span class="color-swatch" style="background:${rgb}"><input type="color" value="${rgb}" data-color="${layer.id}" aria-label="Albedo"></span>
          <div style="flex:1">${sliderHTML({ key: 'roughness', min: 0.05, max: 1, step: 0.01, value: p.roughness, label: 'Roughness', digits: 2, target: layer.id })}</div>
        </div>
        ${sliderHTML({ key: 'patternScale', min: 8, max: 400, step: 2, value: p.patternScale, label: 'Pattern scale', unit: ' m', lo: 'Fine grain', hi: 'Broad', target: layer.id })}
        ${sliderHTML({ key: 'patternContrast', min: 0, max: 1, step: 0.01, value: p.patternContrast, label: 'Pattern contrast', digits: 2, lo: 'Flat', hi: 'Varied', target: layer.id })}
        ${sliderHTML({ key: 'normalStrength', min: 0, max: 2, step: 0.05, value: p.normalStrength, label: 'Detail normals', digits: 2, lo: 'Smooth', hi: 'Craggy', target: layer.id })}
      `, 'card-wide')}
      ${card('Coverage', 'mountain', `
        <div class="scattering-top"><div><div class="metric">${fmt(p.heightMin * 100, 0)}–${fmt(p.heightMax * 100, 0)}<small>% height</small></div>
        <p class="muted">Elevation band where this surface appears.</p></div></div>
        ${sliderHTML({ key: 'heightMin', min: 0, max: 1, step: 0.01, value: p.heightMin, label: 'Height min', digits: 2, lo: 'Sea level', target: layer.id })}
        ${sliderHTML({ key: 'heightMax', min: 0, max: 1, step: 0.01, value: p.heightMax, label: 'Height max', digits: 2, lo: 'Summits', target: layer.id })}
        ${sliderHTML({ key: 'slopeMin', min: 0, max: 90, step: 1, value: p.slopeMin, label: 'Slope min', unit: '°', lo: 'Any', target: layer.id })}
        ${sliderHTML({ key: 'slopeMax', min: 0, max: 90, step: 1, value: p.slopeMax, label: 'Slope max', unit: '°', lo: 'Cliffs', target: layer.id })}
      `)}
      ${card('Masking', 'sparkle', `
        ${sliderHTML({ key: 'noiseAmount', min: 0, max: 1, step: 0.01, value: p.noiseAmount, label: 'Noise amount', digits: 2, lo: 'Clean edges', hi: 'Scattered', target: layer.id })}
        ${sliderHTML({ key: 'noiseScale', min: 10, max: 400, step: 5, value: p.noiseScale, label: 'Noise scale', unit: ' m', target: layer.id })}
        ${sliderHTML({ key: 'noiseContrast', min: 0.05, max: 1, step: 0.01, value: p.noiseContrast, label: 'Noise contrast', digits: 2, target: layer.id })}
        ${sliderHTML({ key: 'flowAmount', min: 0, max: 1, step: 0.01, value: p.flowAmount, label: 'River flow mask', digits: 2, lo: 'Ignores flow', hi: 'Only riverbeds', target: layer.id })}
        ${sliderHTML({ key: 'aoMin', min: 0, max: 1, step: 0.01, value: p.aoMin, label: 'Occlusion min', digits: 2, lo: 'Any', hi: 'Creices only', target: layer.id })}
      `)}
      ${card('Blend & seed', 'layers', `
        <div class="seg" data-blend-seg="${layer.id}">
          ${BLEND_MODES.map(b => `<button data-blendmode="${b.id}" class="${layer.blend === b.id ? 'is-active' : ''}">${b.label}</button>`).join('')}
        </div>
        ${sliderHTML({ key: '__weight', min: 0, max: 1, step: 0.01, value: layer.weight, label: 'Weight', digits: 2, target: layer.id })}
        <div class="control-line seed"><span>Distribution seed</span><button data-reseed="${layer.id}">${layer.seed}${Icons.reset.replace('<svg ', '<svg width="12" height="12" ')}</button></div>
      `)}
      <section class="card card-wide" style="--accent:${t?.color || '#999'}">
        <div class="card-heading"><span>${icon('image', 16)}Coverage preview</span><span class="card-off-label" id="splat-status">live</span></div>
        <div class="splat-preview"><canvas id="splat-canvas" width="320" height="320"></canvas><span class="splat-legend">WEIGHT MAP</span></div>
      </section>`;
  }

  /* ── environment inspector ── */
  function environmentCards() {
    const env = state.env;
    if (sel.id === 'sun') {
      return `
      ${card('Sun direction', 'sun', `
        <div class="direction-top"><div><div class="eyebrow">ELEVATION</div><div class="metric" id="m-elev">${fmt(env.sun.elevation, 1)}<small>°</small></div>
        <span class="metric-caption" id="m-elev-cap">${env.sun.elevation < 0 ? 'Below the horizon' : 'Above the horizon'}</span></div>
        <span class="small-pill" id="m-az-pill">${fmt(env.sun.azimuth, 0)}° azimuth</span></div>
        <div class="gizmo" id="sun-gizmo">${sunGizmoSVG(env.sun.azimuth, env.sun.elevation)}</div>
        <div class="direction-controls">
          <label><span>Azimuth</span><div>${fmt(env.sun.azimuth, 0)}<small>°</small></div>${sliderHTML({ key: 'azimuth', min: 0, max: 360, step: 1, value: env.sun.azimuth, target: 'env-sun' })}</label>
          <label><span>Elevation</span><div>${fmt(env.sun.elevation, 1)}<small>°</small></div>${sliderHTML({ key: 'elevation', min: -8, max: 88, step: 0.5, value: env.sun.elevation, target: 'env-sun' })}</label>
        </div>`, 'direction-card')}
      ${card('Illuminance', 'sun', `
        <div class="metric" id="m-int">${fmt(env.sun.intensity, 0)}<small>klux</small></div>
        <p class="muted">Direct sunlight intensity · clear sky is ~108 klux</p>
        ${sliderHTML({ key: 'intensity', min: 0, max: 150, step: 1, value: env.sun.intensity, target: 'env-sun' })}
        <div class="range-labels"><span>0 klux</span><span>150 klux</span></div>`)}
      ${card('Temperature', 'sparkle', `
        <div class="metric" id="m-temp">${fmt(env.sun.temperature, 0)}<small>K</small></div>
        <div class="temperature-track">${sliderHTML({ key: 'temperature', min: 2000, max: 10000, step: 100, value: env.sun.temperature, target: 'env-sun' })}</div>
        <div class="range-labels"><span>Warm</span><span>Cool</span></div>
        <div class="temperature-footer"><span class="color-chip" id="m-temp-chip" style="background:${env.sun.temperature < 4500 ? '#efd0a3' : env.sun.temperature > 7000 ? '#b9d4f3' : '#efe6d3'}"/><span id="m-temp-label">${env.sun.temperature < 4500 ? 'Golden warmth' : env.sun.temperature > 7000 ? 'Cool daylight' : 'Natural daylight'}</span></div>`)}
      ${card('Atmosphere', 'sky', `
        <div class="scattering-top"><div><div class="metric" id="m-ray">${fmt(env.atmosphere.rayleigh, 1)}<small>× rayleigh</small></div>
        <p class="muted">Molecular scattering strength · drives sky blue depth</p></div><span class="small-pill">Single scattering</span></div>
        ${sliderHTML({ key: 'rayleigh', min: 0.5, max: 6, step: 0.1, value: env.atmosphere.rayleigh, target: 'env-atmosphere' })}
        <div class="range-labels"><span>Thin air</span><span>Deep blue</span></div>
        ${sliderHTML({ key: 'mie', min: 0, max: 0.08, step: 0.002, value: env.atmosphere.mie, digits: 3, label: 'Aerosol haze', lo: 'Clear', hi: 'Hazy', target: 'env-atmosphere' })}
        ${sliderHTML({ key: 'fog', min: 0, max: 1.5, step: 0.05, value: env.atmosphere.fog, digits: 2, label: 'Aerial perspective', lo: 'Crystal', hi: 'Heavy', target: 'env-atmosphere' })}
        ${sliderHTML({ key: 'exposure', min: 0.3, max: 2.2, step: 0.05, value: env.atmosphere.exposure, digits: 2, label: 'Exposure', lo: 'Dark', hi: 'Bright', target: 'env-atmosphere' })}`, 'card-wide')}
      `;
    }
    if (sel.id === 'water') {
      return `
      ${card('Water level', 'water', `
        <div class="scattering-top"><div><div class="metric" id="m-level">${fmt(env.water.level, 1)}<small>m</small></div>
        <p class="muted">Surface elevation above the datum · sea plane</p></div><span class="small-pill" id="m-water-state">${env.water.enabled ? 'Visible' : 'Hidden'}</span></div>
        <div class="toggle-row"><span>Enable water plane</span><button class="toggle ${env.water.enabled ? 'on' : ''}" data-water-toggle="${env.water.enabled ? 'off' : 'on'}"><span></span></button></div>
        ${sliderHTML({ key: 'level', min: 0, max: env.terrain.heightScale, step: 1, value: env.water.level, digits: 1, target: 'env-water' })}
        <div class="range-labels"><span>0 m</span><span>${env.terrain.heightScale} m</span></div>`, 'card-wide')}
      ${card('Surface', 'wave', `
        ${sliderHTML({ key: 'ripple', min: 0, max: 1, step: 0.01, value: env.water.ripple, digits: 2, label: 'Ripple strength', lo: 'Still', hi: 'Choppy', target: 'env-water' })}
        ${sliderHTML({ key: 'clarity', min: 0, max: 1, step: 0.01, value: env.water.clarity, digits: 2, label: 'Clarity', lo: 'Turbid', hi: 'Clear', target: 'env-water' })}
        ${sliderHTML({ key: 'foam', min: 0, max: 1, step: 0.01, value: env.water.foam, digits: 2, label: 'Shoreline foam', lo: 'Clean edge', hi: 'Foamy', target: 'env-water' })}`)}`;
    }
    // terrain & camera
    return `
    ${card('Domain', 'ruler', `
      <div class="scattering-top"><div><div class="metric" id="m-world">${fmt(env.terrain.worldSize / 1000, 1)}<small>km</small></div>
      <p class="muted">World extent · terrain tile is square</p></div><span class="small-pill">${env.terrain.resolution}² sim</span></div>
      ${sliderHTML({ key: 'worldSize', min: 1000, max: 9000, step: 250, value: env.terrain.worldSize, digits: 0, unit: ' m', lo: 'Intimate', hi: 'Vast', target: 'env-terrain' })}
      ${sliderHTML({ key: 'heightScale', min: 200, max: 2600, step: 50, value: env.terrain.heightScale, digits: 0, unit: ' m', label: 'Peak elevation', lo: 'Rolling', hi: 'Alpine', target: 'env-terrain' })}
      <div class="control-line"><span>Simulation resolution</span></div>
      <div class="seg" id="res-seg">
        ${[512, 1024, 2048, 4096].map(r => `<button data-res="${r}" class="${env.terrain.resolution === r ? 'is-active' : ''}">${r}²</button>`).join('')}
      </div>
      <p class="muted">Higher resolutions sharpen erosion detail and cost more simulation time.</p>`, 'card-wide')}
    ${card('Camera', 'camera', `
      <div class="scattering-top"><div><div class="metric" id="m-fov">${fmt(env.camera.fov, 0)}<small>° fov</small></div>
      <p class="muted">Vertical field of view · full-frame equivalent</p></div></div>
      ${sliderHTML({ key: 'fov', min: 18, max: 75, step: 1, value: env.camera.fov, digits: 0, unit: '°', target: 'env-camera' })}
      <div class="control-line"><span>View</span><button id="reset-camera">Reset view</button></div>`)}`;
  }

  /* live readout sync for environment sliders (no full re-render while dragging) */
  function syncEnvReadout(target, key, value, digits) {
    const set = (id, html) => { const n = $('#' + id); if (n) n.innerHTML = html; };
    if (target === 'env-sun') {
      const env = state.env;
      if (key === 'azimuth') { set('m-az-pill', `${fmt(env.sun.azimuth, 0)}° azimuth`); }
      if (key === 'elevation') {
        set('m-elev', `${fmt(env.sun.elevation, 1)}<small>°</small>`);
        set('m-elev-cap', env.sun.elevation < 0 ? 'Below the horizon' : 'Above the horizon');
      }
      if (key === 'intensity') set('m-int', `${fmt(env.sun.intensity, 0)}<small>klux</small>`);
      if (key === 'temperature') {
        set('m-temp', `${fmt(env.sun.temperature, 0)}<small>K</small>`);
        const chip = $('#m-temp-chip'), label = $('#m-temp-label');
        if (chip) chip.style.background = env.sun.temperature < 4500 ? '#efd0a3' : env.sun.temperature > 7000 ? '#b9d4f3' : '#efe6d3';
        if (label) label.textContent = env.sun.temperature < 4500 ? 'Golden warmth' : env.sun.temperature > 7000 ? 'Cool daylight' : 'Natural daylight';
      }
      const gizmo = $('#sun-gizmo');
      if (gizmo) gizmo.innerHTML = sunGizmoSVG(env.sun.azimuth, env.sun.elevation);
    }
    if (target === 'env-water' && key === 'level') set('m-level', `${fmt(state.env.water.level, 1)}<small>m</small>`);
    if (target === 'env-terrain') {
      if (key === 'worldSize') set('m-world', `${fmt(state.env.terrain.worldSize / 1000, 1)}<small>km</small>`);
      if (key === 'heightScale') set('m-height', `${fmt(state.env.terrain.heightScale, 0)}<small> m</small>`);
    }
    if (target === 'env-atmosphere' && key === 'rayleigh') set('m-ray', `${fmt(state.env.atmosphere.rayleigh, 1)}<small>× rayleigh</small>`);
    if (target === 'env-camera' && key === 'fov') set('m-fov', `${fmt(state.env.camera.fov, 0)}<small>° fov</small>`);
  }

  function sunGizmoSVG(azimuth, elevation) {
    const az = azimuth * Math.PI / 180, el = elevation * Math.PI / 180;
    const r = 62;
    const cx = 110, cy = 96;
    const x = cx + Math.cos(az) * Math.sin(Math.max(el, 0.02)) * r;
    const y = cy - Math.cos(el) * r * 0.92 - Math.sin(el) * r * 0.35;
    const horizonY = cy;
    let arcs = '';
    for (const e of [15, 30, 45, 60, 75]) {
      const er = e * Math.PI / 180;
      const rx = Math.cos(er) * r, ry = Math.cos(er) * r * 0.92 + Math.sin(er) * r * 0.35;
      arcs += `<ellipse cx="${cx}" cy="${cy}" rx="${rx.toFixed(1)}" ry="${Math.abs(ry).toFixed(1)}" fill="none" stroke="#4a4a4a" stroke-width="1" stroke-dasharray="${e % 30 === 0 ? 'none' : '2 4'}"/>`;
    }
    let spokes = '';
    for (let a = 0; a < 360; a += 30) {
      const ar = a * Math.PI / 180;
      spokes += `<line x1="${cx + Math.cos(ar) * (r - 7)}" y1="${cy + Math.sin(ar) * (r - 7) * 0.92}" x2="${cx + Math.cos(ar) * (r + 4)}" y2="${cy + Math.sin(ar) * (r + 4) * 0.92}" stroke="#4a4a4a" stroke-width="1"/>`;
    }
    const night = elevation < 0;
    return `<svg viewBox="0 0 220 176" role="img" aria-label="Sun direction gizmo">
      <defs><radialGradient id="sg-sky" cx=".5" cy=".35" r=".9"><stop offset="0" stop-color="#2c3448"/><stop offset="1" stop-color="#161616"/></radialGradient></defs>
      <ellipse cx="${cx}" cy="${cy}" rx="${r + 10}" ry="${(r + 10) * 0.92}" fill="url(#sg-sky)" stroke="#3a3a3a"/>
      ${arcs}${spokes}
      <line x1="${cx - r - 12}" y1="${horizonY}" x2="${cx + r + 12}" y2="${horizonY}" stroke="#5a5a5a" stroke-width="1.2"/>
      <text x="${cx - r - 12}" y="${horizonY + 14}" >W</text><text x="${cx + r + 4}" y="${horizonY + 14}">E</text>
      <text x="${cx - 4}" y="${cy - r - 14}">N</text><text x="${cx - 4}" y="${cy + r + 22}">S</text>
      <line x1="${cx}" y1="${cy}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" stroke="#e8b65f" stroke-width="1.3" stroke-dasharray="3 3"/>
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="13" fill="${night ? '#8fa3d8' : '#e8b65f'}" opacity=".16"/>
      <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="5.5" fill="${night ? '#aebde0' : '#f0c878'}"/>
      <text x="${cx}" y="168" text-anchor="middle">${azimuth.toFixed(0)}° · ${elevation.toFixed(1)}°</text>
    </svg>`;
  }

  /* ── splat preview canvas ── */
  async function refreshSplatPreview() {
    const canvas = $('#splat-canvas');
    if (!canvas || sel.tab !== 'texture') return;
    if (!splatPreviewDirty) return;
    splatPreviewDirty = false;
    try {
      const { a, b, res } = await engine.readSplatWeights();
      const layers = state.texture.layers.slice(0, 8);
      const size = 320;
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d');
      const img = ctx.createImageData(size, size);
      const colors = layers.map(l => {
        const n = parseInt(l.params.albedo.replace('#', ''), 16);
        return [(n >> 16 & 255), (n >> 8 & 255), (n & 255)];
      });
      const step = Math.max(1, Math.floor(res / size));
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const sx = Math.min(res - 1, x * step), sy = Math.min(res - 1, y * step);
          const i = (sy * res + sx) * 4;
          const w = [a[i], a[i + 1], a[i + 2], a[i + 3], b[i], b[i + 1], b[i + 2], b[i + 3]];
          let r = 24, g = 26, bch = 30, tot = 0;
          for (let k = 0; k < 8; k++) {
            const wk = w[k] / 255;
            if (k < colors.length && colors[k]) { r += wk * colors[k][0]; g += wk * colors[k][1]; bch += wk * colors[k][2]; }
            tot += wk;
          }
          if (tot > 0.001) { r /= tot; g /= tot; bch /= tot; } else { r = 30; g = 32; bch = 38; }
          const o = (y * size + x) * 4;
          img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = bch; img.data[o + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      const st = $('#splat-status'); if (st) st.textContent = `${res}² bake`;
    } catch (e) {
      const st = $('#splat-status'); if (st) st.textContent = 'unavailable';
    }
  }

  /* ── add-layer dialog ── */
  const dialog = { open: false, step: 1, category: 'Shapes', query: '', pick: null, forTexture: false };
  const CATEGORIES = [
    { label: 'Shapes', icon: 'mountain' }, { label: 'Modifiers', icon: 'warp' }, { label: 'Erosion', icon: 'erosion' },
  ];
  function openDialog(forTexture) {
    dialog.open = true; dialog.forTexture = forTexture; dialog.step = 1; dialog.query = ''; dialog.pick = null;
    dialog.category = forTexture ? 'Materials' : 'Shapes';
    $('#add-layer-backdrop').hidden = false;
    renderDialog();
  }
  function closeDialog() {
    dialog.open = false;
    $('#add-layer-backdrop').hidden = true;
  }
  function renderDialog() {
    $('#construct-track').classList.toggle('show-properties', dialog.step === 2);
    $('#construct-step1').toggleAttribute('inert', dialog.step === 2);
    $('#construct-step2').toggleAttribute('inert', dialog.step === 1);
    $('#ctx-step1').classList.toggle('current', dialog.step === 1);
    $('#ctx-step2').classList.toggle('current', dialog.step === 2);
    $('#ctx-note').textContent = dialog.forTexture ? 'Surface materials' : 'Shape · modify · erode';
    // nav
    const cats = dialog.forTexture
      ? [{ label: 'Materials', icon: 'layers' }]
      : CATEGORIES;
    $('#construct-nav').innerHTML = cats.map(c => `<button data-cat="${c.label}" class="${dialog.category === c.label && !dialog.query ? 'active' : ''}">${icon(c.icon, 16)}${c.label}<small>${catalogueFor(c.label).length}</small></button>`).join('')
      + `<div class="construct-nav-caption">STACK</div><button data-cat="__all" class="${dialog.category === '__all' && !dialog.query ? 'active' : ''}">${icon('layers', 16)}All<small>${catalogueFor('__all').length}</small></button>`;
    // grid
    const items = catalogueFor(dialog.query ? '__all' : dialog.category)
      .filter(i => !dialog.query || i.name.toLowerCase().includes(dialog.query.toLowerCase()));
    $('#construct-section-name').textContent = dialog.query ? 'Search results' : dialog.category === '__all' ? 'All layers' : dialog.category;
    $('#construct-section-count').textContent = items.length ? String(items.length).padStart(2, '0') : '';
    $('#construct-grid').innerHTML = items.map(i => `
      <button class="construct-tile" data-pick="${i.id}">
        ${layerGlyphSVG(i.icon, 62)}
        <strong>${i.name}</strong><span>${i.detail}</span>
        <span class="construct-tile-arrow">${Icons.arrowRight || ''}</span>
      </button>`).join('') || '<p class="construct-no-results">No matching layers.</p>';
    // step 2
    const pick = dialog.pick;
    if (pick) {
      $('#construct-detail-name').textContent = pick.name;
      $('#construct-detail-kind').textContent = dialog.forTexture ? 'NEW TEXTURE LAYER' : 'NEW TERRAIN LAYER';
      const defaults = dialog.forTexture ? textureType(pick.id).defaults : terrainType(pick.id).defaults;
      $('#construct-detail-body').innerHTML = `
        <div class="detail-hero">
          <div style="color:${pick.color}">${layerGlyphSVG(pick.icon, 120)}</div>
          <div><div class="eyebrow">${dialog.forTexture ? 'Surface material' : pick.cat}</div><h3>${pick.name}</h3><p>${pick.blurb || pick.detail}</p></div>
        </div>
        <div class="construct-section-title"><span>Defaults</span><span></span></div>
        <div class="detail-defaults">
          ${Object.entries(defaults).slice(0, 8).map(([k, v]) => `<div><span>${k}</span><b>${typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(2)) : v}</b></div>`).join('')}
        </div>`;
    }
  }
  function catalogueFor(cat) {
    if (dialog.forTexture) return TEXTURE_TYPES.map(t => ({ id: t.id, name: t.name, icon: t.icon, color: t.color, detail: `Albedo ${t.defaults.albedo}` }));
    const all = TERRAIN_TYPES.map(t => ({ id: t.id, name: t.name, icon: t.icon, color: t.color, detail: t.cat, blurb: t.blurb }));
    if (cat === '__all') return all;
    const map = { Shapes: 'shape', Modifiers: 'modify', Erosion: 'erode' };
    return all.filter(t => terrainType(t.id).cat === map[cat]);
  }

  /* ── selection ── */
  function selectTab(tab) {
    sel.tab = tab;
    const layers = tab === 'texture' ? state.texture.layers : state.terrain.layers;
    sel.id = layers.length ? layers[layers.length - 1].id : null;
    renderAll();
  }
  function selectEnvironment(id) {
    sel.tab = 'environment';
    sel.id = id;
    renderAll();
  }
  function selectLayer(id) {
    sel.id = id;
    renderAll();
  }

  /* ── mutations ── */
  const dirtyTerrain = debounce(() => hooks.regenerate(), 260);
  const dirtyTexture = debounce(() => { hooks.rebakeTexture(); splatPreviewDirty = true; refreshSplatPreview(); }, 200);
  function markDirty() {
    hooks.markSaved(false);
    if (sel.tab === 'texture') dirtyTexture(); else dirtyTerrain();
  }

  function moveLayer(layers, id, dir) {
    const i = layers.findIndex(l => l.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= layers.length) return;
    [layers[i], layers[j]] = [layers[j], layers[i]];
    markDirty(); renderStack();
  }
  function deleteLayer(id) {
    const layers = sel.tab === 'texture' ? state.texture.layers : state.terrain.layers;
    const i = layers.findIndex(l => l.id === id);
    if (i < 0) return;
    layers.splice(i, 1);
    if (sel.id === id) sel.id = layers.length ? layers[Math.max(0, i - 1)].id : null;
    markDirty(); renderAll();
  }
  function duplicateLayer(id) {
    const layers = sel.tab === 'texture' ? state.texture.layers : state.terrain.layers;
    const i = layers.findIndex(l => l.id === id);
    if (i < 0) return;
    const copy = JSON.parse(JSON.stringify(layers[i]));
    copy.id = uid(sel.tab === 'texture' ? 'tex' : 'layer');
    copy.name = layers[i].name + ' copy';
    copy.seed = Math.floor(Math.random() * 99999);
    layers.splice(i + 1, 0, copy);
    sel.id = copy.id;
    markDirty(); renderAll();
  }

  /* ── events ── */
  function wire() {
    // world tree
    $('#world-tree').addEventListener('click', e => {
      const row = e.target.closest('[data-row]');
      if (!row) return;
      const entry = WORLD_GROUPS.flatMap(g => g.rows).find(r => r.id === row.dataset.row);
      entry?.action();
    });
    $('#search-input').addEventListener('input', renderWorldTree);
    $('#search-clear').addEventListener('click', () => { $('#search-input').value = ''; renderWorldTree(); });
    $('#add-layer-button').addEventListener('click', () => openDialog(sel.tab === 'texture'));
    $('#add-layer-inline').addEventListener('click', () => openDialog(sel.tab === 'texture'));
    $('#tab-terrain').addEventListener('click', () => selectTab('terrain'));
    $('#tab-texture').addEventListener('click', () => selectTab('texture'));

    // layer stack interactions
    const stack = $('#layerstack');
    stack.addEventListener('click', e => {
      const tool = e.target.closest('[data-tool]');
      if (tool) {
        e.stopPropagation();
        const layers = sel.tab === 'texture' ? state.texture.layers : state.terrain.layers;
        const id = tool.dataset.layer;
        const layer = layers.find(l => l.id === id);
        switch (tool.dataset.tool) {
          case 'visibility': layer.enabled = !layer.enabled; markDirty(); renderAll(); break;
          case 'up': moveLayer(layers, id, 1); break;
          case 'down': moveLayer(layers, id, -1); break;
          case 'duplicate': duplicateLayer(id); break;
          case 'delete': deleteLayer(id); break;
        }
        return;
      }
      const row = e.target.closest('[data-layer]');
      if (row) selectLayer(row.dataset.layer);
    });
    stack.addEventListener('input', e => {
      const w = e.target.closest('[data-weight]');
      if (w) {
        const layers = sel.tab === 'texture' ? state.texture.layers : state.terrain.layers;
        const layer = layers.find(l => l.id === w.dataset.weight);
        if (layer) { layer.weight = +w.value; w.style.setProperty('--progress', `${layer.weight * 100}%`); markDirty(); }
      }
    });
    stack.addEventListener('change', e => {
      const b = e.target.closest('[data-blend]');
      if (b) {
        const layers = sel.tab === 'texture' ? state.texture.layers : state.terrain.layers;
        const layer = layers.find(l => l.id === b.dataset.blend);
        if (layer) { layer.blend = b.value; markDirty(); }
      }
    });
    // drag reorder
    let dragId = null;
    stack.addEventListener('dragstart', e => {
      const row = e.target.closest('[data-layer]');
      if (!row) return;
      dragId = row.dataset.layer;
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
    });
    stack.addEventListener('dragend', e => {
      e.target.closest?.('[data-layer]')?.classList.remove('dragging');
      $$('.layer-row').forEach(r => r.classList.remove('drop-above', 'drop-below'));
      dragId = null;
    });
    stack.addEventListener('dragover', e => {
      e.preventDefault();
      const row = e.target.closest('[data-layer]');
      $$('.layer-row').forEach(r => r.classList.remove('drop-above', 'drop-below'));
      if (!row || row.dataset.layer === dragId) return;
      const rect = row.getBoundingClientRect();
      row.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-above' : 'drop-below');
    });
    stack.addEventListener('drop', e => {
      e.preventDefault();
      const row = e.target.closest('[data-layer]');
      if (!row || !dragId || row.dataset.layer === dragId) return;
      const layers = sel.tab === 'texture' ? state.texture.layers : state.terrain.layers;
      const from = layers.findIndex(l => l.id === dragId);
      let to = layers.findIndex(l => l.id === row.dataset.layer);
      const rect = row.getBoundingClientRect();
      const above = e.clientY < rect.top + rect.height / 2;
      const [moved] = layers.splice(from, 1);
      to = layers.findIndex(l => l.id === row.dataset.layer);
      layers.splice(above ? to : to + 1, 0, moved);
      markDirty(); renderStack();
    });

    // inspector: sliders, switches, blend segments, colors, reseeds, sun gizmo
    const cards = $('#property-cards');
    cards.addEventListener('input', e => {
      const input = e.target;
      if (input.dataset.param) {
        input.style.setProperty('--progress', `${((input.value - input.min) / (input.max - input.min)) * 100}%`);
        const target = input.dataset.target;
        const key = input.dataset.param;
        if (target === 'env-sun') { state.env.sun[key] = +input.value; hooks.envChanged(); renderInspector(); updateSunStrip(); return; }
        if (target === 'env-water') { state.env.water[key] = +input.value; hooks.envChanged(); renderInspector(); return; }
        if (target === 'env-atmosphere') { state.env.atmosphere[key] = +input.value; hooks.envChanged(); return; }
        if (target === 'env-terrain') { state.env.terrain[key] = +input.value; hooks.envChanged(); renderInspector(); return; }
        if (target === 'env-camera') { state.env.camera[key] = +input.value; hooks.envChanged(); return; }
        const layer = currentLayer();
        if (!layer) return;
        if (key === '__weight') { layer.weight = +input.value; }
        else { layer.params[key] = +input.value; renderInspectorHeader(layer); }
        markDirty();
      }
      if (input.dataset.color) {
        const layer = state.texture.layers.find(l => l.id === input.dataset.color);
        if (layer) { layer.params.albedo = input.value; input.closest('.color-swatch').style.background = input.value; markDirty(); }
      }
    });
    cards.addEventListener('change', e => {
      if (e.target.dataset.color) { /* handled on input */ }
    });
    // property toggles live in their own strip above the cards
    $('#property-switches').addEventListener('click', e => {
      const sw = e.target.closest('[data-switch]');
      if (!sw) return;
      const layer = (sel.tab === 'texture' ? state.texture.layers : state.terrain.layers).find(l => l.id === sw.dataset.layer);
      if (!layer) return;
      layer.switches = layer.switches || {};
      layer.switches[sw.dataset.switch] = layer.switches[sw.dataset.switch] === false;
      markDirty(); renderInspector();
    });
    cards.addEventListener('click', e => {
      const bm = e.target.closest('[data-blendmode]');
      if (bm) {
        const layer = currentLayer();
        if (layer) { layer.blend = bm.dataset.blendmode; markDirty(); renderInspector(); renderStack(); }
        return;
      }
      const reseed = e.target.closest('[data-reseed]');
      if (reseed) {
        const layer = currentLayer();
        if (layer) { layer.seed = Math.floor(Math.random() * 99999); markDirty(); renderInspector(); }
        return;
      }
      const wt = e.target.closest('[data-water-toggle]');
      if (wt) {
        state.env.water.enabled = wt.dataset.waterToggle === 'on';
        hooks.envChanged(); renderInspector();
        return;
      }
      if (e.target.closest('#reset-camera')) { engine?.resetCamera(); return; }
      const res = e.target.closest('[data-res]');
      if (res) {
        state.env.terrain.resolution = +res.dataset.res;
        hooks.resolutionChanged();
        renderInspector();
        return;
      }
    });
    // sun gizmo drag
    cards.addEventListener('pointerdown', e => {
      const gizmo = e.target.closest('#sun-gizmo');
      if (!gizmo) return;
      const move = ev => {
        const rect = gizmo.getBoundingClientRect();
        const svg = gizmo.querySelector('svg');
        const vb = svg.viewBox.baseVal;
        const px = (ev.clientX - rect.left) / rect.width * vb.width;
        const py = (ev.clientY - rect.top) / rect.height * vb.height;
        const cx = 110, cy = 96, r = 62;
        const dx = px - cx, dy = py - cy;
        let az = Math.atan2(dy / 0.92, dx) * 180 / Math.PI;
        az = (az + 450) % 360;
        const rad = Math.hypot(dx, dy / 0.92);
        const el = clamp(90 - (rad / r) * 90, -8, 88);
        state.env.sun.azimuth = Math.round(az);
        state.env.sun.elevation = Math.round(el * 2) / 2;
        hooks.envChanged();
        // light-weight live update while dragging (no full re-render)
        syncEnvReadout('env-sun', 'azimuth', state.env.sun.azimuth);
        syncEnvReadout('env-sun', 'elevation', state.env.sun.elevation);
        $$('.direction-controls label').forEach((label, i) => {
          const strong = label.querySelector('strong');
          if (strong) strong.innerHTML = i === 0
            ? `${fmt(state.env.sun.azimuth, 0)}<small>°</small>`
            : `${fmt(state.env.sun.elevation, 1)}<small>°</small>`;
        });
        updateSunStrip();
      };
      const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      move(e);
    });

    // dialog
    $('#construct-close').addEventListener('click', closeDialog);
    $('#add-layer-backdrop').addEventListener('pointerdown', e => { if (e.target === e.currentTarget) closeDialog(); });
    $('#construct-back').addEventListener('click', () => { dialog.step = 1; renderDialog(); });
    $('#construct-search').addEventListener('input', e => { dialog.query = e.target.value; renderDialog(); });
    $('#construct-nav').addEventListener('click', e => {
      const b = e.target.closest('[data-cat]');
      if (b) { dialog.category = b.dataset.cat; dialog.query = ''; $('#construct-search').value = ''; renderDialog(); }
    });
    $('#construct-grid').addEventListener('click', e => {
      const tile = e.target.closest('[data-pick]');
      if (!tile) return;
      const item = catalogueFor(dialog.query ? '__all' : dialog.category).find(i => i.id === tile.dataset.pick)
        || catalogueFor('__all').find(i => i.id === tile.dataset.pick);
      dialog.pick = item; dialog.step = 2; renderDialog();
    });
    $('#construct-submit').addEventListener('click', () => {
      if (!dialog.pick) return;
      const id = dialog.pick.id;
      if (dialog.forTexture) {
        const { createTextureLayer } = hooks.refs;
        const layer = createTextureLayer(id);
        state.texture.layers.push(layer);
        sel.tab = 'texture'; sel.id = layer.id;
      } else {
        const { createTerrainLayer } = hooks.refs;
        const layer = createTerrainLayer(id);
        state.terrain.layers.push(layer);
        sel.tab = 'terrain'; sel.id = layer.id;
      }
      closeDialog();
      markDirty(); renderAll();
    });
    window.addEventListener('keydown', e => {
      if (e.key === 'Escape' && dialog.open) { e.stopPropagation(); closeDialog(); }
      if (e.shiftKey && e.code === 'KeyA' && !/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) && !e.target.isContentEditable && !dialog.open) {
        e.preventDefault(); openDialog(sel.tab === 'texture');
      }
    });

    // header actions
    $('#enabled-pill').addEventListener('click', () => {
      const layer = currentLayer();
      if (!layer || sel.tab === 'environment') return;
      layer.enabled = !layer.enabled;
      markDirty(); renderAll();
    });
    $('#reset-button').addEventListener('click', () => {
      const layer = currentLayer();
      if (!layer) return;
      const t = sel.tab === 'texture' ? textureType(layer.type) : terrainType(layer.type);
      layer.params = { ...t.defaults };
      markDirty(); renderInspector();
    });
    $('#object-name').addEventListener('dblclick', () => {
      const layer = currentLayer();
      if (!layer) return;
      const h1 = $('#object-name');
      const input = el('input');
      input.value = layer.name;
      input.style.cssText = 'font:inherit;font-size:31px;letter-spacing:-1.3px;background:#1c1c1c;border:1px solid #3d3d3d;border-radius:8px;color:#ececec;padding:2px 8px;width:100%';
      h1.replaceWith(input);
      input.focus(); input.select();
      const commit = () => {
        layer.name = input.value.trim() || layer.name;
        hooks.markSaved(false);
        renderAll();
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', ev => { if (ev.key === 'Enter') input.blur(); });
    });
    $('#save-status').addEventListener('click', () => hooks.saveProject());
  }

  function renderInspectorHeader(layer, key, digits) {
    // light update of readouts without a full re-render (keeps slider focus)
    const cards = $('#property-cards');
    if (!cards) return;
    const sliders = cards.querySelectorAll('input[type=range][data-param]');
    sliders.forEach(s => {
      const k = s.dataset.param;
      if (s.dataset.target?.startsWith('env-')) return;
      let value;
      if (k === '__weight') value = layer.weight;
      else value = layer.params[k];
      if (value === undefined) return;
      const d = s.step.includes('.') ? s.step.split('.')[1].length : (digits ?? 0);
      const row = s.closest('label');
      const strong = row?.querySelector('.control-line strong');
      if (strong) strong.innerHTML = `${fmt(value, d)}<small></small>`;
    });
    // hero metric for shape/erosion cards
    const hero = $('#hero-metric');
    if (hero && layer) {
      const t = terrainType(layer.type);
      const heroKey = t?.cat === 'shape' ? 'height' : (layer.type === 'erosion' ? 'iterations' : null);
      if (heroKey && layer.params[heroKey] !== undefined) {
        const unit = heroKey === 'iterations' ? 'iterations' : 'height';
        hero.innerHTML = heroKey === 'iterations'
          ? `${Math.round(layer.params.iterations)}<small>iterations</small>`
          : `${fmt(layer.params.height, 2)}<small>height</small>`;
      }
    }
  }

  function updateSunStrip() {
    const env = state.env;
    $('#quick-azimuth').value = env.sun.azimuth;
    $('#quick-elevation').value = env.sun.elevation;
    $('#sun-strip-value').textContent = `${fmt(env.sun.azimuth, 0)}° · ${fmt(env.sun.elevation, 1)}°`;
  }

  function renderAll() {
    renderWorldTree();
    renderStack();
    renderInspector();
    updateEnabledPill();
    if (sel.tab === 'texture') refreshSplatPreview();
  }
  function updateEnabledPill() {
    const layer = currentLayer();
    const pill = $('#enabled-pill'), label = $('#enabled-label');
    if (!layer || sel.tab === 'environment') {
      pill.classList.add('disabled');
      label.textContent = sel.tab === 'environment' ? 'Scene' : 'No layer';
      return;
    }
    pill.classList.toggle('disabled', !layer.enabled);
    label.textContent = layer.enabled ? 'Enabled' : 'Disabled';
  }

  /* ── viewport overlay ── */
  const VIEW_MODES = [
    { id: 0, label: 'Shaded' }, { id: 1, label: 'Albedo' }, { id: 2, label: 'Normals' },
    { id: 3, label: 'Height' }, { id: 4, label: 'Slope' }, { id: 5, label: 'AO' },
    { id: 6, label: 'Flow' }, { id: 7, label: 'Splat' },
  ];
  function wireViewport() {
    const modes = $('#view-modes');
    modes.innerHTML = VIEW_MODES.map(m => `<button data-mode="${m.id}" class="${state.view.mode === m.id ? 'is-active' : ''}">${m.label}</button>`).join('');
    modes.addEventListener('click', e => {
      const b = e.target.closest('[data-mode]');
      if (!b) return;
      state.view.mode = +b.dataset.mode;
      $$('#view-modes button').forEach(x => x.classList.toggle('is-active', x === b));
    });
    $('#toggle-shadows').addEventListener('click', () => {
      state.view.shadows = !state.view.shadows;
      $('#toggle-shadows').setAttribute('aria-pressed', String(state.view.shadows));
    });
    $('#toggle-water').addEventListener('click', () => {
      state.env.water.enabled = !state.env.water.enabled;
      $('#toggle-water').setAttribute('aria-pressed', String(state.env.water.enabled));
      hooks.envChanged();
    });
    $('#quick-azimuth').addEventListener('input', e => { state.env.sun.azimuth = +e.target.value; updateSunStrip(); hooks.envChanged(); });
    $('#quick-elevation').addEventListener('input', e => { state.env.sun.elevation = +e.target.value; updateSunStrip(); hooks.envChanged(); });
    $('#generate-button').addEventListener('click', () => hooks.regenerate(true));
    if (engine) engine.onStats = ({ fps, tris, res }) => {
      $('#stats-pill').innerHTML = `<b>${fps}</b> fps<span class="stats-sep"></span><b>${(tris / 1000).toFixed(0)}k</b> tris<span class="stats-sep"></span><b>${res}²</b>`;
    };
  }
  function setProgress(fraction, label) {
    const wrap = $('#generate-progress');
    if (fraction >= 1) { wrap.hidden = true; return; }
    wrap.hidden = false;
    $('#generate-progress-fill').style.width = `${Math.round(fraction * 100)}%`;
    $('#generate-progress-label').textContent = label || 'Simulating…';
  }

  /* ── boot ── */
  $('#brand-symbol').innerHTML = Icons.layers.replace('<svg ', '<svg width="24" height="24" ');
  $('#add-layer-button').innerHTML = Icons.plus.replace('<svg ', '<svg width="17" height="17" ');
  $('#search-icon').innerHTML = Icons.search.replace('<svg ', '<svg width="15" height="15" ');
  $('#search-clear').innerHTML = Icons.x.replace('<svg ', '<svg width="13" height="13" ');
  $('#world-icon').innerHTML = layerGlyphSVG('mountain', 18);
  $('#reset-icon') && ($('#reset-icon').innerHTML = Icons.reset.replace('<svg ', '<svg width="14" height="14" '));
  $('#construct-emblem').innerHTML = Icons.layers.replace('<svg ', '<svg width="19" height="19" ');
  $('#construct-close').innerHTML = Icons.x.replace('<svg ', '<svg width="17" height="17" ');
  $('#construct-search-icon').innerHTML = Icons.search.replace('<svg ', '<svg width="15" height="15" ');
  $('#construct-back').querySelector('.back-arrow').innerHTML = Icons.arrowLeft.replace('<svg ', '<svg width="15" height="15" ');
  $('.save-check').innerHTML = Icons.check.replace('<svg ', '<svg width="12" height="12" ');
  wire();
  wireViewport();
  updateSunStrip();
  renderAll();
  if (!sel.id) selectLayer((sel.tab === 'texture' ? state.texture.layers : state.terrain.layers)[0]?.id || null);

  return {
    selectTab, selectEnvironment, selectLayer, renderAll, renderInspector, renderStack,
    setProgress, updateSunStrip,
    get selection() { return sel; },
    refreshSplatPreview: () => { splatPreviewDirty = true; refreshSplatPreview(); },
  };
}
