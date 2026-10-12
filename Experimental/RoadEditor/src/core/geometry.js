// Geometry — model → render primitives.
//
// Everything the viewport draws comes out of here as one of four primitive kinds, each in world space:
//
//   polys  closed plan polygons (strips, junction pads, crossings, decks, water)
//   lines  polylines with a marking pattern (lane lines, edge lines, hatch, guardrails, rails)
//   props  small objects with a footprint (bollards, signs, columns, piers, sleepers, portals)
//   rings  roundabout annuli, which the renderer draws as circles rather than sampled ribbons
//
// The strip rules are the editor's clean-topology story in code: strips are sampled from the same
// frames as their markings, so paint can never drift off its lane; a kerb is a face and a top, so it
// cannot be coplanar with the carriageway; and a bridge deck extends past its span so pier and
// abutment geometry has somewhere to stand.

import { sampleRoad, roadProfile, junctionPlan, armReach, V, polyLength } from './network.js';
import { profileOffsets, profileExtents, profileWidth } from './profiles.js';
import { CLASS_RANK } from './rank.js';

export const CAMBER = 0.02;         // crossfall from the crown to the kerb line
const RAISED = { kerb: 1, footway: 1, verge: 1, 'tree-lawn': 1, median: 1, tactile: 1 };
const KERB_UP = { upstand: 0.125, low: 0.06, flush: 0.0, mountable: 0.075, splayed: 0.05, channel: 0.125 };

const SURFACE_COLOUR = {
  traffic: [58, 58, 61], bus: [64, 54, 50], 'bus-stop': [62, 55, 50], cycle: [46, 60, 50],
  'cycle-track': [44, 62, 49], parking: [64, 64, 70], loading: [66, 62, 56], shoulder: [62, 62, 65],
  emergency: [66, 66, 70], median: [66, 74, 58], buffer: [62, 62, 62], kerb: [150, 150, 146],
  footway: [124, 122, 116], verge: [74, 88, 56], 'tree-lawn': [66, 82, 50], tactile: [150, 146, 92],
  tram: [86, 78, 84], rail: [78, 78, 84], drainage: [74, 84, 88], guardrail: [140, 140, 145],
  'noise-barrier': [110, 110, 118], 'parking-aisle': [66, 66, 72],
};

/* ── Ribbon helpers ──────────────────────────────────────────────────────────────────────────────── */

function upstandFor(strip) {
  if (strip.type !== 'kerb') return 0;
  if (strip.kerb) return KERB_UP[strip.kerb] ?? 0.125;
  return strip.width <= 0 ? 0 : 0.125;
}

/** Height above the centre-line surface for a point `o` metres to the right of the spline. */
function surfaceOffset(strip, o, frame, raised) {
  const camber = -CAMBER * Math.abs(o);
  const up = raised ? (frame.upstand ?? 0.125) : 0;
  const bank = (frame.bank || 0) * o;
  return camber + up + bank;
}

function stripPolygon(frames, from, to, strip, raised) {
  const poly = [];
  for (const f of frames) poly.push(f.pointAt(from, surfaceOffset(strip, from, f, raised)));
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const f = frames[i];
    poly.push(f.pointAt(to, surfaceOffset(strip, to, f, raised)));
  }
  return poly;
}

function bounds(poly) {
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity; let minZ = Infinity; let maxZ = -Infinity;
  for (const p of poly) {
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
    if (p[2] < minZ) minZ = p[2];
    if (p[2] > maxZ) maxZ = p[2];
  }
  return { minX, maxX, minY, maxY, minZ, maxZ, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: (minZ + maxZ) / 2 };
}

/** Frames extended with the helpers the ribbon builders need, plus superelevation on curves. */
export function roadFrames(project, road, step) {
  const base = sampleRoad(road, step || 5);
  const profile = roadProfile(project, road);
  const upstand = Math.max(...[...profile.right, ...profile.left].filter((s) => s.type === 'kerb').map((s) => upstandFor(s)), 0) || 0.125;
  const spanIndex = spanMask(road, base.length);
  const out = base.map((f) => {
    const n = f.n;
    return {
      p: f.p,
      s: f.s,
      t: f.t,
      n,
      upstand,
      bank: 0,
      span: spanIndex[f.__i ?? 0] ?? null,
      pointAt: (o, dy) => [f.p[0] + n[0] * o, f.p[1] + dy, f.p[2] + n[2] * o],
    };
  });
  computeBank(out, road);
  return out;
}

function computeBank(frames, road) {
  const rank = CLASS_RANK[road.class] ?? 3;
  const maxBank = rank >= 6 ? 0.06 : rank >= 5 ? 0.045 : 0.025;
  for (let i = 0; i < frames.length; i += 1) {
    const a = frames[Math.max(i - 2, 0)].n;
    const b = frames[Math.min(i + 2, frames.length - 1)].n;
    // n rotates with the curve; its rate of change is a cheap curvature proxy.
    const turn = a[0] * b[1] - a[1] * b[0];
    const speed = road.speed || 50;
    const want = Math.min(maxBank, (turn * 60 * (speed / 90)) * 0.12);
    frames[i].bank = -want;
  }
}

/** Per-index span lookup: kind of structure a sampled point sits inside, used for surfaces and props. */
function spanMask(road, count) {
  const mask = new Array(count).fill(null);
  if (!road.spans || !road.spans.length) return mask;
  const last = road.points.length - 1;
  for (const span of road.spans) {
    for (let i = span.i0; i <= span.i1; i += 1) {
      const a = Math.floor((i / last) * (count - 1));
      const b = Math.ceil((i / last) * (count - 1));
      for (let k = a; k <= b; k += 1) if (k >= 0 && k < count) mask[k] = span;
    }
  }
  return mask;
}

/* ── Main builder ────────────────────────────────────────────────────────────────────────────────── */

