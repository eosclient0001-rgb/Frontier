# Subpixel seed retracing combined with reservoir reuse

This extends the default-off [subpixel seed-bank mode](ReplaySampleHistory.md). Previously that mode was
mutually exclusive with temporal and spatial reservoir reuse; it now combines with them. This is still
software ray tracing on bounded fixtures, not hardware RT, non-ray-traced GI, completed ReSTIR GI, an
editor viewport or general animated reconstruction.

## Contract

| Requirement | Scope |
|---|---|
| Retained candidates | Up to three gathered, previously unselected fresh seeds are retraced at the current surface inside `GenerateReplayReservoirs`, after the temporal candidate. Each enters the reservoir with its current-surface target and count one, exactly like an extra fresh candidate. |
| Duplicate guard | A retained seed equal to the seed already entered as the temporal candidate is skipped, so one path is never counted twice in one reservoir. |
| Output | `ResolveReplayReservoirs` keeps its reservoir estimator (`Chosen * Sum / (Count * ChosenTarget)`); the sample-history finalize stage no longer overwrites the output in combined mode. |
| Seed bank | Finalize only shifts the bank and stores this frame's fresh draw, recomputed from the generator start state — never the reservoir-selected seed. |
| Ordering | The recorder now dispatches primary, gather, generate, resolve, finalize in sample-history mode, because generation consumes the gathered bank. Legacy no-reuse mode keeps its arithmetic-mean output and prior numeric behaviour. |
| Exclusions | Still primary, untextured diffuse, one initial fresh candidate; no colour reconstruction, rough or textured mode, or audit double-count. |

## Verification

| Check | Result |
|---|---|
| Host recorder/domain CTests, release | ✔️ 5/5 (`PathReplayVulkanValidation` now accepts temporal, spatial and both combined, and checks the new dispatch order) |
| Host recorder/domain CTests, ASan/UBSan | ✔️ 5/5 |
| Slang compile to SPIR-V (Generate, Resolve, Gather, Finalize, Primary) | ✔️ Compiled with the Slang 2026.12 compiler library in the sandbox; the retained run script uses Slang 2026.14.1 |
| SwiftShader GPU validation (`ValidateReplaySampleCombined`) | 🔴 Not run — blocked: no SwiftShader/Vulkan CPU driver is available in this sandbox and its prebuilt download host is unreachable. The check is wired into `ValidateReplaySampleHistory` and runs under the command below where the tools exist. |
| Physical GPU / Windows / editor | 🔴 Not run |

The GPU check warms both modes through three stationary frames, then compares a half-pixel transition:
pixels retaining no seed must match reservoir-only output bit-for-bit, accepted pixels must shift the
bank around the fresh seed, the accepted count must match counter 23, and more than 50 accepted pixels
must differ from reservoir-only output.

## Reproduce

```sh
bash Exhibits/LightCompute/RunReplaySampleHistory.sh
SANITIZE=1 bash Exhibits/LightCompute/RunReplaySampleHistory.sh
```

Host-only evidence from this sandbox is retained in
[the combined host results](Results/ReplaySampleCombined-host.txt). Correlations between retained seeds
across frames and pixels remain unresolved; no unbiasedness, equal-time speedup or real-time claim is made.
