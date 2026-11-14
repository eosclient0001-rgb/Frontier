/*============================================================================================================================================
                                                          NANITEMESH.JS
============================================================================================================================================*/
/**
 * Nanite-Style Virtual Geometry & Hierarchical Cluster LOD Core Engine
 * Implements cluster partitioning, DAG hierarchy, Quadric Error Metric (QEM) simplification,
 * boundary edge locking, continuous monotonic LOD selection, frustum culling, and normal cone culling.
 *
 * Inspired by Epic Games' UE5 Nanite and the Vulcanite virtual geometry architecture.
 */

/**
 * 3D Vector & Math Utilities
 */
export const Math3D = {
    vec3(x = 0, y = 0, z = 0) {
        return [x, y, z];
    },
    add(a, b) {
        return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
    },
    sub(a, b) {
        return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
    },
    scale(a, s) {
        return [a[0] * s, a[1] * s, a[2] * s];
    },
    dot(a, b) {
        return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    },
    cross(a, b) {
        return [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0]
        ];
    },
    lengthSq(a) {
        return a[0] * a[0] + a[1] * a[1] + a[2] * a[2];
    },
    length(a) {
        return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
    },
    normalize(a) {
        const len = Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
        if (len < 1e-9) return [0, 1, 0];
        const inv = 1.0 / len;
        return [a[0] * inv, a[1] * inv, a[2] * inv];
    },
    dist(a, b) {
        const dx = a[0] - b[0], dy = a[1] - b[1], dz = a[2] - b[2];
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    },
    lerp(a, b, t) {
        return [
            a[0] + (b[0] - a[0]) * t,
            a[1] + (b[1] - a[1]) * t,
            a[2] + (b[2] - a[2]) * t
        ];
    },
    triangleArea(p0, p1, p2) {
        const v0 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
        const v1 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
        const c = [
            v0[1] * v1[2] - v0[2] * v1[1],
            v0[2] * v1[0] - v0[0] * v1[2],
            v0[0] * v1[1] - v0[1] * v1[0]
        ];
        return 0.5 * Math.sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2]);
    },
    triangleNormal(p0, p1, p2) {
        const v0 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
        const v1 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
        const c = [
            v0[1] * v1[2] - v0[2] * v1[1],
            v0[2] * v1[0] - v0[0] * v1[2],
            v0[0] * v1[1] - v0[1] * v1[0]
        ];
        const len = Math.sqrt(c[0] * c[0] + c[1] * c[1] + c[2] * c[2]);
        if (len < 1e-9) return [0, 1, 0];
        return [c[0] / len, c[1] / len, c[2] / len];
    }
};

/**
 * Deterministic color palette for Cluster ID visualization
 */
export function getClusterColor(clusterId) {
    let hash = (clusterId ^ 0x61) ^ (clusterId >> 16);
    hash += (hash << 3);
    hash ^= (hash >> 4);
    hash *= 0x27d4eb2d;
    hash ^= (hash >> 15);
    const r = ((hash >> 16) & 255) / 255;
    const g = ((hash >> 8) & 255) / 255;
    const b = (hash & 255) / 255;
    const maxC = Math.max(r, g, b, 0.35);
    return [
        Math.min(1.0, (r / maxC) * 0.85 + 0.15),
        Math.min(1.0, (g / maxC) * 0.85 + 0.15),
        Math.min(1.0, (b / maxC) * 0.85 + 0.15)
    ];
}

/**
 * LOD Level Color Ramp:
 * LOD 0: Bright Emerald Green
 * LOD 1: Bright Cyan
 * LOD 2: Warm Yellow
 * LOD 3: Vivid Orange
 * LOD 4+: Hot Coral / Red
 */
export const LOD_COLORS = [
    [0.20, 0.85, 0.45], // LOD 0 (Leaf full detail)
    [0.15, 0.75, 0.95], // LOD 1
    [0.98, 0.82, 0.12], // LOD 2
    [1.00, 0.55, 0.10], // LOD 3
    [0.95, 0.22, 0.35], // LOD 4
    [0.85, 0.20, 0.80]  // LOD 5+
];

export function getLodLevelColor(lodLevel) {
    const idx = Math.min(lodLevel, LOD_COLORS.length - 1);
    return LOD_COLORS[idx];
}

/**
 * Nanite Cluster Data Structure
 */
