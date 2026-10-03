/**
 * Dedicated WebGL2 particle liquid solver.
 *
 * This engine is intentionally separate from the Pyro voxel engine. Liquid
 * markers live in ping-pong floating point textures, are advanced with a
 * compact GPU SPH/PIC-style pressure and viscosity step, and are rendered by
 * a depth/thickness particle surface pass. No gas density, temperature,
 * combustion, or pyro raymarch parameters are used here.
 */

const FULLSCREEN_VERT = `#version 300 es
precision highp float;
out vec2 vUV;
void main() {
  vec2 p = (gl_VertexID == 1) ? vec2(3.0, -1.0) : (gl_VertexID == 2 ? vec2(-1.0, 3.0) : vec2(-1.0, -1.0));
  gl_Position = vec4(p, 0.0, 1.0);
  vUV = p * 0.5 + 0.5;
}`;

const PARTICLE_UPDATE_FRAG = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uPositionTex;
uniform sampler2D uVelocityTex;
uniform int uParticleTexSize;
uniform int uParticleCount;
uniform float uDt;
uniform float uGravity;
uniform float uViscosity;
uniform float uPressureStiffness;
uniform float uRestDensity;
uniform float uSmoothingRadius;
uniform float uSurfaceTension;
uniform float uSurfaceAdhesion;
uniform int uObstacleType;
uniform vec3 uColliderPos;
uniform vec3 uColliderVel;
uniform float uColliderRadius;
uniform int uHydroScene;
uniform float uWaterLevel;
uniform float uDamGateX;
uniform int uEnclosedBox;
uniform int uEmitterEnabled;
uniform float uEmitterRate;
uniform float uEmitterRadius;
uniform float uEmitterPosY;
uniform vec3 uSplashCenter;
uniform float uSplashAge;
uniform float uSplashImpulse;
uniform float uFoamGeneration;
uniform float uFoamDissipation;
uniform int uWaveMode;
uniform float uWaveHeight;
uniform float uWaveSpeed;
uniform float uTime;

layout(location = 0) out vec4 outPosition;
layout(location = 1) out vec4 outVelocity;

const int MAX_PARTICLES = 1536;

vec4 readPosition(int index) {
  return texelFetch(uPositionTex, ivec2(index % uParticleTexSize, index / uParticleTexSize), 0);
}

vec4 readVelocity(int index) {
  return texelFetch(uVelocityTex, ivec2(index % uParticleTexSize, index / uParticleTexSize), 0);
}

