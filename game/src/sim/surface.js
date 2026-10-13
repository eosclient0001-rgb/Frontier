// Finds which road section the car is on. Roads can overlap in plan view (viaducts,
// Y-splits), so candidates are scored by height match first, then closeness to centre line.
import { ROAD } from '../world/constants.js';

const ON_ROAD_LIMIT = ROAD.OUTER + 3;

/**
 * @param {import('../world/route.js').Route} route
 * @param {number} x
 * @param {number} y  current car height (used to pick between stacked roads)
 * @param {number} z
 * @param {object|null} hint  section the car was on last step (small stickiness)
 * @returns {{sec, s, lat, h, grade, bank, d}|null}
 */
export function queryRoad(route, x, y, z, hint = null) {
  let best = null;
  let bestScore = Infinity;
  for (const sec of route.sections) {
    if (x < sec.minX || x > sec.maxX || z < sec.minZ || z > sec.maxZ) continue;
    const q = sec.nearest(x, z);
    if (q.d > ON_ROAD_LIMIT) continue;
    if (Math.abs(q.lat) > ON_ROAD_LIMIT) continue;
    const h = sec.surfaceY(q.s, q.lat);
    const dy = Math.abs(y - h);
    let score = dy + 0.6 * q.d;
    if (sec === hint) score -= 0.35;
    if (score < bestScore) {
      bestScore = score;
      const pt = sec.point(q.s, 0);
      best = {
        sec,
        s: q.s,
        lat: q.lat,
        h,
        grade: pt.grade,
        bank: pt.bank,
        d: q.d,
        dy,
      };
    }
  }
  return best;
}
