# Strand Editor

A browser editor for light-fibre, ribbon and dust motion graphics, for automotive ambient UI: boot and
wait screens, cluster and centre-display backgrounds and transitions. It is a WebGL2 tool under
`Experimental/StrandEditor/`. There is no build step: the editor is plain ES modules.

| Entry point | Purpose |
| --- | --- |
| [index.html](../Experimental/StrandEditor/index.html) | The editor: layers, inspector, transport, export |
| [play.html](../Experimental/StrandEditor/play.html) | Full-window loop player for embedding a saved scene |
| [VisualProof/StrandEditor](../VisualProof/StrandEditor/index.html) | Frames rendered by the browser proof, with checks |

## Run it

Serve the folder (browsers do not load ES modules from `file://`), then open the page:

```sh
cd Experimental/StrandEditor
python3 -m http.server 8080      # or: npm run serve
# open http://localhost:8080/index.html   and   http://localhost:8080/play.html?preset=0
```

WebGL2 is required. The editor reports a clear message if it is missing. WebGPU is not used yet; see
*Limits*.

## What it does

- **Layers.** Three mechanisms. *Strands* has three shapes: **Bezier** fibres that sweep from a root bundle,
  **Bloom** strands that radiate from a centre with ruffled rims, and a **Wave** sheet that ripples
  across its width. Each strands layer can also throw head sparks along its fibres. *Particles* is
  drifting dust with a bokeh share and a focus distance. *Text* is a title and subtitle with tracking,
  glow and alignment. Layers can be shown or hidden, reordered, duplicated and deleted.
- **Inspector.** Generated from the schema in `Source/SceneModel.js`. Every control is clamped to its
  declared range on the way in, so a hand-edited file cannot reach the GPU out of range.
- **Scene.** Format (width and height), background gradient and vignette, grain, post (exposure, glow amount and
  spread, saturation, output brightness), loop length and playback speed, and an orbit camera (yaw, pitch,
  distance, field of view). Drag on the view to orbit, scroll to zoom, press **R** to reset.
- **Presets.** Five starter scenes, each approximating one of the reference looks: *Organic fibres* (blue
  sweep with dust and a title), *Emerald sweep* (green fibres with bokeh), *Radial bloom* (a radial burst with
  bokeh), *Ember ribbons* (a portrait frame of orange ribbons over a lavender sheet) and *Sheet lines* (a dense
  oblique sheet with glints).
- **Export.** PNG of the current frame, real-time WebM of one loop (MediaRecorder), and scene JSON save and open.

## Automotive settings

- **Loop.** Every time term is a whole number of cycles per loop, so the animation closes exactly at the loop
  length. This is measured, not assumed: see *Verification*.
- **Output brightness.** Applied last, to the whole frame including text, so a night mode can cap output at
  any level from 5 % to 100 %.
- **Playback speed.** 0.05× to 2×, saved with the scene. Use it as the reduced-motion setting.
- **No strobing.** Light moves along fibres as continuous pulses. Nothing flashes.
- **Budget.** The estimate in the inspector counts strand vertices (strands × segments × 6) and dust. Scenes
  above 2.4 M vertices are flagged. Shrink *Strands* or *Segments* to fit a target GPU.

## Scene format

A scene is JSON with `Format: "StrandEditor/1"`. Scene-level settings are nested (`Post.Glow`,
`Camera.Yaw`); layers are a list of flat records keyed by `Mechanism` (`Strands`, `Particles`, `Text`).
`Source/SceneModel.js` is the authority for names, ranges and defaults. `NormalizeScene` is idempotent, and a
test pins that a saved file reloads unchanged.

## How it renders

- Strands are generated entirely in the vertex shader from `gl_VertexID`. Nothing is uploaded per frame, so
  changing a count, a shape or a colour costs a few uniforms.
- Strands, sparks and dust are additive into a half-float HDR target (multisampled where supported). A
  threshold, downsample and separable blur chain builds four glow levels.
- The composite applies exposure, saturation, an ACES fit, a gamma encode, vignette, grain and output
  brightness. Text is rasterised on a 2D canvas and composited last, premultiplied.

## Verification

```sh
cd Experimental/StrandEditor
npm install                     # test dependencies only; the editor itself needs none
npm test                        # 27 Node tests: maths, schema clamping, idempotence, presets, budget
npm run proof                   # headless Chromium: renders every preset and writes VisualProof/StrandEditor
```

`npm run proof` uses `@sparticuz/chromium`, or the browser named by `CHROME_PATH`. For each preset it checks:
no editor errors; mean luma inside a sane band; **exact periodicity** (the frame at the loop length equals
frame 0, difference 0); a continuous wrap (the step across the loop is no larger than an ordinary step); no
step above 30 levels in one sixtieth of a second; visible motion; text drawn when present; output brightness
0.5 capping the frame; the vertex budget; and an empty browser console. The run in this workspace passed 45
checks.

## Limits

- **WebGL2 only.** WebGPU is the planned second backend. The headless Chromium used for verification does
  not expose `navigator.gpu`, so the WebGPU path cannot be exercised here.
- **Verified on software GL.** Proof frames come from SwiftShader, not a GPU or automotive hardware. Frame
  timing on target hardware needs its own measurement.
- **Approximate looks.** The presets are starting points tuned by eye against the reference frames. They are
  not pixel matches. The reference images were supplied in chat and are not stored in the repository.
- **No keyframes or undo yet.** Animation is one loop driven by the schema; a keyframe track and an undo
  stack are the next features.
- **System fonts.** Title text uses the operating system's sans-serif families (Helvetica, Avenir, Arial).
