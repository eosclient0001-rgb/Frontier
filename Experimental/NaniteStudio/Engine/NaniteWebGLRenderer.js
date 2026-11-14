/*============================================================================================================================================
                                                NANITEWEBGLRENDERER.JS
============================================================================================================================================*/
/**
 * High-Performance WebGL2 GPU Renderer for Nanite Virtual Geometry.
 * Supports PBR Shading, Cluster ID coloring, LOD Level color ramps, barycentric antialiased wireframes,
 * cluster perimeter boundary highlighting, surface normal mapping, screen error heatmaps,
 * frozen camera frustum wireframes, cluster bounding spheres, and ground grid.
 */

import { getClusterColor, getLodLevelColor } from './NaniteMesh.js';

export const RENDER_MODES = {
    SHADED: 0,
    CLUSTER_ID: 1,
    LOD_LEVEL: 2,
    WIREFRAME: 3,
    NORMALS: 4,
    HEATMAP: 5,
    OVERDRAW: 6
};

// GLSL Vertex Shader for Clusters
const CLUSTER_VERT_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec3 aPosition;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec2 aUV;
layout(location = 3) in vec3 aBarycentric;
layout(location = 4) in float aBorderFlags;

uniform mat4 uModelMatrix;
uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;
uniform mat3 uNormalMatrix;

out vec3 vWorldPosition;
out vec3 vViewPosition;
out vec3 vNormal;
out vec2 vUV;
out vec3 vBarycentric;
flat out int vBorderFlags;

void main() {
    vec4 worldPos = uModelMatrix * vec4(aPosition, 1.0);
    vec4 viewPos = uViewMatrix * worldPos;

    vWorldPosition = worldPos.xyz;
    vViewPosition = viewPos.xyz;
    vNormal = normalize(uNormalMatrix * aNormal);
    vUV = aUV;
    vBarycentric = aBarycentric;
    vBorderFlags = int(aBorderFlags);

    gl_Position = uProjectionMatrix * viewPos;
}
`;

// GLSL Fragment Shader for Clusters
const CLUSTER_FRAG_SHADER = `#version 300 es
precision highp float;

in vec3 vWorldPosition;
in vec3 vViewPosition;
in vec3 vNormal;
in vec2 vUV;
in vec3 vBarycentric;
flat in int vBorderFlags;

uniform int uRenderMode;             // 0=Shaded, 1=ClusterID, 2=LODLevel, 3=Wireframe, 4=Normals, 5=Heatmap, 6=Overdraw
uniform vec3 uClusterColor;
uniform vec3 uLodLevelColor;
uniform float uProjectedError;
uniform float uTargetTolerance;

// Material & Lighting
uniform vec3 uBaseColor;
uniform float uMetallic;
uniform float uRoughness;
uniform vec3 uSunDirection;
uniform vec3 uSunColor;
uniform vec3 uAmbientColor;
uniform vec3 uCameraPosition;

// Wireframe & Seams
uniform bool uWireframeOverlay;
uniform float uWireframeOpacity;
uniform bool uHighlightClusterBorders;
uniform vec3 uSeamColor;
uniform float uSeamThickness;

out vec4 fragColor;

// Heatmap palette for screen-space error: Blue(0px) -> Green(1px) -> Yellow(2px) -> Red(5px+)
vec3 errorHeatmap(float err, float tol) {
    float norm = clamp(err / (tol * 2.5), 0.0, 1.0);
    if (norm < 0.25) {
        return mix(vec3(0.1, 0.4, 0.9), vec3(0.2, 0.85, 0.45), norm * 4.0);
    } else if (norm < 0.5) {
        return mix(vec3(0.2, 0.85, 0.45), vec3(0.98, 0.82, 0.12), (norm - 0.25) * 4.0);
    } else if (norm < 0.75) {
        return mix(vec3(0.98, 0.82, 0.12), vec3(1.0, 0.45, 0.1), (norm - 0.5) * 4.0);
    } else {
        return mix(vec3(1.0, 0.45, 0.1), vec3(0.95, 0.1, 0.25), (norm - 0.75) * 4.0);
    }
}

