import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Catalog, CatalogIds, Pipeline, SampleHeight, NormalizeLongitude } from "./planet-data.mjs";

const $ = (Id) => document.getElementById(Id);
const StorageKey = "frontier-planetary-surface-studio-v2";
const Canvas = $("scene");
let Renderer = null;
try {
  Renderer = new THREE.WebGLRenderer({ canvas: Canvas, antialias: true, alpha: false, powerPreference: "high-performance" });
  Renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  Renderer.outputColorSpace = THREE.SRGBColorSpace;
  Renderer.toneMapping = THREE.NoToneMapping;
  Renderer.setClearColor("#090b0d", 1);
} catch (Error) {
  console.error("WebGL renderer unavailable:", Error);
}

const Scene = new THREE.Scene();
Scene.background = new THREE.Color("#090b0d");
const Camera = new THREE.PerspectiveCamera(34, 1, 0.05, 30);
Camera.position.set(0.05, 0.24, 3.45);
const Controls = new OrbitControls(Camera, Canvas);
Controls.enablePan = false;
Controls.enableDamping = true;
Controls.dampingFactor = 0.075;
Controls.minDistance = 1.35;
Controls.maxDistance = 7;
Controls.rotateSpeed = 0.48;
Controls.update();

Scene.add(new THREE.HemisphereLight("#c7c9ca", "#262729", 0.33));
const Sun = new THREE.DirectionalLight("#fff5df", 3.2);
Scene.add(Sun);
const PlanetGroup = new THREE.Group();
Scene.add(PlanetGroup);
const Raycaster = new THREE.Raycaster();
const Pointer = new THREE.Vector2();
const TextureLoader = new THREE.TextureLoader();

const DefaultSettings = { body: "earth", mode: "surface", exaggeration: 1, azimuth: 315, altitude: 35, atmosphereStrength: 0.34, filter: "all" };
let Settings = ReadSettings();
let CurrentBodyId = Settings.body;
let CurrentMode = Settings.mode;
let CurrentFilter = Settings.filter;
let CurrentGrid = null;
let CurrentMesh = null;
let CurrentAtmosphere = null;
let CurrentTexture = null;
let BasePositions = null;
let CurrentHit = null;
let ToastTimer = 0;
let AnimationFrame = 0;
const GeometrySegments = { width: 512, height: 256 };

function ReadSettings() {
  try {
    const Saved = JSON.parse(localStorage.getItem(StorageKey) || "{}");
    const Body = Catalog[Saved.body] ? Saved.body : DefaultSettings.body;
    const Mode = ["surface", "elevation", "illustration"].includes(Saved.mode) ? Saved.mode : DefaultSettings.mode;
    return {
      body: Body,
      mode: SupportsMode(Catalog[Body], Mode) ? Mode : DefaultMode(Catalog[Body]),
      exaggeration: Number.isFinite(Saved.exaggeration) ? THREE.MathUtils.clamp(Saved.exaggeration, 0, 3) : 1,
      azimuth: Number.isFinite(Saved.azimuth) ? THREE.MathUtils.clamp(Saved.azimuth, 0, 359) : 315,
      altitude: Number.isFinite(Saved.altitude) ? THREE.MathUtils.clamp(Saved.altitude, 5, 85) : 35,
      atmosphereStrength: Number.isFinite(Saved.atmosphereStrength) ? THREE.MathUtils.clamp(Saved.atmosphereStrength, 0, 1) : 0.34,
      filter: ["all", "planet", "moon", "dwarf"].includes(Saved.filter) ? Saved.filter : "all",
    };
  } catch {
    return { ...DefaultSettings };
  }
}

function DefaultMode(Body) {
  if (Body?.imageFile) return "surface";
  if (Body?.aiUvFile) return "illustration";
  return "elevation";
}

function SupportsMode(Body, Mode) {
  if (!Body) return false;
  if (Mode === "surface") return Boolean(Body.imageFile && Body.heightFile);
  if (Mode === "elevation") return Boolean(Body.heightFile && Body.sourceHeight);
  if (Mode === "illustration") return Boolean(Body.aiUvFile);
  return false;
}

