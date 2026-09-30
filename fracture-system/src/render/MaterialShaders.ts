/**
 * ============================================================================
 *  Material shaders — the half of "realism" that is not geometry
 * ============================================================================
 *
 *  Screen-space resolution puts a hard floor on how much crack-face detail the
 *  carver can produce: at a 3 mm voxel, a fracture surface is a smooth-ish
 *  sheet. Everything below that scale has to be shading. Which is fine,
 *  because that is exactly where the tell-tale material signatures live:
 *
 *    GLASS     a fracture surface is *optically smooth*, so what you read is
 *              not roughness but the Wallner lines — arcs swept out by the
 *              crack front as it interacted with the stress wave — plus the
 *              mirror / mist / hackle progression as the crack accelerated.
 *              Get those and glass reads as glass even at a 3 mm voxel.
 *    WOOD      torn fibre bundles. Anisotropic relief stretched along the
 *              grain, plus a few pulled-out fibres that stand proud.
 *    CONCRETE  cement paste with exposed aggregate. Aggregates are *smooth and
 *              lighter*; the paste between them is rough and darker. That
 *              contrast is the whole look.
 *    PLASTIC   shear lips, stress whitening, drawn fibrils. Ductile fracture
 *              surfaces whiten (micro-voiding scatters light) and show a
 *              matte/striated band along the drawing direction.
 *    ROCK      conchoidal shells — smooth curved facets with sharp steps
 *              between them, plus a much duller weathered outer surface.
 *
 *  All of it is procedural, so it costs nothing to stream and tiles perfectly
 *  across every fragment the carver produces.
 * ============================================================================
 */

export const NOISE_GLSL = /* glsl */`
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float vnoise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(mix(hash13(i + vec3(0,0,0)), hash13(i + vec3(1,0,0)), f.x),
                    mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
                mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x),
                    mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z);
  return a * 2.0 - 1.0;
}
float fbm(vec3 p, int oct) {
  float s = 0.0, a = 0.5, n = 0.0;
  for (int i = 0; i < 6; i++) {
    if (i >= oct) break;
    s += a * vnoise(p);
    n += a; a *= 0.5; p *= 2.03;
  }
  return s / max(n, 1e-4);
}
`;

export const FRACTURE_VERT = /* glsl */`
precision highp float;

attribute float aFaceKind;     // 0 = outer skin, 1 = fracture face
attribute float aCrackRadial;  // distance from the crack's origin, metres
attribute float aCrackId;      // which crack made this face
attribute float aNormalSeed;   // 0..1 per-fragment random, for variation

uniform vec3 uGrainAxis;

varying vec3 vWorld;
varying vec3 vNormal;
varying float vFaceKind;
varying float vRadial;
varying float vCrackId;
varying float vSeed;
varying vec3 vObj;
varying mat3 vTBN;

void main() {
  vFaceKind = aFaceKind;
  vRadial = aCrackRadial;
  vCrackId = aCrackId;
  vSeed = aNormalSeed;
  vObj = position;

  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);

  // A tangent frame aligned with the grain / draw direction lets every
  // anisotropic texture below stretch in the right direction without needing
  // a UV atlas or any baking.
  vec3 g = normalize(uGrainAxis);
  vec3 t = normalize(cross(abs(g.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0), g));
  vec3 b = cross(g, t);
  vTBN = mat3(t, b, g);

  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

/**
 * Shared PBR-ish body + a per-material fracture-face branch.
 * The material is selected by `#define MAT_*` so each variant is a separate
 * program (no uniform branching in the hot path).
 */
