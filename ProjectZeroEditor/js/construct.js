/*==============================================================================================================================
  CONSTRUCT — NativeConstructPanel.h. The 860 × 760 sheet over #171717, its header "CONSTRUCT / FRONTIER" with the
  "01 Entities > 02 Properties" crumb, the catalogue page (the "Search existing engine entities..." field, the 138 px
  index of groups, the 116 px tiles with their 52 px artwork, the note under them) and the properties page ("< Entities",
  the subject, "Enable in world" when a parent hides the row, then the very same InspectorPanel sheet — not a copy of it).
  Esc steps back one page before it shuts the sheet, and the two pages slide on the native 0.28 s.
==============================================================================================================================*/

const Construct = (() => {
  let scrim = null, root = null, slide = null, groupsEl = null, tilesEl = null, searchEl = null,
      crumbEl = null, propsEl = null, subjectEl = null, backEl = null, closeEl = null;
  let group = 'All', query = '', subject = null;

  /* the catalogue names its records as strings; the tile adds the artwork and its group */
  const flatten = () => CATALOGUE.flatMap(g => g.items.map(label =>
    ({ group: g.group, tint: g.tint, label, icon: CATALOGUE_ICON[label] || 'cube' })));
  const inGroup = (name) => {
    const g = CATALOGUE.find(x => x.group === name);
    return g ? g.items.map(label => ({ group: g.group, tint: g.tint, label, icon: CATALOGUE_ICON[label] || 'cube' })) : [];
  };

  function renderGroups() {
    groupsEl.replaceChildren();
    ['All', ...CATALOGUE.map(g => g.group)].forEach(name => {
      const items = name === 'All' ? flatten() : inGroup(name);
      const b = el('button', name === group ? 'is-on' : '', name);
      b.dataset.count = items.length;
      b.appendChild(el('span', 'cnt', String(items.length)));
      b.onclick = () => { group = name; renderGroups(); renderTiles(); };
      groupsEl.appendChild(b);
    });
  }

  function renderTiles() {
    const items = (group === 'All' ? flatten() : inGroup(group))
      .filter(i => !query || i.label.toLowerCase().includes(query.toLowerCase()));
    tilesEl.replaceChildren();
    if (!items.length) { tilesEl.appendChild(el('div', 'construct-note', 'No engine entity answers that.')); return; }
    items.forEach((item, i) => {
      const tile = el('div', 'construct-tile');
      const art = el('div', 'art', icon(item.icon, 44));
      art.style.color = i % 2 ? '#d8d8d8' : (item.tint || '#d8d8d8');
      tile.appendChild(art);
      tile.appendChild(el('div', 'nm', item.label));
      tile.appendChild(el('div', 'cat', item.group));
      tile.onclick = () => activate(item);
      tilesEl.appendChild(tile);
    });
  }

  function activate(item) {
    const row = SCENE.rows.find(r => r.label === item.label);
    if (row) { App.select(SCENE.rows.indexOf(row)); }
    else {
      /* a catalogue-only record: seat it in the roster with the sheet the tile names */
      App.add(item.label, item.sheet, item.icon);
    }
    openProps(item.label, item.sheet);
  }

  function openProps(label, sheetName) {
    subjectEl.textContent = label;
    propsEl.replaceChildren();
    const row = SCENE.rows.find(r => r.label === label);
    if (row && row.parentHidden) {
      const enable = el('button', 'enablebtn', 'Enable in world');
      enable.onclick = () => { row.parentHidden = false; openProps(label, sheetName); };
      propsEl.appendChild(enable);
    }
    const holder = el('div', 'insp-scroll');
    holder.style.padding = '0';
    const sheet = SHEETS[sheetName] || SHEETS.material;
    (sheet.groups || []).forEach(g => holder.appendChild(renderCard(Object.assign({}, g, { props: g.props.map(p => Object.assign({}, p)) }))));
    propsEl.appendChild(holder);
    root.classList.add('show-props');
    crumbEl.textContent = '01 Entities  >  02 Properties';
  }
  function toCatalogue() {
    root.classList.remove('show-props');
    crumbEl.textContent = '01 Entities  >  02 Properties';
  }

  function open() {
    scrim.hidden = false;
    toCatalogue();
    searchEl.value = '';
    query = '';
    renderGroups();
    renderTiles();
    searchEl.focus();
  }
  function close() { scrim.hidden = true; }
  function isOpen() { return !scrim.hidden; }
  function back() { if (root.classList.contains('show-props')) { toCatalogue(); return true; } return false; }

  function mount(nodes) {
    scrim = nodes.scrim;
    root = nodes.root;
    slide = nodes.slide;
    groupsEl = nodes.groups;
    tilesEl = nodes.tiles;
    searchEl = nodes.search;
    crumbEl = nodes.crumb;
    propsEl = nodes.props;
    subjectEl = nodes.subject;
    backEl = nodes.back;
    closeEl = nodes.close;

    searchEl.oninput = () => { query = searchEl.value; renderTiles(); };
    backEl.onclick = toCatalogue;
    closeEl.onclick = close;
    scrim.onclick = (e) => { if (e.target === scrim) close(); };
    renderGroups();
    renderTiles();
  }
  return { mount, open, close, isOpen, back };
})();

window.Construct = Construct;
