//============================================================================================================================================
//                                                             STRANDEDITORAPP.JS
//============================================================================================================================================
// 📦 Editor shell: scene state, layer list, inspector, transport, camera gestures, export and the render loop.

import {
    CreateLayer, EstimateCost, FieldsFor, LayerFields, NormalizeScene, ReadPath, SceneFields, SceneFromJson,
    SceneToJson, WritePath, LayerLimit,
} from './SceneStructure.js';
import { BuildPreset, PresetList } from './Presets.js';
import { DisplayPanel, PanelHeight, PanelWidth } from './DisplayPanel.js';
import { StrandRenderer } from './StrandRenderer.js';
import { PlaybackTimeline } from './PlaybackTimeline.js';
import { BuildInspector } from './InspectorPanel.js';
import { CanvasToPng, DownloadBlob, DownloadText, RecordLoop } from './SceneExport.js';
import { ApplyDrag, ApplyZoom, CameraMatrices, ResetView } from './OrbitCamera.js';
import { Mat3FromEulerDegrees } from './LinearAlgebra.js';
import { SamplePath } from './PathSpecification.js';
import { BrightestChannel, MeanDifference, Summarise } from './PixelStatistics.js';

// 📝 Starter layers for the Add buttons. Each is a complete layer; the user edits it from the inspector afterwards.
const Starters = {
    Bezier: ['Strands', { Label: 'Bezier fibres', Shape: 'Bezier', Strands: 200, Segments: 64, Length: 10, Spread: 0.8, Position: [-5, -1, 0] }],
    Bloom: ['Strands', {
        Label: 'Radial bloom', Shape: 'Bloom', Strands: 700, Segments: 56, Length: 3.2, Spread: 0, Ruffle: 0.6,
        Window: 0.4, Thickness: 1.6, Taper: 0.5, Intensity: 1.4,
    }],
    Wave: ['Strands', {
        Label: 'Wave sheet', Shape: 'Wave', Strands: 48, Segments: 96, Length: 12, SheetWidth: 6, Ripple: 1.2,
        Waves: 0.8, Thickness: 1.6, Taper: 0.3, Intensity: 1.3, Baseline: 0.2,
    }],
    Flower: ['Strands', {
        Label: 'Flower', Shape: 'Flower', Strands: 600, Segments: 48, Length: 2.4, Spread: 0.15, Petals: 6, Cup: 0.4,
        Ruffle: 0.5, Thickness: 1.2, Taper: 0.4, Intensity: 1.3, Baseline: 0.06, Sparks: 1,
        PulseRate: 2, PulseDepth: 0.5, PulseShape: 'Breathe',
    }],
    Trail: ['Strands', {
        Label: 'Path trail', Shape: 'Trail', Strands: 480, Segments: 96, TrailLength: 0.25, PhaseSpread: 0.3, Spread: 0.06,
        Thickness: 1.2, Taper: 0.3, Intensity: 1.2, Baseline: 0.04, FollowPath: true,
    }],
    Guide: ['Strands', {
        Label: 'Light guide', Shape: 'Guide', Strands: 120, Segments: 128, Spread: 0.08, Amplitude: 0,
        Thickness: 1.2, Intensity: 1.3, Halo: 0.35, Baseline: 1, PulseRate: 1, PulseDepth: 1, PulseShape: 'Sweep',
    }],
    Dust: ['Particles', { Label: 'Dust', Count: 600, Size: 0.01, Brightness: 2, Spread: 6 }],
    Text: ['Text', { Label: 'Title', Title: 'TITLE', Subtitle: 'Subtitle', Face: 'Light', Align: 'Left', X: 0.66, Y: 0.36 }],
};

const SpeedChoices = [0.25, 0.5, 1, 2];

function MechanismCaption(Layer) {
    if (Layer.Mechanism === 'Strands') return Layer.Shape + ' · ' + Layer.Strands;
    if (Layer.Mechanism === 'Particles') return 'Dust · ' + Layer.Count;
    return 'Text';
}

