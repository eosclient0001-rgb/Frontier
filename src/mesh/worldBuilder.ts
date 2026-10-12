// Assembles the complete world from the authored project: topology, junctions, surfaces, bridges, props,
// terrain and water. Output is one BufferGeometry per material key, so the scene issues few draw calls.

import * as THREE from "three";
import { Rng } from "../core/math";
import { Project } from "../core/model";
import { buildJunctions, JunctionModel } from "../core/junction";
import { buildNetwork, RoadNetwork, BRIDGE_LIFT, networkStats } from "../core/topology";
import { MAP_HALF_EXTENT, terrainGrid, WATER_LEVEL } from "../core/terrain";
import { SpatialGrid } from "../core/spatial";
import { BucketSet, RGB, V3 } from "./MeshBucket";
import { pointOnEdge } from "./frames";
import { buildBridge, BridgeContext, Obstacle } from "./bridgeMesh";
import { buildEdgeProps, buildLevelCrossing, buildPlacedProp, RoadSample } from "./propMesh";
import { buildJunctionSurfaces, buildRailTrack, buildSubwayTube, buildSurface, nodeDegreeMap } from "./roadMesh";
import { COLOUR, shade } from "./palette";

export const MATERIAL_KEYS = ["asphalt", "ground", "paving", "marking", "concrete", "steel", "prop", "lamp", "terrain", "water", "tunnel"] as const;
export type MaterialKey = (typeof MATERIAL_KEYS)[number];

export interface WorldStats {
  roads: number;
  edges: number;
  nodes: number;
  junctions: number;
  deadEnds: number;
  bridgeSpans: number;
  levelCrossings: number;
  gradeCrossings: number;
  lengthKm: number;
  triangles: number;
  buildMs: number;
}

export interface BuiltWorld {
  geometries: Map<MaterialKey, THREE.BufferGeometry>;
  network: RoadNetwork;
  junctions: JunctionModel;
  stats: WorldStats;
  warnings: string[];
}

function nearestSample(grid: SpatialGrid<RoadSample>, x: number, z: number): RoadSample {
  let best: RoadSample | null = null;
  let bestD = Infinity;
  for (const s of grid.queryBox(x - 40, z - 40, x + 40, z + 40)) {
    const d = Math.hypot(s.x - x, s.z - z);
    if (d < bestD) {
      bestD = d;
      best = s;
    }
  }
  return best ?? { x, z, r: 3.5, lift: 0 };
}

function buildTerrain(buckets: BucketSet): void {
  const grid = terrainGrid();
  const bucket = buckets.get("terrain");
  const w = grid.n + 1;
  const cell = grid.cell;
  const index = new Uint32Array(w * w);
  const h = grid.heights;
  const at = (i: number, j: number): number => h[Math.min(grid.n, Math.max(0, j)) * w + Math.min(grid.n, Math.max(0, i))];
  for (let j = 0; j <= grid.n; j++) {
    for (let i = 0; i <= grid.n; i++) {
      const x = grid.origin + i * cell;
      const z = grid.origin + j * cell;
      const y = at(i, j);
      const gx = (at(i + 1, j) - at(i - 1, j)) / (2 * cell);
      const gz = (at(i, j + 1) - at(i, j - 1)) / (2 * cell);
      const slope = Math.hypot(gx, gz);
      const normal: V3 = [-gx, 1, -gz];
      const nl = Math.hypot(normal[0], normal[1], normal[2]);
      let base: RGB;
      if (y < WATER_LEVEL + 1.2) base = COLOUR.terrainRock;
      else if (slope > 0.22) base = COLOUR.terrainRock;
      else base = y < 2.5 ? COLOUR.terrainLow : COLOUR.terrainHigh;
      const c = shade(base, x, z, 0.18, 201);
      index[j * w + i] = bucket.vertex([x, y, z], [normal[0] / nl, normal[1] / nl, normal[2] / nl], c);
    }
  }
  for (let j = 0; j < grid.n; j++) {
    for (let i = 0; i < grid.n; i++) {
      const a = index[j * w + i];
      const b = index[(j + 1) * w + i];
      const c = index[j * w + i + 1];
      const d = index[(j + 1) * w + i + 1];
      bucket.tri(a, b, c);
      bucket.tri(c, b, d);
    }
  }

  // Flat water plane covering the map. Terrain above the level hides it, so only the channel and valleys show.
  const water = buckets.get("water");
  const e = MAP_HALF_EXTENT;
  water.quad([-e, WATER_LEVEL, -e], [-e, WATER_LEVEL, e], [e, WATER_LEVEL, e], [e, WATER_LEVEL, -e], [0, 1, 0], COLOUR.water);
}

