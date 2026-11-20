/*============================================================================================================================================
                                                        INSPECTORRENDERER.JS
============================================================================================================================================*/
// Renders the contextual Project-Zero / Frontier World Editor Right Inspector for:
//   - Force Generator Nodes (Hero Banner, 2x2 Metrics, Force Law Selector, Transform, Physics & Envelope,
//     Attenuation & Duration Live SVG Curves, Wind Anemometer, Motion Path, VectorFieldLang Formula, TOML Export/Import)
//   - Flow Visualization Settings Node (Particles, Streamlines, 3D Arrows, Heatmap Slice, Probe)
//   - Camera Nodes (Editor Camera Position/Target/FOV + Presets)
//   - Folder Summary Nodes

import {
  AttenuationCurves,
  COLORMAP_CSS_GRADIENTS,
  DurationModes,
  EvaluateRadialEnvelope,
  EvaluateSceneCompositeTelemetry,
  FieldColormaps,
  FORCE_MODELS,
  ForceDomains,
  GetCompiledForceFormula,
  GetForceModelMeta,
  MotionLoopModes,
  MotionTopologies,
  ParticleSeedModes,
  ReachEnvelopes,
  ResolveForceValues,
  StreamColorModes,
  EvaluatedQuantities,
} from "../Engine/ForceFieldCore.js";
import { FORMULA_PRESETS } from "../Engine/VectorFieldLang.js";
import { ForceModelIconHtml, SvgGlyph } from "./SvgIcons.js";

