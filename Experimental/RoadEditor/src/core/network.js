// The road network — model, spline sampling, junction geometry and movement matrices.
//
// Model shape (one project):
//   project.roads[]    : polyline centre lines with a cross-section profile, class, structure and detail flags
//   project.nodes[]    : junctions and terminals; each node owns the arms connected to it
//   project.rail[]     : rail / tram alignment, used for level crossings and grade separation
//   project.districts[]: named areas the generator produced (used for grouping and for the map)
//
// Two rules keep the network honest and are relied on everywhere else:
//   1. An arm always terminates *at* a node, and the node's position is authoritative. Roads never
//      overlap a junction: their sampled centre line stops at the node's reach, so ribbons cannot
//      interpenetrate.
//   2. Height is per-point, not per-road. A bridge, a tunnel and a dip are the same mechanism, which
//      is what makes grade separation, ramps and overpasses fall out for free.

import { ROAD_CLASSES } from './standards.js';
import { CLASS_RANK as RANK_OF } from './rank.js';
import { PROFILE_LIBRARY, profileById, profileExtents, profileOffsets, profileWidth } from './profiles.js';

/* ── Small vector helpers ────────────────────────────────────────────────────────────────────────── */

export const V = {
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  len2: (a) => Math.hypot(a[0], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  // 2-component (x, z) pair, matching dot2/angle: every caller passes [dx, dz].
  norm2: (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; },
  dot2: (a, b) => a[0] * b[0] + a[1] * b[1],
  angle: (a, b) => Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]),
};

/** An approach wider than six lanes is a motorway cross-section problem, not a junction one. */
export const LANE_LIMIT = 6;

let idSeq = 0;
export const nextId = (prefix) => `${prefix}${(idSeq += 1).toString(36)}`;
export const resetIds = () => { idSeq = 0; };

/* ── Splines ─────────────────────────────────────────────────────────────────────────────────────── */

function catmull(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    out[i] = 0.5 * ((2 * p1[i]) + (-p0[i] + p2[i]) * t + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2 + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3);
  }
  return out;
}

/**
 * Resample a road's control points into frames of roughly `step` metres.
 * `t` runs 0..1 over the whole road, `s` is cumulative arc length, and `n` is the lateral unit vector
 * in the XZ plane. Elevation is interpolated with the same spline, so grades are continuous by
 * construction and a validator can only complain about the control points the generator chose.
 */
export function sampleRoad(road, step = 4) {
  const pts = road.points;
  if (pts.length < 2) return [];
  const frames = [];
  let s = 0;
  const push = (p, t, prev) => {
    const pos = [p[0], p[1], p[2]];
    if (prev) s += V.len(V.sub(pos, prev));
    frames.push({ p: pos, t, s, n: [1, 0], tangent: [0, 0, 1] });
  };
  push(pts[0], 0, null);
  const segs = pts.length - 1;
  for (let i = 0; i < segs; i += 1) {
    const p0 = pts[Math.max(i - 1, 0)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(i + 2, pts.length - 1)];
    const chord = Math.hypot(p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]);
    const n = Math.max(1, Math.round(chord / step));
    for (let k = 1; k <= n; k += 1) {
      const u = k / n;
      push(catmull(p0, p1, p2, p3, u), (i + u) / segs, frames[frames.length - 1].p);
    }
  }
  // Lateral vector per frame, from the local tangent.
  for (let i = 0; i < frames.length; i += 1) {
    const a = frames[Math.max(i - 1, 0)].p;
    const b = frames[Math.min(i + 1, frames.length - 1)].p;
    const d = V.norm2([b[0] - a[0], b[2] - a[2]]);
    frames[i].tangent = [d[0], 0, d[1]];
    frames[i].n = [-d[1], 0, d[0]];
  }
  return frames;
}

export function roadLength(road, frames) {
  const f = frames || sampleRoad(road, 6);
  return f.length ? f[f.length - 1].s : 0;
}

/** Point + lateral vector at a distance along the road. Used for props, markings and ride mode. */
export function frameAt(road, s, frames) {
  const f = frames || sampleRoad(road, 4);
  if (!f.length) return null;
  let lo = 0;
  let hi = f.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (f[mid].s <= s) lo = mid; else hi = mid;
  }
  const a = f[lo];
  const b = f[Math.min(lo + 1, f.length - 1)];
  const span = Math.max(b.s - a.s, 1e-6);
  const u = Math.min(Math.max((s - a.s) / span, 0), 1);
  const mix = (x, y) => x + (y - x) * u;
  return {
    p: [mix(a.p[0], b.p[0]), mix(a.p[1], b.p[1]), mix(a.p[2], b.p[2])],
    n: [mix(a.n[0], b.n[0]), 0, mix(a.n[2], b.n[2])],
    tangent: V.norm3 ? V.norm3(a.tangent, b.tangent, u) : null,
    t: mix(a.t, b.t),
  };
}