export function buildGeometry(project, options = {}) {
  const detail = options.detail || 'full';
  const polys = [];
  const lines = [];
  const props = [];
  const rings = [];
  const stats = { polys: 0, lines: 0, props: 0, triangles: 0, metres: 0, byClass: {} };

  const pushPoly = (poly, colour, meta = {}) => {
    if (poly.length < 3) return;
    polys.push({ pts: poly, colour, bb: bounds(poly), ...meta });
    stats.polys += 1;
    stats.triangles += poly.length - 2;
  };
  const pushLine = (pts, meta) => {
    if (pts.length < 2) return;
    lines.push({ pts, bb: bounds(pts), ...meta });
    stats.lines += 1;
  };
  const pushProp = (x, y, z, meta) => {
    props.push({ x, y, z, ...meta });
    stats.props += 1;
    stats.triangles += 3;
  };

  // ── Roads ───────────────────────────────────────────────────────────────────────────────────────
  for (const road of project.roads) {
    const step = road.points.length > 6 ? 6 : 5;
    const frames = roadFrames(project, road, step);
    if (frames.length < 2) continue;
    const profile = roadProfile(project, road);
    const offsets = profileOffsets(profile);
    const len = frames[frames.length - 1].s;
    stats.metres += len;
    stats.byClass[road.class] = (stats.byClass[road.class] || 0) + len;

    const reach0 = road.startNode ? nodeReach(project, road.startNode, road.id) : 0;
    const reach1 = road.endNode ? nodeReach(project, road.endNode, road.id) : 0;
    const body = frames.filter((f) => f.s >= reach0 && f.s <= len - reach1);
    const stripFrames = body.length >= 2 ? body : frames;
    const tunnel = (f) => f.span && f.span.kind === 'tunnel';
    const bridge = (f) => f.span && f.span.kind === 'bridge';

    for (const { strip, from, to } of offsets) {
      if (strip.type === 'noise-barrier' || strip.type === 'guardrail' || strip.type === 'rail') continue;
      const raised = !!RAISED[strip.type];
      const poly = stripPolygon(stripFrames, from, to, strip, raised);
      const kind = tunnel(stripFrames[0]) ? 'tunnel-surface' : bridge(stripFrames[0]) ? 'deck-surface' : 'surface';
      const tint = tunnel(stripFrames[0]) ? 0.42 : 1;
      pushPoly(poly, shade(SURFACE_COLOUR[strip.type] || [60, 60, 62], tint), {
        kind, roadId: road.id, layer: 0, strip: strip.type, width: strip.width,
      });
      // A kerb is a face and a top: the face stops the carriageway and the raised strip being coplanar.
      if (strip.type === 'kerb' && strip.width > 0 && stripFrames.length >= 2) {
        const up = upstandFor(strip);
        if (up > 0.001) {
          // `from`/`to` belong to the offset entry, not the strip record: using the strip's own
          // fields here produced a kerb face of NaNs, which is invisible and un-cullable.
          const inner = from >= 0 ? from : to;
          const face = [];
          for (const f of stripFrames) face.push(f.pointAt(inner, -CAMBER * Math.abs(inner)));
          for (let i = stripFrames.length - 1; i >= 0; i -= 1) {
            const f = stripFrames[i];
            face.push(f.pointAt(inner, -CAMBER * Math.abs(inner) + up));
          }
          pushPoly(face, [128, 128, 124], { kind: 'kerb-face', roadId: road.id, layer: 1, face: true });
        }
      }
    }

    // ── Markings: one rule table, evaluated per strip boundary ────────────────────────────────────
    for (let i = 0; i < offsets.length - 1; i += 1) {
      const a = offsets[i];
      const b = offsets[i + 1];
      if (Math.abs(a.to - b.from) > 0.02) continue;
      const boundary = a.to;
      const rule = markingRule(profile, a, b, road, project);
      if (!rule) continue;
      const pts = stripFrames.map((f) => f.pointAt(boundary, surfaceOffset(null, boundary, f, false) + 0.012));
      pushLine(pts, {
        kind: 'marking', pattern: rule.pattern, colour: rule.colour || [232, 232, 232],
        width: rule.width, pitch: rule.pitch, duty: rule.duty ?? 0.5, roadId: road.id,
        marking: rule.name, markingId: rule.id,
      });
    }

    // ── Bays: parking ticks, loading boxes, cycle crossing squares ────────────────────────────────
    for (const { strip, from, to } of offsets) {
      if (strip.type !== 'parking' && strip.type !== 'loading' && strip.type !== 'bus-stop') continue;
      const pitch = strip.angle === 'perpendicular' ? 2.5 : strip.angle === 'angled' ? 3.6 : 6.0;
      const mid = (from + to) / 2;
      const pts = [];
      for (let s = 2; s < len; s += pitch) {
        const f = frameNear(stripFrames, s);
        if (!f) continue;
        pts.push(f.pointAt(from, 0.012), f.pointAt(to, 0.012));
      }
      for (let k = 0; k + 1 < pts.length; k += 2) {
        pushLine([pts[k], pts[k + 1]], {
          kind: 'marking', pattern: 'solid', colour: strip.type === 'bus-stop' ? [224, 192, 74] : [230, 230, 230],
          width: 0.1, roadId: road.id, marking: 'bay', markingId: 'parking-bay',
        });
      }
      void mid;
    }

    // ── Approach markings: stop bars and lane arrows before each junction ─────────────────────────
    for (const end of [0, 1]) {
      const nodeId = end === 0 ? road.startNode : road.endNode;
      if (!nodeId) continue;
      const node = project.nodes.find((n) => n.id === nodeId);
      if (!node || node.arms.length < 3) continue;
      const reach = nodeReach(project, nodeId, road.id);
      const s = end === 0 ? reach + 1.2 : len - reach - 1.2;
      const f = frameNear(stripFrames, s);
      if (!f) continue;
      const lanes = offsets.filter((o) => o.strip.type === 'traffic' || o.strip.type === 'bus');
      for (const lane of lanes) {
        const mid = (lane.from + lane.to) / 2;
        pushLine([f.pointAt(lane.from + 0.15, 0.012), f.pointAt(lane.to - 0.15, 0.012)], {
          kind: 'marking', pattern: 'solid', colour: [234, 234, 234], width: 0.3, roadId: road.id,
          marking: 'stop bar', markingId: 'stop-bar',
        });
        void mid;
      }
      // Turn arrows from the junction's movement matrix, so the paint matches the lane assignment.
      const moves = node.moves || [];
      for (const mv of moves.slice(0, 12)) {
        const arm = node.arms[mv.from];
        if (!arm || arm.roadId !== road.id) continue;
        const lane = lanes[mv.fromLane];
        if (!lane) continue;
        const af = frameNear(stripFrames, end === 0 ? reach + 12 : len - reach - 12);
        if (!af) continue;
        const mid = (lane.from + lane.to) / 2;
        pushProp(af.pointAt(mid, 0.02)[0], af.pointAt(mid, 0.02)[1], af.pointAt(mid, 0.02)[2], {
          kind: 'decal', decal: `arrow-${mv.kind}`, w: 0.9, h: 0.01, yaw: yawOf(af), colour: [232, 232, 232], roadId: road.id,
        });
      }
    }

    // ── Structures: deck edges, parapets, piers, abutments, portals, lighting ─────────────────────
    for (const span of road.spans || []) {
      const s0 = frames[Math.min(span.i0, frames.length - 1)].s;
      const s1 = frames[Math.min(span.i1, frames.length - 1)].s;
      if (span.kind === 'bridge') buildBridge(project, road, frames, stripFrames, s0, s1, profile, pushPoly, pushLine, pushProp, offsets);
      else buildTunnel(road, frames, s0, s1, profile, pushLine, pushProp, offsets);
    }

    // ── Furniture from the detail layer ──────────────────────────────────────────────────────────
    const d = road.details || {};
    for (const c of d.crossings || []) buildCrossing(stripFrames, c, offsets, pushPoly, pushProp, profile);
    for (const h of d.humps || []) buildHump(stripFrames, h, offsets, pushPoly, pushLine);
    for (const b of d.bollards || []) buildBollards(stripFrames, b, offsets, pushProp, profile);
    for (const b of d.busStops || []) buildBusStop(stripFrames, b, offsets, pushPoly, pushProp);
    for (const s of d.signs || []) buildSign(stripFrames, s, offsets, pushProp);
    for (const l of d.lights || []) buildLight(stripFrames, l, offsets, pushProp);
    for (const g of d.gullies || []) buildGully(stripFrames, g, offsets, pushProp);
    for (const m of d.manholes || []) buildManhole(stripFrames, m, offsets, pushProp);
    for (const p of d.passing || []) buildPassing(stripFrames, p, offsets, pushPoly, profile);
    for (const r of d.guardrail || []) buildGuardrail(stripFrames, r, offsets, pushLine, pushProp);
    for (const c of d.chicanes || []) buildChicane(stripFrames, c, offsets, pushPoly, profile);
    for (const w of d.wear || []) buildWear(stripFrames, w, offsets, pushPoly, road);
    for (const sw of d.subway || []) buildSubway(stripFrames, sw, offsets, pushProp, pushPoly);
  }

  // ── Junctions ────────────────────────────────────────────────────────────────────────────────────
  for (const node of project.nodes) {
    if (node.arms.length < 2) continue;
    const plan = junctionPlan(project, node);
    if (plan.poly.length < 3) continue;
    if (node.type === 'roundabout') {
      const inner = 7.5;
      const outer = inner + Math.max(6.5, Math.max(...plan.arms.map((a) => a.halfWidth * 2)) * 1.1);
      rings.push({ cx: node.x, cz: node.z, y: node.y, r0: inner, r1: outer, roadId: null, nodeId: node.id });
      // The central island: kerbed, raised, and never driven on.
      const island = [];
      for (let i = 0; i < 24; i += 1) {
        const a = (i / 24) * Math.PI * 2;
        island.push([node.x + Math.cos(a) * inner, node.y + 0.16, node.z + Math.sin(a) * inner]);
      }
      pushPoly(island, [78, 92, 60], { kind: 'island', nodeId: node.id, layer: 2 });
      const kerbRing = [];
      for (let i = 0; i <= 32; i += 1) {
        const a = (i / 32) * Math.PI * 2;
        kerbRing.push([node.x + Math.cos(a) * inner, node.y + 0.16, node.z + Math.sin(a) * inner]);
      }
      pushLine(kerbRing, { kind: 'kerb-ring', colour: [152, 152, 148], width: 0.3, nodeId: node.id });
      const entry = [];
      for (let i = 0; i <= 40; i += 1) {
        const a = (i / 40) * Math.PI * 2;
        entry.push([node.x + Math.cos(a) * outer, node.y + 0.012, node.z + Math.sin(a) * outer]);
      }
      pushLine(entry, { kind: 'marking', pattern: 'dash', colour: [232, 232, 232], width: 0.15, pitch: 2.0, duty: 0.7, nodeId: node.id, marking: 'give-way dashes' });
      for (const arm of plan.arms) {
        pushProp(node.x + arm.dir[0] * (outer + 5), node.y, node.z + arm.dir[1] * (outer + 5), {
          kind: 'sign', sign: 'roundabout', w: 0.9, h: 2.4, yaw: Math.atan2(arm.dir[0], arm.dir[1]), colour: [200, 200, 205], nodeId: node.id,
        });
      }
      continue;
    }
    const planPts = plan.poly.map((p) => [node.x + p[0], node.y + 0.004, node.z + p[1]]);
    pushPoly(planPts, node.control === 'signals' ? [56, 56, 60] : [58, 58, 61], { kind: 'junction', nodeId: node.id, layer: 0 });
    // Kerb returns: the outline the strips are cut back to.
    pushLine(plan.poly.map((p) => [node.x + p[0], node.y + 0.16, node.z + p[1]]).concat([[node.x + plan.poly[0][0], node.y + 0.16, node.z + plan.poly[0][1]]]), {
      kind: 'kerb-return', colour: [150, 150, 146], width: 0.28, nodeId: node.id,
    });
    if (node.control === 'signals') {
      for (const arm of plan.arms) {
        pushProp(node.x + arm.dir[0] * (plan.radius + 1.5), node.y, node.z + arm.dir[1] * (plan.radius + 1.5), {
          kind: 'signal', w: 0.35, h: 3.2, yaw: Math.atan2(arm.dir[0], arm.dir[1]), colour: [40, 42, 46], nodeId: node.id,
        });
      }
    }
    if (node.control === 'yield' || node.control === 'all-way stop') {
      for (const arm of plan.arms) {
        pushProp(node.x + arm.dir[0] * (plan.radius + 0.5), node.y, node.z + arm.dir[1] * (plan.radius + 0.5), {
          kind: 'sign', sign: node.control === 'yield' ? 'give way' : 'stop', w: 0.8, h: 2.3,
          yaw: Math.atan2(arm.dir[0], arm.dir[1]), colour: [200, 200, 205], nodeId: node.id,
        });
      }
    }
  }

  // ── Rail, crossings, and the pedestrian subway network's mouths ──────────────────────────────────
  for (const line of project.rail) buildRail(project, line, pushPoly, pushLine, pushProp);
  for (const x of project.railCrossings || []) buildRailCrossing(x, pushPoly, pushProp, pushLine);

  // ── Water, so bridges have something to be over ──────────────────────────────────────────────────
  if (options.terrain !== false) buildTerrain(project, pushPoly, options.terrainStep || 90);

  return { polys, lines, props, rings, stats, project };
}

