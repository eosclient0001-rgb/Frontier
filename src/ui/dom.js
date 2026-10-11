/**
 * Frontier Terrain Forge — DOM kit.
 *
 * Small helpers that keep the editor's vocabulary in one place: an eyebrow, a
 * card, a slider with a value readout, the 29×17 toggle. Everything the panels
 * render is built from these, so the interface stays visually consistent with
 * the Frontier editor prototype without a framework.
 */

export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'html') node.innerHTML = value;
    else if (key === 'style') Object.assign(node.style, value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key === 'value') node.value = value;
    else if (key === 'checked' || key === 'hidden' || key === 'disabled') node[key] = !!value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat(4)) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export const clear = (node) => { while (node.firstChild) node.removeChild(node.firstChild); return node; };

const PATHS = {
  mountain: 'M3 19h18L14 7l-3 5-2-3z',
  waves: 'M3 12c2.5-3 5-3 7.5 0S16 15 21 12M3 17c2.5-3 5-3 7.5 0S16 20 21 17M3 7c2.5-3 5-3 7.5 0S16 10 21 7',
  layers: 'M12 3 3 8l9 5 9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  canyon: 'M4 20V9l4-2v6l3-4 3 5V6l6 3v11z',
  dunes: 'M3 17c3.5 0 5-6 9-6s5.5 6 9 6M3 20h18',
  volcano: 'M12 4l3 6 4 10H5l4-10zM10 9h4',
  island: 'M3 16c2 3 5 4 9 4s7-1 9-4M8 12c2-2 6-2 8 0',
  noise: 'M4 15c2-6 4 6 6 0s4-6 6 0 3 2 4-1',
  strata: 'M3 7h18M3 12h18M3 17h18',
  cracks: 'M6 4l3 6-2 4 3 6M14 3l2 7-3 3 2 7',
  warp: 'M3 9c4-4 6 4 10 0s6 3 8-1M3 16c4-4 6 4 10 0s6 3 8-1',
  smooth: 'M3 16c3 0 4-8 8-8s5 8 9 8',
  detail: 'M4 18l4-6 3 3 3-7 5 10z',
  flat: 'M3 17h18M6 13h12',
  water: 'M12 3c4 5 6 8 6 11a6 6 0 1 1-12 0c0-3 2-6 6-11z',
  talus: 'M3 19h18M6 15l4-5 3 3 5-6',
  rock: 'M5 18l2-9 6-4 6 6-2 7z',
  soil: 'M4 18h16M6 14c1-2 3-2 4 0M13 14c1-2 3-2 4 0',
  grass: 'M12 20V9M12 12c-2-1-4-3-4-6 3 0 5 2 5 5M12 13c2-1 4-3 4-6-3 0-5 2-5 5',
  forest: 'M12 3 6 12h3l-3 5h12l-3-5h3zM12 17v4',
  sand: 'M3 16c3 0 4 2 8 2s5-2 8-2M6 11h2M13 9h2M9 7h2',
  snow: 'M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9',
  gravel: 'M6 8h3v3H6zM13 6h3v3h-3zM9 14h3v3H9zM15 13h3v3h-3z',
  custom: 'M12 4l2.5 5 5.5.8-4 3.9.9 5.5L12 16.6 7.1 19.2l.9-5.5-4-3.9L9.5 9z',
  eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  eyeOff: 'M4 4l16 16M9.5 9.6A3 3 0 0 0 12 15c.9 0 1.7-.4 2.2-1M6.3 6.7C3.9 8.2 2 12 2 12s3.5 6 10 6c1.6 0 3-.4 4.3-1M11 6.1c.3 0 .6-.1 1-.1 6.5 0 10 6 10 6s-.7 1.3-2 2.6',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  more: 'M6 12h.01M12 12h.01M18 12h.01',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  chevron: 'M9 6l6 6-6 6',
  chevronDown: 'M6 9l6 6 6-6',
  reset: 'M4 12a8 8 0 1 0 3-6.2M4 4v5h5',
  sun: 'M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19',
  camera: 'M4 8h3l2-2h6l2 2h3v11H4zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  brush: 'M5 19c3 0 3-2 5-2s2 2 5 2M14 4l6 6-7 7-6-6z',
  download: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  upload: 'M12 20V9M7 13l5-5 5 5M5 4h14',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  grid: 'M3 9h18M3 15h18M9 3v18M15 3v18',
  clock: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16zM12 8v4l3 2',
  droplet: 'M12 3c4 5 6 8 6 11a6 6 0 1 1-12 0c0-3 2-6 6-11z',
  pick: 'M4 20l7-7M9 4l11 11-3 3-11-11z',
  flatten: 'M4 17h16M8 12h8M10 7h4',
  spray: 'M4 20l3-3M8 16l3-3M12 12l3-3M16 8l3-3M4 10h4M14 4h6',
  lift: 'M12 20V6M7 11l5-5 5 5',
  lower: 'M12 4v14M7 13l5 5 5-5',
};

