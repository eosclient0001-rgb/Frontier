// Gas-only parameters and control ranges retained from the pinned upstream prototype.
export const RESOLUTION_OPTIONS = [
  {
    "value": 16,
    "label": "16³",
    "tilesX": 4,
    "tilesY": 4
  },
  {
    "value": 24,
    "label": "24³",
    "tilesX": 6,
    "tilesY": 4
  },
  {
    "value": 32,
    "label": "32³",
    "tilesX": 8,
    "tilesY": 4
  },
  {
    "value": 48,
    "label": "48³",
    "tilesX": 8,
    "tilesY": 6
  },
  {
    "value": 64,
    "label": "64³",
    "tilesX": 8,
    "tilesY": 8
  },
  {
    "value": 96,
    "label": "96³",
    "tilesX": 12,
    "tilesY": 8
  },
  {
    "value": 128,
    "label": "128³",
    "tilesX": 16,
    "tilesY": 8
  }
];

export const DEBUG_CHANNELS = [
  {
    "id": 0,
    "label": "Lit volume"
  },
  {
    "id": 1,
    "label": "Voxel DDA"
  },
  {
    "id": 2,
    "label": "Smoke density"
  },
  {
    "id": 3,
    "label": "Temperature"
  },
  {
    "id": 4,
    "label": "Fuel"
  },
  {
    "id": 5,
    "label": "Velocity"
  },
  {
    "id": 6,
    "label": "Vorticity"
  },
  {
    "id": 7,
    "label": "Pressure / irradiance"
  },
  {
    "id": 8,
    "label": "Cross-section"
  }
];

export const COLOR_PALETTES = [
  {
    "id": 0,
    "label": "Physical Planckian Blackbody"
  },
  {
    "id": 1,
    "label": "Cinema Napalm / Rich Hydrocarbon"
  },
  {
    "id": 2,
    "label": "Thermobaric White-Hot Ordnance"
  },
  {
    "id": 3,
    "label": "Wildfire / Copper Emerald Flame"
  },
  {
    "id": 4,
    "label": "Cherenkov Blue Plasma Core"
  },
  {
    "id": 5,
    "label": "Arcane Void Magenta / Corrupt Pyro"
  }
];

export const OBSTACLE_TYPES = [
  {
    "id": 0,
    "label": "None"
  },
  {
    "id": 1,
    "label": "Sphere"
  },
  {
    "id": 2,
    "label": "Vertical cylinder"
  },
  {
    "id": 3,
    "label": "Horizontal cylinder"
  },
  {
    "id": 4,
    "label": "Deflector slab"
  },
  {
    "id": 5,
    "label": "Tyre ring"
  }
];

export const ATLAS_MINIMAP_FIELDS = [
  {
    "id": 0,
    "label": "Smoke / temperature"
  },
  {
    "id": 1,
    "label": "Velocity"
  },
  {
    "id": 2,
    "label": "Vorticity"
  },
  {
    "id": 3,
    "label": "Pressure / irradiance"
  }
];

