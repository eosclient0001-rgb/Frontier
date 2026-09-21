import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FluidSolver, materials } from '../src/physics';
import { SurfaceTension, adhesionKernel, cohesionKernel } from '../src/surface-tension';
import { apparentViscosity, strainRate, temperatureShift } from '../src/rheology';
import { ImplicitViscosity } from '../src/viscosity';

const close = (a: number, b: number, epsilon = 1e-6) => assert.ok(Math.abs(a - b) < epsilon, `${a} != ${b}`);

test('surface cohesion kernel repels very close particles, attracts separated neighbors, and vanishes outside support', () => {
  const h = .31;
  assert.ok(cohesionKernel(.1*h, h) < 0);
  assert.ok(cohesionKernel(.6*h, h) > 0);
  close(cohesionKernel(h, h), 0); close(cohesionKernel(0, h), 0);
  close(cohesionKernel(.5*h-1e-9, h), cohesionKernel(.5*h+1e-9, h));
});

test('adhesion has compact support in the outer half of the kernel', () => {
  const h = .31;
  close(adhesionKernel(.1*h, h), 0); close(adhesionKernel(.5*h, h), 0);
  assert.ok(adhesionKernel(.75*h, h) > 0);
  close(adhesionKernel(h, h), 0); close(adhesionKernel(2*h, h), 0);
});

test('internal capillary forces cancel pairwise, remain finite, and vanish when disabled', () => {
  const p = new Float32Array([0,1,0, .16,1,0, .08,1.13,0, .08,1.04,.11]);
  const count = 4, stride = 4, neighbors = new Int32Array(Array.from({length:4}, () => [0,1,2,3]).flat());
  const counts = new Uint8Array([4,4,4,4]), density = new Float32Array([150,150,150,150]);
  const surface = new SurfaceTension(4);
  surface.evaluate(p,count,neighbors,counts,stride,density,.31,265,1,0);
  for (let axis=0; axis<3; axis++) {
    let sum=0; for(let i=0;i<count;i++) sum+=surface.acceleration[3*i+axis];
    close(sum,0,1e-10);
  }
  assert.ok(surface.acceleration.every(Number.isFinite));
  surface.evaluate(p,count,neighbors,counts,stride,density,.31,265,0,0);
  assert.ok(surface.acceleration.every(v=>v===0));
});

test('solid sample pseudo-masses are positive and normalized by boundary neighborhood density', () => {
  const f = new FluidSolver(), b=f.boundaries, h=.31, poly=315/(64*Math.PI*h**9);
  assert.ok(b.count > 1000 && b.count < 4000);
  for(let i=0;i<b.count;i++) assert.ok(Number.isFinite(b.masses[i]) && b.masses[i]>0);
  for(const i of [0,Math.floor(b.count/2),b.count-1]) {
    const k=3*i; let sum=0;
    for(let j=0;j<b.count;j++) {
      const t=3*j, r2=(b.positions[k]-b.positions[t])**2+(b.positions[k+1]-b.positions[t+1])**2+(b.positions[k+2]-b.positions[t+2])**2;
      if(r2<h*h) sum+=poly*(h*h-r2)**3;
    }
    close(b.masses[i]*sum,265,1e-3);
  }
});

test('solid samples restore missing density near a wall but do not fill the air above a free particle', () => {
  const f=new FluidSolver(); f.count=2; f.positions.set([0,.2,0,0,2,0]);
  f.boundarySupport=false; f.measureCompression(); const free=f.density.slice(0,2);
  f.boundarySupport=true; f.measureCompression();
  assert.ok(f.density[0] > free[0]*1.5);
  close(f.density[1],free[1]);
});

function compressed(quality: FluidSolver['pressureQuality']) {
  const f=new FluidSolver(); f.count=0; f.boundarySupport=false; f.pressureQuality=quality;
  for(let x=0;x<7;x++) for(let y=0;y<7;y++) for(let z=0;z<7;z++) f.positions.set([(x-3)*.125,1+y*.125,(z-3)*.125],f.count++*3);
  return f;
}

test('adaptive pressure projection reduces compression, with precise mode outperforming the fast budget', () => {
  const fast=compressed('fast'), precise=compressed('precise');
  fast.solvePressure(); precise.solvePressure();
  assert.ok(precise.pressure.beforePeak > .8);
  assert.ok(precise.pressure.mean < precise.pressure.beforeMean*.02);
  assert.ok(precise.pressure.peak < fast.pressure.peak*.1);
  assert.ok(precise.pressure.peak <= .01 && precise.pressure.converged);
  assert.equal(fast.pressure.converged,false);
  assert.ok(precise.pressure.iterations <= 12);
  const fresh=precise.measureCompression(); close(fresh.mean,precise.pressure.mean); close(fresh.peak,precise.pressure.peak);
});

test('neighbor overflow is reported instead of claiming pressure convergence', () => {
  const f=new FluidSolver(); f.count=150;
  for(let i=0;i<f.count;i++) f.positions.set([0,1,0],i*3);
  f.solvePressure();
  assert.ok(f.pressure.overflow>0); assert.equal(f.pressure.converged,false);
  assert.ok(f.positions.every(Number.isFinite));
});

test('sphere samples and signed-distance projection prevent particle penetration', () => {
  const f=new FluidSolver(), before=f.boundaries.count;
  f.count=1; f.positions.set([f.obstacle.x,f.obstacle.y,f.obstacle.z]);
  f.setObstacle(true);
  assert.ok(f.boundaries.count>before);
  f.positions.set([f.obstacle.x+.01,f.obstacle.y,f.obstacle.z]);
  for(let j=0;j<30;j++) {
    f.step(1/60);
    const o=f.obstacle, distance=Math.hypot(f.positions[0]-o.x,f.positions[1]-o.y,f.positions[2]-o.z);
    assert.ok(distance >= o.radius+f.boundaries.clearance-1e-6);
  }
  f.setObstacle(false); assert.equal(f.boundaries.count,before);
});

