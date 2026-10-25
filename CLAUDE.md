# Frontier — Agent Instructions

Frontier is a general-purpose, cross-platform editor with reusable engine code.
The legacy migration is complete. Do not treat this as an unfinished 1:1 migration target.

## Mandatory reading — every session

Read all four documents at session start, before naming, formatting, editing, or presenting work.
They are authoritative and override agent defaults within their scope:

- `EngineDocs/AgenticInstuctions/SKILL-Naming.md` — all naming, banned words, and name construction.
- `EngineDocs/AgenticInstuctions/SKILL-formatting.md` — source and document formatting.
- `EngineDocs/AgenticInstuctions/SKILL-Emoji.md` — the only approved emojis and permitted usage.
- `EngineDocs/AgenticInstuctions/SKILL-CompactOutputProtocol.md` — compact output; tables and diagrams over prose.

Report missing rules before affected work. Do not silently skip them or invent exceptions.
These paths remain authoritative until an approved relocation updates every reference.

## Content, formats, and rendering

- Use **Content Directory**, `ContentDirectory`, and `EngineContent/`.
  Do not introduce `AssetDirectory` or `UI/Assets/`.
- Shared fonts belong in `EngineContent/FontArchives/<font name>/`, with the original licence beside each collection.
- Shared SVG content belongs in `EngineContent/Icons/`. Resolve bundled content relative to the executable first;
  launching from another working directory must not hide fonts or pick an unrelated partial collection.
- All engine-authored C++ configuration and serialization formats use **TOML**, decoded/encoded with **toml++**.
  Preserve established schemas and extensions; inspect existing codecs before creating another format.
  `Appearance.toml` stores applied theme/typography; `FontCatalogue.toml` and per-font archive TOMLs describe fonts.
  JSON lock manifests and exhibit reports are automation interchange, not new C++ runtime serialization formats.
  External file formats such as OpenType, SVG, and shaders are not converted into TOML.
- **Vulkan is the primary rendering API. Slang (`.slang`) is the primary shader language.**
  DX11 is permitted for the isolated ImGui display exhibit; it is not a replacement engine-renderer architecture.
  Keep the scene renderer excluded from the current selective UI port.
- **GLFW owns platform windows and input.** Use a no-OpenGL-context window for Vulkan or the DX11 ImGui exhibit.
- Third-party sources belong under the existing ignored `ExternalPackages/`, restored from pinned dependencies.
  Reuse the existing toml++, GLFW, ImGui, and ThorVG dependency setup; do not vendor duplicate copies elsewhere.
- The Control Centre is a top-edge drawer, not a separate floating settings window. Retain the reference's
  trapezoid, travelling sheet, bottom grip, axis-locked drag, and upward swipe/flick dismissal.
  Typography sliders and scroll content retain their pointer ownership; drag the header, quick-card blank space,
  notch, or bottom grip to carry the sheet. GI and renderer settings remain excluded.

## Work and verification

Complete the requested work, run relevant local verification, then deliver results with evidence.
Local builds, tests, focused validation programs, and actual application captures need no separate approval.
Never deliver an implementation as complete without testing it.

| Work                  | Required verification                                             |
|-----------------------|-------------------------------------------------------------------|
| C++ or shaders        | Relevant build and tests; runtime validation where applicable.     |
| UI                    | Relevant tests and actual rendered or interaction evidence.        |
| Behaviour repairs     | Reproduce the defect and verify the repaired behaviour.            |
| Performance claims    | Reproducible measurements, conditions, and comparison results.      |
| Documentation         | Paths, links, structure, consistency, and applicable rule checks.   |
| Plans and analysis    | Verify factual claims against inspected sources; show a report.    |

- Exercise the changed behaviour, not merely unrelated passing tests.
- Add focused validation when existing coverage is insufficient.
- Compilation alone does not establish runtime correctness.
- Progress messages must not imply unfinished work passed verification.
- When blocked, report the command, observed result, missing prerequisites, and remaining checks.
- Mark unavailable checks blocked or not run, never passing. A blocked report is not completed implementation.

## Visible evidence — required with delivery

