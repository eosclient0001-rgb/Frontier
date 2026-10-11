// Rolling hills / pasture generator. Rounded crests, shallow valleys.
//   lp[0] = (featureScale m, octaves, lacunarity, gain)
//   lp[1] = (warpAmount, warpFrequency, detailAmount, detailScale m)
//   lp[2] = (heightBias, roundness, terraceAmount, terraceSteps)
//   lp[3] = (billowMix, bearing, stretch, slopeSuppression)
fn layerShape(c: ShapeCtx) -> f32 {
  let s = seedOf(c.seed, 23u);
  let octaves = u32(clamp(c.lp[0].y, 1.0, 12.0));
  let lac = clamp(c.lp[0].z, 1.4, 3.4);
  let gain = clamp(c.lp[0].w, 0.2, 0.72);
  let warpAmt = c.lp[1].x * 0.7;
  let warpFreq = max(c.lp[1].y, 0.03) * 0.6;
  let detailAmp = c.lp[1].z * 0.6;
  let roundness = saturate(c.lp[2].y);
  let billowMix = saturate(c.lp[3].x);
  let stretch = clamp(c.lp[3].z, 0.08, 1.0);
  let bearing = c.lp[3].y;

  let p0 = rot2(aniso(c.uv, bearing, stretch), 0.0) * max(c.freq, 0.5);
  let p = p0 + warpVec(p0, warpAmt, warpFreq, s);

  let base = fbm(p, octaves, lac, gain, s);
  let roll = billowFbm(p * 0.55 + vec2f(1.3, 5.1), octaves, lac, gain * 0.9, s + 7u);
  var h = mix(base, roll, billowMix);
  // Rounded crests: compress the top of the range, lift the floor slightly.
  h = pow(saturate(h), mix(1.0, 2.1, roundness));
  h = h * 0.82 + 0.06;
  let detail = fbm(p * 3.1, 3u, 2.0, 0.5, s + 19u);
  h = h + (detail - 0.5) * detailAmp * 0.5;
  return h + c.lp[2].x;
}
