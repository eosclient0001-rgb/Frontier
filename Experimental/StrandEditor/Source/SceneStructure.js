//============================================================================================================================================
//                                                             SCENESTRUCTURE.JS
//============================================================================================================================================
// 📦 Scene and layer schema with clamped defaults, path helpers and JSON round trip; no DOM access.

// 📝 Every number, colour, choice and vector is clamped or replaced by its schema default on the way in, so a
//    hand-edited or foreign JSON file can never reach the GPU with a value outside its declared range.

import { PathShapeNames } from './PathSpecification.js';
import { PulseShapeNames } from './PulseSpecification.js';

export const SceneFormat = 'StrandEditor/2';
export const MechanismNames = Object.freeze(['Strands', 'Particles', 'Text']);
export const StrandShapeNames = Object.freeze(['Bezier', 'Bloom', 'Wave', 'Flower', 'Trail']);
export const LayerLimit = 24;
export const StrandLimit = 4000;
export const SegmentLimit = 128;
export const ParticleLimit = 6000;
export const VertexBudget = 2400000;

const HexColour = /^#[0-9a-fA-F]{6}$/;
const SafeIdentifier = /^[A-Za-z0-9_-]{1,40}$/;

function Field(Key, Label, Control, Options) {
    return Object.assign({ Key, Label, Control }, Options);
}

function NumberField(Key, Label, Min, Max, Step, Default, Group) {
    return Field(Key, Label, 'Number', { Min, Max, Step, Default, Group });
}

function IntegerField(Key, Label, Min, Max, Default, Group) {
    return Field(Key, Label, 'Integer', { Min, Max, Step: 1, Default, Group });
}

function ColourField(Key, Label, Default, Group) {
    return Field(Key, Label, 'Colour', { Default, Group });
}

function VectorField(Key, Label, Default, Min, Max, Group) {
    return Field(Key, Label, 'Vector', { Default, Min, Max, Step: 0.01, Group });
}

function ChoiceField(Key, Label, Choices, Default, Group) {
    return Field(Key, Label, 'Choice', { Choices, Default, Group });
}

function ToggleField(Key, Label, Default, Group) {
    return Field(Key, Label, 'Toggle', { Default, Group });
}

function TextField(Key, Label, Default, Group, MaxLength = 120) {
    return Field(Key, Label, 'Text', { Default, Group, MaxLength });
}

// 📝 Paths use dots for nesting (Post.Glow). Layers keep flat keys because a layer is one record.
export const SceneFields = Object.freeze([
    TextField('Name', 'Scene name', 'Untitled strand scene', 'Scene', 60),
    IntegerField('Width', 'Width (px)', 320, 3840, 1280, 'Format'),
    IntegerField('Height', 'Height (px)', 180, 2160, 720, 'Format'),
    ColourField('Background.Inner', 'Centre colour', '#000000', 'Background'),
    ColourField('Background.Outer', 'Edge colour', '#000000', 'Background'),
    NumberField('Background.Vignette', 'Vignette', 0, 1, 0.01, 0, 'Background'),
    NumberField('Background.Grain', 'Grain (scales brightness)', 0, 0.1, 0.001, 0, 'Background'),
    NumberField('Post.Exposure', 'Exposure', 0.2, 4, 0.01, 1, 'Post'),
    NumberField('Post.Glow', 'Glow amount', 0, 3, 0.01, 1, 'Post'),
    NumberField('Post.GlowSpread', 'Glow spread', 0, 1, 0.01, 0.5, 'Post'),
    NumberField('Post.Saturation', 'Saturation', 0, 2, 0.01, 1, 'Post'),
    NumberField('Post.Brightness', 'Output brightness', 0.05, 1, 0.01, 1, 'Post'),
    NumberField('Playback.LoopSeconds', 'Loop length (s)', 2, 60, 0.1, 8, 'Playback'),
    NumberField('Playback.Speed', 'Playback speed', 0.05, 2, 0.01, 1, 'Playback'),
    NumberField('Camera.Yaw', 'Yaw (deg)', -180, 180, 0.1, 0, 'Camera'),
    NumberField('Camera.Pitch', 'Pitch (deg)', -80, 80, 0.1, 0, 'Camera'),
    NumberField('Camera.Distance', 'Distance (m)', 2, 40, 0.05, 9, 'Camera'),
    NumberField('Camera.Fov', 'Field of view (deg)', 15, 70, 0.1, 35, 'Camera'),
    ChoiceField('Path.Shape', 'Path shape', PathShapeNames, 'Ring', 'Path'),
    NumberField('Path.Size', 'Path radius (m)', 0.5, 30, 0.01, 6, 'Path'),
]);

