# Frontier

Frontier is an experimental vehicle-rendering and editor project. The browser-based WebGPU vehicle prototype and HMI studies live under [`Experimental/`](Experimental/README.md); they are deliberately separate from the native C++ editor.

## Browser prototypes

- [IlluminationHost — ReSTIR GI vehicle prototype](Experimental/IlluminationHost/README.md): reconstructed from the supplied patch into normal source, shader, asset and tool files. Run it with a static file server and WebGPU-capable browser.
- [Interactive vehicle HMI configurator](Experimental/interactive-vehicle-hmi-configurator/README.md): standalone React/Three.js design study.

The Garage application in IlluminationHost now applies the configurator's paint/finish choices to the live vehicle renderer and offers solid, ghost and wireframe views.
