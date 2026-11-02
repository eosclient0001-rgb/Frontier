import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { InterpolateCandela } from "./photometry.mjs";

const MaximumSpotHalfAngle = THREE.MathUtils.degToRad(89.5);
const ProfileResolution = 256;
const AngularResolution = 4096;

export function ConstructPhotometricCookieTexture(Points, OuterAngle) {
  const Pixels = new Uint8Array(ProfileResolution * ProfileResolution * 4);
  const HalfAngle = Math.min(
    THREE.MathUtils.degToRad(OuterAngle),
    MaximumSpotHalfAngle,
  );
  const Tangent = Math.tan(HalfAngle);
  const PeakCandela = Math.max(...Points.map((Point) => Point.cd), 1);
  const AngularSamples = Float32Array.from(
    { length: AngularResolution },
    (_, SampleIndex) =>
      InterpolateCandela(
        Points,
        (SampleIndex / (AngularResolution - 1)) * OuterAngle,
      ),
  );

  for (let Y = 0; Y < ProfileResolution; Y++) {
    for (let X = 0; X < ProfileResolution; X++) {
      const U = ((X + 0.5) / ProfileResolution) * 2 - 1;
      const V = ((Y + 0.5) / ProfileResolution) * 2 - 1;
      const Radius = Math.hypot(U, V);
      const TextureIndex = (Y * ProfileResolution + X) * 4;
      const AngleFraction =
        THREE.MathUtils.radToDeg(Math.atan(Radius * Tangent)) / OuterAngle;
      const AngularIndex = Math.min(
        AngularResolution - 1,
        Math.round(AngleFraction * (AngularResolution - 1)),
      );
      const Candela = Radius <= 1 ? AngularSamples[AngularIndex] : 0;
      const ProfileFraction = Math.round((255 * Candela) / PeakCandela);
      Pixels[TextureIndex] = ProfileFraction;
      Pixels[TextureIndex + 1] = ProfileFraction;
      Pixels[TextureIndex + 2] = ProfileFraction;
      Pixels[TextureIndex + 3] = 255;
    }
  }

  const Texture = new THREE.DataTexture(
    Pixels,
    ProfileResolution,
    ProfileResolution,
    THREE.RGBAFormat,
  );
  Texture.magFilter = THREE.LinearFilter;
  Texture.minFilter = THREE.LinearFilter;
  Texture.wrapS = THREE.ClampToEdgeWrapping;
  Texture.wrapT = THREE.ClampToEdgeWrapping;
  Texture.colorSpace = THREE.NoColorSpace;
  Texture.needsUpdate = true;
  return Texture;
}

function ConstructMaterialRoom(Scene) {
  const FloorMaterial = new THREE.MeshStandardMaterial({
    color: "#77736d",
    roughness: 0.78,
    metalness: 0.02,
  });
  const WallMaterial = new THREE.MeshStandardMaterial({
    color: "#b8b2aa",
    roughness: 0.84,
  });
  const SideMaterial = new THREE.MeshStandardMaterial({
    color: "#817b73",
    roughness: 0.88,
  });
  const Floor = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), FloorMaterial);
  Floor.rotation.x = -Math.PI / 2;
  Floor.position.y = -0.025;
  Floor.receiveShadow = true;
  Scene.add(Floor);

  const BackWall = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), WallMaterial);
  BackWall.position.set(0, 3, -4);
  BackWall.receiveShadow = true;
  Scene.add(BackWall);

  const LeftWall = new THREE.Mesh(new THREE.PlaneGeometry(12, 6), SideMaterial);
  LeftWall.rotation.y = Math.PI / 2;
  LeftWall.position.set(-6, 3, 0);
  LeftWall.receiveShadow = true;
  Scene.add(LeftWall);

  const SphereMaterial = new THREE.MeshStandardMaterial({
    color: "#bdb6aa",
    roughness: 0.24,
    metalness: 0.08,
  });
  const Sphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.68, 64, 48),
    SphereMaterial,
  );
  Sphere.position.set(0.85, 0.69, -0.9);
  Sphere.castShadow = true;
  Sphere.receiveShadow = true;
  Scene.add(Sphere);

  const CeramicMaterial = new THREE.MeshStandardMaterial({
    color: "#a95031",
    roughness: 0.37,
    metalness: 0.02,
  });
  const CeramicBlock = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1.25, 1.2),
    CeramicMaterial,
  );
  CeramicBlock.position.set(-1.65, 0.625, -1.6);
  CeramicBlock.castShadow = true;
  CeramicBlock.receiveShadow = true;
  Scene.add(CeramicBlock);

  const MetalMaterial = new THREE.MeshStandardMaterial({
    color: "#c6c8c7",
    roughness: 0.2,
    metalness: 0.84,
  });
  const MetalSphere = new THREE.Mesh(
    new THREE.SphereGeometry(0.46, 48, 32),
    MetalMaterial,
  );
  MetalSphere.position.set(2.45, 0.47, -2.15);
  MetalSphere.castShadow = true;
  MetalSphere.receiveShadow = true;
  Scene.add(MetalSphere);

  const PlinthMaterial = new THREE.MeshStandardMaterial({
    color: "#37393a",
    roughness: 0.42,
    metalness: 0.3,
  });
  const Plinth = new THREE.Mesh(
    new THREE.CylinderGeometry(0.8, 0.8, 0.14, 64),
    PlinthMaterial,
  );
  Plinth.position.set(0.85, 0.07, -0.9);
  Plinth.castShadow = true;
  Plinth.receiveShadow = true;
  Scene.add(Plinth);
}

