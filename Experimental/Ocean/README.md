# Ocean — swell, surf, and shore foam

`Ocean.html` is a self-contained open-ocean demo (three.js vendored in
`lib/`, fully offline, no build step — serve the folder over HTTP and
open it in any WebGL2 browser):

- **Swell**: 10 summed Gerstner waves with deep-water dispersion
  (c = sqrt(g/k)), analytic normals, steepness-driven sharp crests.
- **Shoaling**: waves jack up, shorten, and steepen as the beach profile
  shallows — the faces surfers ride, then breakers at the bar.
- **Water shading**: depth-graded absorption (turquoise shallows to deep
  blue), Schlick fresnel into an analytic sky, sun glitter, and back-lit
  subsurface glow through crests.
- **Foam, two systems**: shader foam (shore run-up band + crest caps,
  broken up by flow-aligned noise and voronoi bubbles) and a 12k-particle
  surf system that spawns at the breaker lip, advects with the orbital
  velocity, and swashes up and down the beach.
- **Seabed**: sand profile with wet/dry bands and caustic shimmer showing
  through the transparent shallows.

Controls are in the glass panel (swell, breaker, foam, chop, sun, orbit).
`?static=1` freezes time for screenshots; `?t=<seconds>` seeks.
Debug params: `?segs=<160|320>` mesh density,
`?only=<nofoam|nospec|body|white>` shader bisection,
`?hide=<sky|sand|water|foam>` layer isolation (combinable).

## Research notes

- GPU Gems ch. 1 (Gerstner waves + analytic normals) via the gameidea.org
  walkthrough and Johan Svensson's ocean shader breakdown.
- WaterThreeJS (achrefelouafi): fully procedural three.js ocean — Gerstner
  surface, depth-driven shore band, foam as an assembled energy field
  (Jacobian folds + crest height + shore depth). No FFT required.
- OMYOG coastal renderer (80.lv): particle-simulated foam rendered as a
  density — collects, stretches, breaks up, forms the lip at the breaker's
  end. Our Points system is the lightweight cousin.
- UE5 water / Niagara practice: shader foam for the broad mask, particles
  for splash/spray micro-detail the shader alone cannot do.
- Parberry (GAMEON): halftone dither arrays for foam bubble pop — future
  upgrade if the voronoi breakup reads too smooth.