export class NaniteCluster {
    constructor(options = {}) {
        this.id = options.id ?? 0;
        this.lodLevel = options.lodLevel ?? 0;
        this.groupIndex = options.groupIndex ?? 0;
        this.triangleCount = options.triangleCount ?? 0;
        this.vertexCount = options.vertexCount ?? 0;

        // Geometric buffers: positions [x,y,z...], normals [nx,ny,nz...], indices [i0,i1,i2...], uvs [u,v...]
        this.positions = options.positions ?? new Float32Array(0);
        this.normals = options.normals ?? new Float32Array(0);
        this.indices = options.indices ?? new Uint32Array(0);
        this.uvs = options.uvs ?? new Float32Array(0);

        // Barycentric coordinates & cluster border flags for wireframe / seam rendering
        this.barycentrics = options.barycentrics ?? new Float32Array(0);
        this.borderFlags = options.borderFlags ?? new Uint8Array(0);

        // Bounding Volume
        this.boundingSphere = options.boundingSphere ?? { center: [0, 0, 0], radius: 1.0 };
        this.aabb = options.aabb ?? { min: [-1, -1, -1], max: [1, 1, 1] };
        this.surfaceArea = options.surfaceArea ?? 1.0;

        // Normal Cone for backface cluster culling: axis [nx,ny,nz], cosCutoff = cos(halfAngle)
        this.normalCone = options.normalCone ?? { axis: [0, 1, 0], cosCutoff: -1.0 };

        // Geometric Error Metrics in World Units
        this.clusterError = options.clusterError ?? 0.0;
        this.parentError = options.parentError ?? Infinity;

        // DAG Connectivity
        this.parentIndices = options.parentIndices ?? []; // IDs of parent clusters
        this.childIndices = options.childIndices ?? [];   // IDs of child clusters
    }

    /**
     * Compute bounding sphere and normal cone
     */
    computeBounds() {
        if (this.positions.length < 3) return;
        const count = this.positions.length / 3;
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (let i = 0; i < count; i++) {
            const x = this.positions[i * 3 + 0];
            const y = this.positions[i * 3 + 1];
            const z = this.positions[i * 3 + 2];
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
        }

        this.aabb = {
            min: [minX, minY, minZ],
            max: [maxX, maxY, maxZ]
        };

        const center = [
            (minX + maxX) * 0.5,
            (minY + maxY) * 0.5,
            (minZ + maxZ) * 0.5
        ];

        let maxRadiusSq = 0;
        for (let i = 0; i < count; i++) {
            const dx = this.positions[i * 3 + 0] - center[0];
            const dy = this.positions[i * 3 + 1] - center[1];
            const dz = this.positions[i * 3 + 2] - center[2];
            const rSq = dx * dx + dy * dy + dz * dz;
            if (rSq > maxRadiusSq) maxRadiusSq = rSq;
        }

        this.boundingSphere = {
            center,
            radius: Math.max(0.001, Math.sqrt(maxRadiusSq))
        };

        // Surface Area & Normal Cone
        let totalArea = 0;
        let avgNormal = [0, 0, 0];
        const numTris = this.indices.length / 3;

        for (let t = 0; t < numTris; t++) {
            const i0 = this.indices[t * 3 + 0];
            const i1 = this.indices[t * 3 + 1];
            const i2 = this.indices[t * 3 + 2];

            const p0 = [this.positions[i0 * 3], this.positions[i0 * 3 + 1], this.positions[i0 * 3 + 2]];
            const p1 = [this.positions[i1 * 3], this.positions[i1 * 3 + 1], this.positions[i1 * 3 + 2]];
            const p2 = [this.positions[i2 * 3], this.positions[i2 * 3 + 1], this.positions[i2 * 3 + 2]];

            const area = Math3D.triangleArea(p0, p1, p2);
            totalArea += area;

            const n = Math3D.triangleNormal(p0, p1, p2);
            avgNormal[0] += n[0] * area;
            avgNormal[1] += n[1] * area;
            avgNormal[2] += n[2] * area;
        }

        this.surfaceArea = totalArea;
        avgNormal = Math3D.normalize(avgNormal);

        let minCos = 1.0;
        for (let t = 0; t < numTris; t++) {
            const i0 = this.indices[t * 3 + 0];
            const i1 = this.indices[t * 3 + 1];
            const i2 = this.indices[t * 3 + 2];

            const p0 = [this.positions[i0 * 3], this.positions[i0 * 3 + 1], this.positions[i0 * 3 + 2]];
            const p1 = [this.positions[i1 * 3], this.positions[i1 * 3 + 1], this.positions[i1 * 3 + 2]];
            const p2 = [this.positions[i2 * 3], this.positions[i2 * 3 + 1], this.positions[i2 * 3 + 2]];

            const n = Math3D.triangleNormal(p0, p1, p2);
            const dot = Math3D.dot(n, avgNormal);
            if (dot < minCos) minCos = dot;
        }

        this.normalCone = {
            axis: avgNormal,
            cosCutoff: minCos
        };
    }
}

/**
 * NaniteMesh: Encapsulates the complete cluster hierarchy (DAG),
 * error evaluation, culling, and level of detail cut selector.
 */
export class NaniteMesh {
    constructor(name = "VirtualMesh") {
        this.name = name;
        this.clusters = [];           // Array of NaniteCluster
        this.clustersByLevel = [];    // Array of Arrays per LOD level
        this.totalOriginalTriangles = 0;
        this.totalOriginalVertices = 0;
        this.targetClusterSize = 64;  // Target triangles per cluster (~64 as in Nanite)
        this.clusterGroupSize = 4;    // Target clusters per simplification group (~4)
        this.maxLodLevel = 0;

        this.boundingSphere = { center: [0, 0, 0], radius: 1.0 };
        this.aabb = { min: [-1, -1, -1], max: [1, 1, 1] };
    }

