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
