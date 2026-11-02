const Root = "/Experimental/Editors/PlanetarySurfaceStudio/assets/planet-data";

export const Pipeline = {
  repository: "https://github.com/melvinchia3636/planeteria",
  sourceCommit: "281894f4785e0a97aea32c3e957b8e3b69c8762c",
  publishedAssetsCommit: "73c5610794371eeb7b47165984696c126d31c2dd",
  license: "MIT for pipeline code; underlying raster-data terms remain those of each provider.",
  heightGrid: {
    width: 1024,
    height: 512,
    encoding: "signed 16-bit little-endian metres",
    missingValueHandling:
      "The upstream raster loader replaced missing/non-finite source cells with 0 m. The published grid has no validity mask, so a zero sample cannot always be distinguished from true zero elevation.",
    caveat:
      "Downsampled derivative for interactive preview, not the source DEM and not suitable for precision measurement or scientific analysis.",
  },
  surfaceImage: {
    width: 4096,
    height: 2048,
    encoding: "lossy WebP, sRGB",
    hillshade:
      "The upstream pipeline multiplied source image RGB by 0.30 + 0.70 × DEM hillshade (azimuth 315°, altitude 45°). This is a display derivative, not unshaded reflectance/albedo. Do not treat it as a radiometrically calibrated image or relight it as raw albedo.",
  },
};

