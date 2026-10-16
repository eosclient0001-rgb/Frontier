# Empty documents and interactive sketch construction

## Reference retained alongside the editor

`Reference/index.html` is an unchanged snapshot of the configured GitHub Pages source for
https://sultanaladin.github.io/Frontier-/solidarc/ . Its pinned commit, SHA-256, provenance
and source-vs-deployment distinction are in `Reference/README.md`. Open
`http://<editor-preview>/Reference/index.html` to inspect it without replacing the GPU editor.

## Browser / HTML workflow

* Fresh storage starts with **zero figures**, not Mount. Examples remain explicit choices.
* A recoverable autosave offers **Welcome back → Continue previous / New document / Open .arc**.
* New Document retains a previous recovery copy. Construct → **Restore previous document**
  reopens it; it is also available after drawing in the new document.
* Autosave is debounced 600 ms after edits. Native `/native` action `snapshot` returns only the
  `.arc` journal, not a scene/frame packet. It does not mark the UI busy, rasterize, upload
  geometry or redraw. Camera navigation/drawing defers it. Storage failures warn the user;
  explicitly save an `.arc` before closing important work. This is browser-origin storage,
  **not cloud persistence**, and is not a crash-proof last-keystroke guarantee.
* Construct → Reference → **Workplane** chooses XY/XZ/YZ and a normal offset in metres.
  Drawing intersects that plane, not an arbitrary screen-depth or a ring of preset positions.
* Construct → Sketch Draw arms a tool; **nothing is authored until the required clicks finish**.
  - Line: start, end.
  - Rectangle: first corner, opposite corner. Centre rectangle: centre, corner.
  - Circle: centre, radius; the Defined by selector also offers diameter endpoints.
  - Arc: centre, start, end (counter-clockwise).
  - Ellipse: centre, major-axis end, minor radius.
  - Slot: first centre, second centre; end radius is editable in the prompt.
  - Polygon: centre, radius, then click/Enter to confirm; wheel or field changes side count.
  - Polyline/spline/control curve: successive points; Enter/right-click finishes.
* Esc cancels a draft without an edit; Backspace removes the last point. Construction and
  closed-polyline switches are available in the prompt. Alt-drag/middle navigation remains
  available while drawing. Tab/right-click opens Construct; L/R/C/A/P and Shift+L/Shift+E
  arm the corresponding sketch tools when not typing in a field/dialog.
* Width/height, length, radius/diameter, ellipse axes, polygon sides and arc angle appear as
  spatial live dimensions. Geometry/guide strokes use the existing **WebGL2 segment pipeline**;
  HTML text uses the same locally bundled **DM Sans** as the UI. No Canvas2D image is uploaded.
* Solid/surface tiles now open explicit numeric/command controls instead of inserting a
  hardcoded-sized object at a random/ring location. Their full click-to-draw tools are not
  part of this pass.

`WorkspaceFlow.js` owns UI/recovery/modal sequencing. `DrawingSequence.js` produces only
transient rubber-band presentation; spline/control-curve previews currently show the control
polygon, not an exact live NURBS evaluation. Native `draw <tool> (u,v)...` validates the whole
sequence, uses **the existing C++ ToolSession/NURBS builders**, and edits once, so Undo removes
one completed drawing. No browser mesh becomes the saved model. New draw journals require
this updated native binary; the retained legacy WASM module was not rebuilt.

## Native C++ / ImGui counterpart

`SolidArcEditorHost` now connects the actual viewport Construct chip to a modal catalogue,
with Reference workplane controls and the same native sketch tools. Tool input is still
`ToolSession`, fed by `ConsoleHost::ReceiveInput`, not HTML geometry code. Native Slot has
an additional radius click; native Polygon completes on its radius click and uses Up/Down
or numeric entry for sides. These are documented differences from the browser prompt flow.

