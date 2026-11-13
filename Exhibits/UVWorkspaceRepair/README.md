# Native UV Workspace Repair and Validation

> **Scope.** This document records the native UV workspace repair continuing from `SultanAladin/Frontier`
> branch `arena/4c9015d5-frontier` (commit `624883b66512daed348c33fcb164b616c9691d46`). It supersedes the
> earlier five-change wheel-only repair in [Exhibits/UVInput/README.md](../UVInput/README.md), whose historical
> logs, captures, and five-change audit remain preserved separately.

---

## Results Overview

| Verification Suite                               | Target Profile               | Result                   | Details                                                     |
| ------------------------------------------------ | ---------------------------- | ------------------------ | ----------------------------------------------------------- |
| Native CTest Regression Suite                    | Development / Debug          | 🟢 19/19 passed (178.5s) | Full headless CTest suite clean                             |
| Native CTest Regression Suite                    | Editor / ASan + UBSan        | 🟢 19/19 passed (292.9s) | Full headless CTest suite clean under sanitizers            |
| Focused Wheel Interaction Suite                  | Development / Debug          | 🟢 36/36 passed          | Production callback intake; 84px / 56px / zoom verified     |
| Focused Wheel Interaction Suite                  | Editor / ASan + UBSan        | 🟢 36/36 passed          | Zero dropped packets; idle deltas reset                     |
| Production Vulkan Rendering Suite                | Development / Debug          | 🟢 48/48 passed          | Gizmo, finishes, lag, orthographic ray-pick agreement       |
| Production Vulkan Rendering Suite                | Editor / ASan + UBSan        | 🟢 48/48 passed          | PBR response and all 16 MatCap assignments distinct         |
| Production Workspace Interaction Suite           | Development / Debug          | 🟢 79/79 passed          | UI framing, dropdowns, divider, finish controls, selection  |
| Production Workspace Interaction Suite           | Editor / ASan + UBSan        | 🟢 81/81 passed          | Includes full-editor input ownership and non-dormant intake |
| Unchanged HTML Reference Suite                   | Node.js / Playwright         | 🟢 11/11 groups passed   | All solvers, packing, and UI polish verified                |
| Pinned UI Dependency & Patch Check               | Python 3                     | 🟢 exit 0                | ImGui patches A–H verified                                  |
| Pinned Font & Shader Toolchain Check             | Python 3                     | 🟢 exit 0                | 35 fonts, Slang compiler, SwiftShader ICD verified         |
| Physical Windows Input & Physical Monitor DPI   | Windows host                 | 🚩 Not verified locally  | Linux SwiftShader test environment; see limitations         |
| GitHub Actions Windows MSVC Build                | Windows 2022                 | 🚩 Authorized / Pending  | Workflow configured on session branch; ready for push       |

Retained reports: [Summary JSON](Results/Summary.json) · [Continuation Audit](Results/Continuation.json) ·
[Development CTest XML](Results/Development.xml) · [Editor Sanitized CTest XML](Results/EditorSanitized.xml) ·
[HTML Validation Log](Results/HTML.txt) · [Contended HTML Baseline](Results/HTMLContended.txt).

---

## Repaired Acceptance Areas

### 1. Transform Gizmo Visibility and Normal Orientation
- **Defect:** The 3D translation/rotation gizmo appeared "wired" or inside-out because the depth buffer was
  cleared prior to drawing the gizmo, but subsequent rear-facing gizmo facets overwrote front-facing facets.
- **Repair:** Enabled depth-tested self-occlusion during the gizmo rasterization pass while preserving the
  underlying scene color and pick IDs. Corrected gizmo normal orientation to match winding order.
- **Verification:** Nearest-visible facet agreement improved from 77/478 (16.1%) to 477/481 (99.17%).
  432 shaded triangles verified with zero inverted normals (`MEASURE GizmoShadedTriangles=432 InvertedTriangles=0`).
  Captured evidence: [Before](Images/Before/Gizmo.png) versus [After](Images/After/Gizmo.png).

