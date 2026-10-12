// Specialized geometry for road-on-road merges. When a wider cross-section meets a
// narrower one at an angle (e.g. a 3-lane arterial meeting a 2-lane collector, or a
// 1-lane ramp meeting a 4-lane arterial), the current junction solver produces an
// uneven polygon. We add lane-merging features:
//
//  1. **Drop-lane taper** on the wider approach: the outermost driving lane is dropped
//     ~30 m before the junction with a solid white line and an arrow decal pointing
//     into the continuing lane. This avoids the "merge abruptly" visual.
//
//  2. **Add-lane taper** on the narrower approach: the edge's cross-section is widened
//     in the last 30 m with painted gore and a merge arrow.
//
//  3. **Angled-merge widening**: when the merge angle is acute (< 60°), the wider
//     approach's outer curb is pushed out so the junction polygon doesn't have a
//     concave corner. Markings and a fish-hook arrow at the entry.
//
// The actual cross-section width is what we cannot change per-feature (the profile is
// shared by the whole edge), so we work in paint only: a "ghost" taper strip painted in
// white that looks like a dropped lane, an arrow decal, and a fish-hook chevron.
//
// These are consumed by the edge paint() function (paint out of the wideEnd's outer
// lane) and by the junction build (chevrons in the merge zone).
import { getProfile, layout } from '../profiles.js';
import { line, dashed, decal, bar, tooth } from './markings.js';
import { yawFor } from './out.js';
import { TAU } from '../math.js';

// Find merge pairs in a junction. A merge pair is two incident ends whose:
//   - profile widths differ by ≥ 1.5 m
//   - they share an acute angle (the two tangent vectors are not antiparallel)
//
// Returns an array { wide, narrow, angle } sorted by angle.
export function detectMerges(J) {
  if (!J?.ends?.length) return [];
  const merges = [];
  for (let i = 0; i < J.ends.length; i++) for (let j = i + 1; j < J.ends.length; j++) {
    const A = J.ends[i], B = J.ends[j];
    const WA = layout(getProfile(A.edge)).total, WB = layout(getProfile(B.edge)).total;
    if (Math.abs(WA - WB) < 1.5) continue;
    const cosA = A.dx * B.dx + A.dz * B.dz;
    // Merge pairs must come INTO the junction from roughly opposite sides. If the
    // direction vectors are nearly antiparallel (cosA ≈ -1), they meet head-on and the
    // existing continuation logic already handles it. The interesting case is
    // acute-but-not-parallel: e.g. 30° angle.
    if (cosA < -0.92) continue;
    // they must not be the same road
    if (A.edge.id === B.edge.id) continue;
    const angle = Math.acos(Math.max(-1, Math.min(1, cosA)));
    merges.push({ wide: WA > WB ? A : B, narrow: WA > WB ? B : A, angle, angleCos: cosA, WA, WB });
  }
  return merges.sort((a, b) => a.angleCos - b.angleCos);
}

// For the wider approach in a merge, drop the outermost driving lane in the last
// `TAPER` metres: solid white line marking the new edge, an arrow decal pointing
// into the next lane, and a fish-hook taper (chevron). `setback` is the junction
// setback so we start the taper at `s = setback + TAPER` and end at `s = setback`.
const TAPER = 32;

