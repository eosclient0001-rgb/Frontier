// ---------------------------------------------------------------------------
// Procedural terrain materials. Shared by the bake pass (which evaluates the
// full texture stack once per texel) and kept free of render-only state.
// Each material is a function of world position and surface normal.
// ---------------------------------------------------------------------------
// ---------- procedural materials -----------------------------------------
struct Mat {
  alb: vec3<f32>,
  rough: f32,
  h: f32,
};

fn matGrass(q: vec2<f32>) -> Mat {
  let broad = fbm(q * 0.05 + vec2<f32>(3.1, 1.7), 4, 2.0, 0.5, 0);
  let fine = fbm(q * 1.7, 3, 2.0, 0.5, 0);
  let rq = vec2<f32>(q.x * 0.8 + q.y * 0.6, -q.x * 0.6 + q.y * 0.8);
  let blade = snoise(vec2<f32>(rq.x * 5.0, rq.y * 22.0)) * 0.5 + 0.5;
  var c = mix(vec3<f32>(0.12, 0.25, 0.06), vec3<f32>(0.34, 0.45, 0.13), smoothstep(0.25, 0.75, broad));
  let dry = smoothstep(0.58, 0.78, fbm(q * 0.09 + vec2<f32>(11.0, 4.0), 4, 2.0, 0.5, 0));
  c = mix(c, vec3<f32>(0.44, 0.38, 0.18), dry * 0.7);
  c = c * (0.8 + 0.4 * fine) * (0.88 + 0.24 * blade);
  return Mat(c, 0.85, blade * 0.5 + fine * 0.5);
}

fn matForest(q: vec2<f32>) -> Mat {
  let v = voronoi(q * 1.4, 0.95, 7u);
  let fb = fbm(q * 0.35, 4, 2.0, 0.5, 0);
  var c = mix(vec3<f32>(0.14, 0.10, 0.05), vec3<f32>(0.30, 0.22, 0.12), fb);
  let leafCol = mix(vec3<f32>(0.40, 0.24, 0.08), vec3<f32>(0.22, 0.26, 0.07), v.z);
  let leaf = 1.0 - smoothstep(0.08, 0.42, v.x);
  c = mix(c, leafCol, leaf * 0.85);
  c = c * (0.85 + 0.3 * fbm(q * 4.0, 3, 2.0, 0.5, 0));
  return Mat(c, 0.72, v.x * 0.6 + fb * 0.4);
}

fn rockBase(q: vec2<f32>) -> Mat {
  let g = fbm(q * 2.2, 4, 2.0, 0.5, 0);
  let r = fbm(q * 0.6, 5, 2.1, 0.5, 1);
  let cp = floor(q * 38.0);
  let hv = f32(hcell(i32(cp.x), i32(cp.y), 3u) & 1023u) / 1023.0;
  let speck = smoothstep(0.80, 0.9, hv);
  let lite = smoothstep(0.55, 0.7, fbm(q * 5.0 + vec2<f32>(2.0, 7.0), 3, 2.0, 0.5, 0));
  var c = mix(vec3<f32>(0.30, 0.29, 0.27), vec3<f32>(0.50, 0.47, 0.44), g);
  c = mix(c, vec3<f32>(0.62, 0.60, 0.57), lite * 0.4);
  c = mix(c, vec3<f32>(0.10, 0.095, 0.09), speck * 0.8);
  let cr = voronoi(q * 0.9, 1.0, 5u);
  let edge = 1.0 - smoothstep(0.0, 0.06, cr.y - cr.x);
  c = c * (1.0 - edge * 0.45);
  return Mat(c, 0.62 + 0.2 * g, r * 0.6 + speck * 0.1 - edge * 0.2);
}

fn strataBase(q: vec2<f32>, yy: f32) -> Mat {
  let warp = fbm(q * vec2<f32>(0.25, 0.4), 4, 2.0, 0.5, 0);
  let t = yy * 0.35 + warp * 3.0;
  let bi = floor(t);
  let bf = fract(t);
  let tone = f32(hcell(i32(bi), 5, 9u) & 255u) / 255.0;
  var c = mix(vec3<f32>(0.46, 0.36, 0.27), vec3<f32>(0.70, 0.62, 0.50), tone);
  c = mix(c, vec3<f32>(0.30, 0.26, 0.22), smoothstep(0.9, 1.0, bf) * 0.6);
  c = c * (0.85 + 0.3 * fbm(q * 3.0, 3, 2.0, 0.5, 0));
  return Mat(c, 0.7, bf * 0.5 + fbm(q * 6.0, 3, 2.0, 0.5, 0) * 0.5);
}

