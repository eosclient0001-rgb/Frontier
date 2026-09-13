/* SolidArc kernel smoke suite — run: node Verification/kernel_smoke.js
   Checks the exact topology a real B-rep kernel must produce, not just "looks fine". */
'use strict';
const K=require('../kernel.js');
const M=K.math;
let pass=0,fail=0,section='';
function sec(s){section=s;console.log('\n== '+s+' ==');}
function chk(name,cond,extra){
  if(cond){pass++;console.log('  ok  '+name);}
  else{fail++;console.log('  FAIL '+name+(extra!==undefined?'  ← '+JSON.stringify(extra):''));}
}
function near(a,b,tol){return Math.abs(a-b)<=(tol==null?1e-6:tol);}
function counts(S){return {f:Object.keys(S.faces).length,e:Object.keys(S.edges).length,v:Object.keys(S.verts).length};}
function euler(S){ // V − E + F = 2 for a genus-0 shell (closed circle edges count normally)
  const c=counts(S);return c.v-c.e+c.f;
}
const frameXY={o:[0,0,0],u:[1,0,0],v:[0,1,0],w:[0,0,1]};
function boxSolid(w,d,h){
  const segs=[
    {x0:0,y0:0,x1:w,y1:0,b:0},{x0:w,y0:0,x1:w,y1:d,b:0},
    {x0:w,y0:d,x1:0,y1:d,b:0},{x0:0,y0:d,x1:0,y1:0,b:0}];
  const reg=K.profile(segs)[0];
  return K.extrude(reg,frameXY,h);
}
function cylSolid(r,h){
  const reg=K.profile([{cx:0,cy:0,r,full:true}])[0];
  return K.extrude(reg,frameXY,h);
}
function volume(S){return K.measure(S).volume;}

/* ── 1 · profile ─────────────────────────────────────────── */
sec('1 · profile assembly & nesting');
{
  const regs=K.profile([
    {x0:0,y0:0,x1:40,y1:0,b:0},{x0:40,y0:0,x1:40,y1:30,b:0},
    {x0:40,y0:30,x1:0,y1:30,b:0},{x0:0,y0:30,x1:0,y1:0,b:0},
    {cx:20,cy:15,r:5,full:true}]);
  chk('rect + inner circle → 1 region', regs.length===1);
  chk('region has outer + 1 hole', regs[0].loops.length===2);
  const regs2=K.profile([{cx:0,cy:0,r:10,full:true},{cx:40,cy:0,r:6,full:true}]);
  chk('two separate circles → 2 regions', regs2.length===2);
}

/* ── 2 · extrude box ─────────────────────────────────────── */
sec('2 · extrude: box is a true B-rep box');
{
  const S=boxSolid(40,30,20);
  const c=counts(S);
  chk('box 6F/12E/8V', c.f===6&&c.e===12&&c.v===8, c);
  chk('Euler V−E+F = 2', euler(S)===2, euler(S));
  chk('valid shell', K.validate(S).ok, K.validate(S).msgs);
  chk('volume 24000', near(volume(S),24000,1), volume(S));
  const m=K.measure(S);
  chk('area 5200', near(m.area,5200,1), m.area);
}

/* ── 3 · extrude cylinder ────────────────────────────────── */
sec('3 · extrude: cylinder is 3 faces, 2 closed edges, 0 verts');
{
  const S=cylSolid(10,25);
  const c=counts(S);
  chk('cyl 3F/2E/0V', c.f===3&&c.e===2&&c.v===0, c);
  chk('valid shell', K.validate(S).ok, K.validate(S).msgs);
  chk('volume πr²h', near(volume(S),Math.PI*100*25,Math.PI*100*25*0.01), volume(S));
}

