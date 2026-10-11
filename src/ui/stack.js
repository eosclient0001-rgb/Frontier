/**
 * Frontier Terrain Forge — the layer stack.
 *
 * The rail is the workflow: it reads top to bottom exactly like the pipeline
 * runs. Two stacks live here, chosen by the tab chip at the top —
 *
 *   1 · TERRAIN   generators, from the first mass to the last dressing pass,
 *                 with the erosion simulation sitting where it runs.
 *   2 · TEXTURE   the material stack, blended over the generated surface.
 *
 * Rows reorder by drag, toggle with the eye, and open a menu for the operations
 * that do not deserve a button (duplicate, remove, reset).
 */
import { el, clear, icon, sortable } from './dom.js';
import { openMenu, closeMenu } from './menu.js';
import { TERRAIN_TYPES, MATERIAL_TYPES, EROSION_TYPES, BLEND_OPS, VIEW_MODES } from '../gen/schema.js';
import { layerKindOf, typeOf } from './state.js';

const TERRAIN_GROUPS = [
  { label: 'Mass', ids: ['mountain', 'hills', 'plateau', 'canyon', 'dunes', 'volcano', 'island', 'noise'] },
  { label: 'Shaping', ids: ['strata', 'cracks', 'warpLayer', 'smooth', 'detail', 'flat'] },
  { label: 'Simulation', ids: EROSION_TYPES.map((t) => t.id) },
];

const SCENE_ROWS = [
  { id: 'world', label: 'World & terrain', sub: 'Resolution, extent, elevation', icon: 'grid' },
  { id: 'lighting', label: 'Sun & sky', sub: 'Key light, atmosphere, grade', icon: 'sun' },
  { id: 'display', label: 'Viewport', sub: 'View modes and overlays', icon: 'camera' },
  { id: 'bake', label: 'Bake & export', sub: 'Material maps, PNG export', icon: 'download' },
];

const blendOf = (id) => BLEND_OPS.find((b) => b.id === id);

