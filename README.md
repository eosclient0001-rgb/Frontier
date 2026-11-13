# Frontier

General-purpose, cross-platform editor with reusable engine code.
EngineUpdate establishes documentation, audits inherited violations, and repairs code in reviewed batches.

## Current native UV continuation

The requested `SultanAladin/Frontier` branch `arena/4c9015d5-frontier` is pinned at `624883b66512`.
Its missing UV build/runtime sources are recovered alongside the earlier port on this session branch.
Native UV input follows GLFW capture → the existing editor `InputExchange` → one ImGui intake.
The editor and game own separate exchanges; no additional wheel-input class is used.
The broader repair covers Vulkan gizmo visibility, historical Y-up presentation, real shading/debug dropdowns,
material/specular/MatCap response, reference cards, the split divider, camera lag, and resize/DPI attachments.
See [native UV repair and validation](Exhibits/UVWorkspaceRepair/README.md) for evidence and Windows build steps.
The [original wheel-only acceptance](Exhibits/UVInput/README.md) remains historical evidence, not the current scope.

Select the UV build with `-DFRONTIER_BUILD_UV_WORKSPACE=ON -DFRONTIER_PROFILE=Editor` and run `FrontierUV`.
The older UI-only build is retained with `-DFRONTIER_BUILD_UV_WORKSPACE=OFF`.

## Earlier VehicleHMI continuation

The earlier branch `arena/2ac8ddab-frontier` is continued on `arena/672a179a-frontier`.
See the [continuation report](Exhibits/ContinuationReport.md) and the detailed
[vehicle source audit and executed checks](Exhibits/VehiclePhysics/Continuation.md).
The actual demo Moon texture, mixed flares and selectable XPBD/solid tyre shapes are retained and tested.
Project Drive's vehicle core is separately available, but is not wired into the editor or a Jolt host. Long-impact
parity and validation against measured tyres, vehicles, sky and lens data remain open.

## Start here

- Read [agent instructions](CLAUDE.md) and the four mandatory skills before contributing.
- Follow the [folder map](Documentation/FolderStructure.md) and [workflow](Documentation/Rules/AgentWorkflow.md).
- Track all progress and findings in the [single tracker](Documentation/Tracker.md).
- Follow the [active plan](Documentation/Plans/Ongoing/EngineUpdate.md).
- Retain reproducible evidence under [Exhibits](Exhibits/README.md).
- Build the [Control Centre, fonts, and themes](Exhibits/ControlCentre/README.md).

## Baseline status

Approved source baseline: `SultanAladin/Frontier-` at `338293863d7df4e585dec0c4acae45fe9c524ed5`.
This checkout is `SultanAladin/Frontier`, initially at `4a77bfd17f23536e32781718553ec6a171e39021`.
A selective UI foundation and Control Centre port is now present; the rest of the linked engine has not been imported or merged.
See [port evidence and Windows build steps](Exhibits/UIFoundation/README.md).
That selective-port baseline predates the current native UV and VehicleHMI continuations above.

## Builds and binaries

The user runs Windows; Windows binaries are the default requested binary deliverable.
Do not build or package Linux binaries unless asked. Preserve cross-platform source portability.
MSVC is the current user toolchain; supported GCC, MinGW-w64, and Clang configurations are also permitted.
No macOS setup or binary downloads are currently in scope. No Android application exists in this scope.

The retained UI-foundation build selects only its foundations and Windows UI exhibit, not the old engine.
Its earlier six local checks passed in Debug and with sanitizers. Windows x64 cross-compilation succeeded for that port.
Windows runtime/GPU execution and native MSVC verification remain outstanding.
Do not mix inherited build instructions with this selective target.
Local verification is automatic; GitHub Actions require explicit permission.

## Fonts

Run `python -m pip install -r Automation/FontRequirements.txt`, then `python Automation/PrepareFonts.py`.
This downloads four OFL-licensed families and generates native TOML and tooling JSON font catalogues.
Downloaded fonts remain ignored; the Windows package includes them and their licences.
The Control Centre exposes only interface appearance settings, not GI or renderer controls.

Primary rendering: Vulkan with Slang shaders. GLFW owns windows/input; the isolated ImGui exhibit may use DX11.
The Control Centre uses the reference trapezoidal notch and upward swipe-to-close drawer.
