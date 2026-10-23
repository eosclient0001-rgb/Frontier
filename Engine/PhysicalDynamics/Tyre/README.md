# Tyre models

One contract, three interchangeable physics backends. See `TyreModel.h` for the seam and
`Docs/VehiclePort/PortReport.md` for status and evidence.

| Backend | Class | Physics | Cost (one tyre, 10 mm squash, 60 Hz) |
|---|---|---|---|
| `RigidTraceFan` | `Jolt/RigidTyreModel` | trace-fan contact + Pacejka MF6.1 | 0.06 ms |
| `XpbdSpringCarcass` | `Xpbd/XpbdSpringTyreModel` | configurable XPBD lattice (recovered `ff77585`) | 20.7 ms |
| `VolumetricFem` | `Fem/FemTyreModel` | tetrahedral FEM, first Piola–Kirchhoff | 840.8 ms |

Add a fourth model by adding an enumerator, a class deriving `TyreModel`, and one line in `TyreModelFactory.cpp`.
Nothing in the chassis, drivetrain, suspension or Jolt binding changes.
