// 2-D oriented-box overlap for car footprints (separating axis test).
// Each car is a box of half-length `hl` along its heading and half-width `hw` across it.

/**
 * @returns {{hit:boolean, depth:number, n:[number,number], gap:number}}
 *  hit: boxes overlap. depth: penetration along n. n: unit push direction for box A (away from B).
 *  gap: when not overlapping, the largest separation found on any axis (metres, >= 0 when apart).
 */
export function obbCollide(ax, az, ayaw, ahl, ahw, bx, bz, byaw, bhl, bhw) {
  const fa = [Math.cos(ayaw), Math.sin(ayaw)];
  const ra = [-fa[1], fa[0]];
  const fb = [Math.cos(byaw), Math.sin(byaw)];
  const rb = [-fb[1], fb[0]];
  const dx = bx - ax;
  const dz = bz - az;
  const axes = [fa, ra, fb, rb];
  let minOverlap = Infinity;
  let best = null;
  let maxGap = -Infinity;
  for (const u of axes) {
    const rA = ahl * Math.abs(fa[0] * u[0] + fa[1] * u[1]) + ahw * Math.abs(ra[0] * u[0] + ra[1] * u[1]);
    const rB = bhl * Math.abs(fb[0] * u[0] + fb[1] * u[1]) + bhw * Math.abs(rb[0] * u[0] + rb[1] * u[1]);
    const proj = dx * u[0] + dz * u[1];
    const overlap = rA + rB - Math.abs(proj);
    if (overlap <= 0) {
      maxGap = Math.max(maxGap, -overlap);
    } else if (overlap < minOverlap) {
      minOverlap = overlap;
      // push A away from B along this axis
      const s = proj > 0 ? -1 : 1;
      best = [u[0] * s, u[1] * s];
    }
  }
  if (maxGap >= 0) return { hit: false, depth: 0, n: [0, 0], gap: maxGap };
  return { hit: true, depth: minOverlap, n: best, gap: 0 };
}
