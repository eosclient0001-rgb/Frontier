# Finite-thickness ControlVehicle glazing — 2026-10-26

This phase derives closed glazing from the retained vehicle's window surfaces and binds native saved/reloaded
IOR and RGB absorption to the resulting geometry. Original archives and the thin-sheet comparison are retained.

**Validation status:** native acceptance passed; fresh restored-build Vulkan and full regression runs are pending.
Earlier interrupted-workspace observations are not substituted for retained results from this build.

## Construction

| Item | Mechanism |
|------|-----------|
| Input | 74 retained window triangles, selected with the existing native vehicle material selectors |
| Components | Three exact-edge-connected panes |
| Offset | ±3 mm along area-weighted vertex normals; nominal thickness 6 mm |
| Closure | Reversed interior faces; two outward triangles per original boundary edge |
| Result | 284 triangles; zero unmatched indexed edges; opposite winding on paired edges |
| Volume | Positive signed volume checked separately per component; total approximately 0.0213574 m³ |
| Material | Native TOML → disk reload → `CompiledSurfaceMaterial` → existing category-4 float atlas |
| Spectrum | IOR 1.52; RGB absorption [1, 4, 12] inverse metres |
| Preserved | Racing Green cellular flakes, rubber, two BVH mirror panes, plastic/band cones and lighting routes |

[Production construction](../../Engine/Render/PaneThickness.h) is bounded to 512 input triangles and thickness
0.1–50 mm. It welds exact float positions, not nearby corners. It rejects nonmanifold/inconsistent winding,
non-cycle boundaries, closed input components, opposed adjacent normals, degenerate/inverted output faces,
nonpositive component volume and nonadjacent output triangle intersection/contact, including coplanar overlap.

This is a conservative normal-offset construction, **not a general CAD offset/collision certificate**. Curved
panes have nominal vertex-normal thickness, not an exact constant-distance implicit offset. Intersection checks
skip triangles sharing an indexed vertex; arbitrary adjacent-face overlap and collisions with the opaque body
are not exhaustively certified. Dimensions use the archive's metre scale, not measured manufacturing data.

## Transport corrections

The restored ray-aligned projected edge test replaces independently rounded Moller barycentrics. Precise
products keep shared edges evaluated consistently. This addresses the seam observed during the previous turn;
it is not a formal watertight guarantee at every coordinate scale. Shadow-only predicates are unchanged; this
is not a claim to have reproduced or fixed the old half-pole shadow defect.

Curved thin panes can guide rays through hundreds of total internal reflections. The finite interaction limit
is now **2,048**, rather than 32. The primary TIR diagnostic saturates at 65,535 before packing it alongside the
capped-path count, preventing diagnostic overflow without changing radiance. GPU descriptors/material ABI are
unchanged. No performance improvement or hardware tracing claim is made.

## Fresh pinned negative control

[Previous shader control](Results/VehicleGlazingBoundPrevious.txt), pinned to `250616f` for the three optical
shader files and compiled against the same current fixture: **59 capped paths / 16 unsupported paths**.
The probe device line describes the production limit; the preceding source-override line explicitly identifies
the previous 32-step shader. This is an old-source/current-fixture comparison, not the entire previous app.

## Fresh native checks

| Check | Result |
|-------|--------|
| Native geometry/host packing | 52 assertions, strict and ASan/UBSan passed |
| Invalid geometry | 16 cases rejected |
| Analytic planar volume | Three thicknesses; maximum error 1.78814e-9 m³ |
| Six archived poses | Same 3 components / 284 triangles; volume drift below 1e-7 m³ |
| Saved material | 39 assertions; four disk save/reload/compile cases; five legacy presets |
| Existing native CTests | 4/4 passed |

- [Geometry assertions](Results/PaneThickness.txt)
- [Geometry sanitizers](Results/PaneThicknessSanitized.txt)
- [Native saved coefficients](Results/VehicleGlazingAuthoring.txt)
- [Four native CTests](Results/VehicleGlazingNative.txt)

## Reproduce

```bash
bash Exhibits/LightCompute/RunVehicleGlazing.sh
# Reuse a completed production shader/archive build:
GLAZING_BUILD=0 bash Exhibits/LightCompute/RunVehicleGlazing.sh
# Optional isolated previous/current path-budget comparison:
bash Exhibits/LightCompute/RunGlazingBounds.sh
```

Prerequisites: pinned CMake/Slang/SwiftShader/Vulkan headers from the existing compute setup, pinned toml++
and stb from `Automation/UIDependencies.json`, C++20 compiler and Pillow. Native tests use Linux GCC 12.2,
strict C++20 `-O2`, `-O1` ASan/UBSan, Release Vulkan host and 13 production Slang `-O0` entries.

## Boundaries of this phase

- Actual derived vehicle assignment in the native compute exhibit, not a general editor/scene importer.
- Original archives are not rewritten. Six-pose checks are native geometry tests, not a six-pose GPU film.
- No physical RTX/GTX/Windows execution, real-time performance or finished renderer claim.
- No nested/rough glass, inside-camera support, transmitted analytic shadows or caustic solver.
- No new glass temporal-denoising or unified moving vehicle + baked distance field + sun/sky/cloud/fog acceptance.
- Sun/flare/stars and cellular flakes are preserved; sky/cloud appearance is not redone here.
