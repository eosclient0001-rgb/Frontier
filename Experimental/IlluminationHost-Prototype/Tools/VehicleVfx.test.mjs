import { test } from "node:test";
import assert from "node:assert/strict";
import { ResolveSparkCollision, ResolveSparkRadiance, SparkSequence } from "../Source/SparkSequence.js";
import { ResolveSteeringReturnRate, DriverInputIntegrator } from "../Source/DriverInputIntegrator.js";
import { TyreMarkDepot, TyreMarkLayout } from "../Source/TyreMarkDepot.js";
import { EncodeVehicleRecord, VehicleRecordBytes } from "../Source/VehicleRecord.js";
import { EffectSequence, EffectKind, DerezPresets } from "../Source/EffectSequence.js";

test("spark colours cool continuously to dark red and hot particles cluster into capped light slots", () => {
    const Hot = ResolveSparkRadiance(2100), Mid = ResolveSparkRadiance(1500), Cool = ResolveSparkRadiance(950);
    assert.ok(Hot[0] > Mid[0] && Mid[0] > Cool[0]);
    assert.ok(Hot[1] / Hot[0] > Mid[1] / Mid[0] && Mid[1] / Mid[0] > Cool[1] / Cool[0]);
    const Sparks = Object.create(SparkSequence.prototype);
    Sparks.Settings = { Enabled: true, Brightness: 1 };
    Sparks.Particles = [0, 1, 2, 3, 4].map((N) => ({ Position: [N * 3, 0, 1], Kelvin: 2100 }));
    assert.equal(Sparks.QueryLights(3).length, 3);
    Sparks.Settings.Enabled = false;
    assert.equal(Sparks.QueryLights(3).length, 0);
});

test("spark sweeps hit wall faces, ground and miss distant boxes", () => {
    const Wall = { Minimum: [1, -1, 0], Maximum: [1.2, 1, 3] };
    const Hit = ResolveSparkCollision([0, 0, 2], [2, 0, 2], [Wall]);
    assert.ok(Hit);
    assert.ok(Math.abs(Hit.Point[0] - 1) < 0.001);
    assert.deepEqual(Hit.Normal, [-1, 0, 0]);
    assert.equal(ResolveSparkCollision([0, 3, 2], [2, 3, 2], [Wall]), null);
    assert.ok(ResolveSparkCollision([0, 0, 3], [0, 0, -2], [])?.Normal[2] > 0);
});

test("visual tyres remain round while shredded rubber reaches rim and cabin header stays intact", () => {
    const Header = { SteeringAngle: 0.2, SeeThroughGlass: true, Column: [1, 2, 3], Axis: [1, 0, 0],
                     Cockpit: { Anchor: [0, 0, 0], Scale: 1, Offset: [0, 0, 0] } };
    const Wheels = [0, 1, 2, 3].map((N) => ({ Shredded: N === 2 }));
    const Record = EncodeVehicleRecord(Header, Wheels);
    assert.equal(Record.byteLength, VehicleRecordBytes);
    assert.ok(Math.abs(Record[0] - 0.2) < 1e-6);
    assert.equal(Record[20 + 2 * 4 + 3], 1);
    assert.equal(Record[20 + 3 * 4 + 3], 0);
});

test("hands-off steering self-centres by speed/grip; optional countersteer never overrides a held key", () => {
    assert.ok(ResolveSteeringReturnRate(20, 1) > ResolveSteeringReturnRate(0, 1));
    assert.ok(ResolveSteeringReturnRate(20, 1) > ResolveSteeringReturnRate(20, 0.3));
    const D = new DriverInputIntegrator();
    const Left = new Set(["KeyA"]);
    for (let I = 0; I < 30; I++) D.Advance(Left, 1 / 60, { Speed: 20, SideSpeed: -10, Countersteer: true });
    assert.ok(D.Steer > 0.7);
    for (let I = 0; I < 60; I++) D.Advance(new Set(), 1 / 60, { Speed: 20, SideSpeed: -5, Countersteer: true });
    assert.ok(D.Steer < 0 && D.Steer > -0.25);
    for (let I = 0; I < 60; I++) D.Advance(new Set(), 1 / 60, { Speed: 0, Countersteer: true });
    assert.ok(Math.abs(D.Steer) < 0.08);
});

test("derez and rez produce bounded lights that expire with the emitter", () => {
    const E = Object.create(EffectSequence.prototype);
    for (const Preset of Object.values(DerezPresets))
    {
        E.Settings = { ...Preset, Intensity: 1 };
        E.Clock = 0.5;
        E.Emitters = [{ Kind: EffectKind.VehicleRez, Start: 0, End: 1, Transform: new Float32Array(16) }];
        E.Recording = null;
        assert.ok(E.QueryLight()?.Intensity > 0);
        E.Clock = 1;
        assert.equal(E.QueryLight(), null);
    }
});

test("shredded wheels stamp only narrow rim marks, never new rubber or grooves", () => {
    globalThis.GPUTextureUsage = { TEXTURE_BINDING: 1, COPY_DST: 2 };
    const Writes = [];
    const Exchange = {
        ConstructTexture: ({ label }) => ({ label, createView: () => label }),
        ConstructSampler: () => ({}),
        Device: { queue: { writeTexture: (target) => Writes.push(target.texture.label) } }
    };
    const Depot = new TyreMarkDepot(Exchange);
    const Cell = TyreMarkLayout.Extent[0] / TyreMarkLayout.Texels[0];
    const X = TyreMarkLayout.Origin[0] + (200 + 0.5) * Cell;
    const Y = TyreMarkLayout.Origin[1] + (200 + 0.5) * Cell;
    const Reading = { ContactFraction: 1, OnDebris: false, SlidingPower: 60000, Seconds: 1 / 60,
                      ContactPoint: [X, Y, 0], ContactVelocity: [8, 0, 0], TreadVelocity: [8, 0, 0] };
    const Run = (shredded) => Depot.Advance([Reading], { Enabled: true, Strength: 1 }, [{ Shredded: shredded }]);
    Run(false);
    const Before = [...Depot.Tiles.values()].reduce((N, Tile) => N + Tile.Bytes.reduce((Sum, V, I) => Sum + (I % 2 ? 0 : V), 0), 0);
    assert.ok(Before > 0);
    Reading.ContactPoint = [X + 3, Y, 0];
    Run(true);
    const After = [...Depot.Tiles.values()].reduce((N, Tile) => N + Tile.Bytes.reduce((Sum, V, I) => Sum + (I % 2 ? 0 : V), 0), 0);
    const Rim = [...Depot.Tiles.values()].reduce((N, Tile) => N + Tile.RimBytes.reduce((Sum, V) => Sum + V, 0), 0);
    assert.equal(After, Before);
    assert.ok(Rim > 0);
    assert.ok(Writes.includes("Bare rim scrape deposit"));
    Depot.ResetTracking();
    assert.equal(Depot.Previous[0], null);
    assert.ok(Depot.Tiles.size > 0);
});
