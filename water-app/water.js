/*
 * Standalone Water Surface Lab.
 *
 * This file is intentionally self-contained. It does not import or call the
 * main Frontier/Pyro application. The simulation is a persistent marker
 * liquid with an independent surface reconstruction and water-only material.
 */

const canvas = document.getElementById('water-canvas');
const errorPanel = document.getElementById('error-panel');

const WATER = {
  particleTextureSize: 64,
  particleCount: 1536,
  gravity: 9.8,
  viscosity: 0.04,
  tension: 0.52,
  foam: 1.35,
  absorption: 0.72,
  roughness: 0.14,
  paused: false,
  obstacle: false,
  time: 0,
  mode: 'dam',
};

const BOX_MIN = [-1.35, -0.68, -1.35];
const BOX_MAX = [1.35, 1.05, 1.35];
const NEAR = 0.05;
const FAR = 20.0;

function showError(error) {
  errorPanel.hidden = false;
  errorPanel.textContent = `Standalone water app could not start.\n\n${error?.message || error}`;
}

let gl;
try {
  gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: true,
    stencil: false,
    powerPreference: 'high-performance',
  });
  if (!gl) throw new Error('WebGL2 is not available.');
  if (!gl.getExtension('EXT_color_buffer_float')) {
    throw new Error('This water renderer requires EXT_color_buffer_float for persistent marker state.');
  }
} catch (error) {
  showError(error);
  throw error;
}

const floatLinear = !!gl.getExtension('OES_texture_float_linear');

const FULLSCREEN_VERTEX = `#version 300 es
precision highp float;
out vec2 vUV;
void main() {
  vec2 p = gl_VertexID == 1 ? vec2(3.0, -1.0) : (gl_VertexID == 2 ? vec2(-1.0, 3.0) : vec2(-1.0, -1.0));
  gl_Position = vec4(p, 0.0, 1.0);
  vUV = p * 0.5 + 0.5;
}`;

const PARTICLE_UPDATE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uPosition;
uniform sampler2D uVelocity;
uniform int uTextureSize;
uniform int uCount;
uniform float uDt;
uniform float uGravity;
uniform float uViscosity;
uniform float uTension;
uniform float uRestDensity;
uniform float uKernelRadius;
uniform int uObstacleEnabled;
uniform vec3 uObstaclePosition;
uniform vec3 uObstacleVelocity;
uniform float uObstacleRadius;
uniform vec3 uSplashPosition;
uniform float uSplashAge;
uniform float uSplashImpulse;
uniform float uFoamGain;
uniform float uTime;

layout(location = 0) out vec4 nextPosition;
layout(location = 1) out vec4 nextVelocity;

const int MAX_MARKERS = 1536;

vec4 positionAt(int index) {
  return texelFetch(uPosition, ivec2(index % uTextureSize, index / uTextureSize), 0);
}

vec4 velocityAt(int index) {
  return texelFetch(uVelocity, ivec2(index % uTextureSize, index / uTextureSize), 0);
}

float sphereDistance(vec3 p) {
  if (uObstacleEnabled == 0) return 1000.0;
  return length(p - uObstaclePosition) - uObstacleRadius;
}

