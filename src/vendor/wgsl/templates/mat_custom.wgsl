// Custom — a clean, artistic surface: one warped macroScale field drives the user's
// gradient, tonal patches add life, and micro variation adds grain. Use it for
// stylised palettes, regolith, alien worlds or any surface the presets miss.
//   lp[0] = (macroscale m, octaves, lacunarity, gain)
//   lp[1] = (detailScale m, detailAmount, patchScale m, patchAmount)
//   lp[2] = (hueShift, contrast, unused, unused)
//   lp[3] = (variant, bearing, stretch, unused)
fn materialShape(ctx: MatCtx) -> MatSample {
  let s = seedOf(ctx.seed, 251u);
  let macroScale = max(ctx.lp[0].x, 4.0);
  let pm = ctx.uv * (ctx.world / macroScale);
  let octaves = u32(clamp(ctx.lp[0].y, 1.0, 10.0));

  let warped = warpVec(pm, ctx.lp[2].z * 0.5 + 0.35, 0.6, s);
  let body = fbm(pm + warped, octaves, clamp(ctx.lp[0].z, 1.4, 3.4), clamp(ctx.lp[0].w, 0.2, 0.72), s + 11u);
  let patches = fbm(ctx.uv * (ctx.world / max(ctx.lp[1].z, 4.0)) * 1.4, 3u, 2.0, 0.5, s + 29u);
  let grain = vnoise2(ctx.uv * (ctx.world / max(ctx.lp[1].x, 1.0)) * 0.8, s + 43u) * 0.5 + 0.5;

  var t = saturate(body * (1.0 - ctx.lp[1].w * 0.4) + patches * ctx.lp[1].w * 0.35 + grain * ctx.lp[1].y * 0.2);
  t = saturate(t + (1.0 - ctx.slope) * 0.06 - saturate(ctx.flow) * 0.12);
  t = gainCurve(t, clamp(ctx.lp[2].y, 0.3, 4.0));

  var color = rampColorSmooth(ctx.ramp, ctx.rampCount, t);
  color = mix(color, color * 0.75, saturate(-ctx.curvature * 2.0) * 0.35);
  color = shiftHue(color, ctx.lp[2].x, 1.0, 1.0);

  let detail = saturate(0.4 + ctx.lp[1].y * 0.6);
  let wear = saturate(1.0 - ctx.slope - ctx.flow) * 0.5;
  return MatSample(color, t, detail, wear, 1.1, 1.0);
}
