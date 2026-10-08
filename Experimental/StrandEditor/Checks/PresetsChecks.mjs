//============================================================================================================================================
//                                                             PRESETSCHECKS.MJS                                                              
//============================================================================================================================================
// 📦 Node checks that every starter scene is valid, stable under normalisation, on black, and inside the budget.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BuildPreset, PresetList } from '../Source/Presets.js';
import { EstimateCost, NormalizeScene, VertexBudget } from '../Source/SceneStructure.js';

test('there are eight starter scenes with unique keys and labels', () => {
    assert.equal(PresetList.length, 8);
    assert.equal(new Set(PresetList.map((Preset) => Preset.Key)).size, 8);
    assert.equal(new Set(PresetList.map((Preset) => Preset.Label)).size, 8);
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

    test('preset "' + Preset.Label + '" sits on pure black with no grain or vignette lifting the floor', () => {
        const Scene = BuildPreset(Index);
        assert.equal(Scene.Background.Inner, '#000000');
        assert.equal(Scene.Background.Outer, '#000000');
        assert.equal(Scene.Background.Grain, 0);
        assert.equal(Scene.Background.Vignette, 0);
    });
});

test('the ember preset is portrait, matching the vertical reference frame', () => {
    const Ember = PresetList.findIndex((Preset) => Preset.Key === 'ember-ribbons');
    const Scene = BuildPreset(Ember);
    assert.equal(Scene.Width, 1080);
    assert.equal(Scene.Height, 1920);
});

test('the text presets carry copy that fits the reference layouts', () => {
    for (const Layer of BuildPreset(0).Layers.filter((Member) => Member.Mechanism === 'Text')) {
        assert.ok(Layer.Title.length > 0 && Layer.Title.length <= 120);
    }
});

test('every strand in every preset is thin: fibre width at most 8 mm, except the portrait ribbons', () => {
    for (let Index = 0; Index < PresetList.length; Index++) {
        const Scene = BuildPreset(Index);
        for (const Layer of Scene.Layers.filter((Member) => Member.Mechanism === 'Strands')) {
            if (Scene.Width === 1080) continue;
            assert.ok(Layer.Width <= 0.008, PresetList[Index].Label + ' / ' + Layer.Label + ' is ' + Layer.Width + ' m wide');
        }
    }
});

test('the flower and trail presets carry the objects they are named for', () => {
    const Flower = BuildPreset(PresetList.findIndex((Preset) => Preset.Key === 'flower-path'));
    const Heads = Flower.Layers.filter((Layer) => Layer.Shape === 'Flower');
    const Tails = Flower.Layers.filter((Layer) => Layer.Shape === 'Trail');
    assert.equal(Flower.Path.Shape, 'Rose');
    assert.ok(Heads.length >= 1 && Heads.every((Layer) => Layer.FollowPath && Layer.Flowers >= 2));
    assert.ok(Tails.length >= 1 && Tails.every((Layer) => Layer.TrailLength > 0 && Layer.TrailLength < 1));
    const Weave = BuildPreset(PresetList.findIndex((Preset) => Preset.Key === 'path-weave'));
    assert.equal(Weave.Path.Shape, 'Weave');
    assert.ok(Weave.Layers.some((Layer) => Layer.Shape === 'Trail'));
    const Bloom = BuildPreset(PresetList.findIndex((Preset) => Preset.Key === 'flower-bloom'));
    assert.ok(Bloom.Layers.some((Layer) => Layer.Shape === 'Flower' && Layer.Petals >= 3));
});

test('most presets pulse: at least six of the eight carry a non-zero pulse rate', () => {
    const Pulsing = PresetList.filter((Preset, Index) =>
        BuildPreset(Index).Layers.some((Layer) => Layer.Mechanism === 'Strands' && Layer.PulseRate > 0));
    assert.ok(Pulsing.length >= 6, 'pulsing presets: ' + Pulsing.length);
});
