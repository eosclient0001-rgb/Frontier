/*==============================================================================================================================
  DATA — the scene the editor edits. The Environment folder is the Project-Zero roster read back out of
  Engine/Host/CelestialSequence.cpp: the same names, the same order, the same metas ("AM 10.2", "5.2°", "5.08 kcd",
  "mag +1.3", "1/4", "6 ghosts", "4.2 m/s SW", "Cumulus · 44%", "Rain 27 mm/h", "80×36 m", "391 m", "56 km", "44×16 m"),
  and the same sheets, group for group, with each control's own range, unit and decimals.

  The Geometry half is where the redesign fills the list in: the tyre, its carcass, tread and lattice, the rim and the
  wheel assembly, the vehicles those wheels bolt to, and the cloth and soft bodies. Their sheets use the identical card
  protocol, so nothing new had to be learned to edit them.
==============================================================================================================================*/

/*── tints, straight off the painter: the celestial accents and the editor's own four ────────────*/
const TINT = {
  atmosphere:'#5aa9ff', sun:'#ffb454', sky:'#67e8f9', stars:'#c4b5fd', fog:'#9fb0c0',
  cloud:'#c9d2dc', wind:'#9bd3b4', precip:'#7dd3fc', optics:'#ff8a65', folder:'#8b98a9',
  geometry:'#e2e8f0', light:'#ffb454', camera:'#34c759', body:'#c8b6ff', physics:'#94a3b8',
  tyre:'#e0e6ee', vehicle:'#ff9f68', cloth:'#8fd8c0'
};

/*── the roster's tints, in the folder order the host walks ─────────────────────────────────────*/
const FOLDER_TINT = { Environment:'#8b98a9', Geometry:'#e2e8f0', 'Tyres & Wheels':'#e0e6ee', Vehicles:'#ff9f68', 'Cloth & Soft':"#8fd8c0", Cameras:'#34c759', Lights:'#ffb454' };
const CATEGORY_TINT = { Folder:'#8b98a9', Geometry:'#e2e8f0', Light:'#ffb454', Camera:'#34c759', Body:'#c8b6ff', Volume:'#9fb0c0', Physics:'#94a3b8' };

/*────────────────────────────────────────── property constructors ─────────────────────────────*/
const sl  = (label, min, max, value, decimals, unit, hi) => ({ cat:'slider', label, min, max, value, decimals, unit: unit || '', hi: !!hi });
const sw  = (label, on) => ({ cat:'switch', label, on: !!on });
const ax  = (label, value, step, editable) => ({ cat:'axes', label, value, step: step === undefined ? 1 : step, editable: editable !== false });
const col = (label, value, swatches) => ({ cat:'colour', label, value, swatches: !!swatches });
const sel = (label, options, picked, hi) => ({ cat:'select', label, options, picked, hi: !!hi });
const ro  = (label, text) => ({ cat:'readout', label, text });
const card = (title, props, caption, extra) => Object.assign({ title, props, caption: caption || '' }, extra || {});

/*── shared sheets: the appearance sheets Project-Zero's entities reuse ──────────────────────────*/
const SHEETS = {};
SHEETS.environment = { appearance:'Generic', groups:[
  card('Medium', [ sw('Enabled', true), col('Sky Tint', '#8fb6ff'), col('Ground Colour', '#3c3a36'),
                   sl('Rayleigh', 0, 4, 1, 2, 'x'),
                   sl('Mie', 0, 6, 1, 2, 'x'), sl('Mie Anisotropy', 0, 0.99, 0.76, 2, ''),
                   sl('Ozone', 0, 4, 1, 2, 'x'), sl('Density', 0, 3, 1, 2, 'x', true) ],
       'Turbidity, Rayleigh and Mie blend in one place; the density slider is what a haze pass moves.'),
  card('Tier', [ sel('Model', ['Physical', 'Approximate', 'Stub'], 0), ro('Transmittance LUT', '256 × 64 RGBA16F'),
                 ro('Multiple scattering', '4 taps') ], ''),
  card('Ground', [ ro('Ground albedo', 'sRGB · 0.09 linear'), ro('Horizon falloff', '0.35 km') ], '')
]};

SHEETS.sun = { appearance:'Sun', groups:[
  card('Bake / image', [ ro('Source', 'No image source connected.'), ro('Bake', 'Owned by Sky, not Sun.') ],
       'Sun-specific Bake and Use baked image are not supported. The existing bake belongs to Sky, not Sun.'),
  card('Sun Disk', [ sl('Angular Diameter', 0.1, 5, 0.53, 2, '°'), col('Sun Tint', '#fff4e0'),
                     sel('Colour source', ['RGB tint', 'Temperature'], 0), sl('Temperature', 1000, 40000, 5800, 0, 'K') ], ''),
  card('Sunlight gain', [ sl('Intensity', 0, 60, 5.2, 1, 'x'), sl('Direct', 0, 5, 1, 2, 'x') ],
       'Native, and only after exposure: the disk and the light stay in step.'),
  card('Day cycle', [ sl('Local Hours', 0, 24, 10.2, 2, 'h'), sw('Animate', true), sl('Day duration', 0.01, 168, 24, 2, 'h'),
                      sel('Speed', ['x1', 'x8', 'x30', 'x100', 'Custom'], 0) ],
       "24-hour local clock; the sun's own direction is solved from it, never dialled by hand.", { clock24: true }),
  card('Observer / date', [ sl('Latitude', -90, 90, 52, 2, '°'), sl('Longitude', -180, 180, -1.5, 2, '°'),
                            sl('Day of Month', 1, 31, 21, 0, ''), sl('Month', 1, 12, 6, 0, '') ], ''),
  card('Solved direction', [ ro('Elevation', '+31.20°'), ro('Azimuth', '132.6°'), ro('Declination', '+20.44°'),
                             ro('Equation of Time', '-1.7 min') ],
       'Solved, so manual azimuth/elevation and independent disk/light switches are not exposed.', { stacked: true })
]};

SHEETS.sky = { appearance:'Sky', groups:[
  card('Atmosphere', [ col('Sky Tint', '#8fb6ff'), sl('Intensity', 0, 6, 1, 2, 'x', true),
                       sl('Haze', 0, 1, 0.22, 2, ''), sl('Baked Dome', 0, 1, 0, 2, '') ],
       'The baked dome rides this sheet; it is the same medium the Sky Atmosphere row names.')
]};

