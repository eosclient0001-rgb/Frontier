# Frontier — Volumetric Fire, Smoke & Explosions (WebGPU)

Real-time GPU volumetrics in the browser: an **Eulerian fluid solver running as compute shaders over 3D
textures**, rendered by a **single-pass raymarcher** — the same structure Unreal's Niagara `Grid3D` /
FluidSim and EmberGen use, rebuilt in WGSL.

No meshes, no billboards, no pre-baked flipbooks. The flame you see is a temperature field, the smoke is
advected density, the explosion is a fuel field igniting into heat and soot, and the look comes from
blackbody emission + light scattering integrated along each view ray.

```
                 ┌──────────────── sim (compute, 3D textures) ────────────────┐
 emitter ──▶ advect ──▶ sources ──▶ curl ──▶ vorticity ──▶ divergence ──▶ jacobi×N ──▶ project
             (RK2)      (burn,      (∇×v)   (confinement)   (∇·v)        (∇²p = ∇·v)  (v -= ∇p)
                        buoyancy,
                        blast,
                        turbulence)
                 └───────────────────────────────────────────────────────────┘
                                        │
                        scalars (density, heat, fuel, embers)
                                        ▼
                    raymarch: emission + scattering + transmittance → sky
```

---

## Quick start

```bash
npm run dev          # serves the demo on http://localhost:8080
```

Then open the demo and click in the viewport to detonate something.

Requires a WebGPU browser: **Chrome/Edge 113+**, **Safari 26+**, **Firefox 141+**. On Linux you may need
Vulkan (`--enable-features=Vulkan` if your distro browser ships without it).

```bash
npm run check        # validate every WGSL shader with naga (the wgpu shader compiler)
npm test             # headless structural tests (uniform layouts, pass graph, bindings, presets)
```

## Using it as a library

```js
import { createVolumetricFX } from './src/index.js';

const fx = await createVolumetricFX({
  canvas: document.querySelector('canvas'),
  preset: 'campfire',   // campfire | explosion | inferno | smoke | jet | candle
  quality: 'medium',    // low | medium | high | ultra
});
fx.attachControls();     // orbit + zoom, click to detonate

let last = performance.now();
(function loop(now) {
  const dt = (now - last) / 1000;
  last = now;
  fx.frame(dt);          // advance the simulation and draw
  requestAnimationFrame(loop);
})(last);
```

### API

| | |
|---|---|
| `createVolumetricFX({canvas, preset, quality, autoResize})` | boots WebGPU and returns a `VolumetricFX` |
| `fx.frame(dt)` | one simulation + render step (call from rAF) |
| `fx.setPreset(name, {keepCamera})` | swap physics + look + emitters |
| `fx.setQuality(preset \| {...})` | grid resolution, pressure iterations, substeps, march steps |
| `fx.detonate({position, power})` | one-shot explosion; `position` in world space |
| `fx.emit({kind, position, fuelRate, temperatureRate, ...})` | add a custom emitter |
| `fx.attachControls({onClick})` | orbit camera + click handling |
| `fx.validateShaders()` | resolves to WGSL problems, empty when healthy |
| `fx.onDeviceError(cb)` | GPU validation errors instead of a silent black screen |
| `fx.solver.probeVolume()` | reads a small slab of the fields back to the CPU (diagnostics) |
| `fx.settings.solver` / `fx.settings.render` | live-tweakable parameters (see `presets.js`) |
| `fx.stats` | fps, grid, voxels, encode ms, render scale, substeps |

Lower level pieces are exported too: `FluidSolver`, `VolumetricRenderer`, `EmitterSystem`, `OrbitCamera`,
`Program` (WGSL reflection + pipeline/bind-group cache) and the uniform packers.

---

## How it works

### The grid (why 3D textures, not buffers)

Everything lives in **3D textures** at a power-of-two-ish resolution (64³ → 192³). WGSL can only *write*
a storage texture — never read one — inside a pass. Rather than fight that, the solver is built entirely
from `sampled texture → storage texture` pass pairs, with ping-ponged pairs for the fields that need it.
The payoff is large:

* hardware **trilinear filtering does every interpolation** in the solver for free (advection, gradient
  and divergence stencils all read interpolated values),
* the exact same textures are handed to the raymarcher — no copy, no repack.

| texture | format | channels |
|---|---|---|
| `velA` / `velB` | `rgba16float` | velocity xyz |
| `scalA` / `scalB` | `rgba16float` | density (soot), **temperature**, **fuel**, embers |
| `curl` | `rgba16float` | ω = ∇×v |
| `presA` / `presB` | `rg32float` | pressure (fp32, nearest-sampled — fp16 visibly biases the Poisson solve) |
| `div` | `rg32float` | ∇·v |
| `sdf` | `rgba16float` | obstacle distance field (debug view) |

### The passes

1. **advect** — RK2 semi-Lagrangian transport of velocity *and* scalars in one pass, sharing a single
   backtrace. Velocity is clamped and damped, walls are free-slip, obstacles zero out.