test('sampled stationary-boundary viscosity is dissipative for arbitrary boundary directions', () => {
  const solver=new ImplicitViscosity(1), v=new Float32Array([3,2,-1]);
  solver.addBoundaryPair(0,1/Math.SQRT2,1/Math.SQRT2,0,10);
  const before=v.reduce((s,x)=>s+x*x,0); solver.solve(v,1,30,1e-10);
  assert.ok(v.reduce((s,x)=>s+x*x,0)<before);
  close(v[2],-1); close(v[0]-v[1],1);
});

const chocolate = { baseViscosity: materials.chocolate.viscosity, temperature: 40, referenceTemperature: 40, activationTemperature: 5000, shearThinning: .8 };

test('Carreau response thins with shear, is bounded at zero shear, and has a Newtonian limit', () => {
  const rest=apparentViscosity(0,chocolate), flowing=apparentViscosity(20,chocolate), fast=apparentViscosity(200,chocolate);
  assert.ok(rest>flowing && flowing>fast && fast>0);
  close(apparentViscosity(0,{...chocolate,shearThinning:0}),apparentViscosity(200,{...chocolate,shearThinning:0}));
  close(apparentViscosity(0,{...chocolate,baseViscosity:0}),0);
});

test('Arrhenius temperature shift lowers viscosity when warmer and equals one at reference temperature', () => {
  close(temperatureShift(40,40,5000),1);
  const cold=apparentViscosity(10,{...chocolate,temperature:20}), warm=apparentViscosity(10,{...chocolate,temperature:60});
  assert.ok(cold > warm*3);
  for(const t of [-300,10,40,80,1000]) assert.ok(Number.isFinite(apparentViscosity(0,{...chocolate,temperature:t})));
});

test('strain-rate invariant is zero for rotation and correct for simple shear', () => {
  close(strainRate([0,-2,1,2,0,-3,-1,3,0]),0);
  close(strainRate([0,4,0,0,0,0,0,0,0]),4);
});

test('CPU local gradient reconstructs affine shear and rejects rigid rotation as thinning', () => {
  const f=new FluidSolver(); f.setMaterial('chocolate'); f.count=0;
  for(let x=-2;x<=2;x++) for(let y=-2;y<=2;y++) for(let z=-2;z<=2;z++) f.positions.set([x*.13,1+y*.13,z*.13],f.count++*3);
  f.measureCompression();
  for(let i=0;i<f.count;i++) f.velocities.set([4*f.positions[3*i+1],0,0],3*i);
  f.updateRheology(); close(f.shearRates[62],4,1e-4);
  for(let i=0;i<f.count;i++) f.velocities.set([-2*f.positions[3*i+1],2*f.positions[3*i],0],3*i);
  f.updateRheology(); assert.ok(f.shearRates[62]<1e-5);
});

function moments(f: FluidSolver) {
  const mean=[0,0,0], variance=[0,0,0];
  for(let i=0;i<f.count;i++) for(let axis=0;axis<3;axis++) mean[axis]+=f.positions[3*i+axis]/f.count;
  for(let i=0;i<f.count;i++) for(let axis=0;axis<3;axis++) variance[axis]+=(f.positions[3*i+axis]-mean[axis])**2/f.count;
  return {mean,variance,aspect:Math.max(...variance)/Math.min(...variance)};
}

test('a suspended elongated droplet becomes rounder under capillary forces without bulk translation', () => {
  const f=new FluidSolver(); f.reset('droplet'); f.gravity=0;f.wetting=0;f.cohesion=.018;f.vorticity=0;f.viscosity=.1;
  const before=moments(f);
  for(let i=0;i<240;i++)f.step(1/60);
  const after=moments(f);
  assert.ok(after.aspect < before.aspect*.65);
  before.mean.forEach((x,i)=>close(x,after.mean[i],.002));
});

test('higher adhesion spreads a reduced-gravity drop more in a matched wetting experiment', () => {
  const spread:number[]=[];
  for(const wetting of [0,2]) {
    const f=new FluidSolver();f.reset('droplet');f.gravity=1;f.cohesion=.08;f.wetting=wetting;f.vorticity=0;f.viscosity=.2;
    for(let i=0;i<180;i++)f.step(1/60);
    const m=moments(f);spread.push(m.variance[0]+m.variance[2]);
    assert.ok(f.positions.every(Number.isFinite));
  }
  assert.ok(spread[1]>spread[0]*1.5);
});

test('cold, strongly shear-thinning chocolate stays finite with sampled sphere boundaries', () => {
  const f=new FluidSolver();f.setMaterial('chocolate');f.temperature=10;f.shearThinning=1;f.wetting=2;f.pressureQuality='precise';f.setObstacle(true);f.stir(4);
  for(let i=0;i<60;i++)f.step(1/60);
  assert.ok(f.positions.every(Number.isFinite)); assert.ok(f.velocities.every(Number.isFinite));
  assert.ok(f.apparentViscosities.slice(0,f.count).every(x=>x>=0&&x<=2));
  assert.ok(f.pressure.iterations<=12);
});


test('initial boundary relaxation does not launch a spurious splash from a resting basin', () => {
  const f=new FluidSolver();
  assert.ok(f.velocities.every(v=>v===0));
  for(let step=0;step<25;step++)f.step(1/60);
  let top=0;for(let i=0;i<f.count;i++)top=Math.max(top,f.positions[3*i+1]);
  assert.ok(top<.9);
});
