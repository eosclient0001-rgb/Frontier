// Bedrock — stratified stone with mineral variation, crevice darkening and
// clean faces on steep ground.
//   lp[0] = (macroscale m, octaves, lacunarity, gain)
//   lp[1] = (beddingScale m, beddingStrength, mineralScale m, mineralStrength)
//   lp[2] = (hueShiftLocal, contrast, creviceDarkness, unused)
//   lp[3] = (variant, bearing rad, stretch, unused)
fn materialShape(ctx: MatCtx) -> MatSample {
  let s = seedOf(ctx.seed, 151u);
  let macroScale = max(ctx.lp[0].x, 8.0);
  let octaves = u32(clamp(ctx.lp[0].y, 1.0, 10.0));
  let lac = clamp(ctx.lp[0].z, 1.4, 3.4);
  let gain = clamp(ctx.lp[0].w, 0.2, 0.72);

  let pm = ctx.uv * (ctx.world / macroScale);
  // Bedding: anisotropic along the bearing, warped so it is not a straight grid.
  let bed = aniso(ctx.uv, ctx.lp[3].y, clamp(ctx.lp[3].z, 0.05, 1.0)) * (ctx.world / max(ctx.lp[1].x, 4.0));
  let bedding = fbm(bed + warpVec(bed, 0.35, 0.5, s), 3u, 2.0, 0.5, s + 3u);

  // Mineral variation: cellular, gives the blotchy face colour rock actually has.
  let mineral = worley2(pm * (max(ctx.lp[1].z, 8.0) / macroScale) * 1.6, s + 11u);
  let mineralMask = 1.0 - saturate(mineral.x);

  var t = fbm(pm * 1.7 + vec2f(3.1, 7.7), octaves, lac, gain, s + 19u);
  t = saturate(t * 0.55 + bedding * 0.3 + mineralMask * 0.15 * ctx.lp[1].w);
  // Steep faces are clean rock; flats collect dust and read lighter and dirtier.
  t = saturate(t + (1.0 - ctx.slope) * 0.18 - ctx.deposit * 0.1);
  t = gainCurve(t, clamp(ctx.lp[2].y, 0.3, 4.0));

  var color = rampColorSmooth(ctx.ramp, ctx.rampCount, t);
  // Crevices (concave) go darker and browner; convex edges catch light.
  let crevice = saturate(-ctx.curvature * 2.2) * ctx.lp[2].z;
  color = mix(color, color * vec3f(0.62, 0.58, 0.55), crevice);
  let edge = saturate(ctx.curvature * 2.0) * 0.25;
  color = color + vec3f(0.06, 0.055, 0.05) * edge;
  // Wet rock is darker and more saturated.
  color = mix(color, color * vec3f(0.6, 0.62, 0.66), saturate(ctx.flow * 1.6) * 0.5);
  color = shiftHue(color, ctx.lp[2].x, 1.0, 1.0);

  let detail = saturate(0.55 + 0.45 * ctx.slope + crevice * 0.5);
  let wear = saturate((1.0 - ctx.slope) * 1.2 - ctx.flow * 1.5) * 0.7;
  return MatSample(color, t, detail, wear, mix(1.15, 0.85, t), 1.0);
}
