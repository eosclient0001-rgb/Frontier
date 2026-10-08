# Strand Editor

A browser editor for light-fibre, flower and path motion graphics for automotive ambient UI: boot and
wait screens, cluster and centre-display backgrounds and transitions. It is a WebGL2 tool under
`Experimental/StrandEditor/`. There is no build step: the editor is plain ES modules.

| Entry point | Purpose |
| --- | --- |
| [index.html](../Experimental/StrandEditor/index.html) | The editor: layers, inspector, transport, export |
| [play.html](../Experimental/StrandEditor/play.html) | Full-window loop player for embedding a saved scene, for example `play.html?preset=6` |
| [VisualProof/StrandEditor](../VisualProof/StrandEditor/index.html) | Frames rendered by the browser proof, with checks and measurements |

Design notes and the sources behind the path, trail and pulse behaviour are in
[StrandEditorReferenceNotes2026-10-08.md](StrandEditorReferenceNotes2026-10-08.md).

## Run it

Serve the folder (browsers do not load ES modules from `file://`), then open the page:

```sh
cd Experimental/StrandEditor
python3 -m http.server 8080      # or: npm run serve
# open http://localhost:8080/index.html   and   http://localhost:8080/play.html?preset=6
```

WebGL2 is required. The editor reports a clear message if it is missing. WebGPU is not used yet; see
*Limits*.

## What it does

- **Strands.** Five shapes, all made of thin fibres that are generated on the GPU:
  - **Bezier** fibres sweep from a root bundle.
  - **Bloom** strands radiate from a centre with ruffled rims.
  - **Wave** sheets ripple across their width.
  - **Flower** heads are a root cluster whose petal fibres run to a lobed rim, bend into a cup and open and
    close with the pulse. *Flower heads* sets how many heads a layer carries, *Petals* the lobe count and
    *Cup depth* the bend.
  - **Trail** bundles are fibres that stream along the scene path. Each fibre covers *Trail length* of the
    loop behind its head, so one flower head leaves a comet tail. *Phase spread* controls whether heads
    share one point (a tail) or spread around the whole path (a stream).

  Every strands layer can throw head sparks along its fibres.
- **Ride the scene path.** A layer switch that moves its flower or bezier, bloom and wave geometry along the
  scene path. Trails always ride the path, so the switch has no effect on them.
- **Particles.** Drifting dust with a bokeh share and a focus distance.
- **Text.** A title and subtitle with tracking, glow and alignment.
- **Pulses.** Each strands layer has *Brightness pulses per loop* (0 to 8), *Brightness pulse depth* (0 to 1)
  and *Brightness pulse shape*:
  - **Breathe** is one eased inhale and exhale per pulse, the whole layer together.
  - **Heartbeat** is two short beats, then rest.
  - **Ripple** is a sine that runs outward along each fibre, from root to tip.

  Flower heads open with the same pulse, offset by head index, so a chain of blooms opens in sequence.
  *Light heads per loop* is the older light-window control: how many light heads travel each fibre per loop.
- **Path.** One closed scene path, shared by every layer. *Path shape* is Ring, Figure eight, Rose (five
  petals), Weave or Loop (a limaçon with an inner loop). *Path radius* sets its furthest point in metres.
  Every path is sampled at equal arc length, so light moves at one speed along it.
- **Scene.** Format (width and height), background, post (exposure, glow amount and spread, saturation,
  output brightness), loop length and playback speed, and an orbit camera (yaw, pitch, distance, field of
  view). Drag on the view to orbit, scroll to zoom, press **R** to reset.
- **Presets.** Eight starter scenes:
  - *Organic fibres* is a blue sweep of thin fibres with dust and a title.
  - *Emerald sweep* is green fibres with bokeh and the *TO BE* title.
  - *Radial bloom* is a radial burst with bokeh.
  - *Ember ribbons* is a portrait frame of orange ribbons over lavender lines.
  - *Sheet lines* is a dense oblique sheet with glints.
  - *Flower bloom* is one breathing flower head with pollen.
  - *Flower path* is three flower heads riding a rose path, each with a comet tail.
  - *Path weave* is light trails streaming along a weaving path, with ripple pulses.
- **Export.** PNG of the current frame, real-time WebM of one loop (MediaRecorder), and scene JSON save and
  open. The Add buttons create strands (Bezier, Bloom, Wave, Flower head, Path trail), dust and title text.

## Look defaults

- **Black.** The default background is `#000000` with no vignette and no grain. Grain now multiplies the
  frame instead of adding to it, so true black stays exactly zero. With every layer hidden, the frame of
  every preset reads 0 of 255.
