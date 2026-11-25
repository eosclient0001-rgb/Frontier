/*====================================================================================================================================
                                                        INTERFACEPANELS.JS
====================================================================================================================================*/
// 🧩 Project-Zero style dock panels: outliner (regions, each with its own layer stack), inspector property cards, viewport
//    head, tool row, footers

import { SplineVariants, ShapeOperations, SculptModes } from "./WorldDocument.js";

//------------------------------------------------------------------------------------------------------------------------
//                                                    ICONS
//------------------------------------------------------------------------------------------------------------------------

const IconPaths = {
    World:   "M8 1.5a6.5 6.5 0 1 0 0 13a6.5 6.5 0 0 0 0-13M1.5 8h13M8 1.5c2 2 2 11 0 13M8 1.5c-2 2-2 11 0 13",
    Terrain: "M2 2.5h12v11H2zM2 2.5l2 2M14 2.5l-2 2M2 13.5l2-2M14 13.5l-2-2",
    Shape:   "M3 11c-1-3 1-7 4-8s7 0 7 4-2 6-5 6-5 0-6-2z",
    Spline:  "M2 13c3 0 3-10 6-10s3 10 6 10",
    Sculpt:  "M3 13l4-4M7 9l5-6 1 1-5 6zM2.5 13.5l1.5-.5-1-1z",
    Eye:     "M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8zM8 6a2 2 0 1 0 0 4a2 2 0 0 0 0-4",
    Check:   "M4 8.5l2.5 2.5L12 5.5",
    Up:      "M8 12V4M4.5 7.5L8 4l3.5 3.5",
    Down:    "M8 4v8M4.5 8.5L8 12l3.5-3.5",
    Plus:    "M8 3v10M3 8h10",
    Undo:    "M5 4L2 7l3 3M2 7h7a4 4 0 0 1 0 8H7",
    Redo:    "M11 4l3 3-3 3M14 7H7a4 4 0 0 0 0 8h2",
    Frame:   "M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3",
    Menu:    "M3 4h10M3 8h10M3 12h10",
    Closed:  "M6 4l4 4-4 4",
    Opened:  "M4 6l4 4 4-4",
    Stack:   "M8 2l6 3-6 3-6-3zM2 8l6 3 6-3M2 11l6 3 6-3",
};

export function Icon(Name) { return `<svg class="icon" viewBox="0 0 16 16"><path d="${IconPaths[Name] || ""}"/></svg>`; }

