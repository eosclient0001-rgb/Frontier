import * as THREE from 'three';
import { ChunkedRoadWorld } from '../render/world';
import { FlyCamera } from './flyCamera';
import { Overlay } from './overlay';
import { History } from '../model/history';
import { generateCity, type CityOptions, DEFAULT_CITY } from '../model/generator';
import { closestOnSamples, dist, sampleAtU, type Sample } from '../model/geometry';
import type { V2 } from '../model/types';
import {
  addProp,
  addRoadChain,
  createEmptyNetwork,
  moveNode,
  parseNetwork,
  removeNode,
  removeProp,
  removeSegment,
  serializeNetwork,
  validateNetwork,
} from '../model/network';
import { defaultTemplateFor, templateById, totalExtent } from '../model/profile';
import type { LaneProfile, PropKind, RoadClass, RoadNetwork, RoadSegment } from '../model/types';

export type ToolId = 'select' | 'draw' | 'props' | 'delete';
export type Selection =
  | { kind: 'segment'; id: string }
  | { kind: 'node'; id: string }
  | { kind: 'prop'; id: string }
  | null;

export interface EditorState {
  tool: ToolId;
  selection: Selection;
  propKind: PropKind;
  templateId: string;
  drawCount: number;
  cursor: V2 | null;
  message: string;
}

const AUTOSAVE_KEY = 'project-zero-road-editor:autosave:v1';
const SNAP_RADIUS = 3;
const GROUND = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

/**
 * Editor controller: owns the network, tools, input and the three.js scene.
 * UI code only reads `state` and calls the public methods.
 */
export class RoadEditor {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly fly: FlyCamera;
  readonly world = new ChunkedRoadWorld(400);
  readonly overlay: Overlay;
  net: RoadNetwork = createEmptyNetwork();
  /** Increments on every document change; UI uses it to know when to refresh. */
  revision = 0;
  readonly history = new History();
  state: EditorState = {
    tool: 'select',
    selection: null,
    propKind: 'crosswalk',
    templateId: 'arterial-bus',
    drawCount: 0,
    cursor: null,
    message: '',
  };

  private listeners = new Set<() => void>();
  private drawPoints: V2[] = [];
  private drawNodeIds: (string | null)[] = [];
  private raycaster = new THREE.Raycaster();
  private pointerNdc = new THREE.Vector2();
  private drag: { nodeId: string; recorded: boolean } | null = null;
  private netDirty = true;
  private overlayDirty = true;
  private saveTimer: number | undefined;
  private rafId = 0;
  private lastTime = performance.now();
  private statusTimer = 0;
  private readonly cleanups: Array<() => void> = [];

  constructor(private readonly container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = false;
    this.renderer.setClearColor(0x9fb8c8);
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.touchAction = 'none';

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.5, 40000);
    this.scene.fog = new THREE.Fog(0x9fb8c8, 1500, 9000);
    this.scene.add(new THREE.HemisphereLight(0xe2ecf4, 0x4d5a36, 1.0));
    const sun = new THREE.DirectionalLight(0xfff4e0, 1.8);
    sun.position.set(600, 1000, 400);
    this.scene.add(sun);