### 2. Real Shading and Debug Dropdowns
- **Defect:** 3D viewport shading and debug modes previously cycled sequentially through buttons, making direct
  mode selection slow and disrupting authoring workflows.
- **Repair:** Replaced cycling buttons with real `DropdownSelector` widgets in `UVViewportHost.cpp`:
  - Shading dropdown: *Surface Material (0)*, *MatCap (Per-Face) (1)*, *Material + MatCap (2)*, *Studio Clay (3)*,
    *Flat UV Charts (4)*, *Flat Face Slots (5)*, *Flat UV Checker (6)*, *Flat Priority (7)*, *Flat UV Stretch (8)*,
    *Flat Density (9)*, and *Flat Overlaps (10)*.
  - Debug dropdown: *Priority*, *Clean UV*, *Angle Stretch*, *Area Stretch*, *Texel Density*, and *Overlaps*.
  - Added Escape key cancellation: pressing Escape closes an open dropdown without altering the selected mode.
- **Verification:** Direct mode switching verified across non-adjacent selections (e.g., mode 5, 0, 4, 2, 3, 1).
  Captured evidence: [Surface Dropdown](Images/After/SurfaceDropdown.png).

### 3. Material Response: Metallic, Roughness, and Dielectric Specular
- **Defect:** Surface shading showed negligible response to metallic and roughness edits, and lacked dielectric
  specular reflection.
- **Repair:** Updated Cook-Torrance evaluation in `MatCapEvaluation.slang` and `SurfaceShading.slang`:
  - Added GGX specular microfacet evaluation with Fresnel Schlick dielectric formulation.
  - Integrated studio strip-light environment reflection responding directly to roughness and metallic values.
  - Added dielectric specular slider and live finish editing in `UVInspectorPanel.cpp`.
  - Pure MatCap finishes automatically transition to mixed mode upon parameter edits.
- **Verification:** Low versus high parameter sweeps confirmed visible pixel response:
  - Metallic: 58,733 changed channels, mean delta 37.83 (`Material0Low.png` vs `Material0High.png`).
  - Roughness: 58,800 changed channels, mean delta 1.39 (`Material1Low.png` vs `Material1High.png`).
  - Specular: 58,800 changed channels, mean delta 8.75 (`Material2Low.png` vs `Material2High.png`).
  Captured evidence: [Finish Controls](Images/After/FinishControls.png).

### 4. MatCap Atlas and Procedural Finish Restorations
- **Defect:** Carbon fibre, zebra, and metallic flake MatCaps collapsed to single flat texels on planar surfaces.
- **Repair:** Implemented triplanar spatial finish evaluation in `MatCapEvaluation.slang`:
  - Slot 7: Zebra contouring with normal-sensitive bands.
  - Slots 10 and 11: Metallic flakes with high-frequency procedural glints and distinct blue/red tints.
  - Slot 12: Carbon fibre with multi-filament weave and anisotropic tow glints.
  - Slot 13: Woven fabric texture with warp/weft filament modulation.
- **Verification:** Distinct flat-surface color counts verified:
  - Slot 7 (Zebra): 701 distinct colors.
  - Slot 10 (Blue flakes): 7,678 distinct colors.
  - Slot 11 (Red flakes): 7,778 distinct colors.
  - Slot 12 (Carbon fibre): 2,780 distinct colors.
  - Slot 13 (Woven fabric): 1,684 distinct colors.
  All 16 per-face MatCap slots render distinct production images.
  Captured evidence: [MatCap Comparison Sheet](Images/MatCapComparison.png).

### 5. Outliner and UV Space Cards Matching HTML Reference
- **Defect:** Native panel dimensions and card layouts drifted from the HTML authoring prototype.
- **Repair:** Aligned Outliner card geometry with browser measurements without modifying the UDIM Filter:
  - KPI trio: 280 px total width, 70 px height, 7 px gap, 16 px corner radius.
  - Diagnostics bento cards: 136 px width, 64 px height, 8 px gap, 20 px corner radius.
  - Layer rows: 280 px width, 40 px height.
  - **Invariance:** UDIM Filter dropdown construction and 14 px header/search/filter typography remained untouched.
  - Card interaction: Clicking Remaining or layer cards automatically selects faces in Faces mode.
