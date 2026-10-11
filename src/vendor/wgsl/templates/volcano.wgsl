// Stratovolcano: cone profile, breached crater, radial gully network, lava levees.
//   lp[0] = (radius m, conePower, octaves, gain)
//   lp[1] = (gullyDepth, gullyFrequency, leveeAmount, flankDetail)
//   lp[2] = (baseLevel, craterRadius, craterDepth, rimHeight)
//   lp[3] = (variant, bearing, stretch, slopeSuppression)
//   lp[4] = (centerX 0..1, centerY 0..1, unused, unused)
fn layerShape(c: ShapeCtx) -> f32 {
  let s = seedOf(c.seed, 71u);
  let radius = max(c.lp[0].x, 1.0);
  let conePower = clamp(c.lp[0].y, 0.4, 4.0);
  let center = c.lp[4].xy;
  let d = length((c.uv - center) * vec2f(c.world)) / radius;
  let falloff = saturate(1.0 - d);
  var cone = pow(falloff, conePower);
  // Concave upper flank / convex lower flank: stratovolcano profile.
  cone = mix(cone, pow(saturate(1.0 - d * 0.75), conePower * 1.6), 0.45);

  let ang = atan2(c.uv.y - center.y, c.uv.x - center.x);
  let gullyField = ridgedFbm(vec2f(ang * 3.4, d * 2.6) + warpVec(c.uv * 8.0, 0.35, 1.0, s), 4u, 2.0, 0.5, 1.4, s + 9u);
  let gullies = (gullyField - 0.45) * c.lp[1].x * saturate(falloff * 1.4);
  let flank = fbm(c.uv * max(c.freq, 0.5) * 1.6, 4u, 2.0, 0.5, s + 21u);
  var h = cone + gullies + (flank - 0.5) * c.lp[1].w * falloff;

  // Crater: rim ring + internal bowl, with a breach toward the bearing.
  let craterR = clamp(c.lp[2].y, 0.005, 0.6);
  let breach = smoothstep(0.15, 0.0, abs(fract((ang - c.lp[3].y) / TAU + 0.5) - 0.5));
  let rim = radialRim(c.uv, center, radius * craterR, radius * craterR * 0.55, 2.2);
  let bowl = saturate(1.0 - smoothstep(0.0, radius * craterR * 1.15, length((c.uv - center) * vec2f(c.world))));
  h = h + rim * c.lp[2].w * (1.0 - breach * 0.85) - bowl * c.lp[2].z * (1.0 - breach * 0.6);

  // Lava levees: narrow raised channels radiating from the vent.
  let levee = ridgeLines(ang, d, s);
  h = h + levee * c.lp[1].z * saturate(falloff * 1.2);
  return h + c.lp[2].x;
}

fn ridgeLines(ang: f32, d: f32, s: u32) -> f32 {
  let k = 9.0;
  let f = abs(fract(ang / TAU * k + 0.5) - 0.5) * 2.0;
  return pow(saturate(1.0 - f), 6.0) * saturate(1.0 - d * 0.9) * 0.5;
}
