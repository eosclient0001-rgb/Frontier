import {
  ValidatePhotometrySamples,
  InterpolateCandela,
  IntegrateLuminousFlux,
  GenerateSpotPhotometry,
  DecodeIES,
  EncodeIES,
} from "./photometry.mjs";

const Select = (Selector) => document.querySelector(Selector);
const SourceStorageKey = "frontier-photometric-editor-v3";
const SourceTypes = ["ies", "spot", "point", "area", "directional", "ambient", "hemisphere"];
const Presets = {
  narrow: () => GenerateSpotPhotometry(2400, 12, 28),
  wide: () => GenerateSpotPhotometry(1500, 35, 65),
  wall: () => [
    { angle: 0, cd: 650 },
    { angle: 20, cd: 900 },
    { angle: 40, cd: 1400 },
    { angle: 60, cd: 1200 },
    { angle: 80, cd: 400 },
    { angle: 90, cd: 0 },
    { angle: 180, cd: 0 },
  ],
};

function CreateSource(Type = "ies") {
  return {
    id: crypto.randomUUID(),
    name: Type === "ies" ? "Custom IES luminaire" : `Custom ${Type} source`,
    type: Type,
    color: "#fff2dc",
    groundColor: "#48433b",
    intensity: Type === "directional" ? 12000 : ["ambient", "hemisphere"].includes(Type) ? 0.45 : 1200,
    inner: 12,
    outer: 28,
    width: 1.2,
    height: 0.8,
    position: [0, 4, 0],
    target: [0, 0, 0],
    points: Presets.narrow(),
  };
}

function NormalizeSource(Source) {
  if (!Source || !Source.id || !SourceTypes.includes(Source.type)) return null;
  const DefaultSource = CreateSource(Source.type);
  return {
    ...DefaultSource,
    ...Source,
    position:
      Array.isArray(Source.position) && Source.position.length === 3
        ? Source.position.map(Number)
        : DefaultSource.position,
    target:
      Array.isArray(Source.target) && Source.target.length === 3
        ? Source.target.map(Number)
        : DefaultSource.target,
    points: Source.points
      ? ValidatePhotometrySamples(Source.points)
      : DefaultSource.points,
  };
}

let Sources = [];
let SelectedSourceId = "";
let EnvironmentSettings = { map: "StudioSoftbox", intensity: 1, rotation: 0 };
try {
  let StoredSpecification = JSON.parse(
    localStorage.getItem(SourceStorageKey)
      || localStorage.getItem("frontier-photometry-studio-v2"),
  );
  if (
    !Array.isArray(StoredSpecification?.sources) ||
    StoredSpecification.sources.length === 0
  ) {
    const LegacySpecification = JSON.parse(
      localStorage.getItem("frontier-light-studio-v1"),
    );
    if (
      Array.isArray(LegacySpecification?.lights) &&
      LegacySpecification.lights.length > 0
    ) {
      StoredSpecification = {
        sources: LegacySpecification.lights,
        selected: LegacySpecification.selected,
      };
    }
  }
  if (StoredSpecification?.environment) {
    EnvironmentSettings = {
      ...EnvironmentSettings,
      ...StoredSpecification.environment,
    };
  }
  if (
    !Array.isArray(StoredSpecification?.sources) ||
    StoredSpecification.sources.length === 0
  )
    throw Error("Empty library");
  Sources = StoredSpecification.sources.map(NormalizeSource).filter(Boolean);
  if (!Sources.length) throw Error("No supported lights");
  SelectedSourceId = Sources.some(
    (Source) => Source.id === StoredSpecification.selected,
  )
    ? StoredSpecification.selected
    : Sources[0].id;
} catch {
  const InitialSource = CreateSource();
  Sources = [InitialSource];
  SelectedSourceId = InitialSource.id;
}

const CurrentSource = () =>
  Sources.find((Source) => Source.id === SelectedSourceId);
const CurrentDistribution = () =>
  CurrentSource().type === "spot"
    ? GenerateSpotPhotometry(
        CurrentSource().intensity,
        CurrentSource().inner,
        CurrentSource().outer,
      )
    : CurrentSource().type === "ies"
      ? CurrentSource().points
      : null;