export function icon(name, size = 16) {
  const path = PATHS[name] || PATHS.sparkle;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.4');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', path);
  svg.append(p);
  return svg;
}

export function eyebrow(text) { return el('div', { class: 'eyebrow', text }); }

export function card(title, { hint, sub, icon: iconName } = {}) {
  const body = el('div', { class: 'card-body' });
  const heading = el('div', { class: 'card-heading' },
    el('span', {}, iconName ? icon(iconName, 14) : null, el('span', { text: title })),
    hint ? el('span', { class: 'hint', text: hint }) : null,
  );
  const root = el('section', { class: 'card' }, heading, sub ? el('div', { class: 'card-sub', text: sub }) : null, body);
  return { root, body };
}

const formatValue = (value, format, unit) => {
  if (format) return format(value);
  const abs = Math.abs(value);
  const digits = abs >= 100 ? 0 : abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
  const text = Number(value).toFixed(digits);
  return unit === 'm' && abs >= 1000 ? `${(value / 1000).toFixed(2)} km` : `${text}${unit ? ` ${unit}` : ''}`;
};

/**
 * A labelled slider. `onInput` fires while dragging (used for cheap, live
 * updates) and `onChange` when the value is committed, which is when the graph
 * is regenerated.
 */
export function slider({ label, value, min, max, step, unit = '', hint, format, onInput, onChange, disabled }) {
  const readout = el('span', { class: 'control-value', text: formatValue(value, format, unit) });
  const input = el('input', {
    type: 'range', min, max, step: step ?? (max - min) / 200, value: value ?? min,
    disabled: disabled || undefined,
  });
  const paint = (v) => { input.style.setProperty('--progress', `${((v - min) / Math.max(max - min, 1e-9)) * 100}%`); };
  paint(value);
  input.addEventListener('input', () => {
    const v = Number(input.value);
    paint(v);
    readout.textContent = formatValue(v, format, unit);
    onInput?.(v);
  });
  input.addEventListener('change', () => onChange?.(Number(input.value)));
  return el('div', { class: 'control' },
    el('div', { class: 'control-head' }, el('span', { class: 'control-label', text: label }), readout),
    input,
    hint ? el('div', { class: 'control-hint', text: hint }) : null,
  );
}

export function toggleLine(label, value, onChange, { hint } = {}) {
  const knob = el('span');
  const pill = el('div', { class: `toggle${value ? ' on' : ''}` }, knob);
  const line = el('div', { class: 'toggle-line' },
    el('span', { text: label }),
    pill,
  );
  line.addEventListener('click', () => {
    const next = !pill.classList.contains('on');
    pill.classList.toggle('on', next);
    onChange(next);
  });
  return hint ? el('div', {}, line, el('div', { class: 'control-hint', text: hint })) : line;
}

export function selectLine(label, value, options, onChange) {
  const select = el('select', {});
  for (const option of options) {
    select.append(el('option', { value: String(option.value), text: option.label, selected: String(option.value) === String(value) }));
  }
  select.addEventListener('change', () => onChange(select.value));
  return el('div', { class: 'control' },
    el('div', { class: 'control-head' }, el('span', { class: 'control-label', text: label })),
    el('div', { class: 'field' }, select),
  );
}

export function numberLine(label, value, { step = 1, min = -1e9, max = 1e9, onChange, unit } = {}) {
  const input = el('input', { type: 'number', value: String(value), step, min, max });
  input.addEventListener('change', () => onChange?.(Number(input.value)));
  return el('div', { class: 'control' },
    el('div', { class: 'control-head' },
      el('span', { class: 'control-label', text: label }),
      unit ? el('span', { class: 'control-hint', text: unit }) : null,
    ),
    el('div', { class: 'field' }, input),
  );
}

export function buttonRow(buttons) {
  return el('div', { class: 'button-row' },
    ...buttons.filter(Boolean).map((b) => el('button', {
      class: `outline${b.accent ? ' accent' : ''}`,
      text: b.label,
      title: b.title,
      onclick: b.onClick,
    }, b.icon ? icon(b.icon, 13) : null)),
  );
}

export function sortable(node, handlers) {
  node.draggable = true;
  node.addEventListener('dragstart', (event) => {
    event.dataTransfer.setData('text/plain', node.dataset.id || '');
    event.dataTransfer.effectAllowed = 'move';
    handlers.onStart?.();
  });
  node.addEventListener('dragover', (event) => {
    event.preventDefault();
    const rect = node.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    node.classList.toggle('drop-after', after);
    node.classList.toggle('drop-before', !after);
  });
  node.addEventListener('dragleave', () => node.classList.remove('drop-before', 'drop-after'));
  node.addEventListener('drop', (event) => {
    event.preventDefault();
    const rect = node.getBoundingClientRect();
    const after = event.clientY > rect.top + rect.height / 2;
    node.classList.remove('drop-before', 'drop-after');
    handlers.onDrop?.(after);
  });
  node.addEventListener('dragend', () => {
    node.classList.remove('drop-before', 'drop-after');
    handlers.onEnd?.();
  });
  return node;
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = el('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
