//============================================================================================================================================
//                                                                 PRESETS.JS
//============================================================================================================================================
// 📦 Five starting scenes that approximate the reference motion looks, built only from schema defaults and overrides.

import { CreateLayer, CreateScene } from './SceneModel.js';

// 📝 These are starting points, not copies. Each one is tuned against the reference frames it is named after.
const Strand = (Label, Overrides) => CreateLayer('Strands', { Label, ...Overrides });
const Dust = (Label, Overrides) => CreateLayer('Particles', { Label, ...Overrides });
const Title = (Label, Overrides) => CreateLayer('Text', { Label, ...Overrides });

function OrganicFibres() {
    return CreateScene({
        Name: 'Organic fibres',
        Background: { Inner: '#0f2a66', Outer: '#03060f', Vignette: 0.55, Grain: 0.012 },
        Post: { Exposure: 1, Glow: 1.15, GlowSpread: 0.45, Saturation: 1.1, Brightness: 1 },
        Playback: { LoopSeconds: 12, Speed: 1 },
        Camera: { Yaw: -6, Pitch: 4, Distance: 9.5, Fov: 34 },
        Layers: [
            Strand('Main fibres', {
                Shape: 'Bezier', Strands: 260, Segments: 72, Seed: 11, Length: 12, Spread: 1.2, Amplitude: 2.4,
                Frequency: 1, Width: 0.03, Taper: 0.6, Intensity: 2.2, Core: 34, Halo: 0.3, Baseline: 0.12,
                ColourStart: '#18b4ff', ColourEnd: '#5fd9ff', ColourAccent: '#eaffff', AccentMix: 0.25,
                Window: 0.55, WindowCycles: 1, Sparks: 1, SparkSize: 0.045, SparkBrightness: 4,
                Direction: [1, 0.42, 0], Position: [-6.4, -2.6, 0], Rotation: [0, 0, -6],
            }),
            Strand('Thin fibres', {
                Shape: 'Bezier', Strands: 520, Segments: 64, Seed: 12, Length: 13, Spread: 1.6, Amplitude: 2.6,
                Frequency: 2, Width: 0.012, Taper: 0.5, Intensity: 1.1, Core: 40, Halo: 0.2, Baseline: 0.05,
                ColourStart: '#2a6dff', ColourEnd: '#6fe1ff', ColourAccent: '#ffffff', AccentMix: 0.15,
                Window: 0.4, WindowCycles: 2, Sparks: 0.3, SparkSize: 0.03, SparkBrightness: 2,
                Direction: [1, 0.38, 0], Position: [-6.4, -2.6, 0], Rotation: [0, 0, -6],
            }),
            Dust('Dust', {
                Count: 900, Size: 0.012, Brightness: 2.5, Colour: '#d6f3ff', Bokeh: 0.08, Focus: 9,
                Spread: 7, Drift: 0.6, Seed: 5,
            }),
            Title('Title', {
                Title: 'ORGANIC FIBRES', Subtitle: 'LIGHT IN MOTION', Face: 'Light', Align: 'Left',
                TitleSize: 0.056, SubtitleSize: 0.022, Tracking: 0.24, X: 0.6, Y: 0.36, Colour: '#e4f8ff', Glow: 0.35,
            }),
        ],
    });
}

function EmeraldSweep() {
    return CreateScene({
        Name: 'Emerald sweep',
        Background: { Inner: '#0b1a08', Outer: '#000000', Vignette: 0.6, Grain: 0.012 },
        Post: { Exposure: 1.05, Glow: 0.9, GlowSpread: 0.6, Saturation: 1.15, Brightness: 1 },
        Playback: { LoopSeconds: 12, Speed: 1 },
        Camera: { Yaw: 4, Pitch: -2, Distance: 11, Fov: 34 },
        Layers: [
            Strand('Sweep fibres', {
                Shape: 'Bezier', Strands: 110, Segments: 80, Seed: 21, Length: 13, Spread: 1.8, Amplitude: 3.2,
                Frequency: 1, Width: 0.045, Taper: 0.4, Intensity: 1.5, Core: 42, Halo: 0.2, Baseline: 0.06,
                ColourStart: '#7dff3a', ColourEnd: '#38c81e', ColourAccent: '#f4ffe0', AccentMix: 0.3,
                Window: 0.6, WindowCycles: 1, Sparks: 0.8, SparkSize: 0.1, SparkBrightness: 5,
                Direction: [1, 0.55, 0], Position: [-6, -3.4, 0], Rotation: [0, 0, 0],
            }),
            Dust('Bokeh', {
                Count: 40, Size: 0.09, Brightness: 1.2, Colour: '#c9ff9c', Bokeh: 1, Focus: 11,
                Spread: 6, Drift: 0.5, Seed: 8,
            }),
            Title('Title', {
                Title: 'TO BE', Subtitle: '', Face: 'Light', Align: 'Centre', TitleSize: 0.07,
                Tracking: 0.55, X: 0.5, Y: 0.5, Colour: '#e8ffe0', Glow: 0.15,
            }),
        ],
    });
}