vec3 sphereNormal(vec3 p) {
  float e = 0.0015;
  return normalize(vec3(
    sphereDistance(p + vec3(e, 0.0, 0.0)) - sphereDistance(p - vec3(e, 0.0, 0.0)),
    sphereDistance(p + vec3(0.0, e, 0.0)) - sphereDistance(p - vec3(0.0, e, 0.0)),
    sphereDistance(p + vec3(0.0, 0.0, e)) - sphereDistance(p - vec3(0.0, 0.0, e))
  ));
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  int index = pixel.y * uTextureSize + pixel.x;
  vec4 state = positionAt(index);
  vec4 oldVelocityState = velocityAt(index);

  if (index >= uCount || state.a < 0.5) {
    nextPosition = vec4(0.0);
    nextVelocity = vec4(0.0);
    return;
  }

  vec3 position = state.xyz;
  vec3 velocity = oldVelocityState.xyz;
  float radius = max(uKernelRadius, 0.035);
  float density = 0.0;
  vec3 pressureForce = vec3(0.0);
  vec3 cohesionForce = vec3(0.0);
  vec3 viscosityForce = vec3(0.0);

  // Compact pairwise pressure/separation and viscosity. Markers are never
  // culled by the simulation; only inactive texture slots stay empty.
  for (int j = 0; j < MAX_MARKERS; j++) {
    if (j >= uCount) break;
    if (j == index) continue;
    vec4 neighbour = positionAt(j);
    if (neighbour.a < 0.5) continue;
    vec3 delta = position - neighbour.xyz;
    float distanceToNeighbour = length(delta);
    if (distanceToNeighbour >= radius) continue;
    float q = 1.0 - distanceToNeighbour / radius;
    density += q * q * 3.5;
  }

  float pressure = max(0.0, density - uRestDensity) * 1.65;
  for (int j = 0; j < MAX_MARKERS; j++) {
    if (j >= uCount) break;
    if (j == index) continue;
    vec4 neighbour = positionAt(j);
    if (neighbour.a < 0.5) continue;
    vec3 delta = position - neighbour.xyz;
    float distanceToNeighbour = length(delta);
    if (distanceToNeighbour >= radius || distanceToNeighbour < 0.0001) continue;
    float q = 1.0 - distanceToNeighbour / radius;
    vec3 direction = delta / distanceToNeighbour;
    pressureForce += direction * pressure * q * q / max(density, 1.0);
    cohesionForce -= direction * q * q * uTension * 0.025;
    viscosityForce += (velocityAt(j).xyz - velocity) * q * uViscosity * 0.14;
  }

  velocity += (vec3(0.0, -uGravity * 0.14, 0.0)
             + pressureForce * 0.72 + cohesionForce + viscosityForce) * uDt;
  velocity *= exp(-uViscosity * uDt * 2.8);

  // A small travelling forcing term keeps the free surface alive in the calm
  // pool without replacing the 3D marker body with a height field.
  float wavePhase = position.x * 3.8 + position.z * 2.0 + uTime * 0.82;
  float surfaceBand = exp(-abs(position.y - 0.27) * 14.0);
  velocity.y += cos(wavePhase) * 0.08 * surfaceBand * uDt;

  if (uObstacleEnabled == 1) {
    float bodyDistance = sphereDistance(position);
    if (bodyDistance < radius * 0.92) {
      vec3 normal = sphereNormal(position);
      position += normal * (radius * 0.92 - bodyDistance + 0.0005);
      vec3 relativeVelocity = velocity - uObstacleVelocity;
      float inward = dot(relativeVelocity, normal);
      if (inward < 0.0) relativeVelocity -= normal * inward * 1.30;
      velocity = uObstacleVelocity + relativeVelocity * 0.78;
      velocity += normal * length(uObstacleVelocity) * 0.18;
    }
  }

  if (uSplashImpulse > 0.001 && uSplashAge < 2.4) {
    vec3 splashDelta = position - uSplashPosition;
    float splashDistance = length(splashDelta);
    float ringRadius = 0.035 + uSplashAge * 0.24;
    float ring = exp(-pow((splashDistance - ringRadius) * 18.0, 2.0));
    float core = exp(-splashDistance * splashDistance * 150.0);
    float fade = exp(-uSplashAge * 1.8) * uSplashImpulse;
    vec3 direction = splashDistance > 0.001 ? splashDelta / splashDistance : vec3(0.0, 1.0, 0.0);
    velocity += (direction + vec3(0.0, 1.35, 0.0)) * fade * (ring * 0.85 + core * 0.55);
  }

  velocity = clamp(velocity, vec3(-6.0), vec3(6.0));
  position += velocity * uDt * 0.42;

  // Closed volume retention: floor, ceiling, and side walls keep water volume
  // in the container while still allowing the dam front to spread and splash.
  if (position.y < 0.018) { position.y = 0.018; velocity.y = max(velocity.y, 0.0) * 0.18; }
  if (position.y > 0.985) { position.y = 0.985; velocity.y = min(velocity.y, 0.0) * 0.18; }
  if (position.x < 0.012) { position.x = 0.012; velocity.x = abs(velocity.x) * 0.24; }
  if (position.x > 0.988) { position.x = 0.988; velocity.x = -abs(velocity.x) * 0.24; }
  if (position.z < 0.012) { position.z = 0.012; velocity.z = abs(velocity.z) * 0.24; }
  if (position.z > 0.988) { position.z = 0.988; velocity.z = -abs(velocity.z) * 0.24; }

  float impactFoam = clamp((pressure * 0.065 + length(velocity) * 0.030) * uFoamGain, 0.0, 1.0);
  float foam = max(oldVelocityState.a * exp(-uDt * 0.58), impactFoam);
  nextPosition = vec4(position, 1.0);
  nextVelocity = vec4(velocity, foam);
}`;

const PARTICLE_VERTEX = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uPosition;
uniform sampler2D uVelocity;
uniform int uTextureSize;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uCameraPosition;
uniform vec3 uCameraForward;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec2 uViewport;
uniform float uSplatRadius;
uniform float uNear;
uniform float uFar;

out float markerDepth;
out float markerFoam;
out float markerRadius;

void main() {
  int index = gl_VertexID;
  ivec2 coord = ivec2(index % uTextureSize, index / uTextureSize);
  vec4 marker = texelFetch(uPosition, coord, 0);
  vec4 velocity = texelFetch(uVelocity, coord, 0);
  if (marker.a < 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    markerDepth = uFar;
    markerFoam = 0.0;
    markerRadius = 0.0;
    return;
  }

  vec3 world = mix(uBoxMin, uBoxMax, marker.xyz);
  vec3 viewVector = world - uCameraPosition;
  float depth = max(dot(viewVector, uCameraForward), uNear);
  float ndcX = dot(viewVector, uCameraRight) / (depth * uTanHalfFov * uAspect);
  float ndcY = dot(viewVector, uCameraUp) / (depth * uTanHalfFov);
  float clipZ = (depth - uNear) / max(uFar - uNear, 0.001) * 2.0 - 1.0;
  gl_Position = vec4(ndcX, ndcY, clipZ, 1.0);
  gl_PointSize = max(2.0, uSplatRadius / depth * uViewport.y / uTanHalfFov);
  markerDepth = depth;
  markerFoam = velocity.a;
  markerRadius = uSplatRadius;
}`;

