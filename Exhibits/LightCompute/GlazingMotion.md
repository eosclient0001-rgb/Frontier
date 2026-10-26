# Moving closed-glass ControlVehicle — 2026-10-26

**In progress:** native six-pose construction and ASan+UBSan passed; six-pose GPU acceptance **failed at pose4; under investigation**.
Poses0–3 and warm opaque reuse passed. No accepted six-pose animation yet.
Static native/320×200 Vulkan regression passed, including exact equality of all five prior published PNGs.
Do not substitute prior static-glazing observations for completion of this moving-scene check.

## What changes

- Shared native vehicle-glazing construction now serves static and moving fixtures. Saved IOR1.52 and
  RGB absorption [1,4,12] inverse metres feed the same category-4 atlas; geometry remains nominal6mm.
- Each of six archived ControlVehicle poses rebuilds its actual284 closed window triangles and BVH.
  All four added reflector facets rotate/translate with the body instead of remaining fixed in world space.
- Derived moving tokens100700(glass)/100301(mirrors) exceed the archive's vehicle threshold. The static
  fixture keeps its original700/301 tokens. Reusing those small static tokens for moving geometry would cause
  the existing shader to compute static previous positions; this phase avoids that classification error.
- Independent native inverse/forward rigid transforms check previous pane/mirror positions. Camera movement
  includes an actual cut at pose3; the six car angles are0/.08/.16/.24/.32/.40radians.
- A reconstruction-disabled reference follows exactly the same direct histories and seeds as the reconstructed
  submission. Glass/mirror indirect output must remain exactly fresh, with zero temporal/spatial filtering.
- A repeated static frame must exercise opaque indirect reuse. Every body-geometry revision conservatively
  invalidates authored indirect history. This is safe refresh, **not** improved moving-glass denoising.
- A separate static emissive-colour revision must change rendered output and reject stale indirect history.
  Removal of analytic, emissive and environment sources must yield black output despite populated history.

## Reproduce

```bash
bash Exhibits/LightCompute/RunGlazingMotion.sh
# Already completed static setup/acceptance:
MOTION_BUILD=0 bash Exhibits/LightCompute/RunGlazingMotion.sh
```

Dependencies and device selection follow [static vehicle glazing](VehicleGlazing.md). NativeCPU validation is
also available through `--glazing-motion-native`; it does not load Vulkan. Sanitizer execution builds the same
native host with ASan+UBSan and runs that native-only six-pose path. `MOTION_SANITIZE=0` skips rebuilding it
when a completed sanitizer result is already retained.

## Acceptance scope

- Actual native C++/Vulkan192×120 readbacks,16 transport samples; original native saved spectrum.
- Preserve Racing Green cellular flakes, rubber, cones, analytic and emissive lighting and existing sky data.
- Six discrete poses, not an interpolated simulation or a real-time performance demonstration.
- No shader/descriptor/material ABI or temporal policy changes are intended in this phase.
- No physical RTX/GTX/Windows/editor importer, general CAD offset certification, nested/rough glass,
  transmitted analytic shadows, caustic solver or unified moving SDF/cloud/fog acceptance claim.

## Static extraction regression

The refactored setup produced the exact previous five PNG byte streams at checkpoint2e3eb62, not just matching
counts. All13 compiled SPIR-V byte streams also retain their previous accepted digests. Static acceptance
again reports887glass pixels /1851changed channels /0caps /0unsupported, exact repeat, moved=cold and
64000black source-off pixels. The native exporter again passes39checks and all4native CTests pass.
See `Results/GlazingMotionRegression.json` and `Results/VehicleGlazingGpu.txt`. The previous full optical
chain is retained; it was not rerun unchanged in this phase because no shader/core-renderer changes occurred.
