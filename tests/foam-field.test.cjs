const assert=require('node:assert/strict');
(async()=>{
 const {FoamField}=await import('../foam-field.mjs');const {SurfaceSolver}=await import('../solver.mjs');const {Whitewater,FOAM,SPRAY}=await import('../whitewater-core.mjs');
 const s=new SurfaceSolver(64,8,12),f=new FoamField(128);f.configure(s);
 for(let i=0;i<180;i++)s.advance(1/60,32,dt=>f.update(s,dt,true));assert(f.a.every(v=>v===0));console.log('PASS no spontaneous coverage in calm water');
 f.splat(0,0,.4,.25,.6,.9);const start=f.sample(0,0);f.halfLife=2;for(let i=0;i<40;i++)f.step(s,.05,false,1);assert(Math.abs(f.sample(0,0)-start*.5)<1e-5);console.log('PASS predictable exponential half-life');
 assert(f.a.every(v=>Number.isFinite(v)&&v>=0&&v<=1));const before=f.a.slice();const water=s.height.slice();f.step(s,.05,false,1);assert.deepEqual(s.height,water);console.log('PASS bounded coverage, one-way coupling');
 const fx=new Whitewater(512);fx.crestEnabled=false;fx.burst(s,0,0,.65,1);assert(fx.count<=34);assert(fx.foam.a.some(v=>v>.5));for(let i=0;i<180;i++)fx.update(s,1/120,.65);assert(fx.landed>0);assert.equal(fx.count,0);assert(fx.foam.activeCells>0);console.log('PASS sparse spray deposits coverage and leaves no foam particles');
 for(let i=0;i<100;i++)fx.burst(s,0,0,.65,1.5);assert(fx.count<=256);assert(fx.foam.a.every(v=>v<=1));assert(fx.dropped>0);console.log('PASS spray cap and saturation');
 fx.clearKind(SPRAY);assert.equal(fx.count,0);assert(fx.foam.a.some(v=>v>0));fx.clearKind(FOAM);assert(fx.foam.a.every(v=>v===0));console.log('PASS independent class clears');
 const states=[];for(const fps of [30,60,144]){const w=new SurfaceSolver(64,8,12),e=new Whitewater(512);w.disturb(0,0,.5,.3);e.burst(w,0,0,.65,1);for(let i=0;i<fps*4;i++)w.advance(1/fps,32,dt=>e.update(w,dt,.65));states.push(e);}
 for(const e of states.slice(1)){assert.deepEqual(e.foam.a,states[0].foam.a);assert.equal(e.landed,states[0].landed);assert.equal(e.foam.updates,states[0].foam.updates);}console.log('PASS 20 Hz field is independent of render FPS');
 const refine=new SurfaceSolver(64,8,12),persist=new FoamField(128);persist.configure(refine);persist.splat(0,0,.5,.5,0,1);const h=persist.a.slice();refine.disturb(0,0,1.5,.25);refine.refineIfNeeded();persist.configure(refine);assert.deepEqual(h,persist.a);console.log('PASS water refinement preserves independent coverage field');
 persist.configure(new SurfaceSolver(80,14,20));assert.equal(persist.width,20);assert.equal(persist.depth,14);assert(persist.a.every(v=>v===0));console.log('PASS resizing clears and remaps');
 for(let k=0;k<persist.a.length;k++)if(!persist.wet[k])assert.equal(persist.a[k],0);
 fx.reset();assert.equal(fx.count,0);assert.equal(fx.foam.area,0);console.log('PASS masks and reset');
 const moving=new SurfaceSolver(64,8,12),crest=new Whitewater();moving.disturb(0,0,1.2,.25);for(let i=0;i<60;i++)moving.advance(1/60,32,dt=>crest.update(moving,dt,.65));assert(crest.foam.area>0);assert.equal(crest.count,0);console.log('PASS active crests deposit coverage without particles');
 const mound=new SurfaceSolver(64,8,12),still=new Whitewater();mound.disturb(0,0,1.2,.25);for(let i=0;i<90;i++)still.update(mound,1/90,.65);assert(still.foam.a.every(v=>v===0));console.log('PASS static mound cannot emit foam');
 const residue=new Whitewater();residue.crestEnabled=false;residue.sprayEnabled=false;residue.foamLife=2;residue.burst(s,0,0,.65,1);for(let i=0;i<60*20;i++)residue.update(s,1/60,.65);assert(residue.foam.a.every(v=>v===0));assert.equal(residue.foam.area,0);console.log('PASS negligible residue eventually clears completely');
 persist.splat(0,0,30,30,0,10);persist.step(new SurfaceSolver(80,14,20),.05,false,1);for(let k=0;k<persist.a.length;k++)if(!persist.wet[k])assert.equal(persist.a[k],0);console.log('PASS broad deposits cannot paint dry cells');
})().catch(e=>{console.error(e);process.exitCode=1;});
