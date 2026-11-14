/*============================================================================================================================================
                                                NANITESTUDIOCONTROLLER.JS
============================================================================================================================================*/
/**
 * Master Controller for Frontier Nanite Studio (Project Zero UI + WebGL2 Virtual Geometry).
 * Coordinates camera orbit/pan/zoom, cluster picking, LOD evaluation, frozen frustum debugging,
 * OBJ drag-and-drop, UI telemetry, and Project Zero dock panels.
 */

import { Math3D, NaniteMesh, RENDER_MODES as LOD_RENDER_MODES, getClusterColor, getLodLevelColor } from './NaniteMesh.js';
import {
    generateStanfordBunny,
    generateStanfordDragon,
    generateFractalMountain,
    generateGeodesicSphere,
    generateGothicColumn,
    generateSuzanneHead,
    generateInstanceTransforms,
    parseWavefrontOBJ
} from './NaniteGeometryGenerators.js';
import { NaniteWebGLRenderer, RENDER_MODES } from './NaniteWebGLRenderer.js';

export class OrbitCamera {
    constructor(options = {}) {
        this.target = options.target || [0, 0.4, 0];
        this.distance = options.distance || 3.8;
        this.yaw = options.yaw !== undefined ? options.yaw : 0.45;
        this.pitch = options.pitch !== undefined ? options.pitch : 0.28;
        this.minDistance = 0.4;
        this.maxDistance = 45.0;
        this.fov = (50 * Math.PI) / 180;
        this.near = 0.1;
        this.far = 100.0;
        this.aspect = 1.6;

        this.position = [0, 0, 0];
        this.viewMatrix = new Float32Array(16);
        this.projectionMatrix = new Float32Array(16);
        this.viewProjectionMatrix = new Float32Array(16);
        this.invViewProjectionMatrix = new Float32Array(16);
        this.frustumPlanes = [];

        this.update();
    }

    update() {
        // Clamp pitch to prevent gimbal flipping
        this.pitch = Math.max(-Math.PI * 0.48, Math.min(Math.PI * 0.48, this.pitch));
        this.distance = Math.max(this.minDistance, Math.min(this.maxDistance, this.distance));

        // Compute eye position
        const cosPitch = Math.cos(this.pitch);
        const sinPitch = Math.sin(this.pitch);
        const cosYaw = Math.cos(this.yaw);
        const sinYaw = Math.sin(this.yaw);

        this.position = [
            this.target[0] + this.distance * cosPitch * sinYaw,
            this.target[1] + this.distance * sinPitch,
            this.target[2] + this.distance * cosPitch * cosYaw
        ];

        this.computeViewMatrix();
        this.computeProjectionMatrix();
        this.computeViewProjectionMatrix();
        this.extractFrustumPlanes();
    }

    computeViewMatrix() {
        const eye = this.position;
        const center = this.target;
        const up = [0, 1, 0];

        // Z axis = normalize(eye - center)
        let zx = eye[0] - center[0], zy = eye[1] - center[1], zz = eye[2] - center[2];
        const lenZ = Math.sqrt(zx * zx + zy * zy + zz * zz) || 1.0;
        zx /= lenZ; zy /= lenZ; zz /= lenZ;

        // X axis = normalize(cross(up, Z))
        let xx = up[1] * zz - up[2] * zy;
        let xy = up[2] * zx - up[0] * zz;
        let xz = up[0] * zy - up[1] * zx;
        const lenX = Math.sqrt(xx * xx + xy * xy + xz * xz) || 1.0;
        xx /= lenX; xy /= lenX; xz /= lenX;

        // Y axis = cross(Z, X)
        const yx = zy * xz - zz * xy;
        const yy = zz * xx - zx * xz;
        const yz = zx * xy - zy * xx;

        // Column-major 4x4
        const m = this.viewMatrix;
        m[0] = xx; m[4] = xy; m[8]  = xz; m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
        m[1] = yx; m[5] = yy; m[9]  = yz; m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
        m[2] = zx; m[6] = zy; m[10] = zz; m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
        m[3] = 0;  m[7] = 0;  m[11] = 0;  m[15] = 1.0;
    }

    computeProjectionMatrix() {
        const f = 1.0 / Math.tan(this.fov * 0.5);
        const rangeInv = 1.0 / (this.near - this.far);
        const m = this.projectionMatrix;

        m[0] = f / this.aspect; m[4] = 0; m[8]  = 0;                              m[12] = 0;
        m[1] = 0;              m[5] = f; m[9]  = 0;                              m[13] = 0;
        m[2] = 0;              m[6] = 0; m[10] = (this.far + this.near) * rangeInv; m[14] = 2 * this.far * this.near * rangeInv;
        m[3] = 0;              m[7] = 0; m[11] = -1.0;                           m[15] = 0;
    }

