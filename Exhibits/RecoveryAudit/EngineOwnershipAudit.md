# Exhibit-to-Engine ownership audit

Audit base: `fe774a5796476bb055429e9ee3d1b208202e8aa1`, 2026-10-27. This is an ownership and evidence audit,
not a claim that every feature is integrated into the editor or that all archived tests were rerun. Both
`Engine/` and `Frontier/Engine/` contain shared code; `UI/` also contains production editor code. A source being
in either Engine tree does not by itself establish that the root application builds or uses it.

## Requested rendering and tyre features

| Feature | Shared implementation and actual consumer | Boundary / not yet ported |
|---|---|---|
| Atmosphere | `Frontier/Engine/Rendering/AtmosphereModel.*`; `ReferenceRenderer.cpp`; `Exhibits/EnvironmentPipeline/CMakeLists.txt` and NightSky tests | CPU medium/reference sky; LightCompute's atmosphere cube is CPU-prepared. No full GPU atmosphere LUT/editor integration or measured sky calibration. |
| Clouds | `CloudField.*`; `ReferenceRenderer.cpp`; cloud marching in `Shaders/LightInfluence.slang` | CPU reference and SwiftShader validation host; GPU scene packing and submission must not be mistaken for editor integration. Single-scatter approximation. |
| Fog | `FogMedium.*`; `ReferenceRenderer.cpp`; shadowed single scattering in `Shaders/LightInfluence.slang` | GPU execution is exhibit-hosted; not a complete production volumetric renderer. |
| Analytic lighting | `LightInfluenceSpace.h`, `CandelaDistribution.h`, `ReferenceRenderer.cpp`, `Shaders/LightInfluence.slang`; ClusteredLighting and LightCompute | Point/spot/IES cells tested in a bounded fixture; IES is a subset. Emissive triangles are not clustered. |
| Emissive triangle selection | `RadiantFacetDistribution.{h,cpp}`; LightCompute surface/fog tests call the Engine distribution | Global two-sided area/luminance CDF, separate from replay's uniform source list. The old builder and duplicate CDF checks are no longer the source of truth. No editor submission implied. |
| Sun and flares | `CelestialModel.*`, `SolarDiscFilter.h`, `LensFlareModel.h`, `SolarOpticsPayload.h`, `Shaders/SolarOptics.slang`; NightSky and LightCompute | Finite-pixel Sun and simultaneous flare terms on CPU and isolated Vulkan; no measured-lens calibration, GPU Moon mask or editor integration. |
| Moon and stars | `CelestialModel.*`, `LunarDiscProjection.h`, `LunarBounceReservoir.h`, `ReferenceRenderer.cpp`; NightSky | CPU reference only. Actual demo Moon JPEG is in `EngineContent/CelestialMaps/`; redistribution licence still needs review. No GPU/editor Moon, stars or general lunar GI. |
| XPBD deformation | `Frontier/Engine/Physics/TyreContinuum.{h,cpp}`: 160-particle `TyreCarcassProjection`; VehiclePhysics JS/native comparisons | Prescribed shape and reaction law, not independently measured tyre contact. The older 84-particle `TyreCarcassLattice` is a distinct implementation, not a port of the demo's XPBD. |
| Hex8 3D solid deformation | Same `TyreContinuum.{h,cpp}`: `TyreCarcassSolid`; VehiclePhysics comparisons | 128-cell, 160-particle demo approximation with prescribed reaction; not validated against measured tyres or a general-purpose FEM package. |
| Spring tyre | Analytical vertex deformation in `TyreDeformation.h`; tyre load law is embedded in existing `VehicleSolver.cpp` | Source parity is limited; the 720-step free-running hard-drop test fails and its timestep study is not converged. Separate demo continuum shell is unported. No new vehicle/Jolt port is authorized. |
| ReSTIR GI | `PathReplayFootprint.h`, `PathReplayDomain.*`, `Shaders/PathReplayReservoir.slang`; LightCompute uses the Engine library and shader | Bounded replay experiment only: no complete ReSTIR pipeline, general dynamic geometry, hardware GPU or editor integration. |

## All exhibit directories

The unit of this inventory is each top-level exhibit plus its principal implementation clusters, not a line-by-line
certification of every fixture or historical claim. The table is based on current source, CMake/runner includes and
the newest evidence; historical README text can be superseded. C++ test programs, JS reference oracles, image
converters, viewer pages and fixed scene data remain in Exhibits rather than being copied into Engine.

