// City generation.
//
// The generator answers the brief's "generate a city, roads only" without inventing a second editor:
// it writes the same road / node / rail records a human would draw, so every generated street is
// immediately editable, and the validator scores generated output exactly like hand-drawn output.
//
// Pipeline
//   1. terrain    — seeded value noise, a carved river, a hill ridge, a harbour edge
//   2. districts  — the block structure and the class charter each area is built to
//   3. proposals  — street alignments as 2D polylines, per layout family
//   4. stitching  — pairwise crossings become junctions, splits and terminal nodes; a crossing of two
//                   classes that are far enough apart becomes a bridge or an underpass instead
//   5. elevation   — terrain following, grade-limited, then bridge decks and tunnel bores
//   6. furnishing  — bus stops, crossings, humps, bollards, parking, signs, rail crossings, subways
//
// Everything is deterministic from (seed, size, layout, charter, toggles).

import { ROAD_CLASSES } from './standards.js';
import { profileById, profileWidth } from './profiles.js';
import { CLASS_RANK } from './rank.js';
import {
  makeRoad, makeNode, nextId, resetIds, sampleRoad, V, polyLength,
  clipWaterCrossings, connectDeadEnds, densifyRoads, sliceSpans, rebuildArms, snapArmHeights, sanitizeNetwork, foldDuplicates, stitchRoads,
} from './network.js';

/* ── Seeded randomness ───────────────────────────────────────────────────────────────────────────── */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hash2 = (x, y, seed) => {
  let h = Math.imul(Math.round(x * 127.1) ^ Math.round(y * 311.7), 0x27d4eb2d) ^ (seed * 0x9e3779b9);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

const smooth = (t) => t * t * (3 - 2 * t);
function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - xf) + b * xf) * (1 - yf) + (c * (1 - xf) + d * xf) * yf;
}

/* ── Terrain ─────────────────────────────────────────────────────────────────────────────────────── */

export function makeTerrain(seed, size) {
  const s = size / 3000;
  const river = [];
  const riverPhase = hash2(seed, 7, 91) * 6.28;
  let x = -size * 0.75;
  while (x < size * 0.75) {
    const u = (x + size * 0.75) / (size * 1.5);
    const z = Math.sin(riverPhase + u * 3.2) * size * 0.22 + Math.sin(riverPhase * 1.7 + u * 7.1) * size * 0.05;
    river.push([x, z]);
    x += size * 0.06;
  }
  const riverWidth = 34 * s + 18;
  const hillCx = (hash2(seed, 3, 17) - 0.5) * size * 0.5;
  const hillCz = (hash2(seed, 5, 23) - 0.5) * size * 0.5;

  function base(x, z) {
    let h = 0;
    h += (valueNoise(x / (900 * s), z / (900 * s), seed) - 0.5) * 34 * s;
    h += (valueNoise(x / (320 * s), z / (320 * s), seed + 11) - 0.5) * 11 * s;
    h += (valueNoise(x / (120 * s), z / (120 * s), seed + 29) - 0.5) * 3.2 * s;
    // one hill the motorway spine has to deal with
    const d = Math.hypot(x - hillCx, z - hillCz);
    h += Math.max(0, 1 - d / (620 * s)) * 46 * s;
    // harbour: the map's south-east corner falls away to the water
    const edge = Math.max(0, 1 - Math.hypot(x - size * 0.5, z - size * 0.42) / (size * 0.62));
    h -= edge * edge * 22 * s;
    return h;
  }

  function riverDistance(x, z) {
    let best = 1e9;
    for (let i = 1; i < river.length; i += 1) {
      const a = river[i - 1];
      const b = river[i];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const l2 = dx * dx + dz * dz || 1;
      let t = ((x - a[0]) * dx + (z - a[1]) * dz) / l2;
      t = Math.max(0, Math.min(1, t));
      const px = a[0] + dx * t;
      const pz = a[1] + dz * t;
      best = Math.min(best, Math.hypot(x - px, z - pz));
    }
    return best;
  }

  function height(x, z) {
    const d = riverDistance(x, z);
    let h = base(x, z);
    const carve = Math.max(0, 1 - d / (riverWidth * 2.6));
    h -= carve * carve * 26 * s;               // channel
    h = h * (1 - Math.max(0, 1 - d / riverWidth) * 0.2);
    return h;
  }

  return {
    seed, size,
    river, riverWidth,
    hill: [hillCx, hillCz],
    height,
    distanceToRiver: riverDistance,
    isWater: (x, z) => height(x, z) < 0,
    waterLevel: 0,
  };
}

/* ── Charters ────────────────────────────────────────────────────────────────────────────────────── */
//
// A charter is the city's street culture: which cross-section each class gets, how junctions are
// controlled, and how much of each mode is supplied. Selecting a charter in the Generate panel swaps
// every profile and detail habit in one move, which is how you audition "NFS arterial" against
// "Dutch 30 km/h" on the same seed.