let LightingViewport = null;
let ToastTimer = 0;

function StoreLibrary() {
  try {
    localStorage.setItem(
      SourceStorageKey,
      JSON.stringify({ sources: Sources, selected: SelectedSourceId, environment: EnvironmentSettings }),
    );
    Select("#saved").textContent = "Saved in this browser";
  } catch {
    Select("#saved").textContent = "Browser storage unavailable";
  }
}

function ShowMessage(Message) {
  const Toast = Select("#toast");
  Toast.textContent = Message;
  Toast.classList.add("show");
  window.clearTimeout(ToastTimer);
  ToastTimer = window.setTimeout(() => Toast.classList.remove("show"), 3200);
}

function NumberText(PhotometricNumber, FractionDigits = 0) {
  return new Intl.NumberFormat("en", {
    maximumFractionDigits: FractionDigits,
  }).format(PhotometricNumber);
}

function RenderLibrary() {
  const List = Select("#library");
  List.replaceChildren();
  for (const Source of Sources) {
    const Button = document.createElement("button");
    Button.className = `source-entry${Source.id === SelectedSourceId ? " selected" : ""}`;
    Button.type = "button";
    Button.setAttribute(
      "aria-current",
      Source.id === SelectedSourceId ? "true" : "false",
    );
    const Name = document.createElement("b");
    Name.textContent = Source.name;
    const Type = document.createElement("span");
    Type.textContent = Source.type.toUpperCase();
    Button.append(Name, Type);
    Button.addEventListener("click", () => {
      SelectedSourceId = Source.id;
      StoreLibrary();
      RenderStudio();
    });
    List.append(Button);
  }
}

function RenderSamples(Points) {
  const List = Select("#sampleList");
  List.replaceChildren();
  Points.forEach((Point, PointIndex) => {
    const Row = document.createElement("div");
    Row.className = "sample-row";
    for (const [Field, Unit, Step] of [
      ["angle", "°", "1"],
      ["cd", "cd", "10"],
    ]) {
      const Input = document.createElement("input");
      Input.type = "number";
      Input.min = Field === "angle" ? "0" : "0";
      Input.max = Field === "angle" ? "180" : "10000000";
      Input.step = Step;
      Input.value = Point[Field];
      Input.setAttribute(
        "aria-label",
        `${Field === "angle" ? "Vertical angle" : "Candela"} sample ${PointIndex + 1}`,
      );
      Input.disabled =
        Field === "angle" &&
        (PointIndex === 0 || PointIndex === Points.length - 1);
      Input.addEventListener("change", () => {
        const EditedPoints = Points.map((Sample) => ({ ...Sample }));
        EditedPoints[PointIndex][Field] = Number(Input.value);
        try {
          ValidatePhotometrySamples(EditedPoints);
          CurrentSource().points = EditedPoints;
          StoreLibrary();
          RenderStudio();
        } catch (Failure) {
          ShowMessage(Failure.message);
          RenderStudio();
        }
      });
      const UnitLabel = document.createElement("span");
      UnitLabel.textContent = Unit;
      Row.append(Input, UnitLabel);
    }
    const RemoveButton = document.createElement("button");
    RemoveButton.className = "sample-remove";
    RemoveButton.type = "button";
    RemoveButton.textContent = "×";
    RemoveButton.title = "Remove this sample";
    RemoveButton.disabled =
      PointIndex === 0 || PointIndex === Points.length - 1;
    RemoveButton.addEventListener("click", () => {
      CurrentSource().points.splice(PointIndex, 1);
      StoreLibrary();
      RenderStudio();
    });
    Row.append(RemoveButton);
    List.append(Row);
  });
}