class StrandEditorApp {
    constructor() {
        this.Dom = {
            Canvas: document.getElementById('Canvas'),
            Viewport: document.getElementById('Viewport'),
            Message: document.getElementById('Message'),
            PresetSelect: document.getElementById('PresetSelect'),
            PanelToggle: document.getElementById('PanelToggle'),
            ApplyPreset: document.getElementById('ApplyPreset'),
            NewScene: document.getElementById('NewScene'),
            OpenScene: document.getElementById('OpenScene'),
            SaveScene: document.getElementById('SaveScene'),
            SceneFile: document.getElementById('SceneFile'),
            ExportPng: document.getElementById('ExportPng'),
            ExportWebm: document.getElementById('ExportWebm'),
            LayerList: document.getElementById('LayerList'),
            LayerUp: document.getElementById('LayerUp'),
            LayerDown: document.getElementById('LayerDown'),
            LayerDuplicate: document.getElementById('LayerDuplicate'),
            LayerDelete: document.getElementById('LayerDelete'),
            PlayPause: document.getElementById('PlayPause'),
            Scrub: document.getElementById('Scrub'),
            TimeReadout: document.getElementById('TimeReadout'),
            SpeedSelect: document.getElementById('SpeedSelect'),
            Stats: document.getElementById('Stats'),
            InspectorTitle: document.getElementById('InspectorTitle'),
            InspectorBody: document.getElementById('InspectorBody'),
            InspectorNote: document.getElementById('InspectorNote'),
        };
        this.Canvas = this.Dom.Canvas;
        this.Errors = [];
        this.Selected = null;
        this.Dragging = null;
        this.Fps = 0;
        this.PreviousTime = 0;
        this.Stats = { DrawCalls: 0, Vertices: 0 };
        this.Timeline = new PlaybackTimeline();
        this.Panel = new DisplayPanel(PresetList.map((Preset) => Preset.Label));
        this.PanelOn = false;
        this.PanelSliding = false;
        this.FormatBeforePanel = null;
        this.Scene = BuildPreset(0);
        try {
            this.Renderer = new StrandRenderer(this.Canvas);
        } catch (Failure) {
            this.Renderer = null;
            this.ShowMessage(String(Failure.message || Failure));
        }
        this.PopulatePresets();
        this.BindEvents();
        this.SetScene(this.Scene);
        requestAnimationFrame((Now) => this.Tick(Now));
    }

    PopulatePresets() {
        this.Dom.PresetSelect.textContent = '';
        PresetList.forEach((Preset, Index) => {
            const Option = document.createElement('option');
            Option.value = String(Index);
            Option.textContent = Preset.Label;
            this.Dom.PresetSelect.append(Option);
        });
    }