function ResolveTarget(Scene, Target) {
  if (Scene.Light && Scene.Light.target && Target) {
    Scene.Light.target.position.set(Target[0], Target[1], Target[2]);
  }
}

export function CreateLightingViewport(Canvas, StatusCallback = () => {}) {
  const Renderer = new THREE.WebGLRenderer({
    canvas: Canvas,
    antialias: true,
    alpha: false,
  });
  Renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  Renderer.outputColorSpace = THREE.SRGBColorSpace;
  Renderer.toneMapping = THREE.ACESFilmicToneMapping;
  Renderer.toneMappingExposure = 1;
  Renderer.shadowMap.enabled = true;
  Renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const Scene = new THREE.Scene();
  Scene.background = new THREE.Color("#17191b");
  const Camera = new THREE.PerspectiveCamera(42, 1, 0.05, 100);
  Camera.position.set(7.5, 5.4, 8.4);
  const Controls = new OrbitControls(Camera, Canvas);
  Controls.target.set(0, 1.15, -0.8);
  Controls.enableDamping = true;
  Controls.minDistance = 2.5;
  Controls.maxDistance = 24;
  Controls.maxPolarAngle = Math.PI / 2 - 0.025;
  Controls.update();
  Controls.saveState();
  ConstructMaterialRoom(Scene);

  const EnvironmentLoader = new THREE.TextureLoader();
  let EnvironmentTarget = null;
  let EnvironmentImage = null;
  let EnvironmentRequest = 0;
  let CurrentEnvironmentMap = "";

  function SetEnvironment(Settings = {}) {
    const AvailableMaps = ["StudioSoftbox", "StudioStrip", "WindowLight", "Overcast", "DarkStudio"];
    const MapName = Settings.map === "none"
      ? "none"
      : AvailableMaps.includes(Settings.map)
        ? Settings.map
        : "StudioSoftbox";
    const Intensity = THREE.MathUtils.clamp(Number(Settings.intensity ?? 1), 0, 3);
    const Rotation = THREE.MathUtils.degToRad(Number(Settings.rotation ?? 0));
    Scene.environmentIntensity = Intensity;
    Scene.environmentRotation.set(0, Rotation, 0);
    if (MapName === CurrentEnvironmentMap) return;
    CurrentEnvironmentMap = MapName;
    const Request = ++EnvironmentRequest;
    if (EnvironmentImage) {
      EnvironmentImage.dispose();
      EnvironmentImage = null;
    }
    EnvironmentTarget?.dispose();
    EnvironmentTarget = null;
    Scene.environment = null;
    if (MapName === "none") {
      StatusCallback("Environment lighting off · direct-light preview remains active");
      return;
    }
    const Texture = EnvironmentLoader.load(
      `../../../EngineContent/EnvironmentArchives/${MapName}.png`,
      (LoadedTexture) => {
        const Generator = new THREE.PMREMGenerator(Renderer);
        const Target = Generator.fromEquirectangular(LoadedTexture);
        Generator.dispose();
        LoadedTexture.dispose();
        if (EnvironmentImage === LoadedTexture) EnvironmentImage = null;
        if (Request !== EnvironmentRequest) {
          Target.dispose();
          return;
        }
        EnvironmentTarget = Target;
        Scene.environment = Target.texture;
        StatusCallback(`${MapName.replace(/([A-Z])/g, " $1").trim()} loaded · IBL reflections and fill`);
      },
      undefined,
      () => {
        if (Request !== EnvironmentRequest) return;
        StatusCallback("Environment image unavailable · direct-light preview remains active");
      },
    );
    EnvironmentImage = Texture;
  }

  let ProfileTexture = null;
  let Light = null;
  let AnimationRequest = 0;
  let Disposed = false;
  const SourceMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.065, 20, 12),
    new THREE.MeshBasicMaterial({ color: "#fff2dc" }),
  );
  const AreaAperture = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: "#fff2dc", side: THREE.DoubleSide }),
  );
  Scene.add(SourceMarker, AreaAperture);

  function ReconfigureSceneLight(Specification) {
    if (Light) {
      Scene.remove(Light);
      if (Light.dispose) Light.dispose();
      if (Light.target) Scene.remove(Light.target);
    }
    if (ProfileTexture) {
      ProfileTexture.dispose();
      ProfileTexture = null;
    }

    const Color = new THREE.Color(Specification.color || "#fff2dc");
    if (Specification.type === "ambient") {
      Light = new THREE.AmbientLight(Color, Specification.intensity);
    } else if (Specification.type === "hemisphere") {
      Light = new THREE.HemisphereLight(Color, new THREE.Color(Specification.groundColor || "#48433b"), Specification.intensity);
    } else if (Specification.type === "point") {
      Light = new THREE.PointLight(Color, Specification.intensity, 0, 2);
      Light.castShadow = true;
      Light.shadow.camera.near = 0.05;
      Light.shadow.camera.far = 30;
    } else if (Specification.type === "area") {
      Light = new THREE.RectAreaLight(
        Color,
        Specification.intensity,
        Specification.width,
        Specification.height,
      );
    } else if (Specification.type === "directional") {
      Light = new THREE.DirectionalLight(Color, Specification.intensity);
      Light.castShadow = true;
      Light.shadow.mapSize.set(1536, 1536);
      Light.shadow.camera.near = 0.05;
      Light.shadow.camera.far = 30;
      Light.shadow.camera.left = -7;
      Light.shadow.camera.right = 7;
      Light.shadow.camera.top = 7;
      Light.shadow.camera.bottom = -7;
    } else {
      let IESOuterAngle = 0.1;
      for (
        let PointIndex = 0;
        PointIndex < Specification.points.length;
        PointIndex++
      ) {
        if (Specification.points[PointIndex].cd > 0) {
          IESOuterAngle = Specification.points[PointIndex + 1]?.angle ?? 180;
        }
      }
      const OuterAngle =
        Specification.type === "ies"
          ? Math.min(IESOuterAngle, 89.5)
          : Math.min(Math.max(Specification.outer, 0.1), 89.5);
      const PeakCandela =
        Specification.type === "ies"
          ? Math.max(...Specification.points.map((Point) => Point.cd), 0)
          : Specification.intensity;
      Light = new THREE.SpotLight(
        Color,
        PeakCandela,
        0,
        THREE.MathUtils.degToRad(OuterAngle),
        0,
        2,
      );
      Light.castShadow = true;
      Light.shadow.mapSize.set(1536, 1536);
      Light.shadow.camera.near = 0.05;
      Light.shadow.camera.far = 30;
      Light.shadow.bias = -0.00008;
      Light.shadow.normalBias = 0.018;
      ProfileTexture = ConstructPhotometricCookieTexture(
        Specification.points,
        OuterAngle,
      );
      Light.map = ProfileTexture;
    }
    Light.position.set(...(Specification.position || [0, 4, 0]));
    const Target = [...(Specification.target || [0, 0, 0])];
    if (
      new THREE.Vector3(...Target).distanceToSquared(Light.position) < 0.000001
    ) {
      Target[1] -= 1;
    }
    if (Light.target) {
      Scene.add(Light.target);
      ResolveTarget({ Light }, Target);
    }
    Scene.add(Light);
    if (Light.isRectAreaLight) {
      Light.lookAt(...Target);
    }
    SourceMarker.position.copy(Light.position);
    SourceMarker.material.color.copy(Color);
    SourceMarker.visible = ["ies", "spot", "point"].includes(Specification.type);
    AreaAperture.position.copy(Light.position);
    AreaAperture.lookAt(...Target);
    AreaAperture.scale.set(
      Specification.width || 1,
      Specification.height || 1,
      1,
    );
    AreaAperture.material.color.copy(Color);
    AreaAperture.visible = Specification.type === "area";
  }

  function Resize() {
    const Width = Canvas.clientWidth;
    const Height = Canvas.clientHeight;
    if (Width < 1 || Height < 1) return;
    const RendererDimensions = Renderer.getSize(new THREE.Vector2());
    if (RendererDimensions.x !== Width || RendererDimensions.y !== Height) {
      Renderer.setSize(Width, Height, false);
      Camera.aspect = Width / Height;
      Camera.updateProjectionMatrix();
    }
  }

  function Animate() {
    if (Disposed) return;
    AnimationRequest = window.requestAnimationFrame(Animate);
    Resize();
    Controls.update();
    Renderer.render(Scene, Camera);
  }

  SetEnvironment({ map: "StudioSoftbox", intensity: 1, rotation: 0 });

  ReconfigureSceneLight({
    type: "ies",
    points: [
      { angle: 0, cd: 1200 },
      { angle: 180, cd: 0 },
    ],
    position: [0, 4, 0],
    target: [0, 0, 0],
    color: "#fff2dc",
    intensity: 1200,
  });
  Animate();

  return {
    Reconfigure(Specification) {
      ReconfigureSceneLight(Specification);
    },
    SetEnvironment(Settings) {
      SetEnvironment(Settings);
    },
    ResetView() {
      Controls.reset();
    },
    Dispose() {
      Disposed = true;
      window.cancelAnimationFrame(AnimationRequest);
      Controls.dispose();
      Renderer.dispose();
      SourceMarker.geometry.dispose();
      SourceMarker.material.dispose();
      AreaAperture.geometry.dispose();
      AreaAperture.material.dispose();
      EnvironmentTarget?.dispose();
      EnvironmentImage?.dispose();
      if (ProfileTexture) ProfileTexture.dispose();
      if (Light && Light.dispose) Light.dispose();
    },
  };
}