function SaveSettings() {
  try {
    localStorage.setItem(StorageKey, JSON.stringify({
      body: CurrentBodyId,
      mode: CurrentMode,
      exaggeration: Settings.exaggeration,
      azimuth: Settings.azimuth,
      altitude: Settings.altitude,
      atmosphereStrength: Settings.atmosphereStrength,
      filter: CurrentFilter,
    }));
  } catch {
    // Browser storage is optional.
  }
}

function SetSceneStatus(Message, Visible = true) {
  $("sceneStatus").textContent = Message;
  $("sceneStatus").hidden = !Visible;
}

function ShowToast(Message) {
  const Element = $("toast");
  Element.textContent = Message;
  Element.classList.add("visible");
  window.clearTimeout(ToastTimer);
  ToastTimer = window.setTimeout(() => Element.classList.remove("visible"), 2300);
}

function FormatNumber(Value, MaximumFractionDigits = 0) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: MaximumFractionDigits }).format(Value);
}

function UpdateSun() {
  const Azimuth = THREE.MathUtils.degToRad(Settings.azimuth);
  const Altitude = THREE.MathUtils.degToRad(Settings.altitude);
  Sun.position.set(Math.sin(Azimuth) * Math.cos(Altitude) * 8, Math.sin(Altitude) * 8, Math.cos(Azimuth) * Math.cos(Altitude) * 8);
  $("sunAzimuthValue").textContent = `${Settings.azimuth}°`;
  $("sunAltitudeValue").textContent = `${Settings.altitude}°`;
}

function InterpolateRamp(Value, Stops) {
  const T = THREE.MathUtils.clamp(Value, 0, 1);
  for (let Index = 1; Index < Stops.length; Index += 1) {
    const [Position, Color] = Stops[Index];
    if (T <= Position) {
      const [PreviousPosition, PreviousColor] = Stops[Index - 1];
      const Amount = (T - PreviousPosition) / (Position - PreviousPosition);
      return new THREE.Color(PreviousColor).lerp(new THREE.Color(Color), Amount);
    }
  }
  return new THREE.Color(Stops.at(-1)[1]);
}

function ElevationColor(Body, Elevation) {
  const [Minimum, Maximum] = Body.heightRangeM;
  const T = (Elevation - Minimum) / Math.max(1, Maximum - Minimum);
  if (Body.id === "earth") return InterpolateRamp(T, [[0,"#061d38"],[.27,"#185379"],[.54,"#477b5d"],[.69,"#a2a36b"],[.85,"#956f4f"],[1,"#e9e8df"]]);
  if (Body.id === "venus") return InterpolateRamp(T, [[0,"#3b2716"],[.38,"#76512d"],[.66,"#bb9154"],[1,"#f0d5a1"]]);
  if (Body.id === "mars") return InterpolateRamp(T, [[0,"#282b34"],[.24,"#75523f"],[.57,"#bc7950"],[.82,"#e5b984"],[1,"#eee7d9"]]);
  if (Body.id === "ceres" || Body.id === "pluto") return InterpolateRamp(T, [[0,"#283039"],[.3,"#686a68"],[.65,"#aaa69a"],[1,"#eee2cf"]]);
  return InterpolateRamp(T, [[0,"#29313b"],[.42,"#666c70"],[.72,"#a5a9a9"],[1,"#f0f1ec"]]);
}

function SampleGridAtVertex(Grid, U, V) {
  const W = 1024;
  const H = 512;
  const X = Math.min(W - 1, Math.floor((((U % 1) + 1) % 1) * W));
  const Y = THREE.MathUtils.clamp(Math.round((1 - V) * (H - 1)), 0, H - 1);
  return Grid[Y * W + X];
}

function CreateGlobeGeometry(Body, Grid) {
  const Geometry = new THREE.SphereGeometry(1, GeometrySegments.width, GeometrySegments.height);
  const Positions = Geometry.attributes.position;
  const Uvs = Geometry.attributes.uv;
  const Colors = new Float32Array(Positions.count * 3);
  BasePositions = Positions.array.slice();
  for (let Index = 0; Index < Positions.count; Index += 1) {
    const Color = ElevationColor(Body, SampleGridAtVertex(Grid, Uvs.getX(Index), Uvs.getY(Index)));
    Colors[Index * 3] = Color.r;
    Colors[Index * 3 + 1] = Color.g;
    Colors[Index * 3 + 2] = Color.b;
  }
  Geometry.setAttribute("color", new THREE.BufferAttribute(Colors, 3));
  ApplyTerrainExaggeration(Geometry, Body, Grid, Settings.exaggeration);
  return Geometry;
}