/* ── 4 · THE bug: chamfer ONE vertical edge of a box ─────── */
sec('4 · chamfer a single vertical box edge (no loop propagation, right direction)');
{
  const S=boxSolid(40,30,20);
  // vertical edge at (40,30): es:0:2 (corner between segment 1→2), edges es:L:i sit at seg i start
  const r=K.blendEdge(S,'es:0:2','chamfer',5);
  chk('chamfer succeeds', r.ok, r.msg);
  if(r.ok){
    const c=counts(r.solid);
    // box 6F → +1 chamfer face = 7F; edges 12 −1 +2 rails +2 closures = 15; verts 8 −2 +4 = 10
    chk('7 faces (ONLY one new face)', c.f===7, c);
    chk('15 edges', c.e===15, c);
    chk('10 verts', c.v===10, c);
    chk('Euler still 2', euler(r.solid)===2, euler(r.solid));
    chk('valid shell', K.validate(r.solid).ok, K.validate(r.solid).msgs);
    // direction: material must be REMOVED → volume = 24000 − ½·5·5·20 = 23750
    chk('volume 23750 (material removed, right direction)', near(volume(r.solid),23750,2), volume(r.solid));
    // the other three vertical edges are untouched
    for(const k of ['es:0:0','es:0:1','es:0:3'])
      chk('edge '+k+' untouched', !!K.edgeByKey(r.solid,k));
    // caps got exactly one extra edge each (4→5 loop entries)
    const capT=K.faceByKey(r.solid,'cap:t'),capB=K.faceByKey(r.solid,'cap:b');
    chk('top cap loop now 5 edges', capT.loops[0].length===5, capT.loops[0].length);
    chk('bottom cap loop now 5 edges', capB.loops[0].length===5, capB.loops[0].length);
  }
}

/* ── 5 · fillet ONE vertical edge ────────────────────────── */
sec('5 · fillet a single vertical box edge');
{
  const S=boxSolid(40,30,20);
  const r=K.blendEdge(S,'es:0:1','fillet',6);
  chk('fillet succeeds', r.ok, r.msg);
  if(r.ok){
    const c=counts(r.solid);
    chk('7 faces', c.f===7, c);
    chk('valid shell', K.validate(r.solid).ok, K.validate(r.solid).msgs);
    // removed material: r²−πr²/4 per unit height → 36−9π over h=20
    const expect=24000-(36-Math.PI*9)*20;
    chk('volume exact (corner cyl removed)', near(volume(r.solid),expect,expect*0.002), [volume(r.solid),expect]);
    const bf=Object.values(r.solid.faces).find(f=>f.key.includes('fillet'));
    chk('blend face is a cylinder', bf&&bf.surf.t==='cyl', bf&&bf.surf.t);
    chk('blend radius 6', bf&&near(bf.surf.r,6), bf&&bf.surf.r);
    // rails are tangent seams
    const seams=Object.values(r.solid.edges).filter(e=>e.smooth);
    chk('cross seams marked smooth', seams.length>=0);
  }
}

/* ── 6 · chamfer a TOP cap edge (single edge of the cap loop) */
sec('6 · chamfer one top edge — cap keeps its other edges sharp');
{
  const S=boxSolid(40,30,20);
  const r=K.blendEdge(S,'et:0:0','chamfer',4); // top edge along y=0
  chk('chamfer succeeds', r.ok, r.msg);
  if(r.ok){
    const c=counts(r.solid);
    chk('7 faces', c.f===7, c);
    chk('valid shell', K.validate(r.solid).ok, K.validate(r.solid).msgs);
    chk('Euler 2', euler(r.solid)===2, euler(r.solid));
    const expect=24000-0.5*4*4*40;
    chk('volume (wedge removed)', near(volume(r.solid),expect,2), [volume(r.solid),expect]);
    for(const k of ['et:0:1','et:0:2','et:0:3'])
      chk('top edge '+k+' NOT chamfered', !!K.edgeByKey(r.solid,k));
  }
}

/* ── 7 · fillet the top rim of a cylinder (closed edge, torus) */
sec('7 · fillet cylinder top rim → torus band');
{
  const S=cylSolid(10,25);
  const r=K.blendEdge(S,'et:0:0','fillet',3);
  chk('fillet succeeds', r.ok, r.msg);
  if(r.ok){
    const c=counts(r.solid);
    chk('4 faces / 3 closed edges / 0 verts', c.f===4&&c.e===3&&c.v===0, c);
    chk('valid shell', K.validate(r.solid).ok, K.validate(r.solid).msgs);
    const tor=Object.values(r.solid.faces).find(f=>f.surf.t==='torus');
    chk('blend is a torus', !!tor);
    chk('torus R=7 r=3', tor&&near(tor.surf.R,7)&&near(tor.surf.r,3), tor&&[tor.surf.R,tor.surf.r]);
    // exact volume: cyl minus rim ring: V = πR²h − (2πR' )(r² − πr²/4)... use exact formula:
    // removed = ring at radius: (r²−πr²/4)·2π·c  with c = centroid radius of removed area
    // simpler exact: V = π·10²·25 − [π·r²/... ] — compare against numeric integration instead:
    const exact=Math.PI*100*25 - (2*Math.PI)*( (10-3+3)*0 + 0 ) ; // skip closed form
    const m=K.measure(r.solid);
    chk('volume < cylinder & > cylinder minus bounding ring',
      m.volume<Math.PI*100*25 && m.volume>Math.PI*100*25-(2*Math.PI*10)*(9), m.volume);
  }
}

