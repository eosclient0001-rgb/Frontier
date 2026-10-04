/*==============================================================================================================================
  CONTROLS — ControlPanel.cpp in the browser. Every widget keeps its native figure:
  the 92 px split slider pill (black figure cell, inset unit cell) beside a 26 px track with a 12 px thumb,
  the 44×25 white switch, the three 26 px axis cells with X/Y/Z tints, the 52 px colour chip, the 32 px
  dropdown with its 36 px caret cell and 28 px menu rows, the right-aligned read-out, the 22 px pill toggle.
==============================================================================================================================*/

/** capture(element, event) — the pointer, when the engine offers it (jsdom and old WebKit do not). */
function capture(node, e) { if (node.setPointerCapture && e.pointerId !== undefined) { try { node.setPointerCapture(e.pointerId); } catch (err) { /* the drag still works on move */ } } }

const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html !== undefined) n.innerHTML = html; return n; };
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const fmt = (v, d) => Number(v).toFixed(d);

/*── the settled menu: one stands at a time, a contact outside withdraws it ─────────────────────*/
var OPEN_MENU = null;
function closeMenu() { if (OPEN_MENU) { OPEN_MENU.remove(); OPEN_MENU = null; } }
document.addEventListener('mousedown', (e) => { if (OPEN_MENU && !OPEN_MENU.contains(e.target)) closeMenu(); });

function popMenu(anchor, items, picked, onPick) {
  closeMenu();
  const m = el('div', 'menu');
  items.forEach((label, i) => {
    const it = el('div', 'item' + (i === picked ? ' is-sel' : ''), (i === picked ? '<span class="dot"></span>' : '<span style="width:7px"></span>') + label);
    it.onclick = () => { closeMenu(); onPick(i, label); };
    m.appendChild(it);
  });
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = Math.round(r.left) + 'px';
  m.style.top = Math.round(r.bottom + 8) + 'px';
  const mr = m.getBoundingClientRect();
  if (mr.bottom > innerHeight - 8) m.style.top = Math.round(r.top - mr.height - 8) + 'px';
  if (mr.right > innerWidth - 8) m.style.left = Math.round(innerWidth - mr.width - 8) + 'px';
  OPEN_MENU = m;
  return m;
}

/*── slider — the split pill and the 26 px track ─────────────────────────────────────────────────*/
function renderSlider(prop, onChange) {
  const wrap = el('div', 'slider' + (prop.hi ? ' hi' : ''));

  const pill = el('div', 'pill');
  const num = el('div', 'num');
  const unit = el('div', 'unit');
  num.textContent = fmt(prop.value, prop.decimals);
  unit.textContent = prop.unit || '';
  pill.append(num, unit);
  num.onclick = () => {
    const input = el('input');
    input.value = fmt(prop.value, prop.decimals);
    input.style.cssText = 'width:100%;background:none;border:0;outline:0;text-align:center;font:inherit;color:#f0f0f0';
    num.replaceChildren(input); input.focus(); input.select();
    const commit = () => { prop.value = clamp(parseFloat(input.value) || prop.value, prop.min, prop.max); num.textContent = fmt(prop.value, prop.decimals); onChange && onChange(prop); };
    input.onblur = commit;
    input.onkeydown = (e) => { if (e.key === 'Enter') { commit(); } if (e.key === 'Escape') { num.textContent = fmt(prop.value, prop.decimals); } };
  };

  const track = el('div', 'track');
  const fill = el('i'), thumb = el('b');
  track.append(fill, thumb);
  const paint = () => {
    const f = clamp((prop.value - prop.min) / (prop.max - prop.min || 1), 0, 1);
    fill.style.width = (f * 100) + '%';
    thumb.style.left = `calc(12px + ${f} * (100% - 24px))`;
    num.textContent = fmt(prop.value, prop.decimals);
  };
  const move = (e) => {
    const r = track.getBoundingClientRect();
    const f = clamp((e.clientX - r.left - 12) / Math.max(1, r.width - 24), 0, 1);
    let next = prop.min + f * (prop.max - prop.min);
    if (prop.decimals >= 3) next = Math.round(next * 1e4) / 1e4;
    else if (prop.decimals === 0) next = Math.round(next);
    prop.value = clamp(next, prop.min, prop.max);
    paint(); onChange && onChange(prop);
  };
  track.onpointerdown = (e) => { capture(track, e); track.classList.add('is-held'); move(e);
    track.onpointermove = (ev) => move(ev);
    track.onpointerup = () => { track.classList.remove('is-held'); track.onpointermove = null; }; };
  paint();
  wrap.append(pill, track);
  return wrap;
}

/*── switch — 44×25 ─────────────────────────────────────────────────────────────────────────────*/
function renderSwitch(prop, onChange) {
  const s = el('div', 'switch' + (prop.on ? ' is-on' : ''), '<i></i>');
  s.onclick = () => { prop.on = !prop.on; s.classList.toggle('is-on', prop.on); onChange && onChange(prop); };
  s.style.justifySelf = 'end';
  return s;
}

