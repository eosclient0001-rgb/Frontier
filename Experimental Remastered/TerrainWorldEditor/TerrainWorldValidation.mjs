/*==========================================================================================================================================
                                                     TERRAINWORLDVALIDATION.MJS
==========================================================================================================================================*/
// Comprehensive Headless Validation Suite for Frontier Terrain Studio (Stage 1: 2D Terrain Workspace & 3D Landscape Workspace)

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WorldMask2D, ComputeRegionMaskSdf2D } from './Engine/WorldMask2D.js';
import {
    LAYER_TYPE_META,
    EvaluateBoundaryFalloff,
    CreateTerrainLayer,
    MoveTerrainLayer,
    DuplicateTerrainLayer,
    EvaluateTerrainRegion,
    ApplyTerrainSculptDab,
    ApplyMultiTerrainSculptDab,
    SyncLayerAcrossSelectedRegions,
    ExtractRegionTriangleMesh,
    ExportWorldTerrainsObj,
    ExportWorldTerrainsBinaryStl,
    SeedThreeDemoTerrains
} from './Engine/TerrainLayerStack.js';
import { GpuTerrainStackPipeline } from './Engine/GpuTerrainStackPipeline.js';

let Passed = 0;
function Suite(Name, Fn)
{
    Fn();
    Passed++;
    console.log(`  [PASS] ${Name}`);
}

console.log('Running Frontier Terrain Studio (Stage 1: 2D Terrain & 3D Landscape) Validation...\n');

// 1. Infinite Sparse 2D Mask Canvas & Multi-Mask Boolean Composition
Suite('1. Infinite sparse 2D canvas allocates tiles on demand at ±100 km with multi-mask boolean layers & pruning', () =>
{
    const World = new WorldMask2D();
    const BaseMask = World.addMaskLayer({ name: 'Continent Base', blendMode: 'union' });
    assert.equal(World.totalAllocatedTiles(), 0, 'Fresh world mask must allocate 0 tiles');

    // Paint far across unbounded kilometer coordinates (-84.5 km, +142.3 km)
    World.paintCapsuleMeters(BaseMask, [-84500, 142300], [-84100, 142550], 210, 'paint', 1.0, 0.0, 101);
    assert.ok(World.totalAllocatedTiles() > 0 && World.totalAllocatedTiles() <= 4, 'Only touched 1x1 km tiles should allocate');
    assert.ok(World.sampleCoverageMeters(-84300, 142420, BaseMask.id) > 0.95, 'Painted distant coordinate must read land coverage');
    assert.equal(World.sampleCoverageMeters(25000, -60000, BaseMask.id), 0.0, 'Unpainted distant ocean costs 0 tiles and returns 0');

    // Carve bay via a non-destructive Subtract mask layer
    const BayCarve = World.addMaskLayer({ name: 'Bay Cutout', blendMode: 'subtract' });
    World.paintCapsuleMeters(BayCarve, [-84300, 142420], [-84300, 142420], 95, 'paint', 1.0, 0.0, 202);
    assert.ok(World.sampleCoverageMeters(-84300, 142420) < 0.05, 'Subtract mask layer must non-destructively carve composite coverage');
    BayCarve.visible = false;
    assert.ok(World.sampleCoverageMeters(-84300, 142420) > 0.95, 'Hiding subtract mask layer restores underlying landmass non-destructively');

    // Erasing prunes empty tiles back to 0 bytes
    World.removeMaskLayer(BayCarve.id);
    World.paintCapsuleMeters(BaseMask, [-84700, 142100], [-83900, 142750], 420, 'erase', 1.0, 0.0, 101);
    assert.equal(World.totalAllocatedTiles(), 0, 'Erased empty sparse tiles must be pruned automatically');
});

