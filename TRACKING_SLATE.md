# Slate tracking pin — Frontier follows the Slate engine branch

This file records which Slate commit Frontier's work is based on.
Re-verify at the start of every milestone (procedure below).

## Current pin (verified 2026-09-07)

- Repo: `unassignedinbox/Slate` (no fork relationship with Frontier — merges are file-level, see below)
- Branch: `arena/01a0718d-slate`
- Commit: `a00250ebbe4978c68fe189bd5b7082e73f1952d4` ("An outdoor scene, so seven phases of sky work…")
- State at pin: `Projects/` = Dyno, Fluid, Physics, Zero. **No `Project-Ocean`.**
  Prior ocean session branch `arena/01a071a3-slate` no longer exists and its commits
  (`7730796`, `1526552`, `d6cdccc`, `3978b7f`) are not fetchable — that code is unrecoverable
  from the remote. Ocean restarts fresh, informed by surviving docs.
- Surviving Slate research this work builds on:
  - `References/FluidPhaseF0-SurveyAndPlan.md` (tiered water: T0 = FFT + SWE + wave particles, ≤2 ms GTX)
  - `References/FluidPhaseF1-RecentSurveyAndWebGpuPlan.md` (FFT+SWE stack reconfirmed; no 2023–26 paper displaces it)
  - `References/FluidPhaseF1-UnrealComparison.md` (honest Project-Fluid vs Niagara field-by-field)
  - `Projects/Project-Fluid` (WebGPU PB-MPM prototype + proof/telemetry conventions to match)

## Re-sync procedure (run before each milestone)

```bash
git ls-remote https://github.com/unassignedinbox/Slate.git 'refs/heads/arena/01a0718d-slate'
rm -rf /tmp/slate-ref && git clone --depth 1 --branch 'arena/01a0718d-slate' \
  https://github.com/unassignedinbox/Slate.git /tmp/slate-ref
# update the pin + state notes above, commit on arena/01a07bbc-frontier
```

## Importing Frontier files into Slate (run by user or Slate session — this session can only push to Frontier)

```bash
cd Slate && git checkout arena/01a0718d-slate
git remote add frontier https://github.com/eosclient0001-rgb/Frontier.git  # once
git fetch frontier
git show frontier/arena/01a07bbc-frontier:REPORT_FLUIDS_2023_2026.md > References/FluidFrontier-Report2023-2026.md
git add References/FluidFrontier-Report2023-2026.md
git commit -m "Import fluids research report (Frontier@<sha>)"
git push origin arena/01a0718d-slate
```

(File-level import is deliberate: the repos share no history, so a true merge would drag an
unrelated root commit in. A `git merge --allow-unrelated-histories` remains possible if ever wanted.)
