// ─────────────────────────────────────────────────────────────────────────────
//  Frame constants shared by every render pass.
// ─────────────────────────────────────────────────────────────────────────────
#include "lib.wgsl"
struct Frame {
  viewProj: mat4x4<f32>,
  invViewProj: mat4x4<f32>,
  prevViewProj: mat4x4<f32>,
  camPos: vec4<f32>,      // xyz, w = time
  sunDir: vec4<f32>,      // xyz toward the sun, w = intensity
  atmo: vec4<f32>,        // turbidity, mieG, msStrength, skyIntensity
  sunRad: vec4<f32>,      // rgb solar radiance, w = ozone
  terr: vec4<f32>,        // res, heightScale, worldSize, baseDepth
  terr1: vec4<f32>,       // waterLevel, waterOn, shadowSoftness, aoStrength
  terr2: vec4<f32>,       // debugMode, matCount, heightBlend, exposureScale
  cam: vec4<f32>,         // tanHalfFov, aspect, near, far
  jitter: vec4<f32>,      // jitterX, jitterY, frameIndex, taaBlend
  rres: vec4<f32>,        // renderRes, skirtDepth, taaBlendMax, spare
  water: vec4<f32>,       // tint.rgb, waveAmp
  water2: vec4<f32>,      // absorption.rgb, waveScale
  misc: vec4<f32>,        // detailFade, snowSSS, spare, spare
}