export const CHARTERS = {
  'nfs-arterial': {
    id: 'nfs-arterial', name: 'NFS arterial', blurb: 'Wide, fast, legible. Bus and cycle provision on every arterial, big flowing junctions, a ring and a spine.',
    profiles: {
      motorway: 'motorway-2x3-median-barrier', expressway: 'expressway-2x2',
      arterial: 'avenue-2x2-bus-cycle', collector: 'collector-2x2',
      local: 'residential-street-parking-both-sides', ramp: 'ramp-slip-road',
      busway: 'busway-2-way', cycleway: 'cycleway-two-way', footway: 'footway-park-path',
      lane: 'single-track-lane-passing-places', service: 'service-alley',
      tramway: 'avenue-2x2-tram-in-median', pedestrian: 'pedestrian-street', 'parking-aisle': 'parking-aisle',
    },
    control: { arterial: 'signals', collector: 'yield', local: 'uncontrolled' },
    supply: { busNetwork: true, cycleNetwork: true, parking: true, humps: 0.2, roundaboutRate: 0.15, tram: false, rail: true },
  },
  'euro-mixed': {
    id: 'euro-mixed', name: 'European mixed', blurb: 'Asymmetric streets, tram boulevard, kerbed cycle tracks, mini-roundabouts, on-street parking.',
    profiles: {
      motorway: 'motorway-2x2-hard-shoulder', expressway: 'expressway-2x2',
      arterial: 'avenue-2x2-tram-in-median', collector: 'collector-parking-one-side',
      local: 'residential-street-2-way', lane: 'single-track-lane-passing-places',
      busway: 'busway-2-way', cycleway: 'cycleway-two-way', footway: 'footway-park-path',
      tramway: 'avenue-2x2-tram-in-median', pedestrian: 'pedestrian-street',
      service: 'service-alley', 'parking-aisle': 'parking-aisle', ramp: 'ramp-slip-road',
    },
    control: { arterial: 'signals', collector: 'mini-roundabout', local: 'yield' },
    supply: { busNetwork: true, cycleNetwork: true, parking: true, humps: 0.45, roundaboutRate: 0.35, tram: true, rail: true },
  },
  'us-grid': {
    id: 'us-grid', name: 'US grid', blurb: 'Long straight blocks, permissive movements, big surface parking, wide lanes, strip retail.',
    profiles: {
      motorway: 'motorway-2x3-median-barrier', expressway: 'expressway-2x2',
      arterial: 'arterial-2x2-painted-centre', collector: 'collector-2x2',
      local: 'residential-street-2-way', 'parking-aisle': 'parking-aisle',
      lane: 'single-track-lane-passing-places', service: 'service-alley',
      busway: 'busway-2-way', cycleway: 'cycleway-two-way', footway: 'footway-park-path',
      tramway: 'avenue-2x2-tram-in-median', pedestrian: 'pedestrian-street', ramp: 'ramp-slip-road',
    },
    control: { arterial: 'signals', collector: 'all-way stop', local: 'uncontrolled' },
    supply: { busNetwork: true, cycleNetwork: false, parking: true, humps: 0.05, roundaboutRate: 0.02, tram: false, rail: true },
  },
  dutch: {
    id: 'dutch', name: 'Dutch 30 km/h', blurb: 'Cycle streets, protected crossings, raised junction tables, humps by default, few through routes.',
    profiles: {
      motorway: 'motorway-2x2-hard-shoulder', expressway: 'trunk-road-2x2-at-grade',
      arterial: 'avenue-2x2-bus-cycle', collector: 'collector-parking-one-side',
      local: 'home-zone-shared-surface', lane: 'single-track-lane-passing-places',
      busway: 'busway-2-way', cycleway: 'cycleway-two-way', footway: 'footway-park-path',
      tramway: 'avenue-2x2-tram-in-median', pedestrian: 'pedestrian-street',
      service: 'service-alley', 'parking-aisle': 'parking-aisle', ramp: 'ramp-slip-road',
    },
    control: { arterial: 'signals', collector: 'roundabout', local: 'uncontrolled' },
    supply: { busNetwork: true, cycleNetwork: true, parking: true, humps: 0.8, roundaboutRate: 0.6, tram: true, rail: true },
  },
  british: {
    id: 'british', name: 'British mixed', blurb: 'Double yellows, single-track lanes with passing places, roundabouts, cat’s eyes, zebra crossings.',
    profiles: {
      motorway: 'motorway-2x2-hard-shoulder', expressway: 'trunk-road-2x2-at-grade',
      arterial: 'boulevard-2x2-trees-parking', collector: 'collector-parking-one-side',
      local: 'residential-street-2-way', lane: 'single-track-lane-passing-places',
      busway: 'busway-2-way', cycleway: 'cycleway-two-way', footway: 'footway-park-path',
      tramway: 'avenue-2x2-tram-in-median', pedestrian: 'pedestrian-street',
      service: 'service-alley', 'parking-aisle': 'parking-aisle', ramp: 'ramp-slip-road',
    },
    control: { arterial: 'signals', collector: 'roundabout', local: 'yield' },
    supply: { busNetwork: true, cycleNetwork: true, parking: true, humps: 0.35, roundaboutRate: 0.5, tram: false, rail: true },
  },
  rural: {
    id: 'rural', name: 'Rural / hinterland', blurb: 'One trunk road, winding lanes with passing places, grass verges, almost no junctions.',
    profiles: {
      motorway: 'motorway-2x2-hard-shoulder', expressway: 'trunk-road-2x2-at-grade',
      arterial: 'rural-trunk-wide-verges', collector: 'rural-trunk-wide-verges',
      local: 'single-track-lane-passing-places', lane: 'single-track-lane-passing-places',
      service: 'service-alley', footway: 'footway-park-path', cycleway: 'cycleway-two-way',
      busway: 'busway-2-way', tramway: 'avenue-2x2-tram-in-median', pedestrian: 'pedestrian-street',
      'parking-aisle': 'parking-aisle', ramp: 'ramp-slip-road',
    },
    control: { arterial: 'yield', collector: 'yield', local: 'uncontrolled' },
    supply: { busNetwork: false, cycleNetwork: true, parking: false, humps: 0, roundaboutRate: 0.2, tram: false, rail: true },
  },
};

/* ── Layouts ─────────────────────────────────────────────────────────────────────────────────────── */



export const LAYOUTS = {
  'nfs-loop': {
    id: 'nfs-loop', name: 'Ring + spine (NFS)',
    blurb: 'A grade-separated ring and a diagonal spine, arterial radials, grid and organic infill between them, a riverside boulevard and a bridge. Built for a 4–8 km playground.',
  },
  grid: { id: 'grid', name: 'Grid', blurb: 'Rectangular blocks with a three-step hierarchy. Cheapest to validate, easiest to read at speed.' },
  organic: { id: 'organic', name: 'Organic', blurb: 'Irregular triangulated streets, short blocks, no through-vehicles by accident.' },
  radial: { id: 'radial', name: 'Radial + rings', blurb: 'Concentric rings and spokes with a ring road, the classic European growth pattern.' },
  rural: { id: 'rural', name: 'Rural', blurb: 'One trunk and many lanes. For testing the class rules where there is no city.' },
};

/** Which class an infill street gets, by distance from the map centre and district character. */
function infillClass(rng, rank) {
  const r = rng();
  if (rank === 'core') return r < 0.08 ? 'arterial' : r < 0.5 ? 'collector' : 'local';
  if (rank === 'industrial') return r < 0.35 ? 'collector' : r < 0.9 ? 'local' : 'service';
  return r < 0.22 ? 'collector' : 'local';
}

function proposal(cls, pts, name, district, extra = {}) {
  return { cls, pts: pts.map((p) => [p[0], 0, p[1]]), name, district, ...extra };
}

