export async function benchmarkDamping(){
 const {GPUSPH}=await import('../gpu-sph.mjs');const adapter=await navigator.gpu.requestAdapter();const d=await adapter.requestDevice();const errors=[];d.addEventListener('uncapturederror',e=>errors.push(e.error.message));const results=[];
 for(const [name,viscosity,smoothing] of [['previous',.025,.03],['water',.003,.004]]){
  const s=await GPUSPH.create(d,6144,[7.5,5]);s.gravity=0;s.stiffness=0;s.cohesion=0;s.viscosity=viscosity;s.velocitySmoothing=smoothing;
  const staging=d.createBuffer({size:s.count*32,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const e=d.createCommandEncoder();e.copyBufferToBuffer(s.buffers[0],0,staging,0,s.count*32);d.queue.submit([e.finish()]);await staging.mapAsync(GPUMapMode.READ);const seed=new Float32Array(staging.getMappedRange().slice(0));staging.unmap();staging.destroy();
  for(let i=0;i<s.count;i++)seed[i*8+4]=.7*Math.sin(seed[i*8+2]*10);
  for(const buffer of s.buffers)d.queue.writeBuffer(buffer,0,seed);
  const initial=await s.inspect();const samples=[];
  for(let batch=0;batch<5;batch++){const encoder=d.createCommandEncoder();s.encode(encoder,10,s.body,[0,0,0,0]);d.queue.submit([encoder.finish()]);await d.queue.onSubmittedWorkDone();samples.push(await s.inspect());}
  const final=samples.at(-1);results.push({name,viscosity,smoothing,initial,final,retainedEnergy:final.kineticEnergy/initial.kineticEnergy,samples});s.destroy();
 }
 d.destroy();if(errors.length)throw new Error(errors.join('\n'));return {adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture},note:'Isolated shear decay; gravity, pressure and cohesion disabled for BOTH materials. Not a water realism score.',results};
}
