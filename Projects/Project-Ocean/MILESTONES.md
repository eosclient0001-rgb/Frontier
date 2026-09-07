# Project-Ocean v2 — Milestones (tracks Slate `arena/01a0718d-slate` @ `a00250e`)

Conventions (match Slate Project-Fluid): WebGPU-first prototype, query-string config,
proofs with exit codes, per-kernel CSV telemetry, deterministic runs. Import path to Slate:
see repo-root `TRACKING_SLATE.md`.

## O0 — Scaffold + deep-water look (THIS milestone)
- Static-served page, WebGPU init, orbit camera, resize, FPS/ms overlay, error overlay.
- Analytic Gerstner placeholder (6 waves from wind speed, Pierson–Moskowitz Hs) — **placeholder only**.
- Fragment stack v1: detail normals, Fresnel→sky, absorption/scatter body, sun glitter+sheen,
  crest-lightening placeholder, aerial haze, gamma. Sky gradient + sun pass.
- Query: `?wind=10&auto=1&grid=224`.
- **Accept:** page runs on GTX Chrome + SwiftShader; no console errors; water + horizon + sun read correctly.

## O1 — FFT core + real foam + proofs
- Tessendorf FFT in compute (Stockham, butterfly texture): 256² × 3 cascades (GTX), 512² × 4 (RTX).
- Jacobian crest foam: linear accumulate / exponential decay, velocity advection, lace shading.
- Staggered cascade updates (≤1/frame on GTX); far skirt to horizon; Gerstner fallback flag.
- Proofs: finite-values, spectrum-energy conservation, foam coverage vs Monahan, determinism hash.
- **Accept:** whitecaps where spectrum says so; `?perkernel=1` CSV; sim ≤ 1 ms on GTX class.

## O2 — Shoreline: SDF surf + SWE patch + swash
- Top-down heightfield capture (terrain + flagged obstacles); SDF-to-shoreline surf profiles.
- SWE patch (256²–512²) around focus: flow, foam injection (depth < 25 cm, onshore vel), wet band, waterline.
- Procedural beach scene for testing (berm, cusps, foredune) + caustics.
- **Accept:** ragged bright waterline, foam collars on stones, diverted flow; shore ≤ 1.5 ms.

## O3 — Interaction + spray + splashes
- Synchronous height/velocity query API (B3); buoyancy sampling demo (boat/crate/character capsule).
- Ripple-follower patch under player; velocity-stamp modifiers.
- Spray tier: crest/bore birth, drag flight, Exchange-buffer liter accounting, lit sprites.
- Splash events: burst + decal + stamp on water-plane crossings.
- **Accept:** spray-balance proof gap = 0.0 L; interaction exact, no frame lag; spray ≤ 1 ms GTX.

## O4 — Smoke/fire lane + RTX ultra
- Flipbook sprite renderer + authored library (EmberGen-compatible packing).
- One live 64³ gas sim + quarter-res Beer's-law marcher for hero smoke;ụta fire: blackbody + lights.
- RTX ultra: 4th cascade, 512² FFT, 128³ gas, hero splash mode, denser spray.
- **Accept:** combat scene smoke/fire ≤ 2.5 ms GTX 1080; all lanes preset-scalable (§REPORT 4.3).