export const DEFAULT_PARAMS = {
  "gridResolution": 64,
  "pressureIterations": 22,
  "timeScale": 1,
  "paused": false,
  "macCormackAdvection": true,
  "enclosedBox": false,
  "voxelQuantization": 0,
  "autoGpuGovernor": false,
  "boundsWidth": 1.85,
  "boundsHeight": 2.1,
  "dynamicBounds": true,
  "dynamicBoundsMax": 1.55,
  "interactionMode": "orbit",
  "autoTurntable": false,
  "vorticityConfinement": 7.8,
  "buoyancy": 5.8,
  "smokeWeight": 1.15,
  "burnRate": 1.85,
  "burnHeat": 2.6,
  "sootGeneration": 1.55,
  "combustionExpansion": 4.4,
  "coolingRate": 1.35,
  "smokeDissipation": 0.18,
  "velocityDamping": 0.07,
  "turbulenceStrength": 3.5,
  "turbulenceScale": 3.8,
  "windX": 0.22,
  "windZ": 0,
  "emitterEnabled": true,
  "emitterRate": 1,
  "emitterRadius": 0.1,
  "emitterHeight": 0.07,
  "emitterUpwardVelocity": 3.2,
  "emitterSwirl": 1.2,
  "emitterTemperature": 3.5,
  "emitterFuel": 2.8,
  "emitterSmoke": 1.4,
  "blastStrength": 9.8,
  "blastRadius": 0.18,
  "blastTemperature": 5.4,
  "blastFuel": 4.6,
  "blastSmoke": 2.6,
  "blastLobes": 6,
  "shrapnelEnabled": true,
  "renderChannel": 0,
  "colorPalette": 0,
  "renderScale": 1,
  "raymarchSteps": 96,
  "shadowSteps": 6,
  "densityExtinction": 18.5,
  "smokeAlbedo": 0.22,
  "shadowDensity": 11.5,
  "fireIntensity": 5.6,
  "temperatureScale": 1.15,
  "internalScattering": 2.5,
  "phaseAnisotropy": 0.38,
  "ambientIntensity": 0.35,
  "sunIntensity": 2.2,
  "sunAzimuth": 42,
  "sunElevation": 52,
  "exposure": 1.25,
  "bloomIntensity": 0.55,
  "godRaysIntensity": 0.45,
  "shockwaveStrength": 1,
  "sliceAxis": 2,
  "slicePosition": 0.5,
  "obstacleType": 0,
  "obstacleX": 0.5,
  "obstacleY": 0.26,
  "obstacleZ": 0.5,
  "obstacleRadius": 0.16,
  "colliderAutoMove": true,
  "colliderSpeed": 1.25,
  "showBoundingBox": true,
  "showVoxelGridLines": true,
  "showActiveVoxelCells": false,
  "showFloorGrid": true,
  "showEmbers": true,
  "emberCount": 550,
  "emberSize": 1,
  "emberIntensity": 1.4,
  "emberLifetime": 1,
  "emberAshiness": 0,
  "showAtlasMinimap": true,
  "atlasMinimapField": 0
};