Every delivery must include an actual image, graph, results table, or concise verification report.
UI appearance claims require actual rendered evidence when capture is supported.
Mockups, generated illustrations, and invented measurements are not validation evidence.
A browser prototype does not prove that the production C++ editor renders the same result.

Retain evidence and its generating code together under `Exhibits/`.
Include reproduction commands, prerequisites, platform, compiler, configuration, tested revision,
and any relevant uncommitted changes. Explain limitations and present the evidence, not just its location.

## Folder ownership and documentation

Follow `Documentation/FolderStructure.md`. Do not invent alternative top-level folders.

| Location                         | Responsibility                                        |
|----------------------------------|-------------------------------------------------------|
| `Engine/`                        | Reusable production code shared across applications.  |
| `UI/Editor/`                     | Production editor UI.                                 |
| `Exhibits/`                      | Validation code, retained results, and proof images.   |
| `Exhibits/EditorMirror/`          | Comparison mirror of the C++ editor UI.                |
| `Experimental/`                  | Prototypes, experimental HTML, and related assets.     |
| `Documentation/Tracker.md`       | Single project progress and violation tracker.        |
| `Documentation/Rules/`           | Project rules; four retained skills remain above.     |
| `Documentation/Plans/Ongoing/`   | Approved active plans.                                |
| `Documentation/Plans/Completed/` | Completed plans, outcomes, and evidence links.         |
| `_ClaudeScratch/`                | Disposable local work; ignored and never committed.    |

Do not put prototypes, captures, reports, or validation-only code in `Engine/`.
Exhibits must reuse production engine code, not independent copies of it.
Keep requested prototype source, assets, and launchers together in `Experimental/`.
Do not delete inherited build, dependency, content, or application folders without an approved migration.
Update the folder map and affected references whenever approved moves change paths.
Maintain one tracker, not per-agent progress reports or competing backlogs.
Keep detailed results in exhibits and link them from the tracker.
Do not silently weaken rules to make a scan pass.

## Scratchpad

Use `_ClaudeScratch/logs/`, `_ClaudeScratch/build/`, and `_ClaudeScratch/tmp/` for disposable material.
Never commit scratch contents or leave the only copy of a deliverable or retained evidence there.
Permanent prototypes go in `Experimental/`; retained validation code and results go in `Exhibits/`.
Respect existing ignored build-output conventions when tools require their own directories.
Do not leave generated output next to source or loose at the root.
Incomplete HTML fragments use a non-`.html` extension such as `.part`.

## Platforms, binaries, and tooling

The user is on Windows. Deliver Windows binaries by default when a binary is requested or part of the task.
Do not build, package, or deliver Linux binaries unless requested.
Never substitute a Linux executable for a Windows deliverable.
If Windows compilation is unavailable, report the blocker; do not claim a Windows binary was verified.

Preserve Windows, Linux, and macOS portability. Android is a future consideration; no Android app is in scope.
Do not download macOS binaries or set up macOS during current work.
MSVC is the user's current compiler, not the only permitted compiler.
GCC/g++, MinGW-w64, or Clang may be used where the repository supports them.
Distinguish locally tested configurations from untested portability expectations.

Use actual repository build instructions and available tooling; do not hard-code developer installation paths.
Isolate platform-specific code from reusable code. Avoid unnecessary Windows-only assumptions.
Use the appropriate host interpreter: Windows command tooling for `.bat`, PowerShell for scripts requiring it,
and Bash for appropriate Linux/macOS commands. Python need not live at a fixed path.

## GitHub Actions — explicit approval required

Always ask before causing a GitHub Actions run unless the user explicitly authorised that run.
This includes dispatches, reruns, and remote operations such as pushes or pull requests that trigger workflows.
Inspect triggers before an authorised remote operation. Never use Actions as an automatic local-test fallback.
Permission to edit or commit locally is not permission to run Actions.
Follow the user's current commit and push instructions; do not infer permission to commit or push.

## Delivery

Follow the compact output skill: short outcome, verification table, visible evidence, exhibit paths,
blockers, untested configurations, and remaining work. Do not substitute confidence or compilation for testing.

### Recovered native Float32 surface maps (2026-10-19)

