// Snow — bright, blue in the crevices, wind-crusted on exposed ridges, with
// sastrugi striations aligned to the prevailing bearing.
//   lp[0] = (macroscale m, octaves, lacunarity, gain)
//   lp[1] = (sastrugiScale m, sastrugiAmount, crustScale m, crustAmount)
//   lp[2] = (creviceBlue, contrast, unused, unused)
//   lp[3] = (variant, windBearing rad, stretch, unused)
fn materialShape(ctx: MatCtx) -> MatSample {
  let s = seedOf(ctx.seed, 227u);
  let macroScale = max(ctx.lp[0].x, 8.0);
  let pm = ctx.uv * (ctx.world / macroScale);

  let body = fbm(pm * 1.3, 3u, 2.0, 0.5, s + 5u);
  // Sastrugi: long, low-amplitude ridges cut by the wind.
  let sas = aniso(ctx.uv, ctx.lp[3].y, clamp(ctx.lp[3].z, 0.02, 1.0)) * (ctx.world / max(ctx.lp[1].x, 2.0));
  let sastrugi = vnoise2(sas * vec2f(1.0, 0.22), s + 19u) * 0.5 + 0.5;
  // Crust: a slightly warmer, denser surface where the wind has packed it.
  let crust = worley2(ctx.uv * (ctx.world / max(ctx.lp[1].z, 2.0)) * 0.7, s + 37u);

  var t = saturate(body * 0.55 + sastrugi * ctx.lp[1].y * 0.35 + (1.0 - saturate(crust.x)) * ctx.lp[1].w * 0.2);
  t = saturate(t + ctx.slope * 0.08);
  t = gainCurve(t, clamp(ctx.lp[2].y, 0.3, 4.0));

  var color = rampColorSmooth(ctx.ramp, ctx.rampCount, t);
  // Crevices go blue: shadowed snow is lit by skylight only.
  let crev = saturate(-ctx.curvature * 2.5) * ctx.lp[2].x;
  color = mix(color, color * vec3f(0.72, 0.82, 1.12), crev);
  color = mix(color, color * 0.88, saturate(ctx.flow) * 0.4);

  let detail = saturate(0.2 + sastrugi * 0.35);
  let wear = 0.05;
  return MatSample(color, t, detail, wear, mix(1.5, 0.9, saturate(ctx.slope * 1.5)), 1.0);
}
