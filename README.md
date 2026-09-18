# Frontier — Terrain Studio

A small, bounded desert-terrain sandbox built from a **3D signed-distance volume**, not a heightmap. **WebGL2 is the only active renderer.** **Particle erosion, sediment transport/deposition, sculpting and distance repair run on the GPU using WebGL2 fragment passes.** A worker generates the initial volume and handles explicit connected-piece selection. Startup never probes or initializes WebGPU.

## Run

```sh
npm install
npm run dev        # http://localhost:5173
npm run build
npm run preview
npm test           # numerical/format tests
```

Use a browser with WebGL2 and hardware acceleration enabled. The normal URL starts WebGL2 directly; no query parameter is needed. Existing `?webgl` links still work. The dev server accepts the Arena preview host. All fonts are bundled locally; there are no image textures, purchased assets, remote APIs, or runtime CDN requirements.

## Blank canvas / renderer troubleshooting

Startup renders a small **real terrain frame and reads its pixels back** before marking WebGL2 ready. Flat white/black/clear output fails that check.

- The **WebGL2 ✓** button above the viewport opens renderer diagnostics: WebGL version, frame statistics, GPU simulation capability, and any error. **Copy diagnostics** captures the terrain app's report.
- A lost graphics context stops rendering and opens a persistent recovery panel. **Restart WebGL2** reloads the scene; unsaved edits are lost, so export first if rendering still works.
- WebGPU is not attempted, even if the browser exposes it or an old query string requests it. Erosion uses GPU fragment/MRT/scatter passes, not WebGPU compute shaders.
- Initial resolution is conservative and the drawing buffer is pixel-budgeted. Non-finite camera uniforms are rejected before submission.
- Pixel readback tests the renderer output, not the browser/OS compositor.

## Using the studio

**Viewport layout:** **outliner on the left, viewport in the center, properties/tools on the right**, including narrow preview windows. Panels stay docked and visible when resizing or choosing tools. Only the explicit **Outliner** / **Properties** header buttons collapse a panel; reopening always restores its original side. Panel contents scroll independently. Short windows hide the preset strip, not the viewport. UI styles load before app initialization, and the dev watcher waits for completed stylesheet writes.

**Land-first workflow:** click **New land plot** in the left outliner → sculpt with **Ridge / Dent** → add an editable **Cut spline** → create a separate **Water spline**. Select named objects on the left; properties and tools are on the right. Cut splines really subtract from the 3D SDF; water splines steer both the rendered footprint and GPU river agents. See [the land and spline guide](docs/land-and-splines.md).

Live shapes and cuts are reversible until a destructive brush, erosion, open-gap fracture or piece removal bakes them. Ridge/Dent are surface-oriented XYZ density brushes, not height painting. Water paths currently share a horizontal level: they are artistic current guides, not sloping free-surface hydraulics.

