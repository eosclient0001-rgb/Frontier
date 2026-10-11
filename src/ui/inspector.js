/**
 * Frontier Terrain Forge — inspector.
 *
 * Everything the rail does not own: the selected layer's parameters, its mask
 * stack, and the scene-level panels (world, sun, viewport, bake). Controls are
 * generated from the parameter schema, so a new generator type appears in the
 * inspector without any UI code.
 */
import { el, clear, icon, card, slider, toggleLine, selectLine, numberLine, buttonRow } from './dom.js';
import { openMenu } from './menu.js';
import { BLEND_OPS, MASK_KINDS, MASK_BLENDS, MATERIAL_CONTROLS, VIEW_MODES } from '../gen/schema.js';
import { layerKindOf, typeOf } from './state.js';
import { readField, drawPreview } from './preview.js';

const GROUP_ORDER = ['Shape', 'Simulation', 'Water', 'Erosion', 'Bands', 'Mineral', 'Colour', 'Detail', 'Flow', 'Maps', 'Response'];

const formatValue = (param, value) => {
  if (param.format) return param.format(value);
  const unit = param.unit || '';
  if (unit === 'm' && Math.abs(value) >= 1000) return `${(value / 1000).toFixed(2)} km`;
  if (unit === '°') return `${Number(value).toFixed(value % 1 === 0 ? 0 : 1)}°`;
  if (unit === 'rad') return `${Number(value).toFixed(2)} rad`;
  if (param.step >= 1) return `${Math.round(value)}${unit ? ` ${unit}` : ''}`;
  if (param.step >= 0.01) return `${Number(value).toFixed(2)}${unit ? ` ${unit}` : ''}`;
  return `${Number(value).toFixed(4)}${unit ? ` ${unit}` : ''}`;
};

