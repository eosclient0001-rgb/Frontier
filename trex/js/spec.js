/**
 * spec.js — Osteological reference data + axial skeleton layout.
 *
 * Every number below is in METRES and refers to the reference specimen
 * FMNH PR 2081 ("Sue"), the most complete Tyrannosaurus rex known (~73-90%
 * complete, Hell Creek Formation, South Dakota).  Where the literature gives a
 * range, the mid-point is used and the range is recorded alongside.
 *
 * Frame convention used by the whole project
 * ------------------------------------------
 *   +X = the animal's RIGHT          (right = cross(forward, up))
 *   +Y = UP
 *   -Z = FORWARD (anterior)          (so forward is -Z, three.js default)
 *
 * The pelvis frame has its origin exactly at the acetabulum (hip socket), so
 * "hip height" and "acetabulum height" are the same quantity.
 *
 * Primary sources
 *   [1] Brochu, C.A. (2003). Osteology of Tyrannosaurus rex: insights from a
 *       nearly complete skeleton and high-resolution computed tomographic
 *       analysis of the skull. Journal of Vertebrate Paleontology 22(S4):1-138.
 *   [2] Franoys, "Tyrannosaurus rex skeletal diagram (FMNH PR 2081)" —
 *       osteological measurements table (skull 146 cm premaxilla-quadrate,
 *       femur 132.1 cm, tibiotarsus 124.5 cm, metatarsal III 67.1 cm,
 *       humerus 38.5-39 cm, longest rib 147.8 cm, scapulocoracoid 131 cm,
 *       hindlimb 327 cm, ilium height 59 cm, mandibular ramus 143.7 cm,
 *       skull width between temporal fenestrae 94.5 cm).
 *   [3] Hartman, S. skeletaldrawing.com — Tyrannosaurus rex FMNH PR 2081
 *       skeletal reconstruction, ~12.3 m total length.
 *   [4] Wikipedia "Specimens of Tyrannosaurus" / "Tyrannosaurus" — Sue
 *       12.3-12.4 m long, 3.66-3.96 m tall at the hips, 8.4-14 t; vertebral
 *       formula 10 cervical + 13 dorsal + 5 sacral + 47 caudal (Sue's mount);
 *       18-19 pairs of gastralia.
 *   [5] Persons & Currie / Carpenter & Smith — forelimb proportions
 *       (humerus : ulna : manus ~= 1 : 0.73 : 0.63 for a 12 m individual).
 *   [6] Sellers et al. (2017) PeerJ 3420 — stress-constrained multibody
 *       gait analysis: max ~7.7 m/s, aerial phase (duty factor < 0.5) only
 *       above ~5 m/s; Froude ~1.0 walk/run transition near 5 m/s.
 */

import { Vector3 } from 'three';

/** Published / derived reference measurements. */
export const SPEC = {
  specimen: 'FMNH PR 2081 "Sue"',

  // ---- whole animal -------------------------------------------------------
  totalLength: 12.3,      // axial (snout -> tail tip) [3]
  hipHeightMin: 3.66,     // tall at the hips [4]
  hipHeightMax: 3.96,
  massKg: 9130,           // mean of recent estimates for Sue [4]

  // ---- skull --------------------------------------------------------------
  skull: {
    length: 1.46,          // premaxilla -> posteroventral quadrate [2]
    lengthToCondyle: 1.30, // premaxilla -> occipital condyle [2]
    width: 0.945,          // across the temporal region [2]
    mandibleRamus: 1.437,  // [2]
    teethPerSide: { premaxilla: 4, maxilla: 12, dentary: 14 }, // ~58 total
  },

  // ---- axial skeleton -----------------------------------------------------
  counts: { cervical: 10, dorsal: 13, sacral: 5, caudal: 47 }, // [4]
  gastraliaPairs: 19,     // [4]
  longestRib: 1.478,      // [2]

  // ---- appendicular -------------------------------------------------------
  scapulocoracoid: 1.31,  // [2]
  iliumHeight: 0.59,      // [2]
  forelimb: { humerus: 0.390, ulna: 0.285, radius: 0.255, manus: 0.245 },
  hindlimb: { femur: 1.321, tibiotarsus: 1.245, metatarsalIII: 0.671, total: 3.27 }, // [2]

  // ---- stand / stance targets --------------------------------------------
  stance: {
    acetabulumHeight: 3.06,  // ilium top ≈ 3.68 m — within Sue's 3.66-3.96 m hip height [4]
    ankleHeight: 0.52,       // digitigrade: metatarsus held off the ground
    metatarsalPitch: 55,     // degrees from horizontal, mid-stance
  },
};