const Escape = Text => String(Text).replace(/[&<>"]/g, Character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[Character]);

function LayerColour(Layer)
{
    if (Layer.Category === "Spline") return SplineVariants[Layer.Variant].Colour;
    if (Layer.Category === "Sculpt") return "#ffb454";
    return "#8fbf7a";
}

function LayerSubtitle(Layer)
{
    if (Layer.Category === "Shape") return `${Layer.Parameters.Operation} · ${Layer.Strokes.length} stroke${Layer.Strokes.length === 1 ? "" : "s"}`;
    if (Layer.Category === "Spline") return `${SplineVariants[Layer.Variant].Label} · ${Layer.Splines.length} spline${Layer.Splines.length === 1 ? "" : "s"}`;
    return "GPU raster · unlimited strokes";
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    OUTLINER
//------------------------------------------------------------------------------------------------------------------------

export function RenderOutliner(Session)
{
    const Doc = Session.Document;
    const S = Session.Selection;
    Session.CollapsedRegions = Session.CollapsedRegions || new Set();
    const AllLayers = Doc.Layers;
    document.getElementById("OutlinerSummary").textContent = `${Doc.Terrains.length} region${Doc.Terrains.length === 1 ? "" : "s"} · ${AllLayers.length} layers`;
    const VisibleLayers = AllLayers.filter(Layer => Layer.Visible).length;
    document.getElementById("OutlinerStats").innerHTML =
        `<div class="stat-card"><span class="status-disc">${Icon("Check")}</span><small>Visible</small><strong>${VisibleLayers}</strong></div>` +
        `<div class="stat-card"><span class="muted-disc">${Icon("Eye")}</span><small>Hidden</small><strong>${AllLayers.length - VisibleLayers}</strong></div>`;

    const Rows = [];
    const Row = ({ Key, Depth = 0, Lead = "", Glyph, Colour, Title, Subtitle, Selected, Hidden, Tail = "" }) =>
        `<div class="outliner-row${Selected ? " selected" : ""}${Hidden ? " hidden-row" : ""}" style="--depth:${Depth}" data-key="${Key}">` +
        `${Lead}<span class="row-glyph" style="background:${Colour}22;color:${Colour}">${Icon(Glyph)}</span>` +
        `<span class="row-text"><span>${Escape(Title)}</span><small>${Escape(Subtitle)}</small></span><span class="row-tail">${Tail}</span></div>`;
    const Caret = (Id, Open) => `<button class="row-caret" data-command="Collapse:${Id}" title="${Open ? "Collapse" : "Expand"} layer stack">${Icon(Open ? "Opened" : "Closed")}</button>`;
    const Hint = (Depth, Text) => `<div class="stack-hint" style="--depth:${Depth}">${Escape(Text)}</div>`;
    const PluralLayers = Count => `${Count} layer${Count === 1 ? "" : "s"}`;

    // 📝 A stack is listed top first (top applies last), matching the evaluation order read from the bottom up.
    const PushStack = (Stack, Depth) =>
    {
        for (const Layer of [...Stack].reverse())
        {
            const Selected = (S.Category === "Layer" || S.Category === "Spline") && S.LayerId === Layer.Id;
            Rows.push(Row({ Key: `Layer:${Layer.Id}`, Depth, Glyph: Layer.Category, Colour: LayerColour(Layer), Title: Layer.Name, Subtitle: LayerSubtitle(Layer), Selected, Hidden: !Layer.Visible,
                Tail: `<button class="row-action" data-command="Raise:${Layer.Id}" title="Move up">${Icon("Up")}</button>` +
                      `<button class="row-action" data-command="Lower:${Layer.Id}" title="Move down">${Icon("Down")}</button>` +
                      `<button class="row-status${Layer.Visible ? "" : " off"}" data-command="Visibility:${Layer.Id}" title="Toggle visibility">${Icon(Layer.Visible ? "Check" : "Eye")}</button>` }));
            if (Layer.Category === "Spline" && Selected)
            {
                Layer.Splines.forEach((Spline, Index) => Rows.push(Row({ Key: `Spline:${Layer.Id}:${Spline.Id}`, Depth: Depth + 1, Glyph: "Spline", Colour: LayerColour(Layer),
                    Title: `${SplineVariants[Layer.Variant].Label} ${Index + 1}`, Subtitle: `${Spline.Points.length} control points`, Selected: S.SplineId === Spline.Id })));
            }
        }
    };

    Rows.push(`<div class="section-row">Regions<span class="chips"><button class="chip" data-command="AddCell">${Icon("Plus")} Bounds</button></span></div>`);
    Rows.push(Row({ Key: "World", Glyph: "World", Colour: "#7f92bd", Title: "World", Subtitle: "Infinite plane · settings", Selected: S.Category === "World" }));
    for (const Terrain of Doc.Terrains)
    {
        const Active = Terrain.Id === Doc.ActiveTerrain;
        const Stale = Session.StaleTerrains.has(Terrain.Id);
        const Open = !Session.CollapsedRegions.has(Terrain.Id);
        Rows.push(Row({ Key: `Terrain:${Terrain.Id}`, Depth: 1, Lead: Caret(Terrain.Id, Open), Glyph: "Terrain", Colour: "#ffb454", Title: Terrain.Name,
            Subtitle: `${(Terrain.Size[0] / 1000).toFixed(2)} × ${(Terrain.Size[1] / 1000).toFixed(2)} km · ${Terrain.Resolution}² · ${PluralLayers(Terrain.Layers.length)}${Stale ? " · pending" : ""}`,
            Selected: S.Category === "Terrain" && Active,
            Tail: Active ? `<span class="active-tag">ACTIVE</span>` : `<button class="row-action" data-command="Activate:${Terrain.Id}" title="Make active">${Icon("Check")}</button>` }));
        if (!Open) continue;
        if (Terrain.Layers.length) PushStack(Terrain.Layers, 2);
        else Rows.push(Hint(2, "Empty layer stack · draw a shape [D] inside this region or add a layer below"));
    }
    if (Doc.Unassigned.length)
    {
        const Open = !Session.CollapsedRegions.has("Unassigned");
        Rows.push(Row({ Key: "Unassigned", Depth: 1, Lead: Caret("Unassigned", Open), Glyph: "Stack", Colour: "#8a8a8a", Title: "Unassigned",
            Subtitle: `${PluralLayers(Doc.Unassigned.length)} · not evaluated · box with Bounds [R] to adopt`, Selected: S.Category === "Unassigned" }));
        if (Open) PushStack(Doc.Unassigned, 2);
    }
    if (!Doc.Terrains.length && !Doc.Unassigned.length) Rows.push(Hint(1, "Draw a shape [D] in 2D, then box it with Bounds [R] to create a region"));

    const Owner = Session.ResolveOutlinerOwner();
    const Target = Owner ? Doc.RetrieveTerrain(Owner)?.Name : "Unassigned";
    Rows.push(`<div class="section-row">Add layer<small style="letter-spacing:0;text-transform:none;color:#777">to ${Escape(Target || "Unassigned")}</small></div>`);
    Rows.push(`<div class="add-strip">` +
        `<button data-command="AddShape">${Icon("Plus")} Shape</button>` +
        Object.keys(SplineVariants).map(Variant => `<button data-command="AddSpline:${Variant}">${Icon("Plus")} ${SplineVariants[Variant].Label}</button>`).join("") +
        `<button data-command="AddSculpt">${Icon("Plus")} Sculpt</button></div>`);

    const Container = document.getElementById("OutlinerRows");
    Container.innerHTML = Rows.join("");
    Container.onclick = Event => OnOutlinerClick(Session, Event);
    RenderFooters(Session);
}

// 📝 Reordering stays inside the owning stack; a layer never moves into another region by reordering.
function MoveLayer(Session, Id, Direction)
{
    const Doc = Session.Document;
    const Owner = Doc.RetrieveOwner(Id);
    if (Owner === undefined) return;
    const Layers = Doc.RetrieveStack(Owner);
    const Index = Layers.findIndex(Layer => Layer.Id === Id);
    const Target = Index + Direction;
    if (Index < 0 || Target < 0 || Target >= Layers.length) return;
    Session.EditVector("Reorder layer", () => { [Layers[Index], Layers[Target]] = [Layers[Target], Layers[Index]]; Doc.TouchLayer(Layers[Target]); });
}

function OnOutlinerClick(Session, Event)
{
    const Doc = Session.Document;
    const Command = Event.target.closest("[data-command]")?.dataset.command;
    if (Command)
    {
        Event.stopPropagation();
        const [Verb, Argument] = Command.split(":");
        switch (Verb)
        {
            case "AddCell": Session.SelectTool("Bounds"); if (Session.Workspace === "Relief") Session.SelectWorkspace("Split"); Session.Notify("Drag a box in the 2D plan to create a terrain cell"); break;
            case "Activate": Session.SelectTerrain(Argument); break;
            case "Collapse": { const Collapsed = Session.CollapsedRegions; if (Collapsed.has(Argument)) Collapsed.delete(Argument); else Collapsed.add(Argument); RenderOutliner(Session); break; }
            case "Raise": MoveLayer(Session, Argument, +1); break;
            case "Lower": MoveLayer(Session, Argument, -1); break;
            case "Visibility": Session.EditVector("Toggle visibility", () => { const Layer = Doc.RetrieveLayer(Argument); Layer.Visible = !Layer.Visible; Doc.TouchLayer(Layer); }); break;
            case "AddShape": { const Owner = Session.ResolveOutlinerOwner(); let Layer; Session.EditVector("Add shape layer", () => { Layer = Doc.CreateShapeLayer("Shape", Owner); }); Session.SelectLayer(Layer.Id); Session.SelectTool("Shape"); break; }
            case "AddSpline": { const Owner = Session.ResolveOutlinerOwner(); let Layer; Session.EditVector("Add spline layer", () => { Layer = Doc.CreateSplineLayer(Argument, null, Owner); }); Session.SplineVariant = Argument; Session.SelectLayer(Layer.Id); Session.SelectTool("Spline"); break; }
            case "AddSculpt":
            {
                const Owner = Session.ResolveOutlinerOwner();
                if (!Owner) { Session.Notify("Sculpt layers need a region — box one with Bounds [R] first"); break; }
                const Count = Doc.RetrieveStack(Owner).filter(Candidate => Candidate.Category === "Sculpt").length;
                let Layer;
                Session.EditVector("Add sculpt layer", () => { Layer = Doc.CreateSculptLayer(`Sculpt ${Count + 1}`, Owner); });
                Session.SelectLayer(Layer.Id);
                Session.SelectTool("Sculpt");
                break;
            }
            default: break;
        }
        return;
    }
    const Key = Event.target.closest(".outliner-row")?.dataset.key;
    if (!Key) return;
    const [Category, A, B] = Key.split(":");
    if (Category === "World") Session.SelectWorld();
    else if (Category === "Unassigned") Session.SelectUnassigned();
    else if (Category === "Terrain") Session.SelectTerrain(A);
    else if (Category === "Layer")
    {
        Session.SelectLayer(A);
        const Layer = Doc.RetrieveLayer(A);
        if (Layer.Category === "Spline") Session.SplineVariant = Layer.Variant;
    }
    else if (Category === "Spline") Session.SelectSpline(A, B);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    INSPECTOR WIDGETS
//------------------------------------------------------------------------------------------------------------------------

// 📝 Widgets bind to a getter/setter pair. Edits apply live on input; one undo entry is recorded per gesture on change.
class InspectorBuilder
{
    constructor(Session)
    {
        this.Session = Session;
        this.Parts = [];
        this.Bindings = [];
    }

    Push(Html) { this.Parts.push(Html); return this; }

    Slider(Label, Unit, Minimum, Maximum, Step, Read, Write, Options = {})
    {
        const Id = this.Bindings.length;
        this.Bindings.push({ Category: "Slider", Read, Write, Minimum, Maximum, Step, Label, Undoable: Options.Undoable !== false, Logarithmic: !!Options.Logarithmic });
        this.Parts.push(`<label class="field"><span>${Label}</span><div class="slider-pill"><input type="range" data-binding="${Id}" min="0" max="1000" step="1">` +
            `<div class="split-value"><input type="text" data-binding-text="${Id}"><small>${Unit}</small></div></div></label>`);
        return this;
    }

    Toggle(Label, Read, Write, Options = {})
    {
        const Id = this.Bindings.length;
        this.Bindings.push({ Category: "Toggle", Read, Write, Label, Undoable: Options.Undoable !== false });
        this.Parts.push(`<div class="switch-row"><span>${Label}</span><button class="toggle${Read() ? " on" : ""}" data-binding="${Id}"><i></i></button></div>`);
        return this;
    }

    Choice(Label, Choices, Read, Write, Options = {})
    {
        const Id = this.Bindings.length;
        this.Bindings.push({ Category: "Choice", Read, Write, Label, Undoable: Options.Undoable !== false });
        this.Parts.push(`<label class="field"><span>${Label}</span><select data-binding="${Id}">${Choices.map(Choice => `<option${Choice === Read() ? " selected" : ""}>${Choice}</option>`).join("")}</select></label>`);
        return this;
    }

    Tiles(Choices, Read, Write)
    {
        const Id = this.Bindings.length;
        this.Bindings.push({ Category: "Tiles", Read, Write, Undoable: false });
        this.Parts.push(`<div class="tiles">${Choices.map(([Name, Caption]) => `<button class="quick-tile${Read() === Name ? " on" : ""}" data-binding="${Id}" data-choice="${Name}">${Name}<small>${Caption}</small></button>`).join("")}</div>`);
        return this;
    }

    Card(Title, Body, Note = "")
    {
        this.Parts.push(`<div class="property-card"><h3>${Title}</h3>${Note ? `<p class="note">${Note}</p>` : ""}`);
        Body();
        this.Parts.push(`</div>`);
        return this;
    }

    Buttons(List)
    {
        this.Parts.push(`<div class="button-row">${List.map(([Label, Command, Danger]) => `<button data-action="${Command}"${Danger ? ` class="danger"` : ""}>${Label}</button>`).join("")}</div>`);
        return this;
    }

    Mount(Container, Actions)
    {
        Container.innerHTML = this.Parts.join("");
        const Session = this.Session;
        const Encode = (Binding, Number) => Binding.Logarithmic ? Math.round(Math.log(Number / Binding.Minimum) / Math.log(Binding.Maximum / Binding.Minimum) * 1000) : Math.round((Number - Binding.Minimum) / (Binding.Maximum - Binding.Minimum) * 1000);
        const Decode = (Binding, Position) =>
        {
            const Raw = Binding.Logarithmic ? Binding.Minimum * Math.pow(Binding.Maximum / Binding.Minimum, Position / 1000) : Binding.Minimum + (Binding.Maximum - Binding.Minimum) * Position / 1000;
            return Math.round(Raw / Binding.Step) * Binding.Step;
        };
        const Display = (Binding, Number) => Number.toFixed(Binding.Step < 0.1 ? 2 : Binding.Step < 1 ? 1 : 0);
        const Paint = (Binding, Range, Text) =>
        {
            const Number = Binding.Read();
            const Position = Math.max(0, Math.min(1000, Encode(Binding, Number)));
            Range.value = Position;
            Range.style.setProperty("--fill", `${Position / 10}%`);
            Text.value = Display(Binding, Number);
        };
        let Before = null;
        const BeginEdit = Binding => { if (Binding.Undoable && Before === null) Before = Session.History.CaptureVector(); };
        const EndEdit = Binding => { if (Before !== null) { Session.History.RegisterVectorEdit(Binding.Label, Before); Before = null; RenderOutliner(Session); } };
        Container.querySelectorAll("[data-binding]").forEach(Widget =>
        {
            const Binding = this.Bindings[+Widget.dataset.binding];
            if (Binding.Category === "Slider")
            {
                const Text = Container.querySelector(`[data-binding-text="${Widget.dataset.binding}"]`);
                Paint(Binding, Widget, Text);
                Widget.addEventListener("input", () => { BeginEdit(Binding); Binding.Write(Decode(Binding, +Widget.value)); Paint(Binding, Widget, Text); Session.Invalidate(); });
                Widget.addEventListener("change", () => EndEdit(Binding));
                Text.addEventListener("change", () =>
                {
                    const Parsed = parseFloat(Text.value);
                    if (!isNaN(Parsed)) { BeginEdit(Binding); Binding.Write(Math.max(Binding.Minimum, Math.min(Binding.Maximum, Parsed))); EndEdit(Binding); }
                    Paint(Binding, Widget, Text);
                    Session.Invalidate();
                });
            }
            else if (Binding.Category === "Toggle")
            {
                Widget.addEventListener("click", () => { BeginEdit(Binding); Binding.Write(!Binding.Read()); EndEdit(Binding); Widget.classList.toggle("on", !!Binding.Read()); Session.Invalidate(); });
            }
            else if (Binding.Category === "Choice")
            {
                Widget.addEventListener("change", () => { BeginEdit(Binding); Binding.Write(Widget.value); EndEdit(Binding); Session.Invalidate(); });
            }
            else if (Binding.Category === "Tiles")
            {
                Widget.addEventListener("click", () => { Binding.Write(Widget.dataset.choice); Container.querySelectorAll(`[data-binding="${Widget.dataset.binding}"]`).forEach(Tile => Tile.classList.toggle("on", Tile === Widget)); Session.Invalidate(); });
            }
        });
        Container.querySelectorAll("[data-action]").forEach(Button => Button.addEventListener("click", () => Actions[Button.dataset.action]?.()));
        const Title = Container.querySelector(".inspector-title input");
        if (Title && Actions.Rename) Title.addEventListener("change", () => Actions.Rename(Title.value.trim() || Title.defaultValue));
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    INSPECTOR
//------------------------------------------------------------------------------------------------------------------------

const Metric = (Label, Number, Unit = "") => `<div class="metric-card"><b>${Number}${Unit ? `<small>${Unit}</small>` : ""}</b><span>${Label}</span></div>`;

export function RenderInspector(Session)
{
    const Container = document.getElementById("Inspector");
    const Doc = Session.Document;
    const S = Session.Selection;
    const B = new InspectorBuilder(Session);
    const Actions = {};
    if (Session.Tool === "Sculpt") BuildBrushInspector(Session, B);
    if (S.Category === "Terrain" && Doc.RetrieveTerrain()) BuildTerrainInspector(Session, B, Actions);
    else if (S.Category === "Unassigned") BuildUnassignedInspector(Session, B);
    else if ((S.Category === "Layer" || S.Category === "Spline") && Doc.RetrieveLayer(S.LayerId)) BuildLayerInspector(Session, B, Actions);
    else if (Session.Tool !== "Sculpt") BuildWorldInspector(Session, B, Actions);
    B.Mount(Container, Actions);
    const Footer = document.getElementById("InspectorFooter");
    Footer.innerHTML = `<span>${Session.History.Undo.length} undo · ${Session.History.Redo.length} redo</span><span>` +
        `<button class="round-button" title="Undo (Ctrl+Z)" id="UndoButton">${Icon("Undo")}</button> <button class="round-button" title="Redo (Ctrl+Y)" id="RedoButton">${Icon("Redo")}</button></span>`;
    document.getElementById("UndoButton").onclick = () => Session.Undo();
    document.getElementById("RedoButton").onclick = () => Session.Redo();
}

function BuildBrushInspector(Session, B)
{
    const Brush = Session.Brush;
    const Layer = Session.Document.RetrieveLayer(Session.Selection.LayerId);
    B.Push(`<div class="breadcrumbs">Tools / Sculpt</div><div class="inspector-title">Sculpt brush</div>`);
    B.Push(`<div class="eyebrow">Target: ${Escape(Layer && Layer.Category === "Sculpt" ? Layer.Name : "topmost sculpt layer")} · ${Session.Metrics.TotalStamps.toLocaleString()} stamps this session</div>`);
    B.Tiles([["Raise", "LMB"], ["Lower", "CTRL"], ["Smooth", "SHIFT"], ["Flatten", "HEIGHT AT CLICK"]], () => Brush.Mode, Mode => { Brush.Mode = Mode; });
    B.Card("Brush", () =>
    {
        B.Slider("Radius", "m", 5, 4000, 1, () => Brush.Radius, Number => { Brush.Radius = Number; }, { Undoable: false, Logarithmic: true });
        B.Slider("Strength", "-", 0.02, 2, 0.01, () => Brush.Strength, Number => { Brush.Strength = Number; }, { Undoable: false });
        B.Slider("Hardness", "-", 0, 1, 0.01, () => Brush.Hardness, Number => { Brush.Hardness = Number; }, { Undoable: false });
    }, "Each stamp is one GPU quad into a per-cell R32F delta raster — there is no stroke or node cap. [ / ] resize · Alt+drag or RMB orbits.");
}

function BuildWorldInspector(Session, B, Actions)
{
    const Doc = Session.Document;
    const Settings = Doc.Settings;
    let Bytes = 0;
    Session.Fields.forEach(Field => Bytes += Field.MemoryBytes());
    B.Push(`<div class="breadcrumbs">World</div><div class="inspector-title">World</div><div class="eyebrow">Infinite authoring plane · each region evaluates its own layer stack</div>`);
    B.Push(`<div class="metric-grid">${Metric("Regions", Doc.Terrains.length)}${Metric("Layers", Doc.Layers.length)}${Metric("GPU memory", (Bytes / 1048576).toFixed(0), "MB")}${Metric("Undo depth", Session.History.Undo.length)}</div>`);
    const Touch = Write => Number => { Write(Number); Doc.TouchSettings(true); };
    const Show = Write => Number => { Write(Number); Doc.TouchSettings(false); };
    B.Card("Elevation", () =>
    {
        B.Slider("Sea level", "m", -200, 400, 1, () => Settings.SeaLevel, Show(Number => Settings.SeaLevel = Number));
        B.Slider("Seabed", "m", -600, 0, 1, () => Settings.Seabed, Touch(Number => Settings.Seabed = Number));
        B.Slider("Snow line", "m", 0, 2000, 5, () => Settings.SnowLine, Show(Number => Settings.SnowLine = Number));
    });
    B.Card("Display", () =>
    {
        B.Toggle("Water", () => Settings.WaterVisible, Show(Enabled => Settings.WaterVisible = Enabled));
        B.Toggle("Contours", () => Settings.Contours, Show(Enabled => Settings.Contours = Enabled));
        B.Slider("Contour interval", "m", 5, 200, 5, () => Settings.ContourInterval, Show(Number => Settings.ContourInterval = Number));
        B.Slider("Sun azimuth", "°", 0, 360, 1, () => Settings.SunAzimuth, Touch(Number => Settings.SunAzimuth = Number));
        B.Slider("Sun elevation", "°", 3, 85, 1, () => Settings.SunElevation, Touch(Number => Settings.SunElevation = Number));
        B.Toggle("Splines in 3D", () => Session.ShowSplines3D, Enabled => { Session.ShowSplines3D = Enabled; }, { Undoable: false });
        B.Choice("3D resolution", ["Auto", "Full", "Half"], () => Session.Relief.ScaleMode, Mode => { Session.Relief.ScaleMode = Mode; Session.Relief.Scale = Mode === "Half" ? 0.5 : 1; }, { Undoable: false });
    });
    B.Card("Performance", () =>
    {
        const Result = Session.Benchmark;
        if (Result)
        {
            const Labels = { ColdEvaluate: "Full stack, cold", StampOnly160m: "One stamp · 160 m", StampOnly1000m: "One stamp · 1 km", SculptEditFullFromCache: "Sculpt edit · full cell",
                             SculptEditRegion160m: "Sculpt edit · region 160 m", SculptEditRegion1000m: "Sculpt edit · region 1 km", StrokeEndRefine: "Stroke-end refine",
                             SplineDragIncremental: "Spline point drag", ShapeParameterEdit: "Shape parameter edit", ShapeStrokeEdit: "Shape stroke edit",
                             ReliefRenderFull: "3D view · full res", ReliefRenderHalf: "3D view · half res", CalibrationSeedPass: "Calibration pass" };
            B.Push(`<p class="note">${Escape(Result.Renderer)} · ${Result.Resolution}² · 3D ${Result.Viewport.join("×")} px</p>`);
            for (const [Key, Label] of Object.entries(Labels))
            {
                const Row = Result.Rows[Key];
                if (Row) B.Push(`<div class="switch-row"><span>${Label}</span><span style="color:#ececec">${Row.Milliseconds.toFixed(2)} ms <small style="color:#666">${Row.Passes}p</small></span></div>`);
            }
            const Exact = Result.Rows.RegionExactness;
            if (Exact) B.Push(`<div class="switch-row"><span>Region vs full (max Δh)</span><span style="color:${Exact.MaximumHeightDifferenceMetres === 0 ? "#34c759" : "#e19a97"}">${Exact.MaximumHeightDifferenceMetres.toExponential(1)} m</span></div>`);
        }
        B.Buttons([["Run edit benchmark", "Benchmark"]]);
    }, "Times each edit on this GPU (wall clock, GPU-synchronised). Your document is restored afterwards.");
    Actions.Benchmark = () => Session.RunBenchmark();
    B.Card("Project", () =>
    {
        B.Buttons([["Save project", "Save"], ["Open project", "Open"], ["Load example", "Example"], ["New empty world", "Empty", true]]);
    }, "Projects bundle the vector document with every sculpt raster. The document also autosaves to this browser.");
    Actions.Save = () => Session.SaveProject();
    Actions.Open = () => document.getElementById("OpenFile").click();
    Actions.Example = () => Session.ResetWorld(true);
    Actions.Empty = () => Session.ResetWorld(false);
}

function BuildTerrainInspector(Session, B, Actions)
{
    const Doc = Session.Document;
    const Terrain = Doc.RetrieveTerrain();
    const Field = Session.ActiveField();
    const Evaluation = Field ? Field.LastEvaluation : null;
    B.Push(`<div class="breadcrumbs">World / Regions / ${Escape(Terrain.Name)}</div>`);
    B.Push(`<div class="inspector-title"><input value="${Escape(Terrain.Name)}"></div><div class="eyebrow">Simulation bounds · only this region is evaluated and baked</div>`);
    B.Push(`<div class="metric-grid">${Metric("Width", (Terrain.Size[0] / 1000).toFixed(2), "km")}${Metric("Depth", (Terrain.Size[1] / 1000).toFixed(2), "km")}${Metric("Layers", Terrain.Layers.length)}` +
        `${Metric("Texel", (Terrain.Size[0] / Terrain.Resolution).toFixed(2), "m")}${Metric("GPU memory", Field ? (Field.MemoryBytes() / 1048576).toFixed(0) : 0, "MB")}` +
        `${Metric("CPU submit", Evaluation ? Evaluation.Milliseconds.toFixed(1) : "–", "ms")}${Metric("Passes", Evaluation ? `${Evaluation.Passes}${Evaluation.FromCache ? " ↺" : ""}` : "–")}</div>`);
    const Geometry = Write => Number => { Write(Number); Doc.TouchTerrain(Terrain); if (Field) Field.Anchor = { Min: [...Terrain.Min], Size: [...Terrain.Size] }; };
    B.Card("Bounds", () =>
    {
        B.Slider("Origin X", "m", -50000, 50000, 10, () => Terrain.Min[0], Geometry(Number => Terrain.Min[0] = Number));
        B.Slider("Origin Z", "m", -50000, 50000, 10, () => Terrain.Min[1], Geometry(Number => Terrain.Min[1] = Number));
        B.Slider("Width", "m", 128, 16384, 16, () => Terrain.Size[0], Geometry(Number => Terrain.Size[0] = Number), { Logarithmic: true });
        B.Slider("Depth", "m", 128, 16384, 16, () => Terrain.Size[1], Geometry(Number => Terrain.Size[1] = Number), { Logarithmic: true });
        B.Choice("Resolution", ["512", "1024", "2048"], () => String(Terrain.Resolution), Text => { Terrain.Resolution = +Text; Doc.TouchTerrain(Terrain); Session.ReconcileFields(); RenderInspector(Session); });
    }, "This region owns its layer stack; layers are authored in world space, so numeric bound edits move the region over them while sculpt rasters stay where they are in the region. Drag the handles in 2D to re-anchor sculpting in world space.");
    B.Buttons([["Frame  F", "Frame"], ["Bake heightfield", "Bake"], ["Delete region + stack", "Delete", true]]);
    Actions.Frame = () => Session.FrameActive();
    Actions.Bake = () => Session.BakeHeightfield();
    Actions.Delete = () => Session.DeleteTerrain(Terrain.Id);
    Actions.Rename = Name => Session.EditVector("Rename cell", () => { Terrain.Name = Name; Doc.TouchTerrain(Terrain); });
}

function BuildUnassignedInspector(Session, B)
{
    const Doc = Session.Document;
    B.Push(`<div class="breadcrumbs">World / Unassigned</div><div class="inspector-title">Unassigned layers</div><div class="eyebrow">Drawn outside every region · never evaluated</div>`);
    B.Push(`<div class="metric-grid">${Metric("Layers", Doc.Unassigned.length)}${Metric("Regions", Doc.Terrains.length)}</div>`);
    B.Card("Adoption", () => {}, "Box these layers with the Bounds tool [R]: the new region adopts every unassigned layer whose geometry overlaps it, as the start of its own layer stack.");
}

function BuildLayerInspector(Session, B, Actions)
{
    const Doc = Session.Document;
    const Layer = Doc.RetrieveLayer(Session.Selection.LayerId);
    const Touch = (Write, Geometry = false) => Number => { Write(Number); Doc.TouchLayer(Layer, Geometry); };
    const Category = Layer.Category === "Spline" ? `${SplineVariants[Layer.Variant].Label} spline layer` : `${Layer.Category} layer`;
    const Owner = Doc.RetrieveOwner(Layer.Id);
    B.Push(`<div class="breadcrumbs">World / ${Owner ? `${Escape(Doc.RetrieveTerrain(Owner).Name)} / Layer stack` : "Unassigned"} / ${Escape(Layer.Name)}</div>`);
    B.Push(`<div class="inspector-title"><input value="${Escape(Layer.Name)}"></div><div class="eyebrow" style="color:${LayerColour(Layer)}">${Category} · ${Escape(LayerSubtitle(Layer))}</div>`);
    Actions.Rename = Name => Session.EditVector("Rename layer", () => { Layer.Name = Name; Doc.TouchLayer(Layer); });
    Actions.Delete = () => Session.DeleteSelection();
    B.Card("Layer", () =>
    {
        B.Toggle("Visible", () => Layer.Visible, Touch(Enabled => Layer.Visible = Enabled));
        B.Slider("Opacity", "-", 0, 1, 0.01, () => Layer.Opacity, Touch(Number => Layer.Opacity = Number));
    });

    if (Layer.Category === "Shape")
    {
        const P = Layer.Parameters;
        B.Card("Landform", () =>
        {
            B.Choice("Operation", ShapeOperations, () => P.Operation, Touch(Text => P.Operation = Text));
            B.Slider("Elevation", "m", -400, 1200, 1, () => P.Elevation, Touch(Number => P.Elevation = Number));
            B.Slider("Coast width", "m", 10, 3000, 5, () => P.CoastWidth, Touch(Number => P.CoastWidth = Number), { Logarithmic: true });
            B.Slider("Relief", "m", 0, 1200, 1, () => P.Relief, Touch(Number => P.Relief = Number));
            B.Slider("Relief scale", "m", 50, 5000, 5, () => P.ReliefScale, Touch(Number => P.ReliefScale = Number), { Logarithmic: true });
            B.Slider("Ridged", "-", 0, 1, 0.01, () => P.Ridged, Touch(Number => P.Ridged = Number));
            B.Slider("Coast noise", "-", 0, 1.5, 0.01, () => P.CoastNoise, Touch(Number => P.CoastNoise = Number));
            B.Slider("Seed", "#", 0, 999, 1, () => P.Seed, Touch(Number => P.Seed = Number));
        }, "Strokes are filled into a mask, converted to a signed distance by jump flooding, then shaped into the landmass on the GPU.");
        B.Push(`<div class="section-caption">Strokes<small>${Layer.Strokes.length}</small></div>`);
        B.Buttons([[Session.ShapeSubtract ? "Draw: subtract (X)" : "Draw: add (X)", "Mode"], ["Draw stroke  D", "Draw"], ["Clear strokes", "Clear", true], ["Delete layer", "Delete", true]]);
        Actions.Mode = () => { Session.ShapeSubtract = !Session.ShapeSubtract; RenderInspector(Session); RenderToolRow(Session); };
        Actions.Draw = () => Session.SelectTool("Shape");
        Actions.Clear = () => Session.EditVector("Clear strokes", () => { Layer.Strokes = []; Doc.TouchLayer(Layer, true); });
    }
    else if (Layer.Category === "Spline")
    {
        const P = Layer.Parameters;
        const Tunnel = Layer.Variant === "Tunnel";
        B.Card("Corridor profile", () =>
        {
            B.Slider(Tunnel ? "Radius" : "Width", "m", 2, 400, 1, () => P.Width, Touch(Number => P.Width = Number, true), { Logarithmic: true });
            if (!Tunnel)
            {
                B.Slider("Shoulder", "m", 0, 600, 1, () => P.Shoulder, Touch(Number => P.Shoulder = Number, true));
                B.Slider("Grade smoothing", "m", 0, 600, 5, () => P.Smoothing, Touch(Number => P.Smoothing = Number, true));
                if (Layer.Variant !== "Ridge") B.Slider("Depth", "m", 0, 400, 1, () => P.Depth, Touch(Number => P.Depth = Number));
                if (Layer.Variant === "Ridge") B.Slider("Rise", "m", 0, 800, 1, () => P.Rise, Touch(Number => P.Rise = Number));
                if (Layer.Variant === "Canyon") B.Slider("Terrace step", "m", 0, 80, 1, () => P.TerraceStep, Touch(Number => P.TerraceStep = Number));
                if (Layer.Variant === "Canyon") B.Slider("Wall steepness", "-", 0.5, 5, 0.1, () => P.WallSteepness, Touch(Number => P.WallSteepness = Number));
                B.Toggle("Force downhill", () => !!P.Downhill, Touch(Enabled => P.Downhill = Enabled, true));
            }
        }, Tunnel ? "Tunnels carve a sparse 3D SDF volume around the spline; only the bricks the tube passes through are stored."
                  : "Splines are resampled on the CPU (≈ kilobytes), then the corridor is cut into the height stack per texel on the GPU.");
        const Located = Session.Selection.SplineId ? Doc.LocateSpline(Session.Selection.SplineId) : null;
        if (Located)
        {
            const Index = Session.Selection.PointIndex;
            const Point = Located.Spline.Points[Index];
            if (Point)
            {
                B.Card(`Control point ${Index + 1} / ${Located.Spline.Points.length}`, () =>
                {
                    B.Push(`<div class="axes"><label><b>X</b><input data-axis="X" value="${Point.X.toFixed(1)}"></label><label><b>Z</b><input data-axis="Z" value="${Point.Z.toFixed(1)}"></label></div>`);
                    B.Slider("Width scale", "×", 0.1, 4, 0.05, () => Point.Width, Touch(Number => Point.Width = Number, true));
                    B.Slider(Tunnel ? "Elevation offset" : "Lift", "m", -300, 300, 1, () => Point.Lift || 0, Touch(Number => Point.Lift = Number, true));
                }, "Drag points in 2D or 3D. Alt+drag in 3D changes lift. Delete removes the point.");
            }
            B.Buttons([["Continue spline  P", "Continue"], ["Delete spline", "DeleteSpline", true]]);
            Actions.Continue = () => { Session.Draft = { LayerId: Layer.Id, SplineId: Located.Spline.Id }; Session.SelectTool("Spline"); Session.Draft = { LayerId: Layer.Id, SplineId: Located.Spline.Id }; };
            Actions.DeleteSpline = () => { Session.Selection.PointIndex = -1; Session.DeleteSelection(); };
        }
        B.Buttons([["Draw new spline  P", "Draw"], ["Delete layer", "Delete", true]]);
        Actions.Draw = () => { Session.SplineVariant = Layer.Variant; Session.SelectTool("Spline"); };
    }
    else
    {
        const Field = Session.ActiveField();
        B.Push(`<div class="metric-grid">${Metric("Raster", Field ? `${Field.Resolution}²` : "–")}${Metric("Revision", Field ? (Field.SculptRevisions.get(Layer.Id) || 0) : 0)}</div>`);
        B.Buttons([["Sculpt  B", "Sculpt"], ["Clear in active cell", "Clear", true], ["Delete layer", "Delete", true]]);
        Actions.Sculpt = () => Session.SelectTool("Sculpt");
        Actions.Clear = () =>
        {
            if (!Field) return;
            const N = Field.Resolution;
            const Before = Session.Pipeline.SnapshotSculptRegion(Field, Layer.Id, [0, 0, N, N]);
            Session.Pipeline.ClearSculpt(Field, Layer.Id);
            const After = Session.Pipeline.SnapshotSculptRegion(Field, Layer.Id, [0, 0, N, N]);
            const Restore = Snapshot => () => { Session.Pipeline.RestoreSculptRegion(Field, Layer.Id, [0, 0, N, N], Snapshot); Session.MarkRastersDirty(Session.Document.ActiveTerrain); };
            Session.History.RegisterRasterEdit("Clear sculpt", Restore(Before), Restore(After), () => { Session.Device.ReleaseTexture(Before); Session.Device.ReleaseTexture(After); });
            Session.MarkRastersDirty(Session.Document.ActiveTerrain);
            Session.Invalidate();
        };
    }
    const AxisContainer = () => document.querySelectorAll("#Inspector [data-axis]");
    queueMicrotask(() => AxisContainer().forEach(Input => Input.addEventListener("change", () =>
    {
        const Located = Doc.LocateSpline(Session.Selection.SplineId);
        const Point = Located && Located.Spline.Points[Session.Selection.PointIndex];
        const Number = parseFloat(Input.value);
        if (!Point || isNaN(Number)) return;
        Session.EditVector("Move spline point", () => { Point[Input.dataset.axis] = Number; Doc.TouchLayer(Located.Layer, true); });
    })));
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    VIEWPORT HEAD AND TOOLS
//------------------------------------------------------------------------------------------------------------------------

export function RenderViewportHead(Session)
{
    const Head = document.getElementById("ViewportHead");
    const Terrain = Session.Document.RetrieveTerrain();
    Head.innerHTML =
        `<div class="scene-title"><span class="row-glyph" style="background:#ffb45422;color:#ffb454">${Icon("Terrain")}</span>` +
        `<div><b>${Terrain ? Escape(Terrain.Name) : "No terrain cell"}</b><small>${Terrain ? `${Terrain.Resolution}² · ${(Terrain.Size[0] / 1000).toFixed(1)} × ${(Terrain.Size[1] / 1000).toFixed(1)} km` : "Draw bounds with R"}</small></div>` +
        `<span class="badge">LANDFORM</span></div><span class="head-spacer"></span>` +
        `<div class="pill-group">${[["Plan", "2D", "1"], ["Split", "2D | 3D", "3"], ["Relief", "3D", "2"]].map(([Name, Label, Key]) => `<button data-workspace="${Name}" class="${Session.Workspace === Name ? "on" : ""}" title="Key ${Key}">${Label}</button>`).join("")}</div>` +
        `<button class="round-button" data-head="Frame" title="Frame active cell (F)">${Icon("Frame")}</button>` +
        `<button class="round-button" data-head="Menu" title="Project">${Icon("Menu")}</button>`;
    Head.querySelectorAll("[data-workspace]").forEach(Button => Button.onclick = () => Session.SelectWorkspace(Button.dataset.workspace));
    Head.querySelector('[data-head="Frame"]').onclick = () => Session.FrameActive();
    Head.querySelector('[data-head="Menu"]').onclick = Event => OpenProjectMenu(Session, Event.currentTarget);
}

function OpenProjectMenu(Session, Anchor)
{
    document.querySelector(".menu")?.remove();
    const Menu = document.createElement("div");
    Menu.className = "menu";
    const Box = Anchor.getBoundingClientRect();
    Menu.style.top = `${Box.bottom + 6}px`;
    Menu.style.left = `${Box.right - 230}px`;
    const Entries = [["Save project", "Ctrl+S", () => Session.SaveProject()], ["Open project…", "", () => document.getElementById("OpenFile").click()], null,
                     ["Bake active heightfield", "", () => Session.BakeHeightfield()], null, ["Load example world", "", () => Session.ResetWorld(true)], ["New empty world", "", () => Session.ResetWorld(false)]];
    for (const Entry of Entries)
    {
        if (!Entry) { Menu.appendChild(document.createElement("hr")); continue; }
        const Button = document.createElement("button");
        Button.innerHTML = `${Entry[0]}<small>${Entry[1]}</small>`;
        Button.onclick = () => { Menu.remove(); Entry[2](); };
        Menu.appendChild(Button);
    }
    document.body.appendChild(Menu);
    setTimeout(() => window.addEventListener("pointerdown", function Dismiss(Event) { if (!Menu.contains(Event.target)) { Menu.remove(); window.removeEventListener("pointerdown", Dismiss); } }), 0);
}

export function RenderToolRow(Session)
{
    const Row = document.getElementById("ToolRow");
    const Tools = [["Select", "V"], ["Shape", "D"], ["Bounds", "R"], ["Spline", "P"], ["Sculpt", "B"]];
    let Html = Tools.map(([Name, Key]) => `<button class="tool${Session.Tool === Name ? " on" : ""}" data-tool="${Name}">${Name}<kbd>${Key}</kbd></button>`).join("");
    Html += `<span class="separator"></span>`;
    if (Session.Tool === "Shape") Html += `<div class="pill-group"><button data-subtract="0" class="${Session.ShapeSubtract ? "" : "on"}">Add</button><button data-subtract="1" class="${Session.ShapeSubtract ? "on" : ""}">Subtract</button></div>`;
    if (Session.Tool === "Spline") Html += `<select data-variant>${Object.keys(SplineVariants).map(Variant => `<option${Variant === Session.SplineVariant ? " selected" : ""}>${Variant}</option>`).join("")}</select>`;
    if (Session.Tool === "Sculpt") Html += `<div class="pill-group">${SculptModes.map(Mode => `<button data-mode="${Mode}" class="${Session.Brush.Mode === Mode ? "on" : ""}">${Mode}</button>`).join("")}</div>`;
    const Hints = { Select: "Click to select · drag handles · RMB/MMB pan · wheel zoom", Shape: "Drag to draw a closed landmass stroke", Bounds: "Drag a box = terrain cell (Shift = square)",
                    Spline: "Click to add points · Enter/RMB to finish", Sculpt: "LMB sculpt · Ctrl invert · Shift smooth · [ ] radius" };
    Html += `<span style="font-size:10px;color:#666;white-space:nowrap">${Hints[Session.Tool]}</span>`;
    Row.innerHTML = Html;
    Row.querySelectorAll("[data-tool]").forEach(Button => Button.onclick = () => Session.SelectTool(Button.dataset.tool));
    Row.querySelectorAll("[data-subtract]").forEach(Button => Button.onclick = () => { Session.ShapeSubtract = Button.dataset.subtract === "1"; RenderToolRow(Session); });
    Row.querySelectorAll("[data-mode]").forEach(Button => Button.onclick = () => { Session.Brush.Mode = Button.dataset.mode; RenderToolRow(Session); RenderInspector(Session); });
    const Variant = Row.querySelector("[data-variant]");
    if (Variant) Variant.onchange = () => { Session.SplineVariant = Variant.value; Session.FinishDraft(); };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    FOOTERS
//------------------------------------------------------------------------------------------------------------------------

export function RenderFooters(Session)
{
    const M = Session.Metrics;
    const Device = Session.Device;
    const Gpu = Number => Number >= 0 ? `${Number.toFixed(1)} ms` : "n/a";
    document.getElementById("OutlinerFooter").innerHTML =
        `<span><small>REALTIME</small><b>${M.TickRate.toFixed(0)} fps</b></span>` +
        `<span><small>CPU SUBMIT</small><b>${M.EvaluateMilliseconds.toFixed(1)} ms</b></span>` +
        `<span><small>GPU EVAL</small><b>${Gpu(M.EvaluateGpu)}</b></span>` +
        `<span><small>GPU 3D</small><b>${Gpu(M.ReliefGpu)}</b></span>` +
        `<span><small>3D SCALE</small><b>${Math.round(Session.Relief.Scale * 100)}%</b></span>`;
    const Hover = Session.PlanHover;
    document.getElementById("ViewportFooter").innerHTML =
        `<b class="ok">●</b> ${Escape(Device.RendererLabel || "WebGL2")} · layers <b>${M.Layers}</b> · passes <b>${M.Passes}</b>${M.FromCache ? " (cached prefix)" : ""} · ` +
        `stamps <b>${M.TotalStamps.toLocaleString()}</b> · ${Hover ? `cursor <b>${Hover[0].toFixed(0)}, ${Hover[1].toFixed(0)}</b> m` : "cursor –"}`;
}

export function RefreshAll(Session)
{
    RenderViewportHead(Session);
    RenderToolRow(Session);
    RenderOutliner(Session);
    RenderInspector(Session);
}
