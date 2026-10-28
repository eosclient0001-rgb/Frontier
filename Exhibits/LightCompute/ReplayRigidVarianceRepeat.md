# Rigid-channel disjoint-seed investigation

The [256-batch motion repeat](ReplayFacetMixtureMotionRepeat.md) found a fresh uniform rigid-red
estimate `3.84` nominal combined standard errors below its separately seeded CPU reference, despite
passing the existing broad tolerance. This focused follow-up separates two possible effects: the
emitter proposal and spatial reservoir reuse. It changes no Engine code.

## Experiment and status

At the same moved textured receiver `(28, 38)` and `64 × 64` primary resolution, four fresh estimators
share each frame seed: uniform and uniform/power mixture proposals, each with spatial reuse off and
on. All use the same rough GGX paths, balanced MIS, four-hit budget and scene. The spatial variants
use the centre plus four orthogonal candidates; the single-receiver variants do not use spatial donors.
The CPU reference is a separately implemented four-hit tracer with four separately seeded groups.

The full run is configured for **2,048 distinct frame seeds** in eight groups and **2,000,000 CPU
paths**. It excludes the original 96 motion seeds and the previous 256 frame seeds, including their
submission offsets. Seed labels being distinct does not prove statistically independent streams.
Per-group red means and sample SEs, RGB aggregate estimates, paired differences and every RGB sample
are recorded. The chosen smoke sequence is the first 16 of the preconfigured full sequence.

**Current status: smoke only.** Both release and ASan/UBSan-host smoke runs exited zero and emitted
byte-identical 16-row sample tables; these 16 samples are not a convergence result. The full runs and
interpretation remain pending. Driver/compiler and shader execution are not sanitizer-instrumented.

For speed, the normal full primary-ray shader runs first, then an exhibit-only dispatch marks all but
the five spatial candidates as misses. The `64 × 64` projection and selected pixel are unchanged. For
eight seeds and all four modes, the complete and restricted submissions produce bit-identical selected
RGBA outputs (**128 components**) and bit-identical five-receiver guides (**5,760 components**). The
restricted spatial run confirms eight directed links among the retained receivers. This is a finite
parity check, not a universal proof or a production submission path.

[Release smoke](Results/ReplayRigidVarianceRepeatSmoke-release.txt) ·
[sanitized smoke](Results/ReplayRigidVarianceRepeatSmoke-sanitized.txt) ·
[paired smoke samples](Results/ReplayRigidVarianceRepeatSmokeSamples.csv).

## Failed primary-wrapper attempt

An earlier audit-only [wrapper](Code/ReplayRigidProbePrimary.slang) tried to invoke the shared primary
entry only for the five receivers. Its Slang compilation succeeded, but SwiftShader crashed during
`vkCreateComputePipelines` in its SPIR-V optimization path; the release process exited `139` and the
sanitized process exited `1` with an external-driver stack trace. It was not used to generate any
reported samples. The precise responsibility between the generated SPIR-V and the optimizer has not
been established. The final fixture instead uses the full primary pass and a separately tested receiver
mask. [Release failure](Results/ReplayRigidProbePrimaryAttempt-release-failed.txt) ·
[sanitized failure](Results/ReplayRigidProbePrimaryAttempt-sanitized-failed.txt).

## Reproduce

```sh
# Structural smoke: 16 paired seeds and four 10,000-path CPU groups
CHECK=--replay-rigid-variance-repeat-smoke Exhibits/LightCompute/RunReplayRigidVarianceRepeat.sh
CHECK=--replay-rigid-variance-repeat-smoke SANITIZE=1 BUILD_JOBS=1 Exhibits/LightCompute/RunReplayRigidVarianceRepeat.sh

# Full: 2,048 paired seeds and four 500,000-path CPU groups
Exhibits/LightCompute/RunReplayRigidVarianceRepeat.sh
SANITIZE=1 BUILD_JOBS=1 Exhibits/LightCompute/RunReplayRigidVarianceRepeat.sh
```

The runner reads the prior 256-row sample table to exclude its seed offsets. See
[the previous report](ReplayFacetMixtureMotionRepeat.md) for setup and wider motion/occlusion results.
This focused check cannot establish general unbiasedness, physical-GPU performance, production
integration, or complete ReSTIR GI.
