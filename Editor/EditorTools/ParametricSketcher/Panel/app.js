/* SolidArc panel application — UI wiring over the rewritten analytic B-rep kernel (kernel.js).
   The visual shell (CSS/markup) is reused unchanged from the previous prototype; every piece
   of modelling logic below goes through SolidArcKernel — no polygon tricks. */
'use strict';
const K=window.SolidArcKernel, KM=K.math;
const $=s=>document.querySelector(s), $$=s=>Array.from(document.querySelectorAll(s));
const V={add:KM.add,sub:KM.sub,mul:KM.mul,neg:KM.neg,dot:KM.dot,cross:KM.cross,len:KM.len,norm:KM.norm,dist:KM.dist,lerp:KM.lerp};

/* ═══════════════ document ═══════════════ */
let doc=null, undoStack=[], redoStack=[], selection=[], hover=null;
let selMode='body';
const PLANES={XY:{o:[0,0,0],u:[1,0,0],v:[0,1,0],w:[0,0,1]},
              XZ:{o:[0,0,0],u:[1,0,0],v:[0,0,1],w:[0,-1,0]},
              YZ:{o:[0,0,0],u:[0,1,0],v:[0,0,1],w:[1,0,0]}};
function newDoc(){doc={figures:[],next:1,activePlane:'XY'};selection=[];undoStack=[];redoStack=[];}
function fig(id){return doc.figures.find(f=>f.id===id);}
function figName(pre){let n=1;while(doc.figures.some(f=>f.name===pre+String(n).padStart(3,'0')))n++;return pre+String(n).padStart(3,'0');}
function frameOf(sk){return PLANES[sk.plane]||PLANES.XY;}
/* every drawn shape is its own figure (Circle001, Rect002…); profiles combine per plane */
function planeSketches(plane){return doc.figures.filter(f=>f.kind==='sketch'&&f.vis!==false&&f.plane===plane);}
const planeCache=new Map(); // plane → {stamp, regs} — combined regions of all shapes on the plane
function planeProfile(plane,sks){
  sks=sks||planeSketches(plane);
  const segs=[].concat(...sks.map(s=>s.segs));
  const stamp=JSON.stringify(segs);
  const c=planeCache.get(plane);
  if(c&&c.stamp===stamp)return c.regs;
  let regs=[];
  try{regs=segs.length?(K.profile(segs)||[]):[];}catch(e){regs=[];}
  planeCache.set(plane,{stamp,regs});
  return regs;
}
function snapshot(label){
  undoStack.push({label,doc:JSON.stringify(doc)});
  if(undoStack.length>100)undoStack.shift();
  redoStack=[];
  autosave();
}
function undo(){if(!undoStack.length)return;redoStack.push({label:'now',doc:JSON.stringify(doc)});doc=JSON.parse(undoStack.pop().doc);selection=[];refresh();log('undo');}
function redo(){if(!redoStack.length)return;undoStack.push({label:'now',doc:JSON.stringify(doc)});doc=JSON.parse(redoStack.pop().doc);selection=[];refresh();log('redo');}
function autosave(){try{localStorage.setItem('solidarc2.doc',JSON.stringify(doc));$('#dAuto').textContent='autosaved '+new Date().toLocaleTimeString();}catch(e){}}

/* ═══════════════ body rebuild (recipe replay) ═══════════════ */
const meshCache=new Map(); // bodyId → {solid,mesh,stamp}
function bodySources(b){ // figures whose curves feed this body's profile
  const ids=b.sketches||(b.sketch!=null?[b.sketch]:[]);
  return ids.map(fig).filter(Boolean);
}
function rebuildBody(b){
  b.err=null;
  const sks=bodySources(b);
  if(!sks.length){b.err='profile sketch missing';return null;}
  const segs=[].concat(...sks.map(s=>s.segs));
  const regs=K.profile(segs);
  if(!regs.length){b.err='profile is not closed';return null;}
  let S=K.extrude(regs[b.region||0]||regs[0],frameOf(sks[0]),b.h);
  // transform placement
  if(b.xf&&(b.xf.t.some(x=>x)||b.xf.s!==1||b.xf.rz)){
    const cz=Math.cos(b.xf.rz||0),sz=Math.sin(b.xf.rz||0);
    S=K.transform(S,{t:b.xf.t,s:b.xf.s,r:[[cz,-sz,0],[sz,cz,0],[0,0,1]]}).solid;
  }
  const failed=[];
  for(const ed of (b.edits||[])){
    let r;
    if(ed.op==='blend')r=K.blendEdge(S,ed.edge,ed.kind,ed.d,ed.d2);
    else if(ed.op==='offsetFace')r=K.offsetFace(S,ed.face,ed.d);
    else if(ed.op==='moveFace')r=K.moveFace(S,ed.face,ed.delta);
    else if(ed.op==='moveEdge')r=K.moveEdge(S,ed.edge,ed.delta);
    else if(ed.op==='moveVertex')r=K.moveVertex(S,ed.vert,ed.delta);
    else continue;
    if(r.ok)S=r.solid;else{ed.failed=r.msg;failed.push(r.msg);}
  }
  if(failed.length)b.err=failed[0];
  return S;
}
function bodySolid(b){
  const c=meshCache.get(b.id);
  const stamp=JSON.stringify([b.h,b.xf,b.edits,bodySources(b).map(s=>s.segs)]);
  if(c&&c.stamp===stamp)return c;
  const solid=rebuildBody(b);
  const mesh=solid?K.tessellate(solid):null;
  const entry={solid,mesh,stamp};
  meshCache.set(b.id,entry);
  return entry;
}

/* ═══════════════ camera & viewport ═══════════════ */
const cv=$('#gl'), ctx=cv.getContext('2d');
let W=0,H=0,DPR=1;
const cam={az:45*Math.PI/180,el:30*Math.PI/180,dist:260,target:[20,15,10],ortho:false,fov:40};
function camBasis(){
  const ce=Math.cos(cam.el),se=Math.sin(cam.el),ca=Math.cos(cam.az),sa=Math.sin(cam.az);
  const fwd=[-ce*ca,-ce*sa,-se];            // looking at target
  const right=V.norm(V.cross(fwd,[0,0,1]));
  const up=V.cross(right,fwd);
  const eye=V.sub(cam.target,V.mul(fwd,cam.dist));
  return {fwd,right,up,eye};
}
function project(p){
  const {fwd,right,up,eye}=camBasis();
  const d=V.sub(p,eye);
  const z=V.dot(d,fwd);
  const x=V.dot(d,right),y=V.dot(d,up);
  const f=cam.ortho?(H/(cam.dist*Math.tan(cam.fov*Math.PI/360)*2)):(H/(2*Math.tan(cam.fov*Math.PI/360)))/Math.max(z,1);
  if(!cam.ortho&&z<1)return null;
  return [W/2+x*f,H/2-y*f,z];
}
function pxScale(atP){ // world units per pixel at depth of point
  const {fwd,eye}=camBasis();
  const z=cam.ortho?cam.dist:Math.max(1,V.dot(V.sub(atP||cam.target,eye),fwd));
  return cam.ortho?(cam.dist*Math.tan(cam.fov*Math.PI/360)*2)/H:(2*Math.tan(cam.fov*Math.PI/360)*z)/H;
}
function mouseRay(mx,my){
  const {fwd,right,up,eye}=camBasis();
  if(cam.ortho){
    const s=(cam.dist*Math.tan(cam.fov*Math.PI/360)*2)/H;
    const o=V.add(eye,V.add(V.mul(right,(mx-W/2)*s),V.mul(up,-(my-H/2)*s)));
    return {o,d:fwd};
  }
  const f=H/(2*Math.tan(cam.fov*Math.PI/360));
  const d=V.norm(V.add(fwd,V.add(V.mul(right,(mx-W/2)/f),V.mul(up,-(my-H/2)/f))));
  return {o:eye,d};
}
function rayPlane(ray,frame){
  const n=frame.w,den=V.dot(ray.d,n);
  if(Math.abs(den)<1e-9)return null;
  const t=V.dot(V.sub(frame.o,ray.o),n)/den;
  if(t<0)return null;
  const p=V.add(ray.o,V.mul(ray.d,t));
  return {p,u:V.dot(V.sub(p,frame.o),frame.u),v:V.dot(V.sub(p,frame.o),frame.v)};
}
function resize(){
  DPR=window.devicePixelRatio||1;
  const r=cv.getBoundingClientRect();
  W=r.width;H=r.height;
  cv.width=W*DPR;cv.height=H*DPR;
  ctx.setTransform(DPR,0,0,DPR,0,0);
  draw();
}
new ResizeObserver(resize).observe(cv);

