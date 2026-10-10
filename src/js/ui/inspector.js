// Right-hand inspector. Everything is generated from the schema, so adding a
// parameter to a layer type shows up here automatically.

import { TERRAIN_TYPES, MATERIALS, MATERIAL_BY_KEY, MATERIAL_PARAMS,
         MASK_CHANNELS, paramsOf } from '../schema/layers.js';
import { BLEND_MODES } from '../schema/layers.js';
import { el, slider, toggle, seg, select, range, colorSwatch, section, row, toast } from './widgets.js';
import { icon } from './icons.js';

const CARET = '<svg viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M1.5 3L4.5 6l3-3"/></svg>';

export class Inspector {
  constructor(opts) {
    this.root = document.getElementById('insp-body');
    this.eyebrow = document.getElementById('insp-eyebrow');
    this.state = opts.state;
    this.onChange = opts.onChange;
    this.onRebuild = opts.onRebuild;
    this.onInvalidate = opts.onInvalidate;
    this.kind = 'terrain';
  }

  show(layer, kind) {
    this.kind = kind;
    this.layer = layer || null;
    this.root.innerHTML = '';
    this.eyebrow.textContent = layer ? 'Layer' : 'Scene';
    if (!layer) this.renderGlobals();
    else if (kind === 'terrain') this.renderTerrainLayer(layer);
    else this.renderTextureLayer(layer);
  }

  /** A control that writes straight into `obj[key]`. */
  field(obj, key, opts) {
    const v = obj[key];
    if (typeof v === 'boolean') {
      return toggle(v, (nv) => { obj[key] = nv; opts.rebuild ? this.onRebuild() : this.onInvalidate(); }, opts.label);
    }
    if (opts.type === 'enum' || opts.options) {
      return select(opts.options.map(([l, n]) => [l, String(n)]), String(v),
        (nv) => { obj[key] = Number(nv); (opts.rebuild ? this.onRebuild() : this.onInvalidate()); }, '');
    }
    if (opts.type === 'int' && opts.step >= 1000) {
      return slider({
        value: v, min: opts.min, max: opts.max, step: opts.step, log: opts.log,
        scale: opts.scale || 1, unit: opts.unit || '',
        decimals: 0,
        onChange: (nv) => { obj[key] = Math.round(nv); opts.live && this.onInvalidate(); },
        onCommit: () => (opts.rebuild ? this.onRebuild() : this.onInvalidate()),
      });
    }
    return slider({
      value: v, min: opts.min, max: opts.max, step: opts.step, log: opts.log,
      scale: opts.scale || 1, unit: opts.unit || '',
      onChange: (nv) => { obj[key] = nv; opts.live && this.onInvalidate(); },
      onCommit: () => (opts.rebuild ? this.onRebuild() : this.onInvalidate()),
    });
  }

  addParams(body, layer, params) {
    const groups = new Map();
    for (const p of params) {
      const g = p.group || '';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(p);
    }
    for (const [g, list] of groups) {
      const sect = section(g || 'Parameters', { collapsed: !!g && g !== '' });
      for (const p of list) {
        const ctl = this.field(layer.params, p.key, {
          ...p, rebuild: true, live: false,
        });
        sect.body.append(row(p.label, ctl, p.group ? '' : ''));
      }
      body.append(sect);
    }
  }

