//============================================================================================================================================
//                                                                 PRESETS.JS                                                                 
//============================================================================================================================================
// 📦 Nine starting scenes built from schema defaults and overrides: fibres, flowers, a rose path, a weave and an automotive trim loop, all on black.

import { CreateLayer, CreateScene } from './SceneStructure.js';

// 📝 These are starting points, not copies. Every scene sits on pure black: the blue haze in the references is light
//    in the output, not a backdrop, so the frame carries no colour where no fibre or flower is drawn.
const Strand = (Label, Overrides) => CreateLayer('Strands', { Label, ...Overrides });
const Dust = (Label, Overrides) => CreateLayer('Particles', { Label, ...Overrides });
const Title = (Label, Overrides) => CreateLayer('Text', { Label, ...Overrides });

const Black = () => ({ Inner: '#000000', Outer: '#000000', Vignette: 0, Grain: 0 });

// 📝 Fibre thickness is set in pixels at 1080 p, so these are the widths a viewer sees. Values from 1.0 to 1.6 read as
//    single hairlines; the halo, not the width, carries the glow.
function OrganicFibres() {
    return CreateScene({
        Name: 'Organic fibres',
        Background: Black(),
        Post: { Exposure: 1, Glow: 0.9, GlowSpread: 0.45, Saturation: 1.1, Brightness: 1 },
        Playback: { LoopSeconds: 12, Speed: 1 },
        Camera: { Yaw: -6, Pitch: 4, Distance: 9.5, Fov: 34 },
        Layers: [
            Strand('Main fibres', {
                Shape: 'Bezier', Strands: 200, Segments: 72, Seed: 11, Length: 12, Spread: 1.2, Amplitude: 2.4,
                Frequency: 1, Thickness: 1.5, Taper: 0.6, Intensity: 1.15, Halo: 0.12, Baseline: 0.1,
                ColourStart: '#18b4ff', ColourEnd: '#5fd9ff', ColourAccent: '#eaffff', AccentMix: 0.25,
                Window: 0.55, WindowCycles: 1, Sparks: 0.8, SparkSize: 0.02, SparkBrightness: 3,
                PulseRate: 1, PulseDepth: 0.25, PulseShape: 'Breathe',
                Direction: [1, 0.42, 0], Position: [-6.4, -2.6, 0], Rotation: [0, 0, -6],
            }),
            Strand('Thin fibres', {
                Shape: 'Bezier', Strands: 340, Segments: 64, Seed: 12, Length: 13, Spread: 1.6, Amplitude: 2.6,
                Frequency: 2, Thickness: 1, Taper: 0.5, Intensity: 0.85, Halo: 0.1, Baseline: 0.05,
                ColourStart: '#2a6dff', ColourEnd: '#6fe1ff', ColourAccent: '#ffffff', AccentMix: 0.15,
                Window: 0.4, WindowCycles: 2, Sparks: 0.3, SparkSize: 0.012, SparkBrightness: 2,
                PulseRate: 1, PulseDepth: 0.25, PulseShape: 'Breathe',
                Direction: [1, 0.38, 0], Position: [-6.4, -2.6, 0], Rotation: [0, 0, -6],
            }),
            Dust('Dust', {
                Count: 700, Size: 0.008, Brightness: 2.4, Colour: '#d6f3ff', Bokeh: 0.06, Focus: 9,
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
        Background: Black(),
        Post: { Exposure: 1.05, Glow: 0.9, GlowSpread: 0.6, Saturation: 1.15, Brightness: 1 },
        Playback: { LoopSeconds: 12, Speed: 1 },
        Camera: { Yaw: 4, Pitch: -2, Distance: 11, Fov: 34 },
        Layers: [
            Strand('Sweep fibres', {
                Shape: 'Bezier', Strands: 170, Segments: 80, Seed: 21, Length: 13, Spread: 1.8, Amplitude: 3.2,
                Frequency: 1, Thickness: 1.4, Taper: 0.4, Intensity: 1.3, Halo: 0.2, Baseline: 0.05,
                ColourStart: '#7dff3a', ColourEnd: '#38c81e', ColourAccent: '#f4ffe0', AccentMix: 0.3,
                Window: 0.6, WindowCycles: 1, Sparks: 0.6, SparkSize: 0.018, SparkBrightness: 3,
                PulseRate: 2, PulseDepth: 0.35, PulseShape: 'Ripple',
                Direction: [1, 0.55, 0], Position: [-6, -3.4, 0], Rotation: [0, 0, 0],
            }),
            Dust('Bokeh', {
                Count: 30, Size: 0.06, Brightness: 0.6, Colour: '#c9ff9c', Bokeh: 1, Focus: 11,
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
        Background: Black(),
        Post: { Exposure: 1, Glow: 1.3, GlowSpread: 0.55, Saturation: 1.05, Brightness: 1 },
        Playback: { LoopSeconds: 8, Speed: 1 },
        Camera: { Yaw: 0, Pitch: 0, Distance: 10, Fov: 35 },
        Layers: [
            Strand('Radial fibres', {
                Shape: 'Bloom', Strands: 900, Segments: 56, Seed: 31, Length: 3.2, Spread: 0, Ruffle: 0.7,
                Amplitude: 0.5, Frequency: 2, Thickness: 1.2, Taper: 0.5, Intensity: 1.3, Halo: 0.2, Baseline: 0.1,
                ColourStart: '#2d9bff', ColourEnd: '#3ff2ff', ColourAccent: '#ffffff', AccentMix: 0.2,
                Window: 0.4, WindowCycles: 3, Sparks: 0.7, SparkSize: 0.02, SparkBrightness: 3,
                PulseRate: 2, PulseDepth: 0.3, PulseShape: 'Breathe',
                Position: [0, 0, 0], Rotation: [0, 0, 0],
            }),
            Dust('Bokeh', {
                Count: 30, Size: 0.06, Brightness: 1, Colour: '#5cc4ff', Bokeh: 1, Focus: 10,
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
        Background: Black(),
        Post: { Exposure: 1, Glow: 1.25, GlowSpread: 0.5, Saturation: 1.1, Brightness: 1 },
        Playback: { LoopSeconds: 10, Speed: 1 },
        Camera: { Yaw: 0, Pitch: 0, Distance: 17, Fov: 35 },
        Layers: [
            Strand('Ember fibres', {
                Shape: 'Wave', Strands: 140, Segments: 120, Seed: 41, Length: 4.2, SheetWidth: 3, Ripple: 1.6,
                Waves: 0.9, PhaseSpread: 1.2, Thickness: 1.8, Taper: 0.35, Intensity: 1.4, Halo: 0.35, Baseline: 0.25,
                ColourStart: '#ff8a4c', ColourEnd: '#ffb37a', ColourAccent: '#fff1e6', AccentMix: 0.1,
                Window: 0.8, WindowCycles: 1, Sparks: 0.2, SparkSize: 0.02, SparkBrightness: 3,
                PulseRate: 1, PulseDepth: 0.6, PulseShape: 'Ripple',
                Position: [0, 0, 0], Rotation: [-8, 8, 3],
            }),
            Strand('Lavender lines', {
                Shape: 'Wave', Strands: 120, Segments: 120, Seed: 42, Length: 4.2, SheetWidth: 3, Ripple: 1.6,
                Waves: 0.9, PhaseSpread: 1.2, Thickness: 1, Taper: 0.3, Intensity: 1.1, Halo: 0.15, Baseline: 0.35,
                ColourStart: '#c8b6ff', ColourEnd: '#8e7bff', ColourAccent: '#ffffff', AccentMix: 0.2,
                Window: 0.5, WindowCycles: 2, Sparks: 0.1, SparkSize: 0.012, SparkBrightness: 2,
                PulseRate: 1, PulseDepth: 0.4, PulseShape: 'Ripple',
                Position: [0, 0, 0], Rotation: [-8, 8, 3],
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
        Background: Black(),
        Post: { Exposure: 1, Glow: 1, GlowSpread: 0.4, Saturation: 1, Brightness: 1 },
        Playback: { LoopSeconds: 8, Speed: 1 },
        Camera: { Yaw: 0, Pitch: 28, Distance: 13, Fov: 40 },
        Layers: [
            Strand('Sheet lines', {
                Shape: 'Wave', Strands: 220, Segments: 120, Seed: 51, Length: 14, SheetWidth: 9, Ripple: 1,
                Waves: 0.5, PhaseSpread: 0.9, Thickness: 1.1, Taper: 0.3, Intensity: 1.2, Halo: 0.15, Baseline: 0.2,
                ColourStart: '#4aa8ff', ColourEnd: '#b8ecff', ColourAccent: '#ffffff', AccentMix: 0.35,
                Window: 0.45, WindowCycles: 2, Sparks: 0.2, SparkSize: 0.012, SparkBrightness: 2.5,
                PulseRate: 2, PulseDepth: 0.4, PulseShape: 'Breathe',
                Position: [0, 0, 0], Rotation: [0, 0, 0],
            }),
            Dust('Glints', {
                Count: 1400, Size: 0.006, Brightness: 3, Colour: '#e7fbff', Bokeh: 0, Focus: 13,
                Spread: 9, Drift: 0.3, Seed: 52,
            }),
        ],
    });
}

// 📝 A flower head with petal fibres rides the rose path. Each head's fibres are mirrored by a comet tail on the same path.
function FlowerPath() {
    const Phase = { Position: [0, 0, 0], Rotation: [-10, 0, 0], Flowers: 3 };
    return CreateScene({
        Name: 'Flower path',
        Background: Black(),
        Post: { Exposure: 1, Glow: 0.7, GlowSpread: 0.5, Saturation: 1.1, Brightness: 1 },
        Playback: { LoopSeconds: 10, Speed: 1 },
        Camera: { Yaw: 0, Pitch: 0, Distance: 14, Fov: 34 },
        Path: { Shape: 'Rose', Size: 5 },
        Layers: [
            Strand('Flower heads', {
                ...Phase, Shape: 'Flower', FollowPath: true, Strands: 600, Segments: 40, Seed: 71, Length: 1.9,
                Spread: 0.05, Petals: 6, Cup: 0.5, Ruffle: 0.5, Amplitude: 0.1, Frequency: 1, Thickness: 1.2, Taper: 0.4,
                Intensity: 1.3, Halo: 0.3, Baseline: 0.06, ColourStart: '#2d9bff', ColourEnd: '#7af0ff',
                ColourAccent: '#ffffff', AccentMix: 0.2, Window: 0.4, WindowCycles: 1, Sparks: 1, SparkSize: 0.02,
                SparkBrightness: 3, PulseRate: 2, PulseDepth: 0.6, PulseShape: 'Heartbeat',
            }),
            Strand('Comet tails', {
                ...Phase, Shape: 'Trail', FollowPath: true, Strands: 120, Segments: 96, Seed: 72, TrailLength: 0.1,
                PhaseSpread: 6.2832, Spread: 0.1, Amplitude: 0.05, Frequency: 2, Thickness: 1, Taper: 0.3,
                Intensity: 1.2, Halo: 0.25, Baseline: 0.04, ColourStart: '#2d9bff', ColourEnd: '#7af0ff',
                ColourAccent: '#ffffff', AccentMix: 0.15, Window: 0.5, WindowCycles: 1, Sparks: 0.4, SparkSize: 0.015,
                SparkBrightness: 2.5, PulseRate: 2, PulseDepth: 0.4, PulseShape: 'Ripple',
            }),
            Dust('Pollen', {
                Count: 260, Size: 0.01, Brightness: 2.2, Colour: '#bfeeff', Bokeh: 0.6, Focus: 10,
                Spread: 5, Drift: 0.5, Seed: 62,
            }),
        ],
    });
}

// 📝 Light trails stream along a weaving path, each one a bundle of fibres whose pulse runs outward along it.
function PathWeave() {
    return CreateScene({
        Name: 'Path weave',
        Background: Black(),
        Post: { Exposure: 1, Glow: 0.8, GlowSpread: 0.5, Saturation: 1.1, Brightness: 1 },
        Playback: { LoopSeconds: 8, Speed: 1 },
        Camera: { Yaw: 0, Pitch: 0, Distance: 15, Fov: 34 },
        Path: { Shape: 'Weave', Size: 5 },
        Layers: [
            Strand('Light weave', {
                Shape: 'Trail', Strands: 150, Segments: 96, Seed: 81, TrailLength: 0.1, PhaseSpread: 6.283,
                Spread: 0.12, Amplitude: 0.08, Frequency: 3, Flowers: 1, Thickness: 1.2, Taper: 0.5, Intensity: 1.3,
                Halo: 0.25, Baseline: 0.03, ColourStart: '#18b4ff', ColourEnd: '#e6fbff',
                ColourAccent: '#ffffff', AccentMix: 0.2, Window: 0.6, WindowCycles: 1, Sparks: 0.5, SparkSize: 0.02,
                SparkBrightness: 3, PulseRate: 2, PulseDepth: 0.7, PulseShape: 'Ripple',
                Position: [0, 0, 0], Rotation: [0, 0, 0],
            }),
            Dust('Glints', {
                Count: 500, Size: 0.006, Brightness: 2.5, Colour: '#e7fbff', Bokeh: 0.1, Focus: 15,
                Spread: 7, Drift: 0.3, Seed: 82,
            }),
        ],
    });
}

// 📝 One flower head breathes at the centre of a black frame, with a pollen cloud drifting behind it.
function FlowerBloom() {
    return CreateScene({
        Name: 'Flower bloom',
        Background: Black(),
        Post: { Exposure: 1, Glow: 1.1, GlowSpread: 0.5, Saturation: 1.1, Brightness: 1 },
        Playback: { LoopSeconds: 8, Speed: 1 },
        Camera: { Yaw: 0, Pitch: 0, Distance: 11, Fov: 34 },
        Layers: [
            Strand('Petal fibres', {
                Shape: 'Flower', Strands: 1200, Segments: 56, Seed: 61, Length: 2.7, Spread: 0.25, Petals: 7, Cup: 0.35,
                Ruffle: 0.6, Amplitude: 0.25, Frequency: 2, Flowers: 1, Thickness: 1.2, Taper: 0.4, Intensity: 1.2,
                Halo: 0.25, Baseline: 0.08, ColourStart: '#2d9bff', ColourEnd: '#7af0ff',
                ColourAccent: '#ffffff', AccentMix: 0.2, Window: 0.45, WindowCycles: 2, Sparks: 0.8, SparkSize: 0.02,
                SparkBrightness: 3, PulseRate: 2, PulseDepth: 0.5, PulseShape: 'Breathe',
                Position: [0, 0, 0], Rotation: [-18, 8, 0],
            }),
            Dust('Pollen', {
                Count: 260, Size: 0.01, Brightness: 2.2, Colour: '#bfeeff', Bokeh: 0.6, Focus: 10,
                Spread: 5, Drift: 0.5, Seed: 62,
            }),
        ],
    });
}

// 📝 An ambient trim: a light loop round a dashboard or door panel, the way car interiors run a light guide. A low idle
//    glow holds the loop, a comet of light sweeps round it once per loop, and two flower heads ride the loop with
//    their own pulses. The frame is wide, as a dashboard strip is.
function AutomotiveTrim() {
    return CreateScene({
        Name: 'Automotive trim',
        Width: 1920,
        Height: 720,
        Background: Black(),
        Post: { Exposure: 1, Glow: 0.8, GlowSpread: 0.4, Saturation: 1, Brightness: 1 },
        Playback: { LoopSeconds: 8, Speed: 1 },
        Camera: { Yaw: 0, Pitch: 0, Distance: 16, Fov: 34 },
        Path: { Shape: 'Stadium', Size: 9.5 },
        Layers: [
            Strand('Idle trim', {
                Shape: 'Trail', Strands: 110, Segments: 96, Seed: 91, TrailLength: 0.35, PhaseSpread: 6.2832,
                Spread: 0.08, Amplitude: 0.04, Frequency: 2, Flowers: 1, Thickness: 1.2, Taper: 0.6, Intensity: 1,
                Halo: 0.3, Baseline: 0.25, ColourStart: '#2d9bff', ColourEnd: '#7af0ff', ColourAccent: '#ffffff',
                AccentMix: 0.25, Window: 0.5, WindowCycles: 1, Sparks: 0.5, SparkSize: 0.02, SparkBrightness: 3,
                PulseRate: 2, PulseDepth: 0.6, PulseShape: 'Ripple', Position: [0, 0, 0], Rotation: [0, 0, 0],
            }),
            Strand('Welcome comet', {
                Shape: 'Trail', Strands: 24, Segments: 96, Seed: 94, TrailLength: 0.25, PhaseSpread: 0.8,
                Spread: 0.08, Amplitude: 0.04, Frequency: 2, Flowers: 1, Thickness: 1.2, Taper: 0.6, Intensity: 2,
                Halo: 0.35, Baseline: 0, ColourStart: '#7af0ff', ColourEnd: '#ffffff', ColourAccent: '#ffffff',
                AccentMix: 0, Window: 0.5, WindowCycles: 1, Sparks: 0.3, SparkSize: 0.02, SparkBrightness: 3,
                PulseRate: 1, PulseDepth: 0.6, PulseShape: 'Ripple', Position: [0, 0, 0], Rotation: [0, 0, 0],
            }),
            Strand('Flower heads', {
                Shape: 'Flower', FollowPath: true, Flowers: 2, Strands: 420, Segments: 40, Seed: 92, Length: 1.4,
                Spread: 0.06, Petals: 6, Cup: 0.45, Ruffle: 0.4, Amplitude: 0.08, Frequency: 1, Thickness: 1,
                Taper: 0.4, Intensity: 1.2, Halo: 0.3, Baseline: 0.05, ColourStart: '#2d9bff', ColourEnd: '#7af0ff',
                ColourAccent: '#ffffff', AccentMix: 0.2, Window: 0.4, WindowCycles: 1, Sparks: 0.8, SparkSize: 0.02,
                SparkBrightness: 3, PulseRate: 2, PulseDepth: 0.5, PulseShape: 'Breathe',
                Position: [0, 0, 0], Rotation: [0, 0, 0],
            }),
            Dust('Glints', {
                Count: 400, Size: 0.006, Brightness: 2, Colour: '#dff6ff', Bokeh: 0.05, Focus: 14,
                Spread: 9, Drift: 0.3, Seed: 93,
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
    { Key: 'flower-bloom', Label: 'Flower bloom', Build: FlowerBloom },
    { Key: 'flower-path', Label: 'Flower path', Build: FlowerPath },
    { Key: 'path-weave', Label: 'Path weave', Build: PathWeave },
    { Key: 'automotive-trim', Label: 'Automotive trim', Build: AutomotiveTrim },
]);

export function BuildPreset(Index) {
    const Entry = PresetList[Index] || PresetList[0];
    return Entry.Build();
}
