/*====================================================================================================================================
                                                        WORLDDOCUMENT.JS
====================================================================================================================================*/
// 🧩 Authored world document: planar shapes, terrain regions, landform profile and the ordered layer stack

//------------------------------------------------------------------------------------------------------------------------
//                                                    CONSTANTS
//------------------------------------------------------------------------------------------------------------------------

export const DocumentFormatVersion = 1;

export const ShapeCategories = ["Lasso", "Polygon", "Stroke"];
export const ShapeOperations = ["Union", "Subtract"];
export const LayerCategories = ["HeightSculpt", "VolumeSculpt", "Spline"];
export const SplineCategories = ["Road", "River", "Canyon", "Ridge", "Tunnel"];
export const ProfileModes = ["Follow", "Grade", "Manual"];
export const FalloffProfiles = ["Soft", "Linear", "Plateau", "Hard"];

// 📝 Category index order is shared with the GLSL spline operation switch — never reorder without the shader.
export const SplineCategoryIndex = { Road: 0, River: 1, Canyon: 2, Ridge: 3, Tunnel: 4 };

export const SplineCategoryProfiles = {
    Road:   { Width: 12, Falloff: 22,  Depth: 0,  Roughness: 0,  Smoothing: 160, Offset: 0.4, ProfileMode: "Follow", DescentEnabled: false, StrataInterval: 0,  Colour: "#d9c38a", Description: "Cut-and-fill corridor with embankment slopes" },
    River:  { Width: 18, Falloff: 34,  Depth: 5,  Roughness: 6,  Smoothing: 220, Offset: -1,  ProfileMode: "Follow", DescentEnabled: true,  StrataInterval: 0,  Colour: "#5aa7e8", Description: "Carved channel; bed descends monotonically downstream" },
    Canyon: { Width: 36, Falloff: 80,  Depth: 70, Roughness: 12, Smoothing: 320, Offset: 0,   ProfileMode: "Follow", DescentEnabled: true,  StrataInterval: 12, Colour: "#d0794f", Description: "Deep carve with steep stratified walls" },
    Ridge:  { Width: 40, Falloff: 160, Depth: 110, Roughness: 10, Smoothing: 260, Offset: 0,  ProfileMode: "Follow", DescentEnabled: false, StrataInterval: 0,  Colour: "#8fcf72", Description: "Raised crest blended into surrounding relief" },
    Tunnel: { Width: 14, Falloff: 0,   Depth: 11, Roughness: 0,  Smoothing: 0,   Offset: 0,   ProfileMode: "Grade",  DescentEnabled: false, StrataInterval: 0,  Colour: "#f0a24a", Description: "Volumetric bore (flat floor, arched roof) through solid terrain" },
};

export const HeightResolutionOptions = [512, 1024, 2048];
export const VolumeResolutionOptions = [128, 192, 256];

//------------------------------------------------------------------------------------------------------------------------
//                                                  TOKEN ISSUER
//------------------------------------------------------------------------------------------------------------------------

