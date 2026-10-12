// Frontier Road Editor — road cross-section preset library
// A profile is an ordered list of bands (left → right).
// band: { w:width m, t:surface key, role, dir:±1 (travel dir for moving bands), h:raise m }
// roles: lane bus bike parking shoulder sidewalk walk verge median barrier shared

const lane = (w, dir) => ({ w, t: 'asphalt', role: 'lane', dir, h: 0 });

export const PROFILES = {
  highway: {
    name: 'Motorway / Interstate', cat: 'Highways', speed: 110, guardrail: true,
    desc: '3+3 lanes · concrete median barrier · hard shoulders', lampSpacing: 42,
    bands: [
      { w: 4.0, t: 'grass', role: 'verge', h: 0.02 },
      { w: 2.4, t: 'asphaltDark', role: 'shoulder', dir: 1, h: 0 },
      lane(3.75, 1), lane(3.75, 1), lane(3.75, 1),
      { w: 1.1, t: 'concreteSmooth', role: 'barrier', h: 0.92 },
      lane(3.75, -1), lane(3.75, -1), lane(3.75, -1),
      { w: 2.4, t: 'asphaltDark', role: 'shoulder', dir: -1, h: 0 },
      { w: 4.0, t: 'grass', role: 'verge', h: 0.02 },
    ],
  },
  expressway: {
    name: 'Expressway (2+2)', cat: 'Highways', speed: 90, guardrail: true,
    desc: '2+2 lanes · steel guardrail median', lampSpacing: 42,
    bands: [
      { w: 3.2, t: 'grass', role: 'verge', h: 0.02 },
      { w: 2.2, t: 'asphaltDark', role: 'shoulder', dir: 1, h: 0 },
      lane(3.6, 1), lane(3.6, 1),
      { w: 2.6, t: 'grass', role: 'median', h: 0.04 },
      lane(3.6, -1), lane(3.6, -1),
      { w: 2.2, t: 'asphaltDark', role: 'shoulder', dir: -1, h: 0 },
      { w: 3.2, t: 'grass', role: 'verge', h: 0.02 },
    ],
  },
  avenue: {
    name: 'Arterial Avenue', cat: 'City streets', speed: 50, trees: false,
    desc: 'Bus lanes · cycle tracks · parking · raised median', lampSpacing: 32,
    bands: [
      { w: 3.0, t: 'concrete', role: 'sidewalk', h: 0.16 },
      { w: 1.8, t: 'asphaltGreen', role: 'bike', dir: 1, h: 0.05 },
      { w: 2.2, t: 'asphalt', role: 'parking', h: 0 },
      { w: 3.5, t: 'asphaltRed', role: 'bus', dir: 1, h: 0 },
      lane(3.5, 1),
      { w: 1.3, t: 'concreteSmooth', role: 'median', h: 0.15 },
      lane(3.5, -1),
      { w: 3.5, t: 'asphaltRed', role: 'bus', dir: -1, h: 0 },
      { w: 2.2, t: 'asphalt', role: 'parking', h: 0 },
      { w: 1.8, t: 'asphaltGreen', role: 'bike', dir: -1, h: 0.05 },
      { w: 3.0, t: 'concrete', role: 'sidewalk', h: 0.16 },
    ],
  },
  boulevard: {
    name: 'Grand Boulevard', cat: 'City streets', speed: 50, trees: true,
    desc: 'Tree verges · cycle tracks · planted median', lampSpacing: 36,
    bands: [
      { w: 4.0, t: 'concrete', role: 'sidewalk', h: 0.16 },
      { w: 1.7, t: 'grass', role: 'verge', h: 0.1 },
      { w: 2.2, t: 'asphaltGreen', role: 'bike', dir: 1, h: 0.05 },
      lane(3.25, 1), lane(3.25, 1),
      { w: 3.0, t: 'grass', role: 'verge', h: 0.12 },
      lane(3.25, -1), lane(3.25, -1),
      { w: 2.2, t: 'asphaltGreen', role: 'bike', dir: -1, h: 0.05 },
      { w: 1.7, t: 'grass', role: 'verge', h: 0.1 },
      { w: 4.0, t: 'concrete', role: 'sidewalk', h: 0.16 },
    ],
  },
  street: {
    name: 'Residential Street', cat: 'City streets', speed: 30, trees: true, bumpable: true,
    desc: '2 lanes · parking both sides · tree verges', lampSpacing: 38,
    bands: [
      { w: 2.0, t: 'concrete', role: 'sidewalk', h: 0.16 },
      { w: 1.0, t: 'grass', role: 'verge', h: 0.1 },
      { w: 2.0, t: 'asphalt', role: 'parking', h: 0 },
      lane(3.25, 1), lane(3.25, -1),
      { w: 2.0, t: 'asphalt', role: 'parking', h: 0 },
      { w: 1.0, t: 'grass', role: 'verge', h: 0.1 },
      { w: 2.0, t: 'concrete', role: 'sidewalk', h: 0.16 },
    ],
  },
  oneway: {
    name: 'One-Way Street', cat: 'City streets', speed: 50,
    desc: '3 lanes one direction · parking', lampSpacing: 34,
    bands: [
      { w: 2.0, t: 'concrete', role: 'sidewalk', h: 0.16 },
      { w: 2.2, t: 'asphalt', role: 'parking', h: 0 },
      lane(3.5, 1), lane(3.5, 1), lane(3.5, 1),
      { w: 2.2, t: 'asphalt', role: 'parking', h: 0 },
      { w: 2.0, t: 'concrete', role: 'sidewalk', h: 0.16 },
    ],
  },
  alley: {
    name: 'Alley / Service Lane', cat: 'City streets', speed: 20,
    desc: 'Shared surface · narrow',
    bands: [
      { w: 0.7, t: 'concrete', role: 'sidewalk', h: 0.12 },
      { w: 5.0, t: 'asphaltDark', role: 'shared', dir: 1, h: 0 },
      { w: 0.7, t: 'concrete', role: 'sidewalk', h: 0.12 },
    ],
  },
  country: {
    name: 'Country Road', cat: 'Rural', speed: 80,
    desc: 'Two lanes · gravel shoulders',
    bands: [
      { w: 1.4, t: 'gravel', role: 'shoulder', h: 0.01 },
      lane(3.25, 1), lane(3.25, -1),
      { w: 1.4, t: 'gravel', role: 'shoulder', h: 0.01 },
    ],
  },
  mountain: {
    name: 'Mountain Pass', cat: 'Rural', speed: 60, guardrail: true,
    desc: 'Narrow two-lane · guardrails',
    bands: [
      { w: 0.9, t: 'gravel', role: 'shoulder', h: 0.01 },
      lane(3.0, 1), lane(3.0, -1),
      { w: 0.9, t: 'gravel', role: 'shoulder', h: 0.01 },
    ],
  },
  cobble: {
    name: 'Historic Cobblestone Street', cat: 'Rural', speed: 30,
    desc: 'Shared cobble surface · old town',
    bands: [
      { w: 2.6, t: 'cobble', role: 'sidewalk', h: 0.14 },
      { w: 6.0, t: 'cobble', role: 'shared', dir: 1, h: 0 },
      { w: 2.6, t: 'cobble', role: 'sidewalk', h: 0.14 },
    ],
  },
  promenade: {
    name: 'Waterfront Promenade', cat: 'Paths', speed: 20, trees: true,
    desc: 'Wide paving · one-way cycle track', lampSpacing: 26,
    bands: [
      { w: 5.0, t: 'concreteSmooth', role: 'walk', h: 0.02 },
      { w: 3.0, t: 'asphaltGreen', role: 'bike', dir: 1, h: 0 },
      { w: 2.5, t: 'concrete', role: 'sidewalk', h: 0.16 },
    ],
  },
  cycle: {
    name: 'Cycle Path', cat: 'Paths', speed: 25, trees: true,
    desc: 'Two-way segregated green asphalt',
    bands: [
      { w: 0.8, t: 'grass', role: 'verge', h: 0.04 },
      { w: 1.7, t: 'asphaltGreen', role: 'bike', dir: 1, h: 0 },
      { w: 1.7, t: 'asphaltGreen', role: 'bike', dir: -1, h: 0 },
      { w: 0.8, t: 'grass', role: 'verge', h: 0.04 },
    ],
  },
  dirt: {
    name: 'Dirt Track', cat: 'Rural', speed: 40,
    desc: 'Unpaved · desert / countryside',
    bands: [
      { w: 1.0, t: 'grass', role: 'verge', h: 0.02 },
      { w: 4.5, t: 'dirt', role: 'shared', dir: 1, h: 0 },
      { w: 1.0, t: 'grass', role: 'verge', h: 0.02 },
    ],
  },
};

