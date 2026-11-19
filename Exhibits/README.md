# Exhibits

Retain validation code, actual captures, and reproducible results here.

```text
<ValidationName>/
├── README.md   # Claim, reproduction steps, environment, revision, limitations
├── Code/       # Code producing retained results
├── Images/     # Actual captures when applicable
└── Results/    # Tables, reports, and measurements
```

Use technical names conforming to the naming skill. Do not create empty evidence placeholders.
`EditorMirror/` is reserved for the C++ editor UI comparison mirror; ordinary prototypes are Experimental.
Reuse production engine code rather than copy it. Do not claim a mirror proves native rendering parity.
See `Documentation/Rules/Evidence.md` at repository root.

## Current validation

- [Celestial atmosphere](CelestialAtmosphere/README.md): 32 actual Slang/Vulkan captures, Moon/Sun, six flares,
  six skies at surface/orbit and independent catalogue/ephemeris checks; experimental SwiftShader CPU scope.
- `ControlCentre/`: typography/theme interactions, downloaded font inventory, Windows package inspection.
- `UIFoundation/`: historical first-batch foundation, lifecycle, glyph, and CPU raster evidence.