/** Street alignments for one layout family. Pure 2D; elevations come later. */
function layoutProposals(layout, size, rng, charter) {
  const out = [];
  const half = size / 2;
  const jitter = (v) => (rng() - 0.5) * v;
  const block = size / (layout === 'grid' ? 14 : 11);

  if (layout === 'rural') {
    out.push(proposal('arterial', [[-half * 1.1, -half * 0.4], [-half * 0.2, -half * 0.15], [half * 0.35, half * 0.3], [half * 1.1, half * 0.55]], 'Trunk Road', 'Hinterland'));
    for (let i = 0; i < 26; i += 1) {
      const x0 = -half + rng() * size;
      const z0 = -half + rng() * size;
      const ang = rng() * Math.PI * 2;
      const len = size * (0.18 + rng() * 0.3);
      const pts = [];
      for (let k = 0; k <= 7; k += 1) {
        const u = k / 7;
        pts.push([x0 + Math.cos(ang) * len * u + jitter(size * 0.05), z0 + Math.sin(ang) * len * u + jitter(size * 0.05)]);
      }
      out.push(proposal('lane', pts, `Lane ${i + 1}`, 'Hinterland'));
    }
    return out;
  }

  if (layout === 'nfs-loop') {
    // Ring road — a rounded rectangle at 0.72 of the map, deliberately long and flowing.
    const r = half * 0.72;
    const ring = [];
    const sides = 26;
    for (let i = 0; i <= sides; i += 1) {
      const a = (i / sides) * Math.PI * 2;
      const bulge = 1 + Math.sin(a * 3) * 0.06;
      ring.push([Math.cos(a) * r * bulge, Math.sin(a) * r * bulge * 0.86]);
    }
    out.push(proposal('motorway', ring, 'City Ring', 'Ring'));

    // Spine: the fast diagonal, ring to ring, grade-separated from everything it meets.
    const spine = [];
    for (let i = 0; i <= 10; i += 1) {
      const u = i / 10;
      spine.push([
        -half * 0.96 + size * 0.98 * u + Math.sin(u * 4.2) * size * 0.07,
        -half * 0.7 + size * 1.36 * u + Math.cos(u * 3.1) * size * 0.05,
      ]);
    }
    out.push(proposal('expressway', spine, 'East Gate Expressway', 'Spine'));

    // Two arterials crossing the ring's interior, plus a riverside boulevard.
    out.push(proposal('arterial', [[-half * 0.9, half * 0.28], [0, half * 0.36], [half * 0.9, half * 0.24]], 'North Avenue', 'Core'));
    out.push(proposal('arterial', [[-half * 0.86, -half * 0.42], [-half * 0.1, -half * 0.3], [half * 0.9, -half * 0.5]], 'South Avenue', 'Core'));
    out.push(proposal('arterial', [[half * 0.62, -half * 0.9], [half * 0.7, 0], [half * 0.55, half * 0.9]], 'Dock Boulevard', 'Harbour'));
    out.push(proposal('arterial', [[-half * 0.72, -half * 0.9], [-half * 0.66, -half * 0.1], [-half * 0.7, half * 0.9]], 'West Boulevard', 'West'));
    // Radials from the ring inward, so the interior is not a single grid.
    for (let i = 0; i < 4; i += 1) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      out.push(proposal('arterial', [
        [Math.cos(a) * r * 0.98, Math.sin(a) * r * 0.86],
        [Math.cos(a) * r * 0.45 + jitter(size * 0.04), Math.sin(a) * r * 0.4 + jitter(size * 0.04)],
        [Math.cos(a + 0.35) * size * 0.06, Math.sin(a + 0.35) * size * 0.06],
      ], `Radial ${i + 1}`, 'Core'));
    }
  }

  if (layout === 'radial') {
    const rOuter = half * 0.82;
    for (const f of [0.35, 0.58, 0.82]) {
      const ring = [];
      const sides = 22;
      for (let i = 0; i <= sides; i += 1) {
        const a = (i / sides) * Math.PI * 2;
        ring.push([Math.cos(a) * rOuter * f, Math.sin(a) * rOuter * f]);
      }
      out.push(proposal(f > 0.7 ? 'arterial' : 'collector', ring, `${Math.round(f * 100)}% Ring`, 'Ring'));
    }
    for (let i = 0; i < 8; i += 1) {
      const a = (i / 8) * Math.PI * 2;
      out.push(proposal(i % 2 === 0 ? 'arterial' : 'collector', [
        [Math.cos(a) * size * 0.05, Math.sin(a) * size * 0.05],
        [Math.cos(a + 0.06) * rOuter * 0.55, Math.sin(a + 0.06) * rOuter * 0.55],
        [Math.cos(a) * rOuter, Math.sin(a) * rOuter],
        [Math.cos(a - 0.05) * half * 1.06, Math.sin(a - 0.05) * half * 1.06],
      ], `Spoke ${i + 1}`, 'Core'));
    }
  }

  if (layout === 'organic') {
    // Steiner-ish: scatter points, connect near neighbours, and let link length set the class.
    const nodes = [];
    const count = 260;
    for (let i = 0; i < count; i += 1) {
      const a = rng() * Math.PI * 2;
      const rr = Math.sqrt(rng()) * half * 0.95;
      nodes.push([Math.cos(a) * rr, Math.sin(a) * rr * 0.9]);
    }
    const used = new Set();
    for (let i = 0; i < nodes.length; i += 1) {
      const near = [];
      for (let j = 0; j < nodes.length; j += 1) {
        if (i === j) continue;
        const d = Math.hypot(nodes[i][0] - nodes[j][0], nodes[i][1] - nodes[j][1]);
        if (d < block * 2.0) near.push([d, j]);
      }
      near.sort((a, b) => a[0] - b[0]);
      for (const [d, j] of near.slice(0, 3)) {
        const key = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (used.has(key)) continue;
        used.add(key);
        const cls = d > block * 1.5 ? 'arterial' : d > block * 0.9 ? 'collector' : 'local';
        out.push(proposal(cls, [nodes[i], nodes[j]], `Way ${i}–${j}`, 'Old Town'));
      }
    }
  }

  if (layout === 'grid' || layout === 'nfs-loop' || layout === 'radial') {
    // Block infill: the grid body every layout family inherits, sized to the layout's blocks.
    const street = (x0, z0, x1, z1, cls, name, district) => out.push(proposal(cls, [[x0, z0], [x1, z1]], name, district));
    const cols = Math.max(6, Math.round(size / block));
    const rows = cols;
    const step = size / cols;
    for (let i = 1; i < cols; i += 1) {
      const x = -half + i * step;
      const a = rng();
      const cls = layout === 'grid' ? (i % 4 === 0 ? 'arterial' : i % 2 === 0 ? 'collector' : 'local') : infillClass(rng, a < 0.25 ? 'core' : 'suburb');
      if (layout === 'grid' && i % 2 === 0) street(x, -half, x, half, cls, `${i % 4 === 0 ? 'Avenue' : 'Street'} ${i}`, 'Grid');
      else {
        // Broken, jittered runs rather than one line through the whole map.
        const runs = 3 + Math.floor(rng() * 3);
        for (let k = 0; k < runs; k += 1) {
          const z0 = -half + (k / runs) * size + jitter(step * 0.3);
          const z1 = -half + ((k + 1) / runs) * size + jitter(step * 0.3);
          street(x + jitter(step * 0.18), z0, x + jitter(step * 0.18), z1, cls, `${cls === 'local' ? 'Way' : 'Street'} ${i}-${k + 1}`, cls === 'local' ? 'Suburb' : 'Core');
        }
      }
    }
    for (let j = 1; j < rows; j += 1) {
      const z = -half + j * step;
      for (let k = 0; k < 3; k += 1) {
        const x0 = -half + (k / 3) * size + jitter(step * 0.2);
        const x1 = -half + ((k + 1) / 3) * size + jitter(step * 0.2);
        const cls = layout === 'grid' ? (j % 4 === 0 ? 'arterial' : j % 2 === 0 ? 'collector' : 'local') : infillClass(rng, 'suburb');
        street(x0, z + jitter(step * 0.16), x1, z + jitter(step * 0.16), cls, `${j % 4 === 0 ? 'Cross Avenue' : 'Cross Street'} ${j}`, 'Suburb');
      }
    }
    return out;
  }

  return out;
}

/* ── Stitching: crossings, splits, junctions, grade separation ───────────────────────────────────── */

function segIntersect(p1, p2, p3, p4) {
  const d1x = p2[0] - p1[0];
  const d1z = p2[2] - p1[2];
  const d2x = p4[0] - p3[0];
  const d2z = p4[2] - p3[2];
  const den = d1x * d2z - d1z * d2x;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((p3[0] - p1[0]) * d2z - (p3[2] - p1[2]) * d2x) / den;
  const u = ((p3[0] - p1[0]) * d1z - (p3[2] - p1[2]) * d1x) / den;
  if (t < 0.001 || t > 0.999 || u < 0.001 || u > 0.999) return null;
  return { x: p1[0] + d1x * t, z: p1[2] + d1z * t, angle: Math.abs(Math.atan2(den, d1x * d2x + d1z * d2z)) };
}