SHEETS.stars = { appearance:'Stars', groups:[
  card('Field', [ sl('Brightness', 0, 4, 1, 2, 'x'), sl('Point Size', 0.4, 3, 1, 2, 'x'), sw('Star field', true),
                  sl('Limiting magnitude', 0, 8, 6.5, 1, 'mag'), sw('Twinkle', true), sl('Twinkle depth', 0, 1, 0.35, 2, ''),
                  sl('Twinkle rate', 0, 4, 0.8, 2, 'Hz'), sl('Celestial rotation', 0, 360, 128.4, 1, '°') ], ''),
  card('Catalogue', [ ro('Loaded', '9 110 stars'), ro('Sidereal Time', '128.4°'), ro('Source', 'Hipparcos subset') ], '')
]};

SHEETS.moons = { appearance:'Moon', groups:[
  card('M1 · quarter', [ sw('Visible', true), sl('Size', 0, 10, 5.2, 2, '°'), sl('Azimuth', 0, 360, 132.6, 1, '°'),
                         sl('Elevation', 0, 90, 31.2, 1, '°'), sl('Phase', 0, 1, 0.25, 2, ''), col('Tint', '#dfe6f5') ]),
  card('M2 · hidden', [ sw('Visible', false), sl('Size', 0, 10, 2.1, 2, '°'), sl('Azimuth', 0, 360, 210, 1, '°') ]),
  card('M3 · hidden', [ sw('Visible', false), sl('Size', 0, 10, 1.4, 2, '°') ]),
  card('M4 · hidden', [ sw('Visible', false), sl('Size', 0, 10, 0.9, 2, '°') ])
]};

const FLARE_BASE = [ sw('Enabled', true), sl('Intensity', 0, 4, 1.2, 2, 'x'), sl('Ghost count', 0, 12, 6, 0, ''),
                     sl('Ghost spacing', 0, 2, 0.62, 2, ''), sl('Halo radius', 0, 2, 0.44, 2, ''),
                     sl('Dirt', 0, 1, 0.18, 2, ''), col('Tint', '#ffd7a8') ];
SHEETS.lensflare = { appearance:'LensFlare', groups:[
  card('Sources', FLARE_BASE, ''),
  card('Anamorphic', [ sl('Streak', 0, 2, 0.35, 2, ''), sl('Ratio', 1, 8, 2.4, 2, ''), col('Streak tint', '#7dd3fc') ]),
  card('Occlusion', [ sw('Sun occlusion', true), sw('Sky occlusion', true), sl('Rayleigh term', 0, 1, 0.4, 2, '') ])
]};

SHEETS.wind = { appearance:'Wind', groups:[
  card('Flow', [ sl('Speed', 0, 40, 4.2, 1, 'm/s', true), sl('Bearing', 0, 360, 225, 0, '°'),
                 sl('Shear', 0, 2, 0.18, 2, ''), sw('Air shear', true), sw('Vertical', false) ]),
  card('Gust', [ sl('Shear gain', 0, 4, 1, 2, 'x'), sl('Gust size', 0, 2000, 220, 0, 'm'), sl('Gust speed', 0, 2, 0.35, 2, '') ]),
  card('Beaufort', [ ro('Force', '3 · gentle breeze'), ro('Compass', 'SW · 16-point') ]),
  card('Components', [ ro('Field', 'WindVector · 3 ch'), ro('Drives', 'Clouds · Precip · Cloth') ], '')
]};

const PRECIP_TYPES = ['Rain', 'Drizzle', 'Hail', 'Snow', 'Sleet'];
SHEETS.precipitation = { appearance:'Precipitation', groups:[
  card('Type', [ sw('Enabled', true), sel('Type', PRECIP_TYPES, 0),
                 sl('Intensity', 0, 100, 27, 1, 'mm/h', true), sl('Density', 0, 4, 1, 2, 'x'),
                 sl('Particle Size', 0.1, 4, 1, 2, 'x') ]),
  card('Wind', [ sl('Wind Drift', 0, 4, 0.6, 2, ''), sw('Follow Wind', true), sw('Spawn from Clouds', true) ]),
  card('Collision', [ sw('Ground Collision', true), sl('Accumulation', 0, 1, 0, 2, '') ]),
  card('Live', [ ro('Particles', '18 402'), ro('Snow Depth', '0.000 m') ])
]};

SHEETS.rainbow = { appearance:'Rainbow', groups:[
  card('Bow', [ sw('Enabled', true), sl('Intensity', 0, 2, 1.2, 2, 'x'), sl('Width', 0, 4, 1, 2, 'x'), sl('Secondary', 0, 1, 0.35, 2, '') ]),
  card('Optics', [ sl("Alexander's Band", 0, 1, 0.4, 2, ''), sl('Minimum Path', 0, 2000, 500, 0, 'm'), sl('Droplet radius', 0.01, 2, 0.5, 3, 'mm') ])
]};

/*── the volumes and the fog family, sharing one body ───────────────────────────────────────────*/
const VOLUME_BODY = [ sw('Enabled', true), sl('Density', 0, 4, 0.8, 2, 'x', true), sl('Coverage', 0, 1, 0.55, 2, ''),
                      sl('Feature Scale', 10, 600, 180, 0, 'm'), sl('Anisotropy', -0.9, 0.9, 0.4, 2, ''),
                      sw('Follow Wind', true) ];
