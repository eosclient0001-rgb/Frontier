# Vehicle inspector prototype

Experimental HTML for the vehicle slice of the editor inspector: the card vocabulary the user asked for
(**cards with units**, **coloured icons and text**, **editable curves**) applied to a vehicle and its tyres.

Status: **prototype, not the editor**. Nothing here is production C++ or a capture of the native editor.
The native records, inspector host and validation are described in `Exhibits/VehicleInspector/README.md`.

## Identity

| Item | Value |
|---|---|
| Design language | `Experimental/SlateReference/A/Exhibits/VehicleProvingGrounds/Style/FrontierEditor.css` (tokens, card, control, stat grid, chart metrics) |
| Reference pinned by the editor plan | `SultanAladin/Frontier` at `6afb6f0`, `Experimental/VehicleHmiPrototype` |
| Card vocabulary added here | stat grid with units, coloured value text, editable curve instrument |
| Font | DM Sans 300/400/500, converted from the retained `Style/Fonts/*.woff2` to WOFF2-in-place (no new font licence) |
| Numbers | `Frontier/Engine/Physics/ProjectDrive/*` and `Source/VehicleSpecification.js` — no invented figures |

## What the prototype shows

| Panel | Content |
|---|---|
| Outliner | Render / Environment / Forcefield / Objects / **Vehicle** / Effects groups, `ControlVehicle` with four tyres nested beneath it |
| Inspector · Vehicle | header, enabled pill, four property switches, and eight cards: Identity, Body & mass, Powertrain, Performance, Tyre set, Suspension, Curve editor, Audit |
| Inspector · Tyre | per-corner card: fitted/removed state, **Fit** / **Remove (pit stop)** buttons, compound, cold pressure, temperature, wear, grip, curve card |
| Curve editor | editable polyline on a grid: drag a point, add, select and delete, choose an X/Y field and unit, read the value readout; presets for torque, exhaust temperature, boost and grip |
| Units | every value carries its unit (`kg`, `m`, `Nm`, `rpm`, `kPa`, `°C`, `%`, `bar`, `K`); toggling **Imperial** re-labels the primaries and leaves the SI value in the sub-caption |

## Controls

| Action | Effect |
|---|---|
| Click an outliner row | selects it; the inspector rebuilds for that record |
| Drag a curve point | moves it (bounded by the curve's own field bounds, X kept monotonic) |
| Double-click empty plot | adds a point at that position |
| Click a point, then `Delete` | removes the point (a curve keeps at least two points) |
| Shift-click a point | shows its exact value; `Edit selected` opens the numeric field |
| `Fit` / `Remove` on a tyre card | removes the tyre from the vehicle (pit-stop) and refits it, restoring its stored specification |
| `Reset` on the curve card | restores the preset the curve was loaded from |

## Run

```sh
cd Experimental/VehicleInspector
python3 -m http.server 8080     # open http://localhost:8080/
```

No build step, no dependencies. `Tools/` holds the capture and cross-check scripts used for the exhibit.
