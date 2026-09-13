/* ============================================================================================
   SolidArc kernel — analytic boundary-representation prototype (JS mirror of the C++ Kernel/).

   This is NOT polygon modelling. Every face carries an exact surface (plane, cylinder, cone,
   torus), every edge an exact curve (line, circle) with parameters, and every operation is
   topology surgery + surface/surface intersection. Tessellation happens only for display.

   Operations
     • profile(segs)                — chain 2-D segments (with arc bulges) into nested regions
     • extrude(region, frame, h)    — one face per profile segment: line→plane, arc→cylinder
     • blend(solid, edgeKey, …)     — chamfer / fillet of ONE edge (plus its tangent chain).
                                      Rails offset on the two adjacent faces only; at a sharp
                                      end vertex the blend is closed against the cross face
                                      (classic result: chamfer one cube edge ⇒ the two end
                                      caps each gain exactly one edge — nothing propagates
                                      around the loop, direction always outward-correct).
     • offsetFace / moveEdge / moveVertex — local tweaks: surfaces move, all touched edges are
                                      re-derived by surface∩surface, vertices by curve∩curve.
     • transform / scale            — exact similarity; non-uniform scale only where every
                                      surface stays representable (planar solids), else Refusal.

   Every mutating op validates the shell afterwards (each edge used exactly twice with opposite
   sense, loops vertex-connected) and rolls back with a message on failure — fail-fast.
   ============================================================================================ */