/* ── Marking rules ───────────────────────────────────────────────────────────────────────────────── */

function markingRule(profile, a, b, road, project) {
  const ta = a.strip.type;
  const tb = b.strip.type;
  const isLane = (t) => t === 'traffic' || t === 'bus' || t === 'bus-stop';
  const boundary = a.to;
  const centre = Math.abs(boundary) < 0.05;
  if (centre) {
    const total = profileExtents(profile).width;
    if (road.oneway) return null;
    if (total > 11) return { id: 'centre-double-white', name: 'Double white centreline', pattern: 'solid', width: 0.2, colour: [232, 232, 232], pitch: 0 };
    if (isLane(ta) && isLane(tb)) {
      return project.settings?.markingStyle === 'uk'
        ? { id: 'centre-dashed', name: 'Dashed centreline', pattern: 'dash', width: 0.1, pitch: 3.0, duty: 0.34 }
        : { id: 'centre-double-yellow', name: 'Double yellow line', pattern: 'solid', width: 0.2, colour: [224, 192, 74], pitch: 0 };
    }
  }
  if (isLane(ta) && isLane(tb)) {
    if (ta === 'bus' || tb === 'bus' || ta === 'bus-stop' || tb === 'bus-stop') {
      return { id: 'bus-lane-line', name: 'Bus lane boundary', pattern: 'solid', width: 0.2, colour: [236, 236, 236] };
    }
    return { id: 'lane-dash', name: 'Lane line (dashed)', pattern: 'dash', width: 0.1, pitch: 6.0, duty: 0.5 };
  }
  const withCycle = (x, y) => (x === 'cycle' || x === 'cycle-track') !== (y === 'cycle' || y === 'cycle-track');
  if (withCycle(ta, tb)) return { id: 'cycle-lane-line', name: 'Cycle lane boundary', pattern: 'solid', width: 0.15, colour: [236, 236, 236] };
  const kerbish = (t) => t === 'kerb' || t === 'footway' || t === 'verge' || t === 'tree-lawn' || t === 'tactile';
  if (isLane(ta) && kerbish(tb)) return { id: 'edge-line', name: 'Edge line', pattern: 'solid', width: 0.15 };
  if (isLane(tb) && kerbish(ta)) return { id: 'edge-line', name: 'Edge line', pattern: 'solid', width: 0.15 };
  if (isLane(ta) && (tb === 'parking' || tb === 'loading')) return { id: 'edge-line', name: 'Edge line', pattern: 'solid', width: 0.15 };
  if (isLane(tb) && (ta === 'parking' || ta === 'loading')) return { id: 'edge-line', name: 'Edge line', pattern: 'solid', width: 0.15 };
  if (isLane(ta) && tb === 'shoulder') return { id: 'edge-line', name: 'Edge line', pattern: 'solid', width: 0.15 };
  if (isLane(tb) && ta === 'shoulder') return { id: 'edge-line', name: 'Edge line', pattern: 'solid', width: 0.15 };
  if ((ta === 'traffic' || ta === 'bus') && tb === 'tram') return { id: 'edge-line', name: 'Tram reservation edge', pattern: 'solid', width: 0.15 };
  if ((tb === 'traffic' || tb === 'bus') && ta === 'tram') return { id: 'edge-line', name: 'Tram reservation edge', pattern: 'solid', width: 0.15 };
  return null;
}

