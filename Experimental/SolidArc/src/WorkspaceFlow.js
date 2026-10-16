import {OrientationCube} from "./OrientationSequence.js";
import {GridView} from "./GridSequence.js";
import { ConstructionCatalogue } from "./ConstructionSpecification.js";
import {
  DrawingTools,
  CatalogueTools,
  WorldPoint,
  PreviewDrawing,
  DrawingCommand,
  Transform,
} from "./DrawingSequence.js";
import "./WorkspaceFlow.css";
const $ = (S) => document.querySelector(S);
const SavedKey = "solidarc.native.doc.v1",
  PreviousKey = "solidarc.native.previous.v1";
const XY = { origin: [0, 0, 0], x: [1, 0, 0], y: [0, 1, 0] };
const Read = (Key) => {
  try {
    const V = JSON.parse(localStorage.getItem(Key));
    if (
      V?.version !== 1 ||
      typeof V.text !== "string" ||
      V.text.length > 8 * 1024 * 1024 ||
      typeof V.name !== "string" ||
      !Number.isInteger(V.figures) ||
      V.figures < 0
    )
      return null;
    if (
      V.camera &&
      (!Array.isArray(V.camera.pivot) ||
        V.camera.pivot.length !== 3 ||
        ![
          V.camera.yaw,
          V.camera.pitch,
          V.camera.distance,
          ...V.camera.pivot,
        ].every(Number.isFinite) ||
        V.camera.distance <= 0)
    )
      delete V.camera;
    return V;
  } catch {
    return null;
  }
};
export class WorkspaceFlow {
  constructor(App) {
    this.App = App;
    $("#viewport").insertAdjacentHTML(
      "beforeend",
      `<div id="drawing-labels" aria-hidden="true"></div><section id="draw-prompt" hidden><strong id="draw-title"></strong><span id="draw-step" role="status"></span><label id="draw-circle-label" hidden>Defined by<select id="draw-circle-mode"><option value="circle">Centre / radius</option><option value="circle2">Diameter</option></select></label><label id="draw-radius-label" hidden>End radius (m)<input id="draw-radius" type="number" min="0.001" max="10000" step="0.01" value="0.25"></label><label id="draw-sides-label" hidden>Sides<input id="draw-sides" type="number" min="3" max="64" step="1" value="6"></label><label id="draw-close-label" hidden><input id="draw-close" type="checkbox">Closed</label><label><input id="draw-construction" type="checkbox">Construction</label><button id="draw-finish" class="button">Finish</button><button id="draw-cancel" class="button">Cancel · Esc</button></section>`,
    );
    $("#construct-menu footer").textContent =
      "Choose a sketch tool, then click in the viewport to locate and draw it.";
    document.body.insertAdjacentHTML(
      "beforeend",
      `<dialog id="recovery-dialog"><div class="dialog-heading"><h2>Welcome back</h2></div><p id="recovery-info"></p><p>Your native drawing is saved in this browser. Starting fresh keeps a previous copy recoverable.</p><div class="dialog-actions"><button class="button" id="recovery-continue">Continue previous</button><button class="button" id="recovery-new">New document</button><button class="button" id="recovery-open">Open .arc</button></div></dialog><dialog id="native-placement-dialog"><h2>Native construction</h2><p>Edit the position and dimensions before applying. Units: metres.</p><form id="native-placement-form"><textarea id="native-placement-command" aria-label="Native construction command" rows="5" style="width:100%"></textarea><div class="dialog-actions"><button class="button" type="submit">Apply</button><button class="button" type="button" id="native-placement-cancel">Cancel</button></div></form></dialog><dialog id="workplane-dialog"><h2>Workplane</h2><p>Choose the plane on which to locate and draw profiles. Units: metres.</p><form id="workplane-form"><label>Base<select id="workplane-base"><option>XY</option><option>XZ</option><option>YZ</option></select></label><label>Offset<input id="workplane-offset" type="number" step="any" min="-10000" max="10000" value="0"></label><div class="dialog-actions"><button class="button" type="submit">Use workplane</button><button class="button" type="button" id="workplane-cancel">Cancel</button></div></form></dialog>`,
    );
    $("#construct-menu .construct-catalogue").insertAdjacentHTML(
      "beforeend",
      '<button id="recover-previous" class="button" type="button">Restore previous document</button>',
    );
    $("#recover-previous").onclick = () => this.Restore(Read(PreviousKey));
    $("#recovery-continue").onclick = () => this.Restore(Read(SavedKey));
    $("#recovery-new").onclick = () => {
      this.Backup();
      $("#recovery-dialog").close();
    };
    $("#recovery-open").onclick = () => {
      $("#recovery-dialog").close();
      $("#open-file").click();
    };
    $("#recovery-dialog").addEventListener("cancel", (E) => E.preventDefault());
    $("#native-placement-cancel").onclick = () =>
      $("#native-placement-dialog").close();
    $("#native-placement-form").onsubmit = async (E) => {
      E.preventDefault();
      try {
        const R = await App.Command($("#native-placement-command").value);
        if (R?.success) $("#native-placement-dialog").close();
      } catch (ErrorValue) {
        App.Notify(ErrorValue.message);
      }
    };
    $("#workplane-cancel").onclick = () => $("#workplane-dialog").close();
    $("#workplane-form").onsubmit = async (E) => {
      E.preventDefault();
      const Base = $("#workplane-base").value,
        Offset = Number($("#workplane-offset").value);
      if (!Number.isFinite(Offset) || Math.abs(Offset) > 10000) return;
      const Origin =
        Base === "XY"
          ? [0, 0, Offset]
          : Base === "XZ"
            ? [0, Offset, 0]
            : [Offset, 0, 0];
      try {
        const R = await App.Command(
          `workplane ${Base.toLowerCase()} --origin=(${Origin.join(",")})`,
        );
        if (R?.success) $("#workplane-dialog").close();
      } catch (ErrorValue) {
        App.Notify(ErrorValue.message);
      }
    };
    const Present = App.Present.bind(App);
    this.Present = Present;
    App.Present = (Response) => {
      this.Base = Response.frame ? {...Response,frame:{...Response.frame,
        view:GridView(Response.frame.view,App.Description.workplane||XY)}} : Response;
      this.Paint();
    };
    const Command = App.Command.bind(App);
    App.Command = async (Text, Dirty = true) => {
      const R = await Command(Text, Dirty);
      if (Dirty && R?.success) this.ScheduleSave();
      return R;
    };
    const Receive = App.Receive.bind(App);
    App.Receive = (R) => {
      Receive(R);
      if (R.dirty) this.ScheduleSave();
    };
    const Create = App.CreateDocument.bind(App);
    App.CreateDocument = async (...Args) => {
      this.Cancel();
      if (App.Busy) await App.CurrentRequest;
      if (App.Documents.length) {
        await this.SaveNow();
      }
      const Before = App.Active;
      await Create(...Args);
      if (Before && Before !== App.Active) this.Backup();
      if (!this.Started && App.Document) {
        this.Started = true;
        const Saved = Read(SavedKey);
        if (Saved?.figures) {
          $("#recovery-info").textContent =
            `${Saved.name} · ${Saved.figures} figures · ${new Date(Saved.saved).toLocaleString()}`;
          $("#recovery-dialog").showModal();
        }
      }
    };
    for (const Method of ["ActivateDocument", "CloseDocument"]) {
      const Original = App[Method].bind(App);
      App[Method] = async (...Args) => {
        this.Cancel();
        await this.SaveNow();
        return Original(...Args);
      };
    }
    const OpenTool = App.OpenTool.bind(App);
    App.OpenTool = (Key) =>
      DrawingTools[Key]
        ? this.Start(Key)
        : Key === "plane"
          ? this.Workplane()
          : OpenTool(Key);
    $("#draw-circle-mode").onchange = () => {
      if (!this.Drawing) return;
      this.Drawing.tool = $("#draw-circle-mode").value;
      this.Prompt();
      this.Paint();
    };
    $("#draw-cancel").onclick = () => this.Cancel();
    $("#draw-finish").onclick = () => this.Finish();
    for (const Id of [
      "draw-radius",
      "draw-sides",
      "draw-close",
      "draw-construction",
    ])
      $("#" + Id).oninput = () => {
        if (!this.Drawing) return;
        this.Drawing.radius = Math.max(
          0.001,
          Math.min(10000, Number($("#draw-radius").value) || 0.001),
        );
        this.Drawing.sides = Math.max(
          3,
          Math.min(64, Math.round(Number($("#draw-sides").value) || 3)),
        );
        this.Drawing.closed = $("#draw-close").checked;
        this.Drawing.construction = $("#draw-construction").checked;
        this.Paint();
      };
    const Canvas = $("#cad-canvas");
    const Coordinates = (E) => {
      const R = Canvas.getBoundingClientRect();
      return [(E.clientX - R.left) / R.width, (E.clientY - R.top) / R.height];
    };
    Canvas.addEventListener(
      "pointerdown",
      (E) => {
        if (!this.Drawing || E.altKey || E.button === 1) return;
        E.preventDefault();
        E.stopImmediatePropagation();
        Canvas.focus({ preventScroll: true });
        if (E.button === 2) {
          this.Drawing.points.length >= 2 ? this.Finish() : this.Cancel();
          return;
        }
        if (E.button !== 0 || App.Busy || App.ViewDrag) return;
        const P = this.Point(...Coordinates(E));
        if (!P) {
          App.Notify(
            "Workplane is edge-on or behind the camera. Choose a suitable view.",
          );
          return;
        }
        const Points = this.Drawing.points;
        if (this.Drawing.tool === "polygon" && Points.length === 2) {
          this.Finish();
          return;
        }
        if (
          Points.length &&
          Math.hypot(P[0] - Points.at(-1)[0], P[1] - Points.at(-1)[1]) < 1e-7
        )
          return;
        Points.push(P);
        this.Drawing.cursor = P;
        if (Points.length === DrawingTools[this.Drawing.tool].count)
          this.Finish();
        else {
          this.Prompt();
          this.Paint();
        }
      },
      true,
    );
    Canvas.addEventListener(
      "pointermove",
      (E) => {
        if (!this.Drawing || App.ViewDrag || E.altKey) return;
        E.stopImmediatePropagation();
        this.Drawing.cursor = this.Point(...Coordinates(E));
        if (!this.Frame)
          this.Frame = requestAnimationFrame(() => {
            this.Frame = 0;
            this.Paint();
          });
      },
      true,
    );
    Canvas.addEventListener(
      "wheel",
      (E) => {
        if (this.Drawing?.tool !== "polygon") return;
        E.preventDefault();
        E.stopImmediatePropagation();
        this.Drawing.sides = Math.max(
          3,
          Math.min(64, this.Drawing.sides + (E.deltaY < 0 ? 1 : -1)),
        );
        $("#draw-sides").value = this.Drawing.sides;
        this.Paint();
      },
      { capture: true, passive: false },
    );
    document.addEventListener(
      "keydown",
      (E) => {
        if (
          E.target.closest("input,select,textarea") ||
          E.ctrlKey ||
          E.metaKey ||
          E.altKey
        )
          return;
        if (!this.Drawing) {
          if (
            document.querySelector("dialog[open], #construct-menu:popover-open")
          )
            return;
          const Tool = E.shiftKey
            ? { l: "polyline", e: "ellipse" }[E.key.toLowerCase()]
            : { l: "line", r: "rect", c: "circle", a: "arc", p: "polygon" }[
                E.key.toLowerCase()
              ];
          if (Tool) {
            E.preventDefault();
            E.stopImmediatePropagation();
            this.Start(Tool);
          }
          return;
        }
        if (!["Escape", "Enter", "Backspace"].includes(E.key)) return;
        E.preventDefault();
        E.stopImmediatePropagation();
        if (E.key === "Escape") this.Cancel();
        else if (E.key === "Enter") this.Finish();
        else {
          this.Drawing.points.pop();
          this.Prompt();
          this.Paint();
        }
      },
      true,
    );
    // Right-click opens the catalogue only when it was not a navigation drag.
    Canvas.addEventListener(
      "pointerdown",
      (E) => {
        if (E.button === 2 && !this.Drawing)
          this.Right = [E.clientX, E.clientY];
      },
      true,
    );
    Canvas.addEventListener(
      "pointerup",
      (E) => {
        if (E.button === 2 && this.Right) {
          const P = this.Right;
          this.Right = null;
          if (Math.hypot(E.clientX - P[0], E.clientY - P[1]) < 4)
            setTimeout(() => {
              if (!this.Drawing) App.ToggleConstruct();
            }, 0);
        }
      },
      true,
    );
  }
  Workplane() {
    this.Cancel();
    $("#workplane-dialog").showModal();
  }
  async Start(Tool) {
    if (!(await this.App.AwaitNavigation())) return;
    this.Cancel();
    this.Drawing = {
      tool: Tool,
      points: [],
      cursor: null,
      sides: 6,
      radius: 0.25,
      closed: false,
      construction: false,
      identity: this.App.Active,
    };
    $("#draw-radius").value = 0.25;
    $("#draw-sides").value = 6;
    $("#draw-close").checked = false;
    $("#draw-construction").checked = false;
    $("#draw-circle-label").hidden = !["circle", "circle2"].includes(Tool);
    $("#draw-circle-mode").value = Tool === "circle2" ? "circle2" : "circle";
    $("#draw-radius-label").hidden = !["slot","pslot"].includes(Tool);
    $("#draw-sides-label").hidden = Tool !== "polygon";
    $("#draw-close-label").hidden = Tool !== "polyline";
    $("#draw-finish").hidden = !DrawingTools[Tool].multi && Tool !== "polygon";
    $("#draw-prompt").hidden = false;
    this.Prompt();
    $("#cad-canvas").focus({ preventScroll: true });
  }
  Prompt() {
    if (!this.Drawing) return;
    const D = this.Drawing,
      T = DrawingTools[D.tool];
    $("#draw-title").textContent = T.label;
    $("#draw-step").textContent =
      T.prompts[Math.min(D.points.length, T.prompts.length - 1)];
    $("#cad-canvas").style.cursor = "crosshair";
  }
  Point(U, V) {
    return this.Base
      ? WorldPoint(
          this.Base.frame.view,
          U,
          V,
          this.App.Description.workplane || XY,
        )
      : null;
  }
  Paint() {
    if (!this.Base) return;
    const D = this.Drawing,
      Frame = this.Base.frame,
      Plane = this.App.Description.workplane || XY;
    const Preview = D ? PreviewDrawing(D, Frame.view, Plane) : null;
    const Canvas = $("#cad-canvas"), Cube = OrientationCube(Frame.view, Canvas.clientWidth, Canvas.clientHeight);
    this.Present({...this.Base, frame:{...Frame,localNavigation:true,
      draws:[...Frame.draws,...(Preview ? [Preview.command,...(Preview.extraCommands||[])] : []),...Cube.draws]}});
    const Orientation = $(".orientation");
    Orientation.replaceChildren();
    for (const Face of Cube.faces) {
      const Button=document.createElement("button");
      Button.title=Face.view[0].toUpperCase()+Face.view.slice(1);Button.setAttribute('aria-label',`${Button.title} view`);
      Button.dataset.view=Face.view;
      Button.style.clipPath=`polygon(${Face.points.map(P=>`${P[0]-(Canvas.clientWidth-113)}px ${P[1]-(Canvas.clientHeight-113)}px`).join(',')})`;
      Button.onclick=()=>this.App.SelectCameraView(Face.view);
      Orientation.append(Button);
      // Map the label square through the face's UV basis, not a billboard.
      const Label=document.createElement('span');Label.textContent=Button.title;Label.className='cube-face-label';
      const [O,X,,Y]=Face.points,W=44;
      Label.style.transform=`matrix(${(X[0]-O[0])/W},${(X[1]-O[1])/W},${(Y[0]-O[0])/W},${(Y[1]-O[1])/W},${O[0]-(Canvas.clientWidth-113)},${O[1]-(Canvas.clientHeight-113)})`;
      Orientation.append(Label);
    }
    for(const Axis of Cube.axes) {
      const Label=document.createElement('span');Label.textContent=Axis.text;Label.style.color=Axis.color;
      Label.style.left=`${Axis.point[0]-(Canvas.clientWidth-113)}px`;Label.style.top=`${Axis.point[1]-(Canvas.clientHeight-113)}px`;Orientation.append(Label);
    }
    const Labels = $("#drawing-labels");
    Labels.replaceChildren();
    for (const Label of Preview?.labels || []) {
      const P = Transform(Frame.view.ViewClip, Label.world);
      if (P[3] <= 0) continue;
      const E = document.createElement("span");
      E.textContent = Label.text;
      if(Label.text.includes("°")) E.classList.add("angle");
      E.style.left = `${(P[0] / P[3] + 1) * 50}%`;
      E.style.top = `calc(${(P[1] / P[3] + 1) * 50}% + ${Label.offsetY||0}px)`;
      Labels.append(E);
    }
    if (D) this.Prompt();
  }
  Cancel() {
    if (!this.Drawing) return;
    this.Drawing = null;
    $("#draw-prompt").hidden = true;
    $("#drawing-labels").replaceChildren();
    $("#cad-canvas").style.cursor = "";
    this.Paint();
  }
  async Finish() {
    const D = this.Drawing;
    if (!D || D.identity !== this.App.Active || D.points.length < (D.tool === "polygon" ? 2 : DrawingTools[D.tool].count||2)) return;
    const T = DrawingTools[D.tool];
    if (!T.multi && D.points.length < (D.tool === "polygon" ? 2 : T.count))
      return;
    this.Drawing = null;
    $("#draw-prompt").hidden = true;
    $("#drawing-labels").replaceChildren();
    try {
      const R = await this.App.Command(DrawingCommand(D));
      if (!R?.success) {
        this.Drawing = D;
        $("#draw-prompt").hidden = false;
        this.Prompt();
        this.Paint();
        this.App.Notify("Native sketch refused. Adjust the points or cancel.");
      }
    } catch (E) {
      this.App.Notify(E.message);
      this.Drawing = D;
      $("#draw-prompt").hidden = false;
      this.Prompt();
      this.Paint();
    }
  }
  async Catalogue(Index) {
    const Tool = CatalogueTools[Index];
    if (Tool === "workplane") return this.Workplane();
    if (Tool) return this.Start(Tool);
    // Solid/surface entries retain explicit numeric controls, not random ring placement.
    const Keys = { 12: "box", 13: "sphere", 14: "cylinder", 16: "torus" };
    if (Keys[Index]) return this.App.OpenTool(Keys[Index]);
    this.Cancel();
    $("#native-placement-command").value = ConstructionCatalogue[Index].command(
      0,
      0,
    );
    $("#native-placement-dialog").showModal();
  }
  ScheduleSave() {
    clearTimeout(this.SaveTimer);
    this.SaveTimer = setTimeout(() => this.SaveNow(), 600);
  }
  async SaveNow() {
    clearTimeout(this.SaveTimer);
    if (this.Saving) return this.Saving;
    if (
      !this.App.Document?.dirty ||
      this.Drawing ||
      this.App.ViewDrag ||
      this.App.Busy ||
      this.App.Motion ||
      this.App.ResolveDetail
    ) {
      if (this.App.Document?.dirty) this.ScheduleSave();
      return;
    }
    const App = this.App,
      Identity = App.Active,
      Doc = App.Document;
    const Camera = structuredClone(App.Description.camera),
      Figures = App.Description.figures.length;
    this.Saving = (async () => {
      try {
        const R = App.Worker.Snapshot
          ? await App.Worker.Snapshot(Identity)
          : await App.Request("save");
        if (!R) {
          this.ScheduleSave();
          return;
        }
        if (R.success && App.Active === Identity) {
          localStorage.setItem(
            SavedKey,
            JSON.stringify({
              version: 1,
              text: R.file,
              name: Doc.name,
              figures: Figures,
              camera: Camera,
              saved: new Date().toISOString(),
            }),
          );
        }
      } catch (E) {
        App.Notify(`Autosave unavailable: ${E.message}. Save an .arc copy.`);
      } finally {
        this.Saving = null;
      }
    })();
    return this.Saving;
  }
  Backup() {
    try {
      const Saved = localStorage.getItem(SavedKey);
      if (Saved) {
        localStorage.setItem(PreviousKey, Saved);
        localStorage.removeItem(SavedKey);
      }
    } catch (E) {
      this.App.Notify(`Could not retain previous drawing: ${E.message}`);
    }
  }
  async Restore(Saved) {
    if (!Saved) {
      this.App.Notify("No recoverable previous document in this browser.");
      return;
    }
    if (
      this.App.Document?.dirty &&
      !confirm("Replace this tab with the recoverable drawing?")
    )
      return;
    this.Cancel();
    try {
      if (!(await this.App.AwaitNavigation())) return;
      const R = await this.App.Request("open", { text: Saved.text });
      if (!R.success) {
        this.App.Notify("Recovery was refused; saved copy is untouched.");
        return;
      }
      if (
        Saved.camera &&
        [
          Saved.camera.yaw,
          Saved.camera.pitch,
          Saved.camera.distance,
          ...(Saved.camera.pivot || []),
        ].length === 6 &&
        [
          Saved.camera.yaw,
          Saved.camera.pitch,
          Saved.camera.distance,
          ...Saved.camera.pivot,
        ].every(Number.isFinite)
      )
        await this.App.Request("render", { camera: Saved.camera });
      this.App.Document.name = Saved.name;
      this.App.Document.dirty = false;
      this.App.Refresh();
      $("#recovery-dialog").close();
      if ($("#construct-menu").matches(":popover-open"))
        $("#construct-menu").hidePopover();
    } catch (E) {
      this.App.Notify(E.message);
    }
  }
}