`VectorSurfaceCompute` writes typed RGBA32F channel maps and separate per-channel contribution masks; coverage/selection
stay RGBA8. `VectorCoverageRasterization` derives the actual storage format from SPIR-V and refuses unsupported Float32
capabilities instead of silently quantizing. The shared PFM writer preserves float bits and emits little-endian,
bottom-first scalar/RGB output. Seven GPU channel assertions pass strict and sanitizer builds; the archive contains
14 actual 32x32 GPU fixture maps/masks with separately authored gold thread and fabric metalness. See
`Exhibits/TextureStudio/NativeSurfaceEvidence.html` and `NativeMaterialApplication.md`.

The retired-slot cache path dispatches and samples the 512×512 Float32 surface output. Texture Workspace now toggles
to the native Pattern panel, persists vector TOML, and submits GPU coverage/selection. Its C++ runner passes 606 checks;
the recorded evidence explicitly does not represent a Windows desktop session. Pattern Float32 outputs remain
unconnected to the PBR material renderer; native 3D application, physical height calibration, user-document export and
Pattern 1:1 parity remain open. GIF previews are 8-bit evidence, not precision checks. Scope remains approximately 68%.

### Cloud environment checkpoint — 2026-10-25

Vulkan cloud integration and actual ControlVehicle clear/cloud/wind/low-Sun captures are recorded in
`Exhibits/LightCompute/README.md`, `Results/Clouds.json` and `Results/Clouds.txt`. Camera misses march clouds
per pixel; indirect rays use a GPU cloud cube. Native checks cover 2,230 cube and 396 camera probes, uniform
Beer/ambient integrals, bitwise clear-path equivalence and invalid march bounds. Full clouds passed ASan/UBSan;
native, clustered, legacy Vulkan and indirect reconstruction regressions passed. Twelve compute entries;
no shaderInt64 feature needed. Optional native cloud ambient defaults to zero. Both analytic and emissive paths
remain. Existing native Sun, flare and stars are unchanged. Verification is SwiftShader CPU type 4, not physical
GPU or Windows acceptance. CPU atmosphere, approximate ambient, horizon march artifacts, spatial cloud shadows,
Moon and night/catalogue work remain open; see `Documentation/EnvironmentTodo.md`.

### Spatial cloud-shadow continuation — 2026-10-25

Sun extinction now uses each receiver and secondary-hit position, including reservoir/spatial targets, rather
than the observer-wide factor. Five-case native direct probes (2,165) and 117 secondary probes passed under
ASan/UBSan; temporal/spatial reuse is explicitly exercised. Wind and cloud disable/re-enable match cold direct/
indirect reconstruction. The disable case first reproduced stale history; cloud selection now participates in
history invalidation. Both lighting paths and existing native Sun/flare/stars remain.

The previous ambient field was accidentally zero-filled during upload. Fixed the missing initializers, required
nonzero RGB in its analytic check, and reran all cube/camera probes and cloud captures under ASan/UBSan. Four
actual vehicle/ground wind captures are retained in `Exhibits/LightCompute/Images/CloudShadowVehicle.png` and
`CloudShadowGround.png`. Full-size concurrent software runs hit allocation errors; run captures serially. A final
view was resumed successfully; operation-specific Vulkan failures and capture resumption are retained.

`Exhibits/LightCompute/README.md` and `Results/CloudShadowRegression.txt` record scope and regression chronology.
Still SwiftShader CPU type 4, twelve entries, eight SSBOs, 128-byte pushes and no Int64 feature. No physical
GPU/Windows/real-time acceptance. CPU atmosphere, flat-slab horizon artifacts, approximate ambient, indirect cube
seams, finite-Sun penumbrae, Moon and night/catalogue work remain open. Spatial cloud shadows are no longer open.

### Cloud-shadowed fog and shaft checkpoint — 2026-10-25

The inherited cloud density was ported, not redesigned. Previous ground shadows were not god rays. Added new
native/GPU single scattering through the inherited height-fog density: cloud/triangle-shadowed directional and
point/IES/spot arrivals, analytic camera/light optical depth, source-to-surface fog attenuation and sampled
emitter-to-surface extinction. Legacy native colour-blend `ApplyFog` remains, not relabelled as this feature.

