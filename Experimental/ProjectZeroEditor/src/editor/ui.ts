import { LANE_INFO, TEMPLATES, totalExtent, layoutBands, centreMarkings } from '../model/profile';
import { DEFAULT_CITY } from '../model/generator';
import { ROAD_CLASSES, PROP_KINDS, validateNetwork, segmentsAtNode } from '../model/network';
import { sampleLength } from '../model/geometry';
import type { RoadClass, PropKind, LaneType, CentreKind, LaneProfile, RoadSegment } from '../model/types';
import { RoadEditor, TOOL_HINTS } from './editor';
import type { ToolId } from './editor';

/** Thin DOM helpers so the panels stay declarative without a framework. */
type Child = Node | string | null | false | undefined;
function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | ((e: Event) => void) | undefined> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (typeof v === 'function') node.addEventListener(k.replace(/^on/, ''), v);
    else if (k === 'class') node.className = String(v);
    else if (k === 'value') (node as HTMLInputElement).value = String(v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

const TOOLS: Array<{ id: ToolId; label: string; key: string; icon: string }> = [
  { id: 'select', label: 'Select / move', key: '1', icon: '◎' },
  { id: 'draw', label: 'Draw road', key: '2', icon: '✎' },
  { id: 'props', label: 'Place props', key: '3', icon: '⬢' },
  { id: 'delete', label: 'Delete', key: '4', icon: '✕' },
];

const PROP_LABELS: Record<PropKind, string> = {
  bollard: 'Bollard',
  speedBump: 'Speed bump',
  railCrossing: 'Railway crossing',
  crosswalk: 'Crosswalk (zebra)',
  stopLine: 'Stop line',
  subwayEntrance: 'Subway entrance',
};

const CLASS_LABELS: Record<RoadClass, string> = {
  highway: 'Highway',
  arterial: 'Arterial',
  boulevard: 'Boulevard',
  local: 'Local street',
  path: 'Pedestrian path',
  rail: 'Railway',
  subway: 'Subway',
};

const LANE_TYPES = Object.keys(LANE_INFO) as LaneType[];
const CENTRE_KINDS: CentreKind[] = ['none', 'doubleYellow', 'dashedWhite', 'median'];
const CENTRE_LABELS: Record<CentreKind, string> = {
  none: 'None',
  doubleYellow: 'Double yellow',
  dashedWhite: 'Dashed white',
  median: 'Raised median',
};

/**
 * Builds the editor shell and creates the editor inside its viewport.
 * `makeEditor` receives the viewport element that the 3D canvas should live in.
 */
export function mountUI(root: HTMLElement, makeEditor: (viewport: HTMLElement) => RoadEditor): { editor: RoadEditor; refresh: () => void } {
  root.innerHTML = '';
  const viewport = el('div', { class: 'viewport' });
  const editor = makeEditor(viewport);

  const toolButtons = new Map<ToolId, HTMLButtonElement>();
  const toolbar = el(
    'nav',
    { class: 'toolbar', 'aria-label': 'Tools' },
    ...TOOLS.map((t) => {
      const b = el(
        'button',
        {
          class: 'tool',
          title: `${t.label} (${t.key})`,
          onclick: () => editor.setTool(t.id),
        },
        el('span', { class: 'tool-icon' }, t.icon),
        el('span', { class: 'tool-label' }, t.label),
        el('kbd', {}, t.key),
      );
      toolButtons.set(t.id, b);
      return b;
    }),
  );

  const counts = el('span', { class: 'counts' });
  const message = el('span', { class: 'message' });
  const world = el('span', { class: 'world' });
  const cursor = el('span', { class: 'cursor' });
  const statusBar = el('footer', { class: 'statusbar' }, message, counts, world, cursor);
  const inspector = el('aside', { class: 'inspector', 'aria-label': 'Inspector' });

  const fileInput = el('input', {
    type: 'file',
    accept: 'application/json,.json',
    class: 'hidden',
    onchange: async (e: Event) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      try {
        editor.loadText(await file.text());
      } catch (err) {
        alert(`Could not open file:\n${(err as Error).message}`);
      }
      input.value = '';
    },
  });

  const genModal = buildGenerateModal(editor);
  const helpModal = buildHelp();

  const topbar = el(
    'header',
    { class: 'topbar' },
    el('div', { class: 'brand' }, el('strong', {}, 'Project Zero'), el('span', {}, ' · Road Editor')),
    el(
      'div',
      { class: 'actions' },
      button('New', () => {
        if (confirm('Clear the whole network? Autosave will be replaced.')) editor.newEmpty();
      }),
      button('Generate city…', () => genModal.show()),
      button('Open…', () => fileInput.click()),
      button('Save JSON', () => downloadJSON(editor)),
      button('Undo', () => editor.undo(), 'undo'),
      button('Redo', () => editor.redo(), 'redo'),
      button('Frame all', () => editor.frameAll()),
      button('Validate', () => {
        const errors = editor.validate();
        alert(errors.length ? `${errors.length} problem(s):\n${errors.slice(0, 20).join('\n')}` : 'Network is valid.');
      }),
      button('Help', () => helpModal.show()),
    ),
    fileInput,
  );

  root.append(topbar, el('div', { class: 'body' }, toolbar, viewport, inspector), statusBar, genModal.element, helpModal.element);

  let lastInspectorKey = '';
  const refresh = () => {
    for (const [id, btn] of toolButtons) btn.classList.toggle('active', editor.state.tool === id);
    const c = editor.counts();
    counts.textContent = `${c.nodes} junctions · ${c.segments} roads · ${c.props} props`;
    message.textContent = editor.state.message || TOOL_HINTS[editor.state.tool];
    const ws = editor.world.stats();
    world.textContent = `${ws.chunks} chunks · ${(ws.triangles / 1000).toFixed(1)}k tris · rebuilt ${ws.lastRebuilt}`;
    const cur = editor.state.cursor;
    cursor.textContent = cur ? `x ${cur.x.toFixed(1)}  z ${cur.z.toFixed(1)}  ·  fly ${editor.fly.speed.toFixed(0)} m/s` : `fly ${editor.fly.speed.toFixed(0)} m/s`;
    const undoBtn = root.querySelector<HTMLButtonElement>('button[data-act="undo"]');
    const redoBtn = root.querySelector<HTMLButtonElement>('button[data-act="redo"]');
    if (undoBtn) undoBtn.disabled = !editor.history.canUndo;
    if (redoBtn) redoBtn.disabled = !editor.history.canRedo;

    const sel = editor.state.selection;
    const key = [editor.state.tool, sel?.kind ?? '', sel?.id ?? '', editor.revision, editor.state.templateId, editor.state.propKind, editor.state.drawCount].join('|');
    if (key !== lastInspectorKey) {
      lastInspectorKey = key;
      renderInspector(inspector, editor);
    }
  };

  editor.onChange(refresh);
  refresh();
  return { editor, refresh };
}

