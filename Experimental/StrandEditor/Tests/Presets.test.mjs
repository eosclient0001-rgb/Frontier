//============================================================================================================================================
//                                                              PRESETS.TEST.MJS
//============================================================================================================================================
// 📦 Node tests that every starter scene is valid, stable under normalisation and inside the budget.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BuildPreset, PresetList } from '../Source/Presets.js';
import { EstimateCost, NormalizeScene, VertexBudget } from '../Source/SceneModel.js';

test('there are five starter scenes with unique keys and labels', () => {
    assert.equal(PresetList.length, 5);
    assert.equal(new Set(PresetList.map((Preset) => Preset.Key)).size, 5);
    assert.equal(new Set(PresetList.map((Preset) => Preset.Label)).size, 5);
});

PresetList.forEach((Preset, Index) => {
    test('preset "' + Preset.Label + '" is stable under normalisation', () => {
        const Scene = BuildPreset(Index);
        assert.deepEqual(NormalizeScene(Scene), Scene);
    });

    test('preset "' + Preset.Label + '" has a visible layer, a loop and fits the vertex budget', () => {
        const Scene = BuildPreset(Index);
        assert.ok(Scene.Layers.some((Layer) => Layer.Visible), 'at least one visible layer');
        assert.ok(Scene.Playback.LoopSeconds >= 2);
        assert.ok(EstimateCost(Scene).Vertices <= VertexBudget);
        assert.ok(Scene.Layers.every((Layer) => Layer.Id.length > 0));
    });
});

test('the ember preset is portrait, matching the vertical reference frame', () => {
    const Ember = PresetList.findIndex((Preset) => Preset.Key === 'ember-ribbons');
    const Scene = BuildPreset(Ember);
    assert.equal(Scene.Width, 1080);
    assert.equal(Scene.Height, 1920);
});

test('the text presets carry copy that fits the reference layouts', () => {
    for (const Layer of BuildPreset(0).Layers.filter((Item) => Item.Mechanism === 'Text')) {
        assert.ok(Layer.Title.length > 0 && Layer.Title.length <= 120);
    }
});