/* ── Profile access with per-road overrides ──────────────────────────────────────────────────────── */

export function roadProfile(project, road) {
  if (road.profile) return road.profile;
  return project.profiles.find((p) => p.id === road.profileId) || profileById(road.profileId);
}

export function roadProfileAt(project, road, t) {
  // Transitions: a road may carry a list of profile changes along its length.
  const tr = road.transitions;
  if (!tr || !tr.length) return roadProfile(project, road);
  let pick = tr[0];
  for (const x of tr) if (t >= x.t) pick = x;
  return project.profiles.find((p) => p.id === pick.profileId) || roadProfile(project, road);
}

/** Half-width of the carriageway envelope (kerb line to kerb line), class-aware. */
export function roadHalfWidth(project, road) {
  const p = roadProfile(project, road);
  const e = profileExtents(p);
  return e.width / 2;
}

export function roadWidth(project, road) {
  return profileWidth(roadProfile(project, road));
}

/* ── Junctions ───────────────────────────────────────────────────────────────────────────────────── */

/**
 * Corner point where two arms' kerb lines meet, i.e. the junction's return corner.
 * Returns null when the arms are too nearly parallel or too nearly opposite to define one.
 */
function cornerOf(armA, armB) {
  const a = armA.dir; // unit XZ direction pointing OUT along the arm
  const b = armB.dir;
  const cross = a[0] * b[1] - a[1] * b[0];
  if (Math.abs(cross) < 0.2) return null;
  // Outer edge of arm A facing arm B.
  const side = Math.sign(cross) > 0 ? [-a[1], a[0]] : [a[1], -a[0]];
  const pa = [side[0] * armA.halfWidth, side[1] * armA.halfWidth];
  const sideB = Math.sign(cross) > 0 ? [b[1], -b[0]] : [-b[1], b[0]];
  const pb = [sideB[0] * armB.halfWidth, sideB[1] * armB.halfWidth];
  // Intersect line (pa, a) with (pb, b).
  const denom = a[0] * b[1] - a[1] * b[0];
  if (Math.abs(denom) < 1e-6) return null;
  const t = ((pb[0] - pa[0]) * b[1] - (pb[1] - pa[1]) * b[0]) / denom;
  const x = pa[0] + a[0] * t;
  const z = pa[1] + a[1] * t;
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  if (Math.hypot(x, z) > 60) return null;
  return [x, z];
}

function hull(points) {
  if (points.length < 3) return points;
  const pts = points.slice().sort((p, q) => (p[0] - q[0]) || (p[1] - q[1]));
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i -= 1) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

/** Round a polygon's corners — the junction's kerb returns, in plan. */
export function roundPolygon(pts, radius = 4, perCorner = 6) {
  if (pts.length < 3) return pts;
  const out = [];
  const n = pts.length;
  for (let i = 0; i < n; i += 1) {
    const prev = pts[(i - 1 + n) % n];
    const cur = pts[i];
    const next = pts[(i + 1) % n];
    const d1 = V.norm2([cur[0] - prev[0], cur[1] - prev[1]]);
    const d2 = V.norm2([next[0] - cur[0], next[1] - cur[1]]);
    const l1 = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    const l2 = Math.hypot(next[0] - cur[0], next[1] - cur[1]);
    const r = Math.min(radius, l1 * 0.45, l2 * 0.45);
    if (r < 0.3) { out.push(cur); continue; }
    const a = [cur[0] - d1[0] * r, cur[1] - d1[1] * r];
    const b = [cur[0] + d2[0] * r, cur[1] + d2[1] * r];
    for (let k = 0; k <= perCorner; k += 1) {
      const u = k / perCorner;
      const iu = 1 - u;
      out.push([
        iu * iu * a[0] + 2 * iu * u * cur[0] + u * u * b[0],
        iu * iu * a[1] + 2 * iu * u * cur[1] + u * u * b[1],
      ]);
    }
  }
  return out;
}

export function armOf(project, node, entry) {
  const road = project.roads.find((r) => r.id === entry.roadId);
  if (!road) return null;
  const fromStart = entry.end === 0;
  const p0 = fromStart ? road.points[0] : road.points[road.points.length - 1];
  const p1 = fromStart ? road.points[1] : road.points[road.points.length - 2];
  const dir = V.norm2([p0[0] - p1[0], p0[2] - p1[2]]);
  const prof = roadProfile(project, road);
  return {
    roadId: road.id,
    end: entry.end,
    dir,
    angle: Math.atan2(dir[1], dir[0]),
    halfWidth: profileExtents(prof).width / 2,
    profile: prof,
    road,
    cls: ROAD_CLASSES[road.class] || ROAD_CLASSES.local,
  };
}