/** Centrum (vertebral body) lengths, anterior-most first per series. */
function caudalLengths(n) {
  // i = 1 at the tail base, n = the tip. Anterior caudals ~24 cm, tip ~3 cm.
  const out = [];
  for (let i = 1; i <= n; i++) {
    const u = (n - i) / (n - 1);            // 0 at base, 1 at tip
    out.push(0.033 + 0.218 * Math.pow(u, 1.50));
  }
  return out;
}
const DORSAL_LENGTHS = [0.212, 0.216, 0.221, 0.226, 0.230, 0.233, 0.234, 0.232, 0.229, 0.225, 0.220, 0.214, 0.207]; // D1..D13
const SACRAL_LENGTHS = [0.185, 0.192, 0.196, 0.192, 0.185];  // S1..S5
const CERVICAL_LENGTHS = [0.086, 0.101, 0.141, 0.150, 0.156, 0.161, 0.166, 0.170, 0.174, 0.176]; // C1..C10 (C1 atlas)

/**
 * Axial "curvature" profile. We build the column by integrating a heading
 * angle along it (so the arc length always equals the summed centrum lengths);
 * theta(f) is the pitch of the column, in radians, at fraction f of the way
 * from the tail tip (f = 0) to the atlas (f = 1).  Positive = rising as we
 * travel towards the head.
 *
 * Shape: tail droops at the tip and stiffens to horizontal over the hips,
 * trunk essentially horizontal with a slight rise to the shoulder, then the
 * classic theropod S-curve — a dip behind the skull followed by a strong
 * dorsal flexure carrying the head up above hip level.
 */
const HEADING_KEYS = [
  [0.00, 9], [0.10, 7], [0.22, 4.5], [0.34, 3.0], [0.46, 1.6], [0.53, 0.8],
  [0.60, 0.4], [0.70, 1.6], [0.79, 4.0], [0.845, 1.0], [0.885, -3.0],
  [0.925, 12.0], [0.955, 28.0], [0.98, 40.0], [1.00, 42.0],
];

function headingAt(f) {
  f = Math.min(1, Math.max(0, f));
  for (let i = 0; i < HEADING_KEYS.length - 1; i++) {
    const [f0, a0] = HEADING_KEYS[i];
    const [f1, a1] = HEADING_KEYS[i + 1];
    if (f <= f1) {
      const t = (f - f0) / (f1 - f0);
      const s = t * t * (3 - 2 * t);            // smoothstep
      return ((a0 + (a1 - a0) * s) * Math.PI) / 180;
    }
  }
  return (HEADING_KEYS[HEADING_KEYS.length - 1][1] * Math.PI) / 180;
}

/**
 * Integrate the vertebral column from the tail tip forwards.
 * Returns an ordered list, tail-tip first, atlas last:
 *   [ Ca47, Ca46, ... Ca1, S5, ... S1, D13, ... D1, C10, ... C1 ]
 * Each entry: { series, index, length, a: Vector3 (posterior/start point),
 *               b: Vector3 (anterior/end point), dir: Vector3, f }
 * Coordinates are in "tail-tip space" and are re-based onto the pelvis later.
 */
export function buildVertebralColumn() {
  const { cervical: NC, dorsal: ND, sacral: NS, caudal: NCA } = SPEC.counts;

  const items = [];
  const push = (series, index, length) => items.push({ series, index, length });
  const caud = caudalLengths(NCA);
  for (let i = NCA; i >= 1; i--) push('caudal', i, caud[i - 1]);
  for (let i = NS; i >= 1; i--) push('sacral', i, SACRAL_LENGTHS[i - 1]);
  for (let i = ND; i >= 1; i--) push('dorsal', i, DORSAL_LENGTHS[i - 1]);
  for (let i = NC; i >= 1; i--) push('cervical', i, CERVICAL_LENGTHS[i - 1]);

  const total = items.reduce((s, it) => s + it.length, 0);
  let travelled = 0;

  // Walk forwards from the tail tip. Start at an arbitrary origin; the whole
  // column is re-based onto the acetabulum afterwards.
  let p = new Vector3(0, 0, 0);
  for (const it of items) {
    const f = travelled / total;
    const theta = headingAt(f);
    // forward is -Z; positive theta = rising
    const dir = new Vector3(0, Math.sin(theta), -Math.cos(theta));
    it.a = p.clone();
    it.b = p.clone().addScaledVector(dir, it.length);
    it.dir = dir;
    it.f = f;
    p = it.b;
    travelled += it.length;
  }

  return { items, total };
}

