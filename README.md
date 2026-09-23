# Frontier — Terrain Studio

A bounded kilometre-scale landscape with whole-terrain editing built from a **3D signed-distance volume**, not a heightmap. **WebGL2 is the only active renderer.** **Particle erosion, sediment transport/deposition, sculpting and distance repair run on the GPU using WebGL2 fragment passes.** A worker generates the initial volume and handles explicit connected-piece selection. Startup never probes or initializes WebGPU.

## Hydraulic terrain shaping

**Hydraulic shaping is now the default.** Moving water erodes and deposits on a live sparse XYZ field: **0.50 m cells / 1.50 m exchange width** by default, with a **0.25 m / 0.75 m** option. These dimensions stay fixed when the terrain is enlarged. Rendering, picking, sediment feedback and version-3 exports include the refinement.

**1,024 hydraulic particle slots are selected by default, adjustable up to 16,384**—real transport/exchange capacity, not extra decorative dots. More particles add authoring water and GPU work; they do not widen cuts or enlarge the bounded fine-detail pool. A sampled capacity warning identifies blocked contacts.

Use **Run**, then **Inspect surface detail** to frame an actual eroded location. For concentrated channels, select **Authored XYZ water route** and draw a route. The separate **Weather / rainfall study** retains the constrained mm/hour model; hydraulic authoring is not advertised as a few seconds of natural rain.

See [workflow, implementation, tests and limits](docs/hydraulic-shaping.md). The pool is bounded to 4,096 bricks, uses approximately 246 MiB extra GPU storage and supports at most 4 m of fine-layer displacement. No active-area box, heightmap or CPU erosion is introduced. This is not a Gaea clone or a calibrated geological solver.


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

Startup now displays worker compatibility, whole-volume generation percentage and renderer validation as separate stages. Worker calls have bounded deadlines; early module/worker load failures show the recovery panel rather than leaving the static loading screen indefinitely. Versioned worker entry files and a protocol check handle stale development workers.

Frontier does not use React or Server Components. Errors from the surrounding Arena page should be diagnosed separately by opening the preview in its own tab. A production preview (`npm run build && npm run preview`) also avoids development-module/HMR requests.

Startup renders a small **real terrain frame and reads its pixels back** before marking WebGL2 ready. Flat white/black/clear output fails that check.

- **Help** opens renderer diagnostics: WebGL version, frame statistics, GPU simulation capability, and any error. **Copy diagnostics** captures the terrain app's report.
- A lost graphics context stops rendering and opens a persistent recovery panel. **Restart WebGL2** reloads the scene; unsaved edits are lost, so export first if rendering still works.
- WebGPU is not attempted, even if the browser exposes it or an old query string requests it. Erosion uses GPU fragment/MRT/scatter passes, not WebGPU compute shaders.
- Initial resolution is conservative and the drawing buffer is pixel-budgeted. Non-finite camera uniforms are rejected before submission.
- Pixel readback tests the renderer output, not the browser/OS compositor.

## Using the studio

**Kilometre workflow:** start with a **1 × 1 km Ridge range**, or choose **New scene → Noise landscape**. In Object properties, choose Mountain / Ridge range / Rounded hills and **fBm / Ridged / Ridged multifractal / Billow / Smooth**. Adjust height, noise strength, wavelength and seed; expand **Fractal detail & footprint** for octaves, persistence, lacunarity, domain warp, footprint, heading and terracing. Press **Generate landscape**, confirm replacement, then **Erosion →** to select an agent and Run. These controls stage a draft; they do not silently reset an eroded volume. See [noise landscapes](docs/noise-landscapes.md). The entire terrain is one **128 × 80 × 128 XYZ volume**. At the default kilometre size, actual spacing is **8.06 × 4.06 × 8.06 m**. There is no blue active patch: all tools use global bounds. **Frame entire terrain** resets the view; Object properties disclose the applied spacing. See [kilometre workspaces and limits](docs/kilometre-workspaces.md).

**Satmaps & shared river routes:** the **Satmaps** category follows Fracture, with four procedural material palettes and six SDF-aware map views (flow, sediment, AO, signed curvature, elevation, slope). **Water → Draw river route** now places the same visible XYZ path used by river emission and rendered water. Edit point elevations, width and speed; every batch enters point 1. No path means no river or automatic water. See [Satmaps and route guide](docs/satmaps-and-routes.md).

