// Cross-sections — the profile library and the arithmetic that turns a profile into strips, offsets
// and carriageway lanes.
//
// A profile is the unit the brief cares most about: bus lanes, cycle lanes, parking lanes, tram tracks,
// kerbs, footways and paving all live here, and a road carries one profile that can change along its
// length through a transition. Profiles are symmetrical only when you make them so.
//
//   right[]: ordered from the centreline outward
//   centre : the strip the spline runs down (median / tram reservation / parking aisle), or null
//   left[] : ordered from the centreline outward, mirrored on draw
//
// Signed offsets: the right side occupies [+x0, +x1], the left side [-x1, -x0]. A road whose profile
// is asymmetric therefore leaves the spline off-centre in the carriageway, exactly like a real one
// surveyed from a construction line.

import { STRIP_TYPES, ROAD_CLASSES } from './standards.js';

let stripSeq = 0;
export const newStripId = () => `s${(stripSeq += 1).toString(36)}`;

export function makeStrip(type, width, extra = {}) {
  const spec = STRIP_TYPES[type] || STRIP_TYPES.traffic;
  return { id: newStripId(), type, width: width ?? spec.defaultWidth, ...extra };
}

const mirror = (strips) => strips.map((s) => ({ ...s, id: newStripId() }));

/** Build a symmetric profile: `inner` runs centre → outward on both sides. */
export function symmetric(name, cls, centre, inner, tag) {
  const right = inner.map(([t, w, extra]) => makeStrip(t, w, extra));
  return {
    id: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    name, class: cls, tag: tag || 'Standard',
    centre: centre ? makeStrip(centre[0], centre[1], centre[2]) : null,
    right, left: mirror(right), source: 'preset',
    note: ROAD_CLASSES[cls]?.service || '',
  };
}

/* ── The library ─────────────────────────────────────────────────────────────────────────────────── */