function RadialBloom() {
    return CreateScene({
        Name: 'Radial bloom',
        Background: { Inner: '#0a2350', Outer: '#02040b', Vignette: 0.5, Grain: 0.012 },
        Post: { Exposure: 1, Glow: 1.4, GlowSpread: 0.55, Saturation: 1.05, Brightness: 1 },
        Playback: { LoopSeconds: 8, Speed: 1 },
        Camera: { Yaw: 0, Pitch: 0, Distance: 10, Fov: 35 },
        Layers: [
            Strand('Radial fibres', {
                Shape: 'Bloom', Strands: 900, Segments: 56, Seed: 31, Length: 3.2, Spread: 0, Ruffle: 0.7,
                Amplitude: 0.5, Frequency: 2, Width: 0.02, Taper: 0.5, Intensity: 1.6, Core: 22, Halo: 0.5,
                Baseline: 0.14, ColourStart: '#2d9bff', ColourEnd: '#3ff2ff', ColourAccent: '#ffffff', AccentMix: 0.2,
                Window: 0.4, WindowCycles: 3, Sparks: 0.9, SparkSize: 0.05, SparkBrightness: 4,
                Position: [0, 0, 0], Rotation: [0, 0, 0],
            }),
            Dust('Bokeh', {
                Count: 40, Size: 0.07, Brightness: 1.1, Colour: '#5cc4ff', Bokeh: 1, Focus: 10,
                Spread: 5, Drift: 0.4, Seed: 9,
            }),
        ],
    });
}

function EmberRibbons() {
    return CreateScene({
        Name: 'Ember ribbons',
        Width: 1080,
        Height: 1920,
        Background: { Inner: '#1d2330', Outer: '#07090d', Vignette: 0.45, Grain: 0.012 },
        Post: { Exposure: 1, Glow: 1.25, GlowSpread: 0.5, Saturation: 1.1, Brightness: 1 },
        Playback: { LoopSeconds: 10, Speed: 1 },
        Camera: { Yaw: 0, Pitch: 0, Distance: 17, Fov: 35 },
        Layers: [
            Strand('Ember ribbons', {
                Shape: 'Wave', Strands: 5, Segments: 120, Seed: 41, Length: 4.2, SheetWidth: 3, Ripple: 1.6,
                Waves: 0.9, PhaseSpread: 1.2, Width: 0.18, Taper: 0.35, Intensity: 1.8, Core: 9, Halo: 0.9,
                Baseline: 0.3, ColourStart: '#ff8a4c', ColourEnd: '#ffb37a', ColourAccent: '#fff1e6', AccentMix: 0.1,
                Window: 0.8, WindowCycles: 1, Sparks: 0, Position: [0, 0, 0], Rotation: [-8, 8, 3],
            }),
            Strand('Lavender lines', {
                Shape: 'Wave', Strands: 180, Segments: 120, Seed: 42, Length: 4.2, SheetWidth: 3, Ripple: 1.6,
                Waves: 0.9, PhaseSpread: 1.2, Width: 0.006, Taper: 0.3, Intensity: 0.6, Core: 40, Halo: 0.2,
                Baseline: 0.35, ColourStart: '#c8b6ff', ColourEnd: '#8e7bff', ColourAccent: '#ffffff', AccentMix: 0.2,
                Window: 0.5, WindowCycles: 2, Sparks: 0.1, SparkSize: 0.02, Position: [0, 0, 0], Rotation: [-8, 8, 3],
            }),
            Dust('Dust', {
                Count: 300, Size: 0.008, Brightness: 1.8, Colour: '#b9a8ff', Bokeh: 0.05, Focus: 14,
                Spread: 6, Drift: 0.7, Seed: 43,
            }),
        ],
    });
}

function SheetLines() {
    return CreateScene({
        Name: 'Sheet lines',
        Background: { Inner: '#081a3a', Outer: '#010309', Vignette: 0.5, Grain: 0.012 },
        Post: { Exposure: 1, Glow: 1, GlowSpread: 0.4, Saturation: 1, Brightness: 1 },
        Playback: { LoopSeconds: 8, Speed: 1 },
        Camera: { Yaw: 0, Pitch: 28, Distance: 13, Fov: 40 },
        Layers: [
            Strand('Sheet lines', {
                Shape: 'Wave', Strands: 260, Segments: 120, Seed: 51, Length: 14, SheetWidth: 9, Ripple: 1,
                Waves: 0.5, PhaseSpread: 0.9, Width: 0.01, Taper: 0.3, Intensity: 1.3, Core: 30, Halo: 0.25,
                Baseline: 0.25, ColourStart: '#4aa8ff', ColourEnd: '#b8ecff', ColourAccent: '#ffffff', AccentMix: 0.35,
                Window: 0.45, WindowCycles: 2, Sparks: 0.2, SparkSize: 0.03, SparkBrightness: 3,
                Position: [0, 0, 0], Rotation: [0, 0, 0],
            }),
            Dust('Glints', {
                Count: 1400, Size: 0.006, Brightness: 3, Colour: '#e7fbff', Bokeh: 0, Focus: 13,
                Spread: 9, Drift: 0.3, Seed: 52,
            }),
        ],
    });
}

export const PresetList = Object.freeze([
    { Key: 'organic-fibres', Label: 'Organic fibres', Build: OrganicFibres },
    { Key: 'emerald-sweep', Label: 'Emerald sweep', Build: EmeraldSweep },
    { Key: 'radial-bloom', Label: 'Radial bloom', Build: RadialBloom },
    { Key: 'ember-ribbons', Label: 'Ember ribbons', Build: EmberRibbons },
    { Key: 'sheet-lines', Label: 'Sheet lines', Build: SheetLines },
]);

export function BuildPreset(Index) {
    const Entry = PresetList[Index] || PresetList[0];
    return Entry.Build();
}