  // ── scene / globals ───────────────────────────────────────────────────────
  renderGlobals() {
    const g = this.state.globals;

    // ── Terrain
    const terrain = section('Terrain');
    terrain.body.append(
      row('World Size', slider({
        value: g.worldSize, min: 500, max: 20000, step: 50, log: true, unit: ' m',
        onChange: (v) => { g.worldSize = v; },
        onCommit: () => this.onRebuild({ camera: true }),
      })),
      row('Height Scale', slider({
        value: g.heightScale, min: 50, max: 6000, step: 10, log: true, unit: ' m',
        onChange: (v) => { g.heightScale = v; },
        onCommit: () => this.onRebuild({ camera: true }),
      })),
      row('Field Res', seg([['512', '512'], ['1K', '1024'], ['2K', '2048']], String(g.res),
        (v) => { g.res = Number(v); this.onRebuild(); }, 'mini')),
      row('Mesh Res', seg([['384', '384'], ['512', '512'], ['768', '768'], ['1K', '1024'], ['1.5K', '1536']],
        String(g.renderRes), (v) => { g.renderRes = Number(v); this.onRebuild(); }, 'mini')),
      row('Seed', slider({
        value: g.seed, min: 1, max: 9999, step: 1, decimals: 0,
        onChange: (v) => { g.seed = Math.round(v); this.onInvalidate(); },
        onCommit: () => this.onRebuild({ live: true }),
      })),
    );
    const reseed = el('button', 'btn ghost tiny');
    reseed.innerHTML = '<span class="caps">Randomise seed</span>';
    reseed.addEventListener('click', () => {
      g.seed = 1 + Math.floor(Math.random() * 9998);
      this.onRebuild({ live: true });
      this.show(null, this.kind);
      toast(`Seed ${g.seed}`);
    });
    terrain.body.append(row('', reseed));
    terrain.body.append(el('div', 'hint',
      'Height scale and world size change the physical size of the terrain; erosion ' +
      'parameters are expressed in real units and survive the change.'));
    this.root.append(terrain);

    // ── Sun & atmosphere
    const sky = section('Sun & Atmosphere', { collapsed: true });
    sky.body.append(
      row('Azimuth', slider({
        value: g.sunAzimuth, min: 0, max: 360, step: 1, unit: '°',
        onChange: (v) => { g.sunAzimuth = v; this.onInvalidate(); },
      })),
      row('Elevation', slider({
        value: g.sunElevation, min: -2, max: 89, step: 0.5, unit: '°',
        onChange: (v) => { g.sunElevation = v; this.onInvalidate(); },
      })),
      row('Intensity', slider({
        value: g.sunIntensity, min: 0, max: 4, step: 0.01,
        onChange: (v) => { g.sunIntensity = v; this.onInvalidate(); },
      })),
      row('Turbidity', slider({
        value: g.turbidity, min: 1, max: 12, step: 0.05,
        onChange: (v) => { g.turbidity = v; this.onInvalidate(); },
      })),
      row('Mie', slider({
        value: g.mieG, min: 0, max: 0.98, step: 0.01,
        onChange: (v) => { g.mieG = v; this.onInvalidate(); },
      })),
      row('Sky Intensity', slider({
        value: g.skyIntensity, min: 0, max: 4, step: 0.01,
        onChange: (v) => { g.skyIntensity = v; this.onInvalidate(); },
      })),
      row('Ozone', slider({
        value: g.ozone, min: 0, max: 2, step: 0.01,
        onChange: (v) => { g.ozone = v; this.onInvalidate(); },
      })),
    );
    this.root.append(sky);

    // ── Render
    const render = section('Render', { collapsed: true });
    render.body.append(
      row('Exposure', slider({
        value: g.exposure, min: -1, max: 4, step: 0.01,
        onChange: (v) => { g.exposure = v; this.onInvalidate(); },
      })),
      row('Bloom', slider({
        value: g.bloom, min: 0, max: 1.5, step: 0.01,
        onChange: (v) => { g.bloom = v; this.onInvalidate(); },
      })),
      row('Vignette', slider({
        value: g.vignette, min: 0, max: 1, step: 0.01,
        onChange: (v) => { g.vignette = v; this.onInvalidate(); },
      })),
      row('Grain', slider({
        value: g.grain, min: 0, max: 0.06, step: 0.001,
        onChange: (v) => { g.grain = v; this.onInvalidate(); },
      })),
      row('Saturation', slider({
        value: g.saturation, min: 0, max: 2, step: 0.01,
        onChange: (v) => { g.saturation = v; this.onInvalidate(); },
      })),
      row('Tonemap', seg([['ACES', '0'], ['Neutral', '1'], ['AgX', '2'], ['Filmic', '3']],
        String(g.tonemap), (v) => { g.tonemap = Number(v); this.onInvalidate(); }, 'mini')),
      row('TAA', toggle(g.taa, (v) => { g.taa = v; this.onInvalidate(); })),
      row('TAA Blend', slider({
        value: g.taaBlend, min: 0, max: 0.5, step: 0.005,
        onChange: (v) => { g.taaBlend = v; this.onInvalidate(); },
      })),
      row('Shadow Soft', slider({
        value: g.shadowSoftness, min: 0, max: 0.2, step: 0.002,
        onChange: (v) => { g.shadowSoftness = v; this.onInvalidate(); },
      })),
      row('AO Strength', slider({
        value: g.aoStrength, min: 0, max: 2, step: 0.01,
        onChange: (v) => { g.aoStrength = v; this.onInvalidate(); },
      })),
      row('AO Radius', slider({
        value: g.aoRadius, min: 2, max: 200, step: 1, log: true, unit: ' m',
        onChange: (v) => { g.aoRadius = v; },
        onCommit: () => this.onRebuild({ surface: true }),
      })),
      row('Snow Scatter', slider({
        value: g.snowSSS, min: 0, max: 1.5, step: 0.01,
        onChange: (v) => { g.snowSSS = v; this.onInvalidate(); },
      })),
    );
    this.root.append(render);

    // ── Water
    const water = section('Water', { collapsed: true });
    const wt = el('div', 'ctl');
    wt.append(colorSwatch(g.waterTint, (c) => { g.waterTint = c; this.onInvalidate(); }));
    water.body.append(
      row('Enabled', toggle(g.waterOn, (v) => { g.waterOn = v; this.onInvalidate(); })),
      row('Level', slider({
        value: g.waterLevel, min: 0, max: 0.6, step: 0.002,
        onChange: (v) => { g.waterLevel = v; this.onInvalidate(); },
      })),
      row('Tint', wt),
      row('Waves', slider({
        value: g.waveAmp, min: 0, max: 0.3, step: 0.002,
        onChange: (v) => { g.waveAmp = v; this.onInvalidate(); },
      })),
      row('Wave Scale', slider({
        value: g.waveScale, min: 0.05, max: 4, step: 0.01, log: true,
        onChange: (v) => { g.waveScale = v; this.onInvalidate(); },
      })),
    );
    this.root.append(water);
  }