export const LayerFields = Object.freeze([
    TextField('Label', 'Layer name', 'Layer', 'Layer', 60),
    ToggleField('Visible', 'Visible', true, 'Layer'),
]);

const StrandFieldList = Object.freeze([
    ChoiceField('Shape', 'Shape', StrandShapeNames, 'Bezier', 'Form'),
    IntegerField('Strands', 'Strands', 1, StrandLimit, 200, 'Form'),
    IntegerField('Segments', 'Segments per strand', 4, SegmentLimit, 64, 'Form'),
    IntegerField('Seed', 'Seed', 1, 99999, 7, 'Form'),
    NumberField('Length', 'Length (m)', 0.5, 30, 0.01, 10, 'Form'),
    NumberField('Spread', 'Spread (m): roots, flower core or bundle', 0, 10, 0.01, 0.8, 'Form'),
    VectorField('Direction', 'Bezier direction', [1, 0.25, 0], -1, 1, 'Form'),
    NumberField('Ruffle', 'Bloom ruffle', 0, 1, 0.01, 0.5, 'Form'),
    NumberField('SheetWidth', 'Sheet width (m)', 0.5, 30, 0.01, 6, 'Form'),
    NumberField('Ripple', 'Sheet ripple (m)', 0, 4, 0.01, 1, 'Form'),
    NumberField('Waves', 'Sheet waves', 0, 6, 0.01, 0.8, 'Form'),
    NumberField('PhaseSpread', 'Phase spread (rad): wave or trail heads', 0, 6.283, 0.01, 1.2, 'Form'),
    IntegerField('Flowers', 'Flower heads', 1, 24, 1, 'Form'),
    IntegerField('Petals', 'Petals', 3, 12, 6, 'Form'),
    NumberField('Cup', 'Cup depth', 0, 1, 0.01, 0.3, 'Form'),
    NumberField('Amplitude', 'Wobble (m)', 0, 4, 0.01, 1, 'Motion'),
    NumberField('Frequency', 'Whole waves per loop', 0, 8, 0.01, 2, 'Motion'),
    IntegerField('Harmonic', 'Speed multiple', 1, 4, 1, 'Motion'),
    IntegerField('WindowCycles', 'Light heads per loop', 1, 6, 1, 'Motion'),
    NumberField('Window', 'Light window', 0.02, 1, 0.01, 0.5, 'Motion'),
    NumberField('TrailLength', 'Trail length (share of path)', 0.02, 1, 0.01, 0.3, 'Motion'),
    NumberField('Width', 'Fibre width (m)', 0.001, 0.4, 0.0005, 0.006, 'Look'),
    NumberField('Taper', 'Taper', 0, 1, 0.01, 0.5, 'Look'),
    NumberField('Intensity', 'Intensity', 0, 12, 0.01, 2, 'Look'),
    NumberField('Sharpness', 'Fibre sharpness', 2, 200, 0.5, 30, 'Look'),
    NumberField('Halo', 'Halo', 0, 2, 0.01, 0.3, 'Look'),
    NumberField('Baseline', 'Idle brightness', 0, 1, 0.01, 0.1, 'Look'),
    ColourField('ColourStart', 'Colour start', '#18b4ff', 'Look'),
    ColourField('ColourEnd', 'Colour end', '#5fd9ff', 'Look'),
    ColourField('ColourAccent', 'Accent colour', '#eaffff', 'Look'),
    NumberField('AccentMix', 'Accent amount', 0, 1, 0.01, 0.25, 'Look'),
    NumberField('Sparks', 'Head sparks', 0, 1, 0.01, 0.5, 'Sparks'),
    NumberField('SparkSize', 'Spark size (m)', 0, 0.4, 0.001, 0.06, 'Sparks'),
    NumberField('SparkBrightness', 'Spark brightness', 0, 12, 0.01, 3, 'Sparks'),
    IntegerField('PulseRate', 'Brightness pulses per loop', 0, 8, 0, 'Pulse'),
    NumberField('PulseDepth', 'Brightness pulse depth', 0, 1, 0.01, 0.5, 'Pulse'),
    ChoiceField('PulseShape', 'Brightness pulse shape', PulseShapeNames, 'Breathe', 'Pulse'),
    ToggleField('FollowPath', 'Ride the scene path (flower and wave shapes)', false, 'Placement'),
    VectorField('Position', 'Position (m)', [0, 0, 0], -30, 30, 'Placement'),
    VectorField('Rotation', 'Rotation yaw, pitch, roll (deg)', [0, 0, 0], -180, 180, 'Placement'),
    NumberField('Scale', 'Scale', 0.05, 10, 0.01, 1, 'Placement'),
]);

