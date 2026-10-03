/*
 * Standalone Water Surface Lab.
 *
 * This is a new water-only application. It does not import the Frontier app,
 * its Pyro engine, or its particle renderer. The liquid state is an Eulerian
 * shallow-water momentum/depth grid; the visible water is a continuous indexed
 * surface mesh, not a cloud of marker points.
 */

const canvas = document.getElementById('water-canvas');
const errorPanel = document.getElementById('error-panel');
const GRID_W = 192;
const GRID_H = 128;
const GRID_CELLS = GRID_W * GRID_H;
const MARKER_COUNT = 1536;
const BOX_MIN = [-1.55, -0.72, -1.15];
const BOX_MAX = [1.55, 1.05, 1.15];
const WATER_HEIGHT = 1.42;
const NEAR = 0.05;
const FAR = 20.0;

const WATER = {
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

function showError(error) {
  errorPanel.hidden = false;
  errorPanel.textContent = `Standalone water surface failed to start.\n\n${error?.message || error}`;
  console.error(error);
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
} catch (error) {
  showError(error);
  throw error;
}

const floatColorBuffer = !!gl.getExtension('EXT_color_buffer_float');
const floatLinear = floatColorBuffer && !!gl.getExtension('OES_texture_float_linear');

const FULLSCREEN_VERTEX = `#version 300 es
precision highp float;
out vec2 vUV;
void main() {
  vec2 p = gl_VertexID == 1 ? vec2(3.0, -1.0) : (gl_VertexID == 2 ? vec2(-1.0, 3.0) : vec2(-1.0, -1.0));
  gl_Position = vec4(p, 0.0, 1.0);
  vUV = p * 0.5 + 0.5;
}`;

const MARKER_UPDATE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uMarkerPosition;
uniform sampler2D uMarkerVelocity;
uniform sampler2D uWaterState;
uniform float uMarkerCount;
uniform vec2 uGrid;
uniform float uDt;
uniform float uGravity;
uniform float uTime;
uniform int uPackedState;

layout(location = 0) out vec4 nextPosition;
layout(location = 1) out vec4 nextVelocity;

vec4 decodeGrid(vec4 value) {
  if (uPackedState == 1) value.yz = value.yz * 8.0 - 4.0;
  return value;
}

void main() {
  int marker = int(gl_FragCoord.x - 0.5);
  vec4 position = texelFetch(uMarkerPosition, ivec2(marker, 0), 0);
  vec3 velocity = texelFetch(uMarkerVelocity, ivec2(marker, 0), 0).xyz * 2.0 - 1.0;
  vec2 horizontal = clamp(position.xz, vec2(0.006), vec2(0.994));
  vec4 water = decodeGrid(texture(uWaterState, horizontal));
  float localHeight = clamp(water.r, 0.006, 0.96);
  vec2 gridVelocity = clamp(water.gb, vec2(-3.0), vec2(3.0));
  float seed = position.a;
  float phase = seed * 31.0 + float(marker) * 0.071 + uTime * 0.7;

  // Lagrangian markers are persistent GPU volume tracers. Their horizontal
  // motion follows the grid, while their depth layer stays distributed below
  // the evolving free surface instead of becoming visible point sprites.
  velocity.xz += (gridVelocity * 0.22 - velocity.xz) * min(1.0, uDt * 2.1);
  float layer = 0.08 + 0.78 * fract(seed * 17.0 + 0.17);
  float targetDepth = max(0.008, localHeight * layer);
  velocity.y += (targetDepth - position.y) * (3.2 + 0.35 * sin(phase)) * uDt;
  velocity.y -= uGravity * 0.012 * uDt;
  velocity *= exp(-uDt * vec3(1.8, 2.4, 1.8));
  position.xyz += velocity * uDt * vec3(0.16, 0.10, 0.16);

  if (position.x < 0.008 || position.x > 0.992) { position.x = clamp(position.x, 0.008, 0.992); velocity.x *= -0.42; }
  if (position.z < 0.008 || position.z > 0.992) { position.z = clamp(position.z, 0.008, 0.992); velocity.z *= -0.42; }
  if (position.y < 0.006) { position.y = 0.006; velocity.y = abs(velocity.y) * 0.24; }
  if (position.y > localHeight + 0.045) { position.y = localHeight + 0.045; velocity.y *= -0.28; }
  position.y = clamp(position.y, 0.006, 0.995);
  velocity = clamp(velocity, vec3(-1.0), vec3(1.0));
  nextPosition = vec4(position.x, position.y, position.z, seed);
  nextVelocity = vec4(velocity * 0.5 + 0.5, 1.0);
}`;

const MARKER_FIELD_VERTEX = `#version 300 es
precision highp float;
uniform sampler2D uMarkerPosition;
uniform float uMarkerCount;
out float markerDepth;
void main() {
  int marker = gl_VertexID;
  vec4 position = texelFetch(uMarkerPosition, ivec2(marker, 0), 0);
  gl_Position = vec4(position.x * 2.0 - 1.0, position.z * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = 4.6;
  markerDepth = position.y;
}`;

const MARKER_FIELD_FRAGMENT = `#version 300 es
precision highp float;
in float markerDepth;
layout(location = 0) out vec4 outField;
void main() {
  vec2 point = gl_PointCoord * 2.0 - 1.0;
  float disc = smoothstep(1.0, 0.22, length(point));
  float amount = disc * 0.18;
  // This off-screen splat is the marker-to-surface reconstruction signal;
  // it is never drawn directly to the user's canvas as a particle.
  outField = vec4(amount, amount * markerDepth, amount * markerDepth * markerDepth, amount);
}`;

const GRID_UPDATE_FRAGMENT = `#version 300 es
precision highp float;
precision highp int;

uniform sampler2D uState;
uniform sampler2D uMarkerField;
uniform vec2 uGrid;
uniform float uDt;
uniform float uGravity;
uniform float uViscosity;
uniform float uTension;
uniform float uFoamGain;
uniform float uTime;
uniform int uPackedState;
uniform int uObstacleEnabled;
uniform vec2 uObstaclePosition;
uniform float uObstacleRadius;
uniform vec2 uSplashPosition;
uniform float uSplashAge;
uniform float uSplashImpulse;

layout(location = 0) out vec4 nextState;

vec4 decodeState(vec4 value) {
  if (uPackedState == 1) {
    value.yz = value.yz * 8.0 - 4.0;
  }
  return value;
}

vec4 stateAt(ivec2 cell) {
  return decodeState(texelFetch(uState, clamp(cell, ivec2(0), ivec2(uGrid) - 1), 0));
}

vec4 stateUV(vec2 uv) {
  return decodeState(texture(uState, clamp(uv, vec2(0.0), vec2(1.0))));
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  vec2 uv = (vec2(cell) + 0.5) / uGrid;
  vec4 markerField = texture(uMarkerField, uv);
  float markerCoverage = clamp(markerField.r, 0.0, 1.0);
  vec4 center = stateAt(cell);
  vec4 left = stateAt(cell + ivec2(-1, 0));
  vec4 right = stateAt(cell + ivec2(1, 0));
  vec4 back = stateAt(cell + ivec2(0, -1));
  vec4 front = stateAt(cell + ivec2(0, 1));

  float h = max(center.r, markerCoverage * 0.14);
  vec2 velocity = center.yz;
  vec2 gradient = vec2(right.r - left.r, front.r - back.r) * 0.5;
  vec2 lapVelocity = (left.yz + right.yz + back.yz + front.yz - velocity * 4.0);
  float divergence = (right.g - left.g + front.b - back.b) * 0.5;

  // Finite-volume-style shallow-water update. Height and horizontal momentum
  // stay in the grid, so a dam front spreads as a continuous liquid body.
  velocity -= gradient * uGravity * uDt * 0.24;
  velocity += lapVelocity * (0.08 + uViscosity * 0.42) * uDt * 22.0;
  velocity *= exp(-uViscosity * uDt * 3.0);
  float advectiveHeight = dot(velocity, gradient) * uDt * 0.18;
  h -= advectiveHeight + h * divergence * uDt * 0.06;
  h += (right.r + left.r + front.r + back.r - h * 4.0) * uTension * uDt * 0.035;

  // A low-amplitude travelling disturbance keeps a pool alive, while all
  // motion still comes from the evolving grid state and momentum.
  float wavePhase = uv.x * 7.0 + uv.y * 3.4 + uTime * 0.85;
  float surfaceBand = smoothstep(0.015, 0.11, h);
  velocity += vec2(cos(wavePhase), sin(wavePhase * 0.73)) * 0.015 * surfaceBand * uDt;

  if (uSplashImpulse > 0.001 && uSplashAge < 2.4) {
    vec2 delta = uv - uSplashPosition;
    float distanceToSplash = length(delta);
    float radius = 0.025 + uSplashAge * 0.24;
    float ring = exp(-pow((distanceToSplash - radius) * 22.0, 2.0));
    float core = exp(-distanceToSplash * distanceToSplash * 260.0);
    float fade = exp(-uSplashAge * 1.7) * uSplashImpulse;
    vec2 direction = distanceToSplash > 0.001 ? delta / distanceToSplash : vec2(0.0, 1.0);
    velocity += direction * fade * (ring * 0.90 + core * 0.32);
    h += core * fade * 0.012;
  }

  if (uObstacleEnabled == 1) {
    vec2 obstacleDelta = uv - uObstaclePosition;
    float obstacleDistance = length(obstacleDelta);
    float obstacleShell = exp(-abs(obstacleDistance - uObstacleRadius) * 80.0);
    if (obstacleDistance < uObstacleRadius * 1.12) {
      vec2 outward = obstacleDistance > 0.001 ? obstacleDelta / obstacleDistance : vec2(1.0, 0.0);
      velocity += outward * obstacleShell * 0.34 * uDt * 60.0;
      h *= smoothstep(uObstacleRadius * 0.55, uObstacleRadius * 1.08, obstacleDistance);
    }
  }

  // The bed is a closed basin. Side damping is soft, while height is retained
  // so liquid cannot evaporate when a wave leaves the camera view.
  if (uv.x < 0.008 || uv.x > 0.992) velocity.x *= -0.18;
  if (uv.y < 0.008 || uv.y > 0.992) velocity.y *= -0.18;
  velocity = clamp(velocity, vec2(-3.0), vec2(3.0));
  h = clamp(h, 0.0, 0.96);

  float crest = length(gradient) * 10.0 + length(velocity) * 0.05 + abs(divergence) * 2.0;
  float foam = max(center.a * exp(-uDt * 0.56), clamp(crest * uFoamGain, 0.0, 1.0));
  if (uPackedState == 1) {
    nextState = vec4(h, velocity / 8.0 + 0.5, foam);
  } else {
    nextState = vec4(h, velocity, foam);
  }
}`;

const SURFACE_VERTEX = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aUV;
uniform sampler2D uState;
uniform sampler2D uMarkerField;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform float uWaterHeight;
uniform vec3 uCameraPosition;
uniform vec3 uCameraForward;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform float uTanHalfFov;
uniform float uAspect;
uniform float uNear;
uniform float uFar;
uniform int uPackedState;

out vec2 surfaceUV;
out float surfaceHeight;
out float surfaceFoam;

void main() {
  vec4 state = texture(uState, aUV);
  float markerLift = texture(uMarkerField, aUV).r * 0.14;
  float h = max(state.r, markerLift);
  vec3 world = vec3(
    mix(uBoxMin.x, uBoxMax.x, aUV.x),
    uBoxMin.y + h * uWaterHeight,
    mix(uBoxMin.z, uBoxMax.z, aUV.y)
  );
  vec3 view = world - uCameraPosition;
  float depth = max(dot(view, uCameraForward), uNear);
  float ndcX = dot(view, uCameraRight) / (depth * uTanHalfFov * uAspect);
  float ndcY = dot(view, uCameraUp) / (depth * uTanHalfFov);
  float clipZ = (depth - uNear) / max(uFar - uNear, 0.001) * 2.0 - 1.0;
  gl_Position = vec4(ndcX, ndcY, clipZ, 1.0);
  surfaceUV = aUV;
  surfaceHeight = h;
  surfaceFoam = state.a;
}`;

const SURFACE_FRAGMENT = `#version 300 es
precision highp float;
in vec2 surfaceUV;
in float surfaceHeight;
in float surfaceFoam;
layout(location = 0) out vec4 outColor;
uniform sampler2D uState;
uniform sampler2D uMarkerField;
uniform vec2 uGrid;
uniform vec3 uSunDirection;
uniform vec3 uCameraForward;
uniform vec3 uWaterTint;
uniform float uAbsorption;
uniform float uRoughness;
uniform float uRefraction;
uniform float uFoamGain;
uniform float uTime;

vec3 floorColor(vec3 p) {
  vec3 color = vec3(0.012, 0.022, 0.036);
  float gx = 1.0 - smoothstep(0.008, 0.026, abs(fract(p.x * 3.6) - 0.5));
  float gz = 1.0 - smoothstep(0.008, 0.026, abs(fract(p.z * 3.6) - 0.5));
  color += vec3(0.025, 0.08, 0.13) * max(gx, gz);
  return color;
}

void main() {
  if (surfaceHeight < 0.006) discard;
  vec2 cell = 1.0 / uGrid;
  float hL = texture(uState, surfaceUV - vec2(cell.x, 0.0)).r;
  float hR = texture(uState, surfaceUV + vec2(cell.x, 0.0)).r;
  float hB = texture(uState, surfaceUV - vec2(0.0, cell.y)).r;
  float hF = texture(uState, surfaceUV + vec2(0.0, cell.y)).r;
  vec3 normal = normalize(vec3(-(hR - hL) * 3.2, 1.0, -(hF - hB) * 3.2));
  float diffuse = max(0.12, dot(normal, uSunDirection));
  float viewAngle = max(dot(normal, -uCameraForward), 0.0);
  float fresnel = pow(1.0 - viewAngle, 5.0);
  float markerCoverage = texture(uMarkerField, surfaceUV).r;
  float foam = clamp(surfaceFoam * uFoamGain * 1.8 + markerCoverage * 0.06, 0.0, 1.0);
  float absorb = exp(-surfaceHeight * uAbsorption * 0.32);
  vec3 floor = floorColor(vec3(0.0, 0.0, 0.0));
  vec3 body = uWaterTint * (0.30 + diffuse * 0.70);
  vec3 refraction = mix(body, vec3(0.028, 0.22, 0.42), clamp(uRefraction, 0.0, 1.0));
  vec3 reflection = mix(vec3(0.02, 0.06, 0.12), vec3(0.28, 0.68, 0.96), clamp(0.42 + normal.y * 0.55, 0.0, 1.0));
  float gloss = pow(max(dot(reflect(-uSunDirection, normal), -uCameraForward), 0.0), mix(96.0, 20.0, uRoughness));
  vec3 color = refraction * (0.35 + diffuse * 0.65)
             + reflection * fresnel * (0.24 + 0.70 * uRefraction)
             + vec3(0.72, 0.9, 1.0) * gloss * (0.12 + 0.22 * (1.0 - uRoughness));
  vec3 foamColor = mix(vec3(0.42, 0.72, 0.88), vec3(0.96, 1.0, 1.0), diffuse);
  color = mix(color, foamColor, foam * 0.78);
  float caustic = (0.5 + 0.5 * sin(surfaceUV.x * 36.0 + uTime * 0.4))
                * (0.5 + 0.5 * sin(surfaceUV.y * 44.0 - uTime * 0.28));
  color += vec3(0.018, 0.06, 0.10) * caustic * (1.0 - foam);
  color = color * (1.0 - absorb) + floor * absorb * 0.15;
  outColor = vec4(pow(clamp(color, vec3(0.0), vec3(1.0)), vec3(1.0 / 2.2)), 1.0);
}`;

const FLOOR_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aUV;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uCameraPosition;
uniform vec3 uCameraForward;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform float uTanHalfFov;
uniform float uAspect;
uniform float uNear;
uniform float uFar;
out vec2 floorUV;
void main() {
  vec3 world = vec3(mix(uBoxMin.x, uBoxMax.x, aUV.x), uBoxMin.y, mix(uBoxMin.z, uBoxMax.z, aUV.y));
  vec3 view = world - uCameraPosition;
  float depth = max(dot(view, uCameraForward), uNear);
  float x = dot(view, uCameraRight) / (depth * uTanHalfFov * uAspect);
  float y = dot(view, uCameraUp) / (depth * uTanHalfFov);
  float z = (depth - uNear) / max(uFar - uNear, 0.001) * 2.0 - 1.0;
  gl_Position = vec4(x, y, z, 1.0);
  floorUV = aUV;
}`;

const FLOOR_FRAGMENT = `#version 300 es
precision highp float;
in vec2 floorUV;
layout(location = 0) out vec4 outColor;
uniform float uTime;
void main() {
  float gx = 1.0 - smoothstep(0.01, 0.04, abs(fract(floorUV.x * 16.0) - 0.5));
  float gz = 1.0 - smoothstep(0.01, 0.04, abs(fract(floorUV.y * 12.0) - 0.5));
  vec3 color = vec3(0.012, 0.022, 0.034) + vec3(0.022, 0.07, 0.11) * max(gx, gz);
  outColor = vec4(color, 1.0);
}`;

const OBSTACLE_VERTEX = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec3 uObstaclePosition;
uniform float uObstacleRadius;
uniform vec3 uCameraPosition;
uniform vec3 uCameraForward;
uniform vec3 uCameraRight;
uniform vec3 uCameraUp;
uniform float uTanHalfFov;
uniform float uAspect;
uniform float uNear;
uniform float uFar;
out vec3 obstacleNormal;
void main() {
  vec3 center = mix(uBoxMin, uBoxMax, uObstaclePosition);
  float radius = uObstacleRadius * min(min(uBoxMax.x-uBoxMin.x, uBoxMax.y-uBoxMin.y), uBoxMax.z-uBoxMin.z);
  vec3 world = center + aPosition * radius;
  vec3 view = world - uCameraPosition;
  float depth = max(dot(view, uCameraForward), uNear);
  float x = dot(view, uCameraRight) / (depth * uTanHalfFov * uAspect);
  float y = dot(view, uCameraUp) / (depth * uTanHalfFov);
  float z = (depth - uNear) / max(uFar - uNear, 0.001) * 2.0 - 1.0;
  gl_Position = vec4(x, y, z, 1.0);
  obstacleNormal = normalize(aPosition);
}`;

const OBSTACLE_FRAGMENT = `#version 300 es
precision highp float;
in vec3 obstacleNormal;
layout(location = 0) out vec4 outColor;
uniform vec3 uSunDirection;
void main() {
  float light = 0.22 + 0.78 * max(dot(normalize(obstacleNormal), uSunDirection), 0.0);
  vec3 color = vec3(0.24, 0.29, 0.34) * light + vec3(0.10, 0.16, 0.22) * pow(1.0 - max(dot(normalize(obstacleNormal), vec3(0.0, 0.0, 1.0)), 0.0), 3.0);
  outColor = vec4(color, 1.0);
}`;

class OrbitCamera {
  constructor() {
    this.yaw = 0.68;
    this.pitch = 0.64;
    this.distance = 4.3;
    this.target = [0, -0.05, 0];
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
    this.position = [this.target[0] + this.distance * cp * sy, this.target[1] + this.distance * sp, this.target[2] + this.distance * cp * cy];
    const f = [this.target[0]-this.position[0], this.target[1]-this.position[1], this.target[2]-this.position[2]];
    const fl = Math.hypot(...f) || 1;
    this.forward = f.map((value) => value / fl);
    const r = [-this.forward[2], 0, this.forward[0]];
    const rl = Math.hypot(...r) || 1;
    this.right = r.map((value) => value / rl);
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
    this.target = [0, -0.05, 0];
    this.update();
  }

  ray(ndcX, ndcY) {
    const t = Math.tan(this.fov * 0.5);
    const r = [this.forward[0] + ndcX * this.aspect * t * this.right[0] + ndcY * t * this.up[0], this.forward[1] + ndcX * this.aspect * t * this.right[1] + ndcY * t * this.up[1], this.forward[2] + ndcX * this.aspect * t * this.right[2] + ndcY * t * this.up[2]];
    const l = Math.hypot(...r) || 1;
    return { origin: [...this.position], direction: r.map((value) => value / l) };
  }
}

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`GLSL compile error:\n${log}`);
  }
  return shader;
}

