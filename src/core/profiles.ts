// Road profiles: lateral cross-sections (lanes, bus/cycle/parking bands, sidewalks, medians, dirt, rail).
// A profile is a function of per-road options and a seeded RNG, so two roads of the same profile still differ.

import { Rng } from "./math";

export type BandKind =
  | "drive"
  | "bus"
  | "cycle"
  | "parking"
  | "sidewalk"
  | "median"
  | "verge"
  | "shoulder"
  | "dirt"
  | "paving"
  | "ballast"
  | "tunnel";

export interface Band {
  kind: BandKind;
  w: number; // [m] - Lateral width of the band
  elev: number; // [m] - Height above the carriageway surface (kerbs, medians, sidewalks)
}

export type ProfileId =
  | "motorway"
  | "boulevard"
  | "avenue"
  | "street"
  | "residential"
  | "country"
  | "track"
  | "footpath"
  | "cycleway"
  | "railway"
  | "subway";

export type ProfileCategory = "urban" | "highway" | "country" | "offroad" | "pedestrian" | "rail" | "underground";

export interface RoadOptions {
  lanes?: 1 | 2 | 3; // lanes per direction (ignored by pedestrian/rail profiles)
  bus?: boolean; // dedicated bus lane on the outer lane
  cycle?: boolean; // painted or separated cycle lane
  parking?: boolean; // parallel parking bays
  sidewalks?: boolean; // pedestrian sidewalks / paving
  speedBumps?: boolean; // raised speed bumps on the carriageway
  bollards?: boolean; // bollard row on separators and footpaths
  lamps?: boolean; // street lamp posts along the kerb
}

export interface ProfileDefinition {
  id: ProfileId;
  label: string;
  category: ProfileCategory;
  speedKmh: number;
  swatch: string; // UI colour
  description: string;
  defaults: Required<RoadOptions>;
  rail: boolean;
  underground: boolean;
  // Build the lateral bands from left (+W) to right (-W). Total width is centred on the centreline.
  bands: (opts: Required<RoadOptions>, rng: Rng) => Band[];
}

const jitter = (rng: Rng, w: number): number => w * rng.range(0.96, 1.04);

function laneBands(kind: "drive" | "bus", n: number, rng: Rng, w: number): Band[] {
  const out: Band[] = [];
  for (let i = 0; i < n; i++) out.push({ kind, w: jitter(rng, w), elev: 0 });
  return out;
}

const noOpts: Required<RoadOptions> = {
  lanes: 1,
  bus: false,
  cycle: false,
  parking: false,
  sidewalks: false,
  speedBumps: false,
  bollards: false,
  lamps: false
};