- **Terrain:** Desert canyon, The badlands, or Monument valley. The canyon adds **Wall spacing / base gap**, **Channel bends**, and **Wall flare with height**, modifying the real XYZ SDF. Formation controls regenerate the base volume and **clear erosion, sculpting and fracture edits**.
- **Shapes / gizmo:** add ellipsoids, rounded boxes, capsules, torus rings, eggs, organic clusters or rounded cylinders with local 3D fBm, ridged/multifractal, billow, domain-warp and terracing controls. **G / R / S** select Move / Rotate / Scale gizmos; drag world-axis handles/rings; spline Y moves the real cutter and uniform scale adjusts width/depth. Plot properties include bottom, bevel and XYZ density noise. See [the volumetric object-tools guide](docs/volumetric-object-tools.md).
- **Sculpt:** build ridges and dents on any face, carve a vertical wall or tunnel, build an overhang, or smooth in XYZ. Still a bounded SDF, not a heightmap.
- **Weathering:** choose **Rain, Runoff, River, Wind, Rockfall or Chemical** in Erosion. Each has a separate incoming-size/radius/bounce preset and genuinely different motion or alteration. Loaded agents retain their material and birth properties when you switch.
- **Cracks:** default **Intact cracks** marks selectable 3D Voronoi cells with hairlines but keeps the rock joined and the volume unchanged. Click a touching piece, inspect its orange highlight, then remove only that piece. Open-gap subtraction is a separate destructive option, not the default. One-edit undo restores the volume and crack map. See [the cell-fracture guide](docs/fracture-tools.md).
- **River:** starts at the bed/water band, with adjustable speed, width, depth and X-offset. Wet sediment from every agent is entrained in the guided current. It scours the bed and banks; it is not overhead rain with a new label.
- **Wind:** adjustable height, vertical spread, direction and speed; abrasive sand enters at the upwind boundary.
- **Rockfall / chemical:** impact-energy detachment produces coarse chips which statistically break down into sand/fines. Wet chemical contact produces dissolved load, without a shear threshold or sand-like deposition.
- **Sediment:** real carried sand, wet fines, coarse chips and dissolved material. Agent markers, translucent wet sediment plumes and deposited-material coloring use the GPU inventories. **Audit sediment balance** pauses and reads the ledger and composition.
- **Water:** displaced animated waves, flowing broken-up shoreline foam, depth absorption, bed refraction and SDF bank reflections. Wave height/length/speed/heading, fine ripples, foam coverage/reach/scale, reflection strength, clarity and level are adjustable. World-space procedural detail avoids repeated wave/foam textures; animation stays live while erosion is paused. See [water and canyon controls](docs/water-and-canyon.md). The visibility switch does not turn off transport; use **River transport** in Erosion for that.
- **Export:** saves the current volume, settings and camera as `.frontier`. It is not a mesh or resumable particle/material-layer/modifier checkpoint. Object descriptors are included, but the pre-cut live base is not.

### Clean studio workspace

The [Slate-inspired interface](docs/interface.md) keeps the outliner left, viewport center and inspector right. **New scene** is the single plot/preset chooser; **+ Add** creates shapes or splines. The **inspector section menu** separates Object / Sculpt / Erosion / Water / Fracture workflows. The header owns Run/Pause; simulation details and Step belong to Erosion. A compact View menu replaces always-visible camera controls. OLED-black panels use one versioned stylesheet; diagnostics and key hints live in Help, not a permanent footer. Click a value pill for exact numeric entry. Advanced controls stay available in disclosures; Help contains renderer diagnostics.

### Unreal-style camera

Hold **right mouse** in the viewport to look and fly with **WASD**, **Q/E** and **Shift**. Release right mouse to use **G / R / S** for the selected object’s Move / Rotate / Scale gizmos. There is no bare-key camera flight, so S cannot both scale and move the camera. Orbit remains available. Flight is unconstrained by the terrain; **Home** resets the camera.

| Input                 | Action                                                             |
| --------------------- | ------------------------------------------------------------------ |
| RMB + W / A / S / D   | Forward / left / back / right, relative to view                    |
| RMB + Q / E           | World-vertical down / up                                           |
| Shift                 | 4× flight speed                                                    |
| Right drag            | Look in place, without orbiting around the old target              |
| Left drag             | Orbit or selected brush; look in place in Fly mode                 |
| Alt + left drag       | Orbit even in Fly mode / with a brush selected                     |
| Middle drag           | Pan                                                                |
| Wheel                 | Orbit zoom; change movement speed in Fly mode or while RMB is held |
| Two-finger pinch      | Orbit zoom                                                         |
| Orbit / Fly button    | Choose left-drag navigation style                                  |
| Escape                | Release mouse capture and held movement                            |
| 1 / 2 / 3 / 4 / 5 / 6 | Orbit / Carve / Build / Smooth / Ridge / Dent                      |
| Space                 | Run/pause erosion                                                  |
| G / R / S             | Move / Rotate / Scale gizmo (release RMB first)                    |
| Home                  | Reset camera                                                       |

The `?` panel includes movement speed and controls. Pointer lock is used when the browser/iframe allows it; captured right-drag remains available if permission is denied. Flight ignores UI inputs and clears held keys on blur/visibility/focus changes. Diagonal movement is normalized and frame-time based, not tied to simulation iteration speed.

## Architecture

