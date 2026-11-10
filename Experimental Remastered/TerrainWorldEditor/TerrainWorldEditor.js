/*==========================================================================================================================================
                                                      TERRAINWORLDEDITOR.JS
==========================================================================================================================================*/
// Master Studio Controller for Frontier. Terrain Studio (Experimental Remastered — Stage 1):
// - Workspace 1 (2D Terrain): Infinite sparse-tile 2D masks, multi-mask boolean stack, and separate toggleable/editable Bounds Layers
// - Workspace 2 (3D Landscape): Multi-terrain ocean stage, composable procedural layer stack, Soft Noise vs Hard/None boundary falloff,
//                               simultaneous multi-terrain authoring, and space-efficient Thin Base Surface triangle meshing
// - Persistent IndexedDB world storage + Undo/Redo + .JSON / .OBJ / .STL export

import { WorldMask2D, TILE_WORLD_METERS, MASK_TILE_RES } from './Engine/WorldMask2D.js';
import {
    LAYER_TYPE_META,
    CreateTerrainLayer,
    MoveTerrainLayer,
    DuplicateTerrainLayer,
    SyncLayerAcrossSelectedRegions,
    IsHardBoundaryFalloff,
    EvaluateTerrainRegion,
    SeedThreeDemoTerrains,
    ExportWorldTerrainsObj,
    ExportWorldTerrainsBinaryStl
} from './Engine/TerrainLayerStack.js';
import { WorldMap2DCanvas } from './Engine/WorldMap2DCanvas.js';
import { TerrainOceanViewport } from './Engine/TerrainOceanViewport.js';
import {
    LoadWorldFromStorage,
    SaveWorldToStorage,
    ClearWorldStorage
} from './Engine/WorldStorage.js';
import {
    ConstructGlyph,
    MakeEl,
    MakePropertyGroup,
    MakeSliderPillRow,
    MakeSelectRow,
    MakeBoundaryFalloffGraph
} from './StudioControls.js';

const $ = Id => document.getElementById(Id);

/*==========================================================================================================================================
                                             STAGE-1 PROCEDURAL LANDFORM GENERATOR SHELF
==========================================================================================================================================*/
const QuickGenerators = [
    { type: 'multifractal', glyph: 'Mountain', title: 'Multifractal Mountains', sub: 'Hybrid altitude-damped peaks & valleys', featured: true },
    { type: 'fractal',      glyph: 'Layers',   title: 'Fractal Noise (fBm)',    sub: 'Domain-warped continental base relief' },
    { type: 'ridged',       glyph: 'Activity', title: 'Ridged Spine',           sub: 'Sharp tectonic & volcanic ridge crests' },
    { type: 'voronoi',      glyph: 'Boxes',    title: 'Voronoi / Cellular',     sub: 'Cracked basalt plateaus & block mesas' },
    { type: 'caldera',      glyph: 'Sparkles', title: 'Volcanic Caldera',       sub: 'Ring-cone rim with collapsed crater floor' },
    { type: 'escarpment',   glyph: 'Scan',     title: 'Fault Escarpment',       sub: 'Asymmetric tectonic fault cliff step' },
    { type: 'dunes',        glyph: 'Water',    title: 'Aeolian Dunes',          sub: 'Windward ramp & leeward slipface ripples' },
    { type: 'terrace',      glyph: 'Sliders',  title: 'Dipping Terrace Strata', sub: 'Stepped sedimentary benches & dip angle' },
    { type: 'billow',       glyph: 'Sun',      title: 'Billow Foothills',       sub: 'Soft rounded coastal & meadow hills' },
    { type: 'spline',       glyph: 'Spline',   title: 'Spline Landform',        sub: 'Curve-guided mountain ridge, road, or valley' }
];

const Tool2DDefs = [
    { id: 'brush',   glyph: 'Brush',   label: 'Paint 2D Terrain Mask (B)' },
    { id: 'erase',   glyph: 'Eraser',  label: 'Carve Sea / Bay / Inlet (E)' },
    { id: 'polygon', glyph: 'Polygon', label: 'Lasso / Polygon Silhouette (P)' },
    { id: 'stamp',   glyph: 'Stamp',   label: 'Stamp Landform Silhouette (M)' },
    { id: 'select',  glyph: 'Move',    label: 'Select / Multi-Select / Edit Bounds Layer (V)' },
    { id: 'bounds',  glyph: 'Scan',    label: 'Draw New Terrain Bounds Layer Box (R)' },
    { id: 'spline',  glyph: 'Spline',  label: 'Edit 2D Spline Landform Corridor (S)' }
];

const Tool3DDefs = [
    { id: 'navigate', glyph: 'Planet',    label: 'Orbit & Select Terrains (Shift: Multi-Select)' },
    { id: 'raise',    glyph: 'ArrowUp',   label: 'Raise 3D Relief Across Terrains' },
    { id: 'lower',    glyph: 'ArrowDown', label: 'Carve 3D Basin / Channel Across Terrains' },
    { id: 'smooth',   glyph: 'Water',     label: 'Smooth 3D Slope Transitions' },
    { id: 'flatten',  glyph: 'Columns',   label: 'Flatten 3D Terrace Grade' },
    { id: 'spline',   glyph: 'Spline',    label: 'Drag 3D Spline Control Knots (G)' }
];

const LayerGlyphForType = Type => LAYER_TYPE_META[Type]?.glyph || 'Mountain';

/*==========================================================================================================================================
                                                 STUDIO STATE & INITIALIZATION
==========================================================================================================================================*/
const World = new WorldMask2D();

const Studio = {
    workspace: 'split',     // '2d' | '3d' | 'split'
    inspectorTab: 'layers', // 'layers' | 'bounds' | 'slab' | 'stage'
    outlinerFilter: 'all',  // 'all' | 'terrains' | 'bounds' | 'masks'
    outlinerQuery: '',
    compactOutliner: false,
    maximizedStage: false,
    syncMultiLayerEdits: true,

    activeRegionId: null,
    selectedRegionIds: new Set(),
    activeLayerByRegion: new Map(),
    activeKnotIndex: 0,

    undoStack: [],
    redoStack: [],
    pendingSnapshot: null,
    rebuildTimer: 0,
    persistTimer: 0,
    fpsFrames: 0,
    fpsLastStamp: performance.now()
};

let Map2D = null;
let Viewport3D = null;

function EvaluateDirtyTerrains()
{
    const Rebuilt = [];
    const GpuPipe = Viewport3D?.gpuPipeline || null;
    for (const R of World.regions)
    {
        if (!R.enabled) continue;
        if (R.dirty || !R.runtime)
        {
            const PreviewId = Studio.activeLayerByRegion.get(R.id) || R.stack[0]?.id || null;
            EvaluateTerrainRegion(World, R, PreviewId, GpuPipe);
            R.meshDirty = true;
            Rebuilt.push(R);
        }
    }
    return Rebuilt;
}

async function BootWorld()
{
    const Saved = await LoadWorldFromStorage();
    let Restored = false;
    if (Saved && Array.isArray(Saved.regions) && Saved.regions.length > 0)
    {
        try
        {
            World.loadFromJSON(Saved);
            EvaluateDirtyTerrains();
            Restored = true;
            SetSaveBadge('Restored from IndexedDB');
        }
        catch (Err)
        {
            console.warn('[Frontier Terrain Studio] Saved world incompatible, seeding Stage-1 examples:', Err);
        }
    }

    if (!Restored)
    {
        SeedThreeDemoTerrains(World);
        SetSaveBadge('3 Example Masks Ready');
    }

    Studio.activeRegionId = World.regions[0]?.id || null;
    Studio.selectedRegionIds = new Set(Studio.activeRegionId ? [Studio.activeRegionId] : []);
    for (const R of World.regions)
    {
        if (R.stack.length > 0) Studio.activeLayerByRegion.set(R.id, R.stack[0].id);
    }
}

function SetSaveBadge(Text)
{
    const El = $('inspector-foot-right');
    if (El) El.textContent = Text;
}

function SchedulePersist()
{
    if (Studio.persistTimer) clearTimeout(Studio.persistTimer);
    Studio.persistTimer = setTimeout(async () =>
    {
        Studio.persistTimer = 0;
        const Ok = await SaveWorldToStorage(World.toJSON());
        if (Ok) SetSaveBadge('Auto-saved locally');
    }, 320);
}

function GetActiveRegion()
{
    return World.getRegion(Studio.activeRegionId) || World.regions[0] || null;
}

function GetSelectedRegions()
{
    const Out = [];
    for (const Id of Studio.selectedRegionIds)
    {
        const R = World.getRegion(Id);
        if (R) Out.push(R);
    }
    if (Out.length === 0)
    {
        const Active = GetActiveRegion();
        if (Active) Out.push(Active);
    }
    return Out;
}

function GetActiveLayer(Region = GetActiveRegion())
{
    if (!Region || Region.stack.length === 0) return null;
    const Wanted = Studio.activeLayerByRegion.get(Region.id);
    return Region.stack.find(L => L.id === Wanted) || Region.stack[0];
}

function GetActiveSplineLayer(Region = GetActiveRegion())
{
    if (!Region) return null;
    const Cur = GetActiveLayer(Region);
    if (Cur && Cur.type === 'spline') return Cur;
    return Region.stack.find(L => L.type === 'spline') || null;
}

function MarkAllRegionsDirty()
{
    for (const R of World.regions)
    {
        R.dirty = true;
        R.meshDirty = true;
    }
}

/*==========================================================================================================================================
                                                 UNDO / REDO HISTORY SNAPSHOTS
==========================================================================================================================================*/
function CaptureSnapshot()
{
    return JSON.stringify(World.toJSON());
}

function BeginUndoableAction()
{
    if (!Studio.pendingSnapshot) Studio.pendingSnapshot = CaptureSnapshot();
}

function CommitUndoableAction()
{
    if (!Studio.pendingSnapshot)
    {
        SchedulePersist();
        return;
    }
    const Current = CaptureSnapshot();
    if (Current !== Studio.pendingSnapshot)
    {
        Studio.undoStack.push(Studio.pendingSnapshot);
        if (Studio.undoStack.length > 28) Studio.undoStack.shift();
        Studio.redoStack.length = 0;
        SchedulePersist();
    }
    Studio.pendingSnapshot = null;
    SyncUndoButtons();
}

function RestoreSnapshot(JsonText)
{
    const Data = JSON.parse(JsonText);
    World.loadFromJSON(Data);
    EvaluateDirtyTerrains();

    if (!World.getRegion(Studio.activeRegionId))
    {
        Studio.activeRegionId = World.regions[0]?.id || null;
    }
    const ValidSel = Array.from(Studio.selectedRegionIds).filter(Id => World.getRegion(Id));
    Studio.selectedRegionIds = new Set(ValidSel.length ? ValidSel : (Studio.activeRegionId ? [Studio.activeRegionId] : []));

    for (const R of World.regions)
    {
        if (R.stack.length > 0 && !R.stack.some(L => L.id === Studio.activeLayerByRegion.get(R.id)))
        {
            Studio.activeLayerByRegion.set(R.id, R.stack[0].id);
        }
    }

    Map2D.activeMaskLayerId = World.maskLayers[0]?.id || null;
    Map2D.invalidateMaskCache();
    Map2D.invalidateRegionPreview();
    Viewport3D.markRegionMeshDirty();
    SyncSelectionToEngines();
    SyncBoundsButtonUI();
    SyncOceanButtonUI();
    RefreshAllUI();
    SchedulePersist();
}

function PerformUndo()
{
    if (Studio.undoStack.length === 0) return;
    Studio.redoStack.push(CaptureSnapshot());
    RestoreSnapshot(Studio.undoStack.pop());
    SyncUndoButtons();
}

function PerformRedo()
{
    if (Studio.redoStack.length === 0) return;
    Studio.undoStack.push(CaptureSnapshot());
    RestoreSnapshot(Studio.redoStack.pop());
    SyncUndoButtons();
}

function SyncUndoButtons()
{
    $('undo-btn').disabled = Studio.undoStack.length === 0;
    $('redo-btn').disabled = Studio.redoStack.length === 0;
    $('stroke-counter').textContent = `${World.regions.length} MASKS`;
}

/*==========================================================================================================================================
                                             REBUILD & SYNCHRONIZATION PIPELINE
==========================================================================================================================================*/
function ScheduleDirtyRebuild(Immediate = false)
{
    const Run = () =>
    {
        Studio.rebuildTimer = 0;
        const Rebuilt = EvaluateDirtyTerrains();
        for (const R of Rebuilt)
        {
            Map2D?.invalidateRegionPreview(R.id);
            Viewport3D?.markRegionMeshDirty(R.id);
        }
        Map2D?.requestRedraw();
        if (Viewport3D && Studio.workspace !== '2d')
        {
            const Active = GetActiveRegion();
            const PreviewId = Active ? (Studio.activeLayerByRegion.get(Active.id) || null) : null;
            Viewport3D.render(PreviewId);
        }
        UpdateTelemetryBar();
    };

    if (Immediate)
    {
        if (Studio.rebuildTimer) { clearTimeout(Studio.rebuildTimer); Studio.rebuildTimer = 0; }
        Run();
        return;
    }
    if (Studio.rebuildTimer) return;
    Studio.rebuildTimer = setTimeout(Run, 22);
}

