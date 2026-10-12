import * as THREE from 'three';
import { SampleCache, segmentBezier } from '../model/network';
import { bezierPoint } from '../model/geometry';
import { MeshBatch } from './batch';
import { armsAtNode, buildJunction, buildProp, buildSegment, isRoadClass } from './roadBuilder';
import type { RoadNetwork, RoadSegment } from '../model/types';

/**
 * Chunked world renderer for large maps.
 *
 * Every road segment, junction and prop is owned by exactly one square chunk
 * (chosen from its midpoint). Each chunk is one merged mesh. On edits, only
 * chunks whose contents changed are rebuilt, and three.js frustum culling works
 * per chunk. This keeps editing responsive on maps many kilometres across.
 */

type EntityKind = 'segment' | 'junction' | 'prop';

interface EntityRecord {
  kind: EntityKind;
  id: string;
  sig: string;
  chunk: string;
}

export interface WorldStats {
  chunks: number;
  triangles: number;
  lastRebuilt: number;
}

export class ChunkedRoadWorld {
  readonly group = new THREE.Group();
  readonly material: THREE.Material;

  private meshes = new Map<string, THREE.Mesh>();
  private records = new Map<string, EntityRecord>();
  private cache = new SampleCache(0.5);
  private lastRebuilt = 0;

  constructor(readonly chunkSize = 400) {
    this.group.name = 'road-world';
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
      side: THREE.DoubleSide,
    });
  }

  chunkKey(x: number, z: number): string {
    return `${Math.floor(x / this.chunkSize)},${Math.floor(z / this.chunkSize)}`;
  }

  /** Samples for a segment (cached). Exposed so the editor can share the same curve. */
  samplesFor(net: RoadNetwork, seg: RoadSegment) {
    return this.cache.get(net, seg);
  }

  /** Brings the rendered meshes in line with the network. Returns the number of chunks rebuilt. */
  sync(net: RoadNetwork): number {
    const incident = new Map<string, RoadSegment[]>();
    for (const seg of Object.values(net.segments)) {
      for (const n of [seg.from, seg.to]) {
        const list = incident.get(n) ?? [];
        list.push(seg);
        incident.set(n, list);
      }
    }

    const next = new Map<string, EntityRecord>();
    const segSig = new Map<string, string>();

    for (const seg of Object.values(net.segments)) {
      const a = net.nodes[seg.from];
      const b = net.nodes[seg.to];
      if (!a || !b) continue;
      const sig = JSON.stringify(seg);
      segSig.set(seg.id, sig);
      const chunk = this.chunkKey((a.x + b.x) / 2, (a.z + b.z) / 2);
      next.set(`s:${seg.id}`, { kind: 'segment', id: seg.id, sig, chunk });
    }

    for (const node of Object.values(net.nodes)) {
      const segs = (incident.get(node.id) ?? []).filter((s) => isRoadClass(s.cls));
      if (!segs.length) continue;
      const sig =
        JSON.stringify(node) +
        segs
          .map((s) => s.id + ':' + (segSig.get(s.id) ?? ''))
          .sort()
          .join('|');
      next.set(`n:${node.id}`, {
        kind: 'junction',
        id: node.id,
        sig,
        chunk: this.chunkKey(node.x, node.z),
      });
    }

    for (const prop of Object.values(net.props)) {
      const seg = net.segments[prop.segmentId];
      if (!seg) continue;
      // Chunk choice only needs an approximate position, so use the Bezier directly
      // instead of sampling the curve for every prop on every sync.
      const at = bezierPoint(segmentBezier(net, seg), prop.u);
      const sig = JSON.stringify(prop) + (segSig.get(seg.id) ?? '');
      next.set(`p:${prop.id}`, {
        kind: 'prop',
        id: prop.id,
        sig,
        chunk: this.chunkKey(at.x, at.z),
      });
    }

    // Diff against the previous state to find chunks that need rebuilding.
    const dirty = new Set<string>();
    for (const [key, rec] of next) {
      const prev = this.records.get(key);
      if (!prev || prev.sig !== rec.sig || prev.chunk !== rec.chunk) {
        dirty.add(rec.chunk);
        if (prev) dirty.add(prev.chunk);
      }
    }
    for (const [key, prev] of this.records) {
      if (!next.has(key)) dirty.add(prev.chunk);
    }
    this.records = next;
    this.cache.prune(net);

    if (dirty.size === 0) {
      this.lastRebuilt = 0;
      return 0;
    }

    // Bucket entities for the dirty chunks only.
    const byChunk = new Map<string, EntityRecord[]>();
    for (const rec of next.values()) {
      if (!dirty.has(rec.chunk)) continue;
      const list = byChunk.get(rec.chunk) ?? [];
      list.push(rec);
      byChunk.set(rec.chunk, list);
    }
    for (const chunk of dirty) this.rebuildChunk(net, chunk, byChunk.get(chunk) ?? []);
    this.lastRebuilt = dirty.size;
    return dirty.size;
  }

  private rebuildChunk(net: RoadNetwork, chunk: string, entities: EntityRecord[]): void {
    const old = this.meshes.get(chunk);
    if (old) {
      this.group.remove(old);
      old.geometry.dispose();
      this.meshes.delete(chunk);
    }
    if (!entities.length) return;

    const batch = new MeshBatch();
    const order: Record<EntityKind, number> = { segment: 0, junction: 1, prop: 2 };
    entities.sort((a, b) => order[a.kind] - order[b.kind]);
    for (const rec of entities) {
      if (rec.kind === 'segment') {
        const seg = net.segments[rec.id];
        if (seg) buildSegment(batch, seg, this.cache.get(net, seg));
      } else if (rec.kind === 'junction') {
        const node = net.nodes[rec.id];
        if (!node) continue;
        const arms = armsAtNode(net, node.id, (s) => this.cache.get(net, s));
        // A junction made only of footpaths needs no asphalt fill.
        if (arms.every((a) => a.seg.cls === 'path')) continue;
        buildJunction(batch, node, arms);
      } else {
        const prop = net.props[rec.id];
        const seg = prop && net.segments[prop.segmentId];
        if (prop && seg) buildProp(batch, prop, seg, this.cache.get(net, seg));
      }
    }
    if (batch.isEmpty()) return;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(batch.positions, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(batch.normals, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(batch.colors, 3));
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.name = `chunk ${chunk}`;
    mesh.userData.triangles = batch.triangleCount;
    this.group.add(mesh);
    this.meshes.set(chunk, mesh);
  }

  stats(): WorldStats {
    let triangles = 0;
    for (const m of this.meshes.values()) triangles += (m.userData.triangles as number) ?? 0;
    return { chunks: this.meshes.size, triangles, lastRebuilt: this.lastRebuilt };
  }

  /** Removes everything and frees GPU memory. */
  dispose(): void {
    for (const m of this.meshes.values()) m.geometry.dispose();
    this.meshes.clear();
    this.records.clear();
    this.group.clear();
    this.material.dispose();
  }
}