2. **sources** — the interesting one:
   * emitters inject velocity, dye, heat, fuel and embers (with noise-driven flicker; the gas inside an
     emitter core converges on the emitter velocity, so the source stays coherent at any frame rate),
   * **combustion**: `burn = fuel · smoothstep(ignition, ignition+0.5, temp)`, converting fuel into heat,
     soot and embers. Because the burn rate is temperature dependent, a fire front *propagates* through
     the fuel field — that is what makes a detonation look like a detonation instead of a flash,
   * buoyancy from heat and smoke weight, ambient wind drag, **thermal expansion** (hot gas pushes
     outward from the blast origin — the actual reason fireballs keep growing),
   * divergence-free **curl-noise turbulence**, gated to active cells so empty space costs nothing,
   * cooling (Newton) and dissipation.
3. **curl** → **vorticity confinement** — `f = ε·h·(N × ω)` re-injects the rotational energy that
   semi-Lagrangian advection smears away. This is the difference between "blob" and "smoke".
4. **divergence** → **jacobi × N** → **project** — the pressure Poisson solve `∇²p = ∇·v` followed by
   `v -= ∇p`, which makes the field divergence-free so plumes roll and curl instead of inflating.
5. **raymarch** (fragment) — a fullscreen triangle reconstructs the world ray, intersects the volume AABB
   and marches it, accumulating:
   * **blackbody emission** from temperature (embers → red → orange → yellow-white),
   * **single scattering** with a Henyey-Greenstein phase and a few light-shadow taps toward the sun,
   * **Beer-Lambert transmittance**, with an early-out once the ray is opaque,
   * then composites over a procedural sky, a ground plane and the solid collider box — all three catch
     the plume's light, so the fire visibly lights its surroundings.

A blast also temporarily raises a light source at the detonation point, so the ground flashes.

### Performance

The classic costs, and what is done about them:

* **Pressure iterations** dominate at high resolution (default 22–40 Jacobi iterations). Lower them first
  if you need frames — smoke gets softer, not broken.
* **Raymarch steps** (default 80–144) scale linearly with screen coverage. `fx.autoQuality = true` adds
  UE-style adaptive resolution (drops render scale before dropping simulation quality).
* The **SDF collider** (Inferno preset) is both simulated (velocity is refused entry, divergence is
  Neumann at the surface) and drawn, so smoke wraps around geometry instead of bending around nothing.
* **Substeps** are chosen adaptively: the solver estimates the CFL number from the maximum speed and
  splits fast frames, which is what keeps explosions from smearing into mush.
* Empty cells skip the turbulence noise entirely — a 128³ grid with a small plume costs a fraction of a
  fully active one.

Measured ballparks (typical discrete GPU, 1080p, Medium 96³): ~1.5 ms of compute per frame and ~3–5 ms of
raymarching. The `field`/`cpu encode` readouts in the demo tell you where you actually are, and
`fx.solver.probeVolume()` reports the live density/heat/velocity of the simulation.

---

## Demo controls

| input | action |
|---|---|
| drag | orbit |
| shift-drag / right-drag / two fingers | pan |
| scroll / pinch | zoom |
| click | detonate at the ray hit inside the volume |
| `space` / `p` / `r` | detonate / pause / reset |

The panel exposes presets, quality, live physics (buoyancy, turbulence, vorticity, wind, dissipation,
burn rate), rendering (march steps, extinction, emission, exposure, shadows, anisotropy) and **debug
slice views** — density, heat, fuel, velocity and the obstacle SDF — which is the fastest way to see what
a fluid solver is actually doing.

## Layout

```
src/
  VolumetricFX.js            facade: preset/quality/detonate/frame, canvas + camera + controls
  presets.js                 campfire, explosion, inferno, smoke, jet, candle + quality tiers
  gpu/
    WebGPU.js                device setup, WGSL binding reflection, pipeline + bind group cache
    UniformBuilder.js        vec4-only uniform packing (layout mirrored from the WGSL)
    mat4.js                  perspective / lookAt / invert for the camera
  volumetric/
    FluidSolver.js           textures, pass graph, ping-pong bookkeeping, readback probe
    VolumetricRenderer.js    raymarch pass + the entire look
    EmitterSystem.js         emitter pool with lifetime ramps
    Camera.js                orbit camera + pointer/touch controls
    shaders/*.wgsl.js        WGSL as importable template strings (so `npm run check` can validate them)
tools/
  serve.mjs                  zero-dependency static server
  check-shaders.mjs          naga validation for every shader
  dryrun.mjs                 headless structural tests
index.html, demo/            the showcase app
```

### Notes on technique / further reading

The solver follows the classic GPU fluid line of work — Stam's stable fluids, Fedkiw et al. on vorticity
confinement and smoke, Harris' GPU Gems 3D fluid chapter — adapted to WebGPU's storage-texture
constraints, with the combustion/emitter/parameter model shaped by how Niagara's Grid3D fluid and
EmberGen expose fire authoring.

## License

MIT.