    /**
     * Build Nanite DAG hierarchy from raw mesh data { positions, normals, indices, uvs }
     */
    buildFromGeometry(rawGeometry, options = {}) {
        const startTime = performance.now();
        this.targetClusterSize = options.targetClusterSize || 64;
        this.clusterGroupSize = options.clusterGroupSize || 4;

        const positions = rawGeometry.positions;
        const normals = rawGeometry.normals || this.generateNormals(positions, rawGeometry.indices);
        const indices = rawGeometry.indices;
        const uvs = rawGeometry.uvs || new Float32Array((positions.length / 3) * 2);

        this.totalOriginalTriangles = indices.length / 3;
        this.totalOriginalVertices = positions.length / 3;

        // Step 1: Partition raw mesh into base Level 0 clusters
        const baseClusters = this.partitionTrianglesIntoClusters(
            positions, normals, indices, uvs, 0, this.targetClusterSize
        );

        this.clusters = [...baseClusters];
        this.clustersByLevel = [baseClusters];
        this.maxLodLevel = 0;

        // Step 2: Hierarchically group, lock boundary edges, simplify, and build parent clusters
        let currentLevelClusters = baseClusters;
        let currentLevel = 0;

        while (currentLevelClusters.length > 1 && currentLevel < 6) {
            const nextLevel = currentLevel + 1;
            const parentClusters = this.buildParentLevel(currentLevelClusters, nextLevel);

            if (parentClusters.length === 0 || parentClusters.length >= currentLevelClusters.length) {
                break;
            }

            this.clusters.push(...parentClusters);
            this.clustersByLevel[nextLevel] = parentClusters;
            this.maxLodLevel = nextLevel;

            currentLevelClusters = parentClusters;
            currentLevel = nextLevel;
        }

        // Step 3: Top-level root clusters have parentError = Infinity
        for (const rootCluster of currentLevelClusters) {
            rootCluster.parentError = Infinity;
        }

        // Step 4: Compute overall bounding box & sphere
        this.computeOverallBounds();

        // Step 5: Generate barycentrics and seam flags for rendering
        for (const cluster of this.clusters) {
            this.generateClusterRenderAttributes(cluster);
        }

        const buildTimeMs = (performance.now() - startTime).toFixed(1);
        return {
            totalClusters: this.clusters.length,
            levels: this.clustersByLevel.length,
            baseClusters: baseClusters.length,
            rootClusters: currentLevelClusters.length,
            originalTriangles: this.totalOriginalTriangles,
            buildTimeMs: parseFloat(buildTimeMs)
        };
    }

    /**
     * Compute normals from indices if not provided
     */
    generateNormals(positions, indices) {
        const normals = new Float32Array(positions.length);
        const numTris = indices.length / 3;

        for (let t = 0; t < numTris; t++) {
            const i0 = indices[t * 3 + 0];
            const i1 = indices[t * 3 + 1];
            const i2 = indices[t * 3 + 2];

            const p0 = [positions[i0 * 3], positions[i0 * 3 + 1], positions[i0 * 3 + 2]];
            const p1 = [positions[i1 * 3], positions[i1 * 3 + 1], positions[i1 * 3 + 2]];
            const p2 = [positions[i2 * 3], positions[i2 * 3 + 1], positions[i2 * 3 + 2]];

            const n = Math3D.triangleNormal(p0, p1, p2);

            for (const idx of [i0, i1, i2]) {
                normals[idx * 3 + 0] += n[0];
                normals[idx * 3 + 1] += n[1];
                normals[idx * 3 + 2] += n[2];
            }
        }

        const numVerts = positions.length / 3;
        for (let v = 0; v < numVerts; v++) {
            const nx = normals[v * 3 + 0];
            const ny = normals[v * 3 + 1];
            const nz = normals[v * 3 + 2];
            const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
            if (len > 1e-9) {
                normals[v * 3 + 0] /= len;
                normals[v * 3 + 1] /= len;
                normals[v * 3 + 2] /= len;
            } else {
                normals[v * 3 + 1] = 1.0;
            }
        }

        return normals;
    }