export function paintMergeTaper(out, c, wide, narrow, sStart, lay) {
  // find the outermost drive lane in the wide profile
  const lanes = lay.lanes;
  // prefer a drive lane; fall back to the outermost non-raised lane
  let dropIdx = -1, dropDir = 1;
  for (let k = lanes.length - 1; k >= 0; k--) if (lanes[k].meta?.traffic) { dropIdx = k; break; }
  if (dropIdx < 0) {
    // No drive lane — can't merge in a driving sense; still paint a chevron at the curb.
    dropIdx = lanes.length - 1; dropDir = 1;
  }
  const outer = lanes[dropIdx];
  // the dropped lane is on the side of the road that points TOWARD the narrow
  // approach (i.e. the side where the merge is happening)
  // Compute the narrow's offset direction from the node in wide's right-of-d frame.
  // The narrow's right-of-d frame points AWAY from the node. The wide's right-of-d
  // points the same way (away from node) on the wide side. The narrow's lateral sign
  // tells us which side of the wide the merge is on.
  // (narrow.atA is true when the narrow's endpoint is the node; for the merge we want
  //  the side of the wide edge that is on the same side as the narrow edge.)
  const nDir = narrow.atA ? 1 : -1;            // narrow's outward (+s) direction sign
  // The narrow's offset sign in the wide's right-of-d frame
  // wide.rx, wide.rz = right normal of wide (in the wide's local frame)
  const nx = narrow.dx * nDir, nz = narrow.dz * nDir;
  // dot with the wide's right normal
  const side = Math.sign(nx * wide.rx + nz * wide.rz);
  // the dropped lane is on this side of the wide edge
  const oSide = side > 0 ? outer.o1 : outer.o0;
  // taper line: solid white, parallel to the lane, at (outer edge of dropped lane) +
  // 0.15 m inboard
  const taperO = side > 0 ? oSide - 0.15 : oSide + 0.15;
  // start the taper 32 m before the junction end of the wide
  const s0 = sStart - TAPER;
  // solid line at the new lane boundary
  line(out, 'markWhite', c, s0, sStart, taperO, 0.15, 0);
  // arrow on the dropped lane pointing into the next lane
  const dir = (narrow.atA ? -1 : 1) * side; // if narrow goes out at A and is on the + side, arrow points -s into continuation
  // we want the arrow to point toward the junction (-1 if wide.atA else +1 in the wide's
  // own frame). The dropped-lane's traffic travels toward the junction.
  const travelDir = wide.atA ? -1 : 1;
  const arrowS = (s0 + sStart) / 2;
  const arrowO = side > 0 ? (oSide + taperO) / 2 : (oSide + taperO) / 2;
  // pick an arrow style based on the dropped lane type
  if (outer.type === 'drive') decal(out, 'arrowSR', c, arrowS, arrowO, travelDir, 0, 0.8);
  else if (outer.type === 'bus' || outer.type === 'bike') decal(out, 'arrowS', c, arrowS, arrowO, travelDir, 0, 0.7);
  // fish-hook chevron: a series of small triangle teeth
  const teethN = 6;
  for (let k = 0; k < teethN; k++) {
    const sT = s0 + (sStart - s0) * (k + 0.5) / teethN;
    const t = (k + 0.5) / teethN;
    const oT = side > 0 ? oSide - (oSide - taperO) * t * 0.6 : oSide - (oSide - taperO) * t * 0.6;
    tooth(out, 'markWhite', c, sT, oT, travelDir, 0.4, 0.6, 0);
  }
  // SLOW text
  decal(out, 'slow', c, s0 - 14, taperO + side * 1.4, travelDir, 0);
  return { s0, s1: sStart, side, taperO, dropIdx };
}

// For the narrow approach in a merge, add a "ghost lane" widening in the last `TAPER`
// metres: a white lane line that defines the new merge lane. The narrow's actual
// cross-section doesn't change, but the user sees where the new lane is.
export function paintAddLaneTaper(out, c, narrow, sStart, lay, side) {
  // The new lane is added on the same side as the merge. We paint a dotted white line
  // for the new edge, starting at sStart - TAPER/2 to sStart.
  const s0 = sStart - TAPER * 0.6;
  // pick a sensible new lane offset: in the middle of the curb-side lane of the narrow
  const lanes = lay.lanes;
  let addSide = side; // -1 or +1 in narrow's right-of-d frame
  // the curb offset is lay.curbL (left) or lay.curbR (right)
  const curb = addSide < 0 ? lay.curbL : lay.curbR;
  const hasCurb = addSide < 0 ? lay.hasCurbL : lay.hasCurbR;
  if (!hasCurb) return; // no edge to add a lane against (one-way road / no sidewalk)
  // new lane = 3.2 m wide just inside the curb
  const oNew = addSide < 0 ? curb + 3.2 : curb - 3.2;
  dashed(out, 'markWhite', c, s0, sStart, oNew, 0.12, 3, 6, 0);
  // arrow on the new lane
  const travelDir = narrow.atA ? -1 : 1;
  decal(out, 'arrowS', c, (s0 + sStart) / 2, oNew, travelDir, 0, 0.7);
}