const VOLUME_TRANSFORM = [ ax('Centre', [12, 4, -6], 1), ax('Half Size', [40, 18, 40], 1) ];
SHEETS.cloudVolume = { appearance:'LocalCloud', groups:[
  card('Transform', VOLUME_TRANSFORM), card('Body', VOLUME_BODY),
  card('Tier', [ ro('March', '40 steps · dither'), ro('Light taps', '4') ])
]};
SHEETS.fogVolume = { appearance:'LocalFog', groups:[
  card('Transform', VOLUME_TRANSFORM), card('Body', VOLUME_BODY),
  card('Tier', [ ro('March', '64 steps'), ro('Light taps', '2') ])
]};
SHEETS.heightFog = { appearance:'HeightFog', groups:[
  card('Medium', [ sw('Enabled', true), sl('Density', 0, 0.2, 0.0042, 4, '1/m', true),
                   sl('Falloff Height', 10, 3000, 391, 0, 'm'), sl('Sun Scatter', 0, 2, 0.8, 2, 'x'), col('Colour', '#b8c6d2') ]),
  card('Tier', [ ro('Integrator', 'Analytic · 1 sample'), ro('Lit', 'single scatter') ])
]};
SHEETS.aerialFog = { appearance:'AerialFog', groups:[
  card('Aerial Perspective', [ sw('Enabled', true), sl('Density', 0, 4, 1, 2, 'x', true), sl('Start', 0, 2000, 0, 0, 'm'),
                               sl('Mie Blend', 0, 1, 0.35, 2, ''), col('Inscatter', '#9fb0c0') ]),
  card('Tier', [ ro('Fade', '56 km'), ro('Source', 'Sky medium') ])
]};

SHEETS.clouds = { appearance:'GlobalCloud', groups:[
  card('Shape', [ sw('Enabled', true), sel('Type', ['Cumulus', 'Stratus', 'Cirrus'], 0),
                  sl('Coverage', 0, 1, 0.44, 2, '', true), sl('Density', 0, 4, 1.4, 2, 'x'),
                  sl('Feature Scale', 0, 6, 1.8, 2, ''), sl('Anvil', 0, 1, 0.6, 2, ''),
                  sl('Anisotropy', -0.9, 0.9, 0.6, 2, '') ]),
  card('Altitude', [ sl('Base', 100, 9000, 1200, 0, 'm'), sl('Thickness', 100, 6000, 900, 0, 'm'),
                     sl('Ceiling', 4000, 20000, 9000, 0, 'm'), sw('Follow Wind', true) ]),
  card('Tier Budget', [ ro('Cloud March', '96 steps'), ro('Light Taps', '6 taps') ]),
  card('Cloud Shadows', [ sw('Shadow Enabled', true), sel('Type', ['Cumulus', 'Stratus', 'Cirrus'], 0),
                          sl('Shadow Coverage', 0, 1, 0.5, 2, ''), sl('Shadow Density', 0, 6, 1.6, 2, 'x'),
                          sl('Shadow Scale', 0.01, 1, 0.18, 3, ''), sl('Shadow Anvil', 0, 1, 0.2, 2, ''),
                          sl('Shadow Base', 0, 3000, 1200, 0, 'm'), sl('Shadow Thick', 50, 3000, 900, 0, 'm'),
                          sl('Shadow Ceil', 4000, 20000, 9000, 0, 'm') ]),
  card('Shadow Clock', [ sl('Shadow Time', 0, 86399, 40, 0, 's'), sl('Shadow Wind', 0, 40, 6, 1, 'm/s'),
                         sl('Shadow Dir', 0, 360, 225, 0, '°') ])
]};

/*── cameras ────────────────────────────────────────────────────────────────────────────────────*/
SHEETS.camera = { appearance:'Camera', groups:[
  card('Lens', [ sl('Focal Length', 8, 300, 35, 1, 'mm', true), sl('Sensor', 8, 70, 36, 1, 'mm') ]),
  card('Aperture', [ sl('Aperture', 1.2, 22, 2.8, 1, 'f'), ro('Pupil diameter', '12.5 mm'), ro('In-focus depth', '3.1 m') ]),
  card('Subject', [ sl('Subject Distance', 0.5, 100, 4.5, 2, 'm'), ro('Near', '3.4 m'), ro('Far', '6.5 m') ])
]};
SHEETS.cameraRig = { appearance:'Camera', groups:[
  card('Lens', [ sl('Focal Length', 8, 300, 50, 1, 'mm', true), sl('Sensor', 8, 70, 36, 1, 'mm') ]),
  card('Transform', [ sw('Track target', true), ax('Target', [0, 1.2, 0], 1), sl('Distance', 0.5, 60, 6.4, 2, 'm') ]),
  card('Gate', [ sel('Gate', ['16:9', '2.39:1', '4:3', 'Open gate'], 0), ro('Framing', 'subject locked') ])
]};
SHEETS.postVolume = { appearance:'Generic', groups:[
  card('Exposure', [ sl('Exposure', -6, 6, 0.4, 2, 'EV', true), sl('Contrast', 0, 2, 1, 2, 'x'), sl('Pivot', 0, 1, 0.18, 2, '') ]),
  card('Grade', [ sl('Saturation', 0, 2, 1, 2, 'x'), col('Lift', '#0a0a0c'), col('Gain', '#ffffff') ]),
  card('Bloom', [ sw('Enabled', true), sl('Radius', 0, 4, 1.2, 2, ''), sl('Strength', 0, 2, 0.35, 2, 'x') ])
]};

/*── lights ─────────────────────────────────────────────────────────────────────────────────────*/
SHEETS.pointLight = { appearance:'Generic', groups:[
  card('Source', [ sw('Enabled', true), sl('Lumens', 0, 20000, 1200, 0, 'lm', true), col('Colour', '#ffd9a8'),
                   sl('Radius', 0, 4, 0.2, 3, 'm') ]),
  card('Falloff', [ sel('Model', ['Inverse square', 'Linear', 'Fixed'], 0), sl('Range', 0, 200, 0, 1, 'm') ]),
  card('Shadows', [ sw('Cast', true), sl('Bias', 0, 0.02, 0.002, 4, '') ])
]};
SHEETS.spotLight = { appearance:'Generic', groups:[
  card('Source', [ sw('Enabled', true), sl('Lumens', 0, 40000, 4200, 0, 'lm', true), col('Colour', '#fff2dc') ]),
  card('Cone', [ sl('Inner', 0, 90, 12, 1, '°'), sl('Outer', 0, 90, 18, 1, '°'), sl('Penumbra', 0, 1, 0.4, 2, '') ]),
  card('Shadows', [ sw('Cast', true), sl('Bias', 0, 0.02, 0.002, 4, '') ])
]};
SHEETS.areaLight = { appearance:'Generic', groups:[
  card('Source', [ sw('Enabled', true), sl('Width', 0.1, 10, 2, 2, 'm'), sl('Height', 0.1, 10, 1, 2, 'm'),
                   sl('Lumens', 0, 60000, 6000, 0, 'lm', true), col('Colour', '#ffffff') ]),
  card('Emission', [ sel('Shape', ['Rect', 'Disc', 'Tube'], 0), sw('Two-sided', false) ])
]};

