import { currentDomain, footprintLimits } from "./domain.js";
// Describe the solver that is actually active. Do not advertise the separate
// experimental sparse storage as if it already drove particle exchange.
export function erosionResolution(params = {}, domain = currentDomain()) {
  if (params.hydraulicShaping) {
    const cell = params.hydraulicCell ?? 0.5;
    return {
      mode: "fine-hydraulic",
      adaptiveActive: true,
      cell: [cell, cell, cell],
      supportDiameter: [cell * 3, cell * 3, cell * 3],
      nominalDiameterMm: params.agentDiameter ?? 3,
    };
  }
  const [min, max] = footprintLimits(domain);
  const requested = Number.isFinite(params.footprint) ? params.footprint : 0.45;
  const radius = Math.max(min, Math.min(max, requested));
  return {
    mode: "coarse-parcel",
    adaptiveActive: false,
    cell: [...domain.cell],
    supportDiameter: domain.cell.map((c) => 2 * Math.max(radius, c * 0.95)),
    nominalDiameterMm: params.agentDiameter ?? 3,
  };
}
export function erosionResolutionText(params, domain) {
  const r = erosionResolution(params, domain);
  const dimensions = r.supportDiameter.map((v) => v.toFixed(2)).join(" × ");
  if (r.adaptiveActive)
    return `Hydraulic shaping: ${r.cell[0]} m XYZ cells; ${r.supportDiameter[0].toFixed(2)} m kernel width. Actual local geometry, not marker size. Refinement is world-wide but memory-bounded; audit reports unresolved contacts. Maximum fine-layer displacement is 4 m.`;
  return `Current solver: coarse parcel erosion. New contacts spread over up to ${dimensions} m (XYZ bounding support), not the nominal ${r.nominalDiameterMm} mm agent diameter. Choose Hydraulic shaping for fine-grid exchange; this weather workflow uses the coarse base grid.`;
}