function ApplyTerrainExaggeration(Geometry, Body, Grid, Exaggeration) {
  const Positions = Geometry.attributes.position;
  const Uvs = Geometry.attributes.uv;
  for (let Index = 0; Index < Positions.count; Index += 1) {
    const Elevation = SampleGridAtVertex(Grid, Uvs.getX(Index), Uvs.getY(Index));
    const Scale = 1 + Elevation / (Body.radiusKm * 1000) * Exaggeration;
    Positions.array[Index * 3] = BasePositions[Index * 3] * Scale;
    Positions.array[Index * 3 + 1] = BasePositions[Index * 3 + 1] * Scale;
    Positions.array[Index * 3 + 2] = BasePositions[Index * 3 + 2] * Scale;
  }
  Positions.needsUpdate = true;
  Geometry.computeVertexNormals();
  Geometry.computeBoundingSphere();
}

function CreateAtmosphere(Body) {
  const Color = Body.id === "earth" ? "#83bde9" : Body.id === "titan" ? "#d5a35d" : "#d79563";
  const Material = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(Color) }, uStrength: { value: Settings.atmosphereStrength }, uEnabled: { value: 1 } },
    vertexShader: `varying vec3 vNormalView; varying vec3 vViewPosition; void main(){ vec4 mvPosition=modelViewMatrix*vec4(position,1.0); vNormalView=normalize(normalMatrix*normal); vViewPosition=-mvPosition.xyz; gl_Position=projectionMatrix*mvPosition; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uStrength; uniform float uEnabled; varying vec3 vNormalView; varying vec3 vViewPosition; void main(){ float facing=max(dot(normalize(vNormalView),normalize(vViewPosition)),0.0); float inner=smoothstep(0.0,0.32,facing); float falloff=1.0-smoothstep(0.26,0.72,facing); float fade=inner*falloff; float alpha=fade*uStrength*uEnabled*0.23; if(alpha<0.003) discard; gl_FragColor=vec4(uColor,alpha); }`,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    blending: THREE.AdditiveBlending,
  });
  const Atmosphere = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 48), Material);
  const Relief = Body.heightRangeM
    ? Math.max(0, Body.heightRangeM[1] / (Body.radiusKm * 1000) * Settings.exaggeration)
    : 0;
  Atmosphere.scale.setScalar(1.055 + Relief);
  Atmosphere.renderOrder = -1;
  return Atmosphere;
}

function DisposeCurrentBody() {
  if (CurrentMesh) {
    PlanetGroup.remove(CurrentMesh);
    CurrentMesh.geometry.dispose();
    CurrentMesh.material.dispose();
    CurrentMesh = null;
  }
  if (CurrentAtmosphere) {
    PlanetGroup.remove(CurrentAtmosphere);
    CurrentAtmosphere.geometry.dispose();
    CurrentAtmosphere.material.dispose();
    CurrentAtmosphere = null;
  }
  CurrentTexture?.dispose();
  CurrentTexture = null;
  CurrentGrid = null;
  BasePositions = null;
  CurrentHit = null;
  UpdateCoordinateReadout(null);
}

function DecodeHeightBuffer(Buffer) {
  if (Buffer.byteLength !== 1024 * 512 * 2) throw new Error(`Unexpected height file length: ${Buffer.byteLength}`);
  const View = new DataView(Buffer);
  const Grid = new Int16Array(1024 * 512);
  for (let Index = 0; Index < Grid.length; Index += 1) Grid[Index] = View.getInt16(Index * 2, true);
  return Grid;
}

function UpdateCoordinateReadout(Sample) {
  if (!Sample) {
    $("latitudeValue").textContent = "—";
    $("longitudeValue").textContent = "—";
    $("heightValue").textContent = "—";
    return;
  }
  $("latitudeValue").textContent = `${Sample.latitude.toFixed(2)}°`;
  $("longitudeValue").textContent = `${Sample.longitude.toFixed(2)}°`;
  $("heightValue").textContent = `~${FormatNumber(Sample.height)} m`;
}