export const Bodies = {
  moon: {
    id: "moon",
    name: "Luna",
    class: "Earth moon",
    category: "moon",
    radiusKm: 1737.4,
    longitudeOrigin: 0,
    longitudeDomain: "0–360°E",
    latitudeType: "Planetocentric",
    heightRangeM: [-8473.5, 9979.5],
    heightFile: `${Root}/moon-height.i16le`,
    imageFile: null,
    aiUvFile: "/Experimental/Editors/PlanetarySurfaceStudio/assets/moon-uv/luna.jpg",
    surfaceResolutionM: null,
    sourceSurface: null,
    sourceHeight: {
      product: "LOLA LDEM_128 global lunar digital elevation model",
      instrument: "Lunar Orbiter Laser Altimeter (LOLA), Lunar Reconnaissance Orbiter",
      nominalResolution: "128 pixels/degree; approximately 500 m at the equator",
      citation:
        "NASA PDS Geosciences Node, LOLA gridded data (LDEM_128). Use the PDS label and product documentation for scientific work.",
      url: "https://pds-geosciences.wustl.edu/missions/lro/lola.htm",
      terms: "NASA PDS source product; cite the LOLA team and product documentation.",
    },
    terrainCoverage: "Near-global LOLA grid",
    atmosphere: false,
    notes: [
      "No bundled lunar surface-colour image: the readily available NASA CGI Moon Kit texture is aesthetic rather than a quantitative scientific map, so it is deliberately excluded.",
      "Only the downsampled LOLA elevation derivative is shown. Relief colours are computed from elevation for visualization and are not observed lunar colour.",
      "The AI UV texture is horizontally shifted to reduce its wrap seam; its longitude origin is arbitrary and has no geographic meaning.",
    ],
  },
  earth: {
    id: "earth",
    name: "Earth",
    class: "Terrestrial planet",
    category: "planet",
    atmosphereLabel: "N₂ / O₂",
    radiusKm: 6371,
    longitudeOrigin: -180,
    longitudeDomain: "−180–180°E",
    latitudeType: "Geographic",
    heightRangeM: [-9130.7080078125, 6009.76708984375],
    heightFile: `${Root}/earth-height.i16le`,
    imageFile: `${Root}/earth-surface.webp`,
    surfaceResolutionM: 9780,
    sourceSurface: {
      product: "Blue Marble: Next Generation, topography and bathymetry (December 2004)",
      instrument: "NASA Blue Marble / satellite imagery composite",
      nominalResolution: "21,600 × 10,800 source pixels; bundled derivative 4,096 × 2,048",
      citation: "NASA Visible Earth, Blue Marble: Next Generation collection.",
      url: "https://science.nasa.gov/earth/earth-observatory/blue-marble-next-generation/base-topography-bathymetry/",
      terms: "NASA imagery; retain NASA/Visible Earth attribution and product date.",
    },
    sourceHeight: {
      product: "NOAA ETOPO 2022 v1, global 30 arc-second relief (surface: land and ocean bathymetry)",
      instrument: "NOAA National Centers for Environmental Information (NCEI) compiled relief model",
      nominalResolution: "30 arc-seconds; approximately 1 km at the equator",
      citation: "NOAA NCEI, ETOPO 2022 v1.",
      url: "https://www.ncei.noaa.gov/products/etopo-global-relief-model",
      terms: "NOAA data; cite NOAA NCEI and the ETOPO product.",
    },
    terrainCoverage: "Global land and ocean relief",
    atmosphere: true,
    notes: [
      "The mapped image combines surface colour with topographic/bathymetric shading; it is an older 2004 composite, not a current satellite pass or calibrated albedo layer.",
      "The rendered 1,024 × 512 height grid is a downsampled derivative; its 0 m fill cells have no surviving validity mask.",
    ],
  },
  mars: {
    id: "mars",
    name: "Mars",
    class: "Terrestrial planet",
    category: "planet",
    atmosphereLabel: "Thin CO₂",
    radiusKm: 3396,
    longitudeOrigin: -180,
    longitudeDomain: "−180–180°E",
    latitudeType: "Planetocentric",
    heightRangeM: [-7855, 21107],
    heightFile: `${Root}/mars-height.i16le`,
    imageFile: `${Root}/mars-surface.webp`,
    surfaceResolutionM: 5210,
    sourceSurface: {
      product: "Mars Viking Global Color Mosaic, 925 m",
      instrument: "Viking Orbiter red- and violet-filter image mosaic",
      nominalResolution: "925 m/pixel at the equator; bundled derivative 4,096 × 2,048",
      citation: "USGS Astrogeology Science Center, Mars Viking Global Color Mosaic 925m.",
      url: "https://astrogeology.usgs.gov/search/map/mars_viking_global_color_mosaic_925m",
      terms: "USGS catalog lists public-domain access and no use constraint; cite the product and authors.",
    },
    sourceHeight: {
      product: "Mars MGS MOLA global DEM, 463 m",
      instrument: "Mars Global Surveyor Mars Orbiter Laser Altimeter (MOLA)",
      nominalResolution: "463 m/pixel at the equator",
      citation: "USGS Astrogeology Science Center, MGS MOLA DEM 463m.",
      url: "https://astrogeology.usgs.gov/search/map/mars_mgs_mola_dem_463m",
      terms: "USGS lists this source as CC0/public domain; cite the product and instrument team.",
    },
    terrainCoverage: "Global MOLA grid",
    atmosphere: true,
    notes: [
      "The Viking 925 m mosaic is pseudo-colour, not human-eye true colour; the bundled image has additional DEM hillshade baked in.",
      "The MOLA source DEM is far finer than the bundled 1,024 × 512 height derivative. The derivative's zero-filled missing cells are not separately identified.",
    ],
  },
  mercury: {
    id: "mercury",
    name: "Mercury",
    class: "Terrestrial planet",
    category: "planet",
    atmosphereLabel: "Trace exosphere",
    radiusKm: 2439.4,
    longitudeOrigin: -180,
    longitudeDomain: "−180–180°E",
    latitudeType: "Planetocentric",
    heightRangeM: [-10680, 8304],
    heightFile: `${Root}/mercury-height.i16le`,
    imageFile: `${Root}/mercury-surface.webp`,
    surfaceResolutionM: 3740,
    sourceSurface: {
      product: "MESSENGER MDIS global colour mosaic, 665 m (v3)",
      instrument: "Mercury Dual Imaging System (MDIS), Wide Angle Camera",
      nominalResolution: "665 m/pixel; RGB channels map 1,000, 750 and 430 nm filters",
      citation: "USGS Astrogeology Science Center / MESSENGER team, MDIS Global Color Mosaic.",
      url: "https://astrogeology.usgs.gov/search/map/mercury_messenger_mdis_global_color_mosaic_665m",
      terms: "USGS catalog lists public domain and requests citation to authors.",
    },
    sourceHeight: {
      product: "MESSENGER global DEM, 665 m, version 2",
      instrument: "MESSENGER MDIS NAC/WAC image control and stereo-derived topography",
      nominalResolution: "665 m/pixel at the equator",
      citation: "USGS Astrogeology Science Center, Mercury MESSENGER Global DEM 665m v2.",
      url: "https://astrogeology.usgs.gov/search/map/mercury_messenger_global_dem_665m",
      terms: "USGS catalog requests citation to the authors; cite USGS and the MESSENGER team.",
    },
    terrainCoverage: "Global DEM",
    atmosphere: false,
    notes: [
      "This is enhanced multispectral colour, not what Mercury looks like to the unaided human eye. Red/green/blue encode 1,000/750/430 nm bands.",
      "The source mosaic includes photometric correction; the bundled derivative also has DEM hillshade baked in.",
    ],
  },
  venus: {
    id: "venus",
    name: "Venus",
    class: "Terrestrial planet",
    category: "planet",
    atmosphereLabel: "Dense CO₂",
    radiusKm: 6051.8,
    longitudeOrigin: -180,
    longitudeDomain: "−180–180°E",
    latitudeType: "Planetocentric",
    heightRangeM: [-1982, 10808],
    heightFile: `${Root}/venus-height.i16le`,
    imageFile: `${Root}/venus-surface.webp`,
    surfaceResolutionM: 9284,
    sourceSurface: {
      product: "Magellan C3-MDIR synthetic colour mosaic",
      instrument: "Magellan synthetic aperture radar (SAR)",
      nominalResolution: "4,641 m/pixel for the synthetic-colour product; original radar image swaths are higher resolution",
      citation: "USGS Astrogeology Science Center, Venus Magellan C3-MDIR Synthetic Color Mosaic 4641m.",
      url: "https://astrogeology.usgs.gov/search/map/venus_magellan_global_c3_mdir_synthetic_color_mosaic_4641m",
      terms: "USGS catalog lists public domain; cite the product and Magellan source.",
    },
    sourceHeight: {
      product: "Magellan Global Topography Data Record, version 2",
      instrument: "Magellan radar altimeter",
      nominalResolution: "4,641 m/pixel",
      citation: "USGS Astrogeology Science Center, Venus Magellan Global Topography 4641m.",
      url: "https://astrogeology.usgs.gov/search/map/venus_magellan_global_topography_4641m",
      terms: "USGS catalog lists public domain and requests citation to authors.",
    },
    terrainCoverage: "Global Magellan altimetry grid",
    atmosphere: false,
    notes: [
      "The surface mosaic is radar-derived synthetic colour; Venus has no visible-light surface image in this layer. It is not natural colour or albedo.",
      "The source DEM is a 16-bit altimetry product; this interactive 1,024 × 512 derivative is lower resolution and has no retained validity mask.",
    ],
  },
  ceres: {
    id: "ceres",
    name: "Ceres",
    class: "Dwarf planet",
    category: "dwarf",
    atmosphereLabel: "None detected",
    radiusKm: 470,
    longitudeOrigin: -180,
    longitudeDomain: "−180–180°E",
    latitudeType: "Planetocentric",
    heightRangeM: [-27854, 16968],
    heightFile: `${Root}/ceres-height.i16le`,
    imageFile: `${Root}/ceres-surface.webp`,
    surfaceResolutionM: 721,
    sourceSurface: {
      product: "Dawn Framing Camera global mosaic, 20 pixels/degree (October 2015)",
      instrument: "Dawn Framing Camera (FC), clear-filter global image mosaic",
      nominalResolution: "20 pixels/degree; approximately 5.5 km/pixel at the equator",
      citation: "USGS Astrogeology / NASA-JPL-Caltech / UCLA / MPS / DLR / IDA, Ceres Dawn FC Global Mosaic 400m.",
      url: "https://astrogeology.usgs.gov/search/map/ceres_dawn_fc_global_mosaic_400m",
      terms: "USGS catalog requests citation to authors; the mission mosaic has varying illumination and viewing geometry.",
    },
    sourceHeight: {
      product: "Dawn FC HAMO DLR global DTM, 60 pixels/degree",
      instrument: "Dawn Framing Camera 2 stereo photogrammetry",
      nominalResolution: "Approximately 137 m/pixel at the equator; about 98% coverage, with interpolation near permanently shadowed polar regions",
      citation: "DLR / Dawn team, distributed by USGS Astrogeology, Ceres Dawn FC HAMO DTM 60ppd Oct. 2016.",
      url: "https://astrogeology.usgs.gov/search/map/ceres_dawn_fc2_hamo_global_dtm_137m",
      terms: "Cite the DLR/Dawn authors and the USGS product record.",
    },
    terrainCoverage: "HAMO DTM covers approximately 98%; polar shadow areas include interpolation",
    atmosphere: false,
    notes: [
      "The imagery is a monochrome clear-filter mosaic with different viewing and illumination conditions, not natural-colour albedo.",
      "The high-resolution source DTM is greatly downsampled in the bundled grid; the source has interpolated areas near polar shadows.",
    ],
  },
  pluto: {
    id: "pluto",
    name: "Pluto",
    class: "Dwarf planet",
    category: "dwarf",
    atmosphereLabel: "Seasonal N₂ atmosphere",
    radiusKm: 1188.3,
    longitudeOrigin: -180,
    longitudeDomain: "−180–180°E (render derivative)",
    latitudeType: "Planetographic",
    heightRangeM: [-3924, 5749],
    heightFile: `${Root}/pluto-height.i16le`,
    imageFile: `${Root}/pluto-surface.webp`,
    surfaceResolutionM: 1824,
    sourceSurface: {
      product: "New Horizons LORRI–MVIC global mosaic, 300 m",
      instrument: "Long Range Reconnaissance Imager (LORRI) and Multispectral Visible Imaging Camera (MVIC)",
      nominalResolution: "300 m/pixel at the equator in mapped encounter coverage",
      citation: "New Horizons team / NASA / JHUAPL / SwRI / LPI; USGS Astrogeology Pluto LORRI-MVIC Global Mosaic 300m.",
      url: "https://astrogeology.usgs.gov/search/map/pluto_new_horizons_lorri_mvic_global_mosaic_300m",
      terms: "USGS catalog requests citation to authors; cite New Horizons and the USGS product record.",
    },
    sourceHeight: {
      product: "New Horizons LORRI–MVIC stereo DEM, 300 m (July 2017)",
      instrument: "LORRI and MVIC stereo/parallax mapping",
      nominalResolution: "300 m/pixel in the hemisphere observed at close approach",
      citation: "New Horizons team, USGS Astrogeology Pluto New Horizons LORRI-MVIC Global DEM 300m.",
      url: "https://astrogeology.usgs.gov/search/map/pluto_new_horizons_lorri_mvic_global_dem_300m",
      terms: "USGS catalog requests citation to authors; cite New Horizons and the USGS product record.",
    },
    terrainCoverage: "Global mosaic name, but stereo elevation is principally for the encounter hemisphere; far-side terrain is not measured by this DEM",
    atmosphere: false,
    notes: [
      "The global image is assembled from flyby observations and is not uniform in resolution. The stereo DEM represents the hemisphere visible at closest approach, not independently measured global terrain.",
      "The derivative has no validity mask, so far-side zero-filled cells must not be interpreted as measured zero elevation.",
    ],
  },
};