**Viewport layout:** **outliner on the left, viewport in the center, properties/tools on the right**, including narrow preview windows. Panels stay docked and visible when resizing or choosing tools. Only the explicit **Outliner** / **Properties** header buttons collapse a panel; reopening always restores its original side. Panel contents scroll independently. The header reflows in narrow windows without moving either side panel. UI styles load before app initialization, and the dev watcher waits for completed stylesheet writes.

**Land-first workflow:** click **New scene → Land plot** in the left outliner → sculpt with **Ridge / Dent** → add an editable **Cut spline** → create a separate **Water spline**. Select named objects on the left; properties and tools are on the right. Cut splines really subtract from the 3D SDF; water splines steer both the rendered footprint and GPU river agents. See [the land and spline guide](docs/land-and-splines.md).

Live shapes and cuts are reversible until a destructive brush, erosion, open-gap fracture or piece removal bakes them. Ridge/Dent are surface-oriented XYZ density brushes, not height painting. Water paths have editable XYZ point elevations: they are artistic current guides, not a solved free-surface fluid.

- **Terrain:** user-parameterized noise landscapes and empty local land plots. The hardcoded canyon, badlands and monument scenes are removed. Generate replaces geometry edits; changing draft sliders alone does not.
- **Shapes / gizmo:** add ellipsoids, rounded boxes, capsules, torus rings, eggs, organic clusters or rounded cylinders with local 3D fBm, ridged/multifractal, billow, domain-warp and terracing controls. **G / R / S** select Move / Rotate / Scale gizmos; drag world-axis handles/rings; spline Y moves the real cutter and uniform scale adjusts width/depth. Plot properties include bottom, bevel and XYZ density noise. See [the volumetric object-tools guide](docs/volumetric-object-tools.md).
- **Sculpt:** build ridges and dents on any face, carve a vertical wall or tunnel, build an overhang, or smooth in XYZ. Still a bounded SDF, not a heightmap.
- **Weathering:** choose **Rain, Runoff, River, Wind, Rockfall or Chemical** in Erosion. Each has a separate incoming-size/radius/bounce preset and genuinely different motion or alteration. Loaded agents retain their material and birth properties when you switch.
- **Rain:** visible drops spawn above the entire terrain, fall under gravity, then become non-bouncing runoff. Select **Rain**, enable **Particles**, and press **Run erosion**. Pause freezes the drops.
- **Rain → runoff:** landing starts a separate 600 s travel budget with 0.1%/s runoff evaporation. Fast-flowing fines stay suspended; shallow-pit routing helps carriers continue downhill. Still water can deposit, but a moving numerical timeout no longer dumps a sediment pocket. See [runoff transport](docs/runoff-transport.md).
- **Cracks:** default **Intact cracks** marks selectable 3D Voronoi cells with hairlines but keeps the rock joined and the volume unchanged. Click a touching piece, inspect its orange highlight, then remove only that piece. Open-gap subtraction is a separate destructive option, not the default. One-edit undo restores the volume and crack map. See [the cell-fracture guide](docs/fracture-tools.md).
- **River:** starts at the bed/water band, with adjustable speed, width, depth and X-offset. Wet sediment from every agent is entrained in the guided current. It scours the bed and banks; it is not overhead rain with a new label.
- **Wind:** adjustable height, vertical spread, direction and speed; abrasive sand enters at the upwind boundary.
- **Rockfall / chemical:** impact-energy detachment produces coarse chips which statistically break down into sand/fines. Wet chemical contact produces dissolved load, without a shear threshold or sand-like deposition.
- **Sediment:** real carried sand, wet fines, coarse chips and dissolved material. Agent markers, translucent wet sediment plumes and deposited-material coloring use the GPU inventories. **Audit sediment balance** pauses and reads the ledger and composition.
- **Water:** displaced animated waves, flowing broken-up shoreline foam, depth absorption, bed refraction and SDF bank reflections. Wave height/length/speed/heading, fine ripples, foam coverage/reach/scale, reflection strength, clarity and route surface offset are adjustable. World-space procedural detail avoids repeated wave/foam textures; animation stays live while erosion is paused. See [water controls](docs/water.md). The visibility switch does not turn off transport; use **River transport** in Erosion for that.
- **Export:** saves the current volume, settings and camera as `.frontier`. It is not a mesh or resumable particle/material-layer/modifier checkpoint. Object descriptors are included, but the pre-cut live base is not.