fn triW(nrm: vec3<f32>) -> vec3<f32> {
  let w = pow(abs(nrm), vec3<f32>(4.0));
  return w / max(w.x + w.y + w.z, 1e-5);
}

fn matGranite(q3: vec3<f32>, nrm: vec3<f32>) -> Mat {
  if (abs(nrm.y) > 0.85) { return rockBase(q3.xz); }
  let w = triW(nrm);
  let a = rockBase(q3.zy);
  let b = rockBase(q3.xz);
  let c = rockBase(q3.xy);
  return Mat(a.alb * w.x + b.alb * w.y + c.alb * w.z, a.rough * w.x + b.rough * w.y + c.rough * w.z, a.h * w.x + b.h * w.y + c.h * w.z);
}

fn matStrata(q3: vec3<f32>, nrm: vec3<f32>) -> Mat {
  if (abs(nrm.y) > 0.85) { return strataBase(q3.xz, q3.y); }
  let w = triW(nrm);
  let a = strataBase(q3.zy, q3.y);
  let b = strataBase(q3.xz, q3.y);
  let c = strataBase(q3.xy, q3.z);
  return Mat(a.alb * w.x + b.alb * w.y + c.alb * w.z, a.rough * w.x + b.rough * w.y + c.rough * w.z, a.h * w.x + b.h * w.y + c.h * w.z);
}

fn matSand(q: vec2<f32>) -> Mat {
  let warp = fbm(q * 0.7, 3, 2.0, 0.5, 0) * 4.0;
  let rip = sin(dot(q, vec2<f32>(0.8, 0.6)) * 5.0 + warp) * 0.5 + 0.5;
  let fine = snoise(q * 12.0) * 0.5 + 0.5;
  let c = mix(vec3<f32>(0.60, 0.50, 0.34), vec3<f32>(0.82, 0.74, 0.54), rip * 0.6 + fine * 0.2);
  return Mat(c, 0.92, rip * 0.4 + fine * 0.1);
}

fn matSnow(q: vec2<f32>) -> Mat {
  let f = fbm(q * 0.2, 4, 2.0, 0.5, 0);
  let g = snoise(q * 9.0) * 0.5 + 0.5;
  let c = mix(vec3<f32>(0.80, 0.85, 0.92), vec3<f32>(0.97, 0.98, 1.0), f * 0.8 + g * 0.2);
  return Mat(c, 0.45, f * 0.3 + g * 0.1);
}

fn matGravel(q: vec2<f32>) -> Mat {
  let v = voronoi(q * 5.0, 1.0, 9u);
  var c = mix(vec3<f32>(0.28, 0.26, 0.24), vec3<f32>(0.56, 0.53, 0.49), v.z);
  c = c * (1.0 - 0.4 * (1.0 - smoothstep(0.0, 0.15, v.y - v.x)));
  return Mat(c, 0.85, (1.0 - v.x) * 0.7);
}

fn matMud(q: vec2<f32>) -> Mat {
  let f = fbm(q * 0.3, 5, 2.0, 0.5, 0);
  let wet = smoothstep(0.45, 0.65, f);
  let c = mix(vec3<f32>(0.22, 0.16, 0.10), vec3<f32>(0.11, 0.09, 0.07), wet);
  return Mat(c, mix(0.8, 0.3, wet), f * 0.3);
}

fn matEval(mt: u32, wp: vec3<f32>, nrm: vec3<f32>, sc: f32) -> Mat {
  let q3 = wp / sc;
  let q = q3.xz;
  switch mt {
    case 1u: { return matForest(q); }
    case 2u: { return matGranite(q3, nrm); }
    case 3u: { return matStrata(q3, nrm); }
    case 4u: { return matSand(q); }
    case 5u: { return matSnow(q); }
    case 6u: { return matGravel(q); }
    case 7u: { return matMud(q); }
    default: { return matGrass(q); }
  }
  return matGrass(q);
}