/**
 * Full axial layout expressed in the PELVIS frame (origin = acetabulum,
 * +X right, +Y up, -Z forward).
 *
 * The acetabulum sits below sacral 2; the ilium blade rises ~0.59 m above it
 * [2], so the sacral centra sit ~0.30 m above the acetabulum.
 */
export function buildAxialLayout() {
  const { items, total } = buildVertebralColumn();

  // Locate the anterior end of sacral 1 and the centre of sacral 2.
  const s1 = items.find((it) => it.series === 'sacral' && it.index === 1);
  const s2 = items.find((it) => it.series === 'sacral' && it.index === 2);
  const acet = new Vector3(0, (s2.a.y + s2.b.y) / 2 - 0.30, (s2.a.z + s2.b.z) / 2 - 0.10);

  // Re-base: everything is expressed relative to the acetabulum.
  for (const it of items) {
    it.a.sub(acet);
    it.b.sub(acet);
  }

  const atlas = items[items.length - 1];
  const tailTip = items[0];

  return {
    items,
    axialLength: total,                       // tail tip -> atlas
    /** snout tip -> tail tip chord (what "total length" usually means) */
    chordLength: Math.abs(tailTip.a.z - atlas.b.z),
    atlasAnterior: atlas.b.clone(),
    atlasDir: atlas.dir.clone(),
    sacrumAnterior: s1.b.clone(),
    sacrumPosterior: items.find((it) => it.series === 'sacral' && it.index === SPEC.counts.sacral).a.clone(),
    tailTipPos: tailTip.a.clone(),
  };
}

/** Body cross-section profile, keyed by vertebral position, half-extents in m. */
export const PROFILE = {
  // series -> { [index]: [halfWidth, halfHeightDorsal, halfHeightVentral] }
  caudal: {
    1: [0.50, 0.55, 0.50], 2: [0.46, 0.52, 0.47], 3: [0.43, 0.49, 0.44],
    5: [0.375, 0.44, 0.39], 8: [0.30, 0.36, 0.32], 12: [0.225, 0.28, 0.245],
    16: [0.175, 0.22, 0.19], 20: [0.135, 0.175, 0.15], 26: [0.098, 0.13, 0.11],
    32: [0.070, 0.095, 0.080], 38: [0.050, 0.068, 0.058], 44: [0.036, 0.048, 0.042],
    47: [0.028, 0.036, 0.032],
  },
  sacral: { 5: [0.54, 0.60, 0.56], 3: [0.60, 0.66, 0.62], 1: [0.655, 0.72, 0.66] },
  dorsal: {
    13: [0.69, 0.74, 0.68], 11: [0.725, 0.78, 0.70], 9: [0.735, 0.80, 0.71],
    7: [0.725, 0.80, 0.70], 5: [0.70, 0.79, 0.68], 3: [0.655, 0.76, 0.65],
    1: [0.60, 0.72, 0.62],
  },
  cervical: {
    10: [0.53, 0.64, 0.58], 8: [0.45, 0.55, 0.50], 6: [0.39, 0.48, 0.44],
    4: [0.345, 0.43, 0.40], 2: [0.315, 0.39, 0.37], 1: [0.30, 0.37, 0.35],
  },
};

/** Linear interpolation of the profile table for a given series/index. */
export function profileAt(series, index) {
  const table = PROFILE[series];
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  if (index <= keys[0]) return table[keys[0]].slice();
  if (index >= keys[keys.length - 1]) return table[keys[keys.length - 1]].slice();
  for (let i = 0; i < keys.length - 1; i++) {
    const k0 = keys[i], k1 = keys[i + 1];
    if (index <= k1) {
      const t = (index - k0) / (k1 - k0);
      return table[k0].map((v, j) => v + (table[k1][j] - v) * t);
    }
  }
  return table[keys[keys.length - 1]].slice();
}