float colliderSdf(vec3 p) {
  if (uObstacleType == 0) return 1000.0;
  vec3 d = p - uColliderPos;
  float r = max(uColliderRadius, 0.025);
  if (uObstacleType == 1) return length(d) - r;
  if (uObstacleType == 5) return length(vec2(length(d.xy) - r * 0.76, d.z)) - r * 0.24;
  if (uObstacleType == 2) {
    vec2 q = vec2(length(d.xz) - r * 0.75, abs(d.y) - r * 1.4);
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0)));
  }
  if (uObstacleType == 3) {
    vec2 q = vec2(length(d.yz) - r * 0.72, abs(d.x) - r * 1.9);
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0)));
  }
  vec3 q = abs(d) - vec3(r * 1.5, r * 0.45, r * 1.5);
  return length(max(q, vec3(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

vec3 colliderNormal(vec3 p) {
  float e = 0.0015;
  return normalize(vec3(
    colliderSdf(p + vec3(e, 0.0, 0.0)) - colliderSdf(p - vec3(e, 0.0, 0.0)),
    colliderSdf(p + vec3(0.0, e, 0.0)) - colliderSdf(p - vec3(0.0, e, 0.0)),
    colliderSdf(p + vec3(0.0, 0.0, e)) - colliderSdf(p - vec3(0.0, 0.0, e))
  ));
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  int particleIndex = pixel.y * uParticleTexSize + pixel.x;
  vec4 positionState = readPosition(particleIndex);
  vec4 velocityState = readVelocity(particleIndex);

  if (particleIndex >= uParticleCount || positionState.a < 0.5) {
    outPosition = vec4(0.0);
    outVelocity = vec4(0.0);
    return;
  }

  vec3 position = positionState.xyz;
  vec3 velocity = velocityState.xyz;
  float smoothingRadius = max(uSmoothingRadius, 0.025);
  float density = 0.0;
  vec3 pressureForce = vec3(0.0);
  vec3 cohesionForce = vec3(0.0);
  vec3 viscosityForce = vec3(0.0);

  // A deliberately compact particle-pressure solve. It is O(N²), but the
  // dedicated liquid path keeps N in the 1–3K range for interactive browser
  // scenes and never deletes a marker when it leaves the camera view.
  for (int j = 0; j < MAX_PARTICLES; j++) {
    if (j >= uParticleCount) break;
    vec4 neighborState = readPosition(j);
    if (neighborState.a < 0.5 || j == particleIndex) continue;
    vec3 delta = position - neighborState.xyz;
    float distanceToNeighbor = length(delta);
    if (distanceToNeighbor >= smoothingRadius) continue;
    float q = 1.0 - distanceToNeighbor / smoothingRadius;
    density += q * q * 4.0;
  }

  float pressure = max(0.0, density - uRestDensity) * uPressureStiffness;
  for (int j = 0; j < MAX_PARTICLES; j++) {
    if (j >= uParticleCount) break;
    vec4 neighborState = readPosition(j);
    if (neighborState.a < 0.5 || j == particleIndex) continue;
    vec3 delta = position - neighborState.xyz;
    float distanceToNeighbor = length(delta);
    if (distanceToNeighbor >= smoothingRadius || distanceToNeighbor < 0.0001) continue;
    float q = 1.0 - distanceToNeighbor / smoothingRadius;
    vec3 direction = delta / distanceToNeighbor;
    pressureForce += direction * pressure * q * q / max(density, 1.0);
    cohesionForce -= direction * q * q * uSurfaceTension * 0.018;
    viscosityForce += (readVelocity(j).xyz - velocity) * q * uViscosity * 0.12;
  }

  vec3 acceleration = vec3(0.0, -uGravity * 0.12, 0.0);
  acceleration += pressureForce * 0.75 + cohesionForce + viscosityForce;
  velocity += acceleration * uDt;
  velocity *= exp(-uViscosity * uDt * 2.4);

  // Wave controls are a restrained external forcing term on the persistent
  // surface markers, not a replacement height field. The particle body still
  // carries the resulting momentum into the pool and colliders.
  if (uWaveMode > 0) {
    float waveFrequency = uWaveMode == 2 ? 13.0 : 7.0;
    float phase = position.x * waveFrequency + position.z * 3.2 + uTime * uWaveSpeed;
    float surfaceBand = exp(-abs(position.y - uWaterLevel) * 18.0);
    float crest = cos(phase) * uWaveHeight * surfaceBand;
    velocity.y += crest * uDt * (uWaveMode == 2 ? 3.8 : 1.6);
    velocity.x += sin(phase) * uWaveHeight * surfaceBand * uDt * 0.75;
  }

  // Kinematic full-volume collider response. Markers are pushed out of the
  // sphere/tyre SDF, then retain tangential motion and a wetting/stick term.
  float bodyDistance = colliderSdf(position);
  if (bodyDistance < smoothingRadius * 0.9) {
    vec3 normal = colliderNormal(position);
    position += normal * (smoothingRadius * 0.9 - bodyDistance + 0.0005);
    vec3 relativeVelocity = velocity - uColliderVel;
    float inward = dot(relativeVelocity, normal);
    if (inward < 0.0) relativeVelocity -= normal * inward * 1.35;
    float stick = clamp(uSurfaceAdhesion * 0.20, 0.0, 0.42);
    velocity = uColliderVel + relativeVelocity * (1.0 - stick);
    velocity += normal * length(uColliderVel) * 0.18;
  } else if (uObstacleType != 0) {
    float shell = exp(-abs(bodyDistance) * 36.0);
    vec3 normal = colliderNormal(position);
    velocity += (normal * 0.32 + vec3(0.0, 0.48, 0.0)) * shell * length(uColliderVel) * uDt * 8.0;
  }

  // Manual impact is a genuine particle impulse, not a material ripple.
  if (uSplashImpulse > 0.001 && uSplashAge < 2.2) {
    vec3 splashDelta = position - uSplashCenter;
    float splashDistance = length(splashDelta);
    float fade = exp(-uSplashAge * 2.0) * uSplashImpulse;
    float radius = 0.045 + uSplashAge * 0.22;
    float ring = exp(-pow((splashDistance - radius) * 20.0, 2.0));
    vec3 splashDirection = splashDistance > 0.001 ? splashDelta / splashDistance : vec3(0.0, 1.0, 0.0);
    velocity += (splashDirection + vec3(0.0, 1.35, 0.0)) * ring * fade;
  }

  // Optional fountain source accelerates nearby persistent markers. The marker
  // count stays fixed, so a source cannot create disappearing smoke-like dye.
  if (uEmitterEnabled == 1) {
    float emitterDistance = length(position.xz - vec2(0.54, 0.50));
    float source = smoothstep(uEmitterRadius, uEmitterRadius * 0.18, emitterDistance) * uEmitterRate;
    float verticalBand = 1.0 - smoothstep(uEmitterPosY - 0.18, uEmitterPosY, position.y);
    velocity.y += source * verticalBand * uDt * 2.4;
    velocity.xz += vec2(0.18, -0.12) * source * verticalBand * uDt;
  }

  velocity = clamp(velocity, vec3(-6.0), vec3(6.0));
  position += velocity * uDt * 0.34;

  // Solid domain walls make liquid volume persistent. Open boundaries only
  // remove the side-wall reflection; the floor remains a water container.
  if (position.y < 0.018) { position.y = 0.018; velocity.y = max(velocity.y, 0.0) * 0.22; }
  if (position.y > 0.985) { position.y = 0.985; velocity.y = min(velocity.y, 0.0) * 0.22; }
  if (position.x < 0.012) { position.x = 0.012; velocity.x = abs(velocity.x) * 0.26; }
  if (position.x > 0.988) { position.x = 0.988; velocity.x = -abs(velocity.x) * 0.26; }
  if (position.z < 0.012) { position.z = 0.012; velocity.z = abs(velocity.z) * 0.26; }
  if (position.z > 0.988) { position.z = 0.988; velocity.z = -abs(velocity.z) * 0.26; }
  if (uEnclosedBox == 0) {
    // A shallow open pool still retains markers at the floor; only high side
    // boundaries are softened by the velocity damping above.
    velocity.xz *= 0.999;
  }

  float pressureFoam = clamp((pressure * 0.08 + length(velocity) * 0.025) * uFoamGeneration, 0.0, 1.0);
  float foam = max(velocityState.a * exp(-uDt * uFoamDissipation), pressureFoam);
  outPosition = vec4(position, 1.0);
  outVelocity = vec4(velocity, foam);
}
`;

const PARTICLE_VERT = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uPositionTex;
uniform sampler2D uVelocityTex;
uniform int uParticleTexSize;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uCamPos;
uniform vec3 uCamForward;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec2 uViewport;
uniform float uParticleRadius;
uniform float uNearClip;
uniform float uFarClip;

out float vLinearDepth;
out float vFoam;

void main() {
  int index = gl_VertexID;
  ivec2 coord = ivec2(index % uParticleTexSize, index / uParticleTexSize);
  vec4 particle = texelFetch(uPositionTex, coord, 0);
  vec4 velocity = texelFetch(uVelocityTex, coord, 0);
  if (particle.a < 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    vLinearDepth = uFarClip;
    vFoam = 0.0;
    return;
  }

  vec3 worldPosition = mix(uBoxMin, uBoxMax, particle.xyz);
  vec3 viewVector = worldPosition - uCamPos;
  float linearDepth = max(dot(viewVector, uCamForward), uNearClip);
  float x = dot(viewVector, uCamRight) / (linearDepth * uTanHalfFov * uAspect);
  float y = dot(viewVector, uCamUp) / (linearDepth * uTanHalfFov);
  float clipDepth = (linearDepth - uNearClip) / max(uFarClip - uNearClip, 0.001) * 2.0 - 1.0;
  gl_Position = vec4(x, y, clipDepth, 1.0);
  gl_PointSize = max(2.0, uParticleRadius / linearDepth * uViewport.y / uTanHalfFov);
  vLinearDepth = linearDepth;
  vFoam = velocity.a;
}
`;

const PARTICLE_DEPTH_FRAG = `#version 300 es
precision highp float;
in float vLinearDepth;
in float vFoam;
layout(location = 0) out vec4 outDepth;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float sphereDepth = vLinearDepth - sqrt(max(0.0, 1.0 - r2)) * 0.018;
  outDepth = vec4(sphereDepth, 0.0, 0.0, 1.0);
}
`;

const PARTICLE_THICKNESS_FRAG = `#version 300 es
precision highp float;
in float vLinearDepth;
in float vFoam;
layout(location = 0) out vec4 outThickness;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float disc = smoothstep(1.0, 0.48, r2);
  outThickness = vec4(disc * (0.32 + vFoam * 0.68), 0.0, 0.0, disc);
}
`;

const FLUID_COMPOSITE_FRAG = `#version 300 es
precision highp float;

in vec2 vUV;
layout(location = 0) out vec4 outColor;
uniform sampler2D uDepthTex;
uniform sampler2D uThicknessTex;
uniform vec3 uCamPos;
uniform vec3 uCamForward;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec2 uViewport;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uSunDir;
uniform float uWaterAbsorption;
uniform float uWaterScattering;
uniform vec3 uWaterTint;
uniform float uWaterSurfaceThreshold;
uniform float uWaterRoughness;
uniform float uLiquidSpecular;
uniform float uWaterRefraction;
uniform float uWaterLightIntensity;
uniform float uWaterAmbientIntensity;
uniform float uWaterExposure;
uniform float uCausticsIntensity;
uniform float uTime;
uniform int uObstacleType;
uniform vec3 uColliderPos;
uniform float uColliderRadius;

vec3 rayDirection(vec2 uv) {
  vec2 ndc = uv * 2.0 - 1.0;
  return normalize(uCamForward + ndc.x * uAspect * uTanHalfFov * uCamRight + ndc.y * uTanHalfFov * uCamUp);
}

vec3 worldAtDepth(vec2 uv, float depth) {
  return uCamPos + rayDirection(uv) * depth;
}

float readDepth(vec2 uv) {
  return texture(uDepthTex, clamp(uv, vec2(0.0), vec2(1.0))).r;
}

float colliderSdf(vec3 uvw) {
  if (uObstacleType == 0) return 1000.0;
  vec3 d = uvw - uColliderPos;
  float r = max(uColliderRadius, 0.025);
  if (uObstacleType == 1) return length(d) - r;
  if (uObstacleType == 5) return length(vec2(length(d.xy) - r * 0.76, d.z)) - r * 0.24;
  if (uObstacleType == 2) {
    vec2 q = vec2(length(d.xz) - r * 0.75, abs(d.y) - r * 1.4);
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0)));
  }
  if (uObstacleType == 3) {
    vec2 q = vec2(length(d.yz) - r * 0.72, abs(d.x) - r * 1.9);
    return min(max(q.x, q.y), 0.0) + length(max(q, vec2(0.0)));
  }
  vec3 q = abs(d) - vec3(r * 1.5, r * 0.45, r * 1.5);
  return length(max(q, vec3(0.0))) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float traceCollider(vec3 rayOrigin, vec3 rayDir, out vec3 hitUVW) {
  hitUVW = vec3(0.0);
  if (uObstacleType == 0) return -1.0;
  vec3 extent = uBoxMax - uBoxMin;
  vec3 uvw = (rayOrigin - uBoxMin) / extent;
  vec3 uvStep = rayDir / extent;
  float travel = 0.04;
  for (int i = 0; i < 48; i++) {
    vec3 sampleUVW = uvw + uvStep * travel;
    if (any(lessThan(sampleUVW, vec3(-0.1))) || any(greaterThan(sampleUVW, vec3(1.1)))) break;
    float distanceToBody = colliderSdf(sampleUVW);
    if (distanceToBody < 0.002) {
      hitUVW = sampleUVW;
      return travel;
    }
    travel += clamp(distanceToBody * min(min(extent.x, extent.y), extent.z) * 0.85, 0.008, 0.28);
    if (travel > 24.0) break;
  }
  return -1.0;
}

vec3 colliderNormal(vec3 uvw) {
  float e = 0.0015;
  return normalize(vec3(
    colliderSdf(uvw + vec3(e, 0.0, 0.0)) - colliderSdf(uvw - vec3(e, 0.0, 0.0)),
    colliderSdf(uvw + vec3(0.0, e, 0.0)) - colliderSdf(uvw - vec3(0.0, e, 0.0)),
    colliderSdf(uvw + vec3(0.0, 0.0, e)) - colliderSdf(uvw - vec3(0.0, 0.0, e))
  ));
}

vec3 floorColor(vec3 world, vec3 rayDir) {
  vec3 col = vec3(0.018, 0.025, 0.038);
  float gridX = 1.0 - smoothstep(0.012, 0.035, abs(fract(world.x * 4.0) - 0.5));
  float gridZ = 1.0 - smoothstep(0.012, 0.035, abs(fract(world.z * 4.0) - 0.5));
  col += vec3(0.035, 0.09, 0.14) * max(gridX, gridZ);
  return col;
}

void main() {
  vec3 rayDir = rayDirection(vUV);
  float floorT = 1e9;
  if (rayDir.y < -0.0001) floorT = (uBoxMin.y - uCamPos.y) / rayDir.y;
  vec3 worldFloor = uCamPos + rayDir * floorT;
  vec3 background = floorT > 0.0 && floorT < 30.0 ? floorColor(worldFloor, rayDir) : vec3(0.012, 0.017, 0.028);

  float depth = readDepth(vUV);
  float thickness = texture(uThicknessTex, vUV).r;
  vec3 hitUVW;
  float colliderDepth = traceCollider(uCamPos, rayDir, hitUVW);
  if (colliderDepth > 0.0 && (depth >= 19.9 || colliderDepth < depth)) {
    vec3 objectNormalUVW = colliderNormal(hitUVW);
    vec3 objectNormal = normalize(objectNormalUVW / (uBoxMax - uBoxMin));
    float objectLight = 0.25 + 0.75 * max(dot(objectNormal, uSunDir), 0.0);
    vec3 objectColor = vec3(0.055, 0.075, 0.095) * objectLight;
    float edge = pow(1.0 - max(dot(objectNormal, -rayDir), 0.0), 3.0);
    objectColor += vec3(0.16, 0.24, 0.30) * edge;
    outColor = vec4(pow(clamp(objectColor, vec3(0.0), vec3(1.0)), vec3(1.0 / 2.2)), 1.0);
    return;
  }
  if (depth >= 19.9 || thickness < 0.001) {
    outColor = vec4(pow(background, vec3(1.0 / 2.2)), 1.0);
    return;
  }

  vec3 surfacePosition = worldAtDepth(vUV, depth);
  vec2 px = 1.0 / uViewport;
  float depthX = readDepth(vUV + vec2(px.x * 1.5, 0.0));
  float depthY = readDepth(vUV + vec2(0.0, px.y * 1.5));
  vec3 normal = normalize(cross(
    worldAtDepth(vUV + vec2(px.x * 1.5, 0.0), depthX) - surfacePosition,
    worldAtDepth(vUV + vec2(0.0, px.y * 1.5), depthY) - surfacePosition
  ));
  if (length(normal) < 0.1 || dot(normal, -rayDir) < 0.0) normal = vec3(0.0, 1.0, 0.0);

  float diffuse = max(0.12, dot(normal, uSunDir));
  float fresnel = pow(1.0 - max(dot(normal, -rayDir), 0.0), 5.0);
  float foam = clamp(texture(uThicknessTex, vUV).r * 0.55 / max(0.5 + uWaterSurfaceThreshold, 0.1), 0.0, 1.0);
  vec3 water = uWaterTint * (0.35 + 0.65 * diffuse);
  vec3 reflection = mix(vec3(0.02, 0.07, 0.13),
                        mix(uWaterTint * 2.1, vec3(0.27, 0.62, 0.88), 0.64),
                        clamp(0.42 + normal.y * 0.55, 0.0, 1.0));
  vec3 refracted = mix(water, vec3(0.035, 0.22, 0.38), clamp(uWaterRefraction, 0.0, 1.0));
  refracted = mix(refracted, vec3(0.05, 0.16, 0.22), clamp(uWaterScattering, 0.0, 1.0) * 0.35);
  float specular = pow(max(dot(reflect(-uSunDir, normal), -rayDir), 0.0), mix(96.0, 24.0, clamp(uWaterRoughness, 0.0, 1.0)))
                 * uLiquidSpecular * (0.10 + 0.28 * uWaterLightIntensity) * (1.0 - 0.4 * uWaterRoughness);
  float absorb = exp(-thickness * uWaterAbsorption * 0.55);
  vec3 surface = refracted * (0.32 + 0.68 * diffuse)
               + reflection * fresnel * (0.25 + 0.55 * uWaterRefraction)
               + vec3(0.65, 0.86, 1.0) * specular;
  vec3 foamColor = mix(vec3(0.46, 0.70, 0.86), vec3(0.94, 0.99, 1.0), diffuse);
  surface = mix(surface, foamColor, foam * 0.7);
  vec3 result = background * absorb + surface * (1.0 - absorb) + background * 0.08;

  // Render the kinematic collider above the water when it is in front of the
  // reconstructed depth. This is analytic geometry, not part of the liquid.
  vec3 colliderUVW = (surfacePosition - uBoxMin) / (uBoxMax - uBoxMin);
  float collider = colliderSdf(colliderUVW);
  if (collider < 0.0) result = mix(result, vec3(0.035, 0.045, 0.06), 0.80);

  float caustic = (0.5 + 0.5 * sin(surfacePosition.x * 8.0 + uTime * 0.45))
                * (0.5 + 0.5 * sin(surfacePosition.z * 10.0 - uTime * 0.31));
  result += vec3(0.015, 0.055, 0.095) * caustic * uCausticsIntensity * (1.0 - foam);
  result *= mix(0.72, 1.0, uWaterAmbientIntensity);
  result = clamp(result * uWaterExposure, vec3(0.0), vec3(1.0));
  outColor = vec4(pow(result, vec3(1.0 / 2.2)), 1.0);
}
`;

export class ParticleFluidWebGL2Engine {
  constructor(canvas, params) {
    this.canvas = canvas;
    this.params = params;
    this.backendName = 'WebGL2 (Dedicated Particle Liquid)';
    this.isParticleFluid = true;
    this.tilesX = 1;
    this.tilesY = 1;
    this.gl = canvas.getContext('webgl2', {
      alpha: false,
      depth: true,
      stencil: false,
      antialias: false,
      powerPreference: 'high-performance',
    });
    if (!this.gl) throw new Error('WebGL2 is required for the dedicated particle liquid solver.');

    this.extColorBufferFloat = this.gl.getExtension('EXT_color_buffer_float');
    this.extFloatLinear = this.gl.getExtension('OES_texture_float_linear');
    this.particleTexSize = 64;
    this.maxParticles = this.particleTexSize * this.particleTexSize;
    this.particleCount = this.getParticleCount(params.gridResolution);
    this.time = 0;
    this.liquidSplash = null;
    this.hydroCollider = null;
    this.renderTargets = null;
    this.current = 0;

    this.fullscreenVAO = this.gl.createVertexArray();
    this.pointVAO = this.gl.createVertexArray();
    this.programs = {
      update: this.createProgram(FULLSCREEN_VERT, PARTICLE_UPDATE_FRAG),
      depth: this.createProgram(PARTICLE_VERT, PARTICLE_DEPTH_FRAG),
      thickness: this.createProgram(PARTICLE_VERT, PARTICLE_THICKNESS_FRAG),
      composite: this.createProgram(FULLSCREEN_VERT, FLUID_COMPOSITE_FRAG),
    };
    this.initParticleTextures();
    this.clearGrid();
  }

  getParticleCount(resolution = this.params.gridResolution) {
    const res = Number(resolution) || 48;
    if (res >= 64) return 1536;
    if (res >= 48) return 1280;
    if (res >= 32) return 1024;
    return 768;
  }

  createShader(type, source) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error(`Particle liquid GLSL compile error:\n${info}`);
    }
    return shader;
  }

  createProgram(vertexSource, fragmentSource) {
    const gl = this.gl;
    const vs = this.createShader(gl.VERTEX_SHADER, vertexSource);
    const fs = this.createShader(gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Particle liquid GLSL link error:\n${info}`);
    }
    const uniforms = {};
    for (let i = 0; i < gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS); i++) {
      const info = gl.getActiveUniform(program, i);
      uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(program, info.name.replace(/\[0\]$/, ''));
    }
    return { program, uniforms };
  }

  makeTexture(data = null) {
    const gl = this.gl;
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const internal = this.extColorBufferFloat ? gl.RGBA32F : gl.RGBA16F;
    const type = this.extColorBufferFloat ? gl.FLOAT : gl.HALF_FLOAT;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, this.particleTexSize, this.particleTexSize, 0, gl.RGBA, type, data);
    return texture;
  }

  makeParticleFBO(pos, vel) {
    const gl = this.gl;
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, pos, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, vel, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Particle liquid state framebuffer is incomplete.');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return fbo;
  }

  initParticleTextures() {
    this.positionTextures = [this.makeTexture(), this.makeTexture()];
    this.velocityTextures = [this.makeTexture(), this.makeTexture()];
    this.particleFbos = [
      this.makeParticleFBO(this.positionTextures[0], this.velocityTextures[0]),
      this.makeParticleFBO(this.positionTextures[1], this.velocityTextures[1]),
    ];
  }

  getBoundsBox() {
    const p = this.params;
    const width = p.boundsWidth || 2.35;
    const height = p.boundsHeight || 1.85;
    const floorY = -0.6;
    return {
      boxMin: [-width * 0.5, floorY, -width * 0.5],
      boxMax: [width * 0.5, floorY + height, width * 0.5],
      domainScale: [width, height, width],
      effWidth: width,
      effHeight: height,
      surgeMult: 1,
    };
  }

  seedParticleArrays() {
    const p = this.params;
    const positions = new Float32Array(this.maxParticles * 4);
    const velocities = new Float32Array(this.maxParticles * 4);
    const count = this.particleCount;
    const level = Math.max(0.06, Math.min(0.88, Number(p.waterPoolLevel) || 0.25));
    const dam = Number(p.hydroScene) === 1;
    const damX = Math.max(0.12, Math.min(0.82, Number(p.damGateX) || 0.36));
    // A squat 16×16 lattice gives the marker volume enough vertical layers
    // to form a pool instead of a single noisy billboard of particles.
    const nx = 16;
    const nz = 16;
    const ny = Math.max(1, Math.ceil(count / (nx * nz)));
    let i = 0;
    for (let y = 0; y < ny && i < count; y++) {
      for (let z = 0; z < nz && i < count; z++) {
        for (let x = 0; x < nx && i < count; x++) {
          let px = (x + 0.5) / nx;
          const pz = (z + 0.5) / nz;
          const py = ((y + 0.5) / ny) * level;
          if (dam) px *= damX;
          const jitter = ((i * 17) % 23) / 23.0 - 0.5;
          const lateral = ((i * 29) % 19) / 19.0 - 0.5;
          positions[i * 4 + 0] = Math.max(0.02, Math.min(0.98, px + jitter * 0.0025));
          positions[i * 4 + 1] = Math.max(0.025, Math.min(0.96, py + lateral * 0.0025));
          positions[i * 4 + 2] = Math.max(0.02, Math.min(0.98, pz + jitter * 0.0025));
          positions[i * 4 + 3] = 1;
          const gate = dam && Math.abs(px - damX) < 0.045 ? 2.0 : 0;
          velocities[i * 4 + 0] = gate;
          velocities[i * 4 + 1] = dam && gate > 0 ? 0.15 : 0;
          velocities[i * 4 + 2] = 0;
          velocities[i * 4 + 3] = 0;
          i++;
        }
      }
    }
    return { positions, velocities };
  }

  uploadState() {
    const gl = this.gl;
    const { positions, velocities } = this.seedParticleArrays();
    const internal = this.extColorBufferFloat ? gl.RGBA32F : gl.RGBA16F;
    const type = this.extColorBufferFloat ? gl.FLOAT : gl.HALF_FLOAT;
    for (const texture of this.positionTextures) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, this.particleTexSize, this.particleTexSize, 0, gl.RGBA, type, positions);
    }
    for (const texture of this.velocityTextures) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, this.particleTexSize, this.particleTexSize, 0, gl.RGBA, type, velocities);
    }
    this.current = 0;
    this.time = 0;
  }

  clearGrid() {
    this.liquidSplash = null;
    this.hydroCollider = null;
    this.uploadState();
  }

  setGridResolution(resolution) {
    const nextCount = this.getParticleCount(resolution);
    if (nextCount !== this.particleCount) {
      this.particleCount = nextCount;
      this.clearGrid();
    }
  }

  getHydroColliderState() {
    const p = this.params;
    const type = Number(p.obstacleType) || 0;
    const speed = Math.max(0.05, Number(p.colliderSpeed) || 1);
    const baseX = Number.isFinite(p.obstacleX) ? p.obstacleX : 0.5;
    const baseZ = Number.isFinite(p.obstacleZ) ? p.obstacleZ : 0.5;
    const level = Number.isFinite(p.waterPoolLevel) ? p.waterPoolLevel : 0.25;
    const radius = Number.isFinite(p.obstacleRadius) ? p.obstacleRadius : 0.16;
    if (!p.colliderAutoMove || type === 0) {
      return { pos: [baseX, Number.isFinite(p.obstacleY) ? p.obstacleY : level + radius * 0.35, baseZ], vel: [0, 0, 0] };
    }
    const phase = this.time * speed * (type === 5 ? 0.72 : 0.58);
    const phaseZ = this.time * speed * (type === 5 ? 0.39 : 0.46) + 0.8;
    const ampX = type === 5 ? 0.29 : 0.25;
    const ampZ = type === 5 ? 0.075 : 0.17;
    return {
      pos: [baseX + Math.sin(phase) * ampX, level + radius * (type === 5 ? 0.48 : 0.38), baseZ + Math.sin(phaseZ) * ampZ],
      vel: [Math.cos(phase) * ampX * speed * (type === 5 ? 0.72 : 0.58), 0, Math.cos(phaseZ) * ampZ * speed * (type === 5 ? 0.39 : 0.46)],
    };
  }

  triggerLiquidSplash(options = {}) {
    const p = this.params;
    this.liquidSplash = {
      center: options.center || [0.5, p.waterPoolLevel ?? 0.25, 0.5],
      impulse: options.impulse ?? p.splashEnergy ?? 1.5,
      age: 0,
    };
  }

  triggerExplosion(options = {}) {
    this.triggerLiquidSplash({
      center: options.center || [0.5, this.params.waterPoolLevel ?? 0.25, 0.5],
      impulse: options.impulse ?? Math.max(1.0, (options.strength ?? 6) * 0.18),
    });
  }

  setBrush(pos, vel, active = true) {
    if (active && pos) this.triggerLiquidSplash({ center: pos, impulse: Math.min(3, 1.0 + (vel ? Math.hypot(...vel) * 0.08 : 0)) });
  }

  setTextureUniform(program, name, unit, texture) {
    const gl = this.gl;
    const location = program.uniforms[name];
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (location !== null && location !== undefined) gl.uniform1i(location, unit);
  }

  setUpdateUniforms(program, dt, collider) {
    const gl = this.gl;
    const u = program.uniforms;
    const set1f = (name, value) => { if (u[name] !== null && u[name] !== undefined) gl.uniform1f(u[name], value); };
    const set1i = (name, value) => { if (u[name] !== null && u[name] !== undefined) gl.uniform1i(u[name], value); };
    const set3 = (name, value) => { if (u[name] !== null && u[name] !== undefined) gl.uniform3fv(u[name], value); };
    const p = this.params;
    const splash = this.liquidSplash;
    set1i('uParticleTexSize', this.particleTexSize);
    set1i('uParticleCount', this.particleCount);
    set1f('uDt', dt);
    set1f('uGravity', p.liquidGravity ?? 9.8);
    set1f('uViscosity', p.liquidViscosity ?? 0.04);
    set1f('uPressureStiffness', p.pressureStiffness ?? 1.8);
    set1f('uRestDensity', p.restDensity ?? 2.2);
    set1f('uSmoothingRadius', p.particleSmoothingRadius ?? 0.09);
    set1f('uSurfaceTension', p.surfaceTension ?? 0.52);
    set1f('uSurfaceAdhesion', p.surfaceAdhesion ?? 0.65);
    set1i('uObstacleType', Number(p.obstacleType) || 0);
    set3('uColliderPos', collider.pos);
    set3('uColliderVel', collider.vel);
    set1f('uColliderRadius', p.obstacleRadius ?? 0.16);
    set1i('uHydroScene', p.hydroScene ?? 0);
    set1f('uWaterLevel', p.waterPoolLevel ?? 0.25);
    set1f('uDamGateX', p.damGateX ?? 0.36);
    set1i('uEnclosedBox', p.enclosedBox ? 1 : 0);
    set1i('uEmitterEnabled', p.emitterEnabled ? 1 : 0);
    set1f('uEmitterRate', p.emitterRate ?? 1);
    set1f('uEmitterRadius', p.emitterRadius ?? 0.1);
    set1f('uEmitterPosY', p.emitterPosY ?? 0.76);
    set1f('uFoamGeneration', p.foamGeneration ?? 1.45);
    set1f('uFoamDissipation', p.foamDissipation ?? 0.42);
    set1i('uWaveMode', p.waveMode ?? 0);
    set1f('uWaveHeight', p.waveHeight ?? 0.0);
    set1f('uWaveSpeed', p.waveSpeed ?? 1.0);
    set1f('uTime', this.time);
    set3('uSplashCenter', splash?.center || [0.5, p.waterPoolLevel ?? 0.25, 0.5]);
    set1f('uSplashAge', splash?.age ?? 99);
    set1f('uSplashImpulse', splash ? splash.impulse : 0);
  }

  stepSimulation(rawDt) {
    const gl = this.gl;
    const dt = Math.min(rawDt, 0.025) * (this.params.timeScale || 1);
    this.time += dt;
    const collider = this.getHydroColliderState();
    this.hydroCollider = collider;
    const read = this.current;
    const write = 1 - read;
    const pass = this.programs.update;
    gl.useProgram(pass.program);
    this.setTextureUniform(pass, 'uPositionTex', 0, this.positionTextures[read]);
    this.setTextureUniform(pass, 'uVelocityTex', 1, this.velocityTextures[read]);
    this.setUpdateUniforms(pass, dt, collider);
    gl.bindVertexArray(this.fullscreenVAO);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.particleFbos[write]);
    gl.viewport(0, 0, this.particleTexSize, this.particleTexSize);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.current = write;
    if (this.liquidSplash) {
      this.liquidSplash.age += dt;
      if (this.liquidSplash.age > 2.4) this.liquidSplash = null;
    }
  }

  ensureRenderTargets() {
    const gl = this.gl;
    const width = this.canvas.width;
    const height = this.canvas.height;
    if (this.renderTargets && this.renderTargets.width === width && this.renderTargets.height === height) return;
    if (this.renderTargets) {
      ['depthTex', 'thicknessTex'].forEach((key) => gl.deleteTexture(this.renderTargets[key]));
      ['depthFbo', 'thicknessFbo'].forEach((key) => gl.deleteFramebuffer(this.renderTargets[key]));
      if (this.renderTargets.depthBuffer) gl.deleteRenderbuffer(this.renderTargets.depthBuffer);
    }
    const makeColor = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      const internal = this.extColorBufferFloat ? gl.RGBA16F : gl.RGBA8;
      const type = this.extColorBufferFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;
      const filter = this.extFloatLinear ? gl.LINEAR : gl.NEAREST;
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, width, height, 0, gl.RGBA, type, null);
      return tex;
    };
    const makeFbo = (texture, withDepth = false) => {
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      let depth = null;
      if (withDepth) {
        depth = gl.createRenderbuffer();
        gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
        gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, width, height);
        gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
      }
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      const complete = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!complete) throw new Error('Particle liquid render framebuffer is incomplete.');
      return { fbo, depth };
    };
    const depthTex = makeColor();
    const thicknessTex = makeColor();
    const depthTarget = makeFbo(depthTex, true);
    const thicknessTarget = makeFbo(thicknessTex, false);
    this.renderTargets = {
      width,
      height,
      depthTex,
      thicknessTex,
      depthFbo: depthTarget.fbo,
      depthBuffer: depthTarget.depth,
      thicknessFbo: thicknessTarget.fbo,
    };
  }

  setParticleRenderUniforms(program, camera) {
    const gl = this.gl;
    const u = program.uniforms;
    const p = this.params;
    const { boxMin, boxMax } = this.getBoundsBox();
    const collider = this.hydroCollider || this.getHydroColliderState();
    const set1f = (n, v) => { if (u[n] !== null && u[n] !== undefined) gl.uniform1f(u[n], v); };
    const set1i = (n, v) => { if (u[n] !== null && u[n] !== undefined) gl.uniform1i(u[n], v); };
    const set2 = (n, v) => { if (u[n] !== null && u[n] !== undefined) gl.uniform2fv(u[n], v); };
    const set3 = (n, v) => { if (u[n] !== null && u[n] !== undefined) gl.uniform3fv(u[n], v); };
    set1i('uParticleTexSize', this.particleTexSize);
    set3('uBoxMin', boxMin); set3('uBoxMax', boxMax);
    set3('uCamPos', camera.position); set3('uCamForward', camera.forward);
    set3('uCamRight', camera.right); set3('uCamUp', camera.up);
    set1f('uTanHalfFov', Math.tan(camera.fovY * 0.5));
    set1f('uAspect', camera.aspect); set2('uViewport', [this.canvas.width, this.canvas.height]);
    set1f('uParticleRadius', p.particleRenderRadius ?? 0.032);
    set1f('uNearClip', 0.02); set1f('uFarClip', 20.0);
    set3('uSunDir', this.getSunDirection());
    set1f('uWaterAbsorption', p.waterAbsorption ?? 0.72);
    set1f('uWaterScattering', p.waterScattering ?? 0.08);
    set3('uWaterTint', [p.waterTintR ?? 0.018, p.waterTintG ?? 0.105, p.waterTintB ?? 0.240]);
    set1f('uWaterSurfaceThreshold', p.waterSurfaceThreshold ?? 0.18);
    set1f('uWaterRoughness', p.waterRoughness ?? 0.14);
    set1f('uLiquidSpecular', p.liquidSpecular ?? 1.35);
    set1f('uWaterRefraction', p.waterRefraction ?? 0.78);
    set1f('uWaterLightIntensity', p.waterLightIntensity ?? 1.15);
    set1f('uWaterAmbientIntensity', p.waterAmbientIntensity ?? 0.34);
    set1f('uWaterExposure', p.waterExposure ?? 1.0);
    set1f('uCausticsIntensity', p.causticsIntensity ?? 0.7);
    set1f('uTime', this.time);
    set1i('uObstacleType', Number(p.obstacleType) || 0);
    set3('uColliderPos', collider.pos);
    set1f('uColliderRadius', p.obstacleRadius ?? 0.16);
  }

  getSunDirection() {
    const p = this.params;
    const az = (p.sunAzimuth * Math.PI) / 180;
    const el = (p.sunElevation * Math.PI) / 180;
    return [Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)];
  }

  render(camera) {
    const gl = this.gl;
    this.ensureRenderTargets();
    const target = this.renderTargets;
    const read = this.current;
    gl.bindVertexArray(this.pointVAO);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.BLEND);

    // Pass 1: nearest particle sphere depth for surface reconstruction.
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.depthFbo);
    gl.viewport(0, 0, target.width, target.height);
    gl.clearColor(20.0, 0.0, 0.0, 0.0);
    gl.clearDepth(1.0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const depthProgram = this.programs.depth;
    gl.useProgram(depthProgram.program);
    this.setTextureUniform(depthProgram, 'uPositionTex', 0, this.positionTextures[read]);
    this.setTextureUniform(depthProgram, 'uVelocityTex', 1, this.velocityTextures[read]);
    this.setParticleRenderUniforms(depthProgram, camera);
    gl.drawArrays(gl.POINTS, 0, this.particleCount);

    // Pass 2: additive thickness/foam field. This is what stops isolated
    // markers from looking like smoke particles in the final composite.
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.thicknessFbo);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const thicknessProgram = this.programs.thickness;
    gl.useProgram(thicknessProgram.program);
    this.setTextureUniform(thicknessProgram, 'uPositionTex', 0, this.positionTextures[read]);
    this.setTextureUniform(thicknessProgram, 'uVelocityTex', 1, this.velocityTextures[read]);
    this.setParticleRenderUniforms(thicknessProgram, camera);
    gl.drawArrays(gl.POINTS, 0, this.particleCount);

    // Pass 3: water surface shading from depth/thickness, independent of the
    // Pyro material and density/temperature raymarcher.
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    const composite = this.programs.composite;
    gl.useProgram(composite.program);
    this.setTextureUniform(composite, 'uDepthTex', 0, target.depthTex);
    this.setTextureUniform(composite, 'uThicknessTex', 1, target.thicknessTex);
    this.setParticleRenderUniforms(composite, camera);
    gl.bindVertexArray(this.fullscreenVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  destroy() {
    const gl = this.gl;
    if (this.renderTargets) {
      ['depthTex', 'thicknessTex'].forEach((key) => gl.deleteTexture(this.renderTargets[key]));
      ['depthFbo', 'thicknessFbo'].forEach((key) => gl.deleteFramebuffer(this.renderTargets[key]));
      if (this.renderTargets.depthBuffer) gl.deleteRenderbuffer(this.renderTargets.depthBuffer);
    }
    this.positionTextures.forEach((texture) => gl.deleteTexture(texture));
    this.velocityTextures.forEach((texture) => gl.deleteTexture(texture));
    this.particleFbos.forEach((fbo) => gl.deleteFramebuffer(fbo));
    Object.values(this.programs).forEach((entry) => gl.deleteProgram(entry.program));
    gl.deleteVertexArray(this.fullscreenVAO);
    gl.deleteVertexArray(this.pointVAO);
  }
}
