// Procedural map generator. Produces an authored Project (control points and profiles), never geometry:
// the editor and the mesh builder consume the same data as a hand-drawn network.
//
// Layout (4 km square map):
//   - a city grid of 7 x 7 street lines, arterials every third line, joined to an elevated ring road
//   - an elevated east-west motorway crossing the whole city (grade-separated from every street)
//   - a diagonal railway with level crossings where it meets streets at ground height
//   - river crossings where roads pass over the channel on raised decks
//   - countryside roads and dirt tracks between the city and the map edge
//   - footpaths and cycleways inside city blocks, and an underground subway line
// Every road gets its own seeded variations, so no two roads share a look.

import { ControlPoint, Project, Road, BridgeType } from "./model";
import { ProfileId, RoadOptions } from "./profiles";
import { Rng } from "./math";
import { buildNetwork } from "./topology";
import { validateNetwork } from "./validate";
import { isOverRiver } from "./terrain";

export const CITY_GRID = [-480, -320, -160, 0, 160, 320, 480];
export const RING_RADIUS = 760;
export const RING_LIFT = 7;
export const MOTORWAY_Z = 40;
export const MOTORWAY_LIFT = 12;

export interface GenerateReport {
  roads: number;
  pruned: number;
  overlaps: number;
  shallow: number;
  attempts: number;
}

const cp = (x: number, z: number, lift = 0): ControlPoint => ({ x, z, lift });

// Adds a jittered midpoint between each pair of control points so straight lines read as streets.
function wobble(points: ControlPoint[], rng: Rng, amount: number): ControlPoint[] {
  const out: ControlPoint[] = [];
  for (let k = 0; k < points.length; k++) {
    out.push(points[k]);
    if (k < points.length - 1) {
      const a = points[k];
      const b = points[k + 1];
      out.push(cp((a.x + b.x) / 2 + rng.range(-amount, amount), (a.z + b.z) / 2 + rng.range(-amount, amount), (a.lift + b.lift) / 2));
    }
  }
  return out;
}

function urbanOptions(profile: ProfileId, rng: Rng): RoadOptions {
  switch (profile) {
    case "boulevard":
      return { lanes: rng.pick([1, 2] as const), bus: rng.chance(0.5), cycle: rng.chance(0.7), parking: rng.chance(0.5), sidewalks: true, lamps: true };
    case "avenue":
      return { lanes: 1, bus: rng.chance(0.3), cycle: rng.chance(0.4), parking: rng.chance(0.6), sidewalks: true, lamps: rng.chance(0.8) };
    case "street":
      return { parking: rng.chance(0.6), sidewalks: true, lamps: rng.chance(0.7), bollards: rng.chance(0.2) };
    case "residential":
      return { speedBumps: true, parking: rng.chance(0.8), sidewalks: rng.chance(0.7), lamps: rng.chance(0.5) };
    default:
      return {};
  }
}

// Removes roads that run on top of another road or that cross a rail line at ground level where they should not.
// Repeats until the network is clean, so a generated map never ships with overlapping geometry.
function prune(roads: Road[], report: GenerateReport): Road[] {
  let current = roads;
  for (let pass = 0; pass < 12; pass++) {
    const net = buildNetwork(current);
    const issues = validateNetwork(net);
    const bad = new Set<string>();
    for (const i of issues) {
      if (i.kind === "overlap") {
        report.overlaps++;
        bad.add(i.roadB);
      } else {
        report.shallow++;
      }
    }
    for (const c of net.crossings) {
      if (c.kind !== "level") continue;
      const other = current.find((r) => r.id === c.roadA && !isRail(r)) ?? current.find((r) => r.id === c.roadB && !isRail(r));
      if (other && (other.profile === "footpath" || other.profile === "cycleway")) bad.add(other.id);
    }
    if (bad.size === 0) break;
    report.pruned += bad.size;
    current = current.filter((r) => !bad.has(r.id));
  }
  return current;
}

const isRail = (r: Road): boolean => r.profile === "railway";

export function generateProject(seed: number): Project {
  return generateWithReport(seed).project;
}