/* ── Structures ──────────────────────────────────────────────────────────────────────────────────── */

function buildBridge(project, road, frames, stripFrames, s0, s1, profile, pushPoly, pushLine, pushProp, offsets) {
  const ext = profileExtents(profile);
  const at = (s) => frameNear(stripFrames, s);
  const a = at(s0);
  const b = at(s1);
  if (!a || !b) return;
  // Deck edge: a face under each side of the deck, which is what makes the bridge read from below.
  for (const side of [ext.right, -ext.left]) {
    const face = [];
    for (const f of stripFrames.filter((x) => x.s >= s0 && x.s <= s1)) {
      face.push(f.pointAt(side, -0.2));
    }
    for (let i = face.length - 1; i >= 0; i -= 1) face.push([face[i][0], face[i][1] - 1.1, face[i][2]]);
    pushPoly(face, [96, 96, 100], { kind: 'deck-edge', roadId: road.id, layer: 1, face: true });
    // Parapet: a rail line plus posts, so the deck has an edge you can see at speed.
    const rail = stripFrames.filter((f) => f.s >= s0 && f.s <= s1).map((f) => f.pointAt(side, 1.05));
    pushLine(rail, { kind: 'parapet', colour: [176, 176, 180], width: 0.12, roadId: road.id });
    for (let s = s0; s <= s1; s += 3.4) {
      const f = frameNear(stripFrames, s);
      if (!f) continue;
      const p = f.pointAt(side, 0.55);
      pushProp(p[0], p[1], p[2], { kind: 'parapet-post', w: 0.09, h: 1.0, yaw: yawOf(f), colour: [168, 168, 172], roadId: road.id });
    }
  }
  // Piers and abutments: a column every ~26 m, wider walls at the ends of the span.
  const spanLen = s1 - s0;
  const piers = Math.max(1, Math.round(spanLen / 26) - 1);
  for (let k = 1; k <= piers; k += 1) {
    const f = at(s0 + (spanLen * k) / (piers + 1));
    if (!f) continue;
    const ground = project.terrain?.height(f.p[0], f.p[2]) ?? f.p[1] - 6;
    const h = Math.max(1.5, f.p[1] - ground - 0.9);
    pushProp(f.p[0], ground, f.p[2], { kind: 'pier', w: 1.6, h, d: 1.6, yaw: yawOf(f), colour: [126, 126, 130], roadId: road.id });
    pushProp(f.p[0], ground, f.p[2], { kind: 'pier-footing', w: 3.4, h: 0.7, d: 3.4, yaw: yawOf(f), colour: [110, 110, 114], roadId: road.id });
  }
  for (const f of [a, b]) {
    const ground = project.terrain?.height(f.p[0], f.p[2]) ?? f.p[1] - 3;
    const h = Math.max(1, f.p[1] - ground - 0.6);
    pushProp((f.p[0] + f.p[0]) / 2, ground, f.p[2], { kind: 'abutment', w: profileWidth(profile) + 1.4, h, d: 2.2, yaw: yawOf(f), colour: [132, 128, 120], roadId: road.id });
  }
  void offsets;
}