/** Junction plan polygon: hull of the arm kerb-line return corners, rounded. */
export function junctionPlan(project, node, cornerRadius = 6) {
  const arms = node.arms.map((a) => armOf(project, node, a)).filter(Boolean);
  if (arms.length < 2) return { poly: [], arms, radius: 0 };
  const sorted = arms.slice().sort((a, b) => a.angle - b.angle);
  const corners = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i];
    const b = sorted[(i + 1) % sorted.length];
    const c = cornerOf(a, b);
    if (c) corners.push(c);
  }
  for (const arm of sorted) {
    corners.push([arm.dir[0] * 0.4, arm.dir[1] * 0.4]);
    corners.push([arm.dir[0] * 0.4 + arm.dir[1] * arm.halfWidth, arm.dir[1] * 0.4 - arm.dir[0] * arm.halfWidth]);
    corners.push([arm.dir[0] * 0.4 - arm.dir[1] * arm.halfWidth, arm.dir[1] * 0.4 + arm.dir[0] * arm.halfWidth]);
  }
  const h = hull(corners);
  const radius = Math.max(...arms.map((a) => a.halfWidth));
  const rounded = roundPolygon(h, Math.max(cornerRadius, radius * 0.9), 5);
  const reach = Math.max(...rounded.map((p) => Math.hypot(p[0], p[1])), 0);
  return { poly: rounded, arms: sorted, radius: reach };
}

/** Where an arm's ribbon must stop, so it meets the junction rather than covering it. */
export function armReach(project, node, roadId) {
  const plan = junctionPlan(project, node);
  const arm = plan.arms.find((a) => a.roadId === roadId);
  if (!arm) return 0;
  // Distance from the node centre to where the junction's rounded outline crosses this arm's axis.
  let reach = 0;
  for (let i = 0; i < plan.poly.length; i += 1) {
    const a = plan.poly[i];
    const b = plan.poly[(i + 1) % plan.poly.length];
    const d = [b[0] - a[0], b[1] - a[1]];
    const denom = arm.dir[0] * d[1] - arm.dir[1] * d[0];
    if (Math.abs(denom) < 1e-6) continue;
    const t = (a[0] * d[1] - a[1] * d[0]) / denom;
    if (t > reach) reach = t;
  }
  return Math.min(reach, 40);
}

/* ── Movement matrices (lane continuity) ─────────────────────────────────────────────────────────── */

/**
 * Default movement matrix for a junction: every incoming lane gets the exits its approach geometry
 * allows, and lane-to-lane assignment keeps both sides of the carriageway.
 * This is what the junction panel draws and what the validator reads for lane continuity.
 */
export function buildMoves(project, node) {
  const plan = junctionPlan(project, node);
  const arms = plan.arms;
  if (arms.length < 2 || node.type === 'grade-separated') return [];
  const moves = [];
  arms.forEach((inn, i) => {
    const inbound = inn.profile.right.concat(inn.profile.left).filter((s) => s.type === 'traffic' || s.type === 'bus');
    const inLanes = Math.max(1, Math.min(inbound.length, LANE_LIMIT));
    const candidates = [];
    // `arm.dir` points out of the junction along the arm, so an arriving vehicle travels along the
    // reverse of its own arm: the turn angle is measured from -inn.dir to the outgoing arm.
    const heading = [-inn.dir[0], -inn.dir[1]];
    arms.forEach((out, j) => {
      if (i === j) return;
      const rel = V.angle(heading, out.dir); // 0 = straight on, ±180° = a U-turn
      const deg = (rel * 180) / Math.PI;
      const mag = Math.abs(deg);
      if (mag > 150) return; // a U-turn is a separate, deliberate movement
      const kind = mag < 35 ? 'through' : (deg > 0 ? 'left' : 'right');
      const outbound = out.profile.right.concat(out.profile.left).filter((s) => s.type === 'traffic' || s.type === 'bus');
      candidates.push({ kind, to: j, lanes: Math.max(1, Math.min(outbound.length, LANE_LIMIT)), deg });
    });
    if (!candidates.length) return;
    const priority = { through: 0, right: 1, left: 2 };
    candidates.sort((a, b) => priority[a.kind] - priority[b.kind]);
    for (let lane = 0; lane < inLanes; lane += 1) {
      const want = candidates.length > 1 && inLanes > 1 && lane < candidates.length ? candidates[lane] : candidates[0];
      const extra = inLanes > candidates.length && lane >= candidates.length ? candidates[candidates.length - 1] : null;
      const pick = extra || want;
      moves.push({
        from: i, to: pick.to, fromLane: lane, toLane: Math.min(lane, pick.lanes - 1),
        kind: pick.kind, permitted: true, conflict: false,
      });
    }
  });
  return moves;
}

/* ── Network statistics (the numbers the rail prints) ────────────────────────────────────────────── */

