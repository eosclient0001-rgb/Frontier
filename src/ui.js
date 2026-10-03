// Studio control panel: builds the DOM for the material/dress/physics editors.
import { DRESS_STYLES, NECKLINE_OPTIONS } from './dress.js';
import { PATTERN_TYPES, MOTIF_STYLES, FABRIC_PRESETS } from './fabric.js';

const el = (tag, cls, html) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (html !== undefined) n.innerHTML = html;
  return n;
};

// Controls register a `sync()` here so a preset load can push state back into
// every widget that is bound to the same object.
const registry = [];
export function refreshAll() { for (const fn of registry) fn(); }

/** A collapsible section with a grid of controls inside. */
export function section(parent, title, subtitle, open = true) {
  const wrap = el('section', 'sec');
  const head = el('button', 'sec-head');
  head.innerHTML = `<span class="chev">${open ? '▾' : '▸'}</span><span>${title}</span>`;
  if (subtitle) head.innerHTML += `<span class="sec-sub">${subtitle}</span>`;
  const body = el('div', 'sec-body');
  body.style.display = open ? '' : 'none';
  head.onclick = () => {
    const hidden = body.style.display === 'none';
    body.style.display = hidden ? '' : 'none';
    head.querySelector('.chev').textContent = hidden ? '▾' : '▸';
  };
  wrap.append(head, body);
  parent.appendChild(wrap);
  return body;
}

export function slider(parent, label, obj, key, min, max, step, onInput, fmt = (v) => v.toFixed(2)) {
  const row = el('div', 'row');
  const lab = el('label', 'lab', `<span>${label}</span>`);
  const val = el('span', 'val', fmt(obj[key]));
  lab.appendChild(val);
  const input = el('input');
  input.type = 'range'; input.min = min; input.max = max; input.step = step;
  input.value = obj[key];
  input.oninput = () => {
    obj[key] = parseFloat(input.value);
    val.textContent = fmt(obj[key]);
    onInput?.(obj[key]);
  };
  const setVal = (v) => { obj[key] = v; input.value = v; val.textContent = fmt(v); };
  const sync = () => { if (obj[key] !== undefined) setVal(obj[key]); };
  registry.push(sync);
  row.append(lab, input);
  parent.appendChild(row);
  return { input, setVal, sync, row };
}

export function select(parent, label, obj, key, options, onChange) {
  const row = el('div', 'row');
  const lab = el('label', 'lab', `<span>${label}</span>`);
  const sel = el('select');
  for (const o of options) {
    const op = el('option', null, o.label);
    op.value = o.value;
    sel.appendChild(op);
  }
  const numeric = isNumeric(obj[key]) || options.every((o) => isNumeric(o.value));
  sel.value = obj[key];
  sel.onchange = () => { obj[key] = numeric ? parseFloat(sel.value) : sel.value; onChange?.(obj[key]); };
  const sync = () => { sel.value = obj[key]; };
  registry.push(sync);
  row.append(lab, sel);
  parent.appendChild(row);
  return { select: sel, sync, row };
}

export function toggle(parent, label, obj, key, onChange) {
  const row = el('div', 'row');
  const lab = el('label', 'lab', `<span>${label}</span>`);
  const btn = el('button', 'switch');
  const sync = () => btn.classList.toggle('on', !!obj[key]);
  sync();
  registry.push(sync);
  btn.onclick = () => { obj[key] = obj[key] ? 0 : 1; sync(); onChange?.(obj[key]); };
  row.append(lab, btn);
  parent.appendChild(row);
  return { btn, row, sync };
}

export function color(parent, label, obj, key, onChange) {
  const row = el('div', 'row');
  const lab = el('label', 'lab', `<span>${label}</span>`);
  const inp = el('input');
  inp.type = 'color';
  inp.value = obj[key];
  inp.oninput = () => { obj[key] = inp.value; onChange?.(inp.value); };
  const setVal = (v) => { obj[key] = v; inp.value = v; };
  const sync = () => { if (obj[key]) setVal(obj[key]); };
  registry.push(sync);
  row.append(lab, inp);
  parent.appendChild(row);
  return { input: inp, setVal, sync, row };
}

export function buttonRow(parent, buttons) {
  const row = el('div', 'btnrow');
  const made = {};
  for (const b of buttons) {
    const btn = el('button', `btn ${b.cls ?? ''}`, b.label);
    btn.onclick = b.onClick;
    row.appendChild(btn);
    made[b.id ?? b.label] = btn;
  }
  parent.appendChild(row);
  return made;
}

const isNumeric = (v) => typeof v === 'number';

/** Fabric preset chips. */
export function presetGrid(parent, onPick) {
  const grid = el('div', 'presets');
  for (const p of FABRIC_PRESETS) {
    const chip = el('button', 'chip');
    chip.innerHTML = `<span class="sw" style="background:${p.colA}"></span>${p.name}`;
    chip.onclick = () => onPick(p);
    grid.appendChild(chip);
  }
  parent.appendChild(grid);
  return grid;
}

export function styleOptions() {
  return Object.entries(DRESS_STYLES).map(([k, v]) => ({ value: k, label: v.label }));
}
export { NECKLINE_OPTIONS, PATTERN_TYPES, MOTIF_STYLES };
