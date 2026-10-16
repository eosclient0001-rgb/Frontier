// Cockpit fittings and thin glass, depth-tested over the resolved scene. Live HMI sheets are from
// Frontier Experimental/TabletPanel (arena/4f07c82a-frontier); no Three.js/runtime or remote assets required.
import { ClusterSequence, ClusterOutlines } from "./HMI/ClusterSequence.js";
import { ScreenSequence } from "./HMI/ScreenSequence.js";
import { Applications, ScreenWidth, ScreenHeight } from "./HMI/AppSpecification.js";
import { ConstructIconImages } from "./HMI/IconDepot.js";
import { CabinLayout, ConstructCabinTransform } from "./CabinLayout.js";
import { AddVector, MultiplyTransform, InvertTransform, TransformPoint, SubtractVector, CrossVector, NormalizeVector } from "./TransformProjection.js";

export class CabinProjection
{
    // 📝 Host adapter: Settings are the cabin's switches (the host reads SeeThroughGlass); HudScale sizes the cluster and the
    //    tablet in place (the dashboard, wheel and seats keep their authored size). PendingPressure is the tablet's pressure
    //    before the screens exist.
    constructor(Exchange, Shaders)
    {
        this.Exchange = Exchange; this.Shaders = Shaders;
        this.Settings = { SeeThroughGlass: true };
        this.HudScale = 1.0; this.PendingPressure = 220; this.Touching = false; this.TabletPose = null;
    }

