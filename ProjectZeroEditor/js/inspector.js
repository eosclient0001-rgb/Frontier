/*==============================================================================================================================
  INSPECTOR — InspectorPanel.cpp. The 56 px ident head (36 px tint tile, the CAPS category and its "· locked · hidden"
  suffix, the two 28 px discs), the r18 cards with their 78 px label column and their prow heights (slider 30, switch 26,
  axes 26, colour 26, select 32, read-out 18), the Instance standing card at 130 px, the 64 px Notes field, and the foot
  that reads "Category · dynamic|static" left and the tinted FPS and TRIS right.

  Below that, unchanged: the per-domain sheets, copied from the native builders (Sun, Stars, Atmosphere/Sky, Moon, Wind,
  Precipitation, Rainbow, Fog, Local volumes, Clouds, Lens Flare) and TyreInspectorPanel for the tyre family.
==============================================================================================================================*/

const Inspector = (() => {
  let host = null;

  /*── the ident head ────────────────────────────────────────────────────────────────────────────*/
  function ident(row) {
    const head = el('div', 'insp-ident');
    const tile = el('div', 'tile');
    tile.style.background = hexA(row.tint, 0.14);
    tile.style.border = `1px solid ${hexA(row.tint, 0.42)}`;
    const dot = el('div');
    dot.style.cssText = `width:10px;height:10px;border-radius:50%;background:${row.tint}`;
    tile.appendChild(dot);
    head.appendChild(tile);

    const names = el('div', 'names');
    const title = el('input');
    title.value = row.label;
    title.onchange = () => { row.label = title.value; App.repaintAll(); };
    const cat = el('div', 'cat');
    const suffix = row.locked && !row.visible ? ' <em>· locked · hidden</em>' : row.locked ? ' <em>· locked</em>' : !row.visible ? ' <em>· hidden</em>' : '';
    cat.innerHTML = `${row.category.toUpperCase()}${suffix}`;
    names.append(title, cat);
    head.appendChild(names);

    const toggles = el('div', 'toggles');
    const lock = el('button', row.locked ? 'is-on' : '', icon(row.locked ? 'lock' : 'unlock', 14));
    lock.title = row.locked ? 'Unlock' : 'Lock';
    lock.onclick = () => { row.locked = !row.locked; render(); };
    const eye = el('button', row.visible ? 'is-on' : '', icon(row.visible ? 'eye' : 'eyeOff', 14));
    eye.title = row.visible ? 'Hide' : 'Show';
    eye.onclick = () => { row.visible = !row.visible; App.repaintAll(); };
    toggles.append(lock, eye);
    head.appendChild(toggles);
    return head;
  }

  function hexA(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  /*── the sheets, the standing card, the notes ──────────────────────────────────────────────────*/
  function sheetCards(row, target) {
    const sheet = SHEETS[row.sheet] || SHEETS.material;
    (sheet.groups || []).forEach(group => {
      const g = Object.assign({}, group, { props: group.props.map(p => Object.assign({}, p)), onChange: () => {
        if (row.sheet === 'sun' || row.sheet === 'atmosphere' || row.sheet === 'sky') App.onWorldChanged && App.onWorldChanged();
      } });
      target.appendChild(renderCard(g));
    });
  }

  /* the Sun sheet's own bake tiles — the native BuildSunSheet draws them above the cards */
  function bakeTiles(row) {
    if (row.sheet !== 'sun') return null;
    const box = el('div', 'card');
    box.appendChild(el('div', 'card-head', '<div class="tri"></div><div class="caps">Bake / image</div>'));
    const body = el('div', 'card-body');
    const rowEl = el('div', 'prop');
    rowEl.appendChild(el('div', 'label', 'Use baked image'));
    const z = el('div', 'zone');
    const sw = el('div', 'switch', '<i></i>');
    sw.onclick = () => sw.classList.toggle('is-on');
    z.appendChild(sw);
    rowEl.appendChild(z);
    body.appendChild(rowEl);
    const btns = el('div', 'pills');
    ['Bake', 'Load image'].forEach(label => {
      const b = el('button', 'pilltoggle', label);
      b.onclick = () => App.toast('Sun', `${label} — the native sheet keeps Sky's existing bake; nothing is rebaked here.`);
      btns.appendChild(b);
    });
    body.appendChild(btns);
    body.appendChild(el('div', 'caption', 'Sun-specific Bake and Use baked image are not supported. The existing bake belongs to Sky, not Sun.'));
    box.appendChild(body);
    return box;
  }

  /*── the tyre hero and its generator — TyreInspectorPanel + the proof sheet's own figures ──────*/
  function tyreHero(row) {
    const t = SCENE.tyre;
    const preset = TYRE_PRESETS[t.preset];
    const box = el('div', 'hero-card');
    const head = el('div', 'head');
    head.append(el('span', 'mark', icon('tyre', 22)), el('h3', null, 'Tyre'));
    box.appendChild(head);
    box.appendChild(el('div', 'subject', 'Tyre generator'));
    box.appendChild(el('div', 'name', preset.name));
    box.appendChild(el('div', 'subtitle', `${preset.sub} · ${t.size}`));
    const measure = el('div', 'measure', `831<small>mm overall Ø</small>`);
    box.appendChild(measure);

    const tabs = el('div', 'tyre-tabs');
    ['Tyre', 'Rim', 'Look', 'Export'].forEach(tab => {
      const b = el('button', tab === t.tab ? 'is-on' : '', tab);
      b.onclick = () => { t.tab = tab; render(); };
      tabs.appendChild(b);
    });
    box.appendChild(tabs);

    const chips = el('div', 'tyre-chips');
    TYRE_SIZES.forEach(size => {
      const s = el('span', size === t.size ? 'new' : '', size);
      s.onclick = () => { t.size = size; render(); };
      chips.appendChild(s);
    });
    box.appendChild(chips);

    const stats = el('div', 'tyre-stats');
    [['Overall Ø', '831', 'mm'], ['Tread left', '15.0', 'mm'], ['Circumference', '2.61', 'm'], ['Tread mesh', '138', 'k tris']].forEach(([k, v, u]) => {
      const s = el('div', 'tyre-stat');
      s.appendChild(el('div', 'k', k));
      s.appendChild(el('div', 'v', `${v}<small>${u}</small>`));
      stats.appendChild(s);
    });
    box.appendChild(stats);

    const views = el('div', 'viewbar');
    ['Iso', 'Side', 'Tread', 'Front', 'Spin', 'X-ray cords'].forEach((v, i) => {
      const b = el('button', i === 0 ? 'is-on' : '', v);
      b.onclick = () => { views.querySelectorAll('button').forEach(x => x.classList.remove('is-on')); b.classList.add('is-on'); };
      views.appendChild(b);
    });
    box.appendChild(views);

    const grid = el('div', 'tyre-grid');
    grid.style.marginTop = '10px';
    TYRE_PRESETS.forEach((p, i) => {
      const c = el('div', 'tyre-preset' + (i === t.preset ? ' is-on' : ''));
      const sw = el('div', 'sw');
      sw.style.background = `linear-gradient(135deg, ${p.tint} 0%, #131313 100%)`;
      sw.innerHTML = `<svg viewBox="0 0 60 44" width="100%" height="44"><ellipse cx="30" cy="22" rx="17" ry="17" fill="#0d0d0d" stroke="#4a4a4a"/><ellipse cx="30" cy="22" rx="7" ry="7" fill="#1c1c1c" stroke="#5a5a5a"/>${treadSVG(p.tread)}</svg>`;
      c.append(sw, el('div', 'nm', p.name), el('div', 'sub', p.sub));
      c.onclick = () => { t.preset = i; render(); };
      grid.appendChild(c);
    });
    box.appendChild(grid);

    const actions = el('div', 'viewbar');
    const random = el('button', null, 'Random tyre');
    random.onclick = () => { t.preset = Math.floor(Math.random() * TYRE_PRESETS.length); render(); };
    const rename = el('button', null, 'New name');
    rename.onclick = () => App.toast('Tyre', 'New name — the sheet asks for a name in the field above.');
    actions.append(random, rename);
    box.appendChild(actions);
    return box;
  }
  /* the preset's own tread figure 0…1 drives the artwork: a slick shows none, a mud tyre shows blocks */
  function treadSVG(amount) {
    if (!amount) return '';
    let s = '';
    const notches = Math.round(10 + amount * 14);
    const blot = (0.8 + amount * 2.1).toFixed(2);
    for (let i = 0; i < notches; i++) {
      const a = i * Math.PI * 2 / notches;
      const x1 = 30 + Math.cos(a) * 17, y1 = 22 + Math.sin(a) * 17;
      const x2 = 30 + Math.cos(a) * (17 - 5 - amount * 3), y2 = 22 + Math.sin(a) * (17 - 5 - amount * 3);
      s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#6a6a6a" stroke-width="${blot}"/>`;
    }
    if (amount > 0.6) s += `<circle cx="30" cy="22" r="12.5" fill="none" stroke="#585858" stroke-width="0.8" stroke-dasharray="2 2"/>`;
    return s;
  }

  /*── the foot ──────────────────────────────────────────────────────────────────────────────────*/
  function foot(row) {
    const f = el('div', 'foot');
    const left = el('div', 'cell');
    left.appendChild(el('span', null, row ? `${row.category} · ${row.dynamic ? 'dynamic' : 'static'}${row.locked ? ' · locked' : ''}` : '—'));
    f.appendChild(left);
    const right = el('div', 'right');
    right.appendChild(el('span', 'caps', 'FPS'));
    right.appendChild(el('span', 'fig ' + (App.state.fps >= 50 ? 'good' : App.state.fps < 24 ? 'warn' : ''), String(App.state.fps)));
    if (App.state.fps < 24) right.appendChild(el('span', null, icon('warn', 12, 'var(--amber)')));
    right.appendChild(el('span', null, '·'));
    right.appendChild(el('span', 'caps', 'TRIS'));
    right.appendChild(el('span', 'fig', String(App.state.tris)));
    f.appendChild(right);
    return f;
  }

  /*── the panel ─────────────────────────────────────────────────────────────────────────────────*/
  function render() {
    host.replaceChildren();
    const row = App.picked === null ? null : SCENE.rows[App.picked];
    if (!row) {
      const empty = el('div', 'insp-empty');
      empty.append(el('div', null, 'Nothing selected'), el('small', null, 'Pick an instance in the outliner.'));
      host.appendChild(empty);
      host.appendChild(foot(null));
      return;
    }
    host.appendChild(ident(row));
    const scroll = el('div', 'insp-scroll');
    if (row.sheet === 'tyre' || row.sheet === 'tyreTread' || row.sheet === 'tyreLattice') scroll.appendChild(tyreHero(row));
    const bake = bakeTiles(row);
    if (bake) scroll.appendChild(bake);
    sheetCards(row, scroll);
    scroll.appendChild(renderStanding(row, () => { }));
    scroll.appendChild(renderNotes(row));
    host.appendChild(scroll);
    host.appendChild(foot(row));
  }

  function mount(node) { host = node; render(); }
  return { mount, render, foot: () => foot(App.picked === null ? null : SCENE.rows[App.picked]) };
})();

window.Inspector = Inspector;
