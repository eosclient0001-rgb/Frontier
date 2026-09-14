# Frontier

Realtime engine work. The active project here is **Project Zero**, which renders the full celestial port —
atmosphere, sun, sky, stars, moons, clouds, fog, wind, precipitation, rainbow, **lens flare** and tonemapping.

```sh
cd Projects/Project-Zero
make -j$(nproc)
cd bin && ./Project-Zero
python3 ../Diagnostics/CheckLensFlare.py
```

The lens flare and the cloud systems are the published reference celestial console
(<https://sultanaladin.github.io/Frontier-/celestial/>) transcribed expression for expression — not a
re-imagining. See [`Projects/Project-Zero/README.md`](Projects/Project-Zero/README.md) for the kernel-by-kernel
mapping and the numeric gate that keeps it faithful.

## Layout

| Path                      | What it is                                                        |
| ------------------------- | ----------------------------------------------------------------- |
| `Projects/Project-Zero/`  | the celestial stage: renderer, flare, clouds, diagnostics          |
| `DeviceExchange/`         | vector algebra, input, telemetry                                   |
| `GeometricRaster/`        | camera projection                                                  |
| `Tools/`                  | `PpmToPng.py`, for viewing rendered frames                         |
