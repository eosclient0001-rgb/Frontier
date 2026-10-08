//============================================================================================================================================
//                                                          SCENESTRUCTURECHECKS.MJS                                                          
//============================================================================================================================================
// 📦 Node checks for schema clamping, idempotent normalisation, JSON round trips, and the Flower, Trail, path and pulse fields.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    CoerceField, CreateLayer, CreateScene, EstimateCost, FieldsFor, NormalizeScene, SceneFields, SceneFromJson,
    SceneToJson, StrandLimit, VertexBudget,
} from '../Source/SceneStructure.js';

test('the default scene carries every scene field at its declared default', () => {
    const Scene = CreateScene();
    assert.equal(Scene.Format, 'StrandEditor/2');
    assert.equal(Scene.Width, 1280);
    assert.equal(Scene.Height, 720);
    assert.equal(Scene.Playback.LoopSeconds, 8);
    assert.equal(Scene.Camera.Distance, 9);
    assert.deepEqual(Scene.Layers, []);
    for (const Definition of SceneFields) {
        assert.notEqual(Definition.Default ?? Definition.Min, undefined, Definition.Key);
    }
});

test('out-of-range numbers are clamped and integers are rounded', () => {
    const Scene = NormalizeScene({
        Post: { Exposure: 99, Glow: -4, Brightness: 0 },
        Camera: { Pitch: 500 },
        Width: 99999,
    });
    assert.equal(Scene.Post.Exposure, 4);
    assert.equal(Scene.Post.Glow, 0);
    assert.equal(Scene.Post.Brightness, 0.05);
    assert.equal(Scene.Camera.Pitch, 80);
    assert.equal(Scene.Width, 3840);
});

test('invalid colours and choices fall back to defaults instead of reaching the GPU', () => {
    const Layer = CreateLayer('Strands', { ColourStart: 'javascript:alert(1)', Shape: 'Torus', Strands: 1e9 });
    assert.equal(Layer.ColourStart, '#18b4ff');
    assert.equal(Layer.Shape, 'Bezier');
    assert.equal(Layer.Strands, StrandLimit);
    assert.equal(CoerceField({ Control: 'Colour', Default: '#000000' }, '#ABCDEF'), '#abcdef');
});

test('vectors reject wrong lengths and non-finite components', () => {
    const Definition = FieldsFor('Strands').find((Field) => Field.Key === 'Position');
    assert.deepEqual(CoerceField(Definition, [1, 2]), [0, 0, 0]);
    assert.deepEqual(CoerceField(Definition, [1, Number.NaN, 3]), [0, 0, 0]);
    assert.deepEqual(CoerceField(Definition, [1, 2, 99]), [1, 2, 30]);
});

test('normalisation is idempotent, so saving and reloading changes nothing', () => {
    const Scene = CreateScene({
        Name: 'Round trip',
        Layers: [
            CreateLayer('Strands', { Label: 'Fibres', Shape: 'Bloom', Strands: 300 }),
            CreateLayer('Particles', { Label: 'Dust', Count: 100 }),
            CreateLayer('Text', { Label: 'Title', Title: 'HELLO' }),
        ],
    });
    const Once = NormalizeScene(Scene);
    const Twice = NormalizeScene(Once);
    assert.deepEqual(Twice, Once);
    assert.deepEqual(SceneFromJson(SceneToJson(Scene)), Scene);
});

test('layer identifiers stay unique when a file repeats them, and unknown mechanisms are dropped', () => {
    const Scene = NormalizeScene({
        Layers: [
            { Id: 'Same', Mechanism: 'Particles', Count: 5 },
            { Id: 'Same', Mechanism: 'Particles', Count: 6 },
            { Id: 'Bad id!', Mechanism: 'Text', Title: 'X' },
            { Mechanism: 'Light', Intensity: 4 },
        ],
    });
    assert.equal(Scene.Layers.length, 3);
    const Identifiers = new Set(Scene.Layers.map((Layer) => Layer.Id));
    assert.equal(Identifiers.size, 3);
    assert.equal(Scene.Layers[0].Id, 'Same');
    assert.notEqual(Scene.Layers[1].Id, 'Same');
});

