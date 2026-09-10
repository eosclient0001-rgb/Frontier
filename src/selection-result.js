import { SIZE } from "./field.js";
export const SELECTION_VOXELS = SIZE[0] * SIZE[1] * SIZE[2];
export function assertSelectionMask(mask) {
  if (!(mask instanceof Uint8Array) || mask.length !== SELECTION_VOXELS)
    throw new Error(
      "No valid piece selection was returned. Select the piece again; no rock was removed.",
    );
}
export function validSelectionResult(result) {
  if (
    !result ||
    !(result.mask instanceof Uint8Array) ||
    result.mask.length !== SELECTION_VOXELS
  )
    return false;
  const { count, total, fraction, whole, mask } = result;
  if (
    !Number.isInteger(count) ||
    !Number.isInteger(total) ||
    count <= 0 ||
    count > total ||
    total > SELECTION_VOXELS ||
    !Number.isFinite(fraction) ||
    Math.abs(fraction - count / total) > 1e-8 ||
    whole !== (count === total)
  )
    return false;
  let actual = 0;
  for (const v of mask) {
    if (v === 255) actual++;
    else if (v !== 0 && v !== 128) return false;
  }
  return actual === count;
}