const DEPTH_FRAGMENT = `#version 300 es
precision highp float;
in float markerDepth;
in float markerFoam;
in float markerRadius;
layout(location = 0) out vec4 surfaceDepth;
void main() {
  vec2 point = gl_PointCoord * 2.0 - 1.0;
  float radius2 = dot(point, point);
  if (radius2 > 1.0) discard;
  float sphereOffset = sqrt(max(0.0, 1.0 - radius2)) * markerRadius * 0.72;
  surfaceDepth = vec4(markerDepth - sphereOffset, 0.0, 0.0, 1.0);
}`;

const THICKNESS_FRAGMENT = `#version 300 es
precision highp float;
in float markerDepth;
in float markerFoam;
in float markerRadius;
layout(location = 0) out vec4 surfaceThickness;
void main() {
  vec2 point = gl_PointCoord * 2.0 - 1.0;
  float radius2 = dot(point, point);
  if (radius2 > 1.0) discard;
  float disc = 1.0 - smoothstep(0.28, 1.0, radius2);
  surfaceThickness = vec4(disc * (0.26 + markerFoam * 0.78), disc * markerFoam, 0.0, disc);
}`;

const BLUR_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUV;
uniform sampler2D uSource;
uniform vec2 uDirection;
uniform int uDepthMode;
layout(location = 0) out vec4 blurred;
void main() {
  float center = texture(uSource, vUV).r;
  vec4 total = vec4(0.0);
  float weightTotal = 0.0;
  for (int i = -6; i <= 6; i++) {
    float fi = float(i);
    float gaussian = exp(-fi * fi / 15.0);
    vec4 sampleValue = texture(uSource, vUV + uDirection * fi);
    if (uDepthMode == 1) {
      if (sampleValue.r >= 19.9) continue;
      float edgeWeight = center >= 19.9 ? 1.0 : exp(-abs(sampleValue.r - center) * 7.0);
      gaussian *= edgeWeight;
    }
    total += sampleValue * gaussian;
    weightTotal += gaussian;
  }
  if (uDepthMode == 1 && weightTotal < 0.001) {
    blurred = vec4(20.0, 0.0, 0.0, 1.0);
  } else {
    blurred = total / max(weightTotal, 0.001);
  }
}`;

const COMPOSITE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 vUV;
layout(location = 0) out vec4 outColor;

uniform sampler2D uDepth;
uniform sampler2D uThickness;
uniform vec3 uCameraPosition;
uniform vec3 uCameraForward;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform float uTanHalfFov;
uniform float uAspect;
uniform vec2 uViewport;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uSunDirection;
uniform vec3 uWaterTint;
uniform float uAbsorption;
uniform float uRoughness;
uniform float uRefraction;
uniform float uFoam;
uniform float uTime;
uniform int uObstacleEnabled;
uniform vec3 uObstaclePosition;
uniform float uObstacleRadius;

vec3 rayDirection(vec2 uv) {
  vec2 ndc = uv * 2.0 - 1.0;
  return normalize(uCameraForward + ndc.x * uAspect * uTanHalfFov * uCameraRight + ndc.y * uTanHalfFov * uCameraUp);
}

vec3 worldAtDepth(vec2 uv, float depth) {
  vec3 direction = rayDirection(uv);
  return uCameraPosition + direction * (depth / max(dot(direction, uCameraForward), 0.001));
}

float readDepth(vec2 uv) {
  return texture(uDepth, clamp(uv, vec2(0.0), vec2(1.0))).r;
}

vec3 floorSurface(vec3 world) {
  vec3 result = vec3(0.012, 0.021, 0.034);
  float gridX = 1.0 - smoothstep(0.008, 0.026, abs(fract(world.x * 3.6) - 0.5));
  float gridZ = 1.0 - smoothstep(0.008, 0.026, abs(fract(world.z * 3.6) - 0.5));
  result += vec3(0.025, 0.08, 0.13) * max(gridX, gridZ);
  return result;
}

bool traceObstacle(vec3 origin, vec3 direction, out float hitDistance, out vec3 hitNormal) {
  hitDistance = -1.0;
  hitNormal = vec3(0.0, 1.0, 0.0);
  if (uObstacleEnabled == 0) return false;
  vec3 extent = uBoxMax - uBoxMin;
  vec3 center = mix(uBoxMin, uBoxMax, uObstaclePosition);
  float radius = uObstacleRadius * min(min(extent.x, extent.y), extent.z);
  vec3 oc = origin - center;
  float b = dot(oc, direction);
  float c = dot(oc, oc) - radius * radius;
  float discriminant = b * b - c;
  if (discriminant <= 0.0) return false;
  float t = -b - sqrt(discriminant);
  if (t < 0.0) t = -b + sqrt(discriminant);
  if (t <= 0.0) return false;
  hitDistance = t;
  hitNormal = normalize(origin + direction * t - center);
  return true;
}

void main() {
  vec3 direction = rayDirection(vUV);
  float floorDistance = 1e9;
  if (direction.y < -0.0001) floorDistance = (uBoxMin.y - uCameraPosition.y) / direction.y;
  vec3 floorWorld = uCameraPosition + direction * floorDistance;
  vec3 background = floorDistance > 0.0 && floorDistance < 32.0 ? floorSurface(floorWorld) : vec3(0.006, 0.010, 0.018);

  float depth = readDepth(vUV);
  float thickness = texture(uThickness, vUV).r;
  vec4 thicknessState = texture(uThickness, vUV);
  float obstacleDepth;
  vec3 obstacleNormal;
  if (traceObstacle(uCameraPosition, direction, obstacleDepth, obstacleNormal)
      && (depth >= 19.9 || obstacleDepth < depth)) {
    float light = 0.22 + 0.78 * max(dot(obstacleNormal, uSunDirection), 0.0);
    vec3 obstacleColor = vec3(0.22, 0.27, 0.32) * light;
    obstacleColor += vec3(0.16, 0.25, 0.34) * pow(1.0 - max(dot(obstacleNormal, -direction), 0.0), 3.0);
    outColor = vec4(pow(clamp(obstacleColor, vec3(0.0), vec3(1.0)), vec3(1.0 / 2.2)), 1.0);
    return;
  }

  if (depth >= 19.9 || thickness < 0.004) {
    outColor = vec4(pow(background, vec3(1.0 / 2.2)), 1.0);
    return;
  }

  vec3 surface = worldAtDepth(vUV, depth);
  vec2 pixel = 1.0 / uViewport;
  float dx = readDepth(vUV + vec2(pixel.x * 1.8, 0.0));
  float dy = readDepth(vUV + vec2(0.0, pixel.y * 1.8));
  if (dx >= 19.9) dx = depth;
  if (dy >= 19.9) dy = depth;
  vec3 tangentX = worldAtDepth(vUV + vec2(pixel.x * 1.8, 0.0), dx) - surface;
  vec3 tangentY = worldAtDepth(vUV + vec2(0.0, pixel.y * 1.8), dy) - surface;
  vec3 normal = normalize(cross(tangentX, tangentY));
  if (dot(normal, -direction) < 0.0) normal = -normal;
  if (length(normal) < 0.1) normal = vec3(0.0, 1.0, 0.0);

  float diffuse = max(0.12, dot(normal, uSunDirection));
  float viewAngle = max(dot(normal, -direction), 0.0);
  float fresnel = pow(1.0 - viewAngle, 5.0);
  float foam = clamp(thicknessState.g * 2.4 * uFoam, 0.0, 1.0);
  float absorption = exp(-thickness * uAbsorption * 0.15);
  vec3 body = uWaterTint * (0.30 + 0.70 * diffuse);
  vec3 refracted = mix(body, vec3(0.025, 0.22, 0.40), clamp(uRefraction, 0.0, 1.0));
  vec3 reflection = mix(vec3(0.018, 0.045, 0.085), vec3(0.23, 0.62, 0.92), clamp(0.48 + normal.y * 0.54, 0.0, 1.0));
  float specular = pow(max(dot(reflect(-uSunDirection, normal), -direction), 0.0), mix(96.0, 22.0, clamp(uRoughness, 0.0, 1.0)))
                 * (0.10 + 0.32 * (1.0 - uRoughness));
  vec3 color = refracted * (0.34 + 0.66 * diffuse)
             + reflection * fresnel * (0.25 + 0.75 * uRefraction)
             + vec3(0.72, 0.88, 1.0) * specular;
  vec3 foamColor = mix(vec3(0.38, 0.68, 0.83), vec3(0.96, 0.995, 1.0), diffuse);
  color = mix(color, foamColor, foam * 0.78);

  float caustic = (0.5 + 0.5 * sin(surface.x * 7.0 + uTime * 0.35))
                * (0.5 + 0.5 * sin(surface.z * 9.0 - uTime * 0.27));
  color += vec3(0.012, 0.045, 0.08) * caustic * (1.0 - foam);
  vec3 finalColor = background * absorption + color * (1.0 - absorption) + background * 0.055;
  finalColor = clamp(finalColor, vec3(0.0), vec3(1.0));
  outColor = vec4(pow(finalColor, vec3(1.0 / 2.2)), 1.0);
}`;

