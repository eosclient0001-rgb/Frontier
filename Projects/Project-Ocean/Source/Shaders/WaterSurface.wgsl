// Project-Ocean R1 — Gerstner displacement (R2 replaces with FFT) + true-mirror shading.
// Reflection evaluates the full analytic sky along R: exact mirror at zero pass cost.
// Body is SoT-style: deep <-> subsurface by view angle, sun direction, and peak mask.
struct Uniforms {
  viewProj : mat4x4<f32>,
  camPos : vec3<f32>,
  time : f32,
  sunDir : vec3<f32>,
  windSpeed : f32,
  sunColor : vec3<f32>,
  steepness : f32,
  deepColor : vec3<f32>,
  scatterAmt : f32,
  skyColor : vec3<f32>,
  hazeAmt : f32,
  horizonColor : vec3<f32>,
  waveCount : f32,
  wind : vec4<f32>, // dir.x, dir.z, detailAmp, detailFreq
  waves : array<vec4<f32>, 8>, // dir.x, dir.z, wavelength, amplitude
  look : vec4<f32>, // glitter, foamAmt, foamThresh, exposure
};
@group(0) @binding(0) var<uniform> u : Uniforms;

struct VSIn { @location(0) pos : vec3<f32> };
struct VSOut {
  @builtin(position) clip : vec4<f32>,
  @location(0) world : vec3<f32>,
  @location(1) normal : vec3<f32>,
  @location(2) crest : f32,
};

@vertex
fn vsMain(v : VSIn) -> VSOut {
  var disp = vec3<f32>(0.0);
  var n = vec3<f32>(0.0, 1.0, 0.0);
  var crest = 0.0;
  let g = 9.81;
  for (var i = 0u; i < 8u; i++) {
    if (f32(i) >= u.waveCount) { break; }
    let w = u.waves[i];
    let d = vec2<f32>(w.x, w.y);
    let L = max(w.z, 0.001);
    let a = w.w;
    let k = 6.2831853 / L;
    let c = sqrt(g / k);
    let f = k * (dot(d, v.pos.xz) - c * u.time);
    let s = sin(f);
    let co = cos(f);
    let q = u.steepness / max(k * a * u.waveCount, 0.0001);
    disp.x = disp.x + q * a * d.x * co;
    disp.z = disp.z + q * a * d.y * co;
    disp.y = disp.y + a * s;
    n.x = n.x - d.x * k * a * co;
    n.z = n.z - d.y * k * a * co;
    n.y = n.y - q * k * a * s;
    crest = crest + s * a;
  }
  let world = vec3<f32>(v.pos.x + disp.x, disp.y, v.pos.z + disp.z);
  var o : VSOut;
  o.clip = u.viewProj * vec4<f32>(world, 1.0);
  o.world = world;
  o.normal = normalize(n);
  o.crest = crest;
  return o;
}

fn hash21(p : vec2<f32>) -> f32 {
  return fract(sin(dot(p, vec2<f32>(127.1, 311.7))) * 43758.5453);
}
fn vnoise(p : vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let s = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2<f32>(1.0, 0.0));
  let c = hash21(i + vec2<f32>(0.0, 1.0));
  let d = hash21(i + vec2<f32>(1.0, 1.0));
  return mix(mix(a, b, s.x), mix(c, d, s.x), s.y);
}

// Full analytic sky in LINEAR (mirrors SkyBackdrop pre-gamma): gradient + sun + haze.
fn skyLinear(dir : vec3<f32>) -> vec3<f32> {
  var col = mix(u.horizonColor, u.skyColor, pow(max(dir.y, 0.0), 0.55));
  col = mix(u.horizonColor, col, smoothstep(-0.05, 0.02, dir.y));
  let d = max(dot(dir, u.sunDir), 0.0);
  col = col + u.sunColor * (smoothstep(0.9993, 0.9997, d) * 4.0 +
    pow(d, 350.0) * 0.9 + pow(d, 8.0) * 0.12);
  col = mix(col, u.horizonColor, (1.0 - smoothstep(0.0, 0.18, abs(dir.y))) * 0.6);
  return col;
}