    // Ground: large plane sitting just below the road surface, with a 10 m grid
    // below road level so it reads as orientation without z-fighting asphalt.
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40000, 40000),
      new THREE.MeshStandardMaterial({ color: 0x5f7d4c, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    this.scene.add(ground);
    const grid = new THREE.GridHelper(4000, 400, 0x7d9a68, 0x6f8c5d);
    grid.position.y = -0.02;
    this.scene.add(grid);

    this.scene.add(this.world.group);
    this.overlay = new Overlay();
    this.scene.add(this.overlay.group);
    this.fly = new FlyCamera(this.camera, this.renderer.domElement);

    this.attachInput();
    this.resize();
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(this.container);
    this.cleanups.push(() => ro.disconnect());
  }

  // --- lifecycle ---------------------------------------------------------------

  start(): void {
    const loop = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - this.lastTime) / 1000);
      this.lastTime = now;
      this.fly.update(dt);
      if (this.netDirty) {
        this.netDirty = false;
        this.world.sync(this.net);
        this.overlayDirty = true;
      }
      if (this.overlayDirty) {
        this.overlayDirty = false;
        this.refreshOverlay();
      }
      this.renderer.render(this.scene, this.camera);
      this.rafId = requestAnimationFrame(loop);
      this.statusTimer += dt;
      if (this.statusTimer > 0.25) {
        this.statusTimer = 0;
        this.emit();
      }
    };
    loop();
  }

  dispose(): void {
    cancelAnimationFrame(this.rafId);
    for (const c of this.cleanups) c();
    this.fly.dispose();
    this.world.dispose();
    this.overlay.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = `${w}px`;
    this.renderer.domElement.style.height = `${h}px`;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // --- document ----------------------------------------------------------------

  /** Replaces the whole document. Not undoable (use File > Open as a fresh start). */
  setNetwork(net: RoadNetwork): void {
    this.net = net;
    this.history.clear();
    this.clearDrawing();
    this.state.selection = null;
    this.touchNetwork();
    this.scheduleSave();
    this.notify('Document loaded');
  }

  newEmpty(): void {
    this.setNetwork(createEmptyNetwork());
  }

  generate(opts: Partial<CityOptions>): void {
    const net = generateCity({ ...DEFAULT_CITY, ...opts });
    this.setNetwork(net);
    this.frameAll();
    const counts = this.counts();
    this.notify(`Generated city: ${counts.segments} segments, ${counts.props} props`);
  }

  loadText(text: string): void {
    this.setNetwork(parseNetwork(text));
    this.frameAll();
  }

  exportText(): string {
    return serializeNetwork(this.net);
  }

  counts(): { nodes: number; segments: number; props: number } {
    return {
      nodes: Object.keys(this.net.nodes).length,
      segments: Object.keys(this.net.segments).length,
      props: Object.keys(this.net.props).length,
    };
  }

  validate(): string[] {
    return validateNetwork(this.net);
  }

  /** Frames the whole network. */
  frameAll(): void {
    const ids = Object.values(this.net.nodes);
    if (!ids.length) {
      this.fly.frame(new THREE.Vector3(0, 0, 0), 300);
      return;
    }
    let minX = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (const n of ids) {
      minX = Math.min(minX, n.x);
      minZ = Math.min(minZ, n.z);
      maxX = Math.max(maxX, n.x);
      maxZ = Math.max(maxZ, n.z);
    }
    const centre = new THREE.Vector3((minX + maxX) / 2, 0, (minZ + maxZ) / 2);
    const radius = Math.hypot(maxX - minX, maxZ - minZ) / 2;
    this.fly.frame(centre, Math.max(120, radius));
  }

  // --- tools ---------------------------------------------------------------------

  setTool(tool: ToolId): void {
    if (this.state.tool === 'draw' && tool !== 'draw') this.cancelDrawing();
    this.state.tool = tool;
    this.state.message = TOOL_HINTS[tool];
    this.overlayDirty = true;
    this.notify();
  }

  setPropKind(kind: PropKind): void {
    this.state.propKind = kind;
    this.notify();
  }

  setTemplate(id: string): void {
    if (!templateById(id)) return;
    this.state.templateId = id;
    this.notify();
  }

  get drawing(): { points: V2[] } {
    return { points: this.drawPoints };
  }

  /** Finishes the chain being drawn. Needs at least two points. */
  finishDrawing(): void {
    if (this.drawPoints.length < 2) {
      this.cancelDrawing();
      return;
    }
    const tpl = templateById(this.state.templateId) ?? defaultTemplateFor('arterial');
    this.mutate(() => {
      const segs = addRoadChain(this.net, this.drawPoints, this.drawNodeIds, tpl.cls, tpl.profile());
      if (segs.length) this.state.selection = { kind: 'segment', id: segs[segs.length - 1].id };
    });
    this.clearDrawing();
    this.notify(`Added ${tpl.label.toLowerCase()}`);
  }

  cancelDrawing(): void {
    this.clearDrawing();
    this.notify();
  }

  private clearDrawing(): void {
    this.drawPoints = [];
    this.drawNodeIds = [];
    this.state.drawCount = 0;
    this.overlayDirty = true;
  }

  deleteSelection(): void {
    const sel = this.state.selection;
    if (!sel) return;
    this.mutate(() => {
      if (sel.kind === 'segment') removeSegment(this.net, sel.id);
      else if (sel.kind === 'node') removeNode(this.net, sel.id);
      else removeProp(this.net, sel.id);
    });
    this.state.selection = null;
    this.notify('Deleted');
  }

  select(sel: Selection): void {
    this.state.selection = sel;
    this.overlayDirty = true;
    this.notify();
  }

  undo(): void {
    const prev = this.history.undo(this.net);
    if (!prev) return this.notify('Nothing to undo');
    this.net = prev;
    this.afterReplace('Undo');
  }

  redo(): void {
    const next = this.history.redo(this.net);
    if (!next) return this.notify('Nothing to redo');
    this.net = next;
    this.afterReplace('Redo');
  }

  private afterReplace(msg: string): void {
    this.state.selection = null;
    this.touchNetwork();
    this.scheduleSave();
    this.notify(msg);
  }

  // --- editing helpers used by the inspector ------------------------------------

  setSegmentClass(segId: string, cls: RoadClass): void {
    const seg = this.net.segments[segId];
    if (!seg) return;
    this.mutate(() => {
      seg.cls = cls;
      seg.profile = defaultTemplateFor(cls).profile();
    });
    this.notify();
  }

  applyTemplate(segId: string, templateId: string): void {
    const tpl = templateById(templateId);
    const seg = this.net.segments[segId];
    if (!tpl || !seg) return;
    this.mutate(() => {
      seg.cls = tpl.cls;
      seg.profile = tpl.profile();
    });
    this.notify(`Applied ${tpl.label}`);
  }

  editProfile(segId: string, edit: (p: LaneProfile) => void): void {
    const seg = this.net.segments[segId];
    if (!seg) return;
    this.mutate(() => edit(seg.profile));
    this.notify();
  }

  setNodePosition(nodeId: string, x: number, z: number): void {
    if (!this.net.nodes[nodeId]) return;
    this.mutate(() => moveNode(this.net, nodeId, x, z));
    this.notify();
  }

  updateProp(propId: string, patch: Partial<{ kind: PropKind; u: number; lateral: number }>): void {
    const p = this.net.props[propId];
    if (!p) return;
    this.mutate(() => {
      Object.assign(p, patch);
      p.u = Math.min(1, Math.max(0, p.u));
    });
    this.notify();
  }

  deleteProp(propId: string): void {
    if (!this.net.props[propId]) return;
    this.mutate(() => removeProp(this.net, propId));
    if (this.state.selection?.id === propId) this.state.selection = null;
    this.notify();
  }

  /** Samples of a segment (shared cache with the renderer). */
  samplesOf(seg: RoadSegment): Sample[] {
    return this.world.samplesFor(this.net, seg);
  }

  // --- input ----------------------------------------------------------------------

  private attachInput(): void {
    const dom = this.renderer.domElement;
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || this.fly.isLooking) return;
      const p = this.groundAt(e.clientX, e.clientY);
      if (!p) return;
      if (this.state.tool === 'select') this.beginSelectDrag(p);
      else if (this.state.tool === 'draw') this.addDrawPoint(p);
      else if (this.state.tool === 'props') this.placeProp(p);
      else if (this.state.tool === 'delete') this.deleteAt(p);
    };
    const onMove = (e: PointerEvent) => {
      const p = this.groundAt(e.clientX, e.clientY);
      this.state.cursor = p;
      if (this.drag && p) {
        if (!this.drag.recorded) {
          this.history.record(this.net);
          this.drag.recorded = true;
        }
        moveNode(this.net, this.drag.nodeId, p.x, p.z);
        this.touchNetwork(false);
      }
      if (this.state.tool === 'draw' || this.state.tool === 'props' || this.state.tool === 'delete') this.overlayDirty = true;
    };
    const onUp = () => {
      if (this.drag) {
        this.drag = null;
        this.scheduleSave();
        this.notify();
      }
    };
    const onDouble = (e: MouseEvent) => {
      if (this.state.tool === 'draw') {
        // Repeated clicks within 1 m are ignored by addDrawPoint, so no duplicate to remove.
        this.finishDrawing();
        e.preventDefault();
      }
    };
    dom.addEventListener('pointerdown', onDown);
    dom.addEventListener('pointermove', onMove);
    dom.addEventListener('pointerup', onUp);
    dom.addEventListener('dblclick', onDouble);
    this.cleanups.push(
      () => dom.removeEventListener('pointerdown', onDown),
      () => dom.removeEventListener('pointermove', onMove),
      () => dom.removeEventListener('pointerup', onUp),
      () => dom.removeEventListener('dblclick', onDouble),
    );

    const onKey = (e: KeyboardEvent) => this.onKey(e);
    window.addEventListener('keydown', onKey);
    this.cleanups.push(() => window.removeEventListener('keydown', onKey));
  }

  private onKey(e: KeyboardEvent): void {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.code === 'KeyZ' && !e.shiftKey) {
      e.preventDefault();
      this.undo();
    } else if ((mod && e.code === 'KeyZ' && e.shiftKey) || (mod && e.code === 'KeyY')) {
      e.preventDefault();
      this.redo();
    } else if (mod && e.code === 'KeyS') {
      e.preventDefault();
      this.saveNow();
      this.notify('Saved to browser storage');
    } else if (!mod && e.code === 'Digit1') this.setTool('select');
    else if (!mod && e.code === 'Digit2') this.setTool('draw');
    else if (!mod && e.code === 'Digit3') this.setTool('props');
    else if (!mod && e.code === 'Digit4') this.setTool('delete');
    else if (e.code === 'Enter' && this.state.tool === 'draw') this.finishDrawing();
    else if (e.code === 'Escape') {
      if (this.drawPoints.length) this.cancelDrawing();
      else this.select(null);
    } else if ((e.code === 'Delete' || e.code === 'Backspace') && this.state.selection) {
      e.preventDefault();
      this.deleteSelection();
    } else if (e.code === 'KeyF') {
      const sel = this.state.selection;
      if (sel?.kind === 'node') {
        const n = this.net.nodes[sel.id];
        if (n) this.fly.frame(new THREE.Vector3(n.x, 0, n.z), 60);
      } else if (sel?.kind === 'segment') {
        const seg = this.net.segments[sel.id];
        if (seg) {
          const s = this.samplesOf(seg);
          const mid = sampleAtU(s, 0.5);
          this.fly.frame(new THREE.Vector3(mid.x, 0, mid.z), Math.max(60, s[s.length - 1].s / 2));
        }
      } else this.frameAll();
    }
  }

  /** Intersects the pointer with the ground plane (y = 0). */
  groundAt(clientX: number, clientY: number): V2 | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointerNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(GROUND, hit)) return null;
    return { x: hit.x, z: hit.z };
  }

  // --- tool actions ---------------------------------------------------------------

  private beginSelectDrag(p: V2): void {
    const prop = this.pickProp(p);
    if (prop) {
      this.select({ kind: 'prop', id: prop.id });
      return;
    }
    const node = this.pickNode(p);
    if (node) {
      this.select({ kind: 'node', id: node.id });
      this.drag = { nodeId: node.id, recorded: false };
      return;
    }
    const seg = this.pickSegment(p);
    this.select(seg ? { kind: 'segment', id: seg.id } : null);
  }

  private addDrawPoint(p: V2): void {
    const node = this.pickNode(p);
    const point = node ? { x: node.x, z: node.z } : p;
    const last = this.drawPoints[this.drawPoints.length - 1];
    if (last && dist(last, point) < 1) return;
    this.drawPoints.push(point);
    this.drawNodeIds.push(node ? node.id : null);
    this.state.drawCount = this.drawPoints.length;
    this.overlayDirty = true;
    this.notify();
  }

  private placeProp(p: V2): void {
    const hit = this.pickSegmentForProp(p);
    if (!hit) {
      this.notify('Click closer to a road to place a prop');
      return;
    }
    const kind = this.state.propKind;
    this.mutate(() => {
      const prop = addProp(this.net, hit.seg.id, hit.u, kind, hit.lateral);
      this.state.selection = { kind: 'prop', id: prop.id };
    });
    this.notify(`Placed ${kind}`);
  }

  private deleteAt(p: V2): void {
    const prop = this.pickProp(p);
    if (prop) {
      this.mutate(() => removeProp(this.net, prop.id));
      this.notify('Deleted prop');
      return;
    }
    const node = this.pickNode(p);
    if (node) {
      this.mutate(() => removeNode(this.net, node.id));
      this.notify('Deleted junction');
      return;
    }
    const seg = this.pickSegment(p);
    if (seg) {
      this.mutate(() => removeSegment(this.net, seg.id));
      this.notify('Deleted road');
    }
  }

  // --- picking ----------------------------------------------------------------------

  pickNode(p: V2, radius = SNAP_RADIUS): { id: string; x: number; z: number } | null {
    let best: { id: string; x: number; z: number } | null = null;
    let bestD = radius;
    for (const n of Object.values(this.net.nodes)) {
      const d = Math.hypot(n.x - p.x, n.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = n;
      }
    }
    return best;
  }

  pickProp(p: V2, radius = 3): { id: string } | null {
    let best: { id: string } | null = null;
    let bestD = radius;
    for (const prop of Object.values(this.net.props)) {
      const seg = this.net.segments[prop.segmentId];
      if (!seg) continue;
      const s = sampleAtU(this.samplesOf(seg), prop.u);
      const at = { x: s.x + s.nx * prop.lateral, z: s.z + s.nz * prop.lateral };
      const d = Math.hypot(at.x - p.x, at.z - p.z);
      if (d < bestD) {
        bestD = d;
        best = prop;
      }
    }
    return best;
  }

  pickSegment(p: V2): RoadSegment | null {
    let best: RoadSegment | null = null;
    let bestD = Infinity;
    for (const seg of Object.values(this.net.segments)) {
      const ext = totalExtent(seg.profile);
      const half = Math.max(SNAP_RADIUS, Math.max(Math.abs(ext.lo), Math.abs(ext.hi)) + 1);
      const d = closestOnSamples(this.samplesOf(seg), p).distance;
      if (d < half && d < bestD) {
        bestD = d;
        best = seg;
      }
    }
    return best;
  }

  pickSegmentForProp(p: V2): { seg: RoadSegment; u: number; lateral: number } | null {
    const seg = this.pickSegment(p);
    if (!seg) return null;
    const c = closestOnSamples(this.samplesOf(seg), p);
    return { seg, u: c.u, lateral: c.lateral };
  }

  // --- internal state updates -------------------------------------------------------

  /** Runs a document mutation with undo support. */
  private mutate(fn: () => void): void {
    this.history.record(this.net);
    fn();
    this.touchNetwork();
    this.scheduleSave();
  }

  private touchNetwork(overlay = true): void {
    this.revision++;
    this.netDirty = true;
    if (overlay) this.overlayDirty = true;
  }

  private refreshOverlay(): void {
    const sel = this.state.selection;
    this.overlay.update({
      net: this.net,
      samplesOf: (s) => this.samplesOf(s),
      selection: sel,
      drawPoints: this.drawPoints,
      tool: this.state.tool,
      cursor: this.state.cursor,
      propKind: this.state.propKind,
    });
  }

  private notify(message?: string): void {
    if (message) this.state.message = message;
    this.emit();
  }

  private scheduleSave(): void {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => this.saveNow(), 800);
  }

  saveNow(): void {
    try {
      localStorage.setItem(AUTOSAVE_KEY, serializeNetwork(this.net));
    } catch {
      this.notify('Autosave failed (storage full?)');
    }
  }

  /** Loads the autosave if one exists. Returns false when there is none. */
  restoreAutosave(): boolean {
    const text = localStorage.getItem(AUTOSAVE_KEY);
    if (!text) return false;
    try {
      this.net = parseNetwork(text);
      this.touchNetwork();
      return true;
    } catch {
      return false;
    }
  }
}

export const TOOL_HINTS: Record<ToolId, string> = {
  select: 'Click a road, junction or prop. Drag a junction to move it.',
  draw: 'Click to add points. Double-click or Enter to finish. Esc cancels.',
  props: 'Click on a road to place the selected prop.',
  delete: 'Click a road, junction or prop to delete it.',
};

