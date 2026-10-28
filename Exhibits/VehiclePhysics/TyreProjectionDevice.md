# Standalone GPU tyre projection

## What was added

The VehicleHMI demo's **XPBD-labelled** 32-sector × 5-node carcass is now also a Slang compute
implementation under `Frontier/Engine/Physics/Shaders/TyreProjectionDevice.slang`. It preserves the demo's
sequential 352 compliant-distance projections per substep, authored contact target and prescribed spring
force. One invocation owns a whole tyre, so independent tyres can execute concurrently without atomics; this
is a fidelity-first implementation, not a claim of efficient parallel constraint solving. The force is
`deflection * (25000 + 0.88 * pressure)` in newtons, **not** a reaction integrated from the particles.
This is not a general XPBD solver, a tyre/road force model, or proof of real-world tyre behaviour.

The Engine now owns a checked float32 ABI (`TyreProjectionDevice.{h,cpp}`) and an optional Vulkan command
recorder (`TyreProjectionVulkan.{h,cpp}`). Buffers, descriptor sets, pipeline creation, barriers, queue
submission and retirement are owned by the caller. There is **no editor, scene, mesh-renderer or production
simulation-loop consumer yet**; the direct Vulkan validation host under Exhibits is the only consumer of
the new recorder. No vehicle dynamics or Jolt code was changed.

## Contract

- Bind storage buffers at set 0: commands (binding 0), particles (1) and results (2). Each command and
  particle is 80 bytes, each result 16 bytes. Particles for each tyre are contiguous in 32 × 5 order.
  Compile each Slang entry to SPIR-V, create matching Vulkan compute pipelines and use entry `main` if
  compiling with the supplied runner. Specify `FRONTIER_TYRE_VULKAN_HEADERS` to build the optional Engine
  recorder target; it has no Vulkan-loader dependency because it borrows command function pointers.
- Reset a tyre before its first advance. A valid reset writes rest/local/previous/velocity/world values and
  a zero force; a valid advance updates local and world positions, previous positions, velocities and force.
  `ForceStatus[1]` is 1 for success and 0 for a rejected command. An insufficient buffer binding skips the
  tyre without changing state or status; the caller must provision and check all buffer sizes.
- `CompileTyreProjectionCommand` clamps negative deflection and pressure to zero like the demo; rejects
  nonfinite input, unnormalized quaternion/ground normal (squared-length tolerance `0.001`), centres outside
  ±1,000,000 m, deflection above 1 m, pressure above 2 MPa, lateral force beyond ±10 MN, time outside
  `[1e-6, 1]` seconds and substeps outside `[1, 32]`. These are bounded device-safety limits, not validated
  physical ranges. The shader checks the corresponding already-clamped float32 values and reserved fields.
- Dispatch uses groups of 32 and checks the caller-supplied device group limit. The caller is responsible for
  making command writes available before compute; ordering/reset-to-advance and particle visibility to later
  compute/vertex consumers; and ensuring no in-flight submission uses replaced resources.

## Reproducible evidence

Run `Exhibits/VehiclePhysics/RunTyreProjectionDevice.sh` and again with `SANITIZE=1`. The harness compiles
Slang directly to SPIR-V and passes those exact modules to `vkCreateShaderModule`; the Engine recorder binds
the two pipelines and descriptor set. Logs: `Results/TyreProjectionDevice-{release,sanitized}.txt`.
Both runs exited successfully on **SwiftShader CPU Vulkan** (device type 4), not a discrete or integrated
physical GPU. The native host is ASan/UBSan-instrumented in the second run; the driver and shader are not.

| Comparison / check | Result |
|---|---:|
| Distinct JS reference trajectories | 12 cases × 8 steps, repeated across 33 tyres (two workgroups) |
| Particle snapshots compared with JS and Engine CPU | 42,240 |
| Worst local position vs JS / CPU | `9.94503498e-5 m` / `9.94503498e-5 m` |
| Worst world position vs JS / CPU | `9.6809119e-5 m` / `9.68575478e-5 m` |
| Worst prescribed force vs JS / CPU | `0.001953125 N` / `0.000921011 N` |
| Position / force test limits | `3e-4 m` / `0.02 N` |
| Release/sanitized readback SHA-256 | both `5217678ba7fa33e0bc094a9f1e8e6469471176d574ff5fd345ca4c3ab8ee4318` |

Pinned beads remained exactly at rest; repeated commands in different invocation slots produced identical
bytes; the zero-load tyre stayed static, and the largest loaded displacement was `0.07385 m`. The harness
also exercised valid reset, invalid GPU commands, an undersized particle binding, CPU input guards, zero
count and dispatch-limit rejection. The pre-existing CPU test covered both demo XPBD and Hex8 (16/16
checks); only **XPBD** was advanced on Vulkan here. Error thresholds are finite acceptance tolerances, not
bitwise CPU/GPU parity, and the approximately `0.1 mm` maximum has not been attributed to a specific cause.

## Boundaries

No physical-GPU/Windows test, performance measurement, long-duration stability or measured tyre validation
is provided. The previously documented free-running hard-drop convergence failure remains unresolved.
Hex8, continuum shell, spring-contact dynamics, actual visual consumption of these GPU particles and editor
integration are still open. Results here compare a simulation to the demo/Engine implementation, not to
independent physical data.