function buildTunnel(road, frames, s0, s1, profile, pushLine, pushProp, offsets) {
  const ext = profileExtents(profile);
  for (const s of [s0, s1]) {
    const f = frameNear(frames, s);
    if (!f) continue;
    pushProp(f.p[0], f.p[1], f.p[2], { kind: 'portal', w: ext.width + 4, h: 6.4, yaw: yawOf(f) + Math.PI / 2, colour: [104, 104, 108], roadId: road.id });
  }
  // Tunnel lighting strip and a wall base line each side: at speed this is the only cue that matters.
  const inside = frames.filter((f) => f.s >= s0 && f.s <= s1);
  if (inside.length >= 2) {
    for (const side of [ext.right - 0.3, -ext.left + 0.3]) {
      pushLine(inside.map((f) => f.pointAt(side, 5.2)), { kind: 'tunnel-light', colour: [236, 214, 150], width: 0.18, roadId: road.id });
      pushLine(inside.map((f) => f.pointAt(side, 0.9)), { kind: 'wall-base', colour: [70, 70, 74], width: 0.25, roadId: road.id });
    }
    for (let s = s0 + 12; s < s1; s += 12) {
      const f = frameNear(inside, s);
      if (!f) continue;
      pushProp(f.p[0], f.p[1] + 4.6, f.p[2], { kind: 'tunnel-light', w: 0.4, h: 0.2, yaw: yawOf(f), colour: [240, 220, 160], roadId: road.id });
    }
  }
  void offsets;
}

function buildRail(project, line, pushPoly, pushLine, pushProp) {
  const road = { points: line.points, class: 'rail-line', speed: 0, name: line.name, spans: [], profileId: null };
  const frames = sampleRoad(road, 12);
  if (frames.length < 2) return;
  const band = [];
  for (const f of frames) band.push([f.p[0] + f.n[0] * 3, f.p[1] - 0.35, f.p[2] + f.n[2] * 3]);
  for (let i = frames.length - 1; i >= 0; i -= 1) {
    const f = frames[i];
    band.push([f.p[0] - f.n[0] * 3, f.p[1] - 0.35, f.p[2] - f.n[2] * 3]);
  }
  pushPoly(band, [76, 74, 72], { kind: 'ballast', railId: line.id, layer: 0 });
  for (const side of [0.7175, -0.7175]) {
    pushLine(frames.map((f) => [f.p[0] + f.n[0] * side, f.p[1], f.p[2] + f.n[2] * side]), {
      kind: 'rail', colour: [168, 168, 172], width: 0.075, railId: line.id,
    });
  }
  // Sleepers are only placed where they can be seen at close range: near the road crossings. A rail
  // line's ballast and rails carry the read everywhere else, at a fraction of the prop count.
  const near = (project.railCrossings || []).filter((x) => x.railId === line.id);
  for (const x of near) {
    for (let s = Math.max(0, sAt(frames, [x.x, x.z]) - 30); s < sAt(frames, [x.x, x.z]) + 30; s += 0.62) {
      const f = frameNear(frames, s);
      if (!f) continue;
      pushProp(f.p[0], f.p[1] - 0.16, f.p[2], { kind: 'sleeper', w: 2.6, h: 0.16, d: 0.26, yaw: yawOf(f) + Math.PI / 2, colour: [92, 84, 74], railId: line.id });
    }
  }
}