export const PRESETS = {
  "ue5_pyro_default": {
    "name": "UE5 Niagara Pyro Plume + Blast",
    "description": "Balanced hydrocarbon fireball with dynamic expanding bounds, ballistic shrapnel trails, and rolling dark soot.",
    "triggerExplosionOnLoad": true,
    "params": {
      "gridResolution": 64,
      "boundsWidth": 1.85,
      "boundsHeight": 2.1,
      "dynamicBounds": true,
      "shrapnelEnabled": true,
      "voxelQuantization": 0,
      "renderChannel": 0,
      "colorPalette": 0,
      "vorticityConfinement": 7.8,
      "buoyancy": 5.8,
      "smokeWeight": 1.15,
      "burnRate": 1.85,
      "burnHeat": 2.6,
      "sootGeneration": 1.55,
      "combustionExpansion": 4.4,
      "coolingRate": 1.35,
      "smokeDissipation": 0.18,
      "turbulenceStrength": 3.5,
      "emitterEnabled": true,
      "emitterRate": 1,
      "emitterRadius": 0.1,
      "emitterUpwardVelocity": 3.2,
      "emitterSwirl": 1.2,
      "emitterTemperature": 3.5,
      "emitterFuel": 2.8,
      "emitterSmoke": 1.4,
      "densityExtinction": 18.5,
      "smokeAlbedo": 0.22,
      "fireIntensity": 5.6,
      "internalScattering": 2.5,
      "godRaysIntensity": 0.45,
      "obstacleType": 0,
      "showEmbers": true,
      "showActiveVoxelCells": false
    }
  },
  "shrapnel_airburst": {
    "name": "Ordnance Shrapnel Airburst",
    "description": "High-explosive airburst ejecting 6 burning ballistic shrapnel fragments that arc through the 3D volume leaving smoke streamers.",
    "triggerExplosionOnLoad": true,
    "params": {
      "boundsWidth": 2.45,
      "boundsHeight": 2.55,
      "dynamicBounds": true,
      "shrapnelEnabled": true,
      "emitterEnabled": false,
      "colorPalette": 0,
      "vorticityConfinement": 8.8,
      "buoyancy": 5.2,
      "smokeDissipation": 0.12,
      "blastStrength": 11.5,
      "blastRadius": 0.19,
      "blastTemperature": 6.2,
      "godRaysIntensity": 0.65,
      "obstacleType": 0,
      "showEmbers": true,
      "showActiveVoxelCells": false
    }
  },
  "megaton_open_bounds": {
    "name": "Megaton Wide-Bounds Blast",
    "description": "Extra-large 3.0x simulation bounds with dynamic surge expansion so massive explosions and salvos have full room to mushroom.",
    "triggerExplosionOnLoad": true,
    "params": {
      "boundsWidth": 2.85,
      "boundsHeight": 2.95,
      "dynamicBounds": true,
      "shrapnelEnabled": true,
      "voxelQuantization": 0,
      "renderChannel": 0,
      "colorPalette": 0,
      "vorticityConfinement": 9.2,
      "buoyancy": 6.2,
      "smokeWeight": 1.2,
      "burnRate": 1.75,
      "burnHeat": 3,
      "sootGeneration": 1.9,
      "combustionExpansion": 5.8,
      "coolingRate": 1.2,
      "smokeDissipation": 0.11,
      "turbulenceStrength": 4.5,
      "emitterEnabled": false,
      "blastStrength": 13.5,
      "blastRadius": 0.18,
      "blastTemperature": 6.5,
      "blastFuel": 5.4,
      "blastSmoke": 3,
      "densityExtinction": 20,
      "smokeAlbedo": 0.26,
      "fireIntensity": 6.5,
      "internalScattering": 3,
      "obstacleType": 0,
      "showEmbers": true,
      "showActiveVoxelCells": false
    }
  },
  "low_gpu_performance": {
    "name": "Low-End GPU Fast Mode",
    "description": "Ultra-lightweight 24³ voxel grid (13.8K voxels) + 56 raymarch steps for reduced GPU cost; performance depends on the device.",
    "triggerExplosionOnLoad": true,
    "params": {
      "gridResolution": 24,
      "boundsWidth": 2,
      "boundsHeight": 2.2,
      "dynamicBounds": true,
      "pressureIterations": 14,
      "raymarchSteps": 56,
      "shadowSteps": 4,
      "renderScale": 0.85,
      "voxelQuantization": 0,
      "renderChannel": 0,
      "vorticityConfinement": 8.5,
      "buoyancy": 6,
      "showActiveVoxelCells": false
    }
  },
  "tactical_ordnance": {
    "name": "Tactical C4 / HE Blast Wave",
    "description": "High-explosive shockwave detonation with rapid divergence expansion, blinding flash core, and billowing dust/soot cloud.",
    "triggerExplosionOnLoad": true,
    "params": {
      "boundsWidth": 2.25,
      "boundsHeight": 2.4,
      "dynamicBounds": true,
      "shrapnelEnabled": true,
      "voxelQuantization": 0,
      "renderChannel": 0,
      "colorPalette": 2,
      "vorticityConfinement": 9.2,
      "buoyancy": 4.6,
      "smokeWeight": 1.3,
      "burnRate": 2.6,
      "burnHeat": 3.2,
      "sootGeneration": 2.1,
      "combustionExpansion": 6.5,
      "coolingRate": 1.75,
      "smokeDissipation": 0.14,
      "turbulenceStrength": 4.8,
      "emitterEnabled": false,
      "blastStrength": 12.5,
      "blastRadius": 0.2,
      "blastTemperature": 6.4,
      "blastFuel": 5.2,
      "blastSmoke": 3.2,
      "densityExtinction": 22,
      "smokeAlbedo": 0.34,
      "fireIntensity": 6.8,
      "internalScattering": 3.1,
      "obstacleType": 0,
      "showEmbers": true,
      "showActiveVoxelCells": false
    }
  },
  "oil_well_inferno": {
    "name": "Raging Oil Well Inferno",
    "description": "High-velocity pressurized fuel blowout generating a roaring flame column and dense carbonaceous black smoke.",
    "triggerExplosionOnLoad": false,
    "params": {
      "boundsWidth": 1.9,
      "boundsHeight": 2.4,
      "dynamicBounds": true,
      "voxelQuantization": 0,
      "renderChannel": 0,
      "colorPalette": 1,
      "vorticityConfinement": 8.8,
      "buoyancy": 7.2,
      "smokeWeight": 1.4,
      "burnRate": 1.6,
      "burnHeat": 3.1,
      "sootGeneration": 2.2,
      "combustionExpansion": 3.4,
      "coolingRate": 1.15,
      "smokeDissipation": 0.22,
      "turbulenceStrength": 4.2,
      "windX": 0.65,
      "emitterEnabled": true,
      "emitterRate": 1.45,
      "emitterRadius": 0.11,
      "emitterUpwardVelocity": 5.4,
      "emitterSwirl": 1.8,
      "emitterTemperature": 4.2,
      "emitterFuel": 3.6,
      "emitterSmoke": 1.9,
      "densityExtinction": 24,
      "smokeAlbedo": 0.12,
      "fireIntensity": 6,
      "internalScattering": 2.8,
      "obstacleType": 0,
      "showEmbers": true,
      "showActiveVoxelCells": false
    }
  },
  "obstacle_deflection": {
    "name": "Voxel Collider Flow Deflection",
    "description": "Demonstrates a 3D solid sphere collider inside the Eulerian grid—fire and smoke split and curl around the obstacle.",
    "triggerExplosionOnLoad": true,
    "params": {
      "boundsWidth": 1.85,
      "boundsHeight": 2.1,
      "colorPalette": 0,
      "vorticityConfinement": 8.4,
      "buoyancy": 6.4,
      "burnRate": 1.75,
      "combustionExpansion": 3.8,
      "coolingRate": 1.2,
      "smokeDissipation": 0.18,
      "emitterEnabled": true,
      "emitterRate": 1.25,
      "emitterRadius": 0.11,
      "emitterUpwardVelocity": 4.6,
      "obstacleType": 1,
      "obstacleX": 0.5,
      "obstacleY": 0.42,
      "obstacleZ": 0.5,
      "obstacleRadius": 0.16,
      "showActiveVoxelCells": false
    }
  },
  "wildfire_tornado": {
    "name": "Fire Tornado / Alchemical Vortex",
    "description": "High-swirl fire tornado with copper-emerald blackbody radiation and intense rotational vorticity.",
    "triggerExplosionOnLoad": true,
    "params": {
      "boundsWidth": 1.9,
      "boundsHeight": 2.3,
      "colorPalette": 3,
      "vorticityConfinement": 9.5,
      "buoyancy": 6.8,
      "burnRate": 1.7,
      "combustionExpansion": 3.5,
      "coolingRate": 1.25,
      "smokeDissipation": 0.2,
      "turbulenceStrength": 3.8,
      "emitterEnabled": true,
      "emitterRate": 1.3,
      "emitterRadius": 0.12,
      "emitterUpwardVelocity": 4.2,
      "emitterSwirl": 5.5,
      "emitterTemperature": 3.9,
      "emitterFuel": 3.2,
      "obstacleType": 0,
      "showActiveVoxelCells": false
    }
  },
  "ashfall_motes": {
    "name": "Ashfall / Grey Fireflies",
    "description": "A cooling afterburn cloud with dense grey ash motes instead of orange sparks—use the ember sliders to tune size, brightness, lifetime, and ashiness.",
    "triggerExplosionOnLoad": true,
    "params": {
      "emitterEnabled": false,
      "blastStrength": 7,
      "blastRadius": 0.2,
      "blastTemperature": 2.4,
      "blastFuel": 1.2,
      "blastSmoke": 3.8,
      "colorPalette": 1,
      "smokeDissipation": 0.08,
      "showEmbers": true,
      "emberCount": 900,
      "emberSize": 1.25,
      "emberIntensity": 0.95,
      "emberLifetime": 1.65,
      "emberAshiness": 1,
      "showActiveVoxelCells": false
    }
  },
  "voxelized_stylized": {
    "name": "Voxelized Stylized Grid",
    "description": "Explicit voxelized resolution look showing discrete 3D grid cells with quantized volumetric shading.",
    "triggerExplosionOnLoad": true,
    "params": {
      "voxelQuantization": 0.88,
      "renderChannel": 1,
      "vorticityConfinement": 8,
      "showActiveVoxelCells": true
    }
  }
};

