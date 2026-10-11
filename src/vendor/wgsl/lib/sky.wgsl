// Frontier Terrain Forge — analytic sky model.
//
// Single-scattering atmosphere with Rayleigh and Mie terms, a sun disc of finite
// angular size, a horizon haze band and a starfield that fades in as the sun
// drops. Tuned against reference photometry rather than being a physically exact
// integral, which keeps it to a few dozen ALU per pixel on the sky pass and free
// for the same function to colour ambient light and reflections everywhere else.
//#include "mathx.wgsl"

fn rayleighPhase(cosTheta: f32) -> f32 {
  return 0.0596831 * (1.0 + cosTheta * cosTheta);   // 3/(16*PI)
}

fn miePhase(cosTheta: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(1.0 + g2 - 2.0 * g * cosTheta, 1.5));
}

fn hash13(p: vec3f) -> f32 {
  var q = fract(p * 0.1031);
  q = q + dot(q, q.zyx + vec3f(33.33));
  return fract((q.x + q.y) * q.z);
}

/// Sky radiance for a view direction. `sunDir` points from the surface toward
/// the sun; `hazeBoost` widens the Mie forward lobe for reflections.
fn skyColor(sunDirIn: vec3f, dirIn: vec3f, hazeBoost: f32) -> vec3f {
  let sunDir = normalize(sunDirIn);
  let dir = normalize(dirIn);
  let cosTheta = clamp(dot(dir, sunDir), -1.0, 1.0);

  let betaR = vec3f(5.8e-6, 13.5e-6, 33.1e-6);
  let betaM = 21e-6;
  let g = clamp(0.72 + hazeBoost * 0.12, 0.3, 0.95);

  // Optical depth along the view ray, clamped so the horizon stays finite.
  let up = max(dir.y, -0.06);
  let odR = 1.0 / (up + 0.12);
  let odM = 1.0 / (max(dir.y, -0.03) + 0.06);
  let sunUp = max(sunDir.y, -0.06);
  let sunOdR = 1.0 / (sunUp + 0.12);
  let sunOdM = 1.0 / (max(sunDir.y, -0.03) + 0.06);

  let transR = exp(-betaR * odR * 16000.0);
  let transM = exp(-betaM * odM * 12000.0);
  let sunTransR = exp(-betaR * sunOdR * 16000.0);
  let sunTransM = exp(-betaM * sunOdM * 12000.0);
  let sunTrans = sunTransR * sunTransM;

  // Sun energy: warm and dim near the horizon, neutral and bright overhead.
  let sunElev = clamp(sunDir.y, -0.35, 1.0);
  let sunTint = mix(vec3f(1.25, 0.62, 0.28), vec3f(1.0, 0.96, 0.92), saturate(sunElev * 2.6 + 0.35));
  let sunEnergy = mix(0.25, 26.0, saturate(sunElev * 3.2 + 0.42)) * sunTint;

  let inScatter = (betaR * rayleighPhase(cosTheta) * (1.0 - transR) + vec3f(betaM) * miePhase(cosTheta, g) * (1.0 - transM)) * sunEnergy * sunTrans;
  // Sky radiance is the in-scattered light; a small floor keeps the zenith from
  // going pure black when the sun is far below the horizon.
  var color = inScatter * 500.0 + vec3f(0.0012, 0.0018, 0.0032);

  // Horizon haze: dense air near the ground reads much brighter than the zenith.
  let horizon = exp(-max(dir.y, 0.0) * 14.0);
  color = color + sunTrans * sunTint * horizon * 0.06 * (1.0 + hazeBoost);

  // Sun disc with limb softening.
  let cosSunSize = cos(0.0092);
  let disc = smoothstep(cosSunSize, cosSunSize + 0.0006, cosTheta) * step(0.0, sunDir.y + 0.05);
  color = color + sunEnergy * sunTrans * disc * 3.0;

  // Night sky: stars once the sun is well below the horizon.
  let night = saturate(-sunDir.y * 3.2 - 0.1);
  if (night > 0.001) {
    let cell = floor(dir * 260.0);
    let r = hash13(cell);
    let star = pow(saturate(r - 0.9965) * 285.0, 1.6);
    let twinkle = 0.75 + 0.25 * sin(r * 90.0 + 1.0);
    let starColor = mix(vec3f(0.85, 0.9, 1.0), vec3f(1.0, 0.88, 0.72), fract(r * 31.7));
    color = color + starColor * star * night * twinkle * 2.4;
    // Milky-way style band.
    let band = exp(-pow(abs(dot(dir, normalize(vec3f(0.36, 0.28, -0.9)))), 1.0) * 6.0);
    color = color + vec3f(0.014, 0.016, 0.028) * band * night;
  }
  return color;
}
