const assert=require('node:assert/strict');
(async()=>{
  const {SurfaceSolver}=await import('../solver.mjs');
  const {FloatingBody}=await import('../floating-body.mjs');
  const {pondDimensions,baseSamples}=await import('../pond-config.mjs');
  // Regression: old symplectic frame-remainder stepping hit +/-0.55 m at 60 FPS
  // for this speed/resolution/damping combination, while other frame rates did not.
  const stress=new SurfaceSolver(192,8,12);stress.speed=3;stress.damping=.05;stress.disturb(0,0,1,.25);
  const initial=stress.energy();let maxEnergy=initial,peak=0;
  for(let frame=0;frame<60*45;frame++){
    stress.advance(1/60);if(frame%30===0){maxEnergy=Math.max(maxEnergy,stress.energy());peak=Math.max(peak,stress.height.reduce((a,b)=>Math.max(a,Math.abs(b)),0));}
  }
  assert.equal(stress.clampHits,0);assert(maxEnergy<initial*1.02);assert(stress.energy()<initial*.13);assert(peak<.33);
  console.log('PASS 45-second low-damping/fast-wave regression: no spike clipping, bounded energy, decay', {peak,energyRatio:stress.energy()/initial});
  // The integrator and object forcing must see the same sequence of steps,
  // irrespective of how wall-clock time is partitioned into rendered frames.
  const states=[];
  for(const fps of [30,60,75,120,144]){
    const s=new SurfaceSolver(64,8,12),duck=new FloatingBody();s.speed=3;s.damping=.05;s.disturb(0,0,.4,.3);duck.grab(4,-.5);
    for(let frame=0;frame<fps*6;frame++)s.advance(1/fps,32,dt=>{if(s.time>=1.5)duck.release();duck.update(s,dt,.65);});
    states.push({s,duck});
  }
  const ref=states[0];for(const state of states.slice(1)){
    assert.equal(state.s.time,ref.s.time);assert.deepEqual(state.s.height,ref.s.height);assert.deepEqual(state.s.velocity,ref.s.velocity);
    assert.equal(state.duck.x,ref.duck.x);assert.equal(state.duck.wakes,ref.duck.wakes);
  }
  console.log('PASS identical water/body states at 30 / 60 / 75 / 120 / 144 FPS');
  const jitter=new SurfaceSolver(64,8,12),body=new FloatingBody();jitter.speed=3;jitter.damping=.05;jitter.disturb(0,0,.4,.3);body.grab(4,-.5);
  let time=0,seed=81;while(time<6-1e-12){seed=(1664525*seed+1013904223)>>>0;const dt=Math.min(.003+seed/4294967296*.045,6-time);time+=dt;jitter.advance(dt,32,step=>{if(jitter.time>=1.5)body.release();body.update(jitter,step,.65);});}
  assert.deepEqual(jitter.height,ref.s.height);assert.equal(body.x,ref.duck.x);console.log('PASS jittered frame timing gives identical state');
  const stalled=new SurfaceSolver(64);stalled.advance(5);assert(stalled.time<=.1);assert(stalled.droppedTime>=4.9);assert(stalled.accumulator<stalled.stableDt());console.log('PASS frame stalls cannot create a large integration step/backlog');
  const resting=new SurfaceSolver(64,8,12),passive=new FloatingBody();resting.disturb(0,0,.6,.3);
  for(let i=0;i<600;i++)resting.advance(1/60,32,dt=>passive.update(resting,dt,.65));assert.equal(passive.wakes,0);console.log('PASS passive bobbing does not create self-powered wakes');
  for(const [w,d] of [[8,6],[20,14],[20,6],[8,14],[12,8]])for(const quality of [64,96,128]){
    const dim=pondDimensions(w,d),base=baseSamples(quality,dim.depth),s=new SurfaceSolver(base,dim.depth,dim.width);
    const target=8/(quality-1);assert(Math.abs(s.dx-target)/target<.012);assert(Math.abs(s.dz-target)/target<.012);
    s.disturb(0,0,1.5,.23);for(let i=0;i<3;i++)s.refineIfNeeded();assert(s.height.length<=160000);
    const n=s.n;for(let i=0;i<3;i++)s.refineIfNeeded();assert.equal(s.n,n);
    s.advance(1/30);assert(s.height.every(Number.isFinite));assert(s.lastDt<=s.stableDt());
  }
  console.log('PASS min/max/aspect-ratio dimensions preserve spacing and respect refinement budget');
})().catch(e=>{console.error(e);process.exitCode=1;});