/* ═══════════════ drawing ═══════════════ */
let shade='matcap';
function shadeTri(n){
  const {fwd}=camBasis();
  const l=V.norm([-.4,.35,.85]);
  const nd=Math.max(0,V.dot(n,l)), vd=Math.max(0,-V.dot(n,fwd));
  if(shade==='flat'){const g=60+150*nd;return `rgb(${g|0},${(g*1.04)|0},${(g*1.12)|0})`;}
  // matcap-ish studio
  const base=[128,150,170];
  const rim=Math.pow(1-vd,3)*46;
  const spec=Math.pow(Math.max(0,V.dot(n,V.norm(V.add(l,V.neg(fwd))))),24)*110;
  const k=.28+.72*nd;
  return `rgb(${Math.min(255,base[0]*k+rim+spec)|0},${Math.min(255,base[1]*k+rim+spec)|0},${Math.min(255,base[2]*k+rim+spec)|0})`;
}
function isSel(t,body,key){return selection.some(s=>s.type===t&&s.body===body&&s.key===key);}
function draw(){
  if(!W)return;
  ctx.clearRect(0,0,W,H);
  drawLattice();
  // bodies
  const tris=[];
  for(const b of doc.figures.filter(f=>f.kind==='body'&&f.vis!==false)){
    const {mesh}=bodySolid(b);
    if(!mesh)continue;
    const P=mesh.positions.map(project);
    if(shade!=='wire'){
      for(const t of mesh.tris){
        const a=P[t[0]],bb=P[t[1]],c=P[t[2]];
        if(!a||!bb||!c)continue;
        // backface cull in screen space (outward tris are CCW on screen? depends) — use normal·view
        const n=V.norm(V.cross(V.sub(mesh.positions[t[1]],mesh.positions[t[0]]),V.sub(mesh.positions[t[2]],mesh.positions[t[0]])));
        const {fwd}=camBasis();
        if(V.dot(n,fwd)>0)continue;
        tris.push({z:(a[2]+bb[2]+c[2])/3,a,b:bb,c,n,body:b.id,face:t[3]});
      }
    }
  }
  tris.sort((x,y)=>y.z-x.z);
  for(const t of tris){
    const selF=hover&&hover.type==='face'&&hover.body===t.body&&hover.faceId===t.face;
    const isSelF=selFaceIds.has(t.body+':'+t.face);
    ctx.beginPath();ctx.moveTo(t.a[0],t.a[1]);ctx.lineTo(t.b[0],t.b[1]);ctx.lineTo(t.c[0],t.c[1]);ctx.closePath();
    ctx.fillStyle=isSelF?'rgba(255,180,84,.95)':selF?'rgba(79,216,224,.85)':shadeTri(t.n);
    ctx.fill();
  }
  // body edges & verts
  for(const b of doc.figures.filter(f=>f.kind==='body'&&f.vis!==false)){
    const {mesh}=bodySolid(b);
    if(!mesh)continue;
    for(const e of mesh.edges){
      const sel=isSel('edge',b.id,e.key), hov=hover&&hover.type==='edge'&&hover.body===b.id&&hover.key===e.key;
      ctx.strokeStyle=sel?'#ffb454':hov?'#4fd8e0':e.smooth?'rgba(200,215,230,.18)':shade==='wire'?'rgba(220,230,240,.75)':'rgba(10,14,18,.85)';
      ctx.lineWidth=sel||hov?2.4:e.smooth?1:1.3;
      ctx.beginPath();
      let started=false;
      for(const p of e.pts){const q=project(p);if(!q){started=false;continue;}
        if(!started){ctx.moveTo(q[0],q[1]);started=true;}else ctx.lineTo(q[0],q[1]);}
      ctx.stroke();
    }
    if(selMode==='vertex'||selMode==='edge'){
      for(const v of mesh.verts){
        const q=project(v.p);if(!q)continue;
        const sel=isSel('vertex',b.id,v.key),hov=hover&&hover.type==='vertex'&&hover.body===b.id&&hover.key===v.key;
        if(selMode!=='vertex'&&!sel&&!hov)continue;
        ctx.fillStyle=sel?'#ffb454':hov?'#4fd8e0':'rgba(255,255,255,.65)';
        ctx.beginPath();ctx.arc(q[0],q[1],sel||hov?4:2.6,0,7);ctx.fill();
      }
    }
  }
  // sketches — fill closed regions per plane (so holes work across profiles), then stroke curves
  {
    const skList=doc.figures.filter(f=>f.kind==='sketch'&&f.vis!==false);
    const byPlane=new Map();
    for(const sk of skList){if(!byPlane.has(sk.plane))byPlane.set(sk.plane,[]);byPlane.get(sk.plane).push(sk);}
    for(const [plane,sks] of byPlane)drawPlaneFill(plane,sks);
    for(const sk of skList)drawSketch(sk);
  }
  if(tool&&tool.preview)tool.preview();
  if(modal&&modal.preview)modal.preview();
  drawTriad();
}
let selFaceIds=new Set();
function rebuildSelFaces(){
  selFaceIds=new Set();
  for(const s of selection)if(s.type==='face'){
    const b=fig(s.body);if(!b)continue;
    const {solid}=bodySolid(b);if(!solid)continue;
    const f=K.faceByKey(solid,s.key);
    if(f)selFaceIds.add(s.body+':'+f.id);
  }
}
const profCache=new Map(); // sketchId → {stamp, regs}
function profileOf(sk){
  const stamp=JSON.stringify(sk.segs);
  const c=profCache.get(sk.id);
  if(c&&c.stamp===stamp)return c.regs;
  let regs=[];
  try{regs=K.profile(sk.segs)||[];}catch(e){}
  profCache.set(sk.id,{stamp,regs});
  return regs;
}
function drawPlaneFill(plane,sks){
  // closed regions of ALL shapes on the plane fill together (even-odd: holes stay empty)
  const regs=planeProfile(plane,sks);
  if(!regs.length)return;
  const F=PLANES[plane]||PLANES.XY;
  const P2=(x,y)=>project(V.add(F.o,V.add(V.mul(F.u,x),V.mul(F.v,y))));
  const anySel=sks.some(sk=>selection.some(s=>s.body===sk.id&&(s.type==='sketch'||s.type==='curve')));
  ctx.save();
  ctx.fillStyle=anySel?'rgba(255,180,84,.22)':'rgba(120,200,255,.16)';
  ctx.beginPath();
  for(const reg of regs)for(const loop of reg.loops){
    let started=false;
    for(const s of loop)for(const q2 of segPoly(s)){
      const q=P2(q2[0],q2[1]);
      if(!q){started=false;continue;}
      if(!started){ctx.moveTo(q[0],q[1]);started=true;}else ctx.lineTo(q[0],q[1]);
    }
    ctx.closePath();
  }
  ctx.fill('evenodd');
  ctx.restore();
}
function drawSketch(sk){
  const F=frameOf(sk);
  const P2=(x,y)=>project(V.add(F.o,V.add(V.mul(F.u,x),V.mul(F.v,y))));
  sk.segs.forEach((s,i)=>{
    const sel=isSel('curve',sk.id,i),hov=hover&&hover.type==='curve'&&hover.body===sk.id&&hover.key===i;
    ctx.strokeStyle=sel?'#ffb454':hov?'#4fd8e0':'rgba(120,200,255,.9)';
    ctx.lineWidth=sel||hov?2.2:1.4;
    ctx.beginPath();
    const pts=KM.segPts?KM.segPts(s):null;
    const list=segPoly(s);
    let started=false;
    for(const q2 of list){const q=P2(q2[0],q2[1]);if(!q){started=false;continue;}
      if(!started){ctx.moveTo(q[0],q[1]);started=true;}else ctx.lineTo(q[0],q[1]);}
    ctx.stroke();
  });
}
function arcN(r,sweep){ // adaptive chord count: keeps sagitta under ~¼ px at any zoom
  const tol=Math.max(1e-4,Math.min(1,pxScale()*0.25));
  const ang=Math.min(Math.PI/8,Math.max(Math.PI/1440,Math.sqrt(8*tol/Math.max(r,1e-6))));
  return Math.max(2,Math.min(2048,Math.ceil(Math.abs(sweep)/ang)));
}
function segPoly(s){
  if(s.full){const N=arcN(s.r,2*Math.PI),pts=[];for(let i=0;i<=N;i++){const a=2*Math.PI*i/N;pts.push([s.cx+s.r*Math.cos(a),s.cy+s.r*Math.sin(a)]);}return pts;}
  if(!s.b)return [[s.x0,s.y0],[s.x1,s.y1]];
  const A=KM.arcOf(s),pts=[];
  const N=arcN(A.r,A.sw);
  for(let i=0;i<=N;i++){const a=A.a0+A.sw*i/N;pts.push([A.cx+A.r*Math.cos(a),A.cy+A.r*Math.sin(a)]);}
  return pts;
}
function drawLattice(){
  const F=PLANES[doc.activePlane]||PLANES.XY;
  ctx.lineWidth=1;
  const step=10,n=12;
  for(let i=-n;i<=n;i++){
    for(const dir of [0,1]){
      const a=dir?V.add(F.o,V.add(V.mul(F.u,i*step),V.mul(F.v,-n*step))):V.add(F.o,V.add(V.mul(F.u,-n*step),V.mul(F.v,i*step)));
      const b=dir?V.add(F.o,V.add(V.mul(F.u,i*step),V.mul(F.v,n*step))):V.add(F.o,V.add(V.mul(F.u,n*step),V.mul(F.v,i*step)));
      const pa=project(a),pb=project(b);
      if(!pa||!pb)continue;
      ctx.strokeStyle=i===0?'rgba(255,255,255,.14)':'rgba(255,255,255,.05)';
      ctx.beginPath();ctx.moveTo(pa[0],pa[1]);ctx.lineTo(pb[0],pb[1]);ctx.stroke();
    }
  }
  // axes
  const O=project([0,0,0]);
  if(O){
    for(const [d,c] of [[[30,0,0],'#ff6b6b'],[[0,30,0],'#6fe38a'],[[0,0,30],'#5db3ff']]){
      const q=project(d);if(!q)continue;
      ctx.strokeStyle=c;ctx.lineWidth=1.6;ctx.globalAlpha=.8;
      ctx.beginPath();ctx.moveTo(O[0],O[1]);ctx.lineTo(q[0],q[1]);ctx.stroke();ctx.globalAlpha=1;
    }
  }
}
const triadCv=$('#triad');
function drawTriad(){
  const c=triadCv.getContext('2d');
  const s=76*(window.devicePixelRatio||1);
  if(triadCv.width!==s){triadCv.width=s;triadCv.height=s;}
  c.setTransform(window.devicePixelRatio||1,0,0,window.devicePixelRatio||1,0,0);
  c.clearRect(0,0,76,76);
  const {right,up}=camBasis();
  const proj=d=>[38+V.dot(d,right)*26,38-V.dot(d,up)*26];
  for(const [d,col,l] of [[[1,0,0],'#ff6b6b','X'],[[0,1,0],'#6fe38a','Y'],[[0,0,1],'#5db3ff','Z']]){
    const q=proj(d);
    c.strokeStyle=col;c.lineWidth=1.6;c.beginPath();c.moveTo(38,38);c.lineTo(q[0],q[1]);c.stroke();
    c.fillStyle=col;c.font='9px JetBrains Mono';c.fillText(l,q[0]-2,q[1]-3);
  }
}

/* ═══════════════ picking ═══════════════ */
function pick(mx,my,want){ // want: array of types in priority order
  const hits=[];
  for(const b of doc.figures.filter(f=>f.kind==='body'&&f.vis!==false)){
    const {mesh,solid}=bodySolid(b);
    if(!mesh)continue;
    const P=mesh.positions.map(project);
    // verts
    for(const v of mesh.verts){
      const q=project(v.p);if(!q)continue;
      const d=Math.hypot(q[0]-mx,q[1]-my);
      if(d<9)hits.push({type:'vertex',body:b.id,key:v.key,z:q[2]-1.0,d});
    }
    // edges
    for(const e of mesh.edges){
      if(e.smooth)continue;
      for(let i=0;i<e.pts.length-1;i++){
        const a=project(e.pts[i]),c=project(e.pts[i+1]);
        if(!a||!c)continue;
        const d=ptSeg(mx,my,a,c);
        if(d<7){hits.push({type:'edge',body:b.id,key:e.key,z:(a[2]+c[2])/2-.5,d});break;}
      }
    }
    // faces
    for(const t of mesh.tris){
      const a=P[t[0]],bb=P[t[1]],c=P[t[2]];
      if(!a||!bb||!c)continue;
      const n=V.cross(V.sub(mesh.positions[t[1]],mesh.positions[t[0]]),V.sub(mesh.positions[t[2]],mesh.positions[t[0]]));
      const {fwd}=camBasis();
      if(V.dot(n,fwd)>0)continue;
      if(inTri2(mx,my,a,bb,c)){
        const f=solid.faces[t[3]];
        hits.push({type:'face',body:b.id,key:f?f.key:String(t[3]),faceId:t[3],z:(a[2]+bb[2]+c[2])/3,d:3});
        break;
      }
    }
    if(want.includes('body')){
      for(const t of mesh.tris){
        const a=P[t[0]],bb=P[t[1]],c=P[t[2]];
        if(!a||!bb||!c)continue;
        if(inTri2(mx,my,a,bb,c)){hits.push({type:'body',body:b.id,key:null,z:(a[2]+bb[2]+c[2])/3,d:4});break;}
      }
    }
  }
  // sketch curves
  for(const sk of doc.figures.filter(f=>f.kind==='sketch'&&f.vis!==false)){
    const F=frameOf(sk);
    sk.segs.forEach((s,i)=>{
      const list=segPoly(s);
      for(let j=0;j<list.length-1;j++){
        const a=project(V.add(F.o,V.add(V.mul(F.u,list[j][0]),V.mul(F.v,list[j][1]))));
        const c=project(V.add(F.o,V.add(V.mul(F.u,list[j+1][0]),V.mul(F.v,list[j+1][1]))));
        if(!a||!c)continue;
        if(ptSeg(mx,my,a,c)<7){hits.push({type:'curve',body:sk.id,key:i,z:(a[2]+c[2])/2-.6,d:2});break;}
      }
    });
  }
  for(const t of want){
    const of=hits.filter(h=>h.type===t);
    if(of.length){of.sort((a,b)=>a.z-b.z||a.d-b.d);return of[0];}
  }
  return null;
}
function ptSeg(mx,my,a,b){
  const dx=b[0]-a[0],dy=b[1]-a[1];
  const l2=dx*dx+dy*dy;
  const t=l2?Math.max(0,Math.min(1,((mx-a[0])*dx+(my-a[1])*dy)/l2)):0;
  return Math.hypot(mx-(a[0]+dx*t),my-(a[1]+dy*t));
}
function inTri2(px,py,a,b,c){
  const ar=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  if(Math.abs(ar)<1e-9)return false; // degenerate on screen
  const s1=(b[0]-a[0])*(py-a[1])-(b[1]-a[1])*(px-a[0]);
  const s2=(c[0]-b[0])*(py-b[1])-(c[1]-b[1])*(px-b[0]);
  const s3=(a[0]-c[0])*(py-c[1])-(a[1]-c[1])*(px-c[0]);
  return (s1>=0&&s2>=0&&s3>=0)||(s1<=0&&s2<=0&&s3<=0);
}
function wantOrder(){
  if(selMode==='vertex')return ['vertex','curve','edge'];
  if(selMode==='edge')return ['edge','curve','vertex'];
  if(selMode==='face')return ['face','curve'];
  return ['curve','body'];
}

