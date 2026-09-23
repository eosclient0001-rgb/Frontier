# Distributed adaptive XYZ refinement

**Status: connected to the live Hydraulic shaping workflow.** The former storage-only prototype is now used for particle collision, fine exchange, sediment/material feedback, rendering, GPU picking, checkpoints and version-3 terrain export. The diagnostic CSG sphere is not used as an erosion substitute.

See [Hydraulic shaping: implementation, tests and limits](hydraulic-shaping.md) for the current system.

## Representation

The complete kilometre-scale scene retains a coarse XYZ base. Fine, persistent 8³-node bricks are allocated at water contacts anywhere in the domain. Default spacing is 0.50 m; 0.25 m and 1.00 m options are available. No camera-centred or cyan active patch is used. Bricks store genuine XYZ field values and support caves/overhangs rather than a terrain height column.

Allocation uses the integer-hash table, bounded probing and exact high/low half-float claims introduced in the foundation. Fine erosion uses its own normalized gathers, GPU scatter, aggregate acceptance and cargo feedback. Incomplete contact footprints cannot erode: they do not silently fall back to the coarse brush. Existing details are never evicted to make space.

A boolean XZ occupancy mask is only an empty-space traversal accelerator. It contains no terrain heights; geometry still comes from XYZ bricks. Conservative ray stepping and screen-pixel hit tolerances keep fine deposition visible without forcing every ray through all empty bricks. GPU picking separately refines the final surface hit.

## Bounds

4,096 bricks are not enough to make every cubic metre of a kilometre landscape fine simultaneously. The current fine layer has a 4 m reference-SDF displacement limit and requires about 246 MiB additional GPU storage. The audit reports brick occupancy and unresolved contacts. Smaller cells fill the spatial budget sooner.

Manual tools continue to edit the base, with a world-space rebase of the fine deformation. Distant sculpting is tested not to erase fine cuts. Fine fracture connectivity, rigid-body collapse and unlimited deep valley excavation are not implemented. Workflow/resolution changes require explicit regeneration confirmation; export first to preserve a result.

The original standalone foundation tests remain useful, but they are no longer the sole evidence for fine erosion. Current tests exercise actual moving-water exchange, slow-flow deposition, image/pick changes, capacity backpressure and exact sparse export/checkpoint data.