Actual 320×200 sky, ControlVehicle and local-light comparisons are in `Exhibits/LightCompute/Images/Fog*.png`;
`README.md` explains the deliberate thin broken-cloud sky fixture and all limitations. Native checks cover
654 numeric and 390 captured camera rays plus 270 surface arrivals. Zero density is bitwise unchanged; analytic,
geometry-occlusion, history-isolation, toggle/cold and bounds checks passed under ASan/UBSan. Regular sampling
is not converged: shadow16→64 differs by up to 0.0293056 red on 12 sampled rays. Do not claim final-quality fog,
multiple scattering, emissive-volume scattering or fully coupled inter-bounce/cloud/atmosphere transport.

Thirteen compute entries, eight SSBOs, 128-byte pushes; unchanged allocation and no shaderInt64 feature. Still
SwiftShader CPU type 4, no physical-GPU/Windows/real-time acceptance. Existing Sun/flare/stars unchanged; Moon
remains planned. Run `Exhibits/LightCompute/RunFog.sh` serially; detailed checks live in `Results/Fog.json`.

## Fog shadow quadrature refinement — 2026-10-25

Two fixed-camera ControlVehicle/wind fixtures compare 16/32/64/128 shadow samples at 32 view midpoints.
Actual 160×100 readbacks and 936 independent native probes are retained in `Exhibits/LightCompute`.
64-step full-image RGB RMSE against finite 128-step quadrature decreased 96.57% / 96.39% versus 16;
the exhibit preset is now 64. This is 4× shadow samples, not a speed or full-convergence claim.
`Results/FogSampling.json`, `Images/FogSamplingComparison.png` and `RunFogSampling.sh` retain/reproduce it.
Earlier 320×200 evidence remains unchanged at 16 steps. Historical medium prose was incorrect: source and
captures actually used 0.0015/m and 450 m, not 0.0007/m and 650 m. Metadata corrected, images unchanged.
View marching/aliasing, temporal fog, coupled/multiple scattering, final cloud appearance, Moon and physical
GPU/Windows acceptance remain open; preserve both lighting paths and existing Sun/flare/star code.

Fresh ASan/UBSan checks passed: 654 preset camera probes + 270 surface probes and 1,040 budget-study probes;
external-driver leak detection disabled. Four native CTests passed. Exact new logs are `FogSamplingPresetChecks`,
`FogSamplingSanitizers` and `FogSamplingRegression` under exhibit `Results/`. Diagnostic refinement now uses
shadow128 as the finer budget; the former shadow64 check would be a vacuous self-comparison with the new preset.

## Emissive-volume single scattering — 2026-10-25

Shared Slang fog now optionally gathers emissive triangle radiance, not just emitter-to-surface attenuation.
Area/luminance CDF samples use solid-angle conversion, HG phase, triangle visibility and analytic source-to-volume
extinction. Both lighting types remain. Fog[15] selects 0–64 samples; default 0 preserves older presets.
Actual 160×100 original-ControlVehicle/ground captures add an explicit 2×2 m calibration panel (not a new model
or hidden source boost). Isolated emissive-only and combined analytic/emissive volume lighting are retained in
`Exhibits/LightCompute/Images/FogFacetComparison.png` and `FogFacetCombined.png`. 468 capture and 448 sanitizer
native camera probes passed; capture maximum RGB error 1.59192e-5. A 131,072-sample native rectangle integral
matches independent analytic solid angle within 0.0446%. Cold/zero-density/empty-CDF equality, surface isolation,
geometry occlusion and invalid inputs checked; external-driver leak checks disabled.
Reproduce serially with `RunFogFacets.sh`; see exhibit README and `Results/FogFacets.json` for exact scope.
Emissive-volume single scattering is no longer wholly absent, but remains opt-in and finitely sampled. Multiple
scattering, coupled inter-bounce transport, temporal fog, final clouds, Moon and physical GPU/Windows/viewport
acceptance remain open. Sun/flare/stars are unchanged. No speed or real-time claim.

Emissive-volume regression checkpoint: legacy fog ASan/UBSan checks, Vulkan exact/cluster/overflow,
static/moving history, light-off/residual refresh and all four native CTests passed. The first legacy history
attempt used the primary-motion archive (no uploaded raster receivers), correctly failed its coverage assertion,
and was rerun successfully using native `--vulkan-input` and `--motion-input` archives. Chronology is retained
in `Exhibits/LightCompute/Results/FogFacetRegression.txt`; this was a fixture-selection error, not a renderer fix.

