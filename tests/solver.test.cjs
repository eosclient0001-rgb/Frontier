const assert=require('node:assert/strict');
(async()=>{
const {SurfaceSolver}=await import('../solver.mjs');
function finite(s){assert(s.height.every(Number.isFinite));assert(s.velocity.every(Number.isFinite));assert(Math.max(...s.height)<=.551);assert(Math.min(...s.height)>=-.551);assert(s.lastDt<=s.stableDt()+1e-9);}
// Flat water is a discrete equilibrium, including obstacle boundaries.
const still=new SurfaceSolver(64);for(let i=0;i<300;i++)still.advance(1/60);assert(still.height.every(h=>h===0));assert(still.velocity.every(v=>v===0));console.log('PASS still-water equilibrium');
// An impulse propagates beyond the original Gaussian support, then damps.
const wave=new SurfaceSolver(64);wave.disturb(0,0,1,.2);const start=wave.sample(1,0);for(let i=0;i<60;i++)wave.advance(1/60);assert(Math.abs(wave.sample(1,0))>Math.abs(start)+.001);finite(wave);
const early=wave.height.reduce((sum,h)=>sum+h*h,0);for(let i=0;i<1500;i++)wave.advance(1/60);const late=wave.height.reduce((sum,h)=>sum+h*h,0);assert(late<early*.1);console.log('PASS propagation and long-run damping');
// Remeshing preserves a linear field and its vertical velocity away from rocks.
const refine=new SurfaceSolver(96);for(let j=0;j<refine.n;j++)for(let i=0;i<refine.n;i++){refine.height[j*refine.n+i]=.45*(i*refine.dx-4);refine.velocity[j*refine.n+i]=.08;}
const oldDx=refine.dx;assert(refine.refineIfNeeded());assert.equal(refine.n,144);assert(refine.dx<oldDx);assert(Math.abs(refine.sample(.3,.2)-.135)<1e-5);assert(Math.abs(refine.sampleField(refine.velocity,.3,.2)-.08)<1e-5);console.log('PASS slope-triggered refinement and field interpolation');
const fine=new SurfaceSolver(128);fine.speed=3;fine.disturb(0,0,1.5,.25);const oldDt=fine.stableDt();assert(fine.refineIfNeeded());assert.equal(fine.n,256);assert(fine.stableDt()<oldDt);for(let i=0;i<150;i++)fine.advance(1/60);finite(fine);console.log('PASS maximum resolution and refined CFL timestep');
const off=new SurfaceSolver(64);off.adaptive=false;off.disturb(0,0,1.5,.2);assert.equal(off.refineIfNeeded(),false);assert.equal(off.n,64);console.log('PASS refinement toggle');
assert.throws(()=>off.step(.5),RangeError);console.log('PASS unsafe timestep rejected');
for(const n of [64,96,128]){const s=new SurfaceSolver(n);s.speed=3;s.damping=.05;for(let i=0;i<600;i++){if(i%7===0)s.disturb(Math.sin(i*.91)*3.5,Math.cos(i*.71)*3.5,1.5,.15);s.refineIfNeeded();s.advance(1/60);}finite(s);for(let k=0;k<s.solid.length;k++)if(s.solid[k])assert.equal(s.height[k],0);console.log('PASS repeated disturbances, reflecting obstacles, base '+n);}
})().catch(e=>{console.error(e);process.exitCode=1;});
