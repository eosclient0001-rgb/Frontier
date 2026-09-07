# Project-Ocean v2 — Milestones (tracks Slate `arena/01a0718d-slate` @ `a00250e`)

Conventions (match Slate Project-Fluid): WebGPU-first prototype, query-string config,
proofs with exit codes, per-kernel CSV telemetry, deterministic runs. Import path to Slate:
see repo-root `TRACKING_SLATE.md`. Redo rationale: `REDO.md`.

## O0 — Scaffold + deep-water look (DONE)
- Static-served page, WebGPU init, orbit camera, WASD glide, resize, FPS/ms overlay,
  first-error-kept error overlay, look panel (sea/sun/color/look, all query-mirrored).
- Verdict (see REDO.md): parametric Gerstner + gradient-sky reflection + crest foam cannot
  reach the bar. Kept as the scaffold; the optics were redone in R1–R3.

## R1 — True mirror + researched body (THIS increment)
- Water evaluates the full analytic sky along the reflection vector (exact mirror while the
  sky is analytic; planar-reflection texture arrives with terrain in O2).
- SoT-style body: deep ↔ subsurface by peak mask + sun-facing; residual analytic spec
  attenuated since the mirror carries the sun.
- **Accept:** visible sun glitter path + sun mirror; horizon continuity; no new passes.

## R2 — FFT core (Gerstner deleted)
- Tessendorf FFT in compute (Stockham, butterfly texture): 256² × 3 cascades (GTX), 512² × 4 (RTX).
- Phillips/JONSWAP spectrum, choppiness offsets, staggered cascade updates (≤1/frame GTX),
  far skirt, deterministic (CPU-reconstructible for gameplay queries, SoT-style).
- Proofs: finite-values, spectrum-energy conservation, determinism hash.
- **Accept:** spectrum sea with no visible loop; `?perkernel=1` CSV; sim ≤ 1 ms on GTX class.

## R3 — Jacobian foam + feedback buffer
- Crest foam from the displacement Jacobian; feedback-blurred dispersion buffer;
  lace shading; foam energy budgeted against the spectrum.
- **Accept:** whitecaps where the spectrum says so; coverage proof vs Monahan.

## O2 — Shoreline: SDF surf + SWE patch + swash
- Top-down heightfield capture (terrain + flagged obstacles); SDF-to-shoreline surf profiles.
- SWE patch (256²–512²) around focus: flow, foam injection (depth < 25 cm, onshore vel), wet band, waterline.
- Procedural beach scene for testing (berm, cusps, foredune) + caustics.
- Planar-reflection texture for terrain mirrors (oblique projection or fragment discard clip).
- **Accept:** ragged bright waterline, foam collars on stones, diverted flow; shore ≤ 1.5 ms.

## O3 — Interaction + spray + splashes
- Synchronous height/velocity query API (B3); buoyancy sampling demo (boat/crate/character capsule).
- Ripple-follower patch under player; velocity-stamp modifiers.
- Spray tier: crest/bore birth, drag flight, Exchange-buffer liter accounting, lit sprites.
- Splash events: burst + decal + stamp on water-plane crossings.
- **Accept:** spray-balance proof gap = 0.0 L; interaction exact, no frame lag; spray ≤ 1 ms GTX.

## O4 — Smoke/fire lane + RTX ultra
- Flipbook sprite renderer + authored library (EmberGen-compatible packing).
- One live 64³ gas sim + quarter-res Beer's-law marcher for hero smoke; fire: blackbody + lights.
- RTX ultra: 4th cascade, 512² FFT, 128³ gas, hero splash mode, denser spray.
- **Accept:** combat scene smoke/fire ≤ 2.5 ms GTX 1080; all lanes preset-scalable (§REPORT 4.3).