function RenderDistribution(Points) {
  const Canvas = Select("#curve");
  const Bounds = Canvas.getBoundingClientRect();
  if (Bounds.width < 1 || Bounds.height < 1) return;
  const PixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  Canvas.width = Math.round(Bounds.width * PixelRatio);
  Canvas.height = Math.round(Bounds.height * PixelRatio);
  const Context = Canvas.getContext("2d");
  Context.setTransform(PixelRatio, 0, 0, PixelRatio, 0, 0);
  const Width = Bounds.width;
  const Height = Bounds.height;
  const Margins = { left: 56, right: 18, top: 16, bottom: 15 };
  const PeakCandela = Math.max(...Points.map((Point) => Point.cd), 1);
  Context.clearRect(0, 0, Width, Height);
  Context.font = "11px Inter, system-ui, sans-serif";
  Context.lineWidth = 1;
  for (let GridIndex = 0; GridIndex <= 4; GridIndex++) {
    const Vertical =
      Margins.top + ((Height - Margins.top - Margins.bottom) * GridIndex) / 4;
    Context.strokeStyle = "#34383b";
    Context.beginPath();
    Context.moveTo(Margins.left, Vertical);
    Context.lineTo(Width - Margins.right, Vertical);
    Context.stroke();
    Context.fillStyle = "#8e969b";
    Context.fillText(
      NumberText(PeakCandela * (1 - GridIndex / 4)),
      4,
      Vertical + 4,
    );
  }
  Context.beginPath();
  for (let Angle = 0; Angle <= 180; Angle++) {
    const Horizontal =
      Margins.left + ((Width - Margins.left - Margins.right) * Angle) / 180;
    const Vertical =
      Margins.top +
      (1 - InterpolateCandela(Points, Angle) / PeakCandela) *
        (Height - Margins.top - Margins.bottom);
    if (Angle === 0) Context.moveTo(Horizontal, Vertical);
    else Context.lineTo(Horizontal, Vertical);
  }
  Context.strokeStyle = "#dfb48c";
  Context.lineWidth = 2;
  Context.stroke();
  Select("#curveMaximum").textContent = `${NumberText(PeakCandela)} cd peak`;
}

function ConfigureTextInput(Selector, PhotometricNumber) {
  Select(Selector).value = PhotometricNumber;
}

