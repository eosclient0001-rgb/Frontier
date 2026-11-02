# Experimental

Requested prototypes, experimental HTML, scripts, styles, assets, and launchers belong together here. Do not place
reusable production code or permanent validation reports here. The approved C++ editor comparison mirror belongs in
`Exhibits/EditorMirror/`. Earlier prototypes are retained under
`Documentation/Plans/References/InheritedEngine/Prototypes/`; new prototypes belong here. Review launcher and asset
references before relocating anything.

## Experimental editor and tool hub

Start the shared browser portal with `python3 Experimental/Editors/Serve.py` from the repository root. The hub links to four standalone editors and four additional browser tools/exhibits.

- [Photometric Editor](Editors/PhotometricEditor/README.md) authors Type C IES, spot, point, area, directional,
  ambient, hemisphere, and image-based environment lighting.
- [Planetary Surface Studio](Editors/PlanetarySurfaceStudio/README.md) combines cited surface/elevation layers with
  clearly labelled AI-generated moon UV textures on interactive 3D bodies. Product coverage and display limits stay visible; it is not a
  native-resolution science/GIS tool.
- [Light Studio](Editors/LightStudio/README.md) authors Type C IES and spotlight distributions. Install its pinned Three.js dependency with `npm ci --prefix Experimental/Editors/LightStudio` before opening the 3D preview.
- [Fracture Editor](Editors/FractureEditor/index.html) is a standalone, single-page geometry specimen preview. It is not yet connected to project scene objects.
- [Alloy Texture Studio](TextureStudio/README.md) is a larger material/pattern/texture/stamp/baking application; the portal opens its bundled standalone build.
- [Project Browser](Project%20browser/README.md) is a file-browser prototype; its native hand-off is not connected.
- [Vehicle Proving Grounds](SlateReference/A/Exhibits/VehicleProvingGrounds/README.md) and [Illumination Host](SlateReference/B/Exhibits/IlluminationHost/README.md) are experimental WebGPU vehicle demos with integrated fracture tools, in addition to the standalone Fracture Editor. Before opening them, run `npm ci --prefix Experimental/SlateReference/A/Exhibits/VehicleProvingGrounds` and `npm ci --prefix Experimental/SlateReference/B/Exhibits/IlluminationHost`; a WebGPU-capable browser/adapter is required.