function SetModeVisual(Body) {
  const IsAITexture = CurrentMode === "illustration";
  Canvas.hidden = false;
  Canvas.setAttribute("aria-label", IsAITexture ? `Interactive 3D globe wrapped with an AI-generated UV texture of ${Body.name}; illustrative, not scientific data.` : `Interactive 3D ${Body.name} globe showing ${CurrentMode === "surface" ? "source imagery" : "derived elevation"}.`);
  $("illustrationStamp").hidden = !IsAITexture;
  $("coordinateCard").hidden = IsAITexture || !Body.heightFile;
  $("viewHelp").hidden = false;
  Controls.enabled = true;
  if (IsAITexture) $("surfaceCue").textContent = Body.surfaceCue || "AI surface texture";
}

function UpdateBodySummary(Body) {
  const IsAI = CurrentMode === "illustration";
  const ModeName = IsAI ? "AI UV texture" : CurrentMode === "surface" ? "source map" : "elevation relief";
  $("bodyTitle").textContent = Body.name;
  $("selectedClass").textContent = (Body.parent ? `${Body.parent} MOON` : Body.class).toUpperCase();
  $("bodySubtitle").textContent = IsAI
    ? "AI-generated UV surface · visual only"
    : Body.imageFile
      ? "Mapped image · terrain data"
      : "Elevation data · no source map";
  $("viewportTitle").textContent = `${Body.name} · ${ModeName}`;
  $("viewBadge").classList.toggle("ai-badge", IsAI);
  $("viewBadge").querySelector("span").textContent = IsAI ? "AI UV MAP" : "SOURCE DATA";
  $("layerCaption").textContent = IsAI
    ? "AI texture · dynamically lit sphere · not measured albedo"
    : CurrentMode === "surface"
      ? "Mapped image · baked shading · fixed illumination"
      : "Height-derived colour · dynamic light";
  $("gridCaption").textContent = IsAI
    ? "2:1 EQUIRECTANGULAR · AI ONLY"
    : Body.heightFile
      ? CurrentMode === "surface" ? "4,096 × 2,048 MAP" : "1,024 × 512 · HEIGHT GRID"
      : "NO LOCAL TERRAIN GRID";
  $("terrainModeTag").textContent = IsAI ? "AI UV MAP" : CurrentMode === "surface" ? "SOURCE MAP" : "DATA VIEW";
  $("lightingNote").textContent = IsAI
    ? "AI texture · directional light creates the terminator"
    : CurrentMode === "surface"
      ? "Baked source shading · extra light disabled"
      : "1× = source relief · height values stay in metres";
  $("cloudStatus").textContent = Body.cloudsLabel || "NO CLOUD MAP";
  $("cloudValue").textContent = Body.cloudsLabel || "NO LAYER";
  $("atmosphereType").textContent = Body.atmosphereLabel || "NONE";
  $("atmosphereValue").textContent = Body.atmosphereLabel || "None";
  $("atmosphereStatus").textContent = Body.atmosphere
    ? IsAI ? "Soft atmospheric limb · illustrative" : "Soft atmospheric limb · visual only"
    : "No atmosphere fade";
}

function UpdateModeControls() {
  const Body = Catalog[CurrentBodyId];
  for (const [Id, Mode] of [["surfaceMode", "surface"], ["elevationMode", "elevation"], ["illustrationMode", "illustration"]]) {
    const Button = $(Id);
    Button.disabled = !SupportsMode(Body, Mode);
    Button.setAttribute("aria-pressed", String(CurrentMode === Mode));
  }
  const NoDynamicLight = CurrentMode === "surface";
  for (const Input of document.querySelectorAll(".light-controls")) Input.disabled = NoDynamicLight;
  $("exaggeration").disabled = !Body.heightFile || CurrentMode === "illustration";
  $("atmosphereStrength").disabled = !Body.atmosphere;
}

