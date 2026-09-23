/* ═══════════════ FRONTIER TYRE FORGE — tyre math ═══════════════
 * Procedural tyre sizing based on ISO metric tyre codes:
 *   WIDTH / ASPECT RATIO R RIM   e.g. 225/45 R17
 * All dimensions in millimetres. Wheel axis lies along X.
 */

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp  = (a, b, t) => a + (b - a) * t;

/** Deterministic PRNG (mulberry32) so patterns are stable per seed. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Full dimensional set derived from the three user parameters. */
export function tireSize(widthMM, aspect, rimIn) {
  const W  = widthMM;                        // section width
  const H  = (W * aspect) / 100;             // sidewall height
  const Rr = (rimIn * 25.4) / 2;             // rim radius
  const Ro = Rr + H;                         // loaded/outer radius
  const OD = 2 * Ro;                         // overall diameter
  const circ = Math.PI * OD;                 // rolling circumference
  return {
    W, H, Rr, Ro, OD,
    aspect, rimIn,
    circ,
    revPerKm: 1e6 / circ,
    speedoKmH_at_1000rpm: (circ / 1e6) * 1000 * 60,
    label: `${W}/${aspect} R${rimIn}`,
  };
}

/**
 * Tyre cross-section (profile) used both by the 3D lathe geometry and the
 * 2D blueprint drawing. Returns points {x (axial), r (radial), zone}
 * zone 1 = tread band (crown + upper shoulder), zone 0 = sidewall/bead.
 */
export function buildProfile(sz) {
  const { W, H, Rr, Ro } = sz;
  let rs     = clamp(W * 0.11, 6, 34);             // shoulder round radius
  let Tw     = clamp(W * 0.80, H * 0.9, W);        // tread face width
  /* keep shoulder arcs inside the section width on low-profile tyres */
  const maxTw = W - 2 * rs - 3;
  if (Tw > maxTw) rs = Math.max(4, (W - Tw - 3) / 2);
  const crownH = clamp(Tw * 0.032, 1.5, 7);        // centre crown rise
  const zT = Tw / 2, zW = W / 2;

  const pts = [];
  const zone = [];
  const push = (x, r, z) => { pts.push({ x, r }); zone.push(z); };

  /* left bead */
  push(-zW + 2.5, Rr - 1.5, 0);
  push(-zW + 1.0, Rr + 2.0, 0);

  /* left sidewall — quadratic bézier, bulging to max section width */
  const A = { x: -zW + 1.0, r: Rr + 2.0 };
  const B = { x: -(zW + 1), r: Rr + H * 0.62 };
  const C = { x: -zT - rs,  r: Ro - rs };            // shoulder-arc start
  for (let i = 1; i <= 18; i++) {
    const t = i / 18, mt = 1 - t;
    push(mt * mt * A.x + 2 * mt * t * B.x + t * t * C.x,
         mt * mt * A.r + 2 * mt * t * B.r + t * t * C.r, 0);
  }

  /* left shoulder — quarter arc onto the crown */
  const NS = 9;
  for (let k = 1; k <= NS; k++) {
    const th = (k / NS) * (Math.PI / 2);
    push(-zT - rs * Math.cos(th), Ro - rs + rs * Math.sin(th),
         k >= NS * 0.5 ? 1 : 0);
  }

  /* crown — gentle cosine crown rise across the tread face */
  const NC = 40;
  for (let m = 1; m <= NC; m++) {
    const z = -zT + (2 * zT * m) / NC;
    push(z, Ro + crownH * Math.cos((z / zT) * (Math.PI / 2)), 1);
  }

  /* right shoulder + sidewall: mirror of the left side */
  const left = pts.length;
  for (let j = left - 2; j >= 0; j--) {          // skip duplicated centre pt
    push(-pts[j].x, pts[j].r, zone[j]);
  }

  return { pts, zone, Tw, rs, crownH, zT, zW };
}

/** Human wear label for the HUD chip. */
export function wearLabel(w) {
  if (w < 0.05) return 'NEW';
  if (w < 0.30) return 'LIGHT USE';
  if (w < 0.60) return 'WORN';
  if (w < 0.85) return 'HEAVY WEAR';
  return 'BALD — CHANGE NOW';
}