void main() {
    vec3 N = normalize(vNormal);
    vec3 V = normalize(uCameraPosition - vWorldPosition);
    vec3 L = normalize(uSunDirection);
    vec3 H = normalize(L + V);

    // Compute base lighting
    float NdotL = max(dot(N, L), 0.0);
    float NdotH = max(dot(N, H), 0.0);
    float NdotV = max(dot(N, V), 0.0);

    // Blinn-Phong / Specular
    float specPow = mix(80.0, 4.0, uRoughness);
    float spec = pow(NdotH, specPow) * (1.0 - uRoughness * 0.5);

    // Subtle Rim Light for silhouette separation
    float rim = pow(1.0 - NdotV, 3.5) * 0.35;

    vec3 diffuseLight = uAmbientColor + uSunColor * NdotL;
    vec3 specularLight = uSunColor * spec * (mix(vec3(0.04), uBaseColor, uMetallic));

    vec3 surfaceColor = uBaseColor;

    if (uRenderMode == 0) {
        // Shaded PBR Model
        surfaceColor = uBaseColor * diffuseLight + specularLight + rim * uSunColor * 0.5;
    } else if (uRenderMode == 1) {
        // Cluster ID deterministic vibrant colors with lighting modulation
        surfaceColor = uClusterColor * (diffuseLight * 0.75 + 0.25) + specularLight * 0.5;
    } else if (uRenderMode == 2) {
        // LOD Level Ramp
        surfaceColor = uLodLevelColor * (diffuseLight * 0.75 + 0.25) + specularLight * 0.5;
    } else if (uRenderMode == 3) {
        // Pure Wireframe Mode
        surfaceColor = vec3(0.08, 0.08, 0.10);
    } else if (uRenderMode == 4) {
        // Surface Normals (RGB = XYZ)
        surfaceColor = N * 0.5 + 0.5;
    } else if (uRenderMode == 5) {
        // Projected Screen-Space Error Heatmap
        vec3 heat = errorHeatmap(uProjectedError, uTargetTolerance);
        surfaceColor = heat * (diffuseLight * 0.6 + 0.4);
    } else if (uRenderMode == 6) {
        // Overdraw heatmap representation
        surfaceColor = vec3(0.15, 0.45, 0.85);
    }

    // Antialiased Triangle Wireframe using Barycentric fwidth
    float minBary = min(min(vBarycentric.x, vBarycentric.y), vBarycentric.z);
    vec3 d = fwidth(vBarycentric);
    float edgeFactor = min(min(smoothstep(0.0, d.x * 1.2, vBarycentric.x),
                               smoothstep(0.0, d.y * 1.2, vBarycentric.y)),
                               smoothstep(0.0, d.z * 1.2, vBarycentric.z));

    // Cluster perimeter seam detection
    float seamFactor = 1.0;
    if (uHighlightClusterBorders) {
        if ((vBorderFlags & 1) != 0 && vBarycentric.z < d.z * uSeamThickness) seamFactor = 0.0;
        if ((vBorderFlags & 2) != 0 && vBarycentric.x < d.x * uSeamThickness) seamFactor = 0.0;
        if ((vBorderFlags & 4) != 0 && vBarycentric.y < d.y * uSeamThickness) seamFactor = 0.0;
    }

    // Apply wireframe overlay
    if (uWireframeOverlay || uRenderMode == 3) {
        vec3 wireColor = vec3(0.95, 0.95, 0.98);
        surfaceColor = mix(wireColor, surfaceColor, edgeFactor + (1.0 - uWireframeOpacity));
    }

    // Highlight Cluster Perimeter Seams in bright Gold/White
    if (uHighlightClusterBorders && seamFactor < 0.5) {
        surfaceColor = uSeamColor;
    }

    fragColor = vec4(surfaceColor, 1.0);
}
`;

// GLSL Vertex & Fragment Shaders for Lines (Frustum & Bounding Spheres & Grid)
const LINE_VERT_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPosition;
uniform mat4 uViewMatrix;
uniform mat4 uProjectionMatrix;
uniform mat4 uModelMatrix;
void main() {
    gl_Position = uProjectionMatrix * uViewMatrix * uModelMatrix * vec4(aPosition, 1.0);
}
`;