/*── geometry primitives ────────────────────────────────────────────────────────────────────────*/
const BASE_MATERIAL = [ col('Base Colour', '#b9bcc2'), sl('Roughness', 0, 1, 0.42, 2, ''), sl('Metallic', 0, 1, 0, 2, ''),
                        sl('Specular', 0, 1, 0.5, 2, ''), sl('IOR', 1, 2.6, 1.45, 2, '') ];
SHEETS.primitive = { appearance:'Generic', groups:[
  card('Material', BASE_MATERIAL),
  card('Surface', [ sw('Cast shadows', true), sw('Receive shadows', true), sel('Facing', ['Front', 'Double', 'Back'], 0) ]),
  card('Instance', [ ro('Mesh', 'Cube · 12 tris'), ro('Bounds', '1 × 1 × 1 m') ])
]};
SHEETS.material = { appearance:'Generic', groups:[
  card('Base', BASE_MATERIAL),
  card('Coating', [ sl('Clearcoat', 0, 1, 0.25, 2, ''), sl('Flake', 0, 1, 0.08, 2, ''), sl('Anisotropy', -1, 1, 0, 2, '') ]),
  card('Emission', [ sw('Emit', false), col('Emission', '#000000'), sl('Strength', 0, 60, 0, 1, 'x') ]),
  card('Instance', [ ro('Shader', 'PBR · raster + ReSTIR'), ro('Channels', '20 bound') ])
]};

/*── the tyres, the vehicles and the cloth this redesign adds ───────────────────────────────────*/
SHEETS.tyre = { appearance:'Tyre', groups:[
  card('Inflation', [ sl('Pressure', 0, 400, 240, 0, 'kPa', true) ],
       'The authored value. Hoop and spoke compliance derive from it, so the slider means something physical.'),
  card('Tread', [ sl('Depth', 0, 25, 15, 1, 'mm', true), sl('Wear', 0, 1, 0, 2, ''), sl('Bias', -1, 1, 0, 2, '') ]),
  card('Rim bottoming', [ sl('Clearance', 0, 40, 6, 1, 'mm'), sl('Damping', 0, 1, 0.25, 2, '') ],
       'Part 4 settled the damping ratio at 0.25; above 6.0 mm the stop pumped energy back into the carcass.'),
  card('Instance', [ ro('Outer', '831 mm'), ro('Circumference', '2 610 mm'), ro('Source', 'TreadMeshSolver') ])
]};
SHEETS.tyreTread = { appearance:'TyreTread', groups:[
  card('Tread', [ sw('Enabled', true), sel('Pattern', ['GZero Slick', 'Grizzly Magnum', 'Vortex R1', 'HexaGrip Nova', 'Talon Trail'], 1),
                  sl('Depth', 0, 25, 15, 1, 'mm', true), sl('Blocks', 0, 96, 40, 0, ''),
                  sl('Block size', 0, 4, 1, 2, 'x'), sl('Wear', 0, 1, 0, 2, '') ]),
  card('Mesh', [ sl('Mesh mode', 0, 3, 1, 0, ''), sl('Polygon detail', 0.5, 12, 6, 1, ''),
                 sl('Segments around', 64, 1024, 720, 0, ''), sl('Chevron depth', 0, 12, 6.4, 2, 'mm'),
                 sl('Lateral spread', 0, 20, 8.2, 2, 'mm') ]),
  card('Conditions', [ sl('Tread wear', 0, 100, 0, 0, '%'), ro('Remaining', '15.0 mm'), ro('Worn', '8.0 mm') ])
]};
SHEETS.tyreLattice = { appearance:'TyreLattice', groups:[
  card('XPBD lattice', [ ax('Lattice size', [16, 72, 0], 1), sl('Compliance', 0, 1, 0.12, 3, ''),
                         sl('Shear', 0, 1, 0.4, 2, ''), sl('Bend', 0, 1, 0.2, 2, ''), sl('Damping', 0, 1, 0.25, 2, '') ]),
  card('Solve', [ ro('Solver', 'TreadMeshSolver'), ro('Iterations', '12'), ro('Status', 'Seated') ])
]};
SHEETS.rim = { appearance:'Generic', groups:[
  card('Rim', [ sl('Diameter', 12, 24, 17, 1, 'in', true), sl('Width', 4, 15, 8, 1, 'in'),
                sl('Offset', -40, 60, 25, 0, 'mm'), sl('Bolt count', 3, 12, 6, 0, ''), sl('Bolt circle', 90, 200, 139.7, 1, 'mm') ]),
  card('Look', [ sel('Finish', ['Satin', 'Gloss', 'Brushed', 'Machined'], 0), col('Tint', '#c9cdd2'),
                 sl('Roughness', 0, 1, 0.35, 2, ''), sl('Metallic', 0, 1, 1, 2, '') ]),
  card('Beads', [ sw('Bead lock', true), sl('Seat tension', 0, 1, 0.6, 2, '') ])
]};
SHEETS.wheel = { appearance:'Generic', groups:[
  card('Wheel', [ sl('Camber', -10, 10, -0.5, 2, '°'), sl('Toe', -5, 5, 0.05, 2, '°'), sl('Radius', 100, 600, 415.5, 1, 'mm'),
                  sl('Spin', -360, 360, 0, 1, '°'), sw('Steerable', true) ]),
  card('Fitment', [ ro('Tyre', 'Grizzly Magnum'), ro('Rim', '17 × 8.0'), ro('Axle', 'Front left') ]),
  card('Suspension', [ sl('Travel', 0, 400, 180, 0, 'mm'), sl('Spring', 1, 200, 62, 0, 'N/mm'),
                       sl('Rebound', 0, 1, 0.35, 2, '') ])
]};
SHEETS.vehicle = { appearance:'Generic', groups:[
  card('Body', [ sl('Length', 1, 12, 4.6, 2, 'm'), sl('Width', 0.5, 4, 1.9, 2, 'm'), sl('Height', 0.5, 4, 1.4, 2, 'm'),
                 col('Paint', '#c2410c') ]),
  card('Mass & drive', [ sl('Mass', 200, 4000, 1480, 0, 'kg', true), sel('Drive', ['RWD', 'FWD', 'AWD'], 2),
                         sl('Power', 10, 1200, 320, 0, 'kW') ]),
  card('Aero', [ sl('Drag', 0, 2, 0.31, 2, ''), sl('Downforce', 0, 2000, 120, 0, 'N') ]),
  card('Instance', [ ro('Wheels', '4 seated'), ro('Physics', 'rigid body'), ro('Source', 'VehicleRig') ])
]};
SHEETS.chassis = { appearance:'Generic', groups:[
  card('Chassis', [ sel('Type', ['Ladder', 'Monocoque', 'Space frame'], 1), sl('Wheelbase', 1.5, 5, 2.8, 2, 'm'),
                    sl('Track front', 1, 2.5, 1.6, 2, 'm'), sl('Track rear', 1, 2.5, 1.6, 2, 'm') ]),
  card('Stiffness', [ sl('Torsional', 0, 80000, 32000, 0, 'N·m/deg'), sl('Bending', 0, 80000, 26000, 0, 'N·m/deg') ]),
  card('Mass', [ sl('Mass', 40, 900, 210, 0, 'kg'), ax('Centre of mass', [0, -0.42, 0.1], 0.05) ])
]};
SHEETS.engineSheet = { appearance:'Generic', groups:[
  card('Engine', [ sel('Layout', ['Inline-4', 'V6', 'V8', 'Flat-6', 'Electric'], 1), sl('Displacement', 0.4, 8, 3, 1, 'L'),
                   sl('Power', 10, 1200, 320, 0, 'kW'), sl('Torque', 20, 1200, 480, 0, 'N·m') ]),
  card('Drivetrain', [ sel('Gearbox', ['6-speed manual', '8-speed auto', 'Dual clutch', 'Single speed'], 2),
                       sl('Gear', 1, 8, 3, 0, ''), sl('Final drive', 1, 6, 3.4, 2, ':1') ]),
  card('Live', [ ro('RPM', '2 840'), ro('Load', '0.42') ])
]};
SHEETS.cloth = { appearance:'Generic', groups:[
  card('Simulation', [ sl('Resolution', 8, 128, 48, 0, '', true), sl('Stiffness', 0, 1, 0.7, 2, ''),
                       sl('Damping', 0, 1, 0.12, 2, ''), sl('Gravity', 0, 20, 9.81, 2, 'm/s²'),
                       sl('Wind response', 0, 2, 1, 2, 'x'), sw('Self collision', true) ]),
  card('Pinning', [ sel('Pin mode', ['Corners', 'Top edge', 'Shape'], 0), sl('Pin strength', 0, 1, 1, 2, ''),
                    sl('Tear threshold', 0, 1, 0.8, 2, '') ]),
  card('Fabric', [ sel('Weave', ['Plain', 'Twill', 'Satin', 'Knit'], 0), sl('Density', 50, 900, 220, 0, 'g/m²'),
                   col('Tint', '#7cc9a6') ]),
  card('Instance', [ ro('Particles', '2 304'), ro('Solver', 'XPBD · 12 iterations') ])
]};
SHEETS.rope = { appearance:'Generic', groups:[
  card('Rope', [ sl('Segments', 4, 64, 18, 0, '', true), sl('Radius', 2, 80, 12, 1, 'mm'),
                 sl('Compliance', 0.0001, 0.1, 0.004, 4, ''), sl('Damping', 0, 1, 0.2, 2, '') ]),
  card('Anchors', [ ax('Anchor A', [0, 3, 0], 0.5), ax('Anchor B', [2, 3, 0], 0.5), sw('Sag', true) ])
]};
SHEETS.softBody = { appearance:'Generic', groups:[
  card('Body', [ sl('Resolution', 8, 96, 32, 0, '', true), sl('Volume', 0, 1, 0.6, 2, ''),
                 sl('Poisson', 0, 1, 0.45, 2, ''), sl('Damping', 0, 1, 0.18, 2, '') ]),
  card('Collision', [ sw('Self collision', true), sl('Friction', 0, 1, 0.6, 2, '') ])
]};