function stitch(proposals, terrain) {
  // Spatial hash of segments for pairwise crossing tests.
  const CELL = 80;
  const grid = new Map();
  const key = (cx, cz) => `${cx},${cz}`;
  proposals.forEach((p, pi) => {
    for (let i = 1; i < p.pts.length; i += 1) {
      const a = p.pts[i - 1];
      const b = p.pts[i];
      const minX = Math.min(a[0], b[0]);
      const maxX = Math.max(a[0], b[0]);
      const minZ = Math.min(a[2], b[2]);
      const maxZ = Math.max(a[2], b[2]);
      for (let cx = Math.floor(minX / CELL); cx <= Math.floor(maxX / CELL); cx += 1) {
        for (let cz = Math.floor(minZ / CELL); cz <= Math.floor(maxZ / CELL); cz += 1) {
          const k = key(cx, cz);
          if (!grid.has(k)) grid.set(k, []);
          grid.get(k).push({ pi, i, a, b });
        }
      }
    }
  });

  const hits = new Map(); // per proposal: list of split positions with metadata
  const seenCells = new Set(); // the same segment pair can appear in several hash cells
  const parallelSkip = new Set(); // proposals that lie along another road and should not be built
  for (const bucket of grid.values()) {
    for (let m = 0; m < bucket.length; m += 1) {
      for (let n = m + 1; n < bucket.length; n += 1) {
        const A = bucket[m];
        const B = bucket[n];
        if (A.pi === B.pi) continue;
        const cellKey = `${A.pi}:${A.i}:${B.pi}:${B.i}`;
        if (seenCells.has(cellKey)) continue;
        seenCells.add(cellKey);
        const hit = segIntersect(A.a, A.b, B.a, B.b);
        if (!hit) continue;
        const pa = proposals[A.pi];
        const pb = proposals[B.pi];
        const rankA = CLASS_RANK[pa.cls] ?? 3;
        const rankB = CLASS_RANK[pb.cls] ?? 3;
        const pathA = rankA === 0;
        const pathB = rankB === 0;
        // Grade separation: high-speed classes never meet an at-grade junction, and a two-step class
        // difference is separated. Paths are always grade-separated from motorways.
        const separated = (!pathA && !pathB) && (
          (rankA >= 6 && rankB <= 4) || (rankB >= 6 && rankA <= 4) ||
          (rankA === 7 || rankB === 7) ||
          Math.abs(rankA - rankB) >= 2
        );
        // Two roads running along each other are a duplicate, not a crossing: keep the longer one.
        if (hit.angle < 0.30 && Math.abs(rankA - rankB) <= 1 && !separated) {
          const lenA = polyLength(pa.pts);
          const lenB = polyLength(pb.pts);
          parallelSkip.add(lenA < lenB ? A.pi : B.pi);
          continue;
        }
        const record = {
          x: hit.x, z: hit.z, separated,
          aOver: rankA > rankB || (rankA === rankB && pa.cls === 'arterial'),
          angle: hit.angle, piA: A.pi, piB: B.pi,
        };
        for (const pi of [A.pi, B.pi]) {
          if (!hits.has(pi)) hits.set(pi, []);
          hits.get(pi).push(record);
        }
      }
    }
  }

  // Cut each proposal at its split points, then build chains as roads.
  const roads = [];
  const nodeByKey = new Map();
  const nodeAt = (x, z) => {
    const k = `${Math.round(x * 2)}/${Math.round(z * 2)}`;
    if (nodeByKey.has(k)) return nodeByKey.get(k);
    const node = makeNode({ x, z, y: terrain.height(x, z) });
    nodeByKey.set(k, node);
    return node;
  };

  proposals.forEach((p, pi) => {
    if (parallelSkip.has(pi)) return;
    // Only at-grade crossings become junctions. A grade-separated crossing leaves both roads intact:
    // it becomes a bridge span on one and nothing at all on the other, which is the whole point of
    // separating the classes in the first place.
    const cuts = (hits.get(pi) || []).filter((c) => !c.separated).sort((a, b) => (
      segParam(p.pts, a.x, a.z) - segParam(p.pts, b.x, b.z)
    ));
    // Build the chains by splicing the cut points into the proposal's own point list. An earlier
    // version chain-ed only the endpoints, which quietly straightened every road in the city; the
    // shape points must survive, so the chains are slices of one augmented polyline.
    const list = p.pts.map((q) => [q[0], q[1], q[2]]);
    const markers = [];
    let cursor = 0;
    for (const cut of cuts) {
      let bestI = cursor + 1;
      let bestT = 0;
      let bestD = Infinity;
      for (let i = cursor + 1; i < list.length; i += 1) {
        const a = list[i - 1];
        const b = list[i];
        const dx = b[0] - a[0];
        const dz = b[2] - a[2];
        const l2 = dx * dx + dz * dz || 1;
        let t = ((cut.x - a[0]) * dx + (cut.z - a[2]) * dz) / l2;
        t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(a[0] + dx * t - cut.x, a[2] + dz * t - cut.z);
        if (d < bestD) { bestD = d; bestI = i; bestT = t; }
      }
      let at;
      if (bestT > 0.995) at = bestI;
      else if (bestT < 0.005) at = bestI - 1;
      else {
        const a = list[bestI - 1];
        const b = list[bestI];
        list.splice(bestI, 0, [cut.x, a[1] + (b[1] - a[1]) * bestT, cut.z]);
        at = bestI;
      }
      if (!markers.length || at - markers[markers.length - 1] > 1) markers.push(at);
      cursor = Math.min(at, list.length - 1);
    }

    const chains = [];
    let from = 0;
    for (const m of markers) {
      if (m - from >= 1) chains.push({ pts: list.slice(from, m + 1), at: m });
      from = m;
    }
    chains.push({ pts: list.slice(from), at: null });

    for (const chain of chains) {
      if (chain.pts.length < 2) continue;
      const first = chain.pts[0];
      const last = chain.pts[chain.pts.length - 1];
      const startNode = nodeAt(first[0], first[2]);
      const endNode = nodeAt(last[0], last[2]);
      if (startNode === endNode && polyLength(chain.pts) < 150) continue;
      const road = makeRoad({
        class: p.cls,
        profileId: null,
        points: chain.pts.map((q) => [q[0], 0, q[2]]),
        name: p.name,
        district: p.district,
        proposalIndex: pi,
      });
      road.startNode = startNode.id;
      road.endNode = endNode.id;
      startNode.arms.push({ roadId: road.id, end: 0 });
      endNode.arms.push({ roadId: road.id, end: 1 });
      roads.push(road);
    }

    // Record grade separations against the proposal: which of the two roads goes over.
    for (const cut of (hits.get(pi) || [])) {
      if (!cut.separated) continue;
      const over = cut.piA === pi ? cut.aOver : !cut.aOver;
      p.seps = p.seps || [];
      p.seps.push({ x: cut.x, z: cut.z, over, angle: cut.angle });
    }
  });

  const nodes = [...nodeByKey.values()];
  return { roads, nodes, proposals, parallelSkip };
}

function segParam(pts, x, z) {
  let best = 1e9;
  let bestS = 0;
  let acc = 0;
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - a[0]) * dx + (z - a[2]) * dz) / l2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(a[0] + dx * t - x, a[2] + dz * t - z);
    if (d < best) { best = d; bestS = acc + Math.sqrt(l2) * t; }
    acc += Math.sqrt(l2);
  }
  return bestS;
}


/* ── Interchanges ────────────────────────────────────────────────────────────────────────────────── */