function buildRailCrossing(x, pushPoly, pushProp, pushLine) {
  const w = 9;
  const quad = [
    [x.x - w / 2, x.y + 0.02, x.z - w / 2], [x.x + w / 2, x.y + 0.02, x.z - w / 2],
    [x.x + w / 2, x.y + 0.02, x.z + w / 2], [x.x - w / 2, x.y + 0.02, x.z + w / 2],
  ];
  pushPoly(quad, x.separated ? [90, 90, 94] : [104, 100, 96], { kind: 'rail-crossing', x, layer: 1 });
  if (x.separated) return;
  pushProp(x.x, x.y, x.z, { kind: 'sign', sign: 'crossbuck', w: 1.4, h: 2.6, yaw: 0, colour: [210, 210, 214] });
  if (x.lights) {
    pushProp(x.x + 4, x.y, x.z + 4, { kind: 'signal', w: 0.4, h: 2.9, yaw: 0, colour: [44, 46, 50] });
    pushProp(x.x - 4, x.y, x.z - 4, { kind: 'signal', w: 0.4, h: 2.9, yaw: 0, colour: [44, 46, 50] });
  }
  if (x.barrier) {
    for (const [dx, dz] of [[5.5, 0], [-5.5, 0]]) {
      pushProp(x.x + dx, x.y, x.z + dz, { kind: 'barrier', w: 0.5, h: 1.1, d: 0.5, yaw: 0, colour: [72, 74, 80] });
      pushProp(x.x + dx * 0.75, x.y + 0.9, x.z + dz * 0.75, { kind: 'barrier-arm', w: 4.2, h: 0.14, d: 0.2, yaw: 0, colour: [214, 84, 78] });
    }
  }
  pushLine([[x.x, x.y + 0.03, x.z], [x.x + 6, x.y + 0.03, x.z]], { kind: 'marking', pattern: 'solid', colour: [232, 232, 232], width: 0.3, marking: 'stop bar' });
}

/* ── Furniture builders ──────────────────────────────────────────────────────────────────────────── */

function buildCrossing(frames, c, offsets, pushPoly, pushProp, profile) {
  const f = frameNear(frames, c.s);
  if (!f) return;
  const ext = profileExtents(profile);
  const stripes = c.kind === 'zebra' ? 6 : 5;
  const half = c.width / 2;
  for (let i = 0; i < stripes; i += 1) {
    const t = (i + 0.5) / stripes;
    const o = -ext.left + t * ext.width;
    const w = (ext.width / stripes) * (c.kind === 'zebra' ? 0.72 : 0.55);
    const quad = [
      f.pointAt(o - w / 2, 0.014 + (c.raised ? 0.06 : 0)),
      f.pointAt(o + w / 2, 0.014 + (c.raised ? 0.06 : 0)),
    ];
    const back = frameNear(frames, c.s + half);
    const fwd = frameNear(frames, c.s - half);
    if (!back || !fwd) return;
    pushPoly([
      [fwd.pointAt(o - w / 2, 0.014)[0], fwd.pointAt(o - w / 2, 0.014)[1], fwd.pointAt(o - w / 2, 0.014)[2]],
      [fwd.pointAt(o + w / 2, 0.014)[0], fwd.pointAt(o + w / 2, 0.014)[1], fwd.pointAt(o + w / 2, 0.014)[2]],
      [back.pointAt(o + w / 2, 0.014)[0], back.pointAt(o + w / 2, 0.014)[1], back.pointAt(o + w / 2, 0.014)[2]],
      [back.pointAt(o - w / 2, 0.014)[0], back.pointAt(o - w / 2, 0.014)[1], back.pointAt(o - w / 2, 0.014)[2]],
    ], [236, 236, 236], { kind: 'crossing', layer: 2 });
    void quad;
  }
  // Beacons (zebra) or signal heads (signalised), on the kerb line at the crossing.
  for (const side of [1, -1]) {
    const o = side > 0 ? ext.right + 0.6 : -ext.left - 0.6;
    if (c.beacons) {
      for (const s of [c.s - half, c.s + half]) {
        const p = frameNear(frames, s);
        if (!p) continue;
        const at = p.pointAt(o, 0);
        pushProp(at[0], at[1], at[2], { kind: 'beacon', w: 0.24, h: 4.0, yaw: yawOf(p), colour: [246, 246, 246] });
      }
    }
    if (c.signals) {
      const at = f.pointAt(o, 0);
      pushProp(at[0], at[1], at[2], { kind: 'signal', w: 0.34, h: 3.1, yaw: yawOf(f) + Math.PI, colour: [42, 44, 48] });
    }
  }
  void offsets;
}

function buildHump(frames, h, offsets, pushPoly, pushLine) {
  const back = frameNear(frames, h.s + h.width / 2);
  const fwd = frameNear(frames, h.s - h.width / 2);
  if (!back || !fwd) return;
  const inner = profileExtentsOf(offsets);
  const w = Math.min(inner.right, inner.left) - 0.3;
  if (w < 1.2) return;
  pushPoly([
    fwd.pointAt(-w, h.height), fwd.pointAt(w, h.height), back.pointAt(w, h.height), back.pointAt(-w, h.height),
  ], [88, 84, 76], { kind: 'hump', layer: 3 });
  for (let i = -5; i <= 5; i += 1) {
    const o = (i / 5) * (w - 0.2);
    // yellow / black chevrons: the hump has to be visible before it is felt
    pushLine([fwd.pointAt(o, h.height + 0.01), back.pointAt(o, h.height + 0.01)], {
      kind: 'marking', pattern: 'solid', colour: i % 2 === 0 ? [230, 196, 70] : [40, 40, 42], width: 0.22,
    });
  }
}

function buildBollards(frames, b, offsets, pushProp, profile) {
  const ext = profileExtents(profile);
  if (b.across) {
    const f = frameNear(frames, b.s);
    if (!f) return;
    for (let i = 0; i < b.count; i += 1) {
      const o = -ext.left + ((i + 0.5) / b.count) * ext.width;
      const p = f.pointAt(o, 0);
      pushProp(p[0], p[1], p[2], { kind: 'bollard', w: 0.16, h: 1.0, yaw: yawOf(f), colour: [58, 60, 64], variant: b.kind });
    }
    return;
  }
  const f = frameNear(frames, b.s);
  if (!f) return;
  const o = b.offset ?? (b.side === 'right' ? ext.right - 0.5 : -ext.left + 0.5);
  const p = f.pointAt(o, 0);
  const colour = b.kind === 'illuminated' ? [236, 214, 150] : b.kind === 'concrete chunky' ? [186, 182, 174] : [62, 64, 68];
  pushProp(p[0], p[1], p[2], { kind: 'bollard', w: 0.15, h: 0.95, yaw: yawOf(f), colour, variant: b.kind });
}

