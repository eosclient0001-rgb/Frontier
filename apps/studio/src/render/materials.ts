/**
 * Procedural satellite-style terrain shading — zero bitmap textures.
 *
 * Layer stack (fragment): warped strata geology → large patchiness → slope /
 * elevation biomes (rock/scree/soil-veg/sand/snow/shore) → drainage + process
 * read (flow streaks, sediment fans, fresh-rock erosion) → AO/curvature/wet
 * sculpt → triplanar micro grain → sun + hemisphere + wet spec + fog.
 *
 * Plus: debug mask views (flow/erode/wet/sed/ao/curv/hard) for tuning erosion.
 */
import * as THREE from 'three';

export type MaskView =
  | 'beauty' | 'flow' | 'erode' | 'wet' | 'sed' | 'ao' | 'curv' | 'hard' | 'rain';

export const MASK_VIEW_INDEX: Record<MaskView, number> = {
  beauty: 0, flow: 1, erode: 2, wet: 3, sed: 4, ao: 5, curv: 6, hard: 7, rain: 8,
};

export interface ShadeParams {
  waterLevel: number;
  snowline: number;   // world y where snow starts
  snowAmt: number;    // 0..1 snow coverage boost
  arid: number;       // 0 lush → 1 desert (vegetation → scrub/varnish)
  strataFreq: number; // bands per world unit (match terrain builder)
  dipX: number; dipY: number; dipZ: number;
  sunDirX: number; sunDirY: number; sunDirZ: number;
  maskView: MaskView;
  grainAmt: number;
}

export const DEFAULT_SHADE: ShadeParams = {
  waterLevel: 26,
  snowline: 62,
  snowAmt: 0.7,
  arid: 0.35,
  strataFreq: 9 / 96,
  dipX: 0.13, dipY: 0.98, dipZ: 0.17,
  sunDirX: 0.55, sunDirY: 0.75, sunDirZ: 0.35,
  maskView: 'beauty',
  grainAmt: 1.0,
};

