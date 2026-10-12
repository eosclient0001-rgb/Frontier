import type { CentreKind, LaneProfile, LaneType, RoadClass } from './types';

/**
 * Lane-kind metadata and cross-section layout.
 *
 * Offsets are metres from the centreline with `+` on the left of travel and
 * `-` on the right, so every band has `lo < hi`.
 */

export interface LaneInfo {
  label: string;
  /** Linear-ish sRGB colour as 0xRRGGBB. */
  color: number;
  /** Surface height in metres. */
  y: number;
  /** True for kerbed surfaces (sidewalks etc.) that sit above the road. */
  raised: boolean;
  defaultWidth: number;
  /** Lanes that can carry vehicles. */
  vehicle: boolean;
}

export const LANE_INFO: Record<LaneType, LaneInfo> = {
  driving: { label: 'Driving', color: 0x3b3f46, y: 0, raised: false, defaultWidth: 3.5, vehicle: true },
  bus: { label: 'Bus lane', color: 0x8a2c2c, y: 0, raised: false, defaultWidth: 3.5, vehicle: true },
  bike: { label: 'Bike lane', color: 0x2f7d4a, y: 0, raised: false, defaultWidth: 1.8, vehicle: false },
  parking: { label: 'Parking', color: 0x52565d, y: 0, raised: false, defaultWidth: 2.3, vehicle: false },
  shoulder: { label: 'Shoulder', color: 0x6e6558, y: 0, raised: false, defaultWidth: 2.0, vehicle: false },
  sidewalk: { label: 'Sidewalk', color: 0xc9c5bb, y: 0.15, raised: true, defaultWidth: 3.0, vehicle: false },
  pathway: { label: 'Pathway', color: 0xbfa77c, y: 0.01, raised: false, defaultWidth: 3.0, vehicle: false },
  railway: { label: 'Railway ballast', color: 0x6b655c, y: 0.04, raised: false, defaultWidth: 3.0, vehicle: false },
};

export const CENTRE_COLOR = 0x5e8a45; // median grass
export const CENTRE_RAISED_Y = 0.15;
export const CURB_COLOR = 0xe2ded4;

export interface Band {
  type: LaneType | 'median' | 'centre';
  lo: number;
  hi: number;
  y: number;
  raised: boolean;
  color: number;
}

/** All bands sorted by ascending offset (right-hand side first, then median, then left). */
export function layoutBands(p: LaneProfile): Band[] {
  const bands: Band[] = [];
  const half = p.centre.kind === 'median' ? p.centre.width / 2 : 0;

  // Right side, outward from the centre (offsets go negative).
  let cursor = -half;
  const rightBands: Band[] = [];
  for (const lane of p.right) {
    const info = LANE_INFO[lane.type];
    const hi = cursor;
    const lo = cursor - lane.width;
    rightBands.push({ type: lane.type, lo, hi, y: info.y, raised: info.raised, color: info.color });
    cursor = lo;
  }
  // Left side, outward from the centre.
  cursor = half;
  const leftBands: Band[] = [];
  for (const lane of p.left) {
    const info = LANE_INFO[lane.type];
    const lo = cursor;
    const hi = cursor + lane.width;
    leftBands.push({ type: lane.type, lo, hi, y: info.y, raised: info.raised, color: info.color });
    cursor = hi;
  }

  // Ascending offsets: right side (reversed so the outermost is first).
  for (let i = rightBands.length - 1; i >= 0; i--) bands.push(rightBands[i]);
  if (p.centre.kind === 'median') {
    bands.push({
      type: 'median',
      lo: -half,
      hi: half,
      y: CENTRE_RAISED_Y,
      raised: true,
      color: CENTRE_COLOR,
    });
  }
  for (const b of leftBands) bands.push(b);
  return bands;
}

/** Half-width of the whole cross-section (outermost band edge, either side). */
export function totalExtent(p: LaneProfile): { lo: number; hi: number } {
  const bands = layoutBands(p);
  if (!bands.length) return { lo: -1, hi: 1 };
  return { lo: bands[0].lo, hi: bands[bands.length - 1].hi };
}

/** Extent of the drivable / walkable flat surface (non-raised bands). */
export function flatExtent(p: LaneProfile): { lo: number; hi: number } {
  const flat = layoutBands(p).filter((b) => !b.raised);
  if (!flat.length) return { lo: -1, hi: 1 };
  return {
    lo: Math.min(...flat.map((b) => b.lo)),
    hi: Math.max(...flat.map((b) => b.hi)),
  };
}

export type MarkingStyle = 'solid' | 'dashed' | 'doubleYellow' | 'none';

export interface Marking {
  /** Offset of the line centre from the centreline. */
  offset: number;
  style: MarkingStyle;
  colour: number;
}

const WHITE = 0xf2f2ee;
const YELLOW = 0xf0c020;

/**
 * Markings on the boundary between two adjacent flat bands. Kerbed boundaries
 * (where one side is raised) get no paint; the kerb itself is drawn instead.
 */
