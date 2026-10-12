import * as THREE from 'three';
import { chainHandles, sampleBezier } from '../model/geometry';
import type { Sample } from '../model/geometry';
import { totalExtent } from '../model/profile';
import type { RoadNetwork, V2 } from '../model/types';
import type { Selection, ToolId } from './editor';

/**
 * Editor-only visuals: selection highlight, junction handles, draw preview and
 * the cursor marker. None of this is part of the exported road data.
 */

const HANDLE_Y = 0.25;

export interface OverlayInput {
  net: RoadNetwork;
  samplesOf: (seg: RoadNetwork['segments'][string]) => Sample[];
  selection: Selection;
  drawPoints: V2[];
  tool: ToolId;
  cursor: V2 | null;
  propKind: string;
}

export class Overlay {
  readonly group = new THREE.Group();
  private highlight: THREE.Mesh;
  private highlightEdges: THREE.LineSegments;
  private nodes: THREE.InstancedMesh;
  private drawLine: THREE.Line;
  private drawMarkers: THREE.Group;
  private cursorRing: THREE.Mesh;
  private selectionMarker: THREE.Mesh;
  private readonly nodeGeo = new THREE.SphereGeometry(0.9, 8, 6);
  private readonly nodeMat = new THREE.MeshBasicMaterial({ color: 0x3fa9ff, depthTest: false });
  private readonly markerGeo = new THREE.SphereGeometry(1.2, 8, 6);
  private readonly drawMat = new THREE.LineBasicMaterial({ color: 0xffd23f });
  private readonly markerMat = new THREE.MeshBasicMaterial({ color: 0xffd23f, depthTest: false });
  private readonly highlightMat = new THREE.MeshBasicMaterial({
    color: 0xffd23f,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  private readonly edgeMat = new THREE.LineBasicMaterial({ color: 0xffd23f, depthTest: false });
  private nodeCapacity = 1;
  private readonly tmp = new THREE.Object3D();

  constructor() {
    this.highlight = new THREE.Mesh(new THREE.BufferGeometry(), this.highlightMat);
    this.highlight.renderOrder = 10;
    this.highlightEdges = new THREE.LineSegments(new THREE.BufferGeometry(), this.edgeMat);
    this.highlightEdges.renderOrder = 11;
    this.nodes = new THREE.InstancedMesh(this.nodeGeo, this.nodeMat, 1);
    this.nodes.count = 0;
    this.nodes.renderOrder = 12;
    this.drawLine = new THREE.Line(new THREE.BufferGeometry(), this.drawMat);
    this.drawLine.renderOrder = 12;
    this.drawMarkers = new THREE.Group();
    this.cursorRing = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 2.2, 24),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.85 }),
    );
    this.cursorRing.rotation.x = -Math.PI / 2;
    this.cursorRing.renderOrder = 13;
    this.selectionMarker = new THREE.Mesh(
      new THREE.RingGeometry(3.5, 4.2, 24),
      new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide, depthTest: false }),
    );
    this.selectionMarker.rotation.x = -Math.PI / 2;
    this.selectionMarker.renderOrder = 13;
    this.group.add(this.highlight, this.highlightEdges, this.nodes, this.drawLine, this.drawMarkers, this.cursorRing, this.selectionMarker);
  }

  update(input: OverlayInput): void {
    this.updateNodes(input);
    this.updateHighlight(input);
    this.updateDraw(input);
    this.updateCursor(input);
  }

  private updateNodes(input: OverlayInput): void {
    const nodes = Object.values(input.net.nodes);
    if (nodes.length > this.nodeCapacity) {
      // Grow geometrically so large maps do not reallocate on every new junction.
      const capacity = Math.max(256, nodes.length * 2);
      this.group.remove(this.nodes);
      this.nodes.dispose();
      this.nodes = new THREE.InstancedMesh(this.nodeGeo, this.nodeMat, capacity);
      this.nodes.renderOrder = 12;
      this.nodeCapacity = capacity;
      this.group.add(this.nodes);
    }
    // Junction markers are only useful while editing the road network.
    const visible = input.tool === 'select' || input.tool === 'draw' || input.tool === 'delete';
    this.nodes.visible = visible;
    this.nodes.count = visible ? nodes.length : 0;
    nodes.forEach((n, i) => {
      this.tmp.position.set(n.x, HANDLE_Y, n.z);
      this.tmp.scale.setScalar(1);
      this.tmp.updateMatrix();
      this.nodes.setMatrixAt(i, this.tmp.matrix);
    });
    this.nodes.instanceMatrix.needsUpdate = true;
  }

  private updateHighlight(input: OverlayInput): void {
    const sel = input.selection;
    this.highlight.visible = false;
    this.highlightEdges.visible = false;
    this.selectionMarker.visible = false;
    if (!sel) return;

    if (sel.kind === 'segment') {
      const seg = input.net.segments[sel.id];
      if (!seg) return;
      const samples = input.samplesOf(seg);
      const ext = totalExtent(seg.profile);
      const positions: number[] = [];
      const edges: number[] = [];
      const edgeOffsets = [ext.lo, ext.hi];
      for (let i = 0; i < samples.length - 1; i++) {
        const a = samples[i];
        const b = samples[i + 1];
        const pa = (s: Sample, off: number): [number, number, number] => [s.x + s.nx * off, HANDLE_Y, s.z + s.nz * off];
        const quad = [pa(a, ext.lo), pa(a, ext.hi), pa(b, ext.hi), pa(b, ext.lo)];
        for (const idx of [0, 1, 2, 0, 2, 3]) positions.push(...quad[idx]);
      }
      for (const off of edgeOffsets) {
        for (let i = 0; i < samples.length - 1; i++) {
          const a = samples[i];
          const b = samples[i + 1];
          edges.push(a.x + a.nx * off, HANDLE_Y, a.z + a.nz * off, b.x + b.nx * off, HANDLE_Y, b.z + b.nz * off);
        }
      }
      setPositions(this.highlight, positions);
      setPositions(this.highlightEdges, edges);
      this.highlight.visible = true;
      this.highlightEdges.visible = true;
    } else if (sel.kind === 'node' || sel.kind === 'prop') {
      let x: number | null = null;
      let z: number | null = null;
      if (sel.kind === 'node') {
        const n = input.net.nodes[sel.id];
        if (n) {
          x = n.x;
          z = n.z;
        }
      } else {
        const prop = input.net.props[sel.id];
        const seg = prop && input.net.segments[prop.segmentId];
        if (prop && seg) {
          const samples = input.samplesOf(seg);
          const i = Math.round(prop.u * (samples.length - 1));
          const s = samples[Math.max(0, Math.min(samples.length - 1, i))];
          x = s.x + s.nx * prop.lateral;
          z = s.z + s.nz * prop.lateral;
        }
      }
      if (x !== null && z !== null) {
        this.selectionMarker.position.set(x, 0.3, z);
        this.selectionMarker.visible = true;
      }
    }
  }

  private updateDraw(input: OverlayInput): void {
    const pts = input.drawPoints;
    this.drawLine.visible = pts.length > 0;
    this.drawMarkers.clear();
    if (!pts.length) return;
    const positions: number[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const h = chainHandles(pts, i);
      const curve = sampleBezier({ p0: pts[i], c1: h.c1, c2: h.c2, p3: pts[i + 1] }, 1);
      for (const s of curve) positions.push(s.x, HANDLE_Y + 0.2, s.z);
    }
    setPositions(this.drawLine, positions);
    for (const p of pts) {
      const m = new THREE.Mesh(this.markerGeo, this.markerMat);
      m.position.set(p.x, HANDLE_Y + 0.2, p.z);
      this.drawMarkers.add(m);
    }
  }

  private updateCursor(input: OverlayInput): void {
    const show = input.cursor && (input.tool === 'draw' || input.tool === 'props' || input.tool === 'delete');
    this.cursorRing.visible = Boolean(show);
    if (show && input.cursor) this.cursorRing.position.set(input.cursor.x, 0.35, input.cursor.z);
  }

  dispose(): void {
    this.highlight.geometry.dispose();
    this.highlightEdges.geometry.dispose();
    this.drawLine.geometry.dispose();
    this.nodes.dispose();
    this.nodeGeo.dispose();
    this.nodeMat.dispose();
    this.markerGeo.dispose();
    this.markerMat.dispose();
    this.drawMat.dispose();
    this.highlightMat.dispose();
    this.edgeMat.dispose();
    this.drawMarkers.clear();
    this.group.clear();
  }
}

function setPositions(obj: THREE.Mesh | THREE.LineSegments | THREE.Line, positions: number[]): void {
  const geo = obj.geometry as THREE.BufferGeometry;
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeBoundingSphere();
}