    async ConstructPrograms(FrameRecords, Scene)
    {
        const D = this.Exchange.Device;
        this.ClusterCanvas = document.createElement("canvas");
        this.Cluster = new ClusterSequence(this.ClusterCanvas);
        this.Cluster.Demonstration = false;
        this.TabletCanvas = document.createElement("canvas");
        this.Screen = new ScreenSequence(this.TabletCanvas, await ConstructIconImages(Applications), () => {});
        this.Screen.Values.pressure = this.PendingPressure;
        this.PriorPressure = this.PendingPressure;
        this.Screen.AdvanceClock();
        this.Cluster.RasterCluster(0);
        this.Screen.RasterScreen();
        const MakeTexture = Canvas => D.createTexture({ size: [Canvas.width, Canvas.height], format: "rgba8unorm-srgb",
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT });
        this.ClusterTexture = MakeTexture(this.ClusterCanvas);
        this.TabletTexture = MakeTexture(this.TabletCanvas);
        this.PoseRecords = this.Exchange.ConstructRecords(192, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, "Cabin poses");
        this.Layout = this.Exchange.ConstructDescriptorLayout(["Uniform", "Uniform", "Texture2D", "Texture2D", "Sampler"],
            GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, "Cabin fittings");
        this.Group = this.Exchange.ConstructDescriptorGroup(this.Layout, [FrameRecords, this.PoseRecords,
            this.ClusterTexture.createView(), this.TabletTexture.createView(), this.Exchange.ConstructSampler({magFilter:"linear",minFilter:"linear"})]);
        const Descriptor = {
            VertexEntry: "CabinVertex", FragmentEntry: "CabinFragment",
            VertexLayouts: [{ arrayStride: 36, attributes: [
                {shaderLocation:0,offset:0,format:"float32x3"}, {shaderLocation:1,offset:12,format:"float32x3"},
                {shaderLocation:2,offset:24,format:"float32x2"}, {shaderLocation:3,offset:32,format:"uint32"} ]}],
            Primitive: {topology:"triangle-list",cullMode:"none"},
            DepthStencil: {format:"depth32float",depthWriteEnabled:true,depthCompare:"greater-equal"},
            Targets: [{format:"rgba16float"}]
        };
        this.OpaqueProgram = await this.Shaders.ConstructRasterProgram("CabinRaster.wgsl", Descriptor, [this.Layout]);
        this.GlassProgram = await this.Shaders.ConstructRasterProgram("CabinRaster.wgsl", {...Descriptor,
            DepthStencil: {...Descriptor.DepthStencil,depthWriteEnabled:false},
            Targets: [{format:"rgba16float",blend:{
                color:{srcFactor:"src-alpha",dstFactor:"one-minus-src-alpha",operation:"add"},
                alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}}}]
        }, [this.Layout]);
        this.Scene = Scene;
        const Mesh = ConstructCabinMesh(Scene.VehicleGlassFacets, this.HudScale);
        this.OpaqueCount = Mesh.OpaqueCount;
        this.GlassCount = Mesh.GlassCount;
        this.Vertices = this.Exchange.ConstructRecords(Mesh.Bytes.byteLength, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, "Cabin mesh");
        D.queue.writeBuffer(this.Vertices, 0, Mesh.Bytes);
        // 📝 The first upload waits for the first frame: the surfaces are dirty, so Advance copies them once they are drawn.
        this.Cluster.Dirty = true; this.Screen.Dirty = true;
        this.LastRaster = -1;
    }

    Upload(Texture, Canvas)
    {
        this.Exchange.Device.queue.copyExternalImageToTexture({source:Canvas}, {texture:Texture}, [Canvas.width,Canvas.height]);
    }

    Advance(Vehicle, Seconds)
    {
        this.BodyPose = Vehicle.QueryBodyTransform();
        this.WheelPose = MultiplyTransform(this.BodyPose, ConstructCabinTransform(CabinLayout.Wheel, CabinLayout.WheelTilt, Vehicle.SteerAngle * 3));
        this.TabletPose = MultiplyTransform(this.BodyPose, ConstructCabinTransform(CabinLayout.Tablet, CabinLayout.TabletTilt));
        const Poses = new Float32Array(48);
        Poses.set(this.BodyPose); Poses.set(this.WheelPose,16); Poses.set(this.TabletPose,32);
        this.Exchange.Device.queue.writeBuffer(this.PoseRecords,0,Poses);
        if (Seconds - this.LastRaster < 1 / 30) return;
        this.LastRaster = Seconds;
        const T = Vehicle.QueryTelemetry();
        Object.assign(this.Cluster,{Speed:Math.round(Math.abs(T.Speed)*3.6),Revolutions:T.EngineRPM,Gear:T.Gear,
            Status:T.Pressures.some(P=>P<80) ? "LOW TYRE PRESSURE · SERVICE REQUIRED" : "LIVE CONTROLVEHICLE · kPa / °C",Dirty:true});
        if (this.Cluster.RasterCluster(Seconds)) this.Upload(this.ClusterTexture,this.ClusterCanvas);
        if (this.PriorPressure !== this.Screen.Values.pressure)
        {
            this.PriorPressure = this.Screen.Values.pressure;
            Vehicle.InflateTyres(this.PriorPressure * 1000,this.PriorPressure * 1000);
        }
        this.Screen.LiveReading = T;
        this.Screen.AdvanceClock();
        if (["tyres","telemetry"].includes(this.Screen.Application)) this.Screen.Dirty = true;
        if (this.Screen.RasterScreen()) this.Upload(this.TabletTexture,this.TabletCanvas);
    }

    AssignPressure(Kilopascal)
    {
        this.PendingPressure = Kilopascal; this.PriorPressure = Kilopascal;
        if (this.Screen) this.Screen.Values.pressure = Kilopascal;
    }

    // 📝 The HUD: the cluster and the tablet are scaled in place (the mesh is rewritten; the count is unchanged).
    SetHudScale(Scale)
    {
        this.HudScale = Math.max(0.6, Math.min(1.6, Scale));
        if (!this.Vertices || !this.Scene) return;
        const Mesh = ConstructCabinMesh(this.Scene.VehicleGlassFacets, this.HudScale);
        this.Exchange.Device.queue.writeBuffer(this.Vertices, 0, Mesh.Bytes);
    }

    QueryReadout()
    {
        return this.Screen ? `${this.Screen.Application ?? "home"} · tablet ${Math.round(this.Screen.Values.pressure)} kPa` : "warming up";
    }

    // 📝 The pointer ray meets the SAME physical tablet pose used for drawing (BodyTransform × cabin transform), in the UI's
    //    logical 1200×750 space; the tablet's extent follows the HUD scale. Returns {Across, Down} or null.
    QueryTabletHit(Origin, Direction, BodyTransform)
    {
        const TabletPose = MultiplyTransform(BodyTransform, ConstructCabinTransform(CabinLayout.Tablet, CabinLayout.TabletTilt));
        this.TabletPose = TabletPose;
        const Inverse = InvertTransform(TabletPose);
        const Eye = TransformPoint(Inverse, Origin);
        const Ray = SubtractVector(TransformPoint(Inverse, AddVector(Origin, Direction)), Eye);
        if (Math.abs(Ray[2]) < 1e-8) return null;
        const T = (0.014 - Eye[2]) / Ray[2];
        const X = Eye[0] + T * Ray[0], Y = Eye[1] + T * Ray[1];
        const HalfWidth = CabinLayout.TabletWidth / 2 * this.HudScale, HalfHeight = CabinLayout.TabletHeight / 2 * this.HudScale;
        if (!(T > 0 && Eye[2] > 0 && Math.abs(X) <= HalfWidth && Math.abs(Y) <= HalfHeight)) return null;
        return { Across: (X / HalfWidth + 0.5) * ScreenWidth, Down: (0.5 - Y / HalfHeight) * ScreenHeight };
    }

    ForwardPointer(Phase, Across, Down)
    {
        if (!this.Screen) return false;
        if (Phase === "down") this.Touching = true;
        if (Phase === "up" || Phase === "cancel") this.Touching = false;
        this.Screen.ForwardPointer(Phase, Across, Down);
        return true;
    }

    Record(Encoder, Target, Depth)
    {
        const Pass = Encoder.beginRenderPass({label:"Cabin fittings and thin glazing",
            colorAttachments:[{view:Target,loadOp:"load",storeOp:"store"}],
            depthStencilAttachment:{view:Depth,depthLoadOp:"load",depthStoreOp:"store"}});
        Pass.setBindGroup(0,this.Group); Pass.setVertexBuffer(0,this.Vertices);
        Pass.setPipeline(this.OpaqueProgram); Pass.draw(this.OpaqueCount);
        if (this.Settings.SeeThroughGlass) { Pass.setPipeline(this.GlassProgram); Pass.draw(this.GlassCount,1,this.OpaqueCount); }
        Pass.end();
    }
}

