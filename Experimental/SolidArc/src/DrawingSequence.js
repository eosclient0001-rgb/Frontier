// Presentation-only rubber bands. Final geometry is produced transactionally by C++ ToolSession
// (`draw`), never by these polylines. Preview strokes use the existing GPU segment pipeline.
export const DrawingTools = {
  pslot:{label:"Polyline Slot",prompts:["Click first centre","Click next centre · Enter / right-click to finish"],multi:true},
  "sketch-point":{label:"Point",prompts:["Click position"],count:1},
  "datum-point":{label:"Datum Point",prompts:["Click position"],count:1},
  circle3:{label:"Circle · 3 points",prompts:["Click first point","Click second point","Click third point"],count:3},
  arc3:{label:"Arc · 3 points",prompts:["Click start","Click end","Click through point"],count:3},
  line: {
    label: "Line",
    prompts: ["Click first point", "Click end point"],
    count: 2,
  },
  polyline: {
    label: "Polyline",
    prompts: [
      "Click first point",
      "Click next point · Enter / right-click to finish",
    ],
    multi: true,
  },
  rect: {
    label: "Rectangle",
    prompts: ["Click first corner", "Click opposite corner"],
    count: 2,
  },
  centerrect: {
    label: "Centre Rect.",
    prompts: ["Click centre", "Click corner"],
    count: 2,
  },
  slot: {
    label: "Slot",
    prompts: ["Click first centre", "Click second centre"],
    count: 2,
  },
  circle: {
    label: "Circle",
    prompts: ["Click centre", "Click radius"],
    count: 2,
  },
  circle2: {
    label: "Diameter Circle",
    prompts: ["Click diameter start", "Click diameter end"],
    count: 2,
  },
  arc: {
    label: "Arc",
    prompts: ["Click centre", "Click start point", "Click end point"],
    count: 3,
  },
  ellipse: {
    label: "Ellipse",
    prompts: ["Click centre", "Click major-axis end", "Click minor radius"],
    count: 3,
  },
  polygon: {
    label: "Polygon",
    prompts: [
      "Click centre",
      "Click radius",
      "Scroll to change sides · click / Enter to confirm",
    ],
    count: 3,
  },
  spline: {
    label: "Spline",
    prompts: [
      "Click first point",
      "Click next point · Enter / right-click to finish",
    ],
    multi: true,
  },
  cpcurve: {
    label: "Control Curve",
    prompts: [
      "Click first point",
      "Click next control point · Enter / right-click to finish",
    ],
    multi: true,
  },
};
export const CatalogueTools = [
  "workplane",
  "line",
  "polyline",
  "rect",
  "centerrect",
  "slot",
  "circle",
  "arc",
  "ellipse",
  "polygon",
  "spline",
  "cpcurve",
  ...Array(10).fill(null),"pslot","sketch-point","datum-point","circle3","arc3",
];
const Add = (A, B) => A.map((V, I) => V + B[I]);
const Sub = (A, B) => A.map((V, I) => V - B[I]);
const Mul = (A, S) => A.map((V) => V * S);
const Dot = (A, B) => A.reduce((S, V, I) => S + V * B[I], 0);
export function Transform(M, P) {
  return [0, 1, 2, 3].map(
    (R) =>
      M[R] * P[0] + M[4 + R] * P[1] + M[8 + R] * P[2] + M[12 + R] * (P[3] ?? 1),
  );
}
export function WorldPoint(View, U, V, Plane) {
  const Unproject = (Z) => {
    const Q = Transform(View.ClipView, [U * 2 - 1, V * 2 - 1, Z]);
    return Q.slice(0, 3).map((N) => N / Q[3]);
  };
  const A = Unproject(0),
    B = Unproject(1),
    D = Sub(B, A),
    N = [
      Plane.x[1] * Plane.y[2] - Plane.x[2] * Plane.y[1],
      Plane.x[2] * Plane.y[0] - Plane.x[0] * Plane.y[2],
      Plane.x[0] * Plane.y[1] - Plane.x[1] * Plane.y[0],
    ];
  const Den = Dot(D, N);
  if (Math.abs(Den) < 1e-10) return null;
  const T = Dot(Sub(Plane.origin, A), N) / Den;
  if (T < 0) return null;
  const Local = Sub(Add(A, Mul(D, T)), Plane.origin);
  const Point = [Dot(Local, Plane.x), Dot(Local, Plane.y)];
  return Point.every(Number.isFinite) && Math.max(...Point.map(Math.abs)) < 1e6
    ? Point
    : null;
}
function offsetPolyline(P,r){ // round-capped outline of an open polyline: outer joints get arcs, inner joints get the miter intersection
  const n=P.length;if(n<2)return [];const dirs=[];for(let i=0;i<n-1;i++){const d=[P[i+1][0]-P[i][0],P[i+1][1]-P[i][1]];const l=Math.hypot(d[0],d[1])||1;dirs.push([d[0]/l,d[1]/l]);}
  const nrm=d=>[-d[1],d[0]];const at=v=>Math.atan2(v[1],v[0]);
  const arc=(c,a0,a1,out)=>{let d=a1-a0;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;const k=Math.max(3,Math.round(Math.abs(d)/(Math.PI/14)));for(let i=1;i<k;i++){const t=a0+d*i/k;out.push([c[0]+Math.cos(t)*r,c[1]+Math.sin(t)*r]);}};
  const isect=(p1,p2,p3,p4)=>{const d=(p1[0]-p2[0])*(p3[1]-p4[1])-(p1[1]-p2[1])*(p3[0]-p4[0]);if(Math.abs(d)<1e-9)return null;const t=((p1[0]-p3[0])*(p3[1]-p4[1])-(p1[1]-p3[1])*(p3[0]-p4[0]))/d;return [p1[0]+t*(p2[0]-p1[0]),p1[1]+t*(p2[1]-p1[1])];};
  const side=sg=>{const out=[];for(let i=0;i<n-1;i++){const d=dirs[i],nl=nrm(d).map(v=>v*sg*r);const a=[P[i][0]+nl[0],P[i][1]+nl[1]],b=[P[i+1][0]+nl[0],P[i+1][1]+nl[1]];if(i===0)out.push(a);
      if(i<n-2){const d2=dirs[i+1];const turn=d[0]*d2[1]-d[1]*d2[0];const nl2=nrm(d2).map(v=>v*sg*r);const a2=[P[i+1][0]+nl2[0],P[i+1][1]+nl2[1]],b2=[P[i+2][0]+nl2[0],P[i+2][1]+nl2[1]];
        if(turn*sg<0){out.push(b);arc(P[i+1],at(nl),at(nl2),out);out.push(a2);}else{const x=isect(a,b,a2,b2);out.push(x||b);}}
      else out.push(b);}return out;};
  const L=side(1),R=side(-1);const out=[...L];const tl=at(dirs[n-2]);for(let i=1;i<14;i++){const t=tl+Math.PI/2-Math.PI*i/14;out.push([P[n-1][0]+Math.cos(t)*r,P[n-1][1]+Math.sin(t)*r]);}
  // ensure the end cap goes around the front (through the forward direction)
  out.push(...R.reverse());const t0=at(dirs[0]);const cap=[];let a0=t0-Math.PI/2;for(let i=1;i<14;i++){const t=a0-Math.PI*i/14;cap.push([P[0][0]+Math.cos(t)*r,P[0][1]+Math.sin(t)*r]);}out.push(...cap);
  return out;}