/* ═══════════════ sketch tools ═══════════════ */
let tool=null; // {kind,pts,…,preview()}
const SNAP=5;
function snapUV(uv,ev){
  let u=uv.u,v=uv.v;
  // endpoint weld — ALWAYS on: profiles must close by default. Any click within ~9 px of an
  // existing curve endpoint (or one of the current tool's own points) lands EXACTLY on it.
  const weldR=9*pxScale();
  let best=null;
  const consider=(px,py)=>{
    const d=Math.hypot(px-u,py-v);
    if(d<weldR&&(!best||d<best.d))best={x:px,y:py,d};
  };
  for(const sk of planeSketches(doc.activePlane))for(const s of sk.segs){
    if(s.full)continue;
    consider(s.x0,s.y0);consider(s.x1,s.y1);
  }
  if(tool&&tool.pts)for(const p of tool.pts)consider(p.u,p.v);
  if(best)return [best.x,best.y,true];
  if(ev&&(ev.ctrlKey||ev.metaKey))return [Math.round(u),Math.round(v),false];
  return [Math.round(u/SNAP)*SNAP,Math.round(v/SNAP)*SNAP,false];
}
function toolUV(ev){
  const r=cv.getBoundingClientRect();
  const ray=mouseRay(ev.clientX-r.left,ev.clientY-r.top);
  const hit=rayPlane(ray,PLANES[doc.activePlane]||PLANES.XY);
  if(!hit)return null;
  const [u,v,weld]=snapUV(hit,ev);
  return {u,v,weld};
}
function bulge3(A,M,B){ // bulge of the arc through A,B passing through M (0 if collinear)
  const d=2*(A[0]*(M[1]-B[1])+M[0]*(B[1]-A[1])+B[0]*(A[1]-M[1]));
  if(Math.abs(d)<1e-9)return 0;
  const a2=A[0]*A[0]+A[1]*A[1],m2=M[0]*M[0]+M[1]*M[1],b2=B[0]*B[0]+B[1]*B[1];
  const ox=(a2*(M[1]-B[1])+m2*(B[1]-A[1])+b2*(A[1]-M[1]))/d;
  const oy=(a2*(B[0]-M[0])+m2*(A[0]-B[0])+b2*(M[0]-A[0]))/d;
  const a0=Math.atan2(A[1]-oy,A[0]-ox),a1=Math.atan2(B[1]-oy,B[0]-ox),am=Math.atan2(M[1]-oy,M[0]-ox);
  let ccw=a1-a0;while(ccw<=0)ccw+=2*Math.PI;
  let dm=am-a0;while(dm<0)dm+=2*Math.PI;
  const sw=dm<ccw?ccw:ccw-2*Math.PI;   // pick the side that contains M
  return Math.tan(sw/4);
}
function ellipseSegs(c,p1,p2){ // axis-aligned ellipse as an arc spline through exact samples
  const rx=Math.hypot(p1.u-c.u,p1.v-c.v),ry=Math.hypot(p2.u-c.u,p2.v-c.v);
  if(rx<.01||ry<.01)return [];
  const N=16,at=t=>[c.u+rx*Math.cos(t),c.v+ry*Math.sin(t)];
  const out=[];
  for(let i=0;i<N;i++){
    const t0=2*Math.PI*i/N,t1=2*Math.PI*(i+1)/N;
    const A=at(t0),B=at(t1),M=at((t0+t1)/2);
    out.push({x0:A[0],y0:A[1],x1:B[0],y1:B[1],b:bulge3(A,M,B)});
  }
  return out;
}
const TOOLS={
  line:{label:'line',stem:'Line',prompts:['Click first point','Click second point'],n:2,
    make:p=>[{x0:p[0].u,y0:p[0].v,x1:p[1].u,y1:p[1].v,b:0}],sticky:true},
  rect:{label:'rectangle',stem:'Rect',prompts:['Click first corner','Click opposite corner'],n:2,
    make:p=>rectSegs(p[0],p[1]),sticky:true},
  crect:{label:'centre rect',stem:'Rect',prompts:['Click centre','Click a corner'],n:2,
    make:p=>rectSegs({u:2*p[0].u-p[1].u,v:2*p[0].v-p[1].v},p[1]),sticky:true},
  circle:{label:'circle',stem:'Circle',prompts:['Click centre','Click radius'],n:2,
    make:p=>{const r=Math.hypot(p[1].u-p[0].u,p[1].v-p[0].v);return r>0.01?[{cx:p[0].u,cy:p[0].v,r,full:true}]:[];},sticky:true},
  ellipse:{label:'ellipse',stem:'Ellipse',prompts:['Click centre','Click to set the first radius','Click to set the second radius'],n:3,
    make:p=>ellipseSegs(p[0],p[1],p[2]||p[1]),sticky:true,
    dims:p=>{
      const rx=Math.hypot(p[1].u-p[0].u,p[1].v-p[0].v);
      if(rx<.01)return [];
      const out=[{kind:'rad',c:p[0],p:p[1],label:'R₁ '+fmtMm(rx)}];
      if(p.length>=3){
        const ry=Math.hypot(p[2].u-p[0].u,p[2].v-p[0].v);
        if(ry>.01)out.push({kind:'rad',c:p[0],p:p[2],label:'R₂ '+fmtMm(ry)});
      }
      return out;
    }},
  arc:{label:'arc',stem:'Arc',prompts:['Click centre','Click start point','Click end point'],n:3,
    make:p=>arcSegs(p[0],p[1],p[2]),sticky:true},
  polygon:{label:'polygon',stem:'Polygon',prompts:['Click centre','Click a vertex','Scroll to change sides · click / ⏎ confirm'],n:3,confirmStep:true,
    make:(p,extra)=>polySegs(p[0],p[1],extra&&extra.sides||6),sticky:true,
    dims:(p,extra)=>{
      const r=Math.hypot(p[1].u-p[0].u,p[1].v-p[0].v);
      if(r<.01)return [];
      const k=extra&&extra.sides||6;
      const out=[{kind:'rad',c:p[0],p:p[1],label:'R '+fmtMm(r)+' · '+k+' sides'}];
      // central angle to the second vertex (360°/k), like the original prototype
      const a0=Math.atan2(p[1].v-p[0].v,p[1].u-p[0].u);
      const v2={u:p[0].u+r*Math.cos(a0+2*Math.PI/k),v:p[0].v+r*Math.sin(a0+2*Math.PI/k)};
      const ang=dimAngAt(p[0],p[1],v2);
      if(ang){ang.label=(360/k).toFixed(1)+'°';out.push(ang);}
      return out;
    }},
  polyline:{label:'polyline',stem:'Polyline',prompts:['Click points · Enter / double-click to finish'],n:99,
    make:p=>{const out=[];for(let i=0;i<p.length-1;i++)if(Math.hypot(p[i+1].u-p[i].u,p[i+1].v-p[i].v)>1e-9)out.push({x0:p[i].u,y0:p[i].v,x1:p[i+1].u,y1:p[i+1].v,b:0});return out;},sticky:true,
    dims:p=>dimsPolyline(p)},
  slot:{label:'slot',stem:'Slot',prompts:['Click slot start','Click slot end','Move to set width · click'],n:3,
    make:p=>slotSegs([p[0],p[1]],distPtSeg2(p[2],p[0],p[1])),sticky:true,
    dims:p=>{
      const out=[dimLin(p[0],p[1],'centres ')];
      if(p.length<3){const a=dimAngHoriz(p[0],p[1]);if(a)out.push(a);}
      else{const r=distPtSeg2(p[2],p[0],p[1]);if(r>.05)out.push({kind:'rad',c:p[1],p:p[2],label:'R '+fmtMm(r)});}
      return out;
    }},
  pslot:{label:'polyline slot',stem:'Slot',prompts:['Click spine points · Enter / double-click, then set width'],n:99,twoStage:true,
    make:(p,extra)=>slotSegs(p,extra&&extra.r||0),sticky:true,
    dims:(p,extra)=>{
      const out=dimsPolyline(p);
      if(extra&&extra.r>.05&&extra.cur)out.push({kind:'rad',c:p[p.length-1],p:extra.cur,label:'R '+fmtMm(extra.r)});
      return out;
    }},
};
/* live-dimension providers for the basic tools (kept minimal: only what defines the shape) */
TOOLS.line.dims=p=>{
  const out=[dimLin(p[0],p[1])];
  const a=dimAngHoriz(p[0],p[1]);
  if(a)out.push(a);
  return out;
};
TOOLS.rect.dims=p=>[
  dimLin(p[0],{u:p[1].u,v:p[0].v}),
  dimLin({u:p[1].u,v:p[0].v},p[1])];
TOOLS.crect.dims=p=>{
  const a={u:2*p[0].u-p[1].u,v:2*p[0].v-p[1].v};
  return [dimLin(a,{u:p[1].u,v:a.v}),dimLin({u:p[1].u,v:a.v},p[1])];
};
TOOLS.circle.dims=p=>{
  const r=Math.hypot(p[1].u-p[0].u,p[1].v-p[0].v);
  return r>.01?[{kind:'rad',c:p[0],p:p[1],label:'R '+fmtMm(r)+' · ⌀ '+fmtMm(2*r)}]:[];
};
TOOLS.arc.dims=p=>{
  const r=Math.hypot(p[1].u-p[0].u,p[1].v-p[0].v);
  if(r<.01)return [];
  const out=[{kind:'rad',c:p[0],p:p[1],label:'R '+fmtMm(r)}];
  if(p.length>=3){
    const a0=Math.atan2(p[1].v-p[0].v,p[1].u-p[0].u);
    let a1=Math.atan2(p[2].v-p[0].v,p[2].u-p[0].u);
    while(a1<=a0)a1+=2*Math.PI;
    out.push({kind:'ang',c:p[0],r,a0,a1,label:((a1-a0)*180/Math.PI).toFixed(0)+'°'});
  }
  return out;
};
function fmtMm(x){return x.toFixed(Math.abs(x)>=100?0:1);}
function dimLin(a,b,pre){return {kind:'lin',a,b,label:(pre||'')+fmtMm(Math.hypot(b.u-a.u,b.v-a.v))};}
function dimAngAt(c,pA,pB){ // angle at vertex c between the rays to pA and pB (minor angle)
  const lA=Math.hypot(pA.u-c.u,pA.v-c.v),lB=Math.hypot(pB.u-c.u,pB.v-c.v);
  if(lA<1e-6||lB<1e-6)return null;
  let a0=Math.atan2(pA.v-c.v,pA.u-c.u),a1=Math.atan2(pB.v-c.v,pB.u-c.u);
  let d=a1-a0;while(d>Math.PI)d-=2*Math.PI;while(d<-Math.PI)d+=2*Math.PI;
  if(Math.abs(d)<0.005)return null;              // collinear — no angle to show
  if(d<0){const t=a0;a0=a1;a1=t;d=-d;}
  return {kind:'ang',c,r:Math.min(lA,lB)*0.55,a0,a1,label:(d*180/Math.PI).toFixed(1)+'°'};
}
function dimAngHoriz(a,b){ // angle of the ray a→b measured from the sketch u axis
  const L=Math.hypot(b.u-a.u,b.v-a.v);
  if(L<1e-6)return null;
  const ext={u:a.u+Math.max(8,L*0.5),v:a.v};
  const d=dimAngAt(a,ext,b);
  if(d)d.ref=[a,ext];                            // dashed reference line along the u axis
  return d;
}
function dimsPolyline(p){ // current leg length + turn angle at the previous vertex
  if(p.length<2)return [];
  const a=p[p.length-2],b=p[p.length-1];
  const out=[dimLin(a,b)];
  const ang=p.length>=3?dimAngAt(a,p[p.length-3],b):dimAngHoriz(a,b);
  if(ang)out.push(ang);
  return out;
}
function rectSegs(a,b){
  if(Math.abs(a.u-b.u)<.01||Math.abs(a.v-b.v)<.01)return [];
  return [
    {x0:a.u,y0:a.v,x1:b.u,y1:a.v,b:0},{x0:b.u,y0:a.v,x1:b.u,y1:b.v,b:0},
    {x0:b.u,y0:b.v,x1:a.u,y1:b.v,b:0},{x0:a.u,y0:b.v,x1:a.u,y1:a.v,b:0}];
}
function arcSegs(c,s,e){
  const r=Math.hypot(s.u-c.u,s.v-c.v);
  if(r<.01)return [];
  const a0=Math.atan2(s.v-c.v,s.u-c.u);
  let a1=Math.atan2(e.v-c.v,e.u-c.u);
  while(a1<=a0)a1+=2*Math.PI;
  const sw=a1-a0;
  return [{x0:c.u+r*Math.cos(a0),y0:c.v+r*Math.sin(a0),
           x1:c.u+r*Math.cos(a1),y1:c.v+r*Math.sin(a1),b:Math.tan(sw/4)}];
}
function polySegs(c,v0,n){
  const r=Math.hypot(v0.u-c.u,v0.v-c.v);
  if(r<.01)return [];
  const a0=Math.atan2(v0.v-c.v,v0.u-c.u);
  const out=[];
  for(let i=0;i<n;i++){
    const a=a0+2*Math.PI*i/n,b=a0+2*Math.PI*(i+1)/n;
    out.push({x0:c.u+r*Math.cos(a),y0:c.v+r*Math.sin(a),x1:c.u+r*Math.cos(b),y1:c.v+r*Math.sin(b),b:0});
  }
  return out;
}
/* Slot outline = exact Minkowski of the spine with a disc: straight flanks, semicircle end
   caps and tangent arcs at outer joints, mitres at inner joints — all stored as line/bulge
   segments (single curves), never a point cloud. */