const LINE_FRAG_SHADER = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 fragColor;
void main() {
    fragColor = uColor;
}
`;

/**
 * NaniteWebGLRenderer
 */
export class NaniteWebGLRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.gl = canvas.getContext('webgl2', {
            antialias: true,
            alpha: false,
            powerPreference: 'high-performance'
        });

        if (!this.gl) {
            throw new Error("WebGL2 not supported on this browser/GPU.");
        }

        const gl = this.gl;
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.enable(gl.CULL_FACE);
        gl.cullFace(gl.BACK);

        // Compile Shader Programs
        this.clusterProgram = this.createProgram(CLUSTER_VERT_SHADER, CLUSTER_FRAG_SHADER);
        this.lineProgram = this.createProgram(LINE_VERT_SHADER, LINE_FRAG_SHADER);

        // GPU Buffer Cache per NaniteCluster: Map<clusterId, { vao, vboPos, vboNorm, vboUv, vboBary, vboBorder, ebo, count }>
        this.gpuClusterCache = new Map();

        // Line drawing buffers
        this.lineVao = gl.createVertexArray();
        this.lineVbo = gl.createBuffer();
        gl.bindVertexArray(this.lineVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);

        // Ground Grid Setup
        this.gridGeometry = this.buildGroundGrid(30.0, 30);

        // Identity 4x4 matrix
        this.mat4Identity = [
            1, 0, 0, 0,
            0, 1, 0, 0,
            0, 0, 1, 0,
            0, 0, 0, 1
        ];
    }

    /**
     * Compile shader
     */
    createShader(type, source) {
        const gl = this.gl;
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            const info = gl.getShaderInfoLog(shader);
            gl.deleteShader(shader);
            throw new Error(`Shader compile error: ${info}`);
        }
        return shader;
    }

    /**
     * Link program
     */
    createProgram(vertSource, fragSource) {
        const gl = this.gl;
        const vs = this.createShader(gl.VERTEX_SHADER, vertSource);
        const fs = this.createShader(gl.FRAGMENT_SHADER, fragSource);

        const prog = gl.createProgram();
        gl.attachShader(prog, vs);
        gl.attachShader(prog, fs);
        gl.linkProgram(prog);

        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
            const info = gl.getProgramInfoLog(prog);
            gl.deleteProgram(prog);
            throw new Error(`Program link error: ${info}`);
        }

        // Cache uniform locations
        prog.uniforms = {};
        const count = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
        for (let i = 0; i < count; i++) {
            const uniform = gl.getActiveUniform(prog, i);
            prog.uniforms[uniform.name] = gl.getUniformLocation(prog, uniform.name);
        }

        return prog;
    }

    /**
     * Upload cluster geometry to GPU (VAO & VBOs)
     */
    getOrCreateClusterGPU(cluster) {
        let cached = this.gpuClusterCache.get(cluster.id);
        if (cached) return cached;

        const gl = this.gl;
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);

        // 0: Positions
        const vboPos = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vboPos);
        gl.bufferData(gl.ARRAY_BUFFER, cluster.positions, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

        // 1: Normals
        const vboNorm = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vboNorm);
        gl.bufferData(gl.ARRAY_BUFFER, cluster.normals, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);

        // 2: UVs
        const vboUv = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vboUv);
        gl.bufferData(gl.ARRAY_BUFFER, cluster.uvs, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(2);
        gl.vertexAttribPointer(2, 2, gl.FLOAT, false, 0, 0);

        // 3: Barycentrics
        const vboBary = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vboBary);
        gl.bufferData(gl.ARRAY_BUFFER, cluster.barycentrics, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(3);
        gl.vertexAttribPointer(3, 3, gl.FLOAT, false, 0, 0);

        // 4: Border Flags
        const borderFloats = new Float32Array(cluster.borderFlags.length);
        for (let i = 0; i < cluster.borderFlags.length; i++) {
            borderFloats[i] = cluster.borderFlags[i];
        }
        const vboBorder = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, vboBorder);
        gl.bufferData(gl.ARRAY_BUFFER, borderFloats, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(4);
        gl.vertexAttribPointer(4, 1, gl.FLOAT, false, 0, 0);

        // EBO (Index Buffer)
        const ebo = gl.createBuffer();
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ebo);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, cluster.indices, gl.STATIC_DRAW);

        gl.bindVertexArray(null);

        cached = {
            vao,
            vboPos,
            vboNorm,
            vboUv,
            vboBary,
            vboBorder,
            ebo,
            indexCount: cluster.indices.length
        };

        this.gpuClusterCache.set(cluster.id, cached);
        return cached;
    }

    /**
     * Clear GPU cache when switching meshes
     */
    clearCache() {
        const gl = this.gl;
        for (const c of this.gpuClusterCache.values()) {
            gl.deleteVertexArray(c.vao);
            gl.deleteBuffer(c.vboPos);
            gl.deleteBuffer(c.vboNorm);
            gl.deleteBuffer(c.vboUv);
            gl.deleteBuffer(c.vboBary);
            gl.deleteBuffer(c.vboBorder);
            gl.deleteBuffer(c.ebo);
        }
        this.gpuClusterCache.clear();
    }

    /**
     * Render the active Nanite clusters with the active view mode and settings
     */
    render(activeClusters, camera, sceneSettings = {}) {
        const gl = this.gl;

        // Resize viewport
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        if (this.canvas.width !== width || this.canvas.height !== height) {
            this.canvas.width = width;
            this.canvas.height = height;
        }
        gl.viewport(0, 0, width, height);

        // Clear color and depth
        gl.clearColor(0.045, 0.045, 0.055, 1.0);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

        // Matrices
        const viewMatrix = camera.viewMatrix;
        const projMatrix = camera.projectionMatrix;

        // Render Ground Grid first if enabled
        if (sceneSettings.showGroundGrid !== false) {
            this.renderGroundGrid(viewMatrix, projMatrix);
        }

        // Setup Cluster Shader
        gl.useProgram(this.clusterProgram);
        const u = this.clusterProgram.uniforms;

        gl.uniformMatrix4fv(u.uViewMatrix, false, viewMatrix);
        gl.uniformMatrix4fv(u.uProjectionMatrix, false, projMatrix);
        gl.uniform3fv(u.uCameraPosition, camera.position);

        // Lighting & Material
        const sunDir = sceneSettings.sunDirection || [0.45, 0.85, 0.55];
        const sunCol = sceneSettings.sunColor || [1.0, 0.96, 0.88];
        const ambCol = sceneSettings.ambientColor || [0.18, 0.20, 0.24];
        const baseCol = sceneSettings.baseColor || [0.82, 0.85, 0.90];

        gl.uniform3fv(u.uSunDirection, sunDir);
        gl.uniform3fv(u.uSunColor, sunCol);
        gl.uniform3fv(u.uAmbientColor, ambCol);
        gl.uniform3fv(u.uBaseColor, baseCol);
        gl.uniform1f(u.uMetallic, sceneSettings.metallic ?? 0.15);
        gl.uniform1f(u.uRoughness, sceneSettings.roughness ?? 0.45);

        // Render Modes & Overlays
        const renderMode = sceneSettings.renderMode ?? RENDER_MODES.SHADED;
        gl.uniform1i(u.uRenderMode, renderMode);
        gl.uniform1i(u.uWireframeOverlay, sceneSettings.wireframeOverlay ? 1 : 0);
        gl.uniform1f(u.uWireframeOpacity, sceneSettings.wireframeOpacity ?? 0.65);
        gl.uniform1i(u.uHighlightClusterBorders, sceneSettings.highlightClusterBorders ? 1 : 0);
        gl.uniform3fv(u.uSeamColor, sceneSettings.seamColor || [1.0, 0.78, 0.22]);
        gl.uniform1f(u.uSeamThickness, sceneSettings.seamThickness || 2.2);
        gl.uniform1f(u.uTargetTolerance, sceneSettings.pixelTolerance || 1.0);

        const defaultModel = sceneSettings.modelMatrix || this.mat4Identity;

        // Draw each active cluster
        for (const item of activeClusters) {
            const cluster = item.cluster;
            const modelMat = item.instanceTransform || defaultModel;

            gl.uniformMatrix4fv(u.uModelMatrix, false, modelMat);

            // Compute normal matrix (3x3 inverse transpose approximation)
            const normalMat = [
                modelMat[0], modelMat[1], modelMat[2],
                modelMat[4], modelMat[5], modelMat[6],
                modelMat[8], modelMat[9], modelMat[10]
            ];
            gl.uniformMatrix3fv(u.uNormalMatrix, false, normalMat);

            // Set cluster and LOD colors
            const cColor = getClusterColor(cluster.id);
            const lColor = getLodLevelColor(cluster.lodLevel);
            gl.uniform3fv(u.uClusterColor, cColor);
            gl.uniform3fv(u.uLodLevelColor, lColor);
            gl.uniform1f(u.uProjectedError, item.projectedError || 0.0);

            const gpu = this.getOrCreateClusterGPU(cluster);
            gl.bindVertexArray(gpu.vao);
            gl.drawElements(gl.TRIANGLES, gpu.indexCount, gl.UNSIGNED_INT, 0);
        }

        gl.bindVertexArray(null);

        // Render Frozen Frustum in 3D if frozen camera active
        if (sceneSettings.frozenCamera && sceneSettings.showFrozenFrustumWireframe) {
            this.renderFrustumWireframe(sceneSettings.frozenCamera, viewMatrix, projMatrix);
        }

        // Render Bounding Spheres if enabled
        if (sceneSettings.showBoundingSpheres) {
            this.renderBoundingSpheres(activeClusters, viewMatrix, projMatrix);
        }
    }

    /**
     * Render 3D Ground Grid
     */
    renderGroundGrid(viewMatrix, projMatrix) {
        const gl = this.gl;
        gl.useProgram(this.lineProgram);
        const u = this.lineProgram.uniforms;

        gl.uniformMatrix4fv(u.uViewMatrix, false, viewMatrix);
        gl.uniformMatrix4fv(u.uProjectionMatrix, false, projMatrix);
        gl.uniformMatrix4fv(u.uModelMatrix, false, this.mat4Identity);

        gl.bindVertexArray(this.lineVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
        gl.bufferData(gl.ARRAY_BUFFER, this.gridGeometry.lines, gl.DYNAMIC_DRAW);

        gl.uniform4f(u.uColor, 0.22, 0.24, 0.28, 0.45);
        gl.drawArrays(gl.LINES, 0, this.gridGeometry.vertexCount);

        gl.bindVertexArray(null);
    }

    /**
     * Render the 3D Frozen Camera Frustum Wireframe Pyramid in space
     */
    renderFrustumWireframe(frozenCamera, viewMatrix, projMatrix) {
        const gl = this.gl;
        const invVP = frozenCamera.invViewProjectionMatrix;
        if (!invVP) return;

        // Normalized Device Coordinates (NDC) corner points
        const ndcCorners = [
            [-1, -1, -1], [ 1, -1, -1], [ 1,  1, -1], [-1,  1, -1], // Near plane
            [-1, -1,  1], [ 1, -1,  1], [ 1,  1,  1], [-1,  1,  1]  // Far plane
        ];

        // Unproject NDC to world space
        const worldCorners = ndcCorners.map(pt => this.unprojectPoint(pt, invVP));

        const lines = [];
        // Near rectangle
        lines.push(...worldCorners[0], ...worldCorners[1]);
        lines.push(...worldCorners[1], ...worldCorners[2]);
        lines.push(...worldCorners[2], ...worldCorners[3]);
        lines.push(...worldCorners[3], ...worldCorners[0]);

        // Far rectangle
        lines.push(...worldCorners[4], ...worldCorners[5]);
        lines.push(...worldCorners[5], ...worldCorners[6]);
        lines.push(...worldCorners[6], ...worldCorners[7]);
        lines.push(...worldCorners[7], ...worldCorners[4]);

        // 4 Connecting side edges
        lines.push(...worldCorners[0], ...worldCorners[4]);
        lines.push(...worldCorners[1], ...worldCorners[5]);
        lines.push(...worldCorners[2], ...worldCorners[6]);
        lines.push(...worldCorners[3], ...worldCorners[7]);

        // Camera apex to near plane corners
        const eye = frozenCamera.position;
        lines.push(...eye, ...worldCorners[0]);
        lines.push(...eye, ...worldCorners[1]);
        lines.push(...eye, ...worldCorners[2]);
        lines.push(...eye, ...worldCorners[3]);

        gl.useProgram(this.lineProgram);
        const u = this.lineProgram.uniforms;

        gl.uniformMatrix4fv(u.uViewMatrix, false, viewMatrix);
        gl.uniformMatrix4fv(u.uProjectionMatrix, false, projMatrix);
        gl.uniformMatrix4fv(u.uModelMatrix, false, this.mat4Identity);

        gl.bindVertexArray(this.lineVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW);

        // Vivid orange/amber color for frozen frustum
        gl.uniform4f(u.uColor, 1.0, 0.62, 0.12, 0.95);
        gl.drawArrays(gl.LINES, 0, lines.length / 3);

        gl.bindVertexArray(null);
    }

    /**
     * Unproject an NDC point to world space using inverse View-Projection matrix
     */
    unprojectPoint(pt, invVP) {
        const x = pt[0], y = pt[1], z = pt[2];
        const w = invVP[3] * x + invVP[7] * y + invVP[11] * z + invVP[15];
        const invW = Math.abs(w) > 1e-9 ? 1.0 / w : 1.0;

        return [
            (invVP[0] * x + invVP[4] * y + invVP[8]  * z + invVP[12]) * invW,
            (invVP[1] * x + invVP[5] * y + invVP[9]  * z + invVP[13]) * invW,
            (invVP[2] * x + invVP[6] * y + invVP[10] * z + invVP[14]) * invW
        ];
    }

    /**
     * Render wireframe bounding spheres for active clusters
     */
    renderBoundingSpheres(activeClusters, viewMatrix, projMatrix) {
        const gl = this.gl;
        const lines = [];
        const segments = 24;

        for (const item of activeClusters) {
            const bs = item.cluster.boundingSphere;
            let center = bs.center;
            let radius = bs.radius;

            if (item.instanceTransform) {
                center = [
                    item.instanceTransform[0] * center[0] + item.instanceTransform[4] * center[1] + item.instanceTransform[8]  * center[2] + item.instanceTransform[12],
                    item.instanceTransform[1] * center[0] + item.instanceTransform[5] * center[1] + item.instanceTransform[9]  * center[2] + item.instanceTransform[13],
                    item.instanceTransform[2] * center[0] + item.instanceTransform[6] * center[1] + item.instanceTransform[10] * center[2] + item.instanceTransform[14]
                ];
            }

            // Draw 3 orthogonal circles (XY, XZ, YZ)
            for (let i = 0; i < segments; i++) {
                const a0 = (i / segments) * Math.PI * 2;
                const a1 = ((i + 1) / segments) * Math.PI * 2;

                // XZ circle
                lines.push(
                    center[0] + Math.cos(a0) * radius, center[1], center[2] + Math.sin(a0) * radius,
                    center[0] + Math.cos(a1) * radius, center[1], center[2] + Math.sin(a1) * radius
                );

                // XY circle
                lines.push(
                    center[0] + Math.cos(a0) * radius, center[1] + Math.sin(a0) * radius, center[2],
                    center[0] + Math.cos(a1) * radius, center[1] + Math.sin(a1) * radius, center[2]
                );
            }
        }

        gl.useProgram(this.lineProgram);
        const u = this.lineProgram.uniforms;

        gl.uniformMatrix4fv(u.uViewMatrix, false, viewMatrix);
        gl.uniformMatrix4fv(u.uProjectionMatrix, false, projMatrix);
        gl.uniformMatrix4fv(u.uModelMatrix, false, this.mat4Identity);

        gl.bindVertexArray(this.lineVao);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.DYNAMIC_DRAW);

        gl.uniform4f(u.uColor, 0.2, 0.85, 0.95, 0.5);
        gl.drawArrays(gl.LINES, 0, lines.length / 3);

        gl.bindVertexArray(null);
    }

    /**
     * Build ground grid geometry
     */
    buildGroundGrid(size = 30.0, divisions = 30) {
        const lines = [];
        const half = size * 0.5;
        const step = size / divisions;
        const y = -1.2;

        for (let i = 0; i <= divisions; i++) {
            const pos = -half + i * step;

            // Lines parallel to Z
            lines.push(pos, y, -half);
            lines.push(pos, y,  half);

            // Lines parallel to X
            lines.push(-half, y, pos);
            lines.push( half, y, pos);
        }

        return {
            lines: new Float32Array(lines),
            vertexCount: lines.length / 3
        };
    }
}