export function networkStats(project) {
  let metres = 0;
  const byClass = {};
  for (const road of project.roads) {
    const len = roadLength(road);
    metres += len;
    const k = road.class;
    byClass[k] = byClass[k] || { count: 0, metres: 0 };
    byClass[k].count += 1;
    byClass[k].metres += len;
  }
  const junctions = project.nodes.filter((n) => n.arms.length >= 3).length;
  const terminals = project.nodes.filter((n) => n.arms.length === 1).length;
  return {
    roads: project.roads.length,
    metres,
    km: metres / 1000,
    byClass,
    nodes: project.nodes.length,
    junctions,
    terminals,
    districts: project.districts.length,
    railMetres: project.rail.reduce((a, r) => a + polyLength(r.points), 0),
    lanes: project.roads.reduce((a, r) => a + (r.laneCount || 0), 0),
  };
}

export function polyLength(pts) {
  let s = 0;
  for (let i = 1; i < pts.length; i += 1) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][2] - pts[i - 1][2]);
  return s;
}

/** Every arm end that has no node — the invalid state lane continuity checks against. */
export function orphanEnds(project) {
  const seen = new Set();
  for (const node of project.nodes) {
    for (const arm of node.arms) seen.add(`${arm.roadId}:${arm.end}`);
  }
  const orphans = [];
  for (const road of project.roads) {
    for (const end of [0, 1]) {
      if (!seen.has(`${road.id}:${end}`)) orphans.push({ road, end });
    }
  }
  return orphans;
}

export function makeRoad({ class: cls = 'local', profileId = 'residential-street-2-way', points, name, district, ...rest }) {
  const road = {
    id: nextId('r'),
    name: name || `${(ROAD_CLASSES[cls] || ROAD_CLASSES.local).name} ${nextId('')}`,
    class: cls,
    profileId,
    points: points.map((p) => [p[0], p[1] ?? 0, p[2]]),
    oneway: (ROAD_CLASSES[cls] || {}).lanes ? false : false,
    structure: { kind: 'ground' },
    details: {},
    district: district || null,
    rev: 1,
    ...rest,
  };
  road.laneCount = profileOffsets(profileById(road.profileId)).filter((o) => o.strip.type === 'traffic' || o.strip.type === 'bus').length;
  return road;
}

export function makeNode({ x, z, y = 0, type = 'crossroads', control, arms = [] }) {
  return {
    id: nextId('n'),
    x, z, y,
    type,
    control: control || (type === 'roundabout' ? 'yield' : 'free choice'),
    arms,
    radius: 6,
  };
}

export const defaultProject = (roads, nodes, rail, districts, settings) => ({
  schema: 'frontier.roadway/0.1',
  settings,
  profiles: PROFILE_LIBRARY,
  roads,
  nodes,
  rail: rail || [],
  districts: districts || [],
});

/* ── Cleanup operations ─────────────────────────────────────────────────────────────────────────── */
//
// These are editor commands first and generator passes second: the "connect dead ends" the tool rail
// offers is what the city generator runs, so generated output is never a special case, and a human's
// hand-drawn stub is repaired by exactly the same code.

/** Split a road through a point into two roads. Node bookkeeping is left to rebuildArms(). */
/**
 * Elevation work needs vertices: a 200 m grid segment cannot carry a 90 m bridge ramp. Densification
 * inserts points without moving the centreline, and remaps the index-based structure spans onto the
 * new list so a bridge stays a bridge. Run it after the topology is settled and before grading.
 */
export function densifyRoads(project, options = {}) {
  const maxSpacing = options.maxSpacing ?? 14;
  let added = 0;
  for (const road of project.roads) {
    const pts = road.points;
    if (!pts || pts.length < 2) continue;
    const map = new Array(pts.length).fill(0);
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i += 1) {
      const a = pts[i - 1];
      const b = pts[i];
      const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const steps = Math.max(1, Math.ceil(d / maxSpacing));
      for (let k = 1; k <= steps; k += 1) {
        const t = k / steps;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
      map[i] = out.length - 1;
    }
    added += out.length - pts.length;
    if (road.spans && road.spans.length) {
      const last = map.length - 1;
      road.spans = road.spans
        .map((span) => ({ ...span, i0: map[Math.max(0, Math.min(span.i0, last))], i1: map[Math.max(0, Math.min(span.i1, last))] }))
        .filter((span) => span.i1 > span.i0);
    }
    road.points = out;
  }
  return added;
}

/**
 * Structure spans are stored as index ranges over a road's own point list, so every operation that
 * slices a point list has to carry them along or a bridge silently turns into a piece of flat tarmac.
 */
export function sliceSpans(spans, from, to) {
  const out = [];
  for (const span of spans || []) {
    const i0 = Math.max(span.i0, from);
    const i1 = Math.min(span.i1, to);
    if (i1 < i0) continue;
    out.push({ ...span, i0: i0 - from, i1: i1 - from });
  }
  return out;
}