function distPtSeg2(p,a,b){
  const dx=b.u-a.u,dy=b.v-a.v,l2=dx*dx+dy*dy;
  const t=l2?Math.max(0,Math.min(1,((p.u-a.u)*dx+(p.v-a.v)*dy)/l2)):0;
  return Math.hypot(p.u-(a.u+dx*t),p.v-(a.v+dy*t));
}
function slotSegs(spine,r){
  if(!(r>0.05))return [];
  const P=[];
  for(const p of spine)if(!P.length||Math.hypot(p.u-P[P.length-1].u,p.v-P[P.length-1].v)>1e-6)P.push(p);
  if(P.length<2)return [];
  const n=P.length-1,EPSZ=1e-9;
  const D=[],Lf=[],Rt=[];
  for(let i=0;i<n;i++){
    const dx=P[i+1].u-P[i].u,dy=P[i+1].v-P[i].v,l=Math.hypot(dx,dy);
    D.push([dx/l,dy/l]);Lf.push([-dy/l,dx/l]);Rt.push([dy/l,-dx/l]);
  }
  const segs=[];
  const off=(i,N)=>[P[i].u+N[0]*r,P[i].v+N[1]*r];
  const ang=(c,p)=>Math.atan2(p[1]-c.v,p[0]-c.u);
  const pushLine=(a,b)=>{if(Math.hypot(b[0]-a[0],b[1]-a[1])>1e-9)segs.push({x0:a[0],y0:a[1],x1:b[0],y1:b[1],b:0});};
  const pushArcCCW=(ci,a,b)=>{ // CCW arc about spine point ci from a to b
    let sw=ang(P[ci],b)-ang(P[ci],a);
    while(sw<=0)sw+=2*Math.PI;while(sw>2*Math.PI)sw-=2*Math.PI;
    if(sw<1e-9||sw>2*Math.PI-1e-9)return;
    segs.push({x0:a[0],y0:a[1],x1:b[0],y1:b[1],b:Math.tan(sw/4)});
  };
  const mitre=(pA,dA,pB,dB,fallback)=>{ // intersection of two offset lines
    const den=dA[0]*dB[1]-dA[1]*dB[0];
    if(Math.abs(den)<1e-9)return fallback;
    const t=((pB[0]-pA[0])*dB[1]-(pB[1]-pA[1])*dB[0])/den;
    if(Math.abs(t)>Math.hypot(pB[0]-pA[0],pB[1]-pA[1])+4*r)return fallback; // mitre limit
    return [pA[0]+dA[0]*t,pA[1]+dA[1]*t];
  };
  // right flank forward (outline is CCW: right side → end cap → left side back → start cap)
  let cur=off(0,Rt[0]);
  for(let i=0;i<n;i++){
    const target=off(i+1,Rt[i]);
    if(i<n-1){
      const z=D[i][0]*D[i+1][1]-D[i][1]*D[i+1][0];
      if(z>EPSZ){pushLine(cur,target);pushArcCCW(i+1,target,off(i+1,Rt[i+1]));cur=off(i+1,Rt[i+1]);}
      else if(z<-EPSZ){const m=mitre(off(i,Rt[i]),D[i],off(i+1,Rt[i+1]),D[i+1],target);pushLine(cur,m);cur=m;}
      else{pushLine(cur,target);cur=target;}
    }else{pushLine(cur,target);cur=target;}
  }
  pushArcCCW(n,cur,off(n,Lf[n-1]));cur=off(n,Lf[n-1]);          // end cap
  for(let i=n-1;i>=0;i--){                                        // left flank backward
    if(i>0){
      const z=D[i-1][0]*D[i][1]-D[i-1][1]*D[i][0];
      const target=off(i,Lf[i]);
      if(z<-EPSZ){pushLine(cur,target);pushArcCCW(i,target,off(i,Lf[i-1]));cur=off(i,Lf[i-1]);}
      else if(z>EPSZ){const m=mitre(off(i,Lf[i]),D[i],off(i-1,Lf[i-1]),D[i-1],target);pushLine(cur,m);cur=m;}
      else{pushLine(cur,target);cur=target;}
    }else{pushLine(cur,off(0,Lf[0]));cur=off(0,Lf[0]);}
  }
  pushArcCCW(0,cur,off(0,Rt[0]));                                 // start cap
  return segs;
}
function toolExtra(){ // stage state: slot width from cursor, polygon side count from scroll
  if(!tool)return null;
  if(tool.T.confirmStep)return {sides:tool.sides||6};
  if(!tool.T.twoStage)return null;
  if(tool.stage!=='width')return {r:0,cur:tool.cur};
  const cur=tool.cur;
  if(!cur)return {r:tool.lastR||0,cur};
  let r=Infinity;
  for(let i=0;i<tool.pts.length-1;i++)r=Math.min(r,distPtSeg2(cur,tool.pts[i],tool.pts[i+1]));
  tool.lastR=r;
  return {r,cur};
}
function startTool(kind){
  endAllModes();
  const T=TOOLS[kind];
  if(!T)return;
  tool={kind,T,pts:[],cur:null,sides:6,stage:T.twoStage?'spine':null,
    preview(){
      if(!this.pts.length)return;
      const F=PLANES[doc.activePlane]||PLANES.XY;
      const frozen=this.stage==='width'||this.stage==='sides';
      const pts=(this.cur&&!frozen)?[...this.pts,this.cur]:this.pts;
      const extra=toolExtra();
      let segs=[];
      try{segs=T.make(pts.length>=2?pts:[pts[0],pts[0]],extra)||[];}catch(e){}
      ctx.save();ctx.setLineDash([5,4]);ctx.strokeStyle='rgba(79,216,224,.9)';ctx.lineWidth=1.4;
      for(const s of segs){
        ctx.beginPath();let st=false;
        for(const q2 of segPoly(s)){
          const q=project(V.add(F.o,V.add(V.mul(F.u,q2[0]),V.mul(F.v,q2[1]))));
          if(!q){st=false;continue;}
          if(!st){ctx.moveTo(q[0],q[1]);st=true;}else ctx.lineTo(q[0],q[1]);
        }
        ctx.stroke();
      }
      if(T.twoStage&&this.pts.length>=2){ // show the spine while sizing a polyline slot
        ctx.strokeStyle='rgba(79,216,224,.4)';
        ctx.beginPath();let st=false;
        for(const p of pts){
          const q=project(V.add(F.o,V.add(V.mul(F.u,p.u),V.mul(F.v,p.v))));
          if(!q){st=false;continue;}
          if(!st){ctx.moveTo(q[0],q[1]);st=true;}else ctx.lineTo(q[0],q[1]);
        }
        ctx.stroke();
      }
      ctx.restore();
      if(T.dims&&pts.length>=2){
        let dims=[];
        try{dims=T.dims(pts,extra)||[];}catch(e){}
        drawDims(F,dims);
      }
    }};
  promptShow(T.label,T.prompts[0]+'  ·  tool stays active — Esc / Q to stop');
  cv.style.cursor='crosshair';
  draw();
}
function toolClick(ev){
  const uv=toolUV(ev);
  if(!uv)return;
  const T=tool.T;
  if(tool.stage==='width'||tool.stage==='sides'){finishTool();return;}
  if(T.confirmStep&&tool.pts.length===1){ // polygon: vertex click → scroll-to-set-sides stage
    tool.pts.push(uv);
    tool.stage='sides';
    promptShow(T.label,T.prompts[2]+'  ·  '+(tool.sides||6)+' sides');
    draw();return;
  }
  tool.pts.push(uv);
  if(tool.kind==='polyline'){
    // clicking back on the first point closes the loop and finishes (closed by default)
    if(tool.pts.length>=3&&uv.weld&&
       Math.hypot(uv.u-tool.pts[0].u,uv.v-tool.pts[0].v)<1e-9){finishTool();return;}
    promptShow(T.label,'Click next point · first point / Enter closes');
    draw();return;
  }
  if(T.twoStage){
    promptShow(T.label,'Click next spine point · Enter / double-click, then set width');
    draw();return;
  }
  if(tool.pts.length>=T.n)finishTool();
  else promptShow(T.label,T.prompts[tool.pts.length]||'');
  draw();
}
function toolAdvance(){ // Enter / double-click
  if(!tool)return;
  if(tool.T.twoStage&&tool.stage==='spine'){
    if(tool.pts.length<2){log(tool.T.label+': need at least 2 spine points');return;}
    tool.stage='width';
    promptShow(tool.T.label,'Move to set the slot width · click / ⏎ to commit');
    draw();return;
  }
  finishTool();
}
function finishTool(){
  const T=tool.T;
  let pts=tool.pts;
  if(tool.kind==='polyline'&&pts.length>=3){
    // closed by default: weld the last point onto the first unless they already coincide
    const a=pts[0],z=pts[pts.length-1];
    if(Math.hypot(z.u-a.u,z.v-a.v)>1e-9)pts=[...pts,{u:a.u,v:a.v}];
  }
  const segs=T.make(pts,toolExtra())||[];
  if(!segs.length&&pts.length>=2)log(T.label+': degenerate — points coincide');
  if(segs.length){
    // each drawn shape becomes its own figure in the outliner: Circle001, Slot002, …
    snapshot(T.label);
    const sk={id:doc.next++,kind:'sketch',shape:tool.kind,name:figName(T.stem||T.label.replace(/\b\w/g,c=>c.toUpperCase()).replace(/\s+/g,'')),
      plane:doc.activePlane,segs,vis:true};
    doc.figures.push(sk);
    log(T.label+' → '+sk.name);
  }
  tool.pts=[];tool.cur=null;tool.lastR=0;
  tool.stage=T.twoStage?'spine':null;
  if(!T.sticky)endTool();
  else promptShow(T.label,T.prompts[0]+'  ·  Esc / Q to stop');
  refresh();
}
/* ── dimension line rendering (screen-space arrows, labels in mm) ── */
function drawDims(F,dims){
  const P2=(x,y)=>project(V.add(F.o,V.add(V.mul(F.u,x),V.mul(F.v,y))));
  ctx.save();
  ctx.setLineDash([]);ctx.lineWidth=1;ctx.strokeStyle='rgba(229,211,58,.85)';
  ctx.font='11px "JetBrains Mono",monospace';
  const label=(x,y,txt)=>{
    const w=ctx.measureText(txt).width;
    ctx.fillStyle='rgba(10,11,13,.82)';
    ctx.fillRect(x-w/2-4,y-9,w+8,15);
    ctx.fillStyle='#e5d33a';
    ctx.fillText(txt,x-w/2,y+3);
  };
  const arrow=(x,y,dx,dy)=>{
    const l=Math.hypot(dx,dy)||1;dx/=l;dy/=l;
    ctx.beginPath();ctx.moveTo(x,y);
    ctx.lineTo(x-dx*7-dy*2.5,y-dy*7+dx*2.5);
    ctx.lineTo(x-dx*7+dy*2.5,y-dy*7-dx*2.5);
    ctx.closePath();ctx.fillStyle='#e5d33a';ctx.fill();
  };
  for(const d of dims){
    if(d.kind==='lin'){
      const a=P2(d.a.u,d.a.v),b=P2(d.b.u,d.b.v);
      if(!a||!b)continue;
      if(Math.hypot(b[0]-a[0],b[1]-a[1])<14){label((a[0]+b[0])/2,(a[1]+b[1])/2-14,d.label);continue;}
      // offset the dimension line 14 px to the side of the measured span
      let nx=-(b[1]-a[1]),ny=b[0]-a[0];
      const nl=Math.hypot(nx,ny)||1;nx=nx/nl*14;ny=ny/nl*14;
      const a2=[a[0]+nx,a[1]+ny],b2=[b[0]+nx,b[1]+ny];
      ctx.beginPath();
      ctx.moveTo(a[0],a[1]);ctx.lineTo(a2[0],a2[1]);
      ctx.moveTo(b[0],b[1]);ctx.lineTo(b2[0],b2[1]);
      ctx.moveTo(a2[0],a2[1]);ctx.lineTo(b2[0],b2[1]);
      ctx.stroke();
      arrow(a2[0],a2[1],a2[0]-b2[0],a2[1]-b2[1]);
      arrow(b2[0],b2[1],b2[0]-a2[0],b2[1]-a2[1]);
      label((a2[0]+b2[0])/2,(a2[1]+b2[1])/2-10,d.label);
    }else if(d.kind==='rad'){
      const c=P2(d.c.u,d.c.v),p=P2(d.p.u,d.p.v);
      if(!c||!p)continue;
      ctx.beginPath();ctx.moveTo(c[0],c[1]);ctx.lineTo(p[0],p[1]);ctx.stroke();
      arrow(p[0],p[1],p[0]-c[0],p[1]-c[1]);
      label((c[0]+p[0])/2,(c[1]+p[1])/2-10,d.label);
    }else if(d.kind==='ang'){
      const c=P2(d.c.u,d.c.v);if(!c)continue;
      if(d.ref){ // dashed reference ray (e.g. the horizontal the angle is measured from)
        const ra=P2(d.ref[0].u,d.ref[0].v),rb=P2(d.ref[1].u,d.ref[1].v);
        if(ra&&rb){
          ctx.save();ctx.setLineDash([3,4]);ctx.strokeStyle='rgba(229,211,58,.45)';
          ctx.beginPath();ctx.moveTo(ra[0],ra[1]);ctx.lineTo(rb[0],rb[1]);ctx.stroke();
          ctx.restore();
        }
      }
      const rr=d.r*0.6;
      ctx.beginPath();
      const N=24;
      for(let i=0;i<=N;i++){
        const a=d.a0+(d.a1-d.a0)*i/N;
        const q=P2(d.c.u+rr*Math.cos(a),d.c.v+rr*Math.sin(a));
        if(!q)continue;
        if(i===0)ctx.moveTo(q[0],q[1]);else ctx.lineTo(q[0],q[1]);
      }
      ctx.stroke();
      const mid=(d.a0+d.a1)/2;
      const lp=P2(d.c.u+rr*1.25*Math.cos(mid),d.c.v+rr*1.25*Math.sin(mid));
      if(lp)label(lp[0],lp[1],d.label);
    }
  }
  ctx.restore();
}
function endTool(){tool=null;promptHide();cv.style.cursor='';draw();}

