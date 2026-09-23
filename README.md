# Frontier · SDF Terrain Studio

A professional **3D Signed Distance Field (SDF) Terrain Studio** built with **Slate UI** and a physically coupled **GAEA-grade geomorphological erosion solver**.

Unlike 2.5D scalar heightmaps or simplistic bouncing particle droplets, Frontier operates directly on a **3D volumetric Signed Distance Field ($\Phi(x, y, z)$)** with 3D geological rock strata ($H(x, y, z)$), mass fraction accounting, and narrow-band Euclidean distance normalization.

---

## Geomorphological Erosion Physics (GAEA-Grade)

The erosion solver couples six fundamental geomorphic processes to generate razor-sharp alpine topography without blurring or single-pixel pitting:

```
TECTONIC MASSIF & 3D STRATA
           ↓
PRIORITY-FLOOD DRAINAGE GRAPH (Zero Sinks)
           ↓
STREAM POWER FLUVIAL INCISION + TRANSVERSE V-NOTCH GORGES
           ↓
ANGLE OF REPOSE THERMAL MASS WASTING + TALUS SCREE APRONS
           ↓
SEDIMENT CAPACITY COLLAPSE + ALLUVIAL FANS
           ↓
DIFFERENTIAL ROCK STRATA ETCHING (Benches & Mesas)
           ↓
MICRO-RILL & GULLY INCISION
           ↓
3D SDF VOLUMETRIC UPDATE & DISTANCE NORMALIZATION
```

### 1. Priority-Flood Downhill Drainage Routing
- Radix/Bucket Dijkstra priority flood routes continuous drainage across the entire landscape.
- Enclosed sink depressions are overtopped to their spillway threshold, eliminating artificial pothole traps.
- Multidirectional (MFD / D-Infinity) flow accumulation with coherent meander turbulence eliminates single-axis grid artifacts.

### 2. Stream Power Fluvial Incision & Transverse V-Gorges
- Fluvial incision follows the stream power law:
  $$\dot{E} = K \cdot A^m \cdot S^n \cdot \frac{1}{H(x, y, z)}$$
- **Transverse V-Shaped Valley Carving:** Downcutting in the river thalweg induces lateral bank carving within radius $R_{\text{valley}} \propto A^{0.35}$ following an authentic V-notch profile $\Delta h(r) = \Delta h_0 \cdot (1 - r / R)^{\gamma}$, forming steep-walled mountain canyons and knife-edge interfluve divides.

### 3. Angle of Repose Thermal Mass Wasting & Talus Aprons
- **Thresholded Mass Wasting:** Rock detaches *only* when local slope exceeds the critical rock angle of repose ($\theta_{\text{rock}} \approx 34^\circ - 38^\circ$):
  $$\Delta M = c_{\text{thermal}} \cdot (\tan\theta - \tan\theta_{\text{repose}}) \cdot \frac{1}{H}$$
- Detached debris travels down the steepest fall line and deposits on moderate slopes ($\le 30^\circ$) into authentic **Talus Cones and Scree Aprons**.
- **Zero diffusion on stable slopes:** Slopes below $\theta_c$ are never blurred, keeping knife-edge arêtes, aiguilles, and rock crags razor sharp.

### 4. Sediment Capacity & Alluvial Fans
- Yield-limited carrying capacity $C = K_c \cdot A^{0.6} \cdot (S + S_0)$.
- When steep mountain streams reach gentle valley bottoms or coastlines ($S$ drops $\implies Q_s > C$), the excess sediment dumps into expansive braided alluvial fans.

### 5. Differential 3D Rock Strata Etching
- 3D geological bedding planes with configurable dip and strike angles.
- Alternating hard sandstone/limestone ($H \approx 1.8-2.5$) and soft shale ($H \approx 0.3-0.7$) beds etch into stepped canyon amphitheaters, horizontal benches, and flat-topped mesas.

### 6. Multi-Scale Micro-Rills
- High-frequency tributary grooves along steep flanks feed the crisp GAEA-style branching visual detail.

---

## Slate UI Integration

Built strictly to the **Slate UI Design System** (`unassignedinbox/Slate`):
- **Design Tokens:** `--bg: #050505`, `--panel: #121212`, `--inset: #1a1a1a`, `--hi: #6c77ff`, `--ok: #22c55e`.
- **Top Control Centre Notch:** Quick execution (`Full Pipeline (Space/P)`, `Run Erosion (E)`, `Reset Camera (R)`, `Wireframe (W)`), Channel Preview selector, and status indicator.
- **Left Outliner Scene Graph:** Expandable hierarchy (`Terrain`, `Rock Strata`, `Erosion Stack`, `Water`, `Atmosphere`) with eye visibility toggles.
- **Right Property Inspector:**
  - *Mountain Massif:* Peak height, spine sharpness, octaves, warp amplitude, strata dip/strike, hardness contrast.
  - *GAEA Erosion Pass Stack:* Modular passes (`Fluvial`, `Thermal Talus`, `Strata Etch`, `Alluvial Fans`, `Micro Rills`), each with individual on/off controls, sliders, and **Simulate** buttons.
  - *Volumetric 3D Sculpting:* Live 3D brushes (`Raise`, `Lower`, `V-Gorge`, `Terrace`, `Cave`, `Smooth`) with `Shift + Click` in viewport.
  - *Materials & Splatmaps:* 6 Geological presets (*High Alpine Matterhorn*, *Badlands Red Rock*, *Volcanic Basalt*, *Glacial Fjord*, *Desert Mesa*, *Temperate Range*), snow line, water level.
  - *Geomorphology Diagnostics:* Live mass conservation ledger (Carved $\text{m}^3$, Deposited $\text{m}^3$, Net $\text{m}^3$), slope angle verification, valley V-profile confirmation.

---

## Verification & Raster Proofs

The built-in verification suite rasterizes high-resolution shaded relief maps, cross-section elevation curves, and numerical validations to `diagnostics/`:
- `diagnostics/terrain_shaded_relief.png`: High-res top-down shaded terrain relief.
- `diagnostics/valley_cross_section.png`: Transverse canyon cross-section profile demonstrating V-notch geometry.
- `diagnostics/geomorphology_report.json`: Quantitative geomorphic metrics (steep wall ratio, talus slope ratio, sharp ridge divide count, mass balance).

Run tests and verification:
```bash
npm test
```

---

## Run & Development

```bash
npm run dev        # Starts Vite on http://0.0.0.0:5173
npm run build      # Builds production bundle
npm run preview    # Runs production preview on http://0.0.0.0:5173
npm test           # Runs geomorphology test suite and updates raster proofs
```