## Working cloud budget and material source decision — 2026-10-25

User requested lower cloud sampling for iteration. Current working fog scenes use cloud32 and fog-shadow32,
self-shadow6 and view32. This supersedes the former 64-shadow working preset. High-budget fixtures remain
explicit reference tools; `RunCloudPreview.sh` defaults to low-only, `COMPARE=1` requests reference renders.
Actual two-wind 160×100 comparison RMSE to finite64: 0.00207406 / 0.00187121; appearance inspected and accepted
for iteration, not final quality. Fresh Release/native tests passed, no fresh sanitizer or hardware-speed claim.
See `Exhibits/LightCompute/README.md` and `Results/CloudBudget.json` / `CloudPreview.json`.

Reuse materials from SultanAladin/Frontier arena/5e581235-frontier, **except rewrite glints/flakes/glitter**.
Pinned source audit at be1d0a8e45d39738f37ccf711522a745e326e149: 452/455 selected files already identical,
including all 399 material archive files and the material/paint shaders. Three newer upstream vector-gradient
files use a different ABI; no partial import. Full layered material evaluation still needs scene integration.
Existing glint research and executed adapter comparison are retained; no physical-GPU winner or completed
rewrite is implied. Licensing-safe implementation, sampling/PDF consistency and temporal/energy checks remain.
Audit/reproduction: `Exhibits/TextureStudio/MaterialReuse.md` and `Code/MaterialReuseAudit.py`.

## Retained cellular materials and rough reflections — 2026-10-25

The user subsequently selected existing cellular flakes for the Racing Green car. This supersedes the earlier
glint rewrite exception for this work; no replacement material library. Native ControlVehicle coat/rubber,
thin transmitting windows, triangle-BVH side mirrors, plastic cones and reused shaderball/cloth are rendered
in `Exhibits/LightCompute/MaterialScene.md`. All 399 archived material files remain unchanged.

Energy allocation correction at 05e4090: paired diffuse interface transmission and bounded reciprocal fuzz
coverage. Expanded 384 native/34 Vulkan cases pass the declared 1.02 energy threshold; this is not all-option
or complete-library acceptance. See `Exhibits/TextureStudio/MaterialEnergyAcceptance.md`.

Plastic now uses full shared-BRDF cosine/GGX sampled directions, verified screen-proposed facet intersections
and clear segments, with BVH fallback. Same-seed BVH-only comparison is exactly equal for 14,941 screen rays
and 204,392 fallbacks. Repeat, off-screen source contribution, all-sources-off black and moving-source/fresh
submission equality pass on SwiftShader. Actual sharp/rough and two-position motion captures, reproduction
and limitations: `Exhibits/LightCompute/RoughReflections.md`. Source-off/motion checks use fresh hit shading,
not screen-colour history. Sixteen samples per proposal retain visible noise; no speed claim. Roughness-mip
colour history, temporal specular reconstruction, solid-volume refraction, full sampling/PDF acceptance and
physical RTX/GTX/Windows/viewport verification remain incomplete. Sun/flare/stars and both lighting types stay.

## Pole-shadow report and reflection history — 2026-10-25

User observed a previous-project pole shadow cut off halfway, independent of light/camera. Current native
compute test does not reproduce it: 72 combinations, 3,538,944 analytic closed-box silhouette comparisons,
zero mismatches and 111,408 verified far-half shadow points. Need the old project/file/commit or screenshot
to identify that defect; do not claim the reported shadow bug fixed. Ground-grid readbacks are not a
primary-camera beauty render. See `Exhibits/LightCompute/ShadowHistory.md`.

