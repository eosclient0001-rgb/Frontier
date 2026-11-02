# Photometric Editor

Browser-based photometric asset authoring for Type C IES profiles and common scene-light sources. IES assets and light settings persist in browser storage. This prototype does not synchronize lights with the production C++ editor or serialize a native scene light.

## Run

From the repository root, install the pinned Three.js dependency and start the shared editor portal:

```sh
npm ci --prefix Experimental/Editors/PhotometricEditor
python3 Experimental/Editors/Serve.py
```

Open `http://localhost:5173/` for the editor index or visit `/Experimental/Editors/PhotometricEditor/` directly. The interactive preview loads the bundled environment maps from `EngineContent/EnvironmentArchives/`. A WebGL-capable browser is required.

Run all photometric and UI contract checks with:

```sh
npm test --prefix Experimental/Editors/PhotometricEditor
```

## Source types and outputs

- IES profiles: LM-63 Type C with `TILT=NONE`, one horizontal angle at 0°, and complete 0°–180° vertical coverage. Unsupported asymmetry, tilt, Type A/B, multi-plane and incomplete profiles are rejected rather than flattened.
- Spot sources use peak candela and inner/outer half-angles; the authored smooth distribution can be exported as Type C samples.
- Point sources use candela, rectangular-area sources use luminance in cd/m², and directional sources use illuminance in lux.
- Ambient and hemisphere fills are also available. These use relative renderer intensities, not calibrated photometric units.
- A separate environment-lighting card selects bundled Studio Softbox, Studio Strip, Window Light, Overcast, or Dark Studio images; environment intensity and rotation are adjustable. Image-based fill/reflections complement, but do not replace, direct lights for cast shadows.
- Numerical photometric curve and flux displays are computed from the authored axisymmetric data; point-source flux uses `4πI`.

## Viewport limits

The viewport uses Three.js standard materials, image-based environment lighting, inverse-square point/spot attenuation, profile-cookie projection for IES/spot sources, and shadow maps for point, spot, and directional lights. Rectangular area lights do not cast shadows in this WebGL renderer. The profile-cookie preview models only the forward hemisphere and clamps its cone below 90°; export retains the full IES 0°–180° distribution. Indirect transport, spectral response, measured fixture geometry, and calibrated display exposure are not implemented. Bundled environments are 8-bit PNGs without calibrated radiance. This is a real-time direct-light inspection scene, not a path-traced or photometrically calibrated renderer.
