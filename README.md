# Frontier — Realtime WebGPU Cloth Studio

A browser-based clothing simulator in the spirit of Substance Designer's show editor:
**the material / pattern editor on the left, the live simulation on the right.**

The dress is generated from a parametric pattern block, draped onto a procedural
mannequin, and simulated in real time by an XPBD cloth solver written entirely in
**WebGPU compute shaders**. The cloth is rendered with a procedural fabric shader
(weave, prints, sheen) driven by the same parameters shown in the swatch preview.

```
┌──────────────────────────┬────────────────────────────────────────┐
│  MATERIAL EDITOR         │            SIMULATION                  │
│  ─────────────────────   │   WebGPU render pass                   │
│  live 2D fabric swatch   │   · procedural mannequin               │
│  pattern / colour /      │   · dress mesh straight out of the     │
│  weave / roughness       │     GPU cloth solver (storage buffer)  │
│  dress block + pleats    │   · orbit camera, studio lighting      │
│  physics + mannequin     │                                        │
└──────────────────────────┴────────────────────────────────────────┘
```

## Run it

```bash
npm run dev            # http://localhost:5173  (bound to 0.0.0.0)
```

Open it in a WebGPU-capable browser — Chrome/Edge 113+, Safari 26+, or
Firefox 141+ (WebGPU enabled). No build step: the app is plain ES modules,
served by a dependency-free static server.

## What you can do

**Material tab** — pick one of 12 fabric presets (Indigo Silk, Red Tartan, Gold
Damask, Houndstooth Wool, Black Lace, Sunset Ombré, Denim Twill, …) or author your own:
9 generator types (solid, stripes, plaid, polka, damask, houndstooth, floral, lace,
ombré) with scale/rotation/width, three colour roles, a micro-weave bump, dye
variation, roughness and sheen. The 2D swatch is the same WGSL `evalFabric`
function the dress uses, so what you see is what you wear. Overlays let you stack
layers like a node graph.

**Dress tab** — 9 pattern-block styles (A-line, ball gown, mermaid, shift, empire,
tiered, wrap, goddess, tunic), 6 necklines, length, flare, body ease, fit tightness,
neckline depth, hem sweep, pleat count/depth, straps with width and inset, and the
cloth resolution. Everything rebuilds in well under a frame.

**Physics tab** — XPBD compliance for stretch / shear / bending / seams, areal
density (kg/m²), gravity, wind speed + direction + gustiness, air drag, damping,
collision thickness, body friction, bounciness, substeps and solver iterations.
`Drop from body` releases the pins and the dress falls to the floor; press it again
and it glides back onto the mannequin.

**Body tab** — the mannequin is fully procedural: height, shoulder width, bust,
waist, hips, bust height, arm angle, leg stance, surface detail.

**Scene tab** — key light azimuth/intensity, ambient, time scale, camera presets,
and **Dance**, which animates the body and lets the solver drag the skirt around.

## How it works

### Geometry (`src/body.js`, `src/dress.js`)

The mannequin is two analytic primitives: a **loft** of superellipse rings with
front/back bulges (crotch → hips → waist → bust → shoulders → neck → head) and
tapered **capsules** for arms, hands and legs. The rendered mesh and the collision
volume are the *same* surface, so the cloth can neither sink in nor float off.

The dress is sampled on a cylindrical grid: each column is an angle θ, each row is
a height `lerp(topHem(θ), bottomHem(θ), t)`, and the radius is

```
r(θ, t) = bodySurface(y, θ) · fit + ease(t) + flare(t)
```

with pleats displacing θ, tiers modulating the radius, and trains / asymmetric hems
modulating the bottom edge. Straps are separate islands whose samples are lifted
over the shoulder ridge with a `bodyCeiling` query and stitched to the bodice.

### Simulation (`src/shaders.js`, `src/physics.js`)

Constraints are analytic — no spatial hashing needed:

| type | pairs | purpose |
|------|-------|---------|
| 0 | `(r,c)-(r,c+1)`, `(r,c)-(r+1,c)` | in-plane stretch (the tube seam wraps) |
| 1 | both quad diagonals | shear |
| 2 | skip-one neighbours | bending stiffness |
| 3 | strap end → bodice top | seams |

Each frame, per substep: `PREDICT` (gravity + per-face wind + damping) →
`CLEAR_LAMBDA` → `SOLVE_CONS × iterations` (XPBD, pins re-applied every *N*
iterations) → `COLLIDE` (analytic loft + capsule projection, floor plane, friction
via a `prev` adjustment) → `FINALIZE`. Roughly 44 k constraints at 96×76 for a
mid-size dress, all on the GPU.