/* ═══════════════ extrude tool ═══════════════ */
let xTool=null;
function startExtrude(){
  endAllModes();
  // profile = all shapes on the plane of the selected shape (or the active plane)
  let plane=doc.activePlane;
  const selSk=selection.map(s=>fig(s.body)).find(f=>f&&f.kind==='sketch');
  if(selSk)plane=selSk.plane;
  let sks=planeSketches(plane).filter(s=>s.segs.length);
  if(!sks.length){ // fall back: any plane that has shapes
    const any=doc.figures.filter(f=>f.kind==='sketch'&&f.segs.length&&f.vis!==false);
    if(!any.length){log('extrude: draw a closed profile first');return;}
    plane=any[any.length-1].plane;sks=planeSketches(plane).filter(s=>s.segs.length);
  }
  const regs=K.profile([].concat(...sks.map(s=>s.segs)));
  if(!regs.length){log('extrude: profile is not closed');errShow('Extrude needs a closed profile — close the sketch loop first.');return;}
  xTool={sk:sks[0],sks,regs,region:0,h:20,num:''};
  // pick region under selected curve if any
  promptShow('extrude','Move to set height · type digits · click / ⏎ to commit · Esc cancel');
  cv.style.cursor='ns-resize';
  xTool.preview=()=>{
    const S=K.extrude(xTool.regs[xTool.region],frameOf(xTool.sk),xTool.h);
    const mesh=K.tessellate(S);
    ctx.save();ctx.globalAlpha=.5;
    for(const e of mesh.edges){
      ctx.strokeStyle='#4fd8e0';ctx.lineWidth=1.2;ctx.setLineDash([4,3]);
      ctx.beginPath();let st=false;
      for(const p of e.pts){const q=project(p);if(!q){st=false;continue;}
        if(!st){ctx.moveTo(q[0],q[1]);st=true;}else ctx.lineTo(q[0],q[1]);}
      ctx.stroke();
    }
    ctx.restore();
    gzHudShow('extrude',xTool.h.toFixed(1),'mm');
  };
  const F=frameOf(xTool.sk);
  xTool.move=ev=>{
    const r=cv.getBoundingClientRect();
    const ray=mouseRay(ev.clientX-r.left,ev.clientY-r.top);
    // height = closest approach of ray to the plane-normal line through region centroid
    const c0=regionCentroid(xTool.regs[xTool.region],F);
    const axis={p:c0,d:F.w};
    const h=lineParamNearRay(axis,ray);
    xTool.h=Math.max(0.5,Math.round(h/1)*1);
    draw();
  };
  xTool.commit=()=>{
    const h=xTool.h;
    snapshot('extrude');
    const b={id:doc.next++,kind:'body',name:figName('Body'),sketch:xTool.sk.id,sketches:xTool.sks.map(s=>s.id),region:xTool.region,
      h,xf:{t:[0,0,0],s:1,rz:0},edits:[],vis:true};
    doc.figures.push(b);
    selection=[{type:'body',body:b.id,key:null}];
    endExtrude();
    refresh();
    log('extrude h='+h.toFixed(1));
  };
  draw();
}
function regionCentroid(reg,F){
  let sx=0,sy=0,n=0;
  for(const loop of reg.loops)for(const s of loop){
    if(s.full){sx+=s.cx;sy+=s.cy;n++;}
    else{sx+=(s.x0+s.x1)/2;sy+=(s.y0+s.y1)/2;n++;}
  }
  return V.add(F.o,V.add(V.mul(F.u,sx/n),V.mul(F.v,sy/n)));
}
function lineParamNearRay(line,ray){
  const w=V.sub(ray.o,line.p);
  const a=V.dot(line.d,line.d),b=V.dot(line.d,ray.d),c=V.dot(ray.d,ray.d);
  const d=V.dot(line.d,w),e=V.dot(ray.d,w);
  const den=a*c-b*b;
  if(Math.abs(den)<1e-9)return 0;
  return (b*e-c*d)/den;
}
function endExtrude(){xTool=null;promptHide();hudHide();cv.style.cursor='';draw();}

/* ═══════════════ blend tool (fillet / chamfer) ═══════════════ */
let blendTool=null;
function startBlend(kind){
  endAllModes();
  blendTool={kind,stage:'pick',edge:null,body:null,d:kind==='fillet'?3:2,num:'',lastGood:null};
  promptShow(kind,'Hover a body edge and click it · then drag / type the '+(kind==='fillet'?'radius':'distance'));
  cv.style.cursor='crosshair';
  draw();
}
function blendPreview(){
  if(!blendTool||blendTool.stage!=='drag')return;
  const b=fig(blendTool.body);
  const base=bodySolid(b).solid;
  const r=K.blendEdge(base,blendTool.edge,blendTool.kind,blendTool.d);
  if(r.ok){
    blendTool.lastGood=blendTool.d;
    const mesh=K.tessellate(r.solid);
    ctx.save();
    for(const e of mesh.edges){
      ctx.strokeStyle=e.smooth?'rgba(79,216,224,.35)':'rgba(79,216,224,.95)';
      ctx.lineWidth=1.4;
      ctx.beginPath();let st=false;
      for(const p of e.pts){const q=project(p);if(!q){st=false;continue;}
        if(!st){ctx.moveTo(q[0],q[1]);st=true;}else ctx.lineTo(q[0],q[1]);}
      ctx.stroke();
    }
    ctx.restore();
    gzHudShow(blendTool.kind,blendTool.d.toFixed(2),'mm');
  }else{
    gzHudShow(blendTool.kind,blendTool.d.toFixed(2)+' ✗','mm');
  }
}
function blendClick(ev,mx,my){
  if(blendTool.stage==='pick'){
    const h=pick(mx,my,['edge']);
    if(!h||h.type!=='edge'){log(blendTool.kind+': click a body edge');return;}
    blendTool.edge=h.key;blendTool.body=h.body;blendTool.stage='drag';
    blendTool.startX=mx;blendTool.startD=blendTool.d;
    promptShow(blendTool.kind,'Drag / type the '+(blendTool.kind==='fillet'?'radius':'distance')+' · click / ⏎ apply · Esc cancel');
    draw();
    return;
  }
  blendCommit();
}
function blendCommit(){
  const b=fig(blendTool.body);
  const base=bodySolid(b).solid;
  const r=K.blendEdge(base,blendTool.edge,blendTool.kind,blendTool.d);
  if(!r.ok){errShow(blendTool.kind+' refused: '+r.msg);return;}
  snapshot(blendTool.kind);
  b.edits.push({op:'blend',kind:blendTool.kind,edge:blendTool.edge,d:blendTool.d});
  log(blendTool.kind+' '+blendTool.edge+' '+blendTool.d.toFixed(2));
  endBlend();
  refresh();
}
function endBlend(){blendTool=null;promptHide();hudHide();cv.style.cursor='';draw();}

/* ═══════════════ move / rotate / scale modal ═══════════════ */
let modal=null,gzMode='translate';
function startModal(mode){
  endAllModes(false);
  if(!selection.length){log(mode+': select something first');return;}
  const s=selection[0];
  modal={mode,sel:s,axis:null,num:'',delta:[0,0,0],val:0,start:null};
  if(s.type==='body'){
    const b=fig(s.body);
    if(!b)return endModal();
  }
  promptShow(mode,'Move the mouse · X/Y/Z lock axis · type an exact value · click / ⏎ confirm · Esc cancel');
  modal.preview=()=>{
    if(modal.mode==='translate')gzHudShow(axLabel()+' move',fmtDelta(),'mm');
    else if(modal.mode==='scale')gzHudShow('scale',(1+modal.val).toFixed(3),'×');
    else gzHudShow('Z rotate',(modal.val*180/Math.PI).toFixed(1),'°');
  };
  draw();
}
function axLabel(){return modal.axis?['X','Y','Z'][modal.axis]:'view';}
function fmtDelta(){return V.len(modal.delta).toFixed(2);}
function modalMove(ev,mx,my){
  if(!modal.start){modal.start=[mx,my];return;}
  const dx=mx-modal.start[0],dy=my-modal.start[1];
  const s=selection[0];
  const anchor=selAnchor(s);
  const scale=pxScale(anchor);
  if(modal.mode==='translate'){
    const {right,up}=camBasis();
    let d=V.add(V.mul(right,dx*scale),V.mul(up,-dy*scale));
    if(modal.axis!=null){
      const ax=[[1,0,0],[0,1,0],[0,0,1]][modal.axis];
      d=V.mul(ax,V.dot(d,ax));
    }
    if(ev.ctrlKey||ev.metaKey)d=d.map(x=>Math.round(x/5)*5);
    modal.delta=d;
    applyModalPreview();
  }else if(modal.mode==='scale'){
    modal.val=dx*0.005;
    if(ev.ctrlKey||ev.metaKey)modal.val=Math.round(modal.val/0.1)*0.1;
    applyModalPreview();
  }else{
    modal.val=dx*0.01;
    if(ev.ctrlKey||ev.metaKey)modal.val=Math.round(modal.val/(5*Math.PI/180))*(5*Math.PI/180);
    applyModalPreview();
  }
  draw();
}
function selAnchor(s){
  if(s.type==='body'){
    const b=fig(s.body);const {mesh}=bodySolid(b);
    if(!mesh||!mesh.positions.length)return cam.target;
    let c=[0,0,0];for(const p of mesh.positions)c=V.add(c,p);
    return V.mul(c,1/mesh.positions.length);
  }
  return cam.target;
}
let modalPreviewSolid=null;
function applyModalPreview(){
  modalPreviewSolid=null;
  const s=modal.sel;
  if(s.type==='curve'){return;} // curves commit on confirm
  const b=fig(s.body);
  if(!b||b.kind!=='body')return;
  const base=bodySolid(b).solid;
  if(!base)return;
  let r=null;
  if(s.type==='body'){
    if(modal.mode==='translate')r=K.transform(base,{t:modal.delta});
    else if(modal.mode==='scale')r=K.transform(base,{s:Math.max(0.05,1+modal.val)});
    else{const cz=Math.cos(modal.val),sz=Math.sin(modal.val);
      const a=selAnchor(s);
      let t=K.transform(base,{t:V.neg(a)});
      t=K.transform(t.solid,{r:[[cz,-sz,0],[sz,cz,0],[0,0,1]]});
      r=K.transform(t.solid,{t:a});}
  }else if(modal.mode==='translate'){
    if(s.type==='face')r=K.moveFace(base,s.key,modal.delta);
    else if(s.type==='edge')r=K.moveEdge(base,s.key,modal.delta);
    else if(s.type==='vertex')r=K.moveVertex(base,s.key,modal.delta);
  }
  if(r&&r.ok)modalPreviewSolid=r.solid;
  else if(r&&!r.ok)modal.err=r.msg;
}
function modalConfirm(){
  const s=modal.sel;
  if(s.type==='curve'){
    const sk=fig(s.body),seg=sk.segs[s.key];
    if(modal.mode==='translate'&&seg){
      const F=frameOf(sk);
      const du=V.dot(modal.delta,F.u),dv=V.dot(modal.delta,F.v);
      snapshot('move curve');
      if(seg.full){seg.cx+=du;seg.cy+=dv;}
      else{seg.x0+=du;seg.y0+=dv;seg.x1+=du;seg.y1+=dv;}
    }
    endModal();refresh();return;
  }
  const b=fig(s.body);
  if(!b)return endModal();
  snapshot(modal.mode);
  if(s.type==='body'){
    if(modal.mode==='translate')b.xf.t=V.add(b.xf.t,modal.delta);
    else if(modal.mode==='scale')b.xf.s=Math.max(0.05,b.xf.s*(1+modal.val));
    else b.xf.rz=(b.xf.rz||0)+modal.val;
    // note: rotate about origin composed with translate is approximate for placed bodies;
    // exact enough for the prototype placement chain (rz then s then t)
  }else{
    const ed=modal.mode==='translate'?
      (s.type==='face'?{op:'moveFace',face:s.key,delta:modal.delta}:
       s.type==='edge'?{op:'moveEdge',edge:s.key,delta:modal.delta}:
                       {op:'moveVertex',vert:s.key,delta:modal.delta}):null;
    if(ed){
      // validate against current solid before storing
      const base=bodySolid(b).solid;
      const r=s.type==='face'?K.moveFace(base,s.key,modal.delta):
              s.type==='edge'?K.moveEdge(base,s.key,modal.delta):
                              K.moveVertex(base,s.key,modal.delta);
      if(!r.ok){errShow('move refused: '+r.msg);undoStack.pop();endModal();return;}
      b.edits.push(ed);
    }
  }
  endModal();
  refresh();
}
function endModal(){modal=null;modalPreviewSolid=null;promptHide();hudHide();draw();}
function endAllModes(clearSel){
  if(tool)endTool();
  if(xTool)endExtrude();
  if(blendTool)endBlend();
  if(modal)endModal();
}

/* ═══════════════ hud / prompt / err ═══════════════ */
function promptShow(t,txt){$('#prompt').classList.add('show');$('#promptTool').textContent=t;$('#promptTxt').textContent=txt;}
function promptHide(){$('#prompt').classList.remove('show');}
function gzHudShow(label,val,unit){
  const el=$('#gzHud');
  el.classList.add('show');
  el.innerHTML=`<span class="lab">${label}</span><b>${val}</b><span class="unit">${unit}</span>`;
}
function hudHide(){$('#gzHud').classList.remove('show');}
let errT=null;
function errShow(msg){
  const el=$('#errBar');
  el.textContent=msg;el.style.display='block';
  clearTimeout(errT);errT=setTimeout(()=>{el.style.display='none';},5000);
}
const logLines=[];
function log(s){logLines.push(s);if(logLines.length>40)logLines.shift();renderInspector();}