function SyncSelectionToEngines()
{
    const Active = GetActiveRegion();
    const Spline = GetActiveSplineLayer(Active);

    if (Map2D)
    {
        Map2D.activeRegionId = Studio.activeRegionId;
        Map2D.selectedRegionIds = new Set(Studio.selectedRegionIds);
        Map2D.activeSplineLayerId = Spline?.id || null;
        if (!World.getMaskLayer(Map2D.activeMaskLayerId))
        {
            const Linked = Active?.maskLayerId ? World.getMaskLayer(Active.maskLayerId) : null;
            Map2D.activeMaskLayerId = (Linked || World.maskLayers[0])?.id || null;
        }
        Map2D.requestRedraw();
    }

    if (Viewport3D)
    {
        Viewport3D.activeRegionId = Studio.activeRegionId;
        Viewport3D.selectedRegionIds = new Set(Studio.selectedRegionIds);
        Viewport3D.activeSplineLayerId = Spline?.id || null;
        Viewport3D.selectedKnotIndex = Studio.activeKnotIndex;
    }
}

function SelectRegion(RegionId, ToggleMulti = false, FrameCamera = false)
{
    if (!World.getRegion(RegionId)) return;
    if (ToggleMulti)
    {
        if (Studio.selectedRegionIds.has(RegionId) && Studio.selectedRegionIds.size > 1)
        {
            Studio.selectedRegionIds.delete(RegionId);
            if (Studio.activeRegionId === RegionId)
            {
                Studio.activeRegionId = Array.from(Studio.selectedRegionIds)[0];
            }
        }
        else
        {
            Studio.selectedRegionIds.add(RegionId);
            Studio.activeRegionId = RegionId;
        }
    }
    else
    {
        Studio.selectedRegionIds = new Set([RegionId]);
        Studio.activeRegionId = RegionId;
    }

    const Region = GetActiveRegion();
    if (Region?.maskLayerId && World.getMaskLayer(Region.maskLayerId))
    {
        Map2D.activeMaskLayerId = Region.maskLayerId;
    }
    Studio.activeKnotIndex = 0;
    SyncSelectionToEngines();
    RefreshAllUI();

    if (FrameCamera && Region)
    {
        Map2D.frameBounds(Region.bounds);
        Viewport3D.frameRegion(Region);
    }
}

function SelectAllTerrains()
{
    if (World.regions.length === 0) return;
    Studio.selectedRegionIds = new Set(World.regions.map(R => R.id));
    if (!Studio.activeRegionId || !Studio.selectedRegionIds.has(Studio.activeRegionId))
    {
        Studio.activeRegionId = World.regions[0].id;
    }
    SyncSelectionToEngines();
    RefreshAllUI();
}

function SyncBoundsButtonUI()
{
    const Btn = $('toggle-bounds-btn');
    if (!Btn) return;
    Btn.classList.toggle('active', World.boundsLayerVisible);
    Btn.textContent = World.boundsLayerVisible ? 'Bounds ON' : 'Bounds OFF';
    if (Viewport3D) Viewport3D.showBounds3D = World.boundsLayerVisible;
    Map2D?.requestRedraw();
}

function SyncOceanButtonUI()
{
    const Btn = $('toggle-ocean-btn');
    if (!Btn) return;
    Btn.classList.toggle('active', World.oceanVisible !== false);
    Btn.textContent = World.oceanVisible !== false ? 'Ocean ON' : 'Ocean OFF';
}

/*==========================================================================================================================================
                                       HYDRATE HEADER GLYPHS, TOOL RAILS & QUICK SHELF
==========================================================================================================================================*/
function MountStaticGlyphsAndRails()
{
    $('undo-btn').appendChild(ConstructGlyph('Reset'));
    $('redo-btn').appendChild(ConstructGlyph('Redo'));
    $('compact-outliner').appendChild(ConstructGlyph('Layers'));
    $('add-button').appendChild(ConstructGlyph('Plus'));
    $('stat-active-icon').appendChild(ConstructGlyph('Mountain'));
    $('stat-layers-icon').appendChild(ConstructGlyph('Layers'));
    $('search-icon-slot').appendChild(ConstructGlyph('Search'));
    $('viewport-title-icon').appendChild(ConstructGlyph('Planet'));
    $('toggle-gizmo-btn').appendChild(ConstructGlyph('Gizmo'));
    $('toggle-contours-btn').appendChild(ConstructGlyph('Activity'));
    $('focus-btn').appendChild(ConstructGlyph('Focus'));
    $('maximize-btn').appendChild(ConstructGlyph('Maximize'));
    $('object-symbol').appendChild(ConstructGlyph('Mountain'));

    // 2D Tool Rail
    const Rail2D = $('Tools2DRail');
    for (const T of Tool2DDefs)
    {
        const Btn = MakeEl('button', 'tool-button' + (T.id === 'brush' ? ' active' : ''), ConstructGlyph(T.glyph));
        Btn.type = 'button';
        Btn.dataset.tool2d = T.id;
        Btn.title = T.label;
        Btn.setAttribute('aria-label', T.label);
        Btn.addEventListener('click', () => Set2DTool(T.id));
        Rail2D.appendChild(Btn);
    }

    // 3D Tool Rail
    const Rail3D = $('Tools3DRail');
    for (const T of Tool3DDefs)
    {
        const Btn = MakeEl('button', 'tool-button' + (T.id === 'navigate' ? ' active' : ''), ConstructGlyph(T.glyph));
        Btn.type = 'button';
        Btn.dataset.tool3d = T.id;
        Btn.title = T.label;
        Btn.setAttribute('aria-label', T.label);
        Btn.addEventListener('click', () => Set3DTool(T.id));
        Rail3D.appendChild(Btn);
    }

    // Procedural Landform Generator Quick-Add Shelf
    const Shelf = $('quick-add-list');
    $('quick-gen-count').textContent = String(QuickGenerators.length);
    for (const Gen of QuickGenerators)
    {
        const Card = MakeEl('button', 'quick-add-card' + (Gen.featured ? ' featured-gen' : ''), [
            MakeEl('span', 'quick-add-icon', ConstructGlyph(Gen.glyph)),
            MakeEl('span', 'quick-add-copy', [
                MakeEl('strong', '', Gen.title),
                MakeEl('small', '', Gen.sub)
            ])
        ]);
        Card.type = 'button';
        Card.addEventListener('click', () => AddLayerToTargetRegions(Gen.type));
        Shelf.appendChild(Card);
    }

    // Lower Demonstration Strip (3 Example Terrain Masks + Multi-Terrain & Thin Base Workflows)
    const Strip = $('preset-strip');
    const Presets = [
        {
            label: 'All 3 Example Terrains',
            action: () =>
            {
                $('scope-select').value = 'all';
                Viewport3D.viewScope = 'all';
                Map2D.frameAllRegions();
                Viewport3D.frameVisibleWorld();
                RefreshAllUI();
            }
        },
        {
            label: '1 · Alpine Peninsula (Soft Noise Falloff)',
            action: () => { if (World.regions[0]) SelectRegion(World.regions[0].id, false, true); }
        },
        {
            label: '2 · Basalt Headland (Hard / No Falloff)',
            action: () => { if (World.regions[1]) SelectRegion(World.regions[1].id, false, true); }
        },
        {
            label: '3 · Caldera Archipelago (Mixed Stack)',
            action: () => { if (World.regions[2]) SelectRegion(World.regions[2].id, false, true); }
        },
        {
            label: 'Select All 3 (Simultaneous Edit)',
            action: () =>
            {
                SelectAllTerrains();
                Map2D.frameAllRegions();
                Viewport3D.frameVisibleWorld();
            }
        },
        {
            label: 'Inspect Thin Base Surface (Ocean OFF)',
            action: () =>
            {
                World.oceanVisible = false;
                SyncOceanButtonUI();
                Studio.inspectorTab = 'slab';
                SyncInspectorTabButtons();
                RenderInspector();
            }
        },
        {
            label: 'Export Binary .STL',
            action: () => TriggerExportStl()
        }
    ];
    for (const P of Presets)
    {
        const Chip = MakeEl('button', 'history-chip', P.label);
        Chip.type = 'button';
        Chip.addEventListener('click', P.action);
        Strip.appendChild(Chip);
    }
}

function Set2DTool(ToolId)
{
    Map2D.tool = ToolId;
    Map2D.requestRedraw();
    document.querySelectorAll('[data-tool2d]').forEach(B => B.classList.toggle('active', B.dataset.tool2d === ToolId));
    const Def = Tool2DDefs.find(T => T.id === ToolId);
    $('hud-2d-tool').textContent = Def ? Def.label.replace(/\s*\(.+\)$/, '') : ToolId;

    if (ToolId === 'spline')
    {
        const Region = GetActiveRegion();
        if (Region && !GetActiveSplineLayer(Region))
        {
            AddLayerToTargetRegions('spline');
        }
        SyncSelectionToEngines();
    }
}

function Set3DTool(ToolId)
{
    Viewport3D.tool3D = ToolId;
    if (ToolId === 'spline') Viewport3D.showGizmo = true;
    $('toggle-gizmo-btn').classList.toggle('active', Viewport3D.showGizmo);
    document.querySelectorAll('[data-tool3d]').forEach(B => B.classList.toggle('active', B.dataset.tool3d === ToolId));
    const Def = Tool3DDefs.find(T => T.id === ToolId);
    $('hud-3d-tool').textContent = Def ? Def.label.replace(/\s*\(.+\)$/, '') : ToolId;

    if (ToolId === 'spline')
    {
        const Region = GetActiveRegion();
        if (Region && !GetActiveSplineLayer(Region))
        {
            AddLayerToTargetRegions('spline');
        }
        SyncSelectionToEngines();
    }
}

function SetWorkspaceMode(Mode)
{
    Studio.workspace = Mode;
    const Grid = $('StageGrid');
    Grid.classList.remove('mode-2d', 'mode-3d', 'mode-split');
    Grid.classList.add(`mode-${Mode}`);
    document.querySelectorAll('.top-nav [data-ws]').forEach(B => B.classList.toggle('active', B.dataset.ws === Mode));
    requestAnimationFrame(() => Map2D?.requestRedraw());
}

function SyncInspectorTabButtons()
{
    document.querySelectorAll('#inspector-tabs [data-itab]').forEach(B =>
    {
        B.classList.toggle('active', B.dataset.itab === Studio.inspectorTab);
    });
}

/*==========================================================================================================================================
                                                 REGION & LAYER MUTATION HELPERS
==========================================================================================================================================*/
function AddLayerToTargetRegions(Type)
{
    const Targets = (Studio.selectedRegionIds.size > 1 && Studio.syncMultiLayerEdits)
        ? GetSelectedRegions()
        : [GetActiveRegion()].filter(Boolean);
    if (Targets.length === 0) return;

    BeginUndoableAction();
    for (const Region of Targets)
    {
        let Layer;
        if (Type === 'spline')
        {
            const Cx = Region.bounds.x + Region.bounds.width * 0.5;
            const Cz = Region.bounds.z + Region.bounds.depth * 0.5;
            const Span = Math.min(Region.bounds.width, Region.bounds.depth) * 0.30;
            Layer = CreateTerrainLayer('spline', {
                splineMode: 'ridge',
                width: 95.0,
                amount: 65.0,
                points: [
                    [Math.round(Cx - Span), Math.round(Cz - Span * 0.45), 95],
                    [Math.round(Cx), Math.round(Cz + Span * 0.16), 135],
                    [Math.round(Cx + Span), Math.round(Cz - Span * 0.25), 80]
                ]
            });
        }
        else
        {
            Layer = CreateTerrainLayer(Type);
        }
        Region.stack.push(Layer);
        Region.dirty = true;
        Region.meshDirty = true;
        Studio.activeLayerByRegion.set(Region.id, Layer.id);
    }

    CommitUndoableAction();
    Studio.inspectorTab = 'layers';
    SyncInspectorTabButtons();
    ScheduleDirtyRebuild(true);
    SyncSelectionToEngines();
    RefreshAllUI();
}

function SpawnNewTerrainRegion(CustomBounds = null)
{
    BeginUndoableAction();
    const Index = World.regions.length;
    const Bounds = CustomBounds || {
        x: Math.round(-750 + (Index % 3) * 1450),
        z: Math.round(1350 + Math.floor(Index / 3) * 1450),
        width: 1400,
        depth: 1300
    };

    const MaskLayer = World.addMaskLayer({
        name: `Terrain Mask ${String(Index + 1).padStart(2, '0')} · Landform`,
        blendMode: 'union'
    });
    const Base = CreateTerrainLayer('multifractal', {
        amplitude: 175.0,
        scale: 2.2,
        octaves: 6,
        falloff: { mode: 'soft', distance: 340.0, edgeFloor: 0.0, noiseAmount: 0.24, noiseScale: 1.0 }
    });

    const Region = World.addTerrainRegion({
        bounds: Bounds,
        resolution: 148,
        maskLayerId: MaskLayer.id,
        boundsLayer: {
            visible: true,
            locked: false,
            autoSyncMask: true,
            paddingMeters: 110.0,
            ...Bounds
        },
        stack: [Base]
    });

    const Cx = Bounds.x + Bounds.width * 0.5;
    const Cz = Bounds.z + Bounds.depth * 0.5;
    const Rad = Math.min(Bounds.width, Bounds.depth) * 0.34;
    World.paintStampMeters(MaskLayer, [Cx, Cz], Rad, 'island', false, 0.30, 5100 + Index * 197);

    Studio.activeLayerByRegion.set(Region.id, Base.id);
    Map2D.activeMaskLayerId = MaskLayer.id;
    Map2D.invalidateMaskCache();

    CommitUndoableAction();
    ScheduleDirtyRebuild(true);
    SelectRegion(Region.id, false, true);
}