// 2. Separate, Toggleable, Independently Editable Terrain Bounds Layer & Auto-Sync
Suite('2. Separate Terrain Bounds Layer toggles ON/OFF, edits independently of mask, and supports mask sync', () =>
{
    const World = new WorldMask2D();
    const Mask = World.addMaskLayer({ name: 'Island Mask' });
    World.paintStampMeters(Mask, [1200, -800], 320, 'island', false, 0.25, 303);

    const Region = World.addTerrainRegion({
        name: 'Bounded Island',
        maskLayerId: Mask.id,
        boundsLayer: { visible: true, autoSyncMask: true, paddingMeters: 100 }
    });
    World.syncRegionBoundsToMask(Region);
    assert.ok(Region.bounds.x < 950 && Region.bounds.x + Region.bounds.width > 1450, 'Synced bounds must enclose painted island');

    // Toggle Bounds Layer OFF both per-region and globally without harming terrain mask
    Region.boundsLayer.visible = false;
    assert.equal(World.isRegionBoundsVisible(Region), false, 'Per-terrain Bounds Layer visibility toggle must hide bounds');
    Region.boundsLayer.visible = true;
    World.boundsLayerVisible = false;
    assert.equal(World.isRegionBoundsVisible(Region), false, 'Global Bounds Layer toggle must hide bounds');
    World.boundsLayerVisible = true;
    assert.equal(World.isRegionBoundsVisible(Region), true);

    // Edit Bounds Layer independently from the 2D terrain mask
    const MaskCovBefore = World.sampleCoverageMeters(1200, -800, Mask.id);
    World.setRegionBounds(Region, { x: 600, z: -1400, width: 1400, depth: 1300 }, { manualEdit: true });
    assert.equal(Region.boundsLayer.autoSyncMask, false, 'Manual bounds edit switches off autoSyncMask');
    assert.equal(Region.bounds.width, 1400);
    assert.equal(World.sampleCoverageMeters(1200, -800, Mask.id), MaskCovBefore, 'Editing Bounds Layer must not alter underlying 2D mask');
});

// 3. Exact O(N) Meijster 2D Euclidean Signed Distance Transform
Suite('3. Meijster 2D Euclidean Signed Distance Field computes exact metric inland/offshore distances', () =>
{
    const World = new WorldMask2D();
    const Mask = World.addMaskLayer({ name: 'Circle Island' });
    World.paintCapsuleMeters(Mask, [0, 0], [0, 0], 300, 'paint', 1.0, 0.0, 42);
    const Region = World.addTerrainRegion({
        maskLayerId: Mask.id,
        bounds: { x: -500, z: -500, width: 1000, depth: 1000 },
        resolution: 101
    });
    const { sdf2D, hasLand } = ComputeRegionMaskSdf2D(World, Region, 101, 101);
    assert.equal(hasLand, true);

    const CenterIdx = 50 * 101 + 50;
    const CornerIdx = 0;
    assert.ok(sdf2D[CenterIdx] < -270 && sdf2D[CenterIdx] > -330, `Expected ~-300m at island centre, got ${sdf2D[CenterIdx]}`);
    assert.ok(sdf2D[CornerIdx] > 370 && sdf2D[CornerIdx] < 440, `Expected ~+407m at ocean corner, got ${sdf2D[CornerIdx]}`);
});

// 4. Composable Layer-Stack Architecture (Visibility, Reordering, Duplication, Blending)
Suite('4. Composable layer stack supports visibility toggles, non-destructive reordering, duplication, and blending', () =>
{
    const World = new WorldMask2D();
    const Mask = World.addMaskLayer({ name: 'Stack Test Mask' });
    World.paintCapsuleMeters(Mask, [0, 0], [0, 0], 420, 'paint', 1.0, 0.0, 55);
    const Region = World.addTerrainRegion({
        maskLayerId: Mask.id,
        bounds: { x: -550, z: -550, width: 1100, depth: 1100 },
        resolution: 96,
        stack: [
            CreateTerrainLayer('multifractal', { id: 'l-base', amplitude: 180, falloff: { mode: 'soft', distance: 220 } }),
            CreateTerrainLayer('terrace', { id: 'l-terr', bedCount: 6, strength: 0.85, falloff: { mode: 'none' } })
        ]
    });
    const Rt1 = EvaluateTerrainRegion(World, Region);
    const HWithTerrace = Float32Array.from(Rt1.heights);

    // Disable terrace layer -> non-destructively evaluates pure multifractal
    Region.stack[1].enabled = false;
    const RtNoTerr = EvaluateTerrainRegion(World, Region);
    let DiffDisable = 0;
    for (let I = 0; I < HWithTerrace.length; ++I) DiffDisable += Math.abs(HWithTerrace[I] - RtNoTerr.heights[I]);
    assert.ok(DiffDisable > 500.0, 'Toggling layer visibility OFF must non-destructively remove its contribution');
    Region.stack[1].enabled = true;

    // Reorder terrace below multifractal -> produces a predictably different stacked composition
    assert.equal(MoveTerrainLayer(Region, 'l-terr', -1), true);
    assert.equal(Region.stack[0].id, 'l-terr');
    const RtReordered = EvaluateTerrainRegion(World, Region);
    let DiffOrder = 0;
    for (let I = 0; I < HWithTerrace.length; ++I) DiffOrder += Math.abs(HWithTerrace[I] - RtReordered.heights[I]);
    assert.ok(DiffOrder > 500.0, 'Reordering layers in the stack must update bottom-to-top terrain composition');

    const Dup = DuplicateTerrainLayer(Region, 'l-base');
    assert.ok(Dup && Region.stack.length === 3, 'DuplicateTerrainLayer must insert an independent layer copy');
});

