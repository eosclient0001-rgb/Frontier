// Mountain range generator.
//   lp[0] = (featureScale m, octaves, lacunarity, gain)
//   lp[1] = (warpAmount, warpFrequency, detailAmount, detailScale m)
//   lp[2] = (heightBias, ridgeSharpness, terraceAmount, terraceSteps)
//   lp[3] = (ridgeMix, bearing rad, stretch, slopeSuppression)
//   lp[5] = (erosionHints: valleyWidth, crestRoundness, snowNudge, unused)
fn layerShape(c: ShapeCtx) -> f32 {
  let s = seedOf(c.seed, 11u);
  let octaves = u32(clamp(c.lp[0].y, 1.0, 12.0));
  let lac = clamp(c.lp[0].z, 1.4, 3.4);
  let gain = clamp(c.lp[0].w, 0.2, 0.72);
  let warpAmt = c.lp[1].x;
  let warpFreq = max(c.lp[1].y, 0.03);
  let detailAmp = c.lp[1].z;
  let detailScale = max(c.lp[1].w, 4.0);
  let bias = c.lp[2].x;
  let sharp = clamp(c.lp[2].y, 0.4, 6.0);
  let terrace = saturate(c.lp[2].z);
  let terraceSteps = max(c.lp[2].w, 2.0);
  let ridgeMix = saturate(c.lp[3].x);
  let bearing = c.lp[3].y;
  let crestRound = clamp(c.lp[5].y, 0.0, 1.0);

  let p0 = rot2(c.uv, bearing) * max(c.freq, 0.5);
  let p = p0 + warpVec(p0, warpAmt, warpFreq, s);

  let mass = fbm(p * 0.2 + vec2f(3.1, 7.4), 3u, 2.02, 0.5, s + 5u);
  let ridge = ridgedFbm(p, octaves, lac, gain, sharp, s + 9u);
  let multi = hybridMultifractal(p * 0.55, octaves, lac, gain, 0.32, s + 21u);

  var h = mix(multi, ridge, ridgeMix);
  h = h * mix(0.5, 1.3, mass);
  h = pow(saturate(h), mix(1.3, mix(0.72, 0.95, crestRound), ridgeMix));
  h = saturate(h + (mass - 0.5) * 0.32);
  if (terrace > 0.001) { h = mix(h, terraceCurve(h, terraceSteps, 5.0), terrace); }

  // Rock detail that only appears on upper slopes: this is what sells scale.
  let dfreq = max(c.world / detailScale, 1.0);
  let detail = fbm(p * (dfreq / max(c.freq, 0.5)) * 1.7, 3u, 2.0, 0.55, s + 41u);
  h = h + (detail - 0.5) * detailAmp * (0.3 + 0.7 * h);
  return h + bias;
}