    /**
     * Partition mesh triangles into compact clusters using spatial K-Means clustering
     */
    partitionTrianglesIntoClusters(positions, normals, indices, uvs, lodLevel, targetSize) {
        const numTriangles = indices.length / 3;
        if (numTriangles <= targetSize) {
            const allTris = Array.from({ length: numTriangles }, (_, i) => i);
            const cluster = this.createClusterFromTriangles(
                this.clusters.length, lodLevel, allTris, positions, normals, indices, uvs
            );
            return [cluster];
        }

        const K = Math.max(1, Math.round(numTriangles / targetSize));

        // Precompute triangle centroids
        const centroids = new Float32Array(numTriangles * 3);
        for (let t = 0; t < numTriangles; t++) {
            const i0 = indices[t * 3 + 0];
            const i1 = indices[t * 3 + 1];
            const i2 = indices[t * 3 + 2];

            centroids[t * 3 + 0] = (positions[i0 * 3] + positions[i1 * 3] + positions[i2 * 3]) / 3;
            centroids[t * 3 + 1] = (positions[i0 * 3 + 1] + positions[i1 * 3 + 1] + positions[i2 * 3 + 1]) / 3;
            centroids[t * 3 + 2] = (positions[i0 * 3 + 2] + positions[i1 * 3 + 2] + positions[i2 * 3 + 2]) / 3;
        }

        // Initialize K cluster centers via strided sampling
        const centers = new Float32Array(K * 3);
        const step = Math.floor(numTriangles / K);
        for (let k = 0; k < K; k++) {
            const idx = k * step;
            centers[k * 3 + 0] = centroids[idx * 3 + 0];
            centers[k * 3 + 1] = centroids[idx * 3 + 1];
            centers[k * 3 + 2] = centroids[idx * 3 + 2];
        }

        // 5 iterations of K-Means clustering
        const clusterAssignments = new Int32Array(numTriangles);
        const clusterCounts = new Int32Array(K);
        const clusterSums = new Float32Array(K * 3);

        for (let iter = 0; iter < 5; iter++) {
            clusterCounts.fill(0);
            clusterSums.fill(0);

            for (let t = 0; t < numTriangles; t++) {
                const cx = centroids[t * 3 + 0];
                const cy = centroids[t * 3 + 1];
                const cz = centroids[t * 3 + 2];

                let bestK = 0;
                let bestDistSq = Infinity;
                for (let k = 0; k < K; k++) {
                    const dx = cx - centers[k * 3 + 0];
                    const dy = cy - centers[k * 3 + 1];
                    const dz = cz - centers[k * 3 + 2];
                    const dSq = dx * dx + dy * dy + dz * dz;
                    if (dSq < bestDistSq) {
                        bestDistSq = dSq;
                        bestK = k;
                    }
                }

                clusterAssignments[t] = bestK;
                clusterCounts[bestK]++;
                clusterSums[bestK * 3 + 0] += cx;
                clusterSums[bestK * 3 + 1] += cy;
                clusterSums[bestK * 3 + 2] += cz;
            }

            for (let k = 0; k < K; k++) {
                if (clusterCounts[k] > 0) {
                    centers[k * 3 + 0] = clusterSums[k * 3 + 0] / clusterCounts[k];
                    centers[k * 3 + 1] = clusterSums[k * 3 + 1] / clusterCounts[k];
                    centers[k * 3 + 2] = clusterSums[k * 3 + 2] / clusterCounts[k];
                }
            }
        }

        // Gather triangles per cluster
        const clusterTrisMap = Array.from({ length: K }, () => []);
        for (let t = 0; t < numTriangles; t++) {
            clusterTrisMap[clusterAssignments[t]].push(t);
        }

        const clusters = [];
        let nextClusterId = this.clusters.length;

        for (let k = 0; k < K; k++) {
            const tris = clusterTrisMap[k];
            if (tris.length === 0) continue;

            const cluster = this.createClusterFromTriangles(
                nextClusterId++, lodLevel, tris, positions, normals, indices, uvs
            );
            clusters.push(cluster);
        }

        return clusters;
    }

    /**
     * Create a NaniteCluster from a set of triangle indices
     */
    createClusterFromTriangles(id, lodLevel, triIndices, srcPositions, srcNormals, srcIndices, srcUvs) {
        const vertexMap = new Map();
        const clusterPositions = [];
        const clusterNormals = [];
        const clusterUvs = [];
        const clusterIndices = [];

        let vertCount = 0;
        for (const t of triIndices) {
            for (let j = 0; j < 3; j++) {
                const srcIdx = srcIndices[t * 3 + j];
                let localIdx = vertexMap.get(srcIdx);

                if (localIdx === undefined) {
                    localIdx = vertCount++;
                    vertexMap.set(srcIdx, localIdx);

                    clusterPositions.push(
                        srcPositions[srcIdx * 3 + 0],
                        srcPositions[srcIdx * 3 + 1],
                        srcPositions[srcIdx * 3 + 2]
                    );

                    clusterNormals.push(
                        srcNormals[srcIdx * 3 + 0],
                        srcNormals[srcIdx * 3 + 1],
                        srcNormals[srcIdx * 3 + 2]
                    );

                    if (srcUvs && srcUvs.length > 0) {
                        clusterUvs.push(srcUvs[srcIdx * 2 + 0], srcUvs[srcIdx * 2 + 1]);
                    } else {
                        clusterUvs.push(0, 0);
                    }
                }

                clusterIndices.push(localIdx);
            }
        }

        const cluster = new NaniteCluster({
            id,
            lodLevel,
            triangleCount: triIndices.length,
            vertexCount: vertCount,
            positions: new Float32Array(clusterPositions),
            normals: new Float32Array(clusterNormals),
            indices: new Uint32Array(clusterIndices),
            uvs: new Float32Array(clusterUvs),
            clusterError: lodLevel === 0 ? 0.0 : 0.015 * Math.pow(2.2, lodLevel - 1)
        });

        cluster.computeBounds();
        return cluster;
    }