/*── the tyre generator's own shelf: the proof sheet's fourteen presets ─────────────────────────*/
const TYRE_PRESETS = [
  { name:'Random tyre', sub:'RANDOM', tint:'#3a3f46', tread:0.0 },
  { name:'GZero SLICK', sub:'SLICK', tint:'#2f3236', tread:0.0 },
  { name:'Vortex STREET', sub:'STREET', tint:'#39404a', tread:0.35 },
  { name:'Pilot Road STREET', sub:'STREET', tint:'#3d434b', tread:0.45 },
  { name:'HexaGrip SPORT', sub:'SPORT', tint:'#444a52', tread:0.6 },
  { name:'Grizzly Magnum', sub:'ALL-TERRAIN', tint:'#4a4a45', tread:0.75 },
  { name:'Talon Trail OFF-RAD', sub:'OFF-ROAD', tint:'#524f47', tread:0.9 },
  { name:'Mud Bogger', sub:'MUD', tint:'#57503f', tread:1.0 },
  { name:'Winter Stud', sub:'WINTER', tint:'#5a6068', tread:0.8 },
  { name:'Aquaplane WET', sub:'WET', tint:'#41505c', tread:0.55 },
  { name:'Circuit SLICK', sub:'TRACK', tint:'#2b2e31', tread:0.05 },
  { name:'Drift Smoke', sub:'DRIFT', tint:'#33363a', tread:0.15 },
  { name:'Truck Steer', sub:'TRUCK', tint:'#4b4b4b', tread:0.7 },
  { name:'Spare Skinny', sub:'SPARE', tint:'#3f4245', tread:0.5 }
];
const TYRE_SIZES = ['285/70 R17', '205/70 R15', '265/35 R19', '315/75 R16', '165/70 R14'];

/*────────────────────────────────────────── the roster ─────────────────────────────────────────*/
/* Columns the outliner paints: key, label, depth, category, icon, tint, meta, standing, notes, flags */
const ROSTER = [];
let KEY = 0x200000000;
const row = (r) => { r.key = (0x200000000 + (++KEY)).toString(16); r.id = ROSTER.length; ROSTER.push(r); return r; };

