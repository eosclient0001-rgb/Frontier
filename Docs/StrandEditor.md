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

No local server? The same files are served from the public repository by [raw.githack.com](https://raw.githack.com/), pinned to commit `7c0fd1d`, which has the layout fix and the display panel:

- [Editor](https://raw.githack.com/eosclient0001-rgb/Frontier/7c0fd1da1c21d006b240c92057c5d888fca5700f/Experimental/StrandEditor/index.html)
- [Visual proof](https://raw.githack.com/eosclient0001-rgb/Frontier/7c0fd1da1c21d006b240c92057c5d888fca5700f/VisualProof/StrandEditor/index.html)
- [Display panel proof](https://raw.githack.com/eosclient0001-rgb/Frontier/7c0fd1da1c21d006b240c92057c5d888fca5700f/VisualProof/DisplayPanel/index.html)

raw.githack shows a notice before HTML pages; choose *Open the page*. If the controls stay empty, the editor's script did not start. Open the browser console (F12) to see the first error, or use the local server above. To see the start transition, choose *Start transition* in the Preset menu and press *Apply*.

GitHub's file viewer shows `.html` as source code, so use these links to open the pages. When the editor changes,
update the commit in the links.

WebGL2 is required. The editor reports a clear message if it is missing. WebGPU is not used yet; see
*Limits*.

## What it does

- **Strands.** Six shapes, all made of thin fibres that are generated on the GPU:
  - **Bezier** fibres sweep from a root bundle.
  - **Bloom** strands radiate from a centre with ruffled rims.
  - **Wave** sheets ripple across their width.
  - **Flower** heads are a root cluster whose petal fibres run to a lobed rim, bend into a cup and open and
    close with the pulse. *Flower heads* sets how many heads a layer carries, *Petals* the lobe count and
    *Cup depth* the bend.
  - **Trail** bundles are fibres that stream along the scene path. Each fibre covers *Trail length* of the
    loop behind its head, so one flower head leaves a comet tail. *Phase spread* controls whether heads
    share one point (a tail) or spread around the whole path (a stream).
  - **Guide** fibres lie along the whole scene path, offset sideways by *Spread*, so the path itself is the shape.
    Guides are static, so a *Sweep* pulse is what moves along them. Their ends meet at the seam, so they ignore
    *Taper*.

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
  - **Sweep** is one front that runs from the start of each fibre to its end over the first 45 % of the cycle. The
    lit part stays on behind it, holds to 75 %, then fades, so the next sweep starts from black and the loop closes.
    On a guide the front runs once round the path. Under a sweep, flower heads open in index order.

  Flower heads open with the same pulse, offset by head index, so a chain of blooms opens in sequence.
  *Light heads per loop* is the older light-window control: how many light heads travel each fibre per loop.
- **Path.** One closed scene path, shared by every layer. *Path shape* is Ring, Figure eight, Rose (five
  petals), Weave, Loop (a limaçon with an inner loop) or Stadium (a squircle, flat along X, for a light guide
  round a dashboard or door trim). *Path radius* sets its furthest point in metres.
  Every path is sampled at equal arc length, so light moves at one speed along it.
- **Scene.** Format (width and height), background, post (exposure, glow amount and spread, saturation,
  output brightness), loop length and playback speed, and an orbit camera (yaw, pitch, distance, field of
  view). Drag on the view to orbit, scroll to zoom, press **R** to reset.
- **Presets.** Ten starter scenes:
  - *Organic fibres* is a blue sweep of thin fibres with dust and a title.
  - *Emerald sweep* is green fibres with bokeh and the *TO BE* title.
  - *Radial bloom* is a radial burst with bokeh.
  - *Ember ribbons* is a portrait frame of warm fibres over lavender lines.
  - *Sheet lines* is a dense oblique sheet with glints.
  - *Flower bloom* is one breathing flower head with pollen.
  - *Flower path* is three flower heads riding a rose path, with fibre tails streaming along the whole path.
  - *Path weave* is light trails streaming along a weaving path, with ripple pulses.
  - *Automotive trim* is a wide 1920 × 720 light guide round a stadium loop: a comet sweeps round it once per loop,
    two flower heads ride it, and ripple pulses run along each fibre.
  - *Start transition* is a light guide round the stadium loop, dark at the start. A sweep runs once round it per loop,
    holds, and fades out. A dim resting glow stays under it, so the guide never reads as off between events.
- **Export.** PNG of the current frame, real-time WebM of one loop (MediaRecorder), and scene JSON save and
  open. The Add buttons create strands (Bezier, Bloom, Wave, Flower head, Path trail, Light guide), dust and title text.

## Display panel

Click **Panel view** in the top bar. The editor switches to a fixed 1280 × 800 tablet frame, 16:10. The light fills
the frame, and 2D controls sit on top: a title with the preset number and name, ten toggles numbered 1 to 10, and a
preset slider. Click a toggle, or drag the slider's knob, to switch presets. A press on a control never orbits the
camera; a press elsewhere still does.

The controls are drawn into the frame, so **Export PNG** and **Record loop WebM** include them. Turning Panel view off
restores the frame size from before you turned it on.

`npm run panel-proof` drives these controls with real clicks and drags in headless Chromium, then reads the exported
frames back. It writes `VisualProof/DisplayPanel/`, with a page that shows the frames.

## Look defaults

- **Black.** The default background is `#000000` with no vignette and no grain. Grain now multiplies the
  frame instead of adding to it, so true black stays exactly zero. With every layer hidden, the frame of
  every preset reads 0 of 255.
- **Thin.** *Thickness* is the fibre's full width at half brightness, in pixels at 1080 p, and it scales with the frame
  height. The default is 1.6 px, which reads 1.07 px at 720 p. The core is sized in pixels, so a fibre keeps its width
  at any distance. Nothing narrower than 0.8 px is drawn, so the thinnest setting is still one full pixel of coverage.
  *Halo* sets the soft glow around each core, and *Taper* fades a fibre toward its ends; it no longer thins it.
  Earlier builds set width in metres (3.5 to 6 mm). That is under one pixel at these distances, so fibres drew as
  beads and the glow turned them into bands.

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
- **Trim loop.** *Path shape: Stadium* is the light-guide loop. *Idle trim* keeps the loop lit at low brightness, a
  welcome comet sweeps round it once per loop, and ripple pulses run along each fibre. The reasoning and sources are
  in the reference notes. *Start transition* is the same kind of loop, built from a guide and a sweep.

## Scene format

A scene is JSON with `Format: "StrandEditor/3"`. Scene-level settings are nested (`Post.Glow`, `Camera.Yaw`,
`Path.Shape`); layers are a list of flat records keyed by `Mechanism` (`Strands`, `Particles`, `Text`).
`Source/SceneStructure.js` is the authority for names, ranges and defaults. Versions 1 and 2 load without
error. Their `Width`, `Sharpness` and `Core` settings no longer exist and are dropped, so fibre thickness falls back to
the default, and the new fields take their defaults. A version 1 file gains no pulses or flowers unless you add them. `NormalizeScene` is idempotent, and a check pins that a saved file reloads unchanged.

## How it renders

- Every shape is evaluated in the vertex shader from `gl_VertexID`, so nothing is uploaded per frame. A flower
  or trail reads the scene path from a 512 × 1 float texture, rebuilt only when the path shape or radius
  changes.
- Trails and flowers return local coordinates, and one world transform (rotation, scale, position) serves
  every shape.
- A sweep is evaluated per fragment from the fibre's arc position and the loop phase (`SweepLevel`). Its CPU
  mirror is `SweepLevelAt`, which the checks pin.
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
npm test                        # 107 Node checks: maths, schema, idempotence, presets, paths, pulses, sweep, thickness, panel layout
npm run proof                   # headless Chromium: renders every preset and writes VisualProof/StrandEditor
npm run panel-proof             # headless Chromium: drives the display panel and writes VisualProof/DisplayPanel
```

`npm run proof` uses `@sparticuz/chromium`, or the browser named by `CHROME_PATH`. For each preset it checks:
no editor errors; mean luma inside a sane band; **black**, meaning the frame with every layer hidden reads 0;
**exact periodicity**, meaning the frame at the loop length equals frame 0; a continuous wrap; no step above 30
levels in one sixtieth of a second; visible motion; **visible pulses** for every scene that has them, as a mean
luma swing of at least 0.002 over one loop; for scenes with a trail, that at least 90 % of the bright trail
pixels lie within 10 px of the scene path as the camera projects it; text drawn when present; output brightness
0.5 capping the frame; the vertex budget; and an empty browser console. The run in this workspace passed 118
checks. Trail results: 96.7 % of 66,082 bright pixels on *Flower path* and 93.4 % of 53,636 on *Path weave* lie
within 10 px of the path (mean 4.7 and 4.5 px), and 100.0 % of 56,247 on *Automotive trim* (mean 4.2 px), and 99.6 % of 57,248 on *Start transition* (mean 4.3 px).
With only its sweep layer drawn and the glow off, *Start transition* lights 0 % of the frame at the start of the loop,
1.2 %, 2.5 % and 3.8 % at 10, 20 and 30 % of the loop, 5.5 % from 45 % to 75 %, and 0 % by 99 %. A single
straight fibre measures 1.07 px wide at 1280 × 720, at 6 m and at 24 m, and 1.60 px at 1920 × 1080, read from the
frame's own pixels.

## Limits

- **Not Trapcode.** The editor takes two ideas from Trapcode Particular and Tao, a trail that follows a motion
  path and tapered, looping geometry along a path. It does not reproduce their particle systems, physics,
  turbulence, motion blur or lighting. Trails are bundles of fibres with a wobble, and sparks are the only
  particles along them.
- **One sweep direction.** A sweep runs from the start of each fibre to its end. Centre-out and bilateral sweeps are
  not built yet.
- **Camera-facing paths.** Scene paths lie in the XY plane. Rotate the layer to tilt them.
- **Dense sheets alias.** *Sheet lines* at small sizes shows moiré. Fewer strands or thicker fibres
  reduce it.
- **Bundles add up.** Where many fibres overlap, the glow turns them into a solid band. The trails use sparse
  bundles spread round the path for that reason; a dense bundle on one arc reads as a tube.
- **WebGL2 only.** WebGPU is the planned second backend. The headless Chromium used for verification does
  not expose `navigator.gpu`, so the WebGPU path cannot be exercised here.
- **Verified on software GL.** Proof frames come from SwiftShader, not a GPU or automotive hardware. Frame
  timing on target hardware needs its own measurement.
- **Approximate looks.** The presets are starting points tuned by eye against the reference frames. They are
  not pixel matches. The reference images were supplied in chat and are not stored in the repository.
- **No keyframes or undo yet.** Animation is one loop driven by the schema; a keyframe track and an undo
  stack are the next features.
- **System fonts.** Title text uses the operating system's sans-serif families (Helvetica, Avenir, Arial).
- **Panel view is not saved.** It is a view mode: it is not written into the scene JSON, and the frame is fixed at
  1280 × 800 while it is on. The toggles switch presets, not single layers.
- **Presets keep their own framing.** At 16:10 the start transition's ring runs along the top and bottom edges, under
  the title and the toggle row. Its sweep starts after the loop begins, so its first frames are dark.
