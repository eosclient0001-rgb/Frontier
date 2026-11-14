/*====================================================================================================================================
                                                     WORKSPACEINTERFACE.JS
====================================================================================================================================*/
// 🧩 Workspace wiring: inspector fields, orbit camera input, progressive accumulation loop and determinism verification

import { TracingDivision, ResolveDisplayPixels } from './TracingDivision.js';
import { PaintPresets, FloorPresets, EnvironmentPresets } from './StudioSceneAssembly.js';

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

const QueryParameters             = new URLSearchParams(location.search);
const ValidationEnabled           = QueryParameters.has('validation');
const ReadbackPresentationEnabled = QueryParameters.get('present') === 'readback';

// 📝 Orbit presets: yaw about +Y from +Z, pitch above the horizon, distance to the target [m].
const CameraPresets = {
    Hero:    { Label: 'Hero',    Yaw: 0.78,  Pitch: 0.13, Distance: 9.6,  Target: [0.1, 0.70, 1.0],  FieldOfView: 36 },
    Profile: { Label: 'Profile', Yaw: 0.0,   Pitch: 0.06, Distance: 12.5, Target: [0.0, 0.80, 0.0],   FieldOfView: 34 },
    Front:   { Label: 'Front',   Yaw: 1.5708, Pitch: 0.10, Distance: 11.0, Target: [0.0, 0.75, 0.6],  FieldOfView: 30 },
    Spheres: { Label: 'Spheres', Yaw: 0.0,   Pitch: 0.20, Distance: 6.8,  Target: [0.0, 0.50, 2.9],   FieldOfView: 42 },
    Rear:    { Label: 'Rear',    Yaw: 3.95,  Pitch: 0.16, Distance: 11.8, Target: [0.0, 0.80, 0.0],   FieldOfView: 34 }
};

const Configuration = {
    PaintPreset:          QueryParameters.get('paint') || 'Authored',
    PaintRoughness:       0.0775,
    FloorPreset:          'Epoxy',
    EnvironmentPreset:    'Studio',
    EnvironmentCategory:  0,
    EnvironmentIntensity: 1.5,
    KeyIntensity:         4.0,
    RimIntensity:         12.0,
    FillIntensity:        3.0,
    LampExitance:         0.2,
    ExposureStops:        0.0,
    LightsVisibleToCamera: false,
    BounceLimit:          2,
    DepthLimit:           10,
    ThroughputCutoff:     0.002,
    SampleBatch:          1,
    RenderScale:          Number(QueryParameters.get('scale') || 0.75),
    TargetSamples:        Number(QueryParameters.get('target') || 1024),
    VehicleEnabled:       true,
    ShowcaseEnabled:      true,
    ApertureRadius:       0.0,
    FocusDistance:        0.0,
    CameraPreset:         QueryParameters.get('camera') || 'Hero',
    Camera:               null
};
Configuration.Camera = { ...CameraPresets[Configuration.CameraPreset] };

const Division = new TracingDivision();
const Interface = {
    Paused:          false,
    VerifyActive:    false,
    StartTime:       performance.now(),
    AccumulatedTime: 0,
    DisplayStale:    true,
    ConfigurationRevision: 0
};


//------------------------------------------------------------------------------------------------------------------------
//                                                    INSPECTOR CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

function Locate(Identifier)
{
    return document.getElementById(Identifier);
}

function PopulateSelect(Identifier, Options, Current, OnSelect)
{
    const Select = Locate(Identifier);
    for (const [Key, Label] of Options)
    {
        const Option = document.createElement('option');
        Option.value = Key;
        Option.textContent = Label;
        Select.appendChild(Option);
    }
    Select.value = String(Current);
    Select.addEventListener('change', () => OnSelect(Select.value));
}

function AttachSlider(Identifier, Current, Format, OnInput)
{
    const Slider = Locate(Identifier);
    const Readout = Slider.parentElement.querySelector('output');
    Slider.value = Current;
    Readout.textContent = Format(Number(Current));
    Slider.addEventListener('input', () =>
    {
        Readout.textContent = Format(Number(Slider.value));
        OnInput(Number(Slider.value));
    });
    return Slider;
}