Continued reflection work now has limited angular-aware temporal/spatial reconstruction for authored rough
surfaces; very smooth/mirror/glass routes bypass it. Independent finite-reference RMSE 0.246571 → 0.0927787;
88 native filter probes pass, 520 smooth pixels preserved, camera acceptance/rejection and source-off black
verified. An independent bug in the native exhibit submission's geometry revision was reproduced: moving
emitter geometry without changing its colour/token retained indirect history. Packed-facet snapshots now
invalidate authored-scene history (compact-only diffuse moving-history policy is retained); moved output matches a fresh submission exactly (negative-control RMSE 0.156373). This is
not the pole-shadow defect. Snapshot memory/comparison cost is not optimized or a speed claim. No screen-
colour mip history, complete specular-denoising acceptance, physical GPU/Windows/editor or sanitizer claim.


## Primary smooth dielectric volumes — 2026-10-25

`Exhibits/LightCompute/SolidDielectric.md` records actual 96x64, 128-path SwiftShader CPU Vulkan captures.
Runtime category-4 float-atlas override only: exact Fresnel/Snell/TIR, radiance index factors, interior-distance
Beer absorption, 32-interaction cap, 128-primary-sample cap, geometric outward normals, directional history
bypass. Saved TOML/preset validation and existing category-2 thin sheets are unchanged. 199 boundary cases
(max error 2.18084e-6), 149 reciprocal native identities, four slab fixtures (max central mean error .00346691),
zero valid-fixture capped/unsupported paths; inside-camera/inverted-winding rejection tests pass. Origin
normal offset 2e-5 and negative local hit tolerance -5e-6 fix demonstrated coincident-corner path escapes;
not a general watertight mesh/scale proof. Primary-only exhibit, not completed solid-glass integration.

Secondary solid paths inside sampled material-ray loops reproduced a SwiftShader pipeline-construction
segfault, including after moving terminal shade evaluation outside the solid interaction loop. Removed that
candidate; secondary category-4 encounters explicitly return black. Do not claim working reflected/rough
secondary solid refraction, physical GPU/Windows/editor, caustics, rough glass, nested media or saved authoring.
No speed claim. Existing analytic/emissive lighting, cellular flakes, sun/flare/stars preserved.


## Mirror-to-volume extension and remaining work — 2026-10-25

Primary planar mirrors now share one `IntegrateBoundaryRays` volume integration call site with primary closed
glass. This arrangement passes SwiftShader pipeline creation and actual mirror captures without raising the
normal stack limit. Multiple/nested solid call sites still crash the tested driver, including moved-out-of-thin-
loop, no-inline, forced-early-inline and 64 MiB stack experiments; no underlying driver diagnosis/fix claimed.
Category-1 mirror throughput .94 retained; now uses configured bounded sample count (up to128) rather than
one ray. Mirror marker1.y remains any scene hit; .z packs capped*256+unsupported. Primary marker5 unchanged.
`Exhibits/LightCompute/MirrorDielectric.md`: four mirror slab means on196 central pixels; maximum .00307599;
source-off6144 pixels exactly black, actual96x64 captures with32 mirror paths. See final logs for regressions.
Rough sampled category4 encounters and primary thin-sheet-to-solid paths remain unsupported black; no
recursive mirror chain, nested/rough glass, inside-camera, caustic, full authoring, physical GPU or Windows claim.
`Exhibits/LightCompute/RendererProgress.md` is the emoji done/remaining report; no invented global percentage.


## Sampled rough reflection through smooth glass — 2026-10-25

One flat proposal sequence and one `TraceSolidDielectric` call site now serve authored cosine/GGX material
rays, primary glass and mirrors. `IntegrateBoundaryRays` moved into MaterialRayTransport after the PDF/screen
helpers. Fresnel branching has a separate RNG state so absorption cannot perturb subsequent BRDF directions.
Generic non-screen receiver marker6 exports capped/unsupported counts; screen/mirror/primary metadata retained.
`Exhibits/LightCompute/RoughDielectric.md`: actual96x64,32samples x2proposals, reflectors roughness .06/.30/.65;
index-matched absorption changes11118 channels; ratios .924979/.813363/.710670; exact repeat, source-off6144
pixels black. Pinned213f050 transport shaders reproduce zero changed channels (absorption ignored).
This is rough-reflector transport through smooth closed glass, NOT rough/frosted glass boundaries. Primary
thin-sheet-to-solid and legacy compact-only diffuse paths remain unsupported; no full material/PDF or hardware
acceptance claim. Updated RendererProgress.md distinguishes completed fixtures from remaining renderer work.