function makeProgram(vertexSource, fragmentSource) {
  const vertex = compile(gl.VERTEX_SHADER, vertexSource);
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource);
  const handle = gl.createProgram();
  gl.attachShader(handle, vertex);
  gl.attachShader(handle, fragment);
  gl.linkProgram(handle);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(handle, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(handle);
    gl.deleteProgram(handle);
    throw new Error(`GLSL link error:\n${log}`);
  }
  const uniforms = {};
  for (let i = 0; i < gl.getProgramParameter(handle, gl.ACTIVE_UNIFORMS); i++) {
    const info = gl.getActiveUniform(handle, i);
    uniforms[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(handle, info.name.replace(/\[0\]$/, ''));
  }
  return { handle, uniforms };
}

function set1f(u, name, value) { if (u[name] !== null && u[name] !== undefined) gl.uniform1f(u[name], value); }
function set1i(u, name, value) { if (u[name] !== null && u[name] !== undefined) gl.uniform1i(u[name], value); }
function set2f(u, name, x, y) { if (u[name] !== null && u[name] !== undefined) gl.uniform2f(u[name], x, y); }
function set3f(u, name, value) { if (u[name] !== null && u[name] !== undefined) gl.uniform3fv(u[name], value); }

class WaterGridApp {
  constructor() {
    this.camera = new OrbitCamera();
    this.camera.aspect = 1;
    this.fullscreenVAO = gl.createVertexArray();
    this.meshVAO = gl.createVertexArray();
    this.meshIndexCount = 0;
    this.stateTextures = [this.makeStateTexture(), this.makeStateTexture()];
    this.stateFbos = [this.makeStateFbo(this.stateTextures[0]), this.makeStateFbo(this.stateTextures[1])];
    this.markerPositionTextures = [this.makeMarkerTexture(), this.makeMarkerTexture()];
    this.markerVelocityTextures = [this.makeMarkerTexture(), this.makeMarkerTexture()];
    this.markerFbos = [
      this.makeMarkerFbo(this.markerPositionTextures[0], this.markerVelocityTextures[0]),
      this.makeMarkerFbo(this.markerPositionTextures[1], this.markerVelocityTextures[1]),
    ];
    this.markerFieldTexture = this.makeMarkerFieldTexture();
    this.markerFieldFbo = this.makeMarkerFieldFbo(this.markerFieldTexture);
    this.current = 0;
    this.markerCurrent = 0;
    this.splash = null;
    this.lastTime = performance.now();
    this.fpsTime = 0;
    this.fpsFrames = 0;
    this.obstaclePosition = [0.56, 0.24, 0.52];
    this.programs = {
      markerUpdate: makeProgram(FULLSCREEN_VERTEX, MARKER_UPDATE_FRAGMENT),
      markerField: makeProgram(MARKER_FIELD_VERTEX, MARKER_FIELD_FRAGMENT),
      update: makeProgram(FULLSCREEN_VERTEX, GRID_UPDATE_FRAGMENT),
      surface: makeProgram(SURFACE_VERTEX, SURFACE_FRAGMENT),
      floor: makeProgram(FLOOR_VERTEX, FLOOR_FRAGMENT),
      obstacle: makeProgram(OBSTACLE_VERTEX, OBSTACLE_FRAGMENT),
    };
    this.makeGridMesh();
    this.makeObstacleMesh();
    this.resize();
    this.reset('dam');
  }

