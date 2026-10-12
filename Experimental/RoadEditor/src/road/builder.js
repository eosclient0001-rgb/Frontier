// Orchestrates junction solving and element mesh building, with incremental rebuilds.
import { SpatialIndex } from './network.js';
import { computeJunction } from './junction.js';
import { buildEdge } from './geom/edge.js';
import { buildJunction } from './geom/junctionMesh.js';
import { buildRailEdge } from './geom/rail.js';
import { buildSubway } from './geom/subway.js';
import { buildRiver } from './geom/water.js';
import { Out } from './geom/out.js';
import { getProfile, layout } from './profiles.js';
import { pointSegDist } from './math.js';

export class NetworkBuilder {
  constructor(net, options = {}) {
    this.net = net;
    this.options = { markings: true, props: true, trees: true, ...options };
    this.index = new SpatialIndex(net);
    this.junctions = new Map();
    this.outs = new Map();
    this.setupWater();
  }

  setupWater() {
    const r = this.net.river;
    this.riverGrid = null;
    if (!r) return;
    const cell = 60, grid = new Map();
    for (let i = 0; i < r.pts.length - 1; i++) {
      const a = r.pts[i], b = r.pts[i + 1];
      const x0 = Math.floor((Math.min(a[0], b[0]) - r.width) / cell), x1 = Math.floor((Math.max(a[0], b[0]) + r.width) / cell);
      const z0 = Math.floor((Math.min(a[1], b[1]) - r.width) / cell), z1 = Math.floor((Math.max(a[1], b[1]) + r.width) / cell);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const k = x + ',' + z; if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); }
    }
    this.riverGrid = { cell, grid };
  }
  riverDist(x, z) {
    if (!this.riverGrid) return Infinity;
    const { cell, grid } = this.riverGrid, r = this.net.river;
    const segs = grid.get(Math.floor(x / cell) + ',' + Math.floor(z / cell));
    if (!segs) return Infinity;
    let best = Infinity;
    for (const i of segs) { const a = r.pts[i], b = r.pts[i + 1]; const d = pointSegDist(x, z, a[0], a[1], b[0], b[1])[0]; if (d < best) best = d; }
    return best;
  }

  ctx() {
    const net = this.net, self = this;
    return {
      ...this.options,
      waterAt: (x, z) => self.riverDist(x, z) < (net.river ? net.river.width / 2 + 0.5 : 0),
      groundAt: () => -0.06,
      pierBlocked: (x, z, r, deckY, selfId) => {
        for (const e of self.index.query(x, z, r + 30)) {
          if (e.id === selfId) continue;
          const c = net.centerline(e), q = c.nearest(x, z);
          const half = layout(getProfile(e)).total / 2;
          if (q.d < half + r) { const f = c.frameAt(q.s); if (f.y < deckY - 2) return true; }
        }
        for (const J of self.junctions.values()) {
          if (!J.polygon || Math.abs(J.node.x - x) > 80 || Math.abs(J.node.z - z) > 80) continue;
          const rad = Math.max(...J.ends.map(e => Math.hypot(e.setback, Math.max(e.wl, e.wr) + Math.max(e.sl, e.sr)))) + r;
          if (Math.hypot(J.node.x - x, J.node.z - z) < rad && J.node.y < deckY - 2) return true;
        }
        return false;
      },
      roadAt: (x, z, r) => {
        const hit = self.index.nearestEdge(x, z, r);
        return hit && hit.d < r;
      },
    };
  }

  // Road segments and railway edges share the same junction solver; railways use their own builder.
  buildOne(e, ctx) {
    const net = this.net;
    if (net.isRail(e)) return buildRailEdge(net, e, this.junctions.get(e.a), this.junctions.get(e.b), ctx, this.index);
    return buildEdge(net, e, this.junctions.get(e.a), this.junctions.get(e.b), ctx);
  }

  // Full build. onProgress(fraction, label); yields to the event loop between batches.
  async buildAll(onProgress = () => {}) {
    const net = this.net;
    this.index.rebuild();
    this.junctions.clear(); this.outs.clear();
    const ctx = this.ctx();
    const nodes = [...net.nodes.keys()], edges = [...net.edges.values()];
    const total = nodes.length * 2 + edges.length + net.subways.size + 2;
    let done = 0;
    const tick = async (label) => { if (done % 150 === 0) { onProgress(done / total, label); await new Promise(r => setTimeout(r, 0)); } };
    for (const id of nodes) { this.junctions.set(id, computeJunction(net, id)); done++; await tick('Solving junctions'); }
    for (const e of edges) {
      try { this.outs.set(e.id, this.buildOne(e, ctx)); }
      catch (err) { console.warn('edge build failed', e.id, err); this.outs.set(e.id, new Out(e.id)); }
      done++; await tick(net.isRail(e) ? 'Laying railways' : 'Building road segments');
    }
    for (const id of nodes) {
      try { this.outs.set(id, buildJunction(net, this.junctions.get(id), ctx)); }
      catch (err) { console.warn('junction build failed', id, err); }
      done++; await tick('Building junctions');
    }
    for (const s of net.subways.values()) { this.outs.set(s.id, buildSubway(net, s, this.index, ctx)); done++; await tick('Boring subway'); }
    if (net.river) this.outs.set('river', buildRiver(net.river, ctx));
    if (net.trees?.length) this.outs.set('veg', this.buildVegetation());
    onProgress(1, 'Done');
    return [...this.outs.keys()];
  }

  buildVegetation() {
    const out = new Out('veg');
    for (const [x, z, s, k] of this.net.trees) out.prop(k ? 'treeB' : 'treeA', x, 0, z, (x * 13.1 + z * 7.7) % 6.28, s, s, s);
    return out;
  }

  // Incremental rebuild after edits. Returns {updated:[ids], removed:[ids]}.
  rebuild(changedNodes = [], changedEdges = []) {
    const net = this.net;
    const nodes = new Set(changedNodes.filter(id => net.nodes.has(id)));
    const removed = [];
    const vacated = [];   // footprints of removed road pieces: railways crossing them must be re-laid
    for (const id of changedNodes) if (!net.nodes.has(id)) { removed.push(id); this.junctions.delete(id); this.outs.delete(id); }
    for (const id of changedEdges) {
      const e = net.edges.get(id);
      if (!e) {
        removed.push(id);
        const o = this.outs.get(id); if (o && o.min[0] !== Infinity) vacated.push(o);
        this.outs.delete(id); this.index.removeEdge(id); continue;
      }
      nodes.add(e.a); nodes.add(e.b);
    }
    // first ring: edges touching affected nodes
    const edges = new Set(changedEdges.filter(id => net.edges.has(id)));
    for (const n of nodes) for (const e of net.nodeEdges(n)) edges.add(e.id);
    // second ring: far nodes of those edges and their edges (tangents/setbacks may change)
    const nodes2 = new Set(nodes);
    for (const id of edges) { const e = net.edges.get(id); nodes2.add(e.a); nodes2.add(e.b); }
    const edges2 = new Set(edges);
    for (const n of nodes2) for (const e of net.nodeEdges(n)) edges2.add(e.id);
    net.invalidate(edges2);
    for (const id of edges2) { this.index.removeEdge(id); this.index.insertEdge(net.edges.get(id)); }
    const ctx = this.ctx();
    for (const n of nodes2) this.junctions.set(n, computeJunction(net, n));
    const updated = [];
    for (const id of edges2) {
      const e = net.edges.get(id);
      try { this.outs.set(id, this.buildOne(e, ctx)); } catch (err) { console.warn(err); this.outs.set(id, new Out(id)); }
      updated.push(id);
    }
    for (const n of nodes2) { try { this.outs.set(n, buildJunction(net, this.junctions.get(n), ctx)); updated.push(n); } catch (err) { console.warn(err); } }
    // railways whose crossings may have changed: any railway passing through a rebuilt or vacated road footprint
    const boxes = vacated.concat([...edges2].filter(id => !net.isRail(net.edges.get(id)))
      .map(id => this.outs.get(id)).filter(o => o && o.min[0] !== Infinity));
    if (boxes.length) {
      for (const e of net.edges.values()) {
        if (!net.isRail(e) || edges2.has(e.id)) continue;
        const c = net.centerline(e);
        const hit = i => boxes.some(o => c.X[i] > o.min[0] - 10 && c.X[i] < o.max[0] + 10 && c.Z[i] > o.min[2] - 10 && c.Z[i] < o.max[2] + 10);
        let touch = false;
        for (let i = 0; i < c.X.length && !touch; i += 8) touch = hit(i);
        if (touch) { this.outs.set(e.id, this.buildOne(e, ctx)); updated.push(e.id); }
      }
    }
    return { updated, removed };
  }

  setOption(k, v) { this.options[k] = v; }
}
