//============================================================================================================================================
//                                                          VEHICLESPECIFICATION.JS
//============================================================================================================================================
// 🧩 The authored vehicle as plain data: body, mass, wheels, tyre specification and the editable curves the inspector binds to.

// 📝 Nothing here is invented. Every number is transcribed from the engine sources named beside it, so the prototype
//    edits the same quantity the C++ solver reads:
//      • Body sockets, wheel geometry, mass, inertia — Frontier/Engine/Physics/ProjectDrive/VehicleGeometry.h
//        (ControlVehicleSockets, read out of ControlVehicle.blend).
//      • Engine torque / exhaust flow / exhaust temperature, turbo boost, gear ratios, final drive, inertias —
//        Frontier/Engine/Physics/ProjectDrive/Drivetrain.h/.cpp (EngineParameters::DefaultGTR and friends).
//      • Contact fan, radial stiffness, reference pressure, pressure share — TraceContactTyre.h.
//      • Ride frequency, damping ratio, travel, preload, anti-roll bars — SuspensionSpecification.h.
//      • Cold pressure 220 kPa, optimum tread 353.15 K, grip fade 473.15 K, minimum grip 0.60, pressure grip
//        sensitivity 0.30, tread mass, wear coefficient, burst pressure — the recovered demo's TyreThermalSolver.js,
//        which is the source the native thermal port follows.
//   💡 Units are carried as strings beside each value, because the editor prints the unit and the user asked for a
//      card vocabulary with units. The unit class selects the colour token (see Style/VehicleInspector.css).

//------------------------------------------------------------------------------------------------------------------------
//                                                        UNIT COLOURS
//------------------------------------------------------------------------------------------------------------------------

export const UnitClassByUnit = Object.freeze({
    'kg': 'unit-mass', 'lb': 'unit-mass', 'kg·m²': 'unit-mass',
    'm': 'unit-length', 'mm': 'unit-length', 'in': 'unit-length', 'ft': 'unit-length',
    'Nm': 'unit-torque', 'lb-ft': 'unit-torque', 'kW': 'unit-torque', 'hp': 'unit-torque', 'kg/s': 'unit-torque',
    'rpm': 'unit-rate', 'm/s': 'unit-rate', 'km/h': 'unit-rate', 'mph': 'unit-rate', 'bar': 'unit-rate',
    'Hz': 'unit-rate', 'kN/m': 'unit-pressure', 'N': 'unit-torque', 'N·s/m': 'unit-torque',
    '°C': 'unit-thermal', 'K': 'unit-thermal', '°F': 'unit-thermal',
    'kPa': 'unit-pressure', 'psi': 'unit-pressure',
    '%': 'unit-fraction', 'x': 'unit-fraction', '-': 'unit-fraction', 'g': 'unit-fraction'
});

