# Frontier — XPBD Real Metal Crumple

**Live Demo:** Vite dev server on port 5173 (preview link in UI)

This repo demonstrates **XPBD can do realistic metal / car crumple**, not just cloth.

Previous attempts behave like cloth because:
- High compliance (soft)
- Purely elastic constraints (rest length never changes)
- Low bending stiffness
- No yield surface

### What makes this metal?

This implementation implements **XPBD + Plasticity** (Müller et al. 2016 extended):

#### 1. Very low compliance = steel stiffness
```js
stretchCompliance = 1e-7  // ~200 GPa
bendCompliance = 2e-6
```
Cloth uses 1e-3 to 1e-4. Metal is 1000x stiffer.

#### 2. Yield surface + plastic flow
For each distance constraint:

```
C = |p_i - p_j| - rest
elasticStrain = C / rest
effectiveYield = yield0 + hardening * |plasticStrain|

if |elasticStrain| > effectiveYield:
    // PLASTIC FLOW - rest length permanently changes
    rest += ( |elasticStrain| - effectiveYield ) * plasticRate * rest * sign
```

Same for bending constraints (distance between opposite verts of shared edge).

Result: After impact, `rest` is updated → mesh **stays crumpled**. No rebound.

#### 3. Hardening
Yield increases as plastic strain accumulates → metal gets harder to deform further (strain hardening).

#### 4. Damping kills vibration
- velocityDamping = 0.995
- extra damping when yielding
- compliance is already dissipative in XPBD formulation

### Demos

**1 - Metal Sheet (default):** 22x22 grid, free on ground. Drag hammer (orange sphere) and drop. Sheet dents permanently, shows plastic heatmap (grey → orange → yellow).

**2 - Soda Can Crush:** Cylindrical shell with caps. Flat crusher plate comes down, buckles and folds like real can. Shows sharp plastic folds due to bending plasticity.

**3 - Car Body Crash:** Simplified car shell (BoxGeometry morphed to car shape, deduplicated, converted to XPBD shell). Car has initial velocity 7 m/s into concrete wall at x=3.5. Front crumple zone yields, folds, stays crushed. No elastic bounce-back.

**4 - Metal Ball:** Icosahedron shell, hammer impact.

### Controls
- Drag hammer with mouse
- Orbit: right-drag, scroll zoom
- R = reset, Space = drop, 1/2/3/4 = switch demo
- GUI: tune compliance, yield, plastic rate, hardening live

### Why not rebound like cloth?
Cloth XPBD: `rest` is constant → energy stored → springs back.

Metal XPBD: `rest` is stateful and evolves:
```
rest_{t+1} = rest_t + Δplastic
```
When load removed, C = |p_i-p_j| - rest_{new} ≈ 0 → no restoring force → stays deformed.

This is **exactly how real metal works**: elastic region (Hooke) then plastic region (dislocation flow). We model it as elastoplastic XPBD.

### Solver details
- `substeps = 12`, `iterations = 8` (Gauss-Seidel)
- Predict: `x_pred = x + v*dt + g*dt²`
- Solve: `Δλ = (-C - αλ) / ( Σ w|∇C|² + α )`, `α = compliance / dt²`
- Plasticity after solve
- Collisions: ground plane, sphere hammer, wall box
- Heatmap: per-particle avg |plasticStrain|

### Files
- `src/xpbd.js` - core solver with plasticity
- `src/mesh.js` - sheet/can/car/ball generators + trimesh → constraints
- `src/main.js` - Three.js scene, hammer, collisions, UI

### Run
```bash
npm install
npm run dev
```

### Can XPBD do a full car?
Yes. For production car:
- Use same shell approach but with real car CAD triangulated (10k-50k particles)
- Add separate parts (doors, hood) with breakable constraints
- Add tetrahedral volume constraints for engine block (rigid)
- Add self-collision via spatial hash (this demo uses only ground/wall/hammer for speed)
- Use strain-based tearing when plastic > maxPlastic

This demo proves the core: XPBD + plasticity = realistic permanent metal crumple, not cloth.