export const BodyIds = Object.keys(Bodies);

const MoonUvRoot = "/Experimental/Editors/PlanetarySurfaceStudio/assets/moon-uv";
const MoonProfile = (Id, Name, Parent, RadiusKm, File, SurfaceCue, AtmosphereLabel = "Trace exosphere") => ({
  id: Id,
  name: Name,
  class: `${Parent} moon`,
  parent: Parent,
  category: "moon",
  kind: "ai-uv-map",
  radiusKm: RadiusKm,
  shape: Id === "phobos" || Id === "deimos" ? "triaxial" : null,
  longitudeOrigin: null,
  longitudeDomain: null,
  latitudeType: null,
  heightRangeM: null,
  heightFile: null,
  imageFile: null,
  aiUvFile: `${MoonUvRoot}/${File}`,
  surfaceResolutionM: null,
  sourceSurface: null,
  sourceHeight: null,
  terrainCoverage: "Illustration only — no mapped terrain bundled",
  atmosphere: Id === "titan",
  atmosphereLabel: AtmosphereLabel,
  cloudsLabel: "No cloud map",
  surfaceCue: SurfaceCue,
  notes: [
    "AI-generated equirectangular UV illustration. Not measured albedo, spacecraft imagery or scientific surface data.",
    "The texture is horizontally shifted to reduce its wrap seam; its longitude origin is arbitrary and has no geographic meaning.",
  ],
});