function RenderStudio() {
  const Source = CurrentSource();
  const IsDistribution = Source.type === "ies" || Source.type === "spot";
  const Distribution = CurrentDistribution();
  Select("#name").value = Source.name;
  Select("#color").value = Source.color;
  Select("#groundColor").value = Source.groundColor || "#48433b";
  Select("#groundColorRow").hidden = Source.type !== "hemisphere";
  Select("#typeLabel").textContent =
    Source.type === "ies" ? "IES photometry" : `${Source.type} light`;
  Select("#crumb").textContent =
    Source.type === "ies"
      ? "IES PHOTOMETRY"
      : `${Source.type.toUpperCase()} SOURCE`;
  Select("#outputHeading").textContent =
    Source.type === "directional"
      ? "Directional illuminance"
      : ["ambient", "hemisphere"].includes(Source.type)
        ? "Renderer fill intensity"
        : "Photometric output";
  Select("#curveCard").hidden = !IsDistribution;
  Select("#presetCard").hidden = !IsDistribution;
  for (const Type of SourceTypes) {
    const Tab = Select(`[data-source-type="${Type}"]`);
    const Selected = Source.type === Type;
    Tab.classList.toggle("active", Selected);
    Tab.setAttribute("aria-pressed", String(Selected));
  }
  for (const Type of SourceTypes) {
    Select(`#${Type}Controls`).hidden = Source.type !== Type;
  }

  if (Distribution) {
    const PeakCandela = Math.max(...Distribution.map((Point) => Point.cd));
    Select("#peakStat").textContent = `${NumberText(PeakCandela)} cd`;
    Select("#fluxStat").textContent =
      `${NumberText(IntegrateLuminousFlux(Distribution))} lm`;
    Select("#curveHeading").textContent =
      Source.type === "ies"
        ? "IES candela by vertical angle"
        : "Spot candela by vertical angle";
    RenderSamples(Source.type === "ies" ? Source.points : []);
    if (Source.type === "spot")
      Select("#spotFlux").textContent =
        `${NumberText(IntegrateLuminousFlux(Distribution))} lm`;
    RenderDistribution(Distribution);
  }
  if (Source.type === "point") {
    Select("#pointFlux").textContent =
      `${NumberText(4 * Math.PI * Source.intensity)} lm`;
  }
  ConfigureTextInput("#intensity", Source.intensity);
  ConfigureTextInput("#inner", Source.inner);
  ConfigureTextInput("#outer", Source.outer);
  ConfigureTextInput("#pointIntensity", Source.intensity);
  ConfigureTextInput("#areaIntensity", Source.intensity);
  ConfigureTextInput("#areaWidth", Source.width);
  ConfigureTextInput("#areaHeight", Source.height);
  ConfigureTextInput("#directionalIntensity", Source.intensity);
  ConfigureTextInput("#ambientIntensity", Source.intensity);
  ConfigureTextInput("#hemisphereIntensity", Source.intensity);
  Select("#environmentMap").value = EnvironmentSettings.map;
  Select("#environmentIntensity").value = EnvironmentSettings.intensity;
  Select("#environmentRotation").value = EnvironmentSettings.rotation;
  Select("#environmentIntensityValue").textContent = NumberText(EnvironmentSettings.intensity, 2);
  Select("#environmentRotationValue").textContent = `${Math.round(EnvironmentSettings.rotation)}°`;
  for (const Axis of ["position", "target"]) {
    const Inputs = document.querySelectorAll(`[data-vector="${Axis}"] input`);
    Inputs.forEach(
      (Input, AxisIndex) => (Input.value = Source[Axis][AxisIndex]),
    );
  }

  Select("#previewMode").textContent = {
    ies: "IES Type C · direct photometry · shadow mapped",
    spot: "Spotlight · candela · inverse-square falloff · shadow mapped",
    point: "Point source · candela · inverse-square falloff · shadow mapped",
    area: "Rectangular area source · luminance · direct lighting",
    directional: "Directional source · lux · shadow mapped",
    ambient: "Ambient fill · uniform diffuse illumination · relative renderer units",
    hemisphere: "Hemisphere fill · sky/ground gradient · relative renderer units",
  }[Source.type];
  const WideProfile =
    Source.type === "ies" &&
    Source.points.some((Point) => Point.angle >= 89.5 && Point.cd > 0);
  const WideSpot = Source.type === "spot" && Source.outer > 89.5;
  Select("#previewNote").textContent = WideProfile
    ? "IES export retains 0°–180°. The viewport clips the forward-hemisphere model at 89.5°; indirect bounce is not calculated."
    : WideSpot
      ? "The photometric curve and IES export retain the authored angle. The viewport clips its spotlight cone at 89.5°."
      : Source.type === "area"
        ? "Direct illumination only. Rectangular area lights do not cast shadows in this WebGL renderer; indirect bounce is not calculated."
        : ["ambient", "hemisphere"].includes(Source.type)
          ? "Ambient and hemisphere intensities are renderer-relative and are not physically calibrated in lux or lumens."
          : "Direct illumination only. Indirect bounce transport is not calculated.";
  Select("#export").disabled = !IsDistribution;
  Select("#delete").disabled = Sources.length < 2;
  RenderLibrary();
  if (LightingViewport) {
    LightingViewport.Reconfigure({
      ...Source,
      points: Distribution || Source.points,
    });
  }
}

function ReconfigureNumericInput(Field, Input) {
  const Source = CurrentSource();
  const PhotometricNumber = Number(Input.value);
  if (!Number.isFinite(PhotometricNumber)) return;
  if (
    Field === "intensity" ||
    Field === "pointIntensity" ||
    Field === "areaIntensity" ||
    Field === "directionalIntensity"
  ) {
    Source.intensity = Math.max(
      0,
      Math.min(
        Field === "directionalIntensity" ? 100000 : 10000000,
        PhotometricNumber,
      ),
    );
  } else if (Field === "inner") {
    Source.inner = Math.max(0, Math.min(Source.outer - 0.1, PhotometricNumber));
  } else if (Field === "outer") {
    Source.outer = Math.max(
      Source.inner + 0.1,
      Math.min(180, PhotometricNumber),
    );
  } else if (Field === "ambientIntensity" || Field === "hemisphereIntensity") {
    Source.intensity = Math.max(0, Math.min(10, PhotometricNumber));
  } else if (Field === "areaWidth" || Field === "areaHeight") {
    Source[Field === "areaWidth" ? "width" : "height"] = Math.max(
      0.05,
      Math.min(10, PhotometricNumber),
    );
  }
  StoreLibrary();
  RenderStudio();
}

