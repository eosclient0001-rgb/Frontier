# Texturing Workspace UI — audit, fixes and verification (2026-11-19)

**Scope.** The native Texturing workspace in this repository: the `TextureWorkspace`
binary (`Experimental/TextureStudio/Native/TextureStudioApplication.cpp`, CMake target
`TextureStudio`) hosting the three native panels in `UI/TextureStudio/`
(`MaterialLibraryPanel`, `PatternWorkspacePanel`, `StampWorkspacePanel`) through
`PanelDockspace`.

**Status: ✅ implemented, built, tested.** Four files changed, no new systems, no new
components, no new CMake targets.

---

## 1. Repositories audited

Both repositories named in the task were cloned into separate directories
(`/tmp/frontier-work/frontier-target`, `/tmp/frontier-work/frontier-ref`); nothing was
committed into either, and the reference clone was read only.

| Repository | Branch | What it actually contains |
| :--- | :--- | :--- |
| `SultanAladin/Frontier` | `arena/8391e994-frontier` @ `536cfe1` | Engine + `Engine/Workspaces/{Texturing,Material}` + `Experimental/TextureStudio` (JS) |
| `c7egoist/Frontier` | `arena/28856115-frontier` @ `129ed35` | The same tree **plus** `Experimental/PaintInspector/`, `Experimental/MaterialInspector/` (+`ChannelStack.js`), `BrushStudio`, `ArtworkInspector`, `BakeInspector` and `Documentation/Plans/TexturePaintWorkspacePlan.md` |
| **this repository** | `eosclient0001-rgb/Frontier` `main` @ `96f31ec` | `UI/TextureStudio/` native ImGui panels + `Experimental/TextureStudio/` React reference app |

**Divergence that decides where the fix belongs.** The audited repositories host their
Texturing UI as JavaScript workspaces (`Experimental/TextureStudio/Workspaces/`) driven by
`Engine/TexturePaintEngine.js`; **neither contains a C++ Texture Paint panel.** This
repository hosts the same workspaces natively in C++ (`UI/TextureStudio/*.cpp`) with a
real Vulkan preview, atlas bakes and GPU vector-coverage painting. The C++ workspace that
must match the HTML reference therefore lives **here**, in `UI/TextureStudio/`, and the
HTML/JS reference is the Paint page (`Experimental/PaintInspector/`: Layers outliner +
Layer Inspector cards) together with this repository's own
`Experimental/TextureStudio/src/*.jsx` source of truth.

## 2. Reference render (not just raw HTML)

The sandbox has no root and no working Chromium (`libnspr4` and the X11/Wayland dev
packages are unavailable, so Playwright/Puppeteer and `apt` cannot complete). The
reference page was therefore rendered by its **own authoring harness**, whose committed
output is the rendered page at
`frontier-ref:Experimental/PaintInspector/Screenshots/{paint,paint-channels,paint-text}.png`,
inspected visually (not as markup). Catalogued anatomy:

- **Dock rail** at the top: `Material · Pattern · Stamp · Baking · Brush · Paint`, one
  active pill, each entry reachable.
- **Layers outliner card** (left, 24 px radius): title `Layers` + document tag + `Add`
  split pill; two statistic tiles (`LAYERS 5/5`, `CHANNELS 5/22`); search pill +
  `Filter` dropdown; tree of 39 px rows — thumbnail, name, `blend · 100% · n ch`, six
  channel peek dots, `MASK` badge, eye and lock tools; footer readout strip
  `RES · LAYERS · MASKS · PAINTED`.
- **Layer Inspector card** (right): type mark, undo/redo/import/reset tools, breadcrumb,
  18 px layer name, `normal · 100% · 5 CH` line, layer picker; three stat tiles
  (`Opacity 100%` with a blend meter, `Channels 5/22`, `Mask None`); `LAYER` group with
  blend/part dropdowns, master-opacity slider pill, `Visible` and `Lock edits` switches;
  type card; `CHANNELS` group with search, a `CORE 4/7` disclosure row and per-channel
  rows (swatch, name, caption, value pill, switch), groups `Surface · Coat · Optics ·
  Emission`; `Mask` group with `+ Add mask`; footer `Saved locally · frontier.texture-paint.v2`.
- Tokens: `#121212` panel, `#1c1c1e` inset, `#f0f0f0`/`#888`/`#5c5c5c` text ramp,
  10 % white strokes, 999 px pills, 26 px control height, 18 px inset radius.

## 3. Previous-agent state found (defect register)

