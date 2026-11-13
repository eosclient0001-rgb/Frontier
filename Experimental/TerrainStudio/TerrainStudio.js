/*====================================================================================================================================
                                                        TERRAINSTUDIO.JS
====================================================================================================================================*/
// 🧩 Terrain Studio workspace host: outliner, inspector, tool rows, 2D/3D input routing, undo and the realtime frame loop

import { InitializeGpuContext } from "./Engine/GpuContext.js";
import { LandformEvaluation } from "./Engine/LandformEvaluation.js";
import { TerrainViewport } from "./Engine/TerrainViewport.js";
import { PlanarCanvas } from "./Engine/PlanarCanvas.js";
import * as World from "./Engine/WorldDocument.js";
import { ProjectOntoPolyline } from "./Engine/CurveSampling.js";
import { StoreProject, RetrieveProject, EncodeProjectArchive, DecodeProjectArchive, DocumentStorageKey } from "./Engine/StudioStorage.js";

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

const Glyph = {
    Mountain: "\uf6fc", Map: "\uf279", Polygon: "\uf5ee", Square: "\uf5cb", Bezier: "\uf55b", Road: "\uf018", Water: "\uf773",
    Layers: "\uf5fd", Brush: "\uf1fc", Cube: "\uf1b2", Eye: "\uf06e", EyeSlash: "\uf070", Check: "\uf00c", Plus: "\u002b",
    Close: "\uf00d", Up: "\uf062", Down: "\uf063", Trash: "\uf1f8", Hand: "\uf256", Pointer: "\uf245", Pen: "\uf304",
    Expand: "\uf065", Sun: "\uf185", Wave: "\uf83e", Minus: "\uf068", Globe: "\uf0ac", Circle: "\uf111", Eraser: "\uf12d",
    Stairs: "\ue289", CirclePlus: "\uf055", CircleMinus: "\uf056", Gem: "\uf3a5", Archway: "\uf557", Volcano: "\uf770",
    Shapes: "\uf61f", Bullseye: "\uf140", Pencil: "\uf303", Swap: "\uf0ec", Cubes: "\uf1b3", Spray: "\uf5bd", Snow: "\uf2dc",
    Import: "\uf56f", Export: "\uf56e", File: "\uf15b", Rotate: "\uf2f1", Location: "\uf3c5", Ruler: "\uf545", MountainSun: "\ue52f",
};

const SplineGlyph = { Road: Glyph.Road, River: Glyph.Water, Canyon: Glyph.Volcano, Ridge: Glyph.Mountain, Tunnel: Glyph.Archway };
const LayerGlyph = { HeightSculpt: Glyph.Brush, VolumeSculpt: Glyph.Cubes, Spline: Glyph.Bezier };
const LayerLabel = { HeightSculpt: "Height sculpt", VolumeSculpt: "Volume sculpt", Spline: "Spline layer" };

const HeightBrushModes = [
    { Name: "Raise", Mode: 0, Glyph: Glyph.CirclePlus }, { Name: "Lower", Mode: 1, Glyph: Glyph.CircleMinus },
    { Name: "Smooth", Mode: 2, Glyph: Glyph.Wave }, { Name: "Flatten", Mode: 3, Glyph: Glyph.Minus },
    { Name: "Noise", Mode: 4, Glyph: Glyph.Spray }, { Name: "Terrace", Mode: 6, Glyph: Glyph.Stairs },
    { Name: "Erase", Mode: 5, Glyph: Glyph.Eraser },
];
const VolumeBrushModes = [
    { Name: "Add", Mode: 0, Glyph: Glyph.CirclePlus }, { Name: "Carve", Mode: 1, Glyph: Glyph.CircleMinus }, { Name: "Restore", Mode: 2, Glyph: Glyph.Eraser },
];

const PlanarTools = [
    { Name: "Select", Key: "V", Glyph: Glyph.Pointer, Hint: "Click to select · drag to move · drag region handles to resize · double-click a spline to insert a point · double-click a region to activate it" },
    { Name: "Lasso", Key: "L", Glyph: Glyph.Pencil, Hint: "Drag a closed freehand outline — a landmass (Union) or a cut-out (Subtract)" },
    { Name: "Polygon", Key: "P", Glyph: Glyph.Polygon, Hint: "Click vertices · click the first vertex, double-click or Enter to close · Backspace removes · Esc cancels" },
    { Name: "Stroke", Key: "B", Glyph: Glyph.Brush, Hint: "Drag a thick brush stroke (spits, isthmuses, ridgelines of land)" },
    { Name: "Region", Key: "R", Glyph: Glyph.Square, Hint: "Drag a box: the terrain region / simulation bounds. Only the active region is evaluated in 3D" },
    { Name: "Spline", Key: "S", Glyph: Glyph.Bezier, Hint: "Click control points · double-click or Enter to finish · category in the tool bar" },
];
const TerrainTools = [
    { Name: "Navigate", Key: "N", Glyph: Glyph.Hand, Hint: "LMB/RMB orbit · MMB or Shift+RMB pan · wheel zoom to cursor · F frame region" },
    { Name: "Sculpt", Key: "D", Glyph: Glyph.Brush, Hint: "LMB sculpt the target layer · Shift inverts · [ ] radius · RMB orbit · MMB pan" },
    { Name: "Points", Key: "E", Glyph: Glyph.Location, Hint: "Drag spline control points on the terrain · Shift+drag = height (Manual profile) · Ctrl+click appends to the selected spline" },
];

//------------------------------------------------------------------------------------------------------------------------
//                                                  DOM UTILITIES
//------------------------------------------------------------------------------------------------------------------------

function Construct(Tag, Attributes = {}, Contents = [])
{
    const Fragment = document.createElement(Tag);
    for (const [Name, Content] of Object.entries(Attributes))
    {
        if (Name === "Class") Fragment.className = Content;
        else if (Name === "Text") Fragment.textContent = Content;
        else if (Name === "Style") Fragment.setAttribute("style", Content);
        else if (Name.startsWith("On")) Fragment.addEventListener(Name.slice(2).toLowerCase(), Content);
        else Fragment.setAttribute(Name, Content);
    }
    for (const Content of [].concat(Contents)) if (Content !== null && Content !== undefined) Fragment.append(Content);
    return Fragment;
}

const GlyphSpan = (Code, Style = "") => Construct("i", { Class: "Glyph", Text: Code, Style });
const FormatMetres = (Metres) => (Math.abs(Metres) >= 1000 ? `${(Metres / 1000).toFixed(2)} km` : `${Metres.toFixed(Metres < 10 ? 1 : 0)} m`);

//------------------------------------------------------------------------------------------------------------------------
//                                                  TERRAIN STUDIO
//------------------------------------------------------------------------------------------------------------------------

