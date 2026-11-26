//============================================================================================================================================
//                                                           IMPORTINSTANCE.JSX
//============================================================================================================================================
// 📥 Follow-up 85: two Construct entries that bring content into the scene.
//   Import instance  an empty Outliner row. Its inspector is one slot: drop anything from the Content Browser (a model, a material, a
//                    colour, an image, an icon, an IES file) or a scene type (a camera, a light, a primitive…) and the row becomes that
//                    thing, with that thing's own inspector (a model → object inspector, a camera → camera inspector, …).
//   Import           a file dialog for the engine's file types with a preview of what was chosen; Add to scene places it in the Outliner
//                    straight away as the right row (and keeps the file in the Content Browser).
// 📝 Browser preview only: models are read by the Geometry Compile readers (OBJ, glTF/GLB, STL, PLY, FCT1); FBX and .blend are listed
//    but have no reader in this build, so they are refused with that reason. Files are kept in this browser (IndexedDB), never on disk.

import React, { useEffect, useMemo, useRef, useState } from "react";
import { THREE } from "../Shared/Studio/Render.js";
import { readGeometry, formatOf } from "../Shared/GeometryCompile/Engine/ImportFormats.js";
import { AssetFile, EngineAssets, ImportAsset } from "./AssetDepot.js";
import { AssetDragStart, AssetDropProps } from "./AssetDrag.js";
import { ImportIes } from "./IesProfile.js";
import { ChangeChannel, ResolveMaterial } from "./MaterialSpecification.js";
import { PreviewGeometry } from "./ShaderViewport.jsx";
import { ModelIcon } from "./EditorAssets.js";
import TransformPanel from "./TransformPanel.jsx";
import "./ImportInstance.css";

export const ImportSlotPanel = "import-slot";
export const ImportFilePanel = "import-file";
export const ImportSlotSheet = [];
export const ImportEntries = [
  { Id: "import-instance", Name: "Import instance", Panel: ImportSlotPanel, Icon: "import-instance", Parent: null, Description: "Empty instance · drop anything from the Content Browser" },
  { Id: "import-file", Name: "Import", Panel: ImportFilePanel, Icon: "import", Parent: null, Description: "Bring a file into the scene" },
];

//------------------------------------------------------------------------------------------------------------------------
//                                                    SYMBOLS
//------------------------------------------------------------------------------------------------------------------------
// Drawn in the editor's own icon style (256 box, blue faces, teal accent) since the icon set has no import symbol.
const Svg = (Body) => "data:image/svg+xml;base64," + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="none">${Body}</svg>`);
const ImportSymbols = {
  import: Svg(
    `<path d="M44 140v52q0 16 16 16h136q16 0 16-16v-52" fill="#174b88"/><path d="M44 140h44l14 22h52l14-22h44" fill="#286296"/>` +
      `<path d="M44 140v52q0 16 16 16h136q16 0 16-16v-52M44 140h44l14 22h52l14-22h44" stroke="#8fc6ed" stroke-width="9" stroke-linejoin="round"/>` +
      `<path d="M128 34v96M92 96l36 36 36-36" stroke="#67cba8" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/><circle cx="128" cy="34" r="7" fill="#b4f1d6"/>`,
  ),
  "import-instance": Svg(
    `<path d="M128 104l62 36-62 36-62-36Z" fill="#8fc6ed" fill-opacity=".14"/><path d="M66 140v62l62 36v-62ZM128 176l62-36v62l-62 36Z" fill="#286296" fill-opacity=".28"/>` +
      `<path d="M128 104l62 36v62l-62 36-62-36v-62ZM66 140l62 36 62-36M128 176v62" stroke="#8fc6ed" stroke-width="8" stroke-dasharray="14 11" stroke-linejoin="round"/>` +
      `<path d="M128 22v66M100 62l28 28 28-28" stroke="#67cba8" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
};
export const ImportSymbol = ({ Name, Size = 24 }) =>
  ImportSymbols[Name] ? <img className="native-icon" width={Size} height={Size} src={ImportSymbols[Name]} alt="" data-native-icon={Name} /> : null;

//------------------------------------------------------------------------------------------------------------------------
//                                                    FILE TYPES
//------------------------------------------------------------------------------------------------------------------------
// What the Import dialog offers, and what each becomes. Reads=false: listed so the dialog is honest about it, refused on import.
export const ImportTypes = [
  ["Geometry", ["obj", "gltf", "glb", "stl", "ply", "facet"], "Geometry row · object inspector", true],
  ["Geometry (no reader)", ["fbx", "blend"], "Closed formats · export OBJ, glTF/GLB, STL or PLY", false],
  ["Light profiles", ["ies"], "IES light · light inspector", true],
  ["Images", ["png", "jpg", "jpeg", "webp", "gif", "svg"], "Image panel · object inspector", true],
  ["Materials", ["material.json"], "Material sphere · object inspector", true],
  ["Colours", ["toml"], "Colour sphere · object inspector", true],
  ["Fonts", ["ttf", "otf", "woff", "woff2"], "Content Browser only · no scene object", true],
];
const Suffix = (Name) => {
  const Lower = String(Name).toLowerCase();
  return Lower.endsWith(".material.json") ? "material.json" : Lower.split(".").pop();
};
const TypeOf = (Name) => ImportTypes.find(([, Suffixes]) => Suffixes.includes(Suffix(Name))) || null;
const Stem = (Name) => String(Name || "Untitled").replace(/\.material\.json$/i, "").replace(/\.[^.]+$/, "");
const Accept = ImportTypes.flatMap(([, Suffixes]) => Suffixes.map((Each) => "." + Each)).join(",");

