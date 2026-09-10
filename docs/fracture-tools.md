# Painted 3D cell fracture

The default **Intact cracks · selectable pieces** workflow marks an irregular 3D Voronoi partition without subtracting seams. Rock stays joined and in place. Hairlines show the boundaries; only an explicitly selected piece is removed. This is an artist-controlled partition, not fracture mechanics or rigid-body destruction.

## Default workflow

1. Choose **Fracture** in the inspector section menu. Keep **Crack output → Intact cracks · selectable pieces**.
2. **Paint fracture region** on visible rock. Radius controls new samples; depth extends the painted capsule volume into the rock along the captured view direction. Painting is a preview only.
3. Set target chunk size, irregularity and seed. Smaller size produces more cells within the 64-site budget. **Hairline width** defaults to **14 mm** and changes surface marks, not physical openings.
4. **Mark cracks · keep intact** records the map and draws its hairlines. The GPU terrain, occupancy and loose-material inventory remain byte-for-byte unchanged. Live shape/cut modifiers are not baked by marking.
5. **Select piece**, click a marked cell, inspect the orange highlight, then **Remove selected chunk**. It can be selected while touching its neighbours; there is no need to cut a gap or release the painted boundary first. Only the selected mask is removed. A selection exceeding 65% of all solid cells needs an extra confirmation; an entire-body selection is refused.
6. **Undo last fracture edit** restores the previous terrain/material snapshot and map. Ordinary sculpting, erosion and regeneration invalidate this one-edit undo.

There is one active crack map. Marking a new map replaces the old selection map and hairlines, not previously deleted geometry. **Clear crack map** removes that metadata and its visual lines; Undo can restore the last clear. Pending paint remains separate and can be erased without affecting the committed map.

Marking never generates floating fragments or moves anything. Deliberately removing supporting rock can still leave an unsupported overhang/island: there is no gravity solve, and unselected pieces are never silently deleted. Existing wide gaps from an earlier destructive fracture are not filled by changing modes; Undo that edit if available, or regenerate the base (which clears destructive edits).

## How intact selection works

Deterministic jittered sites define 3D Voronoi cells inside the union of painted capsules. The nearest-site label supplies the selection boundary, not a thin subtraction field. The same sites and region are used by CPU selection and GPU hairline shading.

An explicit click picks the real GPU surface, reads the current GPU volume, and sends it to the worker. `selectIntactCell`:

- Requires the hit to lie inside the committed painted region.
- Identifies the closest site at that hit.
- Restricts conservative 26-neighbour flood fill to solid voxels belonging to that site **and** the painted region.
- Selects only the clicked connected island within that label, not every disconnected island sharing the same site.
- Includes only eligible, unshared surface fringe, protecting neighbours' occupancy.

It never selects from the worker's stale base volume. Only the returned mask is uploaded for highlighting/deletion. Selection is an explicit edit-time readback, not a per-frame/per-erosion CPU operation.

Deletion uses the existing WebGL2 mask subtraction and four distance-repair passes. Remaining occupancy and loose materials are preserved. Destructive removal bakes live objects as before; marking does not. Undo restores volume and map but is not a complete object/particle history.

## Other outputs (explicit opt-in)

- **Open gaps · destructive** retains the previous GPU Voronoi subtraction. Gap width is **0.8–2 m** because the approximately 0.36–0.39 m voxel grid cannot reliably separate bodies with microscopic geometric seams. Optional **Separate painted boundary** cuts around the region too. Both can detach chunks; use Intact cracks if this is unwanted. Selection then uses ordinary connected components.
- **Visual hairline network only** draws the 2–80 mm network without recording an independently selectable partition. Neither this output nor Intact cracks changes collision, occupancy or silhouette when applied.

Intact hairlines have an antialiased minimum visibility at distant views. This is screen coverage, not a widened physical gap. Width becomes more directly resolved as the camera approaches the surface.

## Bounds, persistence and cost

Up to 24 paint samples and 64 XYZ sites per map. Oversized requests increase site spacing across the region rather than truncate one end. Some sites may be in air; caves can split a cell into several pieces. Selection/removal remains voxel-limited, not an exact mesh Boolean.

Maps are world-space: later erosion/sculpting changes the rock but does not move the map. Regeneration clears it. Export stores the committed descriptor in `settings.cellFractureDetail`; `intact: true` identifies selectable intact maps. The site W component in the GPU pattern texture flags minimum hairline visibility; XYZ still contains the geometric sites. Removed pieces and open-gap cuts are in the baked volume. Downstream consumers must implement the matching map/shading semantics. There is no importer UI, automatic persistence or exported undo history.

Undo uses two RGBA32F atlas snapshots (~27.6 MiB), plus small map descriptors. The selection mask and worker eligibility mask are each roughly 0.86 MiB. Particle cargo is not reset by marking/deletion and is not part of this undo checkpoint.

## Verification

`tests/intact-fracture.test.js` covers no subtraction/boundary separation, independent touching-cell selection, exact input preservation, paint bounds, separate islands and invalid clicks. `tests/browser/intact-fracture.spec.js` verifies real GPU volume/material invariance, live modifiers remaining live, selective removal with unchanged neighbour occupancy/materials, exact undo, and the full default paint/mark/select/delete/undo workflow. The legacy open-gap and plane compatibility tests remain separate and passing.

### Selection-worker recovery

Selection replies are validated (typed mask, voxel count and matching selection statistics) before highlighting or deletion. If an older worker returns a volume instead of a mask for an intact-selection request, the client replaces it once, adopts the **current GPU snapshot**, and retries the same selection/map. Recovery never regenerates the terrain from a preset. Unknown worker operations now return explicit errors instead of falling through to a volume response. Invalid GPU masks clear the old selection; removal without a valid mask is refused before baking anything.

`tests/worker-selection.test.js` and the stale-worker variant of `tests/browser/intact-fracture.spec.js` cover the missing-mask error, bounded retry, state preservation, removal and exact undo.