/** Point and tangent at `s` metres along a polyline. */
function alongRoad(points, s) {
  let acc = 0;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const seg = Math.hypot(b[0] - a[0], b[2] - a[2]);
    if (acc + seg >= s) {
      const t = seg > 0 ? (s - acc) / seg : 0;
      return {
        p: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
        dir: V.norm2([b[0] - a[0], b[2] - a[2]]),
        index: i,
        t,
      };
    }
    acc += seg;
  }
  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  return { p: [last[0], last[1], last[2]], dir: V.norm2([last[0] - prev[0], last[2] - prev[2]]), index: points.length - 1, t: 1 };
}

/** Split a road at a distance along it, returning the two halves. */
function splitAtDistance(road, s) {
  const at = alongRoad(road.points, s);
  if (at.index <= 0 || at.index >= road.points.length) return null;
  const pts = road.points;
  const first = makeRoad({ ...road, id: nextId('r'), points: pts.slice(0, at.index).concat([[at.p[0], at.p[1], at.p[2]]]), spans: sliceSpans(road.spans, 0, at.index) });
  const second = makeRoad({ ...road, id: nextId('r'), points: [[at.p[0], at.p[1], at.p[2]]].concat(pts.slice(at.index)), spans: sliceSpans(road.spans, at.index - 1, pts.length - 1) });
  first.startNode = road.startNode;
  second.endNode = road.endNode;
  return { first, second, at };
}

/**
 * Interchanges. A grade-separated crossing connects the two roads with ramps: the fast road keeps its
 * through movement, and the ramps meet it at merge nodes beyond the bridge, which is how a motorway
 * is allowed to have junctions at all. Two ramps per crossing (a half diamond) is enough to make the
 * network a network; the junction panel can add the other two.
 */
