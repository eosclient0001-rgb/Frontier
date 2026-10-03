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
  validate.mjs      geometry + data-pipeline checks
  wgsl-check.mjs    parses every shader (wgsl_reflect) and verifies struct layouts
  sim-test.mjs      CPU mirror of the GPU solver, projection accuracy + stability
```

## Tests

```bash
npm test            # all three suites
npm run validate    # body/dress/constraint/state data checks, all 9 styles
npm run check:wgsl  # every WGSL shader parses; struct sizes match the JS packing
npm run test:sim    # collision projection accuracy + 150 frames of XPBD
```

`sim-test.mjs` mirrors the shaders on the CPU and asserts that the collision
projection lands exactly on the analytic surface (0.00 mm error), that cloth never
penetrates the mannequin, that pins hold to < 1 mm, and that the dress settles to
its authored silhouette. Use `VERBOSE=1 npm run test:sim` for per-frame telemetry.

## Notes

- GPU solver writes to shared vertices are non-atomic, so the result is
  non-deterministic frame to frame (like most real-time GPU cloth solvers); it is
  stable and visually identical, just not bit-reproducible. The CPU mirror is the
  reference for correctness.
- Everything runs on the GPU: no per-frame CPU readback, no tesselation on the
  main thread, and the geometry only rebuilds when you move a structural slider.