export const MoonProfiles = {
  io: MoonProfile("io", "Io", "Jupiter", 1821.6, "io.jpg", "Volcanic · sulfur-rich", "Thin SO₂"),
  europa: MoonProfile("europa", "Europa", "Jupiter", 1560.8, "europa.jpg", "Ice · fractured plains", "Tenuous O₂"),
  ganymede: MoonProfile("ganymede", "Ganymede", "Jupiter", 2634.1, "ganymede.jpg", "Grooved ice · ancient craters", "Tenuous O₂"),
  callisto: MoonProfile("callisto", "Callisto", "Jupiter", 2410.3, "callisto.jpg", "Ancient · heavily cratered", "Trace CO₂ / O₂"),
  titan: MoonProfile("titan", "Titan", "Saturn", 2574.7, "titan.jpg", "Amber haze · dunes below", "Dense N₂ haze"),
  enceladus: MoonProfile("enceladus", "Enceladus", "Saturn", 252.1, "enceladus.jpg", "Bright ice · south-polar fractures", "Water-vapour plume environment"),
  triton: MoonProfile("triton", "Triton", "Neptune", 1353.4, "triton.jpg", "Nitrogen ice · young terrain", "Thin N₂"),
  phobos: MoonProfile("phobos", "Phobos", "Mars", 11.27, "phobos.jpg", "Irregular · Stickney crater", "Near-vacuum"),
  deimos: MoonProfile("deimos", "Deimos", "Mars", 6.2, "deimos.jpg", "Irregular · dusty regolith", "Near-vacuum"),
};

