# SolidArc panel — HTML ↔ C++ integration record

HTML-side review and repair of the SolidArc prototype: what the UI promises,
what the C++ console actually speaks, and the contract between them from now on.

- Reviewed: `Panel/index.html` (single file, ~370 KB, no build step) and
  `Panel/Verification/{smoke.js,render.js}` from
  `SultanAladin/Frontier- @ arena/01a08c57-frontier`,
  against the C++ side (`Console/ConsoleHost*.cpp`, `Kernel/*`,
  `Interaction/{CameraProjection,HotkeyChart}*`, `Scripts/*.arc`).
- Scope of this pass: **HTML side only**. C++ changes are listed as follow-ups.
- Verify: `node Verification/smoke.js` (432 checks) and
  `node Verification/render.js fillet matcap` (offline PNG → `view.png`, git-ignored).

## 1. Finding log

`✅ fixed` · `📝 documented (needs a decision or C++ work)` · `🔶 partly`

| ID | Severity | Finding | Status |
|----|----------|---------|--------|
| F-01 | P0 | Units: C++ works in **metres**, the panel in **mm**, with no conversion layer — any bridge would silently scale ×1000 | ✅ `M_TO_MM` + conversion at the `.arc` boundary; contract §2 |
| F-02 | P0 | Command language diverged: panel `runCmd` had 11 verbs with different grammars than the ~91 C++ verbs; no `help` | ✅ parity subset: paren points, `help`/`redo`/`unhide`, multi-select/delete, `view …/fit`; table §3 |
| F-03 | P0 | No shared script path (panel: proprietary `.json`; C++: `.arc`) | ✅ `.arc` subset importer (`importArc`, open-file accepts `.arc`); table §4 |
| F-04 | P0 | Two extrude flavours: tool extrudes are B-rep, command-line extrudes legacy meshes — edge edits silently ignored on the latter | ✅ `runCmd extrude` now builds B-rep, falls back to legacy only for open profiles |
| F-05 | P0 | XSS through `innerHTML`: command echo, figure/dimension/variable names, expressions, history labels, edit keys | ✅ `esc()` at all 29 user-text sinks; attrs round-trip via `dataset` |
| F-06 | P0 | Fake boolean presented as real (`subtract` stuffs reversed cylinder tris into a box; health claimed “SSI solved”) | ✅ honest label + operand guards; true booleans stay C++-only |
| F-07 | P1 | CSS `.tile` defined twice: outliner status tiles and catalogue cards fought over one class | ✅ status tiles scoped to `.stat` |
| F-08 | P1 | `evalExpr('1e3')` → NaN (identifier rewrite ate exponents) | ✅ exponent guard; `1e3 2E-2 1.5e3` all work |
| F-09 | P1 | View keys advertised as `1/3/7` but only worked on the numpad (row digits are select modes) — dead on laptops | ✅ `Alt+1/3/7` aliases + honest button titles |
| F-10 | P1 | Toolbar showed `E` twice (ellipse row and extrude row) | ✅ draw row now reads `⇧E` (the real binding) |
| F-11 | P1 | Unreachable second `F` branch (Ctrl+F jumped the pivot *and* opened browser find) | ✅ removed |
| F-12 | P1 | No `Ctrl+Y` redo (Windows convention) | ✅ added |
| F-13 | P1 | `setView('bogus')` threw (`m[0]` of undefined) | ✅ hint + `back/left/bottom/persp` |
| F-14 | P1 | Undo dropped the selection | ✅ selection stored in undo entries |
| F-15 | P1 | Camera not autosaved; storage failures silent; “autosave” label static | ✅ autosave on view change, timestamp label, one-time failure warning |
| F-16 | P1 | `subtract` with dangling operands threw every frame (draw → wire fallback loop) | ✅ guards + default segments |
| F-17 | P1 | No touch orbit (`touch-action` missing on the viewport canvas) | ✅ `#gl{touch-action:none}` |
| F-18 | P1 | Junk undo entries: double snapshots on delete/plane, no-op entries on failed commands | ✅ single-entry discipline (`dropSnapshot`, `noMatch`) |
| F-19 | P1 | `box a b c` created NaN-geometry figures | ✅ validation with a visible error |
| F-20 | P1 | Camera clamped to 2 m — metre-scale imports could never fit | ✅ fit ≤ 200 m, wheel ≤ 20 m |
| F-21 | P2 | Dev builds displayed the literal `__BUILD__` placeholder | ✅ “dev build” label |
| F-22 | P2 | Duplicate CSS rules (`.cat-track`, `.stp .n`) | ✅ merged |
| F-23 | P2 | Canvases and icon-only buttons had no accessible names | ✅ roles/labels; log console is `aria-live` |
| F-24 | P2 | Fixed 3-panel layout overlaps below ~980 px | 🔶 narrower rails + catalogue clamp; full responsive = follow-up |
| F-25 | P1 | Select modes reversed vs C++: panel `1-4` = body/face/edge/vertex, C++ = control/edge/face/solid | 📝 needs a product decision (§7) |
| F-26 | P1 | Hotkey vocabulary diverges (`R/C/L/P/Q/B` mean different things each side) | 📝 joint key-chart review, table §8 |
| F-27 | P1 | 370 KB single-file monolith; no seam to swap the JS kernel for C++/WASM | 📝 roadmap §10 (kept no-build by design) |
| F-28 | P1 | Renderer parity: Canvas2D painter’s algorithm vs Vulkan/`SoftwareRaster` (FOV 40 vs 42, matcap approximation, no depth buffer) | 📝 parity notes §9 |
| F-29 | P2 | Panel loads Google Fonts (CDN); repo `.ttf` files are 524-byte stubs | 📝 panel has system fallback; real fonts are C++-side work |
| F-30 | P2 | `docs/solidarc/index.html` is a generated copy that can drift from `Panel/` | 📝 `Scripts/publish-pages.sh` is the only writer; BUILD stamp exposes drift |
| F-31 | P2 | C++ `HotkeyChart` binds `shift+b` twice (box *and* chamfer) | 📝 C++-side fix |
| F-32 | P2 | Smoke tests mock the DOM — no real browser/layout/event coverage | 📝 follow-up: Playwright smoke |
| F-33 | P2 | `draw._retry` falls back to wireframe on render errors, which can mask bugs | 📝 kept; error is still logged + bannered |
| F-34 | P2 | `evalExpr` sandbox allowlist is broad (`a-z`) — safe only because every identifier is rewritten first | 📝 kept; do not loosen the rewrite |
| F-35 | P1 | `runCmd` box/cylinder/extrude names counted ops, duplicating names after deletes | ✅ `nextName` everywhere |
| F-36 | P1 | `view fit` missing from the command line | ✅ (in F-02) |
| F-37 | P1 | The log console only existed inside the single-selection inspector — command feedback was invisible otherwise | ✅ console moved to static HTML, always visible |