function Esc(Str) {
  return String(Str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function RenderSliderRow(Id, Label, Value, Min, Max, Step = 0.05, Unit = "", Decimals = 2) {
  const Safe = Number.isFinite(+Value) ? +Value : Min;
  const Pct = Math.max(0, Math.min(100, ((Safe - Min) / Math.max(1e-6, Max - Min)) * 100));
  return `
    <label class="field">
      <span>${Esc(Label)}</span>
      <div class="slider-pill">
        <div class="split-value">
          <input type="number" data-bind-num="${Esc(Id)}" min="${Min}" max="${Max}" step="${Step}" value="${Number(Safe.toFixed(Decimals))}" aria-label="${Esc(Label)} value" />
          ${Unit ? `<small>${Esc(Unit)}</small>` : ""}
        </div>
        <input type="range" data-bind-range="${Esc(Id)}" min="${Min}" max="${Max}" step="${Step}" value="${Safe}" style="--fill:${Pct.toFixed(1)}%" aria-label="${Esc(Label)}" />
      </div>
    </label>
  `;
}

function RenderToggleRow(Id, Label, Checked, Hint = "") {
  return `
    <div class="switch-row">
      <div>
        <span>${Esc(Label)}</span>
        ${Hint ? `<small style="display:block;color:#6f747d;margin-top:2px;">${Esc(Hint)}</small>` : ""}
      </div>
      <button type="button" class="toggle ${Checked ? "on" : ""}" data-bind-toggle="${Esc(Id)}" aria-pressed="${Boolean(Checked)}"><i></i></button>
    </div>
  `;
}

function BuildAttenuationCurveSvg(Force) {
  const W = 280, H = 74, PadX = 12, PadY = 10;
  const PlotW = W - PadX * 2, PlotH = H - PadY * 2;
  const Pts = [];
  const Area = [];
  for (let I = 0; I <= 40; ++I) {
    const U = I / 40;
    const Y01 = EvaluateRadialEnvelope(U, Force.Attenuation, Force.FalloffExponent);
    const X = PadX + U * PlotW;
    const Y = PadY + (1 - Y01) * PlotH;
    Pts.push(`${X.toFixed(1)},${Y.toFixed(1)}`);
    Area.push(`${X.toFixed(1)},${Y.toFixed(1)}`);
  }
  const AreaPath = `M ${PadX},${PadY + PlotH} L ${Area.join(" L ")} L ${PadX + PlotW},${PadY + PlotH} Z`;
  const CoreU = Math.min(0.98, Force.CoreRadius / Math.max(0.2, Force.Radius));
  const CoreX = PadX + CoreU * PlotW;
  return `
    <svg viewBox="0 0 ${W} ${H}" class="curve-svg" aria-label="Radial attenuation envelope curve">
      <defs>
        <linearGradient id="attGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#4AA8FF" stop-opacity="0.34"/>
          <stop offset="100%" stop-color="#4AA8FF" stop-opacity="0.02"/>
        </linearGradient>
      </defs>
      <line x1="${PadX}" y1="${PadY + PlotH}" x2="${PadX + PlotW}" y2="${PadY + PlotH}" stroke="#2f3238" stroke-width="1"/>
      <line x1="${CoreX.toFixed(1)}" y1="${PadY}" x2="${CoreX.toFixed(1)}" y2="${PadY + PlotH}" stroke="#ffb454" stroke-dasharray="2.5 2.5" stroke-width="1"/>
      <path d="${AreaPath}" fill="url(#attGrad)"/>
      <polyline points="${Pts.join(" ")}" fill="none" stroke="#68dcff" stroke-width="2" stroke-linecap="round"/>
      <text x="${PadX}" y="${H - 1}">r = 0</text>
      <text x="${CoreX.toFixed(1)}" y="${PadY + 8}" fill="#ffb454">r_core</text>
      <text x="${PadX + PlotW - 22}" y="${H - 1}">R = ${Force.Radius.toFixed(1)}m</text>
    </svg>
  `;
}

function BuildDurationWaveformSvg(Force, TimeSec) {
  const W = 280, H = 56, PadX = 12, PadY = 8;
  const PlotW = W - PadX * 2, PlotH = H - PadY * 2;
  const Pts = [];
  for (let I = 0; I <= 48; ++I) {
    const T = (I / 48) * 3.0;
    let G = 1.0;
    if (Force.Duration === "Modulated") {
      G = 0.58 + 0.42 * Math.sin((TimeSec + T) * Math.PI * 2 * Force.Frequency);
    } else if (Force.Duration === "Impulse") {
      const C = (((TimeSec + T) * Force.Frequency) % 1.0 + 1.0) % 1.0;
      G = Math.exp(-C * 4.0) * Math.sin(Math.min(1.0, C * 5.0) * Math.PI * 0.5);
    }
    const X = PadX + (I / 48) * PlotW;
    const Y = PadY + (1 - Math.max(0, Math.min(1, G))) * PlotH;
    Pts.push(`${X.toFixed(1)},${Y.toFixed(1)}`);
  }
  const Color = Force.Duration === "Impulse" ? "#FF8A5B" : Force.Duration === "Modulated" ? "#E8B85B" : "#3AD69C";
  return `
    <svg viewBox="0 0 ${W} ${H}" class="curve-svg" aria-label="Temporal gate waveform">
      <line x1="${PadX}" y1="${PadY + PlotH}" x2="${PadX + PlotW}" y2="${PadY + PlotH}" stroke="#2f3238" stroke-width="1"/>
      <polyline points="${Pts.join(" ")}" fill="none" stroke="${Color}" stroke-width="1.8" stroke-linecap="round"/>
      <text x="${PadX}" y="${H - 1}">t + 0s</text>
      <text x="${PadX + PlotW - 34}" y="${H - 1}">t + 3.0s</text>
    </svg>
  `;
}

export function RenderInspectorHtml(State) {
  const SelectedId = State.SelectedId;
  const ForceNode = State.ForceNodes.find((N) => N.Id === SelectedId);

  if (ForceNode) {
    return RenderForceNodeInspector(ForceNode, State);
  }
  if (SelectedId === "flow_viz" || SelectedId === "flow_particles") {
    return RenderFlowVizInspector(State);
  }
  if (SelectedId === "probe_cursor") {
    return RenderProbeInspector(State);
  }
  if (SelectedId === "editor_camera") {
    return RenderCameraInspector(State);
  }
  return RenderFolderInspector(SelectedId, State);
}

function RenderForceNodeInspector(Node, State) {
  const F = ResolveForceValues(Node.Force);
  const Meta = GetForceModelMeta(F.Model);
  const Dom = ForceDomains[Meta.Domain] || ForceDomains.VectorField;
  const Pos = Node.Position || [0, 0, 0.9];
  const Tel = EvaluateSceneCompositeTelemetry(State.ForceNodes, Pos[0], Pos[1], Pos[2], State.TimeSec, 0.08);
  const LocalSelf = EvaluateSceneCompositeTelemetry([Node], Pos[0], Pos[1], Pos[2], State.TimeSec, 0.08);
  const FormulaProg = F.FormulaEnabled ? GetCompiledForceFormula(F.FormulaCode) : null;

  const DomainOrder = ["VectorField", "FlowField", "TurbulenceField"];
  const ModelOptionsHtml = DomainOrder.map((DomKey) => {
    const GroupModels = FORCE_MODELS.filter((M) => M.Domain === DomKey);
    return `<optgroup label="${Esc(DomKey)}">${GroupModels.map(
      (M) => `<option value="${Esc(M.Id)}" ${M.Id === F.Model ? "selected" : ""}>${Esc(M.Name)} (${Esc(M.Channel)})</option>`,
    ).join("")}</optgroup>`;
  }).join("");

  return `
    <div class="specialized-inspector">
      <div class="inspector-header-block">
        <div class="breadcrumbs">Inspector / ${Esc(Meta.Domain)} / ${Esc(Meta.Name)}</div>
        <div class="inspector-title-row">
          <div class="inspector-title-copy">
            <input type="text" class="inspector-name-input" data-force-name value="${Esc(Node.Name)}" maxlength="48" aria-label="Force generator name" />
            <small>${Esc(Meta.Channel)} · ${Esc(Meta.Unit)}</small>
          </div>
          <button type="button" class="pill-btn" data-action="reset-force" title="Reset parameters to defaults">${SvgGlyph("reset", 12)} Reset</button>
        </div>
      </div>

      <!-- Hero Banner -->
      <div class="force-hero-banner" style="--domain-color:${Meta.Color}">
        <div class="force-hero-top">
          <div class="force-hero-icon">${ForceModelIconHtml(F.Model, 22)}</div>
          <div class="force-hero-meta">
            <span class="domain-chip" style="color:${Meta.Color};border-color:${Meta.Color}44;background:${Meta.Color}18">${Esc(Dom.Label)}</span>
            <strong>${Esc(Meta.Name)}</strong>
            <p>${Esc(Meta.Summary)}</p>
          </div>
        </div>
        <div class="force-equation-bar"><code>${Esc(Meta.Equation)}</code></div>
        <div class="force-quick-actions">
          <button type="button" class="pill-btn ${F.Enabled ? "active-green" : ""}" data-action="toggle-power" title="Enable / Mute generator">
            ${SvgGlyph("power", 12)} ${F.Enabled ? "Enabled" : "Muted"}
          </button>
          <button type="button" class="pill-btn ${F.Solo ? "active-amber" : ""}" data-action="toggle-solo" title="Solo this force generator">
            ${SvgGlyph("zap", 12)} ${F.Solo ? "Soloing" : "Solo"}
          </button>
          <button type="button" class="pill-btn" data-action="duplicate-force" title="Duplicate generator (Ctrl+D)">
            ${SvgGlyph("copy", 12)} Clone
          </button>
          <button type="button" class="pill-btn danger" data-action="delete-force" title="Remove generator (Delete)">
            ${SvgGlyph("trash", 12)}
          </button>
        </div>
        ${
          F.Duration === "Impulse"
            ? `<button type="button" class="impulse-trigger-btn" data-action="trigger-impulse">${SvgGlyph("zap", 14)} Trigger Shockwave Impulse</button>`
            : ""
        }
      </div>

      <!-- 2x2 Telemetry Readout Tiles -->
      <div class="tiles">
        <div class="metric-tile">
          <small>COMPOSITE SPEED</small>
          <div class="metric">${Tel.Speed.toFixed(1)}<small>m/s</small></div>
          <span class="tile-sub">Beaufort ${Tel.Beaufort.Number} · ${Esc(Tel.Beaufort.Label)}</span>
        </div>
        <div class="metric-tile">
          <small>LOCAL CURL |∇×F|</small>
          <div class="metric">${Tel.CurlMag.toFixed(1)}<small>/s</small></div>
          <span class="tile-sub">Peak Self ${LocalSelf.Speed.toFixed(1)} ${Esc(Meta.Unit)}</span>
        </div>
        <div class="metric-tile">
          <small>DIVERGENCE ∇·F</small>
          <div class="metric">${Tel.Divergence >= 0 ? "+" : ""}${Tel.Divergence.toFixed(1)}<small>/s</small></div>
          <span class="tile-sub">${Math.abs(Tel.Divergence) < 0.3 ? "Solenoidal" : Tel.Divergence > 0 ? "Source Outflow" : "Sink Inflow"}</span>
        </div>
        <div class="metric-tile">
          <small>DYNAMIC PRESSURE</small>
          <div class="metric">${Tel.DynamicPressurePa.toFixed(0)}<small>Pa</small></div>
          <span class="tile-sub">Bearing ${Tel.Compass} ${Math.round(Tel.BearingDeg)}°</span>
        </div>
      </div>

      <!-- Generator Law & Transform Card -->
      <section class="property-card">
        <h3>Force Generator &amp; Transform</h3>
        <label class="field">
          <span>Force Law</span>
          <select data-bind-select="Model" aria-label="Force Law">${ModelOptionsHtml}</select>
        </label>
        <div class="field">
          <span>Position (X, Y, Z m)</span>
          <div class="axes">
            <label><b>X</b><input type="number" step="0.05" data-pos-axis="0" value="${Number(Pos[0]).toFixed(2)}" /></label>
            <label><b>Y</b><input type="number" step="0.05" data-pos-axis="1" value="${Number(Pos[1]).toFixed(2)}" /></label>
            <label><b>Z</b><input type="number" step="0.05" data-pos-axis="2" value="${Number(Pos[2]).toFixed(2)}" /></label>
          </div>
        </div>
        ${RenderSliderRow("YawDeg", "Azimuth Yaw", F.YawDeg, -180, 180, 1, "°", 0)}
        ${RenderSliderRow("PitchDeg", "Elevation Pitch", F.PitchDeg, -85, 85, 1, "°", 0)}
      </section>

      <!-- Physics Parameters Card -->
      <section class="property-card">
        <h3>Field Parameters</h3>
        ${RenderSliderRow("Strength", "Strength", F.Strength, -40, 45, 0.25, Meta.Unit, 2)}
        ${RenderSliderRow("Radius", "Influence Radius", F.Radius, 0.4, 6.0, 0.05, "m", 2)}
        ${RenderSliderRow("CoreRadius", "Core Softening", F.CoreRadius, 0.1, Math.max(0.5, F.Radius * 0.9), 0.02, "m", 2)}
        ${RenderSliderRow("SwirlRatio", "Swirl / Spin Ratio", F.SwirlRatio, -2.5, 2.5, 0.05, "×", 2)}
        ${
          ["CurlNoise", "AtmosphericGust", "VorticityConfinement", "BrownianNoise"].includes(F.Model)
            ? RenderSliderRow("TurbulenceScale", "Eddy Wavelength", F.TurbulenceScale, 0.3, 3.5, 0.05, "m", 2) +
              RenderSliderRow("Octaves", "Noise Octaves", F.Octaves, 1, 5, 1, "", 0)
            : ""
        }
      </section>

      <!-- Spatial Envelope & Temporal Gate Card -->
      <section class="property-card">
        <h3>Envelope &amp; Temporal Gate</h3>
        <div class="field">
          <span>Reach Volume</span>
          <div class="segmented-row">
            ${ReachEnvelopes.map(
              (R) => `<button type="button" class="${F.Reach === R ? "active" : ""}" data-bind-enum="Reach" data-enum-val="${R}">${R}</button>`,
            ).join("")}
          </div>
        </div>
        <div class="field">
          <span>Attenuation Curve</span>
          <div class="segmented-row">
            ${AttenuationCurves.map(
              (A) => `<button type="button" class="${F.Attenuation === A ? "active" : ""}" data-bind-enum="Attenuation" data-enum-val="${A}">${A === "InverseSquare" ? "1/r²" : A}</button>`,
            ).join("")}
          </div>
        </div>
        ${F.Attenuation === "Linear" ? RenderSliderRow("FalloffExponent", "Falloff Exponent", F.FalloffExponent, 0.35, 3.0, 0.05, "", 2) : ""}
        <div class="curve-box">${BuildAttenuationCurveSvg(F)}</div>

        <div class="field" style="margin-top:16px">
          <span>Duration Mode</span>
          <div class="segmented-row">
            ${DurationModes.map(
              (D) => `<button type="button" class="${F.Duration === D ? "active" : ""}" data-bind-enum="Duration" data-enum-val="${D}">${D}</button>`,
            ).join("")}
          </div>
        </div>
        ${
          F.Duration !== "Continuous"
            ? RenderSliderRow("Frequency", "Pulse Frequency", F.Frequency, 0.05, 2.5, 0.05, "Hz", 2)
            : ""
        }
        ${
          F.Duration === "Impulse"
            ? RenderSliderRow("WaveSpeed", "Shockwave Speed", F.WaveSpeed, 0.8, 12.0, 0.1, "m/s", 1)
            : ""
        }
        <div class="curve-box">${BuildDurationWaveformSvg(F, State.TimeSec)}</div>
      </section>

      <!-- Motion Path Card -->
      <section class="property-card">
        <h3>Generator Motion Path</h3>
        <label class="field">
          <span>Motion Topology</span>
          <select data-bind-select="MotionTopology">
            ${MotionTopologies.map((M) => `<option value="${M}" ${F.MotionTopology === M ? "selected" : ""}>${M}</option>`).join("")}
          </select>
        </label>
        ${
          F.MotionTopology !== "Static"
            ? `
            <div class="field">
              <span>Loop Mode</span>
              <div class="segmented-row">
                ${MotionLoopModes.map(
                  (L) => `<button type="button" class="${F.MotionLoopMode === L ? "active" : ""}" data-bind-enum="MotionLoopMode" data-enum-val="${L}">${L}</button>`,
                ).join("")}
              </div>
            </div>
            ${RenderSliderRow("MotionSpeed", "Travel Speed", F.MotionSpeed, 0.05, 3.0, 0.05, "m/s", 2)}
            ${
              F.MotionTopology === "CircularOrbit" || F.MotionTopology === "Figure8"
                ? RenderSliderRow("MotionOrbitRadius", "Orbit Radius", F.MotionOrbitRadius, 0.2, 3.5, 0.05, "m", 2)
                : ""
            }
          `
            : ""
        }
      </section>

      <!-- VectorFieldLang Programmable Formula Card -->
      <section class="property-card">
        <h3>VectorFieldLang Formula</h3>
        ${RenderToggleRow("FormulaEnabled", "Override with Symbolic Formula", F.FormulaEnabled, "Evaluates custom math expression in real time")}
        <div class="formula-presets">
          ${FORMULA_PRESETS.map(
            (P, Idx) => `<button type="button" class="chip-btn" data-formula-preset="${Idx}">${Esc(P.Name)}</button>`,
          ).join("")}
        </div>
        <textarea class="formula-editor" data-formula-code rows="4" spellcheck="false" aria-label="VectorFieldLang code">${Esc(F.FormulaCode)}</textarea>
        <div class="formula-diag ${FormulaProg && !FormulaProg.Ok ? "err" : "ok"}">
          ${
            !F.FormulaEnabled
              ? "Formula override inactive — running analytical law."
              : FormulaProg?.Ok
                ? `✓ Compiled (${FormulaProg.OutputChannel} channel) · Active in viewport`
                : `✗ ${Esc(FormulaProg?.Diagnostics?.[0]?.Message || "Syntax error")}`
          }
        </div>
      </section>

      <!-- Live Anemometer & TOML Card -->
      <section class="property-card">
        <h3>Live Wind Anemometer (60s Trace)</h3>
        <canvas id="anemometer-canvas" width="280" height="84" class="anemometer-canvas"></canvas>
        <div class="toml-actions">
          <button type="button" class="pill-btn" data-action="export-force-toml">${SvgGlyph("download", 12)} Export .ForceModel</button>
          <button type="button" class="pill-btn" data-action="export-scene-toml">${SvgGlyph("code", 12)} Scene TOML</button>
        </div>
      </section>
    </div>
  `;
}

function RenderFlowVizInspector(State) {
  const V = State.FlowViz;
  const Grad = COLORMAP_CSS_GRADIENTS[V.Colormap] || COLORMAP_CSS_GRADIENTS.Engineering;
  return `
    <div class="specialized-inspector">
      <div class="inspector-header-block">
        <div class="breadcrumbs">Inspector / Visualization / Flow Field</div>
        <div class="inspector-title-row">
          <div class="inspector-title-copy">
            <h2 style="font-size:24px;font-weight:300;">Flow Visualization</h2>
            <small>Particles · RK4 Streamlines · Vector Lattice · Heatmap</small>
          </div>
          <button type="button" class="pill-btn" data-action="reset-flow-viz">${SvgGlyph("reset", 12)} Reset</button>
        </div>
      </div>

      <section class="property-card">
        <h3>Flow Tracer Particles (RK2 Advection)</h3>
        ${RenderToggleRow("viz:ShowFlowParticles", "Show Advected Flow Particles", V.ShowFlowParticles, "Glowing Lagrangian tracers + velocity ribbon trails")}
        ${RenderSliderRow("viz:ParticleCount", "Particle Count", V.ParticleCount, 100, 3600, 50, "", 0)}
        ${RenderSliderRow("viz:ParticleSpeedScale", "Advection Gain", V.ParticleSpeedScale, 0.05, 0.75, 0.01, "×", 2)}
        ${RenderSliderRow("viz:ParticleTrailLength", "Ribbon Trail Length", V.ParticleTrailLength, 3, 18, 1, "pts", 0)}
        ${RenderSliderRow("viz:ParticleSize", "Particle Size", V.ParticleSize, 0.4, 2.2, 0.05, "×", 2)}
        <label class="field">
          <span>Seed Distribution</span>
          <select data-viz-select="ParticleSeedMode">
            ${ParticleSeedModes.map((M) => `<option value="${M}" ${V.ParticleSeedMode === M ? "selected" : ""}>${M}</option>`).join("")}
          </select>
        </label>
        <button type="button" class="pill-btn" data-action="respawn-particles" style="width:100%;margin-top:8px;">${SvgGlyph("reset", 12)} Respawn Flow Particles</button>
      </section>

      <section class="property-card">
        <h3>RK4 Streamline Ribbons</h3>
        ${RenderToggleRow("viz:ShowStreamlines", "Show 3D Streamlines", V.ShowStreamlines)}
        ${RenderSliderRow("viz:StreamLineCount", "Streamline Seeds", V.StreamLineCount, 20, 200, 4, "", 0)}
        ${RenderSliderRow("viz:StreamResolution", "Integration Steps", V.StreamResolution, 12, 60, 2, "", 0)}
        ${RenderSliderRow("viz:StreamThickness", "Ribbon Thickness", V.StreamThickness, 0.3, 2.0, 0.05, "×", 2)}
        <label class="field">
          <span>Streamline Colouring</span>
          <select data-viz-select="StreamColorMode">
            ${StreamColorModes.map((M) => `<option value="${M}" ${V.StreamColorMode === M ? "selected" : ""}>${M}</option>`).join("")}
          </select>
        </label>
      </section>

      <section class="property-card">
        <h3>3D Vector Lattice &amp; Reach Envelopes</h3>
        ${RenderToggleRow("viz:ShowVelocityArrows", "Show 3D Vector Arrows", V.ShowVelocityArrows)}
        ${RenderSliderRow("viz:ArrowDensity", "Grid Density", V.ArrowDensity, 1, 7, 1, "", 0)}
        ${RenderSliderRow("viz:VolumeLayers", "Vertical Volume Layers", V.VolumeLayers, 1, 3, 1, "", 0)}
        ${RenderSliderRow("viz:VectorScale", "Arrow Scale", V.VectorScale, 0.1, 0.8, 0.02, "×", 2)}
        ${RenderToggleRow("viz:ShowEnvelopes", "Show Force Reach Volumes", V.ShowEnvelopes)}
        ${RenderToggleRow("viz:ShowMotionPaths", "Show Motion Trajectories", V.ShowMotionPaths)}
      </section>

      <section class="property-card">
        <h3>Cross-Section Field Heatmap</h3>
        ${RenderToggleRow("viz:ShowHeatmap", "Show Heatmap Slice", V.ShowHeatmap)}
        <div class="field">
          <span>Slice Plane</span>
          <div class="segmented-row">
            ${["XY", "XZ", "YZ", "ALL"].map(
              (Ax) => `<button type="button" class="${V.SliceAxis === Ax ? "active" : ""}" data-viz-enum="SliceAxis" data-enum-val="${Ax}">${Ax}</button>`,
            ).join("")}
          </div>
        </div>
        ${RenderSliderRow("viz:SliceOffset", "Slice Offset", V.SliceOffset, -2.5, 2.5, 0.05, "m", 2)}
        ${RenderSliderRow("viz:HeatmapOpacity", "Slice Opacity", V.HeatmapOpacity, 0.1, 0.95, 0.02, "", 2)}
        ${RenderSliderRow("viz:FixedMax", "Scale Ceiling", V.FixedMax, 4, 50, 1, "m/s", 0)}
        <label class="field">
          <span>Evaluated Quantity</span>
          <select data-viz-select="Quantity">
            ${EvaluatedQuantities.map((Q) => `<option value="${Q}" ${V.Quantity === Q ? "selected" : ""}>${Q}</option>`).join("")}
          </select>
        </label>
        <label class="field">
          <span>Colormap</span>
          <select data-viz-select="Colormap">
            ${FieldColormaps.map((C) => `<option value="${C}" ${V.Colormap === C ? "selected" : ""}>${C}</option>`).join("")}
          </select>
        </label>
        <div class="colormap-bar" style="background:${Grad}"></div>
      </section>
    </div>
  `;
}

function RenderProbeInspector(State) {
  const P = State.FlowViz.ProbePosition || [0.45, 0.25, 0.85];
  const Tel = EvaluateSceneCompositeTelemetry(State.ForceNodes, P[0], P[1], P[2], State.TimeSec, 0.08);
  return `
    <div class="specialized-inspector">
      <div class="inspector-header-block">
        <div class="breadcrumbs">Inspector / Diagnostics / Point Sample Probe</div>
        <h2 style="font-size:24px;font-weight:300;">3D Flow Sample Probe</h2>
        <small>Hold Shift + Click in the 3D Viewport to reposition probe</small>
      </div>
      <div class="tiles" style="margin-top:14px">
        <div class="metric-tile">
          <small>FLOW SPEED</small>
          <div class="metric">${Tel.Speed.toFixed(2)}<small>m/s</small></div>
          <span class="tile-sub">Beaufort ${Tel.Beaufort.Number} · ${Esc(Tel.Beaufort.Label)}</span>
        </div>
        <div class="metric-tile">
          <small>VORTICITY |∇×F|</small>
          <div class="metric">${Tel.CurlMag.toFixed(2)}<small>/s</small></div>
          <span class="tile-sub">Rotational shear</span>
        </div>
        <div class="metric-tile">
          <small>DIVERGENCE ∇·F</small>
          <div class="metric">${Tel.Divergence >= 0 ? "+" : ""}${Tel.Divergence.toFixed(2)}<small>/s</small></div>
          <span class="tile-sub">Net source / sink</span>
        </div>
        <div class="metric-tile">
          <small>DYNAMIC PRESSURE</small>
          <div class="metric">${Tel.DynamicPressurePa.toFixed(1)}<small>Pa</small></div>
          <span class="tile-sub">${Tel.Compass} (${Math.round(Tel.BearingDeg)}°)</span>
        </div>
      </div>
      <section class="property-card">
        <h3>Probe Coordinates (m)</h3>
        ${RenderSliderRow("probe:0", "Probe X", P[0], -5, 5, 0.05, "m", 2)}
        ${RenderSliderRow("probe:1", "Probe Y", P[1], -5, 5, 0.05, "m", 2)}
        ${RenderSliderRow("probe:2", "Probe Z", P[2], 0.05, 4, 0.05, "m", 2)}
        <div class="readout"><span>Vector (Vx, Vy, Vz)</span><output>${Tel.Velocity.map((N) => N.toFixed(2)).join(", ")} m/s</output></div>
      </section>
    </div>
  `;
}

function RenderCameraInspector(State) {
  const Cam = State.CameraState;
  return `
    <div class="specialized-inspector">
      <div class="inspector-header-block">
        <div class="breadcrumbs">Inspector / Cameras / Editor Camera</div>
        <div class="inspector-title-row">
          <div>
            <h2 style="font-size:24px;font-weight:300;">Editor Camera</h2>
            <small>Right-Handed +Z Up · Orbit / Pan / WASD Fly</small>
          </div>
          <button type="button" class="pill-btn" data-action="reset-camera">${SvgGlyph("reset", 12)} Reset</button>
        </div>
      </div>
      <section class="property-card" style="margin-top:16px">
        <h3>Optics &amp; Framing</h3>
        ${RenderSliderRow("cam:FovDeg", "Vertical FOV", Cam.FovDeg, 20, 90, 1, "°", 0)}
        ${RenderSliderRow("cam:Distance", "Orbit Distance", Cam.Distance, 1.8, 30, 0.1, "m", 1)}
        ${RenderSliderRow("cam:YawDeg", "Azimuth Yaw", Cam.YawDeg, -180, 180, 1, "°", 0)}
        ${RenderSliderRow("cam:PitchDeg", "Elevation Pitch", Cam.PitchDeg, -80, 82, 1, "°", 0)}
      </section>
    </div>
  `;
}

function RenderFolderInspector(SelectedId, State) {
  const ActiveForces = State.ForceNodes.filter((N) => !N.Hidden && N.Force?.Enabled !== false);
  return `
    <div class="specialized-inspector">
      <div class="inspector-header-block">
        <div class="breadcrumbs">Inspector / Collection</div>
        <h2 style="font-size:24px;font-weight:300;">${SelectedId === "cameras" ? "Cameras" : SelectedId === "visualization" ? "Flow Visualization" : "Force Generators"}</h2>
        <small>${State.ForceNodes.length} generators in scene · ${ActiveForces.length} active</small>
      </div>
      <section class="property-card" style="margin-top:16px">
        <h3>Active Force Generators</h3>
        ${State.ForceNodes.map((N) => {
          const Meta = GetForceModelMeta(N.Force?.Model);
          return `
            <div class="folder-entry-row" data-select-row="${Esc(N.Id)}">
              ${ForceModelIconHtml(N.Force?.Model, 15)}
              <span>${Esc(N.Name)}</span>
              <small>${Esc(Meta.Name)} · ${(N.Force?.Strength ?? 0).toFixed(1)} ${Esc(Meta.Unit)}</small>
            </div>
          `;
        }).join("")}
        <button type="button" class="pill-btn primary" data-action="open-construct" style="width:100%;margin-top:12px;">
          ${SvgGlyph("plus", 13)} Add Force Generator (Ctrl+A)
        </button>
      </section>
    </div>
  `;
}