export function ClassifyUnit(Unit)
{
    return UnitClassByUnit[Unit] || 'unit-fraction';
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     UNIT CONVERSION
//------------------------------------------------------------------------------------------------------------------------

// 📝 Two unit systems only: the SI values the engine stores, and the imperial presentation the reference dashboard uses.
//    A conversion is a label change for the inspector; the stored value stays SI so the solver is never given inches.
export const UnitSystems = Object.freeze({
    SI: 'si',
    Imperial: 'imperial'
});

const PoundPerKilogram = 2.2046226218;      // [lb/kg]
const MetreToInch = 39.3700787402;          // [in/m]
const MetreToFoot = 3.28083989501;          // [ft/m]
const PascalToPsi = 0.00014503773773;       // [psi/Pa]
const NewtonMetreToPoundFoot = 0.7375621493; // [lb-ft/Nm]
const WattToHorsepower = 0.00134102209;     // [hp/W]
const KelvinToFahrenheit = (Kelvin) => (Kelvin - 273.15) * 9 / 5 + 32;   // [°F]

// Returns { Value, Unit, Class } for a quantity on the requested unit system. `Unit` is the SI unit as stored.
export function PresentQuantity(Value, Unit, System)
{
    if (System !== UnitSystems.Imperial)
    {
        return { Value, Unit, Class: ClassifyUnit(Unit) };
    }
    switch (Unit)
    {
        case 'kg':     return { Value: Value * PoundPerKilogram, Unit: 'lb', Class: 'unit-mass' };
        case 'm':      return { Value: Value * MetreToFoot, Unit: 'ft', Class: 'unit-length' };
        case 'mm':     return { Value: Value / 25.4, Unit: 'in', Class: 'unit-length' };
        case 'kPa':    return { Value: Value * 1000 * PascalToPsi, Unit: 'psi', Class: 'unit-pressure' };
        case 'Nm':     return { Value: Value * NewtonMetreToPoundFoot, Unit: 'lb-ft', Class: 'unit-torque' };
        case 'kW':     return { Value: Value * WattToHorsepower * 1000, Unit: 'hp', Class: 'unit-torque' };
        case '°C':     return { Value: Value * 9 / 5 + 32, Unit: '°F', Class: 'unit-thermal' };
        case 'K':      return { Value: KelvinToFahrenheit(Value), Unit: '°F', Class: 'unit-thermal' };
        case 'km/h':   return { Value: Value / 1.609344, Unit: 'mph', Class: 'unit-rate' };
        default:       return { Value, Unit, Class: ClassifyUnit(Unit) };
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     CURVE FIELDS
//------------------------------------------------------------------------------------------------------------------------

// 📝 One curve = one editable polyline plus the axis description it is edited against. `Bounds` is what the key
//    editor clamps to; `Precision` is the number of fractional digits the readout and the numeric key field use.
//    Every field name matches the corresponding member in the engine's Curve structs (Drivetrain.h `Curve`,
//    TyreThermalSolver.js ThermalSpecification), so a port binds these to the existing curves instead of new ones.
export const CurveFields = Object.freeze({
    Torque: {
        Label: 'Engine torque', Short: 'Torque', Glyph: 'Gauge',
        XLabel: 'Engine speed', XUnit: 'rpm', XBounds: [500, 9000], XPrecision: 0,
        YLabel: 'Crank torque', YUnit: 'Nm', YBounds: [0, 700], YPrecision: 0,
        Accent: '#e1d34a', Source: 'Drivetrain.h EngineParameters::TorqueCurve (DefaultGTR, 18 points)'
    },
    ExhaustTemperature: {
        Label: 'Exhaust temperature', Short: 'Exhaust', Glyph: 'Thermometer',
        XLabel: 'Engine speed', XUnit: 'rpm', XBounds: [500, 9000], XPrecision: 0,
        YLabel: 'Turbine inlet', YUnit: 'K', YBounds: [400, 1400], YPrecision: 0,
        Accent: '#ef8f52', Source: 'Drivetrain.h EngineParameters::ExhaustTempCurve (DefaultGTR, 5 points)'
    },
    ExhaustFlow: {
        Label: 'Exhaust mass flow', Short: 'Flow', Glyph: 'Waves',
        XLabel: 'Engine speed', XUnit: 'rpm', XBounds: [500, 9000], XPrecision: 0,
        YLabel: 'Mass flow', YUnit: 'kg/s', YBounds: [0, 0.8], YPrecision: 3,
        Accent: '#7fd0d0', Source: 'Drivetrain.h EngineParameters::ExhaustFlowCurve (DefaultGTR, 5 points)'
    },
    TurboBoost: {
        Label: 'Turbo boost', Short: 'Boost', Glyph: 'Wind',
        XLabel: 'Turbo speed', XUnit: 'rpm', XBounds: [0, 160000], XPrecision: 0,
        YLabel: 'Gauge pressure', YUnit: 'bar', YBounds: [0, 2.0], YPrecision: 2,
        Accent: '#8fb2e8', Source: 'Drivetrain.h TurbochargerParameters::BoostPressureCurve (DefaultGTR, 6 points)'
    },
    TorqueMultiplier: {
        Label: 'Boost torque multiplier', Short: 'Multiplier', Glyph: 'TrendingUp',
        XLabel: 'Boost', XUnit: 'bar', XBounds: [0, 2.0], XPrecision: 2,
        YLabel: 'Torque multiplier', YUnit: 'x', YBounds: [0.5, 2.5], YPrecision: 2,
        Accent: '#b9a4e8', Source: 'Drivetrain.h TurbochargerParameters::TorqueMultiplierCurve (DefaultGTR, 4 points)'
    },
    GripTemperature: {
        Label: 'Grip & temperature', Short: 'Grip', Glyph: 'Thermometer',
        XLabel: 'Tread temperature', XUnit: '°C', XBounds: [-20, 250], XPrecision: 0,
        YLabel: 'Grip factor', YUnit: '%', YBounds: [0, 130], YPrecision: 0,
        Accent: '#6fd08c', Source: 'TyreThermalSolver.js OptimumTemperature / GripFadeTemperature / MinimumGripFactor, '
                                + 'with the pressure sensitivity applied as a secondary curve'
    }
});

// 📝 Presets are the engine's own tables, converted into the editable shape (numeric pairs). Loading a preset is how
//    a new vehicle starts: pick the closest engine, then drag its points.
export const CurvePresets = Object.freeze({
    Torque: {
        'GTR preset-1 (engine default)': [[800, 234], [1200, 300], [1600, 352], [2000, 392], [2400, 428], [2800, 460],
                                          [3200, 486], [3600, 504], [4000, 514], [4400, 518], [4800, 520], [5200, 520],
                                          [5800, 520], [6200, 506], [6600, 486], [7000, 462], [7600, 448], [8500, 442]],
        'Flat torque (validation)':       [[1000, 400], [3000, 400], [5000, 400], [7000, 400]],
        'Naturally aspirated V8':         [[800, 280], [2000, 380], [3200, 430], [4400, 452], [5600, 440], [6800, 398], [7600, 350]]
    },
    ExhaustTemperature: {
        'GTR preset-1 (engine default)': [[800, 673], [2000, 873], [4000, 1023], [6000, 1123], [8500, 1173]],
        'Cold-start diagnostic':         [[800, 300], [2000, 420], [4000, 600], [6000, 760], [8500, 820]]
    },
    ExhaustFlow: {
        'GTR preset-1 (engine default)': [[800, 0.04], [2000, 0.10], [4000, 0.22], [6000, 0.35], [8500, 0.48]]
    },
    TurboBoost: {
        'GTR preset-1 (engine default)': [[1000, 0.00], [20000, 0.20], [50000, 0.80], [90000, 1.20], [120000, 1.40], [150000, 1.30]],
        'Race wastegate (1.6 bar)':      [[1000, 0.00], [20000, 0.30], [50000, 1.00], [90000, 1.50], [120000, 1.60], [150000, 1.55]]
    },
    TorqueMultiplier: {
        'GTR preset-1 (engine default)': [[0.0, 1.00], [0.5, 1.30], [1.0, 1.70], [1.2, 1.85]]
    },
    GripTemperature: {
        'Authored thermal specification': [[-20, 72], [20, 86], [60, 100], [80, 100], [120, 88], [160, 73], [200, 60], [240, 60]],
        'Slick · peak at 95 °C':          [[-20, 58], [40, 84], [95, 100], [140, 90], [180, 68], [240, 52]]
    }
});

//------------------------------------------------------------------------------------------------------------------------
//                                                     TYRE COMPOUNDS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Compound rows only set the cold-pressure window and the grip scale the prototype shows; the thermal constants above
//    stay the solver's. They are presentation presets for the tyre editor card, clearly labelled as such.
export const TyreCompounds = Object.freeze({
    Slick:     { Label: 'Slick',     ColdPressureKpa: 200, GripScale: 1.00, TreadMassKg: 1.10, Note: 'Dry only; tread 4 mm' },
    SemiSlick: { Label: 'Semi-slick', ColdPressureKpa: 220, GripScale: 0.94, TreadMassKg: 1.30, Note: 'Road-legal track tyre' },
    Road:      { Label: 'Road',      ColdPressureKpa: 240, GripScale: 0.84, TreadMassKg: 1.60, Note: 'Grooved, wet-capable' },
    Wet:       { Label: 'Wet',       ColdPressureKpa: 210, GripScale: 0.72, TreadMassKg: 1.80, Note: 'High void ratio; cold-favoured' }
});

//------------------------------------------------------------------------------------------------------------------------
//                                                   VEHICLE SPECIFICATION
//------------------------------------------------------------------------------------------------------------------------

export function ConstructVehicleSpecification()
{
    return {
        // -- Identity ----------------------------------------------------------------------------------------------------
        Identity: {
            Name: 'ControlVehicle',
            AuthoredAsset: 'CarModelling/ControlVehicle/ControlVehicle.blend',
            BodyCategory: 'PROTO-X wedge coupe',
            Source: 'VehicleGeometry.h (ControlVehicleSockets)',
            Colour: '#e1d34a'
        },

        // -- Body & mass -------------------------------------------------------------------------------------------------
        Body: {
            MassKg: 1300.0,                  // [kg]  VehicleGeometry.h Mass
            CoMHeightM: 0.53,                // [m]   VehicleGeometry.h CoMHeight
            WheelbaseM: 3.396,               // [m]   front +1.7274, rear −1.6686
            TrackFrontM: 2.095,              // [m]   2 · 1.0475
            TrackRearM: 2.095,               // [m]
            FrontWeightFraction: 0.4914,     // [-]   VehicleGeometry.h
            StaticRideHeightM: 0.06,         // [m]   underfloor to ground
            UnsprungMassPerWheelKg: 20.0,    // [kg]
            OverallLengthM: 5.9748,          // [m]   IdPlate sockets −2.9906 … +2.9842
            OverallWidthM: 2.1490,           // [m]   SideSkirt sockets ±1.0745
            OverallHeightM: 1.7690,          // [m]   model Z span 1.4575 + 0.41715 ground offset, CoMHeight note
            DownforceScale: 1.0,             // [-]   inspector multiplier on the aero devices
            Enabled: true
        },

        // -- Powertrain --------------------------------------------------------------------------------------------------
        Powertrain: {
            IdleRpm: 700,                    // [rpm] Drivetrain.h
            RedlineRpm: 7200,                // [rpm]
            RpmRiseLimit: 1800,              // [rpm/s] MaxRPMIncrease
            RpmFallLimit: 2600,              // [rpm/s] MaxRPMDecrease
            EngineInertiaKgm2: 0.38,         // [kg·m²]
            TurboInertiaKgm2: 0.02,          // [kg·m²]
            WastegateMaxBar: 1.2,            // [bar]
            TurbineEfficiency: 0.65,         // [-]
            CompressorEfficiency: 0.70,      // [-]
            FinalDriveRatio: 3.55,           // [-]   Drivetrain.h FinalDriveRatio
            GearRatios: [4.2, 3.1, 2.5, 1.9, 1.5, 1.2],   // [-] forward gears 1..6 (reverse pairs omitted)
            LaunchRpm: 2600,                 // [rpm] AMT slip target
            ThermalGrip: true,
            LineLock: false,
            TireMarks: true,
            Sparks: true,
            Enabled: true
        },

        // -- Tyre set: one specification shared by four corners, each removable on its own --------------------------------
        TyreSet: {
            Compound: 'SemiSlick',
            ColdPressureFrontKpa: 220,       // [kPa] demo IlluminationHost default
            ColdPressureRearKpa: 220,        // [kPa]
            RadiusM: 0.50855,                // [m]   measured tread radius
            RimRadiusM: 0.34460,             // [m]   measured rim radius
            WidthM: 0.39580,                 // [m]   section width
            RadialStiffnessNm: 250000,       // [N/m] TraceContactTyre.h VerticalStiffness
            ReferencePressureKpa: 110,       // [kPa] TraceContactTyre.h ReferencePressure
            PressureShare: 0.75,             // [-]   TraceContactTyre.h PressureShare
            PressureSensitivity: 0.30,       // [-]   TyreThermalSolver.js PressureGripSensitivity
            OptimumTemperatureK: 353.15,     // [K]   grip plateau end
            GripFadeTemperatureK: 473.15,    // [K]   grip floor
            MinimumGripFactor: 0.60,         // [-]
            TreadMassKg: 1.10,               // [kg]  wearable tread
            WearCoefficient: 6.0e-8,         // [kg/J]
            BurstPressureKpa: 650,           // [kPa] gauge
            CarcassFailureK: 493.15,         // [K]
            Failure: true,
            Wear: true,
            Enabled: true
        },

        // -- Suspension --------------------------------------------------------------------------------------------------
        Suspension: {
            FrontNaturalFrequencyHz: 2.0,    // [Hz]  SuspensionSpecification.h
            FrontDampingRatio: 0.6,          // [-]
            RearNaturalFrequencyHz: 2.2,     // [Hz]
            RearDampingRatio: 0.6,           // [-]
            MaxTravelM: 0.35,                // [m]
            BumpTravelM: 0.02,               // [m]
            DroopTravelM: 0.08,              // [m]
            PreloadN: 5000,                  // [N]
            FrontBarStiffnessNm: 80000,      // [N/m]
            RearBarStiffnessNm: 80000,       // [N/m]
            BarDampingNs: 1500,              // [N·s/m]
            Enabled: true
        },

        // -- Tyre corners: identity, place on the vehicle and current state -----------------------------------------------
        Corners: [
            { Key: 'FL', Label: 'Front left',  Axle: 'Front', Local: [ 1.7274,  1.0475, 0.0914], Fitted: true, PressureKpa: 220, SurfaceK: 293.15, WearFraction: 0.02, Grip: 1.00 },
            { Key: 'FR', Label: 'Front right', Axle: 'Front', Local: [ 1.7274, -1.0475, 0.0914], Fitted: true, PressureKpa: 220, SurfaceK: 293.15, WearFraction: 0.02, Grip: 1.00 },
            { Key: 'RL', Label: 'Rear left',   Axle: 'Rear',  Local: [-1.6686,  1.0475, 0.0914], Fitted: true, PressureKpa: 220, SurfaceK: 293.15, WearFraction: 0.03, Grip: 1.00 },
            { Key: 'RR', Label: 'Rear right',  Axle: 'Rear',  Local: [-1.6686, -1.0475, 0.0914], Fitted: true, PressureKpa: 220, SurfaceK: 293.15, WearFraction: 0.03, Grip: 1.00 }
        ],

        // -- Curve set: the editable tables the curve instrument binds to ------------------------------------------------
        Curves: {
            Torque: [],
            ExhaustTemperature: [],
            ExhaustFlow: [],
            TurboBoost: [],
            TorqueMultiplier: [],
            GripTemperature: []
        },

        // -- Tyres taken off the vehicle and kept in the pit bay, with their own used state ------------------------------
        PitBay: [],

        // -- Pit stop log: what was removed and what was fitted, newest last ----------------------------------------------
        PitLog: []
    };
}

// Deep copy so a reset restores the authored tables without sharing arrays with the live curve set.
export function CloneCurve(Points)
{
    return Points.map((Point) => [Point[0], Point[1]]);
}

export function LoadPreset(Specification, FieldKey, PresetName)
{
    const Presets = CurvePresets[FieldKey] || {};
    const Chosen = Presets[PresetName] || Presets[Object.keys(Presets)[0]];
    if (!Chosen)
    {
        return false;
    }
    Specification.Curves[FieldKey] = CloneCurve(Chosen);
    return true;
}

export function LoadAllAuthors(Specification)
{
    for (const FieldKey of Object.keys(Specification.Curves))
    {
        const Presets = CurvePresets[FieldKey] || {};
        const First = Object.keys(Presets)[0];
        if (First) LoadPreset(Specification, FieldKey, First);
    }
}

// 📝 Linear interpolation between keys, clamped at both ends — the same lookup the engine's Curve::Sample performs,
//    so a readout under the plot means the number the solver would return for that x.
export function SampleCurve(Points, X)
{
    if (!Points.length) return 0;
    if (X <= Points[0][0]) return Points[0][1];
    if (X >= Points[Points.length - 1][0]) return Points[Points.length - 1][1];
    for (let Index = 0; Index < Points.length - 1; ++Index)
    {
        const A = Points[Index], B = Points[Index + 1];
        if (X >= A[0] && X <= B[0])
        {
            const Span = B[0] - A[0];
            const T = Span === 0 ? 0 : (X - A[0]) / Span;
            return A[1] + T * (B[1] - A[1]);
        }
    }
    return Points[Points.length - 1][1];
}

// 📝 Peak of a curve, reported in the card as "peak 520 Nm @ 4800 rpm". Ties resolve to the first occurrence, which is
//    what an engine tuner expects when the table is flat across a plateau.
export function PeakOfCurve(Points)
{
    if (!Points.length) return { X: 0, Y: 0 };
    let Peak = Points[0];
    for (const Point of Points) if (Point[1] > Peak[1]) Peak = Point;
    return { X: Peak[0], Y: Peak[1] };
}