`ToolPreview::Dimensions` contains world-space dimension strokes and labels. Both injected
GPU-command devices and the CPU raster receive the strokes; ImGui draws text with the UI
font. The headless editor proof explicitly loads the same `DMSans-Regular.ttf` as the browser.

Native **New document** clears figures, dimensions, named planes, constraints, undo and
journal via `StartEmptyDocument`; the old script-oriented `reset` behavior remains intact.
Recovery uses `_AgentScratch/autosave/SolidArc.arc` and `.previous.arc`, or the path specified
by `SOLIDARC_RECOVERY_FILE`. On an empty native startup, an existing recovery file offers
Welcome back / Continue / New. Native autosave waits for stable geometry for 600 ms and does
not run during a live tool/gizmo drag. The interactive C++ mirror now starts empty/recoverable;
only the noninteractive regression proof seeds example geometry. The thin CPU mirror advances
only on input, so its recovery timing is tick-driven; it is not a background desktop event loop.

The exact C++ HTML mirror remains a **CPU-reference transport**, not the browser GPU editor:

```sh
python3 Tools/Build/RunSolidArcEditorProof.py
python3 Tools/Build/ServeSolidArcMirror.py --port 8082
```

## Verification

From `Experimental/SolidArc`, with the native service and Vite running:

```sh
npm test                       # 17 native tests, including atomic draw, all sketch builders, .arc replay, snapshot
npm run verify:workflow        # 9 real browser workflow groups
npm run verify:browser         # 12 existing integration groups, example explicitly loaded by fixture
npm run verify:interaction     # 8 navigation/gizmo/layout groups
npm run verify:gpu             # 8 GPU/resource/appearance groups
npm run verify:performance     # native camera parity + no per-motion HTTP/uploads/readbacks
npm run verify:transport       # 3 startup/error-path groups
npm run test:transport         # 6 packet-contract tests
npm run build
```

Set `BROWSER_EXECUTABLE` for Chromium, `SOLIDARC_URL` for the editor URL, and optionally
`BROWSER_ARTIFACTS` for screenshots/proofs. The native headless proof additionally verifies
the actual Construct button, an empty document with no leftover dimensions, real rectangle
pointer preview/completion, spatial W/H labels, shared font and undo. Images are generated
under ignored `Exhibits/Gallery/Editor/EditorProof_SolidArc_{Empty,Construct,Drawing}.png`.

## Deliberate boundaries

This is the requested startup + core 2D drafting pass, **not a claim that the entire reference
application has been ported**. Datum/sketch points, polyline slot, workplane tilt/extent/face
attachment, object snapping in browser drafts, clockwise arc mode, constraint/modify/pattern
catalogues, and the complete reference solid-tool workflow remain unported. Exact spline
rubber bands, native/browser prompt parity and persistent editable dimensions on modal-drawn
NURBS are also follow-up work. Existing numeric native modeling tools remain available.
Physical-GPU/embedded frame rate, native Vulkan completion, fresh WASM and publishing remain
unverified/unfinished as recorded in `RENDERING_REPAIR_STATUS.md`. No commit or push was made.

## Native C++ mouse-path evidence (15 October 2026)

Run `python3 Tools/Build/RunSolidArcEditorProof.py` from the repository root.
The rectangle regression now clicks the actual native **Construct** button, finds the
native **Rectangle** tile's item bounds, clicks that tile, and sends both corner clicks
through `ImGuiIO::AddMousePosEvent` / `AddMouseButtonEvent`. It no longer executes a
`tool rect` or `point` command from the test. Native UI callbacks naturally dispatch
commands into the existing C++ tool session; pointer events go through the editor's
`AdvanceInput` and `ConsoleHost::ReceiveInput` path. Moving to the second corner leaves
the document empty and produces two live dimensions; the second click authors one
rectangle, with a single undo transaction. Test setup still uses commands for camera
and the separate pre-existing gizmo fixture.

