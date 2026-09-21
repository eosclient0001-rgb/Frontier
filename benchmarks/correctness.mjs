export async function snapshotSolver({dense=false,count=6144,dimensions=[7.5,5],batches=2,boundary=false,dfsph=false,substeps=12}={}){
 const {GPUSPH}=await import('../gpu-sph.mjs');const a=await navigator.gpu.requestAdapter();const d=await a.requestDevice();const s=await GPUSPH.create(d,count,dimensions);s.useDFSPH=dfsph;const errors=[];d.addEventListener('uncapturederror',e=>errors.push(e.error.message));
 async function read(buffer,size){const staging=d.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const e=d.createCommandEncoder();e.copyBufferToBuffer(buffer,0,staging,0,size);d.queue.submit([e.finish()]);await staging.mapAsync(GPUMapMode.READ);const bytes=staging.getMappedRange().slice(0);staging.unmap();staging.destroy();return bytes;}
 if(boundary){
  const seed=new Float32Array(await read(s.buffers[0],s.count*32));
  for(let i=0;i<128;i++){
   const epsilon=[-1e-6,0,1e-6][i%3];
   seed[i*8]=(2+i%6)*s.h-s.domain[0]+epsilon;
   seed[i*8+1]=(2+Math.floor(i/36))*s.h+epsilon;
   seed[i*8+2]=(2+Math.floor(i/6)%6)*s.h-s.domain[1]-epsilon;
  }
  for(const b of s.buffers)d.queue.writeBuffer(b,0,seed);
 }
 if(dense){const seed=new Float32Array(await read(s.buffers[0],s.count*32));for(let i=0;i<128;i++){seed[i*8]=2+.01*(i%16);seed[i*8+1]=1.5+.01*Math.floor(i/16);seed[i*8+2]=1+.01*(i%4);}for(const b of s.buffers)d.queue.writeBuffer(b,0,seed);}
 for(let i=0;i<(dense||boundary?1:batches);i++){const e=d.createCommandEncoder();s.encode(e,dense||boundary?1:substeps,s.body,[0,0,0,0]);d.queue.submit([e.finish()]);await d.queue.onSubmittedWorkDone();}
 const state=Array.from(new Float32Array(await read(s.buffers[s.current],s.count*32)));
 const densities=Array.from(new Float32Array(await read(s.density,s.count*8)));
 const counts=new Uint32Array(await read(s.neighbors,s.count*4));const fallbackParticles=counts.filter(n=>n>96).length;
 const metrics=await s.inspect();s.destroy();d.destroy();if(errors.length)throw new Error(errors.join('\n'));return {state,densities,fallbackParticles,metrics};
}