function ConstructCabinMesh(Glass, Scale = 1.0)
{
    const Vertices=[];
    const Triangle=(Points,Material,UV=null,Normals=null)=>{
        const N=NormalizeVector(CrossVector(SubtractVector(Points[1],Points[0]),SubtractVector(Points[2],Points[0])));
        Points.forEach((P,I)=>Vertices.push({P,N:Normals?.[I]||N,UV:UV?.[I]||[0,0],Material}));
    };
    const Quad=(A,B,C,D,Material)=>{
        Triangle([A,B,C],Material,[[0,1],[1,1],[1,0]]);
        Triangle([A,C,D],Material,[[0,1],[1,0],[0,0]]);
    };
    // Toroidal grip, not a flat billboard. Spokes and display turn together on the steering column.
    const R=CabinLayout.WheelRadius, Tube=0.018, Sectors=64, Sides=10;
    const Point=(I,J)=>{const A=I/Sectors*2*Math.PI,B=J/Sides*2*Math.PI;return [(R+Tube*Math.cos(B))*Math.cos(A),(R+Tube*Math.cos(B))*Math.sin(A),Tube*Math.sin(B)];};
    for(let I=0;I<Sectors;I++) for(let J=0;J<Sides;J++) Quad(Point(I,J),Point(I+1,J),Point(I+1,J+1),Point(I,J+1),1);
    Quad([-.17,-.018,0],[.17,-.018,0],[.17,.018,0],[-.17,.018,0],1);
    Quad([-.018,-.18,0],[.018,-.18,0],[.028,0,0],[-.028,0,0],1);
    const Outline=ClusterOutlines.hexagon.Points();
    const W=.27*Scale,H=.151*Scale; // same 0.34:0.19 aspect as the original cluster, scaled to fit inside the wheel
    for(let I=0;I<Outline.length;I++)
    {
        const A=Outline[I],B=Outline[(I+1)%Outline.length];
        Triangle([[0,0,.018],[A[0]*W*.54,A[1]*H*.54,.018],[B[0]*W*.54,B[1]*H*.54,.018]],1);
        Triangle([[0,0,.023],[A[0]*W*.5,A[1]*H*.5,.023],[B[0]*W*.5,B[1]*H*.5,.023]],2,
            [[.5,.5],[A[0]*.5+.5,.5-A[1]*.5],[B[0]*.5+.5,.5-B[1]*.5]]);
    }
    const X=CabinLayout.TabletWidth/2*Scale,Y=CabinLayout.TabletHeight/2*Scale;
    Quad([-X-.012,-Y-.012,.008],[X+.012,-Y-.012,.008],[X+.012,Y+.012,.008],[-X-.012,Y+.012,.008],3);
    Quad([-X,-Y,.014],[X,-Y,.014],[X,Y,.014],[-X,Y,.014],4);
    const OpaqueCount=Vertices.length;
    for(const Facet of Glass) Triangle(Facet.Corners,0);
    const Bytes=new ArrayBuffer(Vertices.length*36),Floats=new Float32Array(Bytes),Ints=new Uint32Array(Bytes);
    Vertices.forEach((V,I)=>{const O=I*9;Floats.set(V.P,O);Floats.set(V.N,O+3);Floats.set(V.UV,O+6);Ints[O+8]=V.Material;});
    return {Bytes,OpaqueCount,GlassCount:Vertices.length-OpaqueCount};
}