- **Thin.** Fibre width defaults to 6 mm (`0.006` m). The presets use 3 to 6 mm, except the portrait ribbons at
  22 mm. At the default camera 6 mm is about one pixel at 720p. *Fibre sharpness* keeps the core tight, and *Halo* supplies the glow.

## Automotive settings

- **Loop.** Every time term is a whole number of cycles per loop, so the animation closes exactly at the loop
  length. This is measured, not assumed: see *Verification*.
- **Output brightness.** Applied last, to the whole frame including text, so a night mode can cap output at
  any level from 5 % to 100 %.
- **Playback speed.** 0.05× to 2×, saved with the scene. Use it as the reduced-motion setting.
- **No strobing.** Light moves along fibres as continuous pulses, and the pulse curves are periodic.
  Nothing flashes.
- **Budget.** The estimate in the inspector counts strand vertices (strands × segments × 6) and dust. Scenes
  above 2.4 M vertices are flagged. Shrink *Strands* or *Segments* to fit a target GPU.

## Scene format

A scene is JSON with `Format: "StrandEditor/2"`. Scene-level settings are nested (`Post.Glow`, `Camera.Yaw`,
`Path.Shape`); layers are a list of flat records keyed by `Mechanism` (`Strands`, `Particles`, `Text`).
`Source/SceneStructure.js` is the authority for names, ranges and defaults. A version 1 file loads without
error. Its `Core` value carries over to `Sharpness`, its fibre widths are kept, and the new fields take their
defaults, so it gains no pulses or flowers unless you add them. `NormalizeScene` is idempotent, and a check pins that a saved file reloads unchanged.

## How it renders

- Every shape is evaluated in the vertex shader from `gl_VertexID`, so nothing is uploaded per frame. A flower
  or trail reads the scene path from a 512 × 1 float texture, rebuilt only when the path shape or radius
  changes.
- Trails and flowers return local coordinates, and one world transform (rotation, scale, position) serves
  every shape.
- Pulse curves run in the fibre fragment shader and in the spark vertex shader. `Source/PulseSpecification.js`
  holds the CPU mirror that the checks compare against.
- Strands, sparks and dust are additive into a half-float HDR target (multisampled where supported). A
  threshold, downsample and separable blur chain builds four glow levels.
- The composite applies exposure, saturation, a filmic fit, a gamma encode, vignette, grain and output
  brightness. Text is rasterised on a 2D canvas and composited last, premultiplied.

## Verification

```sh
cd Experimental/StrandEditor
npm install                     # test dependencies only; the editor itself needs none
npm test                        # 79 Node checks: maths, schema, idempotence, presets, paths, pulses
npm run proof                   # headless Chromium: renders every preset and writes VisualProof/StrandEditor
```

`npm run proof` uses `@sparticuz/chromium`, or the browser named by `CHROME_PATH`. For each preset it checks:
no editor errors; mean luma inside a sane band; **black**, meaning the frame with every layer hidden reads 0;
**exact periodicity**, meaning the frame at the loop length equals frame 0; a continuous wrap; no step above 30
levels in one sixtieth of a second; visible motion; **visible pulses** for every scene that has them, as a mean
luma swing of at least 0.002 over one loop; for scenes with a trail, that at least 90 % of the bright trail
pixels lie within 10 px of the scene path as the camera projects it; text drawn when present; output brightness
0.5 capping the frame; the vertex budget; and an empty browser console. The run in this workspace passed 87
checks. The trail results were 100.0 % of 15,133 pixels on *Flower path* and 100.0 % of 16,893 on *Path weave*,
with a mean distance of 2.4 px to the path.

## Limits

- **Not Trapcode.** The editor takes two ideas from Trapcode Particular and Tao, a trail that follows a motion
  path and tapered, looping geometry along a path. It does not reproduce their particle systems, physics,
  turbulence, motion blur or lighting. Trails are bundles of fibres with a wobble, and sparks are the only
  particles along them.
- **Camera-facing paths.** Scene paths lie in the XY plane. Rotate the layer to tilt them.
- **Dense sheets alias.** *Sheet lines* at small sizes shows moiré. Fewer strands or thicker fibres
  reduce it.
- **WebGL2 only.** WebGPU is the planned second backend. The headless Chromium used for verification does
  not expose `navigator.gpu`, so the WebGPU path cannot be exercised here.
- **Verified on software GL.** Proof frames come from SwiftShader, not a GPU or automotive hardware. Frame
  timing on target hardware needs its own measurement.
- **Approximate looks.** The presets are starting points tuned by eye against the reference frames. They are
  not pixel matches. The reference images were supplied in chat and are not stored in the repository.
- **No keyframes or undo yet.** Animation is one loop driven by the schema; a keyframe track and an undo
  stack are the next features.
- **System fonts.** Title text uses the operating system's sans-serif families (Helvetica, Avenir, Arial).