const ParticleFieldList = Object.freeze([
    IntegerField('Count', 'Particles', 0, ParticleLimit, 400, 'Form'),
    NumberField('Spread', 'Volume half-size (m)', 0.5, 30, 0.01, 6, 'Form'),
    IntegerField('Seed', 'Seed', 1, 99999, 11, 'Form'),
    NumberField('Size', 'Size (m)', 0.001, 0.3, 0.001, 0.01, 'Look'),
    NumberField('Brightness', 'Brightness', 0, 12, 0.01, 2, 'Look'),
    ColourField('Colour', 'Colour', '#dff6ff', 'Look'),
    NumberField('Bokeh', 'Bokeh share', 0, 1, 0.01, 0.1, 'Look'),
    NumberField('Focus', 'Focus distance (m)', 0.5, 60, 0.1, 9, 'Look'),
    NumberField('Drift', 'Drift amount', 0, 1, 0.01, 0.6, 'Motion'),
    IntegerField('Harmonic', 'Speed multiple', 1, 4, 1, 'Motion'),
    VectorField('Position', 'Position (m)', [0, 0, 0], -30, 30, 'Placement'),
    VectorField('Rotation', 'Rotation yaw, pitch, roll (deg)', [0, 0, 0], -180, 180, 'Placement'),
    NumberField('Scale', 'Scale', 0.05, 10, 0.01, 1, 'Placement'),
]);

const TextFieldList = Object.freeze([
    TextField('Title', 'Title', 'TITLE', 'Copy', 120),
    TextField('Subtitle', 'Subtitle', 'Subtitle', 'Copy', 160),
    ChoiceField('Face', 'Typeface', ['Sans', 'Light', 'Condensed'], 'Light', 'Copy'),
    ChoiceField('Align', 'Alignment', ['Left', 'Centre', 'Right'], 'Left', 'Copy'),
    NumberField('TitleSize', 'Title size (of height)', 0.01, 0.3, 0.001, 0.07, 'Layout'),
    NumberField('SubtitleSize', 'Subtitle size (of height)', 0.01, 0.2, 0.001, 0.028, 'Layout'),
    NumberField('Tracking', 'Tracking (em)', 0, 1, 0.01, 0.3, 'Layout'),
    NumberField('X', 'Horizontal (0 left, 1 right)', 0, 1, 0.001, 0.5, 'Layout'),
    NumberField('Y', 'Vertical (0 bottom, 1 top)', 0, 1, 0.001, 0.5, 'Layout'),
    ColourField('Colour', 'Colour', '#dff6ff', 'Look'),
    NumberField('Glow', 'Glow', 0, 1, 0.01, 0.4, 'Look'),
]);

const FieldsByMechanism = { Strands: StrandFieldList, Particles: ParticleFieldList, Text: TextFieldList };

const DefaultLabels = { Strands: 'Fibres', Particles: 'Dust', Text: 'Title' };

export function FieldsFor(Mechanism) {
    return FieldsByMechanism[Mechanism] || [];
}

// 🔢 Coerces one raw value to its field: numbers are rounded for integers and clamped, colours must be #rrggbb.
export function CoerceField(Definition, Raw) {
    const Fallback = Array.isArray(Definition.Default) ? Definition.Default.slice() : Definition.Default;
    switch (Definition.Control) {
        case 'Number':
        case 'Integer': {
            const Candidate = typeof Raw === 'string' && Raw.trim() !== '' ? Number(Raw) : Raw;
            if (typeof Candidate !== 'number' || !Number.isFinite(Candidate)) return Fallback;
            const Rounded = Definition.Control === 'Integer' ? Math.round(Candidate) : Candidate;
            return Math.min(Definition.Max, Math.max(Definition.Min, Rounded));
        }
        case 'Colour':
            return typeof Raw === 'string' && HexColour.test(Raw) ? Raw.toLowerCase() : Fallback;
        case 'Vector':
            if (!Array.isArray(Raw) || Raw.length !== 3 || !Raw.every((Part) => typeof Part === 'number' && Number.isFinite(Part))) {
                return Fallback;
            }
            return Raw.map((Part) => Math.min(Definition.Max, Math.max(Definition.Min, Part)));
        case 'Choice':
            return Definition.Choices.includes(Raw) ? Raw : Fallback;
        case 'Toggle':
            return typeof Raw === 'boolean' ? Raw : Fallback;
        case 'Text':
            return typeof Raw === 'string' ? Raw.slice(0, Definition.MaxLength) : Fallback;
        default:
            return Fallback;
    }
}

