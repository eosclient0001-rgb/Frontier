// Plain, controllable noise — the workhorse for masks, scratches and detail.
//   lp[0] = (featureScale m, octaves, lacunarity, gain)
//   lp[1] = (warpAmount, warpFrequency, amplitude, unused)
//   lp[2] = (level, sharpness, terraceAmount, terraceSteps)
//   lp[3] = (variant, bearing, stretch, slopeSuppression)
fn layerShape(c: ShapeCtx) -> f32 {
  let s = seedOf(c.seed, 97u);
  let octaves = u32(clamp(c.lp[0].y, 1.0, 12.0));
  let lac = clamp(c.lp[0].z, 1.4, 3.4);
  let gain = clamp(c.lp[0].w, 0.2, 0.72);
  let p = c.uv * max(c.freq, 0.5);
  let variant = u32(clamp(c.lp[3].x, 0.0, 9.0));
  var n = 0.5;
  switch (variant) {
    case 0u: { n = fbm(p, octaves, lac, gain, s); }
    case 1u: { n = billowFbm(p, octaves, lac, gain, s); }
    case 2u: { n = ridgedFbm(p, octaves, lac, gain, clamp(c.lp[2].y, 0.4, 6.0), s); }
    case 3u: { n = worleyFbm(p, octaves, lac, gain, s); }
    case 4u: { n = pingPongFbm(p, octaves, lac, gain, clamp(c.lp[2].y, 0.4, 6.0), s); }
    case 5u: { n = swissTurbulence(p, octaves, lac, gain, c.lp[1].x, s); }
    case 6u: { n = hybridMultifractal(p, octaves, lac, gain, 0.35, s); }
    case 7u: { n = warpFbm(p, c.lp[1].x, max(c.lp[1].y, 0.05), octaves, gain, s); }
    case 8u: { n = crackNetwork(p, octaves, lac, gain, clamp(c.lp[2].y * 0.1, 0.02, 0.6), s); }
    case 9u: { n = saturate(vnoise2(p, s) * 0.5 + 0.5); }
    default: { n = fbm(p, octaves, lac, gain, s); }
  }
  var h = mix(0.5, n, saturate(c.lp[1].z));
  let terrace = saturate(c.lp[2].z);
  if (terrace > 0.001) { h = mix(h, terraceCurve(h, max(c.lp[2].w, 2.0), 5.0), terrace); }
  return h + c.lp[2].x;
}