export function generateWithReport(seed: number): { project: Project; report: GenerateReport } {
  const rng = new Rng(seed);
  const roads: Road[] = [];
  const report: GenerateReport = { roads: 0, pruned: 0, overlaps: 0, shallow: 0, attempts: 1 };

  const add = (name: string, profile: ProfileId, points: ControlPoint[], options: RoadOptions = {}, bridge: BridgeType = "auto"): void => {
    roads.push({ id: `r${roads.length + 1}`, name, profile, points, options, bridge, seed: rng.int(1, 0x7fffffff) });
  };

  // City street lines. Each line is split into pieces at intersections, so pieces end at crossings and
  // several lines meet cleanly at junctions. Each piece gets its own profile draw and options.
  const N = CITY_GRID.length;
  const streetNames = { v: ["Market", "Mill", "Harbour", "Station", "Church", "Forge", "Bridge"], h: ["North", "Canal", "Oak", "Hill", "Park", "Bank", "South"] };
  for (let i = 0; i < N; i++) {
    const x = CITY_GRID[i];
    const yRing = Math.sqrt(RING_RADIUS * RING_RADIUS - x * x);
    const arterial = i % 3 === 0;
    const pts: ControlPoint[] = [cp(x, -yRing, RING_LIFT), cp(x, -(yRing + 480) / 2, RING_LIFT / 2)];
    for (let j = 0; j < N; j++) pts.push(cp(x, CITY_GRID[j], 0));
    pts.push(cp(x, (yRing + 480) / 2, RING_LIFT / 2), cp(x, yRing, RING_LIFT));
    addLine(`${streetNames.v[i]} Street`, pts, arterial, i === 0 || i === N - 1);
  }
  for (let j = 0; j < N; j++) {
    const z = CITY_GRID[j];
    const xRing = Math.sqrt(RING_RADIUS * RING_RADIUS - z * z);
    const arterial = j % 3 === 0;
    const pts: ControlPoint[] = [cp(-xRing, z, RING_LIFT), cp(-(xRing + 480) / 2, z, RING_LIFT / 2)];
    for (let i = 0; i < N; i++) pts.push(cp(CITY_GRID[i], z, 0));
    pts.push(cp((xRing + 480) / 2, z, RING_LIFT / 2), cp(xRing, z, RING_LIFT));
    addLine(`${streetNames.h[j]} Road`, pts, arterial, j === 0 || j === N - 1);
  }

  function addLine(baseName: string, raw: ControlPoint[], arterial: boolean, outer: boolean): void {
    const pts = wobble(raw, rng, 7);
    // Split only at grid intersections. Wobbled points sit at even indices; the ramp ends are the first two and last two.
    const cuts: number[] = [0];
    const interior: number[] = [];
    for (let k = 4; k <= pts.length - 5; k += 2) interior.push(k);
    if (interior.length > 0 && rng.chance(0.5)) cuts.push(rng.pick(interior));
    if (interior.length > 3 && rng.chance(0.25)) cuts.push(rng.pick(interior));
    cuts.push(pts.length - 1);
    const uniq = [...new Set(cuts)].sort((a, b) => a - b);
    uniq.forEach((c, idx) => {
      if (idx === uniq.length - 1) return;
      const piece = pts.slice(c, uniq[idx + 1] + 1);
      const profile: ProfileId = arterial
        ? rng.chance(0.6) ? "boulevard" : "avenue"
        : outer ? (rng.chance(0.5) ? "residential" : "street") : rng.chance(0.55) ? "street" : "residential";
      const name = `${baseName}${uniq.length > 2 ? ` ${idx + 1}` : ""}`;
      add(name, profile, piece, urbanOptions(profile, rng), "auto");
    });
  }

  // Ring road: four quarters split at 45 degrees so no split falls on a street end.
  const ringSteps = 64;
  for (let q = 0; q < 4; q++) {
    const pts: ControlPoint[] = [];
    for (let k = 0; k <= ringSteps / 4; k++) {
      const th = ((45 + 90 * q + (90 * k) / (ringSteps / 4)) * Math.PI) / 180;
      pts.push(cp(RING_RADIUS * Math.cos(th), RING_RADIUS * Math.sin(th), RING_LIFT));
    }
    add(`Ring Road ${q + 1}`, "motorway", pts, { lanes: 2 }, "auto");
  }

  // Elevated motorway across the city: raised over the centre, ramping to ground beyond |x| = 1000.
  {
    const xs = [-1900, -1400, -1000, -800, -400, 0, 400, 800, 1000, 1400, 1900];
    const pts = xs.map((x) => cp(x, MOTORWAY_Z + rng.range(-6, 6), Math.abs(x) <= 800 ? MOTORWAY_LIFT : 0));
    add("Central Motorway", "motorway", pts, { lanes: 3 }, "auto");
  }

  // Diagonal railway through the city. Level crossings appear where it meets streets.
  {
    const pts: ControlPoint[] = [];
    for (let k = 0; k <= 12; k++) {
      const t = k / 12;
      pts.push(cp(-1800 + 3600 * t + 60 * Math.sin(t * 5), -1500 + 2900 * t + 40 * Math.cos(t * 4), 0));
    }
    add("Ring Line Railway", "railway", pts, {}, "auto");
  }

  // Subway line under the centre. Negative lift keeps it below the ground everywhere.
  {
    const pts = [cp(-640, -300, -12), cp(-320, -120, -12), cp(0, 0, -12), cp(320, 150, -12), cp(640, 300, -12)];
    add("Metro Line 1", "subway", pts, {}, "auto");
  }

  // River crossings. Lift is raised wherever the curve passes over the channel, so the deck spans the water.
  for (const [name, base, amp, freq] of [
    ["River Road", -1000, 120, 1 / 400],
    ["Floodplain Road", -1080, 200, 1 / 600]
  ] as const) {
    const pts: ControlPoint[] = [];
    const xs: number[] = [];
    for (let x = -1900; x <= 1900; x += 60) xs.push(x);
    const flags = xs.map((x) => isOverRiver({ x, z: base + amp * Math.sin(x * freq) }));
    xs.forEach((x, k) => {
      let dK = Infinity;
      flags.forEach((f, m) => {
        if (f) dK = Math.min(dK, Math.abs(m - k));
      });
      const lift = dK === Infinity ? 0 : 8 * Math.max(0, 1 - Math.max(0, dK - 1) / 2.5);
      pts.push(cp(x, base + amp * Math.sin(x * freq), lift));
    });
    add(name, "country", pts, { lamps: false }, "auto");
  }

  // Countryside roads and dirt tracks out to the map edge. Seeded random routes, validated later.
  for (let k = 0; k < 9; k++) {
    const a = rng.range(0, Math.PI * 2);
    const b = a + rng.range(1.2, 2.6);
    const ra = rng.range(980, 1200);
    const rb = rng.range(980, 1800);
    const start = cp(Math.cos(a) * ra, Math.sin(a) * ra, 0);
    const end = cp(Math.cos(b) * rb, Math.sin(b) * rb, 0);
    const mids: ControlPoint[] = [];
    for (let m = 1; m <= 3; m++) {
      const t = m / 4;
      const r = ra + (rb - ra) * t + rng.range(-160, 160);
      const th = a + (b - a) * t;
      mids.push(cp(Math.cos(th) * r, Math.sin(th) * r, 0));
    }
    const offroad = rng.chance(0.4);
    add(offroad ? `Forest Track ${k + 1}` : `Country Road ${k + 1}`, offroad ? "track" : "country", [start, ...mids, end], {}, "auto");
  }

  // Footpaths and cycleways inside city blocks: they start and end inside one block and never reach a street.
  for (let i = 0; i < N - 1; i++) {
    for (let j = 0; j < N - 1; j++) {
      if (j === 3) continue; // the motorway row
      const x0 = CITY_GRID[i];
      const x1 = CITY_GRID[i + 1];
      const z0 = CITY_GRID[j];
      const z1 = CITY_GRID[j + 1];
      if (rng.chance(0.4)) {
        const za = z0 + rng.range(40, 120);
        const zb = z0 + rng.range(40, 120);
        const pts = [cp(x0 + 35, za), cp((x0 + x1) / 2 + rng.range(-20, 20), (za + zb) / 2 + rng.range(-20, 20)), cp(x1 - 35, zb)];
        add(`Park Path ${roads.length + 1}`, "footpath", pts, { lamps: rng.chance(0.6), bollards: rng.chance(0.5) }, "auto");
      }
      if (rng.chance(0.2)) {
        const pts = [cp(x0 + 40, z0 + 40), cp((x0 + x1) / 2 + rng.range(-25, 25), (z0 + z1) / 2 + rng.range(-25, 25)), cp(x1 - 40, z1 - 40)];
        add(`Cycle Path ${roads.length + 1}`, "cycleway", pts, {}, "auto");
      }
    }
  }

  const pruned = prune(roads, report);
  report.roads = pruned.length;
  const project: Project = {
    format: "frontier-road-network",
    version: 1,
    name: `Generated map ${seed}`,
    seed,
    roads: pruned,
    props: []
  };
  return { project, report };
}
