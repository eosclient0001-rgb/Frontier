# Frontier — SDF terrain with simulated erosion

Volumetric rocky terrain for a game engine. The landform is a **3D signed
distance field**, not a heightmap, and its shape is produced by a **running
erosion simulation** rather than by textures or sculpted assets.

Every parameter is a live slider: change the rock hardness or the river
discharge and the physics keeps running from the current state.

```bash
npm install
npm run dev          # open the printed URL in a WebGPU browser
```

| Script | What it does |
|---|---|
| `npm run dev` | Live app |
| `npm run check` | Static validation of every shader, binding and struct layout |
| `npm run test:physics` | Conservation / stability / morphology assertions |
| `npm run test:morphology` | Renders the reference sim to `tools/out-profile.png` |

---

## Why it is an SDF and not a heightmap

A heightmap stores one height per column. Overhangs, alcoves, natural arches
and caves are therefore not *difficult* to represent — they are **impossible**.

Here the surface is the zero isosurface of a full 3D field, so a vertical line
may enter and exit rock any number of times. Undercut cliffs and arches are
ordinary states of the representation, which is exactly what the erosion model
needs in order to produce canyon morphology instead of a smooth V-valley.

```
sdf < 0   inside rock        .r  signed distance (m)
sdf > 0   open air           .g  loose sediment / regolith
sdf = 0   the rock surface   .b  weathering damage
                             .a  water saturation
```

## Why it doesn't look like borrowed assets

Nothing is sampled from a photo library. Three coupled ideas do the work:

1. **One stratigraphic field drives both physics and colour.** `strataCoord()`
   defines the rock column, `bedHardness()` gives each bed a resistance, and
   `rockAlbedo()` colours it from *the same number*. Ledges always form on
   resistant beds and the colour banding always follows the geometry, because
   they are the same function. Tiled textures cannot achieve that agreement.

2. **The shapes are simulation outputs.** Cliffs, benches, talus aprons, side
   canyons, alcoves and arches emerge from the physics, so they are internally
   consistent and unique to your seed and settings.

3. **Micro-detail is analytic and geology-aware.** Detail is added during the
   ray-march from the same strata and joint fields, so close-up rock agrees
   with the macro form. Bed contacts stay razor-sharp at any voxel resolution
   because hardness is never stored — it is evaluated on demand.

---

## The simulation

Nine passes per step. 1–6 are hydraulics on the drainage surface; 7–9 write the
volume.

| # | Pass | Purpose |
|---|---|---|
| 1 | `surface` | Extract the drainage surface from the SDF |
| 2 | `hydro_flux` | Rain, river inflow, virtual-pipe outflow |
| 3 | `hydro_update` | Apply flux, derive velocity, infiltration |
| 4 | `hydro_erode` | Stream-power erosion / deposition |
| 5 | `hydro_advect` | Semi-Lagrangian sediment transport |
| 6 | `thermal` | Talus, angle of repose |
| 7 | `apply_height` | Write the 2.5D result back into the SDF |
| 8 | **`erode3d`** | **Undercutting, alcoves, collapse, wind** |
| 9 | `redistance` | Restore `\|∇φ\| = 1` |

Water flows over the topmost surface, so the *hydraulic* problem is genuinely
2.5D and is solved that way for speed. `apply_height` writes that result back
into the SDF **only near the top surface**, so everything the heightfield
cannot see is left to `erode3d`. The two act on disjoint parts of the volume
and never fight.

### `erode3d` — the pass a heightmap cannot have

Evolves the field as a level set, `∂φ/∂t = F(x)·|∇φ|`:

1. **Lateral undercutting** — flow attacks the banks it touches, not just the
   bed. Soft beds retreat under hard caps → **overhangs**.
2. **Differential weathering** — retreat ∝ `1/hardness` → **hoodoos**, stepped
   cliff-and-bench profiles.
3. **Cavernous weathering** — curvature-driven, self-reinforcing →
   **alcoves / tafoni**.
4. **Gravitational collapse** — unsupported spans fail → **arch collapse**,
   cliff retreat by block fall.
5. **Aeolian abrasion** — windward faces stripped, fines drift into lee pockets.

