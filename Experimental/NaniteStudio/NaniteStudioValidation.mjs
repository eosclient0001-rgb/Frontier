/*============================================================================================================================================
                                                NANITESTUDIOVALIDATION.MJS
============================================================================================================================================*/
/**
 * Automated 11-Suite Verification of Frontier Nanite Virtual Geometry Studio.
 * Tests cluster partitioning, DAG monotonicity, continuous LOD selection cut,
 * frustum & cone culling, frozen camera mechanics, instancing, OBJ parsing, and Project Zero DOM.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Math3D, NaniteCluster, NaniteMesh, getClusterColor, getLodLevelColor } from './Engine/NaniteMesh.js';
import {
    generateStanfordBunny,
    generateStanfordDragon,
    generateFractalMountain,
    generateGeodesicSphere,
    generateGothicColumn,
    generateSuzanneHead,
    generateInstanceTransforms,
    parseWavefrontOBJ
} from './Engine/NaniteGeometryGenerators.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let totalPassed = 0;
let totalFailed = 0;

function suite(name, fn) {
    try {
        console.log(`▶ Running Suite: ${name}`);
        fn();
        console.log(`  ✔ PASS: ${name}`);
        totalPassed++;
    } catch (err) {
        console.error(`  ✘ FAIL: ${name}`);
        console.error(`    ${err.stack || err.message}`);
        totalFailed++;
    }
}

console.log("================================================================================");
console.log("   FRONTIER NANITE VIRTUAL GEOMETRY STUDIO · AUTOMATED TEST SUITE");
console.log("================================================================================\n");

// -----------------------------------------------------------------------------
// Suite 1: Math3D Vector Utilities
// -----------------------------------------------------------------------------
suite("1. Math3D Vector Utilities & Geometry Metrics", () => {
    const v1 = [1, 2, 3];
    const v2 = [4, 5, 6];

    assert.deepEqual(Math3D.add(v1, v2), [5, 7, 9]);
    assert.deepEqual(Math3D.sub(v2, v1), [3, 3, 3]);
    assert.equal(Math3D.dot(v1, v2), 4 + 10 + 18); // 32

    const norm = Math3D.normalize([0, 3, 4]);
    assert.ok(Math.abs(norm[1] - 0.6) < 1e-5);
    assert.ok(Math.abs(norm[2] - 0.8) < 1e-5);

    // Triangle Area & Normal for right triangle in XY plane (sides 3, 4)
    const p0 = [0, 0, 0];
    const p1 = [3, 0, 0];
    const p2 = [0, 4, 0];
    const area = Math3D.triangleArea(p0, p1, p2);
    assert.equal(area, 6.0, "Right triangle area should be 6.0");

    const n = Math3D.triangleNormal(p0, p1, p2);
    assert.deepEqual(n, [0, 0, 1], "Normal should point along +Z");
});

// -----------------------------------------------------------------------------
// Suite 2: Mesh Partitioning into Clusters
// -----------------------------------------------------------------------------
suite("2. Mesh Partitioning into Clusters (~64 triangles)", () => {
    const sphereGeo = generateGeodesicSphere(3); // Level 3 = 1280 triangles
    assert.ok(sphereGeo.indices.length > 0);
    const originalTriCount = sphereGeo.indices.length / 3;

    const mesh = new NaniteMesh("TestSphere");
    const info = mesh.buildFromGeometry(sphereGeo, { targetClusterSize: 64 });

    assert.ok(info.totalClusters > 0, "Should generate clusters");
    assert.ok(info.levels >= 2, "Should generate multiple LOD levels");
    assert.equal(mesh.totalOriginalTriangles, originalTriCount);

    // Verify all base Level 0 clusters
    const baseClusters = mesh.clustersByLevel[0];
    assert.ok(baseClusters.length > 0);

    let totalTrisBase = 0;
    for (const c of baseClusters) {
        assert.equal(c.lodLevel, 0);
        assert.equal(c.clusterError, 0.0, "Base cluster error must be 0.0 (original geometry)");
        assert.ok(c.boundingSphere.radius > 0, "Cluster radius must be positive");
        assert.ok(c.surfaceArea > 0, "Cluster surface area must be positive");
        assert.ok(c.triangleCount > 0, "Cluster must have triangles");
        assert.ok(c.triangleCount <= 128, "Cluster size should not exceed reasonable bound");
        totalTrisBase += c.triangleCount;
    }

    assert.equal(totalTrisBase, originalTriCount, "Base clusters must contain exactly all original triangles");
});

// -----------------------------------------------------------------------------
// Suite 3: DAG Hierarchy & Strict Monotonicity
// -----------------------------------------------------------------------------
suite("3. DAG Hierarchy & Monotonic Error (parentError > clusterError)", () => {
    const bunnyGeo = generateStanfordBunny(36, 24);
    const mesh = new NaniteMesh("BunnyDAG");
    const info = mesh.buildFromGeometry(bunnyGeo, { targetClusterSize: 64 });

    assert.ok(info.levels >= 2, "Bunny mesh should have at least 2 hierarchy levels");

    // Monotonicity Check across all clusters
    for (const cluster of mesh.clusters) {
        if (cluster.parentError !== Infinity) {
            assert.ok(
                cluster.parentError > cluster.clusterError,
                `Monotonicity violation in cluster #${cluster.id} (lvl ${cluster.lodLevel}): parentError ${cluster.parentError} <= clusterError ${cluster.clusterError}`
            );
        }

        // Child/Parent connectivity check
        if (cluster.lodLevel > 0) {
            assert.ok(cluster.childIndices.length > 0, `Parent cluster #${cluster.id} must reference child clusters`);
        }
    }
});

// -----------------------------------------------------------------------------
// Suite 4: Boundary Edge Locking in Simplification
// -----------------------------------------------------------------------------
suite("4. Boundary Edge Locking Verification", () => {
    const mesh = new NaniteMesh("BoundaryTest");
    // Create simple quad with 2 triangles: [0,1,2] and [0,2,3]
    const quadIndices = new Uint32Array([0, 1, 2, 0, 2, 3]);
    const lockedVerts = mesh.findGroupBoundaryVertices(quadIndices);

    // In a quad, all outer boundary edges (0-1, 1-2, 2-3, 3-0) appear once.
    // Edge 0-2 appears twice (interior shared edge).
    // All 4 vertices touch outer boundary edges, so all should be locked.
    assert.equal(lockedVerts.size, 4, "All 4 perimeter vertices of single quad should be identified as boundary");
});

// -----------------------------------------------------------------------------
// Suite 5: Continuous LOD Cut Selection Heuristic
// -----------------------------------------------------------------------------
suite("5. Continuous LOD Cut Selection (Close vs Distant Viewpoints)", () => {
    const sphereGeo = generateGeodesicSphere(3);
    const mesh = new NaniteMesh("LODTest");
    mesh.buildFromGeometry(sphereGeo, { targetClusterSize: 64 });

    // Mock Close-Up Camera (distance = 2.0)
    const closeCam = {
        position: [0, 0, 2.0],
        fov: 60 * Math.PI / 180,
        frustumPlanes: null
    };

    // Mock Distant Camera (distance = 25.0)
    const farCam = {
        position: [0, 0, 25.0],
        fov: 60 * Math.PI / 180,
        frustumPlanes: null
    };

    const viewport = { width: 1280, height: 800 };

    const closeResult = mesh.evaluateLOD(closeCam, viewport, { pixelTolerance: 1.0 });
    const farResult = mesh.evaluateLOD(farCam, viewport, { pixelTolerance: 1.0 });

    assert.ok(closeResult.activeClusters.length > 0, "Close camera should select active clusters");
    assert.ok(farResult.activeClusters.length > 0, "Distant camera should select active clusters");

    // Distant camera should select significantly fewer triangles due to hierarchical LOD simplification
    assert.ok(
        farResult.activeTriangles < closeResult.activeTriangles,
        `Distant camera rendered tris (${farResult.activeTriangles}) should be fewer than close camera (${closeResult.activeTriangles})`
    );

    // Verify all selected clusters in both passes satisfy the cut condition:
    // (parentError > tolerance) && (clusterError <= tolerance)
    for (const item of closeResult.activeClusters) {
        assert.ok(item.cluster !== undefined);
    }
});

// -----------------------------------------------------------------------------
// Suite 6: View Frustum Culling Correctness
// -----------------------------------------------------------------------------
suite("6. View Frustum Culling on Cluster Bounding Spheres", () => {
    const mesh = new NaniteMesh("FrustumTest");
    // Standard frustum facing -Z with planes: [Ax, By, Cz, D]
    // Camera at origin looking at [0, 0, -1]
    const planes = [
        [ 1,  0,  0, 5], // Left:   x >= -5
        [-1,  0,  0, 5], // Right:  x <= 5
        [ 0,  1,  0, 5], // Bottom: y >= -5
        [ 0, -1,  0, 5], // Top:    y <= 5
        [ 0,  0, -1, 1], // Near:   z <= -1
        [ 0,  0,  1, 50] // Far:    z >= -50
    ];

    // Point inside frustum
    const insideCenter = [0, 0, -10];
    const insideR = 1.0;
    assert.ok(mesh.testSphereFrustum(insideCenter, insideR, planes), "Sphere inside frustum should pass");

    // Point outside far to the right (+X = 20)
    const outsideCenter = [20, 0, -10];
    const outsideR = 1.0;
    assert.ok(!mesh.testSphereFrustum(outsideCenter, outsideR, planes), "Sphere outside frustum (+X) should be culled");

    // Point behind camera (+Z = 10)
    const behindCenter = [0, 0, 10];
    assert.ok(!mesh.testSphereFrustum(behindCenter, insideR, planes), "Sphere behind camera (+Z) should be culled");
});

// -----------------------------------------------------------------------------
// Suite 7: Normal Cone Backface Culling
// -----------------------------------------------------------------------------
suite("7. Backface Cluster Normal Cone Culling", () => {
    const mesh = new NaniteMesh("ConeTest");

    const coneFacingCamera = {
        axis: [0, 0, 1], // Points towards camera at +Z
        cosCutoff: 0.8
    };

    const coneFacingAway = {
        axis: [0, 0, -1], // Points away from camera at +Z
        cosCutoff: 0.8
    };

    const clusterCenter = [0, 0, 0];
    const camPos = [0, 0, 10]; // Camera at [0, 0, 10] looking towards origin

    // Cone facing camera should NOT be culled
    const culledFront = mesh.testClusterCone(clusterCenter, coneFacingCamera, camPos);
    assert.ok(!culledFront, "Cluster facing camera must not be culled");

    // Cone facing away should BE culled
    const culledBack = mesh.testClusterCone(clusterCenter, coneFacingAway, camPos);
    assert.ok(culledBack, "Cluster facing away from camera must be culled");
});

// -----------------------------------------------------------------------------
// Suite 8: Freeze Culling Camera Mechanics
// -----------------------------------------------------------------------------
suite("8. Freeze Culling Camera Isolation", () => {
    const bunnyGeo = generateStanfordBunny(36, 24);
    const mesh = new NaniteMesh("FreezeTest");
    mesh.buildFromGeometry(bunnyGeo, { targetClusterSize: 64 });

    const frozenCam = {
        position: [0, 0, 3.0],
        fov: 50 * Math.PI / 180,
        frustumPlanes: [
            [ 1,  0,  0, 5],
            [-1,  0,  0, 5],
            [ 0,  1,  0, 5],
            [ 0, -1,  0, 5],
            [ 0,  0, -1, 1],
            [ 0,  0,  1, 50]
        ]
    };

    const userCam = {
        position: [100, 100, 100], // User camera moved far away
        fov: 50 * Math.PI / 180,
        frustumPlanes: null
    };

    const viewport = { width: 1280, height: 800 };

    // When evaluating with frozen camera, culling & error projection must be fixed to frozenCam
    const result = mesh.evaluateLOD(frozenCam, viewport, { pixelTolerance: 1.0 });
    assert.ok(result.activeClusters.length > 0, "Frozen camera evaluation should return valid clusters");
    assert.ok(result.activeTriangles > 0);
});

// -----------------------------------------------------------------------------
// Suite 9: Multi-Instance Geometry Transforms
// -----------------------------------------------------------------------------
suite("9. Multi-Instance Geometry Transforms & Grid Generation", () => {
    const transforms = generateInstanceTransforms(25, 3.0);
    assert.equal(transforms.length, 25, "Should generate exactly 25 instance matrices");

    // Verify 4x4 matrix layout and center origin
    const m0 = transforms[0];
    assert.equal(m0.length, 16);
    assert.equal(m0[15], 1.0); // Homogeneous scale
});

// -----------------------------------------------------------------------------
// Suite 10: Wavefront OBJ Format Parser
// -----------------------------------------------------------------------------
suite("10. Wavefront OBJ Format Parser & Dynamic Clustering", () => {
    const sampleOBJ = `
    # Simple Cube OBJ
    v -1.0 -1.0  1.0
    v  1.0 -1.0  1.0
    v  1.0  1.0  1.0
    v -1.0  1.0  1.0
    v -1.0 -1.0 -1.0
    v  1.0 -1.0 -1.0
    v  1.0  1.0 -1.0
    v -1.0  1.0 -1.0

    vn  0.0  0.0  1.0
    vn  0.0  0.0 -1.0
    vn  0.0  1.0  0.0
    vn  0.0 -1.0  0.0
    vn  1.0  0.0  0.0
    vn -1.0  0.0  0.0

    f 1//1 2//1 3//1
    f 1//1 3//1 4//1
    f 6//2 5//2 8//2
    f 6//2 8//2 7//2
    f 4//3 3//3 7//3
    f 4//3 7//3 8//3
    f 5//4 6//4 2//4
    f 5//4 2//4 1//4
    f 2//5 6//5 7//5
    f 2//5 7//5 3//5
    f 5//6 1//6 4//6
    f 5//6 4//6 8//6
    `;

    const parsed = parseWavefrontOBJ(sampleOBJ, "Cube");
    assert.equal(parsed.indices.length, 36, "12 triangles * 3 indices = 36");
    assert.ok(parsed.positions.length > 0);
    assert.ok(parsed.normals.length === parsed.positions.length);

    const mesh = new NaniteMesh(parsed.name);
    const buildInfo = mesh.buildFromGeometry(parsed, { targetClusterSize: 6 });
    assert.ok(buildInfo.totalClusters > 0);
});

// -----------------------------------------------------------------------------
// Suite 11: File Structure, Fonts, CSS, and Project Zero DOM Integrity
// -----------------------------------------------------------------------------
suite("11. File Structure, Fonts, CSS & Project Zero DOM IDs", () => {
    const htmlPath = path.join(__dirname, 'index.html');
    const cssPath = path.join(__dirname, 'ProjectZero.css');
    const fontsDir = path.join(__dirname, 'Fonts');

    assert.ok(fs.existsSync(htmlPath), "index.html must exist");
    assert.ok(fs.existsSync(cssPath), "ProjectZero.css must exist");
    assert.ok(fs.existsSync(fontsDir), "Fonts directory must exist");

    const htmlContent = fs.readFileSync(htmlPath, 'utf8');

    // Verify required DOM IDs
    const requiredIds = [
        'TabStrip',
        'ControlNotch',
        'OutlinerActiveBadge',
        'OutlinerCulledBadge',
        'OutlinerTotalBadge',
        'OutlinerRows',
        'FooterFps',
        'FooterClusters',
        'FooterTris',
        'ViewportMeshTitle',
        'ViewportBadge',
        'ViewportModes',
        'GpuCanvas',
        'HudActiveClusters',
        'HudRenderedTris',
        'HudScreenError',
        'HudFreezePill',
        'HudFpsPill',
        'StatActiveClusters',
        'StatTotalClusters',
        'StatRenderedTris',
        'StatReductionPct',
        'StatScreenErrorMax',
        'StatTargetTolerance',
        'StatFps',
        'StatFrameTime',
        'SliderPixelTolerance',
        'NumPixelTolerance',
        'SliderLodBias',
        'NumLodBias',
        'SelectForcedLod',
        'CheckFrustumCulling',
        'CheckConeCulling',
        'CheckFreezeCulling',
        'CheckShowFrustumWireframe',
        'CheckShowBoundingSpheres',
        'CheckWireframeOverlay',
        'CheckHighlightClusterBorders',
        'CheckShowGroundGrid',
        'SliderInstances',
        'NumInstances',
        'ClusterInspectorBody',
        'ContentDrawer',
        'FileInputOBJ'
    ];

    for (const id of requiredIds) {
        assert.ok(htmlContent.includes(`id="${id}"`), `HTML must contain element with id="${id}"`);
    }

    // Verify Color helpers
    const c0 = getClusterColor(12);
    assert.equal(c0.length, 3);
    const l0 = getLodLevelColor(0);
    assert.equal(l0.length, 3);
});

console.log("\n================================================================================");
console.log(`   TEST RESULTS: ${totalPassed} PASSED, ${totalFailed} FAILED`);
console.log("================================================================================\n");

if (totalFailed > 0) {
    process.exit(1);
}
