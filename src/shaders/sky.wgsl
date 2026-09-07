// ===========================================================================
//  sky.wgsl — analytic sky, sun and aerial perspective.
//
//  Desert light is half the look. A low sun raking across the strata is what
//  makes the relief read; warm bounce light from red rock filling the shadows
//  is what stops the shadows looking dead; and haze building with distance is
//  most of what communicates the enormous scale of a canyon.
// ===========================================================================

#include "common.wgsl"

fn sunDir() -> vec3f {
  return normalize(dirFromAngles(U.sunAzim, max(U.sunElev, 0.5)));
}

/// Rayleigh phase function.
fn phaseR(cosT: f32) -> f32 {
  return (3.0 / (16.0 * PI)) * (1.0 + cosT * cosT);
}

/// Henyey-Greenstein — forward-scattering dust and aerosol.
fn phaseHG(cosT: f32, g: f32) -> f32 {
  let g2 = g * g;
  let den = 1.0 + g2 - 2.0 * g * cosT;
  return (1.0 - g2) / (4.0 * PI * max(pow(den, 1.5), 1e-4));
}

/// Sky radiance for a view direction.
fn skyColor(rd: vec3f) -> vec3f {
  let sd = sunDir();
  let cosT = dot(rd, sd);
  let up = max(rd.y, -0.12);

  // Rayleigh coefficients (relative), giving the blue zenith.
  let betaR = vec3f(5.8e-3, 13.5e-3, 33.1e-3) * 62.0;
  // Dusty desert aerosol: warm, forward-scattering, strong near the horizon.
  let dust = saturate(U.turbidity - 1.6) / 8.4;
  let betaM = vec3f(4.0e-3, 4.2e-3, 4.4e-3) * mix(30.0, 180.0, dust);

  // Longer optical path toward the horizon.
  let zenith = 1.0 / max(up + 0.08, 0.02);
  let sZenith = 1.0 / max(sd.y + 0.08, 0.02);

  let tR = exp(-betaR * zenith * 0.012);
  let tM = exp(-betaM * zenith * 0.010);

  let sunTint = exp(-(betaR * 0.010 + betaM * 0.012) * sZenith);
  let sunCol = mix(vec3f(1.0, 0.42, 0.16), vec3f(1.0, 0.93, 0.84),
                   smoothstep(0.0, 0.42, sd.y)) * sunTint;

  var col = vec3f(0.0);
  col += betaR * phaseR(cosT) * (1.0 - tR) / max(betaR, vec3f(1e-6));
  col += betaM * phaseHG(cosT, 0.76) * (1.0 - tM) / max(betaM, vec3f(1e-6));
  col *= sunCol * 22.0;

  // Warm haze piling up at the horizon.
  let horizon = pow(1.0 - saturate(up), 5.0);
  col = mix(col, vec3f(0.72, 0.62, 0.52) * (0.55 + dust * 0.7), horizon * 0.72);

  // Ground half-space: warm reflected desert floor.
  if (rd.y < 0.0) {
    let g = saturate(-rd.y * 3.2);
    col = mix(col, vec3f(0.34, 0.24, 0.17), g * 0.82);
  }

  return max(col, vec3f(0.0)) * U.skyIntensity;
}

/// Sun disc + forward-scattered glow, added only where nothing was hit.
fn sunDisc(rd: vec3f) -> vec3f {
  let sd = sunDir();
  let cosT = dot(rd, sd);
  let disc = smoothstep(0.99965, 0.99992, cosT);
  let glow = pow(saturate(cosT), 900.0) * 0.6 + pow(saturate(cosT), 60.0) * 0.10;
  let warm = mix(vec3f(1.0, 0.45, 0.18), vec3f(1.0, 0.95, 0.88),
                 smoothstep(0.0, 0.35, sd.y));
  return warm * (disc * 90.0 + glow * 6.0) * U.sunIntensity;
}

/// Direct sunlight colour reaching the ground.
fn sunLight() -> vec3f {
  let sd = sunDir();
  let t = smoothstep(0.0, 0.30, sd.y);
  let col = mix(vec3f(1.0, 0.38, 0.13), vec3f(1.0, 0.96, 0.90), t);
  let atten = mix(0.28, 1.0, t);
  return col * atten * 4.2 * U.sunIntensity;
}

/// Ambient sky light arriving at a surface with normal n.
fn skyAmbient(n: vec3f) -> vec3f {
  let zenithCol = vec3f(0.30, 0.42, 0.62);
  let horizCol  = vec3f(0.52, 0.48, 0.44);
  let t = saturate(n.y * 0.5 + 0.5);
  return mix(horizCol, zenithCol, t) * 0.55 * U.skyIntensity;
}

/// Warm light bouncing off sunlit red rock into shadow. Without this term
/// canyon shadows render as flat black and the whole image dies.
fn bounceLight(n: vec3f, albedo: vec3f) -> vec3f {
  let sd = sunDir();
  let groundCol = vec3f(0.42, 0.24, 0.15);
  let facingDown = saturate(-n.y * 0.5 + 0.5);
  return groundCol * facingDown * saturate(sd.y) * 0.85 * U.bounceStrength;
}

/// Aerial perspective: blend toward the haze colour with distance.
fn applyFog(col: vec3f, dist: f32, rd: vec3f) -> vec3f {
  let sd = sunDir();
  let density = U.fogDensity * 0.0016;

  // Dust concentrates near the ground and drifts with the wind.
  let f = 1.0 - exp(-dist * density);

  // Haze is much brighter when looking toward the sun.
  let cosT = dot(rd, sd);
  let inscatter = phaseHG(cosT, 0.62) * 3.4 + 0.30;

  let hazeBase = mix(vec3f(0.60, 0.55, 0.50), vec3f(0.95, 0.80, 0.62),
                     saturate(inscatter * 0.30));
  let haze = hazeBase * mix(0.55, 1.35, saturate(sunDir().y + 0.25)) * U.skyIntensity;

  return mix(col, haze, saturate(f));
}
