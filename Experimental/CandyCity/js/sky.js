// Candy City — procedural sugar sky.
// A dome shader: gradient, twisted candy-floss clouds, sun/moon and sprinkle stars.

import * as THREE from '../vendor/three.module.js';

const vertex = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragment = /* glsl */ `
precision highp float;
varying vec3 vDir;

uniform float uTime;
uniform float uDay;      // 0 = candy daylight, 1 = sugar night
uniform vec3 uSunDir;    // unit vector toward the sun

float hash31(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash31(i + vec3(0, 0, 0)), hash31(i + vec3(1, 0, 0)), f.x),
        mix(hash31(i + vec3(0, 1, 0)), hash31(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(hash31(i + vec3(0, 0, 1)), hash31(i + vec3(1, 0, 1)), f.x),
        mix(hash31(i + vec3(0, 1, 1)), hash31(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}

float fbm(vec3 p) {
  float s = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    s += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return s;
}

void main() {
  vec3 d = normalize(vDir);
  float up = clamp(d.y, -1.0, 1.0);

  vec3 dayHorizon = vec3(1.00, 0.72, 0.80);
  vec3 dayZenith  = vec3(0.36, 0.66, 0.98);
  vec3 nightHorizon = vec3(0.24, 0.14, 0.33);
  vec3 nightZenith  = vec3(0.04, 0.04, 0.14);

  vec3 horizon = mix(dayHorizon, nightHorizon, uDay);
  vec3 zenith  = mix(dayZenith,  nightZenith,  uDay);

  // Golden-hour pass: as the sun drops, warm the horizon and deepen the zenith.
  float sunHeight = uSunDir.y;
  float dusk = smoothstep(0.42, -0.06, sunHeight) * (1.0 - uDay);
  vec3 duskHorizon = vec3(1.00, 0.52, 0.36);
  vec3 duskZenith  = vec3(0.62, 0.34, 0.62);
  horizon = mix(horizon, duskHorizon, dusk);
  zenith = mix(zenith, duskZenith, dusk);

  float t = pow(smoothstep(-0.12, 0.85, up), 0.75);
  vec3 col = mix(horizon, zenith, t);

  // Warm sugar haze band just above the horizon.
  float band = exp(-pow((up - 0.03) * 5.0, 2.0));
  col += mix(vec3(1.0, 0.55, 0.4), vec3(0.5, 0.24, 0.46), uDay) * band * mix(0.3, 0.07, uDay);

  // Sun / moon.
  float sd = max(dot(d, normalize(uSunDir)), 0.0);
  vec3 sunTint = mix(vec3(1.0, 0.93, 0.72), vec3(0.72, 0.82, 1.0), uDay);
  col += sunTint * pow(sd, 260.0) * 0.55;
  col += sunTint * pow(sd, 6000.0) * 6.0;
  // wide peach halo that only shows when the sun is low
  col += vec3(1.0, 0.55, 0.30) * pow(sd, 6.0) * dusk * 0.55;
  // Soft moon bloom at night.
  col += vec3(0.55, 0.62, 0.95) * pow(sd, 240.0) * uDay * 0.5;

  // Candy-floss clouds: stretched, slowly drifting noise.
  vec3 wind = vec3(uTime * 0.010, 0.0, uTime * 0.006);
  vec3 p = vec3(d.x * 2.6, d.y * 5.2, d.z * 2.6) + wind;
  p.xz += vec2(fbm(p * 0.6) * 0.4);
  float cl = fbm(p);
  float mask = smoothstep(0.02, 0.30, up) * (1.0 - smoothstep(0.75, 1.0, up) * 0.3);
  cl = smoothstep(0.46, 0.80, cl) * mask;

  vec3 cloudLit = mix(vec3(1.0, 0.97, 0.99), vec3(0.56, 0.52, 0.78), uDay);
  vec3 cloudShadow = mix(vec3(1.0, 0.76, 0.86), vec3(0.24, 0.20, 0.40), uDay);
  float shade = smoothstep(0.35, 0.95, fbm(p * 1.7 + 3.0));
  vec3 cloudCol = mix(cloudShadow, cloudLit, shade);
  col = mix(col, cloudCol, cl * 0.88);

  // Sprinkle stars at night.
  vec3 sp = d * 160.0;
  float star = hash31(floor(sp));
  float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + star * 40.0);
  float starMask = pow(smoothstep(0.994, 1.0, star), 2.0) * smoothstep(-0.02, 0.25, up) * uDay;
  col += vec3(1.0, 0.9, 1.0) * starMask * 3.2 * twinkle;

  // Authored palette is sRGB-ish; hand the linear value to the composer.
  col = pow(clamp(col, 0.0, 1.6), vec3(2.2));

  gl_FragColor = vec4(col, 1.0);
}
`;

export function createSky(sunDir = new THREE.Vector3(0.55, 0.6, 0.35).normalize()) {
  const uniforms = {
    uTime: { value: 0 },
    uDay: { value: 0 },
    uSunDir: { value: sunDir.clone() },
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vertex,
    fragmentShader: fragment,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 32), material);
  mesh.name = 'SugarSky';
  mesh.frustumCulled = false;

  return {
    mesh,
    uniforms,
    update(time) {
      uniforms.uTime.value = time;
    },
    setDay(t) {
      uniforms.uDay.value = t;
    },
  };
}
