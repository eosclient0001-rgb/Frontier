// Reusable inspector widgets. Every control takes an `onChange` and returns an
// element, so panels are pure composition.

import { clamp, formatNumber } from '../core/math.js';

export function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

const toLog = (v, min, max) => {
  const a = Math.log(Math.max(min, 1e-6)), b = Math.log(Math.max(max, 1e-6));
  return (Math.log(Math.max(v, 1e-6)) - a) / (b - a || 1);
};
const fromLog = (t, min, max) => {
  const a = Math.log(Math.max(min, 1e-6)), b = Math.log(Math.max(max, 1e-6));
  return Math.exp(a + t * (b - a));
};

/**
 * Label + slider + draggable numeric readout.
 */
export function slider(opts) {
  const {
    value, min = 0, max = 1, step = 0.01, log = false, unit = '', scale = 1,
    decimals = null, onChange, onCommit,
  } = opts;
  const root = el('div', 'slider' + (log ? ' log' : ''));
  const track = el('div', 'track');
  const fill = el('div', 'fill');
  const thumb = el('div', 'thumb');
  const num = el('div', 'num');
  track.append(fill, thumb);
  root.append(track, num);

  let v = value;
  const disp = (x) => (x / scale).toFixed(decimals ?? (step >= 1 ? 0 : Math.min(3, Math.max(0, Math.ceil(-Math.log10(step * scale)))))) + unit;

  const paint = () => {
    const t = log ? toLog(v, min, max) : (v - min) / (max - min || 1);
    const p = clamp(t, 0, 1) * 100;
    fill.style.width = p + '%';
    thumb.style.left = p + '%';
    num.textContent = disp(v);
  };

  const setFromClientX = (clientX) => {
    const r = track.getBoundingClientRect();
    let t = clamp((clientX - r.left) / Math.max(r.width, 1), 0, 1);
    let nv = log ? fromLog(t, min, max) : min + t * (max - min);
    if (step) nv = Math.round(nv / step) * step;
    v = clamp(nv, min, max);
    paint();
    onChange?.(v);
  };

  track.addEventListener('pointerdown', (e) => {
    track.setPointerCapture?.(e.pointerId);
    root.classList.add('drag');
    setFromClientX(e.clientX);
    const move = (ev) => setFromClientX(ev.clientX);
    const up = (ev) => {
      track.releasePointerCapture?.(ev.pointerId);
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', up);
      root.classList.remove('drag');
      onCommit?.(v);
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
  });

  // drag the number itself
  let nx = 0, nv = 0;
  num.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    num.setPointerCapture?.(e.pointerId);
    nx = e.clientX; nv = v;
    root.classList.add('drag');
    const move = (ev) => {
      const span = (max - min) || 1;
      const d = ((ev.clientX - nx) / 180) * span * (log ? 0.6 : 1);
      let t = log ? clamp(toLog(nv, min, max) + (ev.clientX - nx) / 180, 0, 1) : 0;
      let val = log ? fromLog(t, min, max) : nv + d;
      if (step) val = Math.round(val / step) * step;
      v = clamp(val, min, max);
      paint();
      onChange?.(v);
    };
    const up = (ev) => {
      num.releasePointerCapture?.(ev.pointerId);
      num.removeEventListener('pointermove', move);
      num.removeEventListener('pointerup', up);
      root.classList.remove('drag');
      onCommit?.(v);
    };
    num.addEventListener('pointermove', move);
    num.addEventListener('pointerup', up);
  });
  num.title = 'Drag to adjust';

  root.setValue = (nv) => { v = nv; paint(); };
  root.getValue = () => v;
  paint();
  return root;
}

export function toggle(value, onChange, label = '') {
  const b = el('button', 'toggle-pill' + (value ? ' on' : ''));
  b.innerHTML = '<span></span>';
  if (label) b.title = label;
  b.addEventListener('click', () => {
    const on = !b.classList.contains('on');
    b.classList.toggle('on', on);
    onChange?.(on);
  });
  b.setValue = (v) => b.classList.toggle('on', !!v);
  return b;
}

