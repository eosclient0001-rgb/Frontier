import {GPUSPH} from '../gpu-sph.mjs';
export async function runDensityDiagnosticsTests(device){
 const s=await GPUSPH.create(device,6144,[7.5,5]);
 const assert=(ok,message)=>{if(!ok)throw new Error(message);};
 try{
  const initial=await s.inspect();assert(!initial.densityError.measured&&initial.densityError.sampleTime===null,'Reset density must be marked unmeasured');
  // Diagnostic-only fixture; these density tags are not a physical solver state.
  const data=new Float32Array(s.count*8);const ratios=[.5,1,1.1,1.3];
  for(let i=0;i<s.count;i++){data[i*8+1]=1.5;data[i*8+3]=ratios[i%4];}
  device.queue.writeBuffer(s.buffers[s.current],0,data);s.steps=1;s.time=s.dt;
  const state=await s.inspect(),error=state.densityError;
  assert(error.measured&&error.sampleTime===0,'Density sample time does not precede integration');
  assert(Math.abs(error.meanPositiveCompressionPercent-10)<1e-4,'Positive compression incorrectly cancels under-density');
  assert(Math.abs(error.p95PositiveCompressionPercent-30)<1e-4&&Math.abs(error.maxPositiveCompressionPercent-30)<1e-4,'Tail compression incorrect');
  assert(error.particlesOverOnePercent===s.count/2&&error.particlesOverFivePercent===s.count/2,'Compression counts incorrect');
  assert(Math.abs(state.meanDensityRatio-.975)<1e-6,'Mean density incorrect');
  s.reset();assert(!(await s.inspect()).densityError.measured,'Reset did not invalidate density diagnostics');
  return {passed:true,fixtureMeanDensity:state.meanDensityRatio,fixturePositiveCompressionPercent:error.meanPositiveCompressionPercent};
 }finally{s.destroy();}
}
