// ============================================================================
// canyonMaterial.js — procedural PBR canyon shading on MeshStandardMaterial.
// Everything (albedo / roughness / bump) is computed in-shader: no textures.
// Triplanar projection (no UV seams), strata bands, desert varnish, slope
// blending, wet river band, micro detail normals. Lighting/shadows/fog come
// free from MeshStandardMaterial.
// ============================================================================
import * as THREE from 'three';

// NOTE: cnHash/cnNoise/cnFbm3 MUST match makeSharedNoise() in terrain.js
// (integer-hash value noise; used for the strata warp so CPU erosion
// hardness and GPU color bands stay aligned).
const NOISE_GLSL = /* glsl */`
uint cnHash(ivec2 p) {
  uint x = uint(p.x) * 374761393u + uint(p.y) * 668265263u;
  x = (x ^ (x >> 13u)) * 1274126177u;
  return x ^ (x >> 16u);
}
float cnNoise(vec2 p) {
  ivec2 i = ivec2(floor(p));
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = float(cnHash(i)) * 4.6566129e-10;
  float b = float(cnHash(i + ivec2(1, 0))) * 4.6566129e-10;
  float c = float(cnHash(i + ivec2(0, 1))) * 4.6566129e-10;
  float d = float(cnHash(i + ivec2(1, 1))) * 4.6566129e-10;
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float cnFbm3(vec2 p) {
  return 0.5 * cnNoise(p)
       + 0.3 * cnNoise(p * 2.03 + vec2(11.7, 5.3))
       + 0.2 * cnNoise(p * 4.11 + vec2(7.9, 3.1));
}
float cnHash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float cnVNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = cnHash12(i);
  float b = cnHash12(i + vec2(1.0, 0.0));
  float c = cnHash12(i + vec2(0.0, 1.0));
  float d = cnHash12(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float cnFbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * cnVNoise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    a *= 0.5;
  }
  return v;
}
float cnFbm3b(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 3; i++) {
    v += a * cnVNoise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    a *= 0.5;
  }
  return v;
}
`;