export const FRACTURE_FRAG = /* glsl */`
precision highp float;

uniform vec3  uLightDir;
uniform vec3  uLightColor;
uniform vec3  uFillColor;
uniform vec3  uSkyColor;
uniform vec3  uGroundColor;
uniform vec3  uCameraPos;
uniform float uTime;
uniform float uDamageAmount;   // 0..1, how far through the event we are
uniform vec3  uInteriorTint;
uniform float uRoughness;

varying vec3 vWorld;
varying vec3 vNormal;
varying float vFaceKind;
varying float vRadial;
varying float vCrackId;
varying float vSeed;
varying vec3 vObj;
varying mat3 vTBN;

${NOISE_GLSL}

// --- per-material fracture-face signature --------------------------------

#ifdef MAT_GLASS
// Mirror -> mist -> hackle. As a crack accelerates, the fracture surface goes
// from optically smooth ("mirror") through a fine mist to coarse radial
// hackle marks. Keying this off the crack's radial coordinate reproduces the
// actual sequence seen on a broken pane, and the Wallner arcs themselves are
// the interference of the crack front with the stress wave.
float wallner(vec3 p, float radial) {
  float ang = atan(p.y, p.x);
  float arcs = sin(radial * 900.0 + ang * 2.0 + fbm(p * 12.0, 3) * 6.0);
  return smoothstep(0.75, 1.0, abs(arcs));
}
void fractureFace(vec3 p, inout vec3 base, inout float rough, inout float spec) {
  float mirrorToMist = smoothstep(0.02, 0.14, vRadial);      // metres
  float mist   = smoothstep(0.10, 0.35, vRadial);
  float hackle = smoothstep(0.25, 0.60, vRadial);

  float w = wallner(p, vRadial) * (0.35 + 0.65 * mist);
  float h = fbm(vec3(vRadial * 40.0, p.y * 30.0, p.x * 30.0), 3) * hackle;

  base = mix(base, vec3(0.86, 0.93, 0.94), 0.35 + 0.4 * mist);
  base += vec3(0.10) * w;
  rough = mix(rough, 0.02 + 0.45 * mist + 0.25 * hackle, 0.9);
  rough += abs(h) * 0.35;
  spec  = mix(spec, 1.0, 0.6);
}
#endif

#ifdef MAT_WOOD
// Torn fibres: relief stretched along the grain, plus earlywood/latewood
// banding and the odd fibre pulled proud of the surface.
void fractureFace(vec3 p, inout vec3 base, inout float rough, inout float spec) {
  vec3 g = vTBN * p;                   // g.z is the grain direction
  float fibre = fbm(vec3(g.x * 90.0, g.y * 90.0, g.z * 9.0), 4);
  float bands = sin(g.z * 260.0 + fibre * 5.0);
  float tear  = smoothstep(0.25, 0.75, abs(fibre));
  float rings = sin(length(p.xz) * 55.0 + fbm(p * 6.0, 2) * 8.0);

  base = mix(base, vec3(0.74, 0.56, 0.32), 0.55);
  base *= 0.82 + 0.34 * (0.5 + 0.5 * bands);
  base *= 0.9 + 0.2 * (0.5 + 0.5 * rings);
  base = mix(base, vec3(0.42, 0.30, 0.17), tear * 0.45);
  rough = mix(rough, 0.78 + fibre * 0.18, 0.95);
  spec  = mix(spec, 0.12, 0.9);
}
#endif

#ifdef MAT_CONCRETE
// Cement paste (rough, dark) with exposed aggregate (smooth, pale, rounded).
void fractureFace(vec3 p, inout vec3 base, inout float rough, inout float spec) {
  vec3 c = p * 30.0;
  vec3 cell = floor(c);
  vec3 frac = fract(c) - 0.5;
  float pick = hash13(cell);
  // cell-centred "pebbles"
  vec3 centre = vec3(hash13(cell + 11.0), hash13(cell + 27.0), hash13(cell + 41.0)) - 0.5;
  float d = length(frac - centre * 0.5);
  float pebble = smoothstep(0.36, 0.16, d) * step(0.45, pick);

  float paste = fbm(p * 90.0, 4);
  float airVoid = smoothstep(0.55, 0.2, length(fract(p * 14.0) - 0.5));

  vec3 aggregate = mix(vec3(0.66, 0.63, 0.58), vec3(0.78, 0.70, 0.58), hash13(cell * 3.7));
  base = mix(base * (0.72 + 0.22 * paste), aggregate, pebble * 0.8);
  base = mix(base, base * 0.55, airVoid * 0.6);
  rough = mix(0.92, 0.35, pebble);
  rough += paste * 0.1;
  spec = mix(spec, 0.25 + pebble * 0.5, 0.8);
}
#endif

#ifdef MAT_PLASTIC
// Stress whitening and drawn fibrils. A ductile surface whitens where it
// micro-voided, so the whitening is strongest where the drawing was largest.
void fractureFace(vec3 p, inout vec3 base, inout float rough, inout float spec) {
  vec3 g = vTBN * p;
  float draw = fbm(vec3(g.x * 30.0, g.y * 30.0, g.z * 4.0), 3);
  float striae = sin(g.z * 420.0 + draw * 10.0);
  float whitening = smoothstep(-0.2, 0.9, draw) * 0.85;

  base = mix(base, vec3(0.94, 0.94, 0.95), whitening);
  base *= 0.90 + 0.14 * (0.5 + 0.5 * striae);
  // shear lips at the free surface are glossy and drawn
  float lip = smoothstep(0.6, 1.0, abs(draw));
  rough = mix(0.55 + 0.25 * abs(striae), 0.22, lip);
  spec = mix(spec, 0.6, 0.8);
}
#endif

#ifdef MAT_ROCK
// Conchoidal shells: smooth curved facets with sharp steps between them.
void fractureFace(vec3 p, inout vec3 base, inout float rough, inout float spec) {
  float scale = 26.0;
  vec3 c = p * scale;
  vec3 cell = floor(c);
  vec3 frac = fract(c) - 0.5;
  vec3 centre = vec3(hash13(cell + 5.0), hash13(cell + 19.0), hash13(cell + 33.0)) - 0.5;
  float shell = length(frac - centre * 0.35);
  float step2 = smoothstep(0.44, 0.30, shell);
  float ridging = fbm(p * 60.0, 3);

  vec3 shellCol = mix(vec3(0.50, 0.48, 0.45), vec3(0.66, 0.62, 0.56), hash13(cell * 7.1));
  base = mix(base, shellCol, 0.75);
  base *= 0.86 + 0.22 * step2;
  base += vec3(0.06) * ridging;
  // a smooth shell facet is quite reflective, the step is not
  rough = mix(0.85, 0.28, step2) + abs(ridging) * 0.12;
  spec = mix(spec, 0.45, 0.8);
}
#endif

// --- lighting ------------------------------------------------------------

vec3 skyLight(vec3 n) {
  return mix(uGroundColor, uSkyColor, clamp(n.y * 0.5 + 0.5, 0.0, 1.0));
}

void main() {
  vec3 base = vec3(0.5);
  float rough = uRoughness;
  float spec = 0.5;

  #ifdef MAT_GLASS
    base = vec3(0.10, 0.15, 0.16);
    rough = 0.03; spec = 0.9;
  #endif
  #ifdef MAT_WOOD
    base = vec3(0.52, 0.36, 0.20);
  #endif
  #ifdef MAT_CONCRETE
    base = vec3(0.60, 0.59, 0.57);
  #endif
  #ifdef MAT_PLASTIC
    base = vec3(0.72, 0.74, 0.78);
  #endif
  #ifdef MAT_ROCK
    base = vec3(0.44, 0.43, 0.41);
  #endif

  vec3 p = vObj;
  vec3 n = normalize(vNormal);

  // Outer-skin treatment: weathered / worn / coated, and it is the *quiet*
  // half of the material — the fracture face is where the eye should go.
  if (vFaceKind < 0.5) {
    #ifdef MAT_GLASS
      base = vec3(0.07, 0.11, 0.12);
      rough = 0.02;
    #endif
    #ifdef MAT_WOOD
      // plank face: grain lines
      vec3 g = vTBN * p;
      float gr = sin(g.z * 210.0 + fbm(p * 3.0, 3) * 14.0);
      base *= 0.86 + 0.22 * (0.5 + 0.5 * gr);
      rough = 0.62;
    #endif
    #ifdef MAT_CONCRETE
      float cast = fbm(p * 22.0, 3);
      base *= 0.94 + 0.12 * cast;
      rough = 0.80;
    #endif
    #ifdef MAT_ROCK
      float weath = fbm(p * 18.0, 4);
      base *= 0.88 + 0.24 * weath;
      rough = 0.88;
    #endif
    #ifdef MAT_PLASTIC
      base *= 0.96;
      rough = 0.42;
    #endif
  } else {
    fractureFace(p, base, rough, spec);
  }

  // ---- shading --------------------------------------------------------
  vec3 V = normalize(uCameraPos - vWorld);
  vec3 N = n;
  vec3 L = normalize(uLightDir);

  float ndl = max(dot(N, L), 0.0);
  vec3 lit = uLightColor * ndl;

  // hemispheric fill
  lit += uFillColor * skyLight(N) * 0.9;

  // GGX specular
  vec3 H = normalize(L + V);
  float a = max(rough * rough, 0.002);
  float ndh = max(dot(N, H), 0.0);
  float ndv = max(dot(N, V), 0.001);
  float d = a * a / (3.14159 * pow(ndh * ndh * (a * a - 1.0) + 1.0, 2.0));
  float vis = 0.5 / (ndv + sqrt(ndv * (ndv - ndv * a) + a));
  vec3 f0 = mix(vec3(0.04), base, 0.4 + 0.6 * spec);
  vec3 F = f0 + (1.0 - f0) * pow(1.0 - max(dot(H, V), 0.0), 5.0);
  vec3 specular = d * vis * F * uLightColor * ndl;

  // fresnel rim, gives every material an edge that reads at silhouette
  float fres = pow(1.0 - max(dot(N, V), 0.0), 4.0);

  vec3 colour = base * lit + specular;

  #ifdef MAT_GLASS
    // Glass is mostly what is *behind* it. We approximate refraction with the
    // environment gradient plus a strong Fresnel, which at fragment scale is
    // indistinguishable from true refraction but costs one mix.
    vec3 refr = skyLight(refract(-V, N, 0.66));
    colour = mix(colour, refr * vec3(0.72, 0.95, 1.0), 0.55)
           + vec3(0.35, 0.55, 0.6) * fres * 0.8;
    // fracture faces on glass catch light hard along their edges
    colour += vec3(0.30, 0.42, 0.45) * vFaceKind * (0.35 + 0.65 * fres);
    colour += vec3(0.08, 0.16, 0.18) * uDamageAmount;
  #else
    colour += skyLight(reflect(-V, N)) * fres * 0.08 * spec;
  #endif

  // Freshly created fracture faces are brighter than weathered ones; fade
  // that in as the event progresses so a break "blooms" and then settles.
  float freshness = vFaceKind * (1.0 - smoothstep(0.2, 1.0, uDamageAmount));
  colour += uInteriorTint * freshness * 0.06;

  // gamma
  colour = pow(max(colour, 0.0), vec3(0.4545));
  gl_FragColor = vec4(colour, 1.0);
}
`;

/** Shader variant definitions, one program per material. */
export interface ShaderVariant {
  defines: string;
  uniforms: Record<string, unknown>;
}

export const MATERIAL_DEFINES: Record<number, string> = {
  0: '#define MAT_GLASS',
  1: '#define MAT_WOOD',
  2: '#define MAT_CONCRETE',
  3: '#define MAT_PLASTIC',
  4: '#define MAT_ROCK',
};
