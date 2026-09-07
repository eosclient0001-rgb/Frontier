# Project-Ocean v2

Differentiated realtime ocean: real spectra, accountable water, synchronous gameplay queries,
self-proving builds. See `CHARTER.md` (approach) and `MILESTONES.md` (plan).

## Run (O0)

```bash
# from repo root
python3 -m http.server 8000 --bind 0.0.0.0
# open http://<host>:8000/Projects/Project-Ocean/Source/
```

Requires a WebGPU browser (Chrome/Edge 113+, Firefox 141+, Safari 26).

## Controls

- Drag: orbit · wheel: zoom · wind slider: sea state (rebuilds waves live)
- Query string: `?wind=10` (2–22 m/s) `&auto=1` (auto-orbit) `&grid=224` (mesh segments)

## Layout

- `Source/index.html` — page + overlay UI
- `Source/OceanApp.js` — device, mesh, camera, loop, telemetry (no dependencies)
- `Source/Shaders/WaterSurface.wgsl` — vertex Gerstner placeholder + fragment stack v1
- `Source/Shaders/SkyBackdrop.wgsl` — gradient sky + sun fullscreen pass

## Verify (no GPU needed)

```bash
node --check Source/OceanApp.js   # syntax
node Tools/mathtest.mjs           # 39 assertions: projection, camera, waves, mesh
```

## Conventions

- No build step, no npm deps for the demo itself; GPU verification in a WebGPU browser
  (this sandbox blocks browser downloads, so headless screenshots run on your machine).
- `window.__ocean` exposes `{ ready, error, fps, ms, tris }` for headless checks.
- O1 replaces the vertex wave sum with FFT cascade sampling; the fragment stack stays.
