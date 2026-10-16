# SolidArc — recovered UI, GPU viewport

This is the approved browser UI recovered from `arena/215a6f39-frontier`, commit
`f2cfc57daaaf1fafc9a01a2002af6cad8cbd0f0f`. Its stylesheet is unchanged. The outliner,
inspector, catalogue, history, document tabs and original C++ gizmo are reused, not redesigned.

## Run the current preview

From this directory, with Node 22.12+, Python 3, a C++20 compiler, and `gh` available:

```sh
npm ci
npm run build:native
npm run dev:native                 # terminal 1: native geometry service, port 8081
npm run dev -- --port 5176         # terminal 2: browser UI
```

Open the **5176** preview, not the geometry service. The browser uses relative `/native`
requests through Vite's proxy; it never tries to reach the user's computer through localhost.
The server binds `0.0.0.0`. Native objects, logs and proof images belong in ignored
`_AgentScratch/`, not Git. The JSON dependency is bootstrapped from nlohmann/json v3.12.0,
immutable commit `55f93686c01528224f448c19128836e7df245f72`, with a checked SHA-256.

This is a **development transport**, not a production multi-user CAD server. Each browser
session gets its own C++ process/document set. Requests are serialized, same-origin input
is checked, page exit requests session cleanup, and inactive sessions expire on later requests.
Native command input is trusted local development input, not a sandbox for untrusted users.
A deployed static build still needs a same-origin geometry service/reverse proxy.

## Empty startup, recovery and drawing

Fresh documents are now empty. Recoverable browser storage offers Welcome back / Continue
previous / New document, with a previous-copy restore action in Construct. Sketch tiles arm
click-to-locate/click-to-size tools with GPU rubber bands and spatial DM Sans dimensions;
final geometry is one native C++ ToolSession transaction. Background autosave returns only
the `.arc` journal, not a scene packet. See [WORKFLOW.md](WORKFLOW.md) for both HTML and native
C++ behavior, controls, tests and explicit remaining gaps. The unchanged published-source
reference is retained alongside this editor in [Reference/](Reference/README.md).

## What runs where

* **C++:** actual geometry/B-rep/NURBS kernel, tessellation, document state, original analytic
  gizmo, canonical camera state and selection/undo/save/export logic. Camera-only browser
  prediction mirrors the C++ projection math; modeling and gizmo transforms remain native.
* **WebGL2:** surface triangles, instanced screen-space line/point quads, analytic grid shader,
  native gizmo/overlay streams, depth and identity targets, 1-sample interactive / up-to-4x idle rendering, GPU resolve
  and final display transfer. HTML/CSS panels remain the approved browser UI.
* **Shared shaders:** `ShaderCodec.js` imports the real `Presentation/Shaders/*.slang` bodies
  and translates their small shared vocabulary into GLSL ES 3. The CPU reference compiles
  these same bodies as C++. `DisplayTransfer.slang` applies the original display curve once,
  after linear-light blending/resolve.
* **No CPU display-image upload:** native responses carry vertex/index/style/matrix data,
  not RGBA frames. GPU texture allocation passes `null`, not a CPU image. Single-pixel ID
  readback handles clicks; a small overlay-neighborhood readback gates native gizmo starts; explicit box selection reads/compresses a GPU identity plane.
  Full display readback is used only by verification, never production presentation.

The default native transport uses asynchronous `NativeChannel` HTTP calls directly; it does not create a browser Worker. Native computation already runs in a separate C++ process. This avoids embedded-preview Worker incompatibilities entirely. The optional future WASM route retains a versioned worker handshake. Development responses disable caching; malformed or legacy pixel packets are rejected before rendering.

The adapter/driver appears in the render-status tooltip and `window.solidArcGraphics`.
SwiftShader/llvmpipe are explicitly labeled **software driver**. Those drivers exercise the
real graphics API/shaders but are not evidence of physical GPU acceleration. No CPU renderer
fallback is selected when WebGL2/shader/device initialization fails.

## Viewport performance repair

The measured startup scene is **4,410 triangles and 1,350 segments**, not millions of
polygons. The grid is a GPU fullscreen triangle with procedural shading, not a giant line mesh.
The earlier integration unnecessarily serialized camera motion through native HTTP, rebuilt
full draw packets and uploaded geometry again. Responses were approximately **0.6 MB**;
native preparation plus the local process pipe alone took approximately **29–32 ms**, before
browser/network latency. Moving rasterization onto WebGL did not fix that architectural mistake.