Select("#name").addEventListener("change", (Event) => {
  CurrentSource().name =
    Event.target.value.trim().slice(0, 70) || "Untitled light";
  StoreLibrary();
  RenderStudio();
});
Select("#color").addEventListener("change", (Event) => {
  CurrentSource().color = Event.target.value;
  StoreLibrary();
  RenderStudio();
});
Select("#groundColor").addEventListener("change", (Event) => {
  CurrentSource().groundColor = Event.target.value;
  StoreLibrary();
  RenderStudio();
});
for (const [Field, Setting] of [["#environmentMap", "map"], ["#environmentIntensity", "intensity"], ["#environmentRotation", "rotation"]]) {
  Select(Field).addEventListener("input", (Event) => {
    EnvironmentSettings[Setting] = Setting === "map" ? Event.target.value : Number(Event.target.value);
    StoreLibrary();
    if (LightingViewport) LightingViewport.SetEnvironment(EnvironmentSettings);
    if (Setting === "intensity") Select("#environmentIntensityValue").textContent = NumberText(EnvironmentSettings.intensity, 2);
    if (Setting === "rotation") Select("#environmentRotationValue").textContent = `${Math.round(EnvironmentSettings.rotation)}°`;
  });
}
for (const Field of [
  "intensity",
  "inner",
  "outer",
  "pointIntensity",
  "areaIntensity",
  "areaWidth",
  "areaHeight",
  "directionalIntensity",
  "ambientIntensity",
  "hemisphereIntensity",
]) {
  Select(`#${Field}`).addEventListener("change", (Event) =>
    ReconfigureNumericInput(Field, Event.target),
  );
}
for (const Axis of ["position", "target"]) {
  for (const [AxisIndex, Input] of [
    ...document.querySelectorAll(`[data-vector="${Axis}"] input`),
  ].entries()) {
    Input.addEventListener("change", () => {
      const PhotometricNumber = Number(Input.value);
      if (!Number.isFinite(PhotometricNumber)) return;
      CurrentSource()[Axis][AxisIndex] = Math.max(
        -100,
        Math.min(100, PhotometricNumber),
      );
      StoreLibrary();
      RenderStudio();
    });
  }
}