@fragment
fn fsMain(f : VSOut) -> @location(0) vec4<f32> {
  let toCam = u.camPos - f.world;
  let dist = length(toCam);
  let V = toCam / max(dist, 0.0001);

  // Detail normal: domain-warped octaves at non-harmonic scales (de-tiled).
  let wdir = u.wind.xy;
  let fade = exp(-dist / 120.0);
  let warpRot = mat2x2<f32>(0.8, -0.6, 0.6, 0.8); // ~37° frame rotation
  let p1 = f.world.xz * u.wind.w + wdir * u.time * 1.1;
  let g1 = vec2<f32>(vnoise(p1) - 0.5, vnoise(p1 + 13.7) - 0.5);
  let pw = f.world.xz * u.wind.w * 2.7 - vec2<f32>(wdir.y, wdir.x) * u.time * 1.7 + g1 * 2.2;
  let g2 = vec2<f32>(vnoise(pw) - 0.5, vnoise(pw + 7.3) - 0.5);
  let p3 = (warpRot * f.world.xz) * u.wind.w * 5.3 + wdir.yx * u.time * 2.6;
  let g3 = vec2<f32>(vnoise(p3) - 0.5, vnoise(p3 + 3.1) - 0.5);
  let grad = (g1 + g2 * 0.5 + g3 * 0.22 * fade) * u.wind.z * fade;
  let n = normalize(f.normal + vec3<f32>(grad.x, 0.0, grad.y));

  let NdotV = max(dot(n, V), 0.0);
  let fres = 0.02 + 0.98 * pow(1.0 - NdotV, 5.0);

  // TRUE MIRROR: full sky along the reflection vector (sun disc -> glitter path).
  let R = reflect(-V, n);
  let reflCol = skyLinear(R);

  // SoT-style body: deep <-> subsurface by peak mask and sun-facing.
  let crestN = clamp(f.crest * 0.5 + 0.5, 0.0, 1.0);
  let peak = smoothstep(0.55, 0.95, crestN);
  let sunFace = clamp(dot(-V, u.sunDir) * 0.5 + 0.5, 0.0, 1.0);
  let NdotL = dot(n, u.sunDir);
  let scatter = pow(clamp(0.5 + 0.5 * NdotL, 0.0, 1.0), 2.0);
  let deepTerm = u.deepColor * (0.35 + 0.65 * scatter * u.scatterAmt);
  let subTint = mix(u.deepColor, u.skyColor * 0.6, 0.55) * (0.6 + 0.8 * scatter);
  var body = mix(deepTerm, subTint, peak * sunFace);

  // Crest foam: two-octave lace in a rotated frame + large-scale blotchiness.
  // (R3 replaces the crest key with Jacobian energy + a feedback dispersion buffer.)
  let fp = f.world.xz * 0.9 + wdir * u.time * 0.6;
  let lace = vnoise(fp) * 0.65 + vnoise(warpRot * fp * 2.3 - wdir.yx * u.time * 0.9) * 0.35;
  let blotch = vnoise(warpRot * f.world.xz * 0.05 + vec2<f32>(u.time * 0.03, -u.time * 0.02));
  let foamM = smoothstep(u.look.z, u.look.z + 0.2,
    crestN * (0.55 + 0.7 * lace) * (0.45 + 0.9 * blotch)) * exp(-dist / 90.0) * u.look.y;
  body = mix(body, vec3<f32>(0.9, 0.93, 0.95), foamM * 0.85);

  var col = mix(body, reflCol, fres);

  // Residual sparkle: the mirror now carries the sun, so the analytic spec is a
  // small extra (broad sheen kept, tight glitter attenuated).
  let H = normalize(u.sunDir + V);
  let ndh = max(dot(n, H), 0.0);
  let spec = pow(ndh, 720.0) * 3.0 * 0.35 + pow(ndh, 60.0) * 0.25;
  let glit = 0.6 + 0.8 * vnoise(f.world.xz * 3.0 + vec2<f32>(u.time * 2.0, -u.time));
  col = col + u.sunColor * spec * mix(1.0, glit, 0.65) * u.look.x;

  // Aerial haze to horizon.
  let haze = 1.0 - exp(-dist / 900.0 * u.hazeAmt);
  col = mix(col, u.horizonColor, clamp(haze, 0.0, 1.0));

  col = col * u.look.w; // exposure
  col = pow(max(col, vec3<f32>(0.0)), vec3<f32>(0.4545));
  return vec4<f32>(col, 1.0);
}