export function PreviewDrawing(State, View, Plane) {
  const Confirmed = State.points,
    P = [...Confirmed, ...(State.cursor ? [State.cursor] : [])],
    A = P[0],
    B = P[1];
  const Segments = [],
    Labels = [], ArrowPositions = [], AngleSegments = [], Spokes = [];
  const World = (Q) =>
    Add(Plane.origin, Add(Mul(Plane.x, Q[0]), Mul(Plane.y, Q[1])));
  const Segment = (Q, R) => Segments.push(...World(Q), ...World(R));
  const Path = (Qs) => Qs.slice(1).forEach((Q, I) => Segment(Qs[I], Q));
  const Length = (Q, R) => Math.hypot(Q[0] - R[0], Q[1] - R[1]);
  const Dimension = (Q, R, Text, Offset = 0, LabelOffset = 0) => {
    const D = [R[0] - Q[0], R[1] - Q[1]],
      L = Math.hypot(...D) || 1;
    const N = [(-D[1] / L) * Offset, (D[0] / L) * Offset],
      C = [Q[0] + N[0], Q[1] + N[1]],
      E = [R[0] + N[0], R[1] + N[1]];
    Segment(C, E);
    const Project = T => {const H=Transform(View.ViewClip,World(T));return [(H[0]/H[3]+1)*View.Viewport[0]/2,(H[1]/H[3]+1)*View.Viewport[1]/2];};
    const Unproject = T => {const H=Transform(View.ClipView,[T[0]/View.Viewport[0]*2-1,T[1]/View.Viewport[1]*2-1,.1]);return H.slice(0,3).map(V=>V/H[3]);};
    const Start=Project(C),End=Project(E),Len=Math.hypot(End[0]-Start[0],End[1]-Start[1]);
    if(Len>1) for(const [Tip,Other] of [[Start,End],[End,Start]]) {
      const U=[(Other[0]-Tip[0])/Len,(Other[1]-Tip[1])/Len],N=[-U[1],U[0]];
      for(const T of [Tip,[Tip[0]+7*U[0]+3*N[0],Tip[1]+7*U[1]+3*N[1]],[Tip[0]+7*U[0]-3*N[0],Tip[1]+7*U[1]-3*N[1]]]) ArrowPositions.push(...Unproject(T));
    }
    Labels.push({
      world: World([(C[0] + E[0]) / 2, (C[1] + E[1]) / 2]),
      text: Text, offsetY: LabelOffset,
    });
  };
  const F = (V) => `${(V*1000).toFixed(1)} mm`;
  const Ring = (
    C,
    Rx,
    Ry = Rx,
    Angle = 0,
    Start = 0,
    Sweep = Math.PI * 2,
    Count = 96,
  ) => {
    const Qs = Array.from({ length: Count + 1 }, (_, I) => {
      const T = Start + (Sweep * I) / Count,
        X = Math.cos(T) * Rx,
        Y = Math.sin(T) * Ry;
      return [
        C[0] + X * Math.cos(Angle) - Y * Math.sin(Angle),
        C[1] + X * Math.sin(Angle) + Y * Math.cos(Angle),
      ];
    });
    Path(Qs);
  };
  const AngleDimension=(V,First,Last)=>{
    const Start=Math.atan2(First[1]-V[1],First[0]-V[0]);let Sweep=Math.atan2(Last[1]-V[1],Last[0]-V[0])-Start;
    while(Sweep>Math.PI)Sweep-=2*Math.PI;while(Sweep< -Math.PI)Sweep+=2*Math.PI;
    const Radius=Math.min(Length(V,First),Length(V,Last))*.35;
    const At=T=>[V[0]+Radius*Math.cos(T),V[1]+Radius*Math.sin(T)];
    for(let I=0;I<16;I++)AngleSegments.push(...World(At(Start+Sweep*I/16)),...World(At(Start+Sweep*(I+1)/16)));
    const Mid=Start+Sweep/2;Labels.push({world:World([V[0]+Radius*1.6*Math.cos(Mid),V[1]+Radius*1.6*Math.sin(Mid)]),text:`${Math.abs(Sweep*180/Math.PI).toFixed(1)}°`});
  };
  if (A && B) {
    const D = [B[0] - A[0], B[1] - A[1]],
      R = Length(A, B),
      Angle = Math.atan2(D[1], D[0]);
    switch (State.tool) {
      case "pslot": {
        const Outline=offsetPolyline(P,State.radius);if(Outline.length)Path([...Outline,Outline[0]]);
        Dimension(P.at(-2),P.at(-1),F(Length(P.at(-2),P.at(-1))),0,-14);
        if(P.length>=3)AngleDimension(P.at(-2),P.at(-3),P.at(-1));break;
      }
      case "circle3":
      case "arc3": {
        if(!P[2]){Segment(A,B);break;}
        const Mid=State.tool==="arc3"?P[2]:B, C=State.tool==="arc3"?B:P[2],B3=Mid;
        const Den=2*(A[0]*(B3[1]-C[1])+B3[0]*(C[1]-A[1])+C[0]*(A[1]-B3[1]));
        if(Math.abs(Den)<1e-10){Path(P);break;}
        const S=T=>T[0]*T[0]+T[1]*T[1];
        const O=[(S(A)*(B3[1]-C[1])+S(B3)*(C[1]-A[1])+S(C)*(A[1]-B3[1]))/Den,(S(A)*(C[0]-B3[0])+S(B3)*(A[0]-C[0])+S(C)*(B3[0]-A[0]))/Den];
        const Start=Math.atan2(A[1]-O[1],A[0]-O[0]),TAU=2*Math.PI,Positive=T=>(T+TAU)%TAU;
        let Sweep=Positive(Math.atan2(C[1]-O[1],C[0]-O[0])-Start);
        if(Positive(Math.atan2(B3[1]-O[1],B3[0]-O[0])-Start)>Sweep)Sweep-=TAU;
        Ring(O,Length(O,A),Length(O,A),0,Start,State.tool==="circle3"?TAU:Sweep);
        Dimension(O,A,`R ${F(Length(O,A))}`);break;
      }

      case "rect":
      case "centerrect": {
        const Low =
          State.tool === "centerrect" ? [A[0] - D[0], A[1] - D[1]] : A;
        Path([Low, [B[0], Low[1]], B, [Low[0], B[1]], Low]);
        const Off = .4*(View.LatticeStyle?.[0]||1);
        Dimension(Low, [B[0], Low[1]], F(Math.abs(B[0] - Low[0])), -Off);
        Dimension([B[0], Low[1]], B, F(Math.abs(B[1] - Low[1])), -Off);
        break;
      }
      case "circle":
      case "circle2": {
        const C =
          State.tool === "circle2" ? [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2] : A;
        const Radius=State.tool==="circle2"?R/2:R;
        Ring(C,Radius);
        Dimension(C,[C[0]+Radius,C[1]],`R ${F(Radius)}`,0,-14);
        const V=Radius*Math.SQRT1_2;
        Dimension([C[0]-V,C[1]-V],[C[0]+V,C[1]+V],`⌀ ${F(Radius*2)}`,0,14);
        break;
      }
      case "polygon": {
        Ring(A,R,R,Angle,0,Math.PI*2,State.sides);
        const Next=[A[0]+R*Math.cos(Angle+2*Math.PI/State.sides),A[1]+R*Math.sin(Angle+2*Math.PI/State.sides)];
        Spokes.push(...World(A),...World(B),...World(A),...World(Next));
        Dimension(A,B,`R ${F(R)}`,0,-14);Dimension(B,Next,F(Length(B,Next)),0,14);
        AngleDimension(A,B,Next);
        Labels.push({world:World(A),offsetY:23,text:`${State.sides} sides · ${(180*(State.sides-2)/State.sides).toFixed(1)}° interior`});
        break;
      }
      case "arc": {
        let Sweep = P[2]
          ? Math.atan2(P[2][1] - A[1], P[2][0] - A[0]) - Angle
          : Math.PI * 2;
        while (Sweep <= 0) Sweep += Math.PI * 2;
        Ring(A, R, R, 0, Angle, Sweep);
        Dimension(A, B, `R ${F(R)}`);
        if (P[2])
          Dimension(A, P[2], `${((Sweep * 180) / Math.PI).toFixed(1)}°`);
        break;
      }
      case "ellipse": {
        const Minor = P[2]
          ? Math.abs(
              (P[2][0] - A[0]) * -Math.sin(Angle) +
                (P[2][1] - A[1]) * Math.cos(Angle),
            )
          : 0;
        if (Minor) Ring(A, R, Minor, Angle);
        else Segment(A, B);
        Dimension(A, B, `a ${F(R)}`);
        if (Minor)
          Dimension(
            A,
            [A[0] - Math.sin(Angle) * Minor, A[1] + Math.cos(Angle) * Minor],
            `b ${F(Minor)}`,
          );
        break;
      }
      case "slot": {
        const Radius = State.radius,
          N = [-Math.sin(Angle) * Radius, Math.cos(Angle) * Radius];
        Segment([A[0] + N[0], A[1] + N[1]], [B[0] + N[0], B[1] + N[1]]);
        Segment([A[0] - N[0], A[1] - N[1]], [B[0] - N[0], B[1] - N[1]]);
        Ring(A, Radius, Radius, 0, Angle + Math.PI / 2, Math.PI, 48);
        Ring(B, Radius, Radius, 0, Angle - Math.PI / 2, Math.PI, 48);
        Dimension(A, B, `L ${F(R)} · R ${F(Radius)}`);
        break;
      }
      default:
        Path(P);
        Dimension(P.at(-2), P.at(-1), F(Length(P.at(-2), P.at(-1))),0,-14);
        if(P.length>=3)AngleDimension(P.at(-2),P.at(-3),P.at(-1));
    }
  }
  // Confirmed-point markers are geometry as well, not a Canvas2D image.
  if (State.cursor) {
    const C = State.cursor,
      T = 0.035;
    Segment([C[0] - T, C[1]], [C[0] + T, C[1]]);
    Segment([C[0], C[1] - T], [C[0], C[1] + T]);
  }
  return {
    command: {
      kind: "line",
      overlay: true,
      positions: Segments,
      local: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      tint: [1, 1, 1, .75],
      selection: [0, 0, 1, 5],
      surface: [0, 0, 1, 0],
      dashed: false,
      pick: 0,
    },
    extraCommands: [...(ArrowPositions.length ? [{kind:"surface",overlay:true,positions:ArrowPositions,normals:Array(ArrowPositions.length).fill(0).map((_,I)=>I%3===2?1:0),parameters:[],indices:Array.from({length:ArrowPositions.length/3},(_,I)=>I),local:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],tint:[1,1,1,.85],selection:[0,0,1,5],surface:[0,3,0,0],pick:0}] : []), ...[ [AngleSegments,[1,.645,.188,.9],false,1.2], [Spokes,[1,1,1,.35],true,1] ].filter(([P])=>P.length).map(([positions,tint,dashed,width])=>({kind:"line",overlay:true,positions,tint,dashed,local:[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],selection:[0,0,width,5],surface:[0,0,1,0],pick:0}))],
    labels: Labels,
  };
}
export function DrawingCommand(State) {
  const Points =
    State.tool === "polygon" ? State.points.slice(0, 2) : [...State.points];
  if (State.tool === "slot" && Points.length === 2)
    Points.push([Points[1][0], Points[1][1] + State.radius]);
  const Point = (P) => `(${P.map((V) => Number(V.toFixed(9))).join(",")})`;
  return `draw ${State.tool} ${Points.map(Point).join(" ")} --radius=${State.radius} --sides=${State.sides}${State.construction ? " --construction" : ""}${State.closed ? " --closed" : ""}`;
}
