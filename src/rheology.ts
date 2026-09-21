/** Generalized Newtonian demonstration, not calibrated food rheology.
 * Carreau (Yasuda exponent a=2) shear thinning and an Arrhenius temperature shift.
 * Temperature is a prescribed, spatially uniform bath value, not a heat solve.
 */
export interface RheologyParameters {
  baseViscosity: number;
  temperature: number;
  referenceTemperature: number;
  activationTemperature: number; // E/R in kelvin; illustrative, not measured
  shearThinning: number; // 0=Newtonian; 1=strong thinning
}

export function temperatureShift(celsius: number, referenceCelsius: number, activationTemperature: number) {
  const t = Math.max(253.15, Math.min(393.15, celsius + 273.15));
  const reference = referenceCelsius + 273.15;
  return Math.exp(Math.max(-3, Math.min(3, activationTemperature * (1 / t - 1 / reference))));
}

export function apparentViscosity(shearRate: number, parameters: RheologyParameters) {
  const { baseViscosity, temperature, referenceTemperature, activationTemperature } = parameters;
  const thinning = Math.max(0, Math.min(1, parameters.shearThinning));
  const nu0 = .5 * Math.max(0, baseViscosity) ** 2;
  const n = 1 - .85 * thinning;
  const shear = Math.max(0, shearRate);
  const factor = .12 + .88 * Math.pow(1 + (.6 * shear) ** 2, (n - 1) / 2);
  return Math.min(2, nu0 * factor * temperatureShift(temperature, referenceTemperature, activationTemperature));
}

/** sqrt(2 D:D), D = symmetric part of grad(v). Rigid rotation has zero shear. */
export function strainRate(g: ArrayLike<number>) {
  const xy = .5 * (g[1] + g[3]), xz = .5 * (g[2] + g[6]), yz = .5 * (g[5] + g[7]);
  return Math.sqrt(2 * (g[0] ** 2 + g[4] ** 2 + g[8] ** 2 + 2 * (xy * xy + xz * xz + yz * yz)));
}

/** Invert a symmetric neighborhood moment matrix, returning false for sparse/degenerate neighborhoods. */
export function invertMoment(a: Float64Array, out: Float64Array) {
  const a00 = a[0], a01 = a[1], a02 = a[2], a11 = a[4], a12 = a[5], a22 = a[8];
  const c00 = a11 * a22 - a12 * a12, c01 = a02 * a12 - a01 * a22, c02 = a01 * a12 - a02 * a11;
  const c11 = a00 * a22 - a02 * a02, c12 = a01 * a02 - a00 * a12, c22 = a00 * a11 - a01 * a01;
  const determinant = a00 * c00 + a01 * c01 + a02 * c02;
  const trace = a00 + a11 + a22;
  if (trace < 1e-10 || determinant < 1e-7 * trace ** 3) return false;
  const inverse = 1 / determinant;
  out[0] = c00 * inverse; out[1] = out[3] = c01 * inverse; out[2] = out[6] = c02 * inverse;
  out[4] = c11 * inverse; out[5] = out[7] = c12 * inverse; out[8] = c22 * inverse;
  return true;
}