## 2. Units contract

- The panel is **millimetres, everywhere**: figure params, `view.dist`, lattice 10 mm,
  snap 5 mm, dimension labels, command-line numbers.
- The C++ console is **metres** (`CameraProjection` annotates `[m]`; `.arc` scripts use
  metre-scale numbers; lattice cell 1.0).
- The **only** conversion point is the `.arc` boundary: `M_TO_MM = 1000` in
  `importArc`/`arcParse`. Angles stay in degrees on both sides.
- If a WASM/C++ kernel is ever bridged in, it must declare its unit on every call
  (or take mm and convert internally) — never assume.

## 3. Command parity (`arc ›` prompt vs C++ console)

Panel verbs after this pass (all still accept the old spellings):

| Panel | C++ equivalent | Notes |
|---|---|---|
| `box w d h [x y z]` | `box (corner) dx dy dz` | panel pos = centre-base; C++ corner = min corner |
| `box (x,y,z) dx dy dz`, `box (a) (b)` | same | **new**: C++ spellings, converted to centre-base |
| `cylinder r h [x y z]`, `cylinder (x,y,z) r h` | `cylinder (foot) r h [--axis]` | panel vertical-only; `--axis` is import-warned |
| `extrude Sketch h` | `extrude <curve\|aN> len` | panel takes the sketch, B-rep flavour; C++ also takes areas |
| `plane XY\|XZ\|YZ` | `plane …` / `workplane …` | different grammars; both create workplanes |
| `select all\|none\|names…` | `select …` (superset) | panel: no box/pole selection |
| `hide [names]` (bare = selection) | `hide …\|selected` | |
| `show name`, `show all`, `unhide [all\|names]` | `unhide …\|all` | `unhide` is **new** |
| `delete [names\|selected]` | `delete …` | single undo entry now |
| `view front\|back\|right\|left\|top\|bottom\|iso\|ortho\|persp\|fit` | `view …\|orbit\|fit\|dolly` | orbit/dolly stay C++-only |
| `dim on\|off`, `dim Name key` | (dimensions are sketch constraints in C++) | different systems; names only |
| `undo`, `redo`, `help` | `undo`, `redo`, `help` | `redo`/`help` are **new** |

