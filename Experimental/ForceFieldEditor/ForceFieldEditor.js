/*============================================================================================================================================
                                                        FORCEFIELDEDITOR.JS
============================================================================================================================================*/
// Main Application Controller for Frontier ForceField Studio (Project-Zero / Frontier World Editor UI).

import {
  BuildFlowParticleBuffers,
  BuildForceOverlayGeometry,
  COLORMAP_CSS_GRADIENTS,
  CreateFlowParticleSystem,
  CreateForceNodeFromModel,
  DEFAULT_FLOW_VIZ,
  EvaluatedQuantities,
  EvaluateSceneCompositeTelemetry,
  FieldColormaps,
  FORCE_MODELS,
  FORMULA_PRESETS,
  GetForceModelMeta,
  ParseForceModelToml,
  ParticleSeedModes,
  ResetFlowParticles,
  ResolveForceValues,
  SCENE_PRESETS,
  SerializeForceModelToml,
  SerializeSimulationSpaceToml,
  StepFlowParticles,
} from "./Engine/ForceFieldCore.js";
import { ForceFieldWebGLViewport } from "./Engine/ForceFieldWebGLViewport.js";
import { RenderInspectorHtml } from "./UI/InspectorRenderer.js";
import { ForceModelIconHtml, SvgGlyph } from "./UI/SvgIcons.js";

const STORAGE_KEY = "Frontier.ForceFieldStudio.v1";

function Esc(Str) {
  return String(Str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function LoadInitialState() {
  const DefaultPreset = SCENE_PRESETS[0];
  let ForceNodes = DefaultPreset.BuildNodes();
  let PresetId = DefaultPreset.Id;
  let FlowViz = { ...DEFAULT_FLOW_VIZ };

  try {
    const Saved = localStorage.getItem(STORAGE_KEY);
    if (Saved) {
      const Parsed = JSON.parse(Saved);
      if (Array.isArray(Parsed.ForceNodes) && Parsed.ForceNodes.length > 0) {
        ForceNodes = Parsed.ForceNodes.map((N) => ({
          ...N,
          Force: ResolveForceValues(N.Force, N.ForceModel),
        }));
      }
      if (Parsed.PresetId) PresetId = Parsed.PresetId;
      if (Parsed.FlowViz) FlowViz = { ...DEFAULT_FLOW_VIZ, ...Parsed.FlowViz };
    }
  } catch {}

  return {
    PresetId,
    ForceNodes,
    SelectedId: ForceNodes[0]?.Id || "flow_viz",
    OutlinerSearch: "",
    OutlinerDomainFilter: "All",
    OutlinerStatusFilter: "All", // All | Active | Muted
    CollapsedFolders: new Set(),
    ExecMode: "Sim", // Edit | Sim | Play
    TimeSec: 0,
    FlowViz,
    ShowDiag: false,
    FlowVizOpen: false,
    NotchOpen: false,
    DrawerOpen: false,
    DrawerDomain: "All",
    DrawerSearch: "",
    ConstructOpen: false,
    ConstructCategory: "All",
    ConstructSearch: "",
    AnemometerHistory: [],
    Fps: 60,
    OverlayTris: 0,
  };
}

function PersistState(State) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        PresetId: State.PresetId,
        ForceNodes: State.ForceNodes,
        FlowViz: State.FlowViz,
      }),
    );
  } catch {}
}

