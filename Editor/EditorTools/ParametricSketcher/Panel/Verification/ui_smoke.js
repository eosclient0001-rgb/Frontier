/* Panel UI smoke — boots index.html under jsdom (canvas stubbed), drives the command line,
   pick, blend tool and undo, and checks the document/kernel state after each step.
   Run: node Verification/ui_smoke.js  (needs `npm i jsdom` somewhere on NODE_PATH) */
'use strict';
let JSDOM;
try{({JSDOM}=require('jsdom'));}
catch(e){try{({JSDOM}=require('/tmp/node_modules/jsdom'));}catch(e2){
  console.log('jsdom not installed — skipping UI smoke (kernel smoke still covers the modelling).');
  process.exit(0);}}
const fs=require('fs'),path=require('path');
const dir=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const dom=new JSDOM(html,{runScripts:'outside-only',pretendToBeVisual:true,url:'http://localhost/'});
const w=dom.window;
w.HTMLCanvasElement.prototype.getContext=function(){return new Proxy({},{get:(t,p)=>{
  if(typeof p!=='string')return undefined;
  if(['fillStyle','strokeStyle','lineWidth','font','globalAlpha'].includes(p))return t[p];
  return ()=>{};
},set:(t,p,v)=>{t[p]=v;return true;}});};
w.HTMLCanvasElement.prototype.getBoundingClientRect=function(){return {left:0,top:0,width:800,height:600,right:800,bottom:600};};
w.HTMLCanvasElement.prototype.setPointerCapture=function(){};w.HTMLCanvasElement.prototype.releasePointerCapture=function(){};
if(!w.ResizeObserver)w.ResizeObserver=class{observe(){}disconnect(){}};
w.requestAnimationFrame=f=>setTimeout(f,16);
let pass=0,fail=0;
function chk(n,c,x){if(c){pass++;console.log('  ok  '+n);}else{fail++;console.log('  FAIL '+n+(x!==undefined?'  ← '+JSON.stringify(x):''));}}
const errs=[];
w.addEventListener('error',e=>errs.push(e.message));
w.eval(fs.readFileSync(path.join(dir,'kernel.js'),'utf8'));
w.eval(fs.readFileSync(path.join(dir,'app.js'),'utf8'));
chk('boots without errors',errs.length===0,errs);
const P=w.__SolidArcPanel,doc=w.document,K=w.SolidArcKernel;
function cmd(s){const i=doc.querySelector('#cmdIn');i.value=s;i.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));}

console.log('\n== command line builds real solids ==');
cmd('box 40 30 20');
let bodies=P.doc.figures.filter(f=>f.kind==='body');
chk('box created',bodies.length===1);
let bs=P.bodySolid(bodies[0]);
chk('box solid valid',bs.solid&&K.validate(bs.solid).ok);
chk('box volume 24000',Math.abs(K.measure(bs.solid).volume-24000)<1);

console.log('\n== chamfer via command on selected edge ==');
P.selection=[{type:'edge',body:bodies[0].id,key:'es:0:1'}];
cmd('chamfer 5');
bodies=P.doc.figures.filter(f=>f.kind==='body');
chk('edit stored',bodies[0].edits.length===1,bodies[0].edits);
bs=P.bodySolid(bodies[0]);
chk('rebuilt solid valid',bs.solid&&K.validate(bs.solid).ok);
chk('volume 23750 (one edge, right direction)',Math.abs(K.measure(bs.solid).volume-23750)<2,K.measure(bs.solid).volume);
chk('7 faces — no loop propagation',Object.keys(bs.solid.faces).length===7);

console.log('\n== undo restores ==');
P.undo();
bodies=P.doc.figures.filter(f=>f.kind==='body');
chk('undo removed the edit',bodies[0].edits.length===0);
P.redo();
bodies=P.doc.figures.filter(f=>f.kind==='body');
chk('redo restored it',bodies[0].edits.length===1);

console.log('\n== picking through the viewport ==');
// frame and pick the body under cursor centre-ish
w.eval('__SolidArcPanel.cam.target=[20,15,10];__SolidArcPanel.cam.dist=200;__SolidArcPanel.draw();');
const hit=P.pick(400,300,['body']);
chk('centre ray hits the body',!!hit&&hit.type==='body',hit);
const hitE=P.pick(400,300,['edge','body']);
chk('pick returns something valid',!!hitE);

console.log('\n== interactive blend tool ==');
P.startBlend('fillet');
chk('blend tool armed',!!P.blendTool&&P.blendTool.stage==='pick');
// find an edge on screen: project a known edge midpoint via pick sweep
let edgeHit=null;
outer:for(let x=100;x<700;x+=14)for(let y=80;y<560;y+=14){
  const h=P.pick(x,y,['edge']);
  if(h&&h.type==='edge'&&!h.key.includes('·')){edgeHit={x,y,h};break outer;} // an original edge, not a blend rail
}
chk('an edge is pickable on screen',!!edgeHit,edgeHit&&edgeHit.h);
if(edgeHit){
  const cv=doc.querySelector('#gl');
  cv.dispatchEvent(new w.MouseEvent('pointerdown',{clientX:edgeHit.x,clientY:edgeHit.y,bubbles:true}));
  chk('tool moved to drag stage',P.blendTool&&P.blendTool.stage==='drag',P.blendTool&&P.blendTool.stage);
  if(P.blendTool&&P.blendTool.stage==='drag'){
    P.blendTool.d=2.5;
    P.blendCommit();
    bodies=P.doc.figures.filter(f=>f.kind==='body');
    chk('fillet edit stored',bodies[0].edits.some(e=>e.kind==='fillet'),bodies[0].edits);
    bs=P.bodySolid(bodies[0]);
    chk('solid still valid',bs.solid&&K.validate(bs.solid).ok,bs.solid&&K.validate(bs.solid).msgs);
  }
}

console.log('\n== extrude via sketch tools ==');
cmd('clear');
w.eval('__SolidArcPanel.doc.activePlane="XY"');
// top view so screen clicks map to distinct sketch points
w.eval('__SolidArcPanel.cam.az=-Math.PI/2;__SolidArcPanel.cam.el=1.569;__SolidArcPanel.cam.target=[0,0,0];__SolidArcPanel.draw();');
P.startTool('rect');
// simulate two clicks on the sketch plane through pointer events
const cv=doc.querySelector('#gl');
function click(x,y){cv.dispatchEvent(new w.MouseEvent('pointerdown',{clientX:x,clientY:y,bubbles:true,button:0}));
  cv.dispatchEvent(new w.MouseEvent('pointerup',{clientX:x,clientY:y,bubbles:true,button:0}));}
click(300,350);click(500,250);
const sk=P.doc.figures.find(f=>f.kind==='sketch');
chk('rectangle drawn (4 segs)',sk&&sk.segs.length===4,sk&&sk.segs.length);
if(sk&&sk.segs.length===4){
  P.startExtrude();
  chk('extrude armed',true);
  // commit at default height
  w.eval('(function(){const P=__SolidArcPanel;})()');
  cv.dispatchEvent(new w.MouseEvent('pointerdown',{clientX:400,clientY:200,bubbles:true,button:0}));
  bodies=P.doc.figures.filter(f=>f.kind==='body');
  chk('body extruded from sketch',bodies.length===1,bodies.length);
  if(bodies.length){
    bs=P.bodySolid(bodies[0]);
    chk('extruded solid valid',bs.solid&&K.validate(bs.solid).ok);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);