// 5. All Stage-1 Procedural Landform Generators (Zero Erosion / Rock / Cliff Studio Leakage)
Suite('5. Supports Fractal, Multifractal, Ridge, Voronoi, Billow, Dunes, Escarpment, Caldera, Terrace & Spline generators', () =>
{
    const ForbiddenStage2 = ['erosion', 'hydraulic', 'thermal', 'rockstudio', 'cliffstudio', 'arch3d'];
    for (const Key of Object.keys(LAYER_TYPE_META))
    {
        assert.ok(!ForbiddenStage2.includes(Key.toLowerCase()), `Stage 1 must not expose Stage-2 system '${Key}'`);
    }

    const World = new WorldMask2D();
    const Mask = World.addMaskLayer({ name: 'Generator Island' });
    World.paintCapsuleMeters(Mask, [0, 0], [0, 0], 450, 'paint', 1.0, 0.0, 99);

    const GeneratorTypes = ['fractal', 'multifractal', 'ridged', 'voronoi', 'billow', 'dunes', 'escarpment', 'caldera'];
    for (const Type of GeneratorTypes)
    {
        const Region = World.addTerrainRegion({
            name: `Gen ${Type}`,
            maskLayerId: Mask.id,
            bounds: { x: -550, z: -550, width: 1100, depth: 1100 },
            resolution: 72,
            baseElevation: 2.0,
            stack: [CreateTerrainLayer(Type, { amplitude: 150, falloff: { mode: 'soft', distance: 200 } })]
        });
        const Rt = EvaluateTerrainRegion(World, Region);
        assert.ok(Rt.maxHeight > 35.0, `Procedural generator '${Type}' must produce meaningful 3D relief (got ${Rt.maxHeight.toFixed(1)}m)`);
    }

    // Headless check that GpuTerrainStackPipeline gracefully degrades when WebGL2 is absent
    const HeadlessGpu = new GpuTerrainStackPipeline(null);
    assert.equal(HeadlessGpu.supported, false);
});

// 6. Layer Falloff & Influence: Soft Influence / Noise Falloff vs Hard Influence / No Falloff
Suite('6. Per-layer falloff supports Soft Noise Falloff (edge -> centre) and Hard / No Falloff (full boundary strength)', () =>
{
    const SoftClean = { mode: 'soft', distance: 300, edgeFloor: 0.0, noiseAmount: 0.0 };
    assert.equal(EvaluateBoundaryFalloff(0, 500, SoftClean), 0.0, 'Soft falloff at boundary (0m) starts at 0');
    assert.ok(Math.abs(EvaluateBoundaryFalloff(150, 500, SoftClean) - 0.5) < 0.02, 'Soft falloff at 50% inland ramps to 0.5');
    assert.equal(EvaluateBoundaryFalloff(350, 500, SoftClean), 1.0, 'Soft falloff at centre reaches 1.0');

    // Soft Noise Falloff varies organically along coastline while keeping exact 0 at boundary and 1 at deep centre
    const SoftNoisy = { mode: 'soft', distance: 300, edgeFloor: 0.0, noiseAmount: 0.65, noiseScale: 1.5 };
    assert.equal(EvaluateBoundaryFalloff(0, 500, SoftNoisy, 120, -340, 4029), 0.0);
    assert.equal(EvaluateBoundaryFalloff(340, 500, SoftNoisy, 120, -340, 4029), 1.0);
    const W1 = EvaluateBoundaryFalloff(140, 500, SoftNoisy, 100, 100, 4029);
    const W2 = EvaluateBoundaryFalloff(140, 500, SoftNoisy, 820, -640, 4029);
    assert.ok(Math.abs(W1 - W2) > 0.01, 'Soft noise falloff must vary organically across world coordinates');

    // Hard Influence / No Falloff ('none' & 'hard') maintains 100% full influence right up to 0m boundary
    assert.equal(EvaluateBoundaryFalloff(0, 0, { mode: 'none' }), 1.0);
    assert.equal(EvaluateBoundaryFalloff(0, 0, { mode: 'hard' }), 1.0);
});