/*── axis vec3 — X / Y / Z cells, letters draggable ─────────────────────────────────────────────*/
function renderAxes(prop, onChange) {
  const row = el('div', 'axes');
  const vec = prop.value || prop.axes || [0, 0, 0];
  ['x', 'y', 'z'].forEach((axis, i) => {
    const cell = el('div', 'axis ' + axis + (prop.editable === false ? ' is-read' : ''));
    const letter = el('div', 'letter', axis.toUpperCase());
    const num = el('input', 'num');
    num.value = fmt(vec[i], 2);
    if (prop.editable !== false) {
      num.readOnly = false;
      num.onchange = () => { vec[i] = parseFloat(num.value) || 0; num.value = fmt(vec[i], 2); onChange && onChange(prop); };
      letter.onpointerdown = (e) => {
        const startX = e.clientX, start = vec[i];
        capture(letter, e);
        letter.onpointermove = (ev) => {
          vec[i] = Math.round((start + (ev.clientX - startX) * prop.step * 0.5) * 100) / 100;
          num.value = fmt(vec[i], 2); onChange && onChange(prop);
        };
        letter.onpointerup = () => { letter.onpointermove = null; };
      };
    } else { num.readOnly = true; }
    cell.append(letter, num);
    row.appendChild(cell);
  });
  return row;
}

