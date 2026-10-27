# Engine-owned bounded replay domain

The formerly exhibit-local replay intake is now authoritative in `Frontier/Engine/Rendering/`:

- `PathReplayFootprint.h` defines the C++17-compatible 144-byte receiver and facet records.
- `PathReplayDomain.{h,cpp}` validates the bounded BVH, material atlas and receiver inputs; compiles the
  emissive-facet index list; and owns the exact input snapshots used by the existing history-cap policy.
- `FrontierPathReplayDomain` is a standalone C++20 CMake library. Its scene view is non-owning: the caller
  must keep the pointed-to arrays alive and immutable during each call. Domain failures throw
  `std::runtime_error`; a changed input caps retained history at one, while an unchanged input caps it at 64.
  The full-history switch is an audit control, not a recommended dynamic-scene policy.
- The exhibit adapts its existing archive to the Engine view and links the Engine library. The old
  exhibit-local domain implementation was removed. The existing replay shader already resides under Engine;
  Vulkan allocation, submission, fixture generation and validation remain in the exhibit.

This is an ownership and reuse checkpoint, **not** an editor integration or a complete ReSTIR GI pipeline.
The policy still snapshots inputs on the CPU and is not a scalable production scene-revision system. Its
1/64 cap is a heuristic, not an unbiasedness guarantee. Previous limits on material support, reprojection,
finite random streams and physical-GPU validation remain in force.

## Verification

- An independent Engine consumer checks the ABI, source index compilation, seven malformed-domain cases,
  nine revision axes, in-place atlas mutation, the audit override and invalidation. Its release and
  ASan/UBSan builds pass CTest.
- A separately compiled C++17 consumer reproduces 864 bytes of the previous archive layout and reloads them.
  The existing C++17 VehicleCapture also builds and exports its 28,276-facet fixture using the shared footprint.
- The Engine library also builds standalone. SwiftShader CPU-Vulkan regression results are linked below;
  the external Vulkan driver is not sanitizer-instrumented. These checks preserve bounded fixture behavior,
  not real-world material calibration, a hardware-GPU result or a runtime-performance claim.

```bash
bash Exhibits/LightCompute/RunPathReplayEngine.sh
SANITIZE=1 bash Exhibits/LightCompute/RunPathReplayEngine.sh
cmake -S Frontier/Engine/Rendering -B _ClaudeScratch/build/path-replay-engine-standalone
cmake --build _ClaudeScratch/build/path-replay-engine-standalone
RESULTS="$PWD/_ClaudeScratch/engine-replay-vulkan.txt" bash Exhibits/LightCompute/RunRoughTextureReplay.sh
```

[Engine release](Results/PathReplayEngine-release.txt) · [Engine sanitized](Results/PathReplayEngine-sanitized.txt) ·
[C++17 vehicle export](Results/PathReplayEngine-cxx17.txt) ·
[Vulkan release](Results/PathReplayEngine-vulkan-release.txt) ·
[Vulkan sanitized host](Results/PathReplayEngine-vulkan-sanitized.txt) ·
[Replay regressions](Results/PathReplayEngine-regression.txt) ·
[Existing rough-texture scope](RoughTextureReplay.md).