export const Catalog = {
  ...Bodies,
  ...MoonProfiles,
};
export const CatalogIds = Object.keys(Catalog);

export function SampleHeight(Grid, U, V) {
  if (!(Grid instanceof Int16Array) || Grid.length !== 1024 * 512) {
    throw new TypeError("Expected the 1024 × 512 signed-int16 height grid");
  }
  const W = 1024;
  const H = 512;
  const WrappedU = ((U % 1) + 1) % 1;
  const X = WrappedU * W;
  const Y = Math.max(0, Math.min(H - 1, V * (H - 1)));
  const X0 = Math.floor(X) % W;
  const X1 = (X0 + 1) % W;
  const Y0 = Math.floor(Y);
  const Y1 = Math.min(H - 1, Y0 + 1);
  const Fx = X - Math.floor(X);
  const Fy = Y - Y0;
  const A = Grid[Y0 * W + X0] * (1 - Fx) + Grid[Y0 * W + X1] * Fx;
  const B = Grid[Y1 * W + X0] * (1 - Fx) + Grid[Y1 * W + X1] * Fx;
  return A * (1 - Fy) + B * Fy;
}

export function NormalizeLongitude(Longitude, Domain) {
  if (Domain === "0–360°E") return ((Longitude % 360) + 360) % 360;
  const Wrapped = ((Longitude + 180) % 360 + 360) % 360 - 180;
  return Wrapped === -180 ? 180 : Wrapped;
}