    BindEvents() {
        const Dom = this.Dom;
        Dom.ApplyPreset.addEventListener('click', () => this.LoadPreset(Number(Dom.PresetSelect.value)));
        Dom.NewScene.addEventListener('click', () => {
            this.SetScene(NormalizeScene({ Name: 'Untitled strand scene', Layers: [CreateLayer('Strands', { Label: 'Fibres' })] }));
        });
        Dom.OpenScene.addEventListener('click', () => Dom.SceneFile.click());
        Dom.SceneFile.addEventListener('change', () => this.OpenFile(Dom.SceneFile.files[0]));
        Dom.SaveScene.addEventListener('click', () => {
            DownloadText(SceneToJson(this.Scene), this.FileStem() + '.json');
        });
        Dom.ExportPng.addEventListener('click', () => this.ExportPng());
        Dom.ExportWebm.addEventListener('click', () => this.ExportLoop());
        document.querySelectorAll('[data-add]').forEach((Button) => {
            Button.addEventListener('click', () => this.AddLayer(Button.dataset.add));
        });
        Dom.LayerUp.addEventListener('click', () => this.MoveSelected(-1));
        Dom.LayerDown.addEventListener('click', () => this.MoveSelected(1));
        Dom.LayerDuplicate.addEventListener('click', () => this.DuplicateSelected());
        Dom.LayerDelete.addEventListener('click', () => this.DeleteSelected());
        Dom.PlayPause.addEventListener('click', () => this.TogglePlay());
        Dom.PanelToggle.addEventListener('click', () => this.TogglePanel());
        Dom.Scrub.addEventListener('input', () => this.Timeline.Seek(Number(Dom.Scrub.value), this.Scene));
        Dom.SpeedSelect.addEventListener('change', () => {
            this.Scene.Playback.Speed = Number(Dom.SpeedSelect.value);
        });

        const Canvas = this.Canvas;
        // 📝 Panel controls take pointer input first (capture phase, stopped when hit), so a press on a control never starts an orbit.
        Canvas.addEventListener('pointerdown', (Event) => this.PanelPointerDown(Event), { capture: true });
        Canvas.addEventListener('pointermove', (Event) => this.PanelPointerMove(Event), { capture: true });
        Canvas.addEventListener('pointerup', () => {
            this.PanelSliding = false;
        });
        Canvas.addEventListener('pointerdown', (Event) => {
            this.Dragging = { X: Event.clientX, Y: Event.clientY };
            Canvas.setPointerCapture(Event.pointerId);
        });
        Canvas.addEventListener('pointermove', (Event) => {
            if (!this.Dragging) return;
            ApplyDrag(this.Scene.Camera, Event.clientX - this.Dragging.X, Event.clientY - this.Dragging.Y);
            this.Dragging = { X: Event.clientX, Y: Event.clientY };
        });
        Canvas.addEventListener('pointerup', () => {
            if (this.Dragging && this.Selected === null) this.RenderInspector();
            this.Dragging = null;
        });
        Canvas.addEventListener('wheel', (Event) => {
            Event.preventDefault();
            ApplyZoom(this.Scene.Camera, Event.deltaY);
        }, { passive: false });

        document.addEventListener('keydown', (Event) => {
            const Tag = document.activeElement ? document.activeElement.tagName : '';
            if (['INPUT', 'SELECT', 'TEXTAREA'].includes(Tag)) return;
            if (Event.code === 'Space') {
                Event.preventDefault();
                this.TogglePlay();
            } else if (Event.key === 'r' || Event.key === 'R') {
                ResetView(this.Scene.Camera);
                this.RenderInspector();
            } else if (Event.key === 'Delete' || Event.key === 'Backspace') {
                this.DeleteSelected();
            }
        });
        window.addEventListener('resize', () => this.FitCanvas());
    }

    // 📝 Panel view: a fixed 1280×800 frame with the light behind 2D preset controls. Turning it off restores the previous frame size.
    TogglePanel() {
        this.PanelOn = !this.PanelOn;
        const Button = this.Dom.PanelToggle;
        Button.setAttribute('aria-pressed', String(this.PanelOn));
        Button.textContent = this.PanelOn ? 'Hide panel view' : 'Panel view';
        if (this.PanelOn) {
            this.FormatBeforePanel = { Width: this.Scene.Width, Height: this.Scene.Height };
            this.Scene.Width = PanelWidth;
            this.Scene.Height = PanelHeight;
        } else if (this.FormatBeforePanel) {
            this.Scene.Width = this.FormatBeforePanel.Width;
            this.Scene.Height = this.FormatBeforePanel.Height;
            this.FormatBeforePanel = null;
        }
        this.RefreshAll();
    }

    // 📝 The overlay is keyed by the active preset. The renderer rasterises each key once per frame size and caches it.
    PanelOverlay() {
        if (!this.PanelOn) return null;
        const Active = Number(this.Dom.PresetSelect.value);
        return { Key: 'panel-' + Active, Rasterize: (Width, Height) => this.Panel.Rasterize(Active, Width, Height) };
    }

    // 📝 Converts a pointer position to panel pixels, origin top-left, using the canvas's displayed size.
    PanelPoint(Event) {
        const Box = this.Canvas.getBoundingClientRect();
        return {
            X: (Event.clientX - Box.left) * (this.Canvas.width / Box.width),
            Y: (Event.clientY - Box.top) * (this.Canvas.height / Box.height),
        };
    }

    PanelPointerDown(Event) {
        if (!this.PanelOn || Event.button !== 0) return;
        const Point = this.PanelPoint(Event);
        const Hit = this.Panel.HitTest(Point.X, Point.Y);
        if (!Hit) return;
        Event.stopImmediatePropagation();
        this.Canvas.setPointerCapture(Event.pointerId);
        this.PanelSliding = Hit.Action === 'Slide';
        this.ChoosePreset(Hit.Index);
    }