export function splitRoadAt(project, road, x, z) {
  const pts = road.points;
  let bestI = 1;
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - a[0]) * dx + (z - a[2]) * dz) / l2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(a[0] + dx * t - x, a[2] + dz * t - z);
    if (d < bestD) { bestD = d; bestI = i; bestT = t; }
  }
  const a = pts[bestI - 1];
  const b = pts[bestI];
  const mid = [a[0] + (b[0] - a[0]) * bestT, a[1] + (b[1] - a[1]) * bestT, a[2] + (b[2] - a[2]) * bestT];
  const first = makeRoad({ ...road, id: nextId('r'), points: pts.slice(0, bestI).concat([mid]), spans: sliceSpans(road.spans, 0, bestI) });
  const second = makeRoad({ ...road, id: nextId('r'), points: [mid].concat(pts.slice(bestI)), spans: sliceSpans(road.spans, bestI - 1, pts.length - 1) });
  first.startNode = road.startNode;
  first.endNode = null;
  second.startNode = null;
  second.endNode = road.endNode;
  return { first, second, point: mid, distance: bestD };
}

export function projectRoadOn(road, x, z) {
  const pts = road.points;
  let bestI = 1;
  let bestT = 0;
  let bestD = Infinity;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - a[0]) * dx + (z - a[2]) * dz) / l2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(a[0] + dx * t - x, a[2] + dz * t - z);
    if (d < bestD) { bestD = d; bestI = i; bestT = t; }
  }
  const a = pts[bestI - 1];
  const b = pts[bestI];
  return {
    index: bestI, t: bestT, distance: bestD,
    point: [
      a[0] + (b[0] - a[0]) * bestT,
      a[1] + (b[1] - a[1]) * bestT,
      a[2] + (b[2] - a[2]) * bestT,
    ],
    dir: V.norm2([b[0] - a[0], b[2] - a[2]]),
  };
}

/**
 * Connect dangling ends to the nearest road they can legally join, so a generator's stray stubs
 * become T-junctions. Returns the number of joins made. Call rebuildArms() afterwards.
 */
export function connectDeadEnds(project, { maxDistance = 70, minAngle = 40, maxJoins = 600, rankGap = 2 } = {}) {
  const rank = (cls) => RANK_OF[cls] ?? 3;
  const candidates = [];
  for (const node of project.nodes) {
    if (node.arms.length !== 1 || node.riverTerminal) continue;
    const arm = node.arms[0];
    const road = project.roads.find((r) => r.id === arm.roadId);
    if (!road || road.points.length < 2) continue;
    const endP = arm.end === 0 ? road.points[0] : road.points[road.points.length - 1];
    const innerP = arm.end === 0 ? road.points[1] : road.points[road.points.length - 2];
    const dir = V.norm2([endP[0] - innerP[0], endP[2] - innerP[2]]);
    let best = null;
    for (const other of project.roads) {
      if (other.id === road.id) continue;
      // A join is a junction, so it has to obey the same class rules as a drawn one: a motorway spur
      // does not get to T into a residential street, and two classes apart means grade separation.
      if (Math.abs(rank(road.class) - rank(other.class)) >= rankGap) continue;
      if (rank(road.class) >= 6 || rank(other.class) >= 6) continue;
      const pr = projectRoadOn(other, endP[0], endP[2]);
      if (pr.distance < 2 || pr.distance > maxDistance) continue;
      const cross = Math.abs(dir[0] * pr.dir[1] - dir[1] * pr.dir[0]);
      if (cross < Math.sin((minAngle * Math.PI) / 180)) continue;
      if (!best || pr.distance < best.pr.distance) best = { other, pr };
    }
    if (best) candidates.push({ node, road, arm, target: best.other, pr: best.pr });
  }

  let joins = 0;
  const removed = new Set();
  for (const c of candidates) {
    if (joins >= maxJoins) break;
    if (removed.has(c.node.id)) continue;
    if (!project.roads.includes(c.target) || !project.roads.includes(c.road)) continue;
    const pr = projectRoadOn(c.target, c.pr.point[0], c.pr.point[2]);
    if (pr.distance > maxDistance) continue;
    const hit = pr.point;
    // The dangling road now terminates at the junction instead of in mid-air.
    if (c.arm.end === 0) c.road.points[0] = [hit[0], c.road.points[0][1], hit[2]];
    else {
      const last = c.road.points.length - 1;
      c.road.points[last] = [hit[0], c.road.points[last][1], hit[2]];
    }
    const { first, second } = splitRoadAt(project, c.target, hit[0], hit[2]);
    const junction = makeNode({ x: hit[0], z: hit[2], y: hit[1], type: 't', control: 'yield', arms: [] });
    first.endNode = junction.id;
    second.startNode = junction.id;
    c.road.startNode = c.arm.end === 0 ? junction.id : c.road.startNode;
    c.road.endNode = c.arm.end === 1 ? junction.id : c.road.endNode;
    const at = project.roads.indexOf(c.target);
    if (at >= 0) project.roads.splice(at, 1, first, second);
    project.nodes.push(junction);
    removed.add(c.node.id);
    project.nodes = project.nodes.filter((n) => n.id !== c.node.id);
    joins += 1;
  }
  return joins;
}