### Rendering

The dress is drawn *directly* from the solver's storage buffer: the vertex shader
reads the simulated positions at `vertex_index` and derives normals from the grid
neighbours, so no CPU readback ever happens. The fabric shader evaluates the
procedural pattern per pixel, adds a twill weave micro-normal, and shades with
GGX + sheen + fold shading.

## Project layout

```
index.html          editor-left / viewport-right shell
server.mjs          static dev server (no dependencies)
src/
  main.js           app wiring: UI, camera, dance rig, fixed-step loop
  app.js            WebGPU device, pipelines, buffers, solver passes, renderers
  shaders.js        all WGSL: fabric library, 7 compute kernels, 3 render pipelines
  body.js           procedural mannequin + surface queries
  dress.js          parametric dress generator (9 styles × 6 necklines)
  physics.js        constraint graph + GPU state packing
  fabric.js         fabric state, presets, uniform packing
  ui.js             control-panel widgets
  math.js           vec3 / mat4 / helpers
tools/
  validate.mjs         geometry + data-pipeline checks
  wgsl-check.mjs       shader parsing, JS <-> WGSL struct contract, solver contract
  sim-test.mjs         CPU mirror of the GPU solver: projection accuracy + stability
  gpu-mock.mjs         validating WebGPU mock (bind groups, usages, draws)
  app-smoke.mjs        boots the studio against the mock, steps and renders
  ui-smoke.mjs         builds every control-panel widget in a stubbed DOM
  software-render.mjs  CPU port of the fabric shader -> PNG previews
  preview.mjs          ASCII silhouette dump for quick geometry checks
renders/               PNG previews produced by tools/software-render.mjs
```

## Tests

A browser is not needed to run the suite — the GPU layer is verified against a
validating WebGPU mock and the shaders are mirrored on the CPU.

```bash
npm test            # all five suites
npm run validate    # body/dress/constraint/state data checks, all 9 styles x 6 necklines
npm run check:wgsl  # every shader parses; JS <-> WGSL struct layout contract; binding counts
npm run test:sim    # collision projection accuracy + 150 frames of XPBD
npm run test:gpu    # boots the studio against a validating WebGPU mock and steps/renders
npm run test:ui     # builds every control-panel widget in a stubbed DOM
```

* **validate** — mannequin surface queries, dress generation for all 54 style
  combinations, constraint-graph and state packing, strap clearance against the
  analytic body, fabric uniform packing, mat4 maths.
* **wgsl-check** — parses every WGSL source with `wgsl_reflect`, proves the byte
  offsets in `src/layout.js` match the structs the shaders declare (member for
  member, not just the total size), checks `@binding` contiguity and that each
  shader binds exactly what `app.js` binds, and asserts the solver-loop
  invariants (predict integrates, collide folds friction into `prev`, ...).
* **sim-test** — CPU mirror of the compute shaders: the projection lands exactly
  on the analytic surface, no vertex ever penetrates the figure, pins hold to
  < 1 mm, and the hem never sinks through the floor. `VERBOSE=1` prints telemetry.
* **app-smoke** — `tools/gpu-mock.mjs` validates every bind group, buffer usage,
  uniform size, vertex layout, dispatch shape and draw call against the parsed
  shaders, then rebuilds all 54 dress variants and runs the dance rig.
* **ui-smoke** — constructs every widget in every tab against a stubbed DOM.

## Offline previews

Because the WGSL fabric and lighting shaders are mirrored in JavaScript, the
garment can be rendered (and looked at) without a GPU:

```bash
npm run render -- renders/dress.png three      # also: front | side | close | full
STYLE=ballgown PRESET="Indigo Silk" npm run render -- renders/gown.png front
npm run preview -- side                        # quick ASCII silhouette
```

`tools/software-render.mjs` implements the same `evalFabric` / GGX / sheen
pipeline as the shaders and writes a PNG (see `renders/`), while
`tools/gpu-mock.mjs` makes `npm run test:gpu` a real integration test instead of
a stub.

## Notes

- GPU solver writes to shared vertices are non-atomic, so the result is
  non-deterministic frame to frame (like most real-time GPU cloth solvers); it is
  stable and visually identical, just not bit-reproducible. The CPU mirror is the
  reference for correctness.
- Everything runs on the GPU: no per-frame CPU readback, no tesselation on the
  main thread, and the geometry only rebuilds when you move a structural slider.