    PanelPointerMove(Event) {
        if (!this.PanelOn) return;
        const Point = this.PanelPoint(Event);
        if (this.PanelSliding) {
            Event.stopImmediatePropagation();
            this.ChoosePreset(this.Panel.IndexAtX(Point.X));
            return;
        }
        this.Canvas.style.cursor = this.Panel.HitTest(Point.X, Point.Y) ? 'pointer' : '';
    }

    // 📝 Loads a preset only when its index differs, so a slider drag across one preset does not rebuild it.
    ChoosePreset(Index) {
        if (Number(this.Dom.PresetSelect.value) === Index) return;
        this.Dom.PresetSelect.value = String(Index);
        this.LoadPreset(Index);
    }

    FileStem() {
        return (this.Scene.Name || 'strand-scene').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'strand-scene';
    }

    Tick(Now) {
        const Delta = this.PreviousTime ? Math.min(0.25, (Now - this.PreviousTime) / 1000) : 0;
        this.PreviousTime = Now;
        if (Delta > 0) this.Fps = this.Fps * 0.9 + (1 / Delta) * 0.1;
        this.Timeline.Advance(Delta, this.Scene);
        this.Render();
        this.UpdateTransport();
        requestAnimationFrame((Next) => this.Tick(Next));
    }

    Render() {
        if (!this.Renderer) return;
        try {
            this.Stats = this.Renderer.Draw(this.Scene, this.Timeline.Seconds, this.PanelOverlay());
        } catch (Failure) {
            this.Report(Failure);
        }
    }

    Report(Failure) {
        const Text = String((Failure && Failure.message) || Failure);
        if (this.Errors.includes(Text)) return;
        this.Errors.push(Text);
        console.error(Failure);
        this.ShowMessage(Text);
    }

    ShowMessage(Text) {
        this.Dom.Message.textContent = Text;
        this.Dom.Message.hidden = !Text;
    }

    FitCanvas() {
        const Box = this.Dom.Viewport;
        const Aspect = this.Scene.Width / this.Scene.Height;
        let Width = Box.clientWidth - 32;
        let Height = Box.clientHeight - 32;
        if (Width / Height > Aspect) Width = Height * Aspect;
        else Height = Width / Aspect;
        this.Canvas.style.width = Math.max(1, Math.floor(Width)) + 'px';
        this.Canvas.style.height = Math.max(1, Math.floor(Height)) + 'px';
    }

    SetScene(Next) {
        this.Scene = NormalizeScene(Next);
        if (this.PanelOn) {
            this.Scene.Width = PanelWidth;
            this.Scene.Height = PanelHeight;
        }
        this.Selected = null;
        this.Dom.PresetSelect.value = this.Dom.PresetSelect.value || '0';
        this.RefreshAll();
    }

    LoadPreset(Index) {
        this.SetScene(BuildPreset(Index));
        this.Timeline.Seek(0, this.Scene);
    }

    RefreshAll() {
        this.RenderLayerList();
        this.RenderInspector();
        this.FitCanvas();
        this.SyncSpeed();
    }

    SyncSpeed() {
        const Speed = this.Scene.Playback.Speed;
        const Nearest = SpeedChoices.reduce((Best, Choice) => (Math.abs(Choice - Speed) < Math.abs(Best - Speed) ? Choice : Best));
        this.Dom.SpeedSelect.value = String(Nearest);
    }

    FindLayer(Id) {
        return this.Scene.Layers.find((Layer) => Layer.Id === Id) || null;
    }

    RenderLayerList() {
        const List = this.Dom.LayerList;
        List.textContent = '';
        const AddRow = (Id, Name, Caption, Visible, Changed) => {
            const Row = document.createElement('li');
            Row.className = 'LayerRow' + (Id === this.Selected ? ' Selected' : '');
            const Eye = document.createElement('input');
            Eye.type = 'checkbox';
            Eye.checked = Visible;
            Eye.title = 'Visible';
            Eye.addEventListener('click', (Event) => Event.stopPropagation());
            Eye.addEventListener('change', () => {
                Changed(Eye.checked);
                this.RenderLayerList();
            });
            const Label = document.createElement('span');
            Label.className = 'LayerName';
            Label.textContent = Name;
            const Meta = document.createElement('span');
            Meta.className = 'LayerMeta';
            Meta.textContent = Caption;
            Row.append(Eye, Label, Meta);
            Row.addEventListener('click', () => this.Select(Id));
            List.append(Row);
        };
        AddRow(null, 'Scene', this.Scene.Name, true, () => {});
        for (const Layer of this.Scene.Layers) {
            AddRow(Layer.Id, Layer.Label, MechanismCaption(Layer), Layer.Visible, (Setting) => {
                Layer.Visible = Setting;
            });
        }
        this.Dom.LayerDelete.disabled = this.Selected === null;
        this.Dom.LayerDuplicate.disabled = this.Selected === null;
        this.Dom.LayerUp.disabled = this.Selected === null;
        this.Dom.LayerDown.disabled = this.Selected === null;
    }

