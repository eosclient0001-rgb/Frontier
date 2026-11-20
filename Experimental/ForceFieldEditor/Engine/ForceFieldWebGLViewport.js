/*============================================================================================================================================
                                                    FORCEFIELDWEBGLVIEWPORT.JS
============================================================================================================================================*/
// Pure WebGL2 3D Viewport for Frontier ForceField Studio (+Z Up, Right-Handed).
// Renders:
//   1) Infinite anti-aliased 3D engineering ground grid + horizon gradient
//   2) Opaque & Translucent 3D Force Overlay geometry (beacons, Fresnel reach envelopes, impulse wavefronts,
//      3D arrow lattice, RK4 streamlines, iso-contour heatmap slices, motion trajectories)
//   3) Live RK2 advected Flow Tracer Particles (ribbon trails + glowing circular bokeh heads)
//   4) Split Viewport (Perspective + Orthographic Top/Front/Side) via single-pass gl.scissor
//   5) Interactive 2D HUD overlay for 3D Transform Gizmo, Force callouts & Probe reticle

import {
  ComputeGizmoWorldRadius,
  GizmoHandle,
  PickForceBeacon,
  PickTransformGizmo2D,
  ProjectWorldToScreen,
} from "./ForceFieldCore.js";

const DEG_TO_RAD = Math.PI / 180.0;

//------------------------------------------------------------------------------------------------------------------------
//                                              MATRIX & CAMERA UTILITIES (+Z UP)
//------------------------------------------------------------------------------------------------------------------------

function Sub3(A, B) { return [A[0] - B[0], A[1] - B[1], A[2] - B[2]]; }
function Add3(A, B) { return [A[0] + B[0], A[1] + B[1], A[2] + B[2]]; }
function Scale3(A, S) { return [A[0] * S, A[1] * S, A[2] * S]; }
function Dot3(A, B) { return A[0] * B[0] + A[1] * B[1] + A[2] * B[2]; }
function Cross3(A, B) {
  return [
    A[1] * B[2] - A[2] * B[1],
    A[2] * B[0] - A[0] * B[2],
    A[0] * B[1] - A[1] * B[0],
  ];
}
function Norm3(A, Fallback = [0, 0, 1]) {
  const L = Math.hypot(A[0], A[1], A[2]);
  return L > 1e-6 ? [A[0] / L, A[1] / L, A[2] / L] : Fallback;
}

export function CreateDefaultCamera() {
  return {
    Target: [0.1, 0.0, 0.85],
    YawDeg: -52.0,
    PitchDeg: 28.0,
    Distance: 7.4,
    FovDeg: 44.0,
    OrthoHalfHeight: 3.6,
  };
}

export function ComputeCameraVectors(Cam, Mode = "Perspective") {
  if (Mode === "Top") {
    const Pos = [Cam.Target[0], Cam.Target[1], Cam.Target[2] + 18.0];
    return {
      Position: Pos,
      Target: [...Cam.Target],
      Forward: [0, 0, -1],
      Right: [1, 0, 0],
      Up: [0, 1, 0],
      OrthoHalfHeight: Cam.OrthoHalfHeight,
      Mode,
    };
  }
  if (Mode === "Front") {
    const Pos = [Cam.Target[0], Cam.Target[1] - 18.0, Cam.Target[2]];
    return {
      Position: Pos,
      Target: [...Cam.Target],
      Forward: [0, 1, 0],
      Right: [1, 0, 0],
      Up: [0, 0, 1],
      OrthoHalfHeight: Cam.OrthoHalfHeight,
      Mode,
    };
  }
  if (Mode === "Side") {
    const Pos = [Cam.Target[0] + 18.0, Cam.Target[1], Cam.Target[2]];
    return {
      Position: Pos,
      Target: [...Cam.Target],
      Forward: [-1, 0, 0],
      Right: [0, 1, 0],
      Up: [0, 0, 1],
      OrthoHalfHeight: Cam.OrthoHalfHeight,
      Mode,
    };
  }

  const Yaw = Cam.YawDeg * DEG_TO_RAD;
  const Pitch = Math.max(-85, Math.min(85, Cam.PitchDeg)) * DEG_TO_RAD;
  const Cp = Math.cos(Pitch);
  const DirToCam = [Cp * Math.cos(Yaw), Cp * Math.sin(Yaw), Math.sin(Pitch)];
  const Pos = [
    Cam.Target[0] + DirToCam[0] * Cam.Distance,
    Cam.Target[1] + DirToCam[1] * Cam.Distance,
    Math.max(0.15, Cam.Target[2] + DirToCam[2] * Cam.Distance),
  ];
  const Forward = Norm3(Sub3(Cam.Target, Pos), [0, 1, 0]);
  const Right = Norm3(Cross3(Forward, [0, 0, 1]), [1, 0, 0]);
  const Up = Norm3(Cross3(Right, Forward), [0, 0, 1]);
  return {
    Position: Pos,
    Target: [...Cam.Target],
    Forward,
    Right,
    Up,
    FovDeg: Cam.FovDeg,
    OrthoHalfHeight: 0,
    Mode: "Perspective",
  };
}

function BuildViewMatrix(Vecs) {
  const { Position, Right, Up, Forward } = Vecs;
  const F = [-Forward[0], -Forward[1], -Forward[2]];
  return new Float32Array([
    Right[0], Up[0], F[0], 0,
    Right[1], Up[1], F[1], 0,
    Right[2], Up[2], F[2], 0,
    -Dot3(Right, Position), -Dot3(Up, Position), -Dot3(F, Position), 1,
  ]);
}

function BuildProjMatrix(Vecs, Aspect) {
  const Near = 0.08, Far = 120.0;
  if (Vecs.OrthoHalfHeight > 0) {
    const H = Vecs.OrthoHalfHeight;
    const W = H * Aspect;
    const L = -W, R = W, B = -H, T = H;
    return new Float32Array([
      2 / (R - L), 0, 0, 0,
      0, 2 / (T - B), 0, 0,
      0, 0, -2 / (Far - Near), 0,
      -(R + L) / (R - L), -(T + B) / (T - B), -(Far + Near) / (Far - Near), 1,
    ]);
  }
  const F = 1.0 / Math.tan((Vecs.FovDeg * DEG_TO_RAD) * 0.5);
  return new Float32Array([
    F / Aspect, 0, 0, 0,
    0, F, 0, 0,
    0, 0, (Far + Near) / (Near - Far), -1,
    0, 0, (2 * Far * Near) / (Near - Far), 0,
  ]);
}