export const CONTROL_GROUPS = [
  {
    "tab": "tab-grid",
    "title": "Dynamic World Bounds",
    "badge": "ADAPTIVE",
    "controls": [
      {
        "type": "toggle",
        "key": "dynamicBounds",
        "label": "Dynamic Auto-Expanding Blast Bounds"
      },
      {
        "type": "range",
        "key": "boundsWidth",
        "label": "Base Bounds Width X / Z",
        "min": 1,
        "max": 4,
        "step": 0.05
      },
      {
        "type": "range",
        "key": "boundsHeight",
        "label": "Base Bounds Height Y",
        "min": 1.2,
        "max": 4,
        "step": 0.05
      },
      {
        "type": "range",
        "key": "dynamicBoundsMax",
        "label": "Dynamic Blast Surge Multiplier",
        "min": 1.1,
        "max": 2.2,
        "step": 0.05
      }
    ]
  },
  {
    "tab": "tab-grid",
    "title": "3D Voxel Grid Resolution",
    "badge": "EULERIAN",
    "controls": [
      {
        "type": "select",
        "key": "gridResolution",
        "label": "Voxel Domain Dimensions",
        "options": [
          {
            "value": 16,
            "label": "16³",
            "tilesX": 4,
            "tilesY": 4
          },
          {
            "value": 24,
            "label": "24³",
            "tilesX": 6,
            "tilesY": 4
          },
          {
            "value": 32,
            "label": "32³",
            "tilesX": 8,
            "tilesY": 4
          },
          {
            "value": 48,
            "label": "48³",
            "tilesX": 8,
            "tilesY": 6
          },
          {
            "value": 64,
            "label": "64³",
            "tilesX": 8,
            "tilesY": 8
          },
          {
            "value": 96,
            "label": "96³",
            "tilesX": 12,
            "tilesY": 8
          },
          {
            "value": 128,
            "label": "128³",
            "tilesX": 16,
            "tilesY": 8
          }
        ]
      },
      {
        "type": "range",
        "key": "voxelQuantization",
        "label": "Voxel Quantization",
        "min": 0,
        "max": 1,
        "step": 0.01
      },
      {
        "type": "toggle",
        "key": "autoGpuGovernor",
        "label": "Auto Low-End GPU FPS Governor"
      },
      {
        "type": "toggle",
        "key": "showActiveVoxelCells",
        "label": "UE5 Sparse Voxel Octree Wireframe"
      },
      {
        "type": "toggle",
        "key": "showAtlasMinimap",
        "label": "Show Live 2D Tiled 3D Voxel Atlas PiP"
      },
      {
        "type": "select",
        "key": "atlasMinimapField",
        "label": "Voxel Atlas Minimap Channel",
        "options": [
          {
            "id": 0,
            "label": "State Atlas"
          },
          {
            "id": 1,
            "label": "Velocity Atlas"
          },
          {
            "id": 2,
            "label": "Vorticity Curl Atlas"
          },
          {
            "id": 3,
            "label": "Pressure & 3D Irradiance Atlas"
          }
        ]
      }
    ]
  },
  {
    "tab": "tab-grid",
    "title": "Navier-Stokes Pressure Solver",
    "badge": "POISSON",
    "controls": [
      {
        "type": "range",
        "key": "pressureIterations",
        "label": "Jacobi Pressure + Irradiance Iterations",
        "min": 6,
        "max": 48,
        "step": 2
      },
      {
        "type": "range",
        "key": "timeScale",
        "label": "Simulation Time Scale",
        "min": 0.1,
        "max": 2,
        "step": 0.05
      },
      {
        "type": "toggle",
        "key": "macCormackAdvection",
        "label": "MacCormack / BFECC Sharp Advection"
      },
      {
        "type": "toggle",
        "key": "enclosedBox",
        "label": "Closed Top/Side Domain Walls"
      }
    ]
  },
  {
    "tab": "tab-grid",
    "title": "3D Grid Cross-Section Slice",
    "badge": "DEBUG",
    "controls": [
      {
        "type": "select",
        "key": "sliceAxis",
        "label": "Slice Plane Axis",
        "options": [
          {
            "id": 0,
            "label": "X-Axis Slice"
          },
          {
            "id": 1,
            "label": "Y-Axis Slice"
          },
          {
            "id": 2,
            "label": "Z-Axis Slice"
          }
        ]
      },
      {
        "type": "range",
        "key": "slicePosition",
        "label": "Slice Plane Depth",
        "min": 0.05,
        "max": 0.95,
        "step": 0.01
      }
    ]
  },
  {
    "tab": "tab-pyro",
    "title": "Vorticity & Buoyancy Forces",
    "badge": "TURBULENCE",
    "controls": [
      {
        "type": "range",
        "key": "vorticityConfinement",
        "label": "Vorticity Confinement",
        "min": 0,
        "max": 14,
        "step": 0.1
      },
      {
        "type": "range",
        "key": "buoyancy",
        "label": "Thermal Buoyancy Lift",
        "min": 0,
        "max": 12,
        "step": 0.1
      },
      {
        "type": "range",
        "key": "smokeWeight",
        "label": "Soot Weight / Downward Drag",
        "min": 0,
        "max": 3.5,
        "step": 0.05
      },
      {
        "type": "range",
        "key": "turbulenceStrength",
        "label": "Sub-Grid Curl Noise Injection",
        "min": 0,
        "max": 8,
        "step": 0.1
      },
      {
        "type": "range",
        "key": "turbulenceScale",
        "label": "Turbulence Noise Frequency",
        "min": 1,
        "max": 10,
        "step": 0.1
      }
    ]
  },
  {
    "tab": "tab-pyro",
    "title": "Combustion & Thermodynamics",
    "badge": "EXOTHERMIC",
    "controls": [
      {
        "type": "range",
        "key": "burnRate",
        "label": "Fuel Reaction / Burn Speed",
        "min": 0.2,
        "max": 4.5,
        "step": 0.05
      },
      {
        "type": "range",
        "key": "burnHeat",
        "label": "Exothermic Heat Release",
        "min": 0.5,
        "max": 5,
        "step": 0.05
      },
      {
        "type": "range",
        "key": "sootGeneration",
        "label": "Combustion Soot / Smoke Yield",
        "min": 0.2,
        "max": 4,
        "step": 0.05
      },
      {
        "type": "range",
        "key": "combustionExpansion",
        "label": "Gas Divergence Expansion",
        "min": 0,
        "max": 10,
        "step": 0.1
      },
      {
        "type": "range",
        "key": "coolingRate",
        "label": "Stefan-Boltzmann Radiative Cooling",
        "min": 0.2,
        "max": 3.5,
        "step": 0.05
      },
      {
        "type": "range",
        "key": "smokeDissipation",
        "label": "Smoke Dissipation Rate",
        "min": 0.02,
        "max": 1.2,
        "step": 0.02
      },
      {
        "type": "range",
        "key": "windX",
        "label": "Crosswind Force X",
        "min": -2.5,
        "max": 2.5,
        "step": 0.05
      }
    ]
  },
  {
    "tab": "tab-raymarch",
    "title": "Volumetric Raymarcher",
    "badge": "PARTICIPATING MEDIA",
    "controls": [
      {
        "type": "select",
        "key": "renderChannel",
        "label": "Render Mode / Diagnostic Field",
        "options": [
          {
            "id": 0,
            "label": "Combined Lit"
          },
          {
            "id": 1,
            "label": "Voxelized DDA Cubes"
          },
          {
            "id": 2,
            "label": "Primary Density ρ"
          },
          {
            "id": 3,
            "label": "Temperature T"
          },
          {
            "id": 4,
            "label": "Fuel Core f"
          },
          {
            "id": 5,
            "label": "3D Velocity Vectors u"
          },
          {
            "id": 6,
            "label": "Vorticity / Curl Magnitude |∇×u|"
          },
          {
            "id": 7,
            "label": "Poisson Pressure & Irradiance p"
          },
          {
            "id": 8,
            "label": "3D Grid Cross-Section Slice Inspector"
          }
        ]
      },
      {
        "type": "select",
        "key": "colorPalette",
        "label": "Blackbody Radiation Palette",
        "options": [
          {
            "id": 0,
            "label": "Physical Planckian Blackbody"
          },
          {
            "id": 1,
            "label": "Cinema Napalm / Rich Hydrocarbon"
          },
          {
            "id": 2,
            "label": "Thermobaric White-Hot Ordnance"
          },
          {
            "id": 3,
            "label": "Wildfire / Copper Emerald Flame"
          },
          {
            "id": 4,
            "label": "Cherenkov Blue Plasma Core"
          },
          {
            "id": 5,
            "label": "Arcane Void Magenta / Corrupt Pyro"
          }
        ]
      },
      {
        "type": "range",
        "key": "raymarchSteps",
        "label": "Primary Raymarch Steps",
        "min": 32,
        "max": 160,
        "step": 4
      },
      {
        "type": "range",
        "key": "shadowSteps",
        "label": "Self-Shadow Light March Steps",
        "min": 3,
        "max": 12,
        "step": 1
      },
      {
        "type": "range",
        "key": "renderScale",
        "label": "Viewport Render Resolution Scale",
        "min": 0.5,
        "max": 1.25,
        "step": 0.05
      }
    ]
  },
  {
    "tab": "tab-raymarch",
    "title": "Pyro Emission & Scattering",
    "badge": "BLACKBODY",
    "controls": [
      {
        "type": "range",
        "key": "fireIntensity",
        "label": "Blackbody Fire Core Intensity",
        "min": 0.5,
        "max": 12,
        "step": 0.1
      },
      {
        "type": "range",
        "key": "bloomIntensity",
        "label": "3D Volumetric Fire Bloom / Glare",
        "min": 0,
        "max": 2,
        "step": 0.05
      },
      {
        "type": "range",
        "key": "godRaysIntensity",
        "label": "Crepuscular God-Ray Sun Shafts",
        "min": 0,
        "max": 1.5,
        "step": 0.05
      },
      {
        "type": "range",
        "key": "shockwaveStrength",
        "label": "Supersonic Blast Refraction Wave",
        "min": 0,
        "max": 2,
        "step": 0.05
      },
      {
        "type": "range",
        "key": "temperatureScale",
        "label": "Kelvin Temperature LUT Scale",
        "min": 0.4,
        "max": 2.2,
        "step": 0.05
      },
      {
        "type": "range",
        "key": "internalScattering",
        "label": "3D Internal Fire → Smoke Glow",
        "min": 0,
        "max": 6,
        "step": 0.1
      },
      {
        "type": "range",
        "key": "densityExtinction",
        "label": "Smoke Optical Extinction",
        "min": 4,
        "max": 40,
        "step": 0.5
      },
      {
        "type": "range",
        "key": "smokeAlbedo",
        "label": "Smoke Scattering Albedo",
        "min": 0.04,
        "max": 0.9,
        "step": 0.01
      },
      {
        "type": "range",
        "key": "shadowDensity",
        "label": "Self-Shadow Optical Thickness",
        "min": 2,
        "max": 25,
        "step": 0.5
      },
      {
        "type": "range",
        "key": "phaseAnisotropy",
        "label": "Henyey-Greenstein Silver-Lining",
        "min": -0.5,
        "max": 0.85,
        "step": 0.02
      },
      {
        "type": "range",
        "key": "sunElevation",
        "label": "Directional Sun Elevation",
        "min": 10,
        "max": 88,
        "step": 1
      },
      {
        "type": "range",
        "key": "sunAzimuth",
        "label": "Directional Sun Azimuth",
        "min": 0,
        "max": 360,
        "step": 2
      },
      {
        "type": "range",
        "key": "exposure",
        "label": "ACES Filmic Exposure",
        "min": 0.5,
        "max": 2.5,
        "step": 0.05
      }
    ]
  },
  {
    "tab": "tab-emitter",
    "title": "Continuous Fire Plume Emitter",
    "badge": "SOURCE",
    "controls": [
      {
        "type": "toggle",
        "key": "emitterEnabled",
        "label": "Enable Continuous Fuel/Fire Plume"
      },
      {
        "type": "range",
        "key": "emitterRate",
        "label": "Fuel & Heat Injection Rate",
        "min": 0.1,
        "max": 2.5,
        "step": 0.05
      },
      {
        "type": "range",
        "key": "emitterRadius",
        "label": "Nozzle / Burner Radius",
        "min": 0.05,
        "max": 0.25,
        "step": 0.005
      },
      {
        "type": "range",
        "key": "emitterUpwardVelocity",
        "label": "Jet Upward Velocity",
        "min": 0.5,
        "max": 8,
        "step": 0.1
      },
      {
        "type": "range",
        "key": "emitterSwirl",
        "label": "Vortex Swirl Impulse",
        "min": 0,
        "max": 8,
        "step": 0.1
      }
    ]
  },
  {
    "tab": "tab-emitter",
    "title": "Detonation / Explosion Generator",
    "badge": "BLAST",
    "controls": [
      {
        "type": "toggle",
        "key": "shrapnelEnabled",
        "label": "Eject 3D Ballistic Shrapnel Streamers"
      },
      {
        "type": "range",
        "key": "blastStrength",
        "label": "Radial Shockwave Velocity",
        "min": 2,
        "max": 18,
        "step": 0.25
      },
      {
        "type": "range",
        "key": "blastRadius",
        "label": "Fireball Detonation Radius",
        "min": 0.1,
        "max": 0.35,
        "step": 0.01
      },
      {
        "type": "range",
        "key": "blastTemperature",
        "label": "Detonation Core Temperature",
        "min": 2,
        "max": 9,
        "step": 0.1
      },
      {
        "type": "range",
        "key": "blastLobes",
        "label": "Cauliflower Lobe Frequency",
        "min": 2,
        "max": 12,
        "step": 0.5
      }
    ]
  },
  {
    "tab": "tab-emitter",
    "title": "3D Voxelized Solid Collider",
    "badge": "OBSTACLE",
    "controls": [
      {
        "type": "select",
        "key": "obstacleType",
        "label": "Collider Geometry Shape",
        "options": [
          {
            "id": 0,
            "label": "None"
          },
          {
            "id": 1,
            "label": "Moving / Interactive Sphere"
          },
          {
            "id": 2,
            "label": "Vertical Bridge Pier / Pillar"
          },
          {
            "id": 3,
            "label": "Horizontal cylinder"
          },
          {
            "id": 4,
            "label": "Deflector slab"
          },
          {
            "id": 5,
            "label": "Tyre ring"
          }
        ]
      },
      {
        "type": "range",
        "key": "obstacleY",
        "label": "Collider Altitude",
        "min": 0.2,
        "max": 0.78,
        "step": 0.01
      },
      {
        "type": "range",
        "key": "obstacleX",
        "label": "Collider Horizontal Offset",
        "min": 0.2,
        "max": 0.8,
        "step": 0.01
      },
      {
        "type": "range",
        "key": "obstacleZ",
        "label": "Collider Horizontal Offset",
        "min": 0.2,
        "max": 0.8,
        "step": 0.01
      },
      {
        "type": "toggle",
        "key": "colliderAutoMove",
        "label": "Animate collider"
      },
      {
        "type": "range",
        "key": "colliderSpeed",
        "label": "Moving Collider Speed",
        "min": 0.1,
        "max": 3,
        "step": 0.05
      },
      {
        "type": "range",
        "key": "obstacleRadius",
        "label": "Collider Size / Radius",
        "min": 0.08,
        "max": 0.28,
        "step": 0.005
      }
    ]
  },
  {
    "tab": "tab-emitter",
    "title": "Viewport Overlays & Embers",
    "badge": "SCENE",
    "controls": [
      {
        "type": "toggle",
        "key": "showBoundingBox",
        "label": "Show 3D Voxel Domain Wireframe"
      },
      {
        "type": "toggle",
        "key": "showVoxelGridLines",
        "label": "Show Voxel Resolution Cell Subdivisions"
      },
      {
        "type": "toggle",
        "key": "showFloorGrid",
        "label": "Show Lit Studio Floor + Volumetric Shadows"
      },
      {
        "type": "toggle",
        "key": "showEmbers",
        "label": "Show GPU-Advected Fireflies / Ash Motes"
      },
      {
        "type": "range",
        "key": "emberCount",
        "label": "Firefly / Ash Mote Count",
        "min": 0,
        "max": 1000,
        "step": 10
      },
      {
        "type": "range",
        "key": "emberSize",
        "label": "Firefly / Ash Mote Size",
        "min": 0.35,
        "max": 2.5,
        "step": 0.05
      },
      {
        "type": "range",
        "key": "emberIntensity",
        "label": "Firefly Brightness / Ash Visibility",
        "min": 0.1,
        "max": 3,
        "step": 0.05
      },
      {
        "type": "range",
        "key": "emberLifetime",
        "label": "Mote Lifetime / Drift Speed",
        "min": 0.25,
        "max": 3,
        "step": 0.05
      },
      {
        "type": "range",
        "key": "emberAshiness",
        "label": "Ashiness",
        "min": 0,
        "max": 1,
        "step": 0.01
      }
    ]
  }
];

export const createDefaultParams = () => structuredClone(DEFAULT_PARAMS);