    Select(Id) {
        this.Selected = Id;
        this.RenderLayerList();
        this.RenderInspector();
    }

    RenderInspector() {
        const Dom = this.Dom;
        if (this.Selected === null) {
            Dom.InspectorTitle.textContent = 'Scene';
            BuildInspector(Dom.InspectorBody, SceneFields, {
                Read: (Definition) => ReadPath(this.Scene, Definition.Key),
                Write: (Definition, Setting) => WritePath(this.Scene, Definition.Key, Setting),
                Changed: () => this.OnEdited(),
            });
        } else {
            const Layer = this.FindLayer(this.Selected);
            if (!Layer) {
                this.Selected = null;
                this.RenderLayerList();
                this.RenderInspector();
                return;
            }
            Dom.InspectorTitle.textContent = Layer.Label;
            BuildInspector(Dom.InspectorBody, [...LayerFields, ...FieldsFor(Layer.Mechanism)], {
                Read: (Definition) => Layer[Definition.Key],
                Write: (Definition, Setting) => {
                    Layer[Definition.Key] = Setting;
                },
                Changed: () => this.OnEdited(),
            });
        }
        this.UpdateNote();
    }

    OnEdited() {
        this.RenderLayerList();
        this.FitCanvas();
        this.UpdateNote();
    }

    UpdateNote() {
        const Cost = EstimateCost(this.Scene);
        const Lines = [
            Cost.Strands + ' strands · ' + Cost.Vertices.toLocaleString('en-US') + ' vertices · ' + Cost.Dust + ' dust',
        ];
        if (Cost.OverBudget) Lines.push('Over the vertex budget: lower Strands or Segments.');
        this.Dom.InspectorNote.textContent = Lines.join('\n');
    }

    AddLayer(Starter) {
        const Entry = Starters[Starter];
        if (!Entry || this.Scene.Layers.length >= LayerLimit) return;
        const [Mechanism, Overrides] = Entry;
        const Layer = CreateLayer(Mechanism, Overrides);
        this.Scene.Layers.push(Layer);
        this.Select(Layer.Id);
    }

    DuplicateSelected() {
        const Index = this.Scene.Layers.findIndex((Layer) => Layer.Id === this.Selected);
        if (Index < 0 || this.Scene.Layers.length >= LayerLimit) return;
        const Source = this.Scene.Layers[Index];
        const Copy = CreateLayer(Source.Mechanism, { ...Source, Label: Source.Label + ' copy' });
        this.Scene.Layers.splice(Index + 1, 0, Copy);
        this.Select(Copy.Id);
    }

    DeleteSelected() {
        const Index = this.Scene.Layers.findIndex((Layer) => Layer.Id === this.Selected);
        if (Index < 0) return;
        this.Scene.Layers.splice(Index, 1);
        this.Select(null);
    }

    MoveSelected(Direction) {
        const Index = this.Scene.Layers.findIndex((Layer) => Layer.Id === this.Selected);
        const Target = Index + Direction;
        if (Index < 0 || Target < 0 || Target >= this.Scene.Layers.length) return;
        const [Moved] = this.Scene.Layers.splice(Index, 1);
        this.Scene.Layers.splice(Target, 0, Moved);
        this.RenderLayerList();
    }

    TogglePlay() {
        this.Timeline.Toggle();
        this.UpdateTransport();
    }