export function createInspector(editor, app) {
  const { head, body } = app.refs;
  let mapToken = 0;
  const previewCanvases = new Map();

  /* --------------------------------------------------------- primitives -- */
  const groupParams = (type, { includeHidden = false } = {}) => {
    const groups = new Map();
    for (const param of type.params || []) {
      if (param.hidden && !includeHidden) continue;
      if (param.hidden && includeHidden) {
        if (!groups.has('Advanced')) groups.set('Advanced', []);
        groups.get('Advanced').push(param);
        continue;
      }
      const name = param.group || 'Shape';
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(param);
    }
    return [...groups.entries()].sort((a, b) => {
      const ia = GROUP_ORDER.indexOf(a[0]);
      const ib = GROUP_ORDER.indexOf(b[0]);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
  };

  const paramSlider = (layer, param) => slider({
    label: param.label,
    value: layer.params[param.key] ?? param.default ?? param.min,
    min: param.min, max: param.max, step: param.step,
    unit: param.unit,
    hint: param.hint,
    format: (v) => formatValue(param, v),
    onInput: (value) => {
      layer.params[param.key] = value;
      editor.edit(() => {}, { terrain: !layer.material, texture: !!layer.material });
      app.scheduleRegenerate(layer.material ? 'texture' : 'terrain');
    },
    onChange: (value) => {
      layer.params[param.key] = value;
      editor.edit(() => {}, { terrain: !layer.material, texture: !!layer.material });
      app.regenerate(layer.material ? 'texture' : 'terrain');
    },
  });

  const layerControlsCard = (layer) => {
    const kind = layerKindOf(layer);
    const block = card(kind === 'sim' ? 'Simulation output' : 'Stack blend', {
      hint: kind === 'sim' ? 'fold-back' : 'layer weight',
    });
    const commit = () => {
      editor.edit(() => {}, { terrain: !layer.material, texture: !!layer.material });
      app.regenerate(layer.material ? 'texture' : 'terrain');
    };
    const live = () => app.scheduleRegenerate(layer.material ? 'texture' : 'terrain');

    if (kind === 'material') {
      block.body.append(slider({
        label: 'Coverage', value: layer.amount, min: 0, max: 1, step: 0.005, format: (v) => `${Math.round(v * 100)}%`,
        hint: 'How much of this material is blended over what is under it',
        onInput: (v) => { layer.amount = v; live(); }, onChange: (v) => { layer.amount = v; commit(); },
      }));
      return block.root;
    }

    if (kind === 'sim') {
      block.body.append(slider({
        label: 'Delta strength', value: layer.amount, min: 0, max: 1, step: 0.005, format: (v) => `${Math.round(v * 100)}%`,
        hint: 'How much of the simulated height change is folded back onto the terrain',
        onInput: (v) => { layer.amount = v; live(); }, onChange: (v) => { layer.amount = v; commit(); },
      }));
      block.body.append(slider({
        label: 'Wetness gain', value: layer.flowGain ?? 1, min: 0, max: 4, step: 0.01,
        hint: 'Scales the wetness/flow map this simulation publishes to masks and materials',
        onInput: (v) => { layer.flowGain = v; live(); }, onChange: (v) => { layer.flowGain = v; commit(); },
      }));
      block.body.append(slider({
        label: 'Deposit gain', value: layer.depositGain ?? 1, min: 0, max: 4, step: 0.01,
        hint: 'Scales the sediment deposit map — the base for floodplains and alluvial fans',
        onInput: (v) => { layer.depositGain = v; live(); }, onChange: (v) => { layer.depositGain = v; commit(); },
      }));
      return block.root;
    }

    const blendSelect = el('select', {});
    for (const op of BLEND_OPS) {
      blendSelect.append(el('option', { value: String(op.id), text: `${op.glyph}  ${op.label}`, selected: op.id === layer.blend }));
    }
    blendSelect.addEventListener('change', () => {
      layer.blend = Number(blendSelect.value);
      commit();
    });
    block.body.append(el('div', { class: 'control' },
      el('div', { class: 'control-head' }, el('span', { class: 'control-label', text: 'Operation' })),
      el('div', { class: 'field' }, blendSelect),
      el('div', { class: 'control-hint', text: 'How this layer is combined with everything below it in the stack' }),
    ));
    block.body.append(slider({
      label: 'Amount', value: layer.amount, min: 0, max: 1, step: 0.005, format: (v) => `${Math.round(v * 100)}%`,
      onInput: (v) => { layer.amount = v; live(); }, onChange: (v) => { layer.amount = v; commit(); },
    }));
    block.body.append(slider({
      label: 'Bias', value: layer.bias ?? 0, min: -0.4, max: 0.4, step: 0.005,
      onInput: (v) => { layer.bias = v; live(); }, onChange: (v) => { layer.bias = v; commit(); },
    }));
    block.body.append(slider({
      label: 'Contrast', value: layer.contrast ?? 1, min: 0.05, max: 4, step: 0.01,
      onInput: (v) => { layer.contrast = v; live(); }, onChange: (v) => { layer.contrast = v; commit(); },
    }));
    return block.root;
  };

  /* -------------------------------------------------------------- masks -- */
  const maskCard = (layer, mask, index) => {
    const kind = MASK_KINDS.find((k) => k.id === mask.kind) || MASK_KINDS[0];
    const block = el('div', { class: 'mask-card' });

    const kindSelect = el('select', { style: { width: '100%', background: 'transparent', border: '0', color: '#d2d2d2', fontSize: '11px' } });
    for (const k of MASK_KINDS) kindSelect.append(el('option', { value: String(k.id), text: k.label, selected: k.id === mask.kind }));
    kindSelect.addEventListener('change', () => {
      const next = MASK_KINDS.find((k) => k.id === Number(kindSelect.value));
      if (!next) return;
      // Keep the geometry the user already tuned, reset the rest to defaults.
      mask.kind = next.id;
      editor.edit(() => {}, { terrain: !layer.material, texture: !!layer.material });
      app.regenerate(layer.material ? 'texture' : 'terrain');
    });

    block.append(el('div', { class: 'mask-head' },
      el('span', { class: 'mask-kind', text: `mask ${index + 1}` }),
      el('div', { style: { flex: '1' } }, kindSelect),
      el('button', {
        class: 'ghost', title: 'Remove mask',
        onclick: () => { editor.removeMask(layer.id, index); app.regenerate(layer.material ? 'texture' : 'terrain'); },
      }, icon('trash', 13)),
    ));

    const slotSlider = (key, spec) => slider({
      label: spec.label, value: mask[key] ?? spec.min, min: spec.min, max: spec.max, step: spec.step,
      hint: spec.hint,
      format: (v) => (spec.step >= 0.1 ? v.toFixed(2) : v.toFixed(3)),
      onInput: (v) => { mask[key] = v; editor.edit(() => {}, { terrain: !layer.material, texture: !!layer.material }); app.scheduleRegenerate(layer.material ? 'texture' : 'terrain'); },
      onChange: (v) => { mask[key] = v; editor.edit(() => {}, { terrain: !layer.material, texture: !!layer.material }); app.regenerate(layer.material ? 'texture' : 'terrain'); },
    });

    const SLOTS = {
      lo: { label: 'From', min: 0, max: 1.2, step: 0.005 },
      hi: { label: 'To', min: 0, max: 1.2, step: 0.005 },
      soft: { label: 'Softness', min: 0.005, max: 0.6, step: 0.005, hint: 'Width of the transition band at each edge' },
      freq: { label: 'Frequency', min: 0.3, max: 40, step: 0.1 },
      amp: { label: 'Coverage', min: 0, max: 2, step: 0.01 },
      seed: { label: 'Seed', min: 0, max: 1, step: 0.0001 },
      extra: { label: 'Ridge bias', min: -1, max: 1, step: 0.01 },
      cx: { label: 'Centre X', min: 0, max: 1, step: 0.005 },
      cy: { label: 'Centre Y', min: 0, max: 1, step: 0.005 },
      radius: { label: 'Radius', min: 0.02, max: 1.4, step: 0.005 },
    };

    if (kind.kind === 'flat') {
      block.append(el('div', { class: 'control-hint', text: kind.desc }));
    } else {
      block.append(el('div', { class: 'control-hint', text: kind.desc }));
    }
    for (const slot of kind.slots || []) {
      const spec = SLOTS[slot];
      if (!spec) continue;
      block.append(slotSlider(slot, spec));
    }

    const blendSelect = el('select', {});
    for (const op of MASK_BLENDS) blendSelect.append(el('option', { value: String(op.id), text: op.label, selected: op.id === mask.blend }));
    blendSelect.addEventListener('change', () => {
      mask.blend = Number(blendSelect.value);
      editor.edit(() => {}, { terrain: !layer.material, texture: !!layer.material });
      app.regenerate(layer.material ? 'texture' : 'terrain');
    });
    block.append(el('div', { class: 'range-row' },
      el('div', { class: 'control' },
        el('div', { class: 'control-head' }, el('span', { class: 'control-label', text: 'Combine' })),
        el('div', { class: 'field' }, blendSelect),
      ),
      el('div', { class: 'control' },
        el('div', { class: 'control-head' }, el('span', { class: 'control-label', text: 'Invert' })),
        el('div', { class: 'field' },
          (() => {
            const knob = el('span');
            const pill = el('div', { class: `toggle${mask.invert ? ' on' : ''}` }, knob);
            pill.addEventListener('click', () => {
              const next = !pill.classList.contains('on');
              pill.classList.toggle('on', next);
              mask.invert = next ? 1 : 0;
              editor.edit(() => {}, { terrain: !layer.material, texture: !!layer.material });
              app.regenerate(layer.material ? 'texture' : 'terrain');
            });
            return pill;
          })(),
        ),
      ),
      slider({
        label: 'Weight', value: mask.weight ?? 1, min: 0, max: 1, step: 0.01,
        onInput: (v) => { mask.weight = v; editor.edit(() => {}, { terrain: !layer.material, texture: !!layer.material }); app.scheduleRegenerate(layer.material ? 'texture' : 'terrain'); },
        onChange: (v) => { mask.weight = v; editor.edit(() => {}, { terrain: !layer.material, texture: !!layer.material }); app.regenerate(layer.material ? 'texture' : 'terrain'); },
      }),
    ));
    return block;
  };

  const maskStackCard = (layer) => {
    const masks = layer.masks || (layer.masks = []);
    const block = card('Masks', { hint: `${masks.length} of 4`, icon: 'grid' });
    block.body.append(el('div', { class: 'card-sub', text: 'Masks multiply this layer in, so a generator can be told where it is allowed to work. Four per layer — everything downstream (materials, splats, wetness) reads the same fields.' }));
    masks.forEach((mask, index) => block.body.append(maskCard(layer, mask, index)));
    if (masks.length < 4) {
      block.body.append(buttonRow([{
        label: 'Add mask', icon: 'plus', accent: false,
        onClick: (event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          openMenu({ x: rect.left, y: rect.bottom + 4 }, {
            title: 'Mask source',
            items: MASK_KINDS.map((kind) => ({
              label: kind.label, icon: 'grid', title: kind.desc,
              onClick: () => { editor.addMask(layer.id, kind.id); app.regenerate(layer.material ? 'texture' : 'terrain'); },
            })),
          });
        },
      }]));
    }
    return block.root;
  };

  /* ---------------------------------------------------------- materials -- */
  const materialCard = (layer, type) => {
    const block = card('Surface', { hint: 'PBR', icon: 'rock' });
    block.body.append(slider({
      label: MATERIAL_CONTROLS.roughMin.label, value: layer.roughMin, min: 0.03, max: 1, step: 0.01,
      onInput: (v) => { layer.roughMin = v; app.scheduleRegenerate('texture'); editor.edit(() => {}, { texture: true }); },
      onChange: (v) => { layer.roughMin = v; editor.edit(() => {}, { texture: true }); app.regenerate('texture'); },
    }));
    block.body.append(slider({
      label: MATERIAL_CONTROLS.roughMax.label, value: layer.roughMax, min: 0.03, max: 1, step: 0.01,
      onInput: (v) => { layer.roughMax = v; app.scheduleRegenerate('texture'); editor.edit(() => {}, { texture: true }); },
      onChange: (v) => { layer.roughMax = v; editor.edit(() => {}, { texture: true }); app.regenerate('texture'); },
    }));
    block.body.append(slider({
      label: MATERIAL_CONTROLS.metallic.label, value: layer.metallic, min: 0, max: 1, step: 0.01,
      onInput: (v) => { layer.metallic = v; app.scheduleRegenerate('texture'); },
      onChange: (v) => { layer.metallic = v; editor.edit(() => {}, { texture: true }); app.regenerate('texture'); },
    }));
    block.body.append(slider({
      label: MATERIAL_CONTROLS.normalStrength.label, value: layer.normalStrength, min: 0, max: 2, step: 0.01,
      hint: 'Strength of this material’s detail normals in the composite',
      onInput: (v) => { layer.normalStrength = v; app.scheduleRegenerate('texture'); },
      onChange: (v) => { layer.normalStrength = v; editor.edit(() => {}, { texture: true }); app.regenerate('texture'); },
    }));
    const tint = layer.tint || (layer.tint = { hue: 0, saturation: 1, value: 1, variation: 0.5 });
    const detail = layer.detailSettings || (layer.detailSettings = { macroContrast: 1, wear: 0.7, flowInfluence: 0.5 });
    for (const [key, spec, target] of [
      ['hue', MATERIAL_CONTROLS.hueShift, tint],
      ['saturation', MATERIAL_CONTROLS.saturation, tint],
      ['value', MATERIAL_CONTROLS.value, tint],
      ['variation', MATERIAL_CONTROLS.variation, tint],
      ['macroContrast', MATERIAL_CONTROLS.macroContrast, detail],
      ['wear', MATERIAL_CONTROLS.wear, detail],
      ['flowInfluence', MATERIAL_CONTROLS.flowInfluence, detail],
    ]) {
      block.body.append(slider({
        label: spec.label, value: target[key] ?? spec.min, min: spec.min, max: spec.max, step: spec.step,
        onInput: (v) => { target[key] = v; app.scheduleRegenerate('texture'); editor.edit(() => {}, { texture: true }); },
        onChange: (v) => { target[key] = v; editor.edit(() => {}, { texture: true }); app.regenerate('texture'); },
      }));
    }
    return block.root;
  };

  const paletteCard = (layer, type) => {
    const palettes = Object.entries(type.palettes || {});
    if (!palettes.length) return null;
    const block = card('Palette', { hint: layer.palette || '—', icon: 'sparkle' });
    const grid = el('div', { class: 'palette-grid' });
    const current = layer.ramp || null;
    for (const [name, stops] of palettes) {
      const mid = stops[Math.floor(stops.length / 2)][1];
      const toCss = (c) => `rgb(${Math.round(Math.pow(Math.min(1, c), 1 / 2.2) * 255)},${Math.round(Math.pow(Math.min(1, c * 1.02), 1 / 2.2) * 255)},${Math.round(Math.pow(Math.min(1, c * 0.98), 1 / 2.2) * 255)})`;
      const gradient = `linear-gradient(135deg, ${stops.map(([t, c]) => `${toCss(c)} ${Math.round(t * 100)}%`).join(', ')})`;
      grid.append(el('div', {
        class: `palette-chip${layer.palette === name ? ' on' : ''}`,
        style: { background: gradient },
        title: name,
        onclick: () => {
          editor.edit(() => { layer.palette = name; layer.ramp = null; }, { texture: true });
          app.regenerate('texture');
        },
      }, el('span', { text: name })));
    }
    block.body.append(grid);
    if (current) {
      block.body.append(el('div', { class: 'control-hint', text: 'This layer uses a custom gradient.' }));
      block.body.append(buttonRow([{
        label: 'Back to palette', icon: 'reset',
        onClick: () => { editor.edit(() => { layer.ramp = null; }, { texture: true }); app.regenerate('texture'); },
      }]));
    }
    return block.root;
  };

  /* -------------------------------------------------------------- layer -- */
  function layerPanel(layer) {
    const type = typeOf(layer);
    const kind = layerKindOf(layer);
    if (!type) return;
    body.append(layerControlsCard(layer));

    for (const [groupName, params] of groupParams(type, { includeHidden: false })) {
      const block = card(groupName, { hint: `${params.length} controls` });
      for (const param of params) block.body.append(paramSlider(layer, param));
      body.append(block.root);
    }

    const hiddenParams = (type.params || []).filter((p) => p.hidden);
    if (hiddenParams.length) {
      const block = card('Advanced', { hint: `${hiddenParams.length}` });
      for (const param of hiddenParams) block.body.append(paramSlider(layer, param));
      body.append(block.root);
    }

    if (kind === 'material') {
      const palette = paletteCard(layer, type);
      if (palette) body.append(palette);
      body.append(materialCard(layer, type));
    }

    if (kind !== 'sim') body.append(maskStackCard(layer));

    body.append(el('div', { class: 'stat-list' },
      el('div', { class: 'stat-line' }, el('span', { text: 'Layer id' }), el('b', { text: layer.id })),
      el('div', { class: 'stat-line' }, el('span', { text: 'Seed' }), el('b', { text: Number(layer.seed ?? 0).toFixed(4) })),
      type.desc ? el('div', { class: 'control-hint', text: type.desc }) : null,
    ));
    body.append(buttonRow([
      { label: 'Reset', icon: 'reset', onClick: () => { editor.resetLayer(layer.id); app.regenerate(kind === 'material' ? 'texture' : 'terrain'); } },
      { label: 'Duplicate', icon: 'copy', onClick: () => editor.duplicateLayer(layer.id) },
      { label: 'Delete', icon: 'trash', onClick: () => editor.removeLayer(layer.id) },
    ]));
  }

  /* -------------------------------------------------------------- world -- */
  function worldPanel() {
    const world = editor.project.world;
    const worldCard = card('World', { hint: 'extent', icon: 'grid' });
    const commit = () => { editor.edit(() => {}, { terrain: true }); app.regenerate('terrain'); };
    worldCard.body.append(selectLine('Field resolution', world.resolution, [
      { value: 512, label: '512 · fast preview' },
      { value: 1024, label: '1024 · draft' },
      { value: 2048, label: '2048 · production' },
      { value: 4096, label: '4096 · heavy' },
    ], (value) => { world.resolution = Number(value); commit(); app.setResolution?.(Number(value)); }));
    worldCard.body.append(slider({
      label: 'World size', value: world.worldSize, min: 512, max: 16384, step: 64, unit: 'm',
      hint: 'Ground extent of the tile, corner to corner',
      onInput: (v) => { world.worldSize = v; editor.edit(() => {}, { terrain: true }); app.scheduleRegenerate('terrain'); },
      onChange: (v) => { world.worldSize = v; commit(); },
    }));
    worldCard.body.append(slider({
      label: 'Height scale', value: world.heightScale, min: 50, max: 4000, step: 5, unit: 'm',
      hint: 'Vertical extent of the normalised 0…1 height field — the single most important realism control',
      onInput: (v) => { world.heightScale = v; editor.edit(() => {}, { terrain: true }); app.scheduleRegenerate('terrain'); },
      onChange: (v) => { world.heightScale = v; commit(); },
    }));
    worldCard.body.append(slider({
      label: 'Sea level', value: world.waterLevel, min: 0, max: 0.9, step: 0.005,
      format: (v) => `${(v * 100).toFixed(1)}% · ${Math.round(v * world.heightScale)} m`,
      onInput: (v) => { world.waterLevel = v; editor.edit(() => {}, { texture: true }); },
      onChange: (v) => { world.waterLevel = v; editor.edit(() => {}, { texture: true }); app.regenerate('texture'); },
    }));
    worldCard.body.append(selectLine('Render mesh', world.meshResolution ?? 512, [
      { value: 256, label: '256 · smooth' },
      { value: 512, label: '512 · balanced' },
      { value: 768, label: '768 · detailed' },
      { value: 1024, label: '1024 · maximum' },
    ], (value) => { editor.edit(() => { world.meshResolution = Number(value); }); app.setResolution?.(null); }));
    worldCard.body.append(numberLine('Seed', editor.project.seed, {
      step: 1,
      onChange: (value) => { editor.edit((p) => { p.seed = Math.round(value); }, { terrain: true }); app.regenerate('terrain'); },
    }));
    worldCard.body.append(slider({
      label: 'Sketch lift', value: editor.project.display.sketchLift ?? 0, min: 0, max: 0.5, step: 0.005,
      hint: 'How hard the Sketch brush lifts the terrain. Paint with the brush bar, then raise this to pull landforms out of the sketch.',
      onInput: (v) => { editor.project.display.sketchLift = v; editor.edit(() => {}, { terrain: true }); app.scheduleRegenerate('terrain'); },
      onChange: (v) => { editor.project.display.sketchLift = v; editor.edit(() => {}, { terrain: true }); app.regenerate('terrain'); },
    }));
    worldCard.body.append(buttonRow([
      { label: 'Randomise seed', icon: 'sparkle', accent: true, onClick: () => { editor.edit((p) => { p.seed = Math.floor(Math.random() * 99999); }, { terrain: true }); app.regenerate('terrain'); } },
      { label: 'Frame terrain', icon: 'camera', onClick: () => app.frameCamera?.() },
    ]));
    body.append(worldCard.root);

    const handEdits = card('Hand edits', { hint: 'brushes', icon: 'brush' });
    handEdits.body.append(el('div', { class: 'card-sub', text: 'The brush bar sculpts height, paints masks and sketches landforms. Strokes live beside the stack rather than inside it, so regenerating the terrain keeps them and never bakes them into the noise.' }));
    handEdits.body.append(buttonRow([
      { label: 'Clear paint', icon: 'trash', onClick: () => { app.graph?.clearPaint('paint'); app.regenerate('terrain'); } },
      { label: 'Clear sketch', icon: 'trash', onClick: () => { app.graph?.clearPaint('sketch'); app.regenerate('terrain'); } },
      { label: 'Clear sculpt', icon: 'trash', onClick: () => { app.graph?.clearSculpt(); app.markMapsDirty?.(); app.regenerate('terrain'); } },
    ]));
    body.append(handEdits.root);

    const stats = editor.stats;
    const statsCard = card('Elevation', { hint: 'readback', icon: 'waves' });
    const line = (label, value) => el('div', { class: 'stat-line' }, el('span', { text: label }), el('b', { text: value }));
    statsCard.body.append(el('div', { class: 'metric-big' },
      el('span', { text: stats ? Math.round(stats.relief).toLocaleString() : '—' }),
      el('small', { text: 'm relief' }),
    ));
    statsCard.body.append(el('div', { class: 'stat-list' },
      line('Lowest', stats ? `${Math.round(stats.min)} m` : '—'),
      line('Highest', stats ? `${Math.round(stats.max)} m` : '—'),
      line('Mean', stats ? `${Math.round(stats.mean)} m` : '—'),
      line('Cells', `${editor.maps?.resolution ?? world.resolution}² · ${(world.worldSize / (editor.maps?.resolution ?? world.resolution)).toFixed(2)} m/cell`),
    ));
    const profile = el('canvas', { class: 'curve' });
    statsCard.body.append(profile);
    statsCard.body.append(el('div', { class: 'control-hint', text: 'Mid-row elevation profile, straight off the GPU.' }));
    body.append(statsCard.root);
    app.refreshProfile?.(profile);

    const presets = card('Presets', { hint: `${app.presets.length}`, icon: 'sparkle' });
    presets.body.append(el('div', { class: 'card-sub', text: 'Each preset is a complete project: a tuned terrain stack, a simulation pass and a material set built for that landscape.' }));
    for (const preset of app.presets) {
      presets.body.append(el('div', {
        class: 'stat-line',
        style: { cursor: 'pointer', padding: '8px 0', borderTop: '1px solid #242424' },
        title: preset.description,
        onclick: () => app.loadPreset?.(preset),
      }, el('span', { text: preset.name }), el('b', { text: '→' })));
    }
    body.append(presets.root);
  }

  /* ----------------------------------------------------------- lighting -- */
  function lightingPanel() {
    const display = editor.project.display;
    const sun = card('Sun', { hint: 'directional', icon: 'sun' });
    const commit = () => { editor.edit(() => {}, { view: true }); app.requestRender?.(); };
    const timePresets = [
      ['Dawn', 96, 8], ['Morning', 118, 22], ['Noon', 168, 62], ['Golden', 132, 14], ['Dusk', 244, 6], ['Night', 300, -3],
    ];
    sun.body.append(el('div', { class: 'button-row', style: { marginBottom: '16px' } },
      ...timePresets.map(([label, az, elevation]) => el('button', {
        class: 'outline', text: label,
        onClick: () => {
          editor.edit(() => { display.sunAzimuth = az; display.sunElevation = Math.max(0.6, elevation); }, {});
          commit();
        },
      }))));
    sun.body.append(slider({
      label: 'Azimuth', value: display.sunAzimuth, min: 0, max: 360, step: 1,
      format: (v) => `${Math.round(v)}°`,
      hint: 'Compass bearing of the sun',
      onInput: (v) => { display.sunAzimuth = v; commit(); },
      onChange: (v) => { display.sunAzimuth = v; commit(); },
    }));
    sun.body.append(slider({
      label: 'Elevation', value: display.sunElevation, min: 0.5, max: 88, step: 0.5,
      format: (v) => `${v.toFixed(1)}°`,
      hint: 'Low sun rakes across ridges and casts the long shadows that sell the scale',
      onInput: (v) => { display.sunElevation = v; commit(); },
      onChange: (v) => { display.sunElevation = v; commit(); },
    }));
    sun.body.append(slider({
      label: 'Intensity', value: display.sunIntensity, min: 0.2, max: 8, step: 0.05,
      onInput: (v) => { display.sunIntensity = v; commit(); },
      onChange: (v) => { display.sunIntensity = v; commit(); },
    }));
    sun.body.append(slider({
      label: 'Ambient sky light', value: display.ambient, min: 0, max: 1.5, step: 0.01,
      hint: 'Sky radiance from the physical sky model, sampled in the sun’s hemisphere',
      onInput: (v) => { display.ambient = v; commit(); },
      onChange: (v) => { display.ambient = v; commit(); },
    }));
    body.append(sun.root);

    const fog = card('Atmosphere', { hint: 'fog', icon: 'droplet' });
    fog.body.append(slider({
      label: 'Fog density', value: display.fogDensity, min: 0, max: 6, step: 0.01,
      hint: '0 turns aerial perspective off completely',
      onInput: (v) => { display.fogDensity = v; commit(); },
      onChange: (v) => { display.fogDensity = v; commit(); },
    }));
    fog.body.append(slider({
      label: 'Height falloff', value: display.fogHeightFalloff, min: 0, max: 4, step: 0.01,
      onInput: (v) => { display.fogHeightFalloff = v; commit(); },
      onChange: (v) => { display.fogHeightFalloff = v; commit(); },
    }));
    fog.body.append(slider({
      label: 'Aerial perspective', value: display.aerial, min: 0, max: 1.5, step: 0.01,
      hint: 'Tints distant ridges toward the sky colour',
      onInput: (v) => { display.aerial = v; commit(); },
      onChange: (v) => { display.aerial = v; commit(); },
    }));
    body.append(fog.root);

    const grade = card('Grade', { hint: 'filmic', icon: 'camera' });
    for (const [key, label, min, max, step] of [
      ['exposure', 'Exposure', 0.1, 3, 0.01],
      ['contrast', 'Contrast', 0.6, 1.8, 0.01],
      ['saturation', 'Saturation', 0.4, 1.8, 0.01],
      ['vignette', 'Vignette', 0, 1, 0.01],
      ['grain', 'Film grain', 0, 1, 0.01],
    ]) {
      grade.body.append(slider({
        label, value: display[key], min, max, step,
        onInput: (v) => { display[key] = v; commit(); },
        onChange: (v) => { display[key] = v; commit(); },
      }));
    }
    body.append(grade.root);

    const water = card('Water', { hint: 'sea', icon: 'water' });
    water.body.append(toggleLine('Water surface', display.water, (on) => { editor.edit(() => { display.water = on; }); commit(); }));
    body.append(water.root);
  }

  /* ------------------------------------------------------------ display -- */
  function displayPanel() {
    const display = editor.project.display;
    const commit = () => { editor.edit(() => {}, { view: true }); app.requestRender?.(); };
    const modes = card('View mode', { hint: 'debug + hero', icon: 'eye' });
    const select = el('select', {});
    for (const mode of VIEW_MODES) select.append(el('option', { value: String(mode.id), text: mode.label, selected: mode.id === display.viewMode }));
    select.addEventListener('change', () => { display.viewMode = Number(select.value); commit(); });
    modes.body.append(el('div', { class: 'field' }, select));
    modes.body.append(el('div', { class: 'control-hint', text: 'The viewport can show any stage of the pipeline — height, slope, normals, albedo, wetness, AO or roughness — straight from the GPU without a re-bake.' }));
    body.append(modes.root);

    const overlay = card('Overlays', { hint: 'analysis', icon: 'layers' });
    overlay.body.append(toggleLine('Contour lines', display.contourLines, (on) => { display.contourLines = on; commit(); }));
    overlay.body.append(slider({
      label: 'Contour interval', value: display.contourInterval, min: 5, max: 250, step: 1, unit: 'm',
      onInput: (v) => { display.contourInterval = v; commit(); },
      onChange: (v) => { display.contourInterval = v; commit(); },
    }));
    overlay.body.append(toggleLine('Slope overlay', display.slopeOverlay, (on) => { display.slopeOverlay = on; commit(); }));
    overlay.body.append(toggleLine('Wireframe grid', display.wireframe, (on) => { display.wireframe = on; commit(); }));
    body.append(overlay.root);

    const scene = card('Scene', { hint: 'quality', icon: 'camera' });
    scene.body.append(toggleLine('Sun shadows', display.shadows, (on) => { display.shadows = on; commit(); }));
    scene.body.append(slider({
      label: 'Shadow radius', value: display.shadowRadius ?? 1.35, min: 0.4, max: 4, step: 0.05, unit: 'px',
      hint: 'PCF kernel radius in shadow-map texels',
      onInput: (v) => { display.shadowRadius = v; commit(); },
      onChange: (v) => { display.shadowRadius = v; commit(); },
    }));
    scene.body.append(slider({
      label: 'Shadow bias', value: display.shadowBias ?? 0.0016, min: 0, max: 0.01, step: 0.0001,
      onInput: (v) => { display.shadowBias = v; commit(); },
      onChange: (v) => { display.shadowBias = v; commit(); },
    }));
    scene.body.append(selectLine('Projection', display.cameraMode || 'perspective',
      [{ value: 'perspective', label: 'Perspective' }, { value: 'orthographic', label: 'Orthographic' }],
      (value) => { display.cameraMode = value; app.camera.mode = value; }));
    scene.body.append(buttonRow([{ label: 'Frame terrain', icon: 'camera', onClick: () => app.frameCamera?.() }]));
    body.append(scene.root);
  }

  /* --------------------------------------------------------------- bake -- */
  function bakePanel() {
    const texture = editor.project.texture;
    const settings = card('Bake settings', { hint: 'PBR maps', icon: 'sparkle' });
    const commit = () => { editor.edit(() => {}, { texture: true }); app.regenerate('texture'); };
    settings.body.append(selectLine('Map resolution', texture.resolution, [
      { value: 512, label: '512 · quick' },
      { value: 1024, label: '1024 · draft' },
      { value: 2048, label: '2048 · production' },
      { value: 4096, label: '4096 · maximum' },
    ], (value) => { texture.resolution = Number(value); commit(); }));
    for (const [key, label, min, max, step, hint] of [
      ['wetness', 'Wetness', 0, 1.5, 0.01, 'Darkens and saturates the albedo where water flows'],
      ['dust', 'Dust', 0, 1.5, 0.01, 'Wind-blown dust that settles on flats and in hollows'],
      ['aoStrength', 'AO strength', 0, 1, 0.01, 'Applies the ray-marched ambient occlusion to the albedo'],
      ['cavityStrength', 'Cavity strength', 0, 1, 0.01, 'Fine cavity darkening from the height field curvature'],
      ['wetSaturation', 'Wet saturation', 0, 1, 0.01, 'Saturation boost in wet areas'],
      ['splatBlend', 'Splat coverage', 0, 1, 0.01, 'How strongly the exported splat maps reproduce this bake'],
    ]) {
      settings.body.append(slider({
        label, value: texture[key], min, max, step, hint,
        onInput: (v) => { texture[key] = v; editor.edit(() => {}, { texture: true }); app.scheduleRegenerate('texture'); },
        onChange: (v) => { texture[key] = v; commit(); },
      }));
    }
    settings.body.append(buttonRow([
      { label: 'Bake now', icon: 'sparkle', accent: true, onClick: () => app.regenerate('texture') },
      { label: 'Export albedo', icon: 'download', onClick: () => app.exportMap?.('albedo') },
      { label: 'Export ORM', icon: 'download', onClick: () => app.exportMap?.('orm') },
      { label: 'Export normal', icon: 'download', onClick: () => app.exportMap?.('normal') },
    ]));
    body.append(settings.root);

    const maps = card('Maps', { hint: `${editor.bakeStats?.resolution ?? texture.resolution}px`, icon: 'grid' });
    maps.body.append(el('div', { class: 'card-sub', text: 'PBR outputs: albedo (sRGB), ORM packed occlusion/roughness/metallic, tangent-space normal, and two 4-layer splat maps.' }));
    const grid = el('div', { class: 'palette-grid' });
    previewCanvases.clear();
    for (const key of ['albedo', 'orm', 'normal', 'splat0', 'splat1']) {
      const canvas = el('canvas', { class: 'map-thumb', title: key, style: { width: '100%', height: '56px', borderRadius: '8px', border: '1px solid #2c2c2c', background: '#141414' } });
      previewCanvases.set(key, canvas);
      const item = el('div', { style: { cursor: 'pointer' }, onclick: () => app.exportMap?.(key) }, canvas, el('div', { class: 'control-hint', text: key, style: { textAlign: 'center' } }));
      grid.append(item);
    }
    maps.body.append(grid);
    body.append(maps.root);
    refreshPreviews();
  }

  async function refreshPreviews() {
    const token = ++mapToken;
    const maps = app.baker?.maps;
    if (!maps) return;
    for (const [key, canvas] of previewCanvases) {
      const field = maps[key];
      if (!field) continue;
      try {
        const image = await readField(app.gpu, field);
        if (token !== mapToken) return;
        drawPreview(canvas, image, { tone: 'rgba' });
      } catch (error) {
        editor.log('warn', `preview ${key}: ${error.message}`);
      }
    }
  }

  /* -------------------------------------------------------------- heads -- */
  const HEAD_SPECS = {
    world: { title: 'World & terrain', sub: 'Extent, resolution, elevation', icon: 'grid' },
    lighting: { title: 'Sun & sky', sub: 'Key light, atmosphere, grade', icon: 'sun' },
    display: { title: 'Viewport', sub: 'View modes and overlays', icon: 'camera' },
    bake: { title: 'Bake & export', sub: 'Material maps and PNG export', icon: 'download' },
  };

  function renderHead() {
    clear(head);
    const { kind, id } = editor.selection;
    if (kind === 'layer') {
      const layer = editor.selected;
      if (!layer) {
        head.append(el('div', { class: 'head-name', text: 'Nothing selected' }));
        return;
      }
      const type = typeOf(layer);
      const enabled = layer.enabled !== false;
      head.append(
        el('div', { class: 'head-icon', style: { color: type?.accent || '#d6a078' } }, icon(type?.icon || 'sparkle', 16)),
        el('div', { style: { minWidth: '0' } },
          el('div', { class: 'head-name', text: layer.name }),
          el('div', { class: 'head-sub', text: `${type?.label || layer.type}${layerKindOf(layer) === 'sim' ? ' · simulation' : ''}` }),
        ),
        el('div', { class: 'head-actions' },
          el('button', {
            class: `chip${enabled ? '' : ' off'}`,
            text: enabled ? 'Enabled' : 'Disabled',
            title: enabled ? 'Disable this layer' : 'Enable this layer',
            onclick: () => editor.setEnabled(layer.id, !enabled),
          }),
        ),
      );
      void id;
      return;
    }
    const spec = HEAD_SPECS[kind];
    if (!spec) return;
    head.append(
      el('div', { class: 'head-icon' }, icon(spec.icon, 16)),
      el('div', { style: { minWidth: '0' } },
        el('div', { class: 'head-name', text: spec.title }),
        el('div', { class: 'head-sub', text: spec.sub }),
      ),
      el('div', { class: 'head-actions' },
        el('button', { class: 'ghost', title: 'Undo', onclick: () => editor.undo() }, icon('reset', 14)),
      ),
    );
  }

  function render() {
    renderHead();
    clear(body);
    const { kind } = editor.selection;
    if (kind === 'layer') {
      const layer = editor.selected;
      if (layer) layerPanel(layer);
      else body.append(el('div', { class: 'empty', text: 'Nothing selected' }));
    } else if (kind === 'world') worldPanel();
    else if (kind === 'lighting') lightingPanel();
    else if (kind === 'display') displayPanel();
    else if (kind === 'bake') bakePanel();
  }

  editor.on('selection', render);
  editor.on('change', (payload) => {
    // A structural change (stack list) re-renders; slider drags do not, so the
    // pointer never fights a re-created element.
    if (payload?.label === 'stack' || payload?.terrain || payload?.texture) {
      if (!app.dragging) render();
    }
  });
  editor.on('baked', () => { if (editor.selection.kind === 'bake') refreshPreviews(); });
  editor.on('stats', () => { if (editor.selection.kind === 'world') render(); });
  render();

  return { render, refreshPreviews, previewCanvases };
}