/* ═══════════════ pointer & keys ═══════════════ */
let drag=null;
cv.addEventListener('pointerdown',ev=>{
  const r=cv.getBoundingClientRect();
  const mx=ev.clientX-r.left,my=ev.clientY-r.top;
  if(ev.button===2)return;
  if(modal){if(ev.button===0)modalConfirm();return;}
  if(blendTool){blendClick(ev,mx,my);return;}
  if(xTool){xTool.commit();return;}
  if(tool){toolClick(ev);return;}
  drag={mx,my,az:cam.az,el:cam.el,t:cam.target.slice(),pan:ev.shiftKey,moved:false,btn:ev.button};
  cv.setPointerCapture(ev.pointerId);
});
cv.addEventListener('pointermove',ev=>{
  const r=cv.getBoundingClientRect();
  const mx=ev.clientX-r.left,my=ev.clientY-r.top;
  $('#cx').textContent=' ';$('#cy').textContent=' ';$('#cz').textContent=' ';
  const ray=mouseRay(mx,my),hit=rayPlane(ray,PLANES[doc.activePlane]);
  if(hit){$('#cx').textContent=hit.p[0].toFixed(1);$('#cy').textContent=hit.p[1].toFixed(1);$('#cz').textContent=hit.p[2].toFixed(1);}
  if(modal){modalMove(ev,mx,my);return;}
  if(blendTool){
    if(blendTool.stage==='pick'){hover=pick(mx,my,['edge']);draw();}
    else{blendTool.d=Math.max(0.1,blendTool.startD+(mx-blendTool.startX)*pxScale()*0.5);
      if(ev.ctrlKey||ev.metaKey)blendTool.d=Math.round(blendTool.d*2)/2;
      draw();blendPreview();}
    return;
  }
  if(xTool){xTool.move(ev);return;}
  if(tool){tool.cur=toolUV(ev);draw();return;}
  if(drag){
    const dx=mx-drag.mx,dy=my-drag.my;
    if(Math.abs(dx)+Math.abs(dy)>3)drag.moved=true;
    if(drag.pan){
      const {right,up}=camBasis();
      const s=pxScale();
      cam.target=V.add(drag.t,V.add(V.mul(right,-dx*s),V.mul(up,dy*s)));
    }else{
      cam.az=drag.az-dx*0.008;
      cam.el=Math.max(-1.55,Math.min(1.55,drag.el+dy*0.008));
    }
    updateCamPill();draw();
    return;
  }
  hover=pick(mx,my,wantOrder());
  cv.style.cursor=hover?'pointer':'';
  draw();
});
cv.addEventListener('pointerup',ev=>{
  if(!drag)return;
  const r=cv.getBoundingClientRect();
  const mx=ev.clientX-r.left,my=ev.clientY-r.top;
  if(!drag.moved&&drag.btn===0){
    const h=pick(mx,my,wantOrder());
    if(h){
      const it={type:h.type,body:h.body,key:h.key};
      if(ev.shiftKey){
        const i=selection.findIndex(s=>s.type===it.type&&s.body===it.body&&s.key===it.key);
        if(i>=0)selection.splice(i,1);else selection.push(it);
      }else selection=[it];
    }else if(!ev.shiftKey)selection=[];
    rebuildSelFaces();
    refresh();
  }
  drag=null;
});
cv.addEventListener('wheel',ev=>{
  ev.preventDefault();
  if(tool&&tool.stage==='sides'){ // polygon confirm step: scroll sets the side count
    tool.sides=Math.max(3,Math.min(24,(tool.sides||6)-Math.sign(ev.deltaY)));
    promptShow(tool.T.label,tool.T.prompts[2]+'  ·  '+tool.sides+' sides');
    draw();return;
  }
  cam.dist=Math.max(20,Math.min(3000,cam.dist*(ev.deltaY>0?1.1:0.9)));
  updateCamPill();draw();
},{passive:false});
cv.addEventListener('dblclick',()=>{if(tool&&(tool.kind==='polyline'||tool.T.twoStage))toolAdvance();});
cv.addEventListener('contextmenu',ev=>{ev.preventDefault();toggleCat();});
function updateCamPill(){
  $('#camPill').textContent=`orbit · az ${(cam.az*180/Math.PI).toFixed(0)}° · el ${(cam.el*180/Math.PI).toFixed(0)}°`;
  $('#vname').textContent=cam.ortho?'Orthographic':'Perspective';
}
window.addEventListener('keydown',ev=>{
  const tag=(ev.target.tagName||'').toLowerCase();
  if(tag==='input'||tag==='textarea')return;
  const k=ev.key;
  if(k==='Escape'){
    if(modal)return endModal();
    if(blendTool)return endBlend();
    if(xTool)return endExtrude();
    if(tool)return endTool();
    selection=[];rebuildSelFaces();refresh();return;
  }
  if(modal){
    if(k==='x'||k==='X'){modal.axis=modal.axis===0?null:0;applyModalPreview();draw();return;}
    if(k==='y'||k==='Y'){modal.axis=modal.axis===1?null:1;applyModalPreview();draw();return;}
    if(k==='z'||k==='Z'){modal.axis=modal.axis===2?null:2;applyModalPreview();draw();return;}
    if(k==='Enter')return modalConfirm();
    if(/^[0-9.\-]$/.test(k)){
      modal.num+=k;
      const n=parseFloat(modal.num);
      if(!isNaN(n)){
        if(modal.mode==='translate'){
          const ax=modal.axis==null?0:modal.axis;
          modal.delta=[0,0,0];modal.delta[ax]=n;
          applyModalPreview();
        }else if(modal.mode==='scale'){modal.val=n-1;applyModalPreview();}
        else{modal.val=n*Math.PI/180;applyModalPreview();}
        draw();
      }
      return;
    }
  }
  if(blendTool&&blendTool.stage==='drag'){
    if(k==='Enter')return blendCommit();
    if(/^[0-9.]$/.test(k)){blendTool.num+=k;const n=parseFloat(blendTool.num);if(n>0){blendTool.d=n;draw();blendPreview();}return;}
    if(k==='Backspace'){blendTool.num='';return;}
  }
  if(xTool){
    if(k==='Enter')return xTool.commit();
    if(/^[0-9.]$/.test(k)){xTool.num+=k;const n=parseFloat(xTool.num);if(n>0){xTool.h=n;draw();}return;}
  }
  if(tool&&k==='Enter')return toolAdvance();
  if(ev.ctrlKey||ev.metaKey){
    if(k==='z'&&!ev.shiftKey){ev.preventDefault();return undo();}
    if(k==='z'&&ev.shiftKey||k==='y'){ev.preventDefault();return redo();}
    if(k==='s'){ev.preventDefault();return saveJson();}
    if(k==='o'){ev.preventDefault();return openJson();}
    return;
  }
  switch(k){
    case '1':setMode('body');break;
    case '2':setMode('face');break;
    case '3':setMode('edge');break;
    case '4':setMode('vertex');break;
    case '5':cam.ortho=!cam.ortho;syncViewSeg();updateCamPill();draw();break;
    case 'q':case 'Q':endAllModes();break;
    case 'l':startTool('line');break;
    case 'L':startTool('polyline');break;
    case 'r':startTool('rect');break;
    case 'R':startModal('rotate');break;
    case 'c':case 'C':startTool('circle');break;
    case 'a':case 'A':startTool('arc');break;
    case 'p':startTool('polygon');break;
    case 'P':startTool('slot');break;
    case 'e':startExtrude();break;
    case 'E':startTool('ellipse');break;
    case 'b':startBlend('fillet');break;
    case 'B':startBlend('chamfer');break;
    case 'g':case 'G':startModal('translate');break;
    case 's':case 'S':startModal('scale');break;
    case 'f':case 'F':frameSel();break;
    case 'h':case 'H':hideSel(ev.altKey);break;
    case 'Tab':ev.preventDefault();toggleCat();break;
    case 'Delete':case 'Backspace':deleteSel();break;
  }
});
function setMode(m){selMode=m;$$('#selMode button').forEach(b=>b.classList.toggle('on',b.dataset.m===m));draw();}
function frameSel(){
  let pts=[];
  const bodies=selection.filter(s=>s.type==='body').map(s=>fig(s.body));
  const list=bodies.length?bodies:doc.figures.filter(f=>f.kind==='body');
  for(const b of list){const {mesh}=bodySolid(b);if(mesh)pts=pts.concat(mesh.positions);}
  if(!pts.length){cam.target=[20,15,10];cam.dist=260;draw();return;}
  let lo=[1e9,1e9,1e9],hi=[-1e9,-1e9,-1e9];
  for(const p of pts)for(let i=0;i<3;i++){lo[i]=Math.min(lo[i],p[i]);hi[i]=Math.max(hi[i],p[i]);}
  cam.target=V.mul(V.add(lo,hi),.5);
  cam.dist=Math.max(60,V.dist(lo,hi)*1.6);
  draw();
}
function hideSel(unhideAll){
  if(unhideAll){doc.figures.forEach(f=>f.vis=true);refresh();return;}
  for(const s of selection){const f=fig(s.body);if(f)f.vis=false;}
  selection=[];refresh();
}
function deleteSel(){
  if(!selection.length)return;
  snapshot('delete');
  const curveDel=new Map();
  for(const s of selection){
    if(s.type==='curve'){
      (curveDel.get(s.body)||curveDel.set(s.body,[]).get(s.body)).push(s.key);
    }else if(s.type==='body'||s.type==='sketch'||s.key==null){
      const f=fig(s.body);
      if(f)doc.figures=doc.figures.filter(x=>x.id!==f.id);
    }
  }
  for(const [skId,idxs] of curveDel){
    const sk=fig(skId);
    if(sk)sk.segs=sk.segs.filter((_,i)=>!idxs.includes(i));
  }
  selection=[];
  refresh();
}

/* ═══════════════ outliner ═══════════════ */
function renderOutliner(){
  const tree=$('#tree');
  const sketches=doc.figures.filter(f=>f.kind==='sketch');
  const bodies=doc.figures.filter(f=>f.kind==='body');
  const q=($('#q').value||'').toLowerCase();
  const eye=f=>`<span class="eye" data-eye="${f.id}">${f.vis===false?'◡':'👁'}</span>`;
  const shapeIco=sk=>`<svg class="i" viewBox="0 0 24 24" style="width:13px;height:13px">${CAT_ICONS[sk.shape]||CAT_ICONS.polyline}</svg>`;
  let html='';
  html+=`<div class="grp"><div class="grp-h"><span class="car">▾</span>Shapes<span class="cnt">${sketches.length}</span></div><div class="kids">`;
  for(const sk of sketches){
    if(q&&!sk.name.toLowerCase().includes(q))continue;
    const sel=selection.some(s=>s.body===sk.id&&s.type!=='curve');
    html+=`<div class="row ${sel?'sel':''} ${sk.vis===false?'hid':''}" data-fig="${sk.id}">
      <span class="ico" style="--acc:var(--cyan)">${shapeIco(sk)}</span>
      <span class="txt"><span class="name">${sk.name}</span><span class="meta">${sk.plane} · ${sk.segs.length} crv</span></span>${eye(sk)}</div>`;
  }
  html+='</div></div>';
  html+=`<div class="grp"><div class="grp-h"><span class="car">▾</span>Bodies<span class="cnt">${bodies.length}</span></div><div class="kids">`;
  for(const b of bodies){
    if(q&&!b.name.toLowerCase().includes(q))continue;
    const sel=selection.some(s=>s.type==='body'&&s.body===b.id);
    const st=b.err?`<span class="st warn" title="${b.err}">!</span>`:'';
    html+=`<div class="row ${sel?'sel':''} ${b.vis===false?'hid':''}" data-fig="${b.id}">
      <span class="ico" style="--acc:var(--orange)">◼</span>
      <span class="txt"><span class="name">${b.name}</span><span class="meta">h ${b.h} · ${(b.edits||[]).length} edit</span></span>${st}${eye(b)}</div>`;
  }
  html+='</div></div>';
  tree.innerHTML=html;
  $('#tFig').textContent=doc.figures.length;
  $('#tSel').textContent=selection.length;
  $('#tSelS').textContent=selection.length?selection[0].type:'none';
  $$('#tree .row').forEach(r=>{
    r.onclick=ev=>{
      if(ev.target.dataset.eye){
        const f=fig(+ev.target.dataset.eye);
        f.vis=f.vis===false;
        refresh();return;
      }
      const f=fig(+r.dataset.fig);
      const it={type:f.kind==='body'?'body':'sketch',body:f.id,key:null};
      if(ev.shiftKey)selection.push(it);else selection=[it];
      rebuildSelFaces();refresh();
    };
  });
}

