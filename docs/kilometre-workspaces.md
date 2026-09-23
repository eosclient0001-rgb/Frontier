# Whole-terrain kilometre volumes

The landscape is **one authoritative XYZ SDF**. There is no overview/detail composite, active-area rectangle, origin shift or inactive-patch cache. Generation, ray picking, sculpting, shapes, spline cuts, cell fractures, erosion, rain and water routes share world coordinates in metres.

## Resolution and bounds

A fixed **128 × 80 × 128** grid covers the complete requested terrain plus a small boundary margin. At the default **1,000 × 1,000 m** footprint, height 240 m and noise amplitude 45 m:

- Bounds: **[-516, -24, -516] → [516, 301, 516] m**.
- Actual voxel spacing: **8.0625 × 4.0625 × 8.0625 m**.
- Storage: 1,310,720 XYZ voxels in 2048 × 640 atlas textures. Tiles are Z slices, not a heightmap.

Changing width, length or height changes spacing independently on all three axes. The Object panel reports the applied bounds and spacing. Terrain sliders remain a draft until **Generate landscape** is confirmed. Camera framing and spatial tool ranges are refreshed after generation; live object coordinates remain world metres.

This deliberately chooses whole-world access over the former fine local resolution. Millimetre sediment grains, fine cracks and thin channels are **not resolved geometry**. Brush radii and shape/path defaults are sized to the grid. Noise octaves below twice the largest voxel spacing are omitted for the landscape. Intact/hairline fracture maps remain narrow visual seams until an actual selected piece is removed; destructive gaps disclose their coarser minimum width.

## Simulation and water

- WebGL2 GPU passes cover the entire SDF; normal erosion steps perform no CPU volume transfer.
- Rain samples X/Z across the terrain, locates the local uppermost SDF surface, then spawns in real air above it. It does **not** spawn at the distant world ceiling or directly on the ground. Gravity, first-impact latching, non-bouncing runoff, captured rain lifetime, evaporation and bounded deposition remain active.
- River water is **route-based**, not an automatic terrain-wide flood. Draw an XYZ route anywhere on the terrain. The renderer and river particles use the same points, elevations, width and direction. No route means no river emission.
- Wind enters the actual upwind boundary at the chosen world height; rectangular footprints are supported. Non-rain upper lifetime limits scale with domain spacing to permit longer travel; rain’s explicit lifetime/evaporation controls remain in seconds and are not scaled.
- Hydraulic coefficients and rates remain SI quantities. Coarse spatial resolution does not justify multiplying detachment without limit. At the default 5 mm/s aggregate ceiling, kilometre-view changes accumulate slowly. Use the ledger to inspect real exchange, and zoom in to see it; this is not calibrated CFD or geological time acceleration.
- The exchange kernel has a minimum support of 0.95 cell per axis and at most 3.8 cells. On anisotropic grids this produces an ellipsoidal support, ensuring complete normalized scatter/gather without unbounded neighborhoods. SDF distance repair uses anisotropic cell spacing.

## Export and resources

**Export terrain** contains the entire current XYZ SDF, dimensions, global bounds, voxel spacing and scene settings. It is not a fully resumable simulation checkpoint: particle state, loose-material atlases, flow history and live-modifier base are not included. Export metadata states these omissions.

A full RGBA32F atlas is 20 MiB; the solver keeps multiple terrain, material, history and scratch atlases. Grid memory remains bounded when terrain dimensions grow, but physical detail decreases. Empty land plots remain a separate small-volume modelling workflow and reset the domain and spatial tool scales accordingly.

Worker protocol 4 and genuinely versioned entry filenames reject stale local-volume workers. Startup has progress and bounded failure/recovery. No WebGPU or CPU erosion replacement is used.