function Boot() {
  const State = LoadInitialState();
  const ParticleSys = CreateFlowParticleSystem(3600, 14);
  let OverlayDirty = true;
  let ExportDownloadName = "ForceFieldScene.VectorFieldSpace.toml";

  const $ = (Id) => document.getElementById(Id);

  // Inject static SVG icons
  $("outliner-add-btn").innerHTML = SvgGlyph("plus", 14);
  $("stats-visible-icon").innerHTML = SvgGlyph("check", 12);
  $("stats-hidden-icon").innerHTML = SvgGlyph("power", 12);
  $("outliner-search-icon").innerHTML = SvgGlyph("search", 13);
  $("construct-btn-icon").innerHTML = SvgGlyph("plus", 13);
  $("btn-focus-cam").innerHTML = SvgGlyph("focus", 14);
  $("btn-toggle-play").innerHTML = SvgGlyph("pause", 13);
  $("btn-respawn-particles").innerHTML = SvgGlyph("reset", 13);
  $("btn-split-view").innerHTML = SvgGlyph("split", 14);
  $("btn-grid-toggle").innerHTML = SvgGlyph("gizmo", 14);
  $("btn-gizmo-toggle").innerHTML = SvgGlyph("edit", 14);
  $("btn-diag-toggle").innerHTML = SvgGlyph("diagnostics", 14);
  $("construct-close-btn").innerHTML = SvgGlyph("close", 14);
  $("construct-search-icon").innerHTML = SvgGlyph("search", 14);

  // Mount WebGL2 Viewport
  const StageEl = $("viewport-stage");
  const Viewport = new ForceFieldWebGLViewport(StageEl, {
    OnSelectForce: (Id) => {
      State.SelectedId = Id;
      OverlayDirty = true;
      SyncAllUi();
    },
    OnTransformForce: (Id, NextPos) => {
      const Node = State.ForceNodes.find((N) => N.Id === Id);
      if (!Node) return;
      Node.Position = NextPos;
      OverlayDirty = true;
      PersistState(State);
      SyncInspectorValuesOnly(Node);
      RenderOutliner();
    },
    OnProbeMoved: (Pos) => {
      State.FlowViz.ProbePosition = Pos;
      Viewport.ProbePos = Pos;
      OverlayDirty = true;
      PersistState(State);
      UpdateProbeHud();
      if (State.SelectedId === "probe_cursor") RenderInspector();
    },
    OnDropForceGenerator: (ModelId, Pos) => {
      SpawnForceGenerator(ModelId, Pos);
    },
  });
  State.CameraState = Viewport.Camera;
  Viewport.ProbePos = State.FlowViz.ProbePosition;

  // Populate Quick Preset Select + Notch Preset Grid
  const PresetSelect = $("select-preset-quick");
  PresetSelect.innerHTML = SCENE_PRESETS.map(
    (P) => `<option value="${Esc(P.Id)}" ${P.Id === State.PresetId ? "selected" : ""}>Preset · ${Esc(P.Name)}</option>`,
  ).join("");

  const RenderNotchPresets = () => {
    $("notch-presets-grid").innerHTML = SCENE_PRESETS.map(
      (P) => `
      <button type="button" class="preset-card ${P.Id === State.PresetId ? "active" : ""}" data-preset-id="${Esc(P.Id)}">
        <strong>${Esc(P.Name)}</strong>
        <small>${Esc(P.Summary)}</small>
      </button>
    `,
    ).join("");
  };

  function LoadPreset(PresetId) {
    const Preset = SCENE_PRESETS.find((P) => P.Id === PresetId);
    if (!Preset) return;
    State.PresetId = Preset.Id;
    State.ForceNodes = Preset.BuildNodes();
    State.SelectedId = State.ForceNodes[0]?.Id || "flow_viz";
    State.TimeSec = 0;
    PresetSelect.value = Preset.Id;
    OverlayDirty = true;
    ResetFlowParticles(ParticleSys, State.ForceNodes, State.FlowViz, State.TimeSec, State.SelectedId);
    PersistState(State);
    SyncAllUi();
  }

  function SpawnForceGenerator(ModelId, CustomPos = null) {
    const ExistingSame = State.ForceNodes.filter((N) => N.Force?.Model === ModelId).length;
    const Offset = CustomPos || [
      Number((((Math.random() - 0.5) * 2.4)).toFixed(2)),
      Number((((Math.random() - 0.5) * 2.0)).toFixed(2)),
      0.9,
    ];
    const NewNode = CreateForceNodeFromModel(ModelId, ExistingSame + 1, Offset);
    State.ForceNodes.push(NewNode);
    State.SelectedId = NewNode.Id;
    OverlayDirty = true;
    ResetFlowParticles(ParticleSys, State.ForceNodes, State.FlowViz, State.TimeSec, State.SelectedId);
    PersistState(State);
    SyncAllUi();
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // OUTLINER RENDERING & EVENTS
  // ------------------------------------------------------------------------------------------------------------------------

  function RenderOutliner() {
    const ActiveCount = State.ForceNodes.filter((N) => !N.Hidden && N.Force?.Enabled !== false).length;
    const MutedCount = State.ForceNodes.length - ActiveCount;
    $("stats-visible-count").textContent = String(ActiveCount);
    $("stats-hidden-count").textContent = String(MutedCount);
    $("outliner-summary").textContent = `ForceField · ${State.ForceNodes.length} generator${State.ForceNodes.length === 1 ? "" : "s"}`;
    $("footer-forces").textContent = `${ActiveCount}/${State.ForceNodes.length}`;

    $("stats-visible-btn").classList.toggle("active-filter", State.OutlinerStatusFilter === "Active");
    $("stats-hidden-btn").classList.toggle("active-filter", State.OutlinerStatusFilter === "Muted");

    const Query = State.OutlinerSearch.trim().toLowerCase();
    const FilteredForces = State.ForceNodes.filter((N) => {
      const Meta = GetForceModelMeta(N.Force?.Model);
      if (State.OutlinerDomainFilter !== "All" && Meta.Domain !== State.OutlinerDomainFilter) return false;
      const IsActive = !N.Hidden && N.Force?.Enabled !== false;
      if (State.OutlinerStatusFilter === "Active" && !IsActive) return false;
      if (State.OutlinerStatusFilter === "Muted" && IsActive) return false;
      if (Query && !N.Name.toLowerCase().includes(Query) && !Meta.Name.toLowerCase().includes(Query)) return false;
      return true;
    });

    const RenderFolder = (Id, Label, IconGlyph, CountText, ChildrenHtml) => {
      const Collapsed = State.CollapsedFolders.has(Id);
      const IsSel = State.SelectedId === Id;
      return `
        <div class="outliner-row ${IsSel ? "selected" : ""}" style="--depth:0" data-row-id="${Id}" role="treeitem">
          <button type="button" class="row-disclosure" data-toggle-folder="${Id}" aria-label="Toggle folder">
            ${SvgGlyph(Collapsed ? "chevronRight" : "chevronDown", 11)}
          </button>
          <span style="color:#9da3ae">${SvgGlyph(IconGlyph, 14)}</span>
          <div class="row-copy">
            <span class="row-name">${Esc(Label)}</span>
            <span class="row-sub">${Esc(CountText)}</span>
          </div>
        </div>
        ${Collapsed ? "" : ChildrenHtml}
      `;
    };

    const ForceChildrenHtml = FilteredForces.map((N) => {
      const F = ResolveForceValues(N.Force);
      const Meta = GetForceModelMeta(F.Model);
      const IsSel = State.SelectedId === N.Id;
      return `
        <div class="outliner-row ${IsSel ? "selected" : ""} ${N.Hidden ? "hidden-row" : ""}" style="--depth:1" data-row-id="${Esc(N.Id)}" role="treeitem">
          <span class="row-disclosure empty"></span>
          ${ForceModelIconHtml(F.Model, 15)}
          <div class="row-copy">
            <span class="row-name">${Esc(N.Name)}</span>
            <span class="row-sub">${Esc(Meta.Name)} · ${F.Strength.toFixed(1)} ${Esc(Meta.Unit)}${F.Solo ? " · SOLO" : ""}</span>
          </div>
          <div class="row-actions">
            <button type="button" class="row-power-dot ${F.Enabled ? "" : "off"}" data-row-power="${Esc(N.Id)}" title="${F.Enabled ? "Mute force" : "Enable force"}" aria-label="Toggle power">
              ${SvgGlyph(F.Enabled ? "check" : "power", 10)}
            </button>
            <button type="button" class="visibility-btn" data-row-vis="${Esc(N.Id)}" title="${N.Hidden ? "Show force" : "Hide force"}" aria-label="Toggle visibility">
              ${SvgGlyph(N.Hidden ? "eyeOff" : "eye", 13)}
            </button>
          </div>
        </div>
      `;
    }).join("");

    const VizChildrenHtml = `
      <div class="outliner-row ${State.SelectedId === "flow_viz" ? "selected" : ""}" style="--depth:1" data-row-id="flow_viz" role="treeitem">
        <span class="row-disclosure empty"></span>
        <span style="color:#68dcff">${SvgGlyph("particles", 14)}</span>
        <div class="row-copy">
          <span class="row-name">Flow Tracers &amp; Streamlines</span>
          <span class="row-sub">${State.FlowViz.ParticleCount} tracers · ${State.FlowViz.SliceAxis} slice</span>
        </div>
      </div>
      <div class="outliner-row ${State.SelectedId === "probe_cursor" ? "selected" : ""}" style="--depth:1" data-row-id="probe_cursor" role="treeitem">
        <span class="row-disclosure empty"></span>
        <span style="color:#54e6a4">${SvgGlyph("probe", 14)}</span>
        <div class="row-copy">
          <span class="row-name">3D Sample Probe</span>
          <span class="row-sub">${(State.FlowViz.ProbePosition || [0, 0, 0]).map((V) => V.toFixed(2)).join(", ")} m</span>
        </div>
      </div>
    `;

    const CamChildrenHtml = `
      <div class="outliner-row ${State.SelectedId === "editor_camera" ? "selected" : ""}" style="--depth:1" data-row-id="editor_camera" role="treeitem">
        <span class="row-disclosure empty"></span>
        <span style="color:#a7b2c4">${SvgGlyph("camera", 14)}</span>
        <div class="row-copy">
          <span class="row-name">Editor Camera</span>
          <span class="row-sub">${Viewport.PrimaryMode} · ${Math.round(Viewport.Camera.FovDeg)}° FOV</span>
        </div>
      </div>
    `;

    $("outliner-rows").innerHTML =
      RenderFolder("forces", "Force Generators", "folder", `${State.ForceNodes.length} items`, ForceChildrenHtml) +
      RenderFolder("visualization", "Flow Visualization", "particles", "Tracers · Streamlines · Probe", VizChildrenHtml) +
      RenderFolder("cameras", "Cameras", "camera", "1 camera", CamChildrenHtml);
  }

  $("outliner-rows").addEventListener("click", (E) => {
    const ToggleBtn = E.target.closest("[data-toggle-folder]");
    if (ToggleBtn) {
      const FId = ToggleBtn.getAttribute("data-toggle-folder");
      if (State.CollapsedFolders.has(FId)) State.CollapsedFolders.delete(FId);
      else State.CollapsedFolders.add(FId);
      RenderOutliner();
      return;
    }
    const PowerBtn = E.target.closest("[data-row-power]");
    if (PowerBtn) {
      const Id = PowerBtn.getAttribute("data-row-power");
      const Node = State.ForceNodes.find((N) => N.Id === Id);
      if (Node) {
        Node.Force.Enabled = !Node.Force.Enabled;
        OverlayDirty = true;
        PersistState(State);
        SyncAllUi();
      }
      return;
    }
    const VisBtn = E.target.closest("[data-row-vis]");
    if (VisBtn) {
      const Id = VisBtn.getAttribute("data-row-vis");
      const Node = State.ForceNodes.find((N) => N.Id === Id);
      if (Node) {
        Node.Hidden = !Node.Hidden;
        OverlayDirty = true;
        PersistState(State);
        SyncAllUi();
      }
      return;
    }
    const Row = E.target.closest("[data-row-id]");
    if (Row) {
      State.SelectedId = Row.getAttribute("data-row-id");
      OverlayDirty = true;
      SyncAllUi();
    }
  });

  // ------------------------------------------------------------------------------------------------------------------------
  // INSPECTOR RENDERING & INTERACTIVE BINDINGS
  // ------------------------------------------------------------------------------------------------------------------------

  function SyncInspectorValuesOnly(Node) {
    const Root = $("inspector-scroll");
    const Pos = Node.Position || [0, 0, 0.9];
    Root.querySelectorAll("[data-pos-axis]").forEach((Inp) => {
      const Ax = Number(Inp.getAttribute("data-pos-axis"));
      if (document.activeElement !== Inp) Inp.value = Number(Pos[Ax]).toFixed(2);
    });
  }

  function DrawAnemometerCanvas() {
    const Canvas = document.getElementById("anemometer-canvas");
    if (!Canvas) return;
    const Ctx = Canvas.getContext("2d");
    const W = Canvas.width, H = Canvas.height;
    Ctx.clearRect(0, 0, W, H);
    Ctx.fillStyle = "#0d0f13";
    Ctx.fillRect(0, 0, W, H);

    // Subtle horizontal scale lines
    Ctx.strokeStyle = "rgba(255,255,255,0.06)";
    Ctx.lineWidth = 1;
    for (let G = 1; G < 4; ++G) {
      const Y = (G / 4) * H;
      Ctx.beginPath();
      Ctx.moveTo(0, Y);
      Ctx.lineTo(W, Y);
      Ctx.stroke();
    }

    const Hist = State.AnemometerHistory;
    if (Hist.length < 2) return;
    const MaxSpd = Math.max(24, ...Hist);
    Ctx.beginPath();
    Hist.forEach((Spd, Idx) => {
      const X = (Idx / Math.max(1, Hist.length - 1)) * (W - 8) + 4;
      const Y = H - 8 - (Math.min(MaxSpd, Spd) / MaxSpd) * (H - 18);
      if (Idx === 0) Ctx.moveTo(X, Y);
      else Ctx.lineTo(X, Y);
    });
    Ctx.strokeStyle = "#68dcff";
    Ctx.lineWidth = 1.8;
    Ctx.stroke();

    const Latest = Hist[Hist.length - 1] || 0;
    Ctx.fillStyle = "#a8b3c2";
    Ctx.font = "500 10px 'DM Sans', sans-serif";
    Ctx.fillText(`Probe ${Latest.toFixed(1)} m/s`, 8, 14);
  }

  function RenderInspector() {
    const El = $("inspector-scroll");
    El.innerHTML = RenderInspectorHtml(State);
    const SelectedForce = State.ForceNodes.find((N) => N.Id === State.SelectedId);
    Viewport.SelectedNode = SelectedForce || null;
    $("inspector-footer-left").textContent = SelectedForce
      ? `${GetForceModelMeta(SelectedForce.Force?.Model).Name} · ${(SelectedForce.Force?.Strength ?? 0).toFixed(1)}`
      : "ForceField · 19 Laws";
    DrawAnemometerCanvas();
  }

  const InspectorEl = $("inspector-scroll");

  InspectorEl.addEventListener("input", (E) => {
    const Target = E.target;
    const ForceNode = State.ForceNodes.find((N) => N.Id === State.SelectedId);

    if (Target.hasAttribute("data-force-name") && ForceNode) {
      ForceNode.Name = Target.value;
      OverlayDirty = true;
      PersistState(State);
      RenderOutliner();
      return;
    }

    if (Target.hasAttribute("data-formula-code") && ForceNode) {
      ForceNode.Force.FormulaCode = Target.value;
      OverlayDirty = true;
      PersistState(State);
      const Diag = InspectorEl.querySelector(".formula-diag");
      if (Diag) {
        // Lightweight live re-check without blowing textarea focus
        RenderInspectorKeepTextareaFocus(Target.selectionStart, Target.selectionEnd);
      }
      return;
    }

    const BindNum = Target.getAttribute("data-bind-num");
    const BindRange = Target.getAttribute("data-bind-range");
    const Key = BindNum || BindRange;
    if (Key) {
      const Val = Number(Target.value);
      if (!Number.isFinite(Val)) return;
      ApplyBoundProperty(Key, Val, Target);
      return;
    }

    const PosAxis = Target.getAttribute("data-pos-axis");
    if (PosAxis !== null && ForceNode) {
      const Ax = Number(PosAxis);
      const Val = Number(Target.value);
      if (Number.isFinite(Val)) {
        ForceNode.Position[Ax] = Val;
        OverlayDirty = true;
        PersistState(State);
      }
    }
  });

  function RenderInspectorKeepTextareaFocus(SelStart, SelEnd) {
    RenderInspector();
    const Ta = InspectorEl.querySelector("[data-formula-code]");
    if (Ta) {
      Ta.focus();
      try { Ta.setSelectionRange(SelStart, SelEnd); } catch {}
    }
  }

  function ApplyBoundProperty(Key, Val, SourceInput) {
    if (Key.startsWith("viz:")) {
      const VizKey = Key.slice(4);
      State.FlowViz[VizKey] = Val;
      OverlayDirty = true;
      if (VizKey === "ParticleCount") {
        ResetFlowParticles(ParticleSys, State.ForceNodes, State.FlowViz, State.TimeSec, State.SelectedId);
      }
      PersistState(State);
      SyncPairInput(Key, Val, SourceInput);
      UpdateProbeHud();
      return;
    }
    if (Key.startsWith("probe:")) {
      const Ax = Number(Key.slice(6));
      State.FlowViz.ProbePosition[Ax] = Val;
      Viewport.ProbePos = State.FlowViz.ProbePosition;
      OverlayDirty = true;
      PersistState(State);
      SyncPairInput(Key, Val, SourceInput);
      UpdateProbeHud();
      return;
    }
    if (Key.startsWith("cam:")) {
      const CamKey = Key.slice(4);
      Viewport.Camera[CamKey] = Val;
      SyncPairInput(Key, Val, SourceInput);
      return;
    }
    const ForceNode = State.ForceNodes.find((N) => N.Id === State.SelectedId);
    if (ForceNode) {
      ForceNode.Force[Key] = Val;
      OverlayDirty = true;
      PersistState(State);
      SyncPairInput(Key, Val, SourceInput);
      RenderOutliner();
    }
  }

  function SyncPairInput(Key, Val, SourceInput) {
    const Partner = InspectorEl.querySelector(
      SourceInput.type === "range" ? `[data-bind-num="${Key}"]` : `[data-bind-range="${Key}"]`,
    );
    if (Partner) Partner.value = Val;
    const Range = SourceInput.type === "range" ? SourceInput : Partner;
    if (Range) {
      const Min = Number(Range.min), Max = Number(Range.max);
      const Pct = Math.max(0, Math.min(100, ((Val - Min) / Math.max(1e-6, Max - Min)) * 100));
      Range.style.setProperty("--fill", `${Pct.toFixed(1)}%`);
    }
  }

  InspectorEl.addEventListener("change", (E) => {
    const Target = E.target;
    const ForceNode = State.ForceNodes.find((N) => N.Id === State.SelectedId);

    const Sel = Target.getAttribute("data-bind-select");
    if (Sel && ForceNode) {
      if (Sel === "Model") {
        const OldPos = ForceNode.Position;
        const NextDefaults = ResolveForceValues({ Model: Target.value });
        ForceNode.Force = { ...NextDefaults, Enabled: ForceNode.Force.Enabled };
        ForceNode.ForceModel = Target.value;
        ForceNode.Icon = `force-model:${Target.value}`;
        ForceNode.Position = OldPos;
      } else {
        ForceNode.Force[Sel] = Target.value;
      }
      OverlayDirty = true;
      PersistState(State);
      SyncAllUi();
      return;
    }

    const VizSel = Target.getAttribute("data-viz-select");
    if (VizSel) {
      State.FlowViz[VizSel] = Target.value;
      OverlayDirty = true;
      if (VizSel === "ParticleSeedMode") {
        ResetFlowParticles(ParticleSys, State.ForceNodes, State.FlowViz, State.TimeSec, State.SelectedId);
      }
      PersistState(State);
      RenderInspector();
      UpdateProbeHud();
    }
  });

  InspectorEl.addEventListener("click", (E) => {
    const ToggleBtn = E.target.closest("[data-bind-toggle]");
    if (ToggleBtn) {
      const Key = ToggleBtn.getAttribute("data-bind-toggle");
      if (Key.startsWith("viz:")) {
        const Vk = Key.slice(4);
        State.FlowViz[Vk] = !State.FlowViz[Vk];
        OverlayDirty = true;
        PersistState(State);
        SyncAllUi();
      } else {
        const Node = State.ForceNodes.find((N) => N.Id === State.SelectedId);
        if (Node) {
          Node.Force[Key] = !Node.Force[Key];
          OverlayDirty = true;
          PersistState(State);
          RenderInspector();
        }
      }
      return;
    }

    const EnumBtn = E.target.closest("[data-bind-enum]");
    if (EnumBtn) {
      const Key = EnumBtn.getAttribute("data-bind-enum");
      const Val = EnumBtn.getAttribute("data-enum-val");
      const Node = State.ForceNodes.find((N) => N.Id === State.SelectedId);
      if (Node) {
        Node.Force[Key] = Val;
        OverlayDirty = true;
        PersistState(State);
        RenderInspector();
      }
      return;
    }

    const VizEnumBtn = E.target.closest("[data-viz-enum]");
    if (VizEnumBtn) {
      State.FlowViz[VizEnumBtn.getAttribute("data-viz-enum")] = VizEnumBtn.getAttribute("data-enum-val");
      OverlayDirty = true;
      PersistState(State);
      RenderInspector();
      return;
    }

    const FormulaPresetBtn = E.target.closest("[data-formula-preset]");
    if (FormulaPresetBtn) {
      const Idx = Number(FormulaPresetBtn.getAttribute("data-formula-preset"));
      const Node = State.ForceNodes.find((N) => N.Id === State.SelectedId);
      if (Node && FORMULA_PRESETS[Idx]) {
        Node.Force.FormulaEnabled = true;
        Node.Force.FormulaCode = FORMULA_PRESETS[Idx].Code;
        OverlayDirty = true;
        PersistState(State);
        RenderInspector();
      }
      return;
    }

    const SelectRow = E.target.closest("[data-select-row]");
    if (SelectRow) {
      State.SelectedId = SelectRow.getAttribute("data-select-row");
      OverlayDirty = true;
      SyncAllUi();
      return;
    }

    const ActionBtn = E.target.closest("[data-action]");
    if (!ActionBtn) return;
    const Action = ActionBtn.getAttribute("data-action");
    const ForceNode = State.ForceNodes.find((N) => N.Id === State.SelectedId);

    if (Action === "toggle-power" && ForceNode) {
      ForceNode.Force.Enabled = !ForceNode.Force.Enabled;
      OverlayDirty = true;
      PersistState(State);
      SyncAllUi();
    } else if (Action === "toggle-solo" && ForceNode) {
      ForceNode.Force.Solo = !ForceNode.Force.Solo;
      OverlayDirty = true;
      PersistState(State);
      SyncAllUi();
    } else if (Action === "trigger-impulse" && ForceNode) {
      ForceNode.Force.LastTriggerTime = State.TimeSec;
      OverlayDirty = true;
      PersistState(State);
    } else if (Action === "duplicate-force" && ForceNode) {
      const Clone = {
        ...ForceNode,
        Id: `force_clone_${Date.now().toString(36)}`,
        Name: `${ForceNode.Name} Copy`,
        Position: [ForceNode.Position[0] + 0.6, ForceNode.Position[1] + 0.4, ForceNode.Position[2]],
        Force: { ...ForceNode.Force },
      };
      State.ForceNodes.push(Clone);
      State.SelectedId = Clone.Id;
      OverlayDirty = true;
      PersistState(State);
      SyncAllUi();
    } else if (Action === "delete-force" && ForceNode) {
      State.ForceNodes = State.ForceNodes.filter((N) => N.Id !== ForceNode.Id);
      State.SelectedId = State.ForceNodes[0]?.Id || "flow_viz";
      OverlayDirty = true;
      PersistState(State);
      SyncAllUi();
    } else if (Action === "reset-force" && ForceNode) {
      ForceNode.Force = ResolveForceValues({ Model: ForceNode.Force.Model });
      OverlayDirty = true;
      PersistState(State);
      SyncAllUi();
    } else if (Action === "reset-flow-viz") {
      State.FlowViz = { ...DEFAULT_FLOW_VIZ };
      OverlayDirty = true;
      ResetFlowParticles(ParticleSys, State.ForceNodes, State.FlowViz, State.TimeSec, State.SelectedId);
      PersistState(State);
      SyncAllUi();
    } else if (Action === "respawn-particles") {
      ResetFlowParticles(ParticleSys, State.ForceNodes, State.FlowViz, State.TimeSec, State.SelectedId);
    } else if (Action === "reset-camera") {
      Viewport.ResetCamera();
      State.CameraState = Viewport.Camera;
      RenderInspector();
    } else if (Action === "open-construct") {
      OpenConstructModal();
    } else if (Action === "export-force-toml" && ForceNode) {
      OpenTomlModal("Export .ForceModel TOML", SerializeForceModelToml(ForceNode.Name, ForceNode.Force, { Position: ForceNode.Position, Rotation: ForceNode.Rotation }), `${ForceNode.Name.replace(/\s+/g, "_")}.ForceModel.toml`, false);
    } else if (Action === "export-scene-toml") {
      OpenTomlModal("Export .VectorFieldSpace TOML", SerializeSimulationSpaceToml(State.ForceNodes, "ForceFieldStudio"), "ForceFieldStudio.VectorFieldSpace.toml", false);
    }
  });

  // ------------------------------------------------------------------------------------------------------------------------
  // FLOW VIZ POPOVER (IN VIEWPORT)
  // ------------------------------------------------------------------------------------------------------------------------

  function RenderFlowVizPopover() {
    const Pop = $("flow-viz-popover");
    Pop.hidden = !State.FlowVizOpen;
    if (!State.FlowVizOpen) return;
    const V = State.FlowViz;
    Pop.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;">
        <h4 style="margin:0;">Flow &amp; Force Visualization</h4>
        <button type="button" class="pill-btn" data-pop-close style="min-height:22px;padding:2px 8px;font-size:10px;">Done</button>
      </div>
      <div class="viz-chip-grid">
        <button type="button" class="${V.ShowFlowParticles ? "on" : ""}" data-pop-toggle="ShowFlowParticles">Flow Particles</button>
        <button type="button" class="${V.ShowStreamlines ? "on" : ""}" data-pop-toggle="ShowStreamlines">RK4 Streamlines</button>
        <button type="button" class="${V.ShowVelocityArrows ? "on" : ""}" data-pop-toggle="ShowVelocityArrows">3D Arrows</button>
        <button type="button" class="${V.ShowHeatmap ? "on" : ""}" data-pop-toggle="ShowHeatmap">Heatmap Slice</button>
        <button type="button" class="${V.ShowEnvelopes ? "on" : ""}" data-pop-toggle="ShowEnvelopes">Force Bounds</button>
        <button type="button" class="${V.ShowMotionPaths ? "on" : ""}" data-pop-toggle="ShowMotionPaths">Motion Paths</button>
      </div>
      <label class="field" style="margin:2px 0;">
        <span>Slice Plane</span>
        <div class="segmented-row">
          ${["XY", "XZ", "YZ", "ALL"].map((Ax) => `<button type="button" class="${V.SliceAxis === Ax ? "active" : ""}" data-pop-slice="${Ax}">${Ax}</button>`).join("")}
        </div>
      </label>
      <label class="field" style="margin:2px 0;">
        <span>Quantity &amp; Colormap</span>
        <div style="display:flex;gap:6px;">
          <select data-pop-select="Quantity" style="flex:1;height:28px;font-size:11px;">
            ${EvaluatedQuantities.map((Q) => `<option value="${Q}" ${V.Quantity === Q ? "selected" : ""}>${Q}</option>`).join("")}
          </select>
          <select data-pop-select="Colormap" style="flex:1;height:28px;font-size:11px;">
            ${FieldColormaps.map((C) => `<option value="${C}" ${V.Colormap === C ? "selected" : ""}>${C}</option>`).join("")}
          </select>
        </div>
      </label>
      <label class="field" style="margin:2px 0;">
        <span>Particle Seed Mode</span>
        <select data-pop-select="ParticleSeedMode" style="width:100%;height:28px;font-size:11px;">
          ${ParticleSeedModes.map((M) => `<option value="${M}" ${V.ParticleSeedMode === M ? "selected" : ""}>${M}</option>`).join("")}
        </select>
      </label>
    `;
  }

  $("flow-viz-popover").addEventListener("click", (E) => {
    if (E.target.closest("[data-pop-close]")) {
      State.FlowVizOpen = false;
      $("btn-flow-viz").classList.remove("active");
      RenderFlowVizPopover();
      return;
    }
    const T = E.target.closest("[data-pop-toggle]");
    if (T) {
      const K = T.getAttribute("data-pop-toggle");
      State.FlowViz[K] = !State.FlowViz[K];
      OverlayDirty = true;
      PersistState(State);
      RenderFlowVizPopover();
      if (State.SelectedId === "flow_viz") RenderInspector();
      return;
    }
    const S = E.target.closest("[data-pop-slice]");
    if (S) {
      State.FlowViz.SliceAxis = S.getAttribute("data-pop-slice");
      OverlayDirty = true;
      PersistState(State);
      RenderFlowVizPopover();
      if (State.SelectedId === "flow_viz") RenderInspector();
    }
  });

  $("flow-viz-popover").addEventListener("change", (E) => {
    const K = E.target.getAttribute("data-pop-select");
    if (!K) return;
    State.FlowViz[K] = E.target.value;
    OverlayDirty = true;
    if (K === "ParticleSeedMode") {
      ResetFlowParticles(ParticleSys, State.ForceNodes, State.FlowViz, State.TimeSec, State.SelectedId);
    }
    PersistState(State);
    UpdateProbeHud();
    if (State.SelectedId === "flow_viz") RenderInspector();
  });

  // ------------------------------------------------------------------------------------------------------------------------
  // CONSTRUCT MODAL (+ ADD FORCE) & BOTTOM FORCE GENERATOR DRAWER
  // ------------------------------------------------------------------------------------------------------------------------

  function OpenConstructModal() {
    State.ConstructOpen = true;
    $("construct-scrim").hidden = false;
    RenderConstructMatrix();
    setTimeout(() => $("construct-search-input").focus(), 20);
  }

  function CloseConstructModal() {
    State.ConstructOpen = false;
    $("construct-scrim").hidden = true;
  }

  function RenderConstructMatrix() {
    const Q = State.ConstructSearch.trim().toLowerCase();
    const Cat = State.ConstructCategory;
    const Items = FORCE_MODELS.filter((M) => {
      if (Cat !== "All" && M.Domain !== Cat) return false;
      if (Q && !M.Name.toLowerCase().includes(Q) && !M.Summary.toLowerCase().includes(Q) && !M.Domain.toLowerCase().includes(Q)) return false;
      return true;
    });

    $("construct-matrix").innerHTML = Items.map(
      (M) => `
      <button type="button" class="construct-entity" data-spawn-model="${Esc(M.Id)}">
        <div style="display:flex;align-items:center;justify-content:space-between;width:100%;">
          ${ForceModelIconHtml(M.Id, 20)}
          <span class="domain-chip" style="color:${M.Color};border-color:${M.Color}44;background:${M.Color}18">${Esc(M.Domain)}</span>
        </div>
        <strong>${Esc(M.Name)}</strong>
        <small>${Esc(M.Summary)}</small>
      </button>
    `,
    ).join("");
  }

  function RenderDrawerCards() {
    const Q = State.DrawerSearch.trim().toLowerCase();
    const Dom = State.DrawerDomain;
    const Items = FORCE_MODELS.filter((M) => {
      if (Dom !== "All" && M.Domain !== Dom) return false;
      if (Q && !M.Name.toLowerCase().includes(Q) && !M.Summary.toLowerCase().includes(Q)) return false;
      return true;
    });
    $("drawer-cards").innerHTML = Items.map(
      (M) => `
      <div class="generator-card" draggable="true" data-drawer-model="${Esc(M.Id)}" title="Drag onto 3D viewport or click to spawn">
        <div class="generator-card-top">
          ${ForceModelIconHtml(M.Id, 16)}
          <strong>${Esc(M.Name)}</strong>
          <small style="margin-left:auto;color:${M.Color}">${Esc(M.Unit)}</small>
        </div>
        <small>${Esc(M.Summary)}</small>
      </div>
    `,
    ).join("");
  }

  $("drawer-cards").addEventListener("dragstart", (E) => {
    const Card = E.target.closest("[data-drawer-model]");
    if (!Card) return;
    E.dataTransfer.setData("application/x-frontier-force", Card.getAttribute("data-drawer-model"));
    E.dataTransfer.effectAllowed = "copy";
  });
  $("drawer-cards").addEventListener("click", (E) => {
    const Card = E.target.closest("[data-drawer-model]");
    if (!Card) return;
    SpawnForceGenerator(Card.getAttribute("data-drawer-model"));
  });

  // ------------------------------------------------------------------------------------------------------------------------
  // TOML MODAL
  // ------------------------------------------------------------------------------------------------------------------------

  function OpenTomlModal(Title, CodeText, Filename, IsImport) {
    ExportDownloadName = Filename;
    $("export-title").textContent = Title;
    $("export-code").value = CodeText;
    $("export-import-apply-btn").hidden = !IsImport;
    $("export-scrim").hidden = false;
  }

  // ------------------------------------------------------------------------------------------------------------------------
  // WIRE TOOLBAR, FILTERS, RESIZERS, NOTCH, DRAWER & KEYBOARD
  // ------------------------------------------------------------------------------------------------------------------------

  $("tab-add-force-btn").addEventListener("click", OpenConstructModal);
  $("outliner-add-btn").addEventListener("click", OpenConstructModal);
  $("btn-construct-force").addEventListener("click", OpenConstructModal);
  $("construct-close-btn").addEventListener("click", CloseConstructModal);
  $("construct-scrim").addEventListener("click", (E) => {
    if (E.target.id === "construct-scrim") CloseConstructModal();
  });
  $("construct-search-input").addEventListener("input", (E) => {
    State.ConstructSearch = E.target.value;
    RenderConstructMatrix();
  });
  $("construct-categories").addEventListener("click", (E) => {
    const Btn = E.target.closest("[data-cat]");
    if (!Btn) return;
    State.ConstructCategory = Btn.getAttribute("data-cat");
    $("construct-categories").querySelectorAll("button").forEach((B) => B.classList.toggle("active", B === Btn));
    RenderConstructMatrix();
  });
  $("construct-matrix").addEventListener("click", (E) => {
    const Card = E.target.closest("[data-spawn-model]");
    if (!Card) return;
    SpawnForceGenerator(Card.getAttribute("data-spawn-model"));
    CloseConstructModal();
  });

  // Outliner Search & Filters
  $("outliner-search").addEventListener("input", (E) => {
    State.OutlinerSearch = E.target.value;
    RenderOutliner();
  });
  $("outliner-filter-chips").addEventListener("click", (E) => {
    const Btn = E.target.closest("[data-filter]");
    if (!Btn) return;
    State.OutlinerDomainFilter = Btn.getAttribute("data-filter");
    $("outliner-filter-chips").querySelectorAll("button").forEach((B) => B.classList.toggle("active", B === Btn));
    RenderOutliner();
  });
  $("stats-visible-btn").addEventListener("click", () => {
    State.OutlinerStatusFilter = State.OutlinerStatusFilter === "Active" ? "All" : "Active";
    RenderOutliner();
  });
  $("stats-hidden-btn").addEventListener("click", () => {
    State.OutlinerStatusFilter = State.OutlinerStatusFilter === "Muted" ? "All" : "Muted";
    RenderOutliner();
  });
  $("outliner-filter-btn").addEventListener("click", () => {
    State.OutlinerDomainFilter = "All";
    State.OutlinerStatusFilter = "All";
    State.OutlinerSearch = "";
    $("outliner-search").value = "";
    $("outliner-filter-chips").querySelectorAll("button").forEach((B) => B.classList.toggle("active", B.getAttribute("data-filter") === "All"));
    RenderOutliner();
  });

  // Viewport Header Controls
  PresetSelect.addEventListener("change", (E) => LoadPreset(E.target.value));
  $("select-camera-view").addEventListener("change", (E) => {
    Viewport.PrimaryMode = E.target.value;
    RenderOutliner();
  });

  const SetExecMode = (Mode) => {
    State.ExecMode = Mode;
    $("mode-edit-btn").classList.toggle("active", Mode === "Edit");
    $("mode-sim-btn").classList.toggle("active", Mode === "Sim");
    $("mode-play-btn").classList.toggle("active", Mode === "Play");
    State.FlowViz.SimPlaying = Mode !== "Edit";
    $("btn-toggle-play").innerHTML = SvgGlyph(State.FlowViz.SimPlaying ? "pause" : "play", 13);
    $("btn-toggle-play").classList.toggle("active", State.FlowViz.SimPlaying);
  };
  $("mode-edit-btn").addEventListener("click", () => SetExecMode("Edit"));
  $("mode-sim-btn").addEventListener("click", () => SetExecMode("Sim"));
  $("mode-play-btn").addEventListener("click", () => SetExecMode("Play"));

  $("btn-toggle-play").addEventListener("click", () => {
    State.FlowViz.SimPlaying = !State.FlowViz.SimPlaying;
    if (State.FlowViz.SimPlaying && State.ExecMode === "Edit") SetExecMode("Sim");
    $("btn-toggle-play").innerHTML = SvgGlyph(State.FlowViz.SimPlaying ? "pause" : "play", 13);
    $("btn-toggle-play").classList.toggle("active", State.FlowViz.SimPlaying);
  });

  $("btn-respawn-particles").addEventListener("click", () => {
    ResetFlowParticles(ParticleSys, State.ForceNodes, State.FlowViz, State.TimeSec, State.SelectedId);
  });

  $("btn-focus-cam").addEventListener("click", () => {
    const Sel = State.ForceNodes.find((N) => N.Id === State.SelectedId);
    if (Sel) Viewport.FocusOn(Sel.Position, Math.max(3.8, Sel.Force.Radius * 2.4));
    else Viewport.ResetCamera();
  });

  $("btn-split-view").addEventListener("click", () => {
    Viewport.SplitView = !Viewport.SplitView;
    $("btn-split-view").classList.toggle("active", Viewport.SplitView);
  });

  $("btn-grid-toggle").addEventListener("click", () => {
    Viewport.ShowGrid = !Viewport.ShowGrid;
    $("btn-grid-toggle").classList.toggle("active", Viewport.ShowGrid);
  });

  $("btn-gizmo-toggle").addEventListener("click", () => {
    Viewport.ShowGizmo = !Viewport.ShowGizmo;
    $("btn-gizmo-toggle").classList.toggle("active", Viewport.ShowGizmo);
  });

  $("btn-diag-toggle").addEventListener("click", () => {
    State.ShowDiag = !State.ShowDiag;
    $("diag-overlay").hidden = !State.ShowDiag;
    $("btn-diag-toggle").classList.toggle("active", State.ShowDiag);
  });

  $("btn-flow-viz").addEventListener("click", () => {
    State.FlowVizOpen = !State.FlowVizOpen;
    $("btn-flow-viz").classList.toggle("active", State.FlowVizOpen);
    RenderFlowVizPopover();
  });

  // Notch & Drawer
  $("notch-handle").addEventListener("click", () => {
    State.NotchOpen = !State.NotchOpen;
    $("notch-shell").classList.toggle("open", State.NotchOpen);
    if (State.NotchOpen) RenderNotchPresets();
  });
  $("notch-close-btn").addEventListener("click", () => {
    State.NotchOpen = false;
    $("notch-shell").classList.remove("open");
  });
  $("notch-presets-grid").addEventListener("click", (E) => {
    const Card = E.target.closest("[data-preset-id]");
    if (!Card) return;
    LoadPreset(Card.getAttribute("data-preset-id"));
    State.NotchOpen = false;
    $("notch-shell").classList.remove("open");
  });
  $("notch-export-scene-btn").addEventListener("click", () => {
    OpenTomlModal("Export .VectorFieldSpace TOML", SerializeSimulationSpaceToml(State.ForceNodes, "ForceFieldStudio"), "ForceFieldStudio.VectorFieldSpace.toml", false);
  });
  $("notch-import-toml-btn").addEventListener("click", () => {
    OpenTomlModal("Import .ForceModel TOML", "# Paste .ForceModel TOML here\n", "ImportedForce.ForceModel.toml", true);
  });

  $("drawer-handle").addEventListener("click", () => {
    State.DrawerOpen = !State.DrawerOpen;
    $("drawer-shell").classList.toggle("open", State.DrawerOpen);
    if (State.DrawerOpen) RenderDrawerCards();
  });
  $("drawer-search").addEventListener("input", (E) => {
    State.DrawerSearch = E.target.value;
    RenderDrawerCards();
  });
  $("drawer-domain-filters").addEventListener("click", (E) => {
    const Btn = E.target.closest("[data-domain]");
    if (!Btn) return;
    State.DrawerDomain = Btn.getAttribute("data-domain");
    $("drawer-domain-filters").querySelectorAll("button").forEach((B) => B.classList.toggle("active", B === Btn));
    RenderDrawerCards();
  });

  // Export / Import Modal
  $("export-close-btn").addEventListener("click", () => { $("export-scrim").hidden = true; });
  $("export-scrim").addEventListener("click", (E) => {
    if (E.target.id === "export-scrim") $("export-scrim").hidden = true;
  });
  $("export-copy-btn").addEventListener("click", () => {
    navigator.clipboard?.writeText($("export-code").value);
  });
  $("export-download-btn").addEventListener("click", () => {
    const BlobObj = new Blob([$("export-code").value], { type: "text/plain" });
    const Url = URL.createObjectURL(BlobObj);
    const A = document.createElement("a");
    A.href = Url;
    A.download = ExportDownloadName;
    A.click();
    URL.revokeObjectURL(Url);
  });
  $("export-import-apply-btn").addEventListener("click", () => {
    const Parsed = ParseForceModelToml($("export-code").value);
    if (Parsed) {
      const Node = {
        Id: `force_import_${Date.now().toString(36)}`,
        Name: Parsed.Name,
        Panel: "force",
        ForceModel: Parsed.Force.Model,
        Icon: `force-model:${Parsed.Force.Model}`,
        Parent: "forces",
        Position: Parsed.Position,
        Rotation: Parsed.Rotation,
        Hidden: false,
        Force: Parsed.Force,
      };
      State.ForceNodes.push(Node);
      State.SelectedId = Node.Id;
      OverlayDirty = true;
      PersistState(State);
      SyncAllUi();
      $("export-scrim").hidden = true;
    }
  });

  // Dock Column Resizers
  const AttachResizer = (ResizerEl, Side) => {
    ResizerEl.addEventListener("pointerdown", (E) => {
      E.preventDefault();
      ResizerEl.setPointerCapture(E.pointerId);
      const StartX = E.clientX;
      const Workspace = $("Editor");
      const Styles = getComputedStyle(Workspace);
      const StartW = parseFloat(Styles.getPropertyValue(Side === "left" ? "--left" : "--right")) || 320;
      document.body.classList.add("resizing");
      const OnMove = (Ev) => {
        const Dx = Ev.clientX - StartX;
        const Next = Side === "left" ? StartW + Dx : StartW - Dx;
        const Clamped = Math.max(240, Math.min(520, Next));
        Workspace.style.setProperty(Side === "left" ? "--left" : "--right", `${Clamped}px`);
      };
      const OnUp = () => {
        document.body.classList.remove("resizing");
        window.removeEventListener("pointermove", OnMove);
        window.removeEventListener("pointerup", OnUp);
      };
      window.addEventListener("pointermove", OnMove);
      window.addEventListener("pointerup", OnUp);
    });
  };
  AttachResizer($("left-resizer"), "left");
  AttachResizer($("right-resizer"), "right");

  // Keyboard Shortcuts
  window.addEventListener("keydown", (E) => {
    const InInput = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    if (E.ctrlKey && E.key.toLowerCase() === "a" && !InInput) {
      E.preventDefault();
      OpenConstructModal();
    } else if (E.ctrlKey && E.key.toLowerCase() === "f") {
      E.preventDefault();
      $("outliner-search").focus();
    } else if (E.ctrlKey && E.key.toLowerCase() === "b") {
      E.preventDefault();
      $("drawer-handle").click();
    } else if (E.key === "Escape") {
      if (State.ConstructOpen) CloseConstructModal();
      else if (State.NotchOpen) $("notch-close-btn").click();
      else if (!$("export-scrim").hidden) $("export-scrim").hidden = true;
      else if (State.FlowVizOpen) {
        State.FlowVizOpen = false;
        $("btn-flow-viz").classList.remove("active");
        RenderFlowVizPopover();
      }
    } else if (!InInput && E.code === "Space") {
      E.preventDefault();
      $("btn-toggle-play").click();
    } else if (!InInput && E.key.toLowerCase() === "f") {
      $("btn-focus-cam").click();
    } else if (!InInput && E.key.toLowerCase() === "r") {
      $("btn-respawn-particles").click();
    } else if (!InInput && E.key === "F3") {
      E.preventDefault();
      $("btn-diag-toggle").click();
    }
  });

  // ------------------------------------------------------------------------------------------------------------------------
  // PROBE TELEMETRY & ANIMATION LOOP
  // ------------------------------------------------------------------------------------------------------------------------

  function UpdateProbeHud() {
    const P = State.FlowViz.ProbePosition || [0.45, 0.25, 0.85];
    const Tel = EvaluateSceneCompositeTelemetry(State.ForceNodes, P[0], P[1], P[2], State.TimeSec, 0.08);
    const Ceil = State.FlowViz.FixedMax || 24;
    $("probe-hud-grad").style.background = COLORMAP_CSS_GRADIENTS[State.FlowViz.Colormap] || COLORMAP_CSS_GRADIENTS.Engineering;
    $("probe-hud-min").textContent = State.FlowViz.Quantity === "Divergence" ? `${(-Ceil * 0.5).toFixed(0)}` : "0";
    $("probe-hud-max").textContent =
      State.FlowViz.Quantity === "Curl" ? `${Ceil} /s` : State.FlowViz.Quantity === "Divergence" ? `+${(Ceil * 0.5).toFixed(0)} /s` : `${Ceil} m/s`;
    $("probe-hud-metrics").innerHTML = `
      <span>|v| <b>${Tel.Speed.toFixed(1)}</b> m/s</span>
      <span>Bft <b>${Tel.Beaufort.Number}</b></span>
      <span>|∇×F| <b>${Tel.CurlMag.toFixed(1)}</b></span>
      <span>∇·F <b>${Tel.Divergence >= 0 ? "+" : ""}${Tel.Divergence.toFixed(1)}</b></span>
    `;
    $("footer-speed").textContent = `${Tel.Speed.toFixed(1)} m/s`;
    $("footer-curl").textContent = `${Tel.CurlMag.toFixed(1)} /s`;

    State.AnemometerHistory.push(Tel.Speed);
    if (State.AnemometerHistory.length > 72) State.AnemometerHistory.shift();
    DrawAnemometerCanvas();
  }

  function SyncAllUi() {
    RenderOutliner();
    RenderInspector();
    RenderFlowVizPopover();
    UpdateProbeHud();
  }

  ResetFlowParticles(ParticleSys, State.ForceNodes, State.FlowViz, State.TimeSec, State.SelectedId);
  SyncAllUi();

  let LastFrameMs = performance.now();
  let LastTelemetryMs = 0;
  let LastGeoBuildMs = 0;
  let FpsAccum = 0, FpsFrames = 0;

  function FrameLoop(NowMs) {
    const Dt = Math.min(0.05, Math.max(0.001, (NowMs - LastFrameMs) * 0.001));
    LastFrameMs = NowMs;

    FpsAccum += Dt;
    FpsFrames += 1;
    if (FpsAccum >= 0.5) {
      State.Fps = Math.round(FpsFrames / FpsAccum);
      $("footer-fps").textContent = `${State.Fps} fps`;
      $("diag-fps").textContent = `${State.Fps}.0 fps`;
      FpsAccum = 0;
      FpsFrames = 0;
    }

    Viewport.StepFlyCamera(Dt);

    const Playing = State.FlowViz.SimPlaying !== false;
    if (Playing) {
      State.TimeSec += Dt;
      if (State.FlowViz.ShowFlowParticles) {
        StepFlowParticles(ParticleSys, State.ForceNodes, Dt, State.FlowViz, State.TimeSec, State.SelectedId);
      }
    }

    const HasDynamicGeo =
      Playing &&
      State.ForceNodes.some(
        (N) =>
          !N.Hidden &&
          N.Force?.Enabled !== false &&
          (N.Force.MotionTopology !== "Static" ||
            N.Force.Duration !== "Continuous" ||
            ["CurlNoise", "AtmosphericGust", "VorticityConfinement", "BrownianNoise"].includes(N.Force.Model) ||
            State.FlowViz.ShowStreamlines),
      );

    if (OverlayDirty || (HasDynamicGeo && NowMs - LastGeoBuildMs >= 42)) {
      OverlayDirty = false;
      LastGeoBuildMs = NowMs;
      const Geo = BuildForceOverlayGeometry(
        State.ForceNodes,
        State.FlowViz,
        State.SelectedId,
        State.TimeSec,
        Viewport.GetActiveCameraOrigin(),
      );
      Viewport.SetOverlayGeometry(Geo);
      State.OverlayTris = Math.round((Geo.OpaqueVertexCount + Geo.TranslucentVertexCount) / 3);
      $("diag-tris").textContent = String(State.OverlayTris);
    }

    if (State.FlowViz.ShowFlowParticles) {
      const Bufs = BuildFlowParticleBuffers(ParticleSys, State.FlowViz, Viewport.GetActiveCameraOrigin());
      Viewport.SetParticleBuffers(Bufs);
      $("vp-footer-particles").textContent = `${State.FlowViz.ParticleCount} tracers · RK2 + RK4`;
      $("diag-particles").textContent = String(State.FlowViz.ParticleCount);
    } else {
      Viewport.SetParticleBuffers({
        TrailBuffer: new Float32Array(0),
        TrailVertexCount: 0,
        HeadBuffer: new Float32Array(0),
        HeadCount: 0,
      });
      $("vp-footer-particles").textContent = "Tracers hidden · RK4 streams";
    }

    Viewport.Render();

    if (NowMs - LastTelemetryMs >= 200) {
      LastTelemetryMs = NowMs;
      UpdateProbeHud();
    }

    requestAnimationFrame(FrameLoop);
  }

  requestAnimationFrame(FrameLoop);
}

window.addEventListener("DOMContentLoaded", Boot);
