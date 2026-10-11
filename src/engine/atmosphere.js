// =================================================================================================
//  atmosphere.js — physical constants and the packed uniform block
// -------------------------------------------------------------------------------------------------
//  Scattering coefficients are in reciprocal METRES and follow the values used by production sky
//  models (Hillaire / Bruneton). The ozone layer is what turns a sunset orange instead of merely
//  red, so it is part of the model rather than an artistic afterthought.
// =================================================================================================

export const ATMO_DEFAULTS = {
  sunElevation: 32,
  sunAzimuth: 138,
  sunIntensity: 12,
  rayleighScale: 1.0,
  mieScale: 1.0,
  ozoneScale: 1.0,
  miePhaseG: 0.8,
  turbidity: 3.5,
  groundAlbedo: '#6d6353',
  referenceAltitude: 900,
};

const PLANET_RADIUS = 6360000;
const ATMO_TOP = 80000;
const H_RAYLEIGH = 8000;
const H_MIE = 1200;

const BETA_RAYLEIGH = [5.802e-6, 1.3558e-5, 3.31e-5];
const BETA_MIE_SCATTER = 3.996e-6;
const BETA_MIE_EXTINCTION = 8.436e-6;
const OZONE_ABSORPTION = [0.65e-6, 1.881e-6, 0.085e-6];
const OZONE_CENTRE = 25000;
const OZONE_WIDTH = 15000;
const SUN_DISC_RADIUS = 0.00465;

export function sunDirection(elevationDeg, azimuthDeg) {
  const el = (elevationDeg * Math.PI) / 180;
  const az = (azimuthDeg * Math.PI) / 180;
  const c = Math.cos(el);
  // Azimuth is measured clockwise from north, and north is -Z.
  return [c * Math.sin(az), Math.sin(el), -c * Math.cos(az)];
}

export const ATMO_FLOATS = 28;

export function packAtmoParams(v, state, marchSteps = 8, exposure = 1) {
  const [r, g, b] = hexToRgb(state.groundAlbedo ?? ATMO_DEFAULTS.groundAlbedo);
  const sun = sunDirection(state.sunElevation, state.sunAzimuth);
  const rs = state.rayleighScale ?? 1;
  const ms = state.mieScale ?? 1;
  const os = state.ozoneScale ?? 1;

  v[0] = PLANET_RADIUS;
  v[1] = ATMO_TOP;
  v[2] = H_RAYLEIGH;
  v[3] = H_MIE;

  v[4] = BETA_RAYLEIGH[0] * rs;
  v[5] = BETA_RAYLEIGH[1] * rs;
  v[6] = BETA_RAYLEIGH[2] * rs;
  v[7] = state.miePhaseG ?? 0.8;

  v[8] = BETA_MIE_SCATTER * ms;
  v[9] = BETA_MIE_SCATTER * ms;
  v[10] = BETA_MIE_SCATTER * ms;
  v[11] = BETA_MIE_EXTINCTION * ms;

  v[12] = OZONE_ABSORPTION[0] * os;
  v[13] = OZONE_ABSORPTION[1] * os;
  v[14] = OZONE_ABSORPTION[2] * os;
  v[15] = OZONE_CENTRE;

  v[16] = sun[0];
  v[17] = sun[1];
  v[18] = sun[2];
  v[19] = state.sunIntensity ?? 12;

  v[20] = OZONE_WIDTH;
  v[21] = marchSteps;
  v[22] = state.referenceAltitude ?? ATMO_DEFAULTS.referenceAltitude;
  v[23] = SUN_DISC_RADIUS;

  v[24] = r;
  v[25] = g;
  v[26] = b;
  v[27] = exposure;
}

export function hexToRgb(hex) {
  const h = (hex ?? '#000000').replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
}

// A rough correlated colour temperature for the sun, used only by the UI readout.
export function sunTint(elevationDeg) {
  const t = Math.max(0, Math.sin((elevationDeg * Math.PI) / 180));
  const warm = 1 - t;
  return `rgb(${Math.round(255)}, ${Math.round(255 - warm * 70)}, ${Math.round(255 - warm * 130)})`;
}
