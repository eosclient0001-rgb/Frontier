# Terrain Studio baseline verification

The standalone web prototype in `Experimental Remastered` was imported from
`unassignedinbox/Frontier` commit `9331bf34e365f76cd10914f804207394b8a882ca`.
No subsequent commits from that branch were imported. It is not integrated into the
native Vulkan editor. The pinned baseline also contains existing spline/sculpt and
Clay Studio features; these are not new simulation work.

## Checks performed

- `node 'Experimental Remastered/TerrainWorldEditor/TerrainWorldValidation.mjs'`: 7/7 suites passed.
- `node 'Experimental Remastered/SdfSculptEditor/SdfSculptValidation.mjs'`: 9/9 suites passed.
- Standalone server started on port 8087; HTTP delivery checked.

These are headless model/codec tests, not interactive or rendered evidence. A browser,
WebGL rendering, export from the UI, performance at open-world scale, and physical GPU
behavior have **not** been verified in this environment. The baseline uses sampled 2D
mask distance fields and thin-slab terrain, not a general volumetric terrain simulator.
Erosion, weather, water simulation and texturing are outside this checkpoint.
