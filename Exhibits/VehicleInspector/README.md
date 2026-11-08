# Vehicle inspector — HTML prototype, native records, and evidence

The vehicle card set requested for this stretch: **the inspector first, in HTML**, before any engine-side editor work.
It adds a vehicle to the scene with no extra modelling geometry (chassis primitives only) and with four tyres parented to it,
each of which can come off and go back on at a pit stop. Curves (engine torque, tread temperature, and the other authored
tables) are editable, so the same inspector can define a custom vehicle.

> **The images in `Images/` are reconstructions, not screenshots.** No headless browser could be installed in this
> environment (no `libnss3`/`libgbm`, package mirrors unreachable), so each figure is the prototype's own drawing code run
> through an SVG → PNG rasterizer (`Tools/RenderFigures.mjs`, `@resvg/resvg-js`). Same geometry, same tokens, same fonts as
> the page — but the layout was composed by the figure renderer, so spacing may differ from the live page by a pixel or two.
> `Images/StageNativePlanView.png` is different again: it is a **host CPU plan-view drawn from the compiled records by the
> native validation program**, not by either the page or a GPU renderer.

## Run the inspector

```bash
cd Experimental/VehicleInspector/Tools
npm ci
npm test                      # 24 model checks (node --test)
node InspectorValidation.mjs  # 45 DOM checks (jsdom)
node RenderFigures.mjs        # rewrites Exhibits/VehicleInspector/Images/*
```

Then serve it — the page needs an HTTP origin, because ES modules do not load from `file://`:

```bash
cd Experimental/VehicleInspector && python3 Tools/Serve.py      # 0.0.0.0:8080, no-store
```

The page is self-contained: relative module scripts, local `Style/Fonts/*.woff2`, no network fonts or CDNs, so it also runs
inside a restricted preview iframe.

## What the page contains

| Figure | Page element | Contents |
| --- | --- | --- |
| `VehicleInspectorShell.png` | Full editor shell | SceneDirectory outliner, floating inspector panel, stage, session settings |
| `VehicleInspectorCards.png` | The eight vehicle cards | Identity, dimensions, mass & balance, powertrain, tyres, aero, session, actions |
| `TyreInspector.png` | Tyre card, expanded | Four corner rows with pressure/temperature/wear, compound picker, grip curve |
| `TyreFitted.png` | Tyre card, fitted state | The compact per-corner readout |
| `CurveEditor.png` | Curve instrument | Editable key list + plot, add/remove/drag, unit-aware axes |

Card rules taken from `SourceImages/General UI`: dark floating cards on a near-black stage, a large light metric with a small
dimmed unit beside it, and colour-coded icons and units — mass, length, torque, pressure, thermal, rate, fraction each get
their own colour. Every number in the page carries its unit; imperial equivalents are derived, never authored twice.

## Native records

`Frontier/Engine/Scene/VehicleRecords.{h,cpp}`:

- `VehicleRecord : RecordEntry` — classification `Vehicle`; owns the authored `Vehicle::VehicleGeometry`, the engine and
  turbocharger parameters, and four `TyreSheet`s. It registers a `RecordEditorDescription` (8 scalar rows, 2 switches) so the
  existing `SceneInspectorPanel` can draw it, and it owns its curves (`Engine.TorqueCurve`, `Engine.TemperatureCurve`).
- `TyreRecord : RecordEntry` — classification `Tyre`, holds a `VehicleRecord &` and a corner index. A tyre owns no state of its
  own: it is a view onto `Vehicle.Tyres[Corner]`. Its editor description carries pressure (kPa), tread temperature (°C) and wear
  (%), all bound to the vehicle's sheet so an edit on the tyre row and the corner row are the same write.
- `PitBayTyre` — a removed tyre, kept in the vehicle's fixed-capacity pit bay (8 slots). Removal zeroes the hub's pressure and
  drops it to ambient; refit returns the most recently removed tyre for that corner, or a fresh one at the axle's cold
  pressure when the bay has none.
- `EvaluateTyreGrip` / `QueryTyreCompounds` — the presentation geometry of the grip rule (optimum 353.15 K → 1.0, fade
  473.15 K → 0.60, 20 % over-pressure → 0.94, floor 0.25) and the four compound presets.

Editing units: the record stores what the inspector shows — °C and percent — and computes the physical K / 0..1 forms
(`SurfaceK()`, `WearFraction()`) rather than keeping a second copy that can drift. Front weight is stored as a percent and
aligned onto `Geometry.FrontWeightFraction` by `AlignGeometrySheet()`; the powertrain sheet is aligned onto the engine and
turbo by `AlignPowertrain()`. `RecordEditorScalarField` gained a `FloatTarget` so engine geometry (float) can be bound
directly instead of being copied into the inspector model.

## Results

| Report | Result |
| --- | --- |
| `Results/InspectorValidation.txt` | 45 / 45 DOM checks |
| `Results/ModelValidation.txt` | 24 / 24 model checks |
| `Results/NativeRecordValidation.txt` | all native checks passed (see below) |

The native program (`Code/VehicleInspectorValidation.cpp`) proves the record layer end to end: geometry derived from sockets,
the DefaultGTR torque curve interpolated at the redline, peak power banded at the redline (344.82 kW against the 393.4 kW a
full-table integration would claim), four tyre records parented under the vehicle in the `SceneDirectory`, editor
descriptions reached through the directory exactly as the inspector host reaches them, an edit through a bound field
reaching the record, the pit-stop lifecycle including a full bay and the fresh-tyre path, the grip rule, the powertrain
sheet alignment, the outliner/inspector projection, and a plan-view frame whose hash changes when a tyre comes off or the
track widens and returns exactly when every tyre is refitted.

### Build

```bash
g++ -std=c++20 -DFRONTIER_EDITOR_PROFILE=1 -Wall -Wextra -Werror -IFrontier -I. \
    -o vehicleinsp Exhibits/VehicleInspector/Code/VehicleInspectorValidation.cpp \
    Frontier/Engine/Scene/{RecordStore,RecordEntry,SceneDirectory,VehicleRecords}.cpp \
    Frontier/Engine/Physics/ProjectDrive/Drivetrain.cpp \
    Frontier/Engine/Interface/SceneDirectoryPanel.cpp \
    Frontier/Engine/Diagnostics/{LogRingStore,LogCategories,LogStream}.cpp -lpthread
./vehicleinsp VehicleStage.ppm
```

`CMakeLists.txt` builds the same target (`cmake` was not available in this environment; the direct `g++` line above is what
produced the recorded results).

## Known limits

- **No viewport frame.** The stage figures are the page's 2D plan view and the native PPM. No GPU renderer, editor viewport,
  ImGui window or Jolt body was created or observed; the inspector has not been drawn by `SceneInspectorPanel` in a running
  editor.
- `RecordEditorDescription` still has **no curve field**, so the torque and temperature curves can only be edited in the HTML
  prototype. Adding one is the next engine-side step.
- The native records are not yet registered by `FrontierMain.cpp`; only the validation program constructs them.
- Renames due before any port: the prototype's `Draw`/`Spawn` names and the control-table `Get`/`Set` keys do not follow
  `SKILL-Naming.md`.