/** Trim streets that run into water: sub-arterial roads stop at the bank instead of bridging it. */
export function clipWaterCrossings(project, terrain, bridgeClasses = ['motorway', 'expressway', 'arterial', 'ramp', 'busway', 'tramway']) {
  const kept = [];
  let clipped = 0;
  for (const road of project.roads) {
    if (road.spans?.some((s) => s.why === 'river') || bridgeClasses.includes(road.class)) { kept.push(road); continue; }
    const wet = road.points.map((p) => terrain.isWater(p[0], p[2]));
    if (!wet.some(Boolean)) { kept.push(road); continue; }
    // A short wet run is a culvert, not a crossing: keep the road and record the structure.
    const runsAll = [];
    {
      let st = -1;
      for (let i = 0; i <= road.points.length; i += 1) {
        const isWet = i < road.points.length && wet[i];
        if (isWet && st < 0) st = i;
        if (!isWet && st >= 0) { runsAll.push([Math.max(0, st - 1), Math.min(road.points.length - 1, i)]); st = -1; }
      }
    }
    const longest = runsAll.reduce((a, r) => Math.max(a, polyLength(road.points.slice(r[0], r[1] + 1))), 0);
    if (longest <= 40) {
      road.spans = (road.spans || []).concat(runsAll.map(([i0, i1]) => ({ kind: 'culvert', i0, i1, clearance: 1.5 })));
      kept.push(road);
      continue;
    }
    // Collect the dry runs between wet sections.
    const runs = [];
    let start = -1;
    for (let i = 0; i <= road.points.length; i += 1) {
      const isWet = i < road.points.length && wet[i];
      if (!isWet && start < 0) start = i;
      if ((isWet || i === road.points.length) && start >= 0) {
        if (i - start >= 2) runs.push([start, i - 1]);
        start = -1;
      }
    }
    if (!runs.length) continue;
    clipped += 1;
    let prevNode = road.startNode;
    runs.forEach(([a, b], idx) => {
      const piece = makeRoad({ ...road, id: nextId('r'), points: road.points.slice(a, b + 1), spans: sliceSpans(road.spans, a, b) });
      piece.startNode = prevNode;
      if (idx === runs.length - 1) {
        piece.endNode = road.endNode;
      } else {
        const bank = makeNode({ x: piece.points[piece.points.length - 1][0], z: piece.points[piece.points.length - 1][2], y: piece.points[piece.points.length - 1][1], type: 'terminal', arms: [] });
        bank.riverTerminal = true;
        project.nodes.push(bank);
        piece.endNode = bank.id;
        prevNode = bank.id;
      }
      kept.push(piece);
    });
  }
  project.roads = kept;
  return clipped;
}

/** Rebuild node.arms from road terminus metadata — run after any structural edit. */
export function rebuildArms(project) {
  for (const node of project.nodes) node.arms = [];
  const byId = new Map(project.nodes.map((n) => [n.id, n]));
  for (const road of project.roads) {
    const a = byId.get(road.startNode);
    const b = byId.get(road.endNode);
    if (a) a.arms.push({ roadId: road.id, end: 0 });
    if (b) b.arms.push({ roadId: road.id, end: 1 });
  }
}

/** Make every arm meet its node at the node's height, so junction ribbons are flush. */
export function snapArmHeights(project) {
  for (const node of project.nodes) {
    const arms = node.arms.map((a) => {
      const road = project.roads.find((r) => r.id === a.roadId);
      if (!road) return null;
      const p = a.end === 0 ? road.points[0] : road.points[road.points.length - 1];
      return { road, p };
    }).filter(Boolean);
    if (!arms.length) continue;
    const y = arms.reduce((sum, a) => sum + a.p[1], 0) / arms.length;
    node.y = y;
    for (const a of arms) a.p[1] = y;
  }
}

/**
 * Sanitize the network after structural edits: merge coincident nodes, drop nodes that no road
 * references any more, delete degenerate roads, and collapse duplicate points. Every edit operation
 * ends with this, which is what keeps "no orphan nodes, no zero-length roads" true by construction
 * instead of by inspection.
 */