The final ROUGH_DIELECTRIC_BUILD=0 wrapper passed: three new optical screen/BVH exact comparisons,
primary/mirror slab and rejection checks,199 boundary cases,4/4native CTests,opaque history88probes, and the
previous192x120 rough-reflection suite (14941screen/204392fallback rays, RGBerror0, sourceoff/movedfresh pass).
Thirteen compute entry points compiled at Slang-O0. No physical GPU/Windows/editor or speedup claim.


## Primary thin-sheet window followed by closed glass — 2026-10-25

All authored primary receivers now use one `IntegrateBoundaryRays` site. Category2 adds two deterministic
proposal directions with the previous Schlick/two-interface/Beer sheet weights; both directions use the one
solid trace site. Removed the separate primary-sheet ray loop that returned black on category4 hits. Sheet
marker2.y remains any reflected scene hit; .z packs capped*512+unsupported. Configured at most128samples,
two directions each; tracer cap32 retained (previous primary-secondary pane loop cap8 not retained).
`Exhibits/LightCompute/WindowDielectric.md`: actual96x64,64samples x2directions;4slab means (max .00312531),
100central probes per case; sheet reflection and combined white-source controls maxerror1.1283e-6; all6144
pixels sourceoff exactly black. Pinnedabed7c6 transport negative control verifies formerly blocked transmission.
Mirror negative control updated to pinned8a1f38f transport files because its old dispatch edit no longer applies.
This preserves approximate sheet weights, not exact sampling/traversal or a speed claim. Legacy compact-only
diffuse integration, saved closed-glass authoring/vehicle binding, rough boundaries/nested media/inside cameras,
caustics/full denoising/unified moving scene, physical RTX/GTX/Windows/editor remain incomplete.

Final WINDOW_BUILD=0 wrapper exited0: pinned abed7c6 window control returns black on100 central pixels;
pinned8a1f38f mirror control also passes. Primary/mirror/rough-glass,199boundary cases,opaque history and
4native CTests passed; original rough reflection suite retains14941screen/204392fallback rays with RGBerror0.
13compute kernels compiled. Evidence manifest163sources/211products verified; actual software Vulkan only.


## Compact diffuse receivers through smooth closed glass — 2026-10-25

The compact material-address-zero route now joins `IntegrateBoundaryRays`: same uploaded cosine directions,
diffuse response*pi, .002 origin and first-hit lower bound0; compact counters13/14/15 retained. Marker7 exports
capped/unsupported counts. NaN-poisoned material-address channel remains valid unassigned data, not a material.
Root emitter sampling still excludes ordinary first-terminal emission; terminal emission after a closed-solid
boundary is retained because direct-emitter shadow rays conservatively block volumes. Shielded emitter fixture
requires positive exact equality with emitter sampling enabled/disabled. Pure-sheet emitter weighting is not
newly validated; only closed-solid encounters trigger this terminal-emission exception.
`Exhibits/LightCompute/DiffuseDielectric.md`: actual96x64,64cosine samples; three diffuse albedos .3/.6/.9;
Beer absorption changes15360channels, ratios .903583/.761600/.632968; seeded repeat/sourceoff/counters verified;
shielded refracted RGBtotal71.4212. Pinned02d5d13 transport negative control verifies the previous blocked route.
Native compact-only history-revision policy is unchanged; see final regression logs for vehicle/history tests.
No complete MIS, caustic, rough/nested glass, saved authoring/vehicle-binding, physical GPU/editor or speed claim.

The compact phase full regression wrapper exited 0: prior boundary/primary/mirror/rough/sheet checks and four
CTest tests pass; retained vehicle 901-probe native oracle max error 4.6271e-6, source-family linearity
8.44436e-6 and source-off black. Compact reconstruction RMSE .0103498 → .0058573, 210 native spatial
probes max 4.8961e-8. Six 160x100 poses exercise reuse/reset (0/12076/12067/0/12064/12079), preserve current
emission and direct histories (max delta 3.8147e-6). Actual 640x400 retained vehicle readback is included,
explicitly NOT newly authored glass bindings. Evidence manifest: 167 sources / 221 products.
