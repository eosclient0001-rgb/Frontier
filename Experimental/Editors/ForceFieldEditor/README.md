# Force Field Debugger prototype

Start `python3 Experimental/Editors/EditorDemos/Serve.py` from the repository root, and open the Force Field Debugger from the launch page or the General Purpose Editor's WindEditor drawer. The debugger is independent: it does not read or write the General Purpose Editor's wind state or runtime engine data. Its authored fields persist in browser local storage only.

The evaluator is adapted from the General Purpose Editor's upstream HTML wind prototype (`WindSpecification.js` from Frontier- revision 5102470cc319a12d436c767865d995dc0fa009ae). It describes horizontal wind on an XZ plane, not a 3D Navier–Stokes or aerodynamic simulation. The 3D option projects that 2D plane; it is not a volume. Directional wind can be bounded with a smooth XZ radial falloff; other types remain bounded in this model. Color scale is user-selected and clamped; speed uses m/s, components use signed m/s, and divergence and vertical vorticity use finite differences in 1/s. No pressure, geometry interaction, rain, foliage, or engine solver telemetry is sampled.

Triggers and zone entry are simulated with buttons on the preview timeline; they do not bind C++ events or gameplay volumes. Pause, scrub and fire to examine the preview. These limitations mean this is not yet an engineering-validated engine debugger.