function InvalidateAccumulation(SceneChanged = false)
{
    if (SceneChanged)
    {
        Division.ConfigureScene(Configuration);
    }
    else
    {
        Division.Configuration = { ...Configuration };
        Division.ResetAccumulation();
    }
    Interface.AccumulatedTime = 0;
    Interface.StartTime       = performance.now();
    Interface.ConfigurationRevision++;
}

function ConstructInspector()
{
    const PresetRow = Locate('CameraPresetRow');
    for (const [Key, Preset] of Object.entries(CameraPresets))
    {
        const Button = document.createElement('button');
        Button.textContent = Preset.Label;
        Button.dataset.preset = Key;
        Button.classList.toggle('Selected', Key === Configuration.CameraPreset);
        Button.addEventListener('click', () =>
        {
            Configuration.CameraPreset = Key;
            Configuration.Camera = { ...Preset, Target: [...Preset.Target] };
            Locate('FieldOfViewSlider').value = Preset.FieldOfView;
            Locate('FieldOfViewSlider').dispatchEvent(new Event('input'));
            PresetRow.querySelectorAll('button').forEach(Other => Other.classList.toggle('Selected', Other === Button));
            InvalidateAccumulation();
        });
        PresetRow.appendChild(Button);
    }

    const Fixed = Digits => Amount => Amount.toFixed(Digits);
    AttachSlider('FieldOfViewSlider', Configuration.Camera.FieldOfView, Amount => `${Amount}°`, Amount => { Configuration.Camera.FieldOfView = Amount; InvalidateAccumulation(); });
    AttachSlider('ApertureSlider', Configuration.ApertureRadius, Fixed(3), Amount => { Configuration.ApertureRadius = Amount; InvalidateAccumulation(); });

    PopulateSelect('PaintSelect', Object.entries(PaintPresets).map(([Key, Preset]) => [Key, Preset.Label]), Configuration.PaintPreset,
        Key => { Configuration.PaintPreset = Key; InvalidateAccumulation(true); });
    AttachSlider('PaintRoughnessSlider', Configuration.PaintRoughness, Fixed(3), Amount => { Configuration.PaintRoughness = Amount; InvalidateAccumulation(true); });
    PopulateSelect('FloorSelect', Object.entries(FloorPresets).map(([Key, Preset]) => [Key, Preset.Label]), Configuration.FloorPreset,
        Key => { Configuration.FloorPreset = Key; InvalidateAccumulation(true); });
    PopulateSelect('EnvironmentSelect', Object.entries(EnvironmentPresets).map(([Key, Preset]) => [Key, Preset.Label]), Configuration.EnvironmentPreset,
        Key => { Configuration.EnvironmentPreset = Key; Configuration.EnvironmentCategory = EnvironmentPresets[Key].Category; InvalidateAccumulation(); });
    AttachSlider('EnvironmentSlider', Configuration.EnvironmentIntensity, Fixed(2), Amount => { Configuration.EnvironmentIntensity = Amount; InvalidateAccumulation(); });
    AttachSlider('KeySlider', Configuration.KeyIntensity, Fixed(2), Amount => { Configuration.KeyIntensity = Amount; InvalidateAccumulation(true); });
    AttachSlider('RimSlider', Configuration.RimIntensity, Fixed(1), Amount => { Configuration.RimIntensity = Amount; InvalidateAccumulation(true); });
    AttachSlider('FillSlider', Configuration.FillIntensity, Fixed(2), Amount => { Configuration.FillIntensity = Amount; InvalidateAccumulation(true); });
    PopulateSelect('LightVisibilitySelect', [['hidden', 'Hidden (reflections only)'], ['visible', 'Visible']], Configuration.LightsVisibleToCamera ? 'visible' : 'hidden',
        Key => { Configuration.LightsVisibleToCamera = Key === 'visible'; InvalidateAccumulation(); });
    AttachSlider('LampSlider', Configuration.LampExitance, Fixed(2), Amount => { Configuration.LampExitance = Amount; InvalidateAccumulation(true); });
    AttachSlider('ExposureSlider', Configuration.ExposureStops, Amount => `${Amount >= 0 ? '+' : ''}${Amount.toFixed(1)}`,
        Amount => { Configuration.ExposureStops = Amount; Interface.DisplayStale = true; });

    PopulateSelect('BounceSelect', [[1, '1 (direct + 1)'], [2, '2'], [3, '3'], [4, '4']], Configuration.BounceLimit,
        Key => { Configuration.BounceLimit = Number(Key); InvalidateAccumulation(); });
    PopulateSelect('DepthSelect', [[6, '6'], [10, '10'], [14, '14']], Configuration.DepthLimit,
        Key => { Configuration.DepthLimit = Number(Key); InvalidateAccumulation(); });
    PopulateSelect('BatchSelect', [[1, '1'], [2, '2'], [4, '4'], [8, '8']], Configuration.SampleBatch,
        Key => { Configuration.SampleBatch = Number(Key); });
    PopulateSelect('ScaleSelect', [[0.25, '25 %'], [0.5, '50 %'], [0.75, '75 %'], [1, '100 %']], Configuration.RenderScale,
        Key => { Configuration.RenderScale = Number(Key); ResizeViewport(); });
    PopulateSelect('TargetSelect', [[64, '64'], [256, '256'], [1024, '1024'], [4096, '4096'], [16384, '16384']], Configuration.TargetSamples,
        Key => { Configuration.TargetSamples = Number(Key); });

    Locate('PauseButton').addEventListener('click', () =>
    {
        Interface.Paused = !Interface.Paused;
        Locate('PauseButton').textContent = Interface.Paused ? 'Resume' : 'Pause';
    });
    Locate('RestartButton').addEventListener('click', () => InvalidateAccumulation());
    Locate('SaveButton').addEventListener('click', SaveDisplayImage);
    Locate('VerifyButton').addEventListener('click', VerifyRepeatability);
}


