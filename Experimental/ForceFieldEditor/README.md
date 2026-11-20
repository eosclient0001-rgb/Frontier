# Frontier ForceField Studio (`Experimental/ForceFieldEditor`)

Standalone HTML + WebGL2 ForceField & Wind Studio built directly on the **Project-Zero / Frontier World Editor UI** shell (`#090909`–`#26262c` dark charcoal docks, trapezoidal top tabs, centered control notch, bottom generator drawer, Outliner + 3D WebGL2 Viewport + contextual Inspector).

## Capabilities

- **19 Canonical Force Laws** across three domains:
  - **VectorField (12):** `LinearWind`, `Buoyancy`, `RadialBurst`, `Attractor`, `Repulsor`, `AxisAttractor`, `Containment`, `RotationalColumn`, `Torque`, `Drag`, `LorentzField`, `MagneticDipole`
  - **FlowField (3):** `FlowStream`, `SplineForce`, `BoundaryAdhesion`
  - **TurbulenceField (4):** `CurlNoise`, `AtmosphericGust`, `VorticityConfinement`, `BrownianNoise`
- **Live 3D Flow Visualization (WebGL2 + Canvas2D HUD):**
  - RK2 advected **Flow Tracer Particles** with velocity-colored ribbon trails and bokeh heads
  - 3D **RK4 Streamlines** seeded around active forces
  - 3D **Velocity Vector Arrows** colored by speed, curl, divergence, or potential
  - Iso-contoured **Cross-Section Heatmap Slices** (`XY`, `XZ`, `YZ`, or `ALL`)
  - Translucent **Force Envelopes**, **Motion Path** orbits, and **3D Sample Probe** (`Shift+Click` to place)
  - Split **Perspective + Top (XY)** viewport mode and interactive **3D Transform Gizmo**
- **Force Generator Creation & Editing:**
  - `+ Add Force` modal (`Ctrl+A`) and bottom **Force Generators** drag-and-drop palette (`Ctrl+B`)
  - Attenuation curves (`Linear`, `InverseSquare`, `SmoothStep`, `None`), Duration modes (`Continuous`, `Modulated`, `Impulse`), Motion Path kinematics, and live **VectorFieldLang** custom formula overrides
  - `.ForceModel` and `.VectorFieldSpace` TOML import/export

## Running & Validating

```bash
# Run headless verification (19 laws, RK2 tracers, 3D overlays, TOML codec, DOM wiring)
node Experimental/ForceFieldEditor/ForceFieldValidation.mjs

# Serve standalone on 0.0.0.0:8094
python3 Experimental/ForceFieldEditor/Serve.py
```