export const PROFILE_LIST = Object.entries(PROFILES).map(([id, p]) => ({
  id, ...p, half: p.bands.reduce((s, b) => s + b.w, 0) / 2,
}));

export const profileOf = id => PROFILES[id] || PROFILES.street;

// Where should lane markings go between two adjacent bands? (mesher consumes this)
const DRIVING = new Set(['lane', 'bus', 'bike', 'parking', 'shared', 'shoulder']);

export function markBetween(L, R) {
  // outer edges
  if (!L) return DRIVING.has(R.role) && R.role !== 'shoulder' ? 'sw' : 'none';
  if (!R) return DRIVING.has(L.role) && L.role !== 'shoulder' ? 'sw' : 'none';
  const dl = DRIVING.has(L.role), dr = DRIVING.has(R.role);
  if (dl && dr) {
    if (L.role === 'shared' || R.role === 'shared') return 'none';
    if (L.role === 'shoulder' || R.role === 'shoulder') return 'sw';
    if (L.role === 'parking' || R.role === 'parking') return 'none';
    if ((L.dir || 0) * (R.dir || 0) < 0) return 'dy'; // opposing traffic
    return 'dw'; // same direction lane change
  }
  if ((dl && !dr) || (!dl && dr)) {
    const d = dl ? L : R, s = dl ? R : L;
    if (d.role === 'shoulder') return 'none';
    if (s.role === 'sidewalk' || s.role === 'walk' || s.role === 'median' || s.role === 'barrier' || s.role === 'verge') return 'sw';
    return 'none';
  }
  return 'none';
}