//------------------------------------------------------------------------------------------------------------------------
//                                                    CAMERA INPUT
//------------------------------------------------------------------------------------------------------------------------

function AttachOrbitInput(Viewport)
{
    let Pointer = null;
    Viewport.addEventListener('contextmenu', Gesture => Gesture.preventDefault());
    Viewport.addEventListener('pointerdown', Gesture =>
    {
        Pointer = { X: Gesture.clientX, Y: Gesture.clientY, Panning: Gesture.shiftKey || Gesture.button === 2 };
        Viewport.setPointerCapture(Gesture.pointerId);
    });
    Viewport.addEventListener('pointerup', () => { Pointer = null; });
    Viewport.addEventListener('pointermove', Gesture =>
    {
        if (!Pointer) return;
        const DeltaX = Gesture.clientX - Pointer.X, DeltaY = Gesture.clientY - Pointer.Y;
        Pointer.X = Gesture.clientX; Pointer.Y = Gesture.clientY;
        const Camera = Configuration.Camera;
        if (Pointer.Panning)
        {
            const Vectors = TracingDivision.ResolveCameraVectors(Camera, 1.0);
            const Scale = Camera.Distance * 0.0016;
            const RightLength = Math.hypot(...Vectors.Right), UpLength = Math.hypot(...Vectors.Up);
            for (let Axis = 0; Axis < 3; Axis++)
            {
                Camera.Target[Axis] += (-DeltaX * Vectors.Right[Axis] / RightLength + DeltaY * Vectors.Up[Axis] / UpLength) * Scale;
            }
        }
        else
        {
            Camera.Yaw  -= DeltaX * 0.006;
            Camera.Pitch = Math.min(1.45, Math.max(-0.05, Camera.Pitch + DeltaY * 0.005));
        }
        InvalidateAccumulation();
    });
    Viewport.addEventListener('wheel', Gesture =>
    {
        Gesture.preventDefault();
        Configuration.Camera.Distance = Math.min(40, Math.max(2.0, Configuration.Camera.Distance * Math.exp(Gesture.deltaY * 0.001)));
        InvalidateAccumulation();
    }, { passive: false });
}