function buildBusStop(frames, b, offsets, pushPoly, pushProp) {
  const f = frameNear(frames, b.s);
  if (!f) return;
  const ext = profileExtents({ right: offsets.map((o) => o.strip).filter((s) => s.from >= 0), left: offsets.map((o) => o.strip).filter((s) => s.to <= 0), centre: null });
  const inner = profileExtentsOf(offsets);
  const o = b.side === 'right' ? inner.right + 1.2 : -inner.left - 1.2;
  const p = f.pointAt(o, 0);
  if (b.shelter) {
    pushProp(p[0], p[1], p[2], { kind: 'shelter', w: 1.6, h: 2.5, d: 4.6, yaw: yawOf(f), colour: [78, 82, 88], variant: b.kind });
    const roof = [];
    const a = frameNear(frames, b.s - 2.3);
    const c = frameNear(frames, b.s + 2.3);
    if (a && c) {
      const oi = o - (b.side === 'right' ? 0.9 : -0.9);
      const of = o + (b.side === 'right' ? 0.9 : -0.9);
      roof.push(a.pointAt(oi, 2.5), c.pointAt(oi, 2.5), c.pointAt(of, 2.5), a.pointAt(of, 2.5));
      pushPoly(roof, [64, 68, 74], { kind: 'shelter-roof', layer: 4 });
    }
  }
  pushProp(p[0], p[1], p[2], { kind: 'sign', sign: 'bus stop', w: 0.6, h: 3.0, yaw: yawOf(f), colour: [80, 120, 180] });
  void ext;
  void pushPoly;
}

function buildSign(frames, s, offsets, pushProp) {
  const f = frameNear(frames, s.s);
  if (!f) return;
  const ext = profileExtentsOf(offsets);
  const o = s.side === 'right' ? ext.right + 1.0 : -ext.left - 1.0;
  const p = f.pointAt(o, 0);
  pushProp(p[0], p[1], p[2], { kind: 'sign', sign: s.kind, w: 0.75, h: 2.3, yaw: yawOf(f), colour: [196, 196, 200] });
}

function buildLight(frames, l, offsets, pushProp) {
  const f = frameNear(frames, l.s);
  if (!f) return;
  const ext = profileExtentsOf(offsets);
  const o = l.side === 'centre' ? 0 : l.side === 'right' ? ext.right + 0.6 : -ext.left - 0.6;
  const p = f.pointAt(o, 0);
  pushProp(p[0], p[1], p[2], { kind: 'light', w: 0.22, h: l.kind.startsWith('12') || l.kind.startsWith('15') ? 12 : 8, yaw: yawOf(f), colour: [92, 94, 98], variant: l.kind, arm: l.side });
}

function buildGully(frames, g, offsets, pushProp) {
  const f = frameNear(frames, g.s);
  if (!f) return;
  const ext = profileExtentsOf(offsets);
  const o = g.side === 'right' ? ext.right - 0.35 : -ext.left + 0.35;
  const p = f.pointAt(o, 0);
  pushProp(p[0], p[1] + 0.02, p[2], { kind: 'gully', w: 0.45, h: 0.03, d: 0.9, yaw: yawOf(f), colour: [44, 44, 46] });
}

function buildManhole(frames, m, offsets, pushProp) {
  const f = frameNear(frames, m.s);
  if (!f) return;
  const inner = profileExtentsOf(offsets);
  const o = m.side === 'right' ? inner.right * 0.4 : inner.left * 0.4;
  const p = f.pointAt(o, 0);
  pushProp(p[0], p[1] + 0.01, p[2], { kind: 'manhole', w: 0.75, h: 0.02, d: 0.75, yaw: yawOf(f), colour: [58, 58, 60] });
}

function buildPassing(frames, pp, offsets, pushPoly, profile) {
  const a = frameNear(frames, pp.s - pp.len / 2);
  const b = frameNear(frames, pp.s + pp.len / 2);
  if (!a || !b) return;
  const ext = profileExtentsOf(offsets);
  const inner = pp.side === 'right' ? ext.right : -ext.left;
  const outer = inner + (pp.side === 'right' ? pp.width : -pp.width);
  pushPoly([
    a.pointAt(inner, 0.006), a.pointAt(outer, 0.006), b.pointAt(outer, 0.006), b.pointAt(inner, 0.006),
  ], [84, 80, 74], { kind: 'passing-place', layer: 1, profile });
}

function buildChicane(frames, c, offsets, pushPoly, profile) {
  const a = frameNear(frames, c.s - c.len / 2);
  const b = frameNear(frames, c.s + c.len / 2);
  if (!a || !b) return;
  const ext = profileExtentsOf(offsets);
  const inner = c.side === 'right' ? ext.right - 1.2 : -ext.left + 1.2;
  const outer = c.side === 'right' ? ext.right + 1.6 : -ext.left - 1.6;
  pushPoly([
    a.pointAt(inner, 0.006), a.pointAt(outer, 0.006), b.pointAt(outer, 0.006), b.pointAt(inner, 0.006),
  ], [96, 92, 86], { kind: 'chicane', layer: 1, profile });
  pushPoly([
    a.pointAt(inner, 0.15), a.pointAt(outer, 0.15), b.pointAt(outer, 0.15), b.pointAt(inner, 0.15),
  ], [70, 84, 58], { kind: 'chicane-planting', layer: 2, profile });
}