The single most important control is **hardness contrast**: dividing erosion
rate by rock hardness is what turns a smooth valley into a stair-stepped canyon.

---

## Controls

| Input | Action |
|---|---|
| LMB drag | Orbit |
| RMB / MMB drag | Pan |
| Wheel | Zoom |
| **Ctrl + LMB** | **Sculpt (subtract)** |
| **Shift + Ctrl + LMB** | **Sculpt (add)** |
| Shift + wheel | Brush size |
| Space | Run / pause |
| R | Rebuild terrain |

Sculpting is CSG on the field, so subtract digs caves and arches and add stacks
overhanging material — both are legal because the terrain is an SDF. Picking is
done by a GPU ray-cast (`pick.wgsl`) read back asynchronously, so it never
stalls the frame.

Use the **debug views** to see the simulation directly: rock hardness, water and
flow accumulation, sediment, weathering damage, and ray-march cost.

---

## Verification without a GPU

This was built in a sandbox with no GPU, so correctness is enforced statically
and by a CPU reference implementation. `npm run check` runs:

* **`check-shaders`** — parses every composed shader
* **`check-idents`** — resolves every identifier (catches missing `#include`s)
* **`check-bindings`** — cross-validates every `@group`/`@binding` against the
  `GPUBindGroupLayout` in TypeScript, *including storage-texture formats*
* **`check-layout`** — verifies `SimCell`, `Brush` and `Camera` byte offsets
  against the CPU writes
* **`check-slang-parity`** — keeps the hand-written Slang port in sync with the
  generated WGSL one

`tools/sim-reference.mjs` re-implements the solver on the CPU and asserts:
water conservation (0.000% drift), stability at aggressive time steps,
channelisation (20× peak/mean discharge), **differential erosion** (soft rock
erodes 1.43× faster than hard), and the angle of repose (33.0°).

Bugs this harness caught that are easy to reintroduce:

* **Proportional evaporation floods the world.** Uniform rain `R` against a
  loss of `k·w` equilibrates at `w = R/k` — standing water everywhere.
  Infiltration must be depth-independent so thin films vanish and channels
  persist. Fixing it took the terrain from fully flooded to **64 % dry ground**.
* **One angle of repose destroys cliffs.** Talus rests at ~33°, but bedrock
  stands at 52–87°. Using a single angle slumps every cliff into a V-valley.
  Fixing it took steep (>45°) cells in a cross-section from **2 to 75**.
* A storage-texture format mismatch (`r32float` vs `rgba16float`) that would
  have been a hard pipeline-creation failure on first load.
* Three reversed `smoothstep` calls — undefined behaviour in WGSL.
* A velocity singularity at zero water depth, which would have produced a NaN
  that permanently poisons the terrain through the feedback loop.

---

## Porting to Slate (C++ / Vulkan / Slang / ImGui)

**`docs/SLATE_INTEGRATION.md`** is the porting spec: resource table, pass order
with barriers, the WGSL→Slang mapping table, ImGui wiring, and the physics
pitfalls above.

`slang/` contains the parameter block, the geology module and the full
`erode3d` pass already ported to Slang, using specialisation constants so one
SPIR-V module serves every grid resolution.

```bash
slangc frontier_erode3d.slang -target spirv -profile glsl_450 \
       -entry main -stage compute -o erode3d.spv
```

---

## Layout

```
src/
  params.ts            one schema -> WGSL struct + CPU packing + UI sliders
  config.ts            grid resolutions, volume format rationale
  shaders/
    geology.wgsl       strata, joints, hardness, rock colour
    volume.wgsl        SDF access, curvature, analytic micro-detail
    erode3d.wgsl       true volumetric erosion
    hydro_*.wgsl       shallow-water erosion
    thermal.wgsl       talus / angle of repose
    render.wgsl        ray-marcher, materials, lighting
    water.wgsl         silt, wind ripples, foam
    sky.wgsl           atmosphere, aerial perspective
slang/                 Slang port for the Vulkan build
tools/                 offline validation + CPU reference sim
docs/                  Slate integration guide
```

Sizes: the volume pair is ~86 MB at 208³ (default) and ~364 MB at 336³.