Generated C++ visual evidence in `Exhibits/Gallery/Editor/`:
- `EditorProof_SolidArc_Empty.png`: native empty workspace.
- `EditorProof_SolidArc_Construct.png`: real native selectable catalogue.
- `EditorProof_SolidArc_Drawing.png`: native preview, DM Sans width/height labels.
- `EditorProof_SolidArc_Completed.png`: completed native document.
- `EditorProof_SolidArc_Scene.png`: scene-only C++ raster, without UI composition.

The shell now follows the approved browser workspace's tab/header, three rounded
panels, Geometry collection, Bodies/Sketches census, Construct section/tile catalogue,
empty Inspector and viewport camera controls, using actual shared C++ panels. It does
not embed a browser or paint a browser screenshot. **This is not exact UI parity yet:**
the native host remains single-document (the plus action starts a replacement document),
solid/surface construction uses an editable native command-parameter popup rather than
the browser's field forms, and workplane reference controls are simplified. Browser-only
catalogue/dimension editing gaps listed above still apply. The approved browser CSS
has not been changed for this native-shell work.

These images are native **CPU reference** evidence, not proof of native Vulkan rendering
or physical-GPU performance. The proof uses a fixed simulated frame timestep; on-screen
FPS readouts are not a benchmark. Inputs are native ImGui IO events in a headless executable,
not evidence of a physical OS window/input backend. No `CLAUDE.md`/`claud.md` was found
in this checkout. Native Vulkan, exact remaining UI parity and physical desktop input
verification remain outstanding.

### Native CAD follow-up

The native name-first outliner, direct document roster, icon tiles, Polyline Slot,
point tools and journalled tool settings are now implemented and covered by the
native proof. The old gaps list above is historical; the current detailed inventory
and remaining parity work are in
`Editor/AuthoringTools/Modelling/SolidArc/NATIVE_UI_PARITY.md`.
Regenerate the self-contained offline evidence page with
`python3 Tools/Build/GenerateSolidArcProofGallery.py` after running the native proof.


The latest native proof now mouse-tests 14 Sketch/Reference Construct tools using
816 interpolated native pointer moves plus placement clicks, preview/non-commit
checks, completion and undo. `GenerateSolidArcProofGallery.py` now embeds a native-frame
rectangle APNG, 26 still rasters and the JSON results, with lossless PNG compression.
Filter, Orbit and projection share the black/grey colour variant. Remaining operation
scope and the CPU/headless evidence limits are recorded in `NATIVE_UI_PARITY.md`.

### Native orbit animation and Inspector counterpart — 15 October 2026

The C++ counterpart now follows `RefreshInspector()`'s selected geometry cards,
counts, three tabs, Dimensions, world Bounds, Operations and Presentation, plus
its empty-state Box / Circle / Rectangle / Extrude roster. No browser layout/CSS
was changed. Native transforms include world position, rotation, axis and uniform
scale; they currently commit with Apply rather than the HTML's immediate fields.
Native solver actions still use explicit command-parameter popups; the complete
HTML operation-specific forms and precise icon/spacing parity remain unfinished.

`Exhibits/Gallery/Editor/SolidArcProofs.html` is offline/self-contained and begins
with `SolidArcOrbit.gif`: 10 C++ captures from a 32-step native RMB mouse orbit,
about 50 degrees yaw. Native Inspector screenshots follow in the same gallery.
A native widget test renames/restores a body, types X=0.25, applies it, checks the
geometry delta, and undoes it. The 14-tool Construct sweep still passes.

Reproduce the full suite with `python3 Tools/Build/RunSolidArcEditorProof.py`.
For a focused rerun after building:
`.cache/solidarc-editor/SolidArcEditorProof --inspector-orbit-only`.
GIF packaging needs Pillow (`python3 -m pip install --target .cache/proof-python Pillow`),
then `python3 Tools/Build/GenerateSolidArcProofGallery.py`. GIF palette encoding is
lossy; still PNG packaging is lossless. Playback is illustrative native-input/CPU
proof, not a native GPU performance measurement. The live mirror must be restarted
after rebuilding; `/version` must report `restartRequired: false`.

