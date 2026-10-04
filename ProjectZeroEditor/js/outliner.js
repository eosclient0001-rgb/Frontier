/*==============================================================================================================================
  OUTLINER — OutlinerPanel.cpp, block for block. The head with its 28 px round compact button and the "Scene · N nodes" sub,
  the two 18 px census tiles with their 30 px numerals, the 40 px search pill with the 92 px Filter button and its 170 px
  popup, the 26 px narrowing chips with their 6 px tint dots, the rows indented 8 + 13 × depth with a 7 px radius, and the
  five-column foot strip (REALTIME · QUALITY · SUN · MOONS · CAM).
==============================================================================================================================*/

const Outliner = (() => {
  let host = null;      /* #outliner-body */
  let treeEl = null;

  const state = {
    search: '',
    filters: [false, false, false, false, false],
    compact: false,
    shut: new Set(),
    picked: null
  };

  /*── the walk: a row shows when it or a descendant matches the search and the lit chips ────────*/
  function matches(row) {
    if (!state.search) return true;
    return row.label.toLowerCase().includes(state.search.toLowerCase());
  }
  function narrowingOn(row) {
    const lit = FILTERS.filter((f, i) => state.filters[i]).map(f => f.key);
    if (!lit.length) return true;
    if (row.depth === 0) return true;
    return lit.includes(row.narrowing || '');
  }
  function subtreeMatches(row) {
    if (matches(row) && narrowingOn(row)) return true;
    const i = SCENE.rows.indexOf(row);
    for (let j = i + 1; j < SCENE.rows.length && SCENE.rows[j].depth > row.depth; j++) {
      if (subtreeMatches(SCENE.rows[j])) return true;
    }
    return false;
  }
  /* Folders match only through their rows — the page's own rule. */
  const rowShows = (row) => row.depth === 0 ? subtreeMatches(row) : (subtreeMatches(row) && (matches(row) && narrowingOn(row) || true));

  function visibleRows() {
    const out = [];
    for (let i = 0; i < SCENE.rows.length; i++) {
      const row = SCENE.rows[i];
      if (!subtreeMatches(row)) continue;
      if (row.depth > 0 && state.shut.has(parentOf(i))) continue;
      out.push(i);
    }
    return out;
  }
  function parentOf(i) {
    for (let j = i - 1; j >= 0; j--) if (SCENE.rows[j].depth < SCENE.rows[i].depth) return SCENE.rows[j];
    return null;
  }
  const hasKids = (i) => i + 1 < SCENE.rows.length && SCENE.rows[i + 1].depth > SCENE.rows[i].depth;

  /*── the head ──────────────────────────────────────────────────────────────────────────────────*/
  function renderHead() {
    const head = el('div', 'out-head');
    head.appendChild(el('div', 'out-title', 'Outliner'));
    head.appendChild(el('div', 'out-sub', `${SCENE.name} · ${SCENE.nodes} nodes`));
    const compact = el('button', 'out-compact' + (state.compact ? ' is-on' : ''), icon('compact', 14));
    compact.title = 'Compact outliner (Tab)';
    compact.onclick = () => { state.compact = !state.compact; document.body.classList.toggle('is-compact', state.compact); render(); };
    head.appendChild(compact);
    return head;
  }

  /*── the census tiles ──────────────────────────────────────────────────────────────────────────*/
  function renderTiles() {
    const live = SCENE.rows.filter(r => r.category !== 'Folder');
    const shown = live.filter(r => r.visible).length;
    const hidden = live.length - shown;
    const box = el('div', 'out-tiles');
    [['Visible', shown, shown === live.length ? 'ok' : 'ok'], ['Hidden', hidden, hidden ? 'warn' : '']].forEach(([label, n, cls]) => {
      const tile = el('div', 'out-tile ' + cls);
      tile.appendChild(el('div', 'ss-ico', icon(label === 'Visible' ? 'check' : 'warn', 14)));
      tile.appendChild(el('div', 'ss-label', label));
      tile.appendChild(el('div', 'ss-figure', String(n)));
      box.appendChild(tile);
    });
    return box;
  }

  /*── the search pill and the Filter button with its 170 px popup ────────────────────────────────*/
  function renderSearch() {
    const bar = el('div', 'out-searchbar');
    const pill = el('div', 'out-search');
    pill.appendChild(el('span', null, icon('search', 16)));
    const input = el('input');
    input.type = 'text';
    input.placeholder = 'Search  Ctrl+Shift+F';
    input.value = state.search;
    input.oninput = () => { state.search = input.value; paintTree(); };
    pill.appendChild(input);
    bar.appendChild(pill);

    const lit = state.filters.filter(Boolean).length;
    const btn = el('button', 'out-filter' + (lit ? ' is-on' : ''));
    btn.append(el('span', null, icon('sliders', 14)), el('span', null, 'Filter'));
    if (lit) btn.appendChild(el('span', 'cnt', String(lit)));
    btn.onclick = () => {
      const menu = el('div', 'out-legend');
      FILTERS.forEach((f, i) => {
        const row = el('div', 'row' + (state.filters[i] ? ' is-on' : ''));
        const dot = el('span', 'dot'); dot.style.background = f.tint;
        row.append(dot, el('span', null, f.label));
        if (state.filters[i]) row.appendChild(el('span', null, icon('check', 14)));
        row.onclick = () => { state.filters[i] = !state.filters[i]; closeMenu(); render(); };
        menu.appendChild(row);
      });
      document.body.appendChild(menu);
      const r = btn.getBoundingClientRect();
      menu.style.left = Math.round(r.left) + 'px';
      menu.style.top = Math.round(r.bottom + 6) + 'px';
      const mr = menu.getBoundingClientRect();
      if (mr.right > innerWidth - 8) menu.style.left = Math.round(innerWidth - mr.width - 8) + 'px';
      if (OPEN_MENU) OPEN_MENU.remove();
      OPEN_MENU = menu;
      menu.classList.add('menu');
    };
    bar.appendChild(btn);
    return bar;
  }

  /*── the chips ─────────────────────────────────────────────────────────────────────────────────*/
  function renderChips() {
    const box = el('div', 'out-chips');
    FILTERS.forEach((f, i) => {
      if (!state.filters[i]) return;
      const chip = el('button', 'out-chip is-on');
      const dot = el('span', 'dot'); dot.style.background = f.tint;
      chip.append(dot, el('span', null, f.label), el('span', null, '✕'));
      chip.onclick = () => { state.filters[i] = false; render(); };
      box.appendChild(chip);
    });
    return box;
  }

  /*── one row ───────────────────────────────────────────────────────────────────────────────────*/
  function renderRow(i) {
    const row = SCENE.rows[i];
    const kids = hasKids(i);
    const el_ = el('div', 'out-row' + (row.visible ? '' : ' is-off') + (state.picked === i ? ' is-sel' : ''));
    el_.style.paddingLeft = (8 + 13 * row.depth) + 'px';
    el_.style.setProperty('--rowtint', row.tint || '#8b98a9');
    if (state.compact) el_.style.height = '34px';

    const chev = el('div', 'chev', kids ? icon(state.shut.has(row) ? 'chevronRight' : 'chevronDown', 14) : '');
    if (kids) chev.onclick = (e) => { e.stopPropagation(); state.shut.has(row) ? state.shut.delete(row) : state.shut.add(row); paintTree(); };
    el_.appendChild(chev);

    const box = el('div', 'ico');
    const tinted = icon(row.icon || 'cube', 22);
    const svg = box.appendChild(el('div', null, tinted));
    svg.querySelector('svg').style.color = row.tint;
    box.onclick = () => showLegend(row, box);
    el_.appendChild(box);

    el_.appendChild(el('div', 'name', row.label));
    if (row.tag) el_.appendChild(el('div', 'tag', row.tag));
    if (!state.compact) {
      const stat = el('div', 'stat');
      if (row.category !== 'Folder') {
        const standing = row.standing || (row.visible ? 'ok' : 'err');
        const dot = el('div');
        dot.style.cssText = 'width:16px;height:16px;border-radius:50%;display:grid;place-items:center';
        dot.style.background = standing === 'ok' ? 'var(--green)' : standing === 'warn' ? 'rgba(255,180,84,.22)' : 'rgba(255,80,80,.2)';
        dot.style.color = standing === 'ok' ? '#0b1a12' : standing === 'warn' ? 'var(--orange)' : 'var(--red)';
        dot.style.transform = 'scale(.9)';
        dot.appendChild(el('span', null, icon(standing === 'ok' ? 'check' : 'warn', 11)));
        stat.appendChild(dot);
      }
      el_.appendChild(stat);
      if (row.meta) {
        const meta = el('div', 'meta', row.meta);
        if (row.narrowing === 'Sky') meta.style.color = 'var(--t3)';
        el_.appendChild(meta);
      }
    } else if (row.meta) {
      el_.appendChild(el('div', 'meta', row.meta));
    }

    const eye = el('button', 'eye' + (row.visible ? '' : ' is-off'), icon(row.visible ? 'eye' : 'eyeOff', 13));
    eye.onclick = (e) => { e.stopPropagation(); row.visible = !row.visible; render(); };
    el_.appendChild(eye);

    el_.onclick = () => { state.picked = i; App.select(i); paintTree(); };
    el_.onmouseleave = () => hideLegend();
    el_.onmouseenter = (e) => App.hoverRow(row, el_);
    return el_;
  }

  /*── the legend popup — the row's own note and standing ────────────────────────────────────────*/
  let legend = null;
  function showLegend(row, anchor) {
    hideLegend();
    legend = el('div', 'out-legend');
    const head = el('div', 'row');
    const dot = el('span', 'dot'); dot.style.background = row.tint;
    head.append(dot, el('span', null, row.label));
    legend.appendChild(head);
    const body = row.note || (row.visible ? 'Visible in the world.' : 'Hidden — the eye puts it back.');
    const note = el('div', 'row'); note.style.height = 'auto'; note.style.padding = '6px 10px';
    note.append(el('span', null, body));
    legend.appendChild(note);
    document.body.appendChild(legend);
    const r = anchor.getBoundingClientRect();
    legend.style.left = Math.round(r.left) + 'px';
    legend.style.top = Math.round(r.bottom + 4) + 'px';
    const lr = legend.getBoundingClientRect();
    if (lr.right > innerWidth - 8) legend.style.left = Math.round(innerWidth - lr.width - 8) + 'px';
    if (lr.bottom > innerHeight - 8) legend.style.top = Math.round(r.top - lr.height - 4) + 'px';
  }
  function hideLegend() { if (legend) { legend.remove(); legend = null; } }

  /*── the tree ──────────────────────────────────────────────────────────────────────────────────*/
  function paintTree() {
    if (!treeEl) return;
    treeEl.replaceChildren();
    const rows = visibleRows();
    if (!rows.length) { treeEl.appendChild(el('div', 'out-empty', 'Nothing matches that search.')); return; }
    rows.forEach(i => treeEl.appendChild(renderRow(i)));
  }

  /*── the foot strip: five counters, the camera column the widest ───────────────────────────────*/
  function renderFoot() {
    const f = el('div', 'foot');
    const cam = App.state.camera;
    const cells = [
      ['REALTIME', String(App.state.fps), 'fps', App.state.fps >= 50 ? 'good' : (App.state.fps < 24 ? 'warn' : '')],
      ['QUALITY', App.state.quality, '', ''],
      ['SUN', `${App.state.sun}°`, '', ''],
      ['MOONS', `${App.state.moons}/4`, '', ''],
      ['CAM', `${cam.yaw.toFixed(0)}, ${cam.pitch.toFixed(1)}, ${cam.dist.toFixed(0)}`, '', '']
    ];
    cells.forEach(([label, fig, unit, cls], i) => {
      if (i) f.appendChild(el('div', 'sep'));
      const cell = el('div', 'cell');
      cell.appendChild(el('span', 'caps', label));
      cell.appendChild(el('span', 'fig ' + cls, fig));
      if (unit) cell.appendChild(el('span', null, unit));
      if (i === 4) cell.style.marginLeft = 'auto';
      f.appendChild(cell);
    });
    return f;
  }

  /*── the panel ─────────────────────────────────────────────────────────────────────────────────*/
  function render() {
    host.replaceChildren();
    const panel = host.closest('.panel');
    panel.style.flex = state.compact ? '0 0 236px' : (App.state.outlinerFlex || '');
    host.appendChild(renderHead());
    host.appendChild(renderTiles());
    host.appendChild(renderSearch());
    host.appendChild(renderChips());
    treeEl = el('div', 'out-tree');
    host.appendChild(treeEl);
    host.appendChild(renderFoot());
    paintTree();
  }

  function mount(node) { host = node; render(); }
  return { mount, render, state, visibleRows, foot: renderFoot };
})();

window.Outliner = Outliner;