    UpdateTransport() {
        const Dom = this.Dom;
        const Loop = this.Scene.Playback.LoopSeconds;
        Dom.Scrub.max = String(Loop);
        if (document.activeElement !== Dom.Scrub) Dom.Scrub.value = String(this.Timeline.Seconds);
        Dom.TimeReadout.textContent = this.Timeline.Seconds.toFixed(2) + ' / ' + Loop.toFixed(2) + ' s';
        Dom.PlayPause.textContent = this.Timeline.Playing ? 'Pause' : 'Play';
        const Pixels = this.Scene.Width * this.Scene.Height;
        const Errors = this.Errors.length ? ' · ' + this.Errors.length + ' error(s)' : '';
        Dom.Stats.textContent = this.Fps.toFixed(0) + ' fps · ' + this.Stats.DrawCalls + ' draws · '
            + this.Stats.Vertices.toLocaleString('en-US') + ' vertices · ' + this.Scene.Width + '×' + this.Scene.Height
            + ' (' + (Pixels / 1e6).toFixed(2) + ' MP)' + Errors;
    }

    OpenFile(File) {
        if (!File) return;
        File.text().then((Text) => {
            this.SetScene(SceneFromJson(Text));
        }).catch((Failure) => this.Report(Failure));
        this.Dom.SceneFile.value = '';
    }

    ExportPng() {
        this.Render();
        CanvasToPng(this.Canvas)
            .then((Blob) => DownloadBlob(Blob, this.FileStem() + '.png'))
            .catch((Failure) => this.Report(Failure));
    }

    async ExportLoop() {
        const Dom = this.Dom;
        const Seconds = this.Scene.Playback.LoopSeconds / this.Scene.Playback.Speed;
        this.Timeline.Seek(0, this.Scene);
        this.Timeline.Playing = true;
        Dom.ExportWebm.disabled = true;
        Dom.ExportWebm.textContent = 'Recording one loop…';
        try {
            const Blob = await RecordLoop(this.Canvas, Seconds, 60);
            DownloadBlob(Blob, this.FileStem() + '-loop.webm');
        } catch (Failure) {
            this.Report(Failure);
        } finally {
            Dom.ExportWebm.disabled = false;
            Dom.ExportWebm.textContent = 'Record loop WebM';
        }
    }

    // 📝 Check surface for the browser proof. It is read-only apart from the explicit setters.
    Api() {
        const App = this;
        return {
            Ready: Boolean(App.Renderer),
            PresetLabels: PresetList.map((Preset) => Preset.Label),
            ApplyPreset(Index) {
                App.LoadPreset(Index);
                return App.Scene.Name;
            },
            GetScene() {
                return JSON.parse(JSON.stringify(App.Scene));
            },
            SetScene(Scene) {
                App.SetScene(Scene);
                return true;
            },
            Errors() {
                return App.Errors.slice();
            },
            PngUrl(Seconds, WithPanel = true) {
                App.Renderer.Draw(App.Scene, Seconds, WithPanel ? App.PanelOverlay() : null);
                return App.Canvas.toDataURL('image/png');
            },
            Measure(Index) {
                return App.MeasurePreset(Index);
            },
            PathCoverage(Index) {
                return App.MeasurePathCoverage(Index);
            },
            MeasureFibreColumn(Scene) {
                return App.MeasureFibreColumn(Scene);
            },
            MeasureSweep(Index) {
                return App.MeasureSweep(Index);
            },
            PanelLayout() {
                return {
                    Width: PanelWidth,
                    Height: PanelHeight,
                    Chips: App.Panel.Chips.map((Cell) => ({ Index: Cell.Index, X: Cell.X, Y: Cell.Y, Width: Cell.Width, Height: Cell.Height })),
                    TrackLeft: App.Panel.TrackLeft,
                    TrackRight: App.Panel.TrackRight,
                    TrackY: App.Panel.TrackY,
                };
            },
            PanelStatus() {
                return { On: App.PanelOn, Active: Number(App.Dom.PresetSelect.value), Width: App.Scene.Width, Height: App.Scene.Height };
            },
        };
    }

