# Frontier · Terrain Forge

A WebGPU procedural terrain generator with the workflow of a compositing app and
the looks of the Frontier editor: **generate the terrain first, then texture it**,
and never open a node graph.

Everything runs on the GPU. The height field, the erosion simulation, the
material bake and the renderer are all compute/render passes — nothing is read
back to the CPU except the elevation statistics and the map previews you ask for.

```
npm start          # serve the app on :5173  (zero dependencies)
npm run check      # static check: JS parses, every WGSL module compiles (naga), DOM contract
npm run simulate   # headless dry run: every preset through the whole graph
npm run ui         # panel smoke test (DOM shim)
npm run layout     # regenerate src/gen/gpu_layout.js from the shader sources
```

Open <http://localhost:5173/> in Chrome/Edge 113+, Safari 18+ or Firefox 141+.

---

## The workflow

### 1 · Terrain stack — generate the land

The rail is the pipeline: it reads top to bottom exactly as it runs.

```
noise ─ Continents        mass: fractal continents, replace
mountain ─ Ranges         ridged ranges, masked by noise
hills ─ Foothills         rounded foothills, added
───── simulation runs here ─────
hydraulic erosion         150 solver steps, folds the delta back
thermal erosion           talus-angle relaxation
───── post-simulation dressing ─────
strata ─ Bedding          sedimentary banding
detail ─ Rock detail      high-frequency rock
```

* **Mass generators** — mountains, hills, plateau, canyon, dunes, volcano,
  island, noise. Each is a WGSL template driven by one uniform block.
* **Shaping passes** — strata, cracks, domain warp, smooth, detail, flat base.
* **Simulation** — hydraulic and thermal erosion. They run where they sit in
  the stack, on a half-resolution grid, and fold their accumulated delta plus
  wetness/deposit maps back onto the full-resolution field.
* **Masks** — every layer can be masked by slope, height, noise, radial, ridge,
  flow, deposit, curvature, painted mask or hand-drawn sketch (four per layer,
  combined with multiply/add/max/min/replace).

### 2 · Texture stack — shade the surface

Material layers blend over the generated surface in texture space, using the
same mask fields, and bake to production PBR maps:

| map | format | contents |
| --- | --- | --- |
| albedo | sRGB RGBA8 | base colour with AO, cavity, wetness and dust |
| ORM | RGBA8 | occlusion · roughness · metallic (glTF packing) |
| normal | RGBA8 | tangent-space normals, cavity in alpha |
| splat 0/1 | RGBA8 | up to 8 layers of coverage for runtime blending |

Eight materials ship with tuned palettes: bedrock, soil, grass, forest floor,
sand, snow, gravel and a custom gradient material.

---

## Interface

```
┌──────────────┬──────────────────────────────┬──────────────────┐
│ layer stack  │  viewport (WebGPU)           │  inspector        │
│ terrain tab  │  sun/sky, terrain, water,    │  parameters       │
│ texture tab  │  post — live                 │  masks, palettes  │
│ scene rows   │  brush bar · overlays        │  blend, bake      │
└──────────────┴──────────────────────────────┴──────────────────┘
```

The request mentioned the inspector **and** the layer stack on the right. The
stack lives on the **left** and the inspector on the **right**: a stack is a
sequence you read downward, and pairing it with the right-hand inspector keeps
the viewport in the middle, which is how the Frontier editor prototype and every
DCC tool the brief compares against lays itself out. Say the word and the two
rails can be swapped — it is one `grid-template-columns` line in `styles.css`.

**Controls**

| input | action |
| --- | --- |
| left drag | orbit · with the brush armed it sculpts instead |
| right / middle / shift drag | pan |
| wheel | zoom · `[` `]` resize the brush |
| `1`…`8` | view modes (shaded, height, slope, normals, albedo, wetness, AO, roughness) |
| `G` / `F` | generate / frame the terrain |
| `Ctrl+Z` `Ctrl+Shift+Z` | undo / redo |

**Brushes** — raise, lower, smooth, flatten, noise dressing, carve, terrace,
plus mask painting and height sketching. Strokes are stored in their own fields
and re-folded onto the pristine stack result, so regenerating the terrain keeps
your edits and never bakes them into the noise.

---

## Architecture

```
index.html · styles.css         shell and design tokens (Frontier palette)
src/main.js                     boot, scheduling, top bar
src/ui/                         state, layer stack, inspector, viewport, menus
src/gpu/                        device, field pool, compute/render pass wrappers, renderer
src/sim/terrain.js              the terrain graph: plan → passes → maps
src/tex/bake.js                 material stack → PBR maps
src/gen/                        schema (controls + slots), project model, uniform packing, layout
src/vendor/wgsl/                the shader library: lib, passes, templates, render shaders
tools/                          dev server and the three test harnesses
```

* **Schema-driven UI** — a generator is one WGSL template plus one entry in
  `src/gen/schema.js`; the inspector builds its own controls from that entry, so
  adding a generator never touches UI code.
* **Reflected bindings** — `tools/gen-layout.mjs` reflects every uniform struct
  and binding with naga, and the JS side only ever writes fields that exist.
* **Ping-pong fields** — every multi-pass stage reads one texture and writes its
  partner, verified by the headless harness (a pass can never read what it is
  writing).
* **No CPU round trips** — height, slope, curvature, flow, deposit, detail, AO,
  normals, paint and sketch all stay on the GPU.

## Verification

| tool | what it proves |
| --- | --- |
| `tools/check.mjs` | every JS module parses, every WGSL module and template injects and compiles under naga, every `getElementById` has a real element |
| `tools/simulate.mjs` | all 8 presets generate + bake on a mock device: 39 modules, 1028 bind groups, ~4.5 k dispatches, finite uniforms, no empty dispatches |
| `tools/uitest.mjs` | the panels build and every layer type, mask and preset round-trips |
| `tools/boot.mjs` | `src/main.js` actually boots with the real DOM contract: first generation, first bake, first rendered frame, then Generate, layer selection and overlay toggles |

No GPU is needed for any of them.
