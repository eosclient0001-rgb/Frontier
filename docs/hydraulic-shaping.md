# Live hydraulic shaping on a refined XYZ field

## What changed

The previous rainfall correction addressed runaway water volume but left the user with nearly invisible erosion on metre-scale cells. That was not a useful terrain-authoring workflow.

**Hydraulic shaping is now the default studio workflow.** It uses moving surface-water parcels, hydraulic detachment/capacity, sediment transport and deposition on the live sparse XYZ field. It does not call the reference `carveSphere` operation. The previous mm/hour rainfall model remains available separately as **Weather / rainfall study**.

This is an iterative authoring model, not Gaea code, a Gaea-equivalent solver, or a calibrated simulation of a few seconds of rain eroding hard rock.

## Using it

1. Open **Erosion → Hydraulic shaping** and run erosion.
2. Use **Inspect surface detail** to pause and frame a location where real fine-field material exchange occurred. The full kilometre terrain still simulates; this button does not define an active patch.
3. For concentrated channels, choose **Authored XYZ water route** and draw a water route. Its inlet, width, speed and elevations govern the supplied flow. No route means no route-source births; there is no hidden fallback channel.
4. Adjust **Water parcels**, **Water per parcel**, erosion strength, hardness, sediment capacity and deposition. The old physical rainfall-rate controls are hidden in this workflow, rather than pretending to control shaping.
5. Choose the geometry spacing before a run. Changing spacing or switching workflow explicitly requires regeneration, with a confirmation warning to export first.

| Geometry spacing | Actual exchange-kernel diameter | Per-pass aggregate change ceiling |
|---|---:|---:|
| 0.25 m | 0.75 m | 10 mm |
| **0.50 m, default** | **1.50 m** | **20 mm** |
| 1.00 m | 3.00 m | 40 mm |

These sizes are world metres and do not increase when the terrain grows. The incoming millimetre diameter and diagnostic point size are not presented as terrain cut width.

The default is now **1,024 selected hydraulic particle slots** (16× the old 64), with a control up to **16,384** (previous UI ceiling: 512). Births fill the selected pool over several updates; selected slots are not advertised as already-live particles. Changing the count takes effect on the next update without regenerating terrain or reallocating particle textures. All selected slots participate in transport; above 4,096, diagnostic particle markers are sampled to bound drawing work. Weather retains its separate carrier-count setting and fixed mm/hour supply. Fine storage is more expensive, and increasing samples is not advertised as free. More authoring particles supply more water at the same per-parcel setting; neither their cut width nor their erosion-strength coefficient is increased. Fast/Rapid use two/four shaping iterations per update; transport remains limited to one fine cell per exchange at the 4 m/s shaping velocity ceiling.

## Connected implementation

- `fine-hydraulics.js` connects the existing GPU motion/lifecycle system to live sparse allocation, fine contact gathers, scatter, aggregate acceptance, material layers and cargo feedback.
- `fine-hydraulic-shaders.js` specializes the shared exchange and sediment-ledger code for fine XYZ storage. Fine erosion/deposition is constrained by available solid/space, transport capacity, the aggregate per-cell ceiling and the refinement displacement bound.
- Accepted volume is derived from the change actually stored in fine occupancy. It is returned to the particle cargo and constituent ledger; overlapping particles cannot each claim the full cell.
- New shaping parcels start on the surface, or at an explicitly authored XYZ water-route inlet. They receive a defined authoring water volume, not a terrain-area-derived fictitious rainfall volume. Their source water is separately identified in the water ledger.
- `refined-field-glsl.js` supplies the same coarse-plus-fine field to collision, contact normals, terrain rendering and GPU picking. A conservative, boolean occupancy mask accelerates empty-space traversal; it stores **no heights** and is not the terrain representation.
- Ray-hit tolerances, normal sampling, shadow/AO scale and marker lift account for fine resolution. Picking locally refines its hit so allocation does not merely move a ray hit within a coarse tolerance. Procedural bump shading is reduced when showing the fine field.
- Coarse editing rebases the world-space fine deformation against the edited base. Distant sculpt edits were verified not to erase fine cuts. This is not an independently transformed fine mesh attached to each procedural object.
- Flow history remains a coarse diagnostic atlas, populated from the actual fine-field trajectories. Fine material inventory and geometry are separate from that diagnostic.
- GPU snapshots preserve fine values, keys, materials and the acceleration mask. **Version 3 `.frontier` exports include the sparse arrays and payload offsets**, not only a downsampled base. They still omit live particles and are not resumable particle simulations. `frontier.readTerrain()` returns the base and refinement; `readVolume()` is the dense base-only diagnostic.

The viewport now fences displayed GPU frames and avoids queuing more draws while erosion/editing is busy. This prevents a fast CPU animation loop from building an unbounded display backlog behind fine-field computation.

## Explicit bounds and limitations

- 4,096 persistent bricks, each 8³ nodes: 2,097,152 fine nodes. Default extra GPU storage, including exchange/material scratch and a frozen base copy, is approximately **246 MiB**. The existing coarse engine has additional allocations.
- Bricks can be allocated anywhere in the whole XYZ domain. There is no restricted cyan patch, but this is **not the entire kilometre volume resident at 50 cm resolution**.
- When a complete contact footprint cannot be allocated, that contact does not erode/deposit. Existing data stays intact; the engine does not evict details or fall back to a metre-sized coarse cut. The audit reports missing contacts and brick usage. The Erosion panel also samples a lightweight capacity report after a completed batch, no more often than every 16 updates and two seconds. It reads only the key table and selected contact-status rows (about 80 KiB at 1,024 slots; at most 320 KiB at 16,384), not the fine geometry/material atlases. The report labels its sampled update and distinguishes complete contact footprints from actual erosion. Missing contacts can also result from bounded hash probing before every brick slot is occupied. Finer spacing consumes the spatial budget sooner.
- Fine displacement is limited to the region within **4 m of the reference SDF surface**. This implementation targets local rills/channels, not unlimited deep valley excavation or geological-scale terrain restructuring.
- The material parameters are authoring assumptions. Shaping uses a 0.25 m representative flow depth and stronger erodibility than the resistant-rock rainfall study. The water-source volume and iteration count must not be labelled as a natural rain rate or geological age.
- No pressure-projected free surface, structural rock collapse, thermal/talus relaxation or calibrated catchment hydrology is claimed. Curvature/flow diagnostics and fracture connectivity have their existing coarse-resolution limitations.
- A floating-point blending extension is required for the fine scatter. If unavailable, the studio reports that fine shaping is unavailable and retains the weather workflow; it does not substitute CPU erosion.