/* ═══════════════ inspector ═══════════════ */
/* ── exact 2-D properties (analytic: chords + circular-segment corrections, never sampled) ── */
function segLen(s){
  if(s.full)return 2*Math.PI*s.r;
  const ch=Math.hypot(s.x1-s.x0,s.y1-s.y0);
  if(!s.b)return ch;
  const sw=4*Math.atan(s.b);
  return Math.abs(sw)*ch/(2*Math.sin(Math.abs(sw)/2));
}
function loopAreaExact(loop){
  if(loop[0]&&loop[0].full)return Math.PI*loop[0].r*loop[0].r*(loop[0].ccw===false?-1:1);
  let a=0;
  for(const s of loop){
    a+=(s.x0*s.y1-s.x1*s.y0)/2;                      // chord shoelace
    if(s.b){const sw=4*Math.atan(s.b);const A=KM.arcOf(s);
      a+=A.r*A.r/2*(sw-Math.sin(sw));}               // circular segment (signed by sweep)
  }
  return a;
}
function regionProps(reg){
  let area=0,per=0;
  reg.loops.forEach((loop,i)=>{
    const a=loopAreaExact(loop);
    area+=i===0?Math.abs(a):-Math.abs(a);            // outer adds, holes subtract
    for(const s of loop)per+=segLen(s);
  });
  return {area,per};
}
function curveProps(sk,i){
  const s=sk.segs[i];
  if(!s)return [];
  if(s.full)return [
    ['type','circle'],['centre',fmtMm(s.cx)+', '+fmtMm(s.cy)],
    ['radius',fmtMm(s.r)+' mm'],['diameter',fmtMm(2*s.r)+' mm'],
    ['circumference',fmtMm(2*Math.PI*s.r)+' mm'],['area',fmtNum(Math.PI*s.r*s.r)+' mm²']];
  if(!s.b){
    const L=Math.hypot(s.x1-s.x0,s.y1-s.y0);
    return [['type','line'],['length',fmtMm(L)+' mm'],
      ['angle',(Math.atan2(s.y1-s.y0,s.x1-s.x0)*180/Math.PI).toFixed(1)+'°'],
      ['start',fmtMm(s.x0)+', '+fmtMm(s.y0)],['end',fmtMm(s.x1)+', '+fmtMm(s.y1)]];
  }
  const A=KM.arcOf(s),sw=4*Math.atan(s.b);
  return [['type','arc'],['radius',fmtMm(A.r)+' mm'],
    ['sweep',(Math.abs(sw)*180/Math.PI).toFixed(1)+'° '+(sw>0?'CCW':'CW')],
    ['arc length',fmtMm(segLen(s))+' mm'],['centre',fmtMm(A.cx)+', '+fmtMm(A.cy)],
    ['chord',fmtMm(Math.hypot(s.x1-s.x0,s.y1-s.y0))+' mm']];
}
function bodyBBox(b){
  const {mesh}=bodySolid(b);
  if(!mesh||!mesh.positions.length)return null;
  const lo=[1/0,1/0,1/0],hi=[-1/0,-1/0,-1/0];
  for(const p of mesh.positions)for(let i=0;i<3;i++){if(p[i]<lo[i])lo[i]=p[i];if(p[i]>hi[i])hi[i]=p[i];}
  return {lo,hi,dim:V.sub(hi,lo)};
}
function surfProps(f){
  const s=f.surf;
  if(s.t==='plane')return [['surface','plane'],['normal',s.n.map(x=>x.toFixed(2)).join(', ')]];
  if(s.t==='cyl')return [['surface','cylinder'],['radius',fmtMm(s.r)+' mm'],['axis',s.a.map(x=>x.toFixed(2)).join(', ')]];
  if(s.t==='cone')return [['surface','cone'],['base radius',fmtMm(s.r)+' mm'],['half-angle',(Math.atan(Math.abs(s.k))*180/Math.PI).toFixed(1)+'°']];
  if(s.t==='torus')return [['surface','torus'],['ring R',fmtMm(s.R)+' mm'],['tube r',fmtMm(s.r)+' mm']];
  return [['surface',s.t]];
}
function edgeProps(e){
  const c=e.crv;
  const out=[];
  if(c.t==='line'){
    out.push(['curve','line']);
    if(e.v0!=null)out.push(['length',fmtMm(e.t1-e.t0)+' mm']);
  }else if(c.t==='circ'){
    out.push(['curve','circle'],['radius',fmtMm(c.r)+' mm'],['diameter',fmtMm(2*c.r)+' mm']);
    const sw=e.v0==null?2*Math.PI:e.t1-e.t0;
    out.push(['sweep',(sw*180/Math.PI).toFixed(1)+'°'],['arc length',fmtMm(sw*c.r)+' mm']);
  }else out.push(['curve','traced intersection']);
  if(e.smooth)out.push(['joint','tangent (smooth)']);
  return out;
}
function propRows(pairs){
  return `<div class="sec"><div class="sec-head">Properties<span class="hint">${pairs.length}</span></div>
    <div class="sec-body">${pairs.map(([k,v])=>
      `<div class="ctl half"><div class="ctl-top"><span class="lab">${k}</span></div><div class="ctl-top"><span class="val" style="font-size:11.5px">${v}</span></div></div>`).join('')}
    </div></div>`;
}
function renderInspector(){
  const el=$('#insp');
  const badge=$('#inspBadge');
  const consoleHtml=`<div class="console">${logLines.slice(-8).map(l=>`<div><span class="p">›</span> ${l}</div>`).join('')||'<span class="p">›</span> ready'}</div>`;
  const first=selection[0];
  if(!first){
    badge.textContent='nothing selected';
    const nb=doc.figures.filter(f=>f.kind==='body').length;
    el.innerHTML=`<div class="empty"><b>Nothing selected</b>Draw a profile (R rectangle · C circle · L line), then E to extrude.<br>B fillet · ⇧B chamfer · G move · S scale.</div>${consoleHtml}`;
    return;
  }
  const f=fig(first.body);
  if(!f){el.innerHTML='';return;}
  /* sub-entity selection: show the entity's own analytic properties */
  if(first.type==='face'||first.type==='edge'||first.type==='vertex'){
    const b=f,{solid}=bodySolid(b);
    badge.textContent=first.type+' · '+(b.name||'');
    let pairs=[['key',String(first.key)]];
    if(solid){
      if(first.type==='face'){const fc=K.faceByKey(solid,first.key);if(fc)pairs=pairs.concat(surfProps(fc),[['loops',String(fc.loops.length)]]);}
      else if(first.type==='edge'){const e=K.edgeByKey(solid,first.key);if(e)pairs=pairs.concat(edgeProps(e));}
      else{const v=K.vertByKey(solid,first.key);if(v)pairs.push(['position',v.p.map(x=>fmtMm(x)).join(', ')]);}
    }
    el.innerHTML=`
      <div class="hero" style="--acc:var(--violet)">
        <div class="c-top"><span class="ico">◇</span><span class="t"><span class="n">${first.type}</span><span class="m">${b.name} · ${selection.length} selected</span></span></div>
      </div>
      ${propRows(pairs)}
      ${first.type==='edge'?'<div class="actions"><button class="abtn" data-act="fil">fillet (B)</button><button class="abtn" data-act="cha">chamfer (⇧B)</button></div>':''}
      ${consoleHtml}`;
    el.querySelectorAll('[data-act]').forEach(x=>x.onclick=()=>startBlend(x.dataset.act==='fil'?'fillet':'chamfer'));
    return;
  }
  if(first.type==='curve'&&f.kind==='sketch'){
    badge.textContent='curve · '+f.name;
    el.innerHTML=`
      <div class="hero" style="--acc:var(--cyan)">
        <div class="c-top"><span class="ico">◠</span><span class="t"><span class="n">curve ${first.key}</span><span class="m">${f.name} · plane ${f.plane}</span></span></div>
      </div>
      ${propRows(curveProps(f,first.key))}
      <div class="actions"><button class="abtn danger" data-act="del">delete curve</button></div>
      ${consoleHtml}`;
    const dl=el.querySelector('[data-act=del]');
    if(dl)dl.onclick=()=>{snapshot('delete curve');f.segs.splice(first.key,1);selection=[];refresh();};
    return;
  }
  if(f.kind==='body'){
    badge.textContent=f.name;
    const {solid}=bodySolid(f);
    const m=solid?K.measure(solid):null;
    const bb=bodyBBox(f);
    const bodyProps=[];
    if(m)bodyProps.push(['volume',fmtNum(m.volume)+' mm³'],['surface area',fmtNum(m.area)+' mm²']);
    if(bb)bodyProps.push(['size',bb.dim.map(x=>fmtMm(x)).join(' × ')+' mm'],
                         ['centre',V.mul(V.add(bb.lo,bb.hi),.5).map(x=>fmtMm(x)).join(', ')]);
    bodyProps.push(['placement',(f.xf&&f.xf.t||[0,0,0]).map(x=>fmtMm(x)).join(', ')+
      (f.xf&&f.xf.s!==1?' · ×'+f.xf.s.toFixed(2):'')+(f.xf&&f.xf.rz?' · '+(f.xf.rz*180/Math.PI).toFixed(0)+'°':'')]);
    const err=f.err?`<div class="li warn"><span class="dot"></span><span class="t">${f.err}</span></div>`:'';
    const edits=(f.edits||[]).map((e,i)=>`<div class="li ${e.failed?'warn':''}"><span class="dot"></span>
      <span class="t">${e.op==='blend'?e.kind+' '+e.edge+' · '+e.d.toFixed(2):e.op}</span>
      <span class="ib" data-editx="${i}">×</span></div>`).join('');
    el.innerHTML=`
      <div class="hero" style="--acc:var(--orange)">
        <div class="c-top"><span class="ico">◼</span><span class="t"><span class="n">${f.name}</span><span class="m">analytic B-rep body</span></span></div>
        <div class="big"><span class="v">${m?fmtNum(m.volume):'—'}</span><span class="u">mm³</span><span class="lab">volume</span></div>
        <div class="side">
          <div><span class="k">faces</span><span class="v2">${m?m.faces:'—'}</span></div>
          <div><span class="k">edges</span><span class="v2">${m?m.edges+' ('+m.tangentEdges+' tan)':''}</span></div>
          <div><span class="k">verts</span><span class="v2">${m?m.verts:'—'}</span></div>
        </div>
      </div>
      ${err}
      ${propRows(bodyProps)}
      <div class="sec"><div class="sec-head">Extrude<span class="hint">${fig(f.sketch)?fig(f.sketch).name:'?'}</span></div>
        <div class="sec-body">
          <div class="ctl"><div class="ctl-top"><span class="lab">height</span><span class="val">${f.h.toFixed(1)}<small>mm</small></span></div>
            <div class="trk-bar" data-h style="--p:${Math.min(100,f.h)}%"><div class="ticks"></div><div class="fill"></div><div class="thumb"></div></div></div>
        </div></div>
      <div class="sec"><div class="sec-head">Edge edits<span class="hint">${(f.edits||[]).length}</span></div>
        <div class="sec-body"><div class="ctl"><div class="list">${edits||'<div class="li"><span class="t">none — press B / ⇧B on an edge</span></div>'}</div></div></div></div>
      <div class="actions"><button class="abtn" data-act="dup">duplicate</button><button class="abtn danger" data-act="del">delete</button></div>
      ${consoleHtml}`;
    el.querySelectorAll('[data-editx]').forEach(x=>x.onclick=()=>{
      snapshot('remove edit');
      f.edits.splice(+x.dataset.editx,1);
      f.edits.forEach(e=>delete e.failed);
      refresh();
    });
    const trk=el.querySelector('[data-h]');
    if(trk)trk.onpointerdown=e0=>{
      trk.setPointerCapture(e0.pointerId);
      snapshot('height');
      const r=trk.getBoundingClientRect();
      const set=e=>{
        const p=Math.max(0.02,Math.min(1,(e.clientX-r.left)/r.width));
        f.h=Math.round(p*100);
        trk.style.setProperty('--p',(p*100)+'%');
        draw();
      };
      set(e0);
      trk.onpointermove=set;
      trk.onpointerup=()=>{trk.onpointermove=null;refresh();};
    };
    el.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{
      if(b.dataset.act==='del'){snapshot('delete');doc.figures=doc.figures.filter(x=>x.id!==f.id);selection=[];refresh();}
      else{snapshot('duplicate');const c=JSON.parse(JSON.stringify(f));c.id=doc.next++;c.name=figName('Body');c.xf.t=V.add(c.xf.t,[15,15,0]);doc.figures.push(c);refresh();}
    });
  }else{
    badge.textContent=f.name;
    const regs=profileOf(f);
    let area=0,per=0;
    const regRows=regs.map((rg,i)=>{
      const p=regionProps(rg);area+=p.area;per+=p.per;
      return `<div class="li"><span class="dot"></span><span class="t">region ${i+1}${rg.loops.length>1?' · '+(rg.loops.length-1)+' hole'+(rg.loops.length>2?'s':''):''}</span>
        <span class="m">${fmtNum(p.area)} mm²</span></div>`;
    }).join('');
    const skProps=[['curves',String(f.segs.length)],['closed regions',String(regs.length)],
      ['total area',fmtNum(area)+' mm²'],['perimeter',fmtMm(per)+' mm'],['plane',f.plane]];
    el.innerHTML=`
      <div class="hero" style="--acc:var(--cyan)">
        <div class="c-top"><span class="ico">✎</span><span class="t"><span class="n">${f.name}</span><span class="m">sketch · plane ${f.plane}</span></span></div>
        <div class="big"><span class="v">${fmtNum(area)}</span><span class="u">mm²</span><span class="lab">${regs.length} closed region${regs.length===1?'':'s'}</span></div>
      </div>
      ${propRows(skProps)}
      ${regs.length?`<div class="sec"><div class="sec-head">Regions<span class="hint">${regs.length}</span></div>
        <div class="sec-body"><div class="ctl"><div class="list">${regRows}</div></div></div></div>`:''}
      <div class="actions"><button class="abtn" data-act="ext">extrude (E)</button><button class="abtn danger" data-act="del">delete</button></div>
      ${consoleHtml}`;
    el.querySelectorAll('[data-act]').forEach(b=>b.onclick=()=>{
      if(b.dataset.act==='del'){snapshot('delete');doc.figures=doc.figures.filter(x=>x.id!==f.id);selection=[];refresh();}
      else startExtrude();
    });
  }
}
function fmtNum(n){
  if(Math.abs(n)>=1e6)return (n/1e6).toFixed(2)+'M';
  if(Math.abs(n)>=1e4)return (n/1e3).toFixed(1)+'k';
  return n.toFixed(1);
}

