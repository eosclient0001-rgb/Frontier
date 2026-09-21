export async function benchmarkStages({variant='baseline',samples=9,warmup=3,stressSteps=0,water=false,stiffness=null}={}){
 const adapter=await navigator.gpu.requestAdapter();if(!adapter||!adapter.features.has('timestamp-query'))throw new Error('Timestamp-capable WebGPU adapter required');
 const device=await adapter.requestDevice({requiredFeatures:['timestamp-query']});const errors=[];device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
 const path=variant==='baseline'?'./baseline/gpu-sph.mjs':'../gpu-sph.mjs';const {GPUSPH}=await import(path);
 const s=await GPUSPH.create(device,6144,[7.5,5]);if(!water){s.viscosity=.025;s.velocitySmoothing=.03;s.cohesion=.06;}
 if(stiffness!==null)s.stiffness=stiffness;
 const queries=device.createQuerySet({type:'timestamp',count:8}),resolve=device.createBuffer({size:64,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}),read=device.createBuffer({size:64,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 const results=[];
 try{
  for(let iteration=0;iteration<warmup+samples;iteration++){
   const encoder=device.createCommandEncoder();let stage=0;
   // Separate compute passes for per-stage timestamps. Same proxy used for both versions.
   const proxy={beginComputePass(){let group,offsets,pipeline;return {setBindGroup(i,g,o){group=g;offsets=o;},setPipeline(p){pipeline=p;},dispatchWorkgroups(n){const pass=encoder.beginComputePass({timestampWrites:{querySet:queries,beginningOfPassWriteIndex:stage*2,endOfPassWriteIndex:stage*2+1}});pass.setPipeline(pipeline);pass.setBindGroup(0,group,offsets);pass.dispatchWorkgroups(n);pass.end();stage++;},end(){}};}};
   s.encode(proxy,1,s.body,[0,0,0,0]);encoder.resolveQuerySet(queries,0,8,resolve,0);encoder.copyBufferToBuffer(resolve,0,read,0,64);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);
   const t=new BigUint64Array(read.getMappedRange());const row={};['clear','build','density','integrate'].forEach((key,i)=>row[key]=Number(t[i*2+1]-t[i*2])/1e6);if(iteration>=warmup)results.push(row);read.unmap();
  }
  const checkpoints=[];let stressSummary=null;
  if(stressSteps)stressSummary={checkedBatches:0,densityMeasuredBatches:0,maxPositiveCompressionPercent:null,maxMeanPositiveCompressionPercent:null,maxParticlesOverFivePercent:null};
  if(stressSteps){s.reset();for(let n=0;n<stressSteps;n+=12){const encoder=device.createCommandEncoder();s.encode(encoder,Math.min(12,stressSteps-n),n>240?[-.2,.68,.6,.4]:s.body,n>=480&&n<720?[-.6,.38,.25,42]:[0,0,0,0]);device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();const state=await s.inspect();if(!state.finite||state.outside||state.insideSolids||state.invalidResets||state.neighborTruncations||state.speedCaps)throw new Error('Stress failure '+JSON.stringify(state));stressSummary.checkedBatches++;if(state.densityError?.measured){stressSummary.densityMeasuredBatches++;stressSummary.maxPositiveCompressionPercent=Math.max(stressSummary.maxPositiveCompressionPercent,state.densityError.maxPositiveCompressionPercent);stressSummary.maxMeanPositiveCompressionPercent=Math.max(stressSummary.maxMeanPositiveCompressionPercent,state.densityError.meanPositiveCompressionPercent);stressSummary.maxParticlesOverFivePercent=Math.max(stressSummary.maxParticlesOverFivePercent,state.densityError.particlesOverFivePercent);}if(n%120===0||n+12>=stressSteps)checkpoints.push(state);}}
  return {variant,water,adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture,description:adapter.info.description},count:s.count,dimensions:[7.5,5],dt:s.dt,stiffness:s.stiffness,viscosity:s.viscosity,samples:results,checkpoints,stressSummary,errors};
 }finally{s.destroy();queries.destroy();resolve.destroy();read.destroy();device.destroy();}
}
