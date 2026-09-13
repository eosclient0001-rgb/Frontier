/* Sketch-layer smoke — endpoint welding (closed by default), slot / polyline slot geometry,
   polygon scroll-confirm, live dimension providers, inspector property math, region fill.
   Run: node Verification/sketch_smoke.js (jsdom on NODE_PATH; skips politely without it) */
'use strict';
let JSDOM;
try{({JSDOM}=require('jsdom'));}
catch(e){try{({JSDOM}=require('/tmp/node_modules/jsdom'));}catch(e2){
  console.log('jsdom not installed — skipping sketch smoke.');process.exit(0);}}
const fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'..');
const dom=new JSDOM(fs.readFileSync(path.join(dir,'index.html'),'utf8'),{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'});
const w=dom.window;
let fillCalls=0,fillRule=null;
w.HTMLCanvasElement.prototype.getContext=function(){return new Proxy({},{get:(t,p)=>{
  if(typeof p!=='string')return undefined;
  if(p==='measureText')return ()=>({width:30});
  if(p==='fill')return r=>{fillCalls++;if(r)fillRule=r;};
  if(['fillStyle','strokeStyle','lineWidth','font','globalAlpha'].includes(p))return t[p];
  return ()=>{};
},set:(t,p,v)=>{t[p]=v;return true;}});};
w.HTMLCanvasElement.prototype.getBoundingClientRect=function(){return {left:0,top:0,width:800,height:600,right:800,bottom:600};};
w.HTMLCanvasElement.prototype.setPointerCapture=function(){};w.HTMLCanvasElement.prototype.releasePointerCapture=function(){};
if(!w.ResizeObserver)w.ResizeObserver=class{observe(){}disconnect(){}};
w.requestAnimationFrame=f=>setTimeout(f,16);
w.eval(fs.readFileSync(path.join(dir,'kernel.js'),'utf8'));
w.eval(fs.readFileSync(path.join(dir,'app.js'),'utf8'));
const P=w.__SolidArcPanel,doc=w.document,K=w.SolidArcKernel;
const cv=doc.querySelector('#gl');
let pass=0,fail=0;
const chk=(n,c,x)=>{if(c){pass++;console.log('  ok  '+n);}else{fail++;console.log('  FAIL '+n+(x!==undefined?' ← '+JSON.stringify(x):''));}};
function cmd(s){const i=doc.querySelector('#cmdIn');i.value=s;i.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}
function click(x,y){cv.dispatchEvent(new w.MouseEvent('pointerdown',{clientX:x,clientY:y,bubbles:true,button:0}));
  cv.dispatchEvent(new w.MouseEvent('pointerup',{clientX:x,clientY:y,bubbles:true,button:0}));}
function key(k){w.dispatchEvent(new w.KeyboardEvent('keydown',{key:k,bubbles:true}));}
// top-down view so clicks land on the XY plane predictably
function topView(){P.cam.az=-Math.PI/2;P.cam.el=1.569;P.cam.target=[0,0,0];P.cam.dist=200;P.draw();}

console.log('== closed by default: polyline welds & auto-closes ==');
topView();
P.startTool('polyline');
click(300,300);click(500,300);click(500,200);click(340,220); // 4 points, NOT back on start
key('Enter');
let sk=P.doc.figures.find(f=>f.kind==='sketch');
chk('polyline finished into segs',sk&&sk.segs.length===4,sk&&sk.segs.length);
if(sk){
  const regs=K.profile(sk.segs);
  chk('auto-closed → 1 closed region',regs.length===1,regs.length);
  const last=sk.segs[sk.segs.length-1],firstSeg=sk.segs[0];
  chk('last endpoint EXACTLY equals first start (welded, not just near)',
    last.x1===firstSeg.x0&&last.y1===firstSeg.y0,[last.x1,last.y1,firstSeg.x0,firstSeg.y0]);
  fillCalls=0;fillRule=null;P.draw();
  chk('closed region renders a fill (evenodd)',fillCalls>0&&fillRule==='evenodd',[fillCalls,fillRule]);
}

console.log('== endpoint weld snap while drawing lines (across separate shape figures) ==');
cmd('clear');
topView();
P.startTool('line');
click(300,300);click(500,300);   // line 1 → its own figure
click(502,302);click(500,200);   // line 2 starts ~2px off line 1's end → must weld
key('Escape');
let lines=P.doc.figures.filter(f=>f.kind==='sketch');
chk('each line is its own outliner figure',lines.length===2&&lines.every(f=>f.segs.length===1),lines.map(f=>[f.name,f.segs.length]));
if(lines.length===2)
  chk('second line start welded onto first end (cross-figure)',
    lines[1].segs[0].x0===lines[0].segs[0].x1&&lines[1].segs[0].y0===lines[0].segs[0].y1,
    [lines[0].segs[0].x1,lines[0].segs[0].y1,lines[1].segs[0].x0,lines[1].segs[0].y0]);
chk('figures named per shape (Line001, Line002)',
  lines.length===2&&lines[0].name==='Line001'&&lines[1].name==='Line002',lines.map(f=>f.name));

console.log('== slot: analytic outline, closes, extrudes ==');
cmd('clear');
topView();
P.startTool('slot');
click(300,300);click(500,300);click(400,260); // start, end, width point
sk=P.doc.figures.find(f=>f.kind==='sketch');
chk('slot created segs',sk&&sk.segs.length>0,sk&&sk.segs.length);
if(sk&&sk.segs.length){
  chk('slot = 2 lines + 2 semicircle arcs',sk.segs.length===4&&sk.segs.filter(s=>s.b).length===2,
    sk.segs.map(s=>s.b?'arc':'line'));
  const arcs=sk.segs.filter(s=>s.b);
  chk('caps are true semicircles (|sweep|=180°)',
    arcs.every(s=>Math.abs(Math.abs(4*Math.atan(s.b))-Math.PI)<1e-9),
    arcs.map(s=>4*Math.atan(s.b)*180/Math.PI));
  const regs=K.profile(sk.segs);
  chk('slot outline closes into 1 region',regs.length===1,regs.length);
  if(regs.length===1){
    const S=K.extrude(regs[0],{o:[0,0,0],u:[1,0,0],v:[0,1,0],w:[0,0,1]},10);
    chk('slot extrudes to a valid solid',K.validate(S).ok,K.validate(S).msgs);
  }
}

console.log('== polyline slot: two-stage, tangent outer corners ==');
cmd('clear');
topView();
P.startTool('pslot');
click(280,340);click(420,340);click(420,220); // L-shaped spine
key('Enter');                                  // → width stage
cv.dispatchEvent(new w.MouseEvent('pointermove',{clientX:400,clientY:320,bubbles:true}));
click(400,320);                                // commit width
sk=P.doc.figures.find(f=>f.kind==='sketch');
chk('polyline slot created',sk&&sk.segs.length>0,sk&&sk.segs.length);
if(sk&&sk.segs.length){
  const regs=K.profile(sk.segs);
  chk('outline closes into 1 region',regs.length===1,regs.length);
  const arcs=sk.segs.filter(s=>s.b);
  chk('has end caps + outer corner arc (3 arcs)',arcs.length===3,sk.segs.map(s=>s.b?'a':'l').join(''));
  if(regs.length===1){
    const S=K.extrude(regs[0],{o:[0,0,0],u:[1,0,0],v:[0,1,0],w:[0,0,1]},8);
    chk('extrudes valid',K.validate(S).ok,K.validate(S).msgs);
  }
}

console.log('== polygon: scroll-to-set-sides confirm step (original interaction) ==');
cmd('clear');
topView();
P.startTool('polygon');
click(400,300);          // centre
click(460,300);          // vertex → enters sides stage
chk('after vertex click tool waits in sides stage',P.tool&&P.tool.stage==='sides',P.tool&&P.tool.stage);
cv.dispatchEvent(new w.WheelEvent('wheel',{deltaY:-1,bubbles:true,cancelable:true})); // 6→7
cv.dispatchEvent(new w.WheelEvent('wheel',{deltaY:-1,bubbles:true,cancelable:true})); // 7→8
chk('scroll up increments sides to 8',P.tool.sides===8,P.tool&&P.tool.sides);
key('Enter');            // confirm
sk=P.doc.figures.find(f=>f.kind==='sketch');
chk('polygon committed with 8 sides',sk&&sk.segs.length===8,sk&&sk.segs.length);
if(sk&&sk.segs.length===8){
  const regs=K.profile(sk.segs);
  chk('octagon closes into 1 region',regs.length===1,regs.length);
}
key('Escape');

console.log('== live dimensions ==');
const T=P.TOOLS;
{
  const p0={u:0,v:0},p1={u:40,v:0},p2={u:40,v:30};
  let d=T.line.dims([p0,{u:30,v:30}]);
  chk('line dims = length + angle from horizontal',
    d.length===2&&d[1].kind==='ang'&&d[1].label==='45.0°'&&!!d[1].ref,d.map(x=>x.label));
  d=T.line.dims([p0,p1]);
  chk('horizontal line: length only (no 0° angle)',d.length===1&&d[0].label==='40.0',d.map(x=>x.label));
  d=T.polyline.dims([p0,p1,{u:40,v:25}]);
  chk('polyline dims = leg length + 90° turn angle at vertex',
    d.length===2&&d[0].label==='25.0'&&d[1].kind==='ang'&&d[1].label==='90.0°',d.map(x=>x.label));
  d=T.polygon.dims([p0,{u:10,v:0}],{sides:6});
  chk('polygon dims include 60° central angle',
    d.length===2&&d[1].kind==='ang'&&d[1].label==='60.0°',d.map(x=>x.label));
  d=T.slot.dims([p0,{u:30,v:30}]);
  chk('slot spine dims = centres + angle from horizontal',
    d.length===2&&d[1].kind==='ang'&&d[1].label==='45.0°',d.map(x=>x.label));
  d=T.rect.dims([p0,p2]);
  chk('rect dims = width × height only',d.length===2&&d[0].label==='40.0'&&d[1].label==='30.0',d);
  d=T.circle.dims([p0,{u:10,v:0}]);
  chk('circle dim = R + ⌀',d.length===1&&/R 10.0/.test(d[0].label)&&/⌀ 20.0/.test(d[0].label),d);
  d=T.arc.dims([p0,{u:10,v:0},{u:0,v:10}]);
  chk('arc dims = R + sweep angle',d.length===2&&/R 10.0/.test(d[0].label)&&d[1].label==='90°',d);
  d=T.slot.dims([p0,p1,{u:20,v:8}]);
  chk('slot dims = centres + R',d.length===2&&/centres 40.0/.test(d[0].label)&&/R 8.0/.test(d[1].label),d);
  // preview path draws dims without crashing (drive via real pointer events)
  P.startTool('circle');
  click(400,300);
  cv.dispatchEvent(new w.MouseEvent('pointermove',{clientX:460,clientY:300,bubbles:true}));
  let threw=false;try{P.draw();}catch(e){threw=true;}
  chk('dim rendering in preview survives',!threw);
  key('Escape');key('Escape');
}

console.log('== ellipse tool ==');
cmd('clear');
topView();
P.startTool('ellipse');
click(400,300);click(460,300);click(400,270); // centre, rx, ry
sk=P.doc.figures.find(f=>f.kind==='sketch');
chk('ellipse created as own figure',sk&&sk.name==='Ellipse001'&&sk.shape==='ellipse',sk&&[sk.name,sk.shape]);
if(sk){
  chk('ellipse = 16 bulge arcs',sk.segs.length===16&&sk.segs.every(s=>s.b!==0),sk.segs.length);
  const regs=K.profile(sk.segs);
  chk('ellipse closes into 1 region',regs.length===1,regs.length);
  if(regs.length===1){
    const S=K.extrude(regs[0],{o:[0,0,0],u:[1,0,0],v:[0,1,0],w:[0,0,1]},10);
    chk('ellipse extrudes valid',K.validate(S).ok,K.validate(S).msgs);
  }
}
key('Escape');

console.log('== multi-shape profile: circle inside rect makes a hole ==');
cmd('clear');
topView();
P.startTool('rect');
click(300,340);click(500,240);
key('Escape');
P.startTool('circle');
click(400,290);click(430,290);
key('Escape');
{
  const shapes=P.doc.figures.filter(f=>f.kind==='sketch');
  chk('rect and circle are separate outliner figures',
    shapes.length===2&&shapes[0].name.startsWith('Rect')&&shapes[1].name.startsWith('Circle'),
    shapes.map(f=>f.name));
  P.startExtrude();
  cv.dispatchEvent(new w.MouseEvent('pointerdown',{clientX:400,clientY:200,bubbles:true,button:0}));
  const b2=P.doc.figures.find(f=>f.kind==='body');
  chk('extrude combines shapes on the plane',!!b2&&(b2.sketches||[]).length===2,b2&&b2.sketches);
  if(b2){
    const bs=P.bodySolid(b2);
    chk('solid valid with hole',bs.solid&&K.validate(bs.solid).ok,bs.solid&&K.validate(bs.solid).msgs);
    if(bs.solid){
      const inner=Object.values(bs.solid.faces).filter(f=>f.surf.t==='cyl');
      chk('circle became a cylindrical hole wall',inner.length>=1,inner.length);
    }
  }
}

console.log('== overlap fill renders as boolean (XOR) look ==');
cmd('clear');
topView();
P.startTool('circle');
click(380,300);click(440,300); // circle 1
click(440,300);click(500,300); // circle 2 overlapping
key('Escape');
{
  const cs=P.doc.figures.filter(f=>f.kind==='sketch');
  chk('two overlapping circles drawn',cs.length===2,cs.length);
  fillCalls=0;fillRule=null;P.draw();
  chk('overlap fill still renders (single even-odd path)',fillCalls>0&&fillRule==='evenodd',[fillCalls,fillRule]);
}

console.log('== fill property & shell extrude ==');
cmd('clear');
topView();
P.startTool('circle');
click(400,300);click(450,300);
key('Escape');
{
  const c1=P.doc.figures.find(f=>f.kind==='sketch');
  c1.fill=false; // profile toggled to unfilled → extrude must make a shell
  P.startExtrude();
  cv.dispatchEvent(new w.MouseEvent('pointerdown',{clientX:400,clientY:200,bubbles:true,button:0}));
  const b3=P.doc.figures.find(f=>f.kind==='body');
  chk('unfilled profile extrudes as shell',!!b3&&b3.shell===true,b3&&b3.shell);
  if(b3){
    const bs=P.bodySolid(b3);
    chk('shell solid valid (open rims allowed)',bs.solid&&K.validate(bs.solid).ok,bs.solid&&K.validate(bs.solid).msgs);
    chk('shell has no caps',bs.solid&&!Object.keys(bs.solid.faces).some(k=>bs.solid.faces[k].key&&bs.solid.faces[k].key.startsWith('cap')),null);
    chk('shell volume reported 0',K.measure(bs.solid).volume===0,K.measure(bs.solid).volume);
  }
}

console.log('== shape pose editing (move / rotate / scale) ==');
cmd('clear');
topView();
P.startTool('rect');
click(300,340);click(400,240);
key('Escape');
{
  const r1=P.doc.figures.find(f=>f.kind==='sketch');
  const bb0=P.shapeBBox(r1);
  P.applyShapeDelta(r1,{du:15,dv:-5});
  const bb1=P.shapeBBox(r1);
  chk('move shifts bbox centre exactly',
    Math.abs(bb1.c[0]-bb0.c[0]-15)<1e-9&&Math.abs(bb1.c[1]-bb0.c[1]+5)<1e-9,[bb0.c,bb1.c]);
  P.applyShapeDelta(r1,{ds:2});
  const bb2=P.shapeBBox(r1);
  chk('scale doubles width/height about centre',
    Math.abs(bb2.w-2*bb1.w)<1e-6&&Math.abs(bb2.h-2*bb1.h)<1e-6&&Math.abs(bb2.c[0]-bb1.c[0])<1e-6,[bb1.w,bb2.w]);
  P.applyShapeDelta(r1,{rot:Math.PI/2});
  const bb3=P.shapeBBox(r1);
  chk('90° rotation swaps width/height',
    Math.abs(bb3.w-bb2.h)<1e-6&&Math.abs(bb3.h-bb2.w)<1e-6,[bb2.w,bb2.h,bb3.w,bb3.h]);
  const regs=K.profile(r1.segs);
  chk('shape still closed after pose edits',regs.length===1,regs.length);
}

console.log('== 2-D booleans: unite / subtract / intersect ==');
cmd('clear');
topView();
// two overlapping axis-aligned rects via direct segs (exact areas)
function addRect(x0,y0,x1,y1){
  const sk={id:P.doc.next++,kind:'sketch',shape:'rect',name:'R'+P.doc.next,plane:'XY',vis:true,segs:[
    {x0,y0,x1,y1:y0,b:0},{x0:x1,y0,x1,y1,b:0},{x0:x1,y0:y1,x1:x0,y1,b:0},{x0,y0:y1,x1:x0,y1:y0,b:0}]};
  P.doc.figures.push(sk);return sk;
}
{
  const A=addRect(0,0,40,30),B=addRect(20,10,60,40); // overlap 20×20=400; A=1200 B=1200
  P.shapeBool('unite',[A,B]);
  let out=P.doc.figures.filter(f=>f.kind==='sketch');
  chk('unite replaces operands with one shape',out.length===1&&out[0].name.startsWith('Union'),out.map(f=>f.name));
  let regs=K.profile(out[0].segs);
  let area=regs.length?regs.reduce((a,rg)=>a+Math.abs(P.regionArea(rg)),0):0;
  chk('unite area = 1200+1200-400 = 2000',Math.abs(area-2000)<1,area);
  P.undo();
  const A2=P.doc.figures.filter(f=>f.kind==='sketch')[0],B2=P.doc.figures.filter(f=>f.kind==='sketch')[1];
  P.shapeBool('subtract',[A2,B2]);
  out=P.doc.figures.filter(f=>f.kind==='sketch');
  regs=K.profile(out[0].segs);
  area=regs.length?regs.reduce((a,rg)=>a+Math.abs(P.regionArea(rg)),0):0;
  chk('subtract area = 1200-400 = 800',Math.abs(area-800)<1,area);
  P.undo();
  const A3=P.doc.figures.filter(f=>f.kind==='sketch')[0],B3=P.doc.figures.filter(f=>f.kind==='sketch')[1];
  P.shapeBool('intersect',[A3,B3]);
  out=P.doc.figures.filter(f=>f.kind==='sketch');
  regs=out.length?K.profile(out[0].segs):[];
  area=regs.length?regs.reduce((a,rg)=>a+Math.abs(P.regionArea(rg)),0):0;
  chk('intersect area = 400',Math.abs(area-400)<1,area);
}

console.log('== multi-select panel ==');
cmd('clear');
topView();
{
  const A=addRect(0,0,30,30),B=addRect(50,0,80,30);
  P.selection=[{type:'sketch',body:A.id,key:null},{type:'sketch',body:B.id,key:null}];
  P.refresh();
  const html2=doc.querySelector('#insp').innerHTML;
  chk('multi-select shows boolean ops',/unite/.test(html2)&&/subtract/.test(html2)&&/intersect/.test(html2)&&/join/.test(html2),null);
  chk('multi-select shows delete all',/delete all/.test(html2));
  chk('multi-select lists both objects',/2 objects/.test(html2));
  P.shapeJoin([A,B]);
  const after=P.doc.figures.filter(f=>f.kind==='sketch');
  chk('join merges into one figure with 8 curves',after.length===1&&after[0].segs.length===8,after.map(f=>f.segs.length));
}

console.log('== inspector properties ==');
cmd('clear');
cmd('box 40 30 20');
let b=P.doc.figures.find(f=>f.kind==='body');
P.selection=[{type:'body',body:b.id,key:null}];
let html=doc.querySelector('#insp').innerHTML;
chk('body: volume shown',/volume/.test(html)&&/24.0k|24000/.test(html),null);
chk('body: size (bbox) shown',/size/.test(html)&&/40 × 30 × 20|40.0 × 30.0 × 20.0/.test(html.replace(/&nbsp;/g,' ')),null);
chk('body: surface area shown',/surface area/.test(html));
P.selection=[{type:'edge',body:b.id,key:'et:0:0'}];
html=doc.querySelector('#insp').innerHTML;
chk('edge: curve type + length',/line/.test(html)&&/length/.test(html)&&/40/.test(html));
P.selection=[{type:'face',body:b.id,key:'cap:t'}];
html=doc.querySelector('#insp').innerHTML;
chk('face: plane surface props',/plane/.test(html)&&/normal/.test(html));
// sketch props: circle 15 → area π·225
cmd('clear');
const doc2=P.doc;
const sk2={id:doc2.next++,kind:'sketch',name:'SkP',plane:'XY',vis:true,segs:[{cx:0,cy:0,r:15,full:true}]};
doc2.figures.push(sk2);
P.selection=[{type:'sketch',body:sk2.id,key:null}];
P.refresh();
html=doc.querySelector('#insp').innerHTML;
chk('sketch: exact area (π·15² ≈ 706.9)',/706\.9|707/.test(html),null);
chk('sketch: perimeter (2π·15 ≈ 94.2)',/94\.2/.test(html),null);
P.selection=[{type:'curve',body:sk2.id,key:0}];
html=doc.querySelector('#insp').innerHTML;
chk('curve: circle props with radius',/circle/.test(html)&&/15\.0/.test(html));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
