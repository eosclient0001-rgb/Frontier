# Rigid GI rare-sample replay audit

The [2,048-seed study](ReplayRigidVarianceRepeat.md) showed that rare rigid-red values strongly affect
the measured noise ratio. This diagnostic inspects the three largest **uniform spatial** samples and
a median-ranked control, selected after observing that table. For each frame it also evaluates the
paired mixture sample. This is a targeted mechanism check, not a new random experiment.

An exhibit-only, default-off dispatch reads the five already-generated donor seeds and re-evaluates
the unchanged Engine replay path at the selected receiver. A separate host implementation reconstructs
the reservoir's draws, weights and output from those recorded values. The audit is enabled only for
this bounded fixture; ordinary submission remains unchanged. It reuses the shader's own path evaluator,
so it is **not an independent validation of the path radiance itself**.

## Result

| Uniform-spatial rank | Frame seed | Selected donor | Replayed path red at receiver | Reservoir scale | Final red |
|---:|---:|---:|---:|---:|---:|
| 1 | `3636229639` | 4 | `0.253270` | `0.366236` | `0.092756` |
| 2 | `3505352021` | 4 | `0.301015` | `0.227295` | `0.068419` |
| 3 | `1703867237` | 4 | `0.196118` | `0.240472` | `0.047161` |
| 1025 (median control) | `2841748405` | 2 | `0.002154` | `1.123207` | `0.002419` |

For these three large observations, the selected **replayed path values are already high** and the
final reservoir scale is less than one; a large final normalization factor is not the explanation for
these particular spikes. Each fresh donor's stored source weight is one. The paired mixture paths use
the same frame and donor seeds but follow different proposal draws; their final red values for ranks
1–3 are `0.003306 / 0.000555 / 0.001887`. Selection was performed after seeing the data, so this is not
evidence of a universal mixture advantage. It does not yet identify the bounce, PDF, source geometry,
or PRNG behavior responsible for the high path values.

The complete and instrumented submissions produced bit-identical selected RGBA for all eight cases
(32 components), and reproduced the stored CSV values. The host reconstruction matched all selected
RGB outputs with maximum absolute error `0` at the logged precision. Release and ASan/UBSan-host runs
both exited zero and their diagnostic lines match; the driver and shader are not sanitizer-instrumented.
The pre-existing 16-seed smoke fixture also passed after the default-off hook was added, with its sample
CSV byte-identical to the previous capture. A separate moving/blocked/reopened smoke test also passed
in both builds with byte-identical previous samples. These are finite fixture checks, not full-image proofs.

[Release audit](Results/ReplayRigidTailAudit-release.txt) ·
[sanitized audit](Results/ReplayRigidTailAudit-sanitized.txt) ·
[default-path regression](Results/ReplayRigidTailDefault-regression.txt) ·
[sanitized default-path regression](Results/ReplayRigidTailDefault-sanitized.txt) ·
[motion/occlusion regression](Results/ReplayRigidTailMotionDefault-release.txt) ·
[sanitized motion/occlusion regression](Results/ReplayRigidTailMotionDefault-sanitized.txt).

## Reproduce

```sh
# Reads the tracked 2,048-row sample table; selects the top three and median uniform-spatial red cases
Exhibits/LightCompute/RunReplayRigidTailAudit.sh
SANITIZE=1 BUILD_JOBS=1 Exhibits/LightCompute/RunReplayRigidTailAudit.sh
```

The next useful diagnostic is to split the high paths by bounce and contribution, followed by independent
CPU/path checks and disjoint repetitions. No physical-GPU performance, general unbiasedness or complete
ReSTIR GI claim follows from this audit.
