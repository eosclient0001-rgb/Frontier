/*====================================================================================================================================
                                                        WORLDDOCUMENT.JS
====================================================================================================================================*/
// 🧩 Authoring document: terrain regions (simulation bounds) that each own a layer stack (shape, spline, sculpt), an
//    unassigned stack for content drawn before its region exists, and edit history

//------------------------------------------------------------------------------------------------------------------------
//                                                    LAYER SPECIFICATIONS
//------------------------------------------------------------------------------------------------------------------------

export const ShapeOperations = ["Add", "Subtract", "Plateau", "Maximum"];

export const SplineVariants = {
    Road:   { Label: "Road",   Index: 0, Colour: "#d9d9d9", Parameters: { Width: 14, Shoulder: 26, Smoothing: 120, Depth: 0,  Rise: 0,  TerraceStep: 0,  WallSteepness: 1,   Downhill: false } },
    River:  { Label: "River",  Index: 1, Colour: "#5ab4e6", Parameters: { Width: 34, Shoulder: 70, Smoothing: 60,  Depth: 9,  Rise: 0,  TerraceStep: 0,  WallSteepness: 1,   Downhill: true  } },
    Canyon: { Label: "Canyon", Index: 2, Colour: "#e08a5a", Parameters: { Width: 60, Shoulder: 90, Smoothing: 90,  Depth: 110, Rise: 0, TerraceStep: 14, WallSteepness: 2.2, Downhill: false } },
    Ridge:  { Label: "Ridge",  Index: 3, Colour: "#b9a36e", Parameters: { Width: 50, Shoulder: 160, Smoothing: 60, Depth: 0,  Rise: 140, TerraceStep: 0, WallSteepness: 1,   Downhill: false } },
    Tunnel: { Label: "Tunnel", Index: 4, Colour: "#c792ea", Parameters: { Width: 9,  Shoulder: 0,  Smoothing: 0,   Depth: 0,  Rise: 0,  TerraceStep: 0,  WallSteepness: 1,   Downhill: false } },
};

export const SculptModes = ["Raise", "Lower", "Smooth", "Flatten"];

export const DefaultLandmassParameters = { Operation: "Add", Elevation: 90, CoastWidth: 420, Relief: 260, ReliefScale: 900, Ridged: 0.55, CoastNoise: 0.6, Seed: 7 };

//------------------------------------------------------------------------------------------------------------------------
//                                                    TOKENS
//------------------------------------------------------------------------------------------------------------------------