## 4. `.arc` import subset

`importArc(text)` (File → open accepts `.arc`). One undo step. Metres → mm.
Verbs outside this table are skipped with a one-line warning each (capped in the log,
full list returned in `warnings`).

Supported: `line polyline rect polygon slot circle arc ellipse box cylinder plane
extrude loft move workplane view select hide unhide rename clear list echo help`
(`render` warns; `arc --three` warns).

Assumptions (all warned at import when they bite):

- `rect --radius` ignored — fillet corners after import.
- `polygon` radius = circumradius, unless `--circumscribed` (then inradius ÷ cos(π/n)).
- `circle --normal`, `cylinder --axis/--sheet`, `plane --u/--v`,
  `extrude --direction/--sheet` ignored (workplane / vertical / capped / solid).
- `box`/`cylinder` corner forms convert min-corner → centre-base.
- `plane (o) lU lV` becomes an axis-aligned surface; `plane --name=` alone renames the
  active workplane.
- `extrude` resolves a curve by name and builds the B-rep flavour; areas (`aN`) skip.
- `loft` needs ≥ 2 closed-curve profiles (no areas/edges/guides).
- `move` offsets `pos` (curves included); `workplane … [--origin=(…)]` sets plane pos.
- `view` maps the nine static views + `fit`; orbit/dolly skip.
- No `spline/cpcurve`, no `sphere/cone/torus`, no `revolve/sweep/pipe/fillpatch`,
  no `sew/solidify/boolean` solids, no `offset/trim/join/explode/fillet/chamfer`
  (use the panel tools after import), no `delete/duplicate/isolate/undo/redo` mid-script.

## 5. Geometry mapping

- Curves: `line poly circle arc ellipse point` (+ `poly` with `bulge` arcs, DXF sign
  convention; slots keep `spine + r` and regenerate via `regenSlot`). No NURBS.
- Extrude has two builders: `solidBuild` (B-rep: `brep.faces/edges/verts`, stable keys
  like `side:2`, `cap:top`; supports `edits` + `faceOps`) and legacy `extrudeMesh`
  (triangle soup, kept for open profiles/sheets). Tool extrudes and imports use B-rep.
- `subtract` is a **placeholder preview** (box + axis hole only), not CSG.
  Anything else boolean belongs to the C++ kernel.
- `loft` bodies (`op:'loft'`) interpolate resampled sections; surfaces `loft/plane`
  are the old mesh demos.

## 6. Camera conventions

Both sides are Z-up with turntable orbit, but the numbers differ:

| | Panel | C++ (`CameraProjection`) |
|---|---|---|
| Units | mm (`view.dist` ≈ 260) | m (`Distance` ≈ 12) |
| Angles | `az/el` degrees, iso = 45/30 | yaw/pitch radians, −35°/30° |
| FOV | 40° | 42° |
| Views | top/front/right/iso (+back/left/bottom) | front/back/right/left/top/bottom/iso |
| Projection toggle | `ortho` flag / `5` | `5` / `ortho` |