### Visible animations and same-origin GPU drawing preview

The native mirror homepage now opens on the **orbit GIF itself**, not the live CPU
image with a difficult-to-find gallery link. The **Construct + drawing** tab shows
`SolidArcGpuDrawing.gif` (Construct menu, rectangle preview/commit, circle
preview/commit), followed by clearly labelled native CPU catalogue/drawing evidence.
The **Open GPU drawing editor** link opens this unchanged HTML workspace at `/gpu/`.
Build with `npm run build -- --base=/gpu/`; run `Native/ServeSequence.py` on 8081
alongside `Tools/Build/ServeSolidArcMirror.py --port 8082`. Browser `/native` requests
are proxied on the same origin, never to browser-local localhost.

`Tools/Build/RunSolidArcGpuDrawingProof.mjs` records actual menu and pointer input,
checks native figure commits and WebGL calls, and stores renderer/input evidence.
The gallery generator encodes its screenshots into the drawing GIF. Sandbox capture
uses SwiftShader and labels it as software WebGL2; physical GPU and native Vulkan
are **not** claimed. The GPU path draws geometry/grid/overlays through shaders,
with zero CPU scene-RGBA uploads. Tests also checked that both homepage GIFs are
visible and actually change pixels, and that `/gpu/` starts empty without JS errors.

### All-view grids and drawing-plane placement

HTML was implemented/tested first, then the C++ editor counterpart. Named camera
views now select the matching drawing plane: **Top/Bottom → XY**, **Front/Back →
XZ**, **Right/Left → YZ**. X is red, Y green, Z blue. Isometric and free orbit retain
the active workplane rather than switching it during camera motion. Custom
workplane offsets affect both grid rendering and shape placement. Changing named
views cancels incomplete drawings so old UV points cannot move to another plane.

The same plane basis is used by the shared `.slang` lattice shader, the HTML
mouse-ray intersection, live GPU preview strokes and native C++ geometry commit.
Grid depth is computed from its world-space ray intersection. Axis strokes are
slightly stronger than minor grid lines for visibility. This is drawing **on the
plane at the mouse position**; no new quantized snapping mode is implied.

Run `node Tools/Build/RunSolidArcViewGridProof.mjs` from the repository root with
Playwright Chromium (optional `BROWSER_EXECUTABLE` / JSON `BROWSER_ARGS`). The test
covers all six standard views, Isometric retaining YZ, framebuffer axis colours,
preview/noncommit, native bounds at the mouse locations, and an offset plane.
The matching C++ proof is `.cache/solidarc-editor/SolidArcEditorProof --view-grid-only`
after building it. Native tests also verify all points are coplanar, save/reopen
and one-step undo. Full 14-tool native regression remains passing.

The mirror homepage's **View grids + drawing** tab now presents the HTML animation
first and the native counterpart next; the gallery generator embeds these GIFs
when their test captures exist. The HTML recording uses sandbox software WebGL2;
the C++ recording uses CPU SlangMirror. Neither is physical-GPU or native Vulkan
proof. The actual browser drawing route continues to use WebGL2 draw calls without
CPU scene-image uploads. Both services must be restarted after rebuilding C++.

## 16 October: reference dimensions, shape kinds and orientation cube

The retained reference was rechecked against the configured Pages source and has the
same SHA-256 (`fb769872…169b695`). Live dimensions now use white 1 px strokes, filled
7 × 6 px arrowheads, 18 px black/.72 capsules with radius 9, and 11 px UI text
(DM Sans, as permitted). Display values convert the native metre coordinates to mm;
the kernel's units have not changed. Radius/diagonal diameter, rectangle offsets,
polygon spokes/central and interior angle annotations and warm angle guides are
presentation, not authored constraints. The shared lattice shader now uses subdued
reference-style minor/major grid contrast, retaining all-view colored axes and planes.
This is a styling/workflow match, not a claim of whole-page pixel-identical rendering.