## Measured checks

Real WebGL2 tests under SwiftShader verify:

- A moving parcel removes fine solid, carries the accepted sediment and moves downhill; occupancy/cargo accounting stays balanced.
- An authored water inlet produces a **roughly 0.95 m incision after 64 shaping updates** on a controlled XYZ slope, with 50 cm cells and a 1.5 m kernel. Approximately **28.45 m³** was removed and **0.0283 m³** deposited. This supplied **1,000 m³ of authoring water**; it is not eight seconds of natural rainfall.
- The same channel test records zero steady-state CPU texture uploads, texture allocations or pixel readbacks during its simulated updates.
- With particle markers and plumes hidden, the rendered field changes and a GPU pick detects the lower surface. Fine checkpoint values/materials and exported values match exactly.
- Slower loaded flow deposits more than faster flow; accepted deposition is present in the actual fine field.
- Zero erosion strength leaves the surface unchanged. A deliberately exhausted pool preserves existing fine values and the coarse base rather than broadening the brush.
- Default live UI selects hydraulic shaping and reports the real spacing and kernel width.

Commands:

```sh
npm test
CHROMIUM_PATH=/tmp/chromium SOFTWARE_GPU=1 \
  LD_LIBRARY_PATH=/tmp/al2023/lib:/tmp npm run test:browser -- \
  tests/browser/fine-hydraulics.spec.js tests/browser/sparse-sdf.spec.js
npm run build
```

The screenshot `artifacts/hydraulic-channel-proof.png` is a controlled SDF-slope regression with diagnostic particles hidden, not a new hardcoded terrain preset. Test timings are software-GPU timings, not native-device FPS claims.

Validation for this integration: **94 unit tests, 13 focused fine-field/storage browser checks, and the physical-rain admission regression passed**. These were run across targeted commands, not the entire historical browser suite. A redundant expanded normal-function variant produced blank frames during development; using the shared SDF normal function fixed it, and rendering/startup checks were rerun successfully.

The production preview smoke also passed on the default generated kilometre terrain: 14 updates removed about **1.42 m³** into carried sediment, with zero ledger residual and no browser/solver errors. The inspect button framed an actually modified region.


## Denser hydraulic particles — 2026-09-17

The user confirmed that `split-viewport-v1` renders on their browser and that erosion
is visible, but too subtle; they requested many more **real particles**. The viewport
shader mitigation is retained. No new shader programs or larger particle textures
are needed for the density change: it uses the existing 16,384-carrier pool.

Controlled full-domain slope A/B, same 16 updates, 0.5 m XYZ cells, 1.5 m exchange
width, 8 m³ per admitted authoring parcel, 0.125 s transport increment:

| Selected slots | Live particles | Removed | Source water | Bricks | Missing contacts |
|---|---:|---:|---:|---:|---:|
| 64 (old default) | 57 | 11.724367 m³ | 456 m³ | 328 / 4,096 | 0 |
| 1,024 (new default) | 898 | 150.661188 m³ | 7,200 m³ | 4,096 / 4,096 | 339 |

**779 particles above the old 64-slot range actually detached fine material.** This
is about 12.85× more removal in this finite test, not a promised universal speedup,
Gaea parity, or natural-rainfall rate. Fine-field removal agrees with the ledger;
ledger residual is zero and absolute mass residual is below 5e-7 m³.

Increasing that same run to 16,384 slots for four more updates produced 7,420 live
particles, including 3,507 IDs in the upper half of the real pool. Particle/fine
texture identities stayed unchanged, with **zero allocations, uploads or CPU
readbacks inside the measured solver updates**, and GL error zero. However, 7,138
contacts were missing fine storage at this point: the maximum count is not an
assurance of effective erosion everywhere. The visible capacity warning explicitly
says that more particles cannot repair that limit. No eviction or coarse fallback
was introduced. The separately throttled studio capacity monitor does perform the
small diagnostic readbacks described above; it is not part of the solver benchmark.

Verification: **112 unit tests**, **8 distinct targeted browser tests** across
batches (dense counts, live density control, default workflow, fine rendering /
picking / export, zero-strength & full-pool safety, slow-flow deposition, authored
route transport, and fixed mm/hour rainfall) passed. This is not a full-suite run.
Prior intact-fracture UI test failures are not claimed resolved.

Production cross-origin iframe smoke: eight updates with 1,024 selected slots,
671 live particles, **12.768160 m³ removed**, 2,859 bricks, 21 missing contacts,
zero measured mass/ledger residual and no browser errors. Fine spacing remains
0.5 m and capacity 4,096 bricks. Build **`main-Cx9MSgH-.js`**. All automated GPU
measurements use Chromium/ANGLE SwiftShader, not native AMD performance figures.

Ignored evidence: `artifacts/dense-hydraulic-{browser,ui,regressions,units,build,production}.log`
and `artifacts/dense-hydraulic-production-smoke.json`.
