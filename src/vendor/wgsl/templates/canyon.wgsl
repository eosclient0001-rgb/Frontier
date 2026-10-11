// Canyon / badlands network carved into a high plateau, with flat alluvial floors.
//   lp[0] = (featureScale m, octaves, lacunarity, gain)
//   lp[1] = (warpAmount, warpFrequency, depth, rimDetail)
//   lp[2] = (plateauLevel, channelSharpness, floorFlatness, tributaryBias)
//   lp[3] = (variant, bearing, stretch, slopeSuppression)
fn layerShape(c: ShapeCtx) -> f32 {
  let s = seedOf(c.seed, 43u);
  let octaves = u32(clamp(c.lp[0].y, 1.0, 12.0));
  let lac = clamp(c.lp[0].z, 1.4, 3.4);
  let gain = clamp(c.lp[0].w, 0.2, 0.72);
  let depth = clamp(c.lp[1].z, 0.02, 1.0);
  let rimDetail = c.lp[1].w;
  let level = clamp(c.lp[2].x, 0.0, 1.0);
  let carveSharp = clamp(c.lp[2].y, 0.5, 8.0);
  let floorFlat = saturate(c.lp[2].z);

  let p0 = rot2(c.uv, c.lp[3].y) * max(c.freq, 0.5);
  let p = p0 + warpVec(p0, c.lp[1].x, max(c.lp[1].y, 0.03), s);

  let top = fbm(p * 0.6 + vec2f(4.1, 2.9), octaves, lac, gain, s);
  // Channel network: inverted ridges, biased toward the easy drainage lines.
  var chan = ridgedFbm(p * 1.15, octaves + 1u, 2.02, 0.52, 1.15, s + 17u);
  chan = pow(saturate(chan), carveSharp);
  let tributary = crackNetwork(p * 0.75, 3u, 2.0, 0.5, 0.35, s + 61u);
  chan = saturate(max(chan, tributary * saturate(c.lp[2].w * 2.0) * 0.85));

  var h = top * 0.55 + level * 0.45 - chan * depth;
  // Flat, slightly graded canyon floor.
  let floor = saturate((chan - 0.55) * 2.6);
  let graded = level * 0.45 + (fbm(p * 6.0, 2u, 2.0, 0.5, s + 5u) - 0.5) * 0.02;
  h = mix(h, min(h, graded + 0.01), floor * floorFlat);
  // Hard rim detail: thin resistant beds along the canyon walls.
  let rim = saturate(4.0 * chan * (1.0 - chan));
  let beds = ridgedFbm(p * 5.5, 3u, 2.0, 0.5, 2.2, s + 77u);
  h = h + (beds - 0.5) * rimDetail * rim;
  return h;
}
