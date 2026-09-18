# Frontier · SDF Terrain Generator

The missing terrain piece for the engine: a **signed-distance-field terrain
generator** that fuses the two earlier experiments into one pipeline —
and fixes the failure mode of each.

```
analytic multifractal → 3D SDF volume → sculpt (CSG + density brushes)
                                      → GPU particle erosion   (realistic carve)
                                      → geomorphic field passes (drainage network)
                                      → ray-marched straight from the SDF
```

| Ancestor | What it got right | What broke | Fix in this build |
| --- | --- | --- | --- |
| particle-erosion studio | agents carrying real sediment look alive | agents drill bottomless pits into one spot | rest guard, shear thresholds, capacity limits, hardness armoring, regenerating per-cell cut budget |
| SDF erosion lab | stream-power incision + drainage structure | everything diffuses into blur | flow-gated diffusion, sharp n≈1.5 incision, detail-sharpen re-injection, mesh-free ray-march render |

## Run

Zero dependencies — any static file server works:

```sh
python3 -m http.server 5173 --bind 0.0.0.0   # or npm start
# open http://localhost:5173
```

Needs WebGL2 + `EXT_color_buffer_float` (any current Chrome/Edge/Firefox with
hardware acceleration).

```sh
npm test           # CPU geomorphology tests (Node)
npm run lint:glsl  # static shader lint
```

## The volume

The terrain is a **true 3D SDF** (128×64×128 voxels, 48×24×48 m) stored as a
2D texture atlas of Z slices, RGBA32F:

| channel | meaning |
| --- | --- |
| r | signed distance (negative = rock), narrow-band |
| g | hardness — freshly cut rock hardens (armoring), sediment softens it |
| b | moisture — wet trails darken and weaken shear thresholds |
| a | solid fraction — the *authoritative* mass storage |

Every edit changes mass through `a`; distance `r` is rebuilt from it, and a
banded **Eikonal solver** (occupancy fix + quadratic sweeps) re-normalizes the
field. That is what makes sculpting *proper SDF sculpting*: overhangs, arches
and caves stay valid distance fields, and erosion stays mass-conserving.

## Sculpting

Raise / lower / smooth / flatten / terrace density brushes plus **CSG blob
union & subtract**. Strokes edit distance directly inside a falloff-shaped
kernel; the repair passes run after every dab.

## Particle erosion — without the pits

Agents (rain & sheet runoff, or a guided meandering river current) are fully
GPU-simulated: motion → surface contact → splatted cut/deposit requests →
budget-limited volumetric apply → cargo bookkeeping. Detached material enters
the agent's load; only carried material may deposit. Mass is conserved.

The anti-pit system, all evaluated per contact:

1. **Capacity-limited detachment** — no cutting while `load ≥ capacity`, and
   capacity grows with water · speed². Slow pooled agents carry almost nothing.
2. **Shear threshold vs. hardness** — detachment needs `stress > critical`;
   cutting raises hardness (armoring), deposition lowers it.
3. **Rest guard** — an agent that is slow on flat/concave ground (i.e. sitting
   in a hole it dug) has its cut zeroed and dumps its load, so pits self-fill;
   agents stuck too long are recycled.
4. **Regenerating incision budget** — every voxel can only be cut so fast;
   sustained jets exhaust the local budget and must move on.
5. **Hard caps** — per-step cuts clamp to the footprint's available solid and
   to a fraction of a voxel.

## Field passes — without the blur

The surface is extracted from the SDF (128², sub-voxel), eroded on the CPU,
and written back into the volume near the surface:

* priority-flood depression routing (basins drain over their rims),
* D8 flow accumulation with a coherent meander bias,
* stream-power incision `e = K·A^0.45·S^n` with `n` up to 2 — sharp threads,
* capacity-limited sediment routing with overbank spill (alluvial fans),
* **flow-gated** hillslope diffusion — channel cells are never smoothed,
* thermal talus relaxation past the angle of repose,
* **detail sharpen** — ridged micro-relief re-injected on steep, hard, freshly
  worked rock, restoring the high frequencies diffusion rounds off.

The final image ray-marches the SDF itself — no mesh extraction, no smoothing.

## Controls

| Input | Action |
| --- | --- |
| LMB drag | sculpt (when a tool is selected) / orbit camera |
| RMB drag | look in place |
| MMB drag or Shift+LMB | pan |
| wheel | dolly |
| WASD / Q / E (+ Shift) | fly |
| Ctrl+Z / Undo | restore the previous volume snapshot |

Status bar shows fps, live agent count, and the measured cut/fill ledger
(GPU-reduced acceptance totals for particles, exact ledger for field passes).

## Layout

```
index.html          app shell
css/app.css         studio theme
src/volume.js       atlas addressing + shared GLSL preamble
src/gl.js           WebGL2 helpers (targets, ping-pong)
src/gen.js          terrain presets + Eikonal repair
src/sculpt.js       SDF brushes & CSG stamps
src/particles.js    GPU agent erosion (motion/contact/splat/apply/cargo)
src/field-erosion.js extraction, CPU geomorphology, delta apply + detail
src/render.js       ray-march renderer, water, pick, agent points
src/camera.js       orbit/fly camera
src/reduce.js       GPU sum-reduction for the mass ledger
src/main.js         wiring, undo stack, frame loop
tests/              Node tests + static GLSL lint
```