function makeInterchanges(proposals, roads, nodes, terrain, rng) {
  const made = [];
  const seen = new Set();
  for (const p of proposals) {
    for (const sep of (p.seps || [])) {
      // Build each interchange once, from the road that goes over: the under road's own record of
      // the same crossing must not consume the dedupe key.
      if (!sep.over) continue;
      const key = `${Math.round(sep.x / 40)}:${Math.round(sep.z / 40)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const piA = proposals.indexOf(p);
      const overRoad = roads.find((r) => r.proposalIndex === piA && distToPoint(r.points, sep.x, sep.z) < 30);
      const other = proposals.find((q, qi) => qi !== piA && distToPoint2(q.pts, sep.x, sep.z) < 22);
      if (!overRoad || !other) continue;
      const qi = proposals.indexOf(other);
      if (Math.abs((CLASS_RANK[overRoad.class] ?? 3) - (CLASS_RANK[other.cls] ?? 3)) < 2) continue;
      const underRoad = roads.find((r) => r.proposalIndex === qi && distToPoint(r.points, sep.x, sep.z) < 30);
      if (!underRoad) continue;
      const rankUnder = CLASS_RANK[underRoad.class] ?? 3;
      if (rankUnder < 4) continue;

      const overLen = polyLength(overRoad.points);
      const underLen = polyLength(underRoad.points);
      const sOver = paramAlong(overRoad.points, sep.x, sep.z);
      const sUnder = paramAlong(underRoad.points, sep.x, sep.z);
      const deck = 260;  // clearance over the bridge zone
      const gap = 150;   // how far the ramps leave the minor road from the crossing
      if (sOver < deck + 40 || sOver > overLen - deck - 40) continue;
      if (sUnder < gap + 30 || sUnder > underLen - gap - 30) continue;
      if (underLen < 400) continue;

      const overSplitA = splitAtDistance(overRoad, sOver - deck);
      const overSplitB = splitAtDistance(overSplitA ? overSplitA.second : null, deck * 2);
      const underSplitA = splitAtDistance(underRoad, sUnder - gap);
      const underSplitB = splitAtDistance(underSplitA ? underSplitA.second : null, gap * 2);
      if (!overSplitA || !overSplitB || !underSplitA || !underSplitB) continue;

      const nOver = makeNode({ x: overSplitA.at.p[0], z: overSplitA.at.p[2], y: overSplitA.at.p[1], type: 'merge', control: 'free choice', arms: [] });
      const nOver2 = makeNode({ x: overSplitB.at.p[0], z: overSplitB.at.p[2], y: overSplitB.at.p[1], type: 'merge', control: 'free choice', arms: [] });
      const nUnder = makeNode({ x: underSplitA.at.p[0], z: underSplitA.at.p[2], y: underSplitA.at.p[1], type: 't', control: 'yield', arms: [] });
      const nUnder2 = makeNode({ x: underSplitB.at.p[0], z: underSplitB.at.p[2], y: underSplitB.at.p[1], type: 't', control: 'yield', arms: [] });
      nOver.merge = true;
      nOver2.merge = true;

      // Re-wire the four halves into the graph.
      const overHead = overSplitA.first;
      const overMid = overSplitB.first;
      const overTail = overSplitB.second;
      const underHead = underSplitA.first;
      const underMid = underSplitB.first;
      const underTail = underSplitB.second;
      overHead.endNode = nOver.id;
      overMid.startNode = nOver.id;
      overMid.endNode = nOver2.id;
      overTail.startNode = nOver2.id;
      underHead.endNode = nUnder.id;
      underMid.startNode = nUnder.id;
      underMid.endNode = nUnder2.id;
      underTail.startNode = nUnder2.id;

      const replace = (old, list) => {
        const i = roads.indexOf(old);
        if (i >= 0) roads.splice(i, 1, ...list);
      };
      replace(overRoad, [overHead, overMid, overTail]);
      replace(underRoad, [underHead, underMid, underTail]);

      // Two ramps as S-curves: they leave the minor road, run beside the crossing, and merge beyond it.
      const ramp = (from, to, flip) => {
        const pts = [];
        const steps = 6;
        for (let i = 0; i <= steps; i += 1) {
          const u = i / steps;
          const base = [
            from.p[0] + (to.p[0] - from.p[0]) * u,
            from.p[1] + (to.p[1] - from.p[1]) * u,
            from.p[2] + (to.p[2] - from.p[2]) * u,
          ];
          const bow = Math.sin(u * Math.PI) * 46 * (flip ? 1 : -1);
          const nx = -(to.p[2] - from.p[2]);
          const nz = (to.p[0] - from.p[0]);
          const nl = Math.hypot(nx, nz) || 1;
          pts.push([base[0] + (nx / nl) * bow, base[1] + Math.sin(u * Math.PI) * 1.2, base[2] + (nz / nl) * bow]);
        }
        return pts;
      };

      const rampProfile = 'ramp-slip-road';
      const r1 = makeRoad({
        class: 'ramp', profileId: rampProfile,
        points: ramp(underSplitA.at, overSplitB.at, false),
        name: `${overRoad.name} slip (entry)`, district: overRoad.district,
      });
      const r2 = makeRoad({
        class: 'ramp', profileId: rampProfile,
        points: ramp(overSplitA.at, underSplitB.at, true),
        name: `${overRoad.name} slip (exit)`, district: overRoad.district,
      });
      r1.startNode = nUnder.id;
      r1.endNode = nOver2.id;
      r2.startNode = nOver.id;
      r2.endNode = nUnder2.id;
      roads.push(r1, r2);
      nodes.push(nOver, nOver2, nUnder, nUnder2);
      // Ramps cross nothing at grade: they are the interchange.
      made.push({ x: sep.x, z: sep.z, kind: 'half diamond' });
      void rng;
      void terrain;
    }
  }
  return made;
}

/** Distance from a point to a polyline (not to its vertices — grid streets have 200 m segments). */
function distToPoint(points, x, z) {
  let best = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - a[0]) * dx + (z - a[2]) * dz) / l2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(a[0] + dx * t - x, a[2] + dz * t - z));
  }
  return best;
}

const distToPoint2 = distToPoint;

function paramAlong(points, x, z) {
  let acc = 0;
  let best = 0;
  let bd = Infinity;
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - a[0]) * dx + (z - a[2]) * dz) / l2;
    t = Math.max(0, Math.min(1, t));
    const d = Math.hypot(a[0] + dx * t - x, a[2] + dz * t - z);
    if (d < bd) { bd = d; best = acc + Math.sqrt(l2) * t; }
    acc += Math.sqrt(l2);
  }
  return best;
}

/* ── Elevation: terrain following, grades, bridges, tunnels ──────────────────────────────────────── */

const MAX_GRADE = { motorway: 0.04, expressway: 0.055, arterial: 0.07, collector: 0.09, local: 0.11, lane: 0.14, service: 0.14, ramp: 0.07, busway: 0.08, tramway: 0.08, cycleway: 0.08, footway: 0.1, pedestrian: 0.06, 'parking-aisle': 0.05 };

/**
 * Raise (or hold) a road over something. `lift` is the extra height the deck needs at the obstacle;
 * the deck plateau covers the obstacle and smoothstep ramps run out each side at the class's limiting
 * grade, so a generated overpass is legal by construction.
 */
function liftProfile(road, idx, lift, plateau, rampLen, targets) {
  const pts = road.points;
  const write = (from, dir) => {
    let d = 0;
    for (let i = from; i >= 0 && i < pts.length; i += dir) {
      if (i !== from) d += Math.hypot(pts[i][0] - pts[i - dir][0], pts[i][2] - pts[i - dir][2]);
      const f = d <= plateau ? 1 : Math.max(0, 1 - (d - plateau) / rampLen);
      const s = f * f * (3 - 2 * f);
      if (lift * s > targets[i].lift) targets[i] = { lift: lift * s, full: s > 0.985 };
      if (s >= 0.985) targets[i].full = true;
    }
  };
  write(idx, -1);
  write(idx, 1);
}

function applyElevation(roads, proposals, terrain) {
  for (const road of roads) {
    const n = road.points.length;
    const maxG = MAX_GRADE[road.class] ?? 0.1;
    const clearance = road.class === 'motorway' || road.class === 'expressway' ? 5.5 : 4.8;
    let ys = road.points.map((p) => terrain.height(p[0], p[2]));
    for (let pass = 0; pass < 2; pass += 1) {
      const next = ys.slice();
      for (let i = 1; i < ys.length - 1; i += 1) next[i] = (ys[i - 1] + ys[i] * 2 + ys[i + 1]) / 4;
      ys = next;
    }
    const gradeLimit = (dir) => {
      const idx = dir > 0 ? [...ys.keys()] : [...ys.keys()].reverse();
      for (let k = 1; k < idx.length; k += 1) {
        const i = idx[k];
        const j = idx[k - 1];
        const run = Math.hypot(road.points[i][0] - road.points[j][0], road.points[i][2] - road.points[j][2]);
        const maxRise = run * maxG;
        ys[i] = Math.max(Math.min(ys[i], ys[j] + maxRise), ys[j] - maxRise);
      }
    };
    gradeLimit(1);
    gradeLimit(-1);

    const targets = Array.from({ length: n }, () => ({ lift: 0, full: false, kind: null }));

    // Water: deck at a fixed height above the water, ramped out onto the banks.
    const culvertAt = new Array(n).fill(false);
    for (const span of road.spans || []) {
      if (span.kind !== 'culvert') continue;
      for (let k = span.i0; k <= span.i1; k += 1) culvertAt[k] = true;
    }
    for (let i = 0; i < n; i += 1) {
      if (culvertAt[i] || !terrain.isWater(road.points[i][0], road.points[i][2])) continue;
      let j = i;
      while (j + 1 < n && !culvertAt[j + 1] && terrain.isWater(road.points[j + 1][0], road.points[j + 1][2])) j += 1;
      const deck = terrain.waterLevel + (road.class === 'motorway' ? 8.5 : 6.5);
      const lift = Math.max(0, deck - Math.max(ys[i], ys[j]));
      const plateau = Math.max(12, polyLength(road.points.slice(i, j + 1)) / 2 + 8);
      liftProfile(road, Math.round((i + j) / 2), lift, plateau, Math.min(340, Math.max(30, lift / (maxG * 0.5))), targets);
      for (let k = i; k <= j; k += 1) targets[k].kind = 'bridge';
      i = j + 1;
    }

    // Grade separations where this road is the one that goes over.
    const proposal = proposals[road.proposalIndex];
    for (const sep of (proposal?.seps || [])) {
      if (!sep.over) continue;
      const idx = nearestIndex(road, sep.x, sep.z);
      if (Math.hypot(road.points[idx][0] - sep.x, road.points[idx][2] - sep.z) > 30) continue;
      const other = roads.find((r) => r.proposalIndex !== road.proposalIndex && distToRoad(r, sep.x, sep.z) < 22);
      const deck = (other ? other.points[nearestIndex(other, sep.x, sep.z)][1] : terrain.height(sep.x, sep.z)) + clearance + 1.2;
      const lift = Math.max(0, deck - ys[idx]);
      if (typeof process !== 'undefined' && process.env?.DEBUG_ROADS) {
        console.log('  [sep]', road.class, road.name, 'vs', other ? other.class : 'terrain', 'idx', idx, 'n', n,
          'dist', Math.hypot(road.points[idx][0] - sep.x, road.points[idx][2] - sep.z).toFixed(1), 'deck', deck.toFixed(1), 'ys', ys[idx].toFixed(1), 'lift', lift.toFixed(1));
      }
      if (lift < 1.0) continue;
      const plateau = Math.max(14, (other ? profileWidth(profileById(other.profileId)) : 12) / 2 + 14);
      liftProfile(road, idx, lift, plateau, Math.min(340, Math.max(30, lift / (maxG * 0.5))), targets);
      for (let k = Math.max(0, idx - 1); k <= Math.min(n - 1, idx + 1); k += 1) targets[k].kind = targets[k].kind || 'bridge';
    }

    // A hill in the way of a motorway or expressway is bored through, not climbed.
    if (road.class === 'motorway' || road.class === 'expressway') {
      const near = road.points.map((p) => Math.hypot(p[0] - terrain.hill[0], p[2] - terrain.hill[1]));
      const inside = near.map((d) => d < 300);
      const first = inside.indexOf(true);
      if (first >= 0) {
        let last = first;
        while (last + 1 < n && inside[last + 1]) last += 1;
        if (last > first) {
          const boreY = Math.max(ys[first], ys[last]) + 0.4;
          for (let k = first; k <= last; k += 1) { targets[k].kind = 'tunnel'; ys[k] = boreY; }
        }
      }
    }

    for (let i = 0; i < n; i += 1) ys[i] += targets[i].lift;

    // Coalesce structure runs into spans (arc-length spans are computed lazily by the geometry pass).
    road.spans = [];
    let run = null;
    for (let i = 0; i < n; i += 1) {
      const kind = targets[i].kind;
      if (kind && (!run || run.kind !== kind)) {
        if (run) road.spans.push(run);
        run = { kind, i0: i, i1: i, clearance };
      } else if (run && kind === run.kind) {
        run.i1 = i;
      } else if (run && !kind) {
        road.spans.push(run);
        run = null;
      }
    }
    if (run) road.spans.push(run);

    // A deck is level by construction (that is what a plateau buys you), which makes the approach
    // grades the only thing left to fix: clamp every remaining pair to the class limit so no window
    // of the finished profile can exceed it.
    for (const span of road.spans) {
      if (span.kind !== 'bridge' && span.kind !== 'tunnel') continue;
      let top = -Infinity;
      for (let k = span.i0; k <= span.i1; k += 1) top = Math.max(top, ys[k]);
      for (let k = span.i0; k <= span.i1; k += 1) ys[k] = top;
    }
    for (let pass = 0; pass < 3; pass += 1) {
      const order = pass % 2 === 0 ? [...ys.keys()] : [...ys.keys()].reverse();
      for (let k = 1; k < order.length; k += 1) {
        const i = order[k];
        const j = order[k - 1];
        const run2 = Math.hypot(road.points[i][0] - road.points[j][0], road.points[i][2] - road.points[j][2]);
        // A hair under the limit: the validator measures over a 20 m window, and rounding must not
        // push a legal profile over the line.
        const maxRise = run2 * maxG * 0.88;
        ys[i] = Math.max(Math.min(ys[i], ys[j] + maxRise), ys[j] - maxRise);
      }
    }

    road.points = road.points.map((p, k) => [p[0], ys[k], p[2]]);
    road.gradeMax = maxG;
    road.clearance = clearance;
  }
}

/**
 * Junction heights are decided by `snapArmHeights`, so the grade limit has to be re-imposed after it.
 * The ends are pinned (they belong to a junction, and a junction has one height) and the interior is
 * nudged until no pair exceeds the class limit.
 */
export function gradeApproaches(project, options = {}) {
  const margin = options.margin ?? 0.88;
  let fixed = 0;
  for (const road of project.roads) {
    const n = road.points.length;
    if (n < 3) continue;
    const maxG = MAX_GRADE[road.class] ?? 0.1;
    const ys = road.points.map((p) => p[1]);
    for (let pass = 0; pass < 4; pass += 1) {
      const order = pass % 2 === 0 ? [...ys.keys()] : [...ys.keys()].reverse();
      for (let k = 1; k < order.length - 1; k += 1) {
        const i = order[k];
        const j = order[k - 1];
        if (i === 0 || i === n - 1) continue;
        const run = Math.hypot(road.points[i][0] - road.points[j][0], road.points[i][2] - road.points[j][2]);
        const maxRise = run * maxG * margin;
        const clamped = Math.max(Math.min(ys[i], ys[j] + maxRise), ys[j] - maxRise);
        if (Math.abs(clamped - ys[i]) > 1e-4) fixed += 1;
        ys[i] = clamped;
      }
    }
    // Where the two ends are further apart than the class limit allows over this length, no profile
    // can satisfy both. Rather than leave the clamp's half-finished ramp with a step at one end, the
    // link becomes one constant grade between its junctions: the flattest thing that can exist there.
    let excess = false;
    for (let i = 1; i < n; i += 1) {
      const run = Math.hypot(road.points[i][0] - road.points[i - 1][0], road.points[i][2] - road.points[i - 1][2]) || 1;
      if (Math.abs(ys[i] - ys[i - 1]) / run > maxG * 1.05) { excess = true; break; }
    }
    if (excess) {
      const total = ys[n - 1] - ys[0];
      let acc = 0;
      const dist = [0];
      for (let i = 1; i < n; i += 1) {
        acc += Math.hypot(road.points[i][0] - road.points[i - 1][0], road.points[i][2] - road.points[i - 1][2]);
        dist.push(acc);
      }
      for (let i = 1; i < n - 1; i += 1) ys[i] = ys[0] + (total * dist[i]) / (acc || 1);
      road.gradeExcess = Math.round((Math.abs(total) / (acc || 1)) * 1000) / 10;
    } else {
      road.gradeExcess = null;
    }
    road.points = road.points.map((p, k) => [p[0], ys[k], p[2]]);
  }
  return fixed;
}

/**
 * Fast corridors are smoothed before anything is stitched: a jittered control point becomes a local
 * radius of a few hundred metres, and no amount of editing downstream will put a 100 km/h alignment
 * back. Two passes of a 1-2-1 kernel move the wobble, not the route.
 */
function smoothProposal(pts, passes = 2, closed = false) {
  let out = pts.map((p) => p.slice());
  const n = out.length;
  if (n < 5) return out;
  for (let pass = 0; pass < passes; pass += 1) {
    const next = out.map((p) => p.slice());
    for (let i = 0; i < n; i += 1) {
      if (!closed && (i === 0 || i === n - 1)) continue;
      const a = out[(i - 1 + n) % n];
      const b = out[i];
      const c = out[(i + 1) % n];
      next[i][0] = a[0] * 0.25 + b[0] * 0.5 + c[0] * 0.25;
      next[i][2] = a[2] * 0.25 + b[2] * 0.5 + c[2] * 0.25;
    }
    out = next;
  }
  return out;
}

/**
 * Design speed follows the alignment that actually got built. A generated ring road with a 250 m
 * curve is a 75 km/h road whatever its class says, and the validator should be told the truth rather
 * than the wish. Nothing changes the geometry here — only the number the standards are judged against.
 */
export function fitDesignSpeed(project) {
  const OUT = [];
  for (const road of project.roads) {
    const maxV = (ROAD_CLASSES[road.class]?.designSpeed?.[1]) ?? 90;
    const frames = sampleRoad(road, 6);
    if (frames.length < 13) { road.speed = Math.min(road.speed || 50, maxV); continue; }
    let minR = Infinity;
    for (let i = 6; i < frames.length - 6; i += 1) {
      const a = frames[i - 6].tangent;
      const b = frames[i + 6].tangent;
      const turn = Math.atan2(a[0] * b[2] - a[2] * b[0], a[0] * b[0] + a[2] * b[2]);
      if (Math.abs(turn) < 1e-5) continue;
      const arc = frames[i + 6].s - frames[i - 6].s;
      minR = Math.min(minR, Math.abs(arc / turn));
    }
    // R = V^2 / (127 * (e + f)) with 6 % superelevation and 0.12 side friction: R = V^2 / 22.86
    const vAlign = Number.isFinite(minR) ? Math.sqrt(minR * 22.86) : maxV;
    const fitted = Math.max(30, Math.min(maxV, Math.round(vAlign / 5) * 5));
    road.alignment = Number.isFinite(minR) ? Math.round(minR) : null;
    road.speed = fitted;
    OUT.push({ id: road.id, speed: fitted, minR });
  }
  return OUT;
}

function nearestIndex(road, x, z) {
  let best = 0;
  let bd = 1e9;
  road.points.forEach((p, i) => {
    const d = Math.hypot(p[0] - x, p[2] - z);
    if (d < bd) { bd = d; best = i; }
  });
  return best;
}

function distToRoad(road, x, z) {
  let best = 1e9;
  for (let i = 1; i < road.points.length; i += 1) {
    const a = road.points[i - 1];
    const b = road.points[i];
    const dx = b[0] - a[0];
    const dz = b[2] - a[2];
    const l2 = dx * dx + dz * dz || 1;
    let t = ((x - a[0]) * dx + (z - a[2]) * dz) / l2;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(a[0] + dx * t - x, a[2] + dz * t - z));
  }
  return best;
}


/* ── Rail ────────────────────────────────────────────────────────────────────────────────────────── */

function makeRail(size, rng, terrain) {
  const half = size / 2;
  const pts = [];
  const phase = rng() * Math.PI;
  for (let i = 0; i <= 9; i += 1) {
    const u = i / 9;
    pts.push([
      -half * 1.05 + size * 1.05 * u,
      Math.sin(phase + u * 2.4) * size * 0.26,
    ]);
  }
  return [{
    id: nextId('rail'),
    name: 'Main line',
    points: pts.map(([x, z]) => [x, terrain.height(x, z) * 0.35 + 3.2, z]),
    gauge: 1.435,
    electrified: true,
    crossings: [],
  }];
}

/* ── Districts ───────────────────────────────────────────────────────────────────────────────────── */

function makeDistricts(size) {
  const half = size / 2;
  const mk = (id, name, colour, cx, cz, r) => ({
    id, name, colour, cx, cz, r,
    poly: Array.from({ length: 14 }, (_, i) => {
      const a = (i / 14) * Math.PI * 2;
      const wob = 1 + Math.sin(a * 3 + id.length) * 0.12;
      return [cx + Math.cos(a) * r * wob, cz + Math.sin(a) * r * wob * 0.9];
    }),
  });
  return [
    mk('core', 'Core', '#6f7bd8', 0, 0, size * 0.2),
    mk('north', 'North', '#7d9ad0', 0, half * 0.45, size * 0.2),
    mk('south', 'South', '#7fae9a', 0, -half * 0.45, size * 0.2),
    mk('harbour', 'Harbour', '#c0a05a', half * 0.55, -half * 0.45, size * 0.24),
    mk('west', 'West', '#b08a8a', -half * 0.5, 0, size * 0.22),
    mk('ring', 'Ring corridor', '#8f8f98', 0, 0, size * 0.44),
  ];
}

/* ── The public entry point ──────────────────────────────────────────────────────────────────────── */

export const DEFAULT_OPTIONS = {
  seed: 20261012,
  size: 3600,
  layout: 'nfs-loop',
  charter: 'nfs-arterial',
  density: 1.0,
  roundaboutRate: null,
  structureRate: 1.0,
};

export function generateCity(options = {}) {
  const opt = { ...DEFAULT_OPTIONS, ...options };
  const { seed, size, layout, charter: charterId } = opt;
  const charter = CHARTERS[charterId] || CHARTERS['nfs-arterial'];
  const rng = mulberry32(seed);
  resetIds();

  const terrain = makeTerrain(seed, size);
  const districts = makeDistricts(size);
  const proposals = layoutProposals(layout, size, rng, charter);
  for (const p of proposals) {
    const rank = CLASS_RANK[p.cls] ?? 3;
    if (rank >= 6) p.pts = smoothProposal(p.pts, 2, Boolean(p.closed));
  }
  const { roads, nodes } = stitch(proposals, terrain);
  const net = { roads, nodes };
  const interchanges = makeInterchanges(proposals, net.roads, net.nodes, terrain, rng);

  // Cleanup, in the order a human would do it: cut the streets that run into the river, then join the
  // stubs that are left, then re-derive the junction arms from the road termini.
  foldDuplicates(net);

  clipWaterCrossings(net, terrain);
  rebuildArms(net);
  connectDeadEnds(net, { maxDistance: 75 });
  rebuildArms(net);
  connectDeadEnds(net, { maxDistance: 45, minAngle: 55 });
  rebuildArms(net);
  sanitizeNetwork(net);

  // Profiles come from the charter *before* elevation runs, because a bridge deck's ramp length
  // depends on the width of what it crosses. A missing entry falls back rather than throwing.
  for (const road of net.roads) {
    road.profileId = charter.profiles[road.class] || 'residential-street-2-way';
    road.speed = speedForClass(road.class, rng);
    road.surface = road.class === 'lane' ? 'gravel' : road.class === 'service' ? 'dense' : 'sma';
    road.oneway = false;
    const prof = profileById(road.profileId);
    road.laneCount = prof.right.length + prof.left.length;
  }

  // `roads` is the pre-cleanup array; the ops above rebuild the list, so elevate what actually shipped.
  densifyRoads(net, { maxSpacing: 14 });
  applyElevation(net.roads, proposals, terrain);
  // Heights now exist, so an at-grade crossing can be told from an overpass: anything within the band
  // becomes a real junction, and anything above it keeps its structure.
  let stitched = stitchRoads(net, { heightBand: 2.5 });
  rebuildArms(net);
  // The cuts moved endpoints again; put every arm back on its own road's height.
  snapArmHeights(net);
  rebuildArms(net);
  gradeApproaches(net);
  // Snapping junction heights can bring two roads back within a hair of each other, which turns an
  // avoided crossing into a real one. Sweep once more with a tight band, then re-settle the junctions.
  for (let pass = 0; pass < 4; pass += 1) {
    // No grade pass in here: re-grading moves the very profiles the sweep just compared, and the
    // crossing comes straight back. Junction heights are settled before the sweep starts.
    const made = stitchRoads(net, { heightBand: 0.8 });
    if (!made) break;
    rebuildArms(net);
    snapArmHeights(net);
    rebuildArms(net);
  }
  // Junction heights moved again inside the sweep, so the approaches are graded to them last.
  gradeApproaches(net);
  fitDesignSpeed(net);
  const rail = makeRail(size, rng, terrain);
  for (const node of net.nodes) {
    node.type = node.arms.length >= 5 ? 'multiarm' : node.arms.length === 4 ? 'crossroads' : node.arms.length === 3 ? 't' : 'terminal';
    node.control = charter.control[dominantClass(net.roads, node)] || 'uncontrolled';
    if (rng() < (opt.roundaboutRate ?? charter.supply.roundaboutRate) && node.arms.length >= 3) {
      node.type = 'roundabout';
      node.control = 'yield';
    }
    node.y = node.arms.reduce((a, arm) => {
      const road = net.roads.find((r) => r.id === arm.roadId);
      if (!road) return a;
      const p = arm.end === 0 ? road.points[0] : road.points[road.points.length - 1];
      return a + p[1];
    }, 0) / Math.max(1, node.arms.length);
  }

  return {
    terrain,
    districts,
    roads: net.roads,
    nodes: net.nodes,
    rail,
    proposals,
    charter,
    options: opt,
    interchanges,
    stitched,
    stats: {
      generated: true,
      seed, size, layout, charter: charter.id,
      districts: districts.length,
      metros: net.roads.reduce((a, r) => a + polyLength(r.points), 0),
    },
  };
}

function speedForClass(cls, rng) {
  const t = ROAD_CLASSES[cls] || ROAD_CLASSES.local;
  const [lo, hi] = t.designSpeed;
  return Math.round((lo + (hi - lo) * rng()) / 5) * 5;
}

function dominantClass(roads, node) {
  let best = null;
  let bestRank = -1;
  for (const arm of node.arms) {
    const road = roads.find((r) => r.id === arm.roadId);
    if (!road) continue;
    const rank = CLASS_RANK[road.class] ?? 0;
    if (rank > bestRank) { bestRank = rank; best = road.class; }
  }
  return best;
}

export const layoutBlurb = (id) => LAYOUTS[id]?.blurb || '';
export const charterBlurb = (id) => CHARTERS[id]?.blurb || '';
export { sampleRoad, V };