(function(root){
'use strict';
const EPS=1e-7, TOL=1e-5;
/* ------------------------------------------------ small vector kit ------------------------ */
const add=(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a,s)=>[a[0]*s,a[1]*s,a[2]*s];
const neg=a=>[-a[0],-a[1],-a[2]];
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const dist=(a,b)=>len(sub(a,b));
const norm=a=>{const l=len(a);return l<EPS?[0,0,1]:[a[0]/l,a[1]/l,a[2]/l];};
const lerp=(a,b,t)=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
function axisFrame(n){ // orthonormal (u,v) completing unit n
  const h=Math.abs(n[0])<.9?[1,0,0]:[0,1,0];
  const u=norm(cross(h,n)); return [u,cross(n,u)];
}
function solve3(m,b){ // 3x3 linear solve, m row-major
  const [a,b1,c,d,e,f,g,h,i]=m;
  const det=a*(e*i-f*h)-b1*(d*i-f*g)+c*(d*h-e*g);
  if(Math.abs(det)<1e-12)return null;
  return [ (b[0]*(e*i-f*h)-b1*(b[1]*i-f*b[2])+c*(b[1]*h-e*b[2]))/det,
           (a*(b[1]*i-f*b[2])-b[0]*(d*i-f*g)+c*(d*b[2]-b[1]*g))/det,
           (a*(e*b[2]-b[1]*h)-b1*(d*b[2]-b[1]*g)+b[0]*(d*h-e*g))/det ];
}
/* ------------------------------------------------ curves ---------------------------------- */
// line   {t:'line', p, d}                point(t)=p+d·t (d unit)
// circ   {t:'circ', c, a, x, r}          y=a×x, point(θ)=c+r(cosθ·x+sinθ·y), CCW around a
const lineC=(p,d)=>({t:'line',p:p.slice(),d:norm(d)});
const circC=(c,a,x,r)=>({t:'circ',c:c.slice(),a:norm(a),x:norm(x),r});
const polyC=pts=>({t:'poly',pts:pts.map(p=>p.slice())}); // traced intersection curve, param = index
function crvPt(c,t){
  if(c.t==='line')return add(c.p,mul(c.d,t));
  if(c.t==='poly'){
    const n=c.pts.length-1,tc=Math.max(0,Math.min(n,t)),i=Math.min(n-1,Math.floor(tc));
    return lerp(c.pts[i],c.pts[i+1],tc-i);
  }
  const y=cross(c.a,c.x);
  return add(c.c,add(mul(c.x,c.r*Math.cos(t)),mul(y,c.r*Math.sin(t))));
}
function crvTan(c,t){
  if(c.t==='line')return c.d;
  if(c.t==='poly'){
    const n=c.pts.length-1,i=Math.max(0,Math.min(n-1,Math.floor(t)));
    return norm(sub(c.pts[i+1],c.pts[i]));
  }
  const y=cross(c.a,c.x);
  return norm(add(mul(c.x,-Math.sin(t)),mul(y,Math.cos(t))));
}
function crvParam(c,p,hint){
  if(c.t==='line')return dot(sub(p,c.p),c.d);
  if(c.t==='poly'){
    let best=0,bd=Infinity;
    for(let i=0;i<c.pts.length-1;i++){
      const a=c.pts[i],d=sub(c.pts[i+1],a),l2=dot(d,d);
      const f=l2?Math.max(0,Math.min(1,dot(sub(p,a),d)/l2)):0;
      const q=add(a,mul(d,f)),dd=dist(p,q);
      if(dd<bd){bd=dd;best=i+f;}
    }
    return best;
  }
  const y=cross(c.a,c.x), d=sub(p,c.c);
  let th=Math.atan2(dot(d,y),dot(d,c.x));
  if(hint!==undefined){while(th<hint-Math.PI)th+=2*Math.PI;while(th>hint+Math.PI)th-=2*Math.PI;}
  return th;
}
function crvClosest(c,p){ // param of closest point
  if(c.t==='line')return dot(sub(p,c.p),c.d);
  return crvParam(c,p);
}
/* ------------------------------------------------ surfaces -------------------------------- */
// plane {t:'plane', o, n}                        cyl  {t:'cyl',  c, a, x, r}
// cone  {t:'cone',  c, a, x, r, k}  r(h)=r+k·h   torus{t:'torus',c, a, x, R, r}
const planeS=(o,n)=>({t:'plane',o:o.slice(),n:norm(n)});
const cylS=(c,a,r,x)=>({t:'cyl',c:c.slice(),a:norm(a),x:x?norm(x):axisFrame(norm(a))[0],r});
const coneS=(c,a,r,k,x)=>({t:'cone',c:c.slice(),a:norm(a),x:x?norm(x):axisFrame(norm(a))[0],r,k});
const torusS=(c,a,R,r,x)=>({t:'torus',c:c.slice(),a:norm(a),x:x?norm(x):axisFrame(norm(a))[0],R,r});
function surfN(s,p){ // natural (un-sensed) unit normal at a point assumed on the surface
  if(s.t==='plane')return s.n;
  const d=sub(p,s.c), h=dot(d,s.a), rad=sub(d,mul(s.a,h)), e=norm(rad);
  if(s.t==='cyl')return e;
  if(s.t==='cone')return norm(sub(e,mul(s.a,s.k)));
  // torus: from tube centre ring
  const ring=add(s.c,add(mul(e,s.R),[0,0,0]));
  return norm(sub(p,ring));
}
function surfDist(s,p){ // signed-ish scalar, zero on surface — used by numeric solvers
  if(s.t==='plane')return dot(sub(p,s.o),s.n);
  const d=sub(p,s.c), h=dot(d,s.a), rad=sub(d,mul(s.a,h)), rl=len(rad);
  if(s.t==='cyl')return rl-s.r;
  if(s.t==='cone')return rl-(s.r+s.k*h);
  return Math.hypot(rl-s.R,h)-s.r; // torus
}
function surfGrad(s,p){ // numeric gradient of surfDist
  const e=1e-6,g=[0,0,0];
  for(let i=0;i<3;i++){const q=p.slice();q[i]+=e;const q2=p.slice();q2[i]-=e;
    g[i]=(surfDist(s,q)-surfDist(s,q2))/(2*e);}
  return g;
}
function surfUV(s,p,hint){ // parameter pair, hint unwraps angles
  if(s.t==='plane'){const[u,v]=s.uv||(s.uv=axisFrame(s.n));const d=sub(p,s.o);return [dot(d,u),dot(d,v)];}
  const d=sub(p,s.c), h=dot(d,s.a), y=cross(s.a,s.x);
  let th=Math.atan2(dot(d,y),dot(d,s.x));
  if(hint){while(th<hint[0]-Math.PI)th+=2*Math.PI;while(th>hint[0]+Math.PI)th-=2*Math.PI;}
  if(s.t==='cyl'||s.t==='cone')return [th,h];
  const rad=sub(d,mul(s.a,h)), rl=len(rad);
  let ph=Math.atan2(h,rl-s.R);
  if(hint){while(ph<hint[1]-Math.PI)ph+=2*Math.PI;while(ph>hint[1]+Math.PI)ph-=2*Math.PI;}
  return [th,ph];
}
function surfPt(s,uv){
  if(s.t==='plane'){const[u,v]=s.uv||(s.uv=axisFrame(s.n));
    return add(s.o,add(mul(u,uv[0]),mul(v,uv[1])));}
  const y=cross(s.a,s.x), e=add(mul(s.x,Math.cos(uv[0])),mul(y,Math.sin(uv[0])));
  if(s.t==='cyl')return add(s.c,add(mul(e,s.r),mul(s.a,uv[1])));
  if(s.t==='cone')return add(s.c,add(mul(e,s.r+s.k*uv[1]),mul(s.a,uv[1])));
  return add(s.c,add(mul(e,s.R+s.r*Math.cos(uv[1])),mul(s.a,s.r*Math.sin(uv[1]))));
}
function surfNuv(s,uv){
  if(s.t==='plane')return s.n;
  const y=cross(s.a,s.x), e=add(mul(s.x,Math.cos(uv[0])),mul(y,Math.sin(uv[0])));
  if(s.t==='cyl')return e;
  if(s.t==='cone')return norm(sub(e,mul(s.a,s.k)));
  return norm(add(mul(e,Math.cos(uv[1])),mul(s.a,Math.sin(uv[1]))));
}
/* ------------------------------------------------ intersections --------------------------- */
function isectPP(p1,p2,hint){ // plane∩plane → line
  const d=cross(p1.n,p2.n); if(len(d)<1e-9)return null;
  const dn=norm(d);
  // point: solve dot(q,n1)=dot(o1,n1), dot(q,n2)=…, dot(q,dn)=dot(hint||o1,dn)
  const h=hint||p1.o;
  const q=solve3([p1.n[0],p1.n[1],p1.n[2], p2.n[0],p2.n[1],p2.n[2], dn[0],dn[1],dn[2]],
                 [dot(p1.o,p1.n),dot(p2.o,p2.n),dot(h,dn)]);
  return q?lineC(q,dn):null;
}
function surfSurf(s1,s2,hint){ // → curve or null. hint = point near wanted branch.
  if(s1.t==='plane'&&s2.t==='plane')return isectPP(s1,s2,hint);
  if(s2.t==='plane')return surfSurf(s2,s1,hint);
  if(s1.t!=='plane')return null;             // only plane∩quadric analytic here
  const pl=s1,q=s2,ca=Math.abs(dot(pl.n,q.a));
  if(q.t==='cyl'){
    if(ca>1-1e-6){ // circle at the plane's height
      const h=dot(sub(pl.o,q.c),q.a), c=add(q.c,mul(q.a,h));
      return circC(c,q.a,q.x,q.r);
    }
    if(ca<1e-6){ // plane parallel to axis → 0/1/2 lines; take the one nearest hint
      const w=sub(q.c,pl.o), d0=dot(w,pl.n);            // signed axis distance to plane
      if(Math.abs(d0)>q.r+TOL)return null;
      const s=Math.sqrt(Math.max(0,q.r*q.r-d0*d0));
      const foot=sub(q.c,mul(pl.n,d0));
      const side=norm(cross(q.a,pl.n));
      const l1=lineC(add(foot,mul(side,s)),q.a), l2=lineC(add(foot,mul(side,-s)),q.a);
      if(!hint)return l1;
      const d1=len(cross(sub(hint,l1.p),l1.d)), d2=len(cross(sub(hint,l2.p),l2.d));
      return d1<=d2?l1:l2;
    }
    return null;
  }
  if(q.t==='cone'&&ca>1-1e-6){
    const h=dot(sub(pl.o,q.c),q.a), r=q.r+q.k*h;
    if(r<=TOL)return null;
    return circC(add(q.c,mul(q.a,h)),q.a,q.x,r);
  }
  if(q.t==='torus'&&ca>1-1e-6){
    const h=dot(sub(pl.o,q.c),q.a);
    if(Math.abs(h)>q.r+TOL)return null;
    const w=Math.sqrt(Math.max(0,q.r*q.r-h*h));
    const c=add(q.c,mul(q.a,h));
    const cOut=circC(c,q.a,q.x,q.R+w), cIn=circC(c,q.a,q.x,Math.max(TOL,q.R-w));
    if(!hint)return cOut;
    return Math.abs(surfDistCirc(cOut,hint))<=Math.abs(surfDistCirc(cIn,hint))?cOut:cIn;
  }
  return null;
}
function surfDistCirc(c,p){ // distance from point to circle curve
  const d=sub(p,c.c),h=dot(d,c.a),rad=sub(d,mul(c.a,h));
  return Math.hypot(len(rad)-c.r,h);
}
function projectBoth(s1,s2,p){ // Newton-project a point onto s1∩s2
  for(let it=0;it<30;it++){
    const f1=surfDist(s1,p),f2=surfDist(s2,p);
    if(Math.abs(f1)<1e-10&&Math.abs(f2)<1e-10)break;
    const g1=surfGrad(s1,p),g2=surfGrad(s2,p);
    // least-norm step solving g1·dp=−f1, g2·dp=−f2
    const a=dot(g1,g1),b=dot(g1,g2),c=dot(g2,g2);
    const det=a*c-b*b;if(Math.abs(det)<1e-14)break;
    const l1=(-f1*c+f2*b)/det,l2=(-f2*a+f1*b)/det;
    p=add(p,add(mul(g1,l1),mul(g2,l2)));
  }
  return p;
}
function traceCurve(s1,s2,pA,pB){ // marched s1∩s2 curve from pA to pB → poly curve
  pA=projectBoth(s1,s2,pA);pB=projectBoth(s1,s2,pB);
  const total=dist(pA,pB);if(total<1e-9)return null;
  const step=Math.max(total/64,1e-4);
  const pts=[pA];let p=pA;
  let dir=norm(cross(surfGrad(s1,p),surfGrad(s2,p)));
  if(dot(dir,sub(pB,pA))<0)dir=neg(dir);
  for(let i=0;i<400;i++){
    const remain=dist(p,pB);
    if(remain<=step*1.2){pts.push(pB);return polyC(pts);}
    let t=norm(cross(surfGrad(s1,p),surfGrad(s2,p)));
    if(dot(t,dir)<0)t=neg(t);
    const q=projectBoth(s1,s2,add(p,mul(t,step)));
    if(dist(q,p)<step*1e-3)return null; // stalled
    dir=norm(sub(q,p));p=q;pts.push(p);
    if(dist(p,pA)>total*3)return null;  // ran away
  }
  return null;
}
function crvSurf(crv,surf,hintP){ // curve∩surface near hint → {t,p} or null
  if(crv.t==='line'&&surf.t==='plane'){
    const dn=dot(crv.d,surf.n); if(Math.abs(dn)<1e-9)return null;
    const t=dot(sub(surf.o,crv.p),surf.n)/dn; return {t,p:crvPt(crv,t)};
  }
  // numeric: sample, pick sign change / minimum near hint, refine by bisection+secant
  const t0=crvClosest(crv,hintP);
  const span=crv.t==='line'?Math.max(10,dist(crv.p,hintP)+10):Math.PI;
  let best=null;
  const N=96;
  let pt=null,pd=0;
  for(let i=0;i<=N;i++){
    const t=t0-span+2*span*i/N, d=surfDist(surf,crvPt(crv,t));
    if(i>0&&pd*d<=0&&(pd!==0||d!==0)){
      let a=pt,b=t,fa=pd;
      for(let k=0;k<60;k++){const m=(a+b)/2,fm=surfDist(surf,crvPt(crv,m));
        if(fa*fm<=0){b=m;}else{a=m;fa=fm;}}
      const t2=(a+b)/2,p2=crvPt(crv,t2);
      const score=dist(p2,hintP);
      if(!best||score<best.score)best={t:t2,p:p2,score};
    }
    pt=t;pd=d;
  }
  return best;
}
function crvCrv(c1,c2,hintP){ // curve∩curve near hint → point or null
  if(c1.t==='circ'&&c2.t==='line')return crvCrv(c2,c1,hintP);
  if(c1.t==='line'&&c2.t==='circ'){
    // coplanar line∩circle: analytic quadratic with tangency clamp
    const c=c2,l=c1;
    if(Math.abs(dot(l.d,c.a))<1e-7&&Math.abs(dot(sub(l.p,c.c),c.a))<1e-4){
      const f=sub(l.p,c.c);
      const b=dot(f,l.d),cc=dot(f,f)-c.r*c.r;
      let disc=b*b-cc;
      if(disc<0){if(disc>-c.r*c.r*1e-5)disc=0;else return null;}
      const s=Math.sqrt(disc);
      const p1=crvPt(l,-b+s),p2=crvPt(l,-b-s);
      return dist(p1,hintP)<=dist(p2,hintP)?p1:p2;
    }
  }
  if(c1.t==='circ'&&c2.t==='circ'&&Math.abs(dot(c1.a,c2.a))>1-1e-7
     &&Math.abs(dot(sub(c2.c,c1.c),c1.a))<1e-4){
    // coplanar circle∩circle with tangency clamp
    const dvec=sub(c2.c,c1.c),d=len(dvec);
    if(d<1e-9)return null;
    const u=norm(dvec),vperp=norm(cross(c1.a,u));
    let a=(c1.r*c1.r-c2.r*c2.r+d*d)/(2*d);
    let h2=c1.r*c1.r-a*a;
    if(h2<0){if(h2>-c1.r*c1.r*1e-5)h2=0;else return null;}
    const h=Math.sqrt(h2);
    const m=add(c1.c,mul(u,a));
    const p1=add(m,mul(vperp,h)),p2=add(m,mul(vperp,-h));
    return dist(p1,hintP)<=dist(p2,hintP)?p1:p2;
  }
  if(c1.t==='line'&&c2.t==='line'){
    const n=cross(c1.d,c2.d);
    if(len(n)<1e-9)return null;
    // closest points on the two lines; accept if they nearly touch
    const w=sub(c2.p,c1.p);
    const a=dot(c1.d,c1.d),b=dot(c1.d,c2.d),c=dot(c2.d,c2.d),d=dot(c1.d,w),e=dot(c2.d,w);
    const den=a*c-b*b; if(Math.abs(den)<1e-12)return null;
    const s=(d*c-b*e)/den,t=(a*e-b*d)/den;
    const p1=crvPt(c1,s),p2=crvPt(c2,t);
    if(dist(p1,p2)>1e-3)return null;
    return lerp(p1,p2,.5);
  }
  // alternating closest-point projection
  let t=crvClosest(c1,hintP);
  for(let i=0;i<80;i++){
    const p=crvPt(c1,t), u=crvClosest(c2,p), q=crvPt(c2,u);
    const t2=crvClosest(c1,q);
    if(Math.abs(t2-t)<1e-12){t=t2;break;}
    t=t2;
  }
  const p=crvPt(c1,t),q=crvPt(c2,crvClosest(c2,p));
  if(dist(p,q)>1e-3)return null;
  return lerp(p,q,.5);
}
function solvePoint(surfs,hint){ // point on all surfaces (Newton), planes give exact solve
  let p=hint.slice();
  for(let it=0;it<40;it++){
    const F=surfs.map(s=>surfDist(s,p));
    if(Math.max(...F.map(Math.abs))<1e-10)break;
    const G=surfs.map(s=>surfGrad(s,p));
    let m,b;
    if(surfs.length>=3){m=[...G[0],...G[1],...G[2]];b=[-F[0],-F[1],-F[2]];}
    else return null;
    const dp=solve3(m,b); if(!dp)return null;
    p=add(p,dp);
    if(len(dp)<1e-12)break;
  }
  return surfs.every(s=>Math.abs(surfDist(s,p))<1e-6)?p:null;
}
/* ------------------------------------------------ topology -------------------------------- */
function newSolid(){return {nv:0,ne:0,nf:0,verts:{},edges:{},faces:{}};}
function addV(S,p,key){const id=++S.nv;S.verts[id]={id,p:p.slice(),key:key||('v'+id)};return id;}
function addE(S,crv,v0,v1,key,smooth){
  const id=++S.ne;
  let t0=0,t1=0;
  if(v0==null){t0=0;t1=2*Math.PI;}
  else{
    t0=crvParam(crv,S.verts[v0].p);
    t1=crvParam(crv,S.verts[v1].p,crv.t==='circ'?t0+1e-9:undefined);
    if(crv.t==='circ'&&t1<=t0+1e-9)t1+=2*Math.PI;
  }
  S.edges[id]={id,crv,v0:v0??null,v1:v1??null,t0,t1,key:key||('e'+id),smooth:!!smooth};
  return id;
}
function addF(S,surf,sense,loops,key){const id=++S.nf;S.faces[id]={id,surf,sense,loops,key:key||('f'+id)};return id;}
function edgeUses(S){ // eid → [{f,li,ei,fwd}]
  const m={};
  for(const f of Object.values(S.faces))
    f.loops.forEach((L,li)=>L.forEach((en,ei)=>{
      (m[en.e]||(m[en.e]=[])).push({f:f.id,li,ei,fwd:en.fwd});
    }));
  return m;
}
function faceOutN(S,f,p){const n=surfN(f.surf,p);return f.sense>0?n:neg(n);}
function edgeByKey(S,key){for(const e of Object.values(S.edges))if(e.key===key)return e;return null;}
function faceByKey(S,key){for(const f of Object.values(S.faces))if(f.key===key)return f;return null;}
function vertByKey(S,key){for(const v of Object.values(S.verts))if(v.key===key)return v;return null;}
function edgeMidT(e){return (e.t0+e.t1)/2;}
function edgeEndV(e,end){return end===0?e.v0:e.v1;} // end 0 = t0 side
function refreshParams(S,eid){
  const e=S.edges[eid];
  if(e.v0==null)return;
  e.t0=crvParam(e.crv,S.verts[e.v0].p);
  e.t1=crvParam(e.crv,S.verts[e.v1].p,e.crv.t==='circ'?e.t0+1e-9:undefined);
  if(e.crv.t==='circ'&&e.t1<=e.t0+1e-9)e.t1+=2*Math.PI;
}
function validate(S){
  const msgs=[];
  const uses=edgeUses(S);
  for(const e of Object.values(S.edges)){
    const u=uses[e.id]||[];
    if(S.shell){ // open shell: rim edges legitimately used once
      if(u.length<1||u.length>2)msgs.push(`edge ${e.key} used ${u.length}× (need 1–2)`);
      else if(u.length===2&&u[0].fwd===u[1].fwd)msgs.push(`edge ${e.key} used twice with the same sense`);
    }else{
      if(u.length!==2)msgs.push(`edge ${e.key} used ${u.length}× (need 2)`);
      else if(u[0].fwd===u[1].fwd)msgs.push(`edge ${e.key} used twice with the same sense`);
    }
  }
  for(const f of Object.values(S.faces))
    for(const L of f.loops){
      for(let i=0;i<L.length;i++){
        const a=S.edges[L[i].e],b=S.edges[L[(i+1)%L.length].e];
        if(!a||!b){msgs.push(`face ${f.key} refers to a dead edge`);continue;}
        if(a.v0==null)continue; // closed edge is its own loop
        const tail=L[i].fwd?a.v1:a.v0, head=L[(i+1)%L.length].fwd?b.v0:b.v1;
        if(tail!==head)msgs.push(`face ${f.key} loop breaks between ${a.key} and ${b.key}`);
      }
    }
  return {ok:msgs.length===0,msgs};
}
/* ------------------------------------------------ 2-D profile ----------------------------- */
// segment {x0,y0,x1,y1,b}  b = bulge = tan(sweep/4), + = CCW.  Full circle {cx,cy,r,full:true}
function segPts(s,n){ // polygonize one segment (excluding the end point)
  if(s.full){
    const pts=[];const N=n||48;
    for(let i=0;i<N;i++){const a=2*Math.PI*i/N;pts.push([s.cx+s.r*Math.cos(a),s.cy+s.r*Math.sin(a)]);}
    return pts;
  }
  if(!s.b)return [[s.x0,s.y0]];
  const sw=4*Math.atan(s.b);
  const N=Math.max(2,Math.ceil(Math.abs(sw)/(Math.PI/24)));
  const {cx,cy,r,a0}=arcOf(s);
  const pts=[];
  for(let i=0;i<N;i++){const a=a0+sw*i/N;pts.push([cx+r*Math.cos(a),cy+r*Math.sin(a)]);}
  return pts;
}
function arcOf(s){ // centre/radius/start-angle of a bulged segment
  const sw=4*Math.atan(s.b);
  const L=Math.hypot(s.x1-s.x0,s.y1-s.y0);
  const r=L/(2*Math.sin(Math.abs(sw)/2));
  const mx=(s.x0+s.x1)/2,my=(s.y0+s.y1)/2;
  const dx=(s.x1-s.x0)/L,dy=(s.y1-s.y0)/L;
  const h=Math.sqrt(Math.max(0,r*r-L*L/4))*(Math.abs(sw)>Math.PI?-1:1);
  // centre on the left of the chord for CCW (b>0)
  const sgn=s.b>0?1:-1;
  const cx=mx-dy*h*sgn, cy=my+dx*h*sgn;
  const a0=Math.atan2(s.y0-cy,s.x0-cx);
  return {cx,cy,r,a0,sw:sw};
}
function loopArea(loop){ // signed area of a closed seg loop
  let pts=[];
  for(const s of loop)pts=pts.concat(segPts(s));
  let a=0;
  for(let i=0;i<pts.length;i++){const p=pts[i],q=pts[(i+1)%pts.length];a+=p[0]*q[1]-q[0]*p[1];}
  return a/2;
}
function ptInLoop(pt,loop){
  let pts=[];for(const s of loop)pts=pts.concat(segPts(s));
  let inside=false;
  for(let i=0,j=pts.length-1;i<pts.length;j=i++){
    const yi=pts[i][1],yj=pts[j][1],xi=pts[i][0],xj=pts[j][0];
    if((yi>pt[1])!==(yj>pt[1])&&pt[0]<(xj-xi)*(pt[1]-yi)/(yj-yi)+xi)inside=!inside;
  }
  return inside;
}
function reverseLoop(loop){
  if(loop.length===1&&loop[0].full)return loop;
  return loop.slice().reverse().map(s=>({x0:s.x1,y0:s.y1,x1:s.x0,y1:s.y0,b:-s.b}));
}
function profile(segs){ // free segments → regions [{loops:[outer,holes…]}]
  const tol=1e-4, loops=[], used=new Array(segs.length).fill(false);
  // full circles are loops of their own
  segs.forEach((s,i)=>{if(s.full){loops.push([s]);used[i]=true;}});
  for(;;){
    let i0=used.findIndex(u=>!u); if(i0<0)break;
    const chain=[Object.assign({},segs[i0])];used[i0]=true;
    for(;;){
      const last=chain[chain.length-1];
      if(Math.hypot(last.x1-chain[0].x0,last.y1-chain[0].y0)<tol)break;
      let found=-1,flip=false;
      for(let j=0;j<segs.length;j++){
        if(used[j]||segs[j].full)continue;
        if(Math.hypot(segs[j].x0-last.x1,segs[j].y0-last.y1)<tol){found=j;flip=false;break;}
        if(Math.hypot(segs[j].x1-last.x1,segs[j].y1-last.y1)<tol){found=j;flip=true;break;}
      }
      if(found<0)break;
      const s=segs[found];used[found]=true;
      chain.push(flip?{x0:s.x1,y0:s.y1,x1:s.x0,y1:s.y0,b:-s.b}:Object.assign({},s));
    }
    const last=chain[chain.length-1];
    if(Math.hypot(last.x1-chain[0].x0,last.y1-chain[0].y0)<tol&&chain.length>=1)loops.push(chain);
  }
  // nesting: depth by containment; even = outer, odd = hole of the smallest container
  const info=loops.map(l=>({loop:l,area:l[0].full?Math.PI*l[0].r*l[0].r:Math.abs(loopArea(l)),
    pt:l[0].full?[l[0].cx+l[0].r,l[0].cy]:[l[0].x0,l[0].y0]}));
  const regions=[];
  info.forEach((li,i)=>{
    let depth=0,parent=-1,parentArea=Infinity;
    info.forEach((lj,j)=>{
      if(i===j)return;
      const inside=lj.loop[0].full?
        (Math.hypot(li.pt[0]-lj.loop[0].cx,li.pt[1]-lj.loop[0].cy)<lj.loop[0].r):
        ptInLoop(li.pt,lj.loop);
      if(inside){depth++;if(lj.area<parentArea){parentArea=lj.area;parent=j;}}
    });
    li.depth=depth;li.parent=parent;
  });
  info.forEach((li,i)=>{
    if(li.depth%2===0){li.region={loops:[normLoop(li.loop,true)]};regions.push(li.region);}
  });
  info.forEach((li)=>{
    if(li.depth%2===1&&li.parent>=0&&info[li.parent].region)
      info[li.parent].region.loops.push(normLoop(li.loop,false));
  });
  return regions;
}
function normLoop(loop,ccw){ // force orientation: outer CCW, hole CW
  if(loop[0].full)return loop.map(s=>Object.assign({},s,{ccw}));
  const a=loopArea(loop);
  return (a>0)===ccw?loop:reverseLoop(loop);
}
/* ------------------------------------------------ extrude --------------------------------- */
// frame {o,u,v,w} — sketch plane basis (w = u×v). region {loops:[[seg…]…]} first loop outer.
function extrude(region,frame,h,opts){
  const caps=!(opts&&opts.caps===false);
  const {o,u,v}=frame;let w=frame.w||cross(u,v);
  let O=o.slice(),H=h;
  if(H<0){O=add(O,mul(w,H));H=-H;}
  const P3=(x,y,z)=>add(O,add(mul(u,x),add(mul(v,y),mul(w,z))));
  const S=newSolid();
  const capBotLoops=[],capTopLoops=[];
  region.loops.forEach((loop,L)=>{
    if(loop[0].full){ // circular loop → cylinder wall face, 2 closed edges
      const s=loop[0],ccw=s.ccw!==false;
      const c0=P3(s.cx,s.cy,0),c1=P3(s.cx,s.cy,H);
      const ax=norm(u);
      const eb=addE(S,circC(c0,w,ax,s.r),null,null,`eb:${L}:0`);
      const et=addE(S,circC(c1,w,ax,s.r),null,null,`et:${L}:0`);
      const surf=cylS(c0,w,s.r,ax);
      const sense=ccw?1:-1; // CCW loop = material inside = outward radial
      addF(S,surf,sense,
        sense>0?[[{e:eb,fwd:true}],[{e:et,fwd:false}]]
               :[[{e:eb,fwd:false}],[{e:et,fwd:true}]],`w:${L}:0`);
      capBotLoops.push([{e:eb,fwd:!ccw}]);   // bottom cap n=-w: CCW loop seen from below
      capTopLoops.push([{e:et,fwd:ccw}]);
      return;
    }
    const n=loop.length;
    const vb=[],vt=[];
    for(let i=0;i<n;i++){
      vb.push(addV(S,P3(loop[i].x0,loop[i].y0,0),`vb:${L}:${i}`));
      vt.push(addV(S,P3(loop[i].x0,loop[i].y0,H),`vt:${L}:${i}`));
    }
    const eb=[],et=[],es=[],crvB=[],crvT=[];
    for(let i=0;i<n;i++){
      const s=loop[i],j=(i+1)%n;
      let cb,ct;
      if(!s.b){
        const d=norm(sub(P3(s.x1,s.y1,0),P3(s.x0,s.y0,0)));
        cb=lineC(P3(s.x0,s.y0,0),d);ct=lineC(P3(s.x0,s.y0,H),d);
      }else{
        const A=arcOf(s);
        const ax=A.sw>0?w:neg(w);
        const xr=norm(sub(P3(s.x0,s.y0,0),P3(A.cx,A.cy,0)));
        cb=circC(P3(A.cx,A.cy,0),ax,xr,A.r);
        ct=circC(P3(A.cx,A.cy,H),ax,xr,A.r);
      }
      crvB.push(cb);crvT.push(ct);
      eb.push(addE(S,cb,vb[i],vb[j],`eb:${L}:${i}`));
      et.push(addE(S,ct,vt[i],vt[j],`et:${L}:${i}`));
    }
    for(let i=0;i<n;i++){
      const prev=(i-1+n)%n;
      const dIn=crvTan(crvB[prev],S.edges[eb[prev]].t1);
      const dOut=crvTan(crvB[i],S.edges[eb[i]].t0);
      const smooth=dot(dIn,dOut)>1-1e-6;
      es.push(addE(S,lineC(S.verts[vb[i]].p,w),vb[i],vt[i],`es:${L}:${i}`,smooth));
    }
    for(let i=0;i<n;i++){
      const s=loop[i],j=(i+1)%n;
      let surf,sense;
      const pm=crvPt(crvB[i],(S.edges[eb[i]].t0+S.edges[eb[i]].t1)/2);
      const dm=crvTan(crvB[i],(S.edges[eb[i]].t0+S.edges[eb[i]].t1)/2);
      const outw=cross(dm,w); // outward for CCW-ordered material-left loops
      if(!s.b){surf=planeS(pm,outw);sense=1;}
      else{
        const A=arcOf(s);
        const c=P3(A.cx,A.cy,0);
        surf=cylS(c,w,A.r,norm(sub(pm,c)));
        const radial=norm(sub(pm,c));
        sense=dot(radial,outw)>0?1:-1;
      }
      addF(S,surf,sense,[[
        {e:eb[i],fwd:true},{e:es[j],fwd:true},{e:et[i],fwd:false},{e:es[i],fwd:false}
      ]],`w:${L}:${i}`);
      capBotLoops.push(null);capTopLoops.push(null); // placeholder, caps built per loop below
    }
    // cap loop entries for this loop of segments
    capBotLoops.push(loop.map((s,i)=>({e:eb[i],fwd:false})).reverse());
    capTopLoops.push(loop.map((s,i)=>({e:et[i],fwd:true})));
  });
  if(caps){
    const bot=capBotLoops.filter(Boolean),top=capTopLoops.filter(Boolean);
    addF(S,planeS(O,neg(w)),1,bot,'cap:b');
    addF(S,planeS(add(O,mul(w,H)),w),1,top,'cap:t');
  }else S.shell=true; // open shell — rim edges are used once by design
  return S;
}
/* exported below in part 2 (blend, tweaks, tessellation) */
root.__SAK1={EPS,TOL,add,sub,mul,neg,dot,cross,len,dist,norm,lerp,axisFrame,solve3,
  lineC,circC,polyC,crvPt,crvTan,crvParam,crvClosest,planeS,cylS,coneS,torusS,surfN,surfDist,
  surfGrad,surfUV,surfPt,surfNuv,isectPP,surfSurf,surfDistCirc,projectBoth,traceCurve,
  crvSurf,crvCrv,solvePoint,
  newSolid,addV,addE,addF,edgeUses,faceOutN,edgeByKey,faceByKey,vertByKey,refreshParams,
  validate,profile,extrude,segPts,arcOf,loopArea,normLoop};
})(typeof window!=='undefined'?window:globalThis);

