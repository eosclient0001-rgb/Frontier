// JONSWAP + TMA + Donelan-Banner directional spreading
// Based on:
// - Hasselmann 1973 JONSWAP, Bouws 1987 TMA (shallow water correction)
// - Donatini et al. 2024 "Physically accurate real-time synthesis" (frequency/direction -> wavenumber mapping)
// - Duan et al. 2024 self-adaptive filtering
import { G } from './constants.js';

// TMA shallow water factor Phi(w_h) from Bouws et al.
function tmaFactor(omega, depth) {
  if (depth > 500) return 1.0;
  const wh = omega * Math.sqrt(depth / G);
  if (wh <= 1) return 0.5 * wh * wh;
  if (wh < 6) {
    // polynomial approx from Bouws
    return 1 - 0.5 * Math.pow(2 - wh, 2);
  }
  return 1.0;
}

// JONSWAP spectrum S_J(omega)
export function jonswapSpectrum(omega, U10, fetch, gamma=3.3) {
  const g = G;
  // peak frequency from fetch law
  const alpha = 0.076 * Math.pow(g * fetch / (U10*U10), -0.22);
  const wp = 2 * Math.PI * 3.5 * Math.pow(g*g / (U10*fetch), 0.33); // peak angular freq
  const sigma = omega <= wp ? 0.07 : 0.09;
  const r = Math.exp(-Math.pow(omega - wp,2) / (2*sigma*sigma*wp*wp));
  const PM = alpha * g*g * Math.pow(omega, -5) * Math.exp(-1.25*Math.pow(wp/omega,4));
  return PM * Math.pow(gamma, r);
}

// Donelan-Banner directional spreading Dir(omega, theta)
export function directionalSpreading(theta, omega, wp) {
  const beta_s = omega < wp ? 2.61 * Math.pow(omega/wp, 1.3) : 2.28 * Math.pow(wp/omega, 1.3);
  const theta_p = 0; // relative to wind
  const sech = 1.0 / Math.cosh(beta_s * (theta - theta_p));
  return 0.5 * beta_s * sech*sech;
}

// Phillips-like wavenumber spectrum from frequency spectrum via Jacobian
// E(k) dk = S(w) dw , dw/dk from dispersion
// Dispersion with finite depth: w = sqrt(g k tanh(k d))
export function dispersion(k, depth) {
  if (k < 0.001) return 0;
  return Math.sqrt(G * k * Math.tanh(k * depth));
}
export function dispersionDerivative(k, depth) {
  if (k < 0.001) return 0;
  const th = Math.tanh(k*depth);
  const sech2 = 1 - th*th;
  const w = Math.sqrt(G*k*th);
  return 0.5 * G * (th + k*depth*sech2) / w;
}

// Build initial spectrum texture data on CPU (then upload to GPU)
// Returns Float32Array RGBA32F: RG = h0(k), BA = h0*(-k) conj handling later
export function buildInitialSpectrum(size, patchLength, depth, windSpeed, windDir, fetch) {
  const N = size;
  const data = new Float32Array(N*N*4);
  const L = patchLength;
  const dk = 2*Math.PI / L;
  // precompute random Gaussian via Box-Muller with fixed seed for reproducibility
  let seed = 1337;
  function rand() { seed = (seed*16807)%2147483647; return (seed-1)/2147483646; }
  function gaussian() {
    const u1 = rand() || 1e-6, u2 = rand();
    return Math.sqrt(-2*Math.log(u1))*Math.cos(2*Math.PI*u2);
  }
  for (let y=0; y<N; y++) {
    for (let x=0; x<N; x++) {
      const i = y*N + x;
      const kx = (x - N/2) * dk;
      const ky = (y - N/2) * dk;
      const k = Math.hypot(kx, ky);
      if (k < 1e-6) { data[i*4]=0; data[i*4+1]=0; data[i*4+2]=0; data[i*4+3]=0; continue; }
      const theta = Math.atan2(ky, kx) - windDir;
      const omega = dispersion(k, depth);
      const wp = 2*Math.PI*3.5*Math.pow(G*G/(windSpeed*fetch),0.33);
      const S_j = jonswapSpectrum(omega, windSpeed, fetch);
      const Phi = tmaFactor(omega, depth);
      const D = directionalSpreading(theta, omega, wp);
      // Convert S(w) to S(k): S(k) = S(w) * dw/dk * (1/k) * D
      const dwdk = dispersionDerivative(k, depth);
      const Sk = S_j * Phi * D * dwdk / k; // energy
      // Amplitude sqrt(2*Sk*dk*dk) * Gaussian random
      const amp = Math.sqrt(2*Sk*dk*dk) * 0.5;
      const gr = gaussian();
      const gi = gaussian();
      data[i*4+0] = gr * amp;
      data[i*4+1] = gi * amp;
      // store k vector for later (normalized)
      data[i*4+2] = kx / (k||1);
      data[i*4+3] = ky / (k||1);
    }
  }
  return data;
}