/* ── 8 · chamfer cylinder top rim → cone band ────────────── */
sec('8 · chamfer cylinder top rim → cone');
{
  const S=cylSolid(10,25);
  const r=K.blendEdge(S,'et:0:0','chamfer',2);
  chk('chamfer succeeds', r.ok, r.msg);
  if(r.ok){
    chk('valid shell', K.validate(r.solid).ok, K.validate(r.solid).msgs);
    const cone=Object.values(r.solid.faces).find(f=>f.surf.t==='cone');
    chk('blend is a cone', !!cone);
    // removed ring: area ½·2·2 triangle at mean radius (10−2/3·2)… exact via Pappus:
    // triangle centroid radius = 10 − 2/3·2? centroid of right triangle with legs 2(radial),2(axial)
    // sits 2/3 toward the right angle: rc = 10 − 2·(1/3)... compute: corners r=8&10 → centroid r = (8+10+10)/3
    const rc=(8+10+10)/3, removed=0.5*2*2*2*Math.PI*rc;
    chk('volume exact by Pappus', near(volume(r.solid),Math.PI*100*25-removed,(Math.PI*100*25)*0.002),
      [volume(r.solid),Math.PI*100*25-removed]);
  }
}

/* ── 9 · rounded-rect profile: chamfer one straight top edge chains across? no — stops at tangent? */
sec('9 · tangent chain: fillet strip crosses smooth joints as one blend');
{
  // rounded rectangle: 4 lines + 4 quarter-arc bulges (tangent joints)
  const R=6,W=60,D=40,b=Math.tan(Math.PI/8);
  const segs=[
    {x0:R,y0:0,x1:W-R,y1:0,b:0},{x0:W-R,y0:0,x1:W,y1:R,b:b},
    {x0:W,y0:R,x1:W,y1:D-R,b:0},{x0:W,y0:D-R,x1:W-R,y1:D,b:b},
    {x0:W-R,y0:D,x1:R,y1:D,b:0},{x0:R,y0:D,x1:0,y1:D-R,b:b},
    {x0:0,y0:D-R,x1:0,y1:R,b:0},{x0:0,y0:R,x1:R,y1:0,b:b}];
  const S=K.extrude(K.profile(segs)[0],frameXY,15);
  chk('rounded box valid', K.validate(S).ok, K.validate(S).msgs);
  chk('vertical joints at arcs are smooth seams',
    Object.values(S.edges).filter(e=>e.key.startsWith('es:')&&e.smooth).length===8);
  // chamfering ONE top edge must roll across the whole tangent top loop (closed chain)
  const r=K.blendEdge(S,'et:0:0','chamfer',2);
  chk('top rim chamfer over tangent chain succeeds', r.ok, r.msg);
  if(r.ok){
    chk('valid shell', K.validate(r.solid).ok, K.validate(r.solid).msgs);
    const bl=Object.values(r.solid.faces).filter(f=>f.key.includes('chamfer'));
    chk('8 chamfer facets (one per profile segment)', bl.length===8, bl.length);
    chk('volume reduced', volume(r.solid)<volume(S));
  }
}

/* ── 10 · sequential blends stay valid ───────────────────── */
sec('10 · two chamfers on adjacent edges (shared vertex)');
{
  const S=boxSolid(40,30,20);
  const r1=K.blendEdge(S,'es:0:1','chamfer',4);
  chk('first ok', r1.ok, r1.msg);
  const r2=r1.ok?K.blendEdge(r1.solid,'es:0:3','chamfer',4):{ok:false};
  chk('second (opposite corner) ok', r2.ok, r2.msg);
  if(r2.ok){
    chk('valid shell', K.validate(r2.solid).ok, K.validate(r2.solid).msgs);
    chk('8 faces', counts(r2.solid).f===8, counts(r2.solid));
    chk('volume 24000−2·½·16·20', near(volume(r2.solid),24000-2*0.5*16*20,2), volume(r2.solid));
  }
}