export function sanitizeNetwork(project, { nodeMerge = 2.5, minRoad = 6, minPointGap = 0.5, dissolve = true } = {}) {
  const report = { mergedNodes: 0, droppedNodes: 0, droppedRoads: 0, dedupedPoints: 0, dissolvedNodes: 0 };

  // 1. merge near-coincident nodes
  const nodes = [];
  const remap = new Map();
  for (const node of project.nodes) {
    const near = nodes.find((n) => Math.hypot(n.x - node.x, n.z - node.z) < nodeMerge);
    if (near) { remap.set(node.id, near.id); report.mergedNodes += 1; } else { nodes.push(node); remap.set(node.id, node.id); }
  }
  project.nodes = nodes;
  for (const road of project.roads) {
    road.startNode = remap.get(road.startNode) ?? road.startNode;
    road.endNode = remap.get(road.endNode) ?? road.endNode;
  }
  rebuildArms(project);

  // 2. drop nodes nothing is attached to
  const before = project.nodes.length;
  project.nodes = project.nodes.filter((n) => n.arms.length > 0);
  report.droppedNodes = before - project.nodes.length;

  // 3. drop roads that are too short, are loops, or collapse to a point; dedupe their points
  const kept = [];
  for (const road of project.roads) {
    const pts = [road.points[0]];
    for (const p of road.points.slice(1)) {
      const prev = pts[pts.length - 1];
      if (Math.hypot(p[0] - prev[0], p[2] - prev[2]) < minPointGap) { report.dedupedPoints += 1; continue; }
      pts.push(p);
    }
    road.points = pts;
    const loop = road.startNode === road.endNode;
    if (pts.length < 2 || polyLength(pts) < (loop ? 150 : minRoad)) {
      report.droppedRoads += 1;
      continue;
    }
    kept.push(road);
  }
  project.roads = kept;
  rebuildArms(project);
  // A road drop can orphan a node again; one more sweep is enough because roads are edges.
  project.nodes = project.nodes.filter((n) => n.arms.length > 0);
  if (dissolve) {
    for (let pass = 0; pass < 4; pass += 1) {
      const n = dissolvePassThroughNodes(project);
      report.dissolvedNodes += n;
      if (!n) break;
    }
  }
  // Dissolving can leave a node with nothing attached to it; drop those and re-derive the arms.
  const beforeFinal = project.nodes.length;
  rebuildArms(project);
  project.nodes = project.nodes.filter((n) => n.arms.length > 0);
  report.droppedNodes += beforeFinal - project.nodes.length;
  return report;
}

/**
 * Dissolve degree-2 nodes: where two same-class, same-profile roads meet at a node that carries no
 * turn, they are one road with a bend in it. This is the "dissolve junction" command and the reason a
 * generated network has junctions only where a driver can actually choose.
 */
export function dissolvePassThroughNodes(project, max = 4000) {
  let dissolved = 0;
  for (let guard = 0; guard < max; guard += 1) {
    const node = project.nodes.find((n) => {
      if (n.arms.length !== 2) return false;
      const [a1, a2] = n.arms;
      const r1 = project.roads.find((r) => r.id === a1.roadId);
      const r2 = project.roads.find((r) => r.id === a2.roadId);
      if (!r1 || !r2 || r1 === r2) return false;
      if (r1.class !== r2.class || r1.profileId !== r2.profileId) return false;
      if ((r1.spans || []).length || (r2.spans || []).length) return false;
      // Both arms must actually terminate here. A stale arm entry would corrupt the graph.
      const endOf = (r, a) => (a.end === 0 ? r.points[0] : r.points[r.points.length - 1]);
      return Math.hypot(endOf(r1, a1)[0] - n.x, endOf(r1, a1)[2] - n.z) < 1.5
        && Math.hypot(endOf(r2, a2)[0] - n.x, endOf(r2, a2)[2] - n.z) < 1.5;
    });
    if (!node) break;
    const [a1, a2] = node.arms;
    const r1 = project.roads.find((r) => r.id === a1.roadId);
    const r2 = project.roads.find((r) => r.id === a2.roadId);
    const chain1 = a1.end === 0 ? r1.points.slice().reverse() : r1.points.slice();
    const chain2 = a2.end === 0 ? r2.points.slice() : r2.points.slice().reverse();
    r1.points = chain1.concat(chain2.slice(1));
    r1.startNode = a1.end === 0 ? r1.endNode : r1.startNode;
    r1.endNode = a2.end === 0 ? r2.endNode : r2.startNode;
    r1.name = r1.name || r2.name;
    project.roads = project.roads.filter((r) => r !== r2);
    project.nodes = project.nodes.filter((n) => n !== node);
    rebuildArms(project);
    dissolved += 1;
  }
  return dissolved;
}

/**
 * Sanitize the network after structural edits: merge coincident nodes, drop nodes that no road
 * references any more, delete degenerate roads, and collapse duplicate points. Every edit operation
 * ends with this, which is what keeps "no orphan nodes, no zero-length roads" true by construction
 * instead of by inspection.
 */

/**
 * Fold duplicate alignments: two roads that lie on top of each other at the same height are one road
 * with a modelling error, not two roads. The shorter of the pair is removed and the survivor keeps the
 * higher class, because that is the one a driver would have been told to follow.
 */