The bottom-right orientation widget is now a projected 3D cube with hidden-face
rejection, six selectable faces and a colored camera-linked axis triad. HTML submits
cube surface triangles and line streams to the existing WebGL2/shared Slang path;
native `ViewportPanel` submits projected cube triangles through the shared ImGui
UI (rendered by its GPU backend in an engine build). A face selects the appropriate
standard view **and workplane**. Native cube dragging retains its orbit interaction;
browser orbit remains the existing viewport mouse interaction. The selected-object
transform gizmo is independent and is not replaced. Native screenshots are headless
CPU raster proofs, not verified native Vulkan execution.

`SceneFigure::ShapeKind` records authoring identity independently of the editable name.
Both outliners choose per-shape glyphs from the exported kind, rather than calling every
curve a spline or guessing from names. Copy, undo and journal replay preserve it.
Construct adds Polyline Slot, Point, Datum Point, three-point Circle and three-point Arc;
Diameter Circle remains available through Circle's mode selector (and its native tile).
Three-point Arc uses **start, end, through**, matching native ToolSession. Polyline Slot
uses repeated centre clicks, an editable radius, and Enter/right-click completion.
HTML rubber bands are non-authoritative presentation; committed NURBS come from C++.

Verification:
- `python3 Experimental/SolidArc/Native/GeometryMetrics.py`: 18 checks, including all
  27 catalogue entries and kind preservation after rename/save/reopen/undo.
- `node Experimental/SolidArc/src/WorkflowMetrics.mjs`: nine workflow checks.
- `node Tools/Build/RunSolidArcCurveCubeProof.mjs`: five new mouse-selected tools,
  native commits, registered icons, undo/redo, six face clicks, orbit-linked cube;
  WebGL2/SwiftShader, zero CPU fragments/RGBA uploads, no JS errors.
- `python3 Tools/Build/RunSolidArcEditorProof.py`: 17 native mouse-selected tools,
  1,008 interpolated moves, valid NURBS, one-step undo.
- `.cache/solidarc-editor/SolidArcEditorProof --orientation-only`: six native face
  clicks, each required to correct an intentionally wrong workplane.
- `python3 Tools/Build/GenerateSolidArcProofGallery.py`: embeds current evidence in
  `Exhibits/Gallery/Editor/SolidArcProofs.html`, viewable without publishing.

Live mirror: port 8081; browser GPU route `/gpu/`, native CPU-input mirror `/cpp`,
embedded gallery `/proofs`, same-origin native geometry service on 8083.
Rebuild **and restart both services** after native changes; a new gallery alone does not
refresh a running native executable. No commits or pushes were made for this work.

### Viewport rotation and face UV correction

Viewport mouse navigation now uses screen-space orbit: an axis/angle rotates the eye
**and camera up** together around the existing fixed target. It no longer just adds
world yaw and clamped elevation, which spun horizontally at Top/Bottom and prevented
smooth pole crossings. Pivot, eye-to-pivot distance, drawing plane and object geometry
are unchanged. The camera carries a roll value solely to retain its orientation through
these transitions; it is not an independent "tilt camera" gesture. Native and predicted
HTML matrices agree, including nonzero roll. Named views reset roll to zero.

`CameraProjection::OrbitScreen` mirrors `MoveCamera(..., "orbit")`; right/up and view
matrices use that orientation. Browser/native vertical drag signs and sensitivity now
match. Native input journals accept legacy 19-field records and new 20-field records
containing roll; browser/native synchronization and recovery preserve roll too.
The legacy console `view orbit` angle command retains its yaw/elevation semantics.

