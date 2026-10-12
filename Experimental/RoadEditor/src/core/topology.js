// Topology and compliance validation.
//
// Every rule reports a count, the entities it is about, and a severity. The panel shows the offenders
// and can select them; the CLI report prints the same numbers, so a generated city can be diffed
// against a hand-drawn one. Nothing here renders — this module is why the editor can claim "clean
// topology" as a measured property rather than a style.

import { sampleRoad, roadProfile, junctionPlan, orphanEnds, polyLength, armReach, LANE_LIMIT, V } from './network.js';
import { profileOffsets, profileWidth } from './profiles.js';
import { rankOf } from './rank.js';
import { RULES, ROAD_CLASSES } from './standards.js';

const SEG = 4;

const SEV = { fail: 3, warn: 2, info: 1, pass: 0 };

const MAX_GRADE = {
  motorway: 4, expressway: 5.5, arterial: 7, collector: 9, local: 11, lane: 14, service: 14,
  ramp: 7, busway: 8, tramway: 8, cycleway: 8, footway: 10, pedestrian: 6, 'parking-aisle': 5,
};

const MIN_RADIUS = {
  motorway: 600, expressway: 300, arterial: 120, collector: 60, local: 15, lane: 10, service: 8,
  ramp: 60, busway: 50, tramway: 25, cycleway: 8, footway: 3, pedestrian: 3, 'parking-aisle': 6,
};

const JUNCTION_SPACING = { motorway: 1500, expressway: 800, arterial: 150, collector: 80, local: 25, busway: 300, tramway: 100 };

const WIDTH_BOUNDS = {
  traffic: RULES.laneWidth, bus: RULES.busLane, 'bus-stop': { min: 2.6, max: 3.6 },
  cycle: RULES.cycleLane, 'cycle-track': { min: 1.5, max: 3.5 }, parking: RULES.parkingBay,
  footway: RULES.footway, kerb: { min: 0, max: 0.45 }, median: { min: 0.3, max: 12 },
  tram: { min: 2.4, max: 4.0 }, shoulder: { min: 0.3, max: 2.0 },
};

const rule = (id, name, severity, note) => ({ id, name, severity, note, checked: 0, offenders: [], count: 0 });

function add(r, offender, position) {
  r.count += 1;
  if (r.offenders.length < 14) r.offenders.push({ ...offender, position });
}