/* the environment folder and its thirteen records — the native walk wants a folder first */
row({ label:'Environment', depth:0, category:'Folder', icon:'globe', tint:FOLDER_TINT.Environment, pinned:true, open:true, counted:false });
row({ label:'Atmosphere', depth:1, category:'Volume', icon:'atmosphere', tint:TINT.atmosphere, sheet:'environment',
      meta:'AM 10.2', narrowing:'Sky', visible:true, dynamic:false, note:'Rayleigh medium', standing:'ok' });
row({ label:'Directional Light', depth:1, category:'Light', icon:'sun', tint:TINT.sun, sheet:'sun',
      meta:'5.2°', narrowing:'Lights', visible:true, dynamic:true, locked:false, note:'Below horizon', standing:'warn', sun:true });
row({ label:'Sky Atmosphere', depth:1, category:'Volume', icon:'sky', tint:TINT.sky, sheet:'sky',
      meta:'5.08 kcd', narrowing:'Sky', visible:true, dynamic:false, standing:'ok' });
row({ label:'Star Field', depth:1, category:'Geometry', icon:'stars', tint:TINT.stars, sheet:'stars',
      meta:'mag +1.3', narrowing:'Sky', visible:true, dynamic:true, note:'Washed out by sky', standing:'quiet' });
row({ label:'Atlas', depth:1, category:'Geometry', icon:'moon', tint:TINT.stars, sheet:'moons',
      meta:'1/4', narrowing:'Bodies', visible:true, dynamic:true, note:'Set', standing:'ok' });
row({ label:'Lens Flare', depth:1, category:'Component', icon:'flare', tint:TINT.optics, sheet:'lensflare',
      meta:'6 ghosts', narrowing:'Sky', visible:true, dynamic:true, standing:'ok' });
row({ label:'Wind Field', depth:1, category:'Component', icon:'wind', tint:TINT.wind, sheet:'wind',
      meta:'4.2 m/s SW', narrowing:'Sky', visible:true, dynamic:true, physics:true, standing:'ok' });
row({ label:'Clouds', depth:1, category:'Volume', icon:'cloudVolume', tint:TINT.cloud, sheet:'clouds',
      meta:'Cumulus · 44%', narrowing:'Sky', visible:true, dynamic:true, standing:'ok' });
row({ label:'Precipitation', depth:2, category:'Component', icon:'rain', tint:TINT.precip, sheet:'precipitation',
      meta:'Rain 27 mm/h', narrowing:'Sky', visible:true, dynamic:true, standing:'ok' });
row({ label:'Cloud Volume', depth:1, category:'Volume', icon:'localCloud', tint:TINT.cloud, sheet:'cloudVolume',
      meta:'80×36 m', narrowing:'Sky', visible:true, dynamic:true, standing:'ok' });
row({ label:'Volumetrics', depth:1, category:'Volume', icon:'heightFog', tint:TINT.fog, sheet:'heightFog',
      meta:'391 m', narrowing:'Sky', visible:true, dynamic:false, standing:'ok' });
row({ label:'Aerial Perspective', depth:1, category:'Volume', icon:'aerialFog', tint:TINT.fog, sheet:'aerialFog',
      meta:'56 km', narrowing:'Sky', visible:true, dynamic:false, standing:'ok' });
row({ label:'Fog Volume', depth:1, category:'Volume', icon:'volumeFog', tint:TINT.fog, sheet:'fogVolume',
      meta:'44×16 m', narrowing:'Sky', visible:true, dynamic:true, standing:'ok' });
row({ label:'Optics', depth:1, category:'Component', icon:'rainbow', tint:TINT.optics, sheet:'rainbow',
      meta:'120%', narrowing:'Sky', visible:false, dynamic:true, note:'Below horizon', standing:'quiet' });

/* geometry — the showcase shelf the proofs name */
row({ label:'Geometry', depth:0, category:'Folder', icon:'mesh', tint:FOLDER_TINT.Geometry, open:true, counted:false });
row({ label:'Cornell Box', depth:1, category:'Geometry', icon:'cube', tint:TINT.geometry, sheet:'material',
      meta:'24 quads', narrowing:'Geometry', visible:true, dynamic:false, physics:true, standing:'ok' });
row({ label:'Ground Plane', depth:1, category:'Geometry', icon:'plane', tint:TINT.geometry, sheet:'material',
      meta:'40×40 m', narrowing:'Geometry', visible:true, dynamic:false, standing:'ok' });
row({ label:'Tall Box', depth:1, category:'Geometry', icon:'cube', tint:TINT.geometry, sheet:'primitive',
      meta:'0.55 × 1.6 m', narrowing:'Geometry', visible:true, dynamic:true, physics:true, standing:'ok' });
row({ label:'Short Box', depth:1, category:'Geometry', icon:'cube', tint:TINT.geometry, sheet:'primitive',
      meta:'0.55 × 0.55 m', narrowing:'Geometry', visible:true, dynamic:true, physics:true, standing:'ok' });
row({ label:'Sphere', depth:1, category:'Geometry', icon:'sphere', tint:TINT.geometry, sheet:'material',
      meta:'24 tris', narrowing:'Geometry', visible:true, dynamic:true, physics:true, standing:'ok' });
row({ label:'Pyramid', depth:1, category:'Geometry', icon:'pyramid', tint:TINT.geometry, sheet:'primitive',
      meta:'6 tris', narrowing:'Geometry', visible:true, dynamic:false, standing:'ok' });

/* tyres and wheels — the family the native list never had */
row({ label:'Tyres & Wheels', depth:0, category:'Folder', icon:'tyre', tint:FOLDER_TINT['Tyres & Wheels'], open:true, counted:false });
row({ label:'Tyre · Grizzly Magnum', depth:1, category:'Geometry', icon:'tyre', tint:TINT.tyre, sheet:'tyre',
      meta:'285/70 R17', narrowing:'Geometry', visible:true, dynamic:true, physics:true, tyre:true, standing:'ok' });
