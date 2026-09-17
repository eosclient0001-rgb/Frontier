# Frontier — SDF Terrain Studio

Professional terrain generator that works **on the signed distance field itself** —
not on a mesh. A 100 m × 100 m test domain is generated as a multi-fractal
mountain, eroded with **particle hydraulic erosion on the SDF**, and textured
with five **splat-map** material channels: **flow · sediment · peak · pines · height**.

```
┌ generate ───────┐   ┌ erode ──────────────────┐   ┌ splat ──────────────────┐
│ multi-fractal   │   │ particle drops ride     │   │ weights → material      │
│ gradient noise  │ → │ −∇h on the implicit     │ → │ channels, detailed      │
│ + domain warp   │   │ surface d = z − h(x,y)  │   │ albedo bake + splat     │
│ + peak falloff  │   │ carves clamped to voxel │   │ debug texture           │
└─────────────────┘   └─────────────────────────┘   └─────────────────────────┘
```

## Run

```bash
npm install        # three.js
npm start          # serves the app on http://localhost:8123
npm test           # engine smoke test (Node, no browser needed)
```

Open the served page — the full pipeline auto-runs (generate → erode → bake).

## How it works

### 1 · Generation — multi-fractal gradient noise
Perlin **gradient noise** is stacked as fBm and a **ridged multi-fractal**
(mixable via *Ridged mix*), warped by a low-frequency **domain warp** for
swirling crests, then shaped by a radial **peak falloff** so one dominant
summit forms. The result is an implicit surface: the zero set of the SDF

```
d(x, y, z) = z − h(x, y)
```

### 2 · Hydraulic erosion — SDF particles, no mesh
Particles (rain drops) spawn on the implicit surface and move along **−∇h**
(steepest descent of the SDF). Each step:

* **capacity** `C = K · water · (0.12 + 2.4·slope)`
* `load < C` → **erode**: bilinear carve into the field, clamped to
  `cutVoxels · cell`
* `load ≥ C` → **deposit**: bilinear splat, clamped to `depVoxels · cell`
* slope > *slope limit* → talus behaviour (deposit, don't erode)
* moving uphill / leaving the domain → dump load, drop dies

**Voxel resolution and cut depth are coupled by construction:** the maximum
carve per step, the maximum deposit per step and the particle travel distance
are all expressed in **voxel units** and converted to metres with the current
grid spacing — change the grid resolution and the erosion increments scale
with it (the live readout under *02 · Hydraulic Erosion* shows the exact
metres). After the drops, an optional **mass-waste** pass (slope-limited
diffusion) rounds the crests.

### 3 · Splat maps — five material channels
Per voxel the pipeline measures:

| channel  | source                                  | material            |
|----------|-----------------------------------------|---------------------|
| flow     | particle flow-accumulation (wetness)    | wet mud / channels  |
| sediment | deposited-sediment map                  | silt / sand fans    |
| peak     | height band (upper slope)               | bare granite        |
| pines    | gentle slope × mid elevation × dry      | pine canopy         |
| height   | remaining lowland                       | grassland           |

Weights are normalised, then a **detailed albedo** is baked per pixel
(micro-noise speckle, strata, curvature AO, slope-based bedrock exposure) and
a splat debug texture (R flow · G sediment · B peak · A pines) is kept for the
viewport *Splat view* toggle and the minimaps.

## Layout

```
index.html            app shell
css/app.css           professional dark UI
js/terrain-core.js    engine: noise · generation · erosion · splats (Node + worker)
js/terrain-worker.js  Web Worker wrapper (zero-copy buffer transfers)
js/main.js            three.js viewport, UI wiring, minimaps, HUD
test/smoke.js         Node engine tests (npm test)
```