// ---------------------------------------------------------------- terrain ---
export function buildTerrainMaterial(strata, o) {
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, metalness: 0.0 });
  const cols = strata.cols.map((h) => {
    const c = new THREE.Color(h);
    return new THREE.Vector3(c.r, c.g, c.b);
  });
  const sandC = new THREE.Color(o.sandColor);
  const dustC = new THREE.Color(o.dustColor);

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uBounds = { value: strata.bounds.slice() };
    shader.uniforms.uCols = { value: cols };
    shader.uniforms.uHard = { value: strata.hard.slice() };
    shader.uniforms.uXbed = { value: strata.xbed.slice() };
    shader.uniforms.uWaterY = { value: o.waterY };
    shader.uniforms.uWarpFreq = { value: o.warpFreq };
    shader.uniforms.uWarpAmp = { value: o.warpAmp };
    shader.uniforms.uSeedOff = { value: new THREE.Vector2(o.seedOff[0], o.seedOff[1]) };
    shader.uniforms.uSand = { value: o.sand };
    shader.uniforms.uStreak = { value: o.streak };
    shader.uniforms.uSwirl = { value: o.swirl };
    shader.uniforms.uRipple = { value: o.ripple };
    shader.uniforms.uSandCol = { value: new THREE.Vector3(sandC.r, sandC.g, sandC.b) };
    shader.uniforms.uDustCol = { value: new THREE.Vector3(dustC.r, dustC.g, dustC.b) };
    shader.uniforms.uBumpScale = { value: o.bumpScale };
    shader.uniforms.uBumpEps = { value: o.bumpEps };
    shader.uniforms.uBumpAmp = { value: o.bumpAmp };
    shader.uniforms.uBedFreq = { value: o.bedFreq };
    shader.uniforms.uBedAmp = { value: o.bedAmp };
    shader.uniforms.uGrooveFreq = { value: o.grooveFreq };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        attribute float aAO;
        varying float vAO;
        varying vec3 vWPos;
        varying vec3 vWNormal;
      `)
      .replace('#include <worldpos_vertex>', /* glsl */`
        #include <worldpos_vertex>
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
        vWNormal = normalize(mat3(modelMatrix) * objectNormal);
        vAO = aAO;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        varying float vAO;
        varying vec3 vWPos;
        varying vec3 vWNormal;
        uniform float uBounds[13];
        uniform vec3 uCols[12];
        uniform float uHard[12];
        uniform float uXbed[12];
        uniform float uWaterY;
        uniform float uWarpFreq;
        uniform float uWarpAmp;
        uniform vec2 uSeedOff;
        uniform float uSand;
        uniform float uStreak;
        uniform float uSwirl;
        uniform float uRipple;
        uniform vec3 uSandCol;
        uniform vec3 uDustCol;
        uniform float uBumpScale;
        uniform float uBumpEps;
        uniform float uBumpAmp;
        uniform float uBedFreq;
        uniform float uBedAmp;
        uniform float uGrooveFreq;
        ${NOISE_GLSL}
      `)
      .replace('#include <map_fragment>', /* glsl */`
        float gRough = 0.9;
        vec3 cAlbedo = vec3(0.5, 0.5, 0.5);
        {
          vec3 wp = vWPos;
          vec3 wn = normalize(vWNormal);
          float slope = 1.0 - clamp(wn.y, 0.0, 1.0);
          // strata warp (matches CPU hardness field)
          float warpN = cnFbm3(wp.xz * uWarpFreq + uSeedOff);
          float yW = wp.y + (warpN - 0.5) * 2.0 * uWarpAmp;
          // slot-canyon swirl warp
          if (uSwirl > 0.001) {
            float sw = cnFbm(wp.xz * 0.05 + vec2(0.0, wp.y * 0.02));
            float sw2 = cnFbm(wp.xz * 0.05 + vec2(5.2, 1.3) + vec2(0.0, wp.y * 0.02));
            yW += (sw - 0.5) * uSwirl;
            wp.xz += (vec2(sw, sw2) - 0.5) * uSwirl * 0.6;
          }
          // find sedimentary layer (bounds ascending, layer i = [b_i, b_{i+1}])
          int li = 11;
          for (int i = 0; i < 12; i++) {
            if (yW < uBounds[i + 1]) { li = i; break; }
          }
          vec3 base = uCols[li];
          float hard = uHard[li];
          float xb = uXbed[li];
          // triplanar weights
          vec3 abw = pow(abs(wn), vec3(3.0));
          abw /= (abw.x + abw.y + abw.z + 1e-4);
          // grain at two scales, triplanar
          float g1 = cnFbm(wp.yz * 0.33) * abw.x
                   + cnFbm(wp.xz * 0.33) * abw.y
                   + cnFbm(wp.xy * 0.33) * abw.z;
          float g2 = cnFbm(wp.yz * 2.7 + 7.0) * abw.x
                   + cnFbm(wp.xz * 2.7 + 7.0) * abw.y
                   + cnFbm(wp.xy * 2.7 + 7.0) * abw.z;
          vec3 alb = base * (0.82 + 0.36 * g1);
          alb *= 0.92 + 0.16 * g2;
          // bedding planes (thin horizontal lines, weaker in hard rock)
          float bl = pow(0.5 + 0.5 * sin(yW * uBedFreq + warpN * 9.0), 24.0);
          alb *= 1.0 - bl * 0.32 * (1.0 - hard * 0.55);
          // cross-bedding in dune sandstones
          if (xb > 0.5) {
            float ph = (yW + (wp.x + wp.z) * 0.16) * uBedFreq * 0.35;
            float cb = smoothstep(0.25, 0.75, 0.5 + 0.5 * sin(ph * 6.28318));
            alb = mix(alb, alb * 0.8 + vec3(0.035, 0.02, 0.01), cb * 0.55);
          }
          float steep = smoothstep(0.42, 0.68, slope);
          // desert varnish: dark vertical streaks on cliffs
          float stn = cnFbm(vec2(wp.z * 0.5, yW * 0.045)) * abw.x
                    + cnFbm(vec2(wp.x * 0.5, yW * 0.045)) * abw.z
                    + cnFbm(vec2((wp.x + wp.z) * 0.35, yW * 0.045)) * abw.y * 0.35;
          float patchy = smoothstep(0.35, 0.65, cnFbm(wp.xz * 0.02 + 3.7));
          float streak = smoothstep(0.52, 0.78, stn) * steep * patchy * uStreak;
          alb = mix(alb, vec3(0.14, 0.09, 0.065), clamp(streak, 0.0, 0.85));
          // sand / gravel cover on gentle slopes
          float sandM = (1.0 - smoothstep(0.22, 0.48, slope)) * uSand;
          vec3 sandC = uSandCol * (0.88 + 0.24 * g2);
          float speck = step(0.935, cnVNoise(wp.xz * 5.0));
          sandC += speck * vec3(0.10, 0.09, 0.07) * (1.0 - steep);
          alb = mix(alb, sandC, clamp(sandM, 0.0, 1.0));
          // large-scale tonal variation (kills banding/tiling)
          alb *= 0.86 + 0.28 * warpN;
          // cavity: darken crevices, dust on up-facing hollows
          alb *= mix(0.5, 1.0, vAO);
          float dust = (1.0 - smoothstep(0.3, 0.75, slope)) * (1.0 - vAO);
          alb = mix(alb, uDustCol, clamp(dust * 0.6, 0.0, 0.6));
          // wet band near the river + pale mineral ring above it
          float wet = 1.0 - smoothstep(uWaterY + 0.3, uWaterY + 2.0, wp.y);
          alb *= 1.0 - wet * 0.45;
          float ring = 1.0 - smoothstep(0.0, 0.9, abs(wp.y - (uWaterY + 2.4)));
          alb += ring * vec3(0.05, 0.05, 0.045) * steep;
          cAlbedo = alb;
          gRough = mix(0.96, 0.8, steep) + (g2 - 0.5) * 0.1;
          gRough = mix(gRough, 0.22, clamp(wet, 0.0, 1.0));
        }
        diffuseColor.rgb = cAlbedo;
      `)
      .replace('#include <roughnessmap_fragment>', /* glsl */`
        float roughnessFactor = clamp(gRough, 0.05, 1.0);
      `)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        {
          vec3 Nw0 = inverseTransformDirection(normal, viewMatrix);
          vec3 an = abs(Nw0);
          vec2 P;
          vec3 T;
          vec3 B;
          if (an.y >= an.x && an.y >= an.z) {
            P = vWPos.xz; T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 0.0, 1.0);
          } else if (an.x >= an.z) {
            P = vWPos.zy; T = vec3(0.0, 0.0, 1.0); B = vec3(0.0, 1.0, 0.0);
          } else {
            P = vWPos.xy; T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 1.0, 0.0);
          }
          float be = uBumpEps;
          float bs = uBumpScale;
          float slopeN = 1.0 - clamp(normalize(vWNormal).y, 0.0, 1.0);
          float wallM = smoothstep(0.35, 0.65, slopeN);
          float flatM = 1.0 - smoothstep(0.2, 0.45, slopeN);
          float w2 = cnVNoise(vWPos.xz * uWarpFreq * 4.0 + uSeedOff);
          float bph = vWPos.y * uGrooveFreq + w2 * 10.0;
          float b0 = cnFbm3b(P * bs)
            + pow(0.5 + 0.5 * sin(bph), 6.0) * uBedAmp * wallM;
          float bx = cnFbm3b((P + vec2(be, 0.0)) * bs)
            + pow(0.5 + 0.5 * sin(bph + T.y * be * uGrooveFreq), 6.0) * uBedAmp * wallM;
          float bz = cnFbm3b((P + vec2(0.0, be)) * bs)
            + pow(0.5 + 0.5 * sin(bph + B.y * be * uGrooveFreq), 6.0) * uBedAmp * wallM;
          if (uRipple > 0.001) {
            float rp0 = sin(dot(P, vec2(0.8, 0.6)) * 2.4 + w2 * 6.0);
            float rp1 = sin(dot(P + vec2(be, 0.0), vec2(0.8, 0.6)) * 2.4 + w2 * 6.0);
            float rp2 = sin(dot(P + vec2(0.0, be), vec2(0.8, 0.6)) * 2.4 + w2 * 6.0);
            b0 += rp0 * 0.35 * uRipple * flatM;
            bx += rp1 * 0.35 * uRipple * flatM;
            bz += rp2 * 0.35 * uRipple * flatM;
          }
          vec3 grad = (T * (bx - b0) + B * (bz - b0)) / max(be, 1e-3);
          vec3 Nw2 = normalize(Nw0 - (grad - Nw0 * dot(grad, Nw0)) * uBumpAmp);
          normal = normalize((viewMatrix * vec4(Nw2, 0.0)).xyz);
        }
      `)
      .replace('#include <aomap_fragment>', /* glsl */`
        reflectedLight.indirectDiffuse *= mix(0.35, 1.0, vAO);
      `);

    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => 'canyon-terrain-v1';
  return mat;
}