export function boundaryMarking(a: Band, b: Band): Marking | null {
  if (a.raised || b.raised) return null;
  const offset = a.hi === b.lo ? a.hi : (a.hi + b.lo) / 2;
  const t = [a.type, b.type].sort().join('|');
  const pair = (x: string) => t === x;
  if (a.type === 'railway' || b.type === 'railway') return null;
  if (a.type === 'pathway' || b.type === 'pathway') return null;
  if (pair('driving|driving')) return { offset, style: 'dashed', colour: WHITE };
  if (pair('bus|driving')) return { offset, style: 'solid', colour: WHITE };
  if (pair('bike|driving')) return { offset, style: 'solid', colour: WHITE };
  if (pair('driving|parking')) return { offset, style: 'solid', colour: WHITE };
  if (pair('driving|shoulder')) return { offset, style: 'solid', colour: WHITE };
  if (pair('bike|parking') || pair('bike|bus') || pair('bus|parking') || pair('bus|bus')) {
    return { offset, style: 'solid', colour: WHITE };
  }
  if (pair('parking|parking') || pair('bike|bike') || pair('shoulder|shoulder')) return null;
  return { offset, style: 'solid', colour: WHITE };
}

/** Markings for the centre of the cross-section. */
export function centreMarkings(p: LaneProfile): Marking[] {
  const kind: CentreKind = p.centre.kind;
  if (kind === 'doubleYellow') {
    return [
      { offset: 0.2, style: 'solid', colour: YELLOW },
      { offset: -0.2, style: 'solid', colour: YELLOW },
    ];
  }
  if (kind === 'dashedWhite') return [{ offset: 0, style: 'dashed', colour: WHITE }];
  if (kind === 'none') {
    // Two-way local street without a centre line: mark it only between two driving lanes.
    const leftInner = p.left[0];
    const rightInner = p.right[0];
    if (leftInner?.type === 'driving' && rightInner?.type === 'driving') {
      return [{ offset: 0, style: 'dashed', colour: WHITE }];
    }
    return [];
  }
  // Median: no paint, the raised median edges carry the kerb.
  return [];
}

export interface Template {
  id: string;
  label: string;
  cls: RoadClass;
  profile: () => LaneProfile;
}

const lane = (type: LaneType, width?: number) => ({
  type,
  width: width ?? LANE_INFO[type].defaultWidth,
});

export const TEMPLATES: Template[] = [
  {
    id: 'highway-divided',
    label: 'Highway, divided 2×2 with shoulders',
    cls: 'highway',
    profile: () => ({
      centre: { kind: 'median', width: 3 },
      left: [lane('driving', 3.6), lane('driving', 3.6), lane('shoulder', 2.5)],
      right: [lane('driving', 3.6), lane('driving', 3.6), lane('shoulder', 2.5)],
    }),
  },
  {
    id: 'arterial-bus',
    label: 'Arterial with bus lanes',
    cls: 'arterial',
    profile: () => ({
      centre: { kind: 'doubleYellow', width: 0.4 },
      left: [lane('driving', 3.3), lane('bus', 3.5), lane('bike', 1.8), lane('sidewalk', 3.5)],
      right: [lane('driving', 3.3), lane('bus', 3.5), lane('bike', 1.8), lane('sidewalk', 3.5)],
    }),
  },
  {
    id: 'boulevard-bike-parking',
    label: 'Boulevard with bike lanes and parking',
    cls: 'boulevard',
    profile: () => ({
      centre: { kind: 'dashedWhite', width: 0.2 },
      left: [lane('driving', 3.3), lane('bike', 1.8), lane('parking', 2.3), lane('sidewalk', 3)],
      right: [lane('driving', 3.3), lane('bike', 1.8), lane('parking', 2.3), lane('sidewalk', 3)],
    }),
  },
  {
    id: 'local-parking',
    label: 'Local street, parking both sides',
    cls: 'local',
    profile: () => ({
      centre: { kind: 'none', width: 0 },
      left: [lane('driving', 3.0), lane('parking', 2.3), lane('sidewalk', 2.5)],
      right: [lane('driving', 3.0), lane('parking', 2.3), lane('sidewalk', 2.5)],
    }),
  },
  {
    id: 'pedestrian-path',
    label: 'Pedestrian path (paved)',
    cls: 'path',
    profile: () => ({
      centre: { kind: 'none', width: 0 },
      left: [lane('pathway', 2.5)],
      right: [lane('pathway', 2.5)],
    }),
  },
  {
    id: 'rail-line',
    label: 'Railway (standard gauge)',
    cls: 'rail',
    profile: () => ({
      centre: { kind: 'none', width: 0 },
      left: [lane('railway', 3.0)],
      right: [lane('railway', 3.0)],
    }),
  },
  {
    id: 'subway-line',
    label: 'Subway line (underground)',
    cls: 'subway',
    profile: () => ({
      centre: { kind: 'none', width: 0 },
      left: [lane('railway', 2.0)],
      right: [lane('railway', 2.0)],
    }),
  },
];

export function templateById(id: string): Template | undefined {
  return TEMPLATES.find((t) => t.id === id);
}

/** Default template for each road class, used when a class is picked in the UI. */
export function defaultTemplateFor(cls: RoadClass): Template {
  return TEMPLATES.find((t) => t.cls === cls) ?? TEMPLATES[0];
}

export function cloneProfile(p: LaneProfile): LaneProfile {
  return JSON.parse(JSON.stringify(p)) as LaneProfile;
}