function buildWear(frames, w, offsets, pushPoly, road) {
  const a = frameNear(frames, w.s);
  const b = frameNear(frames, Math.min(w.s + w.len, frames[frames.length - 1].s));
  if (!a || !b) return;
  const inner = profileExtentsOf(offsets);
  const base = w.side === 'right' ? inner.right * 0.45 : inner.left * 0.45;
  const o1 = base - w.width / 2;
  const o2 = base + w.width / 2;
  const tint = w.kind === 'oil stain' ? [46, 46, 48] : w.kind === 'reinstatement' ? [70, 70, 74] : [64, 64, 66];
  pushPoly([
    a.pointAt(o1, 0.007), a.pointAt(o2, 0.007), b.pointAt(o2, 0.007), b.pointAt(o1, 0.007),
  ], tint, { kind: 'wear', layer: 1, roadId: road.id });
}

function buildSubway(frames, sw, offsets, pushProp, pushPoly) {
  const f = frameNear(frames, sw.s);
  if (!f) return;
  const ext = profileExtentsOf(offsets);
  const o = sw.side === 'right' ? ext.right + 3 : -ext.left - 3;
  const p = f.pointAt(o, 0);
  pushProp(p[0], p[1], p[2], { kind: 'subway-entrance', w: 3.4, h: 2.8, d: 5.0, yaw: yawOf(f), colour: [104, 104, 110] });
  pushProp(p[0], p[1] + 2.9, p[2], { kind: 'subway-sign', w: 1.6, h: 1.6, yaw: yawOf(f), colour: [86, 108, 156] });
  const stair = [];
  const a = frameNear(frames, sw.s - 1.6);
  const b = frameNear(frames, sw.s + 1.6);
  if (a && b) {
    const oi = o - 1.5;
    const of = o + 1.5;
    stair.push(a.pointAt(oi, 0.05), b.pointAt(oi, 0.05), b.pointAt(of, 0.05), a.pointAt(of, 0.05));
    pushPoly(stair, [92, 92, 96], { kind: 'subway-stair', layer: 2 });
  }
}

function buildGuardrail(frames, r, offsets, pushLine, pushProp) {
  const inner = profileExtentsOf(offsets);
  const s0 = Math.max(0, r.s0);
  const s1 = Math.min(frames[frames.length - 1].s, r.s1);
  if (s1 - s0 < 4) return;
  const sides = r.side === 'both' ? [inner.right + 0.6, -inner.left - 0.6] : [r.side === 'right' ? inner.right + 0.6 : -inner.left - 0.6];
  for (const o of sides) {
    const pts = [];
    for (let s = s0; s <= s1; s += 4) {
      const f = frameNear(frames, s);
      if (f) pts.push(f.pointAt(o, 0.72));
    }
    pushLine(pts, { kind: 'guardrail', colour: [168, 168, 172], width: 0.16 });
    for (let s = s0; s <= s1; s += 4) {
      const f = frameNear(frames, s);
      if (!f) continue;
      const p = f.pointAt(o, 0.36);
      pushProp(p[0], p[1], p[2], { kind: 'guardrail-post', w: 0.12, h: 0.7, yaw: yawOf(f), colour: [150, 150, 154] });
    }
  }
}

function buildTerrain(project, pushPoly, step) {
  const size = project.options.size;
  const half = size / 2;
  const n = Math.max(12, Math.round(size / step));
  const cell = size / n;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const x0 = -half + i * cell;
      const x1 = x0 + cell;
      const z0 = -half + j * cell;
      const z1 = z0 + cell;
      const c = [(x0 + x1) / 2, (z0 + z1) / 2];
      const hc = project.terrain.height(c[0], c[1]);
      if (hc < -6) continue; // deep water is drawn by the water pass instead
      const water = project.terrain.isWater(c[0], c[1]);
      const h = (x, z) => project.terrain.height(x, z);
      const colour = water
        ? [46, 66, 84]
        : hc > 34 ? [104, 100, 92] : hc > 18 ? [92, 96, 84] : hc > 6 ? [82, 92, 66] : [74, 86, 62];
      pushPoly(
        [[x0, h(x0, z0), z0], [x1, h(x1, z0), z0], [x1, h(x1, z1), z1], [x0, h(x0, z1), z1]],
        colour,
        { kind: water ? 'water' : 'terrain', layer: -10 },
      );
    }
  }
}

/* ── Small helpers ───────────────────────────────────────────────────────────────────────────────── */

function frameNear(frames, s) {
  if (!frames.length) return null;
  if (s <= frames[0].s) return frames[0];
  const last = frames[frames.length - 1];
  if (s >= last.s) return last;
  let lo = 0;
  let hi = frames.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].s <= s) lo = mid; else hi = mid;
  }
  const a = frames[lo];
  const b = frames[hi];
  const span = Math.max(b.s - a.s, 1e-6);
  const u = (s - a.s) / span;
  const mix = (x, y) => x + (y - x) * u;
  const n = [mix(a.n[0], b.n[0]), 0, mix(a.n[2], b.n[2])];
  const p = [mix(a.p[0], b.p[0]), mix(a.p[1], b.p[1]), mix(a.p[2], b.p[2])];
  return {
    p, s, n, upstand: mix(a.upstand || 0.125, b.upstand || 0.125), bank: mix(a.bank || 0, b.bank || 0), span: a.span,
    pointAt: (o, dy) => [p[0] + n[0] * o, p[1] + dy, p[2] + n[2] * o],
  };
}

function profileExtentsOf(offsets) {
  if (!offsets.length) return { left: 0, right: 0, width: 0 };
  return { left: -offsets[0].from, right: offsets[offsets.length - 1].to, width: offsets[offsets.length - 1].to - offsets[0].from };
}

function sAt(frames, p) {
  let best = 0;
  let bd = Infinity;
  for (const f of frames) {
    const d = Math.hypot(f.p[0] - p[0], f.p[2] - p[1]);
    if (d < bd) { bd = d; best = f.s; }
  }
  return best;
}

function yawOf(f) {
  return Math.atan2(f.n[0], f.n[2]);
}

function nodeReach(project, nodeId, roadId) {
  const node = project.nodes.find((n) => n.id === nodeId);
  if (!node || node.arms.length < 3) return 0;
  return armReach(project, node, roadId);
}

function shade(rgb, f) {
  return [rgb[0] * f, rgb[1] * f, rgb[2] * f];
}