// ----------------------------------------------------------------- water ---
export function buildWaterMaterial(o) {
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff, transparent: true, opacity: 0.93, roughness: 0.15, metalness: 0.0,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = { value: 0 };
    shader.uniforms.uWaterCol = { value: new THREE.Color(o.color) };
    shader.uniforms.uSkyTint = { value: new THREE.Color(o.skyTint) };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        varying vec3 vWPw;
      `)
      .replace('#include <worldpos_vertex>', /* glsl */`
        #include <worldpos_vertex>
        vWPw = (modelMatrix * vec4(transformed, 1.0)).xyz;
      `);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`
        #include <common>
        varying vec3 vWPw;
        uniform float uTime;
        uniform vec3 uWaterCol;
        uniform vec3 uSkyTint;
        ${NOISE_GLSL}
      `)
      .replace('#include <map_fragment>', /* glsl */`
        diffuseColor.rgb = uWaterCol * (0.92 + 0.16 * cnFbm(vec2(vWPw.x * 0.05 - uTime * 0.25, vWPw.z * 0.03)));
      `)
      .replace('#include <roughnessmap_fragment>', /* glsl */`
        float roughnessFactor = 0.12;
      `)
      .replace('#include <normal_fragment_maps>', /* glsl */`
        {
          vec3 Nw0 = inverseTransformDirection(normal, viewMatrix);
          vec2 P = vWPw.xz;
          float e = 0.6;
          vec2 f1 = vec2(uTime * 0.7, uTime * 0.18);
          float r0 = cnFbm3b(P * 0.8 + f1) + 0.5 * cnFbm3b(P * 2.3 - f1 * 1.7);
          float rx = cnFbm3b((P + vec2(e, 0.0)) * 0.8 + f1) + 0.5 * cnFbm3b((P + vec2(e, 0.0)) * 2.3 - f1 * 1.7);
          float rz = cnFbm3b((P + vec2(0.0, e)) * 0.8 + f1) + 0.5 * cnFbm3b((P + vec2(0.0, e)) * 2.3 - f1 * 1.7);
          vec3 grad = vec3(rx - r0, 0.0, rz - r0) / max(e, 1e-3);
          vec3 Nw2 = normalize(Nw0 - (grad - Nw0 * dot(grad, Nw0)) * 0.35);
          normal = normalize((viewMatrix * vec4(Nw2, 0.0)).xyz);
        }
      `)
      .replace('#include <emissivemap_fragment>', /* glsl */`
        #include <emissivemap_fragment>
        {
          vec3 Vv = normalize(vViewPosition);
          float fres = pow(1.0 - abs(dot(normalize(normal), Vv)), 3.0);
          totalEmissiveRadiance += uSkyTint * fres * 0.55;
        }
      `);

    mat.userData.shader = shader;
  };
  mat.customProgramCacheKey = () => 'canyon-water-v1';
  return mat;
}
