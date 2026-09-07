# Project-Ocean v2 — Charter: match or beat Unreal with a *different* approach

**Decision (2026-09-07, user):** we do not clone Unreal's Water plugin. We match-or-beat its
on-screen quality with an architecture Unreal does not have — physically grounded, gameplay
queryable, water-accountable, self-proving, and cheaper per pixel.

## 1. What Unreal does (and why we refuse to copy it)

UE's stock ocean is **parametric fakery done beautifully**: 2 layers of Gerstner sine-waves
(no spectrum, no physics), visual richness from an opaque artist-driven material graph, and
gameplay queries that lag 1–2 frames behind the picture (async readback) or sample an
analytic approximation that is not what the eye sees. It looks great and sims nothing.

Copying that would give us: unphysical water, gameplay-blind visuals, and a permanent
second-place behind Epic's art team. No.

## 2. Our five bets (the different approach)

**B1 — Real spectra, not sine soup.** Tessendorf FFT over Phillips/JONSWAP spectra is the sim
core. Every whitecap traces to spectrum energy via the Jacobian — foam is a *measurement*,
not a painting. (UE stock has no spectrum at all; only its premium add-ons do.)

**B2 — Water is accountable.** Conservation is engineered, not hoped for: spray tufts take
liters from their birth cell as integer quanta and return them where they land; the SWE shore
patch conserves mass; proofs assert it every run. No shipped engine does this. It kills entire
bug classes (mystery foam, leaking pools, splashes from nothing).

**B3 — Gameplay reads the same water the eye sees.** A synchronous, deterministic
height/velocity query API over the spectrum sum + local grids. No 1–2 frame async lag, no
"analytic approximation" that disagrees with the render. Characters, boats, stones interact
with *exact* water — this is the capability UE lacks and Fluid Flux documents as unreliable.

**B4 — Cost-first scaling.** Staggered FFT cascades (one/frame on GTX), quarter-res foam,
distance-thinned spray, Gerstner analytic fallback that reuses the same shading. GTX 1060 is
the floor; RTX money buys density, never different features. Target: ocean ≤ 4 ms on GTX 1080
at 1080p60 (see REPORT_FLUIDS_2023_2026.md §5.3).

**B5 — Self-proving.** Every milestone ships machine-checkable proofs (finite values, mass
conservation, foam coverage vs model, determinism hash) plus per-kernel CSV telemetry.
Performance is *measured on target hardware*, never assumed. Slate's Project-Fluid proved this
workflow; we match its conventions (proof exit codes, `?perkernel=1`, query-string config).

## 3. What "match UE looks" means (physics cues, not UE IP)

The checklist that makes any ocean read as real — absorption/scattering body color, Fresnel to
sky, sun glitter + sheen, crest foam with lace breakup, SDF shoreline + swash, spray sprites,
underwater fog + caustics. These are optics, not Epic's invention. We implement each with our
own code against our own sim data.

## 4. Non-goals

- No Niagara/material-graph clone, no editor tooling in v2 (query strings + minimal panel).
- No particle ocean surface, ever (particles are spray/ember accents only).
- No neural solvers in the shipping path (watch-list only until sub-millisecond proven).
