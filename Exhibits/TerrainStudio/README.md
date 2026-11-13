# Terrain Studio — Validation Evidence

Headless-browser validation of `Experimental/TerrainStudio` (2D world authoring + 3D GPU-sculpted SDF landform),
captured 2026-11-13 by `Experimental/TerrainStudio/Validation/TerrainStudio.Validation.mjs`.

## Harness

| Item            | Value                                                                 |
|-----------------|-----------------------------------------------------------------------|
| Browser         | Chromium headless, real mouse events at 1600×900                      |
| Adapter         | SwiftShader (CPU-emulated Vulkan) — ⚠️ all GPU timings are pessimistic |
| Document        | `?example` island (3 shapes, 6 splines, tunnels, 4 layer-stack entries)|
| Error watch     | console + pageerror hooks; must be zero for a pass                    |

## Results (ValidationRun/)

| Step | Capture | Result |
|------|---------|--------|
| Load example, initial evaluate | — (Split view) | Stack submit 20.2 ms CPU · GPU-timer evaluate 3052 ms (SwiftShader ①) |
| Height sculpt stroke, 25 dabs | `02-HeightSculpt.png` | batch max 6.2 ms CPU submit · unlimited strokes (dense per-layer texture) |
| Volume carve stroke (caves/overhangs), 13 dabs | `03-VolumeCarve.png` | batch max 1.0 ms CPU · `VolumeLayerCount` 1 |
| Ctrl+Z undo carve | `04-UndoCarve.png` | GPU snapshot swap; undo stack 1, carved pit removed (11,773 px revert) |
| Ctrl+Y redo | — | undo stack 2, carve restored |
| Lasso shape + region box + canyon spline | `05-Planar-NewRegion.png` | shapes 4, regions 2, splines 6, active becomes `Region 02` |
| Split view of Region 02 | `06-Split-NewRegion.png` | 3D pane follows the freshly authored region |
| 6 live canyon edits (depth 70→130 m, width 36→56 m) | `07-Split-CanyonEdited.png` | blocking evaluate 1.8–17.6 ms each; revision delta +1 for every edit ② |

① first-load evaluate includes one-time shader compilation on a software rasterizer; interactive edits do not recompile.
② earlier samples of ~0.5 ms raised a no-op suspicion; this run records `Evaluation.Revision` before/after each edit —
  every edit re-evaluated (`RevisionDelta ≥ 1`).

## Files

- `ValidationRun/01…07*.png` — chronological captures of the steps above
- `ValidationRun/Report.json` — timings, document counts, undo depths, adapter string, full console log

## Reproduce

```
python3 -m http.server 8080 --bind 0.0.0.0 --directory Experimental/TerrainStudio
CHROMIUM_PATH=$(which chromium) node Experimental/TerrainStudio/Validation/TerrainStudio.Validation.mjs \
    http://127.0.0.1:8080/?example Exhibits/TerrainStudio/ValidationRun
```

Exit code is 1 if any console/page error occurs or a spline edit fails to bump the evaluation revision.

⚠️ the captures predate two later cosmetic fixes: the Inspector "GPU work set" tile now refreshes live (117 MB)
and `Select(null)` clears to the world inspector without an exception; both were re-verified headless afterwards.