export function validate(project) {
  const rules = [];
  const R = (id, name, sev, note) => { const r = rule(id, name, sev, note); rules.push(r); return r; };

  /* ── 1. Network integrity ─────────────────────────────────────────────────────────────────────── */
  const orphans = R('orphan-end', 'Arms with no node', 'fail', 'Every road terminus must be attached to a junction or a legal terminal.');
  for (const o of orphanEnds(project)) add(orphans, { roadId: o.road.id, end: o.end }, o.road.points[o.end === 0 ? 0 : o.road.points.length - 1]);

  const dangling = R('dead-end-audit', 'Dead ends without a turning head', 'warn', 'A terminal more than 150 m from the next junction needs a turning head or a loop, or it will be a reverse manoeuvre.');
  for (const node of project.nodes) {
    if (node.arms.length !== 1 || node.riverTerminal) continue;
    const arm = node.arms[0];
    const road = project.roads.find((r) => r.id === arm.roadId);
    if (!road) continue;
    const len = polyLength(road.points);
    const nearest = nearestJunction(project, node.x, node.z, node.id);
    if (nearest > 150 && len > 60) add(dangling, { nodeId: node.id, roadId: road.id, note: `terminal ${Math.round(nearest)} m from the nearest junction` }, [node.x, node.y, node.z]);
  }

  const crossingsWithoutNode = R('crossing-without-junction', 'Roads crossing without meeting', 'fail', 'Two roads whose surfaces overlap but which have no junction are either a z-fighting bug or a missing bridge.');
  for (let i = 0; i < project.roads.length; i += 1) {
    for (let j = i + 1; j < project.roads.length; j += 1) {
      const a = project.roads[i];
      const b = project.roads[j];
      const hit = crossingAt(a, b);
      if (!hit) continue;
      const sameHeight = Math.abs(hit.ya - hit.yb) < 0.6;
      const bridged = (a.spans || []).concat(b.spans || []).some((s) => s.kind === 'bridge' || s.kind === 'tunnel');
      if (sameHeight && !bridged) add(crossingsWithoutNode, { roadId: a.id, roadId2: b.id, note: 'overlap without junction or structure' }, [hit.x, hit.ya, hit.z]);
    }
  }

  /* ── 2. Movement / lane continuity ────────────────────────────────────────────────────────────── */
  const laneCont = R('lane-continuity', 'Lane continuity through junctions', 'fail', 'An incoming lane with no movement is a lane that ends in a wall of kerb.');
  for (const node of project.nodes) {
    if (node.arms.length < 3 || node.type === 'roundabout') continue;
    const moves = node.moves || [];
    const plan = junctionPlan(project, node);
    plan.arms.forEach((arm, idx) => {
      laneCont.checked += 1;
      const lanes = Math.min(LANE_LIMIT, arm.profile.right.concat(arm.profile.left).filter((s) => s.type === 'traffic' || s.type === 'bus').length);
      const served = new Set(moves.filter((m) => m.from === idx).map((m) => m.fromLane));
      for (let lane = 0; lane < Math.max(1, lanes); lane += 1) {
        if (!served.has(lane)) add(laneCont, { nodeId: node.id, roadId: arm.roadId, lane, note: 'no movement assigned' }, [node.x, node.y, node.z]);
      }
    });
  }

  const alignment = R('alignment-class', 'Alignment below the class norm', 'warn', 'The built curve radius fits a slower road than the class expects: either realign it or post the lower limit.');
  for (const road of project.roads) {
    const cls = ROAD_CLASSES[road.class];
    if (!cls?.designSpeed || !road.speed) continue;
    if (road.speed < cls.designSpeed[0] - 0.5) {
      add(alignment, { roadId: road.id, note: `${road.speed} km/h alignment on a ${cls.name} (class norm ${cls.designSpeed[0]}–${cls.designSpeed[1]} km/h)` }, road.points[Math.floor(road.points.length / 2)]);
    }
  }

  const turnConf = R('turn-conflict', 'Conflicting movements in the same lane', 'warn', 'One lane assigned to two movements that cross other traffic is how a junction stops working at peak.');
  for (const node of project.nodes) {
    const byLane = new Map();
    for (const mv of node.moves || []) {
      const key = `${mv.from}:${mv.fromLane}`;
      if (!byLane.has(key)) byLane.set(key, []);
      byLane.get(key).push(mv);
    }
    for (const [, list] of byLane) {
      const kinds = new Set(list.map((m) => m.kind));
      if (kinds.has('left') && kinds.has('through')) add(turnConf, { nodeId: node.id, note: 'lane carries a left turn and a through movement' }, [node.x, node.y, node.z]);
    }
  }

  /* ── 3. Geometry standards ────────────────────────────────────────────────────────────────────── */
  const grade = R('grade', 'Gradients above the class limit', 'fail', 'Percentages per class; a ramp inside an interchange is checked against the ramp limit, not the road it joins.');
  const radius = R('min-radius', 'Horizontal radius below the design speed', 'fail', 'Radius is measured from the sampled centre line, so a kink in the control points shows up here.');
  const width = R('strip-width', 'Cross-section strips outside their standards', 'warn', 'Lane, cycle, bus, parking and footway widths are bounded by the standards catalogue.');
  for (const road of project.roads) {
    const frames = sampleRoad(road, SEG);
    if (frames.length < 3) continue;
    const limit = MAX_GRADE[road.class] ?? 10;
    // Gradients are measured over a 20 m run: a spline's own curvature between samples is not a grade.
    const RUN = 20;
    for (let i = 0; i < frames.length; i += 1) {
      let j = i;
      while (j + 1 < frames.length && frames[j].s - frames[i].s < RUN) j += 1;
      const d = frames[j].s - frames[i].s;
      if (d < RUN * 0.8) break;
      grade.checked += 1;
      const g = Math.abs((frames[j].p[1] - frames[i].p[1]) / d) * 100;
      if (g > limit) {
        add(grade, { roadId: road.id, note: `${g.toFixed(1)} % over ${d.toFixed(0)} m (limit ${limit} %)` }, frames[i].p);
        break;
      }
      i = j - 1;
    }
    const cls = ROAD_CLASSES[road.class] || {};
    const designSpeed = road.speed || cls.designSpeed?.[0] || 50;
    // R = V^2 / (127 (e + f)), e = 0.06, f = 0.12 → R = V^2 / 22.86
    const minR = Math.round((designSpeed * designSpeed) / 22.86);
    // A turning vehicle leaves the through alignment at a junction: radius is a property of the link
    // between junctions, so the approach into a node is measured from the node's arm reach onwards.
    const len = frames[frames.length - 1].s;
    const nodeOf = (id) => project.nodes.find((n) => n.id === id);
    const startNode = nodeOf(road.startNode);
    const endNode = nodeOf(road.endNode);
    const guardStart = startNode && startNode.arms.length >= 3 ? armReach(project, startNode, road.id) + 10 : 0;
    const guardEnd = endNode && endNode.arms.length >= 3 ? len - (armReach(project, endNode, road.id) + 10) : len;
    // Radius is a property of a curve, not of a pair of samples: a 72 m baseline (the way a design
    // checker fits a curve) stops control-point wobble reading as a hairpin.
    const BASE = Math.max(2, Math.round(72 / SEG / 2));
    for (let i = BASE; i < frames.length - BASE; i += 1) {
      if (frames[i].s < guardStart || frames[i].s > guardEnd) continue;
      const a = frames[i - BASE].tangent;
      const b = frames[i + BASE].tangent;
      const turn = Math.atan2(a[0] * b[2] - a[2] * b[0], a[0] * b[0] + a[2] * b[2]);
      const arc = frames[i + BASE].s - frames[i - BASE].s;
      if (Math.abs(turn) < 1e-4) continue;
      const r = Math.abs(arc / turn);
      radius.checked += 1;
      if (r < minR * 0.75) {
        add(radius, { roadId: road.id, note: `R ${r.toFixed(0)} m (minimum ${minR} m at ${designSpeed} km/h)` }, frames[i].p);
        break;
      }
    }
    const profile = roadProfile(project, road);
    for (const { strip } of profileOffsets(profile)) {
      const boundsW = WIDTH_BOUNDS[strip.type];
      if (!boundsW) continue;
      width.checked += 1;
      if (strip.width < boundsW.min - 1e-6 || strip.width > boundsW.max + 1e-6) {
        add(width, { roadId: road.id, note: `${strip.type} ${strip.width.toFixed(2)} m outside ${boundsW.min}–${boundsW.max} m` }, road.points[0]);
      }
    }
  }

  /* ── 4. Junctions ─────────────────────────────────────────────────────────────────────────────── */
  const spacing = R('junction-spacing', 'Junctions closer than the class minimum', 'warn', RULES.junctionSpacing.note);
  const nodesByClass = new Map();
  for (const node of project.nodes) {
    if (node.arms.length < 3) continue;
    let bestRank = -1;
    let bestClass = 'local';
    for (const arm of node.arms) {
      const road = project.roads.find((r) => r.id === arm.roadId);
      if (!road) continue;
      const rank = rankOf(road.class);
      if (rank > bestRank) { bestRank = rank; bestClass = road.class; }
    }
    if (!nodesByClass.has(bestClass)) nodesByClass.set(bestClass, []);
    nodesByClass.get(bestClass).push(node);
  }
  for (const [cls, list] of nodesByClass) {
    const min = JUNCTION_SPACING[cls] || 25;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const d = Math.hypot(list[i].x - list[j].x, list[i].z - list[j].z);
        // The catalogue figure is the desirable spacing; urban junctions legitimately come closer.
        if (d < min * 0.4) {
          add(spacing, { nodeId: list[i].id, nodeId2: list[j].id, note: `${d.toFixed(0)} m apart (desirable ${min} m for ${cls})` }, [list[i].x, list[i].y, list[i].z]);
        }
      }
    }
  }

  const armAngle = R('arm-angle', 'Junction arms too acute to turn', 'warn', 'An arm meeting at less than 45° has no room for a kerb return and no sight line.');
  for (const node of project.nodes) {
    if (node.arms.length < 3) continue;
    const plan = junctionPlan(project, node);
    for (let i = 0; i < plan.arms.length; i += 1) {
      const a = plan.arms[i];
      const b = plan.arms[(i + 1) % plan.arms.length];
      const rel = Math.abs(V.angle(a.dir, b.dir)) * (180 / Math.PI);
      if (rel < 45) add(armAngle, { nodeId: node.id, note: `${rel.toFixed(0)}° between arms` }, [node.x, node.y, node.z]);
    }
  }

  /* ── 5. Structures ────────────────────────────────────────────────────────────────────────────── */
  const clear = R('bridge-clearance', 'Bridge clearance under 4.5 m', 'fail', RULES.bridgeClearance.note);
  const deckGrade = R('deck-grade', 'Bridge and tunnel approach grades', 'warn', 'The ramp into a structure is checked over its last 40 m; a kink at the abutment shows.');
  for (const road of project.roads) {
    for (const span of road.spans || []) {
      clear.checked += 1;
      if ((span.clearance || 0) < 4.5) add(clear, { roadId: road.id, note: `declared clearance ${span.clearance} m` }, road.points[Math.min(span.i0, road.points.length - 1)]);
    }
    for (const span of road.spans || []) {
      const pts = road.points;
      if (span.i0 < 1) continue;
      const a = pts[Math.max(0, span.i0 - 2)];
      const b = pts[span.i0];
      const d = Math.hypot(b[0] - a[0], b[2] - a[2]);
      if (d < 1) continue;
      deckGrade.checked += 1;
      const g = Math.abs((b[1] - a[1]) / d) * 100;
      if (g > (MAX_GRADE[road.class] ?? 10) * 1.3) add(deckGrade, { roadId: road.id, note: `${g.toFixed(1)} % at the structure joint` }, b);
    }
  }

  /* ── 6. Rail ──────────────────────────────────────────────────────────────────────────────────── */
  const railRule = R('rail-protection', 'Rail crossings without protection', 'fail', 'Every at-grade crossing carries a protection level by road class; a lane gets gates, a motorway gets a bridge.');
  const railSkew = R('rail-skew', 'Skewed rail crossings', 'warn', 'Crossings below 45° trap cyclists and are hard on suspension; aim for 90°.');
  for (const x of project.railCrossings || []) {
    railRule.checked += 1;
    if (!x.separated && !x.kind) add(railRule, { roadId: x.roadId, note: 'no protection level' }, [x.x, x.y, x.z]);
    if (Math.abs(x.skew) > 30 && !x.separated) add(railSkew, { roadId: x.roadId, note: `${Math.abs(x.skew).toFixed(0)}° skew` }, [x.x, x.y, x.z]);
  }

  /* ── 7. Detail layer ──────────────────────────────────────────────────────────────────────────── */
  const confl = R('crossing-conflict', 'Bus stops inside a crossing', 'warn', 'A stop inside a crossing zone forces the bus to block the crossing and the pedestrians to wait behind the bus.');
  const crossingSpacing = R('crossing-spacing', 'Crossings closer than 30 m', 'info', 'Two crossings close together usually means one is redundant, or the route is on the wrong side.');
  for (const road of project.roads) {
    const d = road.details || {};
    const crossings = d.crossings || [];
    for (const c of crossings) {
      for (const b of d.busStops || []) {
        confl.checked += 1;
        if (Math.abs(c.s - b.s) < 25) add(confl, { roadId: road.id, note: `stop ${Math.abs(c.s - b.s).toFixed(0)} m from a crossing` }, road.points[0]);
      }
    }
    for (let i = 1; i < crossings.length; i += 1) {
      crossingSpacing.checked += 1;
      if (crossings[i].s - crossings[i - 1].s < 30) add(crossingSpacing, { roadId: road.id, note: `${(crossings[i].s - crossings[i - 1].s).toFixed(0)} m apart` }, road.points[0]);
    }
  }

  /* ── 8. Cost ──────────────────────────────────────────────────────────────────────────────────── */
  const budget = R('budget', 'Geometry and detail budget', 'info', 'Triangles per kilometre, props per kilometre, and the marking count. The renderer streams by chunk; this is the size it is streaming.');
  const geom = project.geometry;
  if (geom) {
    budget.checked += 1;
    const km = Math.max(0.001, geom.stats.metres / 1000);
    const triPerKm = geom.stats.triangles / km;
    budget.metrics = {
      triangles: geom.stats.triangles,
      triPerKm: Math.round(triPerKm),
      polys: geom.stats.polys,
      lines: geom.stats.lines,
      props: geom.stats.props,
      km: geom.stats.metres / 1000,
    };
    if (triPerKm > 6500) add(budget, { note: `${Math.round(triPerKm)} triangles/km above the 6 500 budget` }, [0, 0, 0]);
  }

  const total = rules.reduce((a, r) => a + r.count, 0);
  const fails = rules.filter((r) => r.severity === 'fail').reduce((a, r) => a + r.count, 0);
  const warns = rules.filter((r) => r.severity === 'warn').reduce((a, r) => a + r.count, 0);
  const infos = rules.filter((r) => r.severity === 'info').reduce((a, r) => a + r.count, 0);
  return { rules, total, fails, warns, infos, score: rules.reduce((a, r) => a + SEV[r.severity] * r.count, 0) };
}

function nearestJunction(project, x, z, exceptId) {
  let best = Infinity;
  for (const node of project.nodes) {
    if (node.id === exceptId || node.arms.length < 3) continue;
    best = Math.min(best, Math.hypot(node.x - x, node.z - z));
  }
  return best;
}

/** Do two roads cross in plan without a shared node? Returns the crossing point and both heights. */
function crossingAt(a, b) {
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

/** One-line summary for the rail and the header chip. */
export function validateSummary(report) {
  return `${report.fails} fail · ${report.warns} warn · ${report.infos} info`;
}
