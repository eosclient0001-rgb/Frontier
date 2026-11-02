# Photometric Editor verification

## Result

| Check | Result |
|---|---:|
| UI contract and source-mode tests | 3/3 passed |
| Photometric integration and IES format tests | 7/7 passed |
| Profile-cookie intensity/cutoff test | 1/1 passed |
| JavaScript syntax checks | Passed |
| Eight-link browser-tools hub, all standalone editor pages, runtime dependencies/assets | All checked routes returned HTTP 200 |
| Headless Chromium desktop smoke check | Photometric Editor viewport and canvas rendered; no console or request errors |

Tests cover absolute Type C IES import/export, candela multiplier decoding, malformed/asymmetric input rejection,
`4πI` point-source flux, smooth spot distributions, and generated IES-cookie attenuation. DOM checks cover seven
source modes (IES, spot, point, area, directional, ambient, and hemisphere), plus the environment map, intensity,
and rotation controls. Headless Chromium loaded the editor at 1,440 px with both viewport canvases rendered and no console or network-request errors.

## Reproduction

From the repository root:

```sh
npm ci --prefix Experimental/Editors/PhotometricEditor
npm test --prefix Experimental/Editors/PhotometricEditor
node --check Experimental/Editors/PhotometricEditor/app.mjs
node --check Experimental/Editors/PhotometricEditor/scene.mjs
python3 -m py_compile Experimental/Editors/Serve.py
python3 Experimental/Editors/Serve.py
```

Open `/` for the editor portal or `/Experimental/Editors/PhotometricEditor/` directly. Requirements: Node.js/npm for
the pinned Three.js package, Python 3, and a WebGL-capable browser for the interactive preview.

A headless Chromium smoke check confirmed the desktop page, canvases and bundled scene load. This does not validate photometric calibration or fixture accuracy; the lighting limitations below remain.

## Implementation boundary

The viewport uses Three.js standard materials, selectable bundled 8-bit environment maps, direct lights, inverse-square
point/spot attenuation, profile-cookie projection for IES and spot sources, and supported shadow maps. Ambient and
hemisphere fill intensities are renderer-relative, not calibrated lux/lumens. Rectangular area lights do not cast
shadows. IES values above 89.5° are preserved in export but clipped in the forward-hemisphere viewport. No indirect
transport, spectral response, measured fixture geometry, or calibrated radiance is implemented. The scene is not
path-traced or photometrically calibrated.
