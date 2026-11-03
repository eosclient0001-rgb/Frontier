//============================================================================================================================================
//                                                          INSPECTORMODEL.JS
//============================================================================================================================================
// 🧩 The vehicle inspector's editable state: curve key editing, tyre removal/refit, unit presentation and derived readings.

// 📝 Everything the inspector can change is a function here, and the DOM only reads the result. That keeps the rules
//    (monotone curve x, bounded y, a curve never drops below two keys, a removed tyre keeps its own state in the pit bay)
//    testable outside a browser: `node --test Tools/*.test.mjs` exercises this file directly.
//
//    Naming follows the engine: a curve's points are "keys", the tyre's place on the vehicle is its "corner", and the
//    set of removed-but-kept tyres is the "pit bay".

import { CurveFields, TyreCompounds, SampleCurve, PeakOfCurve, PresentQuantity, UnitSystems } from './VehicleSpecification.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                         CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Minimum separation between neighbouring keys in a curve's x axis, relative to that axis's precision, so two keys
//    can never collapse onto each other and create a vertical segment the interpolator cannot order.
export const KeySeparationFraction = 10;   // [-] - Multiplier on the axis precision step

const AmbientTemperatureK = 293.15;        // [K] - TyreThermalSolver.js AmbientTemperature

//------------------------------------------------------------------------------------------------------------------------
//                                                      CURVE KEY EDITING
//------------------------------------------------------------------------------------------------------------------------

function PrecisionStep(Field)
{
    return Math.pow(10, -Field.YPrecision);   // [-] - Smallest representable y increment
}

function XStep(Field)
{
    return Math.pow(10, -Field.XPrecision) * KeySeparationFraction;   // [x unit] - Smallest allowed x gap
}

function Clamp(Value, Low, High)
{
    return Value < Low ? Low : (Value > High ? High : Value);
}

function Round(Value, Digits)
{
    const Scale = Math.pow(10, Digits);
    return Math.round(Value * Scale) / Scale;
}

// 📝 Insertion: clamp y into the field bounds, clamp x into the axis bounds, refuse a key that would sit closer than the
//    minimum separation to an existing one, then insert in sorted order. Returns the new index or −1 when refused.
export function AddCurveKey(Points, FieldKey, X, Y)
{
    const Field = CurveFields[FieldKey];
    const ClampedX = Round(Clamp(X, Field.XBounds[0], Field.XBounds[1]), Field.XPrecision);
    const ClampedY = Round(Clamp(Y, Field.YBounds[0], Field.YBounds[1]), Field.YPrecision);
    const Gap = XStep(Field);
    for (const Existing of Points)
    {
        if (Math.abs(Existing[0] - ClampedX) < Gap) return -1;
    }
    let Index = 0;
    while (Index < Points.length && Points[Index][0] < ClampedX) ++Index;
    Points.splice(Index, 0, [ClampedX, ClampedY]);
    return Index;
}

// 📝 Movement: y clamps to the field bounds; x clamps to the axis bounds AND between its neighbours (minus the minimum
//    separation) so the polyline stays a function of x. First and last keys may still travel to the axis limits.
export function MoveCurveKey(Points, FieldKey, Index, X, Y)
{
    const Field = CurveFields[FieldKey];
    if (Index < 0 || Index >= Points.length) return false;
    const Gap = XStep(Field);
    const LowX = Index === 0 ? Field.XBounds[0] : Points[Index - 1][0] + Gap;
    const HighX = Index === Points.length - 1 ? Field.XBounds[1] : Points[Index + 1][0] - Gap;
    Points[Index][0] = Round(Clamp(X, LowX, Math.max(LowX, HighX)), Field.XPrecision);
    Points[Index][1] = Round(Clamp(Y, Field.YBounds[0], Field.YBounds[1]), Field.YPrecision);
    return true;
}

// 📝 A curve keeps at least two keys: one key is not a curve, and the sampler would have nothing to interpolate between.
export function RemoveCurveKey(Points, Index)
{
    if (Points.length <= 2) return false;
    if (Index < 0 || Index >= Points.length) return false;
    Points.splice(Index, 1);
    return true;
}

