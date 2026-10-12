// Frontier Road Editor — road network graph (nodes + spline edges) with undo
import * as THREE from 'three';
import { uid, clamp } from './util.js';

export class Network {
  constructor() {
    this.nodes = new Map(); // id → {id,x,z,elev}
    this.edges = new Map(); // id → {id,a,b,profile,kind:'road'|'rail',pts:[{x,z,e}],opts:{}}
    this.props = [];         // {id,type,x,z,rot,extra}
    this.revision = 0;
  }

  bump() { this.revision++; }

  addNode(x, z, elev = 0) {
    const n = { id: uid('n'), x, z, elev };
    this.nodes.set(n.id, n); this.bump();
    return n;
  }
  addEdge(aId, bId, profile, kind = 'road', opts = {}) {
    if (aId === bId) return null;
    // avoid duplicates
    for (const e of this.edges.values()) {
      if ((e.a === aId && e.b === bId) || (e.a === bId && e.b === aId)) return null;
    }
    const e = { id: uid('e'), a: aId, b: bId, profile, kind, pts: [], opts };
    this.edges.set(e.id, e); this.bump();
    return e;
  }
  addProp(type, x, z, rot = 0, extra = {}) {
    const p = { id: uid('p'), type, x, z, rot, ...extra };
    this.props.push(p); this.bump();
    return p;
  }

  removeEdge(id) { this.edges.delete(id); this.bump(); }
  removeProp(id) { this.props = this.props.filter(p => p.id !== id); this.bump(); }
  removeNode(id) {
    for (const e of [...this.edges.values()]) if (e.a === id || e.b === id) this.edges.delete(e.id);
    this.nodes.delete(id); this.bump();
  }

  degree(nodeId) {
    let d = 0;
    for (const e of this.edges.values()) if (e.a === nodeId || e.b === nodeId) d++;
    return d;
  }
  edgesAt(nodeId) {
    const out = [];
    for (const e of this.edges.values()) if (e.a === nodeId || e.b === nodeId) out.push(e);
    return out;
  }

  nearestNode(x, z, maxDist) {
    let best = null, bd = maxDist * maxDist;
    for (const n of this.nodes.values()) {
      const d = (n.x - x) ** 2 + (n.z - z) ** 2;
      if (d < bd) { bd = d; best = n; }
    }
    return best;
  }

  // ── spline sampling ──────────────────────────────────────────────────
  // Returns array of samples {x,z,y} (y = elevation incl. bridge arch), arc-length spaced.
  sampleEdge(edge, step = 2.5) {
    const A = this.nodes.get(edge.a), B = this.nodes.get(edge.b);
    if (!A || !B) return [];
    const cps = [A, ...edge.pts, B].map(p => new THREE.Vector3(p.x, p.e ?? p.elev ?? 0, p.z));
    if (cps.length === 2 && cps[0].distanceTo(cps[1]) < 1e-4) return [];
    const curve = new THREE.CatmullRomCurve3(cps, false, 'centripetal', 0.5);
    const len = curve.getLength();
    const n = Math.max(2, Math.ceil(len / step));
    const out = [];
    const archH = edge.opts.archHeight || 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const p = curve.getPointAt(clamp(t, 0, 1));
      let y = p.y;
      if (archH > 0.01) { const s = Math.sin(Math.PI * t); y += archH * s * s; }
      out.push({ x: p.x, z: p.z, y, t });
    }
    out.length_ = len;
    return out;
  }

  // Split an edge at parameter t (0..1): inserts node, returns new node.
  splitEdge(edgeId, t) {
    const e = this.edges.get(edgeId);
    if (!e) return null;
    const s = this.sampleEdge(e, 1.5);
    if (!s.length) return null;
    const idx = clamp(Math.round(t * (s.length - 1)), 1, s.length - 2);
    const p = s[idx];
    const n = this.addNode(p.x, p.z, p.y);
    // distribute intermediate pts
    const before = e.pts.filter(q => s.indexOf(p) === -1 && true); // recomputed below
    // rebuild via curve parameters: pts before idx proportion
    const fracPts = e.pts.map((q, i) => ({ q, t: (i + 1) / (e.pts.length + 1) }));
    const e1 = this.addEdge(e.a, n.id, e.profile, e.kind, { ...e.opts });
    const e2 = this.addEdge(n.id, e.b, e.profile, e.kind, { ...e.opts });
    if (e1) e1.pts = fracPts.filter(f => f.t < t).map(f => ({ ...f.q }));
    if (e2) e2.pts = fracPts.filter(f => f.t >= t).map(f => ({ ...f.q }));
    void before;
    this.edges.delete(e.id);
    this.bump();
    return n;
  }

  toJSON() {
    return {
      nodes: [...this.nodes.values()],
      edges: [...this.edges.values()].map(e => ({ ...e })),
      props: this.props.map(p => ({ ...p })),
    };
  }
  static fromJSON(j) {
    const n = new Network();
    for (const nd of j.nodes) n.nodes.set(nd.id, { ...nd });
    for (const e of j.edges) n.edges.set(e.id, { ...e, pts: e.pts.map(p => ({ ...p })), opts: { ...e.opts } });
    n.props = j.props.map(p => ({ ...p }));
    return n;
  }
}

// Small undo stack over network snapshots
export class UndoStack {
  constructor(limit = 60) { this.limit = limit; this.stack = []; }
  push(net) {
    this.stack.push(JSON.stringify(net.toJSON()));
    if (this.stack.length > this.limit) this.stack.shift();
  }
  pop(current) {
    const snap = this.stack.pop();
    if (!snap) return current;
    return Network.fromJSON(JSON.parse(snap));
  }
  get canUndo() { return this.stack.length > 0; }
}