function MulMat4(A, B) {
  const Out = new Float32Array(16);
  for (let C = 0; C < 4; ++C) {
    for (let R = 0; R < 4; ++R) {
      Out[C * 4 + R] =
        A[0 * 4 + R] * B[C * 4 + 0] +
        A[1 * 4 + R] * B[C * 4 + 1] +
        A[2 * 4 + R] * B[C * 4 + 2] +
        A[3 * 4 + R] * B[C * 4 + 3];
    }
  }
  return Out;
}

export function ComputePickRay(Vecs, U, V, Aspect) {
  const NdcX = U * 2.0 - 1.0;
  const NdcY = 1.0 - V * 2.0;
  if (Vecs.OrthoHalfHeight > 0) {
    const H = Vecs.OrthoHalfHeight;
    const W = H * Aspect;
    const Origin = Add3(
      Vecs.Position,
      Add3(Scale3(Vecs.Right, NdcX * W), Scale3(Vecs.Up, NdcY * H)),
    );
    return { Origin, Dir: Vecs.Forward };
  }
  const TanHalf = Math.tan((Vecs.FovDeg * DEG_TO_RAD) * 0.5);
  const Dir = Norm3(
    Add3(
      Vecs.Forward,
      Add3(Scale3(Vecs.Right, NdcX * TanHalf * Aspect), Scale3(Vecs.Up, NdcY * TanHalf)),
    ),
  );
  return { Origin: Vecs.Position, Dir };
}

export function RaycastGroundZ(Ray, PlaneZ = 0.0) {
  if (Math.abs(Ray.Dir[2]) < 1e-4) return null;
  const T = (PlaneZ - Ray.Origin[2]) / Ray.Dir[2];
  if (T < 0.05 || T > 80.0) return null;
  return [
    Ray.Origin[0] + Ray.Dir[0] * T,
    Ray.Origin[1] + Ray.Dir[1] * T,
    PlaneZ,
  ];
}

//------------------------------------------------------------------------------------------------------------------------
//                                              GLSL ES 3.00 SHADERS
//------------------------------------------------------------------------------------------------------------------------

const GRID_VS = `#version 300 es
precision highp float;
out vec2 vUv;
void main() {
  vec2 p = vec2((gl_VertexID == 1) ? 3.0 : -1.0, (gl_VertexID == 2) ? 3.0 : -1.0);
  vUv = p * 0.5 + 0.5;
  gl_Position = vec4(p, 0.999, 1.0);
}`;

const GRID_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform vec3 uCamPos;
uniform vec3 uCamFwd;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform float uTanHalfFov;
uniform float uAspect;
uniform float uOrthoHalfH;
uniform float uShowGrid;

vec3 shadeBackdrop(vec3 dir) {
  float h = clamp(dir.z * 0.5 + 0.5, 0.0, 1.0);
  vec3 low = vec3(0.043, 0.047, 0.056);
  vec3 mid = vec3(0.058, 0.064, 0.078);
  vec3 top = vec3(0.032, 0.036, 0.046);
  return mix(low, mix(mid, top, smoothstep(0.45, 1.0, h)), smoothstep(0.0, 0.55, h));
}

void main() {
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 ro, rd;
  if (uOrthoHalfH > 0.0) {
    ro = uCamPos + uCamRight * (ndc.x * uOrthoHalfH * uAspect) + uCamUp * (ndc.y * uOrthoHalfH);
    rd = normalize(uCamFwd);
  } else {
    ro = uCamPos;
    rd = normalize(uCamFwd + uCamRight * (ndc.x * uTanHalfFov * uAspect) + uCamUp * (ndc.y * uTanHalfFov));
  }

  vec3 col = shadeBackdrop(rd);

  if (uShowGrid > 0.5 && abs(rd.z) > 1e-4) {
    float t = -ro.z / rd.z;
    if (t > 0.05 && t < 85.0) {
      vec3 hit = ro + rd * t;
      float dist = length(hit.xy - uCamPos.xy);
      float fade = 1.0 - smoothstep(8.0, 32.0, dist);
      if (fade > 0.004) {
        // Minor 0.25m & Major 1.0m anti-aliased grid
        vec2 coordMinor = hit.xy * 4.0;
        vec2 dMinor = fwidth(coordMinor);
        vec2 gMinor = abs(fract(coordMinor - 0.5) - 0.5) / max(dMinor, vec2(1e-4));
        float minorLine = 1.0 - min(min(gMinor.x, gMinor.y), 1.0);

        vec2 coordMajor = hit.xy;
        vec2 dMajor = fwidth(coordMajor);
        vec2 gMajor = abs(fract(coordMajor - 0.5) - 0.5) / max(dMajor, vec2(1e-4));
        float majorLine = 1.0 - min(min(gMajor.x, gMajor.y), 1.0);

        // X and Y primary axes
        float axisX = 1.0 - clamp(abs(hit.y) / max(fwidth(hit.y) * 1.4, 0.008), 0.0, 1.0);
        float axisY = 1.0 - clamp(abs(hit.x) / max(fwidth(hit.x) * 1.4, 0.008), 0.0, 1.0);

        vec3 floorCol = vec3(0.054, 0.058, 0.068);
        floorCol += vec3(0.045, 0.050, 0.062) * minorLine * 0.55;
        floorCol += vec3(0.095, 0.105, 0.125) * majorLine * 0.85;
        floorCol = mix(floorCol, vec3(0.75, 0.28, 0.28), axisX * 0.68);
        floorCol = mix(floorCol, vec3(0.28, 0.72, 0.38), axisY * 0.68);

        col = mix(col, floorCol, fade);
      }
    }
  }
  fragColor = vec4(col, 1.0);
}`;

const MESH_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec3 aNorm;
layout(location = 2) in vec4 aCol;
layout(location = 3) in float aEmissive;
layout(location = 4) in float aContour;

uniform mat4 uViewProj;
out vec3 vPos;
out vec3 vNorm;
out vec4 vCol;
out float vEmissive;
out float vContour;

void main() {
  vPos = aPos;
  vNorm = aNorm;
  vCol = aCol;
  vEmissive = aEmissive;
  vContour = aContour;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const MESH_FS = `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vNorm;