let TokenCounter = 1;
export function IssueToken(Prefix)
{
    return `${Prefix}${(TokenCounter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    DOCUMENT
//------------------------------------------------------------------------------------------------------------------------

export class WorldDocument
{
    constructor()
    {
        this.Settings = { Seabed: -70, SeaLevel: 0, Ceiling: 1600, WaterVisible: true, Contours: false, ContourInterval: 25, SunAzimuth: 128, SunElevation: 32, SnowLine: 820 };
        this.Terrains = [];                         // [-] - Regions; each owns Layers (bottom → top)
        this.Unassigned = [];                       // [-] - Layers drawn outside every region; adopted by the next box
        this.ActiveTerrain = null;
        this.Revision = 0;                          // [-] - Bumped on any authored change
        this.SettingsRevision = 0;                  // [-] - Bumped on world-setting changes that affect evaluation
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                CONSTRUCTION
    //--------------------------------------------------------------------------------------------------------------------

    // 📝 A new region adopts every unassigned layer whose geometry overlaps it (or that has no geometry yet), so the
    //    "draw a shape, then box it" workflow keeps the drawn content.
    CreateTerrain(Min, Size, Resolution = 1024)
    {
        const Name = `Terrain ${String(this.Terrains.reduce((Highest, Candidate) => Math.max(Highest, parseInt(Candidate.Name.replace(/\D+/g, ""), 10) || 0), 0) + 1).padStart(2, "0")}`;
        const Terrain = { Id: IssueToken("T"), Name, Min: [...Min], Size: [...Size], Resolution, Visible: true, Revision: 1, Layers: [] };
        const Box = [Min[0], Min[1], Min[0] + Size[0], Min[1] + Size[1]];
        const Adopted = this.Unassigned.filter(Layer => { const B = ComputeLayerBounds(Layer); return !B || !(B[2] < Box[0] || B[3] < Box[1] || B[0] > Box[2] || B[1] > Box[3]); });
        this.Unassigned = this.Unassigned.filter(Layer => !Adopted.includes(Layer));
        Terrain.Layers.push(...Adopted);
        Adopted.forEach(Layer => Layer.Revision++);
        this.Terrains.push(Terrain);
        this.ActiveTerrain = Terrain.Id;
        this.Revision++;
        return Terrain;
    }

    // 📝 Owner = terrain id, or null for the unassigned stack; undefined means the active region (unassigned if none).
    InsertLayer(Layer, Owner, AtBottom = false)
    {
        const Stack = this.RetrieveStack(Owner === undefined ? this.ActiveTerrain : Owner);
        if (AtBottom) Stack.unshift(Layer); else Stack.push(Layer);
        this.Revision++;
        return Layer;
    }

    CreateShapeLayer(Name = "Landmass", Owner = undefined, AtBottom = false)
    {
        return this.InsertLayer({ Id: IssueToken("L"), Name, Category: "Shape", Visible: true, Opacity: 1, Strokes: [], Parameters: { ...DefaultLandmassParameters }, Revision: 1, GeometryRevision: 1 }, Owner, AtBottom);
    }

    CreateSplineLayer(Variant, Name = null, Owner = undefined)
    {
        const Specification = SplineVariants[Variant];
        return this.InsertLayer({ Id: IssueToken("L"), Name: Name || `${Specification.Label}s`, Category: "Spline", Variant, Visible: true, Opacity: 1, Splines: [], Parameters: { ...Specification.Parameters }, Revision: 1, GeometryRevision: 1 }, Owner);
    }

    CreateSculptLayer(Name = "Sculpt", Owner = undefined)
    {
        return this.InsertLayer({ Id: IssueToken("L"), Name, Category: "Sculpt", Visible: true, Opacity: 1, Revision: 1, GeometryRevision: 1 }, Owner);
    }

    RemoveLayer(Layer)
    {
        const Owner = this.RetrieveOwner(Layer.Id);
        if (Owner === undefined) return;
        const Stack = this.RetrieveStack(Owner);
        const Index = Stack.indexOf(Layer);
        if (Index >= 0) Stack.splice(Index, 1);
        this.Revision++;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                QUERIES
    //--------------------------------------------------------------------------------------------------------------------

    RetrieveTerrain(Id = this.ActiveTerrain) { return this.Terrains.find(Terrain => Terrain.Id === Id) || null; }
    RetrieveLayer(Id) { return this.Layers.find(Layer => Layer.Id === Id) || null; }

    // 📝 Read-only flat view (unassigned first, then each region bottom → top) for lookups and the shared spline atlas.
    //    Mutations go through the owning stack: RetrieveStack / InsertLayer / RemoveLayer.
    get Layers() { return this.Unassigned.concat(...this.Terrains.map(Terrain => Terrain.Layers)); }

    RetrieveStack(Owner) { return Owner === null || Owner === undefined ? this.Unassigned : (this.Terrains.find(Terrain => Terrain.Id === Owner)?.Layers || this.Unassigned); }

    // 📝 Terrain id owning the layer, null when unassigned, undefined when the layer does not exist.
    RetrieveOwner(LayerId)
    {
        const Terrain = this.Terrains.find(Candidate => Candidate.Layers.some(Layer => Layer.Id === LayerId));
        if (Terrain) return Terrain.Id;
        return this.Unassigned.some(Layer => Layer.Id === LayerId) ? null : undefined;
    }

    // 📝 Region whose bounds contain the world point; the active region wins where regions overlap.
    ResolveRegionAt(X, Z)
    {
        const Inside = Terrain => X >= Terrain.Min[0] && X <= Terrain.Min[0] + Terrain.Size[0] && Z >= Terrain.Min[1] && Z <= Terrain.Min[1] + Terrain.Size[1];
        const Active = this.RetrieveTerrain();
        if (Active && Inside(Active)) return Active;
        return this.Terrains.find(Inside) || null;
    }

    LocateSpline(SplineId)
    {
        for (const Layer of this.Layers)
        {
            if (Layer.Category !== "Spline") continue;
            const Spline = Layer.Splines.find(Candidate => Candidate.Id === SplineId);
            if (Spline) return { Layer, Spline };
        }
        return null;
    }

    // 📝 Marks a layer changed; Geometry = true also invalidates cached shape distance fields / spline sample atlases.
    TouchLayer(Layer, Geometry = false)
    {
        Layer.Revision++;
        if (Geometry) Layer.GeometryRevision++;
        this.Revision++;
    }

    TouchTerrain(Terrain)
    {
        Terrain.Revision++;
        this.Revision++;
    }

    TouchSettings(AffectsEvaluation = true)
    {
        if (AffectsEvaluation) this.SettingsRevision++;
        this.Revision++;
    }

    //--------------------------------------------------------------------------------------------------------------------
    //                                                SERIALIZATION
    //--------------------------------------------------------------------------------------------------------------------

    Encode()
    {
        return JSON.stringify({ Format: "FrontierTerrainAuthoring", Version: 2, Settings: this.Settings, Terrains: this.Terrains, Unassigned: this.Unassigned, ActiveTerrain: this.ActiveTerrain });
    }

    // 📝 Restores authored content in place; revisions are bumped (never reset) so every GPU cache invalidates.
    //    Version 1 (one world-wide stack) migrates each layer to the first region it overlaps, else the active region
    //    for layers without geometry, else the unassigned stack.
    Decode(Text)
    {
        const Archive = JSON.parse(Text);
        if (Archive.Format !== "FrontierTerrainAuthoring") throw new Error("Not a Frontier terrain authoring document.");
        const Bump = this.Revision + 1000;
        const Refresh = Layer => ({ ...Layer, Revision: (Layer.Revision || 1) + Bump, GeometryRevision: (Layer.GeometryRevision || 1) + Bump });
        this.Settings = { ...this.Settings, ...Archive.Settings };
        this.Terrains = Archive.Terrains.map(Terrain => ({ ...Terrain, Revision: (Terrain.Revision || 1) + Bump, Layers: (Terrain.Layers || []).map(Refresh) }));
        this.Unassigned = (Archive.Unassigned || []).map(Refresh);
        this.ActiveTerrain = Archive.ActiveTerrain || (this.Terrains[0] && this.Terrains[0].Id) || null;
        if (!Archive.Version || Archive.Version < 2)
        {
            for (const Layer of (Archive.Layers || []).map(Refresh))
            {
                const B = ComputeLayerBounds(Layer);
                const Owner = B ? this.Terrains.find(Terrain => !(B[2] < Terrain.Min[0] || B[3] < Terrain.Min[1] || B[0] > Terrain.Min[0] + Terrain.Size[0] || B[1] > Terrain.Min[1] + Terrain.Size[1]))
                                : this.RetrieveTerrain();
                (Owner ? Owner.Layers : this.Unassigned).push(Layer);
            }
        }
        this.Revision += Bump;
        this.SettingsRevision += Bump;
    }
}

// 📝 World-space bounds [minX, minZ, maxX, maxZ] of a layer's authored geometry; null when it has none (sculpt
//    rasters, empty layers).
export function ComputeLayerBounds(Layer)
{
    const Points = [];
    if (Layer.Category === "Shape") Layer.Strokes.forEach(Stroke => Stroke.Points.forEach(Point => Points.push(Point)));
    else if (Layer.Category === "Spline") Layer.Splines.forEach(Spline => Spline.Points.forEach(Point => Points.push([Point.X, Point.Z])));
    if (!Points.length) return null;
    return Points.reduce((B, P) => [Math.min(B[0], P[0]), Math.min(B[1], P[1]), Math.max(B[2], P[0]), Math.max(B[3], P[1])], [Infinity, Infinity, -Infinity, -Infinity]);
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    EDIT HISTORY
//------------------------------------------------------------------------------------------------------------------------

// 📝 Vector edits store whole-document snapshots (kilobytes). Sculpt edits store GPU texture regions supplied by the
//    sculpt store through Revert/Reapply closures, so undo never reads raster data back to the CPU.
export class EditHistory
{
    constructor(Document, Capacity = 64)
    {
        this.Document = Document;
        this.Capacity = Capacity;
        this.Undo = [];
        this.Redo = [];
    }

    CaptureVector() { return this.Document.Encode(); }

    RegisterVectorEdit(Label, Before)
    {
        const After = this.Document.Encode();
        if (After === Before) return;
        this.Append({ Label, Category: "Vector", Before, After });
    }

    RegisterRasterEdit(Label, Revert, Reapply, Release)
    {
        this.Append({ Label, Category: "Raster", Revert, Reapply, Release });
    }

    Append(Entry)
    {
        this.Undo.push(Entry);
        this.Redo.forEach(Discarded => Discarded.Release && Discarded.Release());
        this.Redo = [];
        while (this.Undo.length > this.Capacity)
        {
            const Dropped = this.Undo.shift();
            if (Dropped.Release) Dropped.Release();
        }
    }

    StepBack()
    {
        const Entry = this.Undo.pop();
        if (!Entry) return null;
        if (Entry.Category === "Vector") this.Document.Decode(Entry.Before);
        else Entry.Revert();
        this.Redo.push(Entry);
        return Entry.Label;
    }

    StepForward()
    {
        const Entry = this.Redo.pop();
        if (!Entry) return null;
        if (Entry.Category === "Vector") this.Document.Decode(Entry.After);
        else Entry.Reapply();
        this.Undo.push(Entry);
        return Entry.Label;
    }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    EXAMPLE WORLD
//------------------------------------------------------------------------------------------------------------------------

// 📝 Deterministic coastline polygon: radial outline perturbed by summed sinusoids (no RNG dependence).
function GenerateCoastline(CentreX, CentreZ, Radius, Points, Phase)
{
    const Outline = [];
    for (let Index = 0; Index < Points; ++Index)
    {
        const θ = (Index / Points) * Math.PI * 2;
        const Wobble = 1 + 0.22 * Math.sin(θ * 3 + Phase) + 0.12 * Math.sin(θ * 7 + Phase * 2.3) + 0.05 * Math.sin(θ * 17 + Phase * 4.1);
        const Stretch = 1 + 0.35 * Math.cos(θ);
        Outline.push([CentreX + Math.cos(θ) * Radius * Wobble * Stretch, CentreZ + Math.sin(θ) * Radius * Wobble * 0.82]);
    }
    return Outline;
}

export function ConstructExampleWorld(Document)
{
    Document.CreateTerrain([-2300, -2000], [4600, 4000], 1024);
    const Landmass = Document.CreateShapeLayer("Landmass");
    Landmass.Strokes.push({ Points: GenerateCoastline(0, 0, 1650, 160, 0.7), Subtract: false });
    Landmass.Strokes.push({ Points: GenerateCoastline(1250, 1150, 380, 60, 2.1), Subtract: true });

    const Massif = Document.CreateShapeLayer("Highland massif");
    Massif.Parameters = { Operation: "Add", Elevation: 380, CoastWidth: 520, Relief: 230, ReliefScale: 620, Ridged: 0.85, CoastNoise: 0.8, Seed: 23 };
    Massif.Strokes.push({ Points: GenerateCoastline(-500, -420, 720, 90, 4.2), Subtract: false });

    const Canyons = Document.CreateSplineLayer("Canyon");
    Canyons.Splines.push({ Id: IssueToken("S"), Points: [
        { X: -1900, Z: 260, Width: 1, Lift: 0 }, { X: -1150, Z: 120, Width: 1.1, Lift: 0 }, { X: -620, Z: 420, Width: 0.8, Lift: 0 }, { X: -120, Z: 260, Width: 1, Lift: 0 }, { X: 380, Z: 520, Width: 1.2, Lift: 0 } ] });

    const Rivers = Document.CreateSplineLayer("River");
    Rivers.Splines.push({ Id: IssueToken("S"), Points: [
        { X: -260, Z: -1100, Width: 0.6, Lift: 0 }, { X: 180, Z: -620, Width: 0.8, Lift: 0 }, { X: 760, Z: -380, Width: 1, Lift: 0 }, { X: 1250, Z: 120, Width: 1.3, Lift: 0 }, { X: 2050, Z: 260, Width: 1.6, Lift: 0 } ] });

    const Roads = Document.CreateSplineLayer("Road");
    Roads.Splines.push({ Id: IssueToken("S"), Points: [
        { X: 1700, Z: 900, Width: 1, Lift: 0 }, { X: 1050, Z: 560, Width: 1, Lift: 0 }, { X: 600, Z: 120, Width: 1, Lift: 0 }, { X: 330, Z: -260, Width: 1, Lift: 0 }, { X: 70, Z: -380, Width: 1, Lift: 0 } ] });

    const Tunnels = Document.CreateSplineLayer("Tunnel");
    Tunnels.Splines.push({ Id: IssueToken("S"), Points: [
        { X: 70, Z: -380, Width: 1, Lift: 0 }, { X: -420, Z: -470, Width: 1, Lift: 0 }, { X: -1050, Z: -560, Width: 1, Lift: 0 } ] });

    Document.CreateSculptLayer("Sculpt");
    return Document;
}