export function checkbox(value, onChange) {
  const i = el('input');
  i.type = 'checkbox';
  i.checked = !!value;
  i.addEventListener('change', () => onChange?.(i.checked));
  return i;
}

export function seg(options, value, onChange, cls = '') {
  const root = el('div', 'seg ' + cls);
  const buttons = options.map(([label, val]) => {
    const b = el('button', 'btn' + (val === value ? ' sel' : ''));
    b.innerHTML = `<span class="caps">${label}</span>`;
    b.addEventListener('click', () => {
      root.querySelectorAll('.btn').forEach((x) => x.classList.remove('sel'));
      b.classList.add('sel');
      onChange?.(val);
    });
    root.append(b);
    return b;
  });
  root.setValue = (v) => {
    buttons.forEach((b, i) => b.classList.toggle('sel', options[i][1] === v));
  };
  return root;
}

export function select(options, value, onChange, cls = '') {
  const s = el('select', 'sel ' + cls);
  for (const [label, val] of options) {
    const o = el('option', null, label);
    o.value = val;
    s.append(o);
  }
  s.value = value;
  s.addEventListener('change', () => {
    const v = options.find((o) => String(o[1]) === s.value);
    onChange?.(v ? v[1] : s.value);
  });
  s.setValue = (v) => { s.value = v; };
  return s;
}

/**
 * Dual-handle band with feather regions — the workhorse of layer masking.
 */
export function range(opts) {
  const { lo, hi, featherLo, featherHi, min = 0, max = 1, step = 0.005, scale = 1, unit = '', onChange, onCommit } = opts;
  const root = el('div');
  const wrap = el('div', 'range');
  const bg = el('div', 'track-bg');
  const fl = el('div', 'feather');   // low feather
  const fh = el('div', 'feather');   // high feather
  const fill = el('div', 'track-fill');
  const hLo = el('div', 'h');
  const hHi = el('div', 'h');
  const hFL = el('div', 'h feather-h');
  const hFH = el('div', 'h feather-h');
  hFL.style.opacity = '.65';
  hFH.style.opacity = '.65';
  wrap.append(bg, fl, fh, fill, hLo, hHi, hFL, hFH);
  const labels = el('div', 'range-labels');
  const lLo = el('span');
  const lHi = el('span');
  labels.append(lLo, lHi);
  root.append(wrap, labels);

  const st = { lo, hi, featherLo, featherHi };
  const pct = (x) => clamp((x - min) / (max - min || 1), 0, 1) * 100;

  const paint = () => {
    const a = pct(st.lo), b = pct(st.hi);
    fill.style.left = a + '%';
    fill.style.width = Math.max(0, b - a) + '%';
    fl.style.left = pct(st.lo - st.featherLo) + '%';
    fl.style.width = pct(st.featherLo) * 2 + '%';
    fh.style.left = pct(st.hi - st.featherHi) + '%';
    fh.style.width = pct(st.featherHi) * 2 + '%';
    hLo.style.left = a + '%';
    hHi.style.left = b + '%';
    hFL.style.left = pct(st.lo - st.featherLo * 2) + '%';
    hFH.style.left = pct(st.hi + st.featherHi * 2) + '%';
    lLo.textContent = (st.lo * scale).toFixed(unit === '°' ? 0 : 2) + unit;
    lHi.textContent = (st.hi * scale).toFixed(unit === '°' ? 0 : 2) + unit;
  };

  const drag = (handle, fn) => {
    handle.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      handle.setPointerCapture?.(e.pointerId);
      const move = (ev) => {
        const r = wrap.getBoundingClientRect();
        const t = clamp((ev.clientX - r.left) / Math.max(r.width, 1), 0, 1);
        fn(min + t * (max - min));
        paint();
        onChange?.(st);
      };
      const up = (ev) => {
        handle.releasePointerCapture?.(ev.pointerId);
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        onCommit?.(st);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
    });
  };

  const q = (x) => step ? Math.round(x / step) * step : x;
  drag(hLo, (x) => { st.lo = clamp(q(x), min, st.hi); });
  drag(hHi, (x) => { st.hi = clamp(q(x), st.lo, max); });
  drag(hFL, (x) => { st.featherLo = clamp(q(Math.abs(st.lo - x)), 0, (max - min) * 0.5); });
  drag(hFH, (x) => { st.featherHi = clamp(q(Math.abs(x - st.hi)), 0, (max - min) * 0.5); });

  paint();
  root.state = st;
  return root;
}