- **Verification:** Exact dimension assertions in `WorkspaceInteractionValidation` passed.
  Audit confirmed zero lines changed in UDIM Filter logic (`UDIMFilterConstructionIdentical: true`).

### 6. Draggable / Resizable 2D / 3D Split Divider
- **Defect:** The divider between 2D and 3D viewports was static and could not be resized interactively.
- **Repair:** Added interactive split-ratio dragging in `UVViewportHost.cpp` with persistent storage in the
  workspace session, clamped between 0.15 and 0.85 of available viewport width.
- **Verification:** Dragged split ratio from 0.500000 to 0.610294 via mouse input; verified persistence and
  confirmed no underlying canvas navigation or picking occurred during divider drag.
  Captured evidence: [Resized Divider](Images/After/ResizedDivider.png).

### 7. Window Maximize, Dock Extent, and Framebuffer / DPI Updates
- **Defect:** Panels shrank correctly on window downsize but failed to grow when the window maximized; DPI
  scale changes caused blurry viewports or mismatched pointer coordinates.
- **Repair:**
  - `WorkspaceDockContainer.cpp` now refreshes operating surface dimensions when window extent changes.
  - `ViewportProjectionPane.cpp` and `UVViewportInteractor.cpp` convert logical coordinates to physical pixels
    for rasterizer targets and GPU picking queries.
  - Vulkan presenter retires obsolete texture allocations before creating resized textures.
- **Verification:** Negative control confirmed: stale 482x720 layout fails, while synchronized 982x980 succeeds.
  12 texture recreation steps executed without leak or validation errors. 2x framebuffer scale verified
  across 1x and 2x region selections (Box and Circle modes in both 2D and 3D viewports).

### 8. Orientation, Coordinates, and Historical 3cc230f6 Alignment
- **Defect:** An earlier commit introduced an incorrect Z-up camera assumption that inverted Vulkan presentation.
- **Repair:** Restored historical `3cc230f6` Y-up coordinate system:
  - World coordinate frame: right-handed, Y-up, XZ ground plane at Y = -0.02.
  - Camera basis: Top looks down -Y; Front looks down -Z; Right looks down -X.
  - Orthographic CPU rays and Vulkan picking reduction agree across 81/81 sample points.
  - **Invariance:** Vehicle geometry (12,572 vertices, 25,068 faces), import/export codecs, and Jolt physics
    coordinate conventions remained untouched.

### 9. Frame-Rate Independent Camera Lag
- **Defect:** Viewport camera motion lacked smooth damping and was dependent on frame rate.
- **Repair:** Implemented exponential damping in `ViewportProjection.cpp` using exact time deltas:
  `Factor = 1.0f - std::exp(-DeltaTime / ResponseTime)`.
- **Verification:** 60 Hz (15 steps) and 120 Hz (30 steps) runs over identical total elapsed time produced
  identical camera positions (`diff < 1.0e-5`). Non-finite time steps (NaN / Inf) are rejected cleanly.

### 10. Input Architecture: GLFW Capture and ImGui Intake
- **Architecture:**
  - GLFW captures OS peripheral events through registered window callbacks.
  - `DesktopPlatformWindow` enqueues events into `InputExchange` packets (48-byte, alignas(16)).
  - `DesktopWorkspaceLaunch.cpp` drains the exchange and calls `WorkspaceAppearance::ForwardEditorInputToImGui()`.
  - ImGui consumes the consolidated input packets and owns UI interaction.
  - Viewports extract mouse interaction from ImGui window-relative coordinates.
- **Invariants:**
  - Distinct editor and game exchanges: `EditorInput` and `GameInput` do not share state or overwrite each other.
  - No unrelated device polling: removed direct `glfwGetCursorPos` and `glfwGetKey` polling from UI panels.
  - No wheel wrapper: rejected `PointerWheelExchange` was not reintroduced.

---

## Metric Observation Note