| File                     | Responsibility                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------- |
| `src/field.js`           | Procedural formation, legacy CPU reference functions, export                                        |
| `src/worker.js`          | Initial generation; manual sculpt/pick fallback if float targets are unavailable                    |
| `src/erosion-shaders.js` | GPU particle motion, exchange, scatter, acceptance, cargo feedback, distance repair, visible agents |
| `src/gpu-erosion.js`     | GPU state, framebuffer passes, fences, readback and audit                                           |
| `src/shaders.js`         | Terrain ray marcher (old WGSL source is unused)                                                     |
| `src/renderer.js`        | WebGL2 rendering and GPU solver integration                                                         |
| `src/camera.js`          | Shared eye/view-basis math, in-place look and delta-time flight                                     |
| `src/weather.js`         | Per-emitter defaults, size limits and UI descriptions                                               |
| `src/scene-editor.js`    | Outliner, spline inspector, point placement and dragging, live modifier scheduling                  |
| `src/splines.js`         | Curve sampling, channel reference, packed flow-route texture                                        |
| `src/object-tools.js`    | XYZ gizmo, object transforms and shape inspector                                                    |
| `src/object-shaders.js`  | GPU primitive/noise/terracing composition and volumetric detail brushes                             |
| `src/volume-noise.js`    | Shared CPU/GLSL 3D fractal noise and terracing                                                      |
| `src/shapes.js`          | Shape reference, transform and ray-axis math                                                        |
| `src/spline-shaders.js`  | GPU channel subtraction and localized XYZ height deformation                                        |
| `src/flow-path-glsl.js`  | Shared nearest-route geometry, tangents and inlet sampling                                          |
| `src/main.js`            | Controls, scheduling, camera, export                                                                |

### Representation

- Grid: **112 × 72 × 112** (903,168 voxels).
- Bounds: `[-22, -4, -20]` to `[22, 22, 20]` meters.
- Texel centers: `min + (index + 0.5) * ((max - min) / dimensions)`.
- Four channels: signed distance, contact wetness, cumulative deposited voxel volume, solid fraction.
- **Negative distance = solid.** Positive distance = empty space.
- The GPU solver stores XYZ data in ping-pong `RGBA32F` texture atlases. Atlas tiles are **Z slices, not a heightmap**. The same 3D interpolation/CSG representation supports caves and overhangs.
- Signed-distance CSG builds canyon walls, lateral cavities, undercuts, and a finite sandstone bed. Procedural 3D noise and bedding supply geometric and material variation.
- Rendering uses trilinear volume sampling, conservative ray marching, SDF normals, procedural normal detail, soft directional shadows, ambient occlusion, and distance haze.
- Render resolution adapts to observed throughput. GPU steps are fenced to bound the queue.
- Initial generation runs on a worker. Particle motion, sculpting, erosion, deposition, material accounting, and SDF repair execute on the GPU. There is no per-step CPU volume upload or particle/volume readback.

### Erosion model