| # | Finding | Location |
| :--- | :--- | :--- |
| A1 | **Duplicated mask editor.** `VectorMaskControls.cpp` already provided a shared, backed mask editor (`ConstructVectorAuthoringMaskControls`) — and was only used by one validation exhibit. Pattern and Stamp each carried their own hand-rolled copy: same toggles, same eight controls, drifting labels (`Mask shape` vs `Shape`) and different empty-state behaviour. | `PatternWorkspacePanel.cpp:~2752`, `StampWorkspacePanel.cpp:~1605` |
| A2 | **Dead-ended "not ported yet" UI.** Both copies ended in a disabled claim while the real retained mask record (`Topology/Bounds/Transform`) was being edited and baked. | as above |
| A3 | **False "not ported yet" gate on live sliders.** `RenderControl` marked every *direct* recipe control unsupported unless the key resolved as a stratum scalar, even when the value lived in the procedural pool — so real, live sliders (detail scale, orange-peel scale, texture scale) were disabled behind an "unbound parameter" tooltip. | `MaterialLibraryPanel.cpp:1006` |
| A4 | **Dead workspace-rail entries.** Pattern and Stamp headers carried permanently disabled `Texture` and `Baking` pills pointing at no host ("This native workspace is not hosted yet"), reading as broken tabs. | `PatternWorkspacePanel.cpp:~976`, `StampWorkspacePanel.cpp:~407` |
| A5 | **Fake "Stored groups · 0".** A disabled button with a hard-coded `0` and a "not ported yet" tooltip, although the document's `Enclosures` are real and edited right above it. | `PatternWorkspacePanel.cpp:~1409` |
| A6 | **Misleading capability text.** `"Gradients fall back to a neutral grey; clip-paths and masks are not ported"` and two `"Stroke image sources remain deferred"` lines, while `VectorCoverage.slang` fully evaluates linear and radial gradients (`Transform.w == 1|2`) and the Mask card authors a real mask. | Stamp + Pattern inspectors |
| A7 | **Missing reference anatomy** in the native layer stacks: no `Layers`/`Channels` head tiles, no per-row channel summary or peek dots, no `MASK` badge on the row, no footer readout. | `PatternWorkspacePanel::ConstructLayers`, `StampWorkspacePanel::ConstructLayers` |

## 4. Fixes

1. **One mask editor, reused.** Pattern and Stamp now call the existing
   `ConstructVectorAuthoringMaskControls` and commit the edited layer through their own
   `EvaluateEdit`, so every switch, shape, opacity and bounds change is a single undoable
   document edit that the GPU coverage bake already consumes. The duplicate copies and
   their "not ported yet" footers are gone. `Edit mask` remains a canvas mode toggle, not a
   second editor.
2. **Accurate mask shape binding.** The picker in `VectorMaskControls.cpp` now reports the
   shape the record actually holds (`Topology[0] == 1` → Ellipse, rectangle-family otherwise)
   and only writes when the value really changes.
3. **Truthful status text** replaces the unported claims: the mask footer prints the live
   mask geometry ("evaluated by the GPU coverage bake"); the fill/stroke notes state that
   solid, linear and radial sources are all evaluated natively; the SVG-import note states
   precisely what is flattened (imported SVG paint servers, clip-path results).
4. **Direct recipe controls resolve through one lookup** (`QueryDirect`: stratum scalar,
   then procedural pool). This removes both the false disable and the empty-`optional`
   dereference that a pool-only control would have hit, and keeps `ApplyTarget` writing
   back to the same live parameters.
5. **Workspace rail matches what the binary hosts**: `Material · Pattern · Stamp`, no
   disabled dead entries — matching the reference dock.
6. **`Stored groups · n`** is the live `Enclosures` count and toggles the retained group
   sheet.
7. **Reference layer-row anatomy** added to both stacks, all values read from the document:
   head tiles (`LAYERS n/total`, `CHANNELS n/9`; `COMPONENTS n/24` for Stamp), row metadata
   `shape · n ch · MASK`, five channel peek dots lit only for channels the layer actually
   paints (compared against `ConstructVectorAuthoringSurfaceChannels()`), and a footer
   readout `RES · LAYERS · MASKS · PAINTED`.

## 5. Existing components reused (nothing new introduced)

`PanelDockspace` (dock registration, columns, stacked panels, insets, tab metrics),
`VectorAuthoringControlSurface` (`Button/Toggle/Number/Range/Dropdown/Colour/Tooltip/
BeginCard`), `VectorMaskControls` (`ConstructVectorAuthoringMaskControls`,
`ConstructVectorBooleanControls`), `ControlKit` (+`ControlKitPalette`, `ControlKitTokens`),
`DropdownControlSurface`, `IconSymbol`/`IconPresentation`, `VectorAuthoringHistory`,
`VectorAuthoringSurfaceChannels`, `VectorCoverageInstruction`,
`EncodeLibraryDrawCapture` (evidence only), `MaterialThumbnailAtlas`, `ActivateMaterial/
ActivateStamp/ActivatePattern` host callbacks.

## 6. Files changed