/*==========================================================================================================================================
                                           RENDER TOP TRAPEZOIDAL TERRAIN TABS
==========================================================================================================================================*/
function RenderRegionTabs()
{
    const Host = $('region-tabs');
    Host.innerHTML = '';
    const Multi = Studio.selectedRegionIds.size > 1;

    for (const Region of World.regions)
    {
        const IsActive = Region.id === Studio.activeRegionId;
        const IsMulti = Multi && Studio.selectedRegionIds.has(Region.id);
        const Tab = MakeEl('button', 'document-tab' + (IsActive ? ' active' : '') + (IsMulti ? ' multi-selected' : ''));
        Tab.type = 'button';
        Tab.title = 'Click to focus Terrain · Shift+Click to multi-select simultaneously';

        const Dot = MakeEl('span', 'tab-dot');
        Dot.style.background = Region.color;
        const Label = MakeEl('span', '', Region.name.replace(/^Terrain\s+\d+\s*·\s*/i, ''));

        Tab.append(Dot, Label);
        if (World.regions.length > 1)
        {
            const Close = MakeEl('span', 'tab-close', '×');
            Close.title = 'Delete Terrain Region';
            Close.addEventListener('click', E =>
            {
                E.stopPropagation();
                BeginUndoableAction();
                World.removeRegion(Region.id);
                Studio.selectedRegionIds.delete(Region.id);
                if (Studio.activeRegionId === Region.id)
                {
                    Studio.activeRegionId = World.regions[0]?.id || null;
                    if (Studio.activeRegionId) Studio.selectedRegionIds.add(Studio.activeRegionId);
                }
                CommitUndoableAction();
                SyncSelectionToEngines();
                RefreshAllUI();
            });
            Tab.appendChild(Close);
        }

        Tab.addEventListener('click', E => SelectRegion(Region.id, E.shiftKey || E.ctrlKey || E.metaKey, !(E.shiftKey || E.ctrlKey || E.metaKey)));
        Host.appendChild(Tab);
    }
}

/*==========================================================================================================================================
                                    RENDER LEFT OUTLINER (TERRAINS + LAYER STACK + BOUNDS + MASKS)
==========================================================================================================================================*/
function RenderOutliner()
{
    const Host = $('OutlinerContent');
    Host.innerHTML = '';
    Host.classList.toggle('compact', Studio.compactOutliner);

    const Query = Studio.outlinerQuery.trim().toLowerCase();
    let EnabledCount = 0;
    let LayerTotal = 0;
    for (const R of World.regions)
    {
        if (R.enabled) EnabledCount++;
        LayerTotal += R.stack.length;
    }

    $('stat-terrains-on').textContent = String(EnabledCount);
    $('stat-layers-total').textContent = String(LayerTotal);
    const TotalTiles = World.totalAllocatedTiles();
    $('outliner-subtitle').textContent = `${World.regions.length} Terrains · ${TotalTiles} Sparse Tiles`;

    const MultiCount = Studio.selectedRegionIds.size;

    // 1. TERRAIN REGIONS + UNIFIED STACK (Procedural Layers + Separate Bounds Layer)
    if (Studio.outlinerFilter === 'all' || Studio.outlinerFilter === 'terrains' || Studio.outlinerFilter === 'bounds')
    {
        const Group = MakeEl('div', 'tree-group');
        const HeaderText = MultiCount > 1 ? `Terrain Regions (${MultiCount} Multi-Selected)` : 'Terrain Regions & Layer Stack';
        Group.appendChild(MakeEl('div', 'tree-group-header', [
            MakeEl('span', '', HeaderText),
            MakeEl('span', 'count', String(World.regions.length))
        ]));

        for (const Region of World.regions)
        {
            const MatchesRegion = !Query || Region.name.toLowerCase().includes(Query);
            const MatchingLayers = Region.stack.filter(L => !Query || L.name.toLowerCase().includes(Query) || L.type.includes(Query));
            if (!MatchesRegion && MatchingLayers.length === 0) continue;

            const IsSelected = Region.id === Studio.activeRegionId;
            const IsMulti = MultiCount > 1 && Studio.selectedRegionIds.has(Region.id);
            const Row = MakeEl('div', 'tree-row' + (IsSelected ? ' selected' : '') + (IsMulti ? ' multi-selected' : ''));

            const Sym = MakeEl('span', 'row-symbol op-union', ConstructGlyph('Mountain'));
            Sym.style.color = Region.color;
            const KmW = (Region.bounds.width / 1000).toFixed(1);
            const KmD = (Region.bounds.depth / 1000).toFixed(1);
            const Copy = MakeEl('span', 'row-copy', [
                MakeEl('strong', '', Region.name),
                MakeEl('small', '', `${KmW}×${KmD} km · ${Region.stack.length} layers`)
            ]);

            const MainBtn = MakeEl('button', 'tree-main', [Sym, Copy]);
            MainBtn.type = 'button';
            MainBtn.title = 'Click to select · Shift+Click to multi-select simultaneously';
            MainBtn.addEventListener('click', E => SelectRegion(Region.id, E.shiftKey || E.ctrlKey || E.metaKey, false));
            MainBtn.addEventListener('dblclick', () => SelectRegion(Region.id, false, true));

            const BoundsVis = Region.boundsLayer?.visible !== false;
            const BoundsBtn = MakeEl('button', 'row-mini-btn' + (BoundsVis && World.boundsLayerVisible ? ' lock-on' : ''), ConstructGlyph('Scan'));
            BoundsBtn.type = 'button';
            BoundsBtn.title = 'Toggle this Terrain Bounds Layer ON/OFF';
            BoundsBtn.addEventListener('click', E =>
            {
                E.stopPropagation();
                Region.boundsLayer.visible = !Region.boundsLayer.visible;
                Map2D.requestRedraw();
                RenderOutliner();
                if (Studio.inspectorTab === 'bounds') RenderInspector();
            });

            const EyeBtn = MakeEl('button', 'row-mini-btn' + (Region.enabled ? ' eye-on' : ''), ConstructGlyph(Region.enabled ? 'Eye' : 'EyeOff'));
            EyeBtn.type = 'button';
            EyeBtn.title = Region.enabled ? 'Hide Terrain Region' : 'Show Terrain Region';
            EyeBtn.addEventListener('click', E =>
            {
                E.stopPropagation();
                Region.enabled = !Region.enabled;
                if (Region.enabled && !Region.runtime)
                {
                    Region.dirty = true;
                    ScheduleDirtyRebuild(true);
                }
                Map2D.requestRedraw();
                RefreshAllUI();
            });

            const DupBtn = MakeEl('button', 'row-mini-btn', ConstructGlyph('Copy'));
            DupBtn.type = 'button';
            DupBtn.title = 'Duplicate Terrain Region (offset +350m)';
            DupBtn.addEventListener('click', E =>
            {
                E.stopPropagation();
                BeginUndoableAction();
                const CopyReg = World.duplicateRegion(Region.id, 350, 350);
                Map2D.invalidateMaskCache();
                CommitUndoableAction();
                if (CopyReg)
                {
                    ScheduleDirtyRebuild(true);
                    SelectRegion(CopyReg.id, false, true);
                }
            });

            Row.append(MainBtn, MakeEl('div', 'row-end-actions', [BoundsBtn, EyeBtn, DupBtn]));
            Group.appendChild(Row);

            // Expand Active Region's Full Non-Destructive Stack (Procedural Layers + Separate Bounds Layer)
            if (IsSelected)
            {
                const ActiveLayer = GetActiveLayer(Region);

                if (Studio.outlinerFilter !== 'bounds')
                {
                    for (let Li = 0; Li < Region.stack.length; ++Li)
                    {
                        const Layer = Region.stack[Li];
                        if (Query && !Layer.name.toLowerCase().includes(Query) && !Layer.type.includes(Query)) continue;
                        const IsLayerSel = ActiveLayer && Layer.id === ActiveLayer.id;
                        const LRow = MakeEl('div', 'tree-row child-layer' + (IsLayerSel ? ' selected' : ''));

                        const LSym = MakeEl('span', 'row-symbol op-smooth', ConstructGlyph(LayerGlyphForType(Layer.type)));
                        const FallTag = IsHardBoundaryFalloff(Layer.falloff)
                            ? 'Hard Edge'
                            : `Soft ${Math.round(Layer.falloff?.distance || 0)}m`;
                        const LCopy = MakeEl('span', 'row-copy', [
                            MakeEl('strong', '', Layer.name),
                            MakeEl('small', '', `${Layer.combine} · ${FallTag}`)
                        ]);

                        const LMain = MakeEl('button', 'tree-main', [LSym, LCopy]);
                        LMain.type = 'button';
                        LMain.addEventListener('click', () =>
                        {
                            Studio.activeLayerByRegion.set(Region.id, Layer.id);
                            Studio.inspectorTab = 'layers';
                            SyncInspectorTabButtons();
                            if (Viewport3D.lensMode === 1 || Map2D.showFalloffIn2D)
                            {
                                Region.dirty = true;
                                ScheduleDirtyRebuild(true);
                            }
                            SyncSelectionToEngines();
                            RefreshAllUI();
                        });

                        const UpBtn = MakeEl('button', 'row-mini-btn', ConstructGlyph('ChevronUp'));
                        UpBtn.type = 'button';
                        UpBtn.title = 'Move Layer Up in Stack';
                        UpBtn.disabled = Li === 0;
                        UpBtn.addEventListener('click', E =>
                        {
                            E.stopPropagation();
                            BeginUndoableAction();
                            if (MoveTerrainLayer(Region, Layer.id, -1))
                            {
                                CommitUndoableAction();
                                ScheduleDirtyRebuild(true);
                                RenderOutliner();
                            }
                        });

                        const DownBtn = MakeEl('button', 'row-mini-btn', ConstructGlyph('ChevronDown'));
                        DownBtn.type = 'button';
                        DownBtn.title = 'Move Layer Down in Stack';
                        DownBtn.disabled = Li === Region.stack.length - 1;
                        DownBtn.addEventListener('click', E =>
                        {
                            E.stopPropagation();
                            BeginUndoableAction();
                            if (MoveTerrainLayer(Region, Layer.id, 1))
                            {
                                CommitUndoableAction();
                                ScheduleDirtyRebuild(true);
                                RenderOutliner();
                            }
                        });

                        const LEye = MakeEl('button', 'row-mini-btn' + (Layer.enabled ? ' eye-on' : ''), ConstructGlyph(Layer.enabled ? 'Eye' : 'EyeOff'));
                        LEye.type = 'button';
                        LEye.title = Layer.enabled ? 'Disable Layer' : 'Enable Layer';
                        LEye.addEventListener('click', E =>
                        {
                            E.stopPropagation();
                            BeginUndoableAction();
                            Layer.enabled = !Layer.enabled;
                            Region.dirty = true;
                            Region.meshDirty = true;
                            CommitUndoableAction();
                            ScheduleDirtyRebuild(true);
                            RefreshAllUI();
                        });

                        const LDel = MakeEl('button', 'row-mini-btn', ConstructGlyph('Trash'));
                        LDel.type = 'button';
                        LDel.title = 'Delete Layer';
                        LDel.addEventListener('click', E =>
                        {
                            E.stopPropagation();
                            BeginUndoableAction();
                            Region.stack = Region.stack.filter(X => X.id !== Layer.id);
                            Region.dirty = true;
                            Region.meshDirty = true;
                            CommitUndoableAction();
                            ScheduleDirtyRebuild(true);
                            SyncSelectionToEngines();
                            RefreshAllUI();
                        });

                        LRow.append(LMain, MakeEl('div', 'row-end-actions', [UpBtn, DownBtn, LEye, LDel]));
                        Group.appendChild(LRow);
                    }
                }

                // Separate Toggleable & Editable TERRAIN BOUNDS LAYER Row inside the Terrain's Layer Stack!
                const BVis = Region.boundsLayer?.visible !== false;
                const BLock = !!Region.boundsLayer?.locked;
                const BSync = Region.boundsLayer?.autoSyncMask ? 'Auto-Sync' : 'Manual Box';
                const BRow = MakeEl('div', 'tree-row child-layer bounds-layer-row' + (Studio.inspectorTab === 'bounds' ? ' selected' : ''));
                const BSym = MakeEl('span', 'row-symbol', ConstructGlyph('Scan'));
                BSym.style.color = '#e8c27a';
                const BCopy = MakeEl('span', 'row-copy', [
                    MakeEl('strong', '', 'Terrain Bounds Layer'),
                    MakeEl('small', '', `${Math.round(Region.bounds.width)}×${Math.round(Region.bounds.depth)} m · ${BSync}`)
                ]);
                const BMain = MakeEl('button', 'tree-main', [BSym, BCopy]);
                BMain.type = 'button';
                BMain.addEventListener('click', () =>
                {
                    Studio.inspectorTab = 'bounds';
                    SyncInspectorTabButtons();
                    Set2DTool('select');
                    RenderOutliner();
                    RenderInspector();
                });

                const BLockBtn = MakeEl('button', 'row-mini-btn' + (BLock ? ' lock-on' : ''), ConstructGlyph(BLock ? 'Lock' : 'Unlock'));
                BLockBtn.type = 'button';
                BLockBtn.title = BLock ? 'Unlock Terrain Bounds Layer' : 'Lock Terrain Bounds Layer';
                BLockBtn.addEventListener('click', E =>
                {
                    E.stopPropagation();
                    Region.boundsLayer.locked = !Region.boundsLayer.locked;
                    Map2D.requestRedraw();
                    RenderOutliner();
                    if (Studio.inspectorTab === 'bounds') RenderInspector();
                });

                const BEyeBtn = MakeEl('button', 'row-mini-btn' + (BVis && World.boundsLayerVisible ? ' eye-on' : ''), ConstructGlyph(BVis ? 'Eye' : 'EyeOff'));
                BEyeBtn.type = 'button';
                BEyeBtn.title = BVis ? 'Hide Terrain Bounds Layer' : 'Show Terrain Bounds Layer';
                BEyeBtn.addEventListener('click', E =>
                {
                    E.stopPropagation();
                    Region.boundsLayer.visible = !Region.boundsLayer.visible;
                    Map2D.requestRedraw();
                    RenderOutliner();
                    if (Studio.inspectorTab === 'bounds') RenderInspector();
                });

                BRow.append(BMain, MakeEl('div', 'row-end-actions', [BLockBtn, BEyeBtn]));
                Group.appendChild(BRow);
            }
        }
        Host.appendChild(Group);
    }

    // 2. INFINITE 2D MASK LAYER STACK (Boolean Union / Subtract / Intersect)
    if (Studio.outlinerFilter === 'all' || Studio.outlinerFilter === 'masks')
    {
        const MGroup = MakeEl('div', 'tree-group');
        MGroup.appendChild(MakeEl('div', 'tree-group-header', [
            MakeEl('span', '', 'Infinite 2D Mask Stack'),
            MakeEl('span', 'count', `${TotalTiles} tiles`)
        ]));

        for (const MLayer of World.maskLayers)
        {
            if (Query && !MLayer.name.toLowerCase().includes(Query)) continue;
            const IsActiveM = Map2D && Map2D.activeMaskLayerId === MLayer.id;
            const Row = MakeEl('div', 'tree-row mask-layer-row' + (IsActiveM ? ' selected' : ''));
            const OpClass = MLayer.blendMode === 'subtract' ? 'op-subtract' : (MLayer.blendMode === 'intersect' ? 'op-intersect' : 'op-union');
            const Sym = MakeEl('span', `row-symbol ${OpClass}`, ConstructGlyph('Map'));
            const Copy = MakeEl('span', 'row-copy', [
                MakeEl('strong', '', MLayer.name),
                MakeEl('small', '', `${MLayer.blendMode} · ${MLayer.tiles.size} sparse tiles`)
            ]);
            const Main = MakeEl('button', 'tree-main', [Sym, Copy]);
            Main.type = 'button';
            Main.addEventListener('click', () =>
            {
                Map2D.activeMaskLayerId = MLayer.id;
                Studio.inspectorTab = 'bounds';
                SyncInspectorTabButtons();
                Map2D.requestRedraw();
                RefreshAllUI();
            });

            const MLock = MakeEl('button', 'row-mini-btn' + (MLayer.locked ? ' lock-on' : ''), ConstructGlyph(MLayer.locked ? 'Lock' : 'Unlock'));
            MLock.type = 'button';
            MLock.title = MLayer.locked ? 'Unlock 2D Mask Layer' : 'Lock 2D Mask Layer';
            MLock.addEventListener('click', E =>
            {
                E.stopPropagation();
                MLayer.locked = !MLayer.locked;
                RenderOutliner();
                if (Studio.inspectorTab === 'bounds') RenderInspector();
            });

            const Eye = MakeEl('button', 'row-mini-btn' + (MLayer.visible ? ' eye-on' : ''), ConstructGlyph(MLayer.visible ? 'Eye' : 'EyeOff'));
            Eye.type = 'button';
            Eye.title = MLayer.visible ? 'Hide 2D Mask Layer' : 'Show 2D Mask Layer';
            Eye.addEventListener('click', E =>
            {
                E.stopPropagation();
                BeginUndoableAction();
                MLayer.visible = !MLayer.visible;
                MarkAllRegionsDirty();
                CommitUndoableAction();
                ScheduleDirtyRebuild(true);
                RefreshAllUI();
            });

            Row.append(Main, MakeEl('div', 'row-end-actions', [MLock, Eye]));
            MGroup.appendChild(Row);
        }
        Host.appendChild(MGroup);
    }
}