test('the cost estimate counts strand vertices and dust and flags an over-budget scene', () => {
    const Modest = CreateScene({ Layers: [CreateLayer('Strands', { Strands: 100, Segments: 64 }), CreateLayer('Particles', { Count: 50 })] });
    assert.deepEqual(EstimateCost(Modest), { Vertices: 100 * 64 * 6, Strands: 100, Dust: 50, OverBudget: false });
    const Heavy = CreateScene({ Layers: [CreateLayer('Strands', { Strands: 4000, Segments: 128 })] });
    assert.equal(EstimateCost(Heavy).OverBudget, 4000 * 128 * 6 > VertexBudget);
});

test('hidden layers do not count towards the estimate', () => {
    const Scene = CreateScene({ Layers: [CreateLayer('Particles', { Count: 500, Visible: false })] });
    assert.equal(EstimateCost(Scene).Dust, 0);
});

test('the schema offers the flower and trail shapes and rejects an unknown shape', () => {
    assert.equal(CoerceField(FieldsFor('Strands').find((Field) => Field.Key === 'Shape'), 'Flower'), 'Flower');
    assert.equal(CoerceField(FieldsFor('Strands').find((Field) => Field.Key === 'Shape'), 'Trail'), 'Trail');
    assert.equal(CoerceField(FieldsFor('Strands').find((Field) => Field.Key === 'Shape'), 'Spiral'), 'Bezier');
});

test('the pulse rate is a whole number of cycles per loop, clamped between zero and eight', () => {
    const Rate = FieldsFor('Strands').find((Field) => Field.Key === 'PulseRate');
    assert.equal(CoerceField(Rate, 2.6), 3);
    assert.equal(CoerceField(Rate, 40), 8);
    assert.equal(CoerceField(Rate, -3), 0);
});

test('the pulse shape falls back to Breathe for an unknown name', () => {
    const Shape = FieldsFor('Strands').find((Field) => Field.Key === 'PulseShape');
    assert.equal(CoerceField(Shape, 'Ripple'), 'Ripple');
    assert.equal(CoerceField(Shape, 'Strobe'), 'Breathe');
});

test('the scene path takes only known shapes and a radius inside its range', () => {
    const PathShape = SceneFields.find((Field) => Field.Key === 'Path.Shape');
    const PathSize = SceneFields.find((Field) => Field.Key === 'Path.Size');
    assert.equal(CoerceField(PathShape, 'Rose'), 'Rose');
    assert.equal(CoerceField(PathShape, 'Hexagon'), 'Ring');
    assert.equal(CoerceField(PathSize, 0.01), 0.5);
    assert.equal(CoerceField(PathSize, 500), 30);
});

test('a new scene is on black and writes format version two', () => {
    const Scene = CreateScene();
    assert.equal(Scene.Format, 'StrandEditor/2');
    assert.equal(Scene.Background.Inner, '#000000');
    assert.equal(Scene.Background.Outer, '#000000');
    assert.equal(Scene.Background.Grain, 0);
    assert.equal(Scene.Path.Shape, 'Ring');
});

test('a version one file loads with the new fields at their defaults and keeps its own values', () => {
    const Old = SceneFromJson(JSON.stringify({
        Format: 'StrandEditor/1',
        Layers: [{ Mechanism: 'Strands', Shape: 'Bezier', Strands: 20, Width: 0.03 }],
    }));
    const Layer = Old.Layers[0];
    assert.equal(Layer.Width, 0.03);
    assert.equal(Layer.FollowPath, false);
    assert.equal(Layer.PulseRate, 0);
    assert.equal(Layer.Flowers, 1);
});

test('a version one fibre core value carries over to the renamed sharpness setting', () => {
    const Old = SceneFromJson(JSON.stringify({
        Format: 'StrandEditor/1',
        Layers: [{ Mechanism: 'Strands', Shape: 'Bezier', Core: 57 }],
    }));
    assert.equal(Old.Layers[0].Sharpness, 57);
    assert.equal(Old.Layers[0].Core, undefined);
});
