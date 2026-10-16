# Experimental browser prototypes

These browser studies are separate from the native C++ editor. The ReSTIR/vehicle experience is currently a **JavaScript + WebGPU prototype**, not a C++ implementation.

| Prototype | Entry point |
| --- | --- |
| [IlluminationHost — ReSTIR GI vehicle prototype](IlluminationHost/README.md) | [IlluminationHost/index.html](IlluminationHost/index.html) |
| [Interactive vehicle HMI configurator](interactive-vehicle-hmi-configurator/README.md) | [interactive-vehicle-hmi-configurator/index.html](interactive-vehicle-hmi-configurator/index.html) |

IlluminationHost was reconstructed from `01a141bc-a4a3-72ce-8295-398724231feb.patch` into its proper source tree: `Source/`, `Shader/`, `Style/`, `Archive/` and `Tools/`. The patch file itself is not needed to run or work on the prototype. Its in-car Garage HMI now applies paint and gloss/matte materials to the live ControlVehicle, with Ghost and Wireframe viewing modes.

See [IlluminationHost/ROADMAP.md](IlluminationHost/ROADMAP.md) for the requested follow-up physics, tyre and VFX work.