export function colorSwatch(rgb, onChange) {
  const s = el('label', 'swatch');
  const i = el('input');
  i.type = 'color';
  const toHex = (c) => '#' + c.map((x) => Math.round(clamp(x, 0, 1) * 255).toString(16).padStart(2, '0')).join('');
  i.value = toHex(rgb);
  s.style.background = toHex(rgb);
  i.addEventListener('input', () => {
    const v = i.value;
    const c = [1, 3, 5].map((k) => parseInt(v.slice(k, k + 2), 16) / 255);
    s.style.background = v;
    onChange?.(c);
  });
  s.append(i);
  return s;
}

/** Collapsible section. */
export function section(title, opts = {}) {
  const root = el('div', 'sect' + (opts.collapsed ? ' collapsed' : ''));
  const head = el('button', 'sect-head');
  head.innerHTML = `<span class="caret">${opts.icon || '<svg viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1.5 3L4.5 6l3-3"/></svg>'}</span><span>${title}</span>`;
  if (opts.count != null) {
    const c = el('span', 'count', String(opts.count));
    head.append(c);
  }
  const body = el('div', 'sect-body');
  head.addEventListener('click', () => root.classList.toggle('collapsed'));
  root.append(head, body);
  root.body = body;
  root.head = head;
  return root;
}

export function row(label, control, cls = '') {
  const r = el('div', 'row ' + cls);
  if (label) {
    const l = el('label', null, label);
    if (control?.id) l.htmlFor = control.id;
    r.append(l);
  } else {
    r.append(el('div'));
  }
  r.append(control);
  return r;
}

// ── modal ───────────────────────────────────────────────────────────────────
export function modal({ title, body, actions = [] }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = '';
  root.classList.add('on');
  const scrim = el('div', 'modal-scrim');
  const box = el('div', 'modal');
  const head = el('header');
  head.innerHTML = `<b>${title}</b>`;
  const closeBtn = el('button', 'btn icon');
  closeBtn.innerHTML = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  head.append(el('div', 'grow'), closeBtn);
  const bodyEl = el('div', 'body');
  if (body) bodyEl.append(body);
  const foot = el('footer');
  for (const a of actions) {
    const b = el('button', 'btn ' + (a.cls || 'ghost'));
    b.innerHTML = `<span class="caps">${a.label}</span>`;
    b.addEventListener('click', () => { if (!a.onClick || a.onClick() !== false) close(); });
    foot.append(b);
  }
  box.append(head, bodyEl, foot);
  root.append(scrim, box);
  const close = () => { root.classList.remove('on'); root.innerHTML = ''; };
  scrim.addEventListener('click', close);
  closeBtn.addEventListener('click', close);
  const esc = (e) => { if (e.key === 'Escape') { close(); window.removeEventListener('keydown', esc); } };
  window.addEventListener('keydown', esc);
  return { close, body: bodyEl };
}

export function toast(msg, ms = 2200) {
  const root = document.getElementById('toast-root');
  const t = el('div', 'toast', msg);
  root.append(t);
  setTimeout(() => {
    t.style.transition = 'opacity .3s, transform .3s';
    t.style.opacity = '0';
    t.style.transform = 'translateY(6px)';
    setTimeout(() => t.remove(), 320);
  }, ms);
}

export { formatNumber };