    computeViewProjectionMatrix() {
        const a = this.projectionMatrix;
        const b = this.viewMatrix;
        const out = this.viewProjectionMatrix;

        for (let i = 0; i < 4; i++) {
            const ai0 = a[i], ai1 = a[i + 4], ai2 = a[i + 8], ai3 = a[i + 12];
            out[i]      = ai0 * b[0] + ai1 * b[1] + ai2 * b[2] + ai3 * b[3];
            out[i + 4]  = ai0 * b[4] + ai1 * b[5] + ai2 * b[6] + ai3 * b[7];
            out[i + 8]  = ai0 * b[8] + ai1 * b[9] + ai2 * b[10] + ai3 * b[11];
            out[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
        }

        this.invViewProjectionMatrix = invertMatrix4(out);
    }

    /**
     * Extract 6 Frustum Planes using Gribb-Hartmann algorithm
     */
    extractFrustumPlanes() {
        const m = this.viewProjectionMatrix;
        const planes = [];

        // Left plane
        planes.push(normalizePlane([m[3] + m[0], m[7] + m[4], m[11] + m[8], m[15] + m[12]]));
        // Right plane
        planes.push(normalizePlane([m[3] - m[0], m[7] - m[4], m[11] - m[8], m[15] - m[12]]));
        // Bottom plane
        planes.push(normalizePlane([m[3] + m[1], m[7] + m[5], m[11] + m[9], m[15] + m[13]]));
        // Top plane
        planes.push(normalizePlane([m[3] - m[1], m[7] - m[5], m[11] - m[9], m[15] - m[13]]));
        // Near plane
        planes.push(normalizePlane([m[3] + m[2], m[7] + m[6], m[11] + m[10], m[15] + m[14]]));
        // Far plane
        planes.push(normalizePlane([m[3] - m[2], m[7] - m[6], m[11] - m[10], m[15] - m[14]]));

        this.frustumPlanes = planes;
    }

    cloneState() {
        return {
            position: [...this.position],
            target: [...this.target],
            fov: this.fov,
            near: this.near,
            far: this.far,
            viewMatrix: new Float32Array(this.viewMatrix),
            projectionMatrix: new Float32Array(this.projectionMatrix),
            viewProjectionMatrix: new Float32Array(this.viewProjectionMatrix),
            invViewProjectionMatrix: new Float32Array(this.invViewProjectionMatrix),
            frustumPlanes: this.frustumPlanes.map(p => [...p])
        };
    }
}

function normalizePlane(p) {
    const len = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) || 1.0;
    return [p[0] / len, p[1] / len, p[2] / len, p[3] / len];
}

function invertMatrix4(m) {
    const inv = new Float32Array(16);
    inv[0] = m[5] * m[10] * m[15] - m[5] * m[11] * m[14] - m[9] * m[6] * m[15] + m[9] * m[7] * m[14] + m[13] * m[6] * m[11] - m[13] * m[7] * m[10];
    inv[4] = -m[4] * m[10] * m[15] + m[4] * m[11] * m[14] + m[8] * m[6] * m[15] - m[8] * m[7] * m[14] - m[12] * m[6] * m[11] + m[12] * m[7] * m[10];
    inv[8] = m[4] * m[9] * m[15] - m[4] * m[11] * m[13] - m[8] * m[5] * m[15] + m[8] * m[7] * m[13] + m[12] * m[5] * m[11] - m[12] * m[7] * m[9];
    inv[12] = -m[4] * m[9] * m[14] + m[4] * m[10] * m[13] + m[8] * m[5] * m[14] - m[8] * m[6] * m[13] - m[12] * m[5] * m[10] + m[12] * m[6] * m[9];
    inv[1] = -m[1] * m[10] * m[15] + m[1] * m[11] * m[14] + m[9] * m[2] * m[15] - m[9] * m[3] * m[14] - m[13] * m[2] * m[11] + m[13] * m[3] * m[10];
    inv[5] = m[0] * m[10] * m[15] - m[0] * m[11] * m[14] - m[8] * m[2] * m[15] + m[8] * m[3] * m[14] + m[12] * m[2] * m[11] - m[12] * m[3] * m[10];
    inv[9] = -m[0] * m[9] * m[15] + m[0] * m[11] * m[13] + m[8] * m[1] * m[15] - m[8] * m[3] * m[13] - m[12] * m[1] * m[11] + m[12] * m[3] * m[9];
    inv[13] = m[0] * m[9] * m[14] - m[0] * m[10] * m[13] - m[8] * m[1] * m[14] + m[8] * m[2] * m[13] + m[12] * m[1] * m[10] - m[12] * m[2] * m[9];
    inv[2] = m[1] * m[6] * m[15] - m[1] * m[7] * m[14] - m[5] * m[2] * m[15] + m[5] * m[3] * m[14] + m[13] * m[2] * m[7] - m[13] * m[3] * m[6];
    inv[6] = -m[0] * m[6] * m[15] + m[0] * m[7] * m[14] + m[4] * m[2] * m[15] - m[4] * m[3] * m[14] - m[12] * m[2] * m[7] + m[12] * m[3] * m[6];
    inv[10] = m[0] * m[5] * m[15] - m[0] * m[7] * m[13] - m[4] * m[1] * m[15] + m[4] * m[3] * m[13] + m[12] * m[1] * m[7] - m[12] * m[3] * m[5];
    inv[14] = -m[0] * m[5] * m[14] + m[0] * m[6] * m[13] + m[4] * m[1] * m[14] - m[4] * m[2] * m[13] - m[12] * m[1] * m[6] + m[12] * m[2] * m[5];
    inv[3] = -m[1] * m[6] * m[11] + m[1] * m[7] * m[10] + m[5] * m[2] * m[11] - m[5] * m[3] * m[10] - m[9] * m[2] * m[7] + m[9] * m[3] * m[6];
    inv[7] = m[0] * m[6] * m[11] - m[0] * m[7] * m[10] - m[4] * m[2] * m[11] + m[4] * m[3] * m[10] + m[8] * m[2] * m[7] - m[8] * m[3] * m[6];
    inv[11] = -m[0] * m[5] * m[11] + m[0] * m[7] * m[9] + m[4] * m[1] * m[11] - m[4] * m[3] * m[9] - m[8] * m[1] * m[7] + m[8] * m[3] * m[5];
    inv[15] = m[0] * m[5] * m[10] - m[0] * m[6] * m[9] - m[4] * m[1] * m[10] + m[4] * m[2] * m[9] + m[8] * m[1] * m[6] - m[8] * m[2] * m[5];

    let det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12];
    if (Math.abs(det) < 1e-9) return new Float32Array(16);
    det = 1.0 / det;
    for (let i = 0; i < 16; i++) inv[i] *= det;
    return inv;
}