export function buildWorld(project: Project): BuiltWorld {
  const started = performance.now();
  const network = buildNetwork(project.roads);
  const junctions = buildJunctions(network);
  const buckets = new BucketSet();
  const ctx = { degree: nodeDegreeMap(network), caps: junctions.caps };

  // Road samples: lift and half width everywhere a road exists. Used by props, piers and manual placement.
  const samples = new SpatialGrid<RoadSample>(30);
  const ground = new SpatialGrid<Obstacle>(30);
  for (const e of network.edges) {
    if (e.underground) continue;
    const r = e.section.width * 0.5;
    const count = Math.max(2, Math.ceil(e.length / 3));
    for (let k = 0; k <= count; k++) {
      const p = pointOnEdge(e, (e.length * k) / count);
      const sample: RoadSample = { x: p.x, z: p.z, r, lift: p.lift };
      samples.insertBox(p.x, p.z, p.x, p.z, sample);
      if (p.lift < BRIDGE_LIFT) ground.insertBox(p.x, p.z, p.x, p.z, { x: p.x, z: p.z, r });
    }
  }

  for (const e of network.edges) {
    buildSurface(e, ctx, buckets);
    if (e.rail) buildRailTrack(e, buckets);
    buildSubwayTube(e, buckets);
  }
  buildJunctionSurfaces(junctions, buckets);

  const bridgeCtx: BridgeContext = { ground };
  for (const e of network.edges) {
    e.bridges.forEach((span, idx) => {
      buildBridge(e, span, bridgeCtx, buckets, new Rng(e.seed).fork(0xb21d + idx));
    });
  }

  for (const e of network.edges) buildEdgeProps(e, buckets, new Rng(e.seed));

  for (const c of network.crossings) {
    if (c.kind !== "level") continue;
    const near = nearestSample(samples, c.x, c.z);
    buildLevelCrossing({ x: c.x, z: c.z, yaw: c.yaw }, near.r, near.lift, buckets);
  }

  for (const p of project.props) {
    const near = nearestSample(samples, p.x, p.z);
    buildPlacedProp(p, near.r, near.lift, buckets);
  }

  buildTerrain(buckets);

  const geometries = new Map<MaterialKey, THREE.BufferGeometry>();
  let triangles = 0;
  for (const [key, bucket] of buckets.entries()) {
    if (!(MATERIAL_KEYS as readonly string[]).includes(key)) continue;
    triangles += bucket.triangleCount;
    geometries.set(key as MaterialKey, bucket.build());
  }
  const stats = networkStats(network);
  return {
    geometries,
    network,
    junctions,
    warnings: network.warnings,
    stats: {
      roads: project.roads.length,
      edges: stats.edges,
      nodes: stats.nodes,
      junctions: stats.junctions,
      deadEnds: stats.deadEnds,
      bridgeSpans: stats.bridgeSpans,
      levelCrossings: stats.levelCrossings,
      gradeCrossings: stats.gradeCrossings,
      lengthKm: stats.lengthKm,
      triangles,
      buildMs: performance.now() - started
    }
  };
}