class OrbitCamera {
  constructor() {
    this.yaw = 0.68;
    this.pitch = 0.64;
    this.distance = 4.3;
    this.target = [0.0, -0.05, 0.0];
    this.position = [0, 0, 0];
    this.forward = [0, 0, -1];
    this.right = [1, 0, 0];
    this.up = [0, 1, 0];
    this.aspect = 1;
    this.fov = Math.PI * 0.23;
    this.update();
  }

  update() {
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    this.position[0] = this.target[0] + this.distance * cp * sy;
    this.position[1] = this.target[1] + this.distance * sp;
    this.position[2] = this.target[2] + this.distance * cp * cy;
    const fx = this.target[0] - this.position[0];
    const fy = this.target[1] - this.position[1];
    const fz = this.target[2] - this.position[2];
    const fl = Math.hypot(fx, fy, fz) || 1;
    this.forward = [fx / fl, fy / fl, fz / fl];
    const rx = this.forward[1] * 0 - this.forward[2] * 1;
    const ry = this.forward[2] * 0 - this.forward[0] * 0;
    const rz = this.forward[0] * 1 - this.forward[1] * 0;
    const rl = Math.hypot(rx, ry, rz) || 1;
    this.right = [rx / rl, ry / rl, rz / rl];
    this.up = [
      this.right[1] * this.forward[2] - this.right[2] * this.forward[1],
      this.right[2] * this.forward[0] - this.right[0] * this.forward[2],
      this.right[0] * this.forward[1] - this.right[1] * this.forward[0],
    ];
  }

  reset() {
    this.yaw = 0.68;
    this.pitch = 0.64;
    this.distance = 4.3;
    this.target = [0.0, -0.05, 0.0];
    this.update();
  }

