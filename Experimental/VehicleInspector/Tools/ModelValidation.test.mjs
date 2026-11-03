//============================================================================================================================================
//                                                       MODELVALIDATION.TEST.MJS
//============================================================================================================================================
// 🧩 Node test suite for the vehicle inspector's editing rules, unit presentation and the engine's own curve lookup.

// 📝 The rules are in InspectorModel.js and VehicleSpecification.js, not in the DOM: these tests import those modules directly,
//    so a browser is not needed and the expected numbers come from the engine sources (Drivetrain.cpp DefaultGTR table,
//    VehicleGeometry.h geometry, TraceContactTyre.h stiffness) rather than from the prototype.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
    ConstructVehicleSpecification, LoadAllAuthors, LoadPreset, CurvePresets, CurveFields, SampleCurve, PeakOfCurve,
    PresentQuantity, UnitSystems, ClassifyUnit, TyreCompounds
} from '../Source/VehicleSpecification.js';
import {
    AddCurveKey, MoveCurveKey, RemoveCurveKey, SortCurveKeys, EvaluateTorqueCurve, EvaluateCurveMean,
    RemoveTyre, FitTyre, RefitAllTyres, EvaluateTyreGrip, EvaluateVehicleReadings, CountFittedTyres,
    AmbientTemperatureK
} from '../Source/InspectorModel.js';