Cube labels now follow each face's actual U/V directions. HTML maps its UI-font label
square through the projected face basis; native ImGui remaps real font glyph vertices
through the same face basis. Text rotates, shears and foreshortens with its face rather
than remaining a floating screen-facing label. The axis-tip letters remain billboards.

Additional checks:
- `node Tools/Build/VerifySolidArcOrbit.mjs`: 28 native/HTML camera steps over all seven
  named views, fixed target/radius, pole escape, full ViewClip/ViewWorld/ClipView parity.
- `node Tools/Build/RunSolidArcOrbitUvProof.mjs`: real browser mouse drags from Top,
  Bottom and Iso; fixed target/distance, face-label affine mapping, zero CPU uploads.
- Native `--orientation-only`: six cube face clicks plus a horizontal mouse orbit
  from Top (24 moves), verifying eye motion on the target sphere and no pivot drift.
- `python3 Tools/Build/GenerateSolidArcOrbitUvProof.py`: embeds fresh browser GIF/stills
  and C++ CPU proof images in `Exhibits/Gallery/Editor/SolidArcOrbitUvProof.html`.

### Correction: RIGHT-button rotation axes

Right-drag is explicitly **CAD turntable rotation**, not the screen-up/free-orbit mode:
- Horizontal RMB motion changes yaw around world Z only; elevation is unchanged.
- Vertical RMB motion changes elevation around the horizontal camera-right axis only.
- Roll is zero; pivot, distance and object geometry do not change.
- Middle-drag or Shift+right-drag pans. Plain RMB must NOT be classified as pan.
- Left/Alt free-orbit and the UV-mapped cube labels are unchanged.

The browser previously classified button 2 as pan, and the native RMB path used the
screen-space orbit function from the previous correction. Both are now explicitly
mapped to the same `turntable`/`CameraProjection::Orbit` path. Browser buttons number
RMB as 2; native ImGui numbers it as 1. Both native transport and local prediction
use the corrected mapping. Active drawing tools still reserve RMB to finish/cancel.

`RunSolidArcRightDragProof.mjs` tests actual right-button mouse drags from Iso, Front
and Right, independently checking each axis, no pan/roll, fixed radius and Shift+RMB
pan. `VerifySolidArcOrbit.mjs` adds ten native/HTML axis-isolation cases. Native
`--orientation-only` now tests RMB horizontal/vertical axes separately; its pole
escape test uses Alt+left free-orbit. Evidence distinguishes WebGL2/SwiftShader from
native C++ CPU raster; neither is physical-GPU execution evidence.

### Superseding correction: upright navigation for EVERY drag (screenshot regression)

The screen-up/free-orbit path introduced above was incorrect for the requested CAD
navigation: it could produce the rolled Front view shown in the user's screenshot.
It is now removed, **including left and Alt-left**, not merely bypassed for RMB.
All orbit entry points use world-Z yaw / camera-right elevation with no roll.
`OrbitScreen` is a backwards-compatible alias for upright `Orbit`, not arcball.
Horizontal-only movement leaves elevation unchanged, including named Top/Bottom.
World Z remains screen-up (camera-right Z component exactly zero), elevation is
clamped before crossing a pole, and the orbit centre/distance remain unchanged.
The UV-mapped cube text is retained; cube vertical edges track the same upright basis.

Legacy browser camera copies, native camera synchronization and old 20-field input
records discard roll. Native rendering also ignores any legacy roll field. This
prevents an old recovery/journal camera from resurrecting the tilted orientation.

Current evidence: `RunSolidArcUprightProof.mjs` checks 12 combinations (Iso/Front/
Top/Bottom × RMB/LMB/Alt-LMB), at 12 actual mouse moves per combination, asserting
zero roll, world-Z screen-up and fixed pivot/distance; injected legacy roll also
restores upright. WebGL2/SwiftShader, zero CPU frame uploads. Native matrix parity
and mouse input checks pass too. Older free-orbit/pole-escape descriptions and images
above are historical and superseded by this correction.
