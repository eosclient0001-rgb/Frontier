# Noise landscapes → erosion

The studio starts with a **1 × 1 km noise-generated ridge landscape**, with one whole-terrain XYZ volume for erosion and sculpting. **New scene → Noise landscape** returns to this workflow. Empty local land plots remain available; the three fixed desert scenes and `?preset=0` selection are removed. See [kilometre workspaces](kilometre-workspaces.md).

## Workflow

1. Select the base object in the left outliner, then open **Object** if needed.
2. Choose **Mountain massif**, **Ridge range**, or **Rounded hills** in the right-hand properties.
3. Choose **Smooth / no noise**, **Fractal fBm**, **Ridged fractal**, **Ridged multifractal**, or **Billow**.
4. Set peak height, noise strength, feature wavelength and seed. **Fractal detail & footprint** exposes octaves, persistence, lacunarity, domain warp, width, length, heading and terraces.
5. Press **Generate landscape** and confirm replacement of the current base. Moving these new controls only edits a draft: it does not regenerate the volume or reset erosion by itself.
6. Press **Erosion →**, choose **Rain, Runoff, River, Wind, Rockfall or Chemical**, then use the header's **Run erosion**, or **Step** for one simulation iteration.

The Erosion shortcut warns when an unapplied draft exists. The header Erosion tab can still be used to work on the previously generated terrain. Export includes the applied settings, never the unapplied draft.

Generation replaces sculpting, erosion, fracture geometry and fracture maps. Existing live shapes and spline modifiers are reapplied through the existing rebuild lifecycle. Cancel leaves both the current volume and applied settings unchanged. This is not a general-purpose undo system; export before replacing an edited base.

## Controls and limits

| Control                    | Range                      |
| -------------------------- | -------------------------- |
| Footprint                  | 100–2,000 m per horizontal axis |
| Peak envelope              | 4–500 m                     |
| Noise displacement         | 0–120 m                      |
| Feature wavelength         | 2–400 m                     |
| Octaves                    | 1–5                        |
| Persistence                | 0.2–0.8                    |
| Lacunarity                 | 1.4–3.0                    |
| Domain warp                | 0–1.5                      |
| Heading                    | 0–180°                     |
| Terrace spacing / strength | 0.4–30 m / 0–1              |
| Seed                       | 1–99999                    |

The entire landscape uses **128 × 80 × 128** XYZ voxels, with **8.06 × 4.06 × 8.06 m** spacing at the default kilometre footprint. Width, length and height change the spacing. Landscape noise wavelengths below twice the largest voxel spacing are omitted. Peak height specifies the macro envelope; rounded hills, side peaks, noise, terracing and discretization can change the measured visible summit. Very strong noise can create undercuts or isolated small solids; there is no gravity-based collapse solver.

## Geometry, noise and performance

`src/noise-terrain.js` constructs bounded analytic solids: capped-cone mountain envelopes, a seeded three-peak ridge range, or an ellipsoidal hill. A finite bed roots the formation. XYZ density noise deforms the solid, including its flanks; this is **not a heightmap texture**, nor a vertical-only sculpting representation. Noise is stretched modestly along Y for geological structure and fades near the highest summit envelope. Terrain can subsequently be cut, sculpted or fractured anywhere in XYZ.

The scalar field is an approximate distance field after noise and non-uniform shaping, not a mathematically exact SDF. Conservative distance scaling supports the existing renderer and collision sampler. The default noise-landscape material is procedural neutral stone; the four Satmap palettes remain available. No terrain textures or external asset packs are used.

Generation runs once per explicit Generate action in the existing background worker. Parameters are normalized and the sampler is prepared once per volume, not once per voxel. It uses this project's seeded 3D lattice noise. Ridged multifractal combines squared inverted-absolute signals with previous-octave feedback; this is an independent implementation of the conventional approach described in Musgrave's reference and libnoise documentation, not an embedded external terrain engine. [1](https://engineering.purdue.edu/~ebertd/texture/1stEdition/musgrave/musgrave.c) [3](https://hackage-content.haskell.org/package/Noise-1.0.1/src/libnoise/noise/doc/html/classnoise_1_1module_1_1RidgedMulti.html)

**Erosion remains on WebGL2 GPU passes** across the complete terrain. Rain distribution and representative catchment follow the applied domain; SI hydraulic rate limits remain conservative. River transport requires an explicit drawn XYZ route; new landscapes start without water. This is an artist-guided preview, not an automatic drainage-network or calibrated hydraulic solver.

## Verification

See [current kilometre/local-detail checks](kilometre-workspaces.md#verification). Noise controls retain deterministic XYZ sampling, staged generation and applied-settings export.