in vec4 vCol;
in float vEmissive;
in float vContour;
out vec4 fragColor;

uniform vec3 uCamPos;

void main() {
  vec3 N = normalize(vNorm + vec3(0.0, 0.0, 1e-5));
  vec3 L = normalize(vec3(0.45, -0.55, 0.78));
  vec3 V = normalize(uCamPos - vPos);
  float ndl = abs(dot(N, L));
  float rim = pow(1.0 - abs(dot(N, V)), 2.0);
  float shade = mix(0.42 + 0.58 * ndl, 1.0, clamp(vEmissive, 0.0, 1.0));
  vec3 rgb = vCol.rgb * shade + vCol.rgb * rim * 0.16;

  // Crisp iso-contour bands on heatmap slices
  if (vContour >= 0.0) {
    float freq = vContour * 9.0;
    float fw = max(fwidth(freq), 0.015);
    float band = abs(fract(freq - 0.5) - 0.5) / fw;
    float iso = 1.0 - smoothstep(0.0, 1.4, band);
    rgb = mix(rgb, rgb * 1.42 + vec3(0.08), iso * 0.48);
  }

  fragColor = vec4(rgb, vCol.a);
}`;

const TRAIL_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aCol;
uniform mat4 uViewProj;
out vec4 vCol;
void main() {
  vCol = aCol;
  gl_Position = uViewProj * vec4(aPos, 1.0);
}`;

const TRAIL_FS = `#version 300 es
precision highp float;
in vec4 vCol;
out vec4 fragColor;
void main() {
  fragColor = vCol;
}`;