/*── colour chip and the eight tint dots ────────────────────────────────────────────────────────*/
const SWATCHES = ['#ffffff', '#ef5350', '#ffb14b', '#f5d34b', '#69d06d', '#5b8cff', '#9a7bff', '#4fd1c5'];
function renderColour(prop, onChange) {
  const wrap = el('div');
  if (prop.swatches) {
    const row = el('div', 'swatches');
    SWATCHES.forEach(hex => {
      const b = el('b', hex.toLowerCase() === (prop.value || '').toLowerCase() ? 'is-on' : '');
      b.style.background = hex;
      b.onclick = () => { prop.value = hex; onChange && onChange(prop); wrap.replaceWith(renderColour(prop, onChange)); };
      row.appendChild(b);
    });
    wrap.appendChild(row);
    return wrap;
  }
  const row = el('div', 'chip');
  const chip = el('div', 'swatch'); chip.style.background = prop.value;
  const hex = el('div', 'hex', prop.value.toUpperCase());
  chip.onclick = () => {
    const picker = el('div', 'menu');
    const grid = el('div');
    grid.style.cssText = 'display:grid;grid-template-columns:repeat(8,20px);gap:6px;padding:4px';
    SWATCHES.concat(['#000000', '#3c3a36', '#8fb6ff', '#c2410c', '#7cc9a6', '#b9c2cc', '#f0f0f0', '#5c5c5c']).forEach(c => {
      const b = el('b');
      b.style.cssText = `width:20px;height:20px;border-radius:5px;cursor:pointer;border:1px solid #2e2e2e;background:${c}`;
      b.onclick = () => { prop.value = c; hex.textContent = c.toUpperCase(); chip.style.background = c; closeMenu(); onChange && onChange(prop); };
      grid.appendChild(b);
    });
    const field = el('input');
    field.value = prop.value.toUpperCase();
    field.style.cssText = 'width:100%;margin-top:8px;height:26px;border-radius:8px;background:#111;border:1px solid #2e2e2e;color:#f0f0f0;padding:0 8px;outline:0';
    field.onchange = () => { if (/^#?[0-9a-f]{6}$/i.test(field.value)) { const v = field.value.startsWith('#') ? field.value : '#' + field.value; prop.value = v; hex.textContent = v.toUpperCase(); chip.style.background = v; onChange && onChange(prop); } };
    picker.append(grid, field);
    document.body.appendChild(picker);
    const r = chip.getBoundingClientRect();
    picker.style.left = Math.round(r.left) + 'px'; picker.style.top = Math.round(r.bottom + 6) + 'px';
    if (OPEN_MENU) OPEN_MENU.remove();
    OPEN_MENU = picker;
  };
  row.append(chip, hex);
  wrap.appendChild(row);
  return wrap;
}

/*── dropdown — 32 px, black current cell, raised caret cell, 28 px menu rows ────────────────────*/
function renderSelect(prop, onChange) {
  const d = el('div', 'dropdown');
  const cur = el('div', 'cur', prop.options[prop.picked]);
  const caret = el('div', 'caret', icon('chevronUp', 14));
  caret.firstChild.style.transform = 'rotate(180deg)';
  d.append(cur, caret);
  d.onclick = () => popMenu(d, prop.options, prop.picked, (i) => { prop.picked = i; cur.textContent = prop.options[i]; onChange && onChange(prop); });
  return d;
}

/*── read-out — right-aligned tabular text ──────────────────────────────────────────────────────*/
function renderReadout(prop) { return el('div', 'readout', prop.text); }

/*── the card — 18 px radius, 24 px head, chevron, tracked caps ──────────────────────────────────*/
function renderCard(group) {
  const c = el('div', 'card' + (group.shut ? ' is-shut' : ''));
  const head = el('div', 'card-head');
  head.append(el('div', 'tri', group.shut ? '▶' : '▼'), el('div', 'caps', group.title));
  head.onclick = () => { group.shut = !group.shut; c.classList.toggle('is-shut', group.shut); head.querySelector('.tri').textContent = group.shut ? '▶' : '▼'; };
  const body = el('div', 'card-body');
  if (group.caption) body.appendChild(el('div', 'caption', group.caption));
  if (group.clock24) body.appendChild(renderClock(group));
  (group.props || []).forEach(p => {
    if (p.cat === 'image' || p.cat === 'button') return;   /* the bake tiles are drawn by the Sun sheet */
    const prow = el('div', 'prop p-' + p.cat + (group.stacked ? ' stacked' : ''));
    prow.appendChild(el('div', 'label', p.label));
    const zone = el('div', 'zone');
    switch (p.cat) {
      case 'slider': zone.appendChild(renderSlider(p, group.onChange)); break;
      case 'switch': zone.appendChild(renderSwitch(p, group.onChange)); break;
      case 'axes':   zone.appendChild(renderAxes(p, group.onChange)); break;
      case 'colour': zone.appendChild(renderColour(p, group.onChange)); break;
      case 'select': zone.appendChild(renderSelect(p, group.onChange)); break;
      default:       zone.appendChild(renderReadout(p));
    }
    prow.appendChild(zone);
    body.appendChild(prow);
  });
  c.append(head, body);
  return c;
}

/*── the 24-hour clock face — Day cycle's own drawing (126 px) ──────────────────────────────────*/
function renderClock(group) {
  const box = el('div');
  box.style.cssText = 'height:126px;display:grid;place-items:center';
  const hours = (group.props.find(p => p.label === 'Local Hours') || {value:12}).value;
  const svg = [`<svg width="126" height="126" viewBox="0 0 126 126">`,
    `<circle cx="63" cy="63" r="43" fill="none" stroke="rgba(255,255,255,.05)" stroke-width="2"/>`];
  for (let h = 0; h < 24; h++) {
    const a = h * Math.PI * 2 / 24 - Math.PI / 2, inner = h % 6 === 0 ? 35 : 39;
    svg.push(`<line x1="${63 + Math.cos(a) * inner}" y1="${63 + Math.sin(a) * inner}" x2="${63 + Math.cos(a) * 43}" y2="${63 + Math.sin(a) * 43}" stroke="#888"/>`);
  }
  const a = hours * Math.PI * 2 / 24 - Math.PI / 2;
  svg.push(`<circle cx="${63 + Math.cos(a) * 43}" cy="${63 + Math.sin(a) * 43}" r="5" fill="#f5b75c"/>`);
  svg.push(`<text x="58" y="6" fill="#888" font-size="9">00</text><text x="113" y="66" fill="#888" font-size="9">06</text>`,
           `<text x="58" y="124" fill="#888" font-size="9">12</text><text x="1" y="66" fill="#888" font-size="9">18</text></svg>`);
  box.innerHTML = svg.join('');
  return box;
}

/*── the Instance standing card — VISIBLE / LOCKED / DYNAMIC / PHYSICS + TYPE + ID ───────────────*/
function renderStanding(row, onChange) {
  const c = el('div', 'card');
  c.appendChild(el('div', 'card-head', '<div class="tri"></div><div class="caps">Instance</div>'));
  const body = el('div', 'card-body');
  const pills = el('div', 'pills');
  [['VISIBLE', 'visible'], ['LOCKED', 'locked'], ['DYNAMIC', 'dynamic'], ['PHYSICS', 'physics']].forEach(([label, key]) => {
    const b = el('button', 'pilltoggle' + (row[key] ? ' is-on' : ''), label);
    b.onclick = () => { row[key] = !row[key]; b.classList.toggle('is-on', row[key]); onChange && onChange(row); };
    pills.appendChild(b);
  });
  body.appendChild(pills);
  [['TYPE', row.category === 'Folder' ? 'Folder' : (row.category || 'Geometry')],
   ['ID', '#' + String(row.id).padStart(3, '0')]].forEach(([k, v]) => {
    const p = el('div', 'prop'); p.appendChild(el('div', 'label', k));
    const z = el('div', 'zone'); z.appendChild(el('div', 'readout', v)); p.appendChild(z);
    body.appendChild(p);
  });
  c.appendChild(body);
  return c;
}

/*── the Notes card ─────────────────────────────────────────────────────────────────────────────*/
function renderNotes(row) {
  const c = el('div', 'card');
  c.appendChild(el('div', 'card-head', '<div class="tri"></div><div class="caps">Notes</div>'));
  const body = el('div', 'card-body');
  const ta = el('textarea', 'notes');
  ta.value = row.notes || '';
  ta.oninput = () => { row.notes = ta.value; };
  body.appendChild(ta);
  c.appendChild(body);
  return c;
}

Object.assign(window, { el, clamp, capture, fmt, closeMenu, popMenu, SWATCHES, renderSlider, renderSwitch, renderAxes, renderColour, renderSelect, renderReadout, renderCard, renderClock, renderStanding, renderNotes });
