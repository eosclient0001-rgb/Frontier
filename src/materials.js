/**
 * Procedural PBR Material Presets & Satellite SatMap Biome Library
 * 
 * Defines 12 authentic satellite biomes (SatMaps) inspired by USGS, Landsat, and Sentinel
 * orbital earth imagery, with distinct rock/strata color palettes, multi-spectral macro
 * variation tints, physically-differentiated PBR micro-roughness values, and water optics.
 */

export const MATERIAL_PRESETS = {
  highAlpine: {
    name: "High Alpine Matterhorn",
    region: "European Alps (Granite & Glacial Firn)",
    description: "Rugged granite arêtes, snowfields, jagged talus aprons, sparse alpine grass",
    colors: {
      rock: [0.32, 0.31, 0.33],        // Granite bedrock
      rockSecondary: [0.20, 0.20, 0.22], // Dark basalt veins
      strata: [0.48, 0.45, 0.42],      // Quartzite & limestone bands
      talus: [0.38, 0.36, 0.35],       // Angular granite scree
      sediment: [0.48, 0.45, 0.42],    // Valley gravel wash
      dirt: [0.26, 0.22, 0.17],        // Alpine peat soil
      grass: [0.22, 0.38, 0.14],       // Emerald alpine moss & turf
      grassDry: [0.42, 0.44, 0.22],    // Golden highland thatch
      snow: [0.96, 0.97, 1.00],        // Fresh alpine snow
      snowIce: [0.55, 0.78, 0.95],     // Glacial blue ice
      waterShallow: [0.15, 0.48, 0.62], // Crystal turquoise meltwater
      waterDeep: [0.06, 0.18, 0.34],   // Deep alpine lake navy
    },
    macroSatMap: {
      mineral: [1.15, 1.05, 0.95],
      vegetation: [0.85, 1.25, 0.75],
      moisture: [0.80, 0.90, 1.05],
    },
    roughness: {
      rock: 0.72,
      talus: 0.95,
      dirt: 0.88,
      grass: 0.64,
      sediment: 0.80,
      snow: 0.42,
    },
    sunElevation: 42.0,
    sunAzimuth: 135.0,
    skyColor: [0.45, 0.62, 0.85],
    groundBounceColor: [0.22, 0.20, 0.18],
    fogDensity: 0.0025,
    fogColor: [0.55, 0.65, 0.78],
  },

  badlands: {
    name: "Badlands & Grand Canyon",
    region: "Colorado Plateau (Sedimentary Strata)",
    description: "Terracotta and ochre sedimentary strata, carved V-gorges, dry sandy washes",
    colors: {
      rock: [0.72, 0.38, 0.22],        // Navajo terracotta sandstone
      rockSecondary: [0.52, 0.24, 0.14], // Dark ironstone layers
      strata: [0.88, 0.58, 0.34],      // Warm ochre siltstone ledges
      talus: [0.68, 0.40, 0.26],       // Red sandstone rubble
      sediment: [0.82, 0.68, 0.50],    // Buff riverbed sand
      dirt: [0.58, 0.34, 0.20],        // Baked red clay
      grass: [0.44, 0.46, 0.24],       // Desert sagebrush & scrub
      grassDry: [0.62, 0.55, 0.32],    // Arid straw grass
      snow: [0.94, 0.94, 0.96],
      snowIce: [0.75, 0.80, 0.88],
      waterShallow: [0.42, 0.36, 0.24], // Silt-laden shallow wash
      waterDeep: [0.22, 0.18, 0.12],   // Muddy brown canyon river
    },
    macroSatMap: {
      mineral: [1.35, 0.95, 0.75],
      vegetation: [0.90, 1.10, 0.70],
      moisture: [0.95, 0.75, 0.60],
    },
    roughness: {
      rock: 0.82,
      talus: 0.96,
      dirt: 0.92,
      grass: 0.74,
      sediment: 0.85,
      snow: 0.48,
    },
    sunElevation: 35.0,
    sunAzimuth: 215.0,
    skyColor: [0.65, 0.62, 0.68],
    groundBounceColor: [0.38, 0.24, 0.16],
    fogDensity: 0.002,
    fogColor: [0.78, 0.68, 0.58],
  },

  volcanicBasalt: {
    name: "Volcanic Basalt & Obsidian",
    region: "Icelandic Ridge (Basalt & Neon Moss)",
    description: "Jet-black basalt crags, obsidian scree, vibrant Icelandic emerald moss",
    colors: {
      rock: [0.13, 0.13, 0.15],        // Jet black basalt
      rockSecondary: [0.06, 0.06, 0.08], // Obsidian glass crags
      strata: [0.28, 0.18, 0.14],      // Oxidized red lava crust
      talus: [0.16, 0.16, 0.18],       // Volcanic cinders
      sediment: [0.20, 0.19, 0.20],    // Black volcanic sand
      dirt: [0.14, 0.13, 0.12],        // Ash loam
      grass: [0.14, 0.56, 0.10],       // Vivid Icelandic emerald moss
      grassDry: [0.30, 0.42, 0.16],    // Olive lichen
      snow: [0.96, 0.97, 0.99],
      snowIce: [0.48, 0.75, 0.92],
      waterShallow: [0.12, 0.48, 0.55], // Volcanic thermal spring turquoise
      waterDeep: [0.04, 0.12, 0.20],   // Deep oceanic fjord
    },
    macroSatMap: {
      mineral: [1.20, 0.80, 0.70],
      vegetation: [0.70, 1.45, 0.60],
      moisture: [0.65, 0.85, 1.10],
    },
    roughness: {
      rock: 0.55,                      // Polished basalt/obsidian glassy sheen
      talus: 0.94,
      dirt: 0.92,
      grass: 0.58,
      sediment: 0.82,
      snow: 0.38,
    },
    sunElevation: 28.0,
    sunAzimuth: 160.0,
    skyColor: [0.40, 0.48, 0.58],
    groundBounceColor: [0.12, 0.12, 0.14],
    fogDensity: 0.0035,
    fogColor: [0.45, 0.52, 0.60],
  },

  glacialFjord: {
    name: "Glacial Fjord & Cirque",
    region: "Norwegian Fjordland (U-Valleys & Glaciers)",
    description: "Deep carved U-valleys, hanging cliffs, turquoise glacial lakes, moraine till",
    colors: {
      rock: [0.34, 0.36, 0.38],        // Slate grey bedrock
      rockSecondary: [0.24, 0.26, 0.28], // Gneiss shadow bands
      strata: [0.48, 0.50, 0.48],      // Quartzite & dolomite veins
      talus: [0.38, 0.39, 0.40],       // Glacial moraine scree
      sediment: [0.46, 0.50, 0.48],    // Glacial rock flour till
      dirt: [0.26, 0.24, 0.20],        // Peat & humus
      grass: [0.18, 0.44, 0.16],       // Wet fjord moss & scrub
      grassDry: [0.36, 0.42, 0.22],    // Arctic tundra grass
      snow: [0.96, 0.98, 1.00],        // Glacier firn
      snowIce: [0.38, 0.72, 0.94],     // Luminescent turquoise glacier ice
      waterShallow: [0.18, 0.65, 0.72], // Luminescent glacial turquoise
      waterDeep: [0.08, 0.35, 0.48],   // Deep emerald fjord water
    },
    macroSatMap: {
      mineral: [0.95, 1.05, 1.15],
      vegetation: [0.75, 1.30, 0.70],
      moisture: [0.70, 0.95, 1.20],
    },
    roughness: {
      rock: 0.68,
      talus: 0.92,
      dirt: 0.88,
      grass: 0.62,
      sediment: 0.76,
      snow: 0.32,
    },
    sunElevation: 48.0,
    sunAzimuth: 120.0,
    skyColor: [0.50, 0.68, 0.88],
    groundBounceColor: [0.25, 0.28, 0.28],
    fogDensity: 0.003,
    fogColor: [0.60, 0.72, 0.85],
  },

  desertMesa: {
    name: "Desert Mesa & Sand Dunes",
    region: "Sahara & Monument Valley (Sandstone & Dunes)",
    description: "Horizontal hard capstones, stepped canyon benches, expansive red sand washes",
    colors: {
      rock: [0.78, 0.44, 0.26],        // Navajo red sandstone
      rockSecondary: [0.56, 0.30, 0.16], // Shadow sandstone
      strata: [0.94, 0.68, 0.38],      // Golden sandstone capstones
      talus: [0.72, 0.46, 0.30],       // Desert scree
      sediment: [0.90, 0.74, 0.52],    // Expansive sandy washes
      dirt: [0.64, 0.40, 0.26],        // Sandy red loam
      grass: [0.46, 0.48, 0.26],       // Desert sagebrush
      grassDry: [0.66, 0.58, 0.34],    // Bleached desert grass
      snow: [0.94, 0.94, 0.96],
      snowIce: [0.75, 0.80, 0.88],
      waterShallow: [0.22, 0.58, 0.52], // Desert oasis spring
      waterDeep: [0.10, 0.26, 0.28],   // Oasis deep pool
    },
    macroSatMap: {
      mineral: [1.40, 1.05, 0.70],
      vegetation: [0.95, 1.15, 0.65],
      moisture: [1.10, 0.80, 0.60],
    },
    roughness: {
      rock: 0.80,
      talus: 0.95,
      dirt: 0.90,
      grass: 0.76,
      sediment: 0.84,
      snow: 0.46,
    },
    sunElevation: 55.0,
    sunAzimuth: 190.0,
    skyColor: [0.70, 0.72, 0.82],
    groundBounceColor: [0.42, 0.28, 0.18],
    fogDensity: 0.0018,
    fogColor: [0.82, 0.74, 0.65],
  },

  temperateAlpine: {
    name: "Temperate Alpine Forest",
    region: "Rocky Mountains (Limestone & Pine)",
    description: "Lush forest valleys, clear streams, limestone crags, rich humus soil",
    colors: {
      rock: [0.42, 0.42, 0.44],        // Grey limestone
      rockSecondary: [0.28, 0.28, 0.30], // Dark chert
      strata: [0.54, 0.52, 0.48],      // Hard dolomite beds
      talus: [0.44, 0.43, 0.42],       // Scree slope
      sediment: [0.56, 0.50, 0.44],    // River pebble beds
      dirt: [0.22, 0.16, 0.12],        // Rich forest topsoil
      grass: [0.16, 0.46, 0.12],       // Lush mountain pasture
      grassDry: [0.36, 0.42, 0.20],    // Meadow thatch
      snow: [0.96, 0.97, 1.00],
      snowIce: [0.60, 0.80, 0.92],
      waterShallow: [0.10, 0.45, 0.55], // Clear alpine brook
      waterDeep: [0.04, 0.20, 0.32],   // Mountain lake deep blue
    },
    macroSatMap: {
      mineral: [1.05, 1.05, 1.00],
      vegetation: [0.70, 1.40, 0.65],
      moisture: [0.75, 0.90, 1.05],
    },
    roughness: {
      rock: 0.76,
      talus: 0.92,
      dirt: 0.86,
      grass: 0.60,
      sediment: 0.78,
      snow: 0.38,
    },
    sunElevation: 50.0,
    sunAzimuth: 140.0,
    skyColor: [0.48, 0.66, 0.90],
    groundBounceColor: [0.20, 0.22, 0.16],
    fogDensity: 0.0028,
    fogColor: [0.65, 0.75, 0.86],
  },

  icelandicTundra: {
    name: "Icelandic Tundra & Caldera",
    region: "Vatnajökull & Highlands (Basalt & Sulfur)",
    description: "Charcoal basalt bedrock, sulfur oxidized veins, chartreuse spongy moss, dark peat",
    colors: {
      rock: [0.16, 0.16, 0.18],        // Charcoal basalt
      rockSecondary: [0.08, 0.08, 0.10], // Obsidian
      strata: [0.38, 0.32, 0.16],      // Sulfur oxidized veins
      talus: [0.20, 0.20, 0.22],       // Volcanic cinders
      sediment: [0.22, 0.21, 0.22],    // Black outwash sand
      dirt: [0.16, 0.14, 0.12],        // Dark peat soil
      grass: [0.22, 0.60, 0.12],       // Spongy chartreuse moss
      grassDry: [0.34, 0.46, 0.20],    // Olive tundra lichen
      snow: [0.95, 0.97, 1.00],        // Fresh ice cap snow
      snowIce: [0.45, 0.76, 0.94],     // Glacial ice
      waterShallow: [0.14, 0.55, 0.64], // Cyan meltwater
      waterDeep: [0.04, 0.14, 0.24],   // Deep oceanic blue
    },
    macroSatMap: {
      mineral: [1.30, 1.10, 0.60],
      vegetation: [0.80, 1.50, 0.55],
      moisture: [0.60, 0.80, 1.15],
    },
    roughness: {
      rock: 0.60,
      talus: 0.93,
      dirt: 0.90,
      grass: 0.56,
      sediment: 0.80,
      snow: 0.36,
    },
    sunElevation: 32.0,
    sunAzimuth: 170.0,
    skyColor: [0.42, 0.52, 0.64],
    groundBounceColor: [0.14, 0.16, 0.14],
    fogDensity: 0.0032,
    fogColor: [0.48, 0.55, 0.64],
  },

  dolomitesKarst: {
    name: "Dolomites Pale Karst Spire",
    region: "Italian Alps (White Dolomite Limestone)",
    description: "Stark white dolomite limestone peaks, warm buff cliff faces, limestone scree fans",
    colors: {
      rock: [0.58, 0.56, 0.54],        // Bright dolomite limestone
      rockSecondary: [0.36, 0.35, 0.36], // Chert shadows
      strata: [0.68, 0.62, 0.54],      // Warm buff rock beds
      talus: [0.56, 0.54, 0.52],       // Pale limestone scree
      sediment: [0.62, 0.58, 0.52],    // Pale gravel wash
      dirt: [0.32, 0.28, 0.22],        // Light mountain loam
      grass: [0.20, 0.48, 0.14],       // Subalpine meadow
      grassDry: [0.46, 0.48, 0.22],    // Larch gold thatch
      snow: [0.96, 0.97, 1.00],        // Pristine snow
      snowIce: [0.62, 0.82, 0.94],     // Blue ice
      waterShallow: [0.12, 0.52, 0.62], // Crystal alpine tarn
      waterDeep: [0.05, 0.22, 0.36],   // Deep sapphire
    },
    macroSatMap: {
      mineral: [1.15, 1.10, 1.05],
      vegetation: [0.75, 1.35, 0.70],
      moisture: [0.85, 0.90, 1.05],
    },
    roughness: {
      rock: 0.70,                      // Crystalline calcite facets
      talus: 0.92,
      dirt: 0.86,
      grass: 0.62,
      sediment: 0.78,
      snow: 0.40,
    },
    sunElevation: 46.0,
    sunAzimuth: 130.0,
    skyColor: [0.52, 0.70, 0.92],
    groundBounceColor: [0.28, 0.26, 0.24],
    fogDensity: 0.0024,
    fogColor: [0.68, 0.76, 0.88],
  },

  atacamaMartian: {
    name: "Atacama & Martian Desert",
    region: "Hyper-Arid Plateau (Ferric Oxides & Salt Playas)",
    description: "Deep ferric hematite red, desert varnish rock, salt playa crusts, sun-baked arid crust",
    colors: {
      rock: [0.64, 0.26, 0.16],        // Ferric hematite rock
      rockSecondary: [0.42, 0.18, 0.12], // Desert varnish
      strata: [0.52, 0.42, 0.28],      // Oxidized copper crust
      talus: [0.60, 0.28, 0.18],       // Ferric rubble
      sediment: [0.82, 0.72, 0.62],    // Bleached salt playa sand
      dirt: [0.52, 0.24, 0.14],        // Baked iron oxide loam
      grass: [0.52, 0.48, 0.26],       // Scorched dry lichen
      grassDry: [0.68, 0.56, 0.32],    // Arid straw
      snow: [0.92, 0.90, 0.94],        // Dust ice
      snowIce: [0.72, 0.76, 0.85],
      waterShallow: [0.28, 0.46, 0.42], // Brine pool
      waterDeep: [0.16, 0.24, 0.22],   // Deep brine
    },
    macroSatMap: {
      mineral: [1.45, 0.85, 0.65],
      vegetation: [1.10, 1.05, 0.80],
      moisture: [1.20, 0.75, 0.55],
    },
    roughness: {
      rock: 0.78,
      talus: 0.96,
      dirt: 0.92,
      grass: 0.82,
      sediment: 0.88,
      snow: 0.50,
    },
    sunElevation: 60.0,
    sunAzimuth: 200.0,
    skyColor: [0.72, 0.70, 0.78],
    groundBounceColor: [0.44, 0.22, 0.14],
    fogDensity: 0.0016,
    fogColor: [0.80, 0.68, 0.58],
  },

  scottishHighlands: {
    name: "Scottish Highlands & Moor",
    region: "Cairngorms (Lewisian Gneiss & Peat Bogs)",
    description: "Dark Lewisian gneiss, purple heather peat, golden bog grass, deep amber-tinted loch waters",
    colors: {
      rock: [0.28, 0.28, 0.30],        // Dark Lewisian gneiss
      rockSecondary: [0.18, 0.18, 0.20], // Basalt
      strata: [0.46, 0.44, 0.42],      // Quartz vein bands
      talus: [0.32, 0.32, 0.34],       // Dark gneiss scree
      sediment: [0.38, 0.36, 0.34],    // Wet gravel wash
      dirt: [0.18, 0.14, 0.10],        // Dark peat bog
      grass: [0.26, 0.38, 0.18],       // Heather moorland
      grassDry: [0.46, 0.44, 0.22],    // Golden bog grass
      snow: [0.95, 0.96, 0.98],        // Highland snow
      snowIce: [0.58, 0.78, 0.90],
      waterShallow: [0.18, 0.24, 0.28], // Peaty amber loch
      waterDeep: [0.04, 0.08, 0.12],   // Deep black loch
    },
    macroSatMap: {
      mineral: [0.95, 0.95, 1.05],
      vegetation: [0.85, 1.35, 0.75],
      moisture: [0.65, 0.80, 1.10],
    },
    roughness: {
      rock: 0.65,                      // Wet rock glints
      talus: 0.92,
      dirt: 0.88,
      grass: 0.58,
      sediment: 0.75,
      snow: 0.40,
    },
    sunElevation: 36.0,
    sunAzimuth: 155.0,
    skyColor: [0.44, 0.54, 0.68],
    groundBounceColor: [0.16, 0.18, 0.14],
    fogDensity: 0.0035,
    fogColor: [0.50, 0.58, 0.68],
  },

  yosemiteGranite: {
    name: "Yosemite Sierra Granite",
    region: "Sierra Nevada (White Granite & Sierran Meadows)",
    description: "Bright crystalline quartz-granite, pine forest floor, golden meadow turf, crystal rivers",
    colors: {
      rock: [0.54, 0.52, 0.50],        // White crystalline granite
      rockSecondary: [0.32, 0.30, 0.30], // Diorite shadows
      strata: [0.72, 0.70, 0.68],      // Quartz dikes
      talus: [0.50, 0.48, 0.46],       // Angular granite scree
      sediment: [0.68, 0.62, 0.52],    // Crystal river sand
      dirt: [0.28, 0.20, 0.14],        // Pine needle humus
      grass: [0.28, 0.44, 0.16],       // Golden valley meadow
      grassDry: [0.54, 0.50, 0.26],    // Dry sierra grass
      snow: [0.97, 0.98, 1.00],        // Sierra snowpack
      snowIce: [0.65, 0.84, 0.96],
      waterShallow: [0.12, 0.50, 0.54], // Clear emerald river
      waterDeep: [0.06, 0.22, 0.36],   // Deep sapphire pool
    },
    macroSatMap: {
      mineral: [1.20, 1.15, 1.05],
      vegetation: [0.80, 1.30, 0.70],
      moisture: [0.85, 0.90, 1.00],
    },
    roughness: {
      rock: 0.62,                      // Crystalline quartz reflection
      talus: 0.92,
      dirt: 0.86,
      grass: 0.62,
      sediment: 0.76,
      snow: 0.38,
    },
    sunElevation: 52.0,
    sunAzimuth: 135.0,
    skyColor: [0.46, 0.66, 0.92],
    groundBounceColor: [0.26, 0.24, 0.20],
    fogDensity: 0.0022,
    fogColor: [0.62, 0.74, 0.88],
  },

  arcticPermafrost: {
    name: "Arctic Permafrost & Tundra",
    region: "Greenland & Svalbard (Ice Sheets & Patterned Tundra)",
    description: "Frost-shattered dark shale, patterned ground tundra, pale crustose lichen, permanent ice sheets",
    colors: {
      rock: [0.30, 0.30, 0.32],        // Frost-shattered shale
      rockSecondary: [0.22, 0.22, 0.24], // Dark quartzite
      strata: [0.50, 0.54, 0.58],      // Ice-veined strata
      talus: [0.34, 0.34, 0.36],       // Frost till
      sediment: [0.48, 0.50, 0.52],    // Glacial rock flour
      dirt: [0.24, 0.22, 0.20],        // Patterned tundra soil
      grass: [0.26, 0.42, 0.22],       // Pale crustose lichen
      grassDry: [0.38, 0.42, 0.26],    // Arctic moss
      snow: [0.96, 0.98, 1.00],        // Permanent ice sheet
      snowIce: [0.35, 0.68, 0.92],     // Deep blue glacier ice
      waterShallow: [0.16, 0.62, 0.74], // Sub-zero turquoise
      waterDeep: [0.04, 0.16, 0.28],   // Arctic ocean deep
    },
    macroSatMap: {
      mineral: [0.90, 1.05, 1.20],
      vegetation: [0.70, 1.25, 0.80],
      moisture: [0.65, 0.90, 1.25],
    },
    roughness: {
      rock: 0.64,
      talus: 0.90,
      dirt: 0.88,
      grass: 0.64,
      sediment: 0.74,
      snow: 0.28,
    },
    sunElevation: 24.0,
    sunAzimuth: 165.0,
    skyColor: [0.42, 0.54, 0.70],
    groundBounceColor: [0.20, 0.22, 0.24],
    fogDensity: 0.0035,
    fogColor: [0.52, 0.62, 0.75],
  },
};