/* ============================================================================================
   Part 2 — edge blending (chamfer / fillet), local tweaks, transforms, tessellation, measure.
   ============================================================================================ */
(function(root){
'use strict';
const K=root.__SAK1;
const {EPS,TOL,add,sub,mul,neg,dot,cross,len,dist,norm,lerp,axisFrame,solve3,
  lineC,circC,polyC,crvPt,crvTan,crvParam,crvClosest,planeS,cylS,coneS,torusS,surfN,surfDist,
  surfGrad,surfUV,surfPt,surfNuv,surfSurf,surfDistCirc,projectBoth,traceCurve,
  crvSurf,crvCrv,solvePoint,
  newSolid,addV,addE,addF,edgeUses,faceOutN,edgeByKey,faceByKey,vertByKey,refreshParams,
  validate,profile,extrude}=K;

const ok=v=>({ok:true,solid:v});
const refuse=m=>({ok:false,msg:m});
function clone(S){return JSON.parse(JSON.stringify(S));}
function addEShort(S,crv,v0,v1,key,smooth){ // circular edges take the SHORT arc between ends
  const id=addE(S,crv,v0,v1,key,smooth);
  const e=S.edges[id];
  if(crv.t==='circ'&&e.t1-e.t0>Math.PI+1e-9){
    e.crv=circC(crv.c,neg(crv.a),crv.x,crv.r);
    refreshParams(S,id);
  }
  return id;
}

/* ---------------- loop / adjacency helpers ---------------- */
function loopOf(S,fid,eid){ // {li,ei,fwd} of eid in face fid
  const f=S.faces[fid];
  for(let li=0;li<f.loops.length;li++)
    for(let ei=0;ei<f.loops[li].length;ei++)
      if(f.loops[li][ei].e===eid)return {li,ei,fwd:f.loops[li][ei].fwd};
  return null;
}
function edgeFaces(S,eid){ // [faceId of fwd use, faceId of rev use]
  let fw=null,rv=null;
  for(const f of Object.values(S.faces))
    for(const L of f.loops)for(const en of L)
      if(en.e===eid){if(en.fwd)fw=f.id;else rv=f.id;}
  return [fw,rv];
}
function vertEdges(S,vid){
  const out=[];
  for(const e of Object.values(S.edges)){
    if(e.v0===vid)out.push({e:e.id,end:0});
    if(e.v1===vid)out.push({e:e.id,end:1});
  }
  return out;
}
function edgeTanAtEnd(S,e,end){ // tangent pointing OUT of the edge at that end
  const t=end===0?e.t0:e.t1;
  const d=crvTan(e.crv,t);
  return end===0?neg(d):d;
}
function edgeMidPt(S,e){return crvPt(e.crv,(e.t0+e.t1)/2);}
function inwardDir(S,f,e,fwdInLoop,t){ // in-face direction ⊥ edge, pointing into face f, at param t
  const p=crvPt(e.crv,t);
  const n=faceOutN(S,f,p);
  let tan=crvTan(e.crv,t);
  if(!fwdInLoop)tan=neg(tan);
  return norm(cross(n,tan)); // material to the left when walking the loop with outward normal up
}
function loopWindingOK(S,f){ // does loop 0 wind CCW about the outward normal?
  const L=f.loops[0];let a=0;let c=[0,0,0];let cnt=0;
  const pts=[];
  for(const en of L){
    const e=S.edges[en.e];const N=8;
    for(let i=0;i<N;i++){
      const t=en.fwd?e.t0+(e.t1-e.t0)*i/N:e.t1-(e.t1-e.t0)*i/N;
      const p=crvPt(e.crv,t);pts.push(p);c=add(c,p);cnt++;
    }
  }
  c=mul(c,1/cnt);
  const n=faceOutN(S,f,pts[0]);
  let s=0;
  for(let i=0;i<pts.length;i++){
    const p=sub(pts[i],c),q=sub(pts[(i+1)%pts.length],c);
    s+=dot(cross(p,q),n);
  }
  return s>0;
}
function fixWinding(S,fid){
  const f=S.faces[fid];
  if(!loopWindingOK(S,f))f.loops=f.loops.map(L=>L.slice().reverse().map(en=>({e:en.e,fwd:!en.fwd})));
}
function dropVert(S,vid){delete S.verts[vid];}
function dropEdge(S,eid){delete S.edges[eid];}
function collapseEdge(S,eid,keepV){ // zero-length edge: remove it and merge its ends into keepV
  const e=S.edges[eid];
  const dropV=e.v0===keepV?e.v1:e.v0;
  for(const f of Object.values(S.faces))
    f.loops=f.loops.map(L=>L.filter(en=>en.e!==eid));
  delete S.edges[eid];
  if(dropV!==keepV&&dropV!=null){
    for(const e2 of Object.values(S.edges)){
      if(e2.v0===dropV)e2.v0=keepV;
      if(e2.v1===dropV)e2.v1=keepV;
    }
    delete S.verts[dropV];
  }
  for(const e2 of Object.values(S.edges))
    if(e2.v0===keepV||e2.v1===keepV)refreshParams(S,e2.id);
}

/* ---------------- blend geometry families ------------------
   Each returns {rail1,rail2,surf,sample} — rail1 lives on f1's surface, rail2 on f2's.
   d1 is the setback on f1 (chamfer) or the radius (fillet, d2 ignored). */
function planePlaneBlend(kind,s1,s2,inw1,inw2,pm,t,d1,d2){
  if(kind==='chamfer'){
    const q1=add(pm,mul(inw1,d1)),q2=add(pm,mul(inw2,d2));
    if(dist(q1,q2)<TOL)return null;
    const nb=norm(cross(t,sub(q2,q1)));
    return {rail1:lineC(q1,t),rail2:lineC(q2,t),surf:planeS(q1,nb),sample:lerp(q1,q2,.5)};
  }
  const r=d1;
  const n1=s1.n_out,n2=s2.n_out;
  const cx=Math.abs(dot(n1,n2));if(cx>1-1e-9)return null;
  const conv=s1.convex?-1:1; // convex: centre sits inward (negative along outward normals)
  const x=solve3([n1[0],n1[1],n1[2], n2[0],n2[1],n2[2], t[0],t[1],t[2]],[conv*r,conv*r,0]);
  if(!x)return null;
  const c=add(pm,x);
  const f1p=sub(c,mul(n1,dot(sub(c,pm),n1))),f2p=sub(c,mul(n2,dot(sub(c,pm),n2)));
  return {rail1:lineC(f1p,t),rail2:lineC(f2p,t),
    surf:cylS(c,t,r),sample:add(c,mul(norm(sub(pm,c)),r))};
}
function capWallBlend(kind,capS,wallS,inw1,inw2,e,d1,d2){
  // e.crv is a circle; cap plane ⊥ circle axis; wall cyl axis ∥ circle axis
  const c=e.crv,a=c.a,R=c.r;
  const pm=crvPt(c,(e.t0+e.t1)/2);
  const rad=norm(sub(pm,c.c));                 // radial outward at sample
  const sR=Math.sign(dot(inw1,rad))||1;        // cap inward: −1 toward axis (outer wall)
  const sA=Math.sign(dot(inw2,a))||1;          // wall inward along ∓axis
  if(kind==='chamfer'){
    const R1=R+sR*d1;if(R1<TOL)return null;
    const c1=c.c, c2=add(c.c,mul(a,sA*d2));
    const rail1=circC(c1,a,c.x,R1), rail2=circC(c2,a,c.x,R);
    const dh=sA*d2;                            // rail2 height rel. rail1 plane
    const k=(R-R1)/dh;
    const surf=coneS(c1,a,R1,k,c.x);
    const sample=lerp(crvPt(rail1,crvParam(rail1,pm)),crvPt(rail2,crvParam(rail2,pm)),.5);
    return {rail1,rail2,surf,sample};
  }
  const r=d1,Rt=R+sR*r;if(Rt<TOL)return null;
  const cc=add(c.c,mul(a,sA*r));               // tube-centre ring plane
  const surf=torusS(cc,a,Rt,r,c.x);
  const rail1=circC(c.c,a,c.x,Rt);             // spring on cap
  const rail2=circC(cc,a,c.x,R);               // spring on wall
  const ring=add(cc,mul(rad,Rt));
  return {rail1,rail2,surf,sample:add(ring,mul(norm(sub(pm,ring)),r))};
}
function wallWallBlend(kind,s1,s2,inw1,inw2,pm,t,d1,d2){
  // vertical edge: both walls contain direction t (plane with n⊥t, or cyl with axis ∥ t).
  // Work in the 2-D cross-section plane through pm with basis (U,V), t out of the page.
  const [U,V]=axisFrame(t);
  const to3=q=>add(pm,add(mul(U,q[0]),mul(V,q[1])));
  const norm2=v=>{const l=Math.hypot(v[0],v[1]);return l<EPS?[1,0]:[v[0]/l,v[1]/l];};
  const neg2=v=>[-v[0],-v[1]];
  const trace=s=>{ // 2-D trace of a wall in the cross-section (origin = pm)
    if(s.t==='plane')return {t:'line',n:norm2([dot(s.n,U),dot(s.n,V)])};
    const foot=add(s.c,mul(s.a,dot(sub(pm,s.c),s.a)));
    return {t:'circ',c:[dot(sub(foot,pm),U),dot(sub(foot,pm),V)],r:s.r};
  };
  const w1=trace(s1),w2=trace(s2);
  const i1=norm2([dot(inw1,U),dot(inw1,V)]),i2=norm2([dot(inw2,U),dot(inw2,V)]);
  const onWall=(w,inw,d)=>{ // walk arc length d into the face along its wall trace
    if(w.t==='line')return [inw[0]*d,inw[1]*d];
    const v0=[-w.c[0],-w.c[1]];const a0=Math.atan2(v0[1],v0[0]);
    const tang=[-v0[1],v0[0]];const sg=Math.sign(tang[0]*inw[0]+tang[1]*inw[1])||1;
    const a=a0+sg*d/w.r;
    return [w.c[0]+w.r*Math.cos(a),w.c[1]+w.r*Math.sin(a)];
  };
  if(kind==='chamfer'){
    const Q1=to3(onWall(w1,i1,d1)),Q2=to3(onWall(w2,i2,d2));
    if(dist(Q1,Q2)<TOL)return null;
    const nb=norm(cross(t,sub(Q2,Q1)));
    return {rail1:lineC(Q1,t),rail2:lineC(Q2,t),surf:planeS(Q1,nb),sample:lerp(Q1,Q2,.5)};
  }
  const r=d1;
  // rolling-ball centre locus: offset each wall trace into the material by r
  const nf1=norm2([-dot(s1.n_out,U),-dot(s1.n_out,V)]); // into material = −outward
  const nf2=norm2([-dot(s2.n_out,U),-dot(s2.n_out,V)]);
  const locus=(w,into)=>{
    if(w.t==='line')return {t:'line',p:[into[0]*r,into[1]*r],d:[-into[1],into[0]]};
    const toC=Math.sign(into[0]*w.c[0]+into[1]*w.c[1])||1; // material toward centre? shrink : grow
    return {t:'circ',c:w.c,r:toC>0?w.r-r:w.r+r};
  };
  const L1=locus(w1,nf1),L2=locus(w2,nf2);
  const c2=isect2(L1,L2);if(!c2)return null;
  const spring=(w,c)=>{
    if(w.t==='line'){const n=w===w1?nf1:nf2;const d=c[0]*n[0]+c[1]*n[1];return [c[0]-n[0]*d,c[1]-n[1]*d];}
    const v=[c[0]-w.c[0],c[1]-w.c[1]];const l=Math.hypot(v[0],v[1])||1;
    return [w.c[0]+v[0]/l*w.r,w.c[1]+v[1]/l*w.r];
  };
  const q1=spring(w1,c2),q2=spring(w2,c2);
  const C=to3(c2);
  return {rail1:lineC(to3(q1),t),rail2:lineC(to3(q2),t),surf:cylS(C,t,r),
    sample:add(C,mul(norm(sub(pm,C)),r))};
  function isect2(A,B){
    const sols=[];
    if(A.t==='line'&&B.t==='line'){
      const d1=A.d,d2=B.d,dp=[B.p[0]-A.p[0],B.p[1]-A.p[1]];
      const den=d1[0]*d2[1]-d1[1]*d2[0];if(Math.abs(den)<1e-12)return null;
      const s=(dp[0]*d2[1]-dp[1]*d2[0])/den;
      return [A.p[0]+d1[0]*s,A.p[1]+d1[1]*s];
    }
    const lin=A.t==='line'?A:B,cir=A.t==='line'?B:A;
    if(A.t!==B.t){
      const f=[lin.p[0]-cir.c[0],lin.p[1]-cir.c[1]];
      const b=f[0]*lin.d[0]+f[1]*lin.d[1],c=f[0]*f[0]+f[1]*f[1]-cir.r*cir.r;
      const disc=b*b-c;if(disc<0)return null;
      const s1v=-b+Math.sqrt(disc),s2v=-b-Math.sqrt(disc);
      sols.push([lin.p[0]+lin.d[0]*s1v,lin.p[1]+lin.d[1]*s1v]);
      sols.push([lin.p[0]+lin.d[0]*s2v,lin.p[1]+lin.d[1]*s2v]);
    }else{
      const dx=B.c[0]-A.c[0],dy=B.c[1]-A.c[1],d=Math.hypot(dx,dy);
      if(d<1e-12||d>A.r+B.r||d<Math.abs(A.r-B.r))return null;
      const a=(A.r*A.r-B.r*B.r+d*d)/(2*d),h=Math.sqrt(Math.max(0,A.r*A.r-a*a));
      const mx=A.c[0]+dx*a/d,my=A.c[1]+dy*a/d;
      sols.push([mx+h*dy/d,my-h*dx/d]);sols.push([mx-h*dy/d,my+h*dx/d]);
    }
    sols.sort((p,q)=>(p[0]*p[0]+p[1]*p[1])-(q[0]*q[0]+q[1]*q[1]));
    return sols[0]||null;
  }
}

/* ---------------- the blend operation ---------------------- */
function edgeConvex(S,e,f1id){
  const lu=loopOf(S,f1id,e.id);
  const tm=(e.t0+e.t1)/2,p=crvPt(e.crv,tm);
  let t=crvTan(e.crv,tm);if(!lu.fwd)t=neg(t);
  const [fw,rv]=edgeFaces(S,e.id);
  const other=fw===f1id?rv:fw;
  const n1=faceOutN(S,S.faces[f1id],p),n2=faceOutN(S,S.faces[other],p);
  return dot(cross(n1,n2),t)>0;
}
function blendEdge(S0,seedKey,kind,d1,d2){
  d2=d2==null?d1:d2;
  if(!(d1>TOL))return refuse('give a positive distance / radius');
  const S=clone(S0);
  const seed=edgeByKey(S,seedKey);
  if(!seed)return refuse('no such edge: '+seedKey);
  if(seed.smooth)return refuse('that is a tangent seam, not a sharp edge — pick a real edge');
  const [fwF,rvF]=edgeFaces(S,seed.id);
  if(fwF==null||rvF==null)return refuse('edge is not manifold');
  const f1id=fwF; // chain lives on f1's loop; f2 varies per element
  const f1=S.faces[f1id];
  const lu=loopOf(S,f1id,seed.id);
  const L1=f1.loops[lu.li];

  /* -- tangent chain: contiguous run of L1 around the seed where joints are smooth
        and the far-side faces continue tangentially -- */
  const n=L1.length;
  const smoothJoint=(iA,iB)=>{ // between loop entries iA -> iB (consecutive along loop)
    const enA=L1[iA],enB=L1[iB];
    const eA=S.edges[enA.e],eB=S.edges[enB.e];
    if(eA.v0==null||eB.v0==null)return false;
    const vA=enA.fwd?eA.v1:eA.v0, vB=enB.fwd?eB.v0:eB.v1;
    if(vA!==vB)return false;
    const tA=enA.fwd?crvTan(eA.crv,eA.t1):neg(crvTan(eA.crv,eA.t0));
    const tB=enB.fwd?crvTan(eB.crv,eB.t0):neg(crvTan(eB.crv,eB.t1));
    if(dot(tA,tB)<1-1e-6)return false;
    const p=S.verts[vA].p;
    const oA=otherFace(enA.e),oB=otherFace(enB.e);
    const nA=faceOutN(S,S.faces[oA],p),nB=faceOutN(S,S.faces[oB],p);
    return dot(nA,nB)>1-1e-6;
  };
  const otherFace=eid=>{const [a,b]=edgeFaces(S,eid);return a===f1id?b:a;};
  let i0=lu.ei,i1=lu.ei,count=1,closed=false;
  for(;;){ // extend backwards
    const prev=(i0-1+n)%n;
    if(count===n){closed=true;break;}
    if(prev===i1&&count===n-1){ /* full */ }
    if(!smoothJoint(prev,i0))break;
    i0=prev;count++;if(count===n){closed=true;break;}
  }
  if(!closed)for(;;){ // extend forwards
    const nxt=(i1+1)%n;
    if(count===n){closed=true;break;}
    if(!smoothJoint(i1,nxt))break;
    i1=nxt;count++;if(count===n){closed=true;break;}
  }
  const single=S.edges[L1[lu.ei].e].v0==null; // closed circle edge
  const idxs=[];for(let i=0;i<count;i++)idxs.push((i0+i)%n);
  const elems=idxs.map(i=>({en:L1[i],e:S.edges[L1[i].e],f2:S.faces[otherFace(L1[i].e)]}));

  /* -- per element geometry -- */
  for(const el of elems){
    const e=el.e,tm=(e.t0+e.t1)/2,pm=crvPt(e.crv,tm);
    let t=crvTan(e.crv,tm);if(!el.en.fwd)t=neg(t);
    const inw1=inwardDir(S,f1,e,el.en.fwd,tm);
    const lu2=loopOf(S,el.f2.id,e.id);
    const inw2=inwardDir(S,el.f2,e,lu2.fwd,tm);
    const n1=faceOutN(S,f1,pm),n2=faceOutN(S,el.f2,pm);
    const convex=dot(cross(n1,n2),t)>0;
    const s1={...f1.surf,n_out:n1,convex},s2={...el.f2.surf,n_out:n2,convex};
    let g=null;
    const su1=f1.surf,su2=el.f2.surf;
    if(e.crv.t==='line'&&su1.t==='plane'&&su2.t==='plane')
      g=planePlaneBlend(kind,{...s1,n:n1},{...s2,n:n2},inw1,inw2,pm,t,d1,d2);
    else if(e.crv.t==='circ'&&su1.t==='plane'&&su2.t==='cyl'&&Math.abs(dot(su2.a,e.crv.a))>1-1e-6)
      g=capWallBlend(kind,su1,su2,inw1,inw2,e,d1,d2);
    else if(e.crv.t==='circ'&&su2.t==='plane'&&su1.t==='cyl'&&Math.abs(dot(su1.a,e.crv.a))>1-1e-6){
      g=capWallBlend(kind,su2,su1,inw2,inw1,e,d2,d1);
      if(g)g={rail1:g.rail2,rail2:g.rail1,surf:g.surf,sample:g.sample};
    }
    else if(e.crv.t==='line'&&
      (su1.t==='cyl'||su2.t==='cyl')&&
      (su1.t==='plane'||Math.abs(dot(su1.a,e.crv.d))>1-1e-6)&&
      (su2.t==='plane'||Math.abs(dot(su2.a,e.crv.d))>1-1e-6)&&
      (su1.t!=='plane'||Math.abs(dot(su1.n,e.crv.d))<1e-6)&&
      (su2.t!=='plane'||Math.abs(dot(su2.n,e.crv.d))<1e-6))
      g=wallWallBlend(kind,s1,s2,inw1,inw2,pm,t,d1,d2);
    if(!g)return refuse(`unsupported ${kind} geometry on ${e.key} (${su1.t}/${su2.t}, ${e.crv.t} edge)`);
    // orient blend surface outward
    const expect=norm(add(faceOutN(S,f1,pm),faceOutN(S,el.f2,pm)));
    g.sense=dot(surfN(g.surf,g.sample),expect)>=0?1:-1;
    g.t=t;g.pm=pm;g.inw1=inw1;g.inw2=inw2;g.convex=convex;
    // rails of arc elements must run in CHAIN direction (multi-element chains): flip the
    // circle axis when the loop traverses the source edge against its parameterisation
    if(!el.en.fwd){
      for(const rk of ['rail1','rail2']){
        const c=g[rk];
        if(c&&c.t==='circ')g[rk]=circC(c.c,neg(c.a),c.x,c.r);
      }
    }
    el.g=g;
  }

  /* -- joint points between consecutive elements (tangent) -- */
  const joints=[]; // joints[i] between elems[i-1] and elems[i] (closed: joints[0] between last & first)
  const railPt=(crv,near)=>crvPt(crv,crvClosest(crv,near));
  const jointAt=(elA,elB,v)=>{
    const p=S.verts[v].p;
    // true rail∩rail points (tangent rails: alternating projection converges to the touch point)
    const railJoin=(cA,cB,hint)=>{
      const x=crvCrv(cA,cB,hint);
      if(x)return x;
      const a=railPt(cA,hint),b=railPt(cB,hint);
      return dist(a,b)<=1e-3?lerp(a,b,.5):null;
    };
    const j1=railJoin(elA.g.rail1,elB.g.rail1,add(p,mul(lerp(elA.g.inw1,elB.g.inw1,.5),d1)));
    const j2=railJoin(elA.g.rail2,elB.g.rail2,add(p,mul(lerp(elA.g.inw2,elB.g.inw2,.5),d2)));
    if(!j1||!j2)return null;
    return {v,j1,j2};
  };
  const endVert=(el,which)=>{ // which: 0 = chain-start side, 1 = chain-end side
    const e=el.e;return (which===1)===(!!el.en.fwd)?e.v1:e.v0;
  };
  if(!single){
    const kN=elems.length;
    const jFrom=closed?0:1;
    for(let i=jFrom;i<kN;i++){
      const A=elems[(i-1+kN)%kN],B=elems[i];
      const v=endVert(A,1);
      const J=jointAt(A,B,v);
      if(!J)return refuse('blend rails disagree at a tangent joint — reduce the size');
      joints[i]=J;
    }
  }

  /* -- open-end corner closure data -- */
  let ends=null;
  if(!closed&&!single){
    ends=[];
    for(const which of [0,1]){
      const el=which===0?elems[0]:elems[elems.length-1];
      const v=endVert(el,which);
      const ve=vertEdges(S,v).filter(x=>x.e!==el.e.id);
      if(ve.length!==2)return refuse('end corner has valence ≠ 3 — not supported yet');
      let g1=null,g2=null,f3=null;
      for(const x of ve){
        const [a,b]=edgeFaces(S,x.e);
        const fset=[a,b];
        if(fset.includes(f1id))g1=x;else g2=x;
      }
      if(!g1||!g2)return refuse('cannot resolve the corner faces at an end vertex');
      const g1f=edgeFaces(S,g1.e).filter(f=>f!==f1id);
      const g2f=edgeFaces(S,g2.e).filter(f=>f!==el.f2.id);
      f3=g1f.find(f=>g2f.includes(f));
      if(f3==null)return refuse('no common cross face at the end vertex');
      const p=S.verts[v].p;
      const hitA=crvSurf(el.g.rail1,S.faces[f3].surf,p);
      const hitB=crvSurf(el.g.rail2,S.faces[f3].surf,p);
      if(!hitA||!hitB)return refuse('blend does not reach the cross face — reduce the size');
      let cl=surfSurf(el.g.surf,S.faces[f3].surf,lerp(hitA.p,hitB.p,.5));
      if(cl&&cl.t==='circ'){ // reject the analytic branch if it misses the two rail hits
        const dA=surfDistCirc(cl,hitA.p),dB=surfDistCirc(cl,hitB.p);
        if(dA>1e-4||dB>1e-4)cl=null;
      }
      if(!cl)cl=traceCurve(el.g.surf,S.faces[f3].surf,hitA.p,hitB.p); // e.g. cylinder∩tilted plane
      if(!cl)return refuse('cannot build the closure curve between the blend and the cross face');
      ends[which]={v,el,g1,g2,f3,a1:hitA.p,a2:hitB.p,cl};
    }
  }

  /* ================= surgery ================= */
  const kN=elems.length;
  // vertices along rail1 / rail2
  const v1s=[],v2s=[]; // v1s[i] = vertex at start of elem i's rail1 (chain order); v1s[kN] end
  if(single){
    /* closed circular edge: rails are closed circles */
  }else{
    for(let i=0;i<=kN;i++){
      if(closed){
        if(i===kN){v1s[i]=v1s[0];v2s[i]=v2s[0];continue;}
        const J=joints[i];
        v1s[i]=addV(S,J.j1);
        // reuse seam vertex on the walls when the two wall faces share an edge at J.v
        const seam=vertEdges(S,J.v).map(x=>S.edges[x.e]).find(se=>{
          if(!se||se.id===elems[(i-1+kN)%kN].e.id||se.id===elems[i%kN].e.id)return false;
          const [a,b]=edgeFaces(S,se.id);
          return (a===elems[(i-1+kN)%kN].f2.id||b===elems[(i-1+kN)%kN].f2.id)&&
                 (a===elems[i%kN].f2.id||b===elems[i%kN].f2.id);
        });
        if(seam){S.verts[J.v].p=J.j2.slice();v2s[i]=J.v;refreshParams(S,seam.id);}
        else v2s[i]=addV(S,J.j2);
      }else if(i===0){
        v1s[0]=addV(S,ends[0].a1);v2s[0]=addV(S,ends[0].a2);
      }else if(i===kN){
        v1s[kN]=addV(S,ends[1].a1);v2s[kN]=addV(S,ends[1].a2);
      }else{
        const J=joints[i];
        v1s[i]=addV(S,J.j1);
        const seam=vertEdges(S,J.v).map(x=>S.edges[x.e]).find(se=>{
          if(!se||se.id===elems[i-1].e.id||se.id===elems[i].e.id)return false;
          const [a,b]=edgeFaces(S,se.id);
          return (a===elems[i-1].f2.id||b===elems[i-1].f2.id)&&
                 (a===elems[i].f2.id||b===elems[i].f2.id);
        });
        if(seam){S.verts[J.v].p=J.j2.slice();v2s[i]=J.v;refreshParams(S,seam.id);}
        else v2s[i]=addV(S,J.j2);
      }
    }
  }
  // rail edges
  const rail1E=[],rail2E=[];
  for(let i=0;i<kN;i++){
    const g=elems[i].g;
    if(single){
      rail1E[i]=addE(S,g.rail1,null,null,`${seedKey}·r1`);
      rail2E[i]=addE(S,g.rail2,null,null,`${seedKey}·r2`);
    }else{
      rail1E[i]=addE(S,g.rail1,v1s[i],v1s[i+1],`${elems[i].e.key}·r1`);
      rail2E[i]=addE(S,g.rail2,v2s[i],v2s[i+1],`${elems[i].e.key}·r2`);
    }
  }
  // seam edges between blend faces at joints (smooth)
  const seamE=[]; // seamE[i] at joint i (start of elem i)
  const crossCrv=(el,p1,p2)=>{ // cross-section curve of the blend at a joint/end
    if(kind==='chamfer')return lineC(p1,norm(sub(p2,p1)));
    const g=el.g;
    if(g.surf.t==='cyl'){ // fillet cross-section: circle ⊥ axis through p1/p2
      const c=add(g.surf.c,mul(g.surf.a,dot(sub(p1,g.surf.c),g.surf.a)));
      const ax=cross(sub(p1,c),sub(p2,c));
      return circC(c,len(ax)>1e-9?ax:g.surf.a,norm(sub(p1,c)),g.surf.r);
    }
    if(g.surf.t==='torus'){
      const a=g.surf.a,d=sub(p1,g.surf.c),h=dot(d,a);
      const radial=norm(sub(d,mul(a,h)));
      const ring=add(g.surf.c,mul(radial,g.surf.R));
      const ax=norm(cross(a,radial));
      return circC(ring,ax,radial,g.surf.r);
    }
    return lineC(p1,norm(sub(p2,p1)));
  };
  if(!single){
    const jFrom=closed?0:1;
    for(let i=jFrom;i<kN;i++){
      const p1=S.verts[v1s[i]].p,p2=S.verts[v2s[i]].p;
      seamE[i]=addEShort(S,crossCrv(elems[i],p1,p2),v1s[i],v2s[i],`${elems[i].e.key}·x`,true);
    }
  }
  // closure edges at open ends
  const closE=[];
  if(ends){
    for(const which of [0,1]){
      const E=ends[which];
      const vi1=which===0?v1s[0]:v1s[kN],vi2=which===0?v2s[0]:v2s[kN];
      closE[which]=addEShort(S,E.cl,vi1,vi2,`${E.el.e.key}·c${which}`);
    }
  }
  // blend faces — sense rule: two faces always traverse a shared edge oppositely.
  // f1 keeps rail1 in chain direction (fwd:true), f2 keeps rail2 against it (fwd:false),
  // so every blend face walks rail2 forward and rail1 backward.
  const blendF=[];
  for(let i=0;i<kN;i++){
    const g=elems[i].g;
    let loops;
    if(single)loops=[[{e:rail1E[i],fwd:false}],[{e:rail2E[i],fwd:true}]];
    else{
      const startX=closed? seamE[i] : (i===0?closE[0]:seamE[i]);
      const endX  =closed? seamE[(i+1)%kN] : (i===kN-1?closE[1]:seamE[i+1]);
      loops=[[
        {e:startX,fwd:true},
        {e:rail2E[i],fwd:true},
        {e:endX,fwd:false},
        {e:rail1E[i],fwd:false},
      ]];
    }
    blendF[i]=addF(S,g.surf,g.sense,loops,`${elems[i].e.key}·${kind}`);
  }
  // f1: replace chain entries with rail1 entries
  {
    const keep=[];
    if(closed)for(let i=0;i<kN;i++)keep.push({e:rail1E[i],fwd:true});
    else{
      for(let i=0;i<L1.length;i++){
        const idx=idxs.indexOf(i);
        if(idx<0)keep.push(L1[i]);
        else if(i===idxs[0])for(let jj=0;jj<kN;jj++)keep.push({e:rail1E[jj],fwd:true});
      }
      // handle wrap: idxs may wrap past 0 — rebuild in loop order starting at idxs[0]
      if(idxs[0]+kN>n){
        keep.length=0;
        for(let s=0;s<n;s++){
          const i=(idxs[0]+s)%n;
          if(s===0)for(let jj=0;jj<kN;jj++)keep.push({e:rail1E[jj],fwd:true});
          if(s>=kN)keep.push(L1[i]);
        }
      }
    }
    f1.loops[lu.li]=keep;
  }
  // f2 of each element: replace the chain edge with rail2 (reversed relative to rail dir)
  for(let i=0;i<kN;i++){
    const el=elems[i];
    const lu2=loopOf(S,el.f2.id,el.e.id);
    el.f2.loops[lu2.li]=el.f2.loops[lu2.li].map(en=>en.e===el.e.id?{e:rail2E[i],fwd:lu2.fwd===el.en.fwd?true:false}:en);
    // rail2 runs along the chain (same direction as e in f1's loop); in f2 the edge ran opposite,
    // so the replacement keeps f2's traversal direction:
    const fixed=el.f2.loops[lu2.li].find(en=>en.e===rail2E[i]);
    fixed.fwd=!el.en.fwd===!lu2.fwd?true:false;
    fixed.fwd=(lu2.fwd===el.en.fwd); // same sense mapping as the old edge had
  }
  // open ends: retarget neighbour edges, insert closure edge into f3.
  // A neighbour shrunk to zero length (equal-size blends meeting at a corner) is collapsed;
  // a NEGATIVE length means the blend overruns into further faces — corner patches beyond a
  // single cross face are out of scope, so that refuses cleanly.
  if(ends){
    for(const which of [0,1]){
      const E=ends[which];
      const nv1=which===0?v1s[0]:v1s[kN],nv2=which===0?v2s[0]:v2s[kN];
      const g1e=S.edges[E.g1.e],g2e=S.edges[E.g2.e];
      const keepEnd=(ge,gu,nv)=>{if(gu.end===0)ge.v0=nv;else ge.v1=nv;refreshParams(S,ge.id);};
      keepEnd(g1e,E.g1,nv1);keepEnd(g2e,E.g2,nv2);
      const l1=g1e.t1-g1e.t0,l2=g2e.t1-g2e.t0;
      const zero=x=>Math.abs(x)<1e-5||(S.edges&&false);
      const zlen=ge=>ge.v0!=null&&dist(S.verts[ge.v0].p,S.verts[ge.v1].p)<1e-5;
      if((l1<-1e-5&&!zlen(g1e))||(l2<-1e-5&&!zlen(g2e)))
        return refuse('blend overruns the corner into further faces — reduce the size');
      const f3=S.faces[E.f3];
      let done=false;
      for(let li=0;li<f3.loops.length&&!done;li++){
        const L=f3.loops[li];
        for(let ei=0;ei<L.length;ei++){
          const cur=L[ei],nxt=L[(ei+1)%L.length];
          const pair=(cur.e===g1e.id&&nxt.e===g2e.id)||(cur.e===g2e.id&&nxt.e===g1e.id);
          if(!pair)continue;
          const curE=S.edges[cur.e];
          const tailV=cur.fwd?curE.v1:curE.v0;
          const fwd=S.edges[closE[which]].v0===tailV;
          L.splice(ei+1,0,{e:closE[which],fwd});
          done=true;break;
        }
      }
      if(!done)return refuse('could not stitch the closure edge into the cross face');
      dropVert(S,E.v);
      // collapse neighbours that degenerated to a point
      if(zlen(g1e))collapseEdge(S,g1e.id,nv1);
      if(S.edges[g2e.id]&&zlen(g2e))collapseEdge(S,g2e.id,nv2);
    }
  }
  // delete chain edges (+ fully-consumed joint vertices)
  for(const el of elems)dropEdge(S,el.e.id);
  if(!single){
    const jFrom=closed?0:1;
    for(let i=jFrom;i<kN;i++){
      const J=joints[i];
      if(J&&v2s[i]!==J.v)dropVert(S,J.v);
    }
  }
  const val=validate(S);
  if(!val.ok)return refuse('blend produced invalid topology: '+val.msgs[0]);
  return ok(S);
}
function blendEdges(S,keys,kind,d1,d2){
  let cur=S;const failed=[];
  for(const k of keys){
    const r=blendEdge(cur,k,kind,d1,d2);
    if(r.ok)cur=r.solid;else failed.push(k+': '+r.msg);
  }
  if(cur===S)return refuse(failed.join(' · ')||'nothing to blend');
  return {ok:true,solid:cur,failed};
}

/* ---------------- local tweaks ------------------------------ */
function rederiveFaces(S,fids){
  const touchedE=new Set(),touchedV=new Set();
  for(const fid of fids)
    for(const L of S.faces[fid].loops)
      for(const en of L){
        touchedE.add(en.e);
        const e=S.edges[en.e];
        if(e.v0!=null){touchedV.add(e.v0);touchedV.add(e.v1);}
      }
  for(const eid of touchedE){
    const e=S.edges[eid];
    const [a,b]=edgeFaces(S,eid);
    const hint=edgeMidPt(S,e);
    const c=surfSurf(S.faces[a].surf,S.faces[b].surf,hint);
    if(!c)return 'faces no longer intersect along '+e.key;
    e.crv=c;
  }
  for(const vid of touchedV){
    const v=S.verts[vid];
    const fset=new Map();
    for(const x of vertEdges(S,vid))
      for(const f of edgeFaces(S,x.e))fset.set(f,S.faces[f].surf);
    const surfs=[...fset.values()];
    if(surfs.length<3)return 'vertex '+v.key+' has fewer than 3 faces';
    const p=solvePoint(surfs.slice(0,3),v.p);
    if(!p)return 'vertex '+v.key+' lost its intersection point';
    v.p=p;
  }
  // refresh every edge parameterization touching moved vertices
  for(const e of Object.values(S.edges)){
    if(e.v0!=null&&(touchedV.has(e.v0)||touchedV.has(e.v1)))refreshParams(S,e.id);
    else if(touchedE.has(e.id))refreshParams(S,e.id);
  }
  return null;
}
function moveFace(S0,faceKey,delta){
  const S=clone(S0);
  const f=faceByKey(S,faceKey);
  if(!f)return refuse('no such face');
  const s=f.surf;
  if(s.t==='plane'){s.o=add(s.o,delta);delete s.uv;}
  else if(s.t==='cyl'||s.t==='cone'||s.t==='torus')s.c=add(s.c,sub(delta,mul(s.a,0)));
  const err=rederiveFaces(S,[f.id]);
  if(err)return refuse(err);
  const val=validate(S);
  if(!val.ok)return refuse('move face broke the shell: '+val.msgs[0]);
  return ok(S);
}
function offsetFace(S0,faceKey,d){
  const S=clone(S0);
  const f=faceByKey(S,faceKey);
  if(!f)return refuse('no such face');
  const s=f.surf;
  if(s.t==='plane'){s.o=add(s.o,mul(s.n,f.sense*d));delete s.uv;}
  else if(s.t==='cyl'){s.r+=f.sense*d;if(s.r<TOL)return refuse('radius would vanish');}
  else return refuse('offset of '+s.t+' faces is not supported yet');
  const err=rederiveFaces(S,[f.id]);
  if(err)return refuse(err);
  const val=validate(S);
  if(!val.ok)return refuse('offset face broke the shell: '+val.msgs[0]);
  return ok(S);
}
function moveEdge(S0,edgeKey,delta){
  const S=clone(S0);
  const e=edgeByKey(S,edgeKey);
  if(!e)return refuse('no such edge');
  const fids=edgeFaces(S,e.id);
  for(const fid of fids){
    const s=S.faces[fid].surf;
    if(s.t==='plane'){s.o=add(s.o,mul(s.n,dot(delta,s.n)));delete s.uv;}
    else if(s.t==='cyl'){
      const radial=sub(delta,mul(s.a,dot(delta,s.a)));
      s.c=add(s.c,radial);
    }
    else return refuse('move edge next to a '+s.t+' face is not supported yet');
  }
  const err=rederiveFaces(S,fids);
  if(err)return refuse(err);
  const val=validate(S);
  if(!val.ok)return refuse('move edge broke the shell: '+val.msgs[0]);
  return ok(S);
}
function moveVertex(S0,vertKey,delta){
  const S=clone(S0);
  const v=vertByKey(S,vertKey);
  if(!v)return refuse('no such vertex');
  const fset=new Set();
  for(const x of vertEdges(S,v.id))for(const f of edgeFaces(S,x.e))fset.add(f);
  for(const fid of fset){
    const s=S.faces[fid].surf;
    if(s.t!=='plane')return refuse('move vertex on curved faces is not supported yet');
    s.o=add(s.o,mul(s.n,dot(delta,s.n)));delete s.uv;
  }
  const err=rederiveFaces(S,[...fset]);
  if(err)return refuse(err);
  const val=validate(S);
  if(!val.ok)return refuse('move vertex broke the shell: '+val.msgs[0]);
  return ok(S);
}
/* ---------------- transforms -------------------------------- */
function transform(S0,M){ // M: {t:[..], r:3x3 rows or null, s:uniform}
  const S=clone(S0);
  const R=M.r||[[1,0,0],[0,1,0],[0,0,1]],sc=M.s==null?1:M.s,t=M.t||[0,0,0];
  const mp=p=>add([
    (R[0][0]*p[0]+R[0][1]*p[1]+R[0][2]*p[2])*sc,
    (R[1][0]*p[0]+R[1][1]*p[1]+R[1][2]*p[2])*sc,
    (R[2][0]*p[0]+R[2][1]*p[1]+R[2][2]*p[2])*sc],t);
  const md=d=>norm([
    R[0][0]*d[0]+R[0][1]*d[1]+R[0][2]*d[2],
    R[1][0]*d[0]+R[1][1]*d[1]+R[1][2]*d[2],
    R[2][0]*d[0]+R[2][1]*d[1]+R[2][2]*d[2]]);
  for(const v of Object.values(S.verts))v.p=mp(v.p);
  for(const e of Object.values(S.edges)){
    const c=e.crv;
    if(c.t==='line'){c.p=mp(c.p);c.d=md(c.d);}
    else if(c.t==='poly')c.pts=c.pts.map(mp);
    else{c.c=mp(c.c);c.a=md(c.a);c.x=md(c.x);c.r*=sc;}
    if(e.v0!=null)refreshParams(S,e.id);
  }
  for(const f of Object.values(S.faces)){
    const s=f.surf;delete s.uv;
    if(s.t==='plane'){s.o=mp(s.o);s.n=md(s.n);}
    else{s.c=mp(s.c);s.a=md(s.a);s.x=md(s.x);
      if(s.r!=null)s.r*=sc;if(s.R!=null)s.R*=sc;}
  }
  return ok(S);
}
function scaleNonUniform(S0,origin,sx,sy,sz){
  const S=clone(S0);
  for(const f of Object.values(S.faces))
    if(f.surf.t!=='plane')return refuse('non-uniform scale needs every face planar — curved surfaces would leave the plane/cylinder/cone family (this is a B-rep, not a polygon mesh)');
  const mp=p=>[origin[0]+(p[0]-origin[0])*sx,origin[1]+(p[1]-origin[1])*sy,origin[2]+(p[2]-origin[2])*sz];
  for(const v of Object.values(S.verts))v.p=mp(v.p);
  for(const e of Object.values(S.edges)){
    if(e.crv.t!=='line')return refuse('non-uniform scale of curved edges is not supported');
    e.crv.p=mp(e.crv.p);
    e.crv.d=norm([e.crv.d[0]*sx,e.crv.d[1]*sy,e.crv.d[2]*sz]);
    refreshParams(S,e.id);
  }
  for(const f of Object.values(S.faces)){
    const s=f.surf;delete s.uv;
    s.o=mp(s.o);
    s.n=norm([s.n[0]/sx,s.n[1]/sy,s.n[2]/sz]);
  }
  const val=validate(S);
  if(!val.ok)return refuse('scale broke the shell: '+val.msgs[0]);
  return ok(S);
}

/* ---------------- tessellation ------------------------------ */
const ANG=Math.PI/45; // 4°
function sampleEdge(e){
  const c=e.crv,t0=e.v0==null?0:e.t0,t1=e.v0==null?(c.t==='poly'?c.pts.length-1:2*Math.PI):e.t1;
  if(c.t==='line')return [crvPt(c,t0),crvPt(c,t1)];
  if(c.t==='poly'){
    const pts=[];const i0=Math.ceil(t0),i1=Math.floor(t1);
    pts.push(crvPt(c,t0));
    for(let i=i0;i<=i1;i++)if(i>t0+1e-9&&i<t1-1e-9)pts.push(c.pts[i]);
    pts.push(crvPt(c,t1));
    return pts;
  }
  const n=Math.max(2,Math.ceil((t1-t0)/ANG));
  const pts=[];
  for(let i=0;i<=n;i++)pts.push(crvPt(c,t0+(t1-t0)*i/n));
  return pts;
}
function earclip(loops){ // loops: [[ [x,y],… ]] outer first (CCW), holes CW → triangle index triples into flat pts
  const pts=[];const ring=[];
  const area=L=>{let a=0;for(let i=0;i<L.length;i++){const p=L[i],q=L[(i+1)%L.length];a+=p[0]*q[1]-q[0]*p[1];}return a/2;};
  let outer=loops[0].slice();if(area(outer)<0)outer.reverse();
  const holes=loops.slice(1).map(h=>{h=h.slice();if(area(h)>0)h.reverse();return h;});
  // bridge holes (rightmost-first)
  holes.sort((a,b)=>Math.max(...b.map(p=>p[0]))-Math.max(...a.map(p=>p[0])));
  const segInt=(a,b,c,d)=>{
    const r=[b[0]-a[0],b[1]-a[1]],s=[d[0]-c[0],d[1]-c[1]];
    const den=r[0]*s[1]-r[1]*s[0];if(Math.abs(den)<1e-14)return false;
    const t=((c[0]-a[0])*s[1]-(c[1]-a[1])*s[0])/den;
    const u=((c[0]-a[0])*r[1]-(c[1]-a[1])*r[0])/den;
    return t>1e-9&&t<1-1e-9&&u>1e-9&&u<1-1e-9;
  };
  for(const h of holes){
    let hi=0;for(let i=1;i<h.length;i++)if(h[i][0]>h[hi][0])hi=i;
    let best=-1,bd=Infinity;
    for(let oi=0;oi<outer.length;oi++){
      const d2=(outer[oi][0]-h[hi][0])**2+(outer[oi][1]-h[hi][1])**2;
      if(d2>=bd)continue;
      let vis=true;
      const allLoops=[outer,...holes];
      for(const L of allLoops){
        for(let i=0;i<L.length;i++){
          const a=L[i],b=L[(i+1)%L.length];
          if(a===h[hi]||b===h[hi]||a===outer[oi]||b===outer[oi])continue;
          if(segInt(h[hi],outer[oi],a,b)){vis=false;break;}
        }
        if(!vis)break;
      }
      if(vis){bd=d2;best=oi;}
    }
    if(best<0)best=0;
    const merged=outer.slice(0,best+1)
      .concat([...h.slice(hi),...h.slice(0,hi+1)])
      .concat(outer.slice(best));
    outer=merged;
  }
  outer.forEach(p=>{ring.push(pts.length);pts.push(p);});
  // ear clip
  const idx=ring.slice();const tris=[];
  const cross2=(o,a,b)=>(a[0]-o[0])*(b[1]-o[1])-(a[1]-o[1])*(b[0]-o[0]);
  const inTri=(p,a,b,c)=>{
    const d1=cross2(a,b,p),d2=cross2(b,c,p),d3=cross2(c,a,p);
    return (d1>=-1e-12&&d2>=-1e-12&&d3>=-1e-12);
  };
  let guard=idx.length*idx.length+50;
  while(idx.length>3&&guard-->0){
    let clipped=false;
    for(let i=0;i<idx.length;i++){
      const a=pts[idx[(i-1+idx.length)%idx.length]],b=pts[idx[i]],c=pts[idx[(i+1)%idx.length]];
      if(cross2(a,b,c)<=1e-13)continue;
      let ear=true;
      for(let j=0;j<idx.length;j++){
        const q=pts[idx[j]];
        if(q===a||q===b||q===c)continue;
        if(inTri(q,a,b,c)){ear=false;break;}
      }
      if(!ear)continue;
      tris.push([idx[(i-1+idx.length)%idx.length],idx[i],idx[(i+1)%idx.length]]);
      idx.splice(i,1);clipped=true;break;
    }
    if(!clipped){ // fallback: fan
      for(let i=1;i<idx.length-1;i++)tris.push([idx[0],idx[i],idx[i+1]]);
      idx.length=0;break;
    }
  }
  if(idx.length===3)tris.push([idx[0],idx[1],idx[2]]);
  return {pts,tris};
}
function tessFace(S,f,out){
  const s=f.surf;
  const loopPts=f.loops.map(L=>{
    const pts=[];
    for(const en of L){
      const e=S.edges[en.e];
      let sp=sampleEdge(e);
      if(!en.fwd)sp=sp.slice().reverse();
      for(let i=0;i<sp.length-1;i++)pts.push(sp[i]);
      if(e.v0==null&&L.length===1)pts.push(sp[sp.length-1]); // closed single edge loop keeps all
    }
    // dedupe closing point
    if(pts.length>1&&dist(pts[0],pts[pts.length-1])<1e-9)pts.pop();
    return pts;
  });
  const emit=(P3,N3,tris)=>{
    const base=out.positions.length;
    for(let i=0;i<P3.length;i++){out.positions.push(P3[i]);out.normals.push(N3[i]);}
    for(const t of tris){
      const [a,b,c]=t;
      const pa=P3[a],pb=P3[b],pc=P3[c];
      const fn=cross(sub(pb,pa),sub(pc,pa));
      const on=faceOutN(S,f,pa);
      const na=N3[a];
      if(dot(fn,add(na,add(N3[b],N3[c])))>=0)out.tris.push([base+a,base+b,base+c,f.id]);
      else out.tris.push([base+a,base+c,base+b,f.id]);
    }
  };
  if(s.t==='plane'){
    const n=faceOutN(S,f,loopPts[0][0]);
    const [u,v]=axisFrame(n);
    const l2=loopPts.map(L=>L.map(p=>[dot(p,u),dot(p,v)]));
    const {pts,tris}=earclip(l2);
    const P3=pts.map(q=>{ // invert: p = q0*u + q1*v + h*n
      const h=dot(loopPts[0][0],n);
      return add(add(mul(u,q[0]),mul(v,q[1])),mul(n,h));
    });
    emit(P3,P3.map(()=>n),tris);
    return;
  }
  // curved: parameterize loops with unwrapping
  const uvLoops=[];let wrapped=0;
  for(const L of loopPts){
    const uv=[];let hint=null;
    for(const p of L){
      const q=surfUV(s,p,hint);uv.push(q);hint=q;
    }
    // wrap detection
    const q0=surfUV(s,L[0],uv[uv.length-1]);
    if(Math.abs(q0[0]-uv[0][0])>Math.PI)wrapped++;
    uvLoops.push(uv);
  }
  if(wrapped===loopPts.length&&loopPts.length===2){
    // full ring (e.g. cylinder band, cone ring, torus band): grid strip
    const A=loopPts[0],B=loopPts[1];
    const N=Math.max(A.length,B.length,16);
    const P3=[],N3=[],tris=[];
    const pick=(L,i)=>L[Math.round(i*(L.length)/N)%L.length];
    // resample both rings by angle for alignment
    const byAng=L=>{
      const c=s.c;const res=[];
      for(let i=0;i<N;i++){
        const th=2*Math.PI*i/N;
        // find the ring point at that angle: rings are const-height/const-φ circles → reproject
        res.push(th);
      }
      return res;
    };
    const uvA0=surfUV(s,A[0]),uvB0=surfUV(s,B[0]);
    for(let i=0;i<=N;i++){
      const th=uvA0[0]+2*Math.PI*i/N;
      P3.push(surfPt(s,[th,uvA0[1]]));N3.push(mul(surfNuv(s,[th,uvA0[1]]),f.sense));
      P3.push(surfPt(s,[th,uvB0[1]]));N3.push(mul(surfNuv(s,[th,uvB0[1]]),f.sense));
    }
    for(let i=0;i<N;i++){
      const a=2*i,b=2*i+1,c=2*i+2,d=2*i+3;
      tris.push([a,b,c]);tris.push([c,b,d]);
    }
    emit(P3,N3,tris);
    return;
  }
  // open patch in UV — scale θ by a nominal radius to keep earclip well conditioned
  const rr=s.r||s.R||1;
  const l2=uvLoops.map(L=>L.map(q=>[q[0]*rr,s.t==='torus'?q[1]*(s.r||1):q[1]]));
  const {pts,tris}=earclip(l2);
  // refine large triangles (consistent midpoint cache per face)
  const uvPts=pts.map(q=>[q[0]/rr,s.t==='torus'?q[1]/(s.r||1):q[1]]);
  const cache=new Map();
  const midpoint=(i,j)=>{
    const key=i<j?i+'_'+j:j+'_'+i;
    if(cache.has(key))return cache.get(key);
    const q=[(uvPts[i][0]+uvPts[j][0])/2,(uvPts[i][1]+uvPts[j][1])/2];
    const idx=uvPts.length;uvPts.push(q);cache.set(key,idx);
    return idx;
  };
  let work=tris.slice();
  for(let pass=0;pass<6;pass++){
    const next=[];let any=false;
    for(const t of work){
      const spanTh=Math.max(Math.abs(uvPts[t[0]][0]-uvPts[t[1]][0]),Math.abs(uvPts[t[1]][0]-uvPts[t[2]][0]),Math.abs(uvPts[t[0]][0]-uvPts[t[2]][0]));
      const spanPh=s.t==='torus'?Math.max(Math.abs(uvPts[t[0]][1]-uvPts[t[1]][1]),Math.abs(uvPts[t[1]][1]-uvPts[t[2]][1]),Math.abs(uvPts[t[0]][1]-uvPts[t[2]][1])):0;
      if(spanTh>Math.PI/16||spanPh>Math.PI/16){
        any=true;
        const m01=midpoint(t[0],t[1]),m12=midpoint(t[1],t[2]),m20=midpoint(t[2],t[0]);
        next.push([t[0],m01,m20],[m01,t[1],m12],[m20,m12,t[2]],[m01,m12,m20]);
      }else next.push(t);
    }
    work=next;if(!any)break;
  }
  const P3=uvPts.map(q=>surfPt(s,q));
  const N3=uvPts.map(q=>mul(surfNuv(s,q),f.sense));
  emit(P3,N3,work);
}
function tessellate(S){
  const out={positions:[],normals:[],tris:[],edges:[],verts:[]};
  for(const f of Object.values(S.faces)){
    try{tessFace(S,f,out);}catch(err){/* keep going; face missing from shading */}
  }
  for(const e of Object.values(S.edges))
    out.edges.push({key:e.key,id:e.id,smooth:!!e.smooth,pts:sampleEdge(e)});
  for(const v of Object.values(S.verts))
    out.verts.push({key:v.key,id:v.id,p:v.p.slice()});
  return out;
}
function measure(S,mesh){
  const m=mesh||tessellate(S);
  let vol=0,area=0;
  for(const t of m.tris){
    const a=m.positions[t[0]],b=m.positions[t[1]],c=m.positions[t[2]];
    vol+=dot(a,cross(b,c))/6;
    area+=len(cross(sub(b,a),sub(c,a)))/2;
  }
  const nf=Object.keys(S.faces).length,ne=Object.keys(S.edges).length,nv=Object.keys(S.verts).length;
  const nSmooth=Object.values(S.edges).filter(e=>e.smooth).length;
  return {volume:S.shell?0:vol,area,faces:nf,edges:ne,tangentEdges:nSmooth,verts:nv,shell:!!S.shell};
}

root.SolidArcKernel={
  profile,extrude,blendEdge,blendEdges,moveFace,offsetFace,moveEdge,moveVertex,
  transform,scaleNonUniform,tessellate,measure,validate,clone,
  edgeByKey,faceByKey,vertByKey,
  math:K,
};
if(typeof module!=='undefined'&&module.exports)module.exports=root.SolidArcKernel;
})(typeof window!=='undefined'?window:globalThis);
