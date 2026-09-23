// Small diagnostic arrays only; never read the full fine field during playback.
export function fineCapacityStatus(keys, status, selected, capacity, iteration) {
  let bricks = 0, requested = 0, missing = 0;
  for (let slot = 0; slot < capacity; slot++) if (keys[slot * 4 + 3] > .5) bricks++;
  for (let id = 0; id < selected; id++) {
    if (status[id * 4 + 2] > .5) {
      requested++;
      if (status[id * 4 + 1] > .5) missing++;
    }
  }
  return { bricks, capacity, selected, requested, missing,
    complete: requested - missing, iteration };
}
export function fineCapacityText(report) {
  if (!report) return 'Fine-detail capacity will be checked after the next hydraulic update.';
  const n = v => v.toLocaleString();
  const summary = `Update ${n(report.iteration)} · ${n(report.bricks)} / ${n(report.capacity)} fine bricks · ${n(report.complete)} / ${n(report.requested)} contact footprints complete.`;
  return report.missing > 0
    ? `${summary} ${n(report.missing)} contacts blocked by unavailable fine storage. More particles cannot fix this limit. Existing detail is preserved; blocked contacts do not cut.`
    : `${summary} This measures residency, not erosion volume; use Audit for actual removal and deposition.`;
}