export function SortCurveKeys(Points)
{
    Points.sort((A, B) => A[0] - B[0]);
    return Points;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     CURVE READINGS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Peak torque, the speed it occurs at, and crank power integrated from the same table (P = T·ω). Power is derived, not
//    authored: it is reported with the curve that produced it so a tuned table never shows a stale figure.
//    💡 The power band stops at the engine's redline, not at the last key: the DefaultGTR table extends to 8500 rpm, which is
//    beyond its 7200 rpm redline — integrating the whole table would report a power the engine never reaches.
export function EvaluateTorqueCurve(Points, RedlineRpm)
{
    if (!Points.length) return { PeakTorqueNm: 0, PeakTorqueRpm: 0, PeakPowerKw: 0, PeakPowerRpm: 0, PowerAtRedlineKw: 0,
                                 PowerBandRpm: 0 };
    const RadiansPerSecondPerRpm = 2 * Math.PI / 60;   // [rad/s per rpm]
    const LastKey = Points[Points.length - 1][0];
    const Band = Math.min(RedlineRpm === undefined ? LastKey : RedlineRpm, LastKey);

    // 📝 Samples are the keys inside the band plus the band's own end point, so a redline that falls between two keys is
    //    evaluated on the interpolated torque rather than skipped.
    const Samples = Points.filter(([Rpm]) => Rpm <= Band).map(([Rpm, TorqueNm]) => [Rpm, TorqueNm]);
    if (Samples.length === 0 || Samples[Samples.length - 1][0] < Band) Samples.push([Band, SampleCurve(Points, Band)]);

    let PeakPowerKw = 0, PeakPowerRpm = 0;
    for (const [Rpm, TorqueNm] of Samples)
    {
        const Kilowatts = TorqueNm * Rpm * RadiansPerSecondPerRpm / 1000;   // [kW]
        if (Kilowatts > PeakPowerKw) { PeakPowerKw = Kilowatts; PeakPowerRpm = Rpm; }
    }
    const Peak = PeakOfCurve(Points);
    return {
        PeakTorqueNm: Peak.Y,
        PeakTorqueRpm: Peak.X,
        PeakPowerKw,
        PeakPowerRpm,
        PowerAtRedlineKw: SampleCurve(Points, Band) * Band * RadiansPerSecondPerRpm / 1000,
        PowerBandRpm: Band
    };
}

// 📝 Mean value across the sampled span: a quick way to see a curve flatten or spike without reading every key.
export function EvaluateCurveMean(Points)
{
    if (Points.length < 2) return Points.length ? Points[0][1] : 0;
    let Sum = 0;
    for (let Index = 0; Index < Points.length - 1; ++Index)
    {
        const [XA, YA] = Points[Index], [XB, YB] = Points[Index + 1];
        Sum += 0.5 * (YA + YB) * (XB - XA);
    }
    return Sum / (Points[Points.length - 1][0] - Points[0][0]);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    TYRE CORNERS
//------------------------------------------------------------------------------------------------------------------------

export function QueryCorner(Specification, CornerKey)
{
    return Specification.Corners.find((Corner) => Corner.Key === CornerKey) || null;
}

export function CountFittedTyres(Specification)
{
    return Specification.Corners.filter((Corner) => Corner.Fitted).length;
}

// 📝 Removal keeps the tyre: its own pressure, temperature, wear and grip travel into the pit bay, so refitting returns
//    the same used tyre and does not silently reset it to new. The corner itself stays on the vehicle — it is the hub,
//    which a pit stop does not remove — and reads as "no tyre fitted".
export function RemoveTyre(Specification, CornerKey, ClockSeconds)
{
    const Corner = QueryCorner(Specification, CornerKey);
    if (!Corner || !Corner.Fitted) return { Removed: false, Reason: 'no tyre fitted' };
    Specification.PitBay.push({
        Corner: CornerKey,
        Compound: Specification.TyreSet.Compound,
        PressureKpa: Corner.PressureKpa,
        SurfaceK: Corner.SurfaceK,
        WearFraction: Corner.WearFraction,
        Grip: Corner.Grip,
        RemovedAtSeconds: ClockSeconds,
        AgeSeconds: 0
    });
    Corner.Fitted = false;
    Corner.PressureKpa = 0;
    Corner.SurfaceK = AmbientTemperatureK;
    Corner.Grip = 0;
    Specification.PitLog.push({ AtSeconds: ClockSeconds, Action: 'Removed', Corner: CornerKey,
                                Detail: `${TyreCompounds[Specification.TyreSet.Compound].Label} · ${Corner.WearFraction * 100}% worn` });
    return { Removed: true, BayIndex: Specification.PitBay.length - 1 };
}

// 📝 Refit takes the most recently removed tyre for that corner when one is in the bay, otherwise it builds a fresh tyre
//    from the tyre set's current compound and cold pressure. Both paths write through the same corner fields the cards read.
export function FitTyre(Specification, CornerKey, ClockSeconds, ForceFresh = false)
{
    const Corner = QueryCorner(Specification, CornerKey);
    if (!Corner) return { Fitted: false, Reason: 'unknown corner' };
    if (Corner.Fitted) return { Fitted: false, Reason: 'a tyre is already fitted' };

    let BayIndex = -1;
    if (!ForceFresh)
    {
        for (let Index = Specification.PitBay.length - 1; Index >= 0; --Index)
        {
            if (Specification.PitBay[Index].Corner === CornerKey) { BayIndex = Index; break; }
        }
    }

    Corner.Fitted = true;
    if (BayIndex >= 0)
    {
        const Used = Specification.PitBay[BayIndex];
        Corner.PressureKpa = Used.PressureKpa;
        Corner.SurfaceK = Used.SurfaceK;
        Corner.WearFraction = Used.WearFraction;
        Corner.Grip = Used.Grip;
        Specification.PitBay.splice(BayIndex, 1);
        Specification.PitLog.push({ AtSeconds: ClockSeconds, Action: 'Refitted', Corner: CornerKey,
                                    Detail: `${TyreCompounds[Used.Compound].Label} · used, ${Used.WearFraction * 100}% worn` });
        return { Fitted: true, Used: true };
    }

    const TyreSet = Specification.TyreSet;
    const ColdPressure = Corner.Axle === 'Front' ? TyreSet.ColdPressureFrontKpa : TyreSet.ColdPressureRearKpa;
    Corner.PressureKpa = ColdPressure;
    Corner.SurfaceK = AmbientTemperatureK;
    Corner.Grip = 1.0;
    Corner.WearFraction = 0.0;
    Specification.PitLog.push({ AtSeconds: ClockSeconds, Action: 'Fitted new', Corner: CornerKey,
                                Detail: `${TyreCompounds[TyreSet.Compound].Label} · ${ColdPressure} kPa cold` });
    return { Fitted: true, Used: false };
}

// 📝 Grip follows the authored thermal rule: full grip up to the optimum tread temperature, fading linearly to the minimum
//    factor at the fade temperature, then scaled by the fractional cold-pressure deviation. Used by the tyre card and by
//    the demonstration sweep so the number on screen is computed, never typed.
export function EvaluateTyreGrip(Specification, Corner)
{
    const TyreSet = Specification.TyreSet;
    const Compound = TyreCompounds[TyreSet.Compound];
    const Optimum = TyreSet.OptimumTemperatureK;
    const Fade = Math.max(Optimum + 1, TyreSet.GripFadeTemperatureK);
    const Hot = Clamp((Corner.SurfaceK - Optimum) / (Fade - Optimum), 0, 1);
    const Thermal = 1 - Hot * (1 - TyreSet.MinimumGripFactor);
    const Cold = Corner.Axle === 'Front' ? TyreSet.ColdPressureFrontKpa : TyreSet.ColdPressureRearKpa;
    const Deviation = Cold > 0 ? (Corner.PressureKpa - Cold) / Cold : 0;
    const Pressure = Math.max(0.25, 1 - TyreSet.PressureSensitivity * Deviation);
    return Clamp(Thermal * Pressure * Compound.GripScale, 0, 1.3);
}

export function RefitAllTyres(Specification, ClockSeconds)
{
    for (const Corner of Specification.Corners)
    {
        if (!Corner.Fitted) FitTyre(Specification, Corner.Key, ClockSeconds);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   DERIVED VEHICLE READINGS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Static axle loads, sprung mass, yaw inertia and the rollover threshold all follow the engine's own formulas
//    (VehicleGeometry.h Inertia() and RolloverThresholdG()), so the inspector's derived card agrees with the solver's config.
export function EvaluateVehicleReadings(Specification)
{
    const Body = Specification.Body;
    const Gravity = 9.81;                                  // [m/s²]
    const SprungMassKg = Math.max(1, Body.MassKg - 4 * Body.UnsprungMassPerWheelKg);
    const FrontShare = Body.FrontWeightFraction;
    const YawRadiusGyration = 1.60;                        // [m] - VehicleGeometry.h YawRadiusGyration
    const FittedTyres = CountFittedTyres(Specification);
    const Torque = EvaluateTorqueCurve(Specification.Curves.Torque, Specification.Powertrain.RedlineRpm);
    const FirstGear = Specification.Powertrain.GearRatios[0];
    const FinalDrive = Specification.Powertrain.FinalDriveRatio;
    return {
        SprungMassKg,
        UnsprungMassKg: 4 * Body.UnsprungMassPerWheelKg,
        FrontLoadN: Body.MassKg * Gravity * FrontShare,
        RearLoadN: Body.MassKg * Gravity * (1 - FrontShare),
        YawInertiaKgm2: SprungMassKg * YawRadiusGyration * YawRadiusGyration,
        RolloverThresholdG: (0.5 * Body.TrackFrontM) / Body.CoMHeightM,
        WheelTorqueFirstGearNm: Torque.PeakTorqueNm * FirstGear * FinalDrive,
        SpecificPowerKwPerTonne: Torque.PeakPowerKw / (Body.MassKg / 1000),
        FittedTyres,
        FittedTreadMassKg: FittedTyres * Specification.TyreSet.TreadMassKg,
        PitBayCount: Specification.PitBay.length
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                     UNIT PRESENTATION
//------------------------------------------------------------------------------------------------------------------------

// 📝 A card row: label, SI value, SI unit, and the presented value/unit/class for the active unit system.
export function ConstructReading(Label, Value, Unit, System, Extra)
{
    const Presented = PresentQuantity(Value, Unit, System);
    return { Label, Value, Unit, PresentValue: Presented.Value, PresentUnit: Presented.Unit, UnitClass: Presented.Class,
             ...(Extra || {}) };
}

export function FormatReading(Reading, Digits)
{
    const Scale = Math.pow(10, Digits === undefined ? 1 : Digits);
    const Rounded = Math.round(Reading.PresentValue * Scale) / Scale;
    return `${Rounded} ${Reading.PresentUnit}`;
}

export { UnitSystems, AmbientTemperatureK };