//------------------------------------------------------------------------------------------------------------------------
//                                                    MESHES
//------------------------------------------------------------------------------------------------------------------------
// Imported triangles by key (a Content Browser id, or "engine-shaderball"). Rows only hold the key, so the scene stays small; the bytes
// live in IndexedDB and are read again after a reload.
const MeshStore = new Map();
const Pending = new Map();
const Watchers = new Set();
const Announce = () => Watchers.forEach((Watcher) => Watcher());
export function useMeshRevision() {
  const [Revision, Advance] = useState(0);
  useEffect(() => {
    const Watcher = () => Advance((Previous) => Previous + 1);
    Watchers.add(Watcher);
    return () => Watchers.delete(Watcher);
  }, []);
  return Revision;
}
export function ResolveMesh(Name, Bytes) {
  const Raw = readGeometry(Name, Bytes);
  if (!Raw.positions?.length || !Raw.indices?.length) throw Error(Name + ": no triangles in this file.");
  return { Positions: Raw.positions, Indices: Raw.indices, Format: Raw.format || formatOf(Name)?.label || Suffix(Name).toUpperCase(), Notes: Raw.notes || [], Name };
}
function ShaderBallMesh() {
  const Geometry = PreviewGeometry("Shader ball");
  const Positions = Float32Array.from(Geometry.getAttribute("position").array);
  const Indices = Uint32Array.from(Geometry.index.array);
  Geometry.dispose();
  return { Positions, Indices, Format: "SBM1", Notes: ["Engine shader ball · Exhibits/DistanceFieldGI/ShaderBall.mesh"], Name: "ShaderBall.mesh", UpY: true };
}
export function RetainMesh(Key, Mesh) {
  MeshStore.set(Key, Mesh);
  Announce();
}
// The mesh if it is ready; otherwise starts reading it (the viewport redraws through useMeshRevision when it arrives).
export function RetrieveMesh(Key, Name) {
  if (!Key) return null;
  if (MeshStore.has(Key)) return MeshStore.get(Key);
  QueryMesh(Key, Name).catch(() => {});
  return null;
}
export function QueryMesh(Key, Name) {
  if (MeshStore.has(Key)) return Promise.resolve(MeshStore.get(Key));
  if (Key === "engine-shaderball") {
    RetainMesh(Key, ShaderBallMesh());
    return Promise.resolve(MeshStore.get(Key));
  }
  if (!Pending.has(Key))
    Pending.set(
      Key,
      AssetFile(Key).then(async (Stored) => {
        if (!Stored) throw Error("The file is not in this browser any more. Import it again.");
        const Mesh = ResolveMesh(Stored.name || Name, await Stored.arrayBuffer());
        RetainMesh(Key, Mesh);
        return Mesh;
      }).finally(() => Pending.delete(Key)),
    );
  return Pending.get(Key);
}
// The mesh as it stands in the scene: Z-up files turned Y-up, centred on X/Z, resting on the ground, and fitted to a size (or kept in
// the file's units times Unit scale).
export function ConstructMeshGeometry(Mesh, Read) {
  const Geometry = new THREE.BufferGeometry();
  Geometry.setAttribute("position", new THREE.BufferAttribute(Float32Array.from(Mesh.Positions), 3));
  Geometry.setIndex(new THREE.BufferAttribute(Mesh.Indices, 1));
  if ((Read("Geometry Up Axis", "Y") || "Y") === "Z") Geometry.rotateX(-Math.PI / 2);
  Geometry.computeBoundingBox();
  const Box = Geometry.boundingBox, Size = Box.getSize(new THREE.Vector3());
  const Largest = Math.max(Size.x, Size.y, Size.z) || 1;
  const Factor = Read("Geometry Fit", true) !== false ? (+Read("Geometry Fit Size", 1) || 1) / Largest : +Read("Geometry Unit Scale", 1) || 1;
  Geometry.translate(-(Box.min.x + Box.max.x) / 2, -Box.min.y, -(Box.min.z + Box.max.z) / 2);
  Geometry.scale(Factor, Factor, Factor);
  Geometry.computeVertexNormals();
  Geometry.computeBoundingBox();
  return { Geometry, Lift: 0, Factor, Source: [Size.x, Size.y, Size.z] };
}
// Bounds, area, volume (signed tetrahedra, so only meaningful for a closed mesh) and whether every edge has two faces.
const Sizes = new WeakMap();
export function EvaluateMeshSize(Mesh, Read, Scale = [1, 1, 1]) {
  let Base = Sizes.get(Mesh);
  if (!Base) {
    const P = Mesh.Positions, I = Mesh.Indices;
    let Area = 0, Volume = 0;
    const Edges = new Map(), Weld = new Map(), Key = (At) => P[At * 3].toFixed(5) + "," + P[At * 3 + 1].toFixed(5) + "," + P[At * 3 + 2].toFixed(5);
    const Welded = (At) => {
      const Name = Key(At);
      if (!Weld.has(Name)) Weld.set(Name, Weld.size);
      return Weld.get(Name);
    };
    for (let T = 0; T + 2 < I.length; T += 3) {
      const [A, B, C] = [I[T], I[T + 1], I[T + 2]];
      const Ax = P[A * 3], Ay = P[A * 3 + 1], Az = P[A * 3 + 2], Bx = P[B * 3] - Ax, By = P[B * 3 + 1] - Ay, Bz = P[B * 3 + 2] - Az, Cx = P[C * 3] - Ax, Cy = P[C * 3 + 1] - Ay, Cz = P[C * 3 + 2] - Az;
      Area += Math.hypot(By * Cz - Bz * Cy, Bz * Cx - Bx * Cz, Bx * Cy - By * Cx) / 2;
      Volume += (Ax * (P[B * 3 + 1] * P[C * 3 + 2] - P[B * 3 + 2] * P[C * 3 + 1]) - Ay * (P[B * 3] * P[C * 3 + 2] - P[B * 3 + 2] * P[C * 3]) + Az * (P[B * 3] * P[C * 3 + 1] - P[B * 3 + 1] * P[C * 3])) / 6;
      if (I.length <= 600000) {
        const W = [Welded(A), Welded(B), Welded(C)];
        for (let E = 0; E < 3; E++) {
          const U = W[E], V = W[(E + 1) % 3], Name = U < V ? U + ":" + V : V + ":" + U;
          Edges.set(Name, (Edges.get(Name) || 0) + 1);
        }
      }
    }
    const Closed = Edges.size > 0 && [...Edges.values()].every((Count) => Count === 2);
    Base = { Area, Volume: Math.abs(Volume), Closed, Triangles: Math.floor(I.length / 3), Vertices: Weld.size || P.length / 3 };
    Sizes.set(Mesh, Base);
  }
  const Setting = [Read("Geometry Up Axis", "Y"), Read("Geometry Fit", true), Read("Geometry Fit Size", 1), Read("Geometry Unit Scale", 1)].join("|");
  if (!Base.Placed || Base.Setting !== Setting) {
    const { Geometry, Factor } = ConstructMeshGeometry(Mesh, Read);
    Base.Placed = { Box: Geometry.boundingBox.getSize(new THREE.Vector3()), Factor };
    Base.Setting = Setting;
    Geometry.dispose();
  }
  const { Box, Factor } = Base.Placed;
  const [Sx, Sy, Sz] = Scale.map((Axis) => Math.abs(+Axis || 0));
  return {
    Bounds: [Box.x * Sx, Box.y * Sy, Box.z * Sz],
    Area: Base.Area * Factor * Factor * Math.cbrt(Sx * Sy * Sz) ** 2,
    Volume: Base.Volume * Factor ** 3 * Sx * Sy * Sz,
    Triangles: Base.Triangles,
    Vertices: Base.Vertices,
    Closed: Base.Closed,
    Factor,
  };
}
// The mesh rendered in the outliner-icon studio (a still picture, so a preview costs no WebGL context of its own).
function MeshPicture(Mesh, Read, Width = 420, Height = 240) {
  const { Geometry } = ConstructMeshGeometry(Mesh, Read);
  const Shown = new THREE.Mesh(Geometry, new THREE.MeshStandardMaterial({ color: "#c7ada0", roughness: 0.42, metalness: 0.05 }));
  try {
    return ModelIcon(Shown, Width, { Height, Yaw: -140, Pitch: 20 });
  } catch {
    return null;
  } finally {
    Shown.removeFromParent();
    Geometry.dispose();
    Shown.material.dispose();
  }
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    ROW TEMPLATES
//------------------------------------------------------------------------------------------------------------------------
async function ShrinkPicture(Source, Name, Largest = 256) {
  const Picture = new window.Image();
  Picture.src = Source;
  await Picture.decode();
  const Ratio = Math.min(1, Largest / Math.max(Picture.width, Picture.height));
  const Canvas = Object.assign(document.createElement("canvas"), { width: Math.max(1, Math.round(Picture.width * Ratio)), height: Math.max(1, Math.round(Picture.height * Ratio)) });
  Canvas.getContext("2d").drawImage(Picture, 0, 0, Canvas.width, Canvas.height);
  const Lossless = /\.(png|svg|gif|webp)$/i.test(Name) || Source.startsWith("data:image/svg") || Source.startsWith("data:image/png");
  return { Name, Data: Canvas.toDataURL(Lossless ? "image/png" : "image/jpeg", 0.88), Width: Picture.width, Height: Picture.height };
}
const Find = (Entities, Id) => Entities.find((Each) => Each.Id === Id);
const Fresh = () => ResolveMaterial({});
// What a Content Browser entry (or a scene type, or a file) becomes in the Outliner: { Template, Properties } or { Refusal }.
// Item: the Content Browser record (Id, Name, Kind, …). Picture / Mesh / Profile / Material / Colour: what was already read from it.
export function ResolveInstanceTemplate(Item, Entities, Read = {}) {
  const Sphere = Find(Entities, "sphere") || { Panel: "geometry", Icon: "editor-sphere", Parent: "showcase" };
  const Cube = Find(Entities, "cube") || { Panel: "geometry", Icon: "editor-cube", Parent: "showcase" };
  if (Item.Kind === "Construct") {
    const Entity = Find(Entities, Item.Id);
    return Entity ? { Template: Entity, Properties: {} } : { Refusal: Item.Name + " is not a scene type." };
  }
  if (Item.Kind === "Models") {
    if (!Read.Mesh) return { Refusal: Read.Failure || Item.Name + ": no geometry was read." };
    return {
      Template: { Id: "imported-geometry", Name: Stem(Item.Name), Panel: "geometry", Icon: "editor-mesh", Parent: "showcase", Mesh: Item.Id, MeshName: Item.Name, Description: "Imported geometry · " + Read.Mesh.Format },
      Properties: {},
    };
  }
  if (Item.Kind === "Materials" && (Read.Material || Item.Material))
    return { Template: { ...Sphere, Id: "material-sphere", Name: Item.Name, Description: "Material sphere · " + Item.Name }, Properties: { Material: { ...(Read.Material || Item.Material) } } };
  if (Item.Kind === "Colours" && (Read.Colour || Item.Colour)) {
    const Colour = Read.Colour || Item.Colour;
    return {
      Template: { ...Sphere, Id: "colour-sphere", Name: Colour.Name || Item.Name, Description: "Colour sphere · " + (Colour.Hex || "") },
      Properties: { Material: { ...ChangeChannel(Fresh(), "colour", { Fill: String(Colour.Hex || "#c7ada0").toLowerCase() }), Name: Colour.Name || Item.Name } },
    };
  }
  if ((Item.Kind === "Images" || Item.Kind === "Icons") && Read.Picture) {
    const Aspect = (Read.Picture.Width || 1) / (Read.Picture.Height || 1);
    return {
      Template: { ...Cube, Id: "image-panel", Name: Stem(Item.Name), Icon: "slate-image", Description: "Image panel · " + Item.Name },
      Properties: {
        "Geometry Size X": +(Aspect >= 1 ? 1 : Aspect).toFixed(3),
        "Geometry Size Y": +(Aspect >= 1 ? 1 / Aspect : 1).toFixed(3),
        "Geometry Size Z": 0.02,
        Material: { ...ChangeChannel(Fresh(), "colour", { Source: "Texture", Texture: Read.Picture, Fill: "#ffffff" }), Name: Stem(Item.Name) },
      },
    };
  }
  if (Read.Profile) {
    const Light = Find(Entities, "reference-ies-downlight") || { Panel: "light", Icon: "editor-spotlight", Parent: "lighting", ReferenceType: "ieslight", ReferencePreset: "IES Downlight", ReferenceOnly: true };
    return {
      Template: { ...Light, Id: "ies-light", Name: Read.Profile.Name && Read.Profile.Name !== "Imported profile" ? Read.Profile.Name : Stem(Item.Name), Description: "IES light · " + Item.Name },
      Properties: {
        ReferenceInspector: {
          Properties: { profile: "Custom", iesC0: Read.Profile.C0, iesC90: Read.Profile.C90, iesSmooth: false, iesName: Read.Profile.Name, ...(Read.Profile.Lumens ? { lumens: Math.round(Read.Profile.Lumens) } : {}) },
        },
      },
    };
  }
  if (Item.Kind === "Fonts") return { Refusal: "Fonts have no scene object yet · it stays in the Content Browser." };
  if (Item.Kind === "Code") return { Refusal: "Code files have no scene object · open them from the Content Browser." };
  return { Refusal: Item.Name + " has no scene object in this build." };
}
// Reads what a Content Browser entry needs before it can become a row (its bytes are in IndexedDB unless it is an engine entry).
export async function QueryContent(Item, Library) {
  const Full = Library.find((Each) => Each.Id === Item.Id) || Item;
  const Read = {};
  try {
    if (Full.Kind === "Models") Read.Mesh = await QueryMesh(Full.Id, Full.Name);
    else if (Full.Kind === "Images" || Full.Kind === "Icons") {
      let Source = Full.Data;
      let Address = null;
      if (!Source) {
        const Stored = await AssetFile(Full.Id);
        if (!Stored) throw Error("The image is not in this browser any more. Import it again.");
        Source = Address = URL.createObjectURL(Stored);
      }
      try {
        Read.Picture = await ShrinkPicture(Source, Full.Name);
      } finally {
        if (Address) URL.revokeObjectURL(Address);
      }
    } else if (Full.Kind === "Colours") Read.Colour = Full.Colour;
    else if (Full.Kind === "Materials") Read.Material = Full.Material;
    else if (/\.ies$/i.test(Full.Name || "")) {
      const Stored = await AssetFile(Full.Id);
      if (!Stored) throw Error("The IES file is not in this browser any more.");
      Read.Profile = ImportIes(await Stored.text());
    }
  } catch (Failure) {
    Read.Failure = Failure.message;
  }
  return { Full, Read };
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    PREVIEW
//------------------------------------------------------------------------------------------------------------------------
// The polar candela curve of an IES profile (C0 left of the axis mirrored with C90 on the right when it has one).
function IesCurve({ Profile }) {
  const Path = (Points, Side) =>
    Points.map(([Gamma, Level], Index) => {
      const A = (Gamma * Math.PI) / 180, R = 92 * Level;
      return (Index ? "L" : "M") + (110 + Side * Math.sin(A) * R).toFixed(1) + " " + (24 + Math.cos(A) * R).toFixed(1);
    }).join("");
  return (
    <svg className="ii-ies" viewBox="0 0 220 130" aria-label="Candela distribution">
      {[0.25, 0.5, 0.75, 1].map((Ring) => (
        <path key={Ring} d={`M${110 - 92 * Ring} 24A${92 * Ring} ${92 * Ring} 0 0 0 ${110 + 92 * Ring} 24`} />
      ))}
      <path d="M110 24V124M14 24H206" />
      <path className="c0" d={Path(Profile.C0, -1)} />
      <path className={Profile.C90 ? "c90" : "c0"} d={Path(Profile.C90 || Profile.C0, 1)} />
    </svg>
  );
}
// One preview for whatever was read: a model picture, an image, a polar curve, a font sample, a colour or material swatch.
export function ImportPreview({ Item, Read, Facts = [] }) {
  const Picture = useMemo(() => (Read.Mesh ? MeshPicture(Read.Mesh, () => undefined) : null), [Read.Mesh]);
  const Swatch = Read.Colour?.Hex || (Read.Material ? ResolveMaterial({ Material: Read.Material }).Channels.colour?.Fill : null);
  return (
    <figure className="ii-preview" data-preview={Read.Mesh ? "geometry" : Read.Picture ? "image" : Read.Profile ? "ies" : Read.Font ? "font" : Swatch ? "swatch" : "none"}>
      <div className="ii-stage">
        {Read.Mesh && (Picture ? <img src={Picture} alt="" /> : <span className="ii-empty">Preview needs WebGL</span>)}
        {Read.Picture && <img className="ii-image" src={Read.Picture.Data} alt="" />}
        {Read.Profile && <IesCurve Profile={Read.Profile} />}
        {Read.Font && (
          <div className="ii-font" style={{ fontFamily: Read.Font }}>
            <b>Aa</b>
            <span>The quick brown fox jumps over the lazy dog · 0123456789</span>
          </div>
        )}
        {!Read.Mesh && !Read.Picture && !Read.Profile && !Read.Font && Swatch && <span className="ii-swatch" style={{ background: Swatch }} />}
        {!Read.Mesh && !Read.Picture && !Read.Profile && !Read.Font && !Swatch && <span className="ii-empty">{Read.Failure || "No preview"}</span>}
      </div>
      <figcaption>
        <b>{Item?.Name}</b>
        {Facts.length > 0 && (
          <dl>
            {Facts.map(([Term, Detail]) => (
              <div key={Term}>
                <dt>{Term}</dt>
                <dd>{Detail}</dd>
              </div>
            ))}
          </dl>
        )}
      </figcaption>
    </figure>
  );
}
const Count = (Amount) => Number(Amount || 0).toLocaleString("en-US");
function FactsOf(Read, Size = 0) {
  const Facts = [];
  if (Read.Mesh) {
    const Measured = EvaluateMeshSize(Read.Mesh, () => undefined);
    Facts.push(["Format", Read.Mesh.Format], ["Triangles", Count(Measured.Triangles)], ["Vertices", Count(Measured.Vertices)], ["Surface", Measured.Closed ? "Closed" : "Open"]);
  }
  if (Read.Picture) Facts.push(["Pixels", `${Read.Picture.Width} × ${Read.Picture.Height}`], ["Becomes", "Image panel"]);
  if (Read.Profile) Facts.push(["Points", Read.Profile.C0.length + (Read.Profile.C90 ? " per plane" : " · symmetric")], ["Lumens", Read.Profile.Lumens ? Count(Math.round(Read.Profile.Lumens)) : "—"]);
  if (Read.Colour) Facts.push(["Hex", Read.Colour.Hex]);
  if (Read.Material) Facts.push(["Channels", String((Read.Material.Used || []).length || "Default")]);
  if (Size) Facts.push(["File", Size < 1048576 ? (Size / 1024).toFixed(1) + " KB" : (Size / 1048576).toFixed(2) + " MB"]);
  return Facts;
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    IMPORT INSTANCE INSPECTOR
//------------------------------------------------------------------------------------------------------------------------
const SlotKinds = ["Models", "Materials", "Colours", "Images", "Icons", "Fonts", "Code", "Other", "Construct"];
const SceneGroups = [
  ["Cameras", (Entity) => Entity.Panel === "camera" || Entity.Panel === "flare" || Entity.Panel === "post"],
  ["Lights", (Entity) => Entity.Panel === "light" || Entity.Panel === "environment-light"],
  ["Geometry", (Entity) => Entity.Panel === "geometry"],
  ["Sky & weather", (Entity) => ["atmosphere", "sun", "moon", "stars", "clouds", "local-cloud", "wind", "precipitation", "height-fog", "aerial-fog", "local-fog", "rainbow", "god-rays"].includes(Entity.Panel)],
];
// Scene: { Entities (the Construct list), Library (the Content Browser), Convert(Template, Properties) }.
export function ImportSlotInspector({ Subject, Kit, Scene }) {
  const { Card, Metric, Icon } = Kit;
  const [Busy, Work] = useState(false);
  const [Message, Report] = useState("");
  const Picker = useRef(null);
  const Entities = Scene?.Entities || [];
  const Library = useMemo(() => [...(Scene?.Library || []), ...EngineAssets()], [Scene?.Library]);
  const Fill = async (Item) => {
    if (Busy) return;
    Work(true);
    Report("Reading " + Item.Name + "…");
    try {
      const { Full, Read } = Item.Kind === "Construct" ? { Full: Item, Read: {} } : await QueryContent(Item, Library);
      const Resolved = ResolveInstanceTemplate(Full, Entities, Read);
      if (Resolved.Refusal) Report(Resolved.Refusal);
      else {
        Report("");
        Scene.Convert(Resolved.Template, Resolved.Properties);
      }
    } finally {
      Work(false);
    }
  };
  const Choose = async (Event) => {
    const Chosen = Event.target.files?.[0];
    Event.target.value = "";
    if (!Chosen) return;
    try {
      const Kept = await ImportAsset(Chosen);
      Scene.Keep?.(Kept);
      await Fill(Kept);
    } catch (Failure) {
      Report(Failure.message);
    }
  };
  const Routes = [
    ["editor-mesh", "Model", "Geometry · object inspector"],
    ["editor-material", "Material or colour", "Sphere wearing it · object inspector"],
    ["slate-image", "Image or icon", "Image panel · object inspector"],
    ["editor-spotlight", "IES profile", "IES light · light inspector"],
    ["camera", "Scene type", "Its own inspector (camera, light, sky…)"],
  ];
  return (
    <div className="import-slot" data-busy={Busy || undefined}>
      <Card Title="Instance slot" Class="ii-slot-card">
        <Metric Value="Empty" Unit="instance" Caption="Drop anything here; the row becomes it, with its own inspector." />
        <div className="ii-slot" role="button" tabIndex={0} aria-label="Instance slot · drop from the Content Browser or choose a file" onClick={() => Picker.current?.click()} onKeyDown={(Event) => (Event.key === "Enter" || Event.key === " ") && Picker.current?.click()} {...AssetDropProps(SlotKinds, Fill)}>
          <ImportSymbol Name="import-instance" Size={54} />
          <b>{Busy ? "Reading…" : "Drop from the Content Browser"}</b>
          <span>or press to choose a file</span>
        </div>
        <input ref={Picker} type="file" hidden accept={Accept} onChange={Choose} />
        {Message && (
          <p className="ii-message" role="status">
            {Message}
          </p>
        )}
      </Card>
      <Card Title="What it becomes" Class="ii-routes-card">
        <ul className="ii-routes">
          {Routes.map(([Symbol, Label, Detail]) => (
            <li key={Label}>
              <Icon Name={Symbol} Size={20} />
              <b>{Label}</b>
              <span>{Detail}</span>
            </li>
          ))}
        </ul>
      </Card>
      <Card Title="Scene types" Class="ii-types-card">
        <p className="ii-hint">Drag one into the slot, or press it.</p>
        {SceneGroups.map(([Title, Belongs]) => {
          const Members = Entities.filter(Belongs);
          if (!Members.length) return null;
          return (
            <section key={Title} className="ii-type-group">
              <h5>{Title}</h5>
              <div className="ii-types">
                {Members.map((Entity) => (
                  <button key={Entity.Id} type="button" draggable data-scene-type={Entity.Id} onDragStart={(Event) => AssetDragStart(Event, { Id: Entity.Id, Name: Entity.Name, Kind: "Construct" })} onClick={() => Fill({ Id: Entity.Id, Name: Entity.Name, Kind: "Construct" })}>
                    <Icon Name={Entity.Icon} Size={22} />
                    <span>{Entity.Name}</span>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </Card>
    </div>
  );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    IMPORT DIALOG STEP
//------------------------------------------------------------------------------------------------------------------------
// Construct → Import: choose (or drop) a file, see it, then the footer's Add to scene places it. Resolve({ Template, Properties,
// Kept }) is called whenever the chosen file is ready (or null when it can't be placed).
export function ImportFileStep({ Entities, Resolve }) {
  const [Chosen, Pick] = useState(null);
  const [Read, Assign] = useState({});
  const [Kind, Classify] = useState(null);
  const [Busy, Work] = useState(false);
  const Picker = useRef(null);
  const Open = async (File) => {
    if (!File) return;
    Pick(File);
    Assign({});
    Resolve(null);
    const Type = TypeOf(File.name);
    Classify(Type);
    Work(true);
    const Next = {};
    let Item = { Id: null, Name: File.name, Kind: "Other" };
    try {
      if (!Type) throw Error("." + Suffix(File.name) + " is not an engine file type.");
      if (!Type[3]) throw Error(Suffix(File.name).toUpperCase() + " has no reader in this build. " + Type[2].split(" · ")[1] + ".");
      if (File.size > 16 * 1024 * 1024) throw Error(File.name + ": maximum file size is 16 MB.");
      const Group = Type[0];
      if (Group === "Geometry") {
        Next.Mesh = ResolveMesh(File.name, await File.arrayBuffer());
        Item.Kind = "Models";
      } else if (Group === "Light profiles") Next.Profile = ImportIes(await File.text());
      else if (Group === "Images") {
        const Address = URL.createObjectURL(File);
        try {
          Next.Picture = await ShrinkPicture(Address, File.name);
        } finally {
          URL.revokeObjectURL(Address);
        }
        Item.Kind = "Images";
      } else if (Group === "Fonts") {
        const Family = "Import-" + crypto.randomUUID().slice(0, 8);
        const Face = new FontFace(Family, await File.arrayBuffer());
        await Face.load();
        document.fonts.add(Face);
        Next.Font = Family;
        Item.Kind = "Fonts";
      } else if (Group === "Materials") {
        const Content = JSON.parse(await File.text());
        if (Content.Format !== "FrontierMaterial.v1" || !Content.Material?.Channels) throw Error("Not a FrontierMaterial.v1 document.");
        Next.Material = ResolveMaterial({ Material: Content.Material });
        Item = { ...Item, Kind: "Materials", Name: Next.Material.Name || Stem(File.name) };
      } else if (Group === "Colours") {
        Item.Kind = "Colours";
      }
    } catch (Failure) {
      Next.Failure = Failure.message;
    }
    Assign(Next);
    Work(false);
    if (Next.Failure) return;
    // Keep the original in the Content Browser; the row refers to it by id (models are read again from it after a reload).
    let Kept = null;
    try {
      Kept = await ImportAsset(File);
      if (Next.Mesh) RetainMesh(Kept.Id, Next.Mesh);
      if (Kept.Kind === "Colours") Next.Colour = Kept.Colour;
      Item = { ...Item, Id: Kept.Id, Name: Kept.Kind === "Colours" ? Kept.Name : Item.Name };
    } catch (Failure) {
      Assign({ ...Next, Failure: Failure.message });
      return;
    }
    if (Next.Colour) Assign({ ...Next });
    const Resolved = ResolveInstanceTemplate(Item, Entities, Next);
    Resolve({ ...Resolved, Kept, Item });
  };
  const Type = Kind;
  return (
    <div className="ii-dialog">
      <aside className="ii-formats" aria-label="Engine file types">
        <h5>Engine file types</h5>
        {ImportTypes.map(([Title, Suffixes, Becomes, Reads]) => (
          <section key={Title} className={(Reads ? "" : "ii-unread ") + (Type?.[0] === Title ? "ii-current" : "")}>
            <b>{Title}</b>
            <span className="ii-suffixes">{Suffixes.map((Each) => "." + Each).join("  ")}</span>
            <small>{Becomes}</small>
          </section>
        ))}
      </aside>
      <div className="ii-main">
        <div
          className="ii-slot ii-file-slot"
          role="button"
          tabIndex={0}
          aria-label="Choose a file to import"
          onClick={() => Picker.current?.click()}
          onKeyDown={(Event) => (Event.key === "Enter" || Event.key === " ") && Picker.current?.click()}
          onDragOver={(Event) => {
            if (![...(Event.dataTransfer?.types || [])].includes("Files")) return;
            Event.preventDefault();
            Event.currentTarget.setAttribute("data-asset-drop-over", "true");
          }}
          onDragLeave={(Event) => Event.currentTarget.removeAttribute("data-asset-drop-over")}
          onDrop={(Event) => {
            Event.preventDefault();
            Event.currentTarget.removeAttribute("data-asset-drop-over");
            Open(Event.dataTransfer.files?.[0]);
          }}
        >
          <ImportSymbol Name="import" Size={44} />
          <b>{Chosen ? Chosen.name : "Choose a file"}</b>
          <span>{Chosen ? "Press to choose another" : "or drop one here · OBJ, glTF, GLB, STL, PLY, FCT1, IES, images, materials, colours, fonts"}</span>
        </div>
        <input ref={Picker} type="file" hidden accept={Accept} data-import-file onChange={(Event) => { const File = Event.target.files?.[0]; Event.target.value = ""; Open(File); }} />
        {Chosen && (
          <>
            <ImportPreview Item={{ Name: Chosen.name }} Read={Busy ? { Failure: "Reading…" } : Read} Facts={Busy || Read.Failure ? [] : FactsOf(Read, Chosen.size)} />
            {Read.Failure && (
              <p className="ii-message" role="status">
                {Read.Failure}
              </p>
            )}
            {!Read.Failure && !Busy && Type && <p className="ii-becomes">Becomes · {Type[2]}</p>}
          </>
        )}
      </div>
    </div>
  );
}

//------------------------------------------------------------------------------------------------------------------------
//                                                    IMPORTED GEOMETRY PAGE
//------------------------------------------------------------------------------------------------------------------------
// The object inspector's Geometry page for an imported mesh: transform, the source file and how it sits in the scene.
export function ImportedGeometryPage({ Subject, Read, Change, Values, Size, Kit }) {
  const { Card, Control, Metric } = Kit;
  const Revision = useMeshRevision();
  const Mesh = RetrieveMesh(Subject.Mesh, Subject.MeshName);
  const Picture = useMemo(() => (Mesh ? MeshPicture(Mesh, Read, 420, 220) : null), [Mesh, Revision, Read("Geometry Up Axis", "Y")]);
  const Fit = Read("Geometry Fit", true) !== false;
  const Fixed = (Amount, Digits = 2) => (Number.isFinite(Amount) ? Amount.toFixed(Digits) : "–");
  const Units = [["Metres", 1], ["Centimetres", 0.01], ["Millimetres", 0.001], ["Inches", 0.0254], ["Feet", 0.3048]];
  return (
    <>
      <TransformPanel Values={Values} Change={Change} Gizmo />
      <Card Title="Source" Class="ii-source-card">
        <Metric Value={Count(Size.Triangles)} Unit="triangles" Caption={`${Subject.MeshName || "Imported mesh"} · ${Mesh?.Format || "reading…"} · ${Count(Size.Vertices)} vertices`} />
        <div className="graphic ii-source-picture">{Picture ? <img src={Picture} alt="" /> : <span className="ii-empty">{Mesh ? "Preview needs WebGL" : "Reading the file…"}</span>}</div>
        <Control Field={{ Label: "Surface", Control: "Readout" }} Value={Size.Closed ? "Closed · volume is exact" : "Open · volume is an estimate"} />
        {(Mesh?.Notes || []).slice(0, 3).map((Note) => (
          <p key={Note} className="ii-note">
            {Note}
          </p>
        ))}
      </Card>
      <Card Title="Placement" Class="ii-placement-card">
        <Metric Value={Fixed(Size.Bounds[1])} Unit="m · height" Caption={`${Fixed(Size.Bounds[0])} × ${Fixed(Size.Bounds[1])} × ${Fixed(Size.Bounds[2])} m with scale · ×${Fixed(Size.Factor, 4)} from file units`} />
        <Control Field={{ Label: "Up axis", Control: "Select", Options: ["Y up", "Z up"] }} Value={Read("Geometry Up Axis", "Y") === "Z" ? 1 : 0} Change={(Index) => Change("Geometry Up Axis", Index ? "Z" : "Y")} />
        <Control Field={{ Label: "Fit to size", Control: "Switch" }} Value={Fit} Change={(Next) => Change("Geometry Fit", Next)} />
        {Fit ? (
          <Control Field={{ Label: "Largest side", Control: "Slider", Minimum: 0.1, Maximum: 10, Default: 1, Unit: "m", Decimals: 2 }} Value={+Read("Geometry Fit Size", 1)} Change={(Next) => Change("Geometry Fit Size", Next)} />
        ) : (
          <Control Field={{ Label: "File units", Control: "Select", Options: Units.map(([Name]) => Name) }} Value={Math.max(0, Units.findIndex(([, Factor]) => Factor === +Read("Geometry Unit Scale", 1)))} Change={(Index) => Change("Geometry Unit Scale", Units[Index][1])} />
        )}
        <Control Field={{ Label: "Surface area", Control: "Readout" }} Value={Fixed(Size.Area) + " m²"} />
        <Control Field={{ Label: "Volume", Control: "Readout" }} Value={Fixed(Size.Volume, 3) + " m³"} />
      </Card>
    </>
  );
}
export const ImportedProfile = (Subject) => ({
  Name: Subject.MeshName || "Imported geometry",
  Purpose: "Imported geometry from " + (Subject.MeshName || "a file") + ".",
  Reason: "Brought in through Import so it can be lit, given materials and checked against the reference primitives.",
  Tags: ["imported"],
});