export function createStackPanel(editor, refs) {
  let search = '';

  /* ------------------------------------------------------------- rows -- */
  const sceneRow = (spec) => {
    const selected = editor.selection.kind === spec.id;
    const row = el('div', { class: `row${selected ? ' selected' : ''}`, dataset: { id: spec.id } },
      el('div', { class: 'row-icon' }, icon(spec.icon, 15)),
      el('div', { class: 'row-title' },
        el('div', { class: 'row-name', text: spec.label }),
        el('div', { class: 'row-sub', text: spec.sub }),
      ),
    );
    row.addEventListener('click', () => editor.select({ kind: spec.id, id: null }));
    return row;
  };

  const layerRow = (layer, list) => {
    const type = typeOf(layer);
    const kind = layerKindOf(layer);
    const selected = editor.selection.kind === 'layer' && editor.selection.id === layer.id;
    const nameNode = el('div', { class: 'row-name', text: layer.name });
    const sub = kind === 'sim'
      ? `${Math.round(layer.amount * 100)}% · ${layer.params?.iterations ?? 0} iterations`
      : kind === 'material'
        ? `${Math.round(layer.amount * 100)}% · ${layer.palette || 'palette'}`
        : `${blendOf(layer.blend)?.label || 'Add'} ${Math.round(layer.amount * 100)}%`;
    const title = el('div', { class: 'row-title' }, nameNode, el('div', { class: 'row-sub', text: sub }));

    const row = el('div', {
      class: `row${selected ? ' selected' : ''}${layer.enabled === false ? ' disabled' : ' enabled'}`,
      dataset: { id: layer.id },
      title: type?.desc || '',
    },
      el('div', { class: 'row-icon', style: { color: type?.accent || '#8d8d8d', opacity: layer.enabled === false ? '0.45' : '0.85' } }, icon(type?.icon || 'sparkle', 15)),
      title,
      kind === 'sim' ? el('span', { class: 'row-badge', text: 'sim' }) : null,
      (layer.masks?.length ? el('span', { class: 'row-badge', text: `${layer.masks.length}m` }) : null),
      el('button', {
        class: 'row-eye', title: layer.enabled === false ? 'Enable' : 'Disable',
        onclick: (event) => { event.stopPropagation(); editor.setEnabled(layer.id, layer.enabled === false); },
      }, icon(layer.enabled === false ? 'eyeOff' : 'eye', 14)),
      el('button', {
        class: 'row-menu', title: 'Layer actions',
        onclick: (event) => {
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          openMenu({ x: rect.right - 216, y: rect.bottom + 4 }, {
            title: layer.name,
            items: [
              { label: 'Rename', icon: 'chevron', onClick: () => beginRename() },
              { label: 'Duplicate', icon: 'copy', onClick: () => editor.duplicateLayer(layer.id) },
              { label: 'Reset parameters', icon: 'reset', onClick: () => editor.resetLayer(layer.id) },
              { label: layer.enabled === false ? 'Enable layer' : 'Disable layer', icon: layer.enabled === false ? 'eye' : 'eyeOff', onClick: () => editor.setEnabled(layer.id, layer.enabled === false), dividerBefore: true },
              { label: 'Move up', icon: 'lift', onClick: () => moveWithin(list, layer.id, -1) },
              { label: 'Move down', icon: 'lower', onClick: () => moveWithin(list, layer.id, 1) },
              { label: 'Delete', icon: 'trash', onClick: () => editor.removeLayer(layer.id), dividerBefore: true },
            ],
          });
        },
      }, icon('more', 14)),
    );

    const beginRename = () => {
      const input = el('input', {
        type: 'text', value: layer.name,
        style: { width: '100%', background: 'transparent', border: '0', color: 'inherit', fontSize: '12px', padding: '0' },
      });
      title.replaceChildren(input);
      input.focus();
      input.select();
      const commit = () => editor.renameLayer(layer.id, input.value);
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { input.blur(); }
        if (event.key === 'Escape') { input.value = layer.name; input.blur(); }
      });
    };
    nameNode.addEventListener('dblclick', (event) => { event.stopPropagation(); beginRename(); });
    row.addEventListener('click', () => editor.selectLayer(layer.id));

    return sortable(row, {
      onStart: () => row.classList.add('dragging'),
      onEnd: () => { row.classList.remove('dragging'); closeMenu(); },
      onDrop: (after) => {
        const dragged = editor.__draggingId || document.querySelector('.row.dragging')?.dataset.id;
        if (!dragged || dragged === layer.id) return;
        const target = [...list].findIndex((l) => l.id === layer.id);
        const draggedIndex = [...list].findIndex((l) => l.id === dragged);
        let to = after ? target + 1 : target;
        if (draggedIndex >= 0 && draggedIndex < to) to -= 1;
        editor.moveLayer(dragged, { toIndex: to });
      },
    });
  };

  const moveWithin = (list, id, delta) => {
    const index = list.findIndex((l) => l.id === id);
    if (index < 0) return;
    const to = index + delta;
    if (to < 0 || to >= list.length) return;
    editor.moveLayer(id, { toIndex: to });
  };

  /* ------------------------------------------------------------- menus -- */
  function openAddMenu(at, material, index = null) {
    const items = [];
    if (material) {
      for (const type of MATERIAL_TYPES) {
        items.push({ label: type.label, icon: type.icon, title: type.desc, onClick: () => editor.addLayer(type.id, { material: true, index }) });
      }
    } else {
      for (const group of TERRAIN_GROUPS) {
        items.push({ label: group.label, disabled: true, dividerBefore: group.label !== 'Mass' });
        for (const id of group.ids) {
          const type = [...TERRAIN_TYPES, ...EROSION_TYPES].find((t) => t.id === id);
          if (!type) continue;
          items.push({
            label: type.label, icon: type.icon, title: type.desc,
            onClick: () => (EROSION_TYPES.some((t) => t.id === id)
              ? editor.addErosionLayer(id, index)
              : editor.addLayer(id, { index })),
          });
        }
      }
    }
    openMenu(at, { title: material ? 'Material layers' : 'Terrain layers', items });
  }

  /* ------------------------------------------------------------ render -- */
  function render() {
    clear(refs.scroll);
    const terrainTab = editor.tab !== 'texture';
    const list = terrainTab ? editor.project.terrain : editor.project.materials;
    const needle = search.trim().toLowerCase();

    // tab chips
    clear(refs.tabs);
    const tabs = [['terrain', 'Terrain', 'generate'], ['texture', 'Texture', 'shade']];
    for (const [id, label, hint] of tabs) {
      refs.tabs.append(el('button', {
        class: `tab${editor.tab === id ? ' on' : ''}`,
        onclick: () => editor.setTab(id),
      }, el('span', { text: label }), el('small', { text: hint })));
    }

    const group = el('section', { class: 'group' });
    group.append(el('div', { class: 'group-head' },
      el('span', { class: 'eyebrow', text: terrainTab ? 'Terrain stack' : 'Texture stack' }),
      el('span', { class: 'group-actions' },
        el('span', { class: 'count', text: `${list.length}` }),
        el('button', {
          class: 'ghost', title: 'Add layer',
          onclick: (event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            openAddMenu({ x: rect.left - 200, y: rect.bottom + 4 }, !terrainTab);
          },
        }, icon('plus', 14)),
      ),
    ));

    const rows = el('div', { class: 'rows' });
    if (!terrainTab) {
      const bakeRow = sceneRow({ id: 'bake', label: 'Bake settings', sub: `${editor.project.texture.resolution}px maps`, icon: 'sparkle' });
      bakeRow.classList.add('pin');
      rows.append(bakeRow);
      rows.append(el('div', { class: 'stack-divider' }, el('span', { text: 'materials' })));
    }
    let lastKind = null;
    let shown = 0;
    for (let i = 0; i < list.length; i++) {
      const layer = list[i];
      const kind = layerKindOf(layer);
      if (terrainTab && kind === 'sim' && lastKind !== 'sim') {
        rows.append(el('div', { class: 'stack-divider' }, el('span', { text: 'simulation runs here' })));
      }
      if (terrainTab && kind !== 'sim' && lastKind === 'sim') {
        rows.append(el('div', { class: 'stack-divider' }, el('span', { text: 'post-simulation dressing' })));
      }
      lastKind = kind;
      if (needle && !layer.name.toLowerCase().includes(needle) && !(typeOf(layer)?.label || '').toLowerCase().includes(needle)) continue;
      shown++;
      rows.append(layerRow(layer, list));
    }
    if (!shown) rows.append(el('div', { class: 'empty', text: terrainTab ? 'No terrain layers yet' : 'No material layers yet' }));
    group.append(rows);
    refs.scroll.append(group);

    const scene = el('section', { class: 'group' });
    scene.append(el('div', { class: 'group-head' }, el('span', { class: 'eyebrow', text: 'Scene' })));
    const sceneRows = el('div', { class: 'rows' });
    for (const spec of SCENE_ROWS) sceneRows.append(sceneRow(spec));
    scene.append(sceneRows);
    refs.scroll.append(scene);
  }

  refs.search?.addEventListener('input', () => { search = refs.search.value; render(); });
  editor.on('change', render);
  editor.on('tab', render);
  editor.on('selection', render);
  render();
  return { render };
}
