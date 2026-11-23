# Inspector HTML-to-C++ Parity Port Plan

> **TL;DR**: Port every `ProjectZeroEditor` inspector exactly as the browser renders it, with no invented sections, to the native
> `Engine/Editor/Inspectors/` units. The method is: render the HTML, dump its exact geometry, rebuild it from the existing
> `Engine/Components/` primitives, and prove the result with side-by-side PNGs and a pixel-difference score. The current native
> sections that do not exist in the HTML (made up by the previous agent) are removed.

| Subject | Pin |
| :--- | :--- |
| HTML ground truth | `eosclient0001-rgb/Frontier` · `arena/d929ef36-frontier` · `Experimental/ProjectZeroEditor/` (served on `:8097`) |
| Native baseline | `eosclient0005-crypto/Frontier-` · `arena/6e2e878f-frontier` · `31d29a1`, imported here as `fab4b8f` |
| Capture size | `340 px` wide (same as the HTML `.dock.right`), full scroll length, device pixel ratio `1`, DM Sans |
| Native capture | `Exhibits/StandaloneInspectorsValidation` → `SoftwareRasterCanvas` (CPU raster of the ImGui draw lists) |

---

## 1. Locked Rules (Anti-Invention)

| # | Rule | Check |
| :---: | :--- | :--- |
| 1 | Only sections, rows, labels, icons, units and graphics that appear in the HTML screenshot | Each native section title appears in the HTML page DOM dump |
| 2 | Geometry comes from the DOM dump (`getBoundingClientRect` and computed style), never from eyeballing | Offsets and sizes are named constants that cite the HTML selector |
| 3 | Same icons: the SVG paths from `Inspectors.jsx` `Glyph`/`Icon` and lucide, decoded through `VectorIcons` | No substitute icons |
| 4 | Same graphics: port the HTML canvas or SVG formulas (`SkyDome`, `SunCards`, `MoonGlobe`, `environment-graphics`) | No placeholder art |
| 5 | Reuse `InspectorSectionPrimitives`, `ScalarSlider`, `CapsuleButton`, `ExclusiveSelector`, `DropdownSelector`, `TextInputField`, `PolarDirectionDial` | New primitives are added only for HTML patterns that repeat across inspectors |
| 6 | Each control writes the real native variable (`SolarCelestialConfiguration`, `AtmosphericMediumConfiguration`, …) | Linkage list per inspector (§4) |
| 7 | Honest proof: HTML PNG, native PNG and a difference PNG with the mismatched-pixel percentage | Remaining gaps are listed explicitly; nothing is reported as matching when it is not |

---

## 2. Execution Order

| Phase | Work | Output |
| :---: | :--- | :--- |
| 0 | Capture every HTML inspector page (`/tmp/pw/g3.cjs`) and dump its DOM geometry | `Exhibits/Images/StandaloneInspectors/HtmlReference/*.png` · `HtmlGeometry/*.json` |
| 1 | Build the Editor profile and capture the current native pages at full length | `Exhibits/Images/StandaloneInspectors/Native/*.png` |
| 2 | Shared chrome first, since every inspector uses it: dock tab header, heading (breadcrumb · title · eyebrow), page strip (`pc-strip`), section surface (`property-card`), quick-control tiles, Tags section, Notes section, slider row, metric readout | Primitive fixes in `InspectorSectionPrimitives` / `InspectorPanel` |
| 3 | Inspectors in registry order (§3); for each: remove invented sections → port the HTML sections → link the variables → proof | One commit per inspector |
| 4 | Comparison sheet per page: HTML · native · difference | `Exhibits/Images/StandaloneInspectors/Comparison/*.png` |

---

## 3. Inspector Ledger (Registry Order)