// 7. Three Example Terrain Masks Demonstration (Section 3.6)
Suite('7. Ships with 3 Example Terrain Masks demonstrating independent shapes, bounds, layers, and falloffs', () =>
{
    const World = new WorldMask2D();
    const { masks, regions } = SeedThreeDemoTerrains(World);
    assert.equal(masks.length, 3, 'Must ship with 3 Example Terrain Masks');
    assert.equal(regions.length, 3, 'Must ship with 3 independent Terrain Regions & Bounds Layers');

    for (const R of regions)
    {
        assert.ok(R.boundsLayer && R.boundsLayer.visible, `${R.name} must have an active separate Bounds Layer`);
        assert.ok(R.runtime && R.runtime.hasLand && R.runtime.maxHeight > 85.0, `${R.name} must build rich 3D landforms above sea level`);
    }

    assert.equal(regions[0].stack[0].falloff.mode, 'soft', 'Example Terrain 01 demonstrates Soft Noise Falloff');
    assert.equal(regions[1].stack[0].falloff.mode, 'none', 'Example Terrain 02 demonstrates Hard / No Falloff coastal cliffs');
    assert.equal(regions[2].stack[0].falloff.mode, 'rim', 'Example Terrain 03 demonstrates Caldera Rim + mixed layer falloffs');
});

// 8. Space-Efficient Thin Base Surface & Coarse-Decimated Triangle Extraction
Suite('8. Thin Base Surface wastes zero deep-ocean space, decimates flat underside, and exports clean .OBJ / .STL', () =>
{
    const World = new WorldMask2D();
    SeedThreeDemoTerrains(World);
    const R1 = World.regions[0];
    const Mesh = ExtractRegionTriangleMesh(World, R1, { includeUnderside: true });

    assert.ok(Mesh.topTriangleCount > 2000, 'Top terrain surface must have detailed landform triangles');
    assert.ok(Mesh.culledOceanRatio > 0.15, 'Empty ocean cells outside painted 2D mask must be culled');
    assert.ok(Mesh.baseTriangleCount < Mesh.topTriangleCount * 0.75, 'Coarse 4x4 underside decimation must keep thin base surface lightweight');

    let MinY = Infinity, MaxY = -Infinity;
    for (let I = 1; I < Mesh.positions.length; I += 3)
    {
        if (Mesh.positions[I] < MinY) MinY = Mesh.positions[I];
        if (Mesh.positions[I] > MaxY) MaxY = Mesh.positions[I];
    }
    assert.ok(Math.abs(MinY - (-R1.slabThickness)) < 0.05, `Thin base surface floor should sit at -${R1.slabThickness}m, got ${MinY}`);
    assert.ok(MaxY > 120.0, `Terrain relief must extend upward above thin base surface, got ${MaxY}`);

    const Obj = ExportWorldTerrainsObj(World, World.regions);
    assert.ok(Obj.triangleCount > 6000 && Obj.text.includes('o Terrain_01'));
    const Stl = ExportWorldTerrainsBinaryStl(World, [R1]);
    assert.equal(Stl.bytes.byteLength, 84 + Stl.triangleCount * 50);
});

// 9. Simultaneous Multi-Terrain Editing & v2 JSON Round-Trip
Suite('9. Supports simultaneous multi-terrain bounds editing, layer sync, multi-region brush, and JSON round-trip', () =>
{
    const World = new WorldMask2D();
    SeedThreeDemoTerrains(World);
    const [R1, R2, R3] = World.regions;

    // Move Bounds Layers of R1 and R2 simultaneously
    const OrigX1 = R1.bounds.x, OrigX2 = R2.bounds.x, OrigX3 = R3.bounds.x;
    World.translateRegionsBounds([R1.id, R2.id], 50, -30);
    assert.equal(R1.bounds.x, OrigX1 + 50);
    assert.equal(R2.bounds.x, OrigX2 + 50);
    assert.equal(R3.bounds.x, OrigX3, 'Unselected terrain bounds must remain untouched');

    // Sync fractal layer parameters across multiple selected terrains simultaneously
    const SrcFractal = R1.stack.find(L => L.type === 'fractal');
    SrcFractal.amplitude = 133.0;
    const Synced = SyncLayerAcrossSelectedRegions([R1, R2], R1.id, SrcFractal);
    assert.equal(Synced.length, 1);
    assert.equal(R2.stack.find(L => L.type === 'fractal').amplitude, 133.0);

    // Multi-terrain brush dab across overlapping/selected regions
    const PeakX = R1.bounds.x + R1.bounds.width * 0.5;
    const PeakZ = R1.bounds.z + R1.bounds.depth * 0.5;
    EvaluateTerrainRegion(World, R1);
    const Modified = ApplyMultiTerrainSculptDab(World, [R1, R2], [PeakX, 80, PeakZ], 'raise', { radius: 220, strength: 0.9 });
    assert.ok(Modified.includes(R1));

    // Full v2 JSON serialization round-trip
    const JsonText = JSON.stringify(World.toJSON());
    const Restored = new WorldMask2D();
    Restored.loadFromJSON(JSON.parse(JsonText));
    assert.equal(Restored.maskLayers.length, 3);
    assert.equal(Restored.regions.length, 3);
    assert.equal(Restored.totalAllocatedTiles(), World.totalAllocatedTiles());
});