| Exhibit | Current ownership and evidence boundary |
|---|---|
| `ClusteredLighting` | Shared CPU light grid/IES in `Frontier/Engine/Rendering`; native-reference comparisons in the exhibit. GPU spot/IES checks live in LightCompute. |
| `CompleteRenderer` | CMake compiles `Frontier/Engine/Rendering/ReferenceRenderer.cpp` and its shared dependencies; captures and comparisons stay here. CPU reference, not the root editor renderer. |
| `ContentBrowser` | Shared `Engine/Interface/ContentDirectory` and `UI/Editor` panel; exhibit contains validation and captures. |
| `ControlCentre` | Shared `Engine/Interface` codecs/controls and `UI/Editor/ControlCentrePanel`; exhibit has CPU raster, navigation and package checks. |
| `Diagnostics` | Retained telemetry reports/CSV, not a reusable implementation. |
| `Docking` | `Engine/Interface/PanelDockspace*`, monitor/layout code and `UI/Editor`; exhibit validates workspace behavior. |
| `EnvironmentPipeline` | CMake compiles Engine atmosphere, celestial, cloud, fog and weather sources directly. Its declarations do not by themselves provide GPU execution. |
| `FluidReference` | Retained demo WGSL/JS under `Experimental/VehicleHmiReference`; exhibit runs pressure only. No native full gas/liquid solver port. |
| `GeometryPipeline` | CMake compiles `ClusterNesting.cpp` and `VisibilityCull.cpp` from `Frontier/Engine/Rendering`; generated geometry and assertions stay in the exhibit. |
| `IlluminationChain` | CMake compiles shared `DiscrepancySequence`, `ReservoirSampling`, `VarianceFiltering` and unit declarations. Statistical tests do not establish complete GPU ReSTIR. |
| `IndirectIllumination` | Shared `DistanceField`, `SurfaceCards` and illumination declarations; the exhibit is CPU validation, not a full GPU GI integration. |
| `LightCompute` | Engine Slang shaders and bounded replay domain are shared; exhibit contains Vulkan submission, archives, fixture construction and independent references. Some scene-payload preparation remains exhibit-local; integration is incomplete. |
| `LogStream` | CMake uses `Frontier/Engine/Diagnostics`, shared interface code and a separate editor entry point; capture/validation remains here. |
| `NightSky` | Shared atmosphere/celestial/optics evaluators and CPU reference renderer; star catalogue, ephemeris comparisons and captures are evidence. |
| `Notifications` | Shared `Engine/Interface/NotificationSequence` and editor UI; exhibit is validation/captures. |
| `ProjectBrowser` | Shared `UI/Editor/ProjectBrowserPanel` and Engine content/space codecs; browser/Windows checks remain exhibit-owned. |
| `ProjectSpace` | Shared `Engine/ContentInterchange/ProjectSpaceCodec`; TOML templates live in EngineContent; tests and review evidence stay here. |
| `RecoveryAudit` | Historical recovery/ownership reports only. |
| `RenderInfrastructure` | CMake compiles shared `Frontier/Engine/Rendering` scheduling/barrier/atlas code and threading/diagnostics; validation/captures are not GPU scheduling integration. |
| `Renderer` | Shared `Engine/Render` Vulkan rasterization/materials/Slang; exhibit fixtures, readback helpers and images remain tests. Software Vulkan captures do not prove Windows or physical-GPU acceptance. |
| `RendererPlanning` | Source comparisons and historical JS/Python validation results; no independent Engine implementation to migrate from this evidence. |
| `SceneDirectory` | CMake compiles `Frontier/Engine/Scene` and interface sources; exhibit constructs validation cases. |
| `SpaceFormats` | Review viewer, source findings and plans; it is not an implementation of the proposed formats. |
| `TextureStudio` | Shared authoring/material/pattern code in root `Engine/` and `UI/TextureStudio`; many exhibit programs capture, compare or validate. Native editor/material assignment and every HTML feature are not assumed complete. |
| `UIFoundation` | Root `Engine/Interface`, `Engine/Lifecycle` and `UI/Editor`; the exhibit's Windows UI is a validation host. |
| `VehiclePhysics` | Already-imported demo and Project Drive code is in `Frontier/Engine/Physics`; Jolt host/scene rendering and JS reference tests are exhibit-only. Further vehicle physics and Jolt work is held. |
| `VehicleReference` | CMake compiles shared `Frontier/Engine/Rendering` reference code. Vehicle geometry/material fixtures and captures remain exhibit-owned; no vehicle dynamics or GPU integration follows from them. |

## Audit method and evidence

- Enumerated all 27 top-level directories with `find Exhibits -mindepth 1 -maxdepth 1 -type d`; inspected C++/shader
  source lists, CMake links, runners, includes, newest results and documented limitations. Root `CMakeLists.txt`
  was inspected separately from the nested Engine CMake; neither tree was assumed to be the other's duplicate.
- Important unchanged evidence: [daylight/celestial](../NightSky/DaylightReference.md),
  [tyre source and failures](../VehiclePhysics/Continuation.md), [spot/IES](../LightCompute/ClusterSpotIes.md),
  [replay](../LightCompute/ReplayImportance.md), [gas pressure](../FluidReference/PlumePressure.md).
- This audit does not re-execute every historical validation or certify every public API. A count of the directories
  inspected is not a percentage of the user's intended feature set. Individual remaining work is tracked only in
  `Documentation/Tracker.md`, not maintained as a second backlog here.
