/*==============================================================================================================================
  VIEWPORT — ViewportPanel.cpp. The 44 px rail over its 2 px convergence hairline (brand tile · dock pair · Add · the
  Edit|Simulate|Play mode pill with its run-only pause/step/stop · projection · markers · the Live/Static/Held status with
  its sample count · gear), the r12 view plate, and the four-counter foot.

  The scene itself is the redesign's own: every row of the roster stands in the plate as a wireframe box in its own colour,
  and the pick wears the editor's translate gizmo — the same figures as Engine/Editor/GizmoFigures.h (cones at TIP 0.95 of a
  1.0 reach, 0.06 r / 0.18 tall, corner quads at 0.08 half over a white 0.16 ring; X 0xe01414, Y 0x12d40a, Z 0x1560e0,
  quads cyan / magenta / yellow).
==============================================================================================================================*/

const Viewport = (() => {
  let host = null, plate = null, svg = null, consoleEl = null, listEl = null;

  const V = {
    orbit: { yaw: 2.42, pitch: 0.42, dist: 14.5, target: [0, 0.9, 0], ortho: false, viewPoint: 0 },
    transport: 'edit', paused: false, realtime: true, markers: true,
    addOpen: false, viewOpen: false, consoleOpen: false, sugg: 0, ghost: '',
    samples: 128, target_samples: 256, drawn: {}
  };

  const SNAP_NAMES = ['', 'Front', 'Back', 'Right', 'Left', 'Top', 'Bottom'];
  const SNAPS = [{ yaw: 0, pitch: 0 }, { yaw: 0, pitch: 0 }, { yaw: Math.PI, pitch: 0 },
                 { yaw: -Math.PI / 2, pitch: 0 }, { yaw: Math.PI / 2, pitch: 0 },
                 { yaw: 0, pitch: -Math.PI / 2 }, { yaw: 0, pitch: Math.PI / 2 }];
  const PAD_VIEWS = [3, 4, 2, 1, 5, 6];          /* the pad on +X looks back down −X */
  const AXIS_TINT = ['#e01414', '#12d40a', '#1560e0'];   /* GizmoFigures kGizmoTint X/Y/Z */
  const QUAD_TINT = ['#1fc7c7', '#c81ec8', '#e0cd12'];

  /*── the orbit's basis — the solver's own formula ──────────────────────────────────────────────*/
  function basis(yaw, pitch) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const F = [sy * cp, cy * cp, sp];
    let rx = F[1], ry = -F[0];
    const rl = Math.hypot(rx, ry);
    if (rl < 1e-4) { rx = cy; ry = -sy; } else { rx /= rl; ry /= rl; }
    const R = [rx, ry, 0];
    const U = [ry * F[2], -rx * F[2], rx * F[1] - ry * F[0]];
    return { F, R, U };
  }

  /*── one colour per entry: the family hue shifted by the row's own seat ─────────────────────────*/
  function entryColour(row, index) {
    const hex = row.tint || '#9aa4b2';
    const r = parseInt(hex.slice(1, 3), 16) / 255, g = parseInt(hex.slice(3, 5), 16) / 255, b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = 0; s = 0; }
    else {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h /= 6;
    }
    h = (h + index * 0.047) % 1;                       /* every entry steps a little off its family */
    l = clamp(l * (0.72 + ((index * 37) % 40) / 100), 0.28, 0.78);
    s = clamp(s * 1.05 + 0.12, 0.22, 0.95);
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    const to = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
    return `#${to(f(h + 1 / 3))}${to(f(h))}${to(f(h - 1 / 3))}`;
  }

  /*── the seats: one slot per non-folder row, laid out in a shallow grid ────────────────────────*/
  let seatCache = { n: -1, seats: [] };
  function seats() {
    if (seatCache.n === SCENE.rows.length) return seatCache.seats;
    const live = SCENE.rows.filter(r => r.category !== 'Folder');
    const result = live.map((row, i) => {
      const col = i % 6, ring = Math.floor(i / 6);
      const x = (col - 2.5) * 2.15, z = (ring - 2) * 2.15;
      const s = row.category === 'Light' || row.category === 'Camera' ? 0.34 : 0.62;
      return { row, at: [x, s, z], size: s, colour: entryColour(row, i), index: i };
    });
    seatCache = { n: SCENE.rows.length, seats: result };
    return result;
  }
  const seatOf = (row) => seats().find(s => s.row === row);

  /*── projection ────────────────────────────────────────────────────────────────────────────────*/
  function projector(w, h) {
    const { F, R, U } = basis(V.orbit.yaw, V.orbit.pitch);
    const d = V.orbit.dist, T = V.orbit.target;
    const cam = [T[0] - F[0] * d, T[1] - F[1] * d, T[2] - F[2] * d];
    const f = V.orbit.ortho ? h / (d * 0.55) : h * 0.9;
    return (p) => {
      const v = [p[0] - cam[0], p[1] - cam[1], p[2] - cam[2]];
      const x = v[0] * R[0] + v[1] * R[1] + v[2] * R[2];
      const y = v[0] * U[0] + v[1] * U[1] + v[2] * U[2];
      const z = Math.max(0.05, v[0] * F[0] + v[1] * F[1] + v[2] * F[2]);
      return [w / 2 + x / z * f, h / 2 - y / z * f, z];
    };
  }

  /*── the boxes: six faces, painter-sorted, in the entry's own colour ───────────────────────────*/
  function boxFaces(seat, P) {
    const [cx, cy, cz] = seat.at, s = seat.size;
    const v = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]
      .map(([a, b, c]) => [cx + a * s, cy + b * s, cz + c * s]);
    const p = v.map(P);
    const faces = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4]];
    return faces.map(f => {
      const pts = f.map(i => p[i]);
      const depth = pts.reduce((a, q) => a + q[2], 0) / 4;
      return { points: pts.map(q => `${q[0].toFixed(1)},${q[1].toFixed(1)}`).join(' '), depth };
    }).sort((a, b) => b.depth - a.depth);
  }

  /*── the translate gizmo, the reference's own figures (reach 1 → seat size 2.2) ────────────────*/
  function gizmoSVG(seat, P) {
    const R = 2.35, TIP = R * 0.95, CR = R * 0.06, CH = R * 0.18, QH = R * 0.08, RING = R * 0.16;
    const o = seat.at;
    const dirs = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    let out = '';
    dirs.forEach((axis, a) => {
      const end = [o[0] + axis[0] * TIP, o[1] + axis[1] * TIP, o[2] + axis[2] * TIP];
      const base = [o[0] + axis[0] * (TIP - CH), o[1] + axis[1] * (TIP - CH), o[2] + axis[2] * (TIP - CH)];
      const p0 = P([o[0] + axis[0] * (TIP - CH - R * 0.22), o[1] + axis[1] * (TIP - CH - R * 0.22), o[2] + axis[2] * (TIP - CH - R * 0.22)]);
      const p1 = P(base), p2 = P(end);
      const u = [p2[0] - p1[0], p2[1] - p1[1]], len = Math.hypot(u[0], u[1]) || 1;
      const n = [-u[1] / len * CR * (R / 1) * 220, u[0] / len * CR * (R / 1) * 220];
      const w = Math.hypot(n[0], n[1]) || 1;
      const nn = [n[0] / w * Math.max(4, CR * R * 260), n[1] / w * Math.max(4, CR * R * 260)];
      out += `<line x1="${p0[0].toFixed(1)}" y1="${p0[1].toFixed(1)}" x2="${p1[0].toFixed(1)}" y2="${p1[1].toFixed(1)}" stroke="${AXIS_TINT[a]}" stroke-width="${(R * 0.055).toFixed(1)}" stroke-linecap="round"/>`;
      out += `<polygon points="${p2[0].toFixed(1)},${p2[1].toFixed(1)} ${(p1[0] + nn[0]).toFixed(1)},${(p1[1] + nn[1]).toFixed(1)} ${(p1[0] - nn[0]).toFixed(1)},${(p1[1] - nn[1]).toFixed(1)}" fill="${AXIS_TINT[a]}"/>`;
    });
    /* the corner quads, corner at (u+v)·(TIP−half) */
    [[0, 1, 2], [0, 2, 1], [1, 2, 0]].forEach((pair, q) => {
      const half = QH, at = TIP - half;
      const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([su, sv]) => {
        const pt = [o[0], o[1], o[2]];
        pt[pair[0]] += at + su * half;
        pt[pair[1]] += at + sv * half;
        pt[pair[2]] += 0;
        return P(pt);
      });
      out += `<polygon points="${corners.map(c => `${c[0].toFixed(1)},${c[1].toFixed(1)}`).join(' ')}" fill="${QUAD_TINT[q]}" fill-opacity="0.28" stroke="${QUAD_TINT[q]}" stroke-width="1.2"/>`;
    });
    const c = P(o[0] === 0 && o[2] === 0 ? o : o);
    out += `<ellipse cx="${c[0].toFixed(1)}" cy="${c[1].toFixed(1)}" rx="${RING.toFixed(1)}" ry="${(RING * 0.42).toFixed(1)}" fill="none" stroke="#fff" stroke-width="1.2"/>`;
    return out;
  }

  /*── the compass: three axes, pads on all six ends, letters on the positive three ──────────────*/
  function compass(w, h) {
    const { F, R, U } = basis(V.orbit.yaw, V.orbit.pitch);
    const cx = w - 52, cy = h - 52, ARM = 20;
    const axes = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    const pads = axes.map(a => {
      const dx = a[0] * R[0] + a[1] * R[1] + a[2] * R[2];
      const dy = a[0] * U[0] + a[1] * U[1] + a[2] * U[2];
      const toward = -(a[0] * F[0] + a[1] * F[1] + a[2] * F[2]);
      return { x: cx + dx * ARM, y: cy - dy * ARM, front: toward > 0, axis: a };
    });
    let out = `<g class="compass-hold">`;
    for (let a = 0; a < 3; a++) {
      const p0 = pads[2 * a], p1 = pads[2 * a + 1];
      out += `<line x1="${p0.x.toFixed(1)}" y1="${p0.y.toFixed(1)}" x2="${p1.x.toFixed(1)}" y2="${p1.y.toFixed(1)}" stroke="${AXIS_TINT[a]}" stroke-opacity="${p0.front || p1.front ? 0.95 : 0.4}" stroke-width="1.6"/>`;
    }
    const letters = ['X', 'Y', 'Z'];
    pads.forEach((pad, i) => {
      const lit = pad.front;
      const tint = AXIS_TINT[i % 3];
      out += `<circle class="pad" data-pad="${i}" cx="${pad.x.toFixed(1)}" cy="${pad.y.toFixed(1)}" r="6" fill="${lit ? tint : '#2b2b2b'}" fill-opacity="${lit ? 0.9 : 1}" stroke="${lit ? tint : '#3a3a3a'}" stroke-width="1.2"/>`;
      if (i % 2 === 0) {
        out += `<text x="${(pad.x + 10).toFixed(1)}" y="${(pad.y + 3.5).toFixed(1)}" font-size="9" fill="${lit ? tint : '#5c5c5c'}">${letters[i / 2]}</text>`;
      }
    });
    out += `<circle cx="${cx}" cy="${cy}" r="2" fill="#5c5c5c"/></g>`;
    return out;
  }

  /*── the plate ─────────────────────────────────────────────────────────────────────────────────*/
  function paintPlate() {
    if (!plate) return;
    const w = plate.clientWidth || 800, h = plate.clientHeight || 500;
    const P = projector(w, h);
    const picked = App.picked;
    let art = `<g>`;
    const selected = picked === null ? null : seatOf(SCENE.rows[picked]);
    const list = seats().filter(s => s.row.visible).map(seat => {
      const faces = boxFaces(seat, P);
      const mid = faces.reduce((a, f) => a + f.depth, 0) / faces.length;
      return { seat, faces, mid };
    }).sort((a, b) => b.mid - a.mid);
    list.forEach(({ seat, faces }) => {
      const isSel = seat === selected;
      const seatIndex = SCENE.rows.indexOf(seat.row);
      faces.forEach(f => {
        art += `<polygon data-seat="${seatIndex}" points="${f.points}" fill="${seat.colour}" fill-opacity="${isSel ? 0.30 : 0.16}" stroke="${seat.colour}" stroke-opacity="${isSel ? 0.95 : 0.6}" stroke-width="${isSel ? 1.4 : 1}"/>`;
      });
      const c = P(seat.at);
      art += `<text data-seat="${seatIndex}" x="${(c[0] + 6).toFixed(1)}" y="${(c[1] - 6).toFixed(1)}" font-size="10" fill="${seat.colour}">${seat.row.label}</text>`;
    });
    if (selected) art += gizmoSVG(selected, P);

    /* billboards — the volume markers the rail's Markers pill toggles */
    if (V.markers) {
      seats().filter(s => s.row.volumetric || (s.row.narrowing === 'Sky' && s.row.meta && /m$|km$/.test(s.row.meta))).forEach(seat => {
        const p = P([seat.at[0], seat.at[1] + 1.4, seat.at[2]]);
        art += `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="9" fill="rgba(10,12,14,.6)" stroke="${seat.colour}" stroke-width="1.2"/>`;
        art += `<text x="${p[0].toFixed(1)}" y="${(p[1] + 3).toFixed(1)}" font-size="9" text-anchor="middle" fill="${seat.colour}">◆</text>`;
      });
    }
    art += `</g>`;
    art += compass(w, h);
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.innerHTML = art;

    /* pad taps snap their view */
    svg.querySelectorAll('.pad').forEach(pad => {
      pad.style.cursor = 'pointer';
      pad.onclick = (e) => {
        e.stopPropagation();
        const v = PAD_VIEWS[Number(pad.dataset.pad)];
        V.orbit.yaw = SNAPS[v].yaw; V.orbit.pitch = SNAPS[v].pitch; V.orbit.viewPoint = v;
        renderRail(); paintPlate();
      };
    });
    V.drawn = { w, h, P };
  }

  /*── the rail ─────────────────────────────────────────────────────────────────────────────────*/
  function rail() {
    const bar = el('div', 'rail');
    bar.appendChild(el('div', 'brandtile', 'F'));

    const pair = el('div', 'dockpair');
    [['outliner', 'Outliner column'], ['inspector', 'Inspector column']].forEach(([dock, tip], i) => {
      const b = el('button', (i === 0 ? App.state.docks.left : App.state.docks.right) ? 'is-on' : '', icon(i === 0 ? 'compact' : 'sliders', 13));
      b.title = tip;
      b.onclick = () => App.toggleDock(i === 0 ? 'left' : 'right');
      pair.appendChild(b);
    });
    bar.appendChild(pair);

    const add = el('button', 'pill', `${icon('plus', 14)}<span>Add</span>`);
    add.title = 'Add an object  (Shift A)';
    add.onclick = (e) => {
      const menu = el('div', 'menu');
      [['Lights', ['Directional Light (Sun)', 'Point Light', 'Spot Light', 'Rect / Area Light']],
       ['World & Celestial', ['Atmosphere Medium', 'Sky Atmosphere', 'Cloud Layer', 'Local Volumetric Fog', 'Wind Field', 'Rainbow', 'Lens Flare', 'Moon / Satellite']],
       ['Cameras', ['Main Camera', 'Cine Camera (35mm)', 'Cine Camera (50mm)', 'Cine Camera (85mm)', 'Post Process Volume']],
       ['Geometry Primitives', ['Plane / Ground', 'Cube / Box', 'Sphere', 'Cylinder', 'Cone', 'Torus']],
       ['Tyres & Wheels', ['Tyre', 'Carcass', 'Tread', 'XPBD Lattice', 'Rim', 'Wheel Assembly', 'Brake Disc', 'Suspension']],
       ['Vehicles', ['Vehicle', 'Car Body', 'Chassis', 'Engine', 'Gearbox', 'Truck', 'Motorcycle']],
       ['Cloth & Soft Bodies', ['Cloth Panel', 'Rope', 'Soft Body', 'Flag', 'Deformable']]].forEach(([group, items]) => {
        const head = el('div', 'item');
        head.style.color = 'var(--dim)';
        head.style.cursor = 'default';
        head.innerHTML = `<span style="width:7px"></span>${group.toUpperCase()}`;
        menu.appendChild(head);
        items.forEach(label => {
          const it = el('div', 'item', `<span style="width:7px"></span>${label}`);
          it.onclick = () => { closeMenu(); App.add(label); };
          menu.appendChild(it);
        });
      });
      document.body.appendChild(menu);
      const r = add.getBoundingClientRect();
      menu.style.left = Math.round(r.left) + 'px';
      menu.style.top = Math.round(r.bottom + 8) + 'px';
      const mr = menu.getBoundingClientRect();
      if (mr.bottom > innerHeight - 8) menu.style.top = Math.round(Math.max(8, innerHeight - mr.height - 8)) + 'px';
      if (OPEN_MENU) OPEN_MENU.remove();
      OPEN_MENU = menu;
    };
    bar.appendChild(add);

    bar.appendChild(el('div', 'spacer'));

    const modes = el('div', 'modepill');
    [['edit', 'Edit', null], ['simulate', 'Simulate', 'simulate'], ['play', 'Play', 'play']].forEach(([mode, label, glyph]) => {
      const held = V.paused && mode !== 'edit';
      const cls = V.transport === mode ? (mode === 'edit' ? 'is-edit' : (V.paused ? 'is-held' : (mode === 'simulate' ? 'is-sim' : 'is-play'))) : '';
      const b = el('button', cls, `${glyph ? `<span class="led"></span>` : ''}<span>${held ? 'Paused' : label}</span>`);
      b.title = mode === 'edit' ? 'Edit — the editor owns the world  (Esc)'
        : mode === 'simulate' ? 'Simulate — run the world, keep the editor camera  (Alt S)'
          : 'Play — run the world through a scene camera  (Alt P)';
      b.onclick = () => App.setTransport(V.transport === mode ? 'edit' : mode);
      modes.appendChild(b);
    });
    bar.appendChild(modes);

    if (V.transport !== 'edit') {
      const runs = el('div', 'runbtns');
      [['pause', 'Pause / resume  (P)', () => App.setPaused(!V.paused)],
       ['step', 'Advance one frame  (.)', () => App.step(), V.paused === false],
       ['stop', 'Stop — restore the editor  (Esc)', () => App.setTransport('edit')]].forEach(([name, tip, fn, disabled]) => {
        const b = el('button', null, icon(name, 13));
        b.title = tip;
        b.disabled = !!disabled;
        b.onclick = fn;
        runs.appendChild(b);
      });
      bar.appendChild(runs);
    }

    bar.appendChild(el('div', 'spacer'));

    const viewLabel = V.orbit.viewPoint === 0
      ? (V.orbit.ortho ? 'Orthographic' : 'Perspective')
      : `${SNAP_NAMES[V.orbit.viewPoint]} ${V.orbit.ortho ? 'Ortho' : 'Persp'}`;
    const view = el('button', 'pill', `<span>${viewLabel}</span>`);
    view.title = 'Projection and compass snaps';
    view.onclick = () => {
      const menu = el('div', 'menu');
      [['Perspective', V.orbit.viewPoint === 0 && !V.orbit.ortho, () => { V.orbit.ortho = false; V.orbit.viewPoint = 0; }],
       ['Orthographic', V.orbit.viewPoint === 0 && V.orbit.ortho, () => { V.orbit.ortho = true; V.orbit.viewPoint = 0; }],
       ['—', null, null],
       ...SNAP_NAMES.slice(1).map((n, i) => [n, V.orbit.viewPoint === i + 1, () => { V.orbit.yaw = SNAPS[i + 1].yaw; V.orbit.pitch = SNAPS[i + 1].pitch; V.orbit.viewPoint = i + 1; }])
      ].forEach(([label, ticked, fn]) => {
        if (!fn) { const sep = el('div'); sep.style.cssText = 'height:1px;background:var(--stroke);margin:6px 8px'; menu.appendChild(sep); return; }
        const it = el('div', 'item' + (ticked ? ' is-sel' : ''), (ticked ? '<span class="dot"></span>' : '<span style="width:7px"></span>') + label);
        it.onclick = () => { closeMenu(); fn(); renderRail(); paintPlate(); };
        menu.appendChild(it);
      });
      document.body.appendChild(menu);
      const r = view.getBoundingClientRect();
      menu.style.left = Math.round(r.left) + 'px';
      menu.style.top = Math.round(r.bottom + 8) + 'px';
      if (OPEN_MENU) OPEN_MENU.remove();
      OPEN_MENU = menu;
    };
    bar.appendChild(view);

    const mark = el('button', 'pill' + (V.markers ? ' is-on' : ''), `${icon('dot', 12)}<span>Markers</span>`);
    mark.title = 'Volume markers in the view';
    mark.onclick = () => { V.markers = !V.markers; renderRail(); paintPlate(); };
    bar.appendChild(mark);

    const status = V.paused ? 'Held' : V.transport !== 'edit' ? 'Running' : (V.realtime ? 'Live' : 'Static');
    const cls = V.paused ? 'is-held' : V.transport !== 'edit' ? 'is-run' : (V.realtime ? '' : 'is-static');
    const pill = el('button', 'statuspill ' + cls, `<span class="led"></span><span>${status}</span><span class="num">${V.samples}</span>`);
    pill.title = `${V.samples} accumulated samples · ${V.transport === 'edit' ? 'Click to hold the clock (realtime on/off)  (Ctrl R)' : 'The world is running'}`;
    pill.onclick = () => { if (V.transport === 'edit') { V.realtime = !V.realtime; renderRail(); } };
    bar.appendChild(pill);

    const gear = el('button', 'gear', icon('gear', 16));
    gear.title = 'Viewport settings';
    gear.onclick = (e) => { e.stopPropagation(); App.toggleShade(); };
    bar.appendChild(gear);

    const frac = clamp(V.samples / V.target_samples, 0, 1);
    const hair = el('div', 'hairline');
    const fill = el('i');
    fill.style.width = (frac * 100) + '%';
    fill.style.background = frac >= 1 ? '#4f9ad8' : '#59c9a5';
    hair.appendChild(fill);
    bar.appendChild(hair);

    return bar;
  }
  function renderRail() { if (!host) return; const old = host.querySelector('.rail'); const next = rail(); old ? old.replaceWith(next) : host.insertBefore(next, host.firstChild); }

  /*── the console ───────────────────────────────────────────────────────────────────────────────*/
  const QUICK = [['Play — run through a camera', 'transport'], ['Simulate — run the world', 'transport'],
    ['Pause / resume', 'transport'], ['Step one frame', 'transport'], ['Stop and restore', 'transport'],
    ['Realtime viewport', 'viewport']];
  const EXAMPLES = ['find tall box', 'rotate tall box 40 degrees on z', 'move sphere 2 m on x',
    'add sphere at x 3 y 2 z -1', 'enable physics on selected objects', 'isolate selection',
    'set time to golden hour', 'hide moon', 'scale cone 2x'];
  const VERBS = [
    ['find|locate|select|where is|go to|show me|pick', 'find <entity>', 'select it, reveal it in the tree and frame it'],
    ['rotate|turn|spin|yaw|pitch|roll', 'rotate <entity> 40 degrees on z', 'degrees by default, radians if you say so'],
    ['move|translate|shift|nudge|push|place|put', 'move <entity> 2 m on x', 'or "move cube to x 4 y 1 z 0"'],
    ['scale|resize|grow|shrink', 'scale <entity> 2x', 'uniform, or add "on y" for one axis'],
    ['add|create|spawn|new|insert|drop', 'add sphere at x 3 y 2 z -1', 'any entity type, anywhere'],
    ['enable physics|disable physics|turn on physics|turn off physics|physics', 'enable physics on <entity>', 'bodies fall and settle while the world runs'],
    ['isolate|focus|zoom to|frame', 'isolate selection', 'everything else steps aside'],
    ['hide|show|visible|visibility', 'hide moon', 'the eye in the outliner agrees'],
    ['delete|remove|destroy|erase|clear', 'delete from ram <entity>', 'the record leaves the scene'],
    ['simulate|run the world|start simulation', 'simulate', 'the world runs, the editor camera stays'],
    ['play|run through a camera', 'play', 'the scene camera takes the view'],
    ['pause|hold|freeze|resume|unpause', 'pause', 'the clock stops where it stands'],
    ['step|advance one frame|frame step|tick', 'step', 'one frame at a time, while held'],
    ['stop|restore|exit play|end play', 'stop', 'the editor takes the world back'],
    ['set time|time of day|golden hour|clock', 'set time to golden hour', 'the day cycle moves with it']
  ];
  const keysHit = (keys, text) => keys.split('|').some(k => k.startsWith(text.trim().toLowerCase()) && text.trim().length > 0);
  const infix = (hay, needle) => hay.toLowerCase().includes(needle.trim().toLowerCase());

  function suggestions() {
    const text = V.command || '';
    if (!text.trim()) return EXAMPLES.map(e => ({ sort: 'example', title: e, sub: 'example', icon: 'command' }));
    const rows = [];
    VERBS.forEach(v => { if (rows.length < 9 && keysHit(v[0], text.split(' ')[0])) rows.push({ sort: 'verb', title: v[1], sub: v[2], icon: 'command' }); });
    SCENE.rows.forEach(r => { if (rows.length < 9 && infix(r.label, text)) rows.push({ sort: 'entry', title: r.label, sub: 'Geometry', icon: r.icon || 'cube', tint: r.tint }); });
    QUICK.forEach(q => { if (rows.length < 9 && infix(q[0], text)) rows.push({ sort: 'quick', title: q[0], sub: q[1], icon: 'play' }); });
    if (!rows.length) rows.push({ sort: 'bad', title: 'Nothing answers that', sub: 'try "find", "move", "add"', icon: 'warn' });
    return rows.slice(0, 9);
  }

  function renderConsole() {
    if (!consoleEl) return;
    consoleEl.hidden = !V.consoleOpen;
    consoleEl.replaceChildren();
    if (!V.consoleOpen) { listEl && (listEl.hidden = true); return; }
    consoleEl.appendChild(el('span', 'ico', icon('chevron', 14)));
    const input = el('input');
    input.value = V.command || '';
    input.placeholder = 'Say what you want — "rotate cube 40 degrees on Z", "add sphere at x 3 y 2 z -1"';
    input.oninput = () => { V.command = input.value; V.sugg = 0; renderConsole(); };
    input.onkeydown = (e) => {
      const rows = suggestions();
      if (e.key === 'ArrowDown') { V.sugg = (V.sugg + 1) % rows.length; renderConsole(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { V.sugg = (V.sugg + rows.length - 1) % rows.length; renderConsole(); e.preventDefault(); }
      else if (e.key === 'Tab') { V.command = rows[V.sugg].title; renderConsole(); e.preventDefault(); }
      else if (e.key === 'Enter') { runRow(rows[V.sugg]); }
      else if (e.key === 'Escape') { V.command = ''; V.consoleOpen = false; renderConsole(); }
    };
    consoleEl.appendChild(input);
    const key = el('span', 'key', '⌘K');
    key.onclick = () => { V.consoleOpen = true; renderConsole(); };
    consoleEl.appendChild(key);
    const run = el('button', 'ico', icon('play', 13));
    run.title = 'Run  (Enter)';
    run.onclick = () => runRow(suggestions()[V.sugg]);
    consoleEl.appendChild(run);

    listEl.hidden = false;
    listEl.replaceChildren();
    const rows = suggestions();
    listEl.appendChild(el('div', 'head', rows[0].sort === 'example' ? 'SAY WHAT YOU WANT' : 'SUGGESTIONS'));
    rows.forEach((row, i) => {
      const r = el('div', 'row' + (i === V.sugg ? ' is-sel' : ''));
      const glyph = el('span', null, icon(row.icon, 14));
      glyph.style.color = row.tint || (row.sort === 'bad' ? 'var(--red)' : 'var(--hi)');
      const swatch = el('span', 'swatch');
      swatch.style.background = row.tint || (row.sort === 'bad' ? 'var(--red)' : 'var(--hi)');
      r.append(glyph, swatch);
      r.appendChild(el('span', null, row.title));
      r.appendChild(el('span', 'hint', row.sub));
      r.onclick = () => { V.sugg = i; runRow(row); };
      listEl.appendChild(r);
    });
  }

  function runRow(row) {
    if (!row) return;
    App.toast('Command', `“${V.command || row.title}” → ${row.sort === 'bad' ? 'no answer' : row.sub}`);
    if (row.sort === 'quick') {
      if (row.title.startsWith('Play')) App.setTransport('play');
      else if (row.title.startsWith('Simulate')) App.setTransport('simulate');
      else if (row.title.startsWith('Pause')) V.transport === 'edit' ? App.setTransport('simulate') : App.setPaused(!V.paused);
      else if (row.title.startsWith('Step')) App.step();
      else if (row.title.startsWith('Stop')) App.setTransport('edit');
      else if (row.title.startsWith('Realtime')) V.realtime = !V.realtime;
    } else if (row.sort === 'entry') {
      App.select(SCENE.rows.findIndex(r => r.label === row.title));
    } else if (row.sort === 'verb' && /^add /.test(row.title)) {
      App.add(row.title.replace(/^add\s+/, '').split(' at ')[0].replace(/^\w/, c => c.toUpperCase()));
    }
    V.command = '';
    renderConsole(); renderRail();
  }

  /*── the foot: FPS(+ms) · TRIS · INSTANCES(+visible) · CAMERA; the camera cell steps aside first ─*/
  function foot() {
    const f = el('div', 'foot');
    const cam = V.orbit;
    const live = SCENE.rows.filter(r => r.category !== 'Folder');
    const shown = live.filter(r => r.visible).length;
    const cells = [
      ['FPS', String(App.state.fps), `${(1000 / Math.max(1, App.state.fps)).toFixed(1)} ms`, App.state.fps >= 50 ? 'good' : App.state.fps < 24 ? 'warn' : ''],
      ['TRIS', String(App.state.tris), '', ''],
      ['INSTANCES', String(live.length), `${shown} visible`, ''],
      ['CAMERA', `${cam.yaw * 57.29578 >= 0 ? '+' : ''}${(cam.yaw * 57.29578).toFixed(0)}° ${cam.pitch * 57.29578 >= 0 ? '+' : ''}${(cam.pitch * 57.29578).toFixed(0)}° ${cam.dist.toFixed(1)}m`, '', 'dim']
    ];
    cells.forEach(([label, fig, sub, cls], i) => {
      if (i) f.appendChild(el('div', 'sep'));
      const cell = el('div', 'cell');
      cell.appendChild(el('span', 'caps', label));
      cell.appendChild(el('span', 'fig ' + cls, fig));
      if (sub) cell.appendChild(el('span', null, `· ${sub}`));
      if (i === 3) { cell.classList.add('opt'); cell.style.marginLeft = 'auto'; }
      f.appendChild(cell);
    });
    return f;
  }

  /*── the panel ─────────────────────────────────────────────────────────────────────────────────*/
  function render() {
    host.replaceChildren();
    host.appendChild(rail());
    plate = el('div', 'viewport-view');
    svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%');
    plate.appendChild(svg);
    const hint = el('div', 'view-hint');
    hint.append(el('div', null, 'The Cornell Box renders here'), el('small', null, 'in the engine build'));
    hint.style.display = 'none';
    plate.appendChild(hint);
    host.appendChild(plate);

    consoleEl = el('div', 'console');
    listEl = el('div', 'console-list');
    host.appendChild(consoleEl);
    host.appendChild(listEl);
    host.appendChild(foot());

    plate.addEventListener('click', (e) => {
      const seat = e.target && e.target.dataset ? e.target.dataset.seat : null;
      if (seat !== null && seat !== undefined && seat !== '') { App.select(Number(seat)); paintPlate(); }
    });
    plate.onwheel = (e) => { e.preventDefault(); V.orbit.dist = clamp(V.orbit.dist * (1 + Math.sign(e.deltaY) * 0.08), 3, 60); paintPlate(); };
    svg.onpointerdown = (e) => {
      if (e.target.classList && e.target.classList.contains('pad')) return;
      const startX = e.clientX, startY = e.clientY;
      capture(svg, e);
      svg.onpointermove = (ev) => {
        V.orbit.yaw -= (ev.clientX - startX) * 0.008;
        V.orbit.pitch = clamp(V.orbit.pitch + (ev.clientY - startY) * 0.008, -1.55, 1.55);
        V.orbit.viewPoint = 0;
        paintPlate();
      };
      svg.onpointerup = () => { svg.onpointermove = null; };
    };
    renderConsole();
    paintPlate();
  }
  function mount(node) {
    host = node;
    render();
    window.addEventListener('resize', () => paintPlate());
  }
  return { mount, render, renderRail, renderConsole, paintPlate, state: V, foot };
})();

window.Viewport = Viewport;