### Clean studio workspace

The [charcoal studio interface](docs/interface.md), inspired by the supplied dark transit-map reference, keeps the **searchable outliner left, live viewport centre and grouped properties right**. Rounded charcoal cards, light typography and pill controls replace the flat OLED chrome. **New scene** is the single plot/preset chooser; **+ Add** creates shapes or splines. Visible header tabs separate Object / Sculpt / Erosion / Water / Fracture without a duplicate inspector menu. Run/Pause and Export stay in the header; Step and simulation details belong to Erosion. View contains camera/material options. Click a value pill for exact entry. Advanced controls remain in disclosures; Help contains diagnostics. One versioned stylesheet defines the layout before JavaScript starts.

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

- Whole-world grid: **128 × 80 × 128** (1,310,720 XYZ voxels), covering the complete requested terrain. No second overview volume.
- Default kilometre bounds: `[-516, -24, -516]` to `[516, 301, 516]` metres. Width, length and height independently determine voxel spacing.
- Texel centers: `min + (index + 0.5) * ((max - min) / dimensions)`.
- Four channels: signed distance, contact wetness, cumulative deposited voxel volume, solid fraction.
- **Negative distance = solid.** Positive distance = empty space.
- The GPU solver stores XYZ data in ping-pong `RGBA32F` texture atlases. Atlas tiles are **Z slices, not a heightmap**. The same 3D interpolation/CSG representation supports caves and overhangs.
- Seeded XYZ noise deforms bounded mountain/ridge/hill solids. Sculpting, shapes, caves and fractures remain genuinely volumetric.
- Rendering uses trilinear volume sampling, conservative ray marching, SDF normals, procedural normal detail, soft directional shadows, ambient occlusion, and distance haze.
- Render resolution adapts to observed throughput. GPU steps are fenced to bound the queue.
- Initial generation runs on a worker. Particle motion, sculpting, erosion, deposition, material accounting, and SDF repair execute on the GPU. There is no per-step CPU volume upload or particle/volume readback.

### Erosion model

