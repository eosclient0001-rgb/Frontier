// ─── Deterministic procedural track mathematics ─────────────────────────────
// The whole infinite circuit is a pure function of distance `s` (metres along
// the circuit, == world Z). Every system (geometry, physics, trains, signs)
// samples the SAME functions, so visuals and collision can never disagree.

export const TRACK_HALF = 13;          // 26 m wide — Wipeout-wide, 3 road lanes
export const BASE_Y = 11;              // circuit is an elevated deck above the city
export const SPLIT_START0 = 260;
export const SPLIT_PERIOD = 560;
export const SPLIT_LEN = 185;
export const CROSS_START = 175;
export const CROSS_PERIOD = 430;

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

// Centreline — gentle, wide-radius sweepers (no maze / lane-runner kinks)
export function centerX(s) {
  return 34 * Math.sin(s * 0.0032) + 20 * Math.sin(s * 0.00105 + 1.7) + 9 * Math.sin(s * 0.0085 + 0.5);
}
export function centerSlope(s) {
  return 34 * 0.0032 * Math.cos(s * 0.0032) + 20 * 0.00105 * Math.cos(s * 0.00105 + 1.7) + 9 * 0.0085 * Math.cos(s * 0.0085 + 0.5);
}
export function trackYBase(s) {
  return BASE_Y + 4.5 * Math.sin(s * 0.0021 + 0.8) + 2.8 * Math.sin(s * 0.00065 + 2.1) + 1.1 * Math.sin(s * 0.0058);
}
export function trackYSlope(s) {
  return 4.5 * 0.0021 * Math.cos(s * 0.0021 + 0.8) + 2.8 * 0.00065 * Math.cos(s * 0.00065 + 2.1) + 1.1 * 0.0058 * Math.cos(s * 0.0058);
}
export function headingAt(s) { return Math.atan2(centerSlope(s), 1); }
export function bankAt(s) {
  const yawRate = (headingAt(s + 9) - headingAt(s - 9)) / 18;
  return clamp(-yawRate * 240, -0.14, 0.14); // outer edge lifts in corners
}

// Frame at distance s. right = (cos h, 0, -sin h), forward = (sin h, 0, cos h)
export function frameAt(s) {
  const h = headingAt(s);
  return {
    s, h,
    cx: centerX(s), y: trackYBase(s),
    fx: Math.sin(h), fz: Math.cos(h),
    rx: Math.cos(h), rz: -Math.sin(h),
    bank: bankAt(s),
  };
}
export function pointAt(s, u, yExtra = 0) {
  const f = frameAt(s);
  return {
    x: f.cx + f.rx * u,
    y: f.y + branchYOff(s, u) + u * f.bank + yExtra,
    z: s + f.rz * u,
    frame: f,
  };
}
export function surfaceYAt(s, u) {
  const f = frameAt(s);
  return f.y + branchYOff(s, u) + u * f.bank;
}

// ─── Splits: Y (side-by-side) and UP/DOWN (one branch climbs a bridge deck) ──
export function splitAt(s) {
  const k = Math.floor((s - SPLIT_START0) / SPLIT_PERIOD);
  if (k < 0) return null;
  const start = SPLIT_START0 + k * SPLIT_PERIOD;
  if (s < start || s > start + SPLIT_LEN) return null;
  const t = (s - start) / SPLIT_LEN;
  // first split is always a Y so the player learns it; after that, deterministic mix
  const type = k === 0 ? 'Y' : (hash(k * 3.7) > 0.45 ? 'VERT' : 'Y');
  const profile = smoothstep(0, 0.27, t) * (1 - smoothstep(0.73, 1, t));
  return { k, start, t, type, profile };
}
export function nextSplit(s) {
  let k = Math.max(0, Math.floor((s - SPLIT_START0) / SPLIT_PERIOD));
  let start = SPLIT_START0 + k * SPLIT_PERIOD;
  if (s > start + SPLIT_LEN) { k++; start += SPLIT_PERIOD; }
  const type = k === 0 ? 'Y' : (hash(k * 3.7) > 0.45 ? 'VERT' : 'Y');
  return { k, start, type, dist: start - s };
}
export function branchParams(s) {
  const info = splitAt(s);
  if (!info) return null;
  const p = info.profile;
  const half = 6.5 + 2.2 * p;        // each branch starts as half the road, widens a touch
  const offset = 6.5 + 4.8 * p;      // …then forks apart, opening a real gap in the middle
  return {
    info, p, half,
    left:  { offset: -offset, half, yOff: 0 },
    right: { offset:  offset, half, yOff: info.type === 'VERT' ? 8.5 * p : 0 },
  };
}
export function branchYOff(s, u) {
  const b = branchParams(s);
  if (!b) return 0;
  const br = u < 0 ? b.left : b.right;
  return br.yOff;
}

// Sample the drivable surface under a world position.
// Physics and geometry both use this — what you see is exactly what you drive on.
export function groundAt(x, z) {
  const s = z;
  const f = frameAt(s);
  const dx = x - f.cx, dz = z - s;
  const u = dx * f.rx + dz * f.rz; // lateral offset from centreline
  const split = branchParams(s);
  if (split) {
    const br = u < 0 ? split.left : split.right;
    const localU = u - br.offset;
    const y = f.y + br.yOff + u * f.bank;
    const onTrack = Math.abs(localU) <= br.half;
    return {
      s, u, frame: f, split: true, splitType: split.info.type, profile: split.p,
      branch: br, left: split.left, right: split.right, localU, branchHalf: br.half,
      onTrack, y, groundY: onTrack ? y : 0, surface: onTrack ? 'track' : 'city',
    };
  }
  const y = f.y + u * f.bank;
  const onTrack = Math.abs(u) <= TRACK_HALF;
  return {
    s, u, frame: f, split: false, profile: 0,
    branch: null, localU: u, branchHalf: TRACK_HALF,
    onTrack, y, groundY: onTrack ? y : 0, surface: onTrack ? 'track' : 'city',
  };
}

// ─── Perpendicular railways (cross the circuit at right angles) ─────────────
export function crossingAt(k) {
  return {
    k,
    s: CROSS_START + k * CROSS_PERIOD,
    type: k % 2 === 0 ? 'LEVEL' : 'BRIDGE', // LEVEL = gates + train at track level; BRIDGE = train flies over you
    dir: k % 2 === 0 ? 1 : -1,
  };
}
export function nextCrossing(s) {
  const k = Math.max(0, Math.ceil((s - CROSS_START) / CROSS_PERIOD));
  return { ...crossingAt(k), dist: CROSS_START + k * CROSS_PERIOD - s };
}