class TerrainStudio
{
    constructor()
    {
        this.Document = this.RecoverDocument();
        this.Selection = { Category: null };
        this.ActiveLayerToken = this.Document.Layers.find((Layer) => Layer.Category === "HeightSculpt")?.Token ?? null;
        this.ToolOptions = { ShapeOperation: "Union", StrokeWidth: 90, SplineCategory: "Road" };
        this.HeightBrush = { Mode: 0, Radius: 45, Strength: 0.5, Hardness: 0.25, TerraceInterval: 12 };
        this.VolumeBrush = { Mode: 0, Radius: 18, Blend: 0.35, Roughness: 0.25 };
        this.Workspace = "Split";
        this.PlanarTool = "Select";
        this.TerrainTool = "Navigate";
        this.FocusedPane = "Terrain";
        this.PlanarHillshadeEnabled = true;
        this.UndoStack = [];
        this.RedoStack = [];
        this.PendingBefore = null;
        this.Pointer = { X: 0, Y: 0, Inside: false, Moved: false };
        this.TerrainDrag = null;
        this.Stroke = null;
        this.HillshadePending = true;
        this.HillshadeTime = 0;
        this.LoopMilliseconds = [];
        this.StatusMessage = "";
        this.StatusMessageTime = 0;
        this.AutosaveTimer = null;
        this.Docks = Object.fromEntries([...document.querySelectorAll("[id]")].map((Fragment) => [Fragment.id, Fragment]));
        try
        {
            this.Gpu = InitializeGpuContext(this.Docks.TerrainCanvas);
            this.Evaluation = new LandformEvaluation(this.Gpu);
            this.Terrain = new TerrainViewport(this.Docks.TerrainCanvas, this.Gpu, this.Evaluation);
        }
        catch (Failure)
        {
            this.Docks.TerrainPane.append(Construct("div", { Class: "ErrorBanner", Text: `GPU initialisation failed: ${Failure.message}` }));
            console.error(Failure);
            this.Gpu = null;
        }
        this.Planar = new PlanarCanvas(this.Docks.PlanarCanvas, this);
        this.AttachChrome();
        this.AttachTerrainInput();
        this.AttachKeyboard();
        this.ConfigureWorkspace(this.Workspace);
        this.RefreshAll();
        requestAnimationFrame(() =>
        {
            const Region = World.ResolveActiveRegion(this.Document);
            if (Region) { this.Planar.FocusRect(Region.MinimumX, Region.MinimumZ, Region.SizeX, Region.SizeZ); this.Terrain?.FocusRegion(Region); }
        });
        this.RestoreSculptArchive();
        window.TerrainStudio = this;
        requestAnimationFrame((Time) => this.Loop(Time));
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                              DOCUMENT LIFECYCLE
    //--------------------------------------------------------------------------------------------------------------------

    RecoverDocument()
    {
        const Parameters = new URLSearchParams(location.search);
        if (!Parameters.has("example"))
        {
            const Stored = localStorage.getItem(DocumentStorageKey);
            const Decoded = Stored ? World.DecodeDocument(Stored) : null;
            if (Decoded) return Decoded;
        }
        return World.ConstructExampleDocument();
    }

    async RestoreSculptArchive()
    {
        if (!this.Gpu || new URLSearchParams(location.search).has("example")) return;
        try
        {
            const Project = await RetrieveProject();
            if (!Project || !Project.Document) return;
            if (World.EncodeDocument(Project.Document) !== World.EncodeDocument(this.Document)) return;
            this.Evaluation.InstallSculptArchive(this.Document, Project.Sculpt ?? []);
            this.ReportStatus("Restored sculpt layers from browser storage");
        }
        catch (Failure)
        {
            console.warn("Sculpt archive restore skipped:", Failure);
        }
    }

    ReplaceDocument(Document, Sculpt = [])
    {
        this.Document = Document;
        this.Selection = { Category: null };
        this.UndoStack.forEach((Entry) => Entry.Snapshot && this.Evaluation.ReleaseSnapshot(Entry.Snapshot));
        this.RedoStack.forEach((Entry) => Entry.Snapshot && this.Evaluation.ReleaseSnapshot(Entry.Snapshot));
        this.UndoStack = [];
        this.RedoStack = [];
        if (this.Gpu)
        {
            this.Evaluation.RegionStores.clear();
            this.Evaluation.Placement = "";
            this.Evaluation.InvalidateFoundation();
            this.Evaluation.InvalidateVolumeLayers();
            this.Evaluation.CheckpointValid = false;
            if (Sculpt.length) this.Evaluation.InstallSculptArchive(Document, Sculpt);
        }
        this.ActiveLayerToken = Document.Layers.find((Layer) => Layer.Category === "HeightSculpt")?.Token ?? null;
        const Region = World.ResolveActiveRegion(Document);
        if (Region) { this.Planar.FocusRect(Region.MinimumX, Region.MinimumZ, Region.SizeX, Region.SizeZ); this.Terrain?.FocusRegion(Region); }
        this.RefreshAll();
        this.ScheduleAutosave();
    }

    ScheduleAutosave()
    {
        localStorage.setItem(DocumentStorageKey, World.EncodeDocument(this.Document));
        clearTimeout(this.AutosaveTimer);
        this.AutosaveTimer = setTimeout(() => this.SaveProject(true), 2500);
    }

    async SaveProject(Automatic = false)
    {
        localStorage.setItem(DocumentStorageKey, World.EncodeDocument(this.Document));
        if (!this.Gpu) return;
        if (this.Stroke || this.TerrainDrag) { this.ScheduleAutosave(); return; }
        try
        {
            await StoreProject({ Document: JSON.parse(World.EncodeDocument(this.Document)), Sculpt: this.Evaluation.ExtractSculptArchive() });
            this.Docks.SaveStatus.textContent = `${Automatic ? "Autosaved" : "Saved"} ${new Date().toLocaleTimeString()}`;
        }
        catch (Failure)
        {
            this.Docks.SaveStatus.textContent = "Save failed";
            console.warn(Failure);
        }
    }

    ExportArchive()
    {
        const Text = EncodeProjectArchive(this.Document, this.Gpu ? this.Evaluation.ExtractSculptArchive() : []);
        const Link = Construct("a", { href: URL.createObjectURL(new Blob([Text], { type: "application/json" })), download: "World.terrain.json" });
        Link.click();
        setTimeout(() => URL.revokeObjectURL(Link.href), 2000);
    }

    ImportArchive()
    {
        const Picker = Construct("input", { type: "file", accept: ".json" });
        Picker.addEventListener("change", async () =>
        {
            const File = Picker.files?.[0];
            if (!File) return;
            try
            {
                const Archive = DecodeProjectArchive(await File.text());
                const Document = World.DecodeDocument(JSON.stringify(Archive.Document));
                if (!Document) throw new Error("Invalid document");
                this.ReplaceDocument(Document, Archive.Sculpt);
                this.ReportStatus(`Imported ${File.name}`);
            }
            catch (Failure)
            {
                this.ReportStatus(`Import failed: ${Failure.message}`);
            }
        });
        Picker.click();
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                              EDIT TRANSACTIONS
    //--------------------------------------------------------------------------------------------------------------------

    BeginDocumentEdit()
    {
        if (this.PendingBefore === null) this.PendingBefore = World.EncodeDocument(this.Document);
    }

    // 📝 Live notification: invalidates only the GPU passes the category touches; the frame loop re-evaluates.
    NotifyDocumentEdit(Category)
    {
        if (this.Gpu)
        {
            if (Category === "Shapes" || Category === "Landform") this.Evaluation.InvalidateFoundation();
            else if (Category === "Splines" || Category === "Layers") { this.Evaluation.InvalidateStack(); this.Evaluation.InvalidateVolumeLayers(); }
            else if (Category === "VolumeLayers") this.Evaluation.InvalidateVolumeLayers();
        }
        this.Planar.Invalidate();
        this.Terrain?.Invalidate();
        this.HillshadePending = true;
    }

    FinalizeDocumentEdit()
    {
        if (this.PendingBefore === null) return;
        const After = World.EncodeDocument(this.Document);
        if (After !== this.PendingBefore) this.PushUndo({ Category: "Document", Before: this.PendingBefore, After });
        this.PendingBefore = null;
        this.RefreshOutliner();
        this.RefreshHeader();
        this.ScheduleAutosave();
    }

    // One complete undoable mutation; RebuildInspector re-renders the inspector afterwards.
    MutateDocument(Category, Mutation, RebuildInspector = true)
    {
        this.BeginDocumentEdit();
        Mutation();
        this.NotifyDocumentEdit(Category);
        this.FinalizeDocumentEdit();
        if (RebuildInspector) this.RefreshInspector();
    }

    PushUndo(Entry)
    {
        this.UndoStack.push(Entry);
        for (const Discarded of this.RedoStack) if (Discarded.Snapshot) this.Evaluation.ReleaseSnapshot(Discarded.Snapshot);
        this.RedoStack = [];
        while (this.UndoStack.length > 80)
        {
            const Oldest = this.UndoStack.shift();
            if (Oldest.Snapshot) this.Evaluation.ReleaseSnapshot(Oldest.Snapshot);
        }
        let Snapshots = this.UndoStack.filter((Candidate) => Candidate.Snapshot);
        while (Snapshots.length > 24)
        {
            const Oldest = Snapshots.shift();
            this.Evaluation.ReleaseSnapshot(Oldest.Snapshot);
            this.UndoStack.splice(this.UndoStack.indexOf(Oldest), 1);
        }
    }

    Undo() { this.TraverseHistory(this.UndoStack, this.RedoStack, "Before"); }
    Redo() { this.TraverseHistory(this.RedoStack, this.UndoStack, "After"); }

    TraverseHistory(Source, Target, Field)
    {
        const Entry = Source.pop();
        if (!Entry) return;
        if (Entry.Category === "Document")
        {
            const Document = World.DecodeDocument(Entry[Field]);
            if (Document)
            {
                this.Document = Document;
                this.ValidateSelection();
                if (this.Gpu) { this.Evaluation.InvalidateFoundation(); this.Evaluation.InvalidateVolumeLayers(); }
            }
        }
        else if (Entry.Snapshot && this.Gpu)
        {
            this.Evaluation.SwapLayerSnapshot(Entry.Snapshot);
        }
        Target.push(Entry);
        this.NotifyDocumentEdit(null);
        this.RefreshAll();
        this.ScheduleAutosave();
    }

    ValidateSelection()
    {
        const Selection = this.Selection;
        const Present =
            (Selection.Category === "Shape" && this.Document.Shapes.some((Shape) => Shape.Token === Selection.Token)) ||
            (Selection.Category === "Region" && this.Document.Regions.some((Region) => Region.Token === Selection.Token)) ||
            (Selection.Category === "Layer" && World.ResolveLayer(this.Document, Selection.Token)) ||
            (Selection.Category === "Spline" && World.ResolveSpline(this.Document, Selection.Token)) ||
            Selection.Category === "Landform";
        if (!Present) this.Selection = { Category: null };
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                             AUTHORING OPERATIONS
    //--------------------------------------------------------------------------------------------------------------------

    Select(Selection)
    {
        this.Selection = { PointIndex: -1, Category: null, ...(Selection ?? {}) };   // 📝 null → world inspector
        if (Selection?.Category === "Layer") this.ActiveLayerToken = Selection.Token;
        if (Selection?.Category === "Spline")
        {
            const Located = World.ResolveSpline(this.Document, Selection.Token);
            if (Located) this.ActiveSplineLayerToken = Located.Layer.Token;
        }
        if (this.Terrain)
        {
            this.Terrain.Overlay.SelectedSplineToken = Selection?.Category === "Spline" ? Selection.Token : null;
            this.Terrain.Overlay.SelectedPointIndex = Selection?.Category === "Spline" ? (Selection.PointIndex ?? -1) : -1;
            this.Terrain.Invalidate();
        }
        this.Planar.Invalidate();
        this.RefreshOutliner();
        this.RefreshInspector();
        this.RefreshToolRow();
    }

    ReportCursor() { }

    ReportStatus(Message)
    {
        this.StatusMessage = Message;
        this.StatusMessageTime = performance.now();
    }

    CreateShape(Category, Points)
    {
        let Shape;
        this.MutateDocument("Shapes", () =>
        {
            Shape = World.ConstructShape(this.Document, Category, this.ToolOptions.ShapeOperation, Points, this.ToolOptions.StrokeWidth);
            this.Document.Shapes.push(Shape);
        }, false);
        this.Select({ Category: "Shape", Token: Shape.Token });
        if (this.Document.Regions.length === 0) this.ReportStatus("Shape added — now draw a Region box (R) around it to simulate it in 3D");
    }

    CreateRegion(MinimumX, MinimumZ, SizeX, SizeZ)
    {
        let Region;
        this.MutateDocument("Regions", () =>
        {
            Region = World.ConstructRegion(this.Document, MinimumX, MinimumZ, SizeX, SizeZ);
            this.Document.Regions.push(Region);
            this.Document.ActiveRegionToken = Region.Token;
        }, false);
        this.Select({ Category: "Region", Token: Region.Token });
        this.Terrain?.FocusRegion(Region);
        this.ReportStatus(`${Region.Name} created and activated`);
    }

    ResolveSplineLayer()
    {
        const Selected = this.Selection.Category === "Layer" ? World.ResolveLayer(this.Document, this.Selection.Token) : null;
        if (Selected?.Category === "Spline") return Selected;
        const Remembered = World.ResolveLayer(this.Document, this.ActiveSplineLayerToken);
        if (Remembered?.Category === "Spline") return Remembered;
        const Existing = [...this.Document.Layers].reverse().find((Layer) => Layer.Category === "Spline");
        if (Existing) return Existing;
        const Created = World.ConstructLayer(this.Document, "Spline");
        this.Document.Layers.push(Created);
        return Created;
    }

    CreateSpline(Points)
    {
        let Spline;
        this.MutateDocument("Splines", () =>
        {
            const Layer = this.ResolveSplineLayer();
            const Heights = this.Gpu ? this.Evaluation.SampleHeights(Points) : Points.map(() => 0);
            Spline = World.ConstructSpline(this.Document, this.ToolOptions.SplineCategory, Points.map((Point, Index) => ({ X: Point.X, Z: Point.Z, Height: Math.round(Heights[Index] * 10) / 10 })));
            Layer.Splines.push(Spline);
            this.ActiveSplineLayerToken = Layer.Token;
        }, false);
        this.Select({ Category: "Spline", Token: Spline.Token, PointIndex: -1 });
    }

    InsertSplinePoint(SplineToken, Position)
    {
        const Located = World.ResolveSpline(this.Document, SplineToken);
        if (!Located) return;
        const Spline = Located.Spline;
        const Projection = ProjectOntoPolyline(Spline.Points, Position.X, Position.Z);
        const InsertIndex = Projection.SegmentIndex + 1;
        this.MutateDocument("Splines", () =>
        {
            const A = Spline.Points[Projection.SegmentIndex], B = Spline.Points[Math.min(InsertIndex, Spline.Points.length - 1)];
            Spline.Points.splice(InsertIndex, 0, { X: Position.X, Z: Position.Z, Height: (A.Height + B.Height) / 2 });
        }, false);
        this.Select({ Category: "Spline", Token: SplineToken, PointIndex: InsertIndex });
    }

    ActivateRegion(RegionToken)
    {
        this.MutateDocument("Regions", () => { this.Document.ActiveRegionToken = RegionToken; }, false);
        const Region = World.ResolveActiveRegion(this.Document);
        this.Terrain?.FocusRegion(Region);
        this.Select({ Category: "Region", Token: RegionToken });
        this.ReportStatus(`${Region.Name} is now the evaluated region`);
    }

    AddLayer(Category)
    {
        let Layer;
        this.MutateDocument(Category === "VolumeSculpt" ? "VolumeLayers" : "Layers", () =>
        {
            Layer = World.ConstructLayer(this.Document, Category);
            this.Document.Layers.push(Layer);
        }, false);
        this.Select({ Category: "Layer", Token: Layer.Token });
    }

    DeleteSelection()
    {
        const Selection = this.Selection;
        if (Selection.Category === "Spline")
        {
            const Located = World.ResolveSpline(this.Document, Selection.Token);
            if (!Located) return;
            if (Selection.PointIndex >= 0 && Located.Spline.Points.length > 2)
            {
                this.MutateDocument("Splines", () => Located.Spline.Points.splice(Selection.PointIndex, 1));
                this.Select({ Category: "Spline", Token: Selection.Token, PointIndex: -1 });
                return;
            }
            this.MutateDocument("Splines", () => Located.Layer.Splines.splice(Located.Layer.Splines.indexOf(Located.Spline), 1), false);
        }
        else if (Selection?.Category === "Shape")
        {
            this.MutateDocument("Shapes", () => { this.Document.Shapes = this.Document.Shapes.filter((Shape) => Shape.Token !== Selection.Token); }, false);
        }
        else if (Selection?.Category === "Region")
        {
            this.MutateDocument("Regions", () =>
            {
                this.Document.Regions = this.Document.Regions.filter((Region) => Region.Token !== Selection.Token);
                if (this.Document.ActiveRegionToken === Selection.Token) this.Document.ActiveRegionToken = this.Document.Regions[0]?.Token ?? null;
            }, false);
        }
        else if (Selection?.Category === "Layer")
        {
            this.MutateDocument("Layers", () => { this.Document.Layers = this.Document.Layers.filter((Layer) => Layer.Token !== Selection.Token); }, false);
        }
        else return;
        this.Select({ Category: null });
    }

    MoveLayer(LayerToken, Direction)
    {
        const Layers = this.Document.Layers;
        const Index = Layers.findIndex((Layer) => Layer.Token === LayerToken);
        const Target = Index + Direction;
        if (Index < 0 || Target < 0 || Target >= Layers.length) return;
        this.MutateDocument("Layers", () => { [Layers[Index], Layers[Target]] = [Layers[Target], Layers[Index]]; }, false);
        this.RefreshOutliner();
    }

    ResolveSculptLayer()
    {
        const Candidates = [this.Selection.Category === "Layer" ? this.Selection.Token : null, this.ActiveLayerToken];
        for (const Token of Candidates)
        {
            const Layer = Token ? World.ResolveLayer(this.Document, Token) : null;
            if (Layer && (Layer.Category === "HeightSculpt" || Layer.Category === "VolumeSculpt")) return Layer;
        }
        return [...this.Document.Layers].reverse().find((Layer) => Layer.Category === "HeightSculpt") ?? null;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                               CHROME + TOOLS
    //--------------------------------------------------------------------------------------------------------------------

    AttachChrome()
    {
        const Docks = this.Docks;
        document.querySelectorAll(".Segmented button").forEach((Button) => Button.addEventListener("click", () => this.ConfigureWorkspace(Button.dataset.workspace)));
        Docks.OutlinerSearch.addEventListener("input", () => this.RefreshOutliner());
        Docks.UndoButton.addEventListener("click", () => this.Undo());
        Docks.RedoButton.addEventListener("click", () => this.Redo());
        Docks.SaveButton.addEventListener("click", () => this.SaveProject(false));
        Docks.AddLayerTab.addEventListener("click", (Event) => this.OpenLayerMenu(Event.currentTarget));
        Docks.HillshadeToggle.addEventListener("click", () =>
        {
            this.PlanarHillshadeEnabled = !this.PlanarHillshadeEnabled;
            Docks.HillshadeToggle.classList.toggle("Active", this.PlanarHillshadeEnabled);
            this.Planar.Invalidate();
        });
        const FocusActiveRegion = () =>
        {
            const Region = World.ResolveActiveRegion(this.Document);
            if (!Region) return;
            this.Planar.FocusRect(Region.MinimumX, Region.MinimumZ, Region.SizeX, Region.SizeZ);
            this.Terrain?.FocusRegion(Region);
        };
        Docks.FocusPlanar.addEventListener("click", FocusActiveRegion);
        Docks.FocusTerrain.addEventListener("click", FocusActiveRegion);
        this.FocusActiveRegion = FocusActiveRegion;
        if (this.Terrain)
        {
            const Settings = this.Terrain.Settings;
            Docks.LensSelect.addEventListener("change", () => { Settings.Lens = Number(Docks.LensSelect.value); this.Terrain.Invalidate(); });
            const BindToggle = (Fragment, Field) => Fragment.addEventListener("click", () =>
            {
                Settings[Field] = !Settings[Field];
                Fragment.classList.toggle("Active", Settings[Field]);
                this.Terrain.Invalidate();
            });
            BindToggle(Docks.ContourToggle, "ContoursEnabled");
            BindToggle(Docks.ShadowToggle, "ShadowsEnabled");
            BindToggle(Docks.WaterToggle, "WaterEnabled");
        }
        Docks.PlanarPane.addEventListener("pointerenter", () => this.FocusPane("Planar"));
        Docks.TerrainPane.addEventListener("pointerenter", () => this.FocusPane("Terrain"));
        Docks.ShortcutTab.addEventListener("click", () => Docks.ShortcutOverlay.classList.toggle("Open"));
        Docks.ShortcutOverlay.append(
            Construct("div", { Class: "SectionTitle", Style: "margin-top:0" }, [Construct("span", { Text: "Shortcuts" }), Construct("small", { Text: "focus follows the pointer" })]),
            Construct("div", { Class: "KeyGrid" }, [
                ["1 / 2 / 3", "2D World · 3D Landform · Split"], ["V L P B R S", "2D: Select · Lasso · Polygon · Stroke · Region · Spline"],
                ["N D E", "3D: Navigate · Sculpt · Points"], ["[ ]", "Brush radius"], ["Shift", "Invert brush (raise↔lower, add↔carve)"],
                ["Ctrl+Z / Ctrl+Y", "Undo / redo (vector edits and sculpt strokes)"], ["Delete", "Remove selection or selected point"],
                ["F", "Focus active region (zoom to fit)"], ["Enter / Esc", "Finish / cancel polygon or spline"], ["Ctrl+S", "Save to browser storage"],
            ].flatMap(([Key, Meaning]) => [Construct("kbd", { Text: Key }), Construct("span", { Text: Meaning })])));
    }

    FocusPane(Pane)
    {
        this.FocusedPane = Pane;
        this.Docks.PlanarPane.classList.toggle("Focused", Pane === "Planar");
        this.Docks.TerrainPane.classList.toggle("Focused", Pane === "Terrain");
    }

    OpenLayerMenu(Anchor)
    {
        document.querySelector(".LayerMenu")?.remove();
        const Rect = Anchor.getBoundingClientRect();
        const Menu = Construct("div", { Class: "LayerMenu Card", Style: `position:fixed;z-index:50;left:${Rect.left}px;top:${Rect.bottom + 6}px;width:220px;display:flex;flex-direction:column;gap:6px;` },
            ["HeightSculpt", "Spline", "VolumeSculpt"].map((Category) => Construct("button", { OnClick: () => { Menu.remove(); this.AddLayer(Category); }, Style: "justify-content:flex-start" },
                [GlyphSpan(LayerGlyph[Category]), Construct("span", { Text: `Add ${LayerLabel[Category].toLowerCase()}` })])));
        document.body.append(Menu);
        setTimeout(() => document.addEventListener("pointerdown", function Dismiss(Event) { if (!Menu.contains(Event.target)) { Menu.remove(); document.removeEventListener("pointerdown", Dismiss); } }), 0);
    }

    ConfigureWorkspace(Workspace)
    {
        this.Workspace = Workspace;
        this.Docks.ViewportArea.dataset.workspace = Workspace;
        document.querySelectorAll(".Segmented button").forEach((Button) => Button.classList.toggle("Active", Button.dataset.workspace === Workspace));
        if (Workspace !== "Split") this.FocusPane(Workspace);
        this.Planar.Invalidate();
        this.Terrain?.Invalidate();
        this.HillshadePending = true;
        this.RefreshToolRow();
    }

    ConfigurePlanarTool(Tool)
    {
        if (this.Planar.Draft && this.Planar.Draft.Tool !== Tool) this.Planar.Draft = null;
        this.PlanarTool = Tool;
        this.Planar.Tool = Tool;
        this.Planar.Invalidate();
        this.RefreshToolRow();
    }

    ConfigureTerrainTool(Tool)
    {
        this.TerrainTool = Tool;
        if (this.Terrain) { this.Terrain.Brush.Visible = false; this.Terrain.Invalidate(); }
        this.RefreshToolRow();
    }

    RefreshToolRow()
    {
        const Row = this.Docks.ToolRow;
        Row.replaceChildren();
        const ShowPlanar = this.Workspace !== "Terrain";
        const ShowTerrain = this.Workspace !== "Planar";
        if (ShowPlanar)
        {
            Row.append(Construct("div", { Class: "ToolGroup" }, [Construct("span", { Class: "GroupLabel", Text: "2D" }),
                ...PlanarTools.map((Tool) => Construct("button", { Class: this.PlanarTool === Tool.Name ? "Active" : "", title: Tool.Hint, OnClick: () => this.ConfigurePlanarTool(Tool.Name) },
                    [GlyphSpan(Tool.Glyph), Construct("span", { Text: Tool.Name }), Construct("kbd", { Text: Tool.Key })]))]));
            if (["Lasso", "Polygon", "Stroke"].includes(this.PlanarTool))
            {
                Row.append(Construct("div", { Class: "ToolGroup" }, ["Union", "Subtract"].map((Operation) =>
                    Construct("button", { Class: this.ToolOptions.ShapeOperation === Operation ? "Active" : "", OnClick: () => { this.ToolOptions.ShapeOperation = Operation; this.RefreshToolRow(); } },
                        [GlyphSpan(Operation === "Union" ? Glyph.CirclePlus : Glyph.CircleMinus), Construct("span", { Text: Operation })]))));
            }
            if (this.PlanarTool === "Stroke") Row.append(this.ConstructToolSlider("Width", 10, 600, 5, () => this.ToolOptions.StrokeWidth, (Number) => { this.ToolOptions.StrokeWidth = Number; }, "m"));
            if (this.PlanarTool === "Spline")
            {
                Row.append(Construct("div", { Class: "ToolGroup" }, World.SplineCategories.map((Category) =>
                    Construct("button", { Class: this.ToolOptions.SplineCategory === Category ? "Active" : "", title: World.SplineCategoryProfiles[Category].Description, OnClick: () => { this.ToolOptions.SplineCategory = Category; this.RefreshToolRow(); } },
                        [Construct("span", { Class: "Swatch", Style: `background:${World.SplineCategoryProfiles[Category].Colour}` }), Construct("span", { Text: Category })]))));
            }
        }
        if (ShowTerrain)
        {
            Row.append(Construct("div", { Class: "ToolGroup" }, [Construct("span", { Class: "GroupLabel", Text: "3D" }),
                ...TerrainTools.map((Tool) => Construct("button", { Class: this.TerrainTool === Tool.Name ? "Active" : "", title: Tool.Hint, OnClick: () => this.ConfigureTerrainTool(Tool.Name) },
                    [GlyphSpan(Tool.Glyph), Construct("span", { Text: Tool.Name }), Construct("kbd", { Text: Tool.Key })]))]));
            if (this.TerrainTool === "Sculpt")
            {
                const Layer = this.ResolveSculptLayer();
                const Volume = Layer?.Category === "VolumeSculpt";
                const Brush = Volume ? this.VolumeBrush : this.HeightBrush;
                const Modes = Volume ? VolumeBrushModes : HeightBrushModes;
                Row.append(Construct("div", { Class: "ToolGroup" }, Modes.map((Mode) =>
                    Construct("button", { Class: Brush.Mode === Mode.Mode ? "Active" : "", title: Mode.Name, OnClick: () => { Brush.Mode = Mode.Mode; this.RefreshToolRow(); this.RefreshInspector(); } }, [GlyphSpan(Mode.Glyph), Construct("span", { Text: Mode.Name })]))));
                Row.append(this.ConstructToolSlider("Radius", 2, 400, 1, () => Brush.Radius, (Number) => { Brush.Radius = Number; }, "m"));
                if (!Volume) Row.append(this.ConstructToolSlider("Strength", 0.02, 1, 0.01, () => Brush.Strength, (Number) => { Brush.Strength = Number; }, ""));
                Row.append(Construct("div", { Class: "ToolGroup" }, [Construct("span", { Class: "GroupLabel", Text: "TARGET" }),
                    Construct("span", { Class: "ToolValue", Text: Layer ? Layer.Name : "none — add a sculpt layer", Style: "padding:0 10px 0 0" })]));
            }
        }
        const PlanarHint = PlanarTools.find((Tool) => Tool.Name === this.PlanarTool)?.Hint ?? "";
        const TerrainHint = TerrainTools.find((Tool) => Tool.Name === this.TerrainTool)?.Hint ?? "";
        this.Docks.PlanarHint.textContent = `${this.PlanarTool}: ${PlanarHint} · wheel zoom · MMB/RMB/Space pan`;
        this.Docks.TerrainHint.textContent = `${this.TerrainTool}: ${TerrainHint}`;
    }

    ConstructToolSlider(Label, Minimum, Maximum, Step, Read, Write, Unit)
    {
        const Value = Construct("span", { Class: "ToolValue" });
        const Range = Construct("input", { type: "range", min: Minimum, max: Maximum, step: Step, "aria-label": Label });
        const Refresh = () =>
        {
            Range.value = Read();
            Range.style.setProperty("--fill", `${((Read() - Minimum) / (Maximum - Minimum)) * 100}%`);
            Value.textContent = `${Number(Read()).toFixed(Step < 1 ? 2 : 0)}${Unit ? " " + Unit : ""}`;
        };
        Range.addEventListener("input", () => { Write(Number(Range.value)); Refresh(); if (this.Terrain) { this.Terrain.Brush.Radius = this.CurrentBrushRadius(); this.Terrain.Invalidate(); } });
        Refresh();
        Range.RefreshControl = Refresh;
        return Construct("div", { Class: "ToolGroup" }, [Construct("span", { Class: "GroupLabel", Text: Label.toUpperCase() }), Range, Value]);
    }

    CurrentBrushRadius()
    {
        return this.ResolveSculptLayer()?.Category === "VolumeSculpt" ? this.VolumeBrush.Radius : this.HeightBrush.Radius;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                  OUTLINER
    //--------------------------------------------------------------------------------------------------------------------

    RefreshAll()
    {
        this.RefreshOutliner();
        this.RefreshInspector();
        this.RefreshToolRow();
        this.RefreshHeader();
        this.Planar.Invalidate();
        this.Terrain?.Invalidate();
        if (this.Terrain) this.Terrain.Overlay.Document = this.Document;
    }

    RefreshHeader()
    {
        const Region = World.ResolveActiveRegion(this.Document);
        if (this.Terrain) this.Terrain.Overlay.Document = this.Document;
        if (!Region)
        {
            this.Docks.SceneTitle.textContent = "No region";
            this.Docks.SceneSubtitle.textContent = "Draw a region box in the 2D world (R)";
            return;
        }
        const Lattice = World.EvaluateRegionLattice(Region);
        this.Docks.SceneTitle.textContent = Region.Name;
        this.Docks.SceneSubtitle.textContent = `${FormatMetres(Region.SizeX)} × ${FormatMetres(Region.SizeZ)} · height ${Lattice.HeightWidth}×${Lattice.HeightDepth} @ ${Lattice.HeightTexel.toFixed(2)} m · volume ${Lattice.VolumeWidth}×${Lattice.VolumeHeight}×${Lattice.VolumeDepth} @ ${Lattice.VolumeVoxel.toFixed(1)} m`;
    }

    RefreshOutliner()
    {
        const Tree = this.Docks.OutlinerTree;
        const Filter = this.Docks.OutlinerSearch.value.trim().toLowerCase();
        const Matches = (Name) => !Filter || Name.toLowerCase().includes(Filter);
        const Document = this.Document;
        const Selection = this.Selection;
        this.Docks.RegionCount.textContent = Document.Regions.length;
        this.Docks.LayerCount.textContent = Document.Layers.length;
        const SplineCount = Document.Layers.reduce((Total, Layer) => Total + Layer.Splines.length, 0);
        this.Docks.OutlinerSummary.textContent = `World · ${Document.Shapes.length} shapes · ${SplineCount} splines`;
        Tree.replaceChildren();
        const Row = ({ Indent = 0, Icon, IconColour = "#d0d0d0", Name, Detail, Selected, OnSelect, Visible, OnToggle, Actions = [], Chip = null }) =>
            Construct("div", { Class: `TreeRow${Selected ? " Selected" : ""}`, Style: `--indent:${Indent}`, OnClick: OnSelect }, [
                Construct("span", { Class: "RowIcon" }, GlyphSpan(Icon, `color:${IconColour}`)),
                Construct("span", { Class: "RowText" }, [Construct("span", { Text: Name }), Construct("small", { Text: Detail })]),
                Chip,
                Construct("span", { Class: "RowActions" }, Actions.map(([Code, Title, Action]) => Construct("button", { title: Title, OnClick: (Event) => { Event.stopPropagation(); Action(); } }, GlyphSpan(Code)))),
                OnToggle ? Construct("button", { Class: `Visibility${Visible ? "" : " Hidden"}`, title: Visible ? "Visible — click to hide" : "Hidden — click to show", OnClick: (Event) => { Event.stopPropagation(); OnToggle(); } }, GlyphSpan(Visible ? Glyph.Check : Glyph.EyeSlash)) : null,
            ]);
        const Group = (Icon, Title, Count, Button, Rows) => Construct("div", { Class: "TreeGroup" }, [
            Construct("div", { Class: "TreeGroupHeader" }, [GlyphSpan(Icon), Construct("span", { Text: Title }), Construct("small", { Text: String(Count) }), Button]),
            ...Rows]);

        const ShapeRows = Document.Shapes.filter((Shape) => Matches(Shape.Name)).map((Shape) => Row({
            Icon: Shape.Category === "Stroke" ? Glyph.Brush : Shape.Category === "Polygon" ? Glyph.Polygon : Glyph.Pencil,
            IconColour: Shape.Operation === "Subtract" ? "#e0806c" : "#8fcf72",
            Name: Shape.Name, Detail: `${Shape.Category} · ${Shape.Operation} · ${Shape.Points.length} pts`,
            Selected: Selection.Category === "Shape" && Selection.Token === Shape.Token,
            OnSelect: () => this.Select({ Category: "Shape", Token: Shape.Token }),
            Visible: Shape.VisibilityEnabled, OnToggle: () => this.MutateDocument("Shapes", () => { Shape.VisibilityEnabled = !Shape.VisibilityEnabled; }),
        }));
        Tree.append(Group(Glyph.Shapes, "World shapes", Document.Shapes.length,
            Construct("button", { title: "Draw a landmass (Lasso)", OnClick: () => { this.ConfigureWorkspace(this.Workspace === "Terrain" ? "Split" : this.Workspace); this.ConfigurePlanarTool("Lasso"); } }, [GlyphSpan(Glyph.Plus), "Draw"]), ShapeRows));

        const RegionRows = Document.Regions.filter((Region) => Matches(Region.Name)).map((Region) => Row({
            Icon: Glyph.Square, IconColour: Region.Token === Document.ActiveRegionToken ? "#f0a83a" : "#9a9a9a",
            Name: Region.Name, Detail: `${FormatMetres(Region.SizeX)} × ${FormatMetres(Region.SizeZ)} · ${Region.HeightResolution} px`,
            Selected: Selection.Category === "Region" && Selection.Token === Region.Token,
            OnSelect: () => this.Select({ Category: "Region", Token: Region.Token }),
            Chip: Region.Token === Document.ActiveRegionToken ? Construct("span", { Class: "Chip", Text: "ACTIVE" }) : Construct("button", { Class: "Chip Muted", Style: "border:0;min-height:0;padding:2px 7px", title: "Evaluate this region in 3D", OnClick: (Event) => { Event.stopPropagation(); this.ActivateRegion(Region.Token); } }, "ACTIVATE"),
        }));
        Tree.append(Group(Glyph.Square, "Regions", Document.Regions.length,
            Construct("button", { title: "Draw a region box", OnClick: () => { this.ConfigureWorkspace(this.Workspace === "Terrain" ? "Split" : this.Workspace); this.ConfigurePlanarTool("Region"); } }, [GlyphSpan(Glyph.Plus), "Box"]), RegionRows));

        const LayerRows = [];
        const Layers = Document.Layers;
        for (let Index = Layers.length - 1; Index >= 0; Index--)
        {
            const Layer = Layers[Index];
            const SplineRows = Layer.Splines.filter((Spline) => Matches(Spline.Name)).map((Spline) => Row({
                Indent: 1, Icon: SplineGlyph[Spline.Category], IconColour: World.SplineCategoryProfiles[Spline.Category].Colour,
                Name: Spline.Name, Detail: `${Spline.Category} · ${Spline.Points.length} pts · ${Spline.Width} m · ${Spline.ProfileMode}`,
                Selected: Selection.Category === "Spline" && Selection.Token === Spline.Token,
                OnSelect: () => this.Select({ Category: "Spline", Token: Spline.Token, PointIndex: -1 }),
                Visible: Spline.VisibilityEnabled, OnToggle: () => this.MutateDocument("Splines", () => { Spline.VisibilityEnabled = !Spline.VisibilityEnabled; }),
            }));
            if (!Matches(Layer.Name) && SplineRows.length === 0) continue;
            const Sculpting = this.TerrainTool === "Sculpt" && this.ResolveSculptLayer()?.Token === Layer.Token;
            LayerRows.push(Row({
                Icon: LayerGlyph[Layer.Category], IconColour: Layer.Category === "Spline" ? "#d9c38a" : Layer.Category === "VolumeSculpt" ? "#b48cf0" : "#7fb6ff",
                Name: Layer.Name, Detail: `${LayerLabel[Layer.Category]}${Layer.Category === "Spline" ? ` · ${Layer.Splines.length} splines` : ""} · ${Math.round(Layer.Opacity * 100)}%`,
                Selected: Selection.Category === "Layer" && Selection.Token === Layer.Token,
                OnSelect: () => this.Select({ Category: "Layer", Token: Layer.Token }),
                Visible: Layer.VisibilityEnabled, OnToggle: () => this.MutateDocument(Layer.Category === "VolumeSculpt" ? "VolumeLayers" : "Layers", () => { Layer.VisibilityEnabled = !Layer.VisibilityEnabled; }),
                Actions: [[Glyph.Up, "Move up the stack", () => this.MoveLayer(Layer.Token, 1)], [Glyph.Down, "Move down the stack", () => this.MoveLayer(Layer.Token, -1)]],
                Chip: Sculpting ? Construct("span", { Class: "Chip", Text: "BRUSH" }) : null,
            }), ...SplineRows);
        }
        LayerRows.push(Row({
            Icon: Glyph.MountainSun, IconColour: "#8fcf72", Name: "Foundation landform", Detail: "Shapes → coast field → relief (bottom of stack)",
            Selected: Selection.Category === "Landform", OnSelect: () => this.Select({ Category: "Landform" }),
        }));
        Tree.append(Group(Glyph.Layers, "Layer stack", Layers.length,
            Construct("button", { title: "Add layer", OnClick: (Event) => this.OpenLayerMenu(Event.currentTarget) }, [GlyphSpan(Glyph.Plus), "Layer"]), LayerRows));
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                              INSPECTOR WIDGETS
    //--------------------------------------------------------------------------------------------------------------------

    // Slider + numeric field. DocumentCategory != null makes the edit undoable and live-evaluated while dragging.
    ConstructSlider({ Label, Unit = "", Minimum, Maximum, Step, Read, Write, DocumentCategory = null, Note = "" })
    {
        const Range = Construct("input", { type: "range", min: Minimum, max: Maximum, step: Step, "aria-label": Label });
        const Field = Construct("input", { type: "number", min: Minimum, max: Maximum, step: Step, "aria-label": `${Label} value` });
        const Decimals = Step >= 1 ? 0 : Step >= 0.1 ? 1 : 2;
        const Refresh = () =>
        {
            const Current = Read();
            Range.value = Current;
            Field.value = Number(Current).toFixed(Decimals);
            Range.style.setProperty("--fill", `${Math.min(100, Math.max(0, ((Current - Minimum) / (Maximum - Minimum)) * 100))}%`);
        };
        const Apply = (Magnitude) =>
        {
            if (!Number.isFinite(Magnitude)) return;
            Write(Magnitude);
            if (DocumentCategory) this.NotifyDocumentEdit(DocumentCategory);
            Refresh();
        };
        Range.addEventListener("pointerdown", () => DocumentCategory && this.BeginDocumentEdit());
        Range.addEventListener("input", () => { if (DocumentCategory) this.BeginDocumentEdit(); Apply(Number(Range.value)); });
        Range.addEventListener("change", () => DocumentCategory && this.FinalizeDocumentEdit());
        Field.addEventListener("change", () => { if (DocumentCategory) this.BeginDocumentEdit(); Apply(Number(Field.value)); if (DocumentCategory) this.FinalizeDocumentEdit(); });
        Refresh();
        return Construct("div", { Class: "ControlRow" }, [
            Construct("div", { Class: "ControlLabel" }, [Construct("span", { Text: Label }), Construct("small", { Text: Note || `${Minimum} – ${Maximum}${Unit ? " " + Unit : ""}` })]),
            Construct("div", { Class: "ControlInputs" }, [Range, Field, Construct("span", { Class: "Unit", Text: Unit })]),
        ]);
    }

    ConstructPills(Label, Options, Read, Write)
    {
        const Row = Construct("div", { Class: "PillRow" });
        const Refresh = () => Row.querySelectorAll("button").forEach((Button) => Button.classList.toggle("Active", Button.dataset.key === String(Read())));
        for (const Option of Options)
        {
            const Key = typeof Option === "object" ? Option.Key : Option;
            const Text = typeof Option === "object" ? Option.Label : Option;
            Row.append(Construct("button", { "data-key": String(Key), OnClick: () => { Write(Key); Refresh(); } }, Text));
        }
        Refresh();
        return Construct("div", { Class: "ControlRow" }, [Construct("div", { Class: "ControlLabel" }, [Construct("span", { Text: Label })]), Row]);
    }

    ConstructToggle(Label, Read, Write)
    {
        const Switch = Construct("button", { Class: `Switch${Read() ? " On" : ""}`, "aria-label": Label, role: "switch" });
        Switch.addEventListener("click", () => { Write(!Read()); Switch.classList.toggle("On", Read()); });
        return Construct("div", { Class: "ToggleRow" }, [Construct("span", { Text: Label }), Switch]);
    }

    ConstructTiles(Options, Read, Write, Columns = 3)
    {
        const Grid = Construct("div", { Class: "TileGrid", Style: `--columns:${Columns}` });
        for (const Option of Options)
        {
            Grid.append(Construct("button", { Class: `Tile${Read() === Option.Key ? " Active" : ""}`, title: Option.Title ?? Option.Label, OnClick: () => { Write(Option.Key); Grid.querySelectorAll(".Tile").forEach((Tile, Index) => Tile.classList.toggle("Active", Options[Index].Key === Read())); } },
                [GlyphSpan(Option.Glyph, Option.Colour ? `color:${Option.Colour}` : ""), Construct("span", { Text: Option.Label })]));
        }
        return Grid;
    }

    ConstructMetrics(Pairs, Ledger)
    {
        return Construct("div", { Class: "MetricGrid" }, Pairs.map(([Value, Unit, Caption]) =>
        {
            const Strong = Construct("strong", {}, [String(Value), Construct("small", { Text: Unit })]);
            if (Ledger) Ledger[Caption] = Strong;               // 📝 live metric: RefreshStatus rewrites the value node
            return Construct("div", { Class: "MetricCard" }, [Strong, Construct("span", { Text: Caption })]);
        }));
    }

    ConstructHeader(Path, Name, Subtitle, Rename)
    {
        const Title = Rename
            ? Construct("div", { Class: "InspectorTitle" }, Construct("input", { type: "text", value: Name, "aria-label": "Name", OnChange: (Event) => Rename(Event.target.value) }))
            : Construct("div", { Class: "InspectorTitle", Text: Name });
        return [Construct("div", { Class: "InspectorPath" }, [Construct("span", { Text: `Inspector / ${Path}` })]), Title, Construct("div", { Class: "InspectorSubtitle", Text: Subtitle })];
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                  INSPECTOR
    //--------------------------------------------------------------------------------------------------------------------

    RefreshInspector()
    {
        const Body = this.Docks.InspectorBody;
        Body.replaceChildren();
        this.WorldMetrics = null;
        const Selection = this.Selection;                                       // 📝 null → world inspector
        if (Selection?.Category === "Region") this.InspectRegion(Body, this.Document.Regions.find((Region) => Region.Token === Selection.Token));
        else if (Selection?.Category === "Shape") this.InspectShape(Body, this.Document.Shapes.find((Shape) => Shape.Token === Selection.Token));
        else if (Selection?.Category === "Layer") this.InspectLayer(Body, World.ResolveLayer(this.Document, Selection.Token));
        else if (Selection?.Category === "Spline") this.InspectSpline(Body, World.ResolveSpline(this.Document, Selection.Token));
        else if (Selection?.Category === "Landform") this.InspectLandform(Body);
        else this.InspectWorld(Body);
    }

    InspectWorld(Body)
    {
        const Document = this.Document;
        const Region = World.ResolveActiveRegion(Document);
        Body.append(...this.ConstructHeader("World", "World", "Infinite 2D world · one region evaluated at a time"));
        Body.append(Construct("div", { Class: "HeroBanner" }, [Construct("span", { Text: Region ? Region.Name : "No active region" }), Construct("small", { Text: Region ? `${FormatMetres(Region.SizeX)} × ${FormatMetres(Region.SizeZ)}` : "draw a box" })]));
        const Lattice = Region ? World.EvaluateRegionLattice(Region) : null;
        const Memory = this.Gpu && this.Evaluation.Work ? (this.Evaluation.Work.ByteFootprint / 1048576).toFixed(0) : "–";
        Body.append(this.ConstructMetrics([
            [Document.Shapes.length, "", "Shapes"], [Document.Layers.reduce((Total, Layer) => Total + Layer.Splines.length, 0), "", "Splines"],
            [Lattice ? Lattice.HeightTexel.toFixed(2) : "–", "m", "Height texel"], [Memory, "MB", "GPU work set"],
        ], this.WorldMetrics = {}));
        Body.append(Construct("div", { Class: "SectionTitle" }, [Construct("span", { Text: "Workflow" }), Construct("small", { Text: "authoring → bake" })]));
        Body.append(Construct("div", { Class: "Card" }, [
            Construct("div", { Class: "Note" }, [Construct("b", { Text: "① 2D World — " }), "draw landmass shapes (Lasso/Polygon/Stroke). The world is unbounded; pan and zoom freely."]),
            Construct("div", { Class: "Note" }, [Construct("b", { Text: "② Region — " }), "drag a box around the part you want to work on. Only the active region is evaluated and rendered in 3D (world partition)."]),
            Construct("div", { Class: "Note" }, [Construct("b", { Text: "③ Splines — " }), "roads, rivers, canyons, ridges and tunnels as non-destructive layers. Edit any point and the GPU re-evaluates instantly."]),
            Construct("div", { Class: "Note" }, [Construct("b", { Text: "④ 3D Sculpt — " }), "height layers and volumetric (overhang/cave) layers. Fixed-size GPU textures: no sculpt limit, no mesh rebake."]),
        ]));
        Body.append(Construct("div", { Class: "SectionTitle" }, [Construct("span", { Text: "Project" })]));
        Body.append(Construct("div", { Class: "ButtonRow" }, [
            Construct("button", { OnClick: () => this.SaveProject(false) }, [GlyphSpan("\uf0c7"), "Save"]),
            Construct("button", { OnClick: () => this.ExportArchive() }, [GlyphSpan(Glyph.Export), "Export .json"]),
            Construct("button", { OnClick: () => this.ImportArchive() }, [GlyphSpan(Glyph.Import), "Import"]),
        ]));
        Body.append(Construct("div", { Class: "ButtonRow" }, [
            Construct("button", { OnClick: () => this.ReplaceDocument(World.ConstructExampleDocument()) }, [GlyphSpan(Glyph.Rotate), "Load example"]),
            Construct("button", { Class: "Danger", OnClick: () =>
            {
                const Blank = World.ConstructExampleDocument();
                Blank.Shapes = []; Blank.Regions = []; Blank.ActiveRegionToken = null;
                Blank.Layers = [World.ConstructLayer(Blank, "HeightSculpt"), World.ConstructLayer(Blank, "Spline"), World.ConstructLayer(Blank, "VolumeSculpt")];
                this.ReplaceDocument(Blank);
                this.ConfigureWorkspace("Planar");
                this.ConfigurePlanarTool("Lasso");
            } }, [GlyphSpan(Glyph.File), "New blank world"]),
        ]));
        if (this.Gpu) Body.append(Construct("div", { Class: "Note", Text: `GPU: ${this.Gpu.AdapterName} · float filtering ${this.Gpu.LinearFloat ? "hardware" : "manual"} · timer queries ${this.Gpu.TimerQuery ? "available" : "unavailable"}` }));
    }

    InspectLandform(Body)
    {
        const Landform = this.Document.Landform;
        Body.append(...this.ConstructHeader("Layer stack", "Foundation landform", "Bottom of the stack · generated from the 2D shapes"));
        Body.append(this.ConstructTiles(World.FalloffProfiles.map((Profile) => ({ Key: Profile, Label: Profile, Glyph: { Soft: Glyph.Wave, Linear: Glyph.Ruler, Plateau: Glyph.Minus, Hard: Glyph.Stairs }[Profile] })),
            () => Landform.FalloffProfile, (Key) => this.MutateDocument("Landform", () => { Landform.FalloffProfile = Key; }, false), 4));
        const Slider = (Label, Field, Minimum, Maximum, Step, Unit) => Body.append(this.ConstructSlider({ Label, Unit, Minimum, Maximum, Step, Read: () => Landform[Field], Write: (Number) => { Landform[Field] = Number; }, DocumentCategory: "Landform" }));
        Body.append(Construct("div", { Class: "SectionTitle" }, [Construct("span", { Text: "Coast" }), Construct("small", { Text: "jump-flood distance field" })]));
        Slider("Coast falloff", "CoastFalloff", 10, 1500, 5, "m");
        Slider("Coast noise", "CoastNoiseAmplitude", 0, 200, 1, "m");
        Slider("Coast noise scale", "CoastNoiseScale", 20, 1000, 5, "m");
        Slider("Shore height", "ShoreHeight", -20, 40, 0.5, "m");
        Slider("Shelf width", "ShelfWidth", 10, 800, 5, "m");
        Slider("Sea floor", "SeaFloorHeight", -55, 0, 1, "m");
        Body.append(Construct("div", { Class: "SectionTitle" }, [Construct("span", { Text: "Relief" }), Construct("small", { Text: "world-space noise — seamless across regions" })]));
        Slider("Plateau height", "PlateauHeight", 0, 200, 1, "m");
        Slider("Relief amplitude", "ReliefAmplitude", 0, 400, 1, "m");
        Slider("Relief scale", "ReliefScale", 50, 3000, 10, "m");
        Slider("Ridge blend", "RidgeBlend", 0, 1, 0.01, "");
        Slider("Seed", "Seed", 0, 100, 1, "");
    }

    InspectRegion(Body, Region)
    {
        if (!Region) return;
        const Lattice = World.EvaluateRegionLattice(Region);
        const Active = Region.Token === this.Document.ActiveRegionToken;
        Body.append(...this.ConstructHeader("Region", Region.Name, Active ? "Active region · evaluated on the GPU" : "Inactive · not simulated", (Name) => this.MutateDocument("Regions", () => { Region.Name = Name; })));
        const HeightBytes = Lattice.HeightWidth * Lattice.HeightDepth * 4;
        const VolumeBytes = Lattice.VolumeWidth * Lattice.VolumeDepth * Lattice.VolumeHeight * 4;
        Body.append(this.ConstructMetrics([
            [(Region.SizeX / 1000).toFixed(2), "km", "Width X"], [(Region.SizeZ / 1000).toFixed(2), "km", "Depth Z"],
            [Lattice.HeightTexel.toFixed(2), "m", "Height texel"], [Lattice.VolumeVoxel.toFixed(1), "m", "Volume voxel"],
            [(HeightBytes / 1048576).toFixed(1), "MB", "Per height layer"], [(VolumeBytes / 1048576).toFixed(1), "MB", "Per volume layer"],
        ]));
        Body.append(Construct("div", { Class: "ButtonRow" }, [
            Active ? Construct("button", { Class: "Primary", disabled: "" }, [GlyphSpan(Glyph.Check), "Active"]) : Construct("button", { Class: "Primary", OnClick: () => this.ActivateRegion(Region.Token) }, [GlyphSpan(Glyph.Bullseye), "Activate (simulate)"]),
            Construct("button", { OnClick: () => { this.Planar.FocusRect(Region.MinimumX, Region.MinimumZ, Region.SizeX, Region.SizeZ); if (Active) this.Terrain?.FocusRegion(Region); } }, [GlyphSpan(Glyph.Expand), "Focus"]),
            Construct("button", { Class: "Danger", OnClick: () => this.DeleteSelection() }, [GlyphSpan(Glyph.Trash), "Delete"]),
        ]));
        const Slider = (Label, Field, Minimum, Maximum, Step, Unit) => Body.append(this.ConstructSlider({ Label, Unit, Minimum, Maximum, Step, Read: () => Region[Field], Write: (Number) => { Region[Field] = Number; }, DocumentCategory: "Regions" }));
        Body.append(Construct("div", { Class: "SectionTitle" }, [Construct("span", { Text: "Bounds" }), Construct("small", { Text: "sculpt layers stay world-anchored" })]));
        Slider("Minimum X", "MinimumX", -20000, 20000, 16, "m");
        Slider("Minimum Z", "MinimumZ", -20000, 20000, 16, "m");
        Slider("Size X", "SizeX", 64, 8192, 16, "m");
        Slider("Size Z", "SizeZ", 64, 8192, 16, "m");
        Slider("Bottom", "MinimumHeight", -500, 0, 5, "m");
        Slider("Top", "MaximumHeight", 50, 2000, 5, "m");
        Body.append(Construct("div", { Class: "SectionTitle" }, [Construct("span", { Text: "Resolution" }), Construct("small", { Text: "longer side" })]));
        Body.append(this.ConstructPills("Height lattice", World.HeightResolutionOptions.map((Option) => ({ Key: Option, Label: `${Option} px` })), () => Region.HeightResolution, (Key) => this.MutateDocument("Regions", () => { Region.HeightResolution = Key; })));
        Body.append(this.ConstructPills("Volume lattice", World.VolumeResolutionOptions.map((Option) => ({ Key: Option, Label: `${Option} vox` })), () => Region.VolumeResolution, (Key) => this.MutateDocument("Regions", () => { Region.VolumeResolution = Key; })));
    }

    InspectShape(Body, Shape)
    {
        if (!Shape) return;
        Body.append(...this.ConstructHeader("World shape", Shape.Name, `${Shape.Category} · ${Shape.Points.length} points`, (Name) => this.MutateDocument("Shapes", () => { Shape.Name = Name; })));
        Body.append(this.ConstructTiles([{ Key: "Union", Label: "Union (land)", Glyph: Glyph.CirclePlus, Colour: "#8fcf72" }, { Key: "Subtract", Label: "Subtract (water)", Glyph: Glyph.CircleMinus, Colour: "#e0806c" }],
            () => Shape.Operation, (Key) => this.MutateDocument("Shapes", () => { Shape.Operation = Key; }, false), 2));
        if (Shape.Category === "Stroke") Body.append(this.ConstructSlider({ Label: "Stroke width", Unit: "m", Minimum: 5, Maximum: 1000, Step: 1, Read: () => Shape.Width, Write: (Number) => { Shape.Width = Number; }, DocumentCategory: "Shapes" }));
        Body.append(Construct("div", { Class: "ButtonRow" }, [
            Construct("button", { OnClick: () => { const Index = this.Document.Shapes.indexOf(Shape); if (Index < this.Document.Shapes.length - 1) this.MutateDocument("Shapes", () => { this.Document.Shapes.splice(Index, 1); this.Document.Shapes.splice(Index + 1, 0, Shape); }); } }, [GlyphSpan(Glyph.Up), "Later"]),
            Construct("button", { OnClick: () => { const Index = this.Document.Shapes.indexOf(Shape); if (Index > 0) this.MutateDocument("Shapes", () => { this.Document.Shapes.splice(Index, 1); this.Document.Shapes.splice(Index - 1, 0, Shape); }); } }, [GlyphSpan(Glyph.Down), "Earlier"]),
            Construct("button", { Class: "Danger", OnClick: () => this.DeleteSelection() }, [GlyphSpan(Glyph.Trash), "Delete"]),
        ]));
        Body.append(Construct("div", { Class: "Note", Text: "Shapes apply in document order: later subtract shapes cut earlier land, later union shapes refill it." }));
    }

    InspectLayer(Body, Layer)
    {
        if (!Layer) return;
        const Category = Layer.Category === "VolumeSculpt" ? "VolumeLayers" : "Layers";
        Body.append(...this.ConstructHeader("Layer", Layer.Name, LayerLabel[Layer.Category], (Name) => this.MutateDocument(Category, () => { Layer.Name = Name; })));
        Body.append(this.ConstructToggle("Visible (evaluated)", () => Layer.VisibilityEnabled, (Enabled) => this.MutateDocument(Category, () => { Layer.VisibilityEnabled = Enabled; }, false)));
        if (Layer.Category !== "VolumeSculpt") Body.append(this.ConstructSlider({ Label: "Opacity", Unit: "", Minimum: 0, Maximum: 1, Step: 0.01, Read: () => Layer.Opacity, Write: (Number) => { Layer.Opacity = Number; }, DocumentCategory: "Layers" }));
        if (Layer.Category === "HeightSculpt" || Layer.Category === "VolumeSculpt")
        {
            const Volume = Layer.Category === "VolumeSculpt";
            const Brush = Volume ? this.VolumeBrush : this.HeightBrush;
            Body.append(Construct("div", { Class: "SectionTitle" }, [Construct("span", { Text: "Brush" }), Construct("small", { Text: Volume ? "SDF volume · overhangs & caves" : "displacement · GPU texture" })]));
            Body.append(Construct("div", { Class: "ButtonRow" }, [Construct("button", { Class: this.TerrainTool === "Sculpt" ? "Primary" : "", OnClick: () => { this.ActiveLayerToken = Layer.Token; if (this.Workspace === "Planar") this.ConfigureWorkspace("Split"); this.ConfigureTerrainTool("Sculpt"); this.RefreshInspector(); this.RefreshOutliner(); } }, [GlyphSpan(Glyph.Brush), "Sculpt this layer (D)"])]));
            Body.append(this.ConstructTiles((Volume ? VolumeBrushModes : HeightBrushModes).map((Mode) => ({ Key: Mode.Mode, Label: Mode.Name, Glyph: Mode.Glyph })), () => Brush.Mode, (Key) => { Brush.Mode = Key; this.RefreshToolRow(); }, Volume ? 3 : 4));
            Body.append(this.ConstructSlider({ Label: "Radius", Unit: "m", Minimum: 2, Maximum: 400, Step: 1, Read: () => Brush.Radius, Write: (Number) => { Brush.Radius = Number; this.RefreshToolRow(); } }));
            if (!Volume)
            {
                Body.append(this.ConstructSlider({ Label: "Strength", Minimum: 0.02, Maximum: 1, Step: 0.01, Read: () => Brush.Strength, Write: (Number) => { Brush.Strength = Number; this.RefreshToolRow(); } }));
                Body.append(this.ConstructSlider({ Label: "Hardness", Minimum: 0, Maximum: 0.95, Step: 0.01, Read: () => Brush.Hardness, Write: (Number) => { Brush.Hardness = Number; } }));
                Body.append(this.ConstructSlider({ Label: "Terrace interval", Unit: "m", Minimum: 1, Maximum: 60, Step: 0.5, Read: () => Brush.TerraceInterval, Write: (Number) => { Brush.TerraceInterval = Number; } }));
            }
            else
            {
                Body.append(this.ConstructSlider({ Label: "Blend", Minimum: 0, Maximum: 1, Step: 0.01, Read: () => Brush.Blend, Write: (Number) => { Brush.Blend = Number; } }));
                Body.append(this.ConstructSlider({ Label: "Roughness", Minimum: 0, Maximum: 1, Step: 0.01, Read: () => Brush.Roughness, Write: (Number) => { Brush.Roughness = Number; } }));
            }
            Body.append(Construct("div", { Class: "ButtonRow" }, [Construct("button", { Class: "Danger", OnClick: () =>
            {
                if (!this.Gpu || !World.ResolveActiveRegion(this.Document)) return;
                this.PushUndo({ Category: "Layer", Snapshot: this.Evaluation.CaptureLayerSnapshot(Layer.Category, Layer.Token) });
                this.Evaluation.ClearLayer(Layer.Category, Layer.Token);
                this.NotifyDocumentEdit(null);
            } }, [GlyphSpan(Glyph.Eraser), "Clear in active region"])]));
            Body.append(Construct("div", { Class: "Note", Text: Volume
                ? "Volume layers store a signed distance per voxel (carve + add channels). They subtract/union with the height stack, so caves and overhangs survive the bake."
                : "Height sculpt stores a per-texel displacement. Fixed-size texture: unlimited strokes, undo per stroke, no mesh rebuild." }));
        }
        if (Layer.Category === "Spline")
        {
            Body.append(Construct("div", { Class: "SectionTitle" }, [Construct("span", { Text: "Draw into this layer" })]));
            Body.append(this.ConstructTiles(World.SplineCategories.map((Category) => ({ Key: Category, Label: Category, Glyph: SplineGlyph[Category], Colour: World.SplineCategoryProfiles[Category].Colour, Title: World.SplineCategoryProfiles[Category].Description })),
                () => null, (Key) => { this.ActiveSplineLayerToken = Layer.Token; this.ToolOptions.SplineCategory = Key; if (this.Workspace === "Terrain") this.ConfigureWorkspace("Split"); this.ConfigurePlanarTool("Spline"); }, 5));
            Body.append(Construct("div", { Class: "SectionTitle" }, [Construct("span", { Text: "Splines" }), Construct("small", { Text: `${Layer.Splines.length}` })]));
            for (const Spline of Layer.Splines)
            {
                Body.append(Construct("button", { Style: "width:100%;justify-content:flex-start;margin-bottom:4px", OnClick: () => this.Select({ Category: "Spline", Token: Spline.Token }) },
                    [GlyphSpan(SplineGlyph[Spline.Category], `color:${World.SplineCategoryProfiles[Spline.Category].Colour}`), Construct("span", { Text: `${Spline.Name} · ${Spline.Category}` })]));
            }
        }
        Body.append(Construct("div", { Class: "ButtonRow" }, [Construct("button", { Class: "Danger", OnClick: () => this.DeleteSelection() }, [GlyphSpan(Glyph.Trash), "Delete layer"])]));
    }

    InspectSpline(Body, Located)
    {
        if (!Located) return;
        const { Spline, Layer } = Located;
        const Profile = World.SplineCategoryProfiles[Spline.Category];
        Body.append(...this.ConstructHeader(`Spline / ${Layer.Name}`, Spline.Name, Profile.Description, (Name) => this.MutateDocument("Splines", () => { Spline.Name = Name; })));
        Body.append(this.ConstructTiles(World.SplineCategories.map((Category) => ({ Key: Category, Label: Category, Glyph: SplineGlyph[Category], Colour: World.SplineCategoryProfiles[Category].Colour })),
            () => Spline.Category, (Key) => this.MutateDocument("Splines", () =>
            {
                const Defaults = World.SplineCategoryProfiles[Key];
                Object.assign(Spline, { Category: Key, Width: Defaults.Width, Falloff: Defaults.Falloff, Depth: Defaults.Depth, Roughness: Defaults.Roughness, Smoothing: Defaults.Smoothing, Offset: Defaults.Offset, ProfileMode: Defaults.ProfileMode, DescentEnabled: Defaults.DescentEnabled, StrataInterval: Defaults.StrataInterval });
            }), 5));
        const Slider = (Label, Field, Minimum, Maximum, Step, Unit, Note = "") => Body.append(this.ConstructSlider({ Label, Unit, Minimum, Maximum, Step, Note, Read: () => Spline[Field], Write: (Number) => { Spline[Field] = Number; }, DocumentCategory: "Splines" }));
        const Tunnel = Spline.Category === "Tunnel";
        Body.append(Construct("div", { Class: "SectionTitle" }, [Construct("span", { Text: "Cross-section" }), Construct("small", { Text: "live — drag and watch the terrain" })]));
        Slider(Tunnel ? "Bore width" : "Width", "Width", 2, 400, 0.5, "m");
        if (!Tunnel) Slider(Spline.Category === "Road" ? "Embankment" : Spline.Category === "Ridge" ? "Flank" : "Bank / wall", "Falloff", 0, 600, 1, "m");
        if (Spline.Category !== "Road") Slider({ River: "Channel depth", Canyon: "Canyon depth", Ridge: "Crest height", Tunnel: "Bore height" }[Spline.Category], "Depth", Tunnel ? 3 : 0, Spline.Category === "Ridge" ? 500 : 300, 0.5, "m");
        if (!Tunnel) Slider("Roughness", "Roughness", 0, 60, 0.5, "m", "organic edge perturbation");
        if (Spline.Category === "Canyon") Slider("Strata interval", "StrataInterval", 0, 60, 0.5, "m", "0 = smooth walls");
        Body.append(Construct("div", { Class: "SectionTitle" }, [Construct("span", { Text: "Profile" }), Construct("small", { Text: "centerline elevation" })]));
        Body.append(this.ConstructPills("Profile mode", [{ Key: "Follow", Label: "Follow terrain" }, { Key: "Grade", Label: "Grade (end to end)" }, { Key: "Manual", Label: "Manual heights" }],
            () => Spline.ProfileMode, (Key) => this.MutateDocument("Splines", () => { Spline.ProfileMode = Key; })));
        if (Spline.ProfileMode === "Follow")
        {
            Slider("Smoothing", "Smoothing", 0, 1500, 5, "m", "gaussian window along the curve");
            Body.append(this.ConstructToggle("Monotonic descent (downstream)", () => Spline.DescentEnabled, (Enabled) => this.MutateDocument("Splines", () => { Spline.DescentEnabled = Enabled; }, false)));
        }
        Slider("Vertical offset", "Offset", -100, 100, 0.1, "m");
        Body.append(Construct("div", { Class: "SectionTitle" }, [Construct("span", { Text: "Control points" }), Construct("small", { Text: `${Spline.Points.length}` })]));
        Body.append(Construct("div", { Class: "PointList" }, Spline.Points.map((Point, Index) =>
            Construct("button", { Class: this.Selection.PointIndex === Index ? "Active" : "", OnClick: () => this.Select({ Category: "Spline", Token: Spline.Token, PointIndex: Index }) }, `P${Index}`))));
        const PointIndex = this.Selection.PointIndex;
        if (PointIndex >= 0 && PointIndex < Spline.Points.length)
        {
            const Point = Spline.Points[PointIndex];
            const PointSlider = (Label, Field, Minimum, Maximum, Step) => Body.append(this.ConstructSlider({ Label: `P${PointIndex} ${Label}`, Unit: "m", Minimum, Maximum, Step, Read: () => Point[Field], Write: (Number) => { Point[Field] = Number; }, DocumentCategory: "Splines" }));
            PointSlider("X", "X", Point.X - 500, Point.X + 500, 0.5);
            PointSlider("Z", "Z", Point.Z - 500, Point.Z + 500, 0.5);
            if (Spline.ProfileMode === "Manual") PointSlider("height", "Height", -100, 800, 0.5);
            Body.append(Construct("div", { Class: "ButtonRow" }, [Construct("button", { Class: "Danger", OnClick: () => this.DeleteSelection() }, [GlyphSpan(Glyph.Trash), "Delete point"])]));
        }
        const SplineLayers = this.Document.Layers.filter((Candidate) => Candidate.Category === "Spline");
        const LayerPicker = Construct("select", { "aria-label": "Layer" }, SplineLayers.map((Candidate) => Construct("option", { value: Candidate.Token, Text: Candidate.Name })));
        LayerPicker.value = Layer.Token;
        LayerPicker.addEventListener("change", () => this.MutateDocument("Splines", () =>
        {
            Layer.Splines.splice(Layer.Splines.indexOf(Spline), 1);
            World.ResolveLayer(this.Document, LayerPicker.value).Splines.push(Spline);
        }));
        Body.append(Construct("div", { Class: "SectionTitle" }, [Construct("span", { Text: "Layer" }), Construct("small", { Text: "stack position decides what it cuts" })]), LayerPicker);
        Body.append(Construct("div", { Class: "ButtonRow" }, [
            Construct("button", { OnClick: () => this.MutateDocument("Splines", () => Spline.Points.reverse()) }, [GlyphSpan(Glyph.Swap), "Reverse"]),
            Construct("button", { OnClick: () => { this.ConfigureTerrainTool("Points"); if (this.Workspace === "Planar") this.ConfigureWorkspace("Split"); } }, [GlyphSpan(Glyph.Location), "Edit in 3D"]),
            Construct("button", { Class: "Danger", OnClick: () => { this.Selection.PointIndex = -1; this.DeleteSelection(); } }, [GlyphSpan(Glyph.Trash), "Delete"]),
        ]));
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                 3D INPUT
    //--------------------------------------------------------------------------------------------------------------------

    AttachTerrainInput()
    {
        const Canvas = this.Docks.TerrainCanvas;
        if (!this.Terrain) return;
        Canvas.addEventListener("contextmenu", (Event) => Event.preventDefault());
        Canvas.addEventListener("pointerdown", (Event) => this.TerrainPointerDown(Event));
        Canvas.addEventListener("pointermove", (Event) => this.TerrainPointerMove(Event));
        Canvas.addEventListener("pointerup", (Event) => this.TerrainPointerUp(Event));
        Canvas.addEventListener("pointercancel", (Event) => this.TerrainPointerUp(Event));
        Canvas.addEventListener("pointerleave", () => { this.Pointer.Inside = false; this.Terrain.Brush.Visible = false; this.Terrain.Invalidate(); });
        Canvas.addEventListener("wheel", (Event) =>
        {
            Event.preventDefault();
            const Hit = this.Terrain.Pick(Event.clientX, Event.clientY);
            this.Terrain.Dolly(Math.exp(Event.deltaY * 0.0012), Hit ? [Hit.X, Hit.Y, Hit.Z] : null);
        }, { passive: false });
    }

    TerrainPointerDown(Event)
    {
        const Canvas = this.Docks.TerrainCanvas;
        Canvas.setPointerCapture(Event.pointerId);
        Canvas.focus();
        this.Pointer = { X: Event.clientX, Y: Event.clientY, Inside: true, Moved: true };
        const Orbit = Event.button === 2 && !Event.shiftKey || (Event.button === 0 && (Event.altKey || this.TerrainTool === "Navigate"));
        const Pan = Event.button === 1 || (Event.button === 2 && Event.shiftKey);
        if (Orbit || Pan)
        {
            this.TerrainDrag = { Category: Pan ? "Pan" : "Orbit", LastX: Event.clientX, LastY: Event.clientY };
            this.Terrain.Interacting = true;
            return;
        }
        if (Event.button !== 0) return;
        if (this.TerrainTool === "Sculpt") this.BeginStroke(Event);
        else if (this.TerrainTool === "Points") this.BeginPointDrag(Event);
    }

    TerrainPointerMove(Event)
    {
        this.Pointer = { X: Event.clientX, Y: Event.clientY, Inside: true, Moved: true, Shift: Event.shiftKey };
        const Drag = this.TerrainDrag;
        if (Drag && (Drag.Category === "Orbit" || Drag.Category === "Pan"))
        {
            if (Drag.Category === "Orbit") this.Terrain.Orbit(Event.clientX - Drag.LastX, Event.clientY - Drag.LastY);
            else this.Terrain.Pan(Event.clientX - Drag.LastX, Event.clientY - Drag.LastY);
            Drag.LastX = Event.clientX;
            Drag.LastY = Event.clientY;
        }
        if (Drag && Drag.Category === "Point") Drag.Pending = true;
        if (this.Stroke) this.Stroke.Pending = true;
    }

    TerrainPointerUp(Event)
    {
        const Canvas = this.Docks.TerrainCanvas;
        if (Canvas.hasPointerCapture(Event.pointerId)) Canvas.releasePointerCapture(Event.pointerId);
        if (this.TerrainDrag?.Category === "Point")
        {
            this.SweepPointDrag();
            this.FinalizeDocumentEdit();
            this.RefreshInspector();
        }
        if (this.Stroke)
        {
            this.SweepStroke();
            this.Stroke = null;
            this.HillshadePending = true;
            this.ScheduleAutosave();
        }
        this.TerrainDrag = null;
        this.Terrain.Interacting = false;
        this.Terrain.Invalidate();
    }

    BeginStroke(Event)
    {
        const Layer = this.ResolveSculptLayer();
        if (!Layer) { this.ReportStatus("No sculpt layer — add a Height or Volume sculpt layer (+)"); return; }
        if (!Layer.VisibilityEnabled) { this.ReportStatus(`${Layer.Name} is hidden — show it to sculpt`); return; }
        if (!World.ResolveActiveRegion(this.Document)) return;
        const Hit = this.Terrain.Pick(Event.clientX, Event.clientY);
        if (!Hit) return;
        this.PushUndo({ Category: "Layer", Snapshot: this.Evaluation.CaptureLayerSnapshot(Layer.Category, Layer.Token) });
        this.Stroke = { Layer, Last: null, Invert: Event.shiftKey, FlattenHeight: Hit.Y, Pending: true, Dabs: 0 };
        this.Terrain.Interacting = true;
        this.SweepStroke();
    }

    // 📝 Called once per animation frame while stroking: one pick, dabs spaced at ¼ radius along the motion,
    //    all applied in one GPU batch followed by a single partial stack evaluation.
    SweepStroke()
    {
        const Stroke = this.Stroke;
        if (!Stroke || !Stroke.Pending) return;
        Stroke.Pending = false;
        const Hit = this.Terrain.Pick(this.Pointer.X, this.Pointer.Y);
        if (!Hit) return;
        const Volume = Stroke.Layer.Category === "VolumeSculpt";
        const Settings = Volume ? this.VolumeBrush : this.HeightBrush;
        const Spacing = Math.max(Settings.Radius * 0.25, 0.5);
        const Centres = [];
        if (!Stroke.Last) Centres.push(Hit);
        else
        {
            const Distance = Math.hypot(Hit.X - Stroke.Last.X, Hit.Y - Stroke.Last.Y, Hit.Z - Stroke.Last.Z);
            const Count = Math.min(12, Math.floor(Distance / Spacing));
            for (let Index = 1; Index <= Count; Index++)
            {
                const Blend = Index / Count;
                Centres.push({ X: Stroke.Last.X + (Hit.X - Stroke.Last.X) * Blend, Y: Stroke.Last.Y + (Hit.Y - Stroke.Last.Y) * Blend, Z: Stroke.Last.Z + (Hit.Z - Stroke.Last.Z) * Blend });
            }
            if (Count === 0) return;
        }
        Stroke.Last = Centres[Centres.length - 1];
        const Invert = this.Pointer.Shift ?? Stroke.Invert;
        if (Volume)
        {
            let Mode = Settings.Mode;
            if (Invert && Mode < 2) Mode = 1 - Mode;
            this.Evaluation.ApplyVolumeBrush(this.Document, Stroke.Layer.Token, { Mode, Radius: Settings.Radius, Blend: Settings.Blend, Roughness: Settings.Roughness }, Centres);
        }
        else
        {
            let Mode = Settings.Mode;
            if (Invert && Mode <= 1) Mode = 1 - Mode;
            this.Evaluation.ApplyHeightBrush(this.Document, Stroke.Layer.Token, {
                Mode, Radius: Settings.Radius, Hardness: Settings.Hardness, Amount: Settings.Strength * Settings.Radius * 0.05,
                Blend: Math.min(1, Settings.Strength * 0.6), FlattenHeight: Stroke.FlattenHeight, TerraceInterval: Settings.TerraceInterval,
            }, Centres);
        }
        Stroke.Dabs += Centres.length;
        this.Terrain.Brush = { ...this.Terrain.Brush, X: Hit.X, Y: Hit.Y, Z: Hit.Z, Radius: Settings.Radius, Volumetric: Volume, Visible: true };
        this.Terrain.Invalidate();
        this.HillshadePending = true;
    }

    BeginPointDrag(Event)
    {
        const Hit = this.Terrain.Pick(Event.clientX, Event.clientY);
        if (!Hit) { this.TerrainDrag = { Category: "Orbit", LastX: Event.clientX, LastY: Event.clientY }; return; }
        const Rect = this.Docks.TerrainCanvas.getBoundingClientRect();
        const Tolerance = 16 * Hit.Travel * 2 * Math.tan(this.Terrain.Camera.FieldOfView / 2) / Rect.height;
        let Nearest = null;
        for (const Layer of this.Document.Layers)
        {
            if (!Layer.VisibilityEnabled || Layer.Category !== "Spline") continue;
            for (const Spline of Layer.Splines)
            {
                if (!Spline.VisibilityEnabled) continue;
                const Preference = this.Selection.Token === Spline.Token ? 0.6 : 1;
                Spline.Points.forEach((Point, PointIndex) =>
                {
                    const Distance = Math.hypot(Point.X - Hit.X, Point.Z - Hit.Z) * Preference;
                    if (Distance < Tolerance && (!Nearest || Distance < Nearest.Distance)) Nearest = { Distance, Spline, PointIndex };
                });
            }
        }
        if (Nearest)
        {
            this.Select({ Category: "Spline", Token: Nearest.Spline.Token, PointIndex: Nearest.PointIndex });
            this.BeginDocumentEdit();
            const Point = Nearest.Spline.Points[Nearest.PointIndex];
            const Plane = this.Terrain.ProjectRayToPlane(Event.clientX, Event.clientY, Hit.Y);
            this.TerrainDrag = { Category: "Point", Spline: Nearest.Spline, PointIndex: Nearest.PointIndex, PlaneHeight: Hit.Y, OffsetX: Point.X - (Plane?.X ?? Hit.X), OffsetZ: Point.Z - (Plane?.Z ?? Hit.Z), StartY: Event.clientY, StartHeight: Point.Height, Vertical: Event.shiftKey, Pending: false };
            this.Terrain.Interacting = true;
            if (Event.shiftKey && Nearest.Spline.ProfileMode !== "Manual")
            {
                Nearest.Spline.ProfileMode = "Manual";
                this.NotifyDocumentEdit("Splines");
                this.ReportStatus(`${Nearest.Spline.Name}: profile switched to Manual for vertical editing`);
            }
            return;
        }
        if (this.Selection.Category === "Spline" && (Event.ctrlKey || Event.metaKey))
        {
            const Located = World.ResolveSpline(this.Document, this.Selection.Token);
            if (Located)
            {
                this.MutateDocument("Splines", () => Located.Spline.Points.push({ X: Hit.X, Z: Hit.Z, Height: Hit.Y }), false);
                this.Select({ Category: "Spline", Token: Located.Spline.Token, PointIndex: Located.Spline.Points.length - 1 });
                return;
            }
        }
        this.TerrainDrag = { Category: "Orbit", LastX: Event.clientX, LastY: Event.clientY };
        this.Terrain.Interacting = true;
    }

    SweepPointDrag()
    {
        const Drag = this.TerrainDrag;
        if (!Drag || Drag.Category !== "Point" || !Drag.Pending) return;
        Drag.Pending = false;
        const Point = Drag.Spline.Points[Drag.PointIndex];
        if (!Point) return;
        if (Drag.Vertical)
        {
            Point.Height = Math.round((Drag.StartHeight - (this.Pointer.Y - Drag.StartY) * this.Terrain.Camera.Distance * 0.0012) * 10) / 10;
        }
        else
        {
            const Plane = this.Terrain.ProjectRayToPlane(this.Pointer.X, this.Pointer.Y, Drag.PlaneHeight);
            if (!Plane) return;
            Point.X = Plane.X + Drag.OffsetX;
            Point.Z = Plane.Z + Drag.OffsetZ;
        }
        this.NotifyDocumentEdit("Splines");
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                 KEYBOARD
    //--------------------------------------------------------------------------------------------------------------------

    AttachKeyboard()
    {
        window.addEventListener("keydown", (Event) =>
        {
            const Typing = ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName) && document.activeElement.type !== "range";
            if (Typing) return;
            const Control = Event.ctrlKey || Event.metaKey;
            if (Event.key === " ") { this.Planar.SpacePressed = true; }
            if (Control && Event.key.toLowerCase() === "z") { Event.preventDefault(); if (Event.shiftKey) this.Redo(); else this.Undo(); return; }
            if (Control && Event.key.toLowerCase() === "y") { Event.preventDefault(); this.Redo(); return; }
            if (Control && Event.key.toLowerCase() === "s") { Event.preventDefault(); this.SaveProject(false); return; }
            if (Control && Event.key.toLowerCase() === "f") { Event.preventDefault(); this.Docks.OutlinerSearch.focus(); return; }
            if (Control) return;
            if (this.FocusedPane === "Planar" && this.Planar.InterpretKey(Event)) { Event.preventDefault(); return; }
            if (Event.key === "Escape") { this.Select({ Category: null }); return; }
            if (Event.key === "Delete" || Event.key === "Backspace") { Event.preventDefault(); this.DeleteSelection(); return; }
            if (Event.key === "1") return this.ConfigureWorkspace("Planar");
            if (Event.key === "2") return this.ConfigureWorkspace("Terrain");
            if (Event.key === "3") return this.ConfigureWorkspace("Split");
            if (Event.key.toLowerCase() === "f") return this.FocusActiveRegion();
            if (Event.key === "[" || Event.key === "]")
            {
                const Brush = this.ResolveSculptLayer()?.Category === "VolumeSculpt" ? this.VolumeBrush : this.HeightBrush;
                Brush.Radius = Math.min(400, Math.max(2, Math.round(Brush.Radius * (Event.key === "]" ? 1.15 : 1 / 1.15))));
                if (this.Terrain) { this.Terrain.Brush.Radius = Brush.Radius; this.Terrain.Invalidate(); }
                this.RefreshToolRow();
                return;
            }
            const Key = Event.key.toUpperCase();
            const PlanarTool = PlanarTools.find((Tool) => Tool.Key === Key);
            const TerrainTool = TerrainTools.find((Tool) => Tool.Key === Key);
            const PlanarFocus = this.Workspace === "Planar" || (this.Workspace === "Split" && this.FocusedPane === "Planar");
            if (PlanarTool && PlanarFocus) this.ConfigurePlanarTool(PlanarTool.Name);
            else if (TerrainTool && !PlanarFocus) this.ConfigureTerrainTool(TerrainTool.Name);
            else if (PlanarTool && this.Workspace !== "Terrain") this.ConfigurePlanarTool(PlanarTool.Name);
        });
        window.addEventListener("keyup", (Event) => { if (Event.key === " ") this.Planar.SpacePressed = false; });
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                               REALTIME FRAME LOOP
    //--------------------------------------------------------------------------------------------------------------------

    Loop(Time)
    {
        const FrameStart = performance.now();
        if (this.Gpu)
        {
            this.SweepStroke();
            this.SweepPointDrag();
            if (this.TerrainTool === "Sculpt" && this.Pointer.Inside && this.Pointer.Moved && !this.Stroke && !this.TerrainDrag && this.Workspace !== "Planar")
            {
                this.Pointer.Moved = false;
                const Hit = this.Terrain.Pick(this.Pointer.X, this.Pointer.Y);
                const Volume = this.ResolveSculptLayer()?.Category === "VolumeSculpt";
                this.Terrain.Brush = Hit ? { X: Hit.X, Y: Hit.Y, Z: Hit.Z, Radius: Volume ? this.VolumeBrush.Radius : this.HeightBrush.Radius, Volumetric: Volume, Visible: true } : { ...this.Terrain.Brush, Visible: false };
                this.Terrain.Invalidate();
            }
            if (this.Evaluation.Evaluate(this.Document))
            {
                this.Terrain.Invalidate();
                this.HillshadePending = true;
                this.RefreshHeader();
            }
            this.Evaluation.CollectTimers();
            if (this.Workspace !== "Planar") this.Terrain.Render();
            const Interval = this.Stroke || this.TerrainDrag ? 200 : 60;
            if (this.Workspace !== "Terrain" && this.HillshadePending && this.PlanarHillshadeEnabled && Time - this.HillshadeTime > Interval && this.Evaluation.Region)
            {
                this.Planar.InstallHillshade(this.Evaluation.ExtractHillshade(this.Terrain.Settings.WaterLevel));
                this.HillshadePending = false;
                this.HillshadeTime = Time;
            }
        }
        if (this.Workspace !== "Terrain") this.Planar.Render();
        this.LoopMilliseconds.push(Time);
        while (this.LoopMilliseconds.length && Time - this.LoopMilliseconds[0] > 1000) this.LoopMilliseconds.shift();
        if (!this.StatusTime || Time - this.StatusTime > 250) { this.RefreshStatus(performance.now() - FrameStart); this.StatusTime = Time; }
        requestAnimationFrame((Next) => this.Loop(Next));
    }

    RefreshStatus(RenderMilliseconds)
    {
        const Status = this.Docks.StatusBar;
        if (!this.Gpu) { Status.textContent = "GPU unavailable"; return; }
        const Timings = this.Evaluation.Timings;
        const Gpu = Timings.GpuMilliseconds;
        const Parts = [
            ["FPS", String(this.LoopMilliseconds.length)],
            [Gpu ? `GPU ${Gpu.Label.toLowerCase()}` : "Stack submit", `${(Gpu ? Gpu.Milliseconds : Timings.Stack).toFixed(2)} ms`],
            ["Brush batch", `${Timings.Brush.toFixed(2)} ms${Timings.BrushDabs ? ` / ${Timings.BrushDabs} dabs` : ""}`],
            ["Foundation", `${Timings.Foundation.toFixed(2)} ms`],
            ["View", `${this.Terrain.RenderMilliseconds.toFixed(2)} ms`],
        ];
        const Lattice = this.Evaluation.Lattice;
        Status.replaceChildren(...Parts.map(([Label, Value]) => Construct("span", {}, [`${Label} `, Construct("b", { Text: Value })])),
            Construct("span", {}, [Lattice ? `${Lattice.HeightWidth}² · vol ${Lattice.VolumeWidth}×${Lattice.VolumeHeight}×${Lattice.VolumeDepth}` : "no region"]),
            ...(this.StatusMessage && performance.now() - this.StatusMessageTime < 6000 ? [Construct("span", { Class: "Good", Text: this.StatusMessage })] : []));
        const Undo = this.UndoStack.length, Redo = this.RedoStack.length;
        this.Docks.OutlinerFooter.textContent = `Undo ${Undo} · Redo ${Redo} · ${this.Evaluation.Work ? (this.Evaluation.Work.ByteFootprint / 1048576).toFixed(0) : 0} MB work set`;
        if (this.WorldMetrics?.["GPU work set"] && this.Evaluation.Work)
            this.WorldMetrics["GPU work set"].firstChild.nodeValue = (this.Evaluation.Work.ByteFootprint / 1048576).toFixed(0);
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                       MAIN
//------------------------------------------------------------------------------------------------------------------------

new TerrainStudio();