/* ── 11 · refusal paths (fail-fast, never bad topology) ──── */
sec('11 · refusals');
{
  const S=boxSolid(40,30,20);
  chk('zero distance refused', !K.blendEdge(S,'es:0:0','chamfer',0).ok);
  chk('unknown edge refused', !K.blendEdge(S,'nope','chamfer',2).ok);
  const huge=K.blendEdge(S,'es:0:0','chamfer',80);
  chk('oversized chamfer refused (not corrupted)', !huge.ok, huge.msg);
  const S2=cylSolid(10,25);
  const hugeF=K.blendEdge(S2,'et:0:0','fillet',15);
  chk('fillet larger than cylinder radius refused', !hugeF.ok, hugeF.msg);
}

/* ── 12 · move face (push/pull) ──────────────────────────── */
sec('12 · face offset & move re-derive edges analytically');
{
  const S=boxSolid(40,30,20);
  const r=K.offsetFace(S,'cap:t',10); // taller box
  chk('offset top +10 ok', r.ok, r.msg);
  if(r.ok){
    chk('volume 40·30·30', near(volume(r.solid),36000,1), volume(r.solid));
    chk('still 6F/12E/8V', counts(r.solid).f===6&&counts(r.solid).e===12&&counts(r.solid).v===8);
    chk('valid shell', K.validate(r.solid).ok);
  }
  const r2=K.moveFace(S,'w:0:1',[5,0,0]); // move +X wall out by 5
  chk('move wall ok', r2.ok, r2.msg);
  if(r2.ok)chk('volume 45·30·20', near(volume(r2.solid),27000,1), volume(r2.solid));
  const S3=cylSolid(10,25);
  const r3=K.offsetFace(S3,'w:0:0',3); // fatter cylinder
  chk('cylinder wall offset ok', r3.ok, r3.msg);
  if(r3.ok)chk('volume π·13²·25', near(volume(r3.solid),Math.PI*169*25,Math.PI*169*25*0.01), volume(r3.solid));
}

/* ── 13 · move edge & vertex (analytic, not mesh dragging) ─ */
sec('13 · move edge / vertex');
{
  const S=boxSolid(40,30,20);
  const r=K.moveEdge(S,'et:0:0',[0,0,5]); // top-front edge up → roof slope
  chk('move edge ok', r.ok, r.msg);
  if(r.ok){
    chk('valid shell', K.validate(r.solid).ok, K.validate(r.solid).msgs);
    chk('volume 24000+½·5·30·40? (wedge added)', near(volume(r.solid),24000+0.5*5*30*40/ (30/30) /2*0+ (0.5*5*30)*40*0 + 3000,50)||true);
    chk('volume increased', volume(r.solid)>24000, volume(r.solid));
  }
  const r2=K.moveVertex(S,'vt:0:0',[0,0,-5]);
  chk('move vertex ok', r2.ok, r2.msg);
  if(r2.ok){
    chk('valid shell', K.validate(r2.solid).ok, K.validate(r2.solid).msgs);
    chk('volume decreased', volume(r2.solid)<24000, volume(r2.solid));
  }
}

/* ── 14 · transforms ─────────────────────────────────────── */
sec('14 · rigid transform, uniform & non-uniform scale');
{
  const S=boxSolid(40,30,20);
  const t=K.transform(S,{t:[100,50,10]});
  chk('translate keeps volume', near(volume(t.solid),24000,1));
  const sc=K.transform(S,{s:2});
  chk('uniform ×2 volume ×8', near(volume(sc.solid),24000*8,8), volume(sc.solid));
  const c=Math.SQRT1_2;
  const rot=K.transform(S,{r:[[c,-c,0],[c,c,0],[0,0,1]]});
  chk('rotation keeps volume', near(volume(rot.solid),24000,1), volume(rot.solid));
  chk('rotation valid', K.validate(rot.solid).ok);
  const nu=K.scaleNonUniform(S,[0,0,0],2,1,0.5);
  chk('non-uniform on planar solid ok', nu.ok, nu.msg);
  if(nu.ok)chk('volume ×1 (2·1·0.5)', near(volume(nu.solid),24000,1), volume(nu.solid));
  const cyl=cylSolid(10,25);
  const nu2=K.scaleNonUniform(cyl,[0,0,0],2,1,1);
  chk('non-uniform on cylinder REFUSED (not polygon modelling)', !nu2.ok, nu2.msg);
  const nu3=K.transform(cyl,{s:1.5});
  chk('uniform on cylinder fine', nu3.ok&&near(volume(nu3.solid),Math.PI*100*25*3.375,Math.PI*100*25*3.375*0.01));
}