export class NaniteStudioController {
    constructor() {
        this.canvas = document.getElementById('GpuCanvas');
        this.renderer = new NaniteWebGLRenderer(this.canvas);
        this.camera = new OrbitCamera();

        // Active Nanite Virtual Mesh
        this.activeMesh = null;
        this.selectedCluster = null;

        // Frozen Culling Camera state (when frozen, camera snapshot used for culling while user moves freely)
        this.frozenCamera = null;

        // Settings State
        this.settings = {
            renderMode: RENDER_MODES.SHADED,
            pixelTolerance: 1.0,          // Error threshold in pixels
            lodBias: 0.0,                 // LOD Bias (-3 to +3)
            forcedLodLevel: -1,           // -1 = continuous Nanite cut
            frustumCulling: true,
            coneCulling: true,
            freezeCulling: false,
            showFrozenFrustumWireframe: true,
            showBoundingSpheres: false,
            wireframeOverlay: false,
            wireframeOpacity: 0.65,
            highlightClusterBorders: true,
            showGroundGrid: true,
            seamThickness: 2.2,
            sunDirection: [0.55, 0.85, 0.45],
            sunColor: [1.0, 0.96, 0.88],
            ambientColor: [0.18, 0.20, 0.24],
            baseColor: [0.82, 0.85, 0.90],
            metallic: 0.15,
            roughness: 0.45,
            instanceCount: 1,             // 1 = single hero asset, >1 = multi-instance grid
            instanceTransforms: []
        };

        // Telemetry
        this.telemetry = {
            fps: 60,
            frameTimeMs: 1.2,
            activeClusters: 0,
            totalClusters: 0,
            renderedTriangles: 0,
            originalTriangles: 0,
            culledFrustum: 0,
            culledCone: 0,
            culledError: 0,
            reductionPct: 0,
            maxProjectedError: 0
        };

        // Interaction State
        this.isPointerDown = false;
        this.pointerButton = 0;
        this.lastPointerX = 0;
        this.lastPointerY = 0;

        this.initDOM();
        this.initEvents();
        this.loadPreset('bunny');
        this.startRenderLoop();
    }

    initDOM() {
        // Cache DOM elements
        this.dom = {
            statActiveClusters: document.getElementById('StatActiveClusters'),
            statTotalClusters: document.getElementById('StatTotalClusters'),
            statRenderedTris: document.getElementById('StatRenderedTris'),
            statReductionPct: document.getElementById('StatReductionPct'),
            statScreenErrorMax: document.getElementById('StatScreenErrorMax'),
            statTargetTolerance: document.getElementById('StatTargetTolerance'),
            statFps: document.getElementById('StatFps'),
            statFrameTime: document.getElementById('StatFrameTime'),
            outlinerActiveBadge: document.getElementById('OutlinerActiveBadge'),
            outlinerCulledBadge: document.getElementById('OutlinerCulledBadge'),
            outlinerTotalBadge: document.getElementById('OutlinerTotalBadge'),
            outlinerRows: document.getElementById('OutlinerRows'),
            footerFps: document.getElementById('FooterFps'),
            footerClusters: document.getElementById('FooterClusters'),
            footerTris: document.getElementById('FooterTris'),
            hudActiveClusters: document.getElementById('HudActiveClusters'),
            hudRenderedTris: document.getElementById('HudRenderedTris'),
            hudScreenError: document.getElementById('HudScreenError'),
            hudFreezePill: document.getElementById('HudFreezePill'),
            hudFpsPill: document.getElementById('HudFpsPill'),
            viewportMeshTitle: document.getElementById('ViewportMeshTitle'),
            viewportBadge: document.getElementById('ViewportBadge'),
            sliderPixelTolerance: document.getElementById('SliderPixelTolerance'),
            numPixelTolerance: document.getElementById('NumPixelTolerance'),
            sliderLodBias: document.getElementById('SliderLodBias'),
            numLodBias: document.getElementById('NumLodBias'),
            selectForcedLod: document.getElementById('SelectForcedLod'),
            checkFrustumCulling: document.getElementById('CheckFrustumCulling'),
            checkConeCulling: document.getElementById('CheckConeCulling'),
            checkFreezeCulling: document.getElementById('CheckFreezeCulling'),
            checkShowFrustumWireframe: document.getElementById('CheckShowFrustumWireframe'),
            checkShowBoundingSpheres: document.getElementById('CheckShowBoundingSpheres'),
            checkWireframeOverlay: document.getElementById('CheckWireframeOverlay'),
            checkHighlightClusterBorders: document.getElementById('CheckHighlightClusterBorders'),
            checkShowGroundGrid: document.getElementById('CheckShowGroundGrid'),
            sliderWireframeOpacity: document.getElementById('SliderWireframeOpacity'),
            numWireframeOpacity: document.getElementById('NumWireframeOpacity'),
            sliderInstances: document.getElementById('SliderInstances'),
            numInstances: document.getElementById('NumInstances'),
            clusterInspectorBody: document.getElementById('ClusterInspectorBody'),
            controlNotch: document.getElementById('ControlNotch'),
            contentDrawer: document.getElementById('ContentDrawer')
        };
    }

