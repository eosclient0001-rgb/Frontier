# Environment appearance follow-up

Reconstructed from the retained conversation on 2026-10-24; this is not recovery of the original missing document.
These are requested follow-ups; only the explicitly recorded checkpoint below is implemented and verified.

- Preserve the satisfactory Sun, lens flare and ordinary stars.
- Redo the blocky clouds and improve sky appearance.
- Improve the Milky Way, add appropriately licensed stellar catalogues, and deterministic extrasolar populations.
- Check dawn, sunset and the whitish horizon with actual native sequences.
- Add a rendered Moon: observer/time-based position, apparent size, topocentric parallax, phases, orientation,
  licensed surface content, moonlight, atmospheric extinction, cloud occlusion and consistent night exposure.
- Verify lunar rise/set and crescent/quarter/full phases. Eclipse and earthshine fidelity remain separate work.

The recovered `CelestialModel` already contains an approximate lunar-age/illuminated-fraction calculation.
That does not establish that a Moon disc, surface texture or moonlight is connected to the renderer.

## Executed cloud checkpoint — 2026-10-25

- Vulkan per-camera-ray volumetric clouds, a GPU cloud cube for indirect illumination and an observer-local
  Sun-transmittance factor are checked against native references. Clear/cloud/wind/3° low-Sun captures use the
  original ControlVehicle. Actual readbacks and numerical/device scope: `Exhibits/LightCompute/README.md`.
- Existing native Sun, flare and star paths are unchanged. CPU atmospheric precomputation remains; no GPU
  atmosphere, new star catalogue, lunar rendering or observer/time ephemeris is implied.
- Cloud appearance is not final: regular-march horizon structure, approximate isotropic ambient illumination,
  cube seams/resolution and spatial cloud shadows still need work. Dawn/night/rise-set sequences remain open.