const HEAD_VS = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec4 aCol;
layout(location = 2) in float aSize;
uniform mat4 uViewProj;
uniform float uDpr;
out vec4 vCol;
void main() {
  vCol = aCol;
  gl_Position = uViewProj * vec4(aPos, 1.0);
  float distScale = clamp(7.5 / max(1.2, gl_Position.w), 0.55, 2.4);
  gl_PointSize = aSize * distScale * uDpr;
}`;

const HEAD_FS = `#version 300 es
precision highp float;
in vec4 vCol;
out vec4 fragColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float core = smoothstep(1.0, 0.12, r2);
  float hot = smoothstep(0.32, 0.0, r2);
  vec3 col = mix(vCol.rgb, vec3(1.0), hot * 0.55);
  fragColor = vec4(col, vCol.a * core);
}`;

function CompileShader(Gl, Type, Source) {
  const S = Gl.createShader(Type);
  Gl.shaderSource(S, Source);
  Gl.compileShader(S);
  if (!Gl.getShaderParameter(S, Gl.COMPILE_STATUS)) {
    throw new Error(Gl.getShaderInfoLog(S) || "Shader compile error");
  }
  return S;
}

function CreateProgram(Gl, VsSrc, FsSrc) {
  const P = Gl.createProgram();
  const Vs = CompileShader(Gl, Gl.VERTEX_SHADER, VsSrc);
  const Fs = CompileShader(Gl, Gl.FRAGMENT_SHADER, FsSrc);
  Gl.attachShader(P, Vs);
  Gl.attachShader(P, Fs);
  Gl.linkProgram(P);
  if (!Gl.getProgramParameter(P, Gl.LINK_STATUS)) {
    throw new Error(Gl.getProgramInfoLog(P) || "Program link error");
  }
  Gl.deleteShader(Vs);
  Gl.deleteShader(Fs);
  return P;
}

//------------------------------------------------------------------------------------------------------------------------
//                                          VIEWPORT CONTROLLER CLASS
//------------------------------------------------------------------------------------------------------------------------

export class ForceFieldWebGLViewport {
  constructor(ContainerEl, Callbacks = {}) {
    this.Container = ContainerEl;
    this.Callbacks = Callbacks;
    this.Camera = CreateDefaultCamera();
    this.PrimaryMode = "Perspective";
    this.SecondaryMode = "Top";
    this.SplitView = false;
    this.ShowGrid = true;
    this.ShowGizmo = true;
    this.ShowLabels = true;
    this.HoveredHandle = GizmoHandle.None;
    this.ActiveHandle = GizmoHandle.None;
    this.DropPreviewPos = null;

    this.GlCanvas = document.createElement("canvas");
    this.GlCanvas.className = "viewport-webgl-canvas";
    this.HudCanvas = document.createElement("canvas");
    this.HudCanvas.className = "viewport-hud-canvas";
    ContainerEl.appendChild(this.GlCanvas);
    ContainerEl.appendChild(this.HudCanvas);

    this.Ctx2d = this.HudCanvas.getContext("2d");
    this.Gl = this.GlCanvas.getContext("webgl2", { antialias: true, alpha: false, powerPreference: "high-performance" });
    this.HasWebGL2 = Boolean(this.Gl);

    if (this.HasWebGL2) {
      this._InitGl();
    }

    this.OverlayGeo = {
      OpaqueBuffer: new Float32Array(0),
      OpaqueVertexCount: 0,
      TranslucentBuffer: new Float32Array(0),
      TranslucentVertexCount: 0,
      PickBeacons: [],
      Labels: [],
    };
    this.ParticleBuffers = {
      TrailBuffer: new Float32Array(0),
      TrailVertexCount: 0,
      HeadBuffer: new Float32Array(0),
      HeadCount: 0,
    };
    this.SelectedNode = null;
    this.ProbePos = [0.45, 0.25, 0.85];
    this.ShowProbe = true;
    this.KeysDown = new Set();
    this.DragState = null;

    this._BindEvents();
    this._Resize();
    this.ResizeObs = new ResizeObserver(() => this._Resize());
    this.ResizeObs.observe(ContainerEl);
  }

  _InitGl() {
    const Gl = this.Gl;
    this.GridProg = CreateProgram(Gl, GRID_VS, GRID_FS);
    this.MeshProg = CreateProgram(Gl, MESH_VS, MESH_FS);
    this.TrailProg = CreateProgram(Gl, TRAIL_VS, TRAIL_FS);
    this.HeadProg = CreateProgram(Gl, HEAD_VS, HEAD_FS);

    this.GridVao = Gl.createVertexArray();
    this.OpaqueVao = Gl.createVertexArray();
    this.OpaqueVbo = Gl.createBuffer();
    this._SetupMeshVao(this.OpaqueVao, this.OpaqueVbo);

    this.TransVao = Gl.createVertexArray();
    this.TransVbo = Gl.createBuffer();
    this._SetupMeshVao(this.TransVao, this.TransVbo);

    this.TrailVao = Gl.createVertexArray();
    this.TrailVbo = Gl.createBuffer();
    Gl.bindVertexArray(this.TrailVao);
    Gl.bindBuffer(Gl.ARRAY_BUFFER, this.TrailVbo);
    Gl.enableVertexAttribArray(0);
    Gl.vertexAttribPointer(0, 3, Gl.FLOAT, false, 28, 0);
    Gl.enableVertexAttribArray(1);
    Gl.vertexAttribPointer(1, 4, Gl.FLOAT, false, 28, 12);

    this.HeadVao = Gl.createVertexArray();
    this.HeadVbo = Gl.createBuffer();
    Gl.bindVertexArray(this.HeadVao);
    Gl.bindBuffer(Gl.ARRAY_BUFFER, this.HeadVbo);
    Gl.enableVertexAttribArray(0);
    Gl.vertexAttribPointer(0, 3, Gl.FLOAT, false, 32, 0);
    Gl.enableVertexAttribArray(1);
    Gl.vertexAttribPointer(1, 4, Gl.FLOAT, false, 32, 12);
    Gl.enableVertexAttribArray(2);
    Gl.vertexAttribPointer(2, 1, Gl.FLOAT, false, 32, 28);
    Gl.bindVertexArray(null);
  }

  _SetupMeshVao(Vao, Vbo) {
    const Gl = this.Gl;
    Gl.bindVertexArray(Vao);
    Gl.bindBuffer(Gl.ARRAY_BUFFER, Vbo);
    const Stride = 48; // 12 floats
    Gl.enableVertexAttribArray(0);
    Gl.vertexAttribPointer(0, 3, Gl.FLOAT, false, Stride, 0);
    Gl.enableVertexAttribArray(1);
    Gl.vertexAttribPointer(1, 3, Gl.FLOAT, false, Stride, 12);
    Gl.enableVertexAttribArray(2);
    Gl.vertexAttribPointer(2, 4, Gl.FLOAT, false, Stride, 24);
    Gl.enableVertexAttribArray(3);
    Gl.vertexAttribPointer(3, 1, Gl.FLOAT, false, Stride, 40);
    Gl.enableVertexAttribArray(4);
    Gl.vertexAttribPointer(4, 1, Gl.FLOAT, false, Stride, 44);
    Gl.bindVertexArray(null);
  }

  _Resize() {
    const Rect = this.Container.getBoundingClientRect();
    const Dpr = Math.min(2, window.devicePixelRatio || 1);
    this.Width = Math.max(200, Math.round(Rect.width));
    this.Height = Math.max(160, Math.round(Rect.height));
    this.Dpr = Dpr;
    this.GlCanvas.width = Math.round(this.Width * Dpr);
    this.GlCanvas.height = Math.round(this.Height * Dpr);
    this.HudCanvas.width = Math.round(this.Width * Dpr);
    this.HudCanvas.height = Math.round(this.Height * Dpr);
  }

  SetOverlayGeometry(Geo) {
    this.OverlayGeo = Geo;
    if (!this.HasWebGL2) return;
    const Gl = this.Gl;
    Gl.bindBuffer(Gl.ARRAY_BUFFER, this.OpaqueVbo);
    Gl.bufferData(Gl.ARRAY_BUFFER, Geo.OpaqueBuffer, Gl.DYNAMIC_DRAW);
    Gl.bindBuffer(Gl.ARRAY_BUFFER, this.TransVbo);
    Gl.bufferData(Gl.ARRAY_BUFFER, Geo.TranslucentBuffer, Gl.DYNAMIC_DRAW);
  }

  SetParticleBuffers(Bufs) {
    this.ParticleBuffers = Bufs;
    if (!this.HasWebGL2) return;
    const Gl = this.Gl;
    Gl.bindBuffer(Gl.ARRAY_BUFFER, this.TrailVbo);
    Gl.bufferData(Gl.ARRAY_BUFFER, Bufs.TrailBuffer, Gl.DYNAMIC_DRAW);
    Gl.bindBuffer(Gl.ARRAY_BUFFER, this.HeadVbo);
    Gl.bufferData(Gl.ARRAY_BUFFER, Bufs.HeadBuffer, Gl.DYNAMIC_DRAW);
  }

  FocusOn(TargetPos = [0.1, 0.0, 0.85], Distance = 6.2) {
    this.Camera.Target = [...TargetPos];
    this.Camera.Distance = Math.max(2.0, Math.min(28.0, Distance));
  }

  ResetCamera() {
    this.Camera = CreateDefaultCamera();
  }

  GetActiveCameraOrigin() {
    return ComputeCameraVectors(this.Camera, this.PrimaryMode).Position;
  }

  _GetPaneAtClientPos(ClientX, ClientY) {
    const Rect = this.HudCanvas.getBoundingClientRect();
    const X = ClientX - Rect.left;
    const Y = ClientY - Rect.top;
    if (!this.SplitView) {
      return { PaneIndex: 0, Mode: this.PrimaryMode, LocalX: X, LocalY: Y, PaneX: 0, PaneW: this.Width, PaneH: this.Height };
    }
    const HalfW = Math.floor(this.Width * 0.5);
    if (X <= HalfW) {
      return { PaneIndex: 0, Mode: this.PrimaryMode, LocalX: X, LocalY: Y, PaneX: 0, PaneW: HalfW, PaneH: this.Height };
    }
    return { PaneIndex: 1, Mode: this.SecondaryMode, LocalX: X - HalfW, LocalY: Y, PaneX: HalfW, PaneW: this.Width - HalfW, PaneH: this.Height };
  }

  _BindEvents() {
    const Canvas = this.HudCanvas;

    Canvas.addEventListener("contextmenu", (E) => E.preventDefault());

    Canvas.addEventListener("pointerdown", (E) => {
      Canvas.setPointerCapture(E.pointerId);
      const Pane = this._GetPaneAtClientPos(E.clientX, E.clientY);
      const Aspect = Pane.PaneW / Math.max(1, Pane.PaneH);
      const Vecs = ComputeCameraVectors(this.Camera, Pane.Mode);
      const ViewProj = MulMat4(BuildProjMatrix(Vecs, Aspect), BuildViewMatrix(Vecs));
      const U = Pane.LocalX / Math.max(1, Pane.PaneW);
      const V = Pane.LocalY / Math.max(1, Pane.PaneH);
      const Ray = ComputePickRay(Vecs, U, V, Aspect);

      // Shift+Click: Place 3D Flow Probe
      if (E.button === 0 && E.shiftKey) {
        const Hit = RaycastGroundZ(Ray, this.ProbePos?.[2] ?? 0.85) || RaycastGroundZ(Ray, 0.0);
        if (Hit && this.Callbacks.OnProbeMoved) {
          this.Callbacks.OnProbeMoved(Hit.map((N) => Number(N.toFixed(2))));
        }
        return;
      }

      // Check 3D Gizmo Handle on Selected Force
      if (E.button === 0 && this.ShowGizmo && this.SelectedNode) {
        const Pos = this.SelectedNode.Position || [0, 0, 0.9];
        const GizmoR = ComputeGizmoWorldRadius(Pos, Vecs.Position, this.Camera.FovDeg * DEG_TO_RAD, Vecs.OrthoHalfHeight);
        const Handle = PickTransformGizmo2D(Pane.LocalX, Pane.LocalY, Pos, GizmoR, ViewProj, Pane.PaneW, Pane.PaneH);
        if (Handle !== GizmoHandle.None) {
          this.ActiveHandle = Handle;
          this.DragState = {
            Kind: "gizmo",
            Handle,
            Pane,
            StartX: E.clientX,
            StartY: E.clientY,
            StartPos: [...Pos],
            Vecs,
            GizmoR,
          };
          return;
        }
      }

      // Check 3D Force Beacon Picking on left click
      if (E.button === 0) {
        const HitId = PickForceBeacon(Ray.Origin, Ray.Dir, this.OverlayGeo);
        if (HitId && this.Callbacks.OnSelectForce) {
          this.Callbacks.OnSelectForce(HitId);
          return;
        }
      }

      // Camera Navigation
      if (E.button === 1 || (E.button === 0 && E.altKey) || (E.button === 0 && Pane.Mode !== "Perspective")) {
        this.DragState = { Kind: "pan", StartX: E.clientX, StartY: E.clientY, StartTarget: [...this.Camera.Target], Vecs, Pane };
      } else if (E.button === 2) {
        this.DragState = { Kind: "fly", StartX: E.clientX, StartY: E.clientY, StartYaw: this.Camera.YawDeg, StartPitch: this.Camera.PitchDeg };
      } else if (E.button === 0) {
        this.DragState = { Kind: "orbit", StartX: E.clientX, StartY: E.clientY, StartYaw: this.Camera.YawDeg, StartPitch: this.Camera.PitchDeg };
      }
    });

    Canvas.addEventListener("pointermove", (E) => {
      const Pane = this._GetPaneAtClientPos(E.clientX, E.clientY);
      if (!this.DragState) {
        if (this.ShowGizmo && this.SelectedNode) {
          const Aspect = Pane.PaneW / Math.max(1, Pane.PaneH);
          const Vecs = ComputeCameraVectors(this.Camera, Pane.Mode);
          const ViewProj = MulMat4(BuildProjMatrix(Vecs, Aspect), BuildViewMatrix(Vecs));
          const Pos = this.SelectedNode.Position || [0, 0, 0.9];
          const GizmoR = ComputeGizmoWorldRadius(Pos, Vecs.Position, this.Camera.FovDeg * DEG_TO_RAD, Vecs.OrthoHalfHeight);
          this.HoveredHandle = PickTransformGizmo2D(Pane.LocalX, Pane.LocalY, Pos, GizmoR, ViewProj, Pane.PaneW, Pane.PaneH);
        } else {
          this.HoveredHandle = GizmoHandle.None;
        }
        return;
      }

      const Dx = E.clientX - this.DragState.StartX;
      const Dy = E.clientY - this.DragState.StartY;

      if (this.DragState.Kind === "gizmo" && this.SelectedNode && this.Callbacks.OnTransformForce) {
        const { Handle, StartPos, Vecs, GizmoR } = this.DragState;
        const Sens = Math.max(0.004, GizmoR * 0.012);
        const Next = [...StartPos];
        if (Handle === GizmoHandle.TranslateX) {
          const ScreenXDir = Dot3([1, 0, 0], Vecs.Right);
          const ScreenYDir = -Dot3([1, 0, 0], Vecs.Up);
          Next[0] += (Dx * ScreenXDir + Dy * ScreenYDir) * Sens;
        } else if (Handle === GizmoHandle.TranslateY) {
          const ScreenXDir = Dot3([0, 1, 0], Vecs.Right);
          const ScreenYDir = -Dot3([0, 1, 0], Vecs.Up);
          Next[1] += (Dx * ScreenXDir + Dy * ScreenYDir) * Sens;
        } else if (Handle === GizmoHandle.TranslateZ) {
          const ScreenYDir = -Dot3([0, 0, 1], Vecs.Up);
          Next[2] = Math.max(0.05, Next[2] + Dy * ScreenYDir * Sens);
        } else if (Handle === GizmoHandle.PlaneXY) {
          const RightXY = Norm3([Vecs.Right[0], Vecs.Right[1], 0], [1, 0, 0]);
          const FwdXY = Norm3([Vecs.Forward[0], Vecs.Forward[1], 0], [0, 1, 0]);
          Next[0] += (RightXY[0] * Dx - FwdXY[0] * Dy) * Sens;
          Next[1] += (RightXY[1] * Dx - FwdXY[1] * Dy) * Sens;
        }
        this.Callbacks.OnTransformForce(this.SelectedNode.Id, Next.map((V) => Number(V.toFixed(2))));
      } else if (this.DragState.Kind === "orbit" || this.DragState.Kind === "fly") {
        this.Camera.YawDeg = this.DragState.StartYaw - Dx * 0.35;
        this.Camera.PitchDeg = Math.max(-80, Math.min(82, this.DragState.StartPitch + Dy * 0.3));
      } else if (this.DragState.Kind === "pan") {
        const { StartTarget, Vecs } = this.DragState;
        const PanScale = Vecs.OrthoHalfHeight > 0 ? Vecs.OrthoHalfHeight * 0.0045 : this.Camera.Distance * 0.0016;
        const Offset = Add3(Scale3(Vecs.Right, -Dx * PanScale), Scale3(Vecs.Up, Dy * PanScale));
        this.Camera.Target = Add3(StartTarget, Offset);
      }
    });

    const EndDrag = () => {
      this.DragState = null;
      this.ActiveHandle = GizmoHandle.None;
    };
    Canvas.addEventListener("pointerup", EndDrag);
    Canvas.addEventListener("pointercancel", EndDrag);

    Canvas.addEventListener("wheel", (E) => {
      E.preventDefault();
      const Factor = Math.exp(E.deltaY * 0.0011);
      this.Camera.Distance = Math.max(1.8, Math.min(34.0, this.Camera.Distance * Factor));
      this.Camera.OrthoHalfHeight = Math.max(1.0, Math.min(18.0, this.Camera.OrthoHalfHeight * Factor));
    }, { passive: false });

    // Drag & Drop from Bottom Force Generator Drawer
    Canvas.addEventListener("dragover", (E) => {
      if (E.dataTransfer.types.includes("application/x-frontier-force")) {
        E.preventDefault();
        E.dataTransfer.dropEffect = "copy";
        const Pane = this._GetPaneAtClientPos(E.clientX, E.clientY);
        const Aspect = Pane.PaneW / Math.max(1, Pane.PaneH);
        const Vecs = ComputeCameraVectors(this.Camera, Pane.Mode);
        const Ray = ComputePickRay(Vecs, Pane.LocalX / Math.max(1, Pane.PaneW), Pane.LocalY / Math.max(1, Pane.PaneH), Aspect);
        this.DropPreviewPos = RaycastGroundZ(Ray, 0.85) || [0, 0, 0.85];
      }
    });
    Canvas.addEventListener("dragleave", () => {
      this.DropPreviewPos = null;
    });
    Canvas.addEventListener("drop", (E) => {
      const ModelId = E.dataTransfer.getData("application/x-frontier-force");
      this.DropPreviewPos = null;
      if (ModelId && this.Callbacks.OnDropForceGenerator) {
        E.preventDefault();
        const Pane = this._GetPaneAtClientPos(E.clientX, E.clientY);
        const Aspect = Pane.PaneW / Math.max(1, Pane.PaneH);
        const Vecs = ComputeCameraVectors(this.Camera, Pane.Mode);
        const Ray = ComputePickRay(Vecs, Pane.LocalX / Math.max(1, Pane.PaneW), Pane.LocalY / Math.max(1, Pane.PaneH), Aspect);
        const Hit = RaycastGroundZ(Ray, 0.85) || [0, 0, 0.85];
        this.Callbacks.OnDropForceGenerator(ModelId, Hit.map((N) => Number(N.toFixed(2))));
      }
    });

    window.addEventListener("keydown", (E) => this.KeysDown.add(E.code));
    window.addEventListener("keyup", (E) => this.KeysDown.delete(E.code));
  }

  StepFlyCamera(Dt) {
    if (!this.DragState || this.DragState.Kind !== "fly") return;
    const Vecs = ComputeCameraVectors(this.Camera, "Perspective");
    const Spd = 4.5 * Dt;
    let Move = [0, 0, 0];
    if (this.KeysDown.has("KeyW")) Move = Add3(Move, Scale3(Vecs.Forward, Spd));
    if (this.KeysDown.has("KeyS")) Move = Add3(Move, Scale3(Vecs.Forward, -Spd));
    if (this.KeysDown.has("KeyD")) Move = Add3(Move, Scale3(Vecs.Right, Spd));
    if (this.KeysDown.has("KeyA")) Move = Add3(Move, Scale3(Vecs.Right, -Spd));
    if (this.KeysDown.has("KeyE")) Move = Add3(Move, [0, 0, Spd]);
    if (this.KeysDown.has("KeyQ")) Move = Add3(Move, [0, 0, -Spd]);
    this.Camera.Target = Add3(this.Camera.Target, Move);
  }

  Render() {
    const Dpr = this.Dpr || 1;
    const W = this.Width, H = this.Height;
    const Ctx = this.Ctx2d;
    Ctx.setTransform(Dpr, 0, 0, Dpr, 0, 0);
    Ctx.clearRect(0, 0, W, H);

    const Panes = this.SplitView
      ? [
          { X: 0, Y: 0, W: Math.floor(W * 0.5), H, Mode: this.PrimaryMode, Label: this.PrimaryMode },
          { X: Math.floor(W * 0.5), Y: 0, W: W - Math.floor(W * 0.5), H, Mode: this.SecondaryMode, Label: this.SecondaryMode },
        ]
      : [{ X: 0, Y: 0, W, H, Mode: this.PrimaryMode, Label: this.PrimaryMode }];

    if (this.HasWebGL2) {
      const Gl = this.Gl;
      Gl.enable(Gl.SCISSOR_TEST);
      Gl.clearColor(0.04, 0.045, 0.055, 1.0);
      Gl.viewport(0, 0, Math.round(W * Dpr), Math.round(H * Dpr));
      Gl.scissor(0, 0, Math.round(W * Dpr), Math.round(H * Dpr));
      Gl.clear(Gl.COLOR_BUFFER_BIT | Gl.DEPTH_BUFFER_BIT);

      for (const P of Panes) {
        const Vx = Math.round(P.X * Dpr), Vw = Math.round(P.W * Dpr), Vh = Math.round(P.H * Dpr);
        Gl.viewport(Vx, 0, Vw, Vh);
        Gl.scissor(Vx, 0, Vw, Vh);
        this._RenderPaneGl(P);
      }
      Gl.disable(Gl.SCISSOR_TEST);
    }

    // 2D Overlay: Split divider, Gizmo, Callout Labels, Probe reticle, Axis Triad
    for (let I = 0; I < Panes.length; ++I) {
      const P = Panes[I];
      Ctx.save();
      Ctx.beginPath();
      Ctx.rect(P.X, P.Y, P.W, P.H);
      Ctx.clip();
      Ctx.translate(P.X, P.Y);
      this._RenderPaneHud(Ctx, P);
      Ctx.restore();
    }
    if (this.SplitView) {
      const SplitX = Math.floor(W * 0.5);
      Ctx.fillStyle = "rgba(255,255,255,0.12)";
      Ctx.fillRect(SplitX - 1, 0, 2, H);
    }
  }

  _RenderPaneGl(Pane) {
    const Gl = this.Gl;
    const Aspect = Pane.W / Math.max(1, Pane.H);
    const Vecs = ComputeCameraVectors(this.Camera, Pane.Mode);
    const ViewProj = MulMat4(BuildProjMatrix(Vecs, Aspect), BuildViewMatrix(Vecs));

    // 1. Infinite Ground Grid
    Gl.disable(Gl.DEPTH_TEST);
    Gl.disable(Gl.BLEND);
    Gl.useProgram(this.GridProg);
    Gl.uniform3fv(Gl.getUniformLocation(this.GridProg, "uCamPos"), Vecs.Position);
    Gl.uniform3fv(Gl.getUniformLocation(this.GridProg, "uCamFwd"), Vecs.Forward);
    Gl.uniform3fv(Gl.getUniformLocation(this.GridProg, "uCamRight"), Vecs.Right);
    Gl.uniform3fv(Gl.getUniformLocation(this.GridProg, "uCamUp"), Vecs.Up);
    Gl.uniform1f(Gl.getUniformLocation(this.GridProg, "uTanHalfFov"), Math.tan((this.Camera.FovDeg * DEG_TO_RAD) * 0.5));
    Gl.uniform1f(Gl.getUniformLocation(this.GridProg, "uAspect"), Aspect);
    Gl.uniform1f(Gl.getUniformLocation(this.GridProg, "uOrthoHalfH"), Vecs.OrthoHalfHeight);
    Gl.uniform1f(Gl.getUniformLocation(this.GridProg, "uShowGrid"), this.ShowGrid ? 1.0 : 0.0);
    Gl.bindVertexArray(this.GridVao);
    Gl.drawArrays(Gl.TRIANGLES, 0, 3);

    // 2. Opaque Force Beacons, 3D Lattice Arrows, Motion Paths
    Gl.clear(Gl.DEPTH_BUFFER_BIT);
    Gl.enable(Gl.DEPTH_TEST);
    Gl.depthMask(true);
    Gl.useProgram(this.MeshProg);
    Gl.uniformMatrix4fv(Gl.getUniformLocation(this.MeshProg, "uViewProj"), false, ViewProj);
    Gl.uniform3fv(Gl.getUniformLocation(this.MeshProg, "uCamPos"), Vecs.Position);

    if (this.OverlayGeo.OpaqueVertexCount > 0) {
      Gl.bindVertexArray(this.OpaqueVao);
      Gl.drawArrays(Gl.TRIANGLES, 0, this.OverlayGeo.OpaqueVertexCount);
    }

    // 3. Translucent Heatmap Slice, Streamlines, Fresnel Envelopes
    Gl.enable(Gl.BLEND);
    Gl.blendFunc(Gl.SRC_ALPHA, Gl.ONE_MINUS_SRC_ALPHA);
    Gl.depthMask(false);
    if (this.OverlayGeo.TranslucentVertexCount > 0) {
      Gl.bindVertexArray(this.TransVao);
      Gl.drawArrays(Gl.TRIANGLES, 0, this.OverlayGeo.TranslucentVertexCount);
    }

    // 4. Advected Flow Tracer Particle Ribbons & Glowing Heads
    if (this.ParticleBuffers.TrailVertexCount > 0) {
      Gl.useProgram(this.TrailProg);
      Gl.uniformMatrix4fv(Gl.getUniformLocation(this.TrailProg, "uViewProj"), false, ViewProj);
      Gl.bindVertexArray(this.TrailVao);
      Gl.drawArrays(Gl.TRIANGLES, 0, this.ParticleBuffers.TrailVertexCount);
    }

    if (this.ParticleBuffers.HeadCount > 0) {
      Gl.blendFunc(Gl.SRC_ALPHA, Gl.ONE);
      Gl.useProgram(this.HeadProg);
      Gl.uniformMatrix4fv(Gl.getUniformLocation(this.HeadProg, "uViewProj"), false, ViewProj);
      Gl.uniform1f(Gl.getUniformLocation(this.HeadProg, "uDpr"), this.Dpr || 1);
      Gl.bindVertexArray(this.HeadVao);
      Gl.drawArrays(Gl.POINTS, 0, this.ParticleBuffers.HeadCount);
    }

    Gl.depthMask(true);
    Gl.disable(Gl.BLEND);
    Gl.bindVertexArray(null);
  }

  _RenderPaneHud(Ctx, Pane) {
    const Aspect = Pane.W / Math.max(1, Pane.H);
    const Vecs = ComputeCameraVectors(this.Camera, Pane.Mode);
    const ViewProj = MulMat4(BuildProjMatrix(Vecs, Aspect), BuildViewMatrix(Vecs));

    if (this.SplitView) {
      Ctx.fillStyle = "rgba(18, 20, 24, 0.78)";
      Ctx.strokeStyle = "rgba(255,255,255,0.1)";
      Ctx.beginPath();
      Ctx.roundRect(12, 12, 86, 22, 11);
      Ctx.fill();
      Ctx.stroke();
      Ctx.fillStyle = "#cfd4dc";
      Ctx.font = "500 10px 'DM Sans', sans-serif";
      Ctx.fillText(Pane.Label.toUpperCase(), 24, 26);
    }

    // Force Generator Callouts
    if (this.ShowLabels && Array.isArray(this.OverlayGeo.Labels)) {
      for (const Lbl of this.OverlayGeo.Labels) {
        const Sc = ProjectWorldToScreen(Lbl.Center, ViewProj, Pane.W, Pane.H);
        if (!Sc || Sc.X < -40 || Sc.X > Pane.W + 40 || Sc.Y < -20 || Sc.Y > Pane.H + 20) continue;
        const Text = `${Lbl.Name} · ${Lbl.Strength.toFixed(1)} ${Lbl.Unit}`;
        Ctx.font = "500 10.5px 'DM Sans', sans-serif";
        const Tw = Ctx.measureText(Text).width;
        const Bx = Math.round(Sc.X + 12), By = Math.round(Sc.Y - 22);
        Ctx.fillStyle = Lbl.Selected ? "rgba(38, 30, 18, 0.88)" : "rgba(16, 18, 22, 0.80)";
        Ctx.strokeStyle = Lbl.Selected ? "rgba(255, 180, 84, 0.72)" : "rgba(255, 255, 255, 0.14)";
        Ctx.lineWidth = 1;
        Ctx.beginPath();
        Ctx.roundRect(Bx, By, Tw + 20, 20, 10);
        Ctx.fill();
        Ctx.stroke();

        Ctx.fillStyle = Lbl.Active ? Lbl.Color : "#686c73";
        Ctx.beginPath();
        Ctx.arc(Bx + 9, By + 10, 3.2, 0, Math.PI * 2);
        Ctx.fill();

        Ctx.fillStyle = Lbl.Selected ? "#ffe4b8" : "#d8dde6";
        Ctx.fillText(Text, Bx + 16, By + 13.5);
      }
    }

    // Probe Screen Reticle
    if (this.ShowProbe && Array.isArray(this.ProbePos)) {
      const Ps = ProjectWorldToScreen(this.ProbePos, ViewProj, Pane.W, Pane.H);
      if (Ps) {
        Ctx.strokeStyle = "rgba(96, 245, 206, 0.88)";
        Ctx.lineWidth = 1.25;
        Ctx.beginPath();
        Ctx.arc(Ps.X, Ps.Y, 8, 0, Math.PI * 2);
        Ctx.stroke();
      }
    }

    // Drag-and-Drop Spawn Ring Preview
    if (this.DropPreviewPos) {
      const Ds = ProjectWorldToScreen(this.DropPreviewPos, ViewProj, Pane.W, Pane.H);
      if (Ds) {
        Ctx.strokeStyle = "rgba(74, 168, 255, 0.9)";
        Ctx.lineWidth = 2;
        Ctx.setLineDash([4, 3]);
        Ctx.beginPath();
        Ctx.arc(Ds.X, Ds.Y, 18, 0, Math.PI * 2);
        Ctx.stroke();
        Ctx.setLineDash([]);
      }
    }

    // 3D Transform Gizmo on Selected Force
    if (this.ShowGizmo && this.SelectedNode) {
      const Pos = this.SelectedNode.Position || [0, 0, 0.9];
      const Radius = ComputeGizmoWorldRadius(Pos, Vecs.Position, this.Camera.FovDeg * DEG_TO_RAD, Vecs.OrthoHalfHeight);
      const C = ProjectWorldToScreen(Pos, ViewProj, Pane.W, Pane.H);
      if (C) {
        const Highlight = this.ActiveHandle || this.HoveredHandle;
        const Axes = [
          { Handle: GizmoHandle.TranslateX, Tip: [Pos[0] + Radius, Pos[1], Pos[2]], Color: "#ef5b5b", Tag: "X" },
          { Handle: GizmoHandle.TranslateY, Tip: [Pos[0], Pos[1] + Radius, Pos[2]], Color: "#54d678", Tag: "Y" },
          { Handle: GizmoHandle.TranslateZ, Tip: [Pos[0], Pos[1], Pos[2] + Radius], Color: "#5ca4ff", Tag: "Z" },
        ];
        for (const A of Axes) {
          const Tip = ProjectWorldToScreen(A.Tip, ViewProj, Pane.W, Pane.H);
          if (!Tip) continue;
          const IsHot = Highlight === A.Handle;
          Ctx.strokeStyle = IsHot ? "#ffd670" : A.Color;
          Ctx.lineWidth = IsHot ? 3.2 : 2.1;
          Ctx.beginPath();
          Ctx.moveTo(C.X, C.Y);
          Ctx.lineTo(Tip.X, Tip.Y);
          Ctx.stroke();

          const Ang = Math.atan2(Tip.Y - C.Y, Tip.X - C.X);
          Ctx.fillStyle = IsHot ? "#ffd670" : A.Color;
          Ctx.beginPath();
          Ctx.moveTo(Tip.X + Math.cos(Ang) * 4, Tip.Y + Math.sin(Ang) * 4);
          Ctx.lineTo(Tip.X - Math.cos(Ang - 0.45) * 9, Tip.Y - Math.sin(Ang - 0.45) * 9);
          Ctx.lineTo(Tip.X - Math.cos(Ang + 0.45) * 9, Tip.Y - Math.sin(Ang + 0.45) * 9);
          Ctx.closePath();
          Ctx.fill();

          Ctx.font = "600 10px 'DM Sans', sans-serif";
          Ctx.fillText(A.Tag, Tip.X + Math.cos(Ang) * 9 - 3, Tip.Y + Math.sin(Ang) * 9 + 3);
        }

        const CenterHot = Highlight === GizmoHandle.PlaneXY;
        Ctx.fillStyle = CenterHot ? "rgba(255, 214, 112, 0.35)" : "rgba(255, 255, 255, 0.14)";
        Ctx.strokeStyle = CenterHot ? "#ffd670" : "#e2e6ee";
        Ctx.lineWidth = 1.6;
        Ctx.beginPath();
        Ctx.arc(C.X, C.Y, 9, 0, Math.PI * 2);
        Ctx.fill();
        Ctx.stroke();
      }
    }

    // Bottom-Right Orientation Triad (View Axis)
    const TriadCx = Pane.W - 44, TriadCy = Pane.H - 44;
    const TriadAxes = [
      { V: [Dot3([1, 0, 0], Vecs.Right), -Dot3([1, 0, 0], Vecs.Up)], Col: "#df6b6b", Label: "X" },
      { V: [Dot3([0, 1, 0], Vecs.Right), -Dot3([0, 1, 0], Vecs.Up)], Col: "#69c97a", Label: "Y" },
      { V: [Dot3([0, 0, 1], Vecs.Right), -Dot3([0, 0, 1], Vecs.Up)], Col: "#6aa4f2", Label: "Z" },
    ];
    for (const A of TriadAxes) {
      const Ex = TriadCx + A.V[0] * 24;
      const Ey = TriadCy + A.V[1] * 24;
      Ctx.strokeStyle = A.Col;
      Ctx.lineWidth = 1.6;
      Ctx.beginPath();
      Ctx.moveTo(TriadCx, TriadCy);
      Ctx.lineTo(Ex, Ey);
      Ctx.stroke();
      Ctx.fillStyle = A.Col;
      Ctx.font = "500 9.5px 'DM Sans', sans-serif";
      Ctx.fillText(A.Label, Ex + A.V[0] * 7 - 3, Ey + A.V[1] * 7 + 3);
    }
  }

  Destroy() {
    this.ResizeObs.disconnect();
  }
}
