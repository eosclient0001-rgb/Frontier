# ReSTIR Editor Integration

Status: integrated and built. The windowed editor renders a live combined-mode
ReSTIR viewport; GPU execution happens on a real driver (developer's machine).

## What landed

- `Frontier/Engine/Rendering/ReplayViewportRenderer.{h,cpp}` — new Engine
  renderer. Owns a private Vulkan compute device (driver loaded from an
  explicit path), eight storage buffers, four replay pipelines and a bounded
  diffuse-room scene (patches → `TriangleVisibilitySpace` BVH → facets with
  explicit normals, two emissive sources, one blocker). Every frame submits
  the Engine `RecordPathReplay` recorder in combined temporal + spatial +
  seed-bank sample-history mode (bounces 4, environment 0.025³, history cap
  1024) with a drifting camera so reprojection/temporal reuse is exercised
  continuously. History reset follows `PathReplayHistoryDomain` decisions.
  Readback is tonemapped `1 − exp(−x)` RGBA8. No analytic lights.
- `Engine/Interface/VulkanPresentation` — dynamic texture API:
  `CreateDynamicTexture` / `UpdateDynamicTexture` / `DestroyDynamicTexture`
  over `ImGui_ImplVulkan_AddTexture` with staging uploads; textures die with
  the allocation, before `ImGui_ImplVulkan_Shutdown`.
- `Frontier/Applications/Editor/FrontierMain.cpp` — `ConstructViewportPanel`
  placeholder replaced: initialises the renderer once (diagnostics go to the
  LogStream `Render` category), uploads each frame and presents it with live
  statistics (frame, accepted banks, submit ms). Failure paths print the
  diagnostic in-panel; nothing fakes a frame.
- Root `CMakeLists.txt` — `FrontierPortableEngine` (portable Engine UI/scene
  sources, dual include roots) and `FrontierEditor` targets modelled on
  `TextureStudio`; SPIR-V staged into `Shaders/` next to the executable.
  `.github/workflows/WindowsWorkspaces.yml` builds `FrontierEditor`.

## Verification

- ✅ Host syntax/object compile of all 23 editor + renderer translation units.
- ✅ Full Windows x64 cross-build (Zig 0.13, official toolchain) links
  `FrontierEditor.exe` (13.8 MB, static, `Shaders/*.spv` staged).
- ⏳ GPU window run: end-user machine (no ICD/display in the sandbox) —
  `Delivery/Frontier-Editor-Windows-x64.zip` + `README-Editor.txt`.
- Combined-mode estimator correctness remains covered by the host studies and
  the GPU validator package (`Delivery/Frontier-ReSTIR-Windows-x64.zip`).

## Next

1. First GPU run report (accepted banks > 0 after frame 1, no reset storms).
2. 1:1 Outliner/Inspector pixel-parity capture against the pinned HTML.
3. Sun/sky/clouds environment pass into the viewport (no analytic lights).