/* ═══════════════ catalogue ═══════════════ */
/* per-tool icons — simple line glyphs of the actual shape */
const CAT_ICONS={
  line:'<line x1="4" y1="20" x2="20" y2="4"/>',
  polyline:'<polyline points="3,20 9,10 14,15 21,4"/>',
  rect:'<rect x="4" y="6" width="16" height="12" rx="1"/>',
  crect:'<rect x="4" y="6" width="16" height="12" rx="1"/><line x1="12" y1="10.5" x2="12" y2="13.5"/><line x1="10.5" y1="12" x2="13.5" y2="12"/>',
  circle:'<circle cx="12" cy="12" r="8"/>',
  ellipse:'<ellipse cx="12" cy="12" rx="9" ry="5.5"/>',
  arc:'<path d="M4 19 A 14 14 0 0 1 19 5"/>',
  polygon:'<polygon points="12,3.5 19.5,8 19.5,16 12,20.5 4.5,16 4.5,8"/>',
  slot:'<rect x="3" y="8.5" width="18" height="7" rx="3.5"/>',
  pslot:'<path d="M4.5 17.5 L 10 8.5 A 2.6 2.6 0 0 1 14.5 8.5 L 19.5 17"/><path d="M9 20 L 12.3 14.4 M 17 19.5 L 15.4 16.7" stroke-opacity=".55"/>',
  extrude:'<rect x="6" y="12" width="12" height="8"/><path d="M6 12 L12 6 L18 12 M12 6 L12 2 M9.5 4.5 L12 2 L14.5 4.5" stroke-dasharray="0"/>',
  fillet:'<path d="M4 20 L4 10 A 6 6 0 0 1 10 4 L 20 4"/>',
  chamfer:'<path d="M4 20 L4 11 L11 4 L20 4"/>',
  box:'<path d="M4 8.5 L12 4 L20 8.5 L20 16 L12 20.5 L4 16 Z M4 8.5 L12 13 L20 8.5 M12 13 L12 20.5"/>',
  cyl:'<ellipse cx="12" cy="6.5" rx="7" ry="3"/><path d="M5 6.5 L5 17.5 A 7 3 0 0 0 19 17.5 L19 6.5"/>',
};
const CAT=[
  ['Sketch Draw',[
    ['line','Line','L'],['polyline','Polyline','⇧L'],['rect','Rectangle','R'],['crect','Centre rect',''],
    ['circle','Circle','C'],['ellipse','Ellipse','⇧E'],['arc','Arc','A'],['polygon','Polygon','p'],
    ['slot','Slot','P'],['pslot','Polyline slot','']]],
  ['Solid',[
    ['extrude','Extrude','E'],['fillet','Fillet','B'],['chamfer','Chamfer','⇧B'],
    ['box','Box',''],['cyl','Cylinder','']]],
];
function buildCat(){
  const grid=$('#catGrid'),rail=$('#catRail');
  rail.innerHTML=CAT.map((g,i)=>`<div class="rail-item ${i===0?'on':''}" data-g="${i}">${g[0]}</div>`).join('');
  const show=i=>{
    grid.innerHTML=CAT[i][1].map(t=>`<div class="tile" data-t="${t[0]}"><span class="t-key">${t[2]}</span><svg class="i" viewBox="0 0 24 24">${CAT_ICONS[t[0]]||'<rect x="4" y="4" width="16" height="16" rx="2"/>'}</svg><span class="t-lbl">${t[1]}</span></div>`).join('');
    grid.querySelectorAll('.tile').forEach(tl=>tl.onclick=()=>{catAction(tl.dataset.t);toggleCat(false);});
  };
  rail.querySelectorAll('.rail-item').forEach(r=>r.onclick=()=>{
    rail.querySelectorAll('.rail-item').forEach(x=>x.classList.remove('on'));
    r.classList.add('on');show(+r.dataset.g);
  });
  show(0);
  $('#catHead').innerHTML='<span class="ttl"><span class="dot"></span>Construct</span><span class="sp"></span>';
  $('#catFoot').innerHTML='<span>double-click a tile — or press its key in the viewport</span>';
}
function catAction(t){
  if(TOOLS[t])return startTool(t);
  if(t==='extrude')return startExtrude();
  if(t==='fillet')return startBlend('fillet');
  if(t==='chamfer')return startBlend('chamfer');
  if(t==='box')return cmdRun('box 40 30 20');
  if(t==='cyl')return cmdRun('cylinder 12 30');
}
function toggleCat(force){
  const c=$('#cat');
  const show=force!==undefined?force:!c.classList.contains('show');
  c.classList.toggle('show',show);
  if(show){
    const vp=$('#viewport').getBoundingClientRect();
    c.style.left=(vp.left+40)+'px';c.style.top=(vp.top+60)+'px';
  }
}

/* ═══════════════ command line ═══════════════ */
function cmdRun(line){
  const parts=line.trim().split(/\s+/);
  const c=parts[0];
  const num=i=>parseFloat(parts[i]);
  if(c==='box'){
    const w=num(1)||40,d=num(2)||30,h=num(3)||20;
    snapshot('box');
    const sk={id:doc.next++,kind:'sketch',shape:'rect',name:figName('Rect'),plane:'XY',segs:rectSegs({u:0,v:0},{u:w,v:d}),vis:true};
    doc.figures.push(sk);
    const b={id:doc.next++,kind:'body',name:figName('Body'),sketch:sk.id,sketches:[sk.id],region:0,h,xf:{t:[0,0,0],s:1,rz:0},edits:[],vis:true};
    doc.figures.push(b);
    selection=[{type:'body',body:b.id,key:null}];
    refresh();log(`box ${w} ${d} ${h}`);
  }else if(c==='cylinder'||c==='cyl'){
    const r=num(1)||12,h=num(2)||30;
    snapshot('cylinder');
    const sk={id:doc.next++,kind:'sketch',shape:'circle',name:figName('Circle'),plane:'XY',segs:[{cx:0,cy:0,r,full:true}],vis:true};
    doc.figures.push(sk);
    const b={id:doc.next++,kind:'body',name:figName('Body'),sketch:sk.id,sketches:[sk.id],region:0,h,xf:{t:[0,0,0],s:1,rz:0},edits:[],vis:true};
    doc.figures.push(b);
    selection=[{type:'body',body:b.id,key:null}];
    refresh();log(`cylinder ${r} ${h}`);
  }else if(c==='extrude'){startExtrude();}
  else if(c==='chamfer'||c==='fillet'){
    const d=num(1);
    const sel=selection.filter(s=>s.type==='edge');
    if(!sel.length||!d){startBlend(c);return;}
    const byBody=new Map();
    sel.forEach(s=>{(byBody.get(s.body)||byBody.set(s.body,[]).get(s.body)).push(s.key);});
    snapshot(c);
    let done=0;
    for(const [bid,keys] of byBody){
      const b=fig(bid);
      let base=bodySolid(b).solid;
      for(const k of keys){
        const r=K.blendEdge(base,k,c,d);
        if(r.ok){base=r.solid;b.edits.push({op:'blend',kind:c,edge:k,d});done++;}
        else errShow(c+' '+k+' refused: '+r.msg);
      }
    }
    log(`${c} ${d} on ${done} edge(s)`);
    refresh();
  }
  else if(c==='clear'){snapshot('clear');doc.figures=[];selection=[];refresh();}
  else if(c==='demo'){demoScene();}
  else if(c==='hide'){hideSel(false);}
  else if(c==='show'){hideSel(true);}
  else if(c==='view'){const v=parts[1];if(VIEWS[v])setView(v);}
  else log('unknown: '+c+' · try box · cylinder · extrude · fillet 2 · chamfer 1 · clear · demo');
}
$('#cmdIn').addEventListener('keydown',ev=>{
  if(ev.key==='Enter'){cmdRun(ev.target.value);ev.target.value='';}
  ev.stopPropagation();
});

/* ═══════════════ views & top bar ═══════════════ */
const VIEWS={top:{az:-90,el:89.9},front:{az:-90,el:0},right:{az:0,el:0},iso:{az:45,el:30}};
function setView(v){
  const a=VIEWS[v];
  cam.az=a.az*Math.PI/180;cam.el=a.el*Math.PI/180;
  $$('#views button').forEach(b=>b.classList.toggle('on',b.dataset.v===v));
  updateCamPill();draw();
}
$$('#views button').forEach(b=>b.onclick=()=>{
  if(b.dataset.v==='ortho'){cam.ortho=!cam.ortho;syncViewSeg();updateCamPill();draw();return;}
  setView(b.dataset.v);
});
function syncViewSeg(){$('#orthoBtn').classList.toggle('on',cam.ortho);}
$$('#selMode button').forEach(b=>b.onclick=()=>setMode(b.dataset.m));
$$('#shade button').forEach(b=>b.onclick=()=>{
  shade=b.dataset.s;
  $$('#shade button').forEach(x=>x.classList.toggle('on',x===b));
  draw();
});
$$('#gzMode button').forEach(b=>b.onclick=()=>{
  gzMode=b.dataset.g;
  $$('#gzMode button').forEach(x=>x.classList.toggle('on',x===b));
  startModal(gzMode);
});
$('#catBtn').onclick=()=>toggleCat();
$('#q').addEventListener('input',renderOutliner);

/* ═══════════════ save / open / start ═══════════════ */
function saveJson(){
  const blob=new Blob([JSON.stringify(doc,null,1)],{type:'application/json'});
  const a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='solidarc.json';a.click();
}
function openJson(){
  const inp=document.createElement('input');
  inp.type='file';inp.accept='.json';
  inp.onchange=()=>{
    const f=inp.files[0];if(!f)return;
    const rd=new FileReader();
    rd.onload=()=>{try{doc=JSON.parse(rd.result);selection=[];undoStack=[];refresh();log('opened '+f.name);}catch(e){errShow('not a SolidArc document');}};
    rd.readAsText(f);
  };
  inp.click();
}
$('#dSave').onclick=saveJson;
$('#dOpen').onclick=openJson;
$('#dNew').onclick=()=>{newDoc();refresh();};
$('#dHist').onclick=()=>log(undoStack.length+' undo step(s)');
function demoScene(){
  newDoc();
  cmdRun('box 40 30 20');
  const b=doc.figures.find(f=>f.kind==='body');
  b.edits.push({op:'blend',kind:'fillet',edge:'es:0:1',d:6});
  b.edits.push({op:'blend',kind:'chamfer',edge:'et:0:0',d:3});
  cmdRun('cylinder 10 26');
  const b2=doc.figures.filter(f=>f.kind==='body')[1];
  b2.xf.t=[62,15,0];
  b2.edits.push({op:'blend',kind:'fillet',edge:'et:0:0',d:3});
  selection=[];
  refresh();frameSel();
  log('demo scene');
}
function boot(){
  const saved=(()=>{try{return localStorage.getItem('solidarc2.doc');}catch(e){return null;}})();
  const isDemo=/\?demo/.test(location.search);
  newDoc();
  if(isDemo){demoScene();}
  else if(saved){
    $('#start').classList.add('show');
    $('#startInfo').textContent='A previous document is in autosave.';
    $('#startCont').onclick=()=>{try{doc=JSON.parse(saved);}catch(e){}$('#start').classList.remove('show');refresh();frameSel();};
    $('#startNew').onclick=()=>{$('#start').classList.remove('show');refresh();};
    $('#startOpen').onclick=()=>{$('#start').classList.remove('show');openJson();};
    $('#startHist').onclick=()=>{$('#start').classList.remove('show');};
  }
  buildCat();
  resize();
  window.addEventListener('resize',resize);
  $('#dBuild').textContent='kernel v2 · analytic B-rep';
  $('#vmeta').textContent='analytic B-rep · Z-up · lattice 5 mm';
  refresh();
  updateCamPill();
}
function refresh(){
  // patch preview solid into draw path: simplest is cache override
  if(modal&&modalPreviewSolid){/* handled during modal by drawing preview edges */}
  renderOutliner();
  renderInspector();
  rebuildSelFaces();
  autosave();
  draw();
}
/* modal preview drawing: overlay dashes of the preview solid */
const _draw=draw;
draw=function(){
  _draw();
  if(modal&&modalPreviewSolid){
    const mesh=K.tessellate(modalPreviewSolid);
    ctx.save();
    for(const e of mesh.edges){
      ctx.strokeStyle=e.smooth?'rgba(255,180,84,.3)':'rgba(255,180,84,.95)';
      ctx.lineWidth=1.4;ctx.setLineDash([5,4]);
      ctx.beginPath();let st=false;
      for(const p of e.pts){const q=project(p);if(!q){st=false;continue;}
        if(!st){ctx.moveTo(q[0],q[1]);st=true;}else ctx.lineTo(q[0],q[1]);}
      ctx.stroke();
    }
    ctx.restore();
  }
};
boot();
/* verification hook (used by Verification/ui_smoke.js and later by the C++ console host) */
window.__SolidArcPanel={
  get doc(){return doc;}, set doc(d){doc=d;refresh();},
  get selection(){return selection;}, set selection(s){selection=s;rebuildSelFaces();refresh();},
  bodySolid:b=>bodySolid(b), fig, cmdRun, pick, startBlend, startExtrude, startTool, startModal,
  get blendTool(){return blendTool;}, blendCommit, snapshot, refresh, undo, redo, cam, draw:()=>draw(),
  get tool(){return tool;}, toolUV, mouseRay, rayPlane, project, frameOf, PLANES, TOOLS, slotSegs,
  build:'shapes-as-figures r4 (ellipse, icons)',
};
console.log('SolidArc panel build: shapes-as-figures r4 (ellipse, icons)');
