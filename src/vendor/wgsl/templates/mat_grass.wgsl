// Grass — patchy green with dry yellow patches, darker in damp hollows and
// paler on exposed heights. Detail strength is high: grass is a fine-grain
// material and its micro normals carry most of its realism at distance.
//   lp[0] = (macroscale m, octaves, lacunarity, gain)
//   lp[1] = (dryScale m, dryness, bladeScale m, bladeStrength)
//   lp[2] = (dampDarkening, contrast, unused, unused)
//   lp[3] = (variant, bearing, stretch, unused)
fn materialShape(ctx: MatCtx) -> MatSample {
  let s = seedOf(ctx.seed, 179u);
  let macroScale = max(ctx.lp[0].x, 8.0);
  let octaves = u32(clamp(ctx.lp[0].y, 1.0, 10.0));
  let pm = ctx.uv * (ctx.world / macroScale);

  let patches = fbm(pm * 1.15 + warpVec(pm, 0.4, 0.4, s), octaves, 2.0, clamp(ctx.lp[0].w, 0.2, 0.72), s + 5u);
  // Dryness is driven mostly by exposure: dry on sunlit heights and sandy soil.
  let dryNoise = fbm(ctx.uv * (ctx.world / max(ctx.lp[1].x, 8.0)) * 1.9 + vec2f(6.1, 2.3), 3u, 2.0, 0.5, s + 17u);
  var dry = saturate(dryNoise * 0.6 + ctx.height * 0.5 + ctx.deposit * 0.4 - ctx.flow * 0.8) * saturate(ctx.lp[1].y);

  var t = saturate(patches * (1.0 - dry * 0.75) + dry * 0.9);
  t = saturate(t - saturate(ctx.flow * 1.5) * ctx.lp[2].x * 0.3 + (1.0 - ctx.slope) * 0.05);
  t = gainCurve(t, clamp(ctx.lp[2].y, 0.3, 4.0));

  var color = rampColorSmooth(ctx.ramp, ctx.rampCount, t);
  // Blade-level variation: fine, high frequency, only a small tonal shift, but
  // it is what stops large grass fields from looking like felt.
  let blade = vnoise2(aniso(ctx.uv, ctx.lp[3].y, 0.45) * (ctx.world / max(ctx.lp[1].z, 1.0)) * 0.5, s + 31u);
  color = color * (1.0 + blade * saturate(ctx.lp[1].w) * 0.22);
  color = mix(color, color * vec3f(0.6, 0.78, 0.62), saturate(ctx.flow * 1.2) * ctx.lp[2].x * 0.5);

  let detail = saturate(0.75 + ctx.slope * 0.25);
  let wear = saturate(1.0 - ctx.flow * 1.5 - ctx.slope) * 0.35;
  return MatSample(color, t, detail, wear, 1.05, 1.0);
}