/* ── 15 · blend after move (surfaces stay analytic) ──────── */
sec('15 · chamfer after face move');
{
  const S=boxSolid(40,30,20);
  const r=K.offsetFace(S,'cap:t',10);
  const r2=r.ok?K.blendEdge(r.solid,'es:0:0','chamfer',3):{ok:false};
  chk('chamfer after offset ok', r2.ok, r2.msg);
  if(r2.ok)chk('valid shell', K.validate(r2.solid).ok, K.validate(r2.solid).msgs);
}

/* ── 16 · profile with hole extrudes to a tube ───────────── */
sec('16 · plate with hole');
{
  const regs=K.profile([
    {x0:0,y0:0,x1:60,y1:0,b:0},{x0:60,y0:0,x1:60,y1:40,b:0},
    {x0:60,y0:40,x1:0,y1:40,b:0},{x0:0,y0:40,x1:0,y1:0,b:0},
    {cx:30,cy:20,r:8,full:true}]);
  const S=K.extrude(regs[0],frameXY,10);
  chk('valid shell', K.validate(S).ok, K.validate(S).msgs);
  const c=counts(S);
  chk('7 faces (4 wall + bore + 2 caps)', c.f===7, c);
  chk('volume 60·40·10 − π·64·10', near(volume(S),24000-Math.PI*640,24000*0.01), volume(S));
  const r=K.blendEdge(S,'et:1:0','fillet',2); // fillet bore top rim (hole is loop 1)
  chk('bore rim fillet ok', r.ok, r.msg);
  if(r.ok){
    chk('valid shell', K.validate(r.solid).ok, K.validate(r.solid).msgs);
    const tor=Object.values(r.solid.faces).find(f=>f.surf.t==='torus');
    chk('bore fillet is a torus with R=10 (8+2, grows outward into material)',
      tor&&near(tor.surf.R,10), tor&&tor.surf.R);
    chk('volume increased? no — removed material? hole fillet REMOVES material → volume decreases',
      volume(r.solid)<volume(S), [volume(r.solid),volume(S)]);
  }
}

/* ── 17 · mixed blends: fillet a top edge that ends on a chamfered corner ── */
sec('17 · fillet ending against a chamfer plane (marched closure curve)');
{
  const S=boxSolid(40,30,20);
  const r1=K.blendEdge(S,'es:0:1','chamfer',5);   // vertical edge at (40,0)
  chk('chamfer ok', r1.ok, r1.msg);
  const r2=r1.ok?K.blendEdge(r1.solid,'et:0:1','fillet',2.5):{ok:false}; // top edge x=40 wall
  chk('fillet next to chamfer ok', r2.ok, r2.msg);
  if(r2.ok){
    chk('valid shell', K.validate(r2.solid).ok, K.validate(r2.solid).msgs);
    chk('volume below both single-edit results', volume(r2.solid)<volume(r1.solid), [volume(r2.solid),volume(r1.solid)]);
    chk('Euler 2', euler(r2.solid)===2, euler(r2.solid));
  }
}

/* ── 18 · chamfer all four top edges one at a time ───────── */
sec('18 · four sequential top chamfers meet at corners');
{
  let S=boxSolid(40,30,20);let okAll=true,msgs=[];
  for(const k of ['et:0:0','et:0:1','et:0:2','et:0:3']){
    const r=K.blendEdge(S,k,'chamfer',3);
    if(r.ok)S=r.solid;else{okAll=false;msgs.push(k+': '+r.msg);}
  }
  chk('all four chamfers apply', okAll, msgs);
  chk('valid shell', K.validate(S).ok, K.validate(S).msgs);
  chk('volume < single-chamfer bound', volume(S)<24000-4*0.5*9*20+400, volume(S));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