function UpdateInspector(Body) {
  const IsIllustration = CurrentMode === "illustration";
  const IsAIOnly = Body.kind === "ai-uv-map";
  $("bodyGlyph").textContent = Body.name.slice(0, 1);
  $("bodyParent").textContent = Body.parent ? `${Body.parent.toUpperCase()} SYSTEM` : "SOLAR SYSTEM";
  $("inspectorBody").textContent = Body.name;
  $("bodyType").textContent = Body.parent ? `${Body.parent} moon` : Body.class;
  $("objectKind").textContent = Body.category === "moon" ? "MOON" : Body.category === "dwarf" ? "DWARF" : "PLANET";
  $("radiusValue").textContent = `${FormatNumber(Body.radiusKm, 1)} km`;
  $("atmosphereValue").textContent = Body.atmosphereLabel || "None";
  $("cloudValue").textContent = Body.cloudsLabel || "No layer";
  $("surfaceCard").hidden = IsIllustration || !Body.sourceSurface;
  $("heightCard").hidden = !Body.sourceHeight;
  $("aiCard").hidden = !IsIllustration;

  const Surface = Body.sourceSurface;
  $("surfaceProduct").textContent = Surface?.product || "No source image";
  $("surfaceAsset").textContent = Surface ? "4,096 × 2,048 WebP" : "—";
  $("surfaceResolution").textContent = Body.surfaceResolutionM ? `~${FormatNumber(Body.surfaceResolutionM / 1000, 1)} km / px` : "—";
  $("surfaceQuality").textContent = Body.id === "venus" ? "RADAR · SYNTHETIC" : Body.id === "mercury" ? "FALSE COLOUR" : Body.id === "mars" ? "PSEUDO-COLOUR" : Body.id === "ceres" ? "MONOCHROME" : "MAPPED";
  $("surfaceCaveat").textContent = Surface ? `${Pipeline.surfaceImage.hillshade} ${Body.notes[0]}` : "No sourced surface map bundled.";
  $("surfaceTerms").textContent = Surface ? `${Surface.citation} ${Surface.terms}` : "";
  $("surfaceSourceLink").href = Surface?.url || "#";
  $("surfaceDetails").hidden = !Surface;

  const Height = Body.sourceHeight;
  $("heightProduct").textContent = Height?.product || "No elevation grid";
  $("heightGrid").textContent = Height ? "1,024 × 512 · int16 LE" : "—";
  $("heightRange").textContent = Body.heightRangeM ? `${FormatNumber(Body.heightRangeM[0])} / +${FormatNumber(Body.heightRangeM[1])} m` : "No DEM";
  $("heightInstrument").textContent = Height?.instrument || "";
  $("sourceResolution").textContent = Height?.nominalResolution || "";
  $("heightCaveat").textContent = Height ? `${Pipeline.heightGrid.caveat} ${Pipeline.heightGrid.missingValueHandling} ${Body.notes.at(-1)}` : "";
  $("heightTerms").textContent = Height ? `${Height.citation} ${Height.terms}` : "";
  $("heightSourceLink").href = Height?.url || "#";
  $("heightDetails").hidden = !Height;
  $("surfaceCue").textContent = Body.surfaceCue || "Lunar maria · cratered highlands";

  $("bodyNotes").replaceChildren(...(Body.notes || []).map((Note) => {
    const Item = document.createElement("li");
    Item.textContent = Note;
    return Item;
  }));
  $("limitsDetails").hidden = IsAIOnly && IsIllustration;
  $("statusText").textContent = IsIllustration ? "AI UV TEXTURE · NOT DATA" : "LOCAL FILES · SOURCE CITED";
}

function RenderBodyLibrary() {
  const Container = $("bodyList");
  Container.replaceChildren();
  const MatchingIds = CatalogIds.filter((Id) => CurrentFilter === "all" || Catalog[Id].category === CurrentFilter);
  $("bodyCount").textContent = String(MatchingIds.length).padStart(2, "0");
  for (const Id of MatchingIds) {
    const Body = Catalog[Id];
    const Button = document.createElement("button");
    Button.type = "button";
    Button.className = "object-item";
    Button.setAttribute("role", "option");
    Button.setAttribute("aria-selected", String(Id === CurrentBodyId));
    Button.setAttribute("aria-label", `${Body.name}, ${Body.aiUvFile ? "AI UV surface texture" : Body.sourceSurface ? "source imagery and elevation" : "elevation data"}`);
    const Thumb = document.createElement("span");
    Thumb.className = "object-thumb";
    const ThumbnailUrl = Body.aiUvFile || Body.imageFile;
    if (ThumbnailUrl) Thumb.style.backgroundImage = `url('${ThumbnailUrl}')`;
    const Copy = document.createElement("span");
    Copy.className = "object-copy";
    const Name = document.createElement("strong");
    Name.textContent = Body.name;
    const Small = document.createElement("small");
    Small.textContent = Body.parent ? `${Body.parent.toUpperCase()} · AI UV` : Body.imageFile ? "MAP + HEIGHT DATA" : Body.aiUvFile ? "AI UV · LOLA DEM" : "HEIGHT DATA";
    Copy.append(Name, Small);
    const Pill = document.createElement("span");
    Pill.className = `object-pill${Body.aiUvFile ? "" : " data"}`;
    Pill.textContent = Body.aiUvFile ? "AI" : "DATA";
    Button.append(Thumb, Copy, Pill);
    Button.addEventListener("click", () => {
      if (Id === CurrentBodyId) return;
      CurrentBodyId = Id;
      CurrentMode = DefaultMode(Body);
      LoadBody(Id);
    });
    Container.append(Button);
  }
}

