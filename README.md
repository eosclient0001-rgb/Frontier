# Terrain Forge

A browser-based, GPU-accelerated **terrain authoring studio** built on **WebGPU**.
It generates photoreal landscape heightfields from a *layer stack* (no node
graphs), then bakes physically-based surface coverage on top — a workflow
modelled on QuadSpinner's Gaea, with an editor UI in the spirit of the
[Frontier](https://github.com/SultanAladin/Frontier-) `Experimental/FrontierEditor`
prototype: an outliner on the left, an inspector + layer stack on the right, and
a sliding **Construct** dialog for adding layers.

```
terrain-forge/
├── index.html              # app shell (outliner · viewport · inspector)
├── css/editor.css          # full design system (dark, DM Sans, 284 | 1fr | 428)
└── js/
    ├── icons.js            # inline SVG icon set
    ├── util.js             # DOM helpers, PNG encoder (deflate + stored fallback)
    ├── state.js            # layer catalogue, params, presets, project (de)serialisation
    ├── wgsl.js             # compute WGSL: noise, layer eval, erosion, AO, splat bake
    ├── render-wgsl.js      # render WGSL: atmosphere, sky, terrain, water, composite
    ├── engine.js           # WebGPU engine: pipelines, simulation, render loop, exports
    ├── ui.js               # outliner / layer stack / inspector / Construct dialog
    └── main.js             # bootstrap: wires engine + UI, autosave, render loop
```

No build step, no dependencies. Serve the folder over HTTP and open it in a
WebGPU-capable browser (Chrome/Edge 113+, Safari 18+, or Firefox with
`dom.webgpu.enabled`).

## Running

```bash
python3 -m http.server 5173 --bind 0.0.0.0
# then open http://localhost:5173/
```

The app needs a secure context for `navigator.gpu` — `localhost` counts as
secure. Projects autosave to `localStorage` and can be exported/imported as
`.terrain` JSON files.

## Workflow

1. **Terrain** — the stack evaluates bottom → top. Each layer is one of 22
   types (shapes: mountain, hills, dunes, canyon, volcano, plateau, craters,
   archipelago, perlin, worley, gradient, constant, warp; modifiers: smooth,
   terrace, levels, clamp, detail, slant, curvature; erosion: hydraulic,
   thermal) with its own parameters, weight and blend mode
   (mix/add/sub/mul/max/min/screen).
2. **Hydraulic erosion** — Mei et al. virtual pipes (flux → capacity → erode /
   deposit) with optional hardness mask and thermal slumping, simulated in
   chunks so the progress bar stays live.
3. **Texture** — a second layer stack of up to 8 materials, masked by height,
   slope, noise, flow accumulation and ambient occlusion. Weights are baked to
   two `rgba8unorm` maps and previewed live in the inspector.
4. **Environment** — sun direction (interactive gizmo), illuminance, colour
   temperature, single-scattering atmosphere (Rayleigh + Mie), aerial
   perspective, water plane, world size, peak elevation, simulation resolution
   (512²–4096²) and camera FOV.
5. **Export** — 16-bit grayscale heightmap PNG, splat/coverage PNG(s) and a
   full-resolution viewport capture.

## Rendering

* Analytic single-scattering atmosphere (Hillaire) shared by the JS sky-lighting
  model and the WGSL sky/terrain shaders.
* 2048² PCF shadow map from an orthographic sun fit to the world extent.
* Terrain mesh displaced from the height texture in the vertex shader
  (513² or 1025² grid, chosen from the simulation resolution).
* 8-layer PBR shading with triplanar-free procedural detail, curvature-aware
  normals, horizon-based AO and flow-driven riverbed darkening.
* Water plane with depth-buffer refraction, ripple detail and shoreline foam.
* Post: FXAA → ACES filmic tonemap → exposure, vignette and grain.
* Debug view modes: Shaded, Albedo, Normals, Height, Slope, AO, Flow, Splat.

## Controls

| Input | Action |
| --- | --- |
| Drag | Orbit |
| Shift + drag / right-drag | Pan |
| Wheel | Zoom |
| `Shift` + `A` | Open the Construct (add layer) dialog |
| `Esc` | Close the dialog |
| `R` | Reset the camera |

## Notes

* Simulation textures are `r32float` ping-pong pairs; every layer is one
  compute dispatch with a cached pipeline, so editing a parameter only
  re-evaluates that layer's downstream chain.
* Uniform layouts are mirrored between JS and WGSL (texture layers are packed
  as `array<vec4f, 24>` so array strides stay unambiguous across
  implementations).
* If WebGPU is unavailable the workspace still renders and shows an explanatory
  card in the viewport.
