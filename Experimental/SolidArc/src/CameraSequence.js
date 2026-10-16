// Camera-only client prediction. Mirrors CameraProjection.cpp and Mat4 projection conventions;
// geometry, tessellation, selection and gizmo edits remain in native C++. Parity is browser-tested.
const Add = (A, B) => A.map((Value, Index) => Value + B[Index]);
const Scale = (A, B) => A.map((Value) => Value * B);
const Dot = (A, B) => A.reduce((Sum, Value, Index) => Sum + Value * B[Index], 0);
const Cross = (A, B) => [A[1]*B[2]-A[2]*B[1], A[2]*B[0]-A[0]*B[2], A[0]*B[1]-A[1]*B[0]];
const Unit = (A) => Scale(A, 1 / Math.hypot(...A));
const Multiply = (A, B) => Array.from({length: 16}, (_, Index) => {
    const Row = Index % 4, Column = Math.floor(Index / 4);
    return A[Row]*B[Column*4] + A[4+Row]*B[Column*4+1] + A[8+Row]*B[Column*4+2] + A[12+Row]*B[Column*4+3];
});
function Inverse(Matrix)
{
    const Rows = Array.from({length: 4}, (_, Row) => [...Array.from({length: 4}, (_, Column) => Matrix[Column*4+Row]), ...Array.from({length: 4}, (_, Column) => Number(Row === Column))]);
    for (let Column = 0; Column < 4; ++Column)
    {
        let Pivot = Column;
        for (let Row = Column + 1; Row < 4; ++Row) if (Math.abs(Rows[Row][Column]) > Math.abs(Rows[Pivot][Column])) Pivot = Row;
        [Rows[Column], Rows[Pivot]] = [Rows[Pivot], Rows[Column]];
        const Divisor = Rows[Column][Column];
        if (Math.abs(Divisor) < 1e-20) throw Error("Camera projection is singular");
        Rows[Column] = Rows[Column].map((Value) => Value / Divisor);
        for (let Row = 0; Row < 4; ++Row)
        {
            if (Row === Column) continue;
            const Factor = Rows[Row][Column];
            Rows[Row] = Rows[Row].map((Value, Index) => Value - Factor * Rows[Column][Index]);
        }
    }
    return Array.from({length: 16}, (_, Index) => Rows[Index % 4][4 + Math.floor(Index / 4)]);
}
export function CopyCamera(Camera)
{
    return {...Camera, roll:0, pivot: [...Camera.pivot]};
}
function Basis(Camera)
{
    const Offset = [Math.sin(Camera.yaw)*Math.cos(Camera.pitch), -Math.cos(Camera.yaw)*Math.cos(Camera.pitch), Math.sin(Camera.pitch)];
    const Eye = Add(Camera.pivot, Scale(Offset, Camera.distance));
    const Forward = Unit(Scale(Offset, -1));
    const Right=[Math.cos(Camera.yaw),Math.sin(Camera.yaw),0];
    return {Eye,Forward,Right,Up:Cross(Right,Forward)};
}
export function MoveCamera(Camera, Action, X, Y = 0, Height = 1)
{
    if(Action === "turntable" || Action === "orbit") {
        // RMB CAD orbit: horizontal is WORLD Z, vertical is camera-right.
        Camera.yaw=(Camera.yaw+X)%(2*Math.PI);
        if(Y!==0) Camera.pitch=Math.max(-Math.PI/2+1e-3,Math.min(Math.PI/2-1e-3,Camera.pitch+Y));
        Camera.roll=0;
    }
    else if (Action === "zoom") Camera.distance = Math.max(0.01, Camera.distance * Math.pow(0.85, X));
    else if (Action === "pan")
    {
        const {Forward, Right} = Basis(Camera), Up = Cross(Right, Forward);
        const WorldPixel = 2 * Camera.distance * Math.tan(Camera.fov / 2) / Height;
        Camera.pivot = Add(Camera.pivot, Add(Scale(Right, -X * WorldPixel), Scale(Up, -Y * WorldPixel)));
    }
}
export function CameraView(Camera, Width, Height, Previous)
{
    const {Eye, Forward,Right,Up} = Basis(Camera);
    const View = [Right[0], Up[0], -Forward[0], 0, Right[1], Up[1], -Forward[1], 0, Right[2], Up[2], -Forward[2], 0, -Dot(Right, Eye), -Dot(Up, Eye), Dot(Forward, Eye), 1];
    const Near = Camera.orthographic ? Camera.distance - 4*Camera.reach - 100 : Math.max(Camera.distance - 2*Camera.reach, Camera.distance * 0.03, 1e-3);
    const Far = Camera.distance + 8*Camera.reach + 1000;
    const Focal = 1 / Math.tan(Camera.fov / 2), Aspect = Width / Height;
    const Projection = Camera.orthographic
        ? [Focal/Camera.distance/Aspect, 0, 0, 0, 0, -Focal/Camera.distance, 0, 0, 0, 0, 1/(Near-Far), 0, 0, 0, Near/(Near-Far), 1]
        : [Focal/Aspect, 0, 0, 0, 0, -Focal, 0, 0, 0, 0, Far/(Near-Far), -1, 0, 0, Near*Far/(Near-Far), 0];
    const ViewClip = Multiply(Projection, View), ClipView = Inverse(ViewClip), ViewWorld = Inverse(View);
    return {...Previous,
        ViewClip: ViewClip.map(Math.fround), ClipView: ClipView.map(Math.fround), ViewWorld: ViewWorld.map(Math.fround),
        EyePosition: [...(Camera.orthographic ? Scale(Forward, -1) : Eye), Camera.orthographic ? 0 : 1].map(Math.fround),
        Viewport: [Width, Height, 1/Width, 1/Height].map(Math.fround),
        LatticeStyle: [Previous.LatticeStyle[0], 5, Math.max(Camera.distance * 0.9, 3.5), 0.35].map(Math.fround),
        DepthPolicy: [Camera.orthographic ? 2e-3 * Camera.distance / (Far-Near) : 2e-3 * Far*Near/(Far-Near), 0, 0, 0].map(Math.fround),
        PixelAngle: Camera.orthographic ? 0 : Math.fround(2 / Focal / Height),
        PixelWorld: Camera.orthographic ? Math.fround(2 * Camera.distance / Focal / Height) : 0,
    };
}