| # | Native inspector | HTML row(s) (`?inspect=`) | Status |
| :---: | :--- | :--- | :---: |
| 1 | `AtmosphereInspector` | `atmosphere` | 🔴 |
| 2 | `SolarInspector` | `sun` | 🔴 |
| 3 | `CloudInspector` | `clouds` | 🔴 |
| 4 | `LocalCloudInspector` | `local-cloud` | 🔴 |
| 5 | `LunarInspector` | `moon` | 🔴 |
| 6 | `StarfieldInspector` | `stars` | 🔴 |
| 7 | `WindInspector` | `wind` | 🔴 |
| 8 | `HeightFogInspector` | `height-fog` | 🔴 |
| 9 | `AtmosphericFogInspector` | `aerial-fog` | 🔴 |
| 10 | `LocalFogInspector` | `local-fog` | 🔴 |
| 11 | `GodRaysInspector` | `god-rays` | 🔴 |
| 12 | `PrecipitationInspector` | `precipitation` | 🔴 |
| 13 | `RainbowInspector` | `rainbow` | 🔴 |
| 14 | `CameraInspector` | `camera` · `cine` | 🔴 |
| 15 | `CameraSettingsInspector` | `camera-camera-settings` · `cine-camera-settings` | 🔴 |
| 16 | `LensFlareInspector` | `flare` | 🔴 |
| 17 | `MotionBlurInspector` | `motion-blur` | 🔴 |
| 18 | `PointLightInspector` | `reference-rim-point` · `reference-fill-point` | 🔴 |
| 19 | `SpotLightInspector` | `reference-key-spot` | 🔴 |
| 20 | `IesLightInspector` | `reference-ece-low-beam` · `reference-ies-downlight` | 🔴 |
| 21 | `AreaLightInspector` | `light` · `reference-softbox` | 🔴 |
| 22 | `TubeLightInspector` | `reference-studio-tube` | 🔴 |
| 23 | `LedLightInspector` | `reference-led` | 🔴 |
| 24 | `LedStripInspector` | `reference-led-strip` | 🔴 |
| 25 | `EnvironmentLightInspector` | `environment-light` | 🔴 |
| 26 | `PostProcessInspector` | `post` (+ `heat-shimmer`, `glitch`, `chromatic-aberration`, `film-grain`, `lens-distortion`, `scanlines`, `sharpen` effect rows) | 🔴 |
| 27 | `AnalyticPrimitiveInspector` | `cube` · `sphere` · `cylinder` · `torus` · `cone` | 🔴 |
| 28 | `NativeGeometryInspector` | to be assigned from the HTML geometry rows | 🔴 |
| 29 | `ImportedGeometryInspector` | to be assigned from the HTML geometry rows | 🔴 |
| 30 | `ProceduralGeometryInspector` | to be assigned from the HTML geometry rows | 🔴 |
| 31 | `FolderInspector` | `showcase` · `cameras` · `world` · `lighting` · `vehicles` | 🔴 |

📝 HTML rows that have no native inspector yet (`vehicle`, `offroad-vehicle`, `pickup-truck`) are captured for reference
only. They are not ported until a native owner exists or the user schedules them.

---

## 4. Variable Linkage (Filled Per Inspector)

| Inspector | HTML field (`ProjectZeroSpecification.js`) | Native variable | Unit |
| :--- | :--- | :--- | :--- |
| `SolarInspector` | `Manual azimuth` · `Manual elevation` | `SolarCelestialConfiguration` manual direction fields | `[°]` |
| … | filled as each inspector is ported | | |

---

## 5. Proof Format

| File | Content |
| :--- | :--- |
| `HtmlReference/<Row>-<NN>-<Page>.png` | Browser capture, `340 px` wide, full length |
| `Native/<Row>-<NN>-<Page>.png` | `SoftwareRasterCanvas` capture at the same size |
| `Comparison/<Row>-<NN>-<Page>.png` | HTML · native · difference, with the mismatched-pixel percentage in the file's sidecar `.txt` |

---

## 6. Progress Log

| Date | Step | Result |
| :--- | :--- | :--- |
| 2026-11-23 | Baseline import `fab4b8f` · Editor profile configured · fonts and packages prepared | 🟢 |
| 2026-11-23 | Phase 0 HTML capture started (Atmosphere 6 pages, Sun 5 pages first) | in progress |
