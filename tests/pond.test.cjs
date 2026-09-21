const assert=require('node:assert/strict');
(async()=>{
  const {SurfaceSolver}=await import('../solver.mjs');
  const {FloatingBody}=await import('../floating-body.mjs');
  const {WATER_PRESETS}=await import('../water-materials.mjs');
  const s=new SurfaceSolver(96,8,12);
  assert.equal(s.nx,144);assert.equal(s.height.length,144*96);
  assert(Math.abs(s.dx-s.dz)<.001);assert(s.isWet(5,0));assert(!s.isWet(6,0));assert(!s.isWet(0,4));
  for(let j=0;j<s.n;j++)for(let i=0;i<s.nx;i++)s.height[j*s.nx+i]=.45*(i*s.dx-6);
  assert(s.refineIfNeeded());assert.equal(s.nx,216);assert.equal(s.n,144);
  assert(Math.abs(s.sample(4.5,.4)-2.025)<1e-5);console.log('PASS rectangular domain, fixed spacing, refined interpolation');
  const high=new SurfaceSolver(128,8,12);high.speed=3;high.disturb(4,0,1.5,.25);assert(high.refineIfNeeded());assert.equal(high.nx,384);assert.equal(high.n,256);for(let i=0;i<150;i++)high.advance(1/60);assert(high.height.every(Number.isFinite));assert(high.lastDt<=high.stableDt());console.log('PASS 384 × 256 rectangular refinement and stability');
  const water=new SurfaceSolver(64,8,12),duck=new FloatingBody();
  duck.grab(4.5,-.5);
  for(let i=0;i<350;i++){duck.update(water,1/120,.65);water.advance(1/120);}
  assert(duck.x>3);assert(duck.z<-.3);assert(duck.wakes>3);assert(water.height.some(h=>Math.abs(h)>.001));
  assert(water.isWet(duck.x,duck.z,duck.radius));console.log('PASS duck follows drag target and generates solver wakes');
  duck.release();const start={x:duck.x,z:duck.z};for(let i=0;i<60;i++){duck.update(water,1/120,.65);water.advance(1/120);}
  assert(Math.hypot(duck.x-start.x,duck.z-start.z)>.001);console.log('PASS duck coasts after release');
  for(const [x,z] of [[15,0],[0,-9],[-2.4,-1.65],[2.7,1.65]]){
    duck.grab(x,z);for(let i=0;i<500;i++){duck.update(water,1/120,.65);water.advance(1/120);assert(water.isWet(duck.x,duck.z,duck.radius));}
  }
  assert(Object.values(duck).filter(v=>typeof v==='number').every(Number.isFinite));assert(water.height.every(Number.isFinite));console.log('PASS banks/rocks containment and finite coupled state');
  duck.reset(.9);assert.equal(duck.y,.9);assert.equal(duck.wakes,0);assert.equal(duck.target,null);console.log('PASS duck reset');
  assert.deepEqual(Object.keys(WATER_PRESETS).sort(),['clean','dirty','ocean','puddle','swamp']);
  for(const preset of Object.values(WATER_PRESETS)){
    assert(preset.absorption.every(v=>v>=0));assert(preset.scattering>=0);assert(preset.roughness>0&&preset.roughness<1);
    // Beer-Lambert transmittance cannot increase with optical path length.
    for(const a of preset.absorption){const short=Math.exp(-(a+preset.scattering)*.1),long=Math.exp(-(a+preset.scattering)*2);assert(long<=short&&long>=0&&short<=1);}
  }
  assert.equal(WATER_PRESETS.puddle.depth,.065);console.log('PASS five material presets and bounded optical transmission');
})().catch(e=>{console.error(e);process.exitCode=1;});