    MeasurePreset(Index) {
        this.LoadPreset(Index);
        this.Timeline.Playing = false;
        const Scene = this.Scene;
        const Renderer = this.Renderer;
        const Loop = Scene.Playback.LoopSeconds;
        const Step = 1 / 60;
        const Read = (Seconds) => {
            Renderer.Draw(Scene, Seconds);
            return Renderer.ReadPixels();
        };
        const Zero = Read(0);
        const Forward = Read(Step);
        const Wrap = Read(Loop - Step);
        const AtLoop = Read(Loop);
        const Middle = Read(Loop / 2);
        const Summary = Summarise(Zero);
        const Swing = [];
        for (let Slot = 0; Slot < 8; Slot++) Swing.push(Summarise(Read((Loop * Slot) / 8)).MeanLuma);
        const LumaSwing = Math.max(...Swing) - Math.min(...Swing);
        // 📝 With every layer hidden the frame is only the background; a black scene must read zero everywhere.
        const Visibility = Scene.Layers.map((Layer) => Layer.Visible);
        Scene.Layers.forEach((Layer) => {
            Layer.Visible = false;
        });
        const BackgroundPeak = BrightestChannel(Read(0));
        Scene.Layers.forEach((Layer, Position) => {
            Layer.Visible = Visibility[Position];
        });

        let TextEffect = 0;
        const TextLayers = Scene.Layers.filter((Layer) => Layer.Mechanism === 'Text');
        if (TextLayers.length > 0) {
            const Visibility = TextLayers.map((Layer) => Layer.Visible);
            TextLayers.forEach((Layer) => {
                Layer.Visible = false;
            });
            const Without = Read(0);
            TextLayers.forEach((Layer, Position) => {
                Layer.Visible = Visibility[Position];
            });
            TextEffect = MeanDifference(Zero, Without);
        }

        const Brightness = Scene.Post.Brightness;
        Scene.Post.Brightness = 0.5;
        const Dimmed = Summarise(Read(0));
        Scene.Post.Brightness = Brightness;

        Renderer.Draw(Scene, 0);
        const PngUrl = this.Canvas.toDataURL('image/png');
        return {
            Label: PresetList[Index].Label,
            Width: Scene.Width,
            Height: Scene.Height,
            Summary,
            ForwardStep: MeanDifference(Zero, Forward),
            WrapStep: MeanDifference(Wrap, Zero),
            ExactWrap: MeanDifference(Zero, AtLoop),
            MidDifference: MeanDifference(Zero, Middle),
            HasText: TextLayers.length > 0,
            TextEffect,
            DimmedPeak: Dimmed.BrightestChannel,
            BackgroundPeak,
            LumaSwing,
            Cost: EstimateCost(Scene),
            Errors: this.Errors.slice(),
            PngUrl,
        };
    }
    // 📝 Start-transition check: renders the first sweep layer alone with no glow, at several points in the loop, and reads the
    //    share of its pixels that are lit. A sweep starts dark, rises to a plateau, holds, and is dark before the loop ends.
    MeasureSweep(Index) {
        this.LoadPreset(Index);
        this.Timeline.Playing = false;
        const Scene = this.Scene;
        const Layer = Scene.Layers.find((Member) => Member.Mechanism === 'Strands' && Member.PulseShape === 'Sweep' && Member.PulseRate > 0);
        if (!Layer) return null;
        const Visibility = Scene.Layers.map((Member) => Member.Visible);
        const Glow = Scene.Post.Glow;
        Scene.Layers.forEach((Member) => {
            Member.Visible = Member === Layer;
        });
        Scene.Post.Glow = 0;
        const Loop = Scene.Playback.LoopSeconds;
        const Fractions = [0, 0.1, 0.2, 0.3, 0.45, 0.6, 0.75, 0.85, 0.95, 0.99];
        const Shares = Fractions.map((Fraction) => {
            this.Renderer.Draw(Scene, Fraction * Loop);
            const Pixels = this.Renderer.ReadPixels();
            let Lit = 0;
            for (let At = 0; At < Pixels.length; At += 4) {
                if ((Pixels[At] + Pixels[At + 1] + Pixels[At + 2]) / 3 > 0.12 * 255) Lit += 1;
            }
            return Lit / (Pixels.length / 4);
        });
        Scene.Layers.forEach((Member, Position) => {
            Member.Visible = Visibility[Position];
        });
        Scene.Post.Glow = Glow;
        return { Fractions, Shares };
    }