function SetSceneMode(Body) {
  SetModeVisual(Body);
  UpdateBodySummary(Body);
  UpdateModeControls();
}

async function LoadBody(BodyId) {
  const Body = Catalog[BodyId];
  if (!Body) return;
  CurrentBodyId = BodyId;
  if (!SupportsMode(Body, CurrentMode)) CurrentMode = DefaultMode(Body);
  const RequestedMode = CurrentMode;
  DisposeCurrentBody();
  RenderBodyLibrary();
  UpdateInspector(Body);
  UpdateControls();
  SetSceneMode(Body);
  SaveSettings();

  if (!Renderer) {
    SetSceneStatus("WebGL unavailable · source cards remain available");
    return;
  }

  SetSceneStatus(`Loading ${Body.name} ${CurrentMode === "illustration" ? "AI UV texture" : "data"}…`);
  try {
    let Grid = null;
    let Texture = null;
    if (CurrentMode === "illustration") {
      Texture = await new Promise((Resolve, Reject) => TextureLoader.load(Body.aiUvFile, Resolve, undefined, Reject));
    } else {
      if (!Body.heightFile) {
        SetSceneStatus("No local elevation grid for this object.");
        return;
      }
      const HeightResponse = await fetch(Body.heightFile, { cache: "force-cache" });
      if (!HeightResponse.ok) throw new Error(`Height file returned ${HeightResponse.status}`);
      Grid = DecodeHeightBuffer(await HeightResponse.arrayBuffer());
      if (CurrentMode === "surface" && Body.imageFile) {
        Texture = await new Promise((Resolve, Reject) => TextureLoader.load(Body.imageFile, Resolve, undefined, Reject));
      }
    }
    if (BodyId !== CurrentBodyId || CurrentMode !== RequestedMode) {
      Texture?.dispose();
      return;
    }
    if (Texture) {
      Texture.colorSpace = THREE.SRGBColorSpace;
      Texture.wrapS = THREE.RepeatWrapping;
      Texture.wrapT = THREE.ClampToEdgeWrapping;
      Texture.generateMipmaps = true;
      Texture.minFilter = THREE.LinearMipmapLinearFilter;
      Texture.magFilter = THREE.LinearFilter;
      Texture.anisotropy = Math.min(8, Renderer.capabilities.getMaxAnisotropy());
    }
    CurrentGrid = Grid;
    CurrentTexture = Texture;
    const Geometry = CurrentMode === "illustration"
      ? new THREE.SphereGeometry(1, 192, 128)
      : CreateGlobeGeometry(Body, Grid);
    const Material = CurrentMode === "surface" && Texture
      ? new THREE.MeshBasicMaterial({ map: Texture })
      : CurrentMode === "illustration"
        ? new THREE.MeshStandardMaterial({ map: Texture, roughness: 0.94, metalness: 0 })
        : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, metalness: 0 });
    CurrentMesh = new THREE.Mesh(Geometry, Material);
    CurrentMesh.userData.bodyId = Body.id;
    if (Body.id === "phobos") {
      CurrentMesh.scale.set(1.14, 0.95, 0.78);
    } else if (Body.id === "deimos") {
      CurrentMesh.scale.set(1.14, 0.93, 0.84);
    } else if (Body.shape === "oblate") {
      CurrentMesh.scale.set(1, 0.94, 1);
    }
    PlanetGroup.add(CurrentMesh);
    if (Body.atmosphere) {
      CurrentAtmosphere = CreateAtmosphere(Body);
      PlanetGroup.add(CurrentAtmosphere);
    }
    UpdateSun();
    SetSceneStatus("", false);
    UpdateCoordinateReadout(null);
    UpdateInspector(Body);
    SetSceneMode(Body);
    ResizeRenderer();
    SaveSettings();
  } catch (Error) {
    if (BodyId !== CurrentBodyId) return;
    console.error(Error);
    SetSceneStatus("Local planetary file failed to load.");
  }
}