The old local CPU weathering filter is replaced by research-informed **GPU particle transport**. The main reference is Hartley et al., _Flexible terrain erosion_ (2024), which explicitly addresses independent erosion particles and SDF/voxel terrain. [2](https://www.lirmm.fr/~nfaraj/publications/flexible_erosion/2024_Flexible_Terrain_Erosion.pdf)

Agents collide against the current SDF and detach through water shear, wind abrasion, rock impact or wet chemical reaction. They carry constituent sediment and deposit its particulate fractions as capacity drops or grains settle; dissolved material stays in solution. Compact 3D kernels distribute requests. Per-voxel clamping and feedback reconcile overlapping agents so they cannot each claim the same material. A solid-fraction ledger and local distance repair replace the old fixed-band weathering rule.

**Read [the model notes](docs/erosion-model.md)** for equations, research mapping, pass layout, conservation checks, and limitations. This is not a validated geological solver or a full water simulation. The ledger conserves **voxel occupancy**, not the exact geometric volume of the interpolated isosurface. Visible agents represent parcels, not resolved millimetre grains. Time and strength are not calibrated geological aging.

`EXT_color_buffer_float` is required for GPU erosion. If unavailable, erosion controls are disabled with an explanation—**there is no silent CPU erosion fallback**. Terrain viewing and basic manual sculpting remain available. GPU scatter uses float32 blending when supported and float16 otherwise; the audit exposes the accumulation format.

Particle markers and wet sediment plumes can be hidden independently without changing simulation. The river current is an analytic, artist-guided velocity field with SDF collision response, **not a pressure-projected fluid solve**. It follows the explicitly drawn visible XYZ route with editable width, speed and elevation; it does not discover new river networks. Wind and chemistry are heuristic, not calibrated environmental models. Exports omit particle state and the separate loose-material atlas, explicitly flagged in the header.

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

Water tests cover finite settings, exported values, and live waves/foam/optics without simulation steps. The surface is not a coupled pressure/free-surface solver.

Core unit tests cover deterministic seed variation, volume bounds, rock above a lateral cave, additive/subtractive/smoothing brushes, erosion changing distance and moisture, zero-force invariance, picking, half-float conversion, and binary export. Browser tests cover default WebGL2 startup and legacy URLs, real volume changes, controls, and export. GPU tests verify real material exchange, deposition, ledger/occupancy balance, zero-rain behavior, and no per-step worker messages or GPU readbacks. Fault-injection tests verify that WebGPU is never accessed, missing float targets disable erosion explicitly, blank WebGL2 output is rejected, and a lost WebGL2 context shows recovery.

For a custom test browser, set `CHROMIUM_PATH`. Set `SOFTWARE_GPU=1` to enable Chromium's SwiftShader WebGL testing flags. Software rendering is substantially slower than a real GPU; no real-device frame-rate claim is implied by these tests.

## Physical rain and runoff

Rain uses fresh integer-hash birth positions across the terrain. Its **2,048 rain slots** now perform actual SDF contact, hydraulic erosion and sediment transport. Landed drops continue as runoff; GPU handoff copies them into free carrier slots at the exact position, or conservatively merges them with nearby water. The primary pool defaults to 4,096 and supports 16,384 carriers.

If no safe destination exists, the drop stays as real runoff rather than disappearing. This retains water and sediment but can limit new rain under extreme saturation. Zero emission/source switching stops new rain births; pause freezes simulation. The old impact-field recharge is no longer used.

Up to **4,096 carrier markers plus 2,048 rain/runoff markers** are drawn. Transfer adds six bounded particle/bucket passes, no added full-terrain pass and no per-step CPU readback. **81 unit tests and 28 targeted browser/GPU checks passed.** See [implementation, limits and measurements](docs/continuous-rain.md).

## Downhill transport and more particles

The studio now starts with **4,096 GPU samples**, and the control supports **16,384 actual simulated particles**. Carrier display density is capped at 4,096 markers, plus up to 2,048 rain/runoff markers; higher simulation counts still cost more. Runoff now has a separate travel budget, slower evaporation, turbulence-suppressed settling and bounded shallow-pit routing. Existing geometry is not automatically healed. See [implementation, limits and checks](docs/runoff-transport.md). This update passed **80 unit tests and 25 targeted browser/GPU checks**, plus the build and production startup/step smoke check.

## Faster erosion without a larger GPU particle pool

**Erosion → Fast** is now the default for kilometre scenes. It uses **4× transport time-lapse** with **1× erodibility**; **Rapid** requests 8× / 1×. **Reference** restores 1× / 1×. Presets keep the particle count fixed and reset expensive GPU batching to one pass per update; they do not regenerate terrain.

Motion uses at most 32 collision substeps of at most 10 ms. Fine grids automatically limit the effective time-lapse to avoid skipping more than a voxel between exchanges. Rain flight, one-time landing, evaporation and birth-captured lifetimes remain in simulation seconds. The separate artistic erodibility slider is **not calibrated geological time**. For rain it cannot amplify water supply, concentration or the numerical surface-change ceiling.

The erosion/feedback shaders now gather only the compact kernel’s voxel bounds rather than scanning a fixed 729-cell cube. No extra GPU particle/volume textures or full-terrain passes are allocated for acceleration. The small particle integrator does more substeps, so GPU time is not literally free; speed-up depends on the device. See [performance implementation and checks](docs/erosion-performance.md). The performance update passed **77 unit tests and 18 targeted browser/GPU checks**, plus the production build.

## Whole-terrain validation

**74 unit tests and 10 targeted browser/GPU checks passed**, plus the production build and a standalone production startup smoke check. Coverage includes far-world screen sculpting, XYZ water placement and visible G/R/S handles, independent width/length/height regeneration, distant shapes/cuts, intact selection/removal, whole-terrain rain, elevated wind, route-only river births, conservative GPU exchange without per-step CPU transfer, rain flight/one-time impact and startup recovery. Two initial test-harness failures (one oversized software-GPU batch and exact decimal equality) were corrected and the affected checks passed on rerun. The entire historical browser suite was not rerun.

**Export terrain** now contains the complete SDF and global bounds. It still explicitly omits particle state, separate loose-material/flow atlases and live-modifier base. See [whole-terrain operation and limits](docs/kilometre-workspaces.md).