function button(label: string, onClick: () => void, act?: string): HTMLButtonElement {
  return el('button', { class: 'btn', onclick: onClick, 'data-act': act }, label);
}

function downloadJSON(editor: RoadEditor): void {
  const blob = new Blob([editor.exportText()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: 'road-network.json' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function renderInspector(root: HTMLElement, editor: RoadEditor): void {
  root.innerHTML = '';
  const tool = editor.state.tool;
  const sel = editor.state.selection;

  if (tool === 'draw') {
    root.append(
      el('h2', {}, 'Draw road'),
      el('label', { class: 'field' }, el('span', {}, 'Road type'), templateSelect(editor.state.templateId, (id) => editor.setTemplate(id))),
      el('p', { class: 'muted' }, 'Click to lay points; the path is smoothed automatically. Clicks near an existing junction snap to it.'),
      el('div', { class: 'row' }, el('span', {}, `Points: ${editor.state.drawCount}`)),
      el(
        'div',
        { class: 'row' },
        button('Finish (Enter)', () => editor.finishDrawing()),
        button('Cancel (Esc)', () => editor.cancelDrawing()),
      ),
      crossSectionFor(editor.state.templateId),
    );
    return;
  }

  if (tool === 'props') {
    root.append(
      el('h2', {}, 'Place props'),
      el('p', { class: 'muted' }, 'Click next to a road. The prop snaps to the nearest point on its centreline; the lateral offset comes from where you click.'),
      el(
        'div',
        { class: 'prop-grid' },
        ...PROP_KINDS.map((k) =>
          el(
            'button',
            {
              class: `btn prop-btn${editor.state.propKind === k ? ' active' : ''}`,
              onclick: () => editor.setPropKind(k),
            },
            PROP_LABELS[k],
          ),
        ),
      ),
    );
    return;
  }

  if (!sel) {
    root.append(
      el('h2', {}, 'Document'),
      ...documentSummary(editor),
      el('p', { class: 'muted' }, 'Select a road, junction or prop to edit it. Use “Draw road” (2) to lay new roads.'),
    );
    return;
  }

  if (sel.kind === 'segment') {
    const seg = editor.net.segments[sel.id];
    if (seg) root.append(...segmentInspector(editor, seg));
  } else if (sel.kind === 'node') {
    const node = editor.net.nodes[sel.id];
    if (node) {
      const segs = segmentsAtNode(editor.net, node.id);
      root.append(
        el('h2', {}, 'Junction'),
        el('p', { class: 'muted' }, `${segs.length} road end(s) meet here. Drag it in the viewport or type coordinates.`),
        numberRow('X (m)', node.x, (v) => editor.setNodePosition(node.id, v, node.z)),
        numberRow('Z (m)', node.z, (v) => editor.setNodePosition(node.id, node.x, v)),
        el('div', { class: 'row' }, button('Delete junction + roads', () => editor.deleteSelection())),
      );
    }
  } else {
    const prop = editor.net.props[sel.id];
    if (prop) {
      root.append(
        el('h2', {}, 'Prop'),
        el(
          'label',
          { class: 'field' },
          el('span', {}, 'Kind'),
          selectEl(PROP_KINDS.map((k) => [k, PROP_LABELS[k]]), prop.kind, (v) => editor.updateProp(prop.id, { kind: v as PropKind })),
        ),
        rangeRow('Position along road', prop.u, (v) => editor.updateProp(prop.id, { u: v })),
        numberRow('Lateral offset (m, + left)', prop.lateral, (v) => editor.updateProp(prop.id, { lateral: v })),
        el('div', { class: 'row' }, button('Delete prop', () => editor.deleteProp(prop.id))),
      );
    }
  }
}

function documentSummary(editor: RoadEditor): Node[] {
  const c = editor.counts();
  const errors = validateNetwork(editor.net);
  const byClass = new Map<string, number>();
  for (const s of Object.values(editor.net.segments)) byClass.set(s.cls, (byClass.get(s.cls) ?? 0) + 1);
  return [
    el(
      'dl',
      { class: 'kv' },
      el('dt', {}, 'Junctions'),
      el('dd', {}, String(c.nodes)),
      el('dt', {}, 'Road segments'),
      el('dd', {}, String(c.segments)),
      el('dt', {}, 'Props'),
      el('dd', {}, String(c.props)),
    ),
    el(
      'ul',
      { class: 'chips' },
      ...[...byClass.entries()].map(([k, v]) => el('li', {}, `${CLASS_LABELS[k as RoadClass] ?? k}: ${v}`)),
    ),
    errors.length
      ? el('div', { class: 'alert' }, `${errors.length} validation problem(s). Use Validate for details.`)
      : el('div', { class: 'ok' }, 'Network is valid.'),
  ];
}

function segmentInspector(editor: RoadEditor, seg: RoadSegment): Node[] {
  const samples = editor.samplesOf(seg);
  const length = sampleLength(samples);
  const ext = totalExtent(seg.profile);
  const p = seg.profile;
  const nodes: Node[] = [
    el('h2', {}, CLASS_LABELS[seg.cls]),
    el('p', { class: 'muted' }, `Length ${length.toFixed(1)} m · width ${(ext.hi - ext.lo).toFixed(1)} m · id ${seg.id}`),
    el(
      'label',
      { class: 'field' },
      el('span', {}, 'Road class'),
      selectEl(ROAD_CLASSES.map((c) => [c, CLASS_LABELS[c]]), seg.cls, (v) => editor.setSegmentClass(seg.id, v as RoadClass)),
    ),
    el(
      'div',
      { class: 'field' },
      el('span', {}, 'Apply template'),
      el(
        'div',
        { class: 'row' },
        templateSelect(editor.state.templateId, (id) => editor.setTemplate(id)),
        button('Apply', () => editor.applyTemplate(seg.id, editor.state.templateId)),
      ),
    ),
    crossSectionSVG(p),
    el('h3', {}, 'Centre'),
    el(
      'div',
      { class: 'row' },
      selectEl(CENTRE_KINDS.map((k) => [k, CENTRE_LABELS[k]]), p.centre.kind, (v) =>
        editor.editProfile(seg.id, (pr) => {
          pr.centre.kind = v as CentreKind;
          if (v !== 'none' && pr.centre.width <= 0) pr.centre.width = v === 'median' ? 3 : 0.3;
        }),
      ),
      numberInput(p.centre.width, 0.05, 12, 0.05, (v) => editor.editProfile(seg.id, (pr) => (pr.centre.width = v))),
    ),
    el('h3', {}, 'Lanes · left'),
    laneList(editor, seg.id, 'left', p.left),
    el('h3', {}, 'Lanes · right'),
    laneList(editor, seg.id, 'right', p.right),
    el('h3', {}, 'Props on this road'),
  ];

  const props = Object.values(editor.net.props).filter((pr) => pr.segmentId === seg.id).sort((a, b) => a.u - b.u);
  if (!props.length) nodes.push(el('p', { class: 'muted' }, 'None. Use “Place props” (3).'));
  for (const pr of props) {
    nodes.push(
      el(
        'div',
        { class: 'prop-row' },
        el('button', { class: 'link', onclick: () => editor.select({ kind: 'prop', id: pr.id }) }, `${PROP_LABELS[pr.kind]} @ ${(pr.u * 100).toFixed(0)}%`),
        el('button', { class: 'icon', title: 'Delete prop', onclick: () => editor.deleteProp(pr.id) }, '✕'),
      ),
    );
  }

  nodes.push(el('div', { class: 'row end' }, button('Delete road', () => editor.deleteSelection())));
  return nodes;
}

function laneList(editor: RoadEditor, segId: string, side: 'left' | 'right', lanes: LaneProfile['left']): Node {
  const rows = lanes.map((lane, i) =>
    el(
      'div',
      { class: 'lane-row' },
      selectEl(LANE_TYPES.map((t) => [t, LANE_INFO[t].label]), lane.type, (v) =>
        editor.editProfile(segId, (pr) => (pr[side][i].type = v as LaneType)),
      ),
      numberInput(lane.width, 0.3, 12, 0.1, (v) => editor.editProfile(segId, (pr) => (pr[side][i].width = v))),
      el('button', { class: 'icon', title: 'Remove lane', onclick: () => editor.editProfile(segId, (pr) => pr[side].splice(i, 1)) }, '−'),
    ),
  );
  const addType = el('select', { class: 'input' }, ...LANE_TYPES.map((t) => el('option', { value: t }, LANE_INFO[t].label)));
  return el(
    'div',
    { class: 'lanes' },
    ...rows,
    el(
      'div',
      { class: 'row' },
      addType,
      button('+ Add lane', () => {
        const t = addType.value as LaneType;
        editor.editProfile(segId, (pr) => pr[side].push({ type: t, width: LANE_INFO[t].defaultWidth }));
      }),
    ),
  );
}

function crossSectionFor(templateId: string): Node {
  const tpl = TEMPLATES.find((t) => t.id === templateId);
  return tpl ? crossSectionSVG(tpl.profile()) : el('span');
}

/** Draws the cross-section as a simple to-scale SVG strip: bands, kerbs and paint. */
function crossSectionSVG(p: LaneProfile): Node {
  const bands = layoutBands(p);
  const ext = totalExtent(p);
  const width = ext.hi - ext.lo || 1;
  const W = 300;
  const H = 70;
  const sx = (off: number) => ((off - ext.lo) / width) * W;
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'xsec');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Cross-section preview');
  for (const b of bands) {
    const r = document.createElementNS(svgNS, 'rect');
    r.setAttribute('x', String(sx(b.lo)));
    r.setAttribute('width', String(sx(b.hi) - sx(b.lo)));
    r.setAttribute('y', b.raised ? '8' : '30');
    r.setAttribute('height', b.raised ? '40' : '30');
    r.setAttribute('fill', `#${b.color.toString(16).padStart(6, '0')}`);
    svg.append(r);
  }
  for (const m of centreMarkings(p)) {
    const l = document.createElementNS(svgNS, 'line');
    l.setAttribute('x1', String(sx(m.offset)));
    l.setAttribute('x2', String(sx(m.offset)));
    l.setAttribute('y1', '28');
    l.setAttribute('y2', '62');
    l.setAttribute('stroke', `#${m.colour.toString(16).padStart(6, '0')}`);
    l.setAttribute('stroke-width', m.style === 'doubleYellow' ? '1.5' : '1');
    if (m.style === 'dashed') l.setAttribute('stroke-dasharray', '3 2');
    svg.append(l);
  }
  return el('div', { class: 'xsec-wrap' }, svg, el('div', { class: 'muted small' }, `Cross-section ${width.toFixed(1)} m`));
}

function templateSelect(value: string, onChange: (id: string) => void): HTMLSelectElement {
  return selectEl(
    TEMPLATES.map((t) => [t.id, t.label]),
    value,
    onChange,
    'input template-select',
  );
}

function selectEl(options: Array<[string, string]>, value: string, onChange: (v: string) => void, cls = 'input'): HTMLSelectElement {
  const s = el(
    'select',
    { class: cls, onchange: (e: Event) => onChange((e.target as HTMLSelectElement).value) },
    ...options.map(([v, label]) => el('option', { value: v, selected: v === value }, label)),
  );
  s.value = value;
  return s;
}

function numberInput(value: number, min: number, max: number, step: number, onCommit: (v: number) => void): HTMLInputElement {
  return el('input', {
    class: 'input num',
    type: 'number',
    value: Number(value.toFixed(3)),
    min,
    max,
    step,
    onchange: (e: Event) => {
      const v = parseFloat((e.target as HTMLInputElement).value);
      if (Number.isFinite(v)) onCommit(Math.min(max, Math.max(min, v)));
    },
  });
}

function numberRow(label: string, value: number, onCommit: (v: number) => void): Node {
  return el(
    'label',
    { class: 'field' },
    el('span', {}, label),
    el('input', {
      class: 'input',
      type: 'number',
      step: 0.1,
      value: Number(value.toFixed(3)),
      onchange: (e: Event) => {
        const v = parseFloat((e.target as HTMLInputElement).value);
        if (Number.isFinite(v)) onCommit(v);
      },
    }),
  );
}

function rangeRow(label: string, value: number, onCommit: (v: number) => void): Node {
  const out = el('output', {}, value.toFixed(2));
  const input = el('input', {
    type: 'range',
    min: 0,
    max: 1,
    step: 0.005,
    value,
    oninput: (e: Event) => {
      out.textContent = Number((e.target as HTMLInputElement).value).toFixed(2);
    },
    onchange: (e: Event) => onCommit(parseFloat((e.target as HTMLInputElement).value)),
  });
  return el('label', { class: 'field' }, el('span', {}, label, ' ', out), input);
}

function buildGenerateModal(editor: RoadEditor): { element: HTMLElement; show: () => void } {
  const o = { ...DEFAULT_CITY };
  const num = (key: 'seed' | 'width' | 'depth' | 'block' | 'jitter', label: string, step = 1) =>
    el(
      'label',
      { class: 'field' },
      el('span', {}, label),
      el('input', {
        class: 'input',
        type: 'number',
        step,
        value: o[key],
        onchange: (e: Event) => {
          const v = parseFloat((e.target as HTMLInputElement).value);
          if (Number.isFinite(v)) o[key] = v;
        },
      }),
    );
  const check = (key: 'busLanes' | 'bikeLanes' | 'parking' | 'pedestrianPaths' | 'railway' | 'subway' | 'speedBumps', label: string) =>
    el(
      'label',
      { class: 'check' },
      el('input', {
        type: 'checkbox',
        checked: o[key],
        onchange: (e: Event) => {
          o[key] = (e.target as HTMLInputElement).checked;
        },
      }),
      el('span', {}, label),
    );

  const modal = el(
    'div',
    { class: 'modal-card', role: 'dialog', 'aria-modal': 'true' },
    el('h2', {}, 'Generate city'),
    el('p', { class: 'muted' }, 'Deterministic grid city with arterials, boulevards, local streets, footpaths, a railway, and a subway line. Replaces the current network.'),
    el(
      'div',
      { class: 'grid2' },
      num('seed', 'Seed'),
      num('block', 'Block size (m)'),
      num('width', 'Width (m)', 100),
      num('depth', 'Depth (m)', 100),
      num('jitter', 'Node jitter (0–0.3)', 0.01),
    ),
    el(
      'div',
      { class: 'checks' },
      check('busLanes', 'Bus lanes on arterials'),
      check('bikeLanes', 'Bike lanes on boulevards'),
      check('parking', 'Parking lanes'),
      check('pedestrianPaths', 'Diagonal footpaths'),
      check('railway', 'Railway line + crossings'),
      check('subway', 'Subway line + entrances'),
      check('speedBumps', 'Speed bumps on local streets'),
    ),
    el(
      'div',
      { class: 'row end' },
      button('Cancel', () => hide()),
      button('Generate', () => {
        hide();
        editor.generate({ ...o });
      }),
    ),
  );
  const element = el('div', { class: 'modal hidden' }, modal);
  const hide = () => element.classList.add('hidden');
  const show = () => element.classList.remove('hidden');
  element.addEventListener('pointerdown', (e) => {
    if (e.target === element) hide();
  });
  return { element, show };
}

function buildHelp(): { element: HTMLElement; show: () => void } {
  const rows: Array<[string, string]> = [
    ['W A S D', 'Fly forward / left / back / right (Unreal style)'],
    ['Q / E', 'Fly down / up'],
    ['Right mouse drag', 'Look around'],
    ['Mouse wheel', 'Change fly speed'],
    ['Shift / Ctrl', 'Speed ×4 / ×0.25 while moving'],
    ['Left click', 'Use the active tool'],
    ['1 2 3 4', 'Select · Draw road · Place props · Delete'],
    ['Enter / double-click', 'Finish the road being drawn'],
    ['Esc', 'Cancel drawing, or clear selection'],
    ['Delete', 'Delete the selection'],
    ['F', 'Frame the selection (or the whole map)'],
    ['Ctrl+Z / Ctrl+Shift+Z', 'Undo / redo'],
    ['Ctrl+S', 'Save to browser storage'],
  ];
  const card = el(
    'div',
    { class: 'modal-card' },
    el('h2', {}, 'Controls'),
    el('table', { class: 'keys' }, el('tbody', {}, ...rows.map(([k, v]) => el('tr', {}, el('td', {}, el('kbd', {}, k)), el('td', {}, v))))),
    el('div', { class: 'row end' }, button('Close', () => hide())),
  );
  const element = el('div', { class: 'modal hidden' }, card);
  const hide = () => element.classList.add('hidden');
  const show = () => element.classList.remove('hidden');
  element.addEventListener('pointerdown', (e) => {
    if (e.target === element) hide();
  });
  return { element, show };
}