function UpdateControls() {
  $("exaggeration").value = String(Math.round(Settings.exaggeration * 10));
  $("exaggerationValue").textContent = `${Settings.exaggeration.toFixed(1)}×`;
  $("sunAzimuth").value = String(Settings.azimuth);
  $("sunAltitude").value = String(Settings.altitude);
  $("atmosphereStrength").value = String(Math.round(Settings.atmosphereStrength * 100));
  $("atmosphereStrengthValue").textContent = Settings.atmosphereStrength.toFixed(2);
  UpdateSun();
  UpdateModeControls();
}

function UpdateAtmosphere() {
  if (CurrentAtmosphere) CurrentAtmosphere.material.uniforms.uStrength.value = Settings.atmosphereStrength;
  const Body = Catalog[CurrentBodyId];
  if (CurrentAtmosphere) {
    const Relief = Body?.heightRangeM
      ? Math.max(0, Body.heightRangeM[1] / (Body.radiusKm * 1000) * Settings.exaggeration)
      : 0;
    CurrentAtmosphere.scale.setScalar(1.055 + Relief);
  }
}

function UpdateTerrainShape() {
  if (CurrentMesh && CurrentGrid) ApplyTerrainExaggeration(CurrentMesh.geometry, Catalog[CurrentBodyId], CurrentGrid, Settings.exaggeration);
  UpdateAtmosphere();
  $("exaggerationValue").textContent = `${Settings.exaggeration.toFixed(1)}×`;
  SaveSettings();
}

function ChangeMode(Mode) {
  const Body = Catalog[CurrentBodyId];
  if (!SupportsMode(Body, Mode) || Mode === CurrentMode) return;
  CurrentMode = Mode;
  LoadBody(CurrentBodyId);
}

function HandlePointer(Event) {
  if (!CurrentMesh || !CurrentGrid) return;
  const Bounds = Canvas.getBoundingClientRect();
  Pointer.x = ((Event.clientX - Bounds.left) / Bounds.width) * 2 - 1;
  Pointer.y = -((Event.clientY - Bounds.top) / Bounds.height) * 2 + 1;
  Raycaster.setFromCamera(Pointer, Camera);
  const Hits = Raycaster.intersectObject(CurrentMesh, false);
  if (!Hits.length) {
    CurrentHit = null;
    UpdateCoordinateReadout(null);
    return;
  }
  const Local = PlanetGroup.worldToLocal(Hits[0].point.clone());
  const Latitude = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(Local.y / Local.length(), -1, 1)));
  let Phi = Math.atan2(-Local.x, Local.z);
  if (Phi < 0) Phi += Math.PI * 2;
  const U = Phi / (Math.PI * 2);
  const V = THREE.MathUtils.clamp(0.5 - Latitude / 180, 0, 1);
  const Body = Catalog[CurrentBodyId];
  const Height = SampleHeight(CurrentGrid, U, V);
  const Longitude = NormalizeLongitude(Body.longitudeOrigin + U * 360, Body.longitudeDomain);
  CurrentHit = { latitude: Latitude, longitude: Longitude, height: Height, u: U, v: V };
  UpdateCoordinateReadout(CurrentHit);
}