  ray(ndcX, ndcY) {
    const t = Math.tan(this.fov * 0.5);
    const x = ndcX * this.aspect * t;
    const y = ndcY * t;
    const dx = this.forward[0] + x * this.right[0] + y * this.up[0];
    const dy = this.forward[1] + x * this.right[1] + y * this.up[1];
    const dz = this.forward[2] + x * this.right[2] + y * this.up[2];
    const l = Math.hypot(dx, dy, dz) || 1;
    return { origin: [...this.position], direction: [dx / l, dy / l, dz / l] };
  }
}

function shader(type, source) {
  const result = gl.createShader(type);
  gl.shaderSource(result, source);
  gl.compileShader(result);
  if (!gl.getShaderParameter(result, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(result);
    gl.deleteShader(result);
    throw new Error(`GLSL compile error:\n${log}`);
  }
  return result;
}

function program(vertexSource, fragmentSource) {
  const vertex = shader(gl.VERTEX_SHADER, vertexSource);
  const fragment = shader(gl.FRAGMENT_SHADER, fragmentSource);
  const result = gl.createProgram();
  gl.attachShader(result, vertex);
  gl.attachShader(result, fragment);
  gl.linkProgram(result);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(result, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(result);
    gl.deleteProgram(result);
    throw new Error(`GLSL link error:\n${log}`);
  }
  const uniforms = {};
  for (let i = 0; i < gl.getProgramParameter(result, gl.ACTIVE_UNIFORMS); i++) {
    const info = gl.getActiveUniform(result, i);
    uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(result, info.name.replace(/\[0\]$/, ''));
  }
  return { handle: result, uniforms };
}

function set1f(u, name, value) { if (u[name] !== null && u[name] !== undefined) gl.uniform1f(u[name], value); }
function set1i(u, name, value) { if (u[name] !== null && u[name] !== undefined) gl.uniform1i(u[name], value); }
function set2f(u, name, x, y) { if (u[name] !== null && u[name] !== undefined) gl.uniform2f(u[name], x, y); }
function set3f(u, name, value) { if (u[name] !== null && u[name] !== undefined) gl.uniform3fv(u[name], value); }

class WaterSurfaceLab {
  constructor() {
    this.camera = new OrbitCamera();
    this.fullscreenVAO = gl.createVertexArray();
    this.pointsVAO = gl.createVertexArray();
    this.current = 0;
    this.splash = null;
    this.obstaclePosition = [0.56, 0.22, 0.52];
    this.obstacleVelocity = [0, 0, 0];
    this.lastTime = performance.now();
    this.fpsTime = 0;
    this.fpsFrames = 0;

    this.pipelines = {
      update: program(FULLSCREEN_VERTEX, PARTICLE_UPDATE_FRAGMENT),
      depth: program(PARTICLE_VERTEX, DEPTH_FRAGMENT),
      thickness: program(PARTICLE_VERTEX, THICKNESS_FRAGMENT),
      blur: program(FULLSCREEN_VERTEX, BLUR_FRAGMENT),
      composite: program(FULLSCREEN_VERTEX, COMPOSITE_FRAGMENT),
    };

    this.positionTextures = [this.makeStateTexture(), this.makeStateTexture()];
    this.velocityTextures = [this.makeStateTexture(), this.makeStateTexture()];
    this.stateFbos = [
      this.makeStateFramebuffer(this.positionTextures[0], this.velocityTextures[0]),
      this.makeStateFramebuffer(this.positionTextures[1], this.velocityTextures[1]),
    ];
    this.targets = null;
    this.reset('dam');
    this.resize();
  }

  makeStateTexture() {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, WATER.particleTextureSize, WATER.particleTextureSize, 0, gl.RGBA, gl.FLOAT, null);
    return texture;
  }

  makeStateFramebuffer(positionTexture, velocityTexture) {
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, positionTexture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, velocityTexture, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Persistent marker framebuffer is incomplete.');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return framebuffer;
  }

  makeColorTexture(width, height) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    const filter = floatLinear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, width, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
    return texture;
  }

  makeRenderTarget(texture, withDepth = false) {
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    let depth = null;
    if (withDepth) {
      depth = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, canvas.width, canvas.height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    }
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      throw new Error('Water render target is incomplete.');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { framebuffer, depth, texture };
  }

  disposeTargets() {
    if (!this.targets) return;
    for (const key of ['depthRaw', 'depthA', 'depthB', 'thicknessRaw', 'thicknessA', 'thicknessB']) {
      gl.deleteTexture(this.targets[key]);
    }
    for (const key of ['depthTarget', 'depthATarget', 'depthBTarget', 'thicknessTarget', 'thicknessATarget', 'thicknessBTarget']) {
      gl.deleteFramebuffer(this.targets[key].framebuffer);
      if (this.targets[key].depth) gl.deleteRenderbuffer(this.targets[key].depth);
    }
    this.targets = null;
  }

  resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(640, Math.floor(rect.width * dpr));
    const height = Math.max(420, Math.floor(rect.height * dpr));
    if (canvas.width === width && canvas.height === height && this.targets) return;
    canvas.width = width;
    canvas.height = height;
    this.camera.aspect = width / Math.max(1, height);
    this.disposeTargets();
    const depthRaw = this.makeColorTexture(width, height);
    const depthA = this.makeColorTexture(width, height);
    const depthB = this.makeColorTexture(width, height);
    const thicknessRaw = this.makeColorTexture(width, height);
    const thicknessA = this.makeColorTexture(width, height);
    const thicknessB = this.makeColorTexture(width, height);
    this.targets = {
      depthRaw, depthA, depthB, thicknessRaw, thicknessA, thicknessB,
      depthTarget: this.makeRenderTarget(depthRaw, true),
      depthATarget: this.makeRenderTarget(depthA),
      depthBTarget: this.makeRenderTarget(depthB),
      thicknessTarget: this.makeRenderTarget(thicknessRaw),
      thicknessATarget: this.makeRenderTarget(thicknessA),
      thicknessBTarget: this.makeRenderTarget(thicknessB),
    };
  }

  seed(mode) {
    const positions = new Float32Array(WATER.particleTextureSize * WATER.particleTextureSize * 4);
    const velocities = new Float32Array(positions.length);
    const nx = 16;
    const nz = 16;
    const ny = 6;
    const dam = mode === 'dam';
    const level = dam ? 0.58 : 0.27;
    const width = dam ? 0.42 : 0.92;
    let index = 0;
    for (let y = 0; y < ny && index < WATER.particleCount; y++) {
      for (let z = 0; z < nz && index < WATER.particleCount; z++) {
        for (let x = 0; x < nx && index < WATER.particleCount; x++) {
          const jitterA = (((index * 17) % 31) / 31 - 0.5) * 0.003;
          const jitterB = (((index * 23) % 29) / 29 - 0.5) * 0.003;
          const xBase = dam ? (x + 0.5) / nx * width : 0.04 + (x + 0.5) / nx * 0.92;
          positions[index * 4] = Math.max(0.02, Math.min(0.98, xBase + jitterA));
          positions[index * 4 + 1] = Math.max(0.025, Math.min(0.96, (y + 0.5) / ny * level + jitterB));
          positions[index * 4 + 2] = Math.max(0.02, Math.min(0.98, (z + 0.5) / nz + jitterA));
          positions[index * 4 + 3] = 1;
          if (dam && x >= nx - 2) {
            velocities[index * 4] = 1.55 + (index % 5) * 0.07;
            velocities[index * 4 + 1] = 0.08 + (index % 3) * 0.035;
          }
          index++;
        }
      }
    }
    for (const texture of this.positionTextures) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, WATER.particleTextureSize, WATER.particleTextureSize, 0, gl.RGBA, gl.FLOAT, positions);
    }
    for (const texture of this.velocityTextures) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, WATER.particleTextureSize, WATER.particleTextureSize, 0, gl.RGBA, gl.FLOAT, velocities);
    }
    WATER.mode = mode;
    WATER.time = 0;
    this.current = 0;
    this.splash = null;
    this.updateStatus(mode === 'dam' ? 'DAM BREAK READY' : 'CALM POOL READY');
  }

  reset(mode = WATER.mode) {
    this.seed(mode);
  }

  bindTexture(unit, texture, location) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    if (location !== null && location !== undefined) gl.uniform1i(location, unit);
  }

  setParticleUniforms(entry) {
    const u = entry.uniforms;
    set1i(u, 'uTextureSize', WATER.particleTextureSize);
    set1i(u, 'uCount', WATER.particleCount);
    set3f(u, 'uBoxMin', BOX_MIN);
    set3f(u, 'uBoxMax', BOX_MAX);
    set3f(u, 'uCameraPosition', this.camera.position);
    set3f(u, 'uCameraForward', this.camera.forward);
    set3f(u, 'uCameraRight', this.camera.right);
    set3f(u, 'uCameraUp', this.camera.up);
    set1f(u, 'uTanHalfFov', Math.tan(this.camera.fov * 0.5));
    set1f(u, 'uAspect', this.camera.aspect);
    set2f(u, 'uViewport', canvas.width, canvas.height);
    set1f(u, 'uSplatRadius', 0.105);
    set1f(u, 'uNear', NEAR);
    set1f(u, 'uFar', FAR);
  }

  currentObstacle() {
    if (!WATER.obstacle) return { position: [0.56, 0.22, 0.52], velocity: [0, 0, 0] };
    const old = [...this.obstaclePosition];
    const phase = WATER.time * 0.85;
    const position = [0.56 + Math.sin(phase) * 0.18, 0.26, 0.52 + Math.sin(phase * 0.62) * 0.07];
    const velocity = [(position[0] - old[0]) / 0.016, 0, (position[2] - old[2]) / 0.016];
    this.obstaclePosition = position;
    this.obstacleVelocity = velocity;
    return { position, velocity };
  }

  step(dt) {
    const read = this.current;
    const write = 1 - read;
    const entry = this.pipelines.update;
    const obstacle = this.currentObstacle();
    gl.useProgram(entry.handle);
    this.bindTexture(0, this.positionTextures[read], entry.uniforms.uPosition);
    this.bindTexture(1, this.velocityTextures[read], entry.uniforms.uVelocity);
    const u = entry.uniforms;
    set1i(u, 'uTextureSize', WATER.particleTextureSize);
    set1i(u, 'uCount', WATER.particleCount);
    set1f(u, 'uDt', dt);
    set1f(u, 'uGravity', WATER.gravity);
    set1f(u, 'uViscosity', WATER.viscosity);
    set1f(u, 'uTension', WATER.tension);
    set1f(u, 'uRestDensity', 2.1);
    set1f(u, 'uKernelRadius', 0.092);
    set1i(u, 'uObstacleEnabled', WATER.obstacle ? 1 : 0);
    set3f(u, 'uObstaclePosition', obstacle.position);
    set3f(u, 'uObstacleVelocity', obstacle.velocity);
    set1f(u, 'uObstacleRadius', 0.16);
    set3f(u, 'uSplashPosition', this.splash?.position || [0.5, 0.28, 0.5]);
    set1f(u, 'uSplashAge', this.splash?.age ?? 99);
    set1f(u, 'uSplashImpulse', this.splash?.impulse ?? 0);
    set1f(u, 'uFoamGain', WATER.foam);
    set1f(u, 'uTime', WATER.time);
    gl.bindVertexArray(this.fullscreenVAO);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.stateFbos[write]);
    gl.viewport(0, 0, WATER.particleTextureSize, WATER.particleTextureSize);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.current = write;
    if (this.splash) {
      this.splash.age += dt;
      if (this.splash.age > 2.5) this.splash = null;
    }
  }

  blur(source, targetA, targetB, depthMode) {
    const entry = this.pipelines.blur;
    gl.useProgram(entry.handle);
    gl.bindVertexArray(this.fullscreenVAO);
    gl.disable(gl.BLEND);
    let sourceTexture = source;
    for (let pass = 0; pass < 2; pass++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetA.framebuffer);
      gl.viewport(0, 0, canvas.width, canvas.height);
      this.bindTexture(0, sourceTexture, entry.uniforms.uSource);
      set2f(entry.uniforms, 'uDirection', 1 / canvas.width, 0);
      set1i(entry.uniforms, 'uDepthMode', depthMode);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, targetB.framebuffer);
      this.bindTexture(0, targetA.texture, entry.uniforms.uSource);
      set2f(entry.uniforms, 'uDirection', 0, 1 / canvas.height);
      set1i(entry.uniforms, 'uDepthMode', depthMode);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      sourceTexture = targetB.texture;
    }
    return sourceTexture;
  }

  render() {
    this.resize();
    const targets = this.targets;
    const read = this.current;
    const obstacle = this.currentObstacle();
    gl.bindVertexArray(this.pointsVAO);

    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.depthTarget.framebuffer);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(20, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.BLEND);
    const depth = this.pipelines.depth;
    gl.useProgram(depth.handle);
    this.bindTexture(0, this.positionTextures[read], depth.uniforms.uPosition);
    this.bindTexture(1, this.velocityTextures[read], depth.uniforms.uVelocity);
    this.setParticleUniforms(depth);
    gl.drawArrays(gl.POINTS, 0, WATER.particleCount);

    gl.bindFramebuffer(gl.FRAMEBUFFER, targets.thicknessTarget.framebuffer);
    gl.disable(gl.DEPTH_TEST);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    const thickness = this.pipelines.thickness;
    gl.useProgram(thickness.handle);
    this.bindTexture(0, this.positionTextures[read], thickness.uniforms.uPosition);
    this.bindTexture(1, this.velocityTextures[read], thickness.uniforms.uVelocity);
    this.setParticleUniforms(thickness);
    gl.drawArrays(gl.POINTS, 0, WATER.particleCount);
    gl.disable(gl.BLEND);

    const smoothedDepth = this.blur(targets.depthRaw, targets.depthATarget, targets.depthBTarget, 1);
    const smoothedThickness = this.blur(targets.thicknessRaw, targets.thicknessATarget, targets.thicknessBTarget, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.disable(gl.DEPTH_TEST);
    const composite = this.pipelines.composite;
    gl.useProgram(composite.handle);
    this.bindTexture(0, smoothedDepth, composite.uniforms.uDepth);
    this.bindTexture(1, smoothedThickness, composite.uniforms.uThickness);
    const u = composite.uniforms;
    set3f(u, 'uCameraPosition', this.camera.position);
    set3f(u, 'uCameraForward', this.camera.forward);
    set3f(u, 'uCameraRight', this.camera.right);
    set3f(u, 'uCameraUp', this.camera.up);
    set1f(u, 'uTanHalfFov', Math.tan(this.camera.fov * 0.5));
    set1f(u, 'uAspect', this.camera.aspect);
    set2f(u, 'uViewport', canvas.width, canvas.height);
    set3f(u, 'uBoxMin', BOX_MIN);
    set3f(u, 'uBoxMax', BOX_MAX);
    set3f(u, 'uSunDirection', [0.38, 0.78, 0.32]);
    set3f(u, 'uWaterTint', [0.016, 0.12, 0.28]);
    set1f(u, 'uAbsorption', WATER.absorption);
    set1f(u, 'uRoughness', WATER.roughness);
    set1f(u, 'uRefraction', 0.80);
    set1f(u, 'uFoam', WATER.foam);
    set1f(u, 'uTime', WATER.time);
    set1i(u, 'uObstacleEnabled', WATER.obstacle ? 1 : 0);
    set3f(u, 'uObstaclePosition', obstacle.position);
    set1f(u, 'uObstacleRadius', 0.16);
    gl.bindVertexArray(this.fullscreenVAO);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  splashAt(position, impulse = 1.7) {
    this.splash = { position, impulse, age: 0 };
    this.updateStatus('PARTICLE IMPULSE');
  }

  updateStatus(message) {
    const el = document.getElementById('status-readout');
    if (el) el.textContent = message;
  }

  frame(now) {
    const rawDt = Math.min(0.032, Math.max(0.001, (now - this.lastTime) * 0.001));
    this.lastTime = now;
    if (!WATER.paused) {
      WATER.time += rawDt;
      this.step(rawDt);
    }
    this.render();
    this.fpsTime += rawDt;
    this.fpsFrames++;
    if (this.fpsTime > 0.35) {
      const fps = Math.round(this.fpsFrames / this.fpsTime);
      document.getElementById('fps-readout').textContent = String(fps);
      this.fpsTime = 0;
      this.fpsFrames = 0;
    }
    requestAnimationFrame((next) => this.frame(next));
  }

  destroy() {
    this.disposeTargets();
    this.positionTextures.forEach((texture) => gl.deleteTexture(texture));
    this.velocityTextures.forEach((texture) => gl.deleteTexture(texture));
    this.stateFbos.forEach((framebuffer) => gl.deleteFramebuffer(framebuffer));
    Object.values(this.pipelines).forEach((entry) => gl.deleteProgram(entry.handle));
    gl.deleteVertexArray(this.fullscreenVAO);
    gl.deleteVertexArray(this.pointsVAO);
  }
}