row({ label:'Carcass', depth:2, category:'Geometry', icon:'lattice', tint:TINT.tyre, sheet:'tyre',
      meta:'1 831 mm', narrowing:'Geometry', visible:true, dynamic:true, standing:'ok' });
row({ label:'Tread', depth:2, category:'Geometry', icon:'tyreTread', tint:TINT.tyre, sheet:'tyreTread',
      meta:'GENERAT · 7 layers', narrowing:'Geometry', visible:true, dynamic:true, standing:'ok' });
row({ label:'XPBD Lattice', depth:2, category:'Physics', component:true, icon:'lattice', tint:TINT.physics, sheet:'tyreLattice',
      meta:'16×72', narrowing:'Geometry', visible:true, dynamic:true, physics:true, note:'Sidewall decals 0 placed', standing:'warn' });
row({ label:'Rim', depth:2, category:'Geometry', icon:'rim', tint:TINT.tyre, sheet:'rim',
      meta:'17 × 8.0', narrowing:'Geometry', visible:true, dynamic:true, standing:'ok' });
row({ label:'Wheel Assembly', depth:1, category:'Geometry', icon:'wheel', tint:TINT.tyre, sheet:'wheel',
      meta:'4 seated', narrowing:'Geometry', visible:true, dynamic:true, physics:true, standing:'ok' });

/* vehicles */
row({ label:'Vehicles', depth:0, category:'Folder', icon:'vehicle', tint:FOLDER_TINT.Vehicles, open:true, counted:false });
row({ label:'Car Body', depth:1, category:'Geometry', icon:'carBody', tint:TINT.vehicle, sheet:'vehicle',
      meta:'4.6 × 1.9 m', narrowing:'Geometry', visible:true, dynamic:true, physics:true, standing:'ok' });
row({ label:'Chassis', depth:2, category:'Geometry', icon:'chassis', tint:TINT.vehicle, sheet:'chassis',
      meta:'Monocoque', narrowing:'Geometry', visible:true, dynamic:true, standing:'ok' });
row({ label:'Suspension', depth:2, category:'Geometry', icon:'suspension', tint:TINT.vehicle, sheet:'wheel',
      meta:'4 corners', narrowing:'Geometry', visible:true, dynamic:true, standing:'ok' });
row({ label:'Engine', depth:2, category:'Component', icon:'engine', tint:TINT.vehicle, sheet:'engineSheet',
      meta:'320 kW', narrowing:'Geometry', visible:true, dynamic:true, physics:true, standing:'ok' });
row({ label:'Brake Disc', depth:2, category:'Geometry', icon:'brakeDisc', tint:TINT.vehicle, sheet:'material',
      meta:'Ø 350 mm', narrowing:'Geometry', visible:true, dynamic:true, standing:'ok' });

/* cloth and soft bodies */
row({ label:'Cloth & Soft', depth:0, category:'Folder', icon:'cloth', tint:FOLDER_TINT['Cloth & Soft'], open:true, counted:false });
row({ label:'Cloth Panel', depth:1, category:'Geometry', icon:'cloth', tint:TINT.cloth, sheet:'cloth',
      meta:'2 304 particles', narrowing:'Geometry', visible:true, dynamic:true, physics:true, standing:'ok' });
row({ label:'Rope', depth:1, category:'Geometry', icon:'rope', tint:TINT.cloth, sheet:'rope',
      meta:'18 segments', narrowing:'Geometry', visible:true, dynamic:true, physics:true, standing:'ok' });
row({ label:'Soft Body', depth:1, category:'Geometry', icon:'softbody', tint:TINT.cloth, sheet:'softBody',
      meta:'32³ XPBD', narrowing:'Geometry', visible:true, dynamic:true, physics:true, standing:'ok' });

/* cameras */
row({ label:'Cameras', depth:0, category:'Folder', icon:'camera', tint:FOLDER_TINT.Cameras, open:true, counted:false });
row({ label:'Main Camera', depth:1, category:'Camera', icon:'camera', tint:TINT.camera, sheet:'camera',
      meta:'35 mm · f/2.8', narrowing:'Camera', visible:true, dynamic:false, standing:'ok' });
row({ label:'Cine Camera (35mm)', depth:1, category:'Camera', icon:'cinecamera', tint:TINT.camera, sheet:'cameraRig',
      meta:'35 mm', narrowing:'Camera', visible:true, dynamic:false, standing:'ok' });
row({ label:'Cine Camera (50mm)', depth:1, category:'Camera', icon:'cinecamera', tint:TINT.camera, sheet:'cameraRig',
      meta:'50 mm', narrowing:'Camera', visible:true, dynamic:false, standing:'ok' });
row({ label:'Cine Camera (85mm)', depth:1, category:'Camera', icon:'cinecamera', tint:TINT.camera, sheet:'cameraRig',
      meta:'85 mm', narrowing:'Camera', visible:false, dynamic:false, standing:'quiet' });
row({ label:'Post Process Volume', depth:1, category:'Volume', icon:'exposure', tint:TINT.camera, sheet:'postVolume',
      meta:'+0.4 EV', narrowing:'Camera', visible:true, dynamic:false, standing:'ok' });

/* lights */
row({ label:'Lights', depth:0, category:'Folder', icon:'bulb', tint:FOLDER_TINT.Lights, open:true, counted:false });
row({ label:'Point Light', depth:1, category:'Light', icon:'pointlight', tint:TINT.light, sheet:'pointLight',
      meta:'1 200 lm', narrowing:'Lights', visible:true, dynamic:true, standing:'ok' });
row({ label:'Spot Light', depth:1, category:'Light', icon:'spotlight', tint:TINT.light, sheet:'spotLight',
      meta:'18° cone', narrowing:'Lights', visible:true, dynamic:true, standing:'ok' });
row({ label:'Rect Area Light', depth:1, category:'Light', icon:'arealight', tint:TINT.light, sheet:'areaLight',
      meta:'2 × 1 m', narrowing:'Lights', visible:false, dynamic:true, standing:'quiet' });