The vehicle container metadata declares:
- Header: **878 charts** and **0.4725 utilization** (47.25%).
- Native runtime observed: **880 charts** and **47.2%** utilization across 25,068 faces.
- HTML reference catalog: Advertises **152 islands** and **42.5%** utilization for its simplified mesh.

These differences stem from the underlying mesh asset representation: the native engine evaluates the full
authoring asset, whereas the HTML reference uses a downsampled preview asset. The native metrics are reported
truthfully without cosmetic modification.

---

## Visual Evidence

| Capture Description               | File Path                                                         | Dimensions | SHA-256 Digest (RGBA)             |
| --------------------------------- | ----------------------------------------------------------------- | ---------- | --------------------------------- |
| Production Native UV Application  | [NativeApplication.png](Images/After/NativeApplication.png)       | 1600x980   | `ef475ba50068697dc59bd0ee48c7ef3` |
| Initial Settled UV Framing        | [NativeInitial.png](Images/After/NativeInitial.png)               | 1600x980   | `9f3f39e770dfd8dcd633746378ad4a5` |
| Real Shading Dropdown Active      | [SurfaceDropdown.png](Images/After/SurfaceDropdown.png)           | 1600x980   | `b0285192d4dff22e0526a77ed5614b6` |
| Resized 2D/3D Viewport Divider    | [ResizedDivider.png](Images/After/ResizedDivider.png)             | 1600x980   | `5be2a7d532cc97bf29cdd6cb067e1d9` |
| Live Finish Controls & Specular   | [FinishControls.png](Images/After/FinishControls.png)             | 1600x980   | `751d3f533a36879300eb5ff5692e8dee` |
| Compact Workspace Responsive View | [CompactWorkspace.png](Images/After/CompactWorkspace.png)         | 1100x720   | `c74f726aed6cfe96ba1c8e56426b4ce` |
| Standalone Launch Executable View | [StandaloneApp.png](Images/After/StandaloneApplication.png)       | 1840x980   | `76546e0cdd342047bce1bf49eeca961` |
| Full Editor Launch Executable     | [FullEditorApp.png](Images/After/FullEditorApplication.png)       | 1840x980   | `be587ad89d76a0667682d9f7c856dd0` |
| MatCap Procedural Comparison      | [MatCapComparison.png](Images/MatCapComparison.png)               | 1230x626   | `2c579a2c509b134e39d62adb2c29199` |
| Depth-Tested Gizmo Verification   | [Gizmo.png](Images/After/Gizmo.png)                               | 480x480    | `ecfbcab9983ad32f9f743df945f7edd` |
| HTML Reference Browser Capture    | [HTMLReference.png](Images/HTMLReference.png)                     | 1600x980   | `500883f9a71ef9da833da206196b52c` |

---

## Continuation Audit Summary

Executed `Exhibits/UVWorkspaceRepair/Code/InspectContinuation.py`:
- **229 of 267 imported paths remain byte-identical** to the pinned continuation revision (`624883b66512`).
- **38 scoped changes** cover rendering repairs, UI dropdowns, card layouts, input routing, and tests.
- **65 protected paths** (codecs, mathematics, content geometry, MatCaps, and HTML reference) remain unchanged.
- **UDIM Filter** construction is 100% byte-identical to upstream.
- **Historical vehicle** archive (`ControlledIntegrator.GeometrySpace`) is byte-identical to `3cc230f6`.
- **No wheel wrapper** exists; `PointerWheelExchange.h/.cpp` remain deleted.

---

## Windows Reproduction Instructions

To build and run on a Windows 10/11 x64 host using Visual Studio 2022:

```powershell
# 1. Recover pinned dependencies, fonts, and Slang compiler
python -m pip install -r Automation/FontRequirements.txt
python Automation/PrepareDependencies.py
python Automation/PrepareUVFonts.py
python Automation/PrepareShaderToolchain.py

# 2. Configure MSVC project
cmake -S . -B Build/UVWindows -G "Visual Studio 17 2022" -A x64 `
  -DFRONTIER_BUILD_UV_WORKSPACE=ON -DFRONTIER_PROFILE=Editor -DBUILD_TESTING=ON `
  "-DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded$<$<CONFIG:Debug>:Debug>"

# 3. Build Release executables
cmake --build Build/UVWindows --config Release --parallel 4

# 4. Run Windows platform and CPU validation tests
ctest --test-dir Build/UVWindows -C Release --output-on-failure `
  -R "^(InputValidation|WindowValidation|DockingValidation|ControlCentreValidation|WorkspacePanesValidation|LifecycleValidation|WorkspaceRevisionValidation|ContentBrowserValidation|GeometryNetworkValidation|UVBoundaryValidation)$"

