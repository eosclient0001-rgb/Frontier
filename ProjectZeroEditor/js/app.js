/*==============================================================================================================================
  APP — EditorHost.cpp's seams: the tab band over the three docked panels and the project window, the two column splitters
  (Outliner 316, clamp .15–.34 · Inspector 340, clamp .18–.38), the keys the native host listens for (Tab compacts the
  outliner, Ctrl+Shift+F lands on the search, Shift+A raises Construct, Alt+S / Alt+P run the world, Esc puts it back), the
  Control Centre shade behind the viewport gear, and the toasts.
==============================================================================================================================*/

const App = (() => {
  const state = {
    fps: 60, tris: 138420, quality: 'Standard',
    sun: 5.2, moons: 1,
    camera: { yaw: 138.6, pitch: 24.1, dist: 14.5 },
    picked: null,
    docks: { left: true, right: true, viewport: true },
    outlinerFlex: null, inspectorFlex: null,
    shade: false
  };

  /*────────────────────────────────────────── toasts ───────────────────────────────────────────*/
  const toasts = [];
  function toast(title, body) {
    toasts.push({ title, body, at: performance.now() });
    const box = document.getElementById('toasts');
    const node = el('div', 'toast');
    node.append(el('div', 't', title), el('div', 'b', body || ''));
    box.appendChild(node);
    setTimeout(() => node.remove(), 2600);
    if (toasts.length > 3) { toasts.shift(); box.firstChild && box.firstChild.remove(); }
  }

  /*────────────────────────────────────────── the tab band ─────────────────────────────────────*/
  function tab(label, active, onPick, onClose, title) {
    const t = el('div', 'tab' + (active ? ' is-active' : ''), `<span>${label}</span>`);
    t.onclick = onPick;
    t.title = title || label;
    if (onClose) {
      const x = el('span', 'tab-close', '✕');
      x.onclick = (e) => { e.stopPropagation(); onClose(); };
      t.appendChild(x);
    }
    return t;
  }
  function renderTabs() {
    const left = document.getElementById('tabdock-left');
    const centre = document.getElementById('tabdock-centre');
    const right = document.getElementById('tabdock-right');
    left.replaceChildren(); centre.replaceChildren(); right.replaceChildren();
    if (state.docks.left) left.appendChild(tab('Outliner', state.picked !== null, () => { }, () => toggleDock('left'), 'Outliner'));
    const add = el('button', 'tab-add', icon('plus', 13));
    add.title = 'Construct  (Shift A)';
    add.onclick = () => Construct.open();
    left.appendChild(add);
    centre.appendChild(tab(`${SCENE.project} — ${SCENE.name}`, false, () => toast('Project', `${SCENE.project} · ${SCENE.name} · ${SCENE.rows.length} rows`), null, 'Project window'));
    right.appendChild(tab('Viewport', false, () => { }, () => toggleDock('viewport'), 'Viewport'));
    if (state.docks.right) right.appendChild(tab('Inspector', state.picked !== null, () => { }, () => toggleDock('right'), 'Inspector'));
  }

  function toggleDock(which) {
    state.docks[which] = !state.docks[which];
    document.getElementById('panel-outliner').classList.toggle('is-hidden', !state.docks.left);
    document.getElementById('panel-inspector').classList.toggle('is-hidden', !state.docks.right);
    document.getElementById('panel-viewport').classList.toggle('is-hidden', !state.docks.viewport);
    document.getElementById('splitter-left').style.display = state.docks.left ? '' : 'none';
    document.getElementById('splitter-right').style.display = state.docks.right ? '' : 'none';
    renderTabs();
    Viewport.renderRail();
    setTimeout(() => Viewport.paintPlate(), 0);
  }

  /*────────────────────────────────────────── selection ────────────────────────────────────────*/
  function select(index) {
    state.picked = index;
    Inspector.render();
    renderTabs();
    if (index !== null && SCENE.rows[index]) {
      const row = SCENE.rows[index];
      document.getElementById('panel-inspector').scrollTop = 0;
      Viewport.state.samples = Math.max(1, Math.round(Viewport.state.samples / 2));
    }
  }
  const FAMILY = {
    'Atmosphere':'Environment', 'Sky Atmosphere':'Environment', 'Star Field':'Environment', 'Atlas':'Environment',
    'Wind Field':'Environment', 'Clouds':'Environment', 'Precipitation':'Environment', 'Lens Flare':'Environment', 'Optics':'Environment',
    'Tyre':'Tyres & Wheels', 'Carcass':'Tyres & Wheels', 'Tread':'Tyres & Wheels', 'XPBD Lattice':'Tyres & Wheels',
    'Rim':'Tyres & Wheels', 'Wheel Assembly':'Tyres & Wheels', 'Brake Disc':'Tyres & Wheels', 'Suspension':'Vehicles',
    'Car Body':'Vehicles', 'Chassis':'Vehicles', 'Engine':'Vehicles', 'Gearbox':'Vehicles', 'Truck':'Vehicles', 'Motorcycle':'Vehicles',
    'Cloth Panel':'Cloth & Soft', 'Rope':'Cloth & Soft', 'Soft Body':'Cloth & Soft', 'Flag':'Cloth & Soft', 'Deformable':'Cloth & Soft',
    'Main Camera':'Cameras', 'Cine Camera (35mm)':'Cameras', 'Cine Camera (50mm)':'Cameras', 'Cine Camera (85mm)':'Cameras',
    'Post Process Volume':'Cameras', 'Directional Light (Sun)':'Lights', 'Point Light':'Lights', 'Spot Light':'Lights', 'Rect / Area Light':'Lights',
    'Cube / Box':'Geometry', 'Sphere':'Geometry', 'Cylinder':'Geometry', 'Cone':'Geometry', 'Torus':'Geometry',
    'Plane / Ground':'Geometry', 'Terrain':'Geometry', 'Foliage':'Geometry', 'Material':'Geometry', 'Shader Ball':'Geometry'
  };
  const SHEET_FOR = {
    'Atmosphere':'environment', 'Sky Atmosphere':'sky', 'Star Field':'stars', 'Atlas':'moons', 'Wind Field':'wind',
    'Clouds':'clouds', 'Precipitation':'precipitation', 'Lens Flare':'lensflare', 'Optics':'rainbow',
    'Tyre':'tyre', 'Carcass':'tyre', 'Tread':'tyreTread', 'XPBD Lattice':'tyreLattice', 'Rim':'rim',
    'Wheel Assembly':'wheel', 'Brake Disc':'material', 'Suspension':'wheel', 'Car Body':'vehicle', 'Chassis':'chassis',
    'Engine':'engineSheet', 'Gearbox':'engineSheet', 'Truck':'vehicle', 'Motorcycle':'vehicle',
    'Cloth Panel':'cloth', 'Rope':'rope', 'Soft Body':'softBody', 'Flag':'cloth', 'Deformable':'softBody',
    'Main Camera':'camera', 'Cine Camera (35mm)':'cameraRig', 'Cine Camera (50mm)':'cameraRig',
    'Cine Camera (85mm)':'cameraRig', 'Post Process Volume':'postVolume',
    'Directional Light (Sun)':'sun', 'Point Light':'pointLight', 'Spot Light':'spotLight', 'Rect / Area Light':'areaLight'
  };
  function add(label, sheetName, iconName) {
    /* the label the catalogue names may already be seated: the new one takes the next free numeral */
    let unique = label, n = 2;
    while (SCENE.rows.some(r => r.label === unique)) unique = `${label} ${n++}`;
    label = unique;
    const ownerLabel = FAMILY[unique.replace(/ \d+$/, '')] || null;
    let at = SCENE.rows.length;
    if (ownerLabel) {
      const owner = SCENE.rows.findIndex(r => r.label === ownerLabel);
      if (owner >= 0) { at = owner + 1; while (at < SCENE.rows.length && SCENE.rows[at].depth > 0) at++; }
    }
    const row = {
      key: 'k' + (0x200000000 + SCENE.rows.length).toString(16),
      label, depth: ownerLabel ? 1 : 0, category: 'Geometry',
      tint: (SCENE.rows.find(r => r.label === ownerLabel && r.depth === 1) ||
             SCENE.rows.find(r => r.label === ownerLabel) || { tint: '#c9d2dc' }).tint,
      icon: iconName || 'cube', visible: true, meta: 'new', narrowing: 'Geometry',
      sheet: sheetName || SHEET_FOR[unique.replace(/ \d+$/, '')] || 'material'
    };
    SCENE.rows.splice(at, 0, row);
    repaintAll();
    select(SCENE.rows.indexOf(row));
    toast('Added', `${label} — seated in the roster.`);
  }

  /*────────────────────────────────────────── the shade ────────────────────────────────────────*/
  const shadeTiles = [
    ['Global Illumination', '2 Bounces', true], ['Reflections', 'Raytraced', true],
    ['Anti-Aliasing', '', true], ['FPS Overlay', '', false],
    ['Notifications', '', true], ['Quality', state.quality, true],
    ['Patch Geometry', 'Off', false], ['Raytracing', '', true]
  ];
  function renderShade() {
    const shade = document.getElementById('shade');
    shade.hidden = !state.shade;
    if (!state.shade) return;
    shade.replaceChildren();
    const sheet = el('div', 'shade-sheet');
    const head = el('div', 'head');
    head.appendChild(el('span', null, 'Control Centre'));
    const gear = el('span', 'gear', icon('gear', 14));
    sheet.appendChild(head);
    const tiles = el('div', 'shade-tiles');
    shadeTiles.forEach(([label, value, on], i) => {
      const tile = el('div', 'shade-tile' + (on ? '' : ' is-off'));
      const orb = el('div', 'orb', icon(i === 0 ? 'sun' : i === 1 ? 'bounce' : i === 2 ? 'galaxy' : i === 3 ? 'gear' : i === 4 ? 'flag' : i === 5 ? 'sliders' : i === 6 ? 'mesh' : 'orbit', 20));
      tile.append(orb, el('div', 'k', label));
      if (value) tile.appendChild(el('div', 'v', value));
      tile.onclick = () => {
        shadeTiles[i][2] = !shadeTiles[i][2];
        renderShade();
        toast('Render settings applied', `${label} ${shadeTiles[i][2] ? 'on' : 'off'}`);
      };
      tiles.appendChild(tile);
    });
    sheet.appendChild(tiles);
    const scale = el('div', 'shade-scale');
    const track = el('div', 'track');
    track.style.background = 'rgba(0,0,0,.5)';
    const fill = el('i');
    const val = el('div', 'val', '100%');
    let pct = 1;
    const paint = () => { fill.style.width = (pct * 100) + '%'; val.textContent = Math.round(pct * 100) + '%'; };
    const knob = el('b');
    track.append(fill, knob);
    const move = (e) => {
      const r = track.getBoundingClientRect();
      pct = clamp((e.clientX - r.left) / r.width, 0.25, 1);
      fill.style.width = (pct * 100) + '%';
      knob.style.left = (pct * 100) + '%';
      val.textContent = Math.round(pct * 100) + '%';
    };
    track.onpointerdown = (e) => { capture(track, e); move(e); track.onpointermove = move; track.onpointerup = () => { track.onpointermove = null; }; };
    const glyph = el('span', null, icon('exposure', 18));
    scale.append(glyph, track, val);
    sheet.appendChild(scale);
    shade.appendChild(sheet);
    shade.onclick = (e) => { if (e.target === shade) toggleShade(); };
    paint();
  }
  function toggleShade() { state.shade = !state.shade; renderShade(); Viewport.renderRail(); }

  /*────────────────────────────────────────── transport ────────────────────────────────────────*/
  function setTransport(mode) {
    Viewport.state.transport = mode;
    Viewport.state.paused = false;
    if (mode === 'edit') Viewport.state.realtime = true;
    toast(mode === 'edit' ? 'Edit' : mode === 'simulate' ? 'Simulate' : 'Play',
      mode === 'edit' ? 'The editor owns the world.' : mode === 'simulate' ? 'The world runs; the editor camera stays.' : 'The world runs through a scene camera.');
    Viewport.renderRail();
  }
  function setPaused(paused) {
    if (Viewport.state.transport === 'edit') return;
    Viewport.state.paused = paused;
    Viewport.renderRail();
  }
  function step() { if (Viewport.state.transport === 'edit') setTransport('simulate'); Viewport.state.paused = true; Viewport.state.samples = Math.max(1, Viewport.state.samples); Viewport.renderRail(); toast('Step', 'One frame advanced.'); }

  /*────────────────────────────────────────── the splitters ────────────────────────────────────*/
  function mountSplitters() {
    const columns = document.getElementById('columns');
    const drag = (handle, panel, side) => {
      handle.onpointerdown = (e) => {
        handle.setPointerCapture(e.pointerId);
        const total = columns.clientWidth;
        const move = (ev) => {
          const frac = side === 'left' ? ev.clientX / total : (total - ev.clientX) / total;
          const clamped = side === 'left' ? clamp(frac, 0.15, 0.34) : clamp(frac, 0.18, 0.38);
          const px = Math.round(total * clamped);
          if (side === 'left') { state.outlinerFlex = `${px}px`; panel.style.flex = `0 0 ${px}px`; }
          else { state.inspectorFlex = `${px}px`; panel.style.flex = `0 0 ${px}px`; }
        };
        handle.onpointermove = move;
        handle.onpointerup = () => { handle.onpointermove = null; };
      };
    };
    drag(document.getElementById('splitter-left'), document.getElementById('panel-outliner'), 'left');
    drag(document.getElementById('splitter-right'), document.getElementById('panel-inspector'), 'right');
  }

  /*────────────────────────────────────────── the keys ─────────────────────────────────────────*/
  function keys() {
    window.addEventListener('keydown', (e) => {
      const typing = /input|textarea/i.test(document.activeElement.tagName);
      if (e.key === 'Escape') {
        const field = document.activeElement;
        if (typing && field.closest && field.closest('.console')) { Viewport.state.consoleOpen = false; Viewport.renderConsole(); }
        else if (Construct.isOpen()) { if (!Construct.back()) Construct.close(); }
        else if (state.shade) toggleShade();
        else setTransport('edit');
        e.preventDefault(); return;
      }
      if (e.key === 'Tab' && !typing) {
        Outliner.state.compact = !Outliner.state.compact;
        document.body.classList.toggle('is-compact', Outliner.state.compact);
        Outliner.render(); e.preventDefault(); return;
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'f') {
        const field = document.querySelector('.out-search input');
        field && field.focus(); e.preventDefault(); return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        Viewport.state.consoleOpen = !Viewport.state.consoleOpen;
        Viewport.renderConsole();
        const input = document.querySelector('.console input');
        input && input.focus();
        e.preventDefault(); return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'r') { Viewport.state.realtime = !Viewport.state.realtime; Viewport.renderRail(); e.preventDefault(); return; }
      if (typing) return;
      if (e.shiftKey && e.key.toLowerCase() === 'a') { Construct.open(); e.preventDefault(); return; }
      if (e.altKey && e.key.toLowerCase() === 's') { setTransport(Viewport.state.transport === 'simulate' ? 'edit' : 'simulate'); e.preventDefault(); return; }
      if (e.altKey && e.key.toLowerCase() === 'p') { setTransport(Viewport.state.transport === 'play' ? 'edit' : 'play'); e.preventDefault(); return; }
      if (e.key.toLowerCase() === 'p' && Viewport.state.transport !== 'edit') { setPaused(!Viewport.state.paused); return; }
      if (e.key === '.' && Viewport.state.transport !== 'edit') { step(); return; }
      if (e.shiftKey && e.key.toLowerCase() === 's') { toggleShade(); }
    });
  }

  /*────────────────────────────────────────── the tick ─────────────────────────────────────────*/
  function tick() {
    state.fps = Math.round(clamp(60 - Math.random() * 4 + (Viewport.state.transport === 'edit' ? 0 : -6), 12, 62));
    if (Viewport.state.realtime) Viewport.state.samples = Math.min(Viewport.state.target_samples, Viewport.state.samples + 2);
    if (Viewport.state.transport !== 'edit' && !Viewport.state.paused) state.sun = (state.sun + 0.02) % 360;
    const ol = document.querySelector('#outliner-body .foot');
    const vp = document.querySelector('#viewport-body .foot');
    const ins = document.querySelector('#inspector-body .foot');
    state.camera = { yaw: Viewport.state.orbit.yaw * 57.29578, pitch: Viewport.state.orbit.pitch * 57.29578, dist: Viewport.state.orbit.dist };
    ol && ol.replaceWith(Outliner.foot());
    vp && vp.replaceWith(Viewport.foot());
    ins && ins.replaceWith(Inspector.foot());
    const status = document.querySelector('.rail .statuspill .num');
    if (status) status.textContent = String(Viewport.state.samples);
  }

  function repaintAll() { Outliner.render(); Inspector.render(); Viewport.paintPlate(); renderTabs(); }

  /*────────────────────────────────────────── boot ─────────────────────────────────────────────*/
  function boot() {
    Outliner.mount(document.getElementById('outliner-body'));
    Viewport.mount(document.getElementById('viewport-body'));
    Inspector.mount(document.getElementById('inspector-body'));
    Construct.mount({
      scrim: document.getElementById('construct-scrim'),
      root: document.getElementById('construct'),
      slide: document.getElementById('construct-slide'),
      groups: document.getElementById('construct-groups'),
      tiles: document.getElementById('construct-tiles'),
      search: document.getElementById('construct-search'),
      crumb: document.getElementById('construct-crumb'),
      props: document.getElementById('construct-properties'),
      subject: document.getElementById('construct-subject'),
      back: document.getElementById('construct-back'),
      close: document.getElementById('construct-close')
    });
    renderTabs();
    mountSplitters();
    keys();
    select(2);                       /* the Sun opens the bench */
    setInterval(tick, 1000);
  }

  document.addEventListener('DOMContentLoaded', boot);
  return {
    state, select, add, toggleDock, toggleShade, setTransport, setPaused, step, toast, renderTabs, repaintAll, boot,
    get picked() { return state.picked; },
    onWorldChanged() { Viewport.state.samples = 1; }
  };
})();

window.App = App;