/*── the Construct catalogue: the groups the native sheet names, plus the filled-in families ─────*/
const CATALOGUE = [
  { group:'Environment', tint:'#5aa9ff', items:['Atmosphere', 'Sky Atmosphere', 'Star Field', 'Atlas'] },
  { group:'Weather', tint:'#7dd3fc', items:['Wind Field', 'Clouds', 'Precipitation', 'Lens Flare', 'Optics'] },
  { group:'Cameras', tint:'#34c759', items:['Main Camera', 'Cine Camera (35mm)', 'Cine Camera (50mm)', 'Cine Camera (85mm)', 'Post Process Volume'] },
  { group:'Geometry', tint:'#e2e8f0', items:['Cube / Box', 'Sphere', 'Cylinder', 'Cone', 'Torus', 'Plane / Ground', 'Terrain', 'Foliage'] },
  { group:'Lighting', tint:'#ffb454', items:['Directional Light (Sun)', 'Point Light', 'Spot Light', 'Rect / Area Light'] },
  { group:'Tyres & Wheels', tint:'#e0e6ee', items:['Tyre', 'Carcass', 'Tread', 'XPBD Lattice', 'Rim', 'Wheel Assembly', 'Brake Disc', 'Suspension'] },
  { group:'Vehicles', tint:'#ff9f68', items:['Car Body', 'Chassis', 'Engine', 'Gearbox', 'Truck', 'Motorcycle'] },
  { group:'Cloth & Soft', tint:'#8fd8c0', items:['Cloth Panel', 'Rope', 'Soft Body', 'Flag', 'Deformable'] },
  { group:'Materials', tint:'#c8b6ff', items:['Material', 'Shader Ball', 'Texture', 'Layer Stack'] },
  { group:'Effects', tint:'#ff8a65', items:['Particle Emitter', 'Decal', 'Trail', 'Bloom'] }
];
const CATALOGUE_ICON = {
  'Atmosphere':'atmosphere', 'Sky Atmosphere':'sky', 'Star Field':'stars', 'Atlas':'moon',
  'Wind Field':'wind', 'Clouds':'cloudVolume', 'Precipitation':'rain', 'Lens Flare':'flare', 'Optics':'rainbow',
  'Main Camera':'camera', 'Cine Camera (35mm)':'cinecamera', 'Cine Camera (50mm)':'cinecamera', 'Cine Camera (85mm)':'cinecamera',
  'Post Process Volume':'exposure', 'Cube / Box':'cube', 'Sphere':'sphere', 'Cylinder':'cylinder', 'Cone':'cone', 'Torus':'torus',
  'Plane / Ground':'plane', 'Terrain':'terrain', 'Foliage':'foliage', 'Directional Light (Sun)':'sun', 'Point Light':'pointlight',
  'Spot Light':'spotlight', 'Rect / Area Light':'arealight', 'Tyre':'tyre', 'Carcass':'carcass', 'Tread':'tyreTread',
  'XPBD Lattice':'lattice', 'Rim':'rim', 'Wheel Assembly':'wheel', 'Brake Disc':'brakeDisc', 'Suspension':'suspension',
  'Car Body':'carBody', 'Chassis':'chassis', 'Engine':'engine', 'Gearbox':'gearbox', 'Truck':'truck', 'Motorcycle':'bike',
  'Cloth Panel':'cloth', 'Rope':'rope', 'Soft Body':'softbody', 'Flag':'flag', 'Deformable':'deform',
  'Material':'material', 'Shader Ball':'sphere', 'Texture':'texture', 'Layer Stack':'layers',
  'Particle Emitter':'particle', 'Decal':'mask', 'Trail':'wave', 'Bloom':'exposure'
};

/*── the filter pills: the host's four names and tints, plus the families this redesign adds ─────*/
const FILTERS = [
  { label:'Lights',   tint:'#ffb454', match:r => r.narrowing === 'Lights' || r.category === 'Light' },
  { label:'Sky',      tint:'#5aa9ff', match:r => r.narrowing === 'Sky' },
  { label:'Bodies',   tint:'#dfe6f5', match:r => r.narrowing === 'Bodies' },
  { label:'Geometry', tint:'#e2e8f0', match:r => r.narrowing === 'Geometry' },
  { label:'Camera',   tint:'#34c759', match:r => r.narrowing === 'Camera' },
  { label:'Tyres',    tint:'#e0e6ee', match:r => ['tyre','tyreTread','tyreLattice','rim','wheel'].includes(r.sheet) },
  { label:'Cloth',    tint:'#8fd8c0', match:r => ['cloth','rope','softBody'].includes(r.sheet) },
  { label:'Hidden',   tint:'#ff3b30', match:r => !r.visible && r.category !== 'Folder' }
];

/*── search/command vocabulary, and the room's own little facts ──────────────────────────────────*/
const SCENE_STATS = { name:'Project-Zero', nodes:() => ROSTER.filter(r => r.category !== 'Folder').length,
                      tris:138420, instances:() => ROSTER.filter(r => r.category !== 'Folder').length };
const QUICK_COMMANDS = [
  'Play — run the world through a camera', 'Simulate — run the world', 'Pause / resume', 'Step one frame',
  'Stop and restore', 'Find and frame', 'Isolate selection', 'Hide moon', 'Enable physics on selection',
  'Set time to golden hour', 'Scale cone 2x', 'Add a tyre to the scene'
];
const COMMAND_EXAMPLES = ['find', 'rotate', 'move', 'scale', 'add', 'select', 'hide', 'show', 'enable physics on', 'delete from ram'];

/* the scene the panels paint: the roster, its name, and the tyre the generator works on */
const SCENE = {
  name:'Showcase', project:'Project-Zero', rows:ROSTER,
  get nodes() { return ROSTER.filter(r => r.category !== 'Folder').length; },
  tyre: { preset:5, size:'285/70 R17', tab:'Tyre', pressure:240, tread:15.0, wear:0, clearance:6.0, damping:0.25 }
};

window.SCENE = SCENE;
window.TINT = TINT; window.SHEETS = SHEETS; window.ROSTER = ROSTER; window.CATALOGUE = CATALOGUE;
window.CATALOGUE_ICON = CATALOGUE_ICON; window.FILTERS = FILTERS; window.TYRE_PRESETS = TYRE_PRESETS;
window.TYRE_SIZES = TYRE_SIZES; window.SCENE_STATS = SCENE_STATS; window.QUICK_COMMANDS = QUICK_COMMANDS;
window.COMMAND_EXAMPLES = COMMAND_EXAMPLES;