# 5. Launch applications
.\Build\UVWindows\Release\FrontierUV.exe
.\Build\UVWindows\Release\FrontierEditor.exe
```

---

## Local Verification Commands

To reproduce the local Linux headless verification:

```bash
# 1. Prepare dependencies and toolchains
python3 Automation/PrepareDependencies.py
python3 Automation/PrepareUVFonts.py
python3 Automation/PrepareShaderToolchain.py

# 2. Configure and build Development profile
cmake -S . -B _ClaudeScratch/build/UV -G Ninja \
  -DFRONTIER_BUILD_UV_WORKSPACE=ON -DFRONTIER_PROFILE=Development \
  -DGLFW_BUILD_X11=OFF -DGLFW_BUILD_WAYLAND=OFF -DBUILD_TESTING=ON -DCMAKE_BUILD_TYPE=Debug
ninja -C _ClaudeScratch/build/UV

# 3. Run Development tests and focused validations
ctest --test-dir _ClaudeScratch/build/UV --output-on-failure
_ClaudeScratch/build/UV/WheelInputValidation
_ClaudeScratch/build/UV/WorkspaceRepairValidation
_ClaudeScratch/build/UV/WorkspaceInteractionValidation

# 4. Configure and build Sanitized Editor profile
cmake -S . -B _ClaudeScratch/build/UVEditorSanitized -G Ninja \
  -DFRONTIER_BUILD_UV_WORKSPACE=ON -DFRONTIER_PROFILE=Editor \
  -DGLFW_BUILD_X11=OFF -DGLFW_BUILD_WAYLAND=OFF -DBUILD_TESTING=ON -DCMAKE_BUILD_TYPE=Debug \
  -DCMAKE_CXX_FLAGS="-fsanitize=address,undefined -fno-omit-frame-pointer" \
  -DCMAKE_C_FLAGS="-fsanitize=address,undefined -fno-omit-frame-pointer"
ninja -C _ClaudeScratch/build/UVEditorSanitized

# 5. Run Sanitized Editor tests
ASAN_OPTIONS=detect_leaks=0:halt_on_error=1 UBSAN_OPTIONS=halt_on_error=1 \
  ctest --test-dir _ClaudeScratch/build/UVEditorSanitized --output-on-failure
ASAN_OPTIONS=detect_leaks=0:halt_on_error=1 UBSAN_OPTIONS=halt_on_error=1 \
  _ClaudeScratch/build/UVEditorSanitized/WorkspaceInteractionValidation

# 6. Verify HTML reference
node Experimental/UVEditor/UVValidation.mjs

# 7. Collect results and audit continuation
python3 Exhibits/UVWorkspaceRepair/Code/CollectResults.py
```

---

## Limitations

- **Headless Environment:** Local Linux execution runs on GLFW's null window platform with Google SwiftShader
  CPU Vulkan ICD (device type 4). Physical GPU rasterization and driver-specific hardware behavior were not
  tested locally.
- **Physical Peripheral Delivery:** Window events and pointer coordinates are replayed through registered GLFW
  callbacks and `InputExchange`. Physical mouse hardware feel, OS cursor acceleration curves, and raw Windows
  WM_INPUT were not physically exercised.
- **DPI and Display Scaling:** DPI tests programmatically verify framebuffer attachments, layout bounds, and
  coordinate mapping at 1x and 2x scales; physical multi-monitor DPI transitions require Windows desktop testing.
- **Leak Detection:** ASan leak detection is disabled (`detect_leaks=0`) due to third-party driver allocation
  tracking limitations; address error and undefined behavior checks remain active and clean.