let lab;
try {
  lab = new WaterSurfaceLab();
} catch (error) {
  showError(error);
  throw error;
}

function waterPointFromPointer(event) {
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = 1 - ((event.clientY - rect.top) / rect.height) * 2;
  const ray = lab.camera.ray(ndcX, ndcY);
  const floor = BOX_MIN[1] + 0.08;
  const t = Math.abs(ray.direction[1]) > 0.0001 ? (floor - ray.origin[1]) / ray.direction[1] : 1.4;
  const x = ray.origin[0] + ray.direction[0] * Math.max(0.2, t);
  const y = ray.origin[1] + ray.direction[1] * Math.max(0.2, t);
  const z = ray.origin[2] + ray.direction[2] * Math.max(0.2, t);
  return [
    Math.max(0.03, Math.min(0.97, (x - BOX_MIN[0]) / (BOX_MAX[0] - BOX_MIN[0]))),
    Math.max(0.04, Math.min(0.62, (y - BOX_MIN[1]) / (BOX_MAX[1] - BOX_MIN[1]))),
    Math.max(0.03, Math.min(0.97, (z - BOX_MIN[2]) / (BOX_MAX[2] - BOX_MIN[2]))),
  ];
}

let dragging = false;
let lastPointer = [0, 0];
let downPointer = [0, 0];
canvas.addEventListener('pointerdown', (event) => {
  dragging = true;
  lastPointer = [event.clientX, event.clientY];
  downPointer = [event.clientX, event.clientY];
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  const dx = event.clientX - lastPointer[0];
  const dy = event.clientY - lastPointer[1];
  lastPointer = [event.clientX, event.clientY];
  if (event.buttons & 1) {
    lab.camera.yaw -= dx * 0.006;
    lab.camera.pitch = Math.max(0.10, Math.min(1.38, lab.camera.pitch + dy * 0.006));
    lab.camera.update();
  }
});
canvas.addEventListener('pointerup', (event) => {
  const clickDistance = Math.hypot(event.clientX - downPointer[0], event.clientY - downPointer[1]);
  if (dragging && clickDistance < 5) lab.splashAt(waterPointFromPointer(event), 1.7);
  dragging = false;
  canvas.releasePointerCapture(event.pointerId);
});
canvas.addEventListener('pointercancel', () => { dragging = false; });
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  lab.camera.distance = Math.max(2.1, Math.min(8.5, lab.camera.distance * (1 + event.deltaY * 0.001)));
  lab.camera.update();
}, { passive: false });

