// Browser/WebGPU regression suite. Import and call runGPUSPHTests(device).
// Does not emulate the kernels on the CPU or substitute the heightfield solver.
import {GPUSPH} from '../gpu-sph.mjs?v=volume1';
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
export async function runGPUSPHTests(device,{batches=80}={}){
  const errors=[],records=[];const onError=e=>errors.push(e.error.message);device.addEventListener('uncapturederror',onError);
  const solver=await GPUSPH.create(device,6144);
  try{
    for(let batch=0;batch<batches;batch++){
      const command=device.createCommandEncoder();
      const target=batch>25?[-.2,.68,.6,.4]:solver.body.slice();
      const poke=batch>=40&&batch<65?[-.6,.38,.25,42]:[0,0,0,0];
      solver.encode(command,12,target,poke);device.queue.submit([command.finish()]);await device.queue.onSubmittedWorkDone();
      if(batch%20===19||batch===batches-1){
        const state=await solver.inspect();records.push(state);
        assert(state.count===6144,'Particle count/mass was not conserved');assert(state.finite,'Nonfinite particle state');
        assert(state.outside===0,'Particle escaped the simulation bounds');assert(state.insideSolids===0,'Particle penetrated a body/rock collider');
        assert(state.invalidResets===0,'Emergency invalid-state reset activated');assert(state.neighborTruncations===0,'Neighbor traversal safety limit activated');
        assert(state.speedCaps===0,'Emergency speed clamp activated');assert(state.meanDensityRatio>.7&&state.meanDensityRatio<1.3,'Average fluid density deviated excessively');
      }
    }
    solver.reset();const reset=await solver.inspect();assert(reset.time===0&&reset.steps===0&&reset.maxSpeed===0,'Reset did not clear dynamic state');
    assert(reset.count===6144&&reset.finite,'Reset did not preserve the full fluid volume');
  }finally{solver.destroy();}
  const resolutions=[];
  for(const count of [12000,24000]){
    const s=await GPUSPH.create(device,count);try{
      const encoder=device.createCommandEncoder();s.encode(encoder,12,s.body,[0,0,0,0]);device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();const state=await s.inspect();
      assert(state.count===count&&state.finite&&state.outside===0&&state.invalidResets===0,'Resolution preset failed');resolutions.push(state);
    }finally{s.destroy();}
  }
  device.removeEventListener('uncapturederror',onError);assert(errors.length===0,errors.join('\n'));
  return {records,resolutions,errors};
}

export async function runGPUTubTests(device){
  const results=[];
  for(const dimensions of [[7.5,5],[10,6.8],[14,10],[14,3.4]]){
    const solver=await GPUSPH.create(device,6144,dimensions);
    try{
      for(let i=0;i<4;i++){const command=device.createCommandEncoder();solver.encode(command,12,solver.body,[0,0,0,0]);device.queue.submit([command.finish()]);await device.queue.onSubmittedWorkDone();}
      const state=await solver.inspect();
      assert(state.finite&&state.outside===0&&state.insideSolids===0,'Resized tub lost containment: '+dimensions);
      assert(state.invalidResets===0&&state.neighborTruncations===0&&state.speedCaps===0,'Resized tub used an emergency guard');
      results.push({dimensions,spacing:solver.spacing,...state});
    }finally{solver.destroy();}
  }
  return results;
}
