# Frontier SDF — Erosion Model (v1)

GPU agents living in a 128×80×128 SDF volume. One fixed step (`dt = 1/60`)
runs five passes: **motion → event → scatter → apply → cargo**.

## Agents

| Kind | Spawn | Motion | Exchange |
|---|---|---|---|
| 0 Rain | random XZ, sphere-traced to surface | gravity, drag, surface slide + friction | capacity ∝ water·speed·slope; evaporates |
| 1 River | inlet disc, sphere-traced to surface | gravity + steer to downhill⊕downstream | high capacity, speed² scour, underwater dump |
| 2 Wind | upwind boundary band | relax to gusting wind + settling | windward abrasion × facing, lee deposition |
| 3 Thermal | random XZ **only if slope > repose** | ballistic + rolling + heavy friction | dislodge above repose, dump below |

Cargo per agent: sand / silt / gravel (world-volume units). Detached rock
converts to cargo by a per-kind product mix; deposition settles gravel first.

## No-infinite-holes guarantee

1. **Motion gate**: rain/river detach scales with `smoothstep(0.3, 1.0, speed)` —
   no flow means no shear, so bouncing in place removes nothing.
2. **Rest gate**: any particle with `rest > 0.15–0.3 s` detaches exactly zero.
   It can only deposit, then dump and sleep. This breaks the dig→fall→dig loop.
3. **Capacity clamp**: `detach ≤ max(0, capacity − load)`.
4. **Voxel clamp**: `detach ≤ 2%` of kernel solid mass; `deposit ≤ 3%` of void.
5. **Apply clamp**: surface moves ≤ 0.008 world units per step (≈¼ voxel per
   10 steps) and ≤ 20% of voxel mass per side — small controlled pieces only.
6. **Acceptance feedback**: volume-apply returns accept rates; cargo only books
   accepted mass (no phantom sediment).
7. **Rest → settle → sleep**: contact + slow ⇒ rest timer; `rest > 0.4 s` dumps
   all load at the contact; rested + (dry or clean) ⇒ slot sleeps until an
   emitter recycles it. Dry rain gives up 3× faster. Resting droplets freeze
   instead of jitter-cutting.
8. **Rate-limited emitters** + finite lifetimes (25–60 s) + boundary retirement.

## Volume channels

`R` signed distance (±3 band) · `G` deposited sediment (mass/voxel) ·
`B` wetness (25 s half-life) · `A` coarse fraction of deposit.
Boundary walls are re-enforced every apply pass; erosion can never breach the domain.

## Ledger

`rock-now + deposited + carried + outflow ≈ rock-initial`. Read via two
reduction passes + a 1 px readback. Outflow = load carried off-domain or
retired with age (reported, not hidden).

## Water coupling

Agents below the water plane get strong drag + buoyancy and dump load fast
(deltas). The baked flow field + sea shader + river ribbons are described in
`docs/requirements.md §4`. There is no pressure/free-surface solve — river
surfaces are trail ribbons, sea is a level plane with current advection.