export function createTerrainMaterial(shade: ShadeParams): THREE.MeshStandardMaterial {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.94,
    metalness: 0.0,
  });
  const uniforms = {
    uWaterLevel: { value: shade.waterLevel },
    uSnowline: { value: shade.snowline },
    uSnowAmt: { value: shade.snowAmt },
    uArid: { value: shade.arid },
    uStrataFreq: { value: shade.strataFreq },
    uDip: { value: new THREE.Vector3(shade.dipX, shade.dipY, shade.dipZ) },
    uSunDir: { value: new THREE.Vector3(shade.sunDirX, shade.sunDirY, shade.sunDirZ).normalize() },
    uMaskView: { value: MASK_VIEW_INDEX[shade.maskView] },
    uGrain: { value: shade.grainAmt },
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    (mat.userData as Record<string, unknown>).shader = shader;

    shader.vertexShader = `
      attribute float aFlow;
      attribute float aErode;
      attribute float aWet;
      attribute float aSed;
      attribute float aAO;
      attribute float aCurv;
      attribute float aHard;
      attribute float aRain;
      varying vec3 vWPos;
      varying vec3 vWNormal;
      varying vec4 vD0; // flow, erode, wet, sed
      varying vec4 vD1; // ao, curv, hard, rain
    ` + shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vWPos = (modelMatrix * vec4(position, 1.0)).xyz;
       vWNormal = normalize(mat3(modelMatrix) * normal);
       vD0 = vec4(aFlow, aErode, aWet, aSed);
       vD1 = vec4(aAO, aCurv, aHard, aRain);`
    );

    shader.fragmentShader = `
      varying vec3 vWPos;
      varying vec3 vWNormal;
      varying vec4 vD0;
      varying vec4 vD1;
      uniform float uWaterLevel;
      uniform float uSnowline;
      uniform float uSnowAmt;
      uniform float uArid;
      uniform float uStrataFreq;
      uniform vec3 uDip;
      uniform vec3 uSunDir;
      uniform float uMaskView;
      uniform float uGrain;

      float fh_hash(vec3 p) {
        p = fract(p * 0.3183099 + vec3(0.1, 0.17, 0.13));
        p *= 17.0;
        return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
      }
      float fh_vnoise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        vec3 u = f * f * (3.0 - 2.0 * f);
        float n000 = fh_hash(i);
        float n100 = fh_hash(i + vec3(1.0, 0.0, 0.0));
        float n010 = fh_hash(i + vec3(0.0, 1.0, 0.0));
        float n110 = fh_hash(i + vec3(1.0, 1.0, 0.0));
        float n001 = fh_hash(i + vec3(0.0, 0.0, 1.0));
        float n101 = fh_hash(i + vec3(1.0, 0.0, 1.0));
        float n011 = fh_hash(i + vec3(0.0, 1.0, 1.0));
        float n111 = fh_hash(i + vec3(1.0, 1.0, 1.0));
        return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y),
                   mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z);
      }
      float fh_fbm(vec3 p) {
        float s = 0.0, a = 0.5;
        for (int o = 0; o < 4; o++) { s += a * fh_vnoise(p); p *= 2.03; a *= 0.5; }
        return s;
      }
      vec3 fh_bandColor(float idx) {
        float m = mod(idx, 6.0);
        if (m < 0.5) return vec3(0.62, 0.47, 0.33);      // sandstone
        if (m < 1.5) return vec3(0.45, 0.38, 0.33);      // shale
        if (m < 2.5) return vec3(0.52, 0.50, 0.47);      // granite
        if (m < 3.5) return vec3(0.66, 0.60, 0.50);      // limestone
        if (m < 4.5) return vec3(0.30, 0.29, 0.30);      // basalt
        return vec3(0.58, 0.52, 0.42);                   // silt
      }
      float fh_grain(vec3 wp, vec3 n) {
        vec3 w = abs(n);
        w = w / max(w.x + w.y + w.z, 1e-4);
        float gx = fh_vnoise(vec3(wp.yz * 14.0, 3.7));
        float gy = fh_vnoise(vec3(wp.xz * 14.0, 9.1));
        float gz = fh_vnoise(vec3(wp.xy * 14.0, 5.3));
        return gx * w.x + gy * w.y + gz * w.z;
      }
    ` + shader.fragmentShader
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        {
          vec3 wN = normalize(vWNormal);
          vec3 wp = vWPos;
          float flow = vD0.x, erodeM = vD0.y, wet = vD0.z, sed = vD0.w;
          float ao = vD1.x, curv = vD1.y;

          // ---- 1. geology base: warped dipping strata ---------------------
          float warp = fh_fbm(wp * 0.045) - 0.5;
          float s = dot(wp, uDip) * uStrataFreq + warp * 2.4;
          float bi = floor(s);
          float bf = fract(s);
          vec3 rockA = fh_bandColor(bi);
          vec3 rockB = fh_bandColor(bi + 1.0);
          float blend = smoothstep(0.75, 1.0, bf);
          vec3 alb = mix(rockA, rockB, blend);
          float seam = smoothstep(0.0, 0.10, bf) * (1.0 - smoothstep(0.90, 1.0, bf));
          alb *= mix(0.72, 1.0, seam); // dark sedimentary seams
          // large patchiness
          float patchN = fh_fbm(wp * 0.02 + 7.0);
          alb *= 0.88 + 0.24 * patchN;

          // ---- 2. slope / elevation biomes --------------------------------
          float slope = clamp(1.0 - wN.y, 0.0, 1.5);
          float elev = wp.y;
          float moist = clamp(flow * 0.6 + wet * 0.8 + fh_fbm(wp * 0.05 + 3.0) * 0.5, 0.0, 1.0);
          // scree on mid slopes
          float screeM = smoothstep(0.25, 0.45, slope) * (1.0 - smoothstep(0.6, 0.8, slope));
          vec3 scree = vec3(0.55, 0.50, 0.44) * (0.9 + 0.2 * fh_vnoise(wp * 2.0));
          alb = mix(alb, scree, screeM * 0.7);
          // vegetation / scrub on gentle low ground
          float vegM = (1.0 - smoothstep(0.15, 0.42, slope)) * (1.0 - smoothstep(uSnowline - 14.0, uSnowline + 6.0, elev));
          vec3 lush = mix(vec3(0.16, 0.30, 0.10), vec3(0.35, 0.44, 0.16), moist);
          vec3 scrub = mix(vec3(0.42, 0.36, 0.22), vec3(0.50, 0.38, 0.24), fh_vnoise(wp * 0.6));
          vec3 veg = mix(lush, scrub, uArid);
          veg *= 0.85 + 0.3 * fh_fbm(wp * 0.35);
          alb = mix(alb, veg, vegM * (0.35 + 0.65 * moist));
          // sand where loose sediment sits
          float sandM = clamp(sed * 1.4, 0.0, 1.0) * (1.0 - smoothstep(0.3, 0.55, slope));
          float ripple = 0.94 + 0.12 * sin(dot(wp.xz, vec2(2.1, 1.3)) + fh_fbm(wp * 0.2) * 6.0);
          alb = mix(alb, vec3(0.76, 0.68, 0.53) * ripple, sandM * 0.85);
          // snow
          float snowM = smoothstep(uSnowline - 4.0 - uSnowAmt * 10.0, uSnowline + 6.0, elev + (fh_fbm(wp * 0.06) - 0.5) * 14.0)
                      * (1.0 - smoothstep(0.35, 0.62, slope));
          float sparkle = step(0.9965, fh_hash(floor(wp * 22.0))) * clamp(dot(wN, uSunDir), 0.0, 1.0);
          alb = mix(alb, vec3(0.92, 0.94, 0.97) + sparkle * 0.6, clamp(snowM, 0.0, 1.0));
          // shoreline wet band
          float shore = 1.0 - smoothstep(0.0, 2.2, abs(elev - uWaterLevel));
          alb = mix(alb, alb * 0.62 + vec3(0.10, 0.09, 0.06), shore * (1.0 - smoothstep(0.3, 0.5, slope)) * 0.8);

          // ---- 3. drainage + process read ----------------------------------
          float chan = clamp(log(1.0 + flow * 3.0), 0.0, 1.5);
          alb *= 1.0 - clamp(chan * 0.5, 0.0, 0.55);           // dark wet channels
          alb += vec3(0.10, 0.09, 0.07) * clamp(chan - 0.5, 0.0, 0.5); // pale levees
          float fanM = clamp(sed * 0.9 - chan * 0.3, 0.0, 1.0) * (1.0 - smoothstep(0.25, 0.5, slope));
          alb = mix(alb, vec3(0.70, 0.62, 0.50), fanM * 0.6);  // alluvial fans
          float fresh = clamp(erodeM * 1.2, 0.0, 1.0);
          alb = mix(alb, alb * vec3(0.55, 0.42, 0.36) + vec3(0.08, 0.02, 0.0), fresh * 0.85); // fresh rock

          // ---- 4. sculpt: AO / curvature / wetness --------------------------
          alb *= mix(1.0, ao, 0.78);
          alb *= 1.0 + clamp(curv * 0.35, -0.16, 0.12);
          alb *= mix(1.0, 0.42, clamp(wet, 0.0, 1.0));

          // ---- 5. micro grain (triplanar) -----------------------------------
          float g1 = fh_grain(wp, wN);
          float g2 = fh_vnoise(wp * 55.0);
          alb *= (1.0 - uGrain * 0.10) + uGrain * 0.20 * g1 * (0.6 + 0.4 * g2);

          // ---- 6. debug mask views -------------------------------------------
          int mv = int(uMaskView + 0.5);
          if (mv == 1) alb = mix(vec3(0.02, 0.03, 0.05), vec3(0.2, 0.5, 1.0), clamp(log(1.0 + flow * 4.0), 0.0, 1.0));
          else if (mv == 2) alb = mix(vec3(0.05, 0.02, 0.02), vec3(1.0, 0.15, 0.08), clamp(erodeM * 0.7, 0.0, 1.0));
          else if (mv == 3) alb = mix(vec3(0.02, 0.03, 0.04), vec3(0.1, 0.9, 1.0), clamp(wet, 0.0, 1.0));
          else if (mv == 4) alb = mix(vec3(0.03, 0.03, 0.02), vec3(1.0, 0.85, 0.25), clamp(sed * 1.2, 0.0, 1.0));
          else if (mv == 5) alb = vec3(ao);
          else if (mv == 6) alb = curv > 0.0 ? mix(vec3(0.1), vec3(1.0, 0.3, 0.2), clamp(curv * 2.0, 0.0, 1.0))
                                            : mix(vec3(0.1), vec3(0.2, 0.4, 1.0), clamp(-curv * 2.0, 0.0, 1.0));
          else if (mv == 7) alb = mix(vec3(0.02, 0.04, 0.02), vec3(0.2, 1.0, 0.3), clamp(vD1.z, 0.0, 1.0));
          else if (mv == 8) alb = mix(vec3(0.04, 0.02, 0.05), vec3(1.0, 0.3, 1.0), clamp(vD1.w, 0.0, 1.0));

          diffuseColor.rgb = alb;
        }`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
        {
          float wet2 = clamp(vD0.z, 0.0, 1.0);
          float chan2 = clamp(log(1.0 + vD0.x * 3.0), 0.0, 1.0);
          roughnessFactor = mix(roughnessFactor, 0.22, clamp(wet2 * 0.9 + chan2 * 0.25, 0.0, 1.0));
        }`
      );
  };

  mat.customProgramCacheKey = () => 'frontier-terrain-v1';
  (mat.userData as Record<string, unknown>).uniforms = uniforms;
  return mat;
}

export function updateTerrainUniforms(mat: THREE.Material, shade: ShadeParams): void {
  const u = (mat.userData as Record<string, { value: unknown }>).uniforms as unknown as
    Record<string, { value: number | THREE.Vector3 }>;
  if (!u) return;
  (u.uWaterLevel.value as number) = shade.waterLevel;
  (u.uSnowline.value as number) = shade.snowline;
  (u.uSnowAmt.value as number) = shade.snowAmt;
  (u.uArid.value as number) = shade.arid;
  (u.uStrataFreq.value as number) = shade.strataFreq;
  (u.uDip.value as THREE.Vector3).set(shade.dipX, shade.dipY, shade.dipZ);
  (u.uSunDir.value as THREE.Vector3).set(shade.sunDirX, shade.sunDirY, shade.sunDirZ).normalize();
  (u.uMaskView.value as number) = MASK_VIEW_INDEX[shade.maskView];
  (u.uGrain.value as number) = shade.grainAmt;
}

// ---------------------------------------------------------------- water
export function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: { value: 0 },
      uDeep: { value: new THREE.Color(0x0b3742) },
      uShallow: { value: new THREE.Color(0x3d9db3) },
      uSky: { value: new THREE.Color(0xbfe3ef) },
      uSunDir: { value: new THREE.Vector3(0.55, 0.75, 0.35).normalize() },
      uOpacity: { value: 0.82 },
    },
    vertexShader: `
      varying vec3 vWPos;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      varying vec3 vWPos;
      uniform float uTime;
      uniform vec3 uDeep, uShallow, uSky, uSunDir;
      uniform float uOpacity;
      void main() {
        // Two scrolling wave octaves perturb the normal.
        float w1 = sin(vWPos.x * 0.35 + uTime * 1.1) * cos(vWPos.z * 0.30 - uTime * 0.9);
        float w2 = sin(vWPos.x * 0.90 - uTime * 1.7 + vWPos.z * 0.70 + uTime * 1.3);
        vec3 n = normalize(vec3(w1 * 0.08 + w2 * 0.03, 1.0, w1 * 0.06 - w2 * 0.04));
        vec3 v = normalize(cameraPosition - vWPos);
        float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
        vec3 col = mix(uDeep, uShallow, 0.35 + 0.25 * w1);
        col = mix(col, uSky, clamp(fres * 0.85 + 0.08, 0.0, 1.0));
        vec3 hv = normalize(v + uSunDir);
        float spec = pow(max(dot(n, hv), 0.0), 240.0) * 1.6;
        col += vec3(1.0, 0.95, 0.85) * spec;
        gl_FragColor = vec4(col, uOpacity);
      }`,
  });
}

// ---------------------------------------------------------------- sky
export function createSkyMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSunDir: { value: new THREE.Vector3(0.55, 0.75, 0.35).normalize() },
      uHorizon: { value: new THREE.Color(0xcfdfe8) },
      uZenith: { value: new THREE.Color(0x6fa8cf) },
      uGround: { value: new THREE.Color(0x9aa5a8) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      varying vec3 vDir;
      uniform vec3 uSunDir, uHorizon, uZenith, uGround;
      void main() {
        float h = clamp(vDir.y, -1.0, 1.0);
        vec3 col = h >= 0.0 ? mix(uHorizon, uZenith, pow(h, 0.62))
                            : mix(uHorizon, uGround, clamp(-h * 3.0, 0.0, 1.0));
        float sun = clamp(dot(normalize(vDir), normalize(uSunDir)), 0.0, 1.0);
        col += vec3(1.0, 0.92, 0.78) * (pow(sun, 900.0) * 1.2 + pow(sun, 18.0) * 0.16);
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}