function ExportView() {
  const Body = Catalog[CurrentBodyId];
  const View = {
    format: "frontier.planetary-surface-view",
    version: 2,
    exportedAt: new Date().toISOString(),
    object: {
      id: Body.id,
      name: Body.name,
      class: Body.class,
      parent: Body.parent || null,
      referenceRadiusKm: Body.radiusKm,
      aiTexture: CurrentMode === "illustration" ? { type: "AI-generated equirectangular UV illustration", scientificData: false } : null,
      sourceSurface: Body.sourceSurface,
      sourceElevation: Body.sourceHeight,
      limitations: Body.notes,
    },
    view: {
      mode: CurrentMode,
      verticalExaggeration: Settings.exaggeration,
      sunAzimuthDegrees: Settings.azimuth,
      sunAltitudeDegrees: Settings.altitude,
      atmosphereStrength: Body.atmosphere ? Settings.atmosphereStrength : 0,
      coordinateSample: CurrentHit,
      crossBodyScale: "normalized per body; not a size comparison",
    },
    notes: ["AI UV textures are generated illustrations, not spacecraft imagery, measured albedo, or scientific maps.", "Derived elevation-grid readouts are approximate, not authoritative measurements."],
  };
  const BlobUrl = URL.createObjectURL(new Blob([JSON.stringify(View, null, 2)], { type: "application/json" }));
  const Link = document.createElement("a");
  Link.href = BlobUrl;
  Link.download = `${Body.id}-view.json`;
  Link.click();
  setTimeout(() => URL.revokeObjectURL(BlobUrl), 800);
  ShowToast("View card exported");
}

function ResizeRenderer() {
  if (!Renderer) return;
  const Bounds = Canvas.getBoundingClientRect();
  if (!Bounds.width || !Bounds.height || Canvas.hidden) return;
  Renderer.setSize(Bounds.width, Bounds.height, false);
  Camera.aspect = Bounds.width / Bounds.height;
  Camera.updateProjectionMatrix();
}

function Render() {
  AnimationFrame = requestAnimationFrame(Render);
  Controls.update();
  if (Renderer && !Canvas.hidden) Renderer.render(Scene, Camera);
}

function AttachEvents() {
  for (const Button of document.querySelectorAll(".view-modes button")) Button.addEventListener("click", () => ChangeMode(Button.dataset.mode));
  for (const Button of document.querySelectorAll(".library-filters button")) {
    Button.addEventListener("click", () => {
      CurrentFilter = Button.dataset.filter;
      Settings.filter = CurrentFilter;
      for (const Other of document.querySelectorAll(".library-filters button")) Other.setAttribute("aria-pressed", String(Other === Button));
      RenderBodyLibrary();
      SaveSettings();
    });
  }
  $("exaggeration").addEventListener("input", (Event) => {
    Settings.exaggeration = Number(Event.target.value) / 10;
    UpdateTerrainShape();
  });
  $("sunAzimuth").addEventListener("input", (Event) => {
    Settings.azimuth = Number(Event.target.value);
    UpdateSun();
    SaveSettings();
  });
  $("sunAltitude").addEventListener("input", (Event) => {
    Settings.altitude = Number(Event.target.value);
    UpdateSun();
    SaveSettings();
  });
  $("atmosphereStrength").addEventListener("input", (Event) => {
    Settings.atmosphereStrength = Number(Event.target.value) / 100;
    $("atmosphereStrengthValue").textContent = Settings.atmosphereStrength.toFixed(2);
    UpdateAtmosphere();
    SaveSettings();
  });
  $("resetView").addEventListener("click", () => {
    Controls.reset();
    Settings.exaggeration = 1;
    Settings.azimuth = 315;
    Settings.altitude = 35;
    Settings.atmosphereStrength = 0.34;
    UpdateControls();
    UpdateTerrainShape();
    ShowToast("View reset · 1× relief · soft atmosphere");
  });
  $("exportView").addEventListener("click", ExportView);
  Canvas.addEventListener("pointerup", HandlePointer);
  Canvas.addEventListener("click", HandlePointer);
  new ResizeObserver(ResizeRenderer).observe($("viewportWrap"));
  window.addEventListener("beforeunload", () => cancelAnimationFrame(AnimationFrame));
}

function Start() {
  CurrentFilter = Settings.filter;
  for (const Button of document.querySelectorAll(".library-filters button")) Button.setAttribute("aria-pressed", String(Button.dataset.filter === CurrentFilter));
  RenderBodyLibrary();
  UpdateInspector(Catalog[CurrentBodyId]);
  UpdateControls();
  if (!Renderer) {
    SetSceneStatus("WebGL unavailable · info cards still available");
    return;
  }
  AttachEvents();
  LoadBody(CurrentBodyId);
  ResizeRenderer();
  Render();
}

Start();
