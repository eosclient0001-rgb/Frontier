// Island / archipelago: radial falloff over a torn coast, beach shelf, inland hills.
//   lp[0] = (islandRadius m, octaves, lacunarity, gain)
//   lp[1] = (coastRaggedness, coastFrequency, inlandRelief, shelfWidth)
//   lp[2] = (seaLevel, shoreFlatness, peakHeight, unused)
//   lp[3] = (variant, bearing, stretch, slopeSuppression)
//   lp[4] = (centerX 0..1, centerY 0..1, unused, unused)
fn layerShape(c: ShapeCtx) -> f32 {
  let s = seedOf(c.seed, 83u);
  let radius = max(c.lp[0].x, 1.0);
  let octaves = u32(clamp(c.lp[0].y, 1.0, 12.0));
  let center = c.lp[4].xy;
  let dist = length((c.uv - center) * vec2f(c.world)) / radius;
  // Ragged coastline: the falloff radius is modulated by noise, not a circle.
  let ragged = fbm(c.uv * max(c.freq, 0.5) * 1.3 + vec2f(3.3, 8.1), 4u, 2.02, 0.5, s + 5u);
  let d = dist * (1.0 + (ragged - 0.5) * c.lp[1].x * 2.0);
  let shelf = clamp(c.lp[1].w, 0.0, 0.6);
  var land = saturate(1.0 - smootherstep(1.0 - shelf, 1.0 + shelf * 0.6, d));
  let relief = fbm(c.uv * max(c.freq, 0.5) * 0.85 + warpVec(c.uv * max(c.freq, 0.5), 0.35, 0.8, s), octaves, 2.0, 0.5, s + 11u);
  var h = land * (0.2 + relief * c.lp[1].z);
  // Shoreline: flatten into a beach shelf just above the water line.
  let shore = saturate(1.0 - abs(land - saturate(1.0 - shelf)) / max(shelf, 0.02));
  h = mix(h, c.lp[2].x + shore * 0.02, shore * c.lp[2].y);
  h = h * mix(1.0, 1.0 + c.lp[2].z, land);
  return h;
}
