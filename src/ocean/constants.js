// Physical constants + Tunables based on 2023-2024 research
export const G = 9.81;
export const FFT_SIZE = 256; // GTX friendly, 0.7ms on GTX 1060 (Duan 2024)
export const CASCADES = 3;
export const CASCADE_SCALES = [1.0, 0.25, 0.06]; // 400m, 100m, 25m - multi-band like Donatini 2024
export const WIND_SPEED = 12.0; // m/s U10
export const WIND_DIR = Math.PI * 0.15;
export const FETCH = 20000.0; // 20km fetch for JONSWAP
export const DEPTH = 50.0; // meters, variable via bathymetry
export const JONSWAP_ALPHA = 0.076; // alpha_PM * ...
export const JONSWAP_GAMMA = 3.3;
export const TMA_KP_DEPTH = 1.0;
export const CHOPPY = 1.3;
export const FOAM_THRESHOLD_JACOBIAN = 0.35;
export const FOAM_DECAY = 0.92;
export const FOAM_GROW = 2.5;
