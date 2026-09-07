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

- Drag: orbit · wheel: zoom · panel groups: sea / sun / color / look (all live)
- Query string mirrors every control: `?wind=10&swell=1&chop=1.3&steep=0.65`
  `&sunEl=32&sunAz=206&sunI=1.15&deep=1c5266&sky=709ed6&hor=cfdee8&sun=fff3e0`
  `&glitter=1&foam=1&foamTh=0.78&haze=1&detail=0.55&expo=1&auto=1&grid=224`
- `steep` absent = auto from wind (until the slider is touched, then it overrides)

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
