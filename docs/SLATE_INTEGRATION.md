# Porting Frontier into Slate (C++ / Vulkan / Slang / ImGui / GLFW)

The reference implementation in `src/` is WebGPU + WGSL because that is what
could be built and validated end-to-end in this environment. The **algorithms,
pass order, data layouts and parameter set are the deliverable**; the API
binding is thin and mechanical.

This document is the porting spec: what each pass does, the exact resources it
needs, the dispatch order, and the WGSL→Slang mapping.

---

## 1. What this system is

A **volumetric SDF terrain** with a physically-motivated erosion simulation.

The terrain is a signed distance field in a 3D texture:

```
sdf < 0   inside rock
sdf > 0   open air
sdf = 0   the rock surface
```

**It is deliberately not a heightmap.** A heightmap stores one height per
column, which makes overhangs, alcoves, natural arches and caves
unrepresentable — not "hard", *impossible*. In an SDF a vertical line may enter
and exit rock any number of times, so undercut cliffs and arches are ordinary
states of the representation. That property is the whole reason the erosion
model below can produce Southwest canyon morphology instead of a smooth
V-valley with a texture on it.

### Why it does not look like borrowed assets

Nothing here is sampled from a photo library. The look comes from three
coupled ideas:

1. **One stratigraphic field drives both physics and colour.** `strataCoord()`
   defines the rock column; `bedHardness()` gives each bed a resistance;
   `rockAlbedo()` colours it from the *same* number. Ledges therefore always
   form on resistant beds, and the colour banding always follows the geometry,
   because they are the same function. A tiled texture can never achieve that
   agreement.

2. **The shapes are produced by erosion, not authored.** Cliffs, benches,
   talus aprons, side canyons, alcoves and arches are outputs of the
   simulation, so they are internally consistent and unique to your parameters
   and seed.

3. **Micro-detail is analytic and geology-aware.** `rockDetail()` runs at
   ray-march time and is driven by the same strata and joint fields, so
   close-up detail agrees with the macro form instead of fighting it.

---

## 2. Resources

| Resource | Format | Size | Usage |
|---|---|---|---|
| `volA`, `volB` | `VK_FORMAT_R16G16B16A16_SFLOAT` | `VOLX×VOLY×VOLZ` 3D | `STORAGE` + `SAMPLED` |
| `simBuf` | `SimCell[]`, 64 B/cell | `SIMX*SIMZ` | `STORAGE` |
| `paramBuf` | `Params` | 352 B | `UNIFORM` |
| `cameraBuf` | `Camera` | 112 B | `UNIFORM` |
| `brushBuf` | `Brush` | 48 B | `UNIFORM` |
| `pickReq` / `pickRes` | 32 B each | | `UNIFORM` / `STORAGE` |

### Volume channel layout

```
.r  signed distance to the rock surface (metres)
.g  loose sediment / regolith cover
.b  accumulated weathering damage   (drives colour + roughness)
.a  water saturation                (wet rock renders darker)
```

**On the format choice.** Two textures are ping-ponged rather than using one
read-write image. In Vulkan you *could* use a single `VK_FORMAT_R16G16B16A16_SFLOAT`
storage image with read-write access, but ping-ponging is kept because:

* it removes all intra-dispatch ordering hazards (every pass is a pure
  `read src → write dst`), so you only need a simple barrier between passes;
* it is what the WebGPU version must do anyway (read-write `rgba16float`
  requires the optional `texture-formats-tier2` feature), so both backends stay
  on one code path.

Half-float is the right precision for an SDF: relative error is smallest near
zero, which is exactly where the surface is.

`VK_FORMAT_R16G16B16A16_SFLOAT` supports `STORAGE_IMAGE` and
`SAMPLED_IMAGE` + linear filtering on essentially all desktop Vulkan drivers,
but query `vkGetPhysicalDeviceFormatProperties` for
`VK_FORMAT_FEATURE_STORAGE_IMAGE_BIT` and
`VK_FORMAT_FEATURE_SAMPLED_IMAGE_FILTER_LINEAR_BIT` anyway.

---

## 3. Pass order (one simulation step)

All nine passes share descriptor set 0. Insert a
`VkMemoryBarrier` / image barrier between each
(`SHADER_WRITE → SHADER_READ`).

