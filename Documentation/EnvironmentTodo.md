# Environment appearance follow-up

Reconstructed from the retained conversation on 2026-10-24; this is not recovery of the original missing document.
These are requested follow-ups; only the explicitly recorded checkpoint below is implemented and verified.

- Preserve the satisfactory Sun, lens flare and ordinary stars.
- Redo the blocky clouds and improve sky appearance.
- Render cloud-shadowed light shafts and illuminated fog, not only ground shadows or a constant-colour overlay.
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
  cube seams/resolution and finite-Sun penumbrae still need work. Dawn/night/rise-set sequences remain open.

## Spatial cloud-shadow continuation — 2026-10-25

- Surface and secondary-hit Sun extinction replaces the observer-wide lighting factor. Exact/clustered,
  reservoir/spatial reuse, non-Solar-source preservation and wind-history refresh are checked. Four actual
  ControlVehicle/ground wind captures accompany the native-reference results in `Exhibits/LightCompute/README.md`.
- Fixed the omitted ambient RGB upload from the first cloud checkpoint and strengthened its uniform-medium
  check to require nonzero incident radiance. Updated cloud images must be generated from corrected readbacks.
- Regular cloud stepping, the flat slab, indirect cube seams, physical GPU/Windows acceptance and Moon remain open.

## Shadowed fog and light-shaft checkpoint — 2026-10-25

- Added camera-path single scattering with cloud and geometry visibility, point/IES/spot and directional
  illumination, analytic camera/light optical depth and source-to-surface fog extinction. Earlier cloud density
  was reused, not replaced by a new shape model. Legacy analytic colour fog alone was not enough for shafts.
- Actual 320×200 comparisons and native checks are in `Exhibits/LightCompute/README.md`: broken-cloud soft shafts,
  the original ControlVehicle and local-light cones. Preserve both lighting paths and existing celestial code.
- Remaining: sampling bands/aliasing, temporal fog reconstruction, full inter-bounce/coupled media transport,
  emissive-volume scattering, multiple scattering, physical GPU/Windows acceptance and final sky appearance.