  // ── terrain layer ─────────────────────────────────────────────────────────
  renderTerrainLayer(layer) {
    const def = TERRAIN_TYPES[layer.type];

    const head = el('div', 'sect');
    const hrow = el('div');
    hrow.style.cssText = 'display:flex;align-items:center;gap:10px;padding:4px 0 10px';
    const ic = el('div', 'layer-icon', icon(def.icon || 'plane'));
    ic.style.width = '30px'; ic.style.height = '30px'; ic.style.borderRadius = '9px';
    const t = el('div');
    t.innerHTML = `<div style="font-size:13px;color:#e9ebed">${def.name}</div>
                   <div style="font-size:10.5px;color:#6d7379;line-height:1.45;margin-top:2px">${def.hint || ''}</div>`;
    hrow.append(ic, t);
    head.append(hrow);
    this.root.append(head);

    const s = section('Layer');
    s.body.append(
      row('Enabled', toggle(layer.enabled, (v) => { layer.enabled = v; this.onRebuild(); })),
      row('Blend', select(BLEND_MODES.map(([l, n]) => [l, String(n)]), String(layer.blend),
        (v) => { layer.blend = Number(v); this.onRebuild(); })),
      row('Opacity', slider({
        value: layer.opacity, min: 0, max: 1, step: 0.01,
        onChange: (v) => { layer.opacity = v; },
        onCommit: () => this.onRebuild(),
      })),
    );
    this.root.append(s);

    const ps = section('Parameters');
    for (const p of paramsOf(layer)) {
      if (p.key === 'opacity') continue;
      ps.body.append(row(p.label, this.field(layer.params, p.key, { ...p, rebuild: true })));
    }
    this.root.append(ps);

    this.root.append(this.maskSection(layer));
  }