export const PROFILE_LIBRARY = [
  symmetric('Motorway 2×2 + hard shoulder', 'motorway', ['median', 4.5],
    [['emergency', 3.0], ['traffic', 3.75], ['traffic', 3.75]], 'Motorway'),

  symmetric('Motorway 2×3 + median barrier', 'motorway', ['median', 3.0],
    [['traffic', 3.65], ['traffic', 3.65], ['traffic', 3.65], ['emergency', 3.0]], 'Motorway'),

  symmetric('Expressway 2×2', 'expressway', ['median', 2.0],
    [['traffic', 3.65], ['traffic', 3.65], ['shoulder', 1.5]], 'Motorway'),

  symmetric('Trunk road 2×2, at grade', 'expressway', ['median', 1.5],
    [['traffic', 3.5], ['traffic', 3.5], ['shoulder', 1.0], ['kerb', 0.125, { kerb: 'upstand' }], ['footway', 2.0]], 'Standard'),

  // The NFS brief: wide, fast, legible, with real bus and cycle provision.
  symmetric('Avenue 2×2 · bus + cycle', 'arterial', ['median', 2.5],
    [['traffic', 3.4], ['traffic', 3.4], ['bus', 3.4], ['buffer', 0.6], ['cycle-track', 2.0], ['kerb', 0.15, { kerb: 'upstand' }], ['footway', 3.0]], 'Bus'),

  symmetric('Avenue 2×2 · tram in median', 'tramway', ['tram', 3.2],
    [['traffic', 3.2], ['traffic', 3.2], ['parking', 2.2], ['kerb', 0.15, { kerb: 'upstand' }], ['footway', 2.6]], 'Tram'),

  symmetric('Boulevard 2×2 · trees + parking', 'arterial', ['median', 6.0],
    [['traffic', 3.3], ['traffic', 3.3], ['parking', 2.2], ['kerb', 0.15, { kerb: 'upstand' }], ['tree-lawn', 2.0], ['footway', 2.5]], 'Parking'),

  symmetric('Arterial 2×2, painted centre', 'arterial', null,
    [['traffic', 3.5], ['traffic', 3.5], ['buffer', 0.5], ['cycle', 1.8], ['parking', 2.2], ['kerb', 0.15, { kerb: 'upstand' }], ['footway', 2.2]], 'Cycle'),

  // Asymmetric on purpose: the editor has to show that a street is not a mirror.
  {
    id: 'collector-parking-one-side', name: 'Collector · parking left, cycle right', class: 'collector',
    tag: 'Parking', source: 'preset', centre: null,
    right: [makeStrip('traffic', 3.3), makeStrip('cycle', 1.8), makeStrip('kerb', 0.125, { kerb: 'upstand' }), makeStrip('footway', 2.4)],
    left: [makeStrip('traffic', 3.3), makeStrip('parking', 2.2), makeStrip('kerb', 0.125, { kerb: 'upstand' }), makeStrip('footway', 2.4)],
    note: 'A one-sided parking bay and a one-sided cycle lane is the commonest real asymmetric cross-section.',
  },

  symmetric('Collector 2×2', 'collector', null,
    [['traffic', 3.25], ['traffic', 3.25], ['kerb', 0.125, { kerb: 'upstand' }], ['footway', 2.0]], 'Standard'),

  symmetric('Collector · bus lay-bys', 'collector', null,
    [['traffic', 3.25], ['bus-stop', 3.0], ['kerb', 0.15, { kerb: 'upstand' }], ['footway', 2.4]], 'Bus'),

  symmetric('Residential street 2-way', 'local', null,
    [['traffic', 3.0], ['traffic', 3.0], ['kerb', 0.125, { kerb: 'upstand' }], ['verge', 1.0], ['footway', 1.8]], 'Standard'),

  symmetric('Residential street · parking both sides', 'local', null,
    [['traffic', 3.0], ['parking', 2.1], ['kerb', 0.125, { kerb: 'upstand' }], ['verge', 0.8], ['footway', 1.6]], 'Parking'),

  symmetric('Home zone / shared surface', 'local', null,
    [['traffic', 2.9], ['traffic', 2.9], ['kerb', 0.12, { kerb: 'flush' }], ['footway', 2.4]], 'Shared'),

  symmetric('Single-track lane + passing places', 'lane', null,
    [['traffic', 3.0], ['verge', 1.2]], 'Rural'),

  symmetric('Service alley', 'service', null,
    [['traffic', 3.4], ['shoulder', 0.4]], 'Rural'),

  symmetric('Busway 2-way', 'busway', null,
    [['bus', 3.5], ['shoulder', 0.5], ['kerb', 0.125, { kerb: 'upstand' }], ['footway', 2.0]], 'Bus'),

  symmetric('Ramp / slip road', 'ramp', null,
    [['traffic', 3.65], ['shoulder', 0.5]], 'Motorway'),

  symmetric('Cycleway, two-way', 'cycleway', null,
    [['cycle-track', 2.0], ['shoulder', 0.3], ['verge', 1.0]], 'Cycle'),

  symmetric('Footway / park path', 'footway', null,
    [['footway', 2.5], ['verge', 1.0]], 'Shared'),

  symmetric('Pedestrian street', 'pedestrian', null,
    [['footway', 4.0], ['footway', 4.0]], 'Shared'),

  symmetric('Parking aisle', 'parking-aisle', ['parking-aisle', 6.0],
    [['parking', 5.0, { angle: 'perpendicular' }]], 'Parking'),

  symmetric('Rural trunk, wide verges', 'lane', null,
    [['traffic', 3.65], ['verge', 3.0]], 'Rural'),
];

export const profileById = (id) => PROFILE_LIBRARY.find((p) => p.id === id) || PROFILE_LIBRARY[0];

/* ── Arithmetic ──────────────────────────────────────────────────────────────────────────────────── */