function ResizeViewport()
{
    const Viewport = Locate('ViewportPanel');
    const Canvas   = Locate('ViewportCanvas');
    let Width, Height;
    if (QueryParameters.has('width'))
    {
        Width  = Number(QueryParameters.get('width'));
        Height = Number(QueryParameters.get('height'));
    }
    else
    {
        const Ratio = Math.min(window.devicePixelRatio || 1, 2) * Configuration.RenderScale;
        Width  = Math.max(64, Math.round(Viewport.clientWidth * Ratio));
        Height = Math.max(64, Math.round(Viewport.clientHeight * Ratio));
    }
    Canvas.width  = Width;
    Canvas.height = Height;
    Division.ResizeAccumulation(Width, Height);
    Division.Configuration = { ...Configuration };
    Interface.AccumulatedTime = 0;
    Interface.StartTime = performance.now();
    Locate('StatusResolution').textContent = `${Width} × ${Height} px (${(Width * Height / 1e6).toFixed(2)} MP)`;
}


//------------------------------------------------------------------------------------------------------------------------
//                                                    ACCUMULATION LOOP
//------------------------------------------------------------------------------------------------------------------------

function ExposureMultiplier()
{
    return Math.pow(2.0, Configuration.ExposureStops);
}

function RefreshReadout(DispatchMilliseconds)
{
    const Samples = Division.SampleCount;
    Locate('ReadoutSamples').textContent = Samples.toLocaleString('en-US');
    const Seconds = Interface.AccumulatedTime / 1000;
    const Rate = Seconds > 0 ? Samples / Seconds : 0;
    const NetExponent = Samples > 0 ? Math.floor(Math.log2(Samples)) : 0;
    Locate('ReadoutSecondary').textContent = Samples >= Configuration.TargetSamples
        ? `Converged to target · ${Seconds.toFixed(1)} s`
        : `${Rate.toFixed(1)} samples/s · target ${Configuration.TargetSamples.toLocaleString('en-US')}`;
    Locate('ConvergenceFill').style.width = `${Math.min(100, 100 * Samples / Configuration.TargetSamples)}%`;
    if (DispatchMilliseconds !== undefined)
    {
        const RaySamples = Division.AccumulationWidth * Division.AccumulationHeight * Rate;
        Locate('StatusRate').textContent = `${Rate.toFixed(2)} spp/s · ${(RaySamples / 1e6).toFixed(1)} M px-samples/s`;
    }
    Locate('StatusElapsed').textContent = `${Seconds.toFixed(1)} s`;
    Locate('StatusNet').textContent = Samples > 0 ? `2^${NetExponent} = ${2 ** NetExponent} (every pair a (0,${NetExponent},2)-net)` : '—';
}

async function AdvanceAccumulationLoop()
{
    for (;;)
    {
        await new Promise(requestAnimationFrame);
        if (Interface.VerifyActive) continue;
        if (!Interface.Paused && Division.SampleCount < Configuration.TargetSamples)
        {
            const Revision = Interface.ConfigurationRevision;
            const Batch = Math.min(Configuration.SampleBatch, Configuration.TargetSamples - Division.SampleCount);
            const Start = performance.now();
            Division.AdvanceSamples(Batch);
            await Division.PresentDisplay(ExposureMultiplier());
            await Division.Device.queue.onSubmittedWorkDone();
            const Elapsed = performance.now() - Start;
            if (Revision === Interface.ConfigurationRevision) Interface.AccumulatedTime += Elapsed;
            RefreshReadout(Elapsed);
            Interface.DisplayStale = false;
        }
        else if (Interface.DisplayStale)
        {
            await Division.PresentDisplay(ExposureMultiplier());
            Interface.DisplayStale = false;
            RefreshReadout();
        }
    }
}


//------------------------------------------------------------------------------------------------------------------------
//                                                    EXPORT AND VERIFICATION
//------------------------------------------------------------------------------------------------------------------------

async function EncodeDisplayPng()
{
    const Accumulation = await Division.RetrieveAccumulation();
    const Width = Division.AccumulationWidth, Height = Division.AccumulationHeight;
    const Pixels = ResolveDisplayPixels(Accumulation, Width, Height, ExposureMultiplier());
    const Surface = document.createElement('canvas');
    Surface.width = Width; Surface.height = Height;
    Surface.getContext('2d').putImageData(new ImageData(Pixels, Width, Height), 0, 0);
    return Surface.toDataURL('image/png');
}