  // ── texture layer ─────────────────────────────────────────────────────────
  renderTextureLayer(layer) {
    const head = el('div', 'sect');
    const hrow = el('div');
    hrow.style.cssText = 'display:flex;align-items:center;gap:10px;padding:4px 0 10px';
    const ic = el('div', 'layer-icon mat', icon('layers'));
    ic.style.cssText += 'width:30px;height:30px;border-radius:9px';
    const hex = (c) => '#' + c.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
    ic.style.background = `linear-gradient(135deg,${hex(layer.colors[0])} 0 55%,${hex(layer.colors[1])} 55% 100%)`;
    const t = el('div');
    t.innerHTML = `<div style="font-size:13px;color:#e9ebed">${layer.name}</div>
                   <div style="font-size:10.5px;color:#6d7379;margin-top:2px">Material layer</div>`;
    hrow.append(ic, t);
    head.append(hrow);
    this.root.append(head);

    const s = section('Layer');
    const matSel = select(MATERIALS.map((m) => [m.name, m.key]), layer.material, (k) => {
      const m = MATERIAL_BY_KEY[k];
      layer.material = k;
      layer.matId = m.id;
      layer.name = m.name;
      layer.colors = [m.color.slice(), m.color2.slice()];
      this.onChange?.();
      this.show(layer, 'texture');
    });
    s.body.append(
      row('Material', matSel),
      row('Enabled', toggle(layer.enabled, () => this.onChange?.())),
      row('Height Blend', toggle(layer.blend === 1, (v) => { layer.blend = v ? 1 : 0; this.onChange?.(); })),
      row('Opacity', slider({
        value: layer.opacity, min: 0, max: 1, step: 0.01,
        onChange: (v) => { layer.opacity = v; }, onCommit: () => this.onChange?.(),
      })),
    );
    const cols = el('div', 'colors');
    cols.append(
      colorSwatch(layer.colors[0], (c) => { layer.colors[0] = c; this.onChange?.(); }),
      colorSwatch(layer.colors[1], (c) => { layer.colors[1] = c; this.onChange?.(); }),
      el('span', 'hint', 'Base · Variation'),
    );
    s.body.append(row('Colour', cols));
    this.root.append(s);

    const groups = new Map();
    for (const p of MATERIAL_PARAMS) {
      const g = p.group || 'Material';
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(p);
    }
    for (const [g, list] of groups) {
      const sect = section(g, { collapsed: g !== 'Relief' });
      for (const p of list) {
        sect.body.append(row(p.label, this.field(layer.params, p.key, { ...p })));
      }
      this.root.append(sect);
    }

    this.root.append(this.maskSection(layer));
  }

