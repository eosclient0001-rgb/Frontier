// Native CAD stays in C++. Camera-only redraws use retained native vertex streams locally:
// no HTTP, JSON geometry parsing, tessellation or vertex uploads on the animation path.
import { CommandProtocol, ValidateCommands } from "./CommandPacket.js";
import { CopyCamera, MoveCamera, CameraView } from "./CameraSequence.js";

export class NativeChannel
{
    constructor()
    {
        this.Identity = crypto.randomUUID();
        this.Controller = new AbortController();
        this.Closed = false;
        this.Epoch = 0;
        this.RemoteSequence = Promise.resolve();
        this.Stats = {requests: 0, receivedBytes: 0, localResponses: 0};
        this.Sequence = this.Initialize();
    }
    Emit(Value)
    {
        if (!this.Closed) this.onmessage?.({data: Value});
    }
    async Initialize()
    {
        try
        {
            const Result = await fetch("/native/health", {cache: "no-store", signal: this.Controller.signal});
            if (!Result.ok) throw Error(`Native geometry service unavailable (HTTP ${Result.status}).`);
            const Health = await Result.json();
            if (Health.transport !== "native-cpp-command-stream") throw Error("The native endpoint is not the SolidArc C++ geometry service.");
            this.Emit({ready: true, protocol: CommandProtocol, session: this.Identity});
        }
        catch (ErrorValue) { this.Emit({fatal: String(ErrorValue)}); }
    }
    Fetch(Request)
    {
        const Task = this.RemoteSequence.then(async () =>
        {
            if (this.Closed) throw Error("Geometry session closed");
            const Start = performance.now(), Epoch = this.Epoch;
            const Input = {...Request, ...(this.CameraDirty && Request.action !== "create" && Request.identity === this.Cache?.description.identity ? {camera: CopyCamera(this.Camera)} : {})};
            ++this.Stats.requests;
            const Result = await fetch("/native", {
                method: "POST", headers: {"Content-Type": "application/json", "X-SolidArc-Session": this.Identity},
                body: JSON.stringify(Input), signal: this.Controller.signal,
            });
            const Text = await Result.text();
            this.Stats.receivedBytes += Text.length;
            if (!Result.ok) throw Error(Text);
            const ParseStart = performance.now(), Response = JSON.parse(Text);
            if (Response.error) throw Error(Response.error);
            ValidateCommands(Response);
            if (Request.action === "hover" && this.Cache?.description.identity === Response.description.identity &&
                this.Cache.description.gizmo.hover === Response.description.gizmo.hover && Epoch === this.Epoch)
                Response.frame.draws = this.Cache.frame.draws;
            const Packet = {...Response, token: Request.token, duration: performance.now() - Start,
                timings: {roundTripMilliseconds: ParseStart - Start, jsonMilliseconds: performance.now() - ParseStart, responseBytes: Text.length}};
            if (Epoch === this.Epoch && (Request.action === "create" || !this.LastIdentity || Request.identity === this.LastIdentity))
            {
                this.Cache = Packet;
                this.Camera = CopyCamera(Packet.description.camera);
                this.CameraDirty = false;
            }
            return Packet;
        });
        this.RemoteSequence = Task.catch(() => {});
        return Task;
    }
    Snapshot(Identity)
    {
        const Task = this.RemoteSequence.then(async () =>
        {
            if (this.Closed || this.Pointer || this.NativePointer || this.CameraDirty) return null;
            ++this.Stats.requests;
            const Result = await fetch("/native", {
                method: "POST", headers: {"Content-Type": "application/json", "X-SolidArc-Session": this.Identity},
                body: JSON.stringify({action: "snapshot", identity: Identity}), signal: this.Controller.signal,
            });
            const Text = await Result.text(); this.Stats.receivedBytes += Text.length;
            if (!Result.ok) throw Error(Text);
            const Response = JSON.parse(Text);
            if (Response.error || !Response.success || typeof Response.file !== "string" || !Response.file.startsWith("# SolidArc native document v1")) throw Error(Response.error || "Native snapshot refused or malformed");
            return Response;
        });
        this.RemoteSequence = Task.catch(() => {});
        return Task;
    }
    NearGizmo(Request)
    {
        const Grips = this.Cache?.description.gizmo.grips || [];
        if (!Grips.length) return false;
        const PadX = 110 / (Request.width / Request.scale), PadY = 110 / (Request.height / Request.scale);
        return Request.u >= Math.min(...Grips.map((Grip) => Grip.u)) - PadX &&
            Request.u <= Math.max(...Grips.map((Grip) => Grip.u)) + PadX &&
            Request.v >= Math.min(...Grips.map((Grip) => Grip.v)) - PadY &&
            Request.v <= Math.max(...Grips.map((Grip) => Grip.v)) + PadY;
    }
    Change(Action, X, Y = 0, Height = 1)
    {
        MoveCamera(this.Camera, Action, X, Y, Height);
        this.CameraDirty = true;
        ++this.Epoch;
    }
    Local(Request, Interaction = "", Animate = false)
    {
        const Packet = this.Cache;
        ++this.Stats.localResponses;
        return {...Packet, token: Request.token, lines: [], file: null, dirty: false, success: true, duration: 0,
            interaction: Interaction, local: true,
            description: {...Packet.description, camera: CopyCamera(this.Camera)},
            frame: {...Packet.frame, localNavigation: Animate, view: CameraView(this.Camera, Packet.frame.width, Packet.frame.height, Packet.frame.view)},
            timings: {roundTripMilliseconds: 0, jsonMilliseconds: 0, responseBytes: 0}};
    }
    ScheduleSync(Request)
    {
        clearTimeout(this.SyncTimer);
        this.SyncTimer = setTimeout(async () =>
        {
            if (this.Closed || this.Pointer || this.NativePointer || !this.CameraDirty) return;
            const Epoch = this.Epoch;
            try
            {
                const Response = await this.Fetch({...Request, action: "render"});
                if (Epoch === this.Epoch && !this.Pointer && !this.NativePointer)
                    this.Emit({...Response, refresh: true});
            }
            catch (ErrorValue) { if (!this.Closed) this.Emit({notice: String(ErrorValue)}); }
        }, 180);
    }
    MovePointer(Request)
    {
        const Pointer = this.Pointer;
        if (Math.hypot(Request.cx - Pointer.originX, Request.cy - Pointer.originY) > 4) Pointer.moved = true;
        if (!Pointer.moved) return;
        if (Pointer.pan) this.Change("pan", Request.cx - Pointer.x, Pointer.y - Request.cy, Request.cssHeight);
        else this.Change(Pointer.button===2?"turntable":"orbit", -(Request.cx - Pointer.x) * 0.006, (Request.cy - Pointer.y) * 0.006);
        Pointer.x = Request.cx;
        Pointer.y = Request.cy;
    }
    async Dispatch(Request)
    {
        const Action = Request.action;
        if (this.CameraDirty && this.Cache && (Action === "create" || Request.identity !== this.Cache.description.identity))
            await this.Fetch({...Request, identity: this.Cache.description.identity, action: "render"});
        if (["command", "open", "create", "close", "activate"].includes(Action)) {
            ++this.Epoch;
            clearTimeout(this.SyncTimer);
        }
        const CanPreview = this.Cache && Number.isFinite(this.Camera?.fov) && Request.identity === this.Cache.description.identity &&
            Request.width === this.Cache.frame.width && Request.height === this.Cache.frame.height;
        if (!CanPreview) return this.Fetch(Request);
        if (Action === "hover" && !this.Pointer && !this.NativePointer)
        {
            // Hover is not allowed to hold up navigation. The exact C++ analytic gizmo aim
            // refreshes asynchronously, and stale responses never overwrite a newer camera.
            if (!this.HoverTask && performance.now() - (this.LastHover || 0) > 120 && !this.CameraDirty && (this.NearGizmo(Request) || this.Cache.description.gizmo.hover))
            {
                const Epoch = this.Epoch, Hover = this.Cache.description.gizmo.hover;
                this.LastHover = performance.now();
                this.HoverTask = this.Fetch(Request).then((Response) =>
                {
                    if (Epoch === this.Epoch && !this.Pointer && !this.NativePointer && Hover !== Response.description.gizmo.hover) this.Emit({...Response, refresh: true});
                }).catch(() => {}).finally(() => { this.HoverTask = null; });
            }
            return {...this.Local(Request), noRedraw: true};
        }
        if (Action === "pointerStart")
        {
            clearTimeout(this.SyncTimer);
            const Pointer = {originX: Request.cx, originY: Request.cy, x: Request.cx, y: Request.cy,
                pan: Request.button === 1 || Request.pan || (Request.button === 2 && Request.extend),
                button: Request.button, orbit: Request.orbit, extend: Request.extend, moved: false};
            if (Request.button === 0 && !Request.orbit && (Request.gizmoCandidate ?? this.NearGizmo(Request)))
            {
                const Response = await this.Fetch(Request);
                if (Response.interaction === "gizmo") { this.NativePointer = true; return Response; }
                // Preserve exact native hit testing. If no grip was hit, release its native
                // gesture and keep the rest of this camera drag entirely client-side.
                this.Fetch({...Request, action: "pointerEnd", cancel: true}).catch(() => {});
            }
            this.Pointer = Pointer;
            return this.Local(Request, Pointer.pan ? "pan" : "orbit");
        }
        if (Action === "pointerMove" && this.Pointer)
        {
            this.MovePointer(Request);
            await new Promise(requestAnimationFrame);
            return this.Local(Request, this.Pointer.pan ? "pan" : "orbit", this.Pointer.moved);
        }
        if (Action === "pointerEnd" && this.Pointer)
        {
            if (!Request.cancel) this.MovePointer(Request);
            const Pointer = this.Pointer;
            this.Pointer = null;
            if (!Request.cancel && !Pointer.moved && Pointer.button === 0 && !Pointer.orbit)
                return this.Fetch({...Request, action: "pick", x: Request.u * Request.width, y: Request.v * Request.height, extend: Pointer.extend});
            this.ScheduleSync(Request);
            return this.Local(Request);
        }
        if (Action === "pointerEnd" && this.NativePointer)
        {
            this.NativePointer = false;
            return this.Fetch(Request);
        }
        if (["orbit", "turntable", "pan", "zoom"].includes(Action) && !this.NativePointer)
        {
            this.Change(Action, Action === "zoom" ? Request.steps : Request.x, Request.y || 0, Request.height);
            this.ScheduleSync(Request);
            await new Promise(requestAnimationFrame);
            return this.Local(Request, "", true);
        }
        if (Action === "render" && this.CameraDirty)
        {
            this.ScheduleSync(Request);
            return {...this.Local(Request), noRedraw: true};
        }
        return this.Fetch(Request);
    }
    postMessage(Request)
    {
        this.LastIdentity = Request.identity;
        this.Sequence = this.Sequence.then(async () =>
        {
            if (this.Closed) return;
            try { this.Emit(await this.Dispatch(Request)); }
            catch (ErrorValue) { this.Emit({token: Request.token, error: String(ErrorValue), lines: []}); }
        });
    }
    terminate()
    {
        this.Closed = true;
        clearTimeout(this.SyncTimer);
        this.Controller.abort();
    }
}
