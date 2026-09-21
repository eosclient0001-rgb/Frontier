// Actual WGSL scene-intersection comparison, including refracted/interior rays.
import {surfaceShader as reference} from './pre-wall-batch/gpu-fluid-shaders.mjs';
import {surfaceShader as optimized} from '../gpu-fluid-shaders.mjs';
export async function validateWalls(){
 const adapter=await navigator.gpu.requestAdapter();const device=await adapter.requestDevice();const errors=[];
 device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
 const count=16384,bytes=count*32;
 const uniform=device.createBuffer({size:336,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
 const rays=device.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST});
 const output=device.createBuffer({size:bytes,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
 const read=device.createBuffer({size:bytes,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});
 const pipelines=[];let seed=92173;
 function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
 try{
  for(const source of [reference,optimized]){
   const code=source.slice(0,source.indexOf('@fragment fn background'))+`
struct Ray {origin:vec4<f32>,direction:vec4<f32>}
struct Result {geometry:vec4<f32>,color:vec4<f32>}
@group(0) @binding(3) var<storage,read> rays:array<Ray>;
@group(0) @binding(4) var<storage,read_write> results:array<Result>;
@compute @workgroup_size(128) fn check(@builtin(global_invocation_id) id:vec3<u32>){
 if(id.x>=arrayLength(&rays)){return;}
 let r=rays[id.x];let hit=scene(r.origin.xyz,r.direction.xyz);
 results[id.x]=Result(vec4<f32>(hit.distance,hit.normal),vec4<f32>(hit.color,1.));
}`;
   const module=device.createShaderModule({code});const info=await module.getCompilationInfo();
   if(info.messages.some(m=>m.type==='error'))throw new Error(JSON.stringify(info.messages));
   const pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'check'}});
   const group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:uniform}},{binding:3,resource:{buffer:rays}},{binding:4,resource:{buffer:output}}]});
   pipelines.push({pipeline,group});
  }
  const cases=[];
  for(const [width,length,bx,bz] of [[5,3.4,.9,.25],[7.5,5,.9,.25],[10,6.8,-2,1.5],[14,10,5,-3]]){
   const cam=new Float32Array(84);cam.set([bx,.68,bz,.4],68);cam.set([-1,.32,-.6,.48],72);cam.set([width/2,3,length/2,.1],76);cam[80]=1000;device.queue.writeBuffer(uniform,0,cam);
   const data=new Float32Array(count*8);
   const axes=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
   for(let i=0;i<count;i++){
    let origin=[(random()-.5)*width*3,random()*5-.5,(random()-.5)*length*3];
    let dir=[random()-.5,random()-.5,random()-.5];
    if(i%3===0)origin=[(random()-.5)*width,random()*1.28,(random()-.5)*length];
    if(i%7===0)dir=axes[i%6];
    // Aim at wall edges/corners from both above and within the basin.
    if(i%11===0){const target=[(i%2?1:-1)*width/2,i%4<2?0:1.28,(i%5?1:-1)*length/2];dir=target.map((v,j)=>v-origin[j]);}
    const norm=Math.hypot(...dir)||1;data.set([...origin,0,...dir.map(v=>v/norm),0],i*8);
   }
   device.queue.writeBuffer(rays,0,data);const snapshots=[];
   for(const {pipeline,group} of pipelines){
    const encoder=device.createCommandEncoder();const pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);pass.dispatchWorkgroups(count/128);pass.end();encoder.copyBufferToBuffer(output,0,read,0,bytes);device.queue.submit([encoder.finish()]);await read.mapAsync(GPUMapMode.READ);snapshots.push(new Float32Array(read.getMappedRange().slice(0)));read.unmap();
   }
   let maxDistanceError=0,maxAttributeError=0,mismatches=0;
   for(let i=0;i<count;i++){
    const a=snapshots[0],b=snapshots[1];let bad=false;
    for(let j=0;j<8;j++){if(a[i*8+j]===b[i*8+j])continue;const error=Math.abs(a[i*8+j]-b[i*8+j]);if(!Number.isFinite(error))throw new Error('Nonfinite ray result');
     if(j===0){maxDistanceError=Math.max(maxDistanceError,error);if(error>1e-4*Math.max(1,Math.abs(a[i*8])))bad=true;}
     else {maxAttributeError=Math.max(maxAttributeError,error);if(error>1e-5)bad=true;}
    }
    if(bad)mismatches++;
   }
   cases.push({dimensions:[width,length],rays:count,maxDistanceError,maxAttributeError,mismatches});
  }
  if(errors.length||cases.some(c=>c.mismatches))throw new Error(JSON.stringify({cases,errors}));
  return {cases,errors,adapter:{vendor:adapter.info.vendor,architecture:adapter.info.architecture}};
 }finally{uniform.destroy();rays.destroy();output.destroy();read.destroy();device.destroy();}
}
