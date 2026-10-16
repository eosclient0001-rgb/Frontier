// Camera-linked 3D view cube. Faces are GPU triangle streams, not CSS pictures.
// The screen projection is mirrored by the native ViewportPanel orientation cube.
import {Transform} from './DrawingSequence.js';
const Identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
export function OrientationCube(View, Width, Height) {
  const M=View.ViewWorld, Dot=(P,O)=>P.reduce((S,V,I)=>S+V*M[O+I],0);
  const Project=P=>[Width-65+22*Dot(P,0),Height-65-22*Dot(P,4)];
  const World=P=>{const Q=Transform(View.ClipView,[P[0]/Width*2-1,P[1]/Height*2-1,.1]);return Q.slice(0,3).map(V=>V/Q[3]);};
  const Draws=[],Faces=[],Axes=[];
  const Command=(kind,tint)=>({kind,overlay:true,local:Identity,tint,selection:[0,0,1,5],surface:[0,3,0,0],dashed:false,pick:0,positions:[],normals:[],parameters:[],indices:[]});
  const FaceU=[[[0,1,0],[0,-1,0]],[[-1,0,0],[1,0,0]],[[1,0,0],[1,0,0]]];
  const FaceV=[[[0,0,1],[0,0,1]],[[0,0,1],[0,0,1]],[[0,1,0],[0,-1,0]]];
  const Names=[['right','left'],['back','front'],['top','bottom']];
  for(let Axis=0;Axis<3;Axis++) for(const Sign of [1,-1]) {
    const N=[0,0,0];N[Axis]=Sign;
    if(Dot(N,8)<=.02) continue;
    const Side=Sign===1?0:1,U=FaceU[Axis][Side],V=FaceV[Axis][Side];
    const Q=[[-1,1],[1,1],[1,-1],[-1,-1]].map(([X,Y])=>Project(N.map((Z,I)=>Z+U[I]*X+V[I]*Y)));
    const Shade=.12+.13*Dot(N,8), C=Command('surface',[Shade,Shade,Shade,1]);
    Q.forEach(P=>{C.positions.push(...World(P));C.normals.push(...N);});
    C.indices=[0,1,2,0,2,3];Draws.push(C);
    const E=Command('line',[.45,.45,.45,1]);
    Q.forEach((P,I)=>E.positions.push(...World(P),...World(Q[(I+1)%4])));Draws.push(E);
    Faces.push({view:Names[Axis][Sign===1?0:1],points:Q,center:Project(N)});
  }
  const Origin=[Width-92,Height-30],Colors=[[.86,.15,.15,1],[.16,.68,.22,1],[.15,.32,.9,1]];
  for(let Axis=0;Axis<3;Axis++) {
    const P=[0,0,0];P[Axis]=1;const End=[Origin[0]+19*Dot(P,0),Origin[1]-19*Dot(P,4)];
    const C=Command('line',Colors[Axis]);C.selection[2]=1.5;C.positions=[...World(Origin),...World(End)];Draws.push(C);
    Axes.push({text:'XYZ'[Axis],point:End,color:['#ef5350','#69d06d','#5b8cff'][Axis]});
  }
  return {draws:Draws,faces:Faces,axes:Axes};
}