/** Signed strip intervals, centre first then right side outward then left side outward. */
export function profileOffsets(profile) {
  const out = [];
  const live = (s2) => s2 && s2.width > 1e-6;
  let r = 0;
  let l = 0;
  if (live(profile.centre)) {
    const w = profile.centre.width;
    r = w / 2;
    l = -w / 2;
    out.push({ strip: profile.centre, side: 'centre', from: l, to: r });
  }
  let cursor = r;
  for (const s of profile.right.filter(live)) {
    out.push({ strip: s, side: 'right', from: cursor, to: cursor + s.width });
    cursor += s.width;
  }
  cursor = l;
  for (const s of profile.left.filter(live)) {
    out.push({ strip: s, side: 'left', from: cursor - s.width, to: cursor });
    cursor -= s.width;
  }
  return out.sort((a, b) => a.from - b.from);
}

export function profileWidth(profile) {
  const o = profileOffsets(profile);
  if (!o.length) return 0;
  return o[o.length - 1].to - o[0].from;
}

export function profileExtents(profile) {
  const o = profileOffsets(profile);
  if (!o.length) return { left: 0, right: 0, width: 0 };
  return { left: -o[0].from, right: o[o.length - 1].to, width: profileWidth(profile) };
}

/** Every strip that carries moving vehicles, nearest the centre first, per direction. */
export function carriagewayLanes(profile, driveSide = 'right') {
  const pick = (arr) => arr.filter((s) => s.type === 'traffic' || s.type === 'bus');
  const right = pick(profile.right);
  const left = pick(profile.left);
  // On a drive-on-the-right road the right-hand side of the spline travels away from the viewer's
  // reference direction; the sign flips on the left. The editor stores direction per lane instead of
  // assuming it, so this is only a seed value.
  const forward = driveSide === 'right' ? right : left;
  const backward = driveSide === 'right' ? left : right;
  return { forward, backward };
}

export function laneCount(profile) {
  const total = (profile.right.length ? profile.right : []).concat(profile.left);
  return total.filter((s) => s.type === 'traffic').length;
}

export function stripSummary(profile) {
  const o = profileOffsets(profile);
  const counts = {};
  for (const { strip } of o) counts[strip.type] = (counts[strip.type] || 0) + 1;
  return counts;
}

/** Height the profile's kerb sits at, used by the validator and the bridge/clearance checks. */
export function profileKerbUpstand(profile) {
  const kerbs = [...profile.right, ...profile.left].filter((s) => s.type === 'kerb');
  if (!kerbs.length) return 0;
  return Math.max(...kerbs.map((s) => s.width > 0 ? (KERB_UPSTAND[s.kerb] ?? 0.125) : 0));
}

const KERB_UPSTAND = { upstand: 0.125, low: 0.06, flush: 0.0, mountable: 0.075, splayed: 0.05, channel: 0.125 };

/** Deep clone with fresh strip ids — the editor's “duplicate profile” command. */
export function cloneProfile(profile, name) {
  return {
    ...profile,
    id: `${profile.id}-copy-${Math.random().toString(36).slice(2, 6)}`,
    name: name || `${profile.name} (copy)`,
    source: 'custom',
    centre: profile.centre ? { ...profile.centre, id: newStripId() } : null,
    right: profile.right.map((s) => ({ ...s, id: newStripId() })),
    left: profile.left.map((s) => ({ ...s, id: newStripId() })),
  };
}

/** One-line description for the outliner and the inspector header. */
export function profileLine(profile) {
  const w = profileWidth(profile);
  const c = stripSummary(profile);
  const parts = [];
  if (c.traffic) parts.push(`${c.traffic} traffic`);
  if (c.bus || c['bus-stop']) parts.push(`${(c.bus || 0) + (c['bus-stop'] || 0)} bus`);
  if (c.cycle || c['cycle-track']) parts.push(`${(c.cycle || 0) + (c['cycle-track'] || 0)} cycle`);
  if (c.parking) parts.push(`${c.parking} parking`);
  if (c.tram) parts.push('tram');
  return `${w.toFixed(2)} m · ${parts.join(' · ') || 'non-motorised'}`;
}