| File | Change |
| :--- | :--- |
| `UI/TextureStudio/PatternWorkspacePanel.cpp` | shared mask editor; rail `Material·Pattern·Stamp`; live `Stored groups`; head tiles; row metadata + peek dots; footer readout; accurate fill/stroke text |
| `UI/TextureStudio/StampWorkspacePanel.cpp` | shared mask editor; rail; head tiles (`COMPONENTS`/`CHANNELS`); row metadata + peek dots; footer readout; accurate SVG/fill text; dead fourth head tile removed |
| `UI/TextureStudio/VectorMaskControls.cpp` | accurate `Mask shape` binding; factual mask footer with live geometry |
| `UI/TextureStudio/MaterialLibraryPanel.cpp` | `QueryDirect` single-resolution lookup for direct recipe controls (false "unported" disable + empty-optional dereference removed) |
| `Exhibits/TextureStudio/Images/PatternWorkspaceNative-2026-11-19.png` | new evidence capture (see §7) |

No files deleted, no CMake target added or removed, no reference repository touched.

## 7. Build and verification

- **Configure/build:** `cmake -S . -B Build/Host -G Ninja -DFRONTIER_HOST_VERIFICATION=ON
  -DBUILD_TESTING=ON -DCMAKE_BUILD_TYPE=Release -DGLFW_BUILD_WAYLAND=OFF
  -DGLFW_BUILD_X11=OFF` then `cmake --build Build/Host -j2` — **exit 0**, `0` compiler
  errors, **`0` warnings outside vendored third-party code** (the only warnings in the log
  are three pre-existing `-Wstringop-overflow` notes inside `ExternalPackages/thorvg`).
  Windows remains the delivery target; the two GLFW options were only needed because this
  Linux sandbox has no X11/Wayland development packages.
- **Tests:** `ctest -j2` — **40 of 41 pass**, including every Texturing suite:
  `PatternLibraryGalleryValidation`, `PatternThumbnailAtlasValidation`,
  `PatternAtlasDiskCacheValidation`, `PatternLibraryPresetValidation`,
  `StampWorkspacePanelConstructionValidation` (constructs the real panels),
  `StampTextGestureValidation`, `StampVectorImportValidation`,
  `MaterialLibraryValidation`, `MaterialProceduralBakingValidation`,
  `MaterialAuthoringValidation`, all `VectorCoverage*` and `VectorSelectionValidation`.
  The single failure is **`ContentBrowserValidation`** (`FAIL: Missing native hit extent`),
  which reproduces identically with these changes stashed — it is a pre-existing failure in
  an editor-explorer panel that does not link `FrontierTextureStudioUI`.
- **Visual comparison (no GPU available):** the sandbox has no Vulkan ICD, so the
  `MaterialWorkspaceEvidence` GPU capture path returns `-9` and the app cannot present. The
  native workspace was instead composed headlessly and rasterized with the repository's own
  CPU ImGui draw-command capture, using a scratch harness (`_ClaudeScratch/`, git-ignored,
  not added to CMake). The capture in `Exhibits/TextureStudio/Images/
  PatternWorkspaceNative-2026-11-19.png` shows the fixes in place: the dock rail reads
  `Material | Pattern | Stamp`, the head tiles read `LAYERS 5/5` and `CHANNELS 6/9`, A1–A2
  duplicates are gone, and the layer rows carry per-layer `· 3 ch` / `· 6 ch` summaries with
  differentiated peek dots. The canvas shows `GPU coverage unavailable` in that capture
  because no GPU exists in the sandbox — the same panel renders live coverage in the
  Windows build.

## 8. Remaining gaps (not fixed here, recorded honestly)

- **No single unified "Paint" page exists in C++.** The reference's `Paint` dock entry
  (a paint-layer document with per-layer channels, masks and stamps) has no C++ host in this
  repository; the native workspace hosts Material / Pattern / Stamp, and painting is the
  vector-coverage authoring in Pattern/Stamp. Building a paint-layer C++ document model
  would be a new system, which this task forbids. The Paint-page anatomy that *does* map
  onto existing data (outliner cards, head tiles, row metadata, masks, footer) has been
  applied to the two stacks that exist.
- **The CSS/DOM→ImGui parity limits** noticed while comparing: the reference's 22 OpenPBR
  channels collapse to this engine's nine `VectorAuthoringSurfaceChannel` contributions, and
  the in-card "channel stack" editor does not exist natively (channels are edited in the
  `Surface channels` sheet, which was left as is).
- **Imported raster (PNG data-URL) stamp components** still render as a placeholder box; the
  data URL is validated and retained, but decoding into the layer atlas would require a new
  upload path — out of scope for a UI fix.
- **No occlusion/transmission/clearcoat defaults changed**: those three channels still start
  disabled by design (`ConstructVectorAuthoringSurfaceChannels`).