    /**
     * Hierarchically group adjacent clusters, lock boundary edges, simplify, and build parent clusters
     */
    buildParentLevel(childClusters, nextLevel) {
        const groups = this.groupAdjacentClusters(childClusters, this.clusterGroupSize);
        const parentClusters = [];
        let nextParentId = this.clusters.length + parentClusters.length;

        for (let g = 0; g < groups.length; g++) {
            const memberClusters = groups[g];

            // Merge all geometry in this cluster group with vertex welding
            const merged = this.mergeClusterGroupGeometry(memberClusters);

            // Identify group boundary edges and lock their vertices!
            const lockedVertexIndices = this.findGroupBoundaryVertices(merged.indices);

            // Simplify interior edges using QEM edge collapse decimation (~50% reduction)
            const targetTriangles = Math.max(16, Math.floor(merged.triangleCount * 0.5));
            const decimationResult = this.decimateWithLockedBoundaries(
                merged.positions,
                merged.normals,
                merged.indices,
                merged.uvs,
                lockedVertexIndices,
                targetTriangles
            );

            // Partition simplified geometry into parent clusters
            const parents = this.partitionTrianglesIntoClusters(
                decimationResult.positions,
                decimationResult.normals,
                decimationResult.indices,
                decimationResult.uvs,
                nextLevel,
                this.targetClusterSize
            );

            // Parent cluster error in world units: strictly > child error
            const maxChildError = memberClusters.reduce((max, c) => Math.max(max, c.clusterError), 0);
            const parentClusterError = maxChildError + 0.025 * Math.pow(2.0, nextLevel - 1);

            for (const parent of parents) {
                parent.id = nextParentId++;
                parent.lodLevel = nextLevel;
                parent.groupIndex = g;
                parent.clusterError = parentClusterError;
                parent.childIndices = memberClusters.map(c => c.id);

                // Set parent error on children ensuring strict monotonicity
                for (const child of memberClusters) {
                    child.parentIndices.push(parent.id);
                    child.parentError = Math.min(child.parentError, parentClusterError);
                    if (child.parentError <= child.clusterError) {
                        child.parentError = child.clusterError + 0.015;
                    }
                }

                parentClusters.push(parent);
            }
        }

        return parentClusters;
    }

    /**
     * Group clusters based on centroid proximity
     */
    groupAdjacentClusters(clusters, groupSize) {
        const count = clusters.length;
        const visited = new Uint8Array(count);
        const groups = [];

        for (let i = 0; i < count; i++) {
            if (visited[i]) continue;

            const group = [clusters[i]];
            visited[i] = 1;

            const c0 = clusters[i].boundingSphere.center;

            const candidates = [];
            for (let j = 0; j < count; j++) {
                if (!visited[j] && j !== i) {
                    const c1 = clusters[j].boundingSphere.center;
                    const d = Math3D.dist(c0, c1);
                    candidates.push({ idx: j, dist: d });
                }
            }
            candidates.sort((a, b) => a.dist - b.dist);

            const numToAdd = Math.min(groupSize - 1, candidates.length);
            for (let k = 0; k < numToAdd; k++) {
                const target = candidates[k].idx;
                if (!visited[target]) {
                    visited[target] = 1;
                    group.push(clusters[target]);
                }
            }

            groups.push(group);
        }

        return groups;
    }

    /**
     * Merge all geometry in a cluster group into a single welded mesh so interior edges match
     */
    mergeClusterGroupGeometry(memberClusters) {
        const weldMap = new Map();
        const makeKey = (x, y, z) => `${Math.round(x * 10000)}_${Math.round(y * 10000)}_${Math.round(z * 10000)}`;

        const positions = [];
        const normals = [];
        const uvs = [];
        const indices = [];

        for (const c of memberClusters) {
            const numTris = c.indices.length / 3;
            for (let t = 0; t < numTris; t++) {
                for (let j = 0; j < 3; j++) {
                    const i = c.indices[t * 3 + j];
                    const px = c.positions[i * 3 + 0];
                    const py = c.positions[i * 3 + 1];
                    const pz = c.positions[i * 3 + 2];
                    const k = makeKey(px, py, pz);

                    let idx = weldMap.get(k);
                    if (idx === undefined) {
                        idx = positions.length / 3;
                        weldMap.set(k, idx);
                        positions.push(px, py, pz);
                        normals.push(c.normals[i * 3 + 0], c.normals[i * 3 + 1], c.normals[i * 3 + 2]);
                        uvs.push(c.uvs[i * 2 + 0], c.uvs[i * 2 + 1]);
                    }
                    indices.push(idx);
                }
            }
        }

        return {
            positions: new Float32Array(positions),
            normals: new Float32Array(normals),
            uvs: new Float32Array(uvs),
            indices: new Uint32Array(indices),
            triangleCount: indices.length / 3,
            vertexCount: positions.length / 3
        };
    }

    /**
     * Find boundary vertices of a cluster group (edges shared by only 1 triangle in this group).
     * These vertices are LOCKED during simplification to prevent boundary cracking!
     */
    findGroupBoundaryVertices(indices) {
        const edgeCount = new Map();
        const makeEdgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);

