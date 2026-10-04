// PaintEngine3D.js
// High-performance Three.js 3D Viewport with PBR shading, Raycast UV picking, and Brush Cursor

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { ModelLibrary } from "./ModelLibrary.js";

export class PaintEngine3D {
  constructor(canvas, compositor) {
    this.canvas = canvas;
    this.compositor = compositor;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;

    // Scene & Camera
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color("#0d0d0d");

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    this.camera.position.set(0, 1.2, 3.4);

    // Controls
    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.target.set(0, 0, 0);

    // Raycaster
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Lighting Setup
    this.lightsGroup = new THREE.Group();
    this.scene.add(this.lightsGroup);
    this.currentLighting = "studio";
    this.setupLighting("studio");

    // Mesh Materials
    this.setupMaterials();

    // Active Mesh
    this.currentMesh = null;
    this.wireframeMesh = null;
    this.showWireframe = false;
    this.currentModelId = "helmet";
    this.loadModel("helmet");

    // 3D Brush Projection Cursor Ring
    this.brushCursor = this.createBrushCursor();
    this.scene.add(this.brushCursor);

    // Viewport Mode & Channels
    this.renderChannel = "lit"; // "lit", "base_color", "roughness", "metallic", "normal", "height"

    // Turntable
    this.turntableActive = false;
    this.turntableSpeed = 0.01;

    // Animation Loop
    this.lastTime = performance.now();
    this.fps = 60;
    this.frameCount = 0;
    this.fpsTimer = performance.now();

    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);