| # | Pass | Grid | Writes | Purpose |
|---|---|---|---|---|
| 1 | `surface` | 2D `SIMX×SIMZ` | sim | Extract the drainage surface from the SDF |
| 2 | `hydro_flux` | 2D | sim | Rain, river inflow, virtual-pipe outflow |
| 3 | `hydro_update` | 2D | sim | Apply flux, derive velocity, infiltration |
| 4 | `hydro_erode` | 2D | sim | Stream-power erosion / deposition |
| 5 | `hydro_advect` | 2D | sim | Semi-Lagrangian sediment transport |
| 6 | `thermal` | 2D | sim | Talus, angle of repose, commit advection |
| 7 | `apply_height` | 3D | **volume** | Write the 2.5D result back into the SDF |
| 8 | `erode3d` | 3D | **volume** | Undercutting, alcoves, collapse, wind |
| 9 | `redistance` | 3D | **volume** | Restore `|∇φ| = 1` |

Passes 1–6 only touch `simBuf`, so they can all be recorded into one command
buffer region with buffer barriers between them and **no ping-pong**. Passes
7–9 each read one volume and write the other, so swap `src`/`dst` after each.

Workgroups: `8×8×1` for the 2D passes, `4×4×4` for the 3D passes.

### Why the hybrid 2.5D + 3D split is not a compromise

Water flows over the topmost exposed surface, so the *hydraulic* problem is
genuinely 2.5D — solving it on a heightfield is both correct and much faster.
`apply_height` then writes that result back into the SDF **only within a few
voxels of the top surface** (a Gaussian window around `cell.h0`).

Everything the heightfield cannot see — the overhang above, the alcove behind,
the arch downstream — is left untouched and handled by `erode3d`. The two never
fight because they act on disjoint parts of the volume.

---

## 4. The five processes in `erode3d`

This is the pass that justifies the whole representation. See
`slang/frontier_erode3d.slang` for the complete port.

1. **Lateral undercutting** — flow attacks the banks it touches, weighted by
   `1 - |n.y|` (only sideways-facing rock) and by height above the waterline.
   Soft beds retreat under hard caps → **overhangs**.
2. **Differential weathering** — surface-normal retreat ∝ `1/hardness`, scaled
   by ambient exposure. Alone this carves **hoodoos** and the stepped
   cliff-and-bench profile.
3. **Cavernous weathering** — curvature-driven, concentrated in concavities and
   sheltered spots. Self-reinforcing → **alcoves / tafoni**.
4. **Gravitational collapse** — scan downward for a void; compare the
   unsupported span against `collapseThresh * hardness`. → **arch collapse,
   cliff retreat by block fall**.
5. **Aeolian abrasion** — windward faces stripped, fines drift into lee
   pockets.

---

## 5. WGSL → Slang mapping

| WGSL | Slang |
|---|---|
| `vec3f`, `vec2i`, `vec4u` | `float3`, `int2`, `uint4` |
| `mix(a,b,t)` | `lerp(a,b,t)` |
| `fract` | `frac` |
| `textureLoad(t, c, 0)` | `t.Load(int4(c, 0))` |
| `textureStore(t, c, v)` | `t[c] = v` |
| `textureSampleLevel(t, s, uv, 0)` | `t.SampleLevel(s, uv, 0)` |
| `@group(G) @binding(B)` | `[[vk::binding(B, G)]]` |
| `@compute @workgroup_size(x,y,z)` | `[shader("compute")] [numthreads(x,y,z)]` |
| `@builtin(global_invocation_id)` | `SV_DispatchThreadID` |
| `var<storage, read_write> b: array<T>` | `RWStructuredBuffer<T> b` |
| `var<uniform> u: T` | `ConstantBuffer<T> u` |
| `texture_storage_3d<f, write>` | `RWTexture3D<float4>` |
| `texture_3d<f32>` | `Texture3D<float4>` |
| `saturate` | `saturate` (same) |
| `select(f, t, cond)` | `cond ? t : f` |
| loop `break if` | ordinary `if (...) break;` |

**Two portability notes carried over from the WGSL work:**

* **Reversed `smoothstep` is undefined.** `smoothstep(hi, lo, x)` with
  `hi > lo` is UB in WGSL and unreliable in HLSL/SPIR-V too. Always write
  `1.0 - smoothstep(lo, hi, x)`. Three of these were found and fixed.
* **`f32` vs half-float storage.** The SDF is stored as half; keep all
  intermediate maths in `float`.

Compile with:

```bash
slangc frontier_erode3d.slang -target spirv -profile glsl_450 \
       -entry main -stage compute -o erode3d.spv
```

Slang's specialisation constants (`[SpecializationConstant]`) let one SPIR-V
module serve every grid resolution — set `VOLX/VOLY/VOLZ/SIMX/SIMZ` through
`VkSpecializationInfo` at pipeline creation instead of recompiling.

---

## 6. C++ parameter struct