    initEvents() {
        const canvas = this.canvas;

        // Pointer Controls (Orbit, Pan, Zoom)
        canvas.addEventListener('pointerdown', (e) => {
            this.isPointerDown = true;
            this.pointerButton = e.button;
            this.lastPointerX = e.clientX;
            this.lastPointerY = e.clientY;
            canvas.setPointerCapture(e.pointerId);
        });

        canvas.addEventListener('pointermove', (e) => {
            if (!this.isPointerDown) return;
            const dx = e.clientX - this.lastPointerX;
            const dy = e.clientY - this.lastPointerY;
            this.lastPointerX = e.clientX;
            this.lastPointerY = e.clientY;

            if (this.pointerButton === 0 && !e.shiftKey) {
                // Orbit
                this.camera.yaw -= dx * 0.007;
                this.camera.pitch -= dy * 0.007;
                this.camera.update();
            } else if (this.pointerButton === 2 || (this.pointerButton === 0 && e.shiftKey)) {
                // Pan
                const panSpeed = this.camera.distance * 0.0018;
                const cosYaw = Math.cos(this.camera.yaw);
                const sinYaw = Math.sin(this.camera.yaw);

                // Right vector
                const rightX = cosYaw;
                const rightZ = -sinYaw;

                this.camera.target[0] -= rightX * dx * panSpeed;
                this.camera.target[2] -= rightZ * dx * panSpeed;
                this.camera.target[1] += dy * panSpeed;
                this.camera.update();
            }
        });

        const endPointer = (e) => {
            this.isPointerDown = false;
            try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        };
        canvas.addEventListener('pointerup', endPointer);
        canvas.addEventListener('pointercancel', endPointer);
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Mouse Wheel Zoom
        canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            const factor = Math.exp(e.deltaY * 0.0015);
            this.camera.distance *= factor;
            this.camera.update();
        }, { passive: false });

        // Cluster Picking on click
        canvas.addEventListener('click', (e) => {
            if (Math.abs(e.clientX - this.lastPointerX) > 3 || Math.abs(e.clientY - this.lastPointerY) > 3) return;
            this.pickClusterAtPixel(e.offsetX, e.offsetY);
        });

        // Window resize
        window.addEventListener('resize', () => {
            if (this.canvas.clientWidth > 0 && this.canvas.clientHeight > 0) {
                this.camera.aspect = this.canvas.clientWidth / this.canvas.clientHeight;
                this.camera.update();
            }
        });

        // Keyboard Shortcuts
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

            if (e.key === 'f' || e.key === 'F') {
                this.toggleFreezeCulling();
            } else if (e.key === 'w' || e.key === 'W') {
                this.settings.wireframeOverlay = !this.settings.wireframeOverlay;
                if (this.dom.checkWireframeOverlay) this.dom.checkWireframeOverlay.checked = this.settings.wireframeOverlay;
            } else if (e.key === '1') {
                this.setRenderMode(RENDER_MODES.SHADED);
            } else if (e.key === '2') {
                this.setRenderMode(RENDER_MODES.CLUSTER_ID);
            } else if (e.key === '3') {
                this.setRenderMode(RENDER_MODES.LOD_LEVEL);
            } else if (e.key === '4') {
                this.setRenderMode(RENDER_MODES.WIREFRAME);
            } else if (e.key === '5') {
                this.setRenderMode(RENDER_MODES.NORMALS);
            } else if (e.key === '6') {
                this.setRenderMode(RENDER_MODES.HEATMAP);
            } else if (e.key === 'r' || e.key === 'R') {
                this.resetCamera();
            }
        });

        // Top Notch Toggle
        const btnToggleNotch = document.getElementById('BtnToggleNotch');
        if (btnToggleNotch) {
            btnToggleNotch.addEventListener('click', () => {
                this.dom.controlNotch?.classList.toggle('hidden');
            });
        }

        // View Mode Buttons
        const modeButtons = document.querySelectorAll('[data-view-mode]');
        modeButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const modeName = btn.getAttribute('data-view-mode');
                modeButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                this.setRenderMode(RENDER_MODES[modeName] ?? RENDER_MODES.SHADED);
            });
        });

        // Preset Buttons
        const presetButtons = document.querySelectorAll('[data-preset]');
        presetButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const preset = btn.getAttribute('data-preset');
                this.loadPreset(preset);
            });
        });

        // Sliders & Number Inputs
        this.bindSliderAndNum('SliderPixelTolerance', 'NumPixelTolerance', (val) => {
            this.settings.pixelTolerance = parseFloat(val);
        });

        this.bindSliderAndNum('SliderLodBias', 'NumLodBias', (val) => {
            this.settings.lodBias = parseFloat(val);
        });

        this.bindSliderAndNum('SliderWireframeOpacity', 'NumWireframeOpacity', (val) => {
            this.settings.wireframeOpacity = parseFloat(val);
        });

        this.bindSliderAndNum('SliderInstances', 'NumInstances', (val) => {
            const count = parseInt(val, 10);
            this.setInstanceCount(count);
        });

        // Forced LOD Select
        if (this.dom.selectForcedLod) {
            this.dom.selectForcedLod.addEventListener('change', (e) => {
                this.settings.forcedLodLevel = parseInt(e.target.value, 10);
            });
        }

        // Checkboxes
        if (this.dom.checkFrustumCulling) {
            this.dom.checkFrustumCulling.addEventListener('change', (e) => {
                this.settings.frustumCulling = e.target.checked;
            });
        }
        if (this.dom.checkConeCulling) {
            this.dom.checkConeCulling.addEventListener('change', (e) => {
                this.settings.coneCulling = e.target.checked;
            });
        }
        if (this.dom.checkFreezeCulling) {
            this.dom.checkFreezeCulling.addEventListener('change', (e) => {
                this.setFreezeCulling(e.target.checked);
            });
        }
        if (this.dom.checkShowFrustumWireframe) {
            this.dom.checkShowFrustumWireframe.addEventListener('change', (e) => {
                this.settings.showFrozenFrustumWireframe = e.target.checked;
            });
        }
        if (this.dom.checkShowBoundingSpheres) {
            this.dom.checkShowBoundingSpheres.addEventListener('change', (e) => {
                this.settings.showBoundingSpheres = e.target.checked;
            });
        }
        if (this.dom.checkWireframeOverlay) {
            this.dom.checkWireframeOverlay.addEventListener('change', (e) => {
                this.settings.wireframeOverlay = e.target.checked;
            });
        }
        if (this.dom.checkHighlightClusterBorders) {
            this.dom.checkHighlightClusterBorders.addEventListener('change', (e) => {
                this.settings.highlightClusterBorders = e.target.checked;
            });
        }
        if (this.dom.checkShowGroundGrid) {
            this.dom.checkShowGroundGrid.addEventListener('change', (e) => {
                this.settings.showGroundGrid = e.target.checked;
            });
        }

        // Reset View button
        const btnResetView = document.getElementById('BtnResetCamera');
        if (btnResetView) {
            btnResetView.addEventListener('click', () => this.resetCamera());
        }

        // Freeze View button in toolbar
        const btnFreezeView = document.getElementById('BtnFreezeCulling');
        if (btnFreezeView) {
            btnFreezeView.addEventListener('click', () => this.toggleFreezeCulling());
        }

        // Content Browser Drawer Pull Handle
        const btnToggleDrawer = document.getElementById('BtnToggleDrawer');
        if (btnToggleDrawer) {
            btnToggleDrawer.addEventListener('click', () => {
                this.dom.contentDrawer?.classList.toggle('open');
            });
        }

        // OBJ File Upload Input & Drag-and-drop
        const fileInput = document.getElementById('FileInputOBJ');
        if (fileInput) {
            fileInput.addEventListener('change', (e) => {
                const file = e.target.files?.[0];
                if (file) this.loadOBJFile(file);
            });
        }

        const dropZone = document.getElementById('ViewportDropZone');
        if (dropZone) {
            window.addEventListener('dragover', (e) => {
                e.preventDefault();
                dropZone.classList.add('active');
            });
            window.addEventListener('dragleave', (e) => {
                if (e.relatedTarget === null) dropZone.classList.remove('active');
            });
            window.addEventListener('drop', (e) => {
                e.preventDefault();
                dropZone.classList.remove('active');
                const file = e.dataTransfer?.files?.[0];
                if (file && file.name.toLowerCase().endsWith('.obj')) {
                    this.loadOBJFile(file);
                }
            });
        }
    }

    bindSliderAndNum(sliderId, numId, callback) {
        const slider = document.getElementById(sliderId);
        const num = document.getElementById(numId);
        if (!slider || !num) return;

        slider.addEventListener('input', (e) => {
            num.value = e.target.value;
            callback(e.target.value);
        });

        num.addEventListener('change', (e) => {
            slider.value = e.target.value;
            callback(e.target.value);
        });
    }

    setRenderMode(mode) {
        this.settings.renderMode = mode;
        const modeButtons = document.querySelectorAll('[data-view-mode]');
        modeButtons.forEach(btn => {
            const m = RENDER_MODES[btn.getAttribute('data-view-mode')];
            btn.classList.toggle('active', m === mode);
        });
    }

    setFreezeCulling(freeze) {
        this.settings.freezeCulling = freeze;
        if (freeze) {
            this.frozenCamera = this.camera.cloneState();
            if (this.dom.hudFreezePill) this.dom.hudFreezePill.classList.remove('hidden');
        } else {
            this.frozenCamera = null;
            if (this.dom.hudFreezePill) this.dom.hudFreezePill.classList.add('hidden');
        }
        if (this.dom.checkFreezeCulling) this.dom.checkFreezeCulling.checked = freeze;
    }

    toggleFreezeCulling() {
        this.setFreezeCulling(!this.settings.freezeCulling);
    }

    resetCamera() {
        this.camera.target = [0, 0.4, 0];
        this.camera.distance = 3.8;
        this.camera.yaw = 0.45;
        this.camera.pitch = 0.28;
        this.camera.update();
    }

    setInstanceCount(count) {
        this.settings.instanceCount = count;
        if (count <= 1) {
            this.settings.instanceTransforms = [];
        } else {
            this.settings.instanceTransforms = generateInstanceTransforms(count, 3.2);
        }
    }

    /**
     * Load built-in procedural preset or OBJ
     */
    loadPreset(presetName) {
        let rawGeometry = null;

        if (presetName === 'bunny') {
            rawGeometry = generateStanfordBunny(56, 42);
        } else if (presetName === 'dragon') {
            rawGeometry = generateStanfordDragon(64, 28);
        } else if (presetName === 'mountain') {
            rawGeometry = generateFractalMountain(96);
        } else if (presetName === 'sphere') {
            rawGeometry = generateGeodesicSphere(4);
        } else if (presetName === 'column') {
            rawGeometry = generateGothicColumn(60, 40);
        } else if (presetName === 'suzanne') {
            rawGeometry = generateSuzanneHead(42, 32);
        } else if (presetName === 'instances') {
            rawGeometry = generateStanfordBunny(48, 36);
            this.setInstanceCount(25);
            if (this.dom.sliderInstances) this.dom.sliderInstances.value = 25;
            if (this.dom.numInstances) this.dom.numInstances.value = 25;
        }

        if (!rawGeometry) return;

        this.renderer.clearCache();
        this.activeMesh = new NaniteMesh(rawGeometry.name);
        const buildInfo = this.activeMesh.buildFromGeometry(rawGeometry, {
            targetClusterSize: 64,
            clusterGroupSize: 4
        });

        this.selectedCluster = this.activeMesh.clusters[0] || null;

        // Update UI
        if (this.dom.viewportMeshTitle) this.dom.viewportMeshTitle.textContent = rawGeometry.name;
        if (this.dom.viewportBadge) {
            this.dom.viewportBadge.textContent = `${buildInfo.totalClusters} Clusters · ${buildInfo.levels} Levels`;
        }

        this.updateForcedLodDropdown(buildInfo.levels);
        this.updateOutlinerTree();
        this.updateClusterInspector();
    }

    /**
     * Load uploaded OBJ file
     */
    loadOBJFile(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const text = e.target.result;
                const rawGeometry = parseWavefrontOBJ(text, file.name);

                this.renderer.clearCache();
                this.activeMesh = new NaniteMesh(rawGeometry.name);
                const buildInfo = this.activeMesh.buildFromGeometry(rawGeometry, {
                    targetClusterSize: 64,
                    clusterGroupSize: 4
                });

                this.selectedCluster = this.activeMesh.clusters[0] || null;

                if (this.dom.viewportMeshTitle) this.dom.viewportMeshTitle.textContent = file.name;
                if (this.dom.viewportBadge) {
                    this.dom.viewportBadge.textContent = `${buildInfo.totalClusters} Clusters · ${buildInfo.levels} Levels`;
                }

                this.updateForcedLodDropdown(buildInfo.levels);
                this.updateOutlinerTree();
                this.updateClusterInspector();
            } catch (err) {
                alert(`Error parsing OBJ: ${err.message}`);
            }
        };
        reader.readAsText(file);
    }

    updateForcedLodDropdown(levels) {
        if (!this.dom.selectForcedLod) return;
        this.dom.selectForcedLod.innerHTML = `
            <option value="-1">Continuous Nanite Cut</option>
            ${Array.from({ length: levels }, (_, i) => `<option value="${i}">Force LOD ${i} (${i === 0 ? 'Original' : 'Coarser'})</option>`).join('')}
        `;
        this.dom.selectForcedLod.value = "-1";
        this.settings.forcedLodLevel = -1;
    }

    updateOutlinerTree() {
        if (!this.dom.outlinerRows || !this.activeMesh) return;

        let html = `
            <div class="outliner-item active-mesh" data-outliner-type="mesh">
                <span class="icon">📦</span>
                <span class="label"><strong>${this.activeMesh.name}</strong></span>
                <span class="badge">${this.activeMesh.clusters.length} clusters</span>
            </div>
            <div class="outliner-subgroup">
        `;

        for (let lvl = 0; lvl < this.activeMesh.clustersByLevel.length; lvl++) {
            const clusters = this.activeMesh.clustersByLevel[lvl];
            const color = getLodLevelColor(lvl);
            const hexColor = `rgb(${Math.round(color[0]*255)}, ${Math.round(color[1]*255)}, ${Math.round(color[2]*255)})`;

            html += `
                <div class="outliner-item lod-level-row" data-lod-level="${lvl}">
                    <span class="lod-color-dot" style="background:${hexColor};"></span>
                    <span class="label">LOD Level ${lvl} ${lvl === 0 ? '(Leaf)' : '(Simplified)'}</span>
                    <span class="count">${clusters.length}</span>
                </div>
            `;
        }

        html += `</div>`;
        this.dom.outlinerRows.innerHTML = html;
    }

    updateClusterInspector() {
        if (!this.dom.clusterInspectorBody) return;
        const c = this.selectedCluster;
        if (!c) {
            this.dom.clusterInspectorBody.innerHTML = `<p class="empty-note">Click a cluster in the viewport or outliner to inspect.</p>`;
            return;
        }

        const color = getClusterColor(c.id);
        const hexColor = `rgb(${Math.round(color[0]*255)}, ${Math.round(color[1]*255)}, ${Math.round(color[2]*255)})`;
        const lodColor = getLodLevelColor(c.lodLevel);
        const hexLod = `rgb(${Math.round(lodColor[0]*255)}, ${Math.round(lodColor[1]*255)}, ${Math.round(lodColor[2]*255)})`;

        this.dom.clusterInspectorBody.innerHTML = `
            <div class="cluster-hero">
                <div class="cluster-swatch" style="background:${hexColor};"></div>
                <div class="cluster-title-wrap">
                    <h4>Cluster #${c.id}</h4>
                    <span class="cluster-lod-pill" style="background:${hexLod}33; color:${hexLod}; border-color:${hexLod}66;">LOD ${c.lodLevel}</span>
                </div>
            </div>
            <div class="field-grid-2">
                <div class="readout-cell"><small>TRIANGLES</small><strong>${c.triangleCount}</strong></div>
                <div class="readout-cell"><small>VERTICES</small><strong>${c.vertexCount}</strong></div>
                <div class="readout-cell"><small>CLUSTER ERROR (δc)</small><strong>${c.clusterError.toFixed(4)}</strong></div>
                <div class="readout-cell"><small>PARENT ERROR (δp)</small><strong>${c.parentError === Infinity ? '∞ (Root)' : c.parentError.toFixed(4)}</strong></div>
                <div class="readout-cell"><small>SPHERE RADIUS</small><strong>${c.boundingSphere.radius.toFixed(3)}</strong></div>
                <div class="readout-cell"><small>SURFACE AREA</small><strong>${c.surfaceArea.toFixed(3)}</strong></div>
            </div>
            <div class="dag-parents-children">
                <small>PARENT CLUSTERS: ${c.parentIndices.length > 0 ? c.parentIndices.join(', ') : 'None (Root Node)'}</small><br/>
                <small>CHILD CLUSTERS: ${c.childIndices.length > 0 ? c.childIndices.join(', ') : 'None (Leaf Node)'}</small>
            </div>
        `;
    }

    pickClusterAtPixel(screenX, screenY) {
        if (!this.activeMesh) return;
        // Simple bounding sphere ray test to select closest cluster
        const w = this.canvas.clientWidth;
        const h = this.canvas.clientHeight;
        const ndcX = (screenX / w) * 2.0 - 1.0;
        const ndcY = -(screenY / h) * 2.0 + 1.0;

        const invVP = this.camera.invViewProjectionMatrix;
        const pNear = this.renderer.unprojectPoint([ndcX, ndcY, -1], invVP);
        const pFar = this.renderer.unprojectPoint([ndcX, ndcY, 1], invVP);

        const rayDir = Math3D.normalize(Math3D.sub(pFar, pNear));
        const rayOrigin = pNear;

        let closestDist = Infinity;
        let picked = null;

        for (const cluster of this.activeMesh.clusters) {
            const center = cluster.boundingSphere.center;
            const radius = cluster.boundingSphere.radius;

            const oc = Math3D.sub(center, rayOrigin);
            const proj = Math3D.dot(oc, rayDir);
            if (proj < 0) continue;

            const perpSq = Math3D.lengthSq(oc) - proj * proj;
            if (perpSq <= radius * radius) {
                const dist = proj - Math.sqrt(radius * radius - perpSq);
                if (dist < closestDist) {
                    closestDist = dist;
                    picked = cluster;
                }
            }
        }

        if (picked) {
            this.selectedCluster = picked;
            this.updateClusterInspector();
        }
    }

    startRenderLoop() {
        let lastTime = performance.now();
        let frameCounter = 0;
        let fpsTimer = 0;

        const loop = (currentTime) => {
            requestAnimationFrame(loop);

            const dt = (currentTime - lastTime) / 1000.0;
            lastTime = currentTime;

            frameCounter++;
            fpsTimer += dt;
            if (fpsTimer >= 0.5) {
                this.telemetry.fps = Math.round(frameCounter / fpsTimer);
                this.telemetry.frameTimeMs = (1000.0 / this.telemetry.fps).toFixed(1);
                frameCounter = 0;
                fpsTimer = 0;
            }

            if (!this.activeMesh) return;

            // Camera for culling: either frozen snapshot or active camera
            const cullingCam = this.settings.freezeCulling && this.frozenCamera
                ? this.frozenCamera
                : this.camera;

            const viewport = {
                width: this.canvas.clientWidth || 800,
                height: this.canvas.clientHeight || 600
            };

            const evalOptions = {
                pixelTolerance: this.settings.pixelTolerance,
                lodBias: this.settings.lodBias,
                frustumCulling: this.settings.frustumCulling,
                coneCulling: this.settings.coneCulling,
                forcedLodLevel: this.settings.forcedLodLevel
            };

            // Evaluate clusters (single hero or multi-instance)
            let allActiveClusters = [];
            let totalCulledFrustum = 0;
            let totalCulledCone = 0;
            let totalCulledError = 0;
            let totalActiveTriangles = 0;
            let maxError = 0;

            if (this.settings.instanceCount > 1 && this.settings.instanceTransforms.length > 0) {
                for (const xform of this.settings.instanceTransforms) {
                    const result = this.activeMesh.evaluateLOD(cullingCam, viewport, {
                        ...evalOptions,
                        instanceTransform: xform
                    });
                    allActiveClusters.push(...result.activeClusters);
                    totalCulledFrustum += result.culledFrustum;
                    totalCulledCone += result.culledCone;
                    totalCulledError += result.culledError;
                    totalActiveTriangles += result.activeTriangles;
                    if (result.maxProjectedError > maxError) maxError = result.maxProjectedError;
                }
            } else {
                const result = this.activeMesh.evaluateLOD(cullingCam, viewport, evalOptions);
                allActiveClusters = result.activeClusters;
                totalCulledFrustum = result.culledFrustum;
                totalCulledCone = result.culledCone;
                totalCulledError = result.culledError;
                totalActiveTriangles = result.activeTriangles;
                maxError = result.maxProjectedError;
            }

            // Update Telemetry
            const totalOriginalTris = this.activeMesh.totalOriginalTriangles * Math.max(1, this.settings.instanceCount);
            const totalMeshClusters = this.activeMesh.clusters.length * Math.max(1, this.settings.instanceCount);
            const reduction = ((1.0 - totalActiveTriangles / Math.max(1, totalOriginalTris)) * 100).toFixed(1);

            this.telemetry.activeClusters = allActiveClusters.length;
            this.telemetry.totalClusters = totalMeshClusters;
            this.telemetry.renderedTriangles = totalActiveTriangles;
            this.telemetry.originalTriangles = totalOriginalTris;
            this.telemetry.culledFrustum = totalCulledFrustum;
            this.telemetry.culledCone = totalCulledCone;
            this.telemetry.culledError = totalCulledError;
            this.telemetry.reductionPct = reduction;
            this.telemetry.maxProjectedError = maxError;

            // Render GPU Frame
            this.renderer.render(allActiveClusters, this.camera, {
                renderMode: this.settings.renderMode,
                wireframeOverlay: this.settings.wireframeOverlay,
                wireframeOpacity: this.settings.wireframeOpacity,
                highlightClusterBorders: this.settings.highlightClusterBorders,
                showGroundGrid: this.settings.showGroundGrid,
                showBoundingSpheres: this.settings.showBoundingSpheres,
                showFrozenFrustumWireframe: this.settings.showFrozenFrustumWireframe,
                frozenCamera: this.frozenCamera,
                pixelTolerance: this.settings.pixelTolerance,
                baseColor: this.settings.baseColor,
                metallic: this.settings.metallic,
                roughness: this.settings.roughness,
                sunDirection: this.settings.sunDirection,
                sunColor: this.settings.sunColor,
                ambientColor: this.settings.ambientColor
            });

            this.updateDOMTelemetry();
        };

        requestAnimationFrame(loop);
    }

    updateDOMTelemetry() {
        const t = this.telemetry;
        if (this.dom.statActiveClusters) this.dom.statActiveClusters.textContent = t.activeClusters.toLocaleString();
        if (this.dom.statTotalClusters) this.dom.statTotalClusters.textContent = t.totalClusters.toLocaleString();
        if (this.dom.statRenderedTris) this.dom.statRenderedTris.textContent = t.renderedTriangles.toLocaleString();
        if (this.dom.statReductionPct) this.dom.statReductionPct.textContent = `-${t.reductionPct}%`;
        if (this.dom.statScreenErrorMax) this.dom.statScreenErrorMax.textContent = `${t.maxProjectedError.toFixed(2)} px`;
        if (this.dom.statTargetTolerance) this.dom.statTargetTolerance.textContent = `${this.settings.pixelTolerance.toFixed(1)} px`;
        if (this.dom.statFps) this.dom.statFps.textContent = `${t.fps}`;
        if (this.dom.statFrameTime) this.dom.statFrameTime.textContent = `${t.frameTimeMs} ms`;

        if (this.dom.outlinerActiveBadge) this.dom.outlinerActiveBadge.textContent = t.activeClusters;
        if (this.dom.outlinerCulledBadge) this.dom.outlinerCulledBadge.textContent = (t.culledFrustum + t.culledCone + t.culledError);
        if (this.dom.outlinerTotalBadge) this.dom.outlinerTotalBadge.textContent = t.totalClusters;

        if (this.dom.footerFps) this.dom.footerFps.textContent = `${t.fps} FPS · ${t.frameTimeMs} ms`;
        if (this.dom.footerClusters) this.dom.footerClusters.textContent = `${t.activeClusters} / ${t.totalClusters}`;
        if (this.dom.footerTris) this.dom.footerTris.textContent = `${t.renderedTriangles.toLocaleString()} (${t.reductionPct}% saved)`;

        if (this.dom.hudActiveClusters) this.dom.hudActiveClusters.textContent = `${t.activeClusters} clusters`;
        if (this.dom.hudRenderedTris) this.dom.hudRenderedTris.textContent = `${t.renderedTriangles.toLocaleString()} tris`;
        if (this.dom.hudScreenError) this.dom.hudScreenError.textContent = `Err: ${t.maxProjectedError.toFixed(1)}px / ${this.settings.pixelTolerance.toFixed(1)}px`;
        if (this.dom.hudFpsPill) this.dom.hudFpsPill.textContent = `${t.fps} FPS`;
    }
}