// 📝 Tokens are document-unique strings; the counter is persisted so reloaded documents never reissue a token.
export function IssueToken(Document, Prefix)
{
    Document.TokenCounter = (Document.TokenCounter ?? 0) + 1;
    return `${Prefix}${Document.TokenCounter.toString(36).toUpperCase()}`;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                  CONSTRUCTION
//------------------------------------------------------------------------------------------------------------------------

export function ConstructLandformProfile()
{
    return {
        SeaFloorHeight: -40,      // [m] - Elevation outside every landmass shape
        ShoreHeight: 2,           // [m] - Elevation at the coastline
        ShelfWidth: 140,          // [m] - Width of the submerged slope from shore to sea floor
        CoastFalloff: 280,        // [m] - Distance inland over which the landmass rises to full height
        FalloffProfile: "Soft",   // [-] - Soft | Linear | Plateau | Hard
        PlateauHeight: 24,        // [m] - Uniform inland elevation added by the rise
        ReliefAmplitude: 130,     // [m] - Peak height of procedural relief
        ReliefScale: 520,         // [m] - Wavelength of the largest relief feature
        RidgeBlend: 0.55,         // [0-1] - Blend from rolling fBm to ridged multifractal
        CoastNoiseAmplitude: 36,  // [m] - Coastline perturbation distance
        CoastNoiseScale: 170,     // [m] - Coastline perturbation wavelength
        Seed: 7,                  // [-] - Relief seed
    };
}

export function ConstructRegion(Document, MinimumX, MinimumZ, SizeX, SizeZ)
{
    const Count = Document.Regions.length + 1;
    return {
        Token: IssueToken(Document, "R"),
        Name: `Region ${String(Count).padStart(2, "0")}`,
        MinimumX, MinimumZ, SizeX, SizeZ,
        MinimumHeight: -60,      // [m] - Bottom of the simulation box
        MaximumHeight: 420,      // [m] - Top of the simulation box
        HeightResolution: 1024,  // [px] - Height texels along the longer side
        VolumeResolution: 192,   // [px] - Volume voxels along the longer side
        VisibilityEnabled: true,
    };
}

export function ConstructShape(Document, Category, Operation, Points, Width = 60)
{
    const Count = Document.Shapes.length + 1;
    return {
        Token: IssueToken(Document, "S"),
        Name: `${Category} ${String(Count).padStart(2, "0")}`,
        Category, Operation, Width,
        Points: Points.map((Point) => ({ X: Point.X, Z: Point.Z })),
        VisibilityEnabled: true,
    };
}

export function ConstructLayer(Document, Category, Name)
{
    const Prefix = { HeightSculpt: "Sculpt", VolumeSculpt: "Volume", Spline: "Splines" }[Category];
    const Count = Document.Layers.filter((Layer) => Layer.Category === Category).length + 1;
    return {
        Token: IssueToken(Document, "L"),
        Name: Name ?? `${Prefix} ${String(Count).padStart(2, "0")}`,
        Category,
        Opacity: 1,
        VisibilityEnabled: true,
        Splines: [],
    };
}

export function ConstructSpline(Document, Category, Points)
{
    const Profile = SplineCategoryProfiles[Category];
    const Count = Document.Layers.reduce((Total, Layer) => Total + Layer.Splines.filter((Spline) => Spline.Category === Category).length, 0) + 1;
    return {
        Token: IssueToken(Document, "C"),
        Name: `${Category} ${String(Count).padStart(2, "0")}`,
        Category,
        Points: Points.map((Point) => ({ X: Point.X, Z: Point.Z, Height: Point.Height ?? 0 })),
        Width: Profile.Width,
        Falloff: Profile.Falloff,
        Depth: Profile.Depth,
        Roughness: Profile.Roughness,
        Smoothing: Profile.Smoothing,
        Offset: Profile.Offset,
        ProfileMode: Profile.ProfileMode,
        DescentEnabled: Profile.DescentEnabled,
        StrataInterval: Profile.StrataInterval,
        VisibilityEnabled: true,
    };
}

// 📝 Organic closed outline: a radial contour perturbed by a few deterministic harmonics.
function ConstructRadialOutline(CentreX, CentreZ, Radius, Harmonics, SampleCount)
{
    const Outline = [];
    for (let SampleIndex = 0; SampleIndex < SampleCount; SampleIndex++)
    {
        const θ = (SampleIndex / SampleCount) * Math.PI * 2;
        let Scale = 1;
        for (const [Frequency, Amplitude, Phase] of Harmonics) Scale += Amplitude * Math.sin(θ * Frequency + Phase);
        Outline.push({ X: CentreX + Math.cos(θ) * Radius * Scale, Z: CentreZ + Math.sin(θ) * Radius * Scale });
    }
    return Outline;
}

// Example world so the studio opens on a working landform: island + bay, one region, sculpt/spline/volume layers.
export function ConstructExampleDocument()
{
    const Document = {
        FormatVersion: DocumentFormatVersion,
        TokenCounter: 0,
        Landform: ConstructLandformProfile(),
        Shapes: [],
        Regions: [],
        Layers: [],
        ActiveRegionToken: null,
    };
    Document.Shapes.push(ConstructShape(Document, "Lasso", "Union",
        ConstructRadialOutline(0, 0, 400, [[2, 0.12, 0.4], [3, 0.08, 1.9], [5, 0.05, 0.7], [9, 0.025, 2.2]], 96)));
    Document.Shapes[0].Name = "Main Island";
    Document.Shapes.push(ConstructShape(Document, "Lasso", "Subtract",
        ConstructRadialOutline(330, 230, 120, [[3, 0.15, 0.2], [6, 0.05, 1.0]], 40)));
    Document.Shapes[1].Name = "South-East Bay";
    Document.Shapes.push(ConstructShape(Document, "Stroke", "Union",
        [{ X: -380, Z: -300 }, { X: -480, Z: -420 }, { X: -600, Z: -470 }], 90));
    Document.Shapes[2].Name = "North-West Spit";

    const Region = ConstructRegion(Document, -512, -512, 1024, 1024);
    Region.Name = "Island Region";
    Document.Regions.push(Region);
    Document.ActiveRegionToken = Region.Token;

    const Landforms = ConstructLayer(Document, "Spline", "Landform Splines");
    const Range = ConstructSpline(Document, "Ridge", [{ X: -300, Z: 60 }, { X: -120, Z: -40 }, { X: 60, Z: -90 }, { X: 230, Z: -20 }]);
    Range.Name = "Spine Range";
    const Gorge = ConstructSpline(Document, "Canyon", [{ X: -260, Z: -260 }, { X: -170, Z: -170 }, { X: -60, Z: -200 }, { X: 40, Z: -330 }]);
    Gorge.Name = "North Gorge";
    Landforms.Splines.push(Range, Gorge);

    const Sculpt = ConstructLayer(Document, "HeightSculpt");

    const Routes = ConstructLayer(Document, "Spline", "Routes & Water");
    const River = ConstructSpline(Document, "River", [{ X: 40, Z: 40 }, { X: 70, Z: 140 }, { X: 10, Z: 240 }, { X: 60, Z: 360 }, { X: 90, Z: 460 }]);
    River.Name = "South River";
    const Road = ConstructSpline(Document, "Road", [{ X: -330, Z: 200 }, { X: -200, Z: 150 }, { X: -60, Z: 210 }, { X: 120, Z: 200 }, { X: 280, Z: 120 }]);
    Road.Name = "Coast Road";
    const Bore = ConstructSpline(Document, "Tunnel", [{ X: -150, Z: 170 }, { X: -100, Z: 40 }, { X: -40, Z: -140 }]);
    Bore.Name = "Spine Tunnel";
    Routes.Splines.push(River, Road, Bore);

    const Volume = ConstructLayer(Document, "VolumeSculpt");
    Document.Layers.push(Landforms, Sculpt, Routes, Volume);
    return Document;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    QUERIES
//------------------------------------------------------------------------------------------------------------------------

export function ResolveActiveRegion(Document)
{
    return Document.Regions.find((Region) => Region.Token === Document.ActiveRegionToken) ?? Document.Regions[0] ?? null;
}

export function ResolveSpline(Document, SplineToken)
{
    for (const Layer of Document.Layers)
    {
        const Spline = Layer.Splines.find((Candidate) => Candidate.Token === SplineToken);
        if (Spline) return { Layer, Spline };
    }
    return null;
}

export function ResolveLayer(Document, LayerToken)
{
    return Document.Layers.find((Layer) => Layer.Token === LayerToken) ?? null;
}

// 📝 Height texels are square: the longer region side receives HeightResolution texels.
export function EvaluateRegionLattice(Region)
{
    const LongerSide = Math.max(Region.SizeX, Region.SizeZ);
    const HeightTexel = LongerSide / Region.HeightResolution;
    const VolumeVoxel = LongerSide / Region.VolumeResolution;
    return {
        HeightTexel,
        HeightWidth: Math.max(8, Math.round(Region.SizeX / HeightTexel)),
        HeightDepth: Math.max(8, Math.round(Region.SizeZ / HeightTexel)),
        VolumeVoxel,
        VolumeWidth: Math.max(8, Math.round(Region.SizeX / VolumeVoxel)),
        VolumeDepth: Math.max(8, Math.round(Region.SizeZ / VolumeVoxel)),
        VolumeHeight: Math.max(8, Math.min(512, Math.round((Region.MaximumHeight - Region.MinimumHeight) / VolumeVoxel))),
    };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                 SERIALIZATION
//------------------------------------------------------------------------------------------------------------------------

export function EncodeDocument(Document)
{
    return JSON.stringify(Document);
}

// Decode and migrate a stored document; returns null when the text is not a terrain document.
export function DecodeDocument(Text)
{
    try
    {
        const Parsed = JSON.parse(Text);
        if (!Parsed || !Array.isArray(Parsed.Shapes) || !Array.isArray(Parsed.Layers) || !Array.isArray(Parsed.Regions)) return null;
        Parsed.Landform = { ...ConstructLandformProfile(), ...(Parsed.Landform ?? {}) };
        for (const Layer of Parsed.Layers) Layer.Splines = Layer.Splines ?? [];
        Parsed.FormatVersion = DocumentFormatVersion;
        return Parsed;
    }
    catch
    {
        return null;
    }
}