export const PROFILES: Record<ProfileId, ProfileDefinition> = {
  motorway: {
    id: "motorway",
    label: "Motorway",
    category: "highway",
    speedKmh: 110,
    swatch: "#f2b33d",
    description: "Divided dual carriageway with hard shoulders and a concrete barrier median.",
    defaults: { ...noOpts, lanes: 3 },
    rail: false,
    underground: false,
    bands(o, rng) {
      // Ordered left (+W) to right (-W): outer shoulder, carriageway, barrier median, carriageway, shoulder.
      return [
        { kind: "shoulder", w: jitter(rng, 3.0), elev: 0 },
        ...laneBands("drive", o.lanes, rng, 3.6),
        { kind: "median", w: jitter(rng, 4.0), elev: 0.45 },
        ...laneBands("drive", o.lanes, rng, 3.6),
        { kind: "shoulder", w: jitter(rng, 3.0), elev: 0 }
      ];
    }
  },
  boulevard: {
    id: "boulevard",
    label: "Boulevard",
    category: "urban",
    speedKmh: 50,
    swatch: "#ff8a4c",
    description: "Two-way arterial with optional bus lanes, cycle lanes, parking and wide sidewalks.",
    defaults: { ...noOpts, lanes: 2, bus: true, cycle: true, parking: true, sidewalks: true, lamps: true },
    rail: false,
    underground: false,
    bands(o, rng) {
      const bands: Band[] = [];
      if (o.sidewalks) bands.push({ kind: "sidewalk", w: jitter(rng, 3.6), elev: 0.15 });
      if (o.parking) bands.push({ kind: "parking", w: jitter(rng, 2.4), elev: 0 });
      if (o.cycle) bands.push({ kind: "cycle", w: jitter(rng, 1.9), elev: 0 });
      if (o.bus) bands.push({ kind: "bus", w: jitter(rng, 3.6), elev: 0 });
      bands.push(...laneBands("drive", o.lanes, rng, 3.3));
      bands.push({ kind: "median", w: jitter(rng, 2.0), elev: 0.12 });
      bands.push(...laneBands("drive", o.lanes, rng, 3.3));
      if (o.bus) bands.push({ kind: "bus", w: jitter(rng, 3.6), elev: 0 });
      if (o.cycle) bands.push({ kind: "cycle", w: jitter(rng, 1.9), elev: 0 });
      if (o.parking) bands.push({ kind: "parking", w: jitter(rng, 2.4), elev: 0 });
      if (o.sidewalks) bands.push({ kind: "sidewalk", w: jitter(rng, 3.6), elev: 0.15 });
      return bands;
    }
  },
  avenue: {
    id: "avenue",
    label: "Avenue",
    category: "urban",
    speedKmh: 40,
    swatch: "#ffd166",
    description: "Two-way city avenue with parking, sidewalks and an optional cycle lane.",
    defaults: { ...noOpts, lanes: 1, parking: true, sidewalks: true, cycle: false, lamps: true },
    rail: false,
    underground: false,
    bands(o, rng) {
      const bands: Band[] = [];
      if (o.sidewalks) bands.push({ kind: "sidewalk", w: jitter(rng, 3.0), elev: 0.15 });
      if (o.parking) bands.push({ kind: "parking", w: jitter(rng, 2.3), elev: 0 });
      if (o.cycle) bands.push({ kind: "cycle", w: jitter(rng, 1.8), elev: 0 });
      bands.push(...laneBands("drive", o.lanes, rng, 3.3));
      bands.push(...laneBands("drive", o.lanes, rng, 3.3));
      if (o.cycle) bands.push({ kind: "cycle", w: jitter(rng, 1.8), elev: 0 });
      if (o.parking) bands.push({ kind: "parking", w: jitter(rng, 2.3), elev: 0 });
      if (o.sidewalks) bands.push({ kind: "sidewalk", w: jitter(rng, 3.0), elev: 0.15 });
      return bands;
    }
  },
  street: {
    id: "street",
    label: "Street",
    category: "urban",
    speedKmh: 30,
    swatch: "#c9c9cf",
    description: "Ordinary city street, single lane each way, optional parking and sidewalks.",
    defaults: { ...noOpts, lanes: 1, parking: true, sidewalks: true, lamps: true, bollards: false },
    rail: false,
    underground: false,
    bands(o, rng) {
      const bands: Band[] = [];
      if (o.sidewalks) bands.push({ kind: "sidewalk", w: jitter(rng, 2.6), elev: 0.15 });
      if (o.parking) bands.push({ kind: "parking", w: jitter(rng, 2.2), elev: 0 });
      bands.push(...laneBands("drive", o.lanes, rng, 3.1));
      bands.push(...laneBands("drive", o.lanes, rng, 3.1));
      if (o.parking) bands.push({ kind: "parking", w: jitter(rng, 2.2), elev: 0 });
      if (o.sidewalks) bands.push({ kind: "sidewalk", w: jitter(rng, 2.6), elev: 0.15 });
      return bands;
    }
  },
  residential: {
    id: "residential",
    label: "Residential",
    category: "urban",
    speedKmh: 20,
    swatch: "#9bd17b",
    description: "Narrow residential road, sidewalks on both sides and speed bumps on the carriageway.",
    defaults: { ...noOpts, lanes: 1, sidewalks: true, speedBumps: true, lamps: true },
    rail: false,
    underground: false,
    bands(o, rng) {
      const bands: Band[] = [];
      if (o.sidewalks) bands.push({ kind: "sidewalk", w: jitter(rng, 2.0), elev: 0.14 });
      bands.push(...laneBands("drive", o.lanes, rng, 2.8));
      bands.push(...laneBands("drive", o.lanes, rng, 2.8));
      if (o.sidewalks) bands.push({ kind: "sidewalk", w: jitter(rng, 2.0), elev: 0.14 });
      return bands;
    }
  },
  country: {
    id: "country",
    label: "Country road",
    category: "country",
    speedKmh: 80,
    swatch: "#8fb9a8",
    description: "Rural two-lane road with gravel shoulders and grass verges, no footways.",
    defaults: { ...noOpts, lanes: 1 },
    rail: false,
    underground: false,
    bands(o, rng) {
      return [
        { kind: "verge", w: jitter(rng, 1.8), elev: 0 },
        { kind: "shoulder", w: jitter(rng, 1.0), elev: 0 },
        ...laneBands("drive", o.lanes, rng, 3.1),
        ...laneBands("drive", o.lanes, rng, 3.1),
        { kind: "shoulder", w: jitter(rng, 1.0), elev: 0 },
        { kind: "verge", w: jitter(rng, 1.8), elev: 0 }
      ];
    }
  },
  track: {
    id: "track",
    label: "Off-road track",
    category: "offroad",
    speedKmh: 25,
    swatch: "#a67c52",
    description: "Unsurfaced dirt track through fields and forest. Ruts and puddles are generated per road.",
    defaults: { ...noOpts, lanes: 1 },
    rail: false,
    underground: false,
    bands(_o, rng) {
      return [{ kind: "dirt", w: jitter(rng, 3.2), elev: 0 }];
    }
  },
  footpath: {
    id: "footpath",
    label: "Footpath",
    category: "pedestrian",
    speedKmh: 0,
    swatch: "#e4d9b8",
    description: "Pedestrian paving path. Optional bollard row on both edges.",
    defaults: { ...noOpts, bollards: true, lamps: true },
    rail: false,
    underground: false,
    bands(_o, rng) {
      return [{ kind: "paving", w: jitter(rng, 2.6), elev: 0.04 }];
    }
  },
  cycleway: {
    id: "cycleway",
    label: "Cycleway",
    category: "pedestrian",
    speedKmh: 20,
    swatch: "#3fbf7f",
    description: "Segregated two-way cycle track with a bollard separator.",
    defaults: { ...noOpts, bollards: true },
    rail: false,
    underground: false,
    bands(_o, rng) {
      return [{ kind: "cycle", w: jitter(rng, 3.0), elev: 0 }];
    }
  },
  railway: {
    id: "railway",
    label: "Railway",
    category: "rail",
    speedKmh: 120,
    swatch: "#8d8d96",
    description: "Single-track railway on ballast. Road crossings become level crossings with barriers.",
    defaults: { ...noOpts },
    rail: true,
    underground: false,
    bands(_o, rng) {
      return [{ kind: "ballast", w: jitter(rng, 4.6), elev: 0 }];
    }
  },
  subway: {
    id: "subway",
    label: "Subway",
    category: "underground",
    speedKmh: 70,
    swatch: "#5b8cff",
    description: "Underground metro tunnel. Shown as a ghost tube with surface station entrances.",
    defaults: { ...noOpts },
    rail: true,
    underground: true,
    bands(_o, rng) {
      return [{ kind: "tunnel", w: jitter(rng, 5.6), elev: 0 }];
    }
  }
};

export const PROFILE_ORDER: ProfileId[] = [
  "motorway",
  "boulevard",
  "avenue",
  "street",
  "residential",
  "country",
  "track",
  "footpath",
  "cycleway",
  "railway",
  "subway"
];

export function isProfileId(v: unknown): v is ProfileId {
  return typeof v === "string" && (PROFILE_ORDER as string[]).includes(v);
}

// Resolve options: defaults, overridden by explicit options. Booleans from the road override defaults.
export function resolveOptions(id: ProfileId, opts?: RoadOptions): Required<RoadOptions> {
  return { ...PROFILES[id].defaults, ...(opts ?? {}) };
}

// Build the lateral band list for a road. Returns bands ordered left (+W) to right (-W) and total width.
export function buildSection(id: ProfileId, opts: Required<RoadOptions>, rng: Rng): { bands: Band[]; width: number } {
  const bands = PROFILES[id].bands(opts, rng);
  const width = bands.reduce((s, b) => s + b.w, 0);
  return { bands, width };
}
