# FlorArc — procedural plant generator

Outliner · Viewport · Inspector for growing HQ procedural flora. Zero build step:
serve this folder over http and open `index.html` (three.js r160 is vendored in
`vendor/`, no CDN needed).

```sh
python3 -m http.server 8123   # then open http://localhost:8123/plants/
```

## What's inside

- **26 plants** in 5 categories — Grasses (8), Shrubs (7), Flowers (4), Weeds (4),
  Ferns (3). All smooth-shaded, indexed, welded geometry with vertex colours.
- **Texture atlas** — press `A`: a procedural 1024×512 PNG (32 cells: blades,
  leaves, petals, pinnae, bark, soil, berries…) with a JSON manifest. Both are
  downloadable from the modal and regenerate deterministically from seed.
- **Grow catalogue** (`Tab`) — tune seed / params / colours, then grow; double-click
  a tile to quick-grow. `+ add` (header) and per-category `+` (rail) grow instantly.
- **Inspector** — live parameter sliders rebuild the selected specimen in place
  (old mesh is disposed, never stacked).
- **Exports** — per-specimen `.obj` (baked vertex colours), whole-garden `.obj`,
  garden `.json` save/open, autosave to localStorage.
- **Command line** — `grow rose · seed test-99 · atlas · wire · solo · help …`

## Tests ( throwaway harnesses, not committed)

- `node /tmp/geotest.mjs` — every builder × default/min/max params: indexed,
  NaN-free, zero degenerate tris (78 checks).
- `node /tmp/uitest/run.mjs` — jsdom + real three.js: boot, catalogue, `+` buttons,
  atlas modal + manifest, param-edit duplicate regression, commands, keys (46 checks).