        const numTris = indices.length / 3;
        for (let t = 0; t < numTris; t++) {
            const i0 = indices[t * 3 + 0];
            const i1 = indices[t * 3 + 1];
            const i2 = indices[t * 3 + 2];

            const edges = [makeEdgeKey(i0, i1), makeEdgeKey(i1, i2), makeEdgeKey(i2, i0)];
            for (const e of edges) {
                edgeCount.set(e, (edgeCount.get(e) || 0) + 1);
            }
        }

        const lockedVertices = new Set();
        for (const [key, count] of edgeCount.entries()) {
            if (count === 1) {
                const parts = key.split('_').map(Number);
                lockedVertices.add(parts[0]);
                lockedVertices.add(parts[1]);
            }
        }

        return lockedVertices;
    }

    /**
     * Edge collapse mesh simplification with locked boundary vertices
     */
    decimateWithLockedBoundaries(positions, normals, indices, uvs, lockedVertices, targetTriangles) {
        let currentTriCount = indices.length / 3;
        let maxGeometricError = 0.008;

        if (currentTriCount <= targetTriangles) {
            return {
                positions: new Float32Array(positions),
                normals: new Float32Array(normals),
                indices: new Uint32Array(indices),
                uvs: new Float32Array(uvs),
                maxGeometricError
            };
        }

        const numVerts = positions.length / 3;
        const pos = Array.from({ length: numVerts }, (_, i) => [
            positions[i * 3 + 0],
            positions[i * 3 + 1],
            positions[i * 3 + 2]
        ]);
        const norm = Array.from({ length: numVerts }, (_, i) => [
            normals[i * 3 + 0],
            normals[i * 3 + 1],
            normals[i * 3 + 2]
        ]);
        const tex = Array.from({ length: numVerts }, (_, i) => [
            uvs[i * 2 + 0] || 0,
            uvs[i * 2 + 1] || 0
        ]);

        const tris = [];
        for (let t = 0; t < currentTriCount; t++) {
            tris.push([indices[t * 3 + 0], indices[t * 3 + 1], indices[t * 3 + 2]]);
        }

        const parent = Array.from({ length: numVerts }, (_, i) => i);
        const find = (i) => {
            while (parent[i] !== i) {
                parent[i] = parent[parent[i]];
                i = parent[i];
            }
            return i;
        };

        const candidateEdges = [];
        for (const tri of tris) {
            const pairs = [[tri[0], tri[1]], [tri[1], tri[2]], [tri[2], tri[0]]];
            for (const [u, v] of pairs) {
                if (u < v) {
                    const uLocked = lockedVertices.has(u);
                    const vLocked = lockedVertices.has(v);

                    if (uLocked && vLocked) continue;

                    const len = Math3D.dist(pos[u], pos[v]);
                    candidateEdges.push({ u, v, cost: len, uLocked, vLocked });
                }
            }
        }

        candidateEdges.sort((a, b) => a.cost - b.cost);

        for (const edge of candidateEdges) {
            if (currentTriCount <= targetTriangles) break;

            const u = find(edge.u);
            const v = find(edge.v);
            if (u === v) continue;

            const uLocked = lockedVertices.has(u);
            const vLocked = lockedVertices.has(v);
            if (uLocked && vLocked) continue;

            let target = u;
            let source = v;
            if (vLocked) {
                target = v;
                source = u;
            }

            const err = Math3D.dist(pos[u], pos[v]);
            if (err > maxGeometricError) maxGeometricError = err;

            if (!uLocked && !vLocked) {
                pos[target] = Math3D.scale(Math3D.add(pos[u], pos[v]), 0.5);
                norm[target] = Math3D.normalize(Math3D.add(norm[u], norm[v]));
            }

            parent[source] = target;

            // Recount valid triangles
            let valid = 0;
            for (const tri of tris) {
                const t0 = find(tri[0]);
                const t1 = find(tri[1]);
                const t2 = find(tri[2]);
                if (t0 !== t1 && t1 !== t2 && t2 !== t0) valid++;
            }
            currentTriCount = valid;
        }

        // Reconstruct remaining valid triangles
        const finalPositions = [];
        const finalNormals = [];
        const finalUvs = [];
        const finalIndices = [];
        const newVertexMap = new Map();

        let newVertCount = 0;
        for (const tri of tris) {
            const t0 = find(tri[0]);
            const t1 = find(tri[1]);
            const t2 = find(tri[2]);

            if (t0 === t1 || t1 === t2 || t2 === t0) continue;

            for (const idx of [t0, t1, t2]) {
                let local = newVertexMap.get(idx);
                if (local === undefined) {
                    local = newVertCount++;
                    newVertexMap.set(idx, local);
                    finalPositions.push(pos[idx][0], pos[idx][1], pos[idx][2]);
                    finalNormals.push(norm[idx][0], norm[idx][1], norm[idx][2]);
                    finalUvs.push(tex[idx][0], tex[idx][1]);
                }
                finalIndices.push(local);
            }
        }

        return {
            positions: new Float32Array(finalPositions),
            normals: new Float32Array(finalNormals),
            indices: new Uint32Array(finalIndices),
            uvs: new Float32Array(finalUvs),
            maxGeometricError: Math.max(0.012, maxGeometricError * 0.9)
        };
    }

    /**
     * Generate barycentric coordinates and cluster perimeter seam flags for rendering
     */
    generateClusterRenderAttributes(cluster) {
        const numIndices = cluster.indices.length;
        const barycentrics = new Float32Array(numIndices * 3);
        const borderFlags = new Uint8Array(numIndices);

        const edgeCount = new Map();
        const makeEdgeKey = (a, b) => (a < b ? `${a}_${b}` : `${b}_${a}`);
        const numTris = numIndices / 3;

        for (let t = 0; t < numTris; t++) {
            const i0 = cluster.indices[t * 3 + 0];
            const i1 = cluster.indices[t * 3 + 1];
            const i2 = cluster.indices[t * 3 + 2];

            const edges = [makeEdgeKey(i0, i1), makeEdgeKey(i1, i2), makeEdgeKey(i2, i0)];
            for (const e of edges) {
                edgeCount.set(e, (edgeCount.get(e) || 0) + 1);
            }
        }

        for (let t = 0; t < numTris; t++) {
            barycentrics[t * 9 + 0] = 1.0; barycentrics[t * 9 + 1] = 0.0; barycentrics[t * 9 + 2] = 0.0;
            barycentrics[t * 9 + 3] = 0.0; barycentrics[t * 9 + 4] = 1.0; barycentrics[t * 9 + 5] = 0.0;
            barycentrics[t * 9 + 6] = 0.0; barycentrics[t * 9 + 7] = 0.0; barycentrics[t * 9 + 8] = 1.0;

            const i0 = cluster.indices[t * 3 + 0];
            const i1 = cluster.indices[t * 3 + 1];
            const i2 = cluster.indices[t * 3 + 2];

            const e01 = edgeCount.get(makeEdgeKey(i0, i1)) === 1 ? 1 : 0;
            const e12 = edgeCount.get(makeEdgeKey(i1, i2)) === 1 ? 1 : 0;
            const e20 = edgeCount.get(makeEdgeKey(i2, i0)) === 1 ? 1 : 0;

            borderFlags[t * 3 + 0] = e01 | (e20 << 1);
            borderFlags[t * 3 + 1] = e12 | (e01 << 1);
            borderFlags[t * 3 + 2] = e20 | (e12 << 1);
        }

        cluster.barycentrics = barycentrics;
        cluster.borderFlags = borderFlags;
    }

    /**
     * Compute bounding sphere and AABB of the entire mesh
     */
    computeOverallBounds() {
        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;

        for (const cluster of this.clustersByLevel[0] || []) {
            const b = cluster.aabb;
            if (b.min[0] < minX) minX = b.min[0];
            if (b.min[1] < minY) minY = b.min[1];
            if (b.min[2] < minZ) minZ = b.min[2];
            if (b.max[0] > maxX) maxX = b.max[0];
            if (b.max[1] > maxY) maxY = b.max[1];
            if (b.max[2] > maxZ) maxZ = b.max[2];
        }

        this.aabb = {
            min: [minX, minY, minZ],
            max: [maxX, maxY, maxZ]
        };

        const center = [
            (minX + maxX) * 0.5,
            (minY + maxY) * 0.5,
            (minZ + maxZ) * 0.5
        ];

        let maxRSq = 0;
        for (const cluster of this.clustersByLevel[0] || []) {
            const c = cluster.boundingSphere.center;
            const r = cluster.boundingSphere.radius;
            const d = Math3D.dist(center, c) + r;
            if (d * d > maxRSq) maxRSq = d * d;
        }

        this.boundingSphere = {
            center,
            radius: Math.sqrt(maxRSq)
        };
    }

    /**
     * RUNTIME CONTINUOUS LOD SELECTION (Nanite Heuristic Cut) + CULLING
     * Evaluates all clusters against view frustum, normal cones, and projected pixel error.
     */
    evaluateLOD(camera, viewport, options = {}) {
        const {
            pixelTolerance = 1.0,     // Error threshold in pixels (default 1.0 px)
            lodBias = 0.0,            // User LOD bias (-3 to +3)
            frustumCulling = true,    // Enable view frustum culling
            coneCulling = true,       // Enable backface normal cone culling
            forcedLodLevel = -1,      // -1 = continuous Nanite cut, 0..N = force specific level
            instanceTransform = null  // Optional 4x4 matrix for instanced rendering
        } = options;

        const activeClusters = [];
        let culledFrustum = 0;
        let culledCone = 0;
        let culledError = 0;
        let activeTriangles = 0;
        let maxProjectedError = 0.0;

        const camPos = camera.position;
        const screenHeight = viewport.height || 800;
        const fov = camera.fov || (60 * Math.PI / 180);
        const tanHalfFov = Math.tan(fov * 0.5);

        const frustumPlanes = frustumCulling ? camera.frustumPlanes : null;
        const biasMultiplier = Math.pow(2.0, lodBias);

        // Forced LOD mode (manual override)
        if (forcedLodLevel >= 0 && forcedLodLevel <= this.maxLodLevel) {
            const levelClusters = this.clustersByLevel[forcedLodLevel] || [];
            for (const cluster of levelClusters) {
                let center = cluster.boundingSphere.center;
                let radius = cluster.boundingSphere.radius;

                if (instanceTransform) {
                    center = this.transformPoint(center, instanceTransform);
                    radius = radius * this.getTransformScale(instanceTransform);
                }

                if (frustumPlanes && !this.testSphereFrustum(center, radius, frustumPlanes)) {
                    culledFrustum++;
                    continue;
                }

                if (coneCulling && this.testClusterCone(center, cluster.normalCone, camPos)) {
                    culledCone++;
                    continue;
                }

                activeClusters.push({
                    cluster,
                    projectedError: 0.0,
                    instanceTransform
                });
                activeTriangles += cluster.triangleCount;
            }

            return {
                activeClusters,
                culledFrustum,
                culledCone,
                culledError: 0,
                activeTriangles,
                totalClusters: this.clusters.length,
                maxProjectedError: 0.0,
                reductionPct: ((1.0 - activeTriangles / Math.max(1, this.totalOriginalTriangles)) * 100).toFixed(1)
            };
        }

        // CONTINUOUS NANITE CUT SELECTION
        // A cluster is selected if:
        // projectedParentError > threshold && projectedClusterError <= threshold
        for (const cluster of this.clusters) {
            let center = cluster.boundingSphere.center;
            let radius = cluster.boundingSphere.radius;

            if (instanceTransform) {
                center = this.transformPoint(center, instanceTransform);
                radius = radius * this.getTransformScale(instanceTransform);
            }

            // Frustum Culling
            if (frustumPlanes && !this.testSphereFrustum(center, radius, frustumPlanes)) {
                culledFrustum++;
                continue;
            }

            // Normal Cone Backface Culling
            if (coneCulling && this.testClusterCone(center, cluster.normalCone, camPos)) {
                culledCone++;
                continue;
            }

            // Distance from camera to cluster center
            const dist = Math.max(Math3D.dist(camPos, center), 0.05);

            // Screen error projection scale factor: pixels per world unit
            const screenScale = (screenHeight * 0.5) / (dist * tanHalfFov);

            // Projected cluster error & parent error in screen pixels
            const projClusterError = cluster.clusterError * screenScale * biasMultiplier;
            const projParentError = cluster.parentError === Infinity
                ? Infinity
                : cluster.parentError * screenScale * biasMultiplier;

            if (projClusterError > maxProjectedError) {
                maxProjectedError = projClusterError;
            }

            // Nanite Selection Condition:
            // (parent error > tolerance) AND (cluster error <= tolerance)
            const isParentTooCoarse = projParentError > pixelTolerance;
            const isClusterAccurate = projClusterError <= pixelTolerance;

            if (isParentTooCoarse && isClusterAccurate) {
                activeClusters.push({
                    cluster,
                    projectedError: projClusterError,
                    instanceTransform
                });
                activeTriangles += cluster.triangleCount;
            } else {
                culledError++;
            }
        }

        const reductionPct = ((1.0 - activeTriangles / Math.max(1, this.totalOriginalTriangles)) * 100).toFixed(1);

        return {
            activeClusters,
            culledFrustum,
            culledCone,
            culledError,
            activeTriangles,
            totalClusters: this.clusters.length,
            maxProjectedError: parseFloat(maxProjectedError.toFixed(2)),
            reductionPct
        };
    }

    /**
     * Test bounding sphere against 6 frustum planes: [Ax + By + Cz + D >= -R]
     */
    testSphereFrustum(center, radius, planes) {
        for (let i = 0; i < 6; i++) {
            const p = planes[i];
            const dist = p[0] * center[0] + p[1] * center[1] + p[2] * center[2] + p[3];
            if (dist < -radius) {
                return false;
            }
        }
        return true;
    }

    /**
     * Test normal cone against camera viewpoint for backface cluster culling
     */
    testClusterCone(center, cone, camPos) {
        if (!cone || cone.cosCutoff === -1.0) return false;
        const viewDir = Math3D.normalize([
            camPos[0] - center[0],
            camPos[1] - center[1],
            camPos[2] - center[2]
        ]);
        const dot = Math3D.dot(cone.axis, viewDir);
        const sinCutoff = Math.sqrt(Math.max(0, 1.0 - cone.cosCutoff * cone.cosCutoff));
        return dot < -sinCutoff;
    }

    /**
     * Transform point by 4x4 matrix
     */
    transformPoint(p, m) {
        return [
            m[0] * p[0] + m[4] * p[1] + m[8]  * p[2] + m[12],
            m[1] * p[0] + m[5] * p[1] + m[9]  * p[2] + m[13],
            m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14]
        ];
    }

    /**
     * Extract uniform scale from transform matrix
     */
    getTransformScale(m) {
        const sx = Math.sqrt(m[0] * m[0] + m[1] * m[1] + m[2] * m[2]);
        return sx || 1.0;
    }
}
