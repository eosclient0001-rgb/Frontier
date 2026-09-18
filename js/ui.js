/* ============================================================
 * Frontier · SDF Terrain Lab — Professional UI kit
 * Small DOM builders for the Gaea-style dark control panel.
 * ============================================================ */

/** Section block with a titled header. */
export function mkSection(parent, title, hint) {
  const sec = document.createElement('section');
  sec.className = 'sec';
  const head = document.createElement('div');
  head.className = 'sec-head';
  const h = document.createElement('h3');
  h.textContent = title;
  head.appendChild(h);
  if (hint) {
    const s = document.createElement('span');
    s.className = 'sec-hint';
    s.textContent = hint;
    head.appendChild(s);
  }
  sec.appendChild(head);
  const body = document.createElement('div');
  body.className = 'sec-body';
  sec.appendChild(body);
  parent.appendChild(sec);
  return body;
}

/** Range slider row: label — value readout, with styled track. */
export function mkSlider(body, { id, label, min, max, step, value, fmt, unit = '' }) {
  const row = document.createElement('div');
  row.className = 'row';
  const lab = document.createElement('label');
  lab.textContent = label;
  lab.title = id;
  const val = document.createElement('span');
  val.className = 'val mono';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = min; input.max = max; input.step = step; input.value = value;
  const show = () => {
    const v = parseFloat(input.value);
    val.textContent = (fmt ? fmt(v) : trimNum(v)) + unit;
    const pct = ((v - min) / (max - min)) * 100;
    input.style.setProperty('--fill', pct + '%');
  };
  input.addEventListener('input', () => {
    show();
    row.dispatchEvent(new CustomEvent('ui:change', { detail: { id, value: parseFloat(input.value) } }));
  });
  row.appendChild(lab);
  row.appendChild(val);
  row.appendChild(input);
  body.appendChild(row);
  show();
  return {
    id, row, input, valEl: val,
    get: () => parseFloat(input.value),
    set: (v) => { input.value = v; show(); },
  };
}

/** Select row. */
export function mkSelect(body, { id, label, options, value }) {
  const row = document.createElement('div');
  row.className = 'row row-select';
  const lab = document.createElement('label');
  lab.textContent = label;
  const sel = document.createElement('select');
  for (const [v, t] of options) {
    const o = document.createElement('option');
    o.value = v; o.textContent = t;
    if (String(v) === String(value)) o.selected = true;
    sel.appendChild(o);
  }
  sel.addEventListener('change', () =>
    row.dispatchEvent(new CustomEvent('ui:change', { detail: { id, value: sel.value } })));
  row.appendChild(lab);
  row.appendChild(sel);
  body.appendChild(row);
  return {
    id, row, input: sel,
    get: () => sel.value,
    set: (v) => { sel.value = v; },
  };
}

/** Checkbox row. */
export function mkCheck(body, { id, label, value, hint }) {
  const row = document.createElement('label');
  row.className = 'row row-check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = !!value;
  input.addEventListener('change', () =>
    row.dispatchEvent(new CustomEvent('ui:change', { detail: { id, value: input.checked } })));
  const lab = document.createElement('span');
  lab.textContent = label;
  if (hint) {
    const s = document.createElement('span');
    s.className = 'dim small';
    s.textContent = ' — ' + hint;
    lab.appendChild(s);
  }
  row.appendChild(input);
  row.appendChild(lab);
  body.appendChild(row);
  return {
    id, row, input,
    get: () => input.checked,
    set: (v) => { input.checked = !!v; },
  };
}

/** Seed row: integer field + dice (randomize). */
export function mkSeed(body, { id, label, value, min = 1, max = 99999 }) {
  const row = document.createElement('div');
  row.className = 'row row-seed';
  const lab = document.createElement('label');
  lab.textContent = label;
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'mono';
  input.min = min; input.max = max; input.value = value;
  input.addEventListener('change', () => {
    let v = parseInt(input.value, 10);
    if (!Number.isFinite(v)) v = 1;
    input.value = v;
    row.dispatchEvent(new CustomEvent('ui:change', { detail: { id, value: v } }));
  });
  const dice = document.createElement('button');
  dice.className = 'dice';
  dice.title = 'randomize';
  dice.textContent = '⚄';
  dice.addEventListener('click', () => {
    const v = 1 + ((Math.random() * (max - min)) | 0);
    input.value = v;
    row.dispatchEvent(new CustomEvent('ui:change', { detail: { id, value: v } }));
  });
  row.appendChild(lab);
  row.appendChild(input);
  row.appendChild(dice);
  body.appendChild(row);
  return {
    id, row, input,
    get: () => parseInt(input.value, 10) || 1,
    set: (v) => { input.value = v; },
  };
}

/** Plain readout line (label + value span). */
export function mkReadout(body, label, cls = '') {
  const row = document.createElement('div');
  row.className = 'row row-readout ' + cls;
  const lab = document.createElement('label');
  lab.textContent = label;
  const val = document.createElement('span');
  val.className = 'val mono';
  val.textContent = '—';
  row.appendChild(lab);
  row.appendChild(val);
  body.appendChild(row);
  return { set: (v) => { val.textContent = v; }, valEl: val };
}

/** Stat row for the right-hand data panel. */
export function mkStat(parent, label) {
  const row = document.createElement('div');
  row.className = 'stat';
  const lab = document.createElement('span');
  lab.className = 'stat-lab';
  lab.textContent = label;
  const val = document.createElement('span');
  val.className = 'stat-val mono';
  val.textContent = '—';
  row.appendChild(lab);
  row.appendChild(val);
  parent.appendChild(row);
  return { set: (v) => { val.textContent = v; }, valEl: val };
}

export function trimNum(v) {
  if (Number.isInteger(v)) return String(v);
  const a = Math.abs(v);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toFixed(3);
}

export function fmtMeters(v) {
  return Math.abs(v) >= 10 ? v.toFixed(1) + ' m' : (v * 100).toFixed(1) + ' cm';
}