export function ReadPath(Source, Path) {
    let Cursor = Source;
    for (const Key of Path.split('.')) {
        if (Cursor === null || typeof Cursor !== 'object') return undefined;
        Cursor = Cursor[Key];
    }
    return Cursor;
}

export function WritePath(Target, Path, Setting) {
    const Keys = Path.split('.');
    let Cursor = Target;
    for (const Key of Keys.slice(0, -1)) {
        if (typeof Cursor[Key] !== 'object' || Cursor[Key] === null) Cursor[Key] = {};
        Cursor = Cursor[Key];
    }
    Cursor[Keys[Keys.length - 1]] = Setting;
}

let IdentifierSerial = 0;

export function NewLayerId() {
    IdentifierSerial += 1;
    return 'L' + Date.now().toString(36) + IdentifierSerial.toString(36);
}

export function CreateLayer(Mechanism, Incoming = {}) {
    if (!MechanismNames.includes(Mechanism)) throw new Error('Unknown layer mechanism: ' + Mechanism);
    // 📝 Version one called the fibre core setting Core. Carry that saved value over rather than dropping it.
    const Overrides = Incoming.Sharpness === undefined && typeof Incoming.Core === 'number'
        ? { ...Incoming, Sharpness: Incoming.Core }
        : Incoming;
    const Layer = {
        Id: NewLayerId(),
        Mechanism,
        Label: CoerceField(LayerFields[0], Overrides.Label ?? DefaultLabels[Mechanism]),
        Visible: CoerceField(LayerFields[1], Overrides.Visible),
    };
    for (const Definition of FieldsFor(Mechanism)) {
        Layer[Definition.Key] = CoerceField(Definition, Overrides[Definition.Key]);
    }
    return Layer;
}

// 📝 Normalisation is idempotent: NormalizeScene(NormalizeScene(x)) deep-equals NormalizeScene(x). Checks pin this.
export function NormalizeScene(Input) {
    const Source = Input && typeof Input === 'object' ? Input : {};
    const Scene = { Format: SceneFormat };
    for (const Definition of SceneFields) {
        WritePath(Scene, Definition.Key, CoerceField(Definition, ReadPath(Source, Definition.Key)));
    }
    Scene.Layers = [];
    const Used = new Set();
    const Incoming = Array.isArray(Source.Layers) ? Source.Layers : [];
    for (const Entry of Incoming) {
        if (Scene.Layers.length >= LayerLimit) break;
        if (!Entry || typeof Entry !== 'object' || !MechanismNames.includes(Entry.Mechanism)) continue;
        const Layer = CreateLayer(Entry.Mechanism, Entry);
        if (typeof Entry.Id === 'string' && SafeIdentifier.test(Entry.Id)) Layer.Id = Entry.Id;
        while (Used.has(Layer.Id)) Layer.Id = NewLayerId();
        Used.add(Layer.Id);
        Scene.Layers.push(Layer);
    }
    return Scene;
}

export function CreateScene(Overrides = {}) {
    return NormalizeScene(Overrides);
}

export function SceneToJson(Scene) {
    return JSON.stringify(NormalizeScene(Scene), null, 2) + '\n';
}

export function SceneFromJson(Text) {
    return NormalizeScene(JSON.parse(Text));
}

// 🔢 Rough GPU cost: strand vertices are Strands x Segments x 6, dust is one point per particle.
export function EstimateCost(Scene) {
    let Vertices = 0;
    let Strands = 0;
    let Dust = 0;
    for (const Layer of Scene.Layers) {
        if (!Layer.Visible) continue;
        if (Layer.Mechanism === 'Strands') {
            Vertices += Layer.Strands * Layer.Segments * 6;
            Strands += Layer.Strands;
        } else if (Layer.Mechanism === 'Particles') {
            Dust += Layer.Count;
        }
    }
    return { Vertices, Strands, Dust, OverBudget: Vertices > VertexBudget };
}