  // ── mask ──────────────────────────────────────────────────────────────────
  maskSection(layer) {
    const mask = layer.mask;
    const sect = section('Mask', { collapsed: false, count: mask.enabled ? 'on' : 'off' });

    const headCtl = el('div', 'ctl');
    headCtl.style.gap = '10px';
    headCtl.append(
      toggle(mask.enabled, (v) => { mask.enabled = v; sect.head.querySelector('.count').textContent = v ? 'on' : 'off'; this.onChange?.({ rebuild: mask.enabled }); }),
      el('span', 'hint', 'Restrict this layer by terrain properties'),
    );
    sect.body.append(row('Enabled', headCtl));
    sect.body.append(el('div', 'hint',
      'Channels combine multiplicatively — a layer only shows where every enabled channel is true.'));

    for (const ch of MASK_CHANNELS) {
      const c = mask.channels[ch.key];
      const sub = section(ch.label, { collapsed: !c.on });
      const onOff = document.createElement('input');
      onOff.type = 'checkbox';
      onOff.checked = c.on;
      onOff.addEventListener('change', () => {
        c.on = onOff.checked;
        mask.enabled = mask.enabled || onOff.checked;
        this.onChange?.({ rebuild: true });
      });
      const nameWrap = el('div', 'name');
      nameWrap.append(onOff, el('span', null, ch.label));
      sub.body.append(el('div', 'mask-row', ''));
      const r = el('div', 'mask-row');
      r.append(nameWrap);

      if (ch.noise) {
        r.append(el('span', 'hint', 'procedural'));
        sub.body.append(r);
        sub.body.append(row('Scale', slider({
          value: c.scale, min: 0.002, max: 0.5, step: 0.001, log: true,
          onChange: (v) => { c.scale = v; }, onCommit: () => this.onChange?.(),
        })));
        sub.body.append(row('Detail', slider({
          value: c.octaves, min: 1, max: 8, step: 1, decimals: 0,
          onChange: (v) => { c.octaves = Math.round(v); }, onCommit: () => this.onChange?.(),
        })));
        sub.body.append(row('Contrast', slider({
          value: c.contrast, min: 0.1, max: 4, step: 0.01,
          onChange: (v) => { c.contrast = v; }, onCommit: () => this.onChange?.(),
        })));
        sub.body.append(row('Bias', slider({
          value: c.bias, min: 0, max: 1, step: 0.005,
          onChange: (v) => { c.bias = v; }, onCommit: () => this.onChange?.(),
        })));
        sub.body.append(row('Seed', slider({
          value: c.seed, min: 0, max: 9999, step: 1, decimals: 0,
          onChange: (v) => { c.seed = Math.round(v); }, onCommit: () => this.onChange?.(),
        })));
      } else if (ch.aspect) {
        r.append(el('span', 'hint', 'compass'));
        sub.body.append(r);
        sub.body.append(row('Direction', slider({
          value: c.angle, min: 0, max: 1, step: 0.005, scale: 360, unit: '°',
          onChange: (v) => { c.angle = v; }, onCommit: () => this.onChange?.(),
        })));
        sub.body.append(row('Width', slider({
          value: c.width, min: 0, max: 0.5, step: 0.005,
          onChange: (v) => { c.width = v; }, onCommit: () => this.onChange?.(),
        })));
        sub.body.append(row('Feather', slider({
          value: c.feather, min: 0, max: 0.5, step: 0.005,
          onChange: (v) => { c.feather = v; }, onCommit: () => this.onChange?.(),
        })));
      } else {
        const prev = el('div', 'mask-preview');
        const cv = el('canvas');
        cv.width = 54; cv.height = 14;
        prev.append(cv);
        r.append(prev);
        sub.body.append(r);
        const rg = range({
          lo: c.lo, hi: c.hi, featherLo: c.featherLo, featherHi: c.featherHi,
          min: 0, max: 1, step: 0.002, scale: ch.scale || 1, unit: ch.unit || '',
          onChange: (s) => { Object.assign(c, s); drawPreview(cv, c); },
          onCommit: () => this.onChange?.(),
        });
        sub.body.append(rg);
        drawPreview(cv, c);
      }
      sect.body.append(sub);
    }

    sect.body.append(row('Gamma', slider({
      value: mask.gamma, min: 0.2, max: 4, step: 0.01,
      onChange: (v) => { mask.gamma = v; }, onCommit: () => this.onChange?.(),
    })));
    sect.body.append(row('Invert', toggle(mask.invert, (v) => { mask.invert = v; this.onChange?.({ rebuild: true }); })));
    return sect;
  }
}

function drawPreview(cv, c) {
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const img = ctx.createImageData(W, H);
  for (let x = 0; x < W; x++) {
    const t = (x + 0.5) / W;
    const v = band(t, c.lo, c.hi, c.featherLo, c.featherHi);
    for (let y = 0; y < H; y++) {
      const o = (y * W + x) * 4;
      const g = 28 + v * 200;
      img.data[o] = g * 0.55;
      img.data[o + 1] = g * 0.95;
      img.data[o + 2] = g;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function band(t, lo, hi, fl, fh) {
  const ss = (e0, e1, x) => {
    const t2 = Math.min(1, Math.max(0, (x - e0) / (e1 - e0 || 1e-6)));
    return t2 * t2 * (3 - 2 * t2);
  };
  const a = ss(lo - fl, lo + fl, t);
  const b = 1 - ss(hi - fh, hi + fh, t);
  return Math.max(0, Math.min(1, Math.min(a, b)));
}
