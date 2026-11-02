# Experimental

Requested prototypes, experimental HTML, scripts, styles, assets, and launchers belong together here. Do not place
reusable production code or permanent validation reports here. The approved C++ editor comparison mirror belongs in
`Exhibits/EditorMirror/`. Earlier prototypes are retained under
`Documentation/Plans/References/InheritedEngine/Prototypes/`; new prototypes belong here. Review launcher and asset
references before relocating anything.

## Experimental editor

Start the shared browser portal with `python3 Experimental/Editors/Serve.py` from the repository root.

- [Photometric Editor](Editors/PhotometricEditor/README.md) authors Type C IES, spot, point, area, directional,
  ambient, hemisphere, and image-based environment lighting.
- [Planetary Surface Studio](Editors/PlanetarySurfaceStudio/README.md) combines cited surface/elevation layers with
  clearly labelled AI-generated moon UV textures on interactive 3D bodies. Product coverage and display limits stay visible; it is not a
  native-resolution science/GIS tool.