/*==========================================================================================================================================
                                           RENDER RIGHT CONTEXTUAL INSPECTOR
==========================================================================================================================================*/
function RenderInspector()
{
    const Host = $('InspectorContent');
    Host.innerHTML = '';

    const Region = GetActiveRegion();
    if (!Region)
    {
        Host.appendChild(MakeEl('p', 'property-hint', 'No terrain region selected. Click + New Terrain to begin.'));
        return;
    }

    const SelectedList = GetSelectedRegions();
    const IsMulti = SelectedList.length > 1;

    $('inspector-crumb').textContent = IsMulti
        ? `Inspector / ${SelectedList.length} Terrains Selected`
        : `Inspector / ${Region.name.split('·')[0].trim()}`;
    if (document.activeElement !== $('object-name')) $('object-name').value = Region.name;
    $('object-type').textContent = IsMulti
        ? `MULTI-EDIT (${SelectedList.length} TERRAINS) · ACTIVE: ${Region.resolution}²`
        : `THIN-BASE · ${Region.resolution}² GRID · ${Region.stack.length} LAYERS`;
    $('object-enabled').checked = Region.enabled;

    // KPI Trio (matching Experimental Remastered Sun + Fluid Inspector)
    const Rt = Region.runtime;
    const PeakM = Rt ? Math.round(Rt.maxHeight - World.seaLevel) : 0;
    const AreaKm2 = ((Region.bounds.width * Region.bounds.depth) / 1e6).toFixed(2);
    const LandPct = Rt ? Math.round((Rt.landCells / Math.max(1, Rt.nx * Rt.nz)) * 100) : 0;

    Host.appendChild(MakeEl('div', 'kpi-row', [
        MakeEl('div', 'kpi highlight', [
            MakeEl('span', 'kpi-label', 'Peak Relief'),
            MakeEl('strong', '', `+${PeakM} m`)
        ]),
        MakeEl('div', 'kpi', [
            MakeEl('span', 'kpi-label', 'Bounds Area'),
            MakeEl('strong', '', `${AreaKm2} km²`)
        ]),
        MakeEl('div', 'kpi', [
            MakeEl('span', 'kpi-label', 'Land Mask'),
            MakeEl('strong', '', `${LandPct}%`)
        ])
    ]));

    // MULTI-TERRAIN SIMULTANEOUS AUTHORING CARD (whenever 2+ terrains are selected!)
    if (IsMulti)
    {
        RenderMultiTerrainSimultaneousCard(Host, SelectedList);
    }

    if (Studio.inspectorTab === 'layers')
    {
        RenderLayersAndFalloffTab(Host, Region, SelectedList);
    }
    else if (Studio.inspectorTab === 'bounds')
    {
        RenderBoundsAndMaskTab(Host, Region);
    }
    else if (Studio.inspectorTab === 'slab')
    {
        RenderThinSlabTab(Host, Region, SelectedList);
    }
    else
    {
        RenderOceanAndExportTab(Host);
    }
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                     MULTI-TERRAIN SIMULTANEOUS EDITING BANNER & BATCH CONTROLS (2+ TERRAINS SELECTED)
------------------------------------------------------------------------------------------------------------------------------------------*/
function RenderMultiTerrainSimultaneousCard(Host, SelectedList)
{
    const Banner = MakeEl('div', 'multi-edit-banner');
    const Head = MakeEl('div', 'multi-edit-head', [
        MakeEl('strong', '', `${SelectedList.length} Terrains Selected Simultaneously`),
        MakeEl('span', 'multi-edit-tag', 'MULTI-TERRAIN')
    ]);
    Banner.appendChild(Head);

    const SyncRow = MakeEl('div', 'inline-toggle-row');
    SyncRow.appendChild(MakeEl('span', '', 'Sync Layer & Falloff Edits Across Selected'));
    const SyncChk = MakeEl('input');
    SyncChk.type = 'checkbox';
    SyncChk.checked = Studio.syncMultiLayerEdits;
    SyncChk.addEventListener('change', () => { Studio.syncMultiLayerEdits = SyncChk.checked; });
    SyncRow.appendChild(SyncChk);
    Banner.appendChild(SyncRow);

    const Active = GetActiveRegion();
    Banner.appendChild(MakeSliderPillRow('Batch Relief Scale', 0.25, 2.5, 0.05, Active?.reliefScale ?? 1.0, 2, '×',
        V =>
        {
            BeginUndoableAction();
            for (const R of SelectedList)
            {
                R.reliefScale = V;
                R.dirty = true;
                R.meshDirty = true;
            }
            ScheduleDirtyRebuild();
        },
        () => { CommitUndoableAction(); RenderInspector(); }, 1.0));

    const BtnRow = MakeEl('div', 'studio-btn-row');
    const FitAllBtn = MakeEl('button', 'button', 'Sync All Bounds');
    FitAllBtn.type = 'button';
    FitAllBtn.addEventListener('click', () =>
    {
        BeginUndoableAction();
        for (const R of SelectedList) World.syncRegionBoundsToMask(R);
        CommitUndoableAction();
        ScheduleDirtyRebuild(true);
        RefreshAllUI();
    });

    const SoloSingleBtn = MakeEl('button', 'button', 'Single Select');
    SoloSingleBtn.type = 'button';
    SoloSingleBtn.addEventListener('click', () =>
    {
        if (Active) SelectRegion(Active.id, false, false);
    });

    BtnRow.append(FitAllBtn, SoloSingleBtn);
    Banner.appendChild(BtnRow);
    Host.appendChild(Banner);
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                         TAB 1: UNIFIED COMPOSABLE LAYER STACK & BOUNDARY FALLOFF / INFLUENCE
------------------------------------------------------------------------------------------------------------------------------------------*/
function RenderLayersAndFalloffTab(Host, Region, SelectedList)
{
    const Layer = GetActiveLayer(Region);
    const SyncActive = SelectedList.length > 1 && Studio.syncMultiLayerEdits;

    const MarkDirtyAndSync = MutatedLayer =>
    {
        Region.dirty = true;
        Region.meshDirty = true;
        if (SyncActive && MutatedLayer)
        {
            SyncLayerAcrossSelectedRegions(SelectedList, Region.id, MutatedLayer);
        }
    };

    const StackCard = MakePropertyGroup('Terrain Layer Stack', 'Layers', `${Region.stack.length}`, true,
        'Stack procedural landform generators, spline corridors, and 3D sculpt layers non-destructively inside the 2D mask.');

    const LayerOptions = Region.stack.map((L, Idx) => [`${Idx + 1}. ${L.name}`, L.id]);
    if (LayerOptions.length > 0 && Layer)
    {
        StackCard.Body.appendChild(MakeSelectRow('Editing Layer', LayerOptions, Layer.id, Val =>
        {
            Studio.activeLayerByRegion.set(Region.id, Val);
            SyncSelectionToEngines();
            RefreshAllUI();
        }));
    }

    const AddRow = MakeEl('div', 'studio-btn-row');
    for (const [Label, Kind] of [['+ Multifractal', 'multifractal'], ['+ Caldera', 'caldera'], ['+ Dunes', 'dunes'], ['+ Spline', 'spline']])
    {
        const B = MakeEl('button', 'button', Label);
        B.type = 'button';
        B.addEventListener('click', () => AddLayerToTargetRegions(Kind));
        AddRow.appendChild(B);
    }
    StackCard.Body.appendChild(AddRow);

    if (Layer)
    {
        const OrderRow = MakeEl('div', 'studio-btn-row');
        const UpB = MakeEl('button', 'button', '↑ Move Up');
        UpB.type = 'button';
        UpB.addEventListener('click', () =>
        {
            BeginUndoableAction();
            if (MoveTerrainLayer(Region, Layer.id, -1))
            {
                CommitUndoableAction();
                ScheduleDirtyRebuild(true);
                RefreshAllUI();
            }
        });
        const DownB = MakeEl('button', 'button', '↓ Move Down');
        DownB.type = 'button';
        DownB.addEventListener('click', () =>
        {
            BeginUndoableAction();
            if (MoveTerrainLayer(Region, Layer.id, 1))
            {
                CommitUndoableAction();
                ScheduleDirtyRebuild(true);
                RefreshAllUI();
            }
        });
        const DupB = MakeEl('button', 'button', 'Duplicate');
        DupB.type = 'button';
        DupB.addEventListener('click', () =>
        {
            BeginUndoableAction();
            const Clone = DuplicateTerrainLayer(Region, Layer.id);
            if (Clone) Studio.activeLayerByRegion.set(Region.id, Clone.id);
            CommitUndoableAction();
            ScheduleDirtyRebuild(true);
            RefreshAllUI();
        });
        OrderRow.append(UpB, DownB, DupB);
        StackCard.Body.appendChild(OrderRow);
    }
    Host.appendChild(StackCard.Group);

    if (!Layer) return;

    // 1. Active Generator / Spline / Sculpt Parameters
    const ParamCard = MakePropertyGroup(Layer.name, LayerGlyphForType(Layer.type), Layer.type.toUpperCase(), true);

    ParamCard.Body.appendChild(MakeSelectRow('Combine Mode', [
        ['Add Relief (+)', 'add'],
        ['Subtract / Carve (-)', 'subtract'],
        ['Max Peak Envelope', 'max'],
        ['Min Basin Envelope', 'min'],
        ['Lerp / Blend Target', 'lerp'],
        ['Multiply Relief', 'multiply']
    ], Layer.combine, Val =>
    {
        BeginUndoableAction();
        Layer.combine = Val;
        MarkDirtyAndSync(Layer);
        CommitUndoableAction();
        ScheduleDirtyRebuild(true);
        RenderOutliner();
    }));

    ParamCard.Body.appendChild(MakeSliderPillRow('Layer Opacity', 0, 1, 0.01, Layer.opacity, 2, '×',
        V => { BeginUndoableAction(); Layer.opacity = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
        () => CommitUndoableAction(), 1.0));

    if (Layer.type !== 'spline' && Layer.type !== 'sculpt')
    {
        if (Layer.type === 'terrace')
        {
            ParamCard.Body.appendChild(MakeSliderPillRow('Strata Bed Count', 2, 28, 1, Layer.bedCount ?? 9, 0, '#',
                V => { BeginUndoableAction(); Layer.bedCount = Math.round(V); MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                () => CommitUndoableAction(), 9));
            ParamCard.Body.appendChild(MakeSliderPillRow('Step Sharpness', 0.05, 1.0, 0.02, Layer.strength ?? 0.76, 2, '×',
                V => { BeginUndoableAction(); Layer.strength = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                () => CommitUndoableAction(), 0.76));
            ParamCard.Body.appendChild(MakeSliderPillRow('Strata Dip Angle', -18, 18, 0.5, Layer.dipDeg ?? 4.0, 1, '°',
                V => { BeginUndoableAction(); Layer.dipDeg = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                () => CommitUndoableAction(), 4.0));
            ParamCard.Body.appendChild(MakeSliderPillRow('Strike Azimuth', 0, 360, 1, Layer.strikeDeg ?? 25.0, 0, '°',
                V => { BeginUndoableAction(); Layer.strikeDeg = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                () => CommitUndoableAction(), 25.0));
        }
        else if (Layer.type === 'caldera')
        {
            ParamCard.Body.appendChild(MakeSliderPillRow('Cone Rim Height', 20, 520, 2, Layer.amplitude ?? 190, 0, 'm',
                V => { BeginUndoableAction(); Layer.amplitude = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                () => CommitUndoableAction(), 190));
            ParamCard.Body.appendChild(MakeSliderPillRow('Caldera Radius', 0.25, 1.25, 0.02, Layer.radiusFrac ?? 0.76, 2, '×',
                V => { BeginUndoableAction(); Layer.radiusFrac = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                () => CommitUndoableAction(), 0.76));
            ParamCard.Body.appendChild(MakeSliderPillRow('Crater Depth', 0.05, 1.1, 0.02, Layer.craterDepth ?? 0.56, 2, '×',
                V => { BeginUndoableAction(); Layer.craterDepth = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                () => CommitUndoableAction(), 0.56));
            ParamCard.Body.appendChild(MakeSliderPillRow('Rim Sharpness', 0.1, 1.0, 0.02, Layer.rimSharpness ?? 0.65, 2, '×',
                V => { BeginUndoableAction(); Layer.rimSharpness = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                () => CommitUndoableAction(), 0.65));
        }
        else if (Layer.type === 'escarpment')
        {
            ParamCard.Body.appendChild(MakeSliderPillRow('Fault Throw', -380, 480, 2, Layer.amplitude ?? 130, 0, 'm',
                V => { BeginUndoableAction(); Layer.amplitude = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                () => CommitUndoableAction(), 130));
            ParamCard.Body.appendChild(MakeSliderPillRow('Strike Azimuth', 0, 360, 1, Layer.azimuth ?? 28, 0, '°',
                V => { BeginUndoableAction(); Layer.azimuth = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                () => CommitUndoableAction(), 28));
            ParamCard.Body.appendChild(MakeSliderPillRow('Scarp Sharpness', 0.1, 0.98, 0.02, Layer.sharpness ?? 0.78, 2, '×',
                V => { BeginUndoableAction(); Layer.sharpness = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                () => CommitUndoableAction(), 0.78));
            ParamCard.Body.appendChild(MakeSliderPillRow('Strike Meander', 0, 0.9, 0.02, Layer.warp ?? 0.34, 2, '×',
                V => { BeginUndoableAction(); Layer.warp = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                () => CommitUndoableAction(), 0.34));
        }
        else if (Layer.type === 'dunes')
        {
            ParamCard.Body.appendChild(MakeSliderPillRow('Dune Crest Height', 4, 180, 1, Layer.amplitude ?? 44, 0, 'm',
                V => { BeginUndoableAction(); Layer.amplitude = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                () => CommitUndoableAction(), 44));
            ParamCard.Body.appendChild(MakeSliderPillRow('Crest Density', 0.6, 12.0, 0.1, Layer.scale ?? 4.2, 1, '×',
                V => { BeginUndoableAction(); Layer.scale = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                () => CommitUndoableAction(), 4.2));
            ParamCard.Body.appendChild(MakeSliderPillRow('Wind Azimuth', 0, 360, 1, Layer.azimuth ?? 55, 0, '°',
                V => { BeginUndoableAction(); Layer.azimuth = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                () => CommitUndoableAction(), 55));
            ParamCard.Body.appendChild(MakeSliderPillRow('Slipface Sharpness', 0.1, 0.95, 0.02, Layer.asymmetry ?? 0.74, 2, '×',
                V => { BeginUndoableAction(); Layer.asymmetry = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                () => CommitUndoableAction(), 0.74));
        }
        else
        {
            ParamCard.Body.appendChild(MakeSliderPillRow('Relief Amplitude', -380, 620, 2, Layer.amplitude ?? 180, 0, 'm',
                V => { BeginUndoableAction(); Layer.amplitude = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                () => CommitUndoableAction(), 180));
            ParamCard.Body.appendChild(MakeSliderPillRow('Feature Frequency', 0.4, 10.0, 0.1, Layer.scale ?? 2.4, 1, '×',
                V => { BeginUndoableAction(); Layer.scale = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                () => CommitUndoableAction(), 2.4));
            if (Layer.octaves !== undefined)
            {
                ParamCard.Body.appendChild(MakeSliderPillRow('Octaves', 1, 8, 1, Layer.octaves ?? 6, 0, '#',
                    V => { BeginUndoableAction(); Layer.octaves = Math.round(V); MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                    () => CommitUndoableAction(), 6));
            }
            ParamCard.Body.appendChild(MakeSliderPillRow('Domain Warp', 0, 1.3, 0.02, Layer.warp ?? 0.32, 2, '×',
                V => { BeginUndoableAction(); Layer.warp = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                () => CommitUndoableAction(), 0.32));
            ParamCard.Body.appendChild(MakeSliderPillRow('Random Seed', 1, 9999, 1, Layer.seed ?? 4029, 0, '#',
                V => { BeginUndoableAction(); Layer.seed = Math.round(V); MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
                () => CommitUndoableAction(), 4029));
        }
    }
    else if (Layer.type === 'spline')
    {
        RenderSplineControlsInto(ParamCard.Body, Region, Layer);
    }
    else if (Layer.type === 'sculpt')
    {
        ParamCard.Body.appendChild(MakeEl('p', 'property-hint',
            '3D Sculpt Relief Layer: choose Raise, Lower, Smooth, or Flatten in the 3D Landscape tool rail and brush directly across one or multiple terrains.'));
    }

    Host.appendChild(ParamCard.Group);

    // 2. BOUNDARY FALLOFF & INFLUENCE CARD (Soft Influence / Noise Falloff vs Hard Influence / No Falloff)
    const IsHard = IsHardBoundaryFalloff(Layer.falloff);
    const FallBadge = IsHard ? 'HARD / NO FALLOFF' : `${Math.round(Layer.falloff.distance)} m`;
    const FallCard = MakePropertyGroup('Boundary Falloff & Influence', 'Scan', FallBadge, true,
        'Choose Soft Influence / Noise Falloff to taper elevation organically from the 2D mask edge toward the interior, or Hard Influence / No Falloff for full strength right to the cliff edge.');

    let GraphEl = null;

    FallCard.Body.appendChild(MakeSelectRow('Influence Profile', [
        ['Soft Influence · Smooth Coastal Ramp', 'soft'],
        ['Soft Influence · Continental Taper', 'continental'],
        ['Soft Influence · Steep Plateau Rim', 'plateau'],
        ['Hard Influence · No Falloff (100% Edge)', 'none'],
        ['Perimeter Rim / Ring Ridge', 'rim'],
        ['Rectangular Bounds Box Falloff', 'bounds'],
        ['Custom Editable Curve', 'custom']
    ], IsHard ? 'none' : Layer.falloff.mode, Val =>
    {
        BeginUndoableAction();
        Layer.falloff.mode = Val;
        MarkDirtyAndSync(Layer);
        CommitUndoableAction();
        GraphEl?.Redraw();
        ScheduleDirtyRebuild(true);
        RenderInspector();
        RenderOutliner();
    }));

    GraphEl = MakeBoundaryFalloffGraph(Layer.falloff,
        () => { BeginUndoableAction(); MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
        () => CommitUndoableAction());
    FallCard.Body.appendChild(GraphEl);

    if (!IsHard)
    {
        FallCard.Body.appendChild(MakeSliderPillRow('Inland Ramp Dist', 20, 1400, 5, Layer.falloff.distance ?? 280, 0, 'm',
            V => { BeginUndoableAction(); Layer.falloff.distance = V; GraphEl.Redraw(); MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
            () => CommitUndoableAction(), 280));

        FallCard.Body.appendChild(MakeSliderPillRow('Coast Edge Floor', 0, 1, 0.01, Layer.falloff.edgeFloor ?? 0.0, 2, '×',
            V => { BeginUndoableAction(); Layer.falloff.edgeFloor = V; GraphEl.Redraw(); MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
            () => CommitUndoableAction(), 0.0));

        FallCard.Body.appendChild(MakeSliderPillRow('Noise Feather', 0, 0.85, 0.01, Layer.falloff.noiseAmount ?? 0.18, 2, '×',
            V => { BeginUndoableAction(); Layer.falloff.noiseAmount = V; GraphEl.Redraw(); MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
            () => CommitUndoableAction(), 0.18));

        FallCard.Body.appendChild(MakeSliderPillRow('Noise Scale', 0.25, 4.0, 0.05, Layer.falloff.noiseScale ?? 1.0, 2, '×',
            V => { BeginUndoableAction(); Layer.falloff.noiseScale = V; GraphEl.Redraw(); MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
            () => CommitUndoableAction(), 1.0));
    }

    Host.appendChild(FallCard.Group);

    // 3. Elevation & Slope Mask Card
    const HMask = Layer.heightMask || (Layer.heightMask = { enabled: false, minElev: 0, maxElev: 340, minSlope: 0, maxSlope: 90 });
    const MaskCard = MakePropertyGroup('Elevation & Slope Mask', 'Sliders', HMask.enabled ? 'ON' : 'OFF', false,
        'Constrain this layer to specific altitude bands (e.g., alpine peaks above +90m) or flat/steep slopes.');

    const EnRow = MakeEl('div', 'inline-toggle-row');
    EnRow.appendChild(MakeEl('span', '', 'Enable Altitude / Slope Mask'));
    const EnChk = MakeEl('input');
    EnChk.type = 'checkbox';
    EnChk.checked = !!HMask.enabled;
    EnChk.addEventListener('change', () =>
    {
        BeginUndoableAction();
        HMask.enabled = EnChk.checked;
        MarkDirtyAndSync(Layer);
        CommitUndoableAction();
        ScheduleDirtyRebuild(true);
        RenderInspector();
    });
    EnRow.appendChild(EnChk);
    MaskCard.Body.appendChild(EnRow);

    MaskCard.Body.appendChild(MakeSliderPillRow('Min Elevation', -60, 500, 2, HMask.minElev, 0, 'm',
        V => { BeginUndoableAction(); HMask.enabled = true; HMask.minElev = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
        () => CommitUndoableAction(), 0));
    MaskCard.Body.appendChild(MakeSliderPillRow('Max Elevation', 0, 900, 5, HMask.maxElev, 0, 'm',
        V => { BeginUndoableAction(); HMask.enabled = true; HMask.maxElev = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
        () => CommitUndoableAction(), 340));
    MaskCard.Body.appendChild(MakeSliderPillRow('Max Slope Angle', 5, 90, 1, HMask.maxSlope, 0, '°',
        V => { BeginUndoableAction(); HMask.enabled = true; HMask.maxSlope = V; MarkDirtyAndSync(Layer); ScheduleDirtyRebuild(); },
        () => CommitUndoableAction(), 90));

    Host.appendChild(MaskCard.Group);
}

function RenderSplineControlsInto(Body, Region, Layer)
{
    Body.appendChild(MakeSelectRow('Spline Landform Mode', [
        ['Mountain Ridge Spine', 'ridge'],
        ['Graded Terrace / Road Corridor', 'grade'],
        ['Carved Canyon / River Valley', 'valley']
    ], Layer.splineMode, Val =>
    {
        BeginUndoableAction();
        Layer.splineMode = Val;
        Region.dirty = true;
        Region.meshDirty = true;
        CommitUndoableAction();
        ScheduleDirtyRebuild(true);
    }));

    Body.appendChild(MakeSliderPillRow('Corridor Width', 12, 420, 2, Layer.width ?? 105, 0, 'm',
        V => { BeginUndoableAction(); Layer.width = V; Region.dirty = true; Region.meshDirty = true; ScheduleDirtyRebuild(); },
        () => CommitUndoableAction(), 105));
    Body.appendChild(MakeSliderPillRow('Relief Amount', -180, 240, 2, Layer.amount ?? 32, 0, 'm',
        V => { BeginUndoableAction(); Layer.amount = V; Region.dirty = true; Region.meshDirty = true; ScheduleDirtyRebuild(); },
        () => CommitUndoableAction(), 32));
    Body.appendChild(MakeSliderPillRow('Bank Smoothness', 0.05, 1.0, 0.02, Layer.bankSmooth ?? 0.62, 2, '×',
        V => { BeginUndoableAction(); Layer.bankSmooth = V; Region.dirty = true; Region.meshDirty = true; ScheduleDirtyRebuild(); },
        () => CommitUndoableAction(), 0.62));

    const KnotList = MakeEl('div', 'knot-list');
    Layer.points.forEach((Pt, Idx) =>
    {
        const Elev = Pt[2] ?? 0;
        const Chip = MakeEl('div', 'knot-chip-row' + (Idx === Studio.activeKnotIndex ? ' active' : ''), [
            MakeEl('span', 'knot-badge', String(Idx + 1)),
            MakeEl('span', 'knot-coords', `${Math.round(Pt[0])}, ${Math.round(Pt[1])} m`),
            MakeEl('span', 'knot-elev-pill', `${Elev >= 0 ? '+' : ''}${Math.round(Elev)} m`)
        ]);
        Chip.addEventListener('click', () =>
        {
            Studio.activeKnotIndex = Idx;
            SyncSelectionToEngines();
            RenderInspector();
        });
        KnotList.appendChild(Chip);
    });
    Body.appendChild(KnotList);

    const ActivePt = Layer.points[Studio.activeKnotIndex] || Layer.points[0];
    if (ActivePt)
    {
        Body.appendChild(MakeSliderPillRow(`Knot #${Studio.activeKnotIndex + 1} Elevation`, -80, 480, 1, ActivePt[2] ?? 40, 0, 'm',
            V => { BeginUndoableAction(); ActivePt[2] = V; Region.dirty = true; Region.meshDirty = true; ScheduleDirtyRebuild(); },
            () => CommitUndoableAction(), 40));
    }

    const BtnRow = MakeEl('div', 'studio-btn-row');
    const Edit2DBtn = MakeEl('button', 'button', 'Edit in 2D (S)');
    Edit2DBtn.type = 'button';
    Edit2DBtn.addEventListener('click', () => Set2DTool('spline'));

    const Edit3DBtn = MakeEl('button', 'button', 'Edit in 3D (G)');
    Edit3DBtn.type = 'button';
    Edit3DBtn.addEventListener('click', () => Set3DTool('spline'));
    BtnRow.append(Edit2DBtn, Edit3DBtn);
    Body.appendChild(BtnRow);
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                     TAB 2: SEPARATE TOGGLEABLE TERRAIN BOUNDS LAYER & INFINITE 2D MASK STACK
------------------------------------------------------------------------------------------------------------------------------------------*/
function RenderBoundsAndMaskTab(Host, Region)
{
    const BVis = Region.boundsLayer.visible !== false && World.boundsLayerVisible;
    const BoundsCard = MakePropertyGroup('Terrain Bounds Layer', 'Scan', BVis ? 'VISIBLE' : 'HIDDEN', true,
        'Each terrain region has its own independent Bounds Layer that can be toggled ON/OFF, locked, auto-synced to painted 2D masks, or resized independently.');

    const GlobalVisRow = MakeEl('div', 'inline-toggle-row');
    GlobalVisRow.appendChild(MakeEl('span', '', 'Show Bounds Layers Globally (2D & 3D)'));
    const GlobalChk = MakeEl('input');
    GlobalChk.type = 'checkbox';
    GlobalChk.checked = World.boundsLayerVisible;
    GlobalChk.addEventListener('change', () =>
    {
        World.boundsLayerVisible = GlobalChk.checked;
        SyncBoundsButtonUI();
        RenderOutliner();
        RenderInspector();
        SchedulePersist();
    });
    GlobalVisRow.appendChild(GlobalChk);
    BoundsCard.Body.appendChild(GlobalVisRow);

    const RegVisRow = MakeEl('div', 'inline-toggle-row');
    RegVisRow.appendChild(MakeEl('span', '', 'Show This Terrain Bounds Layer'));
    const RegVisChk = MakeEl('input');
    RegVisChk.type = 'checkbox';
    RegVisChk.checked = Region.boundsLayer.visible !== false;
    RegVisChk.addEventListener('change', () =>
    {
        Region.boundsLayer.visible = RegVisChk.checked;
        Map2D.requestRedraw();
        RenderOutliner();
        RenderInspector();
        SchedulePersist();
    });
    RegVisRow.appendChild(RegVisChk);
    BoundsCard.Body.appendChild(RegVisRow);

    const LockRow = MakeEl('div', 'inline-toggle-row');
    LockRow.appendChild(MakeEl('span', '', 'Lock Bounds Layer Geometry'));
    const LockChk = MakeEl('input');
    LockChk.type = 'checkbox';
    LockChk.checked = !!Region.boundsLayer.locked;
    LockChk.addEventListener('change', () =>
    {
        Region.boundsLayer.locked = LockChk.checked;
        Map2D.requestRedraw();
        RenderOutliner();
        SchedulePersist();
    });
    LockRow.appendChild(LockChk);
    BoundsCard.Body.appendChild(LockRow);

    const AutoSyncRow = MakeEl('div', 'inline-toggle-row');
    AutoSyncRow.appendChild(MakeEl('span', '', 'Auto-Expand Bounds When Painting Mask'));
    const AutoSyncChk = MakeEl('input');
    AutoSyncChk.type = 'checkbox';
    AutoSyncChk.checked = !!Region.boundsLayer.autoSyncMask;
    AutoSyncChk.addEventListener('change', () =>
    {
        Region.boundsLayer.autoSyncMask = AutoSyncChk.checked;
        RenderOutliner();
        SchedulePersist();
    });
    AutoSyncRow.appendChild(AutoSyncChk);
    BoundsCard.Body.appendChild(AutoSyncRow);

    BoundsCard.Body.appendChild(MakeSliderPillRow('Bounds X', -25000, 25000, 10, Region.bounds.x, 0, 'm',
        V => { BeginUndoableAction(); World.setRegionBounds(Region, { ...Region.bounds, x: V }, { manualEdit: true }); ScheduleDirtyRebuild(); Map2D.requestRedraw(); },
        () => { CommitUndoableAction(); RenderOutliner(); }, Region.bounds.x));

    BoundsCard.Body.appendChild(MakeSliderPillRow('Bounds Z', -25000, 25000, 10, Region.bounds.z, 0, 'm',
        V => { BeginUndoableAction(); World.setRegionBounds(Region, { ...Region.bounds, z: V }, { manualEdit: true }); ScheduleDirtyRebuild(); Map2D.requestRedraw(); },
        () => { CommitUndoableAction(); RenderOutliner(); }, Region.bounds.z));

    BoundsCard.Body.appendChild(MakeSliderPillRow('Bounds Width', 180, 12000, 20, Region.bounds.width, 0, 'm',
        V => { BeginUndoableAction(); World.setRegionBounds(Region, { ...Region.bounds, width: V }, { manualEdit: true }); ScheduleDirtyRebuild(); Map2D.requestRedraw(); },
        () => { CommitUndoableAction(); RenderOutliner(); }, 1500));

    BoundsCard.Body.appendChild(MakeSliderPillRow('Bounds Depth', 180, 12000, 20, Region.bounds.depth, 0, 'm',
        V => { BeginUndoableAction(); World.setRegionBounds(Region, { ...Region.bounds, depth: V }, { manualEdit: true }); ScheduleDirtyRebuild(); Map2D.requestRedraw(); },
        () => { CommitUndoableAction(); RenderOutliner(); }, 1400));

    BoundsCard.Body.appendChild(MakeSliderPillRow('Mask Sync Padding', 20, 450, 10, Region.boundsLayer.paddingMeters ?? 90, 0, 'm',
        V => { Region.boundsLayer.paddingMeters = V; },
        () => SchedulePersist(), 90));

    const BoundsBtnRow = MakeEl('div', 'studio-btn-row');
    const SyncNowBtn = MakeEl('button', 'button', 'Sync Bounds to Mask');
    SyncNowBtn.type = 'button';
    SyncNowBtn.addEventListener('click', () =>
    {
        BeginUndoableAction();
        World.syncRegionBoundsToMask(Region, Region.boundsLayer.paddingMeters ?? 90);
        CommitUndoableAction();
        ScheduleDirtyRebuild(true);
        RefreshAllUI();
    });

    const EditBoxBtn = MakeEl('button', 'button', 'Edit Handles in 2D');
    EditBoxBtn.type = 'button';
    EditBoxBtn.addEventListener('click', () => Set2DTool('select'));
    BoundsBtnRow.append(SyncNowBtn, EditBoxBtn);
    BoundsCard.Body.appendChild(BoundsBtnRow);

    Host.appendChild(BoundsCard.Group);

    // 2. Infinite 2D Terrain Mask Stack & Brush Controls
    const TotalTiles = World.totalAllocatedTiles();
    const MLayer = World.getMaskLayer(Map2D.activeMaskLayerId) || World.maskLayers[0];

    const MaskCard = MakePropertyGroup('Infinite 2D Mask Stack', 'Map', `${TotalTiles} TILES`, true,
        `Unbounded sparse ${MASK_TILE_RES}×${MASK_TILE_RES} tile hash map (${TILE_WORLD_METERS}m per tile). Paint freely anywhere on the infinite ocean.`);

    const SourceOpts = [['Composite Boolean Mask Stack', '__all__']].concat(World.maskLayers.map(M => [`Isolated: ${M.name}`, M.id]));
    MaskCard.Body.appendChild(MakeSelectRow('Terrain Mask Source', SourceOpts, Region.maskLayerId || '__all__', Val =>
    {
        BeginUndoableAction();
        Region.maskLayerId = Val === '__all__' ? null : Val;
        if (Region.maskLayerId) Map2D.activeMaskLayerId = Region.maskLayerId;
        Region.dirty = true;
        Region.meshDirty = true;
        CommitUndoableAction();
        ScheduleDirtyRebuild(true);
        RefreshAllUI();
    }));

    const AutoSpawnRow = MakeEl('div', 'inline-toggle-row');
    AutoSpawnRow.appendChild(MakeEl('span', '', 'Auto-Create Terrain on Open-Ocean Paint'));
    const AutoSpawnChk = MakeEl('input');
    AutoSpawnChk.type = 'checkbox';
    AutoSpawnChk.checked = !!World.autoCreateTerrainOnNewMask;
    AutoSpawnChk.addEventListener('change', () =>
    {
        World.autoCreateTerrainOnNewMask = AutoSpawnChk.checked;
        SchedulePersist();
    });
    AutoSpawnRow.appendChild(AutoSpawnChk);
    MaskCard.Body.appendChild(AutoSpawnRow);

    if (MLayer)
    {
        const MaskPickerOpts = World.maskLayers.map(M => [M.name, M.id]);
        MaskCard.Body.appendChild(MakeSelectRow('Active Paint Mask', MaskPickerOpts, MLayer.id, Val =>
        {
            Map2D.activeMaskLayerId = Val;
            Map2D.requestRedraw();
            RefreshAllUI();
        }));

        MaskCard.Body.appendChild(MakeSelectRow('Mask Boolean Mode', [
            ['Union Land (+)', 'union'],
            ['Subtract / Cut Bay (-)', 'subtract'],
            ['Intersect Clip (&)', 'intersect']
        ], MLayer.blendMode, Val =>
        {
            BeginUndoableAction();
            MLayer.blendMode = Val;
            MarkAllRegionsDirty();
            CommitUndoableAction();
            ScheduleDirtyRebuild(true);
            RefreshAllUI();
        }));

        MaskCard.Body.appendChild(MakeSliderPillRow('Mask Layer Opacity', 0, 1, 0.02, MLayer.opacity ?? 1.0, 2, '×',
            V => { BeginUndoableAction(); MLayer.opacity = V; MarkAllRegionsDirty(); ScheduleDirtyRebuild(); Map2D.requestRedraw(); },
            () => CommitUndoableAction(), 1.0));
    }

    MaskCard.Body.appendChild(MakeSelectRow('Stamp Silhouette (M)', [
        ['Organic Island', 'island'],
        ['Scattered Archipelago', 'archipelago'],
        ['Volcanic Ring Atoll', 'atoll'],
        ['Continental Block', 'rect']
    ], Map2D.stampKind, Val =>
    {
        Map2D.stampKind = Val;
        Set2DTool('stamp');
    }));

    const MaskBtnRow = MakeEl('div', 'studio-btn-row');
    const NewSubBtn = MakeEl('button', 'button', '+ Sub-Mask Layer');
    NewSubBtn.type = 'button';
    NewSubBtn.addEventListener('click', () =>
    {
        BeginUndoableAction();
        const Sub = World.addMaskLayer({ name: `Mask 0${World.maskLayers.length + 1} · Cutout`, blendMode: 'subtract' });
        Map2D.activeMaskLayerId = Sub.id;
        CommitUndoableAction();
        RefreshAllUI();
    });

    const DupMaskBtn = MakeEl('button', 'button', 'Duplicate Mask');
    DupMaskBtn.type = 'button';
    DupMaskBtn.addEventListener('click', () =>
    {
        if (!MLayer) return;
        BeginUndoableAction();
        const Copy = World.duplicateMaskLayer(MLayer.id);
        if (Copy) Map2D.activeMaskLayerId = Copy.id;
        Map2D.invalidateMaskCache();
        MarkAllRegionsDirty();
        CommitUndoableAction();
        ScheduleDirtyRebuild(true);
        RefreshAllUI();
    });

    const ClearMaskBtn = MakeEl('button', 'button', 'Clear Mask');
    ClearMaskBtn.type = 'button';
    ClearMaskBtn.addEventListener('click', () =>
    {
        if (!MLayer) return;
        BeginUndoableAction();
        World.clearMaskLayer(MLayer.id);
        Map2D.invalidateMaskCache();
        Map2D.invalidateRegionPreview();
        CommitUndoableAction();
        ScheduleDirtyRebuild(true);
        RefreshAllUI();
    });
    MaskBtnRow.append(NewSubBtn, DupMaskBtn, ClearMaskBtn);
    MaskCard.Body.appendChild(MaskBtnRow);

    Host.appendChild(MaskCard.Group);
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                     TAB 3: SPACE-EFFICIENT THIN BASE SURFACE & TRIANGLE MESH INSPECTOR
------------------------------------------------------------------------------------------------------------------------------------------*/
function RenderThinSlabTab(Host, Region, SelectedList)
{
    const Targets = (SelectedList.length > 1) ? SelectedList : [Region];
    const Rt = Region.runtime;
    const TotalCells = Rt ? Rt.nx * Rt.nz : 1;
    const CulledPct = Rt ? Math.round((Rt.culledCells / Math.max(1, TotalCells)) * 100) : 0;

    const SlabCard = MakePropertyGroup('Thin Base Surface & Mesh', 'Boxes', `${Region.resolution}²`, true,
        'Each terrain rests on a space-efficient thin flat underside wafer with watertight perimeter skirts and coarse 4×4 interior underside decimation — zero deep-ocean block waste.');

    SlabCard.Body.appendChild(MakeSliderPillRow('Base Elevation', -25, 35, 0.5, Region.baseElevation ?? 2.5, 1, 'm',
        V =>
        {
            BeginUndoableAction();
            for (const R of Targets) { R.baseElevation = V; R.dirty = true; R.meshDirty = true; }
            ScheduleDirtyRebuild();
        },
        () => CommitUndoableAction(), 2.5));

    SlabCard.Body.appendChild(MakeSliderPillRow('Wafer Thickness', 1.0, 28.0, 0.5, Region.slabThickness ?? 5.0, 1, 'm',
        V =>
        {
            BeginUndoableAction();
            for (const R of Targets) { R.slabThickness = V; R.dirty = true; R.meshDirty = true; }
            ScheduleDirtyRebuild();
        },
        () => CommitUndoableAction(), 5.0));

    SlabCard.Body.appendChild(MakeSliderPillRow('Shoreline Bevel', 0, 140, 2, Region.shorelineBevel ?? 18, 0, 'm',
        V =>
        {
            BeginUndoableAction();
            for (const R of Targets) { R.shorelineBevel = V; R.dirty = true; R.meshDirty = true; }
            ScheduleDirtyRebuild();
        },
        () => CommitUndoableAction(), 18));

    SlabCard.Body.appendChild(MakeSliderPillRow('Grid Resolution', 64, 256, 8, Region.resolution, 0, 'px',
        V =>
        {
            BeginUndoableAction();
            for (const R of Targets) { R.resolution = Math.round(V); R.dirty = true; R.meshDirty = true; }
            ScheduleDirtyRebuild();
        },
        () => { CommitUndoableAction(); RefreshAllUI(); }, 160));

    const OceanToggleBtn = MakeEl('button', 'button', World.oceanVisible !== false ? 'Hide Ocean to Inspect Thin Base Surface' : 'Show Ocean Surface');
    OceanToggleBtn.type = 'button';
    OceanToggleBtn.style.width = '100%';
    OceanToggleBtn.style.justifyContent = 'center';
    OceanToggleBtn.style.marginTop = '8px';
    OceanToggleBtn.addEventListener('click', () =>
    {
        World.oceanVisible = !(World.oceanVisible !== false);
        SyncOceanButtonUI();
        RenderInspector();
    });
    SlabCard.Body.appendChild(OceanToggleBtn);

    const GpuEntry = Viewport3D?.regionGpu.get(Region.id);
    if (Rt)
    {
        const StatsCard = MakePropertyGroup('Mesh Space-Efficiency Telemetry', 'Activity', `${CulledPct}% CULLED`, true);
        const Rows = [
            ['Active Land Cells', `${Rt.landCells.toLocaleString()} / ${TotalCells.toLocaleString()}`],
            ['Culled Empty Ocean Cells', `${CulledPct}% skipped`],
            ['Top Relief Triangles', (GpuEntry?.topTriCount || 0).toLocaleString()],
            ['Decimated Base Triangles', `${(GpuEntry?.baseTriCount || 0).toLocaleString()} (4×4 blocks)`],
            ['Total Watertight Triangles', (GpuEntry?.triCount || 0).toLocaleString()]
        ];
        for (const [K, V] of Rows)
        {
            StatsCard.Body.appendChild(MakeEl('div', 'inline-toggle-row', [
                MakeEl('span', '', K),
                MakeEl('strong', 'tabular', V)
            ]));
        }
        Host.append(SlabCard.Group, StatsCard.Group);
        return;
    }

    Host.appendChild(SlabCard.Group);
}

/*------------------------------------------------------------------------------------------------------------------------------------------
                                     TAB 4: OCEAN STAGE, SUN LIGHTING & TRIANGLE EXPORT
------------------------------------------------------------------------------------------------------------------------------------------*/
function RenderOceanAndExportTab(Host)
{
    const OceanCard = MakePropertyGroup('3D Ocean Context & Lighting', 'Sun', `${World.seaLevel.toFixed(1)} m`, true,
        'Toggleable 3D ocean sea-level plane providing coastal scale context across all visible terrains.');

    OceanCard.Body.appendChild(MakeSliderPillRow('Ocean Sea Level', -40, 60, 0.5, World.seaLevel, 1, 'm',
        V => { BeginUndoableAction(); World.seaLevel = V; MarkAllRegionsDirty(); ScheduleDirtyRebuild(); },
        () => CommitUndoableAction(), 0.0));

    OceanCard.Body.appendChild(MakeSliderPillRow('Ocean Wave Height', 0.0, 3.5, 0.05, Viewport3D.waveAmplitude, 2, 'm',
        V => { Viewport3D.waveAmplitude = V; }, null, 1.25));

    OceanCard.Body.appendChild(MakeSliderPillRow('Sun Azimuth', 0, 360, 1, Viewport3D.sunAzimuthDeg, 0, '°',
        V => { Viewport3D.sunAzimuthDeg = V; }, null, 134));

    OceanCard.Body.appendChild(MakeSliderPillRow('Sun Elevation', 4, 88, 1, Viewport3D.sunElevationDeg, 0, '°',
        V => { Viewport3D.sunElevationDeg = V; }, null, 34));

    OceanCard.Body.appendChild(MakeSliderPillRow('Camera Exposure', 0.55, 1.85, 0.02, Viewport3D.exposure, 2, 'EV',
        V => { Viewport3D.exposure = V; }, null, 0.94));

    Host.appendChild(OceanCard.Group);

    const ExportCard = MakePropertyGroup('Project & Triangle Mesh Export', 'Download', 'TRIANGLES', true,
        'Export visible thin-base-surface terrain meshes as clean watertight triangles (.OBJ or binary .STL), or save the non-destructive sparse-tile project (.JSON).');

    const Row1 = MakeEl('div', 'studio-btn-row');
    const ObjBtn = MakeEl('button', 'button export-button', 'Export .OBJ');
    ObjBtn.type = 'button';
    ObjBtn.addEventListener('click', TriggerExportObj);

    const StlBtn = MakeEl('button', 'button', 'Export .STL');
    StlBtn.type = 'button';
    StlBtn.addEventListener('click', TriggerExportStl);
    Row1.append(ObjBtn, StlBtn);

    const Row2 = MakeEl('div', 'studio-btn-row');
    const SaveJsonBtn = MakeEl('button', 'button', 'Save Project .JSON');
    SaveJsonBtn.type = 'button';
    SaveJsonBtn.addEventListener('click', TriggerSaveJson);

    const LoadJsonBtn = MakeEl('button', 'button', 'Load Project .JSON');
    LoadJsonBtn.type = 'button';
    LoadJsonBtn.addEventListener('click', () => $('FileLoadJson').click());
    Row2.append(SaveJsonBtn, LoadJsonBtn);

    ExportCard.Body.append(Row1, Row2);
    Host.appendChild(ExportCard.Group);
}

/*==========================================================================================================================================
                                                 IMPORT / EXPORT & TELEMETRY
==========================================================================================================================================*/
function DownloadBlob(BlobObj, Filename)
{
    const Url = URL.createObjectURL(BlobObj);
    const A = document.createElement('a');
    A.href = Url;
    A.download = Filename;
    document.body.appendChild(A);
    A.click();
    A.remove();
    setTimeout(() => URL.revokeObjectURL(Url), 1500);
}

function GetExportTargetRegions()
{
    return Viewport3D ? Viewport3D.getVisibleRegions() : World.regions.filter(R => R.enabled);
}

function TriggerExportObj()
{
    ScheduleDirtyRebuild(true);
    const { text: ObjText } = ExportWorldTerrainsObj(World, GetExportTargetRegions());
    DownloadBlob(new Blob([ObjText], { type: 'text/plain;charset=utf-8' }), 'frontier-terrain-thin-base.obj');
}

function TriggerExportStl()
{
    ScheduleDirtyRebuild(true);
    const { bytes: StlBytes } = ExportWorldTerrainsBinaryStl(World, GetExportTargetRegions());
    DownloadBlob(new Blob([StlBytes], { type: 'model/stl' }), 'frontier-terrain-thin-base.stl');
}

function TriggerSaveJson()
{
    const Json = JSON.stringify(World.toJSON(), null, 2);
    DownloadBlob(new Blob([Json], { type: 'application/json' }), 'frontier-terrain-studio.json');
}

function UpdateTelemetryBar()
{
    const Region = GetActiveRegion();
    const TotalTiles = World.totalAllocatedTiles();
    const ApproxKb = Math.round(World.totalAllocatedBytes() / 1024);
    $('status-tiles').textContent = `Sparse 2D Tiles: ${TotalTiles} (${ApproxKb.toLocaleString()} KB)`;

    const EnabledCount = World.regions.filter(R => R.enabled).length;
    const MultiCount = Studio.selectedRegionIds.size;
    $('hud-3d-scope').textContent = MultiCount > 1
        ? `${MultiCount} SELECTED`
        : (Viewport3D?.viewScope === 'solo' ? 'SOLO TERRAIN' : `${EnabledCount} TERRAINS`);

    if (Region && Region.runtime)
    {
        const FloorY = Region.runtime.slabBottom.toFixed(1);
        const PeakY = Math.round(Region.runtime.maxHeight);
        $('hud-slab-floor').textContent = `${FloorY} m`;
        $('status-main').textContent = MultiCount > 1
            ? `${MultiCount} Terrains Selected (Active: ${Region.name})`
            : Region.name;
        $('status-slab').textContent = `Thin Base Surface: ${FloorY} m → +${PeakY} m`;
    }

    const Tris = Viewport3D?.totalVisibleTriangles || 0;
    const Verts = Viewport3D?.totalVisibleVertices || 0;
    $('hud-tris-count').textContent = Tris.toLocaleString();
    $('status-mesh').textContent = `Triangles: ${Tris.toLocaleString()} · Vertices: ${Verts.toLocaleString()}`;
}

function RefreshAllUI()
{
    RenderRegionTabs();
    RenderOutliner();
    RenderInspector();
    SyncUndoButtons();
    UpdateTelemetryBar();
}

/*==========================================================================================================================================
                                                 BOOT, RENDER LOOP & EVENT WIRING
==========================================================================================================================================*/
async function InitStudio()
{
    MountStaticGlyphsAndRails();
    await BootWorld();

    Map2D = new WorldMap2DCanvas($('Canvas2D'), World, {
        onCursorMove: (Wx, Wz) =>
        {
            $('Hud2DCoords').textContent = `${(Wx / 1000).toFixed(2)}, ${(Wz / 1000).toFixed(2)} km`;
        },
        onBeforeMaskEdit: () => BeginUndoableAction(),
        onMaskLivePaint: () =>
        {
            Map2D.invalidateMaskCache();
            ScheduleDirtyRebuild(false);
        },
        onMaskStrokeFinished: SpawnedRegion =>
        {
            Map2D.invalidateMaskCache();
            CommitUndoableAction();
            ScheduleDirtyRebuild(true);
            if (SpawnedRegion)
            {
                const Base = CreateTerrainLayer('multifractal');
                SpawnedRegion.stack.push(Base);
                SpawnedRegion.dirty = true;
                SpawnedRegion.meshDirty = true;
                Studio.activeLayerByRegion.set(SpawnedRegion.id, Base.id);
                ScheduleDirtyRebuild(true);
                SelectRegion(SpawnedRegion.id, false, false);
            }
            else
            {
                RefreshAllUI();
            }
        },
        onCreateRegionFromBox: Box => SpawnNewTerrainRegion(Box),
        onRegionSelectionChanged: (ActiveId, SelectedIds) =>
        {
            Studio.activeRegionId = ActiveId;
            Studio.selectedRegionIds = new Set(SelectedIds);
            SyncSelectionToEngines();
            RefreshAllUI();
        },
        onBeforeBoundsEdit: () => BeginUndoableAction(),
        onRegionBoundsEdited: (_Regions, Finished) =>
        {
            ScheduleDirtyRebuild(Finished);
            if (Finished)
            {
                CommitUndoableAction();
                RefreshAllUI();
            }
            else
            {
                UpdateTelemetryBar();
            }
        },
        onLayerStackChanged: (Reg, LayerId) =>
        {
            Studio.activeLayerByRegion.set(Reg.id, LayerId);
            ScheduleDirtyRebuild(true);
            RefreshAllUI();
        },
        onSplineEdited: (Reg, _Layer, Finished, KnotIdx) =>
        {
            if (Number.isFinite(KnotIdx)) Studio.activeKnotIndex = KnotIdx;
            if (!Finished) BeginUndoableAction();
            Reg.dirty = true;
            Reg.meshDirty = true;
            ScheduleDirtyRebuild(Finished);
            if (Finished)
            {
                CommitUndoableAction();
                RenderInspector();
            }
        },
        onDoubleClickRegion: Reg =>
        {
            SelectRegion(Reg.id, false, true);
        }
    });

    Viewport3D = new TerrainOceanViewport($('Canvas3D'), $('Overlay3D'), World, {
        onPickRegionIn3D: (Reg, Multi) => SelectRegion(Reg.id, Multi, false),
        onBeforeSculpt3D: () => BeginUndoableAction(),
        onSculptLive3D: Touched =>
        {
            for (const R of Touched)
            {
                Map2D.invalidateRegionPreview(R.id);
                Viewport3D.markRegionMeshDirty(R.id);
            }
            Map2D.requestRedraw();
            UpdateTelemetryBar();
        },
        onSculptStrokeFinished3D: () =>
        {
            CommitUndoableAction();
            RefreshAllUI();
        },
        onSplineKnotSelected: (_Reg, _Layer, Idx) =>
        {
            Studio.activeKnotIndex = Idx;
            SyncSelectionToEngines();
            RenderInspector();
        },
        onBeforeSplineGizmoEdit: () => BeginUndoableAction(),
        onSplineGizmoLive: Reg =>
        {
            Reg.dirty = true;
            Reg.meshDirty = true;
            ScheduleDirtyRebuild(false);
        },
        onSplineGizmoFinished: Reg =>
        {
            Reg.dirty = true;
            Reg.meshDirty = true;
            ScheduleDirtyRebuild(true);
            CommitUndoableAction();
            RenderInspector();
        },
        onSplineKnotAdded3D: (Reg, Layer, Idx) =>
        {
            Studio.activeLayerByRegion.set(Reg.id, Layer.id);
            Studio.activeKnotIndex = Idx;
            Reg.dirty = true;
            Reg.meshDirty = true;
            ScheduleDirtyRebuild(true);
            CommitUndoableAction();
            RefreshAllUI();
        }
    });

    SyncSelectionToEngines();
    SyncBoundsButtonUI();
    SyncOceanButtonUI();
    Map2D.frameAllRegions();
    Viewport3D.frameVisibleWorld();
    ScheduleDirtyRebuild(true);
    RefreshAllUI();

    // Continuous 60 FPS Studio Render Loop
    const Tick = Now =>
    {
        if (Studio.workspace !== '3d') Map2D.render();
        if (Studio.workspace !== '2d')
        {
            const Active = GetActiveRegion();
            const PreviewId = Active ? (Studio.activeLayerByRegion.get(Active.id) || null) : null;
            Viewport3D.render(PreviewId);
        }

        Studio.fpsFrames++;
        if (Now - Studio.fpsLastStamp >= 500)
        {
            const Fps = Math.min(120, Math.round((Studio.fpsFrames * 1000) / (Now - Studio.fpsLastStamp)));
            Studio.fpsFrames = 0;
            Studio.fpsLastStamp = Now;
            const GpuTag = Viewport3D.gpuPipeline?.available ? 'GPU-STACK' : 'THIN-BASE';
            $('engine-pill-text').textContent = `${GpuTag} · ${Fps} FPS`;
            UpdateTelemetryBar();
        }
        requestAnimationFrame(Tick);
    };
    requestAnimationFrame(Tick);

    // Workspace Switcher (2D Terrain | 3D Landscape | Split 2D + 3D)
    document.querySelectorAll('.top-nav [data-ws]').forEach(Btn =>
    {
        Btn.addEventListener('click', () => SetWorkspaceMode(Btn.dataset.ws));
    });

    // Header & Outliner Actions
    $('new-scene-btn').addEventListener('click', () => SpawnNewTerrainRegion());
    $('dock-new-terrain-btn').addEventListener('click', () => SpawnNewTerrainRegion());
    $('add-button').addEventListener('click', () => AddLayerToTargetRegions('multifractal'));
    $('undo-btn').addEventListener('click', PerformUndo);
    $('redo-btn').addEventListener('click', PerformRedo);
    $('export-button').addEventListener('click', TriggerExportObj);
    $('dock-save-json-btn').addEventListener('click', TriggerSaveJson);
    $('import-btn').addEventListener('click', () => $('FileLoadJson').click());

    $('FileLoadJson').addEventListener('change', async E =>
    {
        const File = E.target.files?.[0];
        if (!File) return;
        try
        {
            const Text = await File.text();
            BeginUndoableAction();
            RestoreSnapshot(Text);
            CommitUndoableAction();
            Map2D.frameAllRegions();
            Viewport3D.frameVisibleWorld();
        }
        catch (Err)
        {
            console.error('Failed to load Terrain Studio .JSON:', Err);
        }
        E.target.value = '';
    });

    $('compact-outliner').addEventListener('click', () =>
    {
        Studio.compactOutliner = !Studio.compactOutliner;
        $('compact-outliner').classList.toggle('active', Studio.compactOutliner);
        RenderOutliner();
    });

    $('scene-search').addEventListener('input', E =>
    {
        Studio.outlinerQuery = E.target.value;
        RenderOutliner();
    });

    document.querySelectorAll('#scene-filters [data-filter]').forEach(Btn =>
    {
        Btn.addEventListener('click', () =>
        {
            Studio.outlinerFilter = Btn.dataset.filter;
            document.querySelectorAll('#scene-filters [data-filter]').forEach(B => B.classList.toggle('active', B === Btn));
            RenderOutliner();
        });
    });

    // Stage Top Bar Controls
    $('scope-select').addEventListener('change', E =>
    {
        Viewport3D.viewScope = E.target.value;
        UpdateTelemetryBar();
    });

    $('lens-select').addEventListener('change', E =>
    {
        const Mode = parseInt(E.target.value, 10) || 0;
        Viewport3D.lensMode = Mode === 4 ? 0 : Mode;
        Viewport3D.showWireGrid = Mode === 4;
        if (Viewport3D.lensMode === 1)
        {
            const Reg = GetActiveRegion();
            if (Reg) { Reg.dirty = true; Reg.meshDirty = true; ScheduleDirtyRebuild(true); }
        }
    });

    $('select-all-terrains-btn').addEventListener('click', SelectAllTerrains);

    $('toggle-2d-falloff-btn').addEventListener('click', () =>
    {
        Map2D.showFalloffIn2D = !Map2D.showFalloffIn2D;
        $('toggle-2d-falloff-btn').classList.toggle('active', Map2D.showFalloffIn2D);
        Map2D.invalidateRegionPreview();
        Map2D.requestRedraw();
    });

    // Global Separate Bounds Layer Toggle (updates BOTH 2D and 3D!)
    $('toggle-bounds-btn').addEventListener('click', () =>
    {
        World.boundsLayerVisible = !World.boundsLayerVisible;
        SyncBoundsButtonUI();
        RenderOutliner();
        if (Studio.inspectorTab === 'bounds') RenderInspector();
        SchedulePersist();
    });

    // 3D Ocean Toggle (reveals Thin Base Surface wafer!)
    $('toggle-ocean-btn').addEventListener('click', () =>
    {
        World.oceanVisible = !(World.oceanVisible !== false);
        SyncOceanButtonUI();
        if (Studio.inspectorTab === 'slab') RenderInspector();
    });

    $('toggle-gizmo-btn').addEventListener('click', () =>
    {
        Viewport3D.showGizmo = !Viewport3D.showGizmo;
        $('toggle-gizmo-btn').classList.toggle('active', Viewport3D.showGizmo);
    });

    $('toggle-contours-btn').addEventListener('click', () =>
    {
        Viewport3D.showContours = !Viewport3D.showContours;
        $('toggle-contours-btn').classList.toggle('active', Viewport3D.showContours);
    });

    $('focus-btn').addEventListener('click', () =>
    {
        Map2D.frameAllRegions();
        Viewport3D.frameVisibleWorld();
    });

    $('maximize-btn').addEventListener('click', ToggleMaximizeStage);

    // Lower Quick Bar Controls
    const SyncRangeFill = El =>
    {
        const Min = parseFloat(El.min), Max = parseFloat(El.max), Val = parseFloat(El.value);
        El.style.setProperty('--fill', `${(((Val - Min) / (Max - Min)) * 100).toFixed(1)}%`);
    };
    SyncRangeFill($('dock-radius-range'));
    SyncRangeFill($('dock-rough-range'));

    $('dock-radius-range').addEventListener('input', E =>
    {
        const R = parseFloat(E.target.value);
        SyncRangeFill(E.target);
        Map2D.brushRadiusM = R;
        Viewport3D.sculptRadiusM = R * 1.15;
        $('dock-radius-val').textContent = `${Math.round(R)} m`;
    });

    $('dock-rough-range').addEventListener('input', E =>
    {
        const V = parseFloat(E.target.value);
        SyncRangeFill(E.target);
        Map2D.coastRoughness = V;
        $('dock-rough-val').textContent = `${Math.round(V * 100)}%`;
    });

    $('dock-atmos-select').addEventListener('change', E =>
    {
        Viewport3D.atmosphereMode = parseInt(E.target.value, 10) || 0;
    });

    $('dock-fit-mask-btn').addEventListener('click', () =>
    {
        const Targets = GetSelectedRegions();
        if (!Targets.length) return;
        BeginUndoableAction();
        for (const R of Targets) World.syncRegionBoundsToMask(R, R.boundsLayer?.paddingMeters ?? 90);
        CommitUndoableAction();
        ScheduleDirtyRebuild(true);
        RefreshAllUI();
    });

    // Inspector Object Header & Tabs
    $('object-name').addEventListener('change', E =>
    {
        const Reg = GetActiveRegion();
        if (Reg && E.target.value.trim())
        {
            Reg.name = E.target.value.trim();
            RefreshAllUI();
            SchedulePersist();
        }
    });

    $('object-enabled').addEventListener('change', E =>
    {
        const Targets = GetSelectedRegions();
        for (const R of Targets)
        {
            R.enabled = E.target.checked;
            if (R.enabled && !R.runtime) { R.dirty = true; R.meshDirty = true; }
        }
        ScheduleDirtyRebuild(true);
        Map2D.requestRedraw();
        RefreshAllUI();
    });

    $('reset-demo-btn').addEventListener('click', async () =>
    {
        BeginUndoableAction();
        await ClearWorldStorage();
        SeedThreeDemoTerrains(World);
        Studio.activeRegionId = World.regions[0]?.id || null;
        Studio.selectedRegionIds = new Set(Studio.activeRegionId ? [Studio.activeRegionId] : []);
        for (const R of World.regions)
        {
            if (R.stack.length > 0) Studio.activeLayerByRegion.set(R.id, R.stack[0].id);
        }
        Map2D.activeMaskLayerId = World.maskLayers[0]?.id || null;
        Map2D.invalidateMaskCache();
        Map2D.invalidateRegionPreview();
        Viewport3D.markRegionMeshDirty();
        SyncSelectionToEngines();
        SyncBoundsButtonUI();
        SyncOceanButtonUI();
        CommitUndoableAction();
        Map2D.frameAllRegions();
        Viewport3D.frameVisibleWorld();
        ScheduleDirtyRebuild(true);
        RefreshAllUI();
        SetSaveBadge('Reset to 3 Example Masks');
    });

    document.querySelectorAll('#inspector-tabs [data-itab]').forEach(Btn =>
    {
        Btn.addEventListener('click', () =>
        {
            Studio.inspectorTab = Btn.dataset.itab;
            SyncInspectorTabButtons();
            RenderOutliner();
            RenderInspector();
        });
    });

    // Studio Keyboard Shortcuts
    window.addEventListener('keydown', E =>
    {
        const Tag = document.activeElement?.tagName;
        if (Tag === 'INPUT' || Tag === 'TEXTAREA' || Tag === 'SELECT') return;

        if ((E.ctrlKey || E.metaKey) && E.key.toLowerCase() === 'f')
        {
            E.preventDefault();
            $('scene-search').focus();
            return;
        }
        if ((E.ctrlKey || E.metaKey) && E.key.toLowerCase() === 'a')
        {
            E.preventDefault();
            SelectAllTerrains();
            return;
        }
        if ((E.ctrlKey || E.metaKey) && E.key.toLowerCase() === 'z' && !E.shiftKey)
        {
            E.preventDefault();
            PerformUndo();
            return;
        }
        if ((E.ctrlKey || E.metaKey) && (E.key.toLowerCase() === 'y' || (E.key.toLowerCase() === 'z' && E.shiftKey)))
        {
            E.preventDefault();
            PerformRedo();
            return;
        }
        if (E.key === 'Tab')
        {
            E.preventDefault();
            ToggleMaximizeStage();
            return;
        }

        const K = E.key.toLowerCase();
        if (K === '1') SetWorkspaceMode('2d');
        else if (K === '2') SetWorkspaceMode('3d');
        else if (K === '3') SetWorkspaceMode('split');
        else if (K === 'b') Set2DTool('brush');
        else if (K === 'e') Set2DTool('erase');
        else if (K === 'p') Set2DTool('polygon');
        else if (K === 'm') Set2DTool('stamp');
        else if (K === 'v') Set2DTool('select');
        else if (K === 'r') Set2DTool('bounds');
        else if (K === 's') Set2DTool('spline');
        else if (K === 'g') Set3DTool('spline');
        else if (K === 'w')
        {
            World.oceanVisible = !(World.oceanVisible !== false);
            SyncOceanButtonUI();
        }
        else if (K === 'f')
        {
            Map2D.frameAllRegions();
            Viewport3D.frameVisibleWorld();
        }
    });
}

function ToggleMaximizeStage()
{
    Studio.maximizedStage = !Studio.maximizedStage;
    $('left-panel').style.display = Studio.maximizedStage ? 'none' : '';
    $('inspector-panel').style.display = Studio.maximizedStage ? 'none' : '';
    $('studio-workspace').style.gridTemplateColumns = Studio.maximizedStage ? '1fr' : '';
    $('maximize-btn').classList.toggle('active', Studio.maximizedStage);
    requestAnimationFrame(() => Map2D?.requestRedraw());
}

InitStudio();