export function foldDuplicates(project, { tolerance = 2.0, overlap = 0.5, heightBand = 1.0 } = {}) {
  const drop = new Set();
  const list = project.roads;
  for (let i = 0; i < list.length; i += 1) {
    const a = list[i];
    if (drop.has(a.id)) continue;
    for (let j = i + 1; j < list.length; j += 1) {
      const b = list[j];
      if (drop.has(b.id) || drop.has(a.id)) continue;
      const shorter = polyLength(a.points) <= polyLength(b.points) ? a : b;
      const longer = shorter === a ? b : a;
      let hits = 0;
      let samples = 0;
      for (const p of shorter.points) {
        samples += 1;
        const pr = projectRoadOn(longer, p[0], p[2]);
        // Interior projections only: a stub beyond the other road's end projects onto its terminus and
        // would read as a duplicate when it is really just nearby.
        if (pr.t < 0.05 || pr.t > 0.95) continue;
        if (pr.distance < tolerance && Math.abs(pr.point[1] - p[1]) < heightBand) hits += 1;
      }
      if (samples && hits / samples >= overlap) {
        drop.add(shorter.id);
        if (shorter === a) break;
      }
    }
  }
  if (!drop.size) return 0;
  project.roads = project.roads.filter((r) => !drop.has(r.id));
  rebuildArms(project);
  project.nodes = project.nodes.filter((n) => n.arms.length > 0);
  return drop.size;
}

/**
 * Stitch any remaining at-grade crossings into junctions.
 *
 * This is the topological invariant, not a generator detail: two roads whose surfaces overlap at the
 * same height must either share a node or one of them must be a structure. The generator runs it after
 * interchanges (ramps cross streets, and a ramp crossing a street at grade *is* a junction); the editor
 * runs it after any drawn edit. Returns the number of junctions created.
 */
export function stitchRoads(project, { heightBand = 1.5 } = {}) {
  let made = 0;
  for (let pass = 0; pass < 3; pass += 1) {
    let changed = false;
    const roads = project.roads;
    for (let i = 0; i < roads.length; i += 1) {
      const a = roads[i];
      for (let j = i + 1; j < roads.length; j += 1) {
        const b = roads[j];
        if (a.startNode === b.startNode && a.endNode === b.endNode) continue;
        const hit = crossingPoint(a, b);
        if (!hit || Math.abs(hit.ya - hit.yb) > heightBand) continue;
        if (nearNode(project, hit.x, hit.z, 0.9, [a, b])) continue; // already junctioned here
        const sa = splitRoadAt(project, a, hit.x, hit.z);
        const sb = splitRoadAt(project, b, hit.x, hit.z);
        const junction = makeNode({ x: hit.x, z: hit.z, y: (hit.ya + hit.yb) / 2, type: 'crossroads', control: 'yield', arms: [] });
        sa.first.endNode = junction.id;
        sa.second.startNode = junction.id;
        sb.first.endNode = junction.id;
        sb.second.startNode = junction.id;
        project.nodes.push(junction);
        const ia = project.roads.indexOf(a);
        if (ia >= 0) project.roads.splice(ia, 1, sa.first, sa.second);
        const ib = project.roads.indexOf(b);
        if (ib >= 0) project.roads.splice(ib, 1, sb.first, sb.second);
        made += 1;
        changed = true;
        break;
      }
      if (changed) break;
    }
    rebuildArms(project);
    // Drop the nodes nothing uses, but never one a road still points at: a dangling arm reference is
    // worse than an armless node, and the orphan-end audit covers the other direction.
    const referenced = new Set();
    for (const r of project.roads) { referenced.add(r.startNode); referenced.add(r.endNode); }
    project.nodes = project.nodes.filter((n) => n.arms.length > 0 || referenced.has(n.id));
    if (!changed) break;
  }
  return made;
}

function crossingPoint(a, b) {
  for (let i = 1; i < a.points.length; i += 1) {
    const p1 = a.points[i - 1];
    const p2 = a.points[i];
    for (let j = 1; j < b.points.length; j += 1) {
      const p3 = b.points[j - 1];
      const p4 = b.points[j];
      const d1x = p2[0] - p1[0];
      const d1z = p2[2] - p1[2];
      const d2x = p4[0] - p3[0];
      const d2z = p4[2] - p3[2];
      const den = d1x * d2z - d1z * d2x;
      if (Math.abs(den) < 1e-9) continue;
      const t = ((p3[0] - p1[0]) * d2z - (p3[2] - p1[2]) * d2x) / den;
      const u = ((p3[0] - p1[0]) * d1z - (p3[2] - p1[2]) * d1x) / den;
      if (t < 0.02 || t > 0.98 || u < 0.02 || u > 0.98) continue;
      return {
        x: p1[0] + d1x * t,
        z: p1[2] + d1z * t,
        ya: p1[1] + (p2[1] - p1[1]) * t,
        yb: p3[1] + (p4[1] - p3[1]) * u,
      };
    }
  }
  return null;
}

function nearNode(project, x, z, radius, roads) {
  const ids = new Set();
  for (const r of roads) { ids.add(r.startNode); ids.add(r.endNode); }
  return project.nodes.some((n) => ids.has(n.id) && Math.hypot(n.x - x, n.z - z) < radius);
}
