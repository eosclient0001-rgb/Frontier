// Soil — dark organic topsoil with tonal patches, pebble speckle and moisture
// variation. Designed to sit under grass and forest layers.
//   lp[0] = (macroscale m, octaves, lacunarity, gain)
//   lp[1] = (pebbleScale m, pebbleAmount, patchScale m, patchAmount)
//   lp[2] = (moistureDarkening, contrast, unused, unused)
//   lp[3] = (variant, bearing, stretch, unused)
fn materialShape(ctx: MatCtx) -> MatSample {
  let s = seedOf(ctx.seed, 163u);
  let macroScale = max(ctx.lp[0].x, 8.0);
  let octaves = u32(clamp(ctx.lp[0].y, 1.0, 10.0));
  let pm = ctx.uv * (ctx.world / macroScale);

  let patches = fbm(ctx.uv * (ctx.world / max(ctx.lp[1].z, 16.0)) * 1.3 + vec2f(1.9, 4.3), 3u, 2.02, 0.5, s + 7u);
  let body = fbm(pm * 2.3, octaves, 2.0, clamp(ctx.lp[0].w, 0.2, 0.72), s + 13u);
  // Pebbles: cellular cells, only their centres contribute.
  let peb = worley2(pm * (max(ctx.lp[1].x, 4.0) / macroScale) * 2.2, s + 29u);
  let pebble = pow(saturate(1.0 - peb.x), 3.0) * saturate(ctx.lp[1].y) * (0.4 + 0.6 * ctx.slope);

  var t = saturate(body * 0.6 + patches * 0.3 + pebble * 0.25);
  t = saturate(t - saturate(ctx.flow * 1.4) * ctx.lp[2].x * 0.25 + (1.0 - ctx.slope) * 0.08);
  t = gainCurve(t, clamp(ctx.lp[2].y, 0.3, 4.0));

  var color = rampColorSmooth(ctx.ramp, ctx.rampCount, t);
  color = mix(color, color * vec3f(0.55, 0.58, 0.62), saturate(ctx.flow) * ctx.lp[2].x);
  color = mix(color, color * 0.7, saturate(-ctx.curvature * 2.0) * 0.4);

  let detail = saturate(0.35 + pebble * 1.5 + ctx.slope * 0.4);
  let wear = saturate(1.0 - ctx.slope * 1.4 - ctx.flow) * 0.6;
  return MatSample(color, t, detail, wear, mix(1.25, 0.95, t), 1.0);
}