Camera motion now runs on browser animation frames over retained vertex/index buffers.
Only camera uniforms change; an idle/end synchronization sends the final camera to C++.
Epoch/document guards reject stale refreshes. Picking is lazy, with no GPU readback during
ordinary camera dragging. Unchanged idle hover does not redraw. Shared-shader matcap studios
are baked once **on the GPU** into a texture array when float render targets are supported;
otherwise the shared analytic GPU shader remains the fallback. No CPU image is uploaded.

`verify:performance` compares 12 camera cases against actual C++ matrices (maximum measured
relative error **4.14e-9**), then exercises default left-button orbit with **800 ms artificial
network latency**. The latest run submitted 60 frames with **zero HTTP/native requests,
zero vertex uploads and zero GPU readbacks during the drag**. Final native camera sync
error was zero; 20 unchanged hover events caused zero redraws. With `BROWSER_ARTIFACTS` set,
it writes `SolidArcPerformance.json` in that directory.

**This is not a 60-fps claim.** The headless runner reports ANGLE/SwiftShader, not a physical
GPU. The latest concurrent-suite run took 8,493.4 ms for those 60 submissions (~7 fps);
an earlier isolated run took 5,506.5 ms (~11 fps). These establish removal of network/upload
work from camera motion, not physical-GPU or embedded-preview frame rate. The outstanding
headless/software/compositor cadence is not isolated. Native CAD-transform gizmo edits still
make serialized native requests and are latency-bound. View-dependent native gizmo/helper
geometry is reprojected during local motion and regenerated on the native idle refresh.

## Verification

With both development servers running and a Playwright-compatible Chromium installed:

```sh
npm test                          # freshly compiled C++ transport: 17 tests; examples + all 22 tools
npm run verify:workflow           # 9 empty/recovery/staged-drawing groups
npm run verify:browser            # 12 original UI/integration groups, now GPU presentation
npm run verify:interaction        # 8 mouse/camera/gizmo/catalogue groups
npm run verify:gpu                # 8 device/picking/resource/appearance groups
npm run verify:performance        # C++ camera parity / delayed-network orbit / idle-hover redraws
npm run test:transport            # 6 packet-contract checks
npm run verify:transport          # worker-disabled startup / malformed response / unavailable backend regressions
npm run build
```

Browser commands accept `SOLIDARC_URL` (default `http://127.0.0.1:5173/`),
`BROWSER_EXECUTABLE`, and `BROWSER_ARTIFACTS`. For the commands above on port 5176,
set `SOLIDARC_URL=http://127.0.0.1:5176/`.

`verify:gpu` instruments actual WebGL draw/texture-upload and Canvas2D image calls; it
checks colour changes, different box-selection regions, control-pole picks, full
`0xfedcba98` identity round-trip, resize/cleanup and GL/browser errors. It emits an honest
adapter report and optional screenshot. Browser tests here were run on **SwiftShader**.

The native standalone CMake build also contains `CommandVerification`: a C++ headless
counterpart checking the real scene/gizmo device vocabulary, no CPU readback image,
coordinate-specific picking, identity runs, control points and resize. The existing native
editor CPU proof remains available through `Tools/Build/RunSolidArcEditorProof.py`.

Captured evidence from this session is in the ignored `Exhibits/Gallery/Editor/` folder:
`SolidArcBrowserGpu.png`, `SolidArcBrowserCpuReference.png`, and `SolidArcGpuMetrics.json`.
The CPU browser image is the unchanged recovered reference, not a new WASM build.

## WebAssembly status — do not mistake the retained reference for GPU output

`Runtime/GeometryModule.{js,wasm}` is the recovered **legacy CPU reference**, not a newly
built GPU command module. The default native transport does not initialize it.
`npm run test:reference` explicitly tests that retained reference; its results are not
validation of the new native command module.

The source supports rebuilding the same command bridge with Emscripten:

```sh
EMXX=/path/to/em++ npm run build:wasm
VITE_SOLIDARC_TRANSPORT=wasm npm run dev
```

That build was **not run here** because an Emscripten SDK was unavailable. The WASM route
requires the new `RenderCommands` export and refuses the old module rather than falling
back to its CPU raster. A standalone browser-only GPU artifact is therefore still pending.
Vite may emit the retained reference as an unused dynamic-import asset in a native build;
its presence does not mean it is executed.

A native Vulkan renderer and its corrected publishing workflow remain separate unfinished
work. This browser WebGL2 implementation is not being presented as native Vulkan.