async function SaveDisplayImage()
{
    const Link = document.createElement('a');
    Link.href = await EncodeDisplayPng();
    Link.download = `DeterministicPathTracer_${Division.SampleCount}spp.png`;
    Link.click();
}

// 📝 Renders SampleTotal samples from zero in batches of Batch, waiting for the GPU between batches.
async function RenderFromZero(SampleTotal, Batch)
{
    Division.ResetAccumulation();
    while (Division.SampleCount < SampleTotal)
    {
        Division.AdvanceSamples(Math.min(Batch, SampleTotal - Division.SampleCount));
        await Division.Device.queue.onSubmittedWorkDone();
    }
}

async function VerifyRepeatability()
{
    const SampleTotal = Math.max(1, Division.SampleCount);
    const DigestLine = Locate('DigestLine');
    Interface.VerifyActive = true;
    DigestLine.className = 'DigestLine';
    DigestLine.textContent = `Re-rendering ${SampleTotal} samples twice…`;
    try
    {
        await RenderFromZero(SampleTotal, 1);
        const FirstDigest = await Division.ComputeAccumulationDigest();
        await RenderFromZero(SampleTotal, Math.max(2, Math.min(8, SampleTotal)));
        const SecondDigest = await Division.ComputeAccumulationDigest();
        const Matched = FirstDigest === SecondDigest;
        DigestLine.className = `DigestLine ${Matched ? 'Matched' : 'Diverged'}`;
        DigestLine.textContent = `${SampleTotal} spp · batch 1: ${FirstDigest}\n${SampleTotal} spp · batch ${Math.max(2, Math.min(8, SampleTotal))}: ${SecondDigest}\n${Matched ? 'Bit-identical' : 'DIVERGED'}`;
        DigestLine.style.whiteSpace = 'pre-line';
    }
    finally
    {
        Interface.VerifyActive = false;
        Interface.DisplayStale = true;
    }
}


//------------------------------------------------------------------------------------------------------------------------
//                                                    INITIALIZE
//------------------------------------------------------------------------------------------------------------------------

async function InitializeWorkspace()
{
    try
    {
        await Division.Initialize(Locate('ViewportCanvas'), new URL('../Assets/', import.meta.url), ReadbackPresentationEnabled);
        Division.Configuration = { ...Configuration };
        ResizeViewport();
        Division.ConfigureScene(Configuration);
        const Summary = Division.SceneSummary;
        Locate('StatusAdapter').textContent  = Division.AdapterDescription;
        Locate('StatusGeometry').textContent = `${Summary.TriangleCount.toLocaleString('en-US')} tris · ${Summary.BoundsEntryCount.toLocaleString('en-US')} bounds · ${Summary.SphereCount} spheres · ${Summary.LightCount} softboxes`;
        ConstructInspector();
        AttachOrbitInput(Locate('ViewportPanel'));
        if (!QueryParameters.has('width')) new ResizeObserver(() => { ResizeViewport(); Interface.DisplayStale = true; }).observe(Locate('ViewportPanel'));

        window.DeterministicTracing = {
            Division, Configuration, CameraPresets,
            ApplyConfiguration: (Partial, SceneChanged = true) => { Object.assign(Configuration, Partial); InvalidateAccumulation(SceneChanged); },
            RenderFromZero, EncodeDisplayPng,
            ComputeDigest: () => Division.ComputeAccumulationDigest(),
            ExtractQuadrature: (SampleTotal, PairTotal) => Division.ExtractQuadratureOnDevice(SampleTotal, PairTotal),
            RetrieveAccumulation: () => Division.RetrieveAccumulation()
        };
        if (!ValidationEnabled) AdvanceAccumulationLoop();
        document.body.dataset.ready = 'true';
    }
    catch (Failure)
    {
        console.error(Failure);
        const Notice = Locate('FailureNotice');
        Notice.hidden = false;
        Notice.textContent = `Deterministic path tracer could not start.\n\n${Failure.message || Failure}\n\nRequires a WebGPU browser (Chrome / Edge 113+) on a GTX 900-series or newer GPU.`;
        Locate('ReadoutSecondary').textContent = 'Failed — see notice';
        document.body.dataset.ready = 'failed';
    }
}

InitializeWorkspace();