window.addEventListener('resize', () => lab.resize());
document.getElementById('dam-button').addEventListener('click', () => lab.reset('dam'));
document.getElementById('pool-button').addEventListener('click', () => lab.reset('pool'));
document.getElementById('splash-button').addEventListener('click', () => lab.splashAt([0.58, 0.28, 0.50], 2.2));
document.getElementById('obstacle-button').addEventListener('click', (event) => {
  WATER.obstacle = !WATER.obstacle;
  event.currentTarget.textContent = `SPHERE: ${WATER.obstacle ? 'ON' : 'OFF'}`;
  event.currentTarget.classList.toggle('active', WATER.obstacle);
});
document.getElementById('pause-button').addEventListener('click', (event) => {
  WATER.paused = !WATER.paused;
  event.currentTarget.textContent = WATER.paused ? 'RESUME' : 'PAUSE';
  lab.updateStatus(WATER.paused ? 'PAUSED' : 'RUNNING');
});
document.getElementById('reset-view-button').addEventListener('click', () => lab.camera.reset());

function connectSlider(id, key, output, digits = 2) {
  const input = document.getElementById(id);
  const label = document.getElementById(output);
  input.addEventListener('input', () => {
    WATER[key] = Number(input.value);
    label.textContent = WATER[key].toFixed(digits);
  });
}
connectSlider('gravity', 'gravity', 'gravity-value', 1);
connectSlider('viscosity', 'viscosity', 'viscosity-value');
connectSlider('tension', 'tension', 'tension-value');
connectSlider('foam', 'foam', 'foam-value');
connectSlider('absorption', 'absorption', 'absorption-value');
connectSlider('roughness', 'roughness', 'roughness-value');

document.getElementById('marker-readout').textContent = WATER.particleCount.toLocaleString();
requestAnimationFrame((now) => lab.frame(now));