## 7. Selection modes

- Panel: `Body 1 · Face 2 · Edge 3 · Vertex 4` (+⇧ combine), sketcher sub-modes align.
- C++: `selectmode solid|face|edge|control` on `4/3/2/1` — the same four concepts in
  **reverse** key order and different names.
- Decision needed before any shared key chart or tutorial text: pick one order.

## 8. Keyboard map (panel) and C++ divergences

Panel bindings that matter for the “how interaction works” prototype:

`L` line · `⇧L` polyline · `R` rectangle · `C` circle · `A` arc · `P` polygon ·
`⇧E` ellipse · `E` extrude · `⇧O` loft · `I` inset · `O` offset · `T` trim · `K` cut ·
`B`/`⇧B` fillet/chamfer · `M`/`⇧M`/`⌥M` mirror/linear/circular · `⇧D` dimension ·
`D` toggle dims · `G`/`⇧R`/`S` modal move/rotate/scale (`X/Y/Z` lock, digits type-in) ·
`F` focus · `⇧F` fill · `H` hide · `⌥H` unhide-all · `⇧W` workplane · `Q`/`Esc` select ·
`Tab` catalogue · `1-4` modes · `5` ortho · numpad/`Alt+1/3/7` views ·
`Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y` undo/redo · `Ctrl+H/S/O/N` history/save/open/new ·
LMB orbit · `⇧LMB` pan · wheel dolly · `⌃` snap · `⌥` slide.

Same letter, different meaning in the C++ `HotkeyChart`:

| Key | Panel | C++ |
|---|---|---|
| `R` | rectangle (always draws!) | rotate selection |
| `⇧R` | rotate modal | **repeat last command** |
| `C` | circle | cut |
| `L` | line | loft selected |
| `P` | polygon | pipe selected |
| `Q` | select tool | boolean union |
| `B` | fillet | fillet (same) |
| `E/O/T` | extrude/offset/trim | same |
| `M` | mirror | `Alt+X` mirrors; `M` unbound |

Recommendation: converge on one chart before user-facing docs (the C++ `bind` verb
can adopt panel bindings or vice versa). Also note F-31: C++ binds `shift+b` twice.

## 9. Renderer parity

- Panel: immediate-mode Canvas 2D, CPU painter’s sort, per-frame full redraw, no depth
  buffer, no frustum culling. Shade modes `wire/flat/plastic/matcap` approximate the
  C++ `SoftwareRaster` outputs — close enough for interaction prototyping, not
  pixel-comparable (see FOV §6; matcap is an analytic approximation).
- Keep the seam in mind: `draw()` reads `meshOf()`/`topo()` only. A future raster
  (WebGL, WASM `SoftwareRaster` PNG stream) replaces `drawInner`, not the tools.

## 10. Roadmap to real integration (after the HTML pass)

1. **Joint key chart + select-mode order** (§7–§8) — one product decision, then align.
2. **Kernel seam in the panel**: introduce a `Kernel` object behind
   `profileSegs/solidBuild/solveSketch/meshOf` with stamped units, so the UI never
   touches geometry math directly; the JS implementation becomes `KernelJS`.
3. **WASM build of the C++ `Kernel/`** (math only — no Vulkan/ImGui) exposing the same
   `Kernel` surface; feature-detect and run both against the shared `.arc` corpus (§4).
4. **Browser smoke** (Playwright): load page, run `.arc`, screenshot, diff against
   `render.js` PNGs; keep `smoke.js` as the fast logic gate.
5. **Responsive pass** for the three panels (F-24) once desktop interaction is frozen.
6. C++-owned: real booleans stay kernel-side; STEP/STL export; real fonts (F-29);
   `shift+b` double-bind (F-31).

## 11. Files

- `index.html` — the prototype (source of truth; `BUILD` placeholder).
- `Verification/smoke.js` — headless logic tests (§31 covers this pass).
- `Verification/render.js` — offline PNG renders (`view.png`, git-ignored).
- `docs/solidarc/index.html` — generated by `Scripts/publish-pages.sh`; never edited.