  makeStateTexture() {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, floatLinear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, floatLinear ? gl.LINEAR : gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const internal = floatColorBuffer ? gl.RGBA32F : gl.RGBA8;
    const type = floatColorBuffer ? gl.FLOAT : gl.UNSIGNED_BYTE;
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, GRID_W, GRID_H, 0, gl.RGBA, type, null);
    return texture;
  }

  makeStateFbo(texture) {
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Water grid framebuffer is incomplete.');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return framebuffer;
  }

  makeMarkerTexture() {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, MARKER_COUNT, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return texture;
  }

  makeMarkerFbo(positionTexture, velocityTexture) {
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, positionTexture, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, velocityTexture, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Water marker framebuffer is incomplete.');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return framebuffer;
  }

  makeMarkerFieldTexture() {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, GRID_W, GRID_H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    return texture;
  }

  makeMarkerFieldFbo(texture) {
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Marker reconstruction framebuffer is incomplete.');
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return framebuffer;
  }

  makeGridMesh() {
    const vertices = [];
    const indices = [];
    for (let y = 0; y <= GRID_H; y++) {
      for (let x = 0; x <= GRID_W; x++) vertices.push(x / GRID_W, y / GRID_H);
    }
    const stride = GRID_W + 1;
    for (let y = 0; y < GRID_H; y++) {
      for (let x = 0; x < GRID_W; x++) {
        const a = y * stride + x;
        const b = a + 1;
        const c = a + stride;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    this.meshIndexCount = indices.length;
    gl.bindVertexArray(this.meshVAO);
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  makeObstacleMesh() {
    const vertices = [];
    const indices = [];
    const rows = 18;
    const columns = 28;
    for (let y = 0; y <= rows; y++) {
      const v = y / rows;
      const phi = v * Math.PI;
      for (let x = 0; x <= columns; x++) {
        const u = x / columns;
        const theta = u * Math.PI * 2;
        vertices.push(Math.sin(phi) * Math.cos(theta), Math.cos(phi), Math.sin(phi) * Math.sin(theta));
      }
    }
    const stride = columns + 1;
    for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
      const a = y * stride + x; const b = a + 1; const c = a + stride; const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
    this.obstacleIndexCount = indices.length;
    this.obstacleVAO = gl.createVertexArray();
    gl.bindVertexArray(this.obstacleVAO);
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    const indexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(indices), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
  }

  uploadState(state) {
    const internal = floatColorBuffer ? gl.RGBA32F : gl.RGBA8;
    const type = floatColorBuffer ? gl.FLOAT : gl.UNSIGNED_BYTE;
    const upload = floatColorBuffer ? state : Uint8Array.from(state, (value, index) => {
      const channel = index % 4;
      if (channel === 0 || channel === 3) return Math.round(Math.max(0, Math.min(1, value)) * 255);
      return Math.round(Math.max(0, Math.min(1, value / 8 + 0.5)) * 255);
    });
    for (const texture of this.stateTextures) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, internal, GRID_W, GRID_H, 0, gl.RGBA, type, upload);
    }
  }

  uploadMarkerState(position, velocity) {
    for (const texture of this.markerPositionTextures) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, MARKER_COUNT, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, position);
    }
    for (const texture of this.markerVelocityTextures) {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, MARKER_COUNT, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, velocity);
    }
  }

  resetMarkers(mode) {
    const position = new Uint8Array(MARKER_COUNT * 4);
    const velocity = new Uint8Array(MARKER_COUNT * 4);
    const sample = (value) => {
      const n = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
      return n - Math.floor(n);
    };
    const dam = mode === 'dam';
    for (let index = 0; index < MARKER_COUNT; index++) {
      const x = dam ? 0.045 + sample(index + 1.1) * 0.275 : 0.045 + sample(index + 1.1) * 0.91;
      const z = 0.045 + sample(index + 7.7) * 0.91;
      const y = dam ? 0.025 + sample(index + 14.3) * 0.69 : 0.018 + sample(index + 14.3) * 0.22;
      const offset = index * 4;
      position[offset] = Math.round(x * 255);
      position[offset + 1] = Math.round(y * 255);
      position[offset + 2] = Math.round(z * 255);
      position[offset + 3] = Math.round(sample(index + 23.9) * 255);
      velocity[offset] = 128;
      velocity[offset + 1] = 128;
      velocity[offset + 2] = 128;
      velocity[offset + 3] = 255;
    }
    this.uploadMarkerState(position, velocity);
    this.markerCurrent = 0;
  }

  reset(mode) {
    const state = new Float32Array(GRID_CELLS * 4);
    const dam = mode === 'dam';
    for (let y = 0; y < GRID_H; y++) for (let x = 0; x < GRID_W; x++) {
      const index = (y * GRID_W + x) * 4;
      const u = (x + 0.5) / GRID_W;
      const v = (y + 0.5) / GRID_H;
      const edge = Math.min(Math.min(u, 1 - u), Math.min(v, 1 - v));
      const pool = dam ? (u < 0.34 ? 0.72 : 0.0) : (edge > 0.018 ? 0.24 : 0.12);
      const ripple = !dam ? Math.sin(u * 38.0) * Math.sin(v * 31.0) * 0.006 : 0;
      state[index] = Math.max(0, pool + ripple);
      state[index + 1] = dam && u > 0.29 && u < 0.35 ? 0.65 : 0;
      state[index + 2] = 0;
      state[index + 3] = 0;
    }
    this.uploadState(state);
    this.resetMarkers(mode);
    this.drawMarkerField();
    WATER.mode = mode;
    WATER.time = 0;
    this.current = 0;
    this.splash = null;
    this.updateStatus(mode === 'dam' ? 'DAM BREAK READY' : 'CALM POOL READY');
  }

  updateStatus(value) { document.getElementById('status-readout').textContent = value; }

  obstacleState() {
    if (!WATER.obstacle) return { position: [0.56, 0.24, 0.52] };
    const phase = WATER.time * 0.72;
    this.obstaclePosition = [0.56 + Math.sin(phase) * 0.17, 0.24, 0.52 + Math.sin(phase * 0.63) * 0.08];
    return { position: this.obstaclePosition };
  }

  updateMarkers(dt) {
    const read = this.markerCurrent;
    const write = 1 - read;
    const pass = this.programs.markerUpdate;
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(pass.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.markerPositionTextures[read]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.markerVelocityTextures[read]);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTextures[this.current]);
    set1i(pass.uniforms, 'uMarkerPosition', 0);
    set1i(pass.uniforms, 'uMarkerVelocity', 1);
    set1i(pass.uniforms, 'uWaterState', 2);
    set1f(pass.uniforms, 'uMarkerCount', MARKER_COUNT);
    set2f(pass.uniforms, 'uGrid', GRID_W, GRID_H);
    set1f(pass.uniforms, 'uDt', dt);
    set1f(pass.uniforms, 'uGravity', WATER.gravity);
    set1f(pass.uniforms, 'uTime', WATER.time);
    set1i(pass.uniforms, 'uPackedState', floatColorBuffer ? 0 : 1);
    gl.bindVertexArray(this.fullscreenVAO);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.markerFbos[write]);
    gl.viewport(0, 0, MARKER_COUNT, 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.markerCurrent = write;
  }

  drawMarkerField() {
    const pass = this.programs.markerField;
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(pass.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.markerPositionTextures[this.markerCurrent]);
    set1i(pass.uniforms, 'uMarkerPosition', 0);
    set1f(pass.uniforms, 'uMarkerCount', MARKER_COUNT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.markerFieldFbo);
    gl.viewport(0, 0, GRID_W, GRID_H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(this.fullscreenVAO);
    gl.drawArrays(gl.POINTS, 0, MARKER_COUNT);
    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  step(dt) {
    const read = this.current;
    const write = 1 - read;
    const pass = this.programs.update;
    const obstacle = this.obstacleState();
    gl.useProgram(pass.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTextures[read]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.markerFieldTexture);
    set1i(pass.uniforms, 'uState', 0);
    set1i(pass.uniforms, 'uMarkerField', 1);
    set2f(pass.uniforms, 'uGrid', GRID_W, GRID_H);
    set1f(pass.uniforms, 'uDt', dt);
    set1f(pass.uniforms, 'uGravity', WATER.gravity);
    set1f(pass.uniforms, 'uViscosity', WATER.viscosity);
    set1f(pass.uniforms, 'uTension', WATER.tension);
    set1f(pass.uniforms, 'uFoamGain', WATER.foam);
    set1f(pass.uniforms, 'uTime', WATER.time);
    set1i(pass.uniforms, 'uPackedState', floatColorBuffer ? 0 : 1);
    set1i(pass.uniforms, 'uObstacleEnabled', WATER.obstacle ? 1 : 0);
    set2f(pass.uniforms, 'uObstaclePosition', obstacle.position[0], obstacle.position[2]);
    set1f(pass.uniforms, 'uObstacleRadius', 0.14);
    set2f(pass.uniforms, 'uSplashPosition', this.splash?.position[0] ?? 0.5, this.splash?.position[1] ?? 0.5);
    set1f(pass.uniforms, 'uSplashAge', this.splash?.age ?? 99);
    set1f(pass.uniforms, 'uSplashImpulse', this.splash?.impulse ?? 0);
    gl.bindVertexArray(this.fullscreenVAO);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.stateFbos[write]);
    gl.viewport(0, 0, GRID_W, GRID_H);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.current = write;
    if (this.splash) {
      this.splash.age += dt;
      if (this.splash.age > 2.5) this.splash = null;
    }
  }

  setCameraUniforms(entry) {
    const u = entry.uniforms;
    set3f(u, 'uBoxMin', BOX_MIN);
    set3f(u, 'uBoxMax', BOX_MAX);
    set3f(u, 'uCameraPosition', this.camera.position);
    set3f(u, 'uCameraForward', this.camera.forward);
    set3f(u, 'uCameraRight', this.camera.right);
    set3f(u, 'uCameraUp', this.camera.up);
    set1f(u, 'uTanHalfFov', Math.tan(this.camera.fov * 0.5));
    set1f(u, 'uAspect', this.camera.aspect);
    set1f(u, 'uNear', NEAR);
    set1f(u, 'uFar', FAR);
  }

  drawFloor() {
    const entry = this.programs.floor;
    gl.useProgram(entry.handle);
    this.setCameraUniforms(entry);
    set1f(entry.uniforms, 'uTime', WATER.time);
    gl.bindVertexArray(this.meshVAO);
    gl.drawElements(gl.TRIANGLES, this.meshIndexCount, gl.UNSIGNED_INT, 0);
  }

  drawSurface() {
    const entry = this.programs.surface;
    gl.useProgram(entry.handle);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.stateTextures[this.current]);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.markerFieldTexture);
    set1i(entry.uniforms, 'uState', 0);
    set1i(entry.uniforms, 'uMarkerField', 1);
    set2f(entry.uniforms, 'uGrid', GRID_W, GRID_H);
    set1f(entry.uniforms, 'uWaterHeight', WATER_HEIGHT);
    this.setCameraUniforms(entry);
    set3f(entry.uniforms, 'uSunDirection', [0.38, 0.78, 0.32]);
    set3f(entry.uniforms, 'uWaterTint', [0.012, 0.12, 0.30]);
    set1f(entry.uniforms, 'uAbsorption', WATER.absorption);
    set1f(entry.uniforms, 'uRoughness', WATER.roughness);
    set1f(entry.uniforms, 'uRefraction', 0.82);
    set1f(entry.uniforms, 'uFoamGain', WATER.foam);
    set1f(entry.uniforms, 'uTime', WATER.time);
    gl.bindVertexArray(this.meshVAO);
    gl.drawElements(gl.TRIANGLES, this.meshIndexCount, gl.UNSIGNED_INT, 0);
  }

  drawObstacle() {
    if (!WATER.obstacle) return;
    const entry = this.programs.obstacle;
    const obstacle = this.obstacleState();
    gl.useProgram(entry.handle);
    this.setCameraUniforms(entry);
    set3f(entry.uniforms, 'uObstaclePosition', obstacle.position);
    set1f(entry.uniforms, 'uObstacleRadius', 0.14);
    set3f(entry.uniforms, 'uSunDirection', [0.38, 0.78, 0.32]);
    gl.bindVertexArray(this.obstacleVAO);
    gl.drawElements(gl.TRIANGLES, this.obstacleIndexCount, gl.UNSIGNED_INT, 0);
  }

  resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const width = Math.max(640, Math.floor(rect.width * dpr));
    const height = Math.max(420, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) canvas.width = width, canvas.height = height;
    this.camera.aspect = width / Math.max(1, height);
    gl.viewport(0, 0, width, height);
  }

  render() {
    this.resize();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.004, 0.009, 0.016, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.disable(gl.BLEND);
    this.drawFloor();
    this.drawSurface();
    this.drawObstacle();
  }

  splashAt(position, impulse = 1.7) {
    this.splash = { position, impulse, age: 0 };
    this.updateStatus('WAVE IMPULSE');
  }

  frame(now) {
    const dt = Math.min(0.026, Math.max(0.001, (now - this.lastTime) * 0.001));
    this.lastTime = now;
    if (!WATER.paused) {
      WATER.time += dt;
      this.updateMarkers(dt);
      this.drawMarkerField();
      this.step(dt);
    }
    this.render();
    this.fpsTime += dt;
    this.fpsFrames++;
    if (this.fpsTime > 0.35) {
      document.getElementById('fps-readout').textContent = String(Math.round(this.fpsFrames / this.fpsTime));
      this.fpsTime = 0;
      this.fpsFrames = 0;
    }
    requestAnimationFrame((next) => this.frame(next));
  }
}