function FreshSpecification()
{
    const Specification = ConstructVehicleSpecification();
    LoadAllAuthors(Specification);
    return Specification;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                   ENGINE TABLE PARITY
//------------------------------------------------------------------------------------------------------------------------

test('the torque curve is the engine default table', () =>
{
    const Specification = FreshSpecification();
    const Torque = Specification.Curves.Torque;
    assert.equal(Torque.length, 18, 'DefaultGTR has 18 keys');
    assert.deepEqual(Torque[0], [800, 234], 'first key is 800 rpm / 234 Nm');
    assert.deepEqual(Torque[Torque.length - 1], [8500, 442], 'last key is 8500 rpm / 442 Nm');
});

test('curve lookup matches linear interpolation between keys', () =>
{
    const Points = [[1000, 100], [2000, 200], [3000, 150]];
    assert.equal(SampleCurve(Points, 500), 100, 'below the first key clamps');
    assert.equal(SampleCurve(Points, 1500), 150, 'midpoint interpolates');
    assert.equal(SampleCurve(Points, 2500), 175, 'descending segment interpolates');
    assert.equal(SampleCurve(Points, 9000), 150, 'above the last key clamps');
});

test('peak power is integrated from the torque table, inside the redline', () =>
{
    const Specification = FreshSpecification();
    const Redline = Specification.Powertrain.RedlineRpm;
    const Evaluated = EvaluateTorqueCurve(Specification.Curves.Torque, Redline);
    assert.equal(Evaluated.PeakTorqueNm, 520, 'peak torque is 520 Nm');
    assert.equal(Evaluated.PeakTorqueRpm, 4800, 'first key at 520 Nm is 4800 rpm');
    assert.equal(Evaluated.PowerBandRpm, 7200, 'the power band stops at the 7200 rpm redline');
    // Interpolated 457.33 Nm at 7200 rpm = 344.8 kW. Integrating the whole 8500 rpm table would report 393 kW instead.
    assert.ok(Evaluated.PeakPowerKw > 340 && Evaluated.PeakPowerKw < 350, `peak power ${Evaluated.PeakPowerKw} kW`);
    assert.equal(Evaluated.PeakPowerRpm, 7200, 'peak power sits at the redline for this table');
    assert.ok(Math.abs(Evaluated.PowerAtRedlineKw - Evaluated.PeakPowerKw) < 1e-9, 'band end is the reported peak');

    // 📝 A table whose tail rises above the redline must not leak power past it.
    const FlatTail = [[1000, 200], [7000, 400], [9000, 900]];
    const Capped = EvaluateTorqueCurve(FlatTail, 7000);
    assert.equal(Capped.PeakPowerRpm, 7000);
    assert.ok(Capped.PeakPowerKw < 400 * 9000 * 2 * Math.PI / 60 / 1000, 'the 9000 rpm key is outside the band');
});

test('mean of a monotone ramp is the mid value', () =>
{
    assert.equal(EvaluateCurveMean([[0, 0], [10, 10]]), 5);
});

//------------------------------------------------------------------------------------------------------------------------
//                                                       CURVE EDITING
//------------------------------------------------------------------------------------------------------------------------

test('adding a key keeps the curve sorted and bounded', () =>
{
    const Specification = FreshSpecification();
    const Points = Specification.Curves.Torque;
    const Index = AddCurveKey(Points, 'Torque', 6100, 6000);
    assert.ok(Index > 0, 'accepted');
    assert.equal(Points[Index][1], 700, 'y clamps to the 700 Nm field bound');
    for (let Step = 1; Step < Points.length; ++Step) assert.ok(Points[Step][0] > Points[Step - 1][0], 'x stays increasing');
});

test('a key closer than the minimum separation is refused', () =>
{
    const Points = [[1000, 100], [2000, 200]];
    assert.equal(AddCurveKey(Points, 'Torque', 2000.5, 300), -1);
    assert.equal(Points.length, 2, 'nothing was inserted');
});

test('moving a key cannot cross its neighbours', () =>
{
    const Points = [[1000, 100], [2000, 200], [3000, 300]];
    MoveCurveKey(Points, 'Torque', 1, 5000, 200);
    assert.ok(Points[1][0] < Points[2][0], 'x stays below the next key');
    assert.ok(Points[1][0] > Points[0][0], 'x stays above the previous key');
    MoveCurveKey(Points, 'Torque', 0, 5900, 100);
    assert.ok(Points[0][0] < Points[1][0], 'the first key stops short of the second');
});

test('a curve never drops below two keys', () =>
{
    const Points = [[1000, 100], [2000, 200]];
    assert.equal(RemoveCurveKey(Points, 0), false);
    assert.equal(Points.length, 2);
    Points.push([3000, 300]);
    assert.equal(RemoveCurveKey(Points, 1), true);
    assert.deepEqual(Points, [[1000, 100], [3000, 300]]);
});

test('sorting restores a monotone x axis after an external edit', () =>
{
    const Points = [[3000, 1], [1000, 2], [2000, 3]];
    SortCurveKeys(Points);
    assert.deepEqual(Points.map((Point) => Point[0]), [1000, 2000, 3000]);
});

test('every curve field declares bounds, units and a source', () =>
{
    for (const [Key, Field] of Object.entries(CurveFields))
    {
        assert.ok(Field.XBounds[0] < Field.XBounds[1], `${Key} x bounds ordered`);
        assert.ok(Field.YBounds[0] < Field.YBounds[1], `${Key} y bounds ordered`);
        assert.ok(Field.XUnit.length > 0 && Field.YUnit.length > 0, `${Key} carries units`);
        assert.ok(Field.Source.length > 0, `${Key} names its engine source`);
        assert.ok(CurvePresets[Key] && Object.keys(CurvePresets[Key]).length > 0, `${Key} has a preset`);
    }
});

test('loading a preset replaces the keys without sharing the array', () =>
{
    const Specification = FreshSpecification();
    LoadPreset(Specification, 'Torque', 'Naturally aspirated V8');
    assert.equal(Specification.Curves.Torque.length, 7);
    AddCurveKey(Specification.Curves.Torque, 'Torque', 5000, 445);
    assert.equal(CurvePresets.Torque['Naturally aspirated V8'].length, 7, 'the preset table was not mutated');
});

//------------------------------------------------------------------------------------------------------------------------
//                                                        TYRE CORNERS
//------------------------------------------------------------------------------------------------------------------------

test('a removed tyre is kept in the pit bay with its own state', () =>
{
    const Specification = FreshSpecification();
    const Corner = Specification.Corners[0];
    Corner.PressureKpa = 187;
    Corner.SurfaceK = 361.15;
    Corner.WearFraction = 0.42;

    const Removed = RemoveTyre(Specification, 'FL', 12);
    assert.equal(Removed.Removed, true);
    assert.equal(Corner.Fitted, false);
    assert.equal(Corner.PressureKpa, 0, 'a hub with no tyre holds no pressure');
    assert.equal(Specification.PitBay.length, 1);
    assert.equal(Specification.PitBay[0].PressureKpa, 187);
    assert.equal(Specification.PitBay[0].WearFraction, 0.42);
    assert.equal(Specification.PitLog.at(-1).Action, 'Removed');
});

test('refitting returns the same used tyre', () =>
{
    const Specification = FreshSpecification();
    const Corner = Specification.Corners[1];
    Corner.PressureKpa = 205;
    Corner.WearFraction = 0.31;
    RemoveTyre(Specification, 'FR', 20);
    const Fitted = FitTyre(Specification, 'FR', 84);
    assert.equal(Fitted.Used, true);
    assert.equal(Corner.Fitted, true);
    assert.equal(Corner.PressureKpa, 205);
    assert.equal(Corner.WearFraction, 0.31);
    assert.equal(Specification.PitBay.length, 0);
    assert.equal(Specification.PitLog.at(-1).Action, 'Refitted');
});

test('an empty bay fits a new tyre at the set cold pressure and ambient', () =>
{
    const Specification = FreshSpecification();
    const Corner = Specification.Corners[2];
    Specification.TyreSet.ColdPressureRearKpa = 215;
    RemoveTyre(Specification, 'RL', 30);
    Specification.PitBay.length = 0;
    const Fitted = FitTyre(Specification, 'RL', 31);
    assert.equal(Fitted.Used, false);
    assert.equal(Corner.PressureKpa, 215);
    assert.equal(Corner.SurfaceK, AmbientTemperatureK);
    assert.equal(Corner.WearFraction, 0);
});

test('a fitted corner cannot be fitted twice or removed twice', () =>
{
    const Specification = FreshSpecification();
    assert.equal(FitTyre(Specification, 'FL', 1).Fitted, false);
    RemoveTyre(Specification, 'FL', 2);
    assert.equal(RemoveTyre(Specification, 'FL', 3).Removed, false);
    assert.equal(Specification.PitBay.length, 1);
});

test('removing one tyre leaves the other three on the vehicle', () =>
{
    const Specification = FreshSpecification();
    RemoveTyre(Specification, 'RR', 5);
    assert.equal(CountFittedTyres(Specification), 3);
    assert.deepEqual(Specification.Corners.map((Corner) => Corner.Fitted), [true, true, true, false]);
});

test('grip fades from the optimum to the floor and follows pressure', () =>
{
    const Specification = FreshSpecification();
    const Corner = Specification.Corners[0];
    Specification.TyreSet.Compound = 'Slick';
    Corner.SurfaceK = 353.15;
    const AtOptimum = EvaluateTyreGrip(Specification, Corner);
    assert.ok(Math.abs(AtOptimum - 1) < 1e-9, `optimum tread gives full grip (${AtOptimum})`);

    Corner.SurfaceK = 473.15;
    const AtFade = EvaluateTyreGrip(Specification, Corner);
    assert.ok(Math.abs(AtFade - 0.6) < 1e-9, `fade temperature gives the minimum factor (${AtFade})`);

    Corner.SurfaceK = 353.15;
    Corner.PressureKpa = 220 * 1.2;
    const OverInflated = EvaluateTyreGrip(Specification, Corner);
    assert.ok(Math.abs(OverInflated - 0.94) < 1e-9, `20 % over-pressure costs 6 % grip (${OverInflated})`);
});

test('every tyre compound names a cold pressure and a note', () =>
{
    for (const [Key, Compound] of Object.entries(TyreCompounds))
    {
        assert.ok(Compound.ColdPressureKpa >= 150 && Compound.ColdPressureKpa <= 300, `${Key} cold pressure is plausible`);
        assert.ok(Compound.Note.length > 0, `${Key} carries a note`);
    }
});

//------------------------------------------------------------------------------------------------------------------------
//                                                    DERIVED READINGS
//------------------------------------------------------------------------------------------------------------------------

test('static loads, inertia and rollover limit follow the engine formulas', () =>
{
    const Specification = FreshSpecification();
    const Readings = EvaluateVehicleReadings(Specification);
    const Gravity = 9.81;
    assert.ok(Math.abs(Readings.FrontLoadN - 1300 * Gravity * 0.4914) < 1e-6, 'front axle load');
    assert.ok(Math.abs(Readings.RearLoadN - 1300 * Gravity * (1 - 0.4914)) < 1e-6, 'rear axle load');
    assert.equal(Readings.SprungMassKg, 1300 - 4 * 20, 'sprung mass excludes the unsprung corners');
    assert.ok(Math.abs(Readings.YawInertiaKgm2 - 1220 * 1.6 * 1.6) < 1e-6, 'yaw inertia is m·k²');
    assert.ok(Math.abs(Readings.RolloverThresholdG - (0.5 * 2.095) / 0.53) < 1e-9, 'rollover threshold is half-track / CoM height');
});

test('wheel torque in first gear comes from the edited curve', () =>
{
    const Specification = FreshSpecification();
    const Before = EvaluateVehicleReadings(Specification).WheelTorqueFirstGearNm;
    Specification.Curves.Torque = [[1000, 200], [4000, 600]];
    const After = EvaluateVehicleReadings(Specification).WheelTorqueFirstGearNm;
    assert.equal(Before, 520 * 4.2 * 3.55);
    assert.equal(After, 600 * 4.2 * 3.55);
});

test('refitting every corner restores a full set', () =>
{
    const Specification = FreshSpecification();
    RemoveTyre(Specification, 'FL', 1);
    RemoveTyre(Specification, 'RR', 2);
    RefitAllTyres(Specification, 3);
    assert.equal(CountFittedTyres(Specification), 4);
    assert.equal(Specification.PitBay.length, 0);
});

//------------------------------------------------------------------------------------------------------------------------
//                                                    UNIT PRESENTATION
//------------------------------------------------------------------------------------------------------------------------

test('SI presentation leaves values and units untouched', () =>
{
    const Presented = PresentQuantity(1300, 'kg', UnitSystems.SI);
    assert.equal(Presented.Value, 1300);
    assert.equal(Presented.Unit, 'kg');
});

test('imperial presentation converts mass, length, pressure, torque and temperature', () =>
{
    assert.ok(Math.abs(PresentQuantity(1300, 'kg', UnitSystems.Imperial).Value - 2866.009) < 0.01);
    assert.ok(Math.abs(PresentQuantity(3.396, 'm', UnitSystems.Imperial).Value - 11.1417) < 0.001);
    assert.ok(Math.abs(PresentQuantity(220, 'kPa', UnitSystems.Imperial).Value - 31.908) < 0.01);
    assert.ok(Math.abs(PresentQuantity(520, 'Nm', UnitSystems.Imperial).Value - 383.53) < 0.01);
    assert.ok(Math.abs(PresentQuantity(353.15, 'K', UnitSystems.Imperial).Value - 176) < 0.01);
    assert.ok(Math.abs(PresentQuantity(80, '°C', UnitSystems.Imperial).Value - 176) < 0.01);
});

test('units map to their colour class and unknown units fall back to the fraction class', () =>
{
    assert.equal(ClassifyUnit('kg'), 'unit-mass');
    assert.equal(ClassifyUnit('Nm'), 'unit-torque');
    assert.equal(ClassifyUnit('kPa'), 'unit-pressure');
    assert.equal(ClassifyUnit('°C'), 'unit-thermal');
    assert.equal(ClassifyUnit('rpm'), 'unit-rate');
    assert.equal(ClassifyUnit('nonsense'), 'unit-fraction');
});