for (const Tab of document.querySelectorAll("[data-source-type]")) {
  Tab.addEventListener("click", () => {
    CurrentSource().type = Tab.dataset.sourceType;
    StoreLibrary();
    RenderStudio();
  });
}
Select("#add").addEventListener("click", () => {
  const NewSource = CreateSource(CurrentSource().type);
  Sources.push(NewSource);
  SelectedSourceId = NewSource.id;
  StoreLibrary();
  RenderStudio();
});
Select("#delete").addEventListener("click", () => {
  if (Sources.length < 2) return;
  Sources = Sources.filter((Source) => Source.id !== SelectedSourceId);
  SelectedSourceId = Sources[0].id;
  StoreLibrary();
  RenderStudio();
});
Select("#addSample").addEventListener("click", () => {
  const Points = CurrentSource().points;
  if (Points.length >= 1000) {
    ShowMessage("IES format limit reached: 1000 vertical samples.");
    return;
  }
  let WidestGapIndex = 0;
  for (let PointIndex = 1; PointIndex < Points.length - 1; PointIndex++) {
    if (
      Points[PointIndex + 1].angle - Points[PointIndex].angle >
      Points[WidestGapIndex + 1].angle - Points[WidestGapIndex].angle
    ) {
      WidestGapIndex = PointIndex;
    }
  }
  const NewAngle =
    (Points[WidestGapIndex].angle + Points[WidestGapIndex + 1].angle) / 2;
  Points.splice(WidestGapIndex + 1, 0, {
    angle: NewAngle,
    cd: InterpolateCandela(Points, NewAngle),
  });
  StoreLibrary();
  RenderStudio();
});
for (const PresetButton of document.querySelectorAll("[data-preset]")) {
  PresetButton.addEventListener("click", () => {
    const PresetName = PresetButton.dataset.preset;
    const Source = CurrentSource();
    if (Source.type === "spot")
      [Source.intensity, Source.inner, Source.outer] =
        PresetName === "narrow"
          ? [2400, 12, 28]
          : PresetName === "wide"
            ? [1500, 35, 65]
            : [1400, 45, 80];
    else if (Source.type === "ies") Source.points = Presets[PresetName]();
    else {
      Source.type = "ies";
      Source.points = Presets[PresetName]();
    }
    StoreLibrary();
    RenderStudio();
    ShowMessage("Photometric preset applied");
  });
}
Select("#export").addEventListener("click", () => {
  try {
    const Distribution = CurrentDistribution();
    if (!Distribution)
      throw Error("IES export is available for IES and spotlight sources.");
    const Document = EncodeIES(Distribution, CurrentSource().name);
    const DownloadUrl = URL.createObjectURL(
      new Blob([Document], { type: "text/plain" }),
    );
    const DownloadLink = document.createElement("a");
    DownloadLink.href = DownloadUrl;
    DownloadLink.download = `${
      CurrentSource()
        .name.replace(/[^a-z0-9_-]+/gi, "-")
        .replace(/^-|-$/g, "") || "photometry"
    }.ies`;
    DownloadLink.click();
    window.setTimeout(() => URL.revokeObjectURL(DownloadUrl), 1000);
    ShowMessage("LM-63 IES profile exported");
  } catch (Failure) {
    ShowMessage(Failure.message);
  }
});
Select("#importButton").addEventListener("click", () =>
  Select("#file").click(),
);
Select("#file").addEventListener("change", async (Event) => {
  const File = Event.target.files[0];
  if (!File) return;
  try {
    if (File.size > 1000000)
      throw Error("IES files over 1 MB are not supported.");
    const ImportedSource = CreateSource("ies");
    ImportedSource.name =
      File.name.replace(/\.ies$/i, "").slice(0, 70) || "Imported IES profile";
    ImportedSource.points = DecodeIES(await File.text());
    Sources.push(ImportedSource);
    SelectedSourceId = ImportedSource.id;
    StoreLibrary();
    RenderStudio();
    ShowMessage("IES photometry imported");
  } catch (Failure) {
    ShowMessage(Failure.message);
  } finally {
    Event.target.value = "";
  }
});
Select("#resetView").addEventListener("click", () =>
  LightingViewport?.ResetView(),
);
window.addEventListener("resize", () => {
  if (CurrentDistribution()) RenderDistribution(CurrentDistribution());
});

StoreLibrary();
RenderStudio();
import("./scene.mjs")
  .then(({ CreateLightingViewport }) => {
    try {
      LightingViewport = CreateLightingViewport(Select("#scene"), (Message) => {
        Select("#sceneStatus").textContent = Message;
      });
      Select("#sceneStatus").textContent =
        "WebGL ready · loading Studio Softbox environment";
      LightingViewport.Reconfigure({
        ...CurrentSource(),
        points: CurrentDistribution() || CurrentSource().points,
      });
      LightingViewport.SetEnvironment(EnvironmentSettings);
    } catch (Failure) {
      Select("#sceneStatus").textContent =
        `3D viewport unavailable: ${Failure.message}`;
      Select("#sceneStatus").classList.add("error");
    }
  })
  .catch((Failure) => {
    Select("#sceneStatus").textContent =
      `3D viewport unavailable: ${Failure.message}`;
    Select("#sceneStatus").classList.add("error");
  });