Keep field order identical to `slang/frontier_params.slang` and assert it:

```cpp
struct FrontierParams {
    // Geology
    float seed = 17.0f, bedThickness = 17.0f, strataDip = 0.9f, strataAzim = 35.0f;
    float foldAmp = 14.0f, foldFreq = 0.0016f, strataWarp = 5.0f, strataWarpFreq = 0.004f;
    float hardContrast = 2.6f, capFrac = 0.26f;
    float jointDensity = 0.0045f, jointDepth = 0.45f, jointJitter = 0.55f;
    float basementY = 0.06f, basementHard = 0.9f;
    // ... (see frontier_params.slang for the full ordered list)
    uint32_t debugView = 0;
    float _pad0 = 0.0f;
};
static_assert(sizeof(FrontierParams) == 352, "must match Params in Slang");
static_assert(sizeof(FrontierParams) % 16 == 0, "UBO alignment");
```

### ImGui panel

Every slider is `ImGui::SliderFloat` over the ranges in `src/params.ts`
(which also carries the tooltip text). Only the `rebuild: true` parameters
require regenerating the terrain — everything else takes effect on the next
simulation step, which is what makes it feel live:

```cpp
bool rebuild = false;
if (ImGui::CollapsingHeader("Geology", ImGuiTreeNodeFlags_DefaultOpen)) {
    rebuild |= ImGui::SliderFloat("Seed", &P.seed, 0.f, 999.f, "%.0f");
    ImGui::SliderFloat("Bed thickness (m)", &P.bedThickness, 3.f, 80.f);
    if (ImGui::IsItemHovered())
        ImGui::SetTooltip("Vertical thickness of one bed. Thin -> finely banded "
                          "badlands; thick -> big Grand-Canyon ledges.");
    ImGui::SliderFloat("Hardness contrast", &P.hardContrast, 0.4f, 7.f);
    // ...
}
if (rebuild) queueTerrainRebuild();
```

Upload once per frame with `vkCmdUpdateBuffer` (352 B is well under the 65536 B
limit) before recording the passes.

---

## 7. Interactive sculpting

`sculpt.slang` is CSG against the field:

* **subtract** → `smax(d, -brush, k)` — digs caves, arches, alcoves
* **add** → `smin(d, brush, k)` — stacks overhanging material
* **smooth** → blend toward the neighbourhood average

Both directions are legal because the terrain is an SDF. Run 1–2 `redistance`
sweeps afterwards.

**Picking.** Don't read the volume back to the CPU — that stalls the pipeline.
`pick.slang` is a one-thread compute pass that marches the ray on the GPU and
writes the hit into a small buffer. Copy it to a host-visible buffer and read
it with a fence, one frame late; at pointer speeds the lag is invisible.

---

## 8. Validating the port

The offline harnesses in `tools/` are backend-independent and are the fastest
way to confirm a port still behaves:

```bash
npm run test:physics      # conservation, stability, channelisation,
                          # differential erosion, angle of repose
npm run test:morphology   # renders plan view + cross-section to PNG
```

`tools/sim-reference.mjs` is a CPU implementation of the same arithmetic. If
your Vulkan build diverges, port a single pass at a time and compare against it.

Two bugs it caught that are easy to reintroduce:

* **Proportional evaporation floods the world.** Uniform rain `R` against a
  loss of `k·w` equilibrates at `w = R/k` — standing water *everywhere*.
  Infiltration must be depth-independent (a rate, not a fraction) so thin films
  vanish and channels persist. Fixing this took the terrain from fully flooded
  to 64% dry ground.
* **A single angle of repose destroys cliffs.** Loose talus rests at ~33°, but
  bedrock stands at 52–87° depending on hardness. Using one angle for both
  slumps every cliff into a smooth V-valley. Fixing this took the count of
  steep (>45°) cells in a cross-section from 2 to 75.

---

## 9. Performance notes

* **Narrow band.** `erode3d` and `redistance` early-out outside `|d| < 3·voxel`.
  Most of the volume is deep rock or sky.
* **Detail shell in the ray-march.** `rockDetail` is several octaves of 3D
  noise; evaluating it at every march step is the single biggest cost in the
  renderer. It is gated to a shell around the isosurface and returns a
  conservative lower bound outside it, so the march stays watertight.
* **Sim buffer as one SoA allocation.** One `RWStructuredBuffer` instead of ten
  keeps the descriptor set small and cache behaviour predictable.
* **Steps per frame.** 2 is a good default. The UI stays responsive because
  rendering is decoupled from stepping.

At 208³ the volume pair is ~86 MB; at 336³ it is ~364 MB. Budget accordingly.
