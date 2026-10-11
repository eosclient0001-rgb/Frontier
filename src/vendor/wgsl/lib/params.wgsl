// Frontier Terrain Forge — shared uniform layouts.
//
// These structs are shared by every layer pass. Their byte offsets are NOT
// hand-mirrored in JavaScript: tools/gen-layout.mjs reflects them out of the
// compiled SPIR-V and writes src/gen/gpu_layout.js, so the CPU packer and the
// GPU can never disagree. Keep members 16-byte friendly (uniform space requires
// struct/array members to start on a 16-byte boundary and arrays need a stride
// that is a multiple of 16).

/// One entry of a layer's mask stack. Masks are combined in order:
/// value = blend(value, maskValue * weight). Size: 80 bytes, 16 f32 + 4 u32.
struct MaskDef {
  kind: u32,       // 0 const, 1 slope, 2 height, 3 noise, 4 flow, 5 deposit,
                   // 6 curvature, 7 paint, 8 radial, 9 ridge, 10 sketch
  blend: u32,      // 0 mul, 1 add, 2 max, 3 min, 4 replace
  invert: u32,
  enabled: u32,
  weight: f32,
  lo: f32,         // primary range low  (slope 0..1 / height 0..1 / radial dist)
  hi: f32,         // primary range high
  soft: f32,       // range feathering
  freq: f32,       // noise frequency (features across the tile)
  amp: f32,        // strength / falloff exponent
  seed: f32,       // 0..1
  cx: f32,         // radial centre x
  cy: f32,         // radial centre y
  radius: f32,
  extra: f32,
  extra2: f32,
  extra3: f32,
  extra4: f32,
  extra5: f32,
  extra6: f32,
};

/// Parameter block handed to terrain layers and material layers. 736 bytes.
struct LayerUniforms {
  dims: vec2u,           // @0
  worldSize: f32,        // @8
  heightScale: f32,      // @12
  cellMeters: f32,       // @16
  seed: f32,             // @20
  amount: f32,           // @24
  bias: f32,             // @28
  contrast: f32,         // @32
  blend: u32,            // @36
  layerType: u32,        // @40
  maskCount: u32,        // @44
  materialType: u32,     // @48
  simRes: f32,           // @52
  textureRes: f32,       // @56
  waterLevel: f32,       // @60
  sunAzimuth: f32,       // @64
  padF0: f32,            // @68
  padF1: f32,            // @72
  padF2: f32,            // @76
  lp: array<vec4f, 8>,   // @80   per-type shape parameters
  masks: array<MaskDef, 4>, // @208
  ramp: array<vec4f, 8>, // @528  colour stops (rgb, position)
  rampCount: u32,        // @656
  rampMode: u32,         // @660
  padU0: u32,            // @664
  padU1: u32,            // @668
  roughRange: vec4f,     // @672  (roughnessMin, roughnessMax, metallic, normalStrength)
  tint: vec4f,           // @688  (hueShift, saturationMul, valueMul, variation)
  detail: vec4f,         // @704  (macroScale, detailScale, granularity, contrast)
  extras: vec4f,         // @720  (macroContrast, wearAmount, heightBias, sketchAmount)
};

/// Context handed to injected shape functions. `freq` is already
/// worldSize / featureScale, so shapes work directly in feature space.
struct ShapeCtx {
  uv: vec2f,
  freq: f32,
  seed: f32,
  world: f32,
  lp: array<vec4f, 8>,
};

/// Context passed to injected material generators. Unlike the render
/// structures this one only holds plain data (handles may never live in a
/// struct on naga), so it can be copied into every material function cheaply.
struct MatCtx {
  uv: vec2f,
  world: f32,
  height: f32,      // normalised elevation 0..1
  slope: f32,       // 0..1
  flow: f32,        // 0..1 wetness
  deposit: f32,     // 0..1
  curvature: f32,
  ao: f32,
  seed: f32,
  rampCount: u32,
  padU: u32,
  padF: f32,
  lp: array<vec4f, 8>,
  ramp: array<vec4f, 8>,
  tint: vec4f,      // (hueShift, saturationMul, valueMul, variation)
  detail: vec4f,    // (macroScale, detailScale, granularity, contrast)
  extras: vec4f,    // (macroContrast, wearAmount, heightBias, unused)
};

/// What a material generator produces: linear albedo plus the modulation the
/// shared pass applies to roughness, metallic and the detail-normal strength.
struct MatSample {
  albedo: vec3f,
  variation: f32,       // 0..1 macro variation -> roughness blend + export detail
  detail: f32,      // 0..1 micro detail strength
  wear: f32,        // 0..1 dust/sediment accumulation on flats
  roughMod: f32,
  metalMod: f32,
};

/// Global view/scene parameters shared by the render stages. 256 bytes.
struct ViewUniforms {
  viewProj: mat4x4f,       // @0
  invViewProj: mat4x4f,    // @64
  cameraPos: vec4f,        // @128  (xyz position, w = exposure)
  sunDir: vec4f,           // @144  (xyz direction to sun, w = intensity)
  sunColor: vec4f,         // @160  (rgb, w = ambient strength)
  params: vec4f,           // @176  (worldSize, heightScale, time, terrainRes)
  fog: vec4f,              // @192  (density, start, heightFalloff, aerialStrength)
  grade: vec4f,            // @208  (contrast, saturation, vignette, grain)
  flags: vec4f,            // @224  (wireframe, contours, slopeOverlay, mode)
  flags2: vec4f,           // @240  (sunAzimuth, sunElevation, waterLevel, contourInterval)
  grid: vec4f,             // @256  (meshResolution, simResolution, cellMeters, pad)
};

/// Sun shadow block, shared by the depth pass and the surface stages. 128 bytes.
struct LightParams {
  lightViewProj: mat4x4f,  // @0
  lightDir: vec4f,         // @64  (xyz direction toward the sun, w = map texel size)
  shadow: vec4f,           // @80  (depthBias, normalBias, pcfRadius, intensity)
  lightExtent: vec4f,      // @96  (halfExtent, worldSize, heightScale, unused)
  grid: vec4f,             // @112 (meshResolution, fieldResolution, cellMeters, pad)
};