    // 📝 Thin-fibre check: draws the scene it is given (one straight fibre on black) and returns the luminance of the
    //    centre column, bottom to top as the GPU reads it, so the proof can measure the fibre's width in pixels.
    MeasureFibreColumn(Scene) {
        this.SetScene(Scene);
        this.Timeline.Playing = false;
        this.Renderer.Draw(this.Scene, 0.5);
        const Width = this.Canvas.width;
        const Height = this.Canvas.height;
        const Pixels = this.Renderer.ReadPixels();
        const Column = Math.floor(Width / 2);
        const Luma = [];
        for (let Row = 0; Row < Height; Row++) {
            const At = (Row * Width + Column) * 4;
            Luma.push((Pixels[At] + Pixels[At + 1] + Pixels[At + 2]) / 3);
        }
        return { Width, Height, Luma };
    }

    // 📝 Trail check: renders the first trail or guide layer alone, then counts how many of its bright pixels lie within ten pixels
    //    of the scene path as the camera projects it. A trail that rides the path scores close to one.
    MeasurePathCoverage(Index) {
        this.LoadPreset(Index);
        this.Timeline.Playing = false;
        const Scene = this.Scene;
        const Layer = Scene.Layers.find((Member) => Member.Mechanism === 'Strands' && (Member.Shape === 'Trail' || Member.Shape === 'Guide'));
        if (!Layer) return null;
        const Visibility = Scene.Layers.map((Member) => Member.Visible);
        const Glow = Scene.Post.Glow;
        Scene.Layers.forEach((Member) => {
            Member.Visible = Member === Layer;
        });
        Scene.Post.Glow = 0;
        this.Renderer.Draw(Scene, 0.37 * Scene.Playback.LoopSeconds);
        const Pixels = this.Renderer.ReadPixels();
        Scene.Layers.forEach((Member, Position) => {
            Member.Visible = Visibility[Position];
        });
        Scene.Post.Glow = Glow;

        // 📝 Same transform as the shader: local path point scaled, rotated (column-major), then placed, then projected.
        const View = CameraMatrices(Scene.Camera, Scene.Width / Scene.Height).ViewProjection;
        const Rotation = Mat3FromEulerDegrees(Layer.Rotation[0], Layer.Rotation[1], Layer.Rotation[2]);
        const Curve = SamplePath(Scene.Path.Shape, Scene.Path.Size, 2048);
        const Projected = [];
        for (let Sample = 0; Sample < Curve.Count; Sample++) {
            const X = Curve.Samples[Sample * 4] * Layer.Scale;
            const Y = Curve.Samples[Sample * 4 + 1] * Layer.Scale;
            const World = [0, 1, 2].map((Row) => Rotation[Row] * X + Rotation[3 + Row] * Y + Layer.Position[Row]);
            const Clip = [0, 1, 2, 3].map((Row) => View[Row] * World[0] + View[4 + Row] * World[1] + View[8 + Row] * World[2] + View[12 + Row]);
            Projected.push([(Clip[0] / Clip[3] * 0.5 + 0.5) * Scene.Width, (Clip[1] / Clip[3] * 0.5 + 0.5) * Scene.Height]);
        }

        const Tolerance = 10;
        let Lit = 0;
        let Near = 0;
        let DistanceSum = 0;
        for (let Row = 0; Row < Scene.Height; Row++) {
            for (let Column = 0; Column < Scene.Width; Column++) {
                const Byte = (Row * Scene.Width + Column) * 4;
                const Luma = (0.2126 * Pixels[Byte] + 0.7152 * Pixels[Byte + 1] + 0.0722 * Pixels[Byte + 2]) / 255;
                if (Luma < 0.15) continue;
                Lit += 1;
                let Best = Infinity;
                for (const [X, Y] of Projected) {
                    const Gap = (X - (Column + 0.5)) ** 2 + (Y - (Row + 0.5)) ** 2;
                    if (Gap < Best) Best = Gap;
                }
                const Distance = Math.sqrt(Best);
                DistanceSum += Distance;
                if (Distance <= Tolerance) Near += 1;
            }
        }
        return {
            Label: PresetList[Index].Label,
            Lit,
            Fraction: Lit > 0 ? Near / Lit : 0,
            MeanDistance: Lit > 0 ? DistanceSum / Lit : 0,
            Tolerance,
        };
    }
}

const App = new StrandEditorApp();
window.StrandEditor = App.Api();