The old local CPU weathering filter is replaced by research-informed **GPU particle transport**. The main reference is Hartley et al., _Flexible terrain erosion_ (2024), which explicitly addresses independent erosion particles and SDF/voxel terrain. [2](https://www.lirmm.fr/~nfaraj/publications/flexible_erosion/2024_Flexible_Terrain_Erosion.pdf)

Agents collide against the current SDF and detach through water shear, wind abrasion, rock impact or wet chemical reaction. They carry constituent sediment and deposit its particulate fractions as capacity drops or grains settle; dissolved material stays in solution. Compact 3D kernels distribute requests. Per-voxel clamping and feedback reconcile overlapping agents so they cannot each claim the same material. A solid-fraction ledger and local distance repair replace the old fixed-band weathering rule.

**Read [the model notes](docs/erosion-model.md)** for equations, research mapping, pass layout, conservation checks, and limitations. This is not a validated geological solver or a full water simulation. The ledger conserves **voxel occupancy**, not the exact geometric volume of the interpolated isosurface. Visible agents represent parcels, not resolved millimetre grains. Time and strength are not calibrated geological aging.

`EXT_color_buffer_float` is required for GPU erosion. If unavailable, erosion controls are disabled with an explanation—**there is no silent CPU erosion fallback**. Terrain viewing and basic manual sculpting remain available. GPU scatter uses float32 blending when supported and float16 otherwise; the audit exposes the accumulation format.

Particle markers and wet sediment plumes can be hidden independently without changing simulation. The river current is an analytic, artist-guided velocity field with SDF collision response, **not a pressure-projected fluid solve**. It follows the configured canyon centerline with adjustable transport width/offset; it does not discover new river networks. Wind and chemistry are heuristic, not calibrated environmental models. Exports omit particle state and the separate loose-material atlas, explicitly flagged in the header.

## Engine integration / file format

`.frontier` version 2 is an uncompressed binary file (the fourth channel is now solid fraction):

1. `uint32` little-endian magic: `0x46534446`.
2. `uint32` little-endian UTF-8 JSON header length in bytes.
3. Header bytes: version, dimensions, bounds, channel names, component type, settings, camera, iterations.
4. Interleaved little-endian float32 voxel data, X-fastest: `((z * ny + y) * nx + x) * 4 + channel`.

The JSON length is not necessarily aligned to 4 bytes. Copy the payload before creating a Float32Array:

```js
const file = await response.arrayBuffer();
const view = new DataView(file);
if (view.getUint32(0, true) !== 0x46534446)
  throw new Error("Not a Frontier volume");
const jsonLength = view.getUint32(4, true);
const header = JSON.parse(
  new TextDecoder().decode(new Uint8Array(file, 8, jsonLength)),
);
const voxels = new Float32Array(file.slice(8 + jsonLength)); // little-endian hosts
// Upload to a 3D texture, or extract the zero isosurface with marching cubes / dual contouring.
```

There is currently no UI scene importer, mesh export, general undo history, or automatic persistence. The Cracks tool has a dedicated one-edit undo, invalidated by erosion, normal sculpting or regeneration. Export before regenerating if you want to preserve a sculpted volume.

Baked crack cuts and deleted chunks are part of the saved volume. The painted visual crack network is saved in `settings.cellFractureDetail`, with `intact: true` for selectable intact maps and `fractureDetailsIncluded: true`; legacy plane-detail descriptors remain in `settings.fractureDetails`. Both require matching downstream shading. Pending paint and undo snapshots are not exported.

The header uses model identifier `webgl2-multi-agent-transport-v2`, `particleStateIncluded: false` and `materialLayersIncluded: false`. The payload layout remains volume format version 2.

A small read-only diagnostic API is available at `window.frontier`: `backend`, `iterations`, copied `settings`/`camera`, async `readVolume()`, and a copied `diagnostics` report, and on-demand `auditErosion()`.

## Tests

```sh
npm test
npx playwright install chromium
npm run test:browser
```

Unit tests additionally cover flight basis/eye invariance, normalized movement, boost and weather profile ranges. Browser extensions cover actual keyboard/RMB/focus behavior, per-emitter UI memory, low river cutting and downstream sediment, wind altitude/dry abrasion, size-sensitive rock impacts, reaction-limited dissolved load, deposited composition bounds and suspended-slot cargo/species preservation.

Crack tests additionally cover reproducible 3D Voronoi sites, size/seed/variation controls, GPU-budget coarsening, grid versus hairline widths, conservative connectivity/hidden bridges, multiple disconnected cell fragments, preserved unpainted rock, no readback during GPU fracture subtraction, exact undo, and real paint/preview/select/delete interactions. Explicit chunk selection reads the current GPU volume into a worker for connectivity; this is an artist operation, not per-step CPU erosion.

Water/canyon tests additionally check real gap regeneration, meander/flare relationships, settings export, live wave/foam/optics pixel changes without simulation steps, and extreme-view rendering. The water is a procedural surface, not a coupled pressure/free-surface solve.

Core unit tests cover deterministic seed variation, volume bounds, rock above a lateral cave, additive/subtractive/smoothing brushes, erosion changing distance and moisture, zero-force invariance, picking, half-float conversion, and binary export. Browser tests cover default WebGL2 startup and legacy URLs, real volume changes, controls, and export. GPU tests verify real material exchange, deposition, ledger/occupancy balance, zero-rain behavior, and no per-step worker messages or GPU readbacks. Fault-injection tests verify that WebGPU is never accessed, missing float targets disable erosion explicitly, blank WebGL2 output is rejected, and a lost WebGL2 context shows recovery.

For a custom test browser, set `CHROMIUM_PATH`. Set `SOFTWARE_GPU=1` to enable Chromium's SwiftShader WebGL testing flags. Software rendering is substantially slower than a real GPU; no real-device frame-rate claim is implied by these tests.