let app;
try {
  app = new WaterGridApp();
} catch (error) {
  showError(error);
  throw error;
}

function pointFromPointer(event) {
  const rect = canvas.getBoundingClientRect();
  const ndcX = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const ndcY = 1 - ((event.clientY - rect.top) / rect.height) * 2;
  const ray = app.camera.ray(ndcX, ndcY);
  const floor = BOX_MIN[1] + 0.05;
  const t = Math.abs(ray.direction[1]) > 0.0001 ? (floor - ray.origin[1]) / ray.direction[1] : 1.4;
  const worldX = ray.origin[0] + ray.direction[0] * Math.max(0.2, t);
  const worldZ = ray.origin[2] + ray.direction[2] * Math.max(0.2, t);
  return [
    Math.max(0.03, Math.min(0.97, (worldX - BOX_MIN[0]) / (BOX_MAX[0] - BOX_MIN[0]))),
    Math.max(0.03, Math.min(0.97, (worldZ - BOX_MIN[2]) / (BOX_MAX[2] - BOX_MIN[2]))),
  ];
}

let dragging = false;
let down = [0, 0];
let last = [0, 0];
canvas.addEventListener('pointerdown', (event) => {
  dragging = true;
  down = [event.clientX, event.clientY];
  last = down;
  canvas.setPointerCapture(event.pointerId);
});
canvas.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  const dx = event.clientX - last[0];
  const dy = event.clientY - last[1];
  last = [event.clientX, event.clientY];
  app.camera.yaw -= dx * 0.006;
  app.camera.pitch = Math.max(0.10, Math.min(1.38, app.camera.pitch + dy * 0.006));
  app.camera.update();
});
canvas.addEventListener('pointerup', (event) => {
  if (Math.hypot(event.clientX - down[0], event.clientY - down[1]) < 5) app.splashAt(pointFromPointer(event));
  dragging = false;
  canvas.releasePointerCapture(event.pointerId);
});
canvas.addEventListener('pointercancel', () => { dragging = false; });
canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  app.camera.distance = Math.max(2.2, Math.min(8.5, app.camera.distance * (1 + event.deltaY * 0.001)));
  app.camera.update();
}, { passive: false });
window.addEventListener('resize', () => app.resize());

document.getElementById('dam-button').addEventListener('click', () => app.reset('dam'));
document.getElementById('pool-button').addEventListener('click', () => app.reset('pool'));
document.getElementById('splash-button').addEventListener('click', () => app.splashAt([0.58, 0.5], 2.1));
document.getElementById('obstacle-button').addEventListener('click', (event) => {
  WATER.obstacle = !WATER.obstacle;
  event.currentTarget.textContent = `SPHERE: ${WATER.obstacle ? 'ON' : 'OFF'}`;
  event.currentTarget.classList.toggle('active', WATER.obstacle);
});
document.getElementById('pause-button').addEventListener('click', (event) => {
  WATER.paused = !WATER.paused;
  event.currentTarget.textContent = WATER.paused ? 'RESUME' : 'PAUSE';
  app.updateStatus(WATER.paused ? 'PAUSED' : 'RUNNING');
});
document.getElementById('reset-view-button').addEventListener('click', () => app.camera.reset());

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

document.getElementById('marker-readout').textContent = `${MARKER_COUNT.toLocaleString()} / ${GRID_W}×${GRID_H}`;
requestAnimationFrame((now) => app.frame(now));