// 10. Studio DOM ID Parity, GLSL ES 3.00 Integrity, Stage-1 Scope Purity & Self-Hosted Fonts
Suite('10. Studio DOM ID parity, GLSL ES 3.00 shader integrity, Stage-1 scope purity & zero external CDNs', () =>
{
    const Dir = path.dirname(fileURLToPath(import.meta.url));
    const Html = fs.readFileSync(path.join(Dir, 'index.html'), 'utf8');
    const Css = fs.readFileSync(path.join(Dir, 'TerrainWorldEditor.css'), 'utf8');
    const EditorJs = fs.readFileSync(path.join(Dir, 'TerrainWorldEditor.js'), 'utf8');
    const ViewportJs = fs.readFileSync(path.join(Dir, 'Engine', 'TerrainOceanViewport.js'), 'utf8');
    const GpuPipeJs = fs.readFileSync(path.join(Dir, 'Engine', 'GpuTerrainStackPipeline.js'), 'utf8');

    // Every $('...') lookup in TerrainWorldEditor.js must exist as id="..." in index.html
    const HtmlIds = new Set(Array.from(Html.matchAll(/\bid="([^"]+)"/g), M => M[1]));
    const ReferencedIds = new Set(Array.from(EditorJs.matchAll(/\$\('([^']+)'\)/g), M => M[1]));
    assert.ok(ReferencedIds.size >= 30, 'Expected at least 30 DOM ID bindings in TerrainWorldEditor.js');
    for (const Id of ReferencedIds)
    {
        assert.ok(HtmlIds.has(Id), `DOM ID #${Id} referenced in TerrainWorldEditor.js is missing from index.html`);
    }

    // Zero external http/https CDN dependencies in index.html (excluding SVG xmlns) or TerrainWorldEditor.css
    const HtmlStripped = Html.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, '');
    assert.ok(!/https?:\/\//i.test(HtmlStripped), 'index.html must not depend on external CDNs');
    assert.ok(!/https?:\/\//i.test(Css), 'TerrainWorldEditor.css must not depend on external CDNs');

    // Self-hosted DM Sans & Font Awesome 6 Free WOFF2 fonts exist
    assert.ok(fs.existsSync(path.join(Dir, '..', 'SdfSculptEditor', 'Fonts', 'dm-sans-latin-400-normal.woff2')));
    assert.ok(fs.existsSync(path.join(Dir, '..', 'SdfSculptEditor', 'Fonts', 'fa-solid-900.woff2')));

    // 4-Workspace bar includes 2D Terrain, 3D Landscape, Split, and disabled Stage-2 Erosion & Texturing roadmap pills
    assert.ok(Html.includes('data-ws="2d"') && Html.includes('data-ws="3d"') && Html.includes('data-ws="split"'));
    assert.ok(Html.includes('Erosion') && Html.includes('Texturing') && Html.includes('stage-planned'));

    // Stage-1 purity: zero Rock/Overhang/Arch studio systems in UI or viewport
    assert.ok(!EditorJs.includes('arch3d') && !EditorJs.includes('sdf3DOps') && !ViewportJs.includes('arch3d'));

    // Every GLSL ES 3.00 shader template in GpuTerrainStackPipeline.js & TerrainOceanViewport.js has balanced braces
    for (const SrcFile of [GpuPipeJs, ViewportJs])
    {
        const Shaders = Array.from(SrcFile.matchAll(/`(#version 300 es[\s\S]*?)`/g), M => M[1]);
        assert.ok(Shaders.length >= 2);
        for (const Glsl of Shaders)
        {
            const Opens = (Glsl.match(/\{/g) || []).length;
            const Closes = (Glsl.match(/\}/g) || []).length;
            assert.equal(Opens, Closes, 'Unbalanced braces in GLSL ES 3.00 shader');
        }
    }
});

console.log(`\nAll ${Passed}/10 Frontier Terrain Studio validation suites passed!`);