    this.resize();
  }

  setupMaterials() {
    // 1. Full Lit PBR Material
    this.pbrMaterial = new THREE.MeshStandardMaterial({
      map: this.compositor.baseColorTexture,
      roughnessMap: this.compositor.roughnessTexture,
      metalnessMap: this.compositor.metalnessTexture,
      normalMap: this.compositor.normalTexture,
      normalScale: new THREE.Vector2(1.0, 1.0),
      emissiveMap: this.compositor.emissiveTexture,
      emissive: new THREE.Color("#ffffff"),
      roughness: 1.0,
      metalness: 1.0,
      side: THREE.DoubleSide
    });

    // 2. Unlit Albedo Channel
    this.baseColorMaterial = new THREE.MeshBasicMaterial({
      map: this.compositor.baseColorTexture,
      side: THREE.DoubleSide
    });

    // 3. Unlit Roughness Channel
    this.roughnessMaterial = new THREE.MeshBasicMaterial({
      map: this.compositor.roughnessTexture,
      side: THREE.DoubleSide
    });

    // 4. Unlit Metalness Channel
    this.metalnessMaterial = new THREE.MeshBasicMaterial({
      map: this.compositor.metalnessTexture,
      side: THREE.DoubleSide
    });

    // 5. Unlit Normal Channel
    this.normalMaterial = new THREE.MeshNormalMaterial({
      side: THREE.DoubleSide
    });

    // 6. Unlit Height Channel
    this.heightMaterial = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(this.compositor.heightCanvas),
      side: THREE.DoubleSide
    });

    // Wireframe Overlay Material
    this.wireframeMaterial = new THREE.MeshBasicMaterial({
      color: 0x64d2ff,
      wireframe: true,
      transparent: true,
      opacity: 0.25
    });
  }

  setupLighting(preset) {
    this.currentLighting = preset;
    while (this.lightsGroup.children.length > 0) {
      this.lightsGroup.remove(this.lightsGroup.children[0]);
    }

    if (preset === "studio") {
      // Clean 3-point Studio Lighting
      const ambient = new THREE.AmbientLight(0xffffff, 0.4);
      const key = new THREE.DirectionalLight(0xfff5ea, 1.6);
      key.position.set(4, 5, 4);

      const fill = new THREE.DirectionalLight(0xdbe9ff, 0.8);
      fill.position.set(-4, 3, 2);

      const rim = new THREE.DirectionalLight(0xffffff, 0.6);
      rim.position.set(0, -3, -4);

      this.lightsGroup.add(ambient, key, fill, rim);
      this.scene.background = new THREE.Color("#0c0c0e");
    } else if (preset === "cyberpunk") {
      // High contrast Cyan & Magenta Rim
      const ambient = new THREE.AmbientLight(0x0a1020, 0.5);
      const keyCyan = new THREE.DirectionalLight(0x00f0ff, 2.2);
      keyCyan.position.set(4, 3, 2);

      const rimPink = new THREE.DirectionalLight(0xff007f, 2.2);
      rimPink.position.set(-4, 2, -2);

      const underGlow = new THREE.DirectionalLight(0x7928ca, 0.8);
      underGlow.position.set(0, -4, 2);

      this.lightsGroup.add(ambient, keyCyan, rimPink, underGlow);
      this.scene.background = new THREE.Color("#06070a");
    } else if (preset === "sunset") {
      // Warm Golden Hour
      const ambient = new THREE.AmbientLight(0x2c1f30, 0.6);
      const sun = new THREE.DirectionalLight(0xff9e44, 2.2);
      sun.position.set(5, 2, 3);

      const skyFill = new THREE.DirectionalLight(0x4070a0, 0.7);
      skyFill.position.set(-3, 4, -2);

      this.lightsGroup.add(ambient, sun, skyFill);
      this.scene.background = new THREE.Color("#100c0f");
    } else if (preset === "dark_rim") {
      // Moody Dark Silhouette
      const ambient = new THREE.AmbientLight(0x111111, 0.2);
      const rim1 = new THREE.DirectionalLight(0xffffff, 3.0);
      rim1.position.set(-4, 4, -4);

      const rim2 = new THREE.DirectionalLight(0x88bbff, 1.5);
      rim2.position.set(4, -2, -3);

      this.lightsGroup.add(ambient, rim1, rim2);
      this.scene.background = new THREE.Color("#050505");
    } else if (preset === "warehouse") {
      // Cool Industrial Warehouse
      const ambient = new THREE.AmbientLight(0xd0d8e0, 0.7);
      const overhead = new THREE.DirectionalLight(0xf0f4f8, 1.4);
      overhead.position.set(0, 6, 0);

      const side = new THREE.DirectionalLight(0xb0c0d0, 0.5);
      side.position.set(4, 1, 4);

      this.lightsGroup.add(ambient, overhead, side);
      this.scene.background = new THREE.Color("#0f1215");
    }
  }

  setRenderChannel(channel) {
    this.renderChannel = channel;
    if (!this.currentMesh) return;

    if (channel === "lit") {
      this.currentMesh.material = this.pbrMaterial;
    } else if (channel === "base_color") {
      this.currentMesh.material = this.baseColorMaterial;
    } else if (channel === "roughness") {
      this.currentMesh.material = this.roughnessMaterial;
    } else if (channel === "metallic") {
      this.currentMesh.material = this.metalnessMaterial;
    } else if (channel === "normal") {
      this.currentMesh.material = this.normalMaterial;
    } else if (channel === "height") {
      this.heightMaterial.map.needsUpdate = true;
      this.currentMesh.material = this.heightMaterial;
    }
  }

  toggleWireframe(visible) {
    this.showWireframe = visible !== undefined ? visible : !this.showWireframe;
    if (this.wireframeMesh) {
      this.wireframeMesh.visible = this.showWireframe;
    }
  }

  createBrushCursor() {
    const geometry = new THREE.RingGeometry(0.04, 0.05, 32);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
      depthTest: false
    });
    const cursor = new THREE.Mesh(geometry, material);
    cursor.visible = false;
    cursor.renderOrder = 999;
    return cursor;
  }

  updateBrushCursor(hit, brushSizePx, totalTexSize = 2048) {
    if (!hit) {
      this.brushCursor.visible = false;
      return;
    }
    this.brushCursor.visible = true;
    this.brushCursor.position.copy(hit.point).addScaledVector(hit.normal, 0.005);

    // Align cursor ring with surface normal
    this.brushCursor.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hit.normal);

    // Estimate 3D scale based on brush radius percentage
    const uvFraction = (brushSizePx / totalTexSize) * 2.5;
    this.brushCursor.scale.set(uvFraction, uvFraction, uvFraction);
  }

  loadModel(modelId, customGeometry = null) {
    this.currentModelId = modelId;

    if (this.currentMesh) {
      this.scene.remove(this.currentMesh);
      if (this.wireframeMesh) this.scene.remove(this.wireframeMesh);
    }

    let geometry = customGeometry;

    if (!geometry) {
      if (modelId === "helmet") {
        geometry = ModelLibrary.createSciFiHelmet();
      } else if (modelId === "drone") {
        geometry = ModelLibrary.createMechDrone();
      } else if (modelId === "teapot") {
        geometry = ModelLibrary.createTeapot();
      } else if (modelId === "blaster") {
        geometry = ModelLibrary.createBlaster();
      } else if (modelId === "crate") {
        geometry = ModelLibrary.createUnwrappedBox();
      } else if (modelId === "canister") {
        geometry = ModelLibrary.createFuelCanister();
      } else if (modelId === "sphere") {
        geometry = ModelLibrary.createSphere();
      } else if (modelId === "torus") {
        geometry = ModelLibrary.createTorus();
      } else {
        geometry = ModelLibrary.createUnwrappedBox();
      }
    }

    this.currentMesh = new THREE.Mesh(geometry, this.pbrMaterial);
    this.currentMesh.castShadow = true;
    this.currentMesh.receiveShadow = true;
    this.scene.add(this.currentMesh);

    // Create wireframe overlay mesh
    this.wireframeMesh = new THREE.Mesh(geometry, this.wireframeMaterial);
    this.wireframeMesh.visible = this.showWireframe;
    this.scene.add(this.wireframeMesh);

    this.setRenderChannel(this.renderChannel);
  }

  raycast(clientX, clientY) {
    if (!this.currentMesh) return null;

    const rect = this.canvas.getBoundingClientRect();
    this.mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);
    const intersects = this.raycaster.intersectObject(this.currentMesh, false);

    if (intersects.length > 0) {
      const hit = intersects[0];
      if (hit.uv) {
        return {
          uv: hit.uv,
          point: hit.point,
          normal: hit.face ? hit.face.normal.clone().applyQuaternion(this.currentMesh.quaternion) : new THREE.Vector3(0, 1, 0)
        };
      }
    }
    return null;
  }

  setCameraView(view) {
    const dist = 3.2;
    if (view === "front") {
      this.camera.position.set(0, 0, dist);
    } else if (view === "side") {
      this.camera.position.set(dist, 0, 0);
    } else if (view === "top") {
      this.camera.position.set(0, dist, 0.001);
    } else if (view === "perspective" || view === "iso") {
      this.camera.position.set(dist * 0.7, dist * 0.6, dist * 0.7);
    }
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  resetCamera() {
    this.camera.position.set(0, 1.2, 3.4);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  toggleTurntable() {
    this.turntableActive = !this.turntableActive;
    return this.turntableActive;
  }

  resize() {
    const width = this.canvas.parentElement ? this.canvas.parentElement.clientWidth : 800;
    const height = this.canvas.parentElement ? this.canvas.parentElement.clientHeight : 600;

    if (width === 0 || height === 0) return;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  animate() {
    requestAnimationFrame(this.animate);

    // Turntable spin
    if (this.turntableActive && this.currentMesh) {
      this.currentMesh.rotation.y += this.turntableSpeed;
      if (this.wireframeMesh) {
        this.wireframeMesh.rotation.y = this.currentMesh.rotation.y;
      }
    }

    this.controls.update();
    this.renderer.render(this.scene, this.camera);

    // FPS Meter
    this.frameCount++;
    const now = performance.now();
    if (now - this.fpsTimer >= 500) {
      this.fps = Math.round((this.frameCount * 1000) / (now - this.fpsTimer));
      this.frameCount = 0;
      this.fpsTimer = now;
    }
  }
}
