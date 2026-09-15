# Ocean — surf that has to earn its water

State: **research phase — no implementation**. `Ocean.html` v1 (Gerstner +
shader foam) and v2 (spectrum sea + particle foam) were deleted after
review: the waves never looked realistic and v1 violated the standing
rule below.

Standing rules for whatever gets built next:

- **Foam is particles only.** No foam term of any kind in the water
  shader (no run-up band, no crest caps, no noise breakup on the
  surface). Emission fields may drive particles; particles are the
  only visible foam.
- **References before code.** A reference board (real surf photos)
  gates all look decisions. Default frame must read as ocean with
  particles off before any effect lands.
- **One surface both sides read.** CPU spawn logic and GPU rendering
  share the same height field — never two mirrors that drift.

See `RESEARCH.md` for the full post-mortem, the literature survey
(Tessendorf FFT ocean, Jacobian foam emission, precedents), and the
committed v3 plan. `lib/` keeps the vendored three.js for the rebuild.
