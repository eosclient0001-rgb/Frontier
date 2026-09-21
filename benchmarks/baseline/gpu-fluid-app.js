import * as THREE from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {GPUSPH} from './gpu-sph.mjs?v=editor2';
import {particleShader,blurShader,surfaceShader} from './gpu-fluid-shaders.mjs?v=editor2';
const $=id=>document.getElementById(id),canvas=$('fluid'),viewport=$('viewport');
let tubDimensions=[7.5,5];
const renderProfiles={fast:{width:720,passes:2},balanced:{width:960,passes:4},high:{width:1400,passes:6}};
if(!isSecureContext)throw new Error('WebGPU requires HTTPS or localhost. Open this page through the secure live preview.');
if(!navigator.gpu)throw new Error('This browser does not expose WebGPU. Try current Chrome or Edge with hardware acceleration enabled. This version does not silently fall back to a CPU solver.');
const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});
if(!adapter)throw new Error('No WebGPU adapter is available. Enable browser hardware acceleration, update your graphics driver, and restart Chrome or Edge.');
const timestamps=adapter.features.has('timestamp-query');
const device=await adapter.requestDevice({requiredFeatures:timestamps?['timestamp-query']:[]});
device.addEventListener('uncapturederror',event=>window.gpuFluidFailure(event.error));
device.lost.then(info=>window.gpuFluidFailure(new Error('The GPU device was lost: '+info.message+'. Reload to restart.')));
const context=canvas.getContext('webgpu');if(!context)throw new Error('Could not create the WebGPU canvas context.');
const format=navigator.gpu.getPreferredCanvasFormat();context.configure({device,format,alphaMode:'opaque'});
const info=adapter.info||{};const description=[info.vendor,info.architecture,info.description].filter(Boolean).join(' · ');
$('deviceBadge').textContent='WebGPU · '+(info.vendor||'GPU connected');$('deviceBadge').title=description;
if(/swiftshader|llvmpipe|software/i.test(description)){$('deviceBadge').textContent='Software WebGPU adapter';$('warning').hidden=false;$('warning').textContent='This browser supplied a software WebGPU adapter. The compute code still uses WebGPU, but performance here is not representative of a hardware GPU.';}
const camera=new THREE.PerspectiveCamera(42,1,.05,80);camera.coordinateSystem=THREE.WebGPUCoordinateSystem;camera.updateProjectionMatrix();
const orbit=new OrbitControls(camera,canvas);orbit.enableDamping=true;orbit.dampingFactor=.12;orbit.enablePan=false;orbit.minDistance=4;orbit.maxDistance=18;orbit.maxPolarAngle=Math.PI*.47;
let dirty=true;function home(){const fit=Math.max(tubDimensions[0]/5,tubDimensions[1]/3.4);camera.position.set(5.1*fit,5.4*fit,7.3*fit);orbit.maxDistance=18*fit;orbit.minDistance=4*fit;orbit.target.set(0,.55,0);orbit.update();dirty=true;}home();orbit.addEventListener('change',()=>dirty=true);$('home').onclick=home;
const camBuffer=device.createBuffer({size:336,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});
const textureLayout=device.createBindGroupLayout({entries:[{binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:'uniform'}},{binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:'unfilterable-float'}}]});
const texturePipelineLayout=device.createPipelineLayout({bindGroupLayouts:[textureLayout]});
async function module(code,label){const shader=device.createShaderModule({code,label});const messages=(await shader.getCompilationInfo()).messages.filter(m=>m.type==='error');if(messages.length)throw new Error(messages.map(m=>label+' '+m.lineNum+': '+m.message).join('\n'));return shader;}
const particleModule=await module(particleShader,'Particle depth');
const particlePipeline=await device.createRenderPipelineAsync({layout:'auto',vertex:{module:particleModule,entryPoint:'vertex'},fragment:{module:particleModule,entryPoint:'fragment',targets:[{format:'r32float'}]},primitive:{topology:'triangle-list'},depthStencil:{format:'depth32float',depthWriteEnabled:true,depthCompare:'less'}});
const blurModule=await module(blurShader,'Surface smoothing');
const blurPipelines=await Promise.all(['horizontal','vertical'].map(entryPoint=>device.createRenderPipelineAsync({layout:texturePipelineLayout,vertex:{module:blurModule,entryPoint:'vertex'},fragment:{module:blurModule,entryPoint,targets:[{format:'r32float'}]}})));
const surfaceModule=await module(surfaceShader,'Water surface');
const surfacePipeline=await device.createRenderPipelineAsync({layout:texturePipelineLayout,vertex:{module:surfaceModule,entryPoint:'vertex'},fragment:{module:surfaceModule,entryPoint:'fragment',targets:[{format}]}});
let solver=await GPUSPH.create(device,Number($('resolution').value),tubDimensions);
let particleGroups=[];function bindParticles(){particleGroups=solver.buffers.map(buffer=>device.createBindGroup({layout:particlePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:camBuffer}},{binding:1,resource:{buffer}}]}));}bindParticles();
let textures=[],views=[],textureGroups=[],depthTexture,width=0,height=0;
function resize(){
  const rect=viewport.getBoundingClientRect();const w=Math.max(1,Math.round(Math.min(renderProfiles[$('renderQuality').value].width,rect.width))),h=Math.max(1,Math.round(w*rect.height/rect.width));if(w===width&&h===height)return;
  width=w;height=h;canvas.width=w;canvas.height=h;camera.aspect=w/h;camera.fov=rect.width<600?48:42;camera.updateProjectionMatrix();
  for(const texture of textures)texture.destroy();depthTexture?.destroy();
  textures=[0,1,2].map(i=>device.createTexture({label:'Surface depth '+i,size:[w,h],format:'r32float',usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING}));
  views=textures.map(t=>t.createView());textureGroups=views.map(view=>device.createBindGroup({layout:textureLayout,entries:[{binding:0,resource:{buffer:camBuffer}},{binding:1,resource:view}]}));
  depthTexture=device.createTexture({size:[w,h],format:'depth32float',usage:GPUTextureUsage.RENDER_ATTACHMENT});dirty=true;
}
new ResizeObserver(()=>{dirty=true;}).observe(viewport);resize();
let querySet,queryResolve,queryRead,queryBusy=false,gpuMs=null,computeMs=null,renderMs=null,lastSubsteps=0,sampleSubsteps=null;
if(timestamps){querySet=device.createQuerySet({type:'timestamp',count:3});queryResolve=device.createBuffer({size:24,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC});queryRead=device.createBuffer({size:24,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});}else $('timingLabel').textContent='GPU timestamp queries unavailable';
let running=true,busy=false,switching=false,last=performance.now(),accumulator=0,frames=0,fpsStart=last,lastQuery=0,tool='orbit',pointerDown=false;
let goal=solver.body.slice(),jet=[-.6,.38,.25,0],jetRemaining=0;
function setRunning(value){running=value;$('play').textContent=running?'Ⅱ Pause':'▶ Play';$('runningBadge').textContent=running?'LIVE · 3D SPH':'PAUSED';dirty=true;accumulator=0;}
$('play').onclick=()=>setRunning(!running);$('play').disabled=false;$('reset').disabled=false;$('splash').disabled=false;
$('view').onchange=()=>dirty=true;
$('renderQuality').onchange=()=>dirty=true;
$('viscosity').oninput=e=>{solver.viscosity=Number(e.target.value);$('viscosityValue').textContent=solver.viscosity.toFixed(3);};
async function exclusive(action){if(switching)return;switching=true;const controls=['resolution','reset','play','splash','applyTub','tubPreset','tubWidth','tubDepth'];controls.forEach(id=>$(id).disabled=true);try{await device.queue.onSubmittedWorkDone();await action();dirty=true;accumulator=0;updateMetrics();}finally{switching=false;controls.forEach(id=>$(id).disabled=false);}}
$('reset').onclick=()=>exclusive(()=>{solver.body=[.9,.68,.25,.40];goal=solver.body.slice();solver.reset();jetRemaining=0;});
async function rebuild(dimensions){
  const next=await GPUSPH.create(device,Number($('resolution').value),dimensions);
  next.viscosity=Number($('viscosity').value);solver.destroy();solver=next;tubDimensions=dimensions.slice();goal=solver.body.slice();jetRemaining=0;bindParticles();home();updateMetrics();
}
$('resolution').onchange=()=>exclusive(()=>rebuild(tubDimensions));
$('tubPreset').onchange=()=>{if($('tubPreset').value!=='custom'){const [w,d]=$('tubPreset').value.split(',');$('tubWidth').value=w;$('tubDepth').value=d;}};
for(const id of ['tubWidth','tubDepth'])$(id).oninput=()=>{$('tubPreset').value='custom';};
$('applyTub').onclick=()=>{
  const dimensions=[Number($('tubWidth').value),Number($('tubDepth').value)];
  if(!dimensions.every(Number.isFinite)||dimensions[0]<5||dimensions[0]>14||dimensions[1]<3.4||dimensions[1]>10){$('sizeHelp').textContent='Enter width 5–14 m and length 3.4–10 m.';return;}
  exclusive(async()=>{await rebuild(dimensions);$('sizeHelp').textContent='Dimensions applied. The volume and colliders have been reset; particle count is unchanged.';});
};
function selectObject(object){
  document.querySelectorAll('[data-object]').forEach(el=>{const active=el.dataset.object===object;el.classList.toggle('selected',active);el.setAttribute('aria-pressed',String(active));});
  document.querySelectorAll('[data-inspector]').forEach(el=>el.hidden=el.dataset.inspector!==object);
  $('selectionName').textContent={tub:'Tub',fluid:'Water',duck:'Duck',rock:'Rock'}[object];
}
for(const el of document.querySelectorAll('[data-object]'))el.onclick=()=>selectObject(el.dataset.object);
$('moveDuck').onclick=()=>setTool('duck');
$('splash').onclick=()=>{if(!running)setRunning(true);jet=[-.6,.38,.25,42];jetRemaining=.45;};
function setTool(value){tool=value;orbit.enabled=value==='orbit';document.querySelectorAll('[data-tool]').forEach(el=>el.classList.toggle('selected',el.dataset.tool===value));$('hint').textContent=value==='orbit'?'Drag to orbit · scroll to zoom':value==='duck'?'Drag across the water to move the solid duck':'Press and drag to lift the actual fluid particles';}
for(const button of document.querySelectorAll('[data-tool]'))button.onclick=()=>setTool(button.dataset.tool);
const raycaster=new THREE.Raycaster(),plane=new THREE.Plane(new THREE.Vector3(0,1,0),-.65),point=new THREE.Vector3();
function interact(event){
  const rect=canvas.getBoundingClientRect();raycaster.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,1-(event.clientY-rect.top)/rect.height*2),camera);
  if(!raycaster.ray.intersectPlane(plane,point))return;
  const x=THREE.MathUtils.clamp(point.x,-solver.domain[0]+.65,solver.domain[0]-.65),z=THREE.MathUtils.clamp(point.z,-solver.domain[1]+.65,solver.domain[1]-.65);
  if(tool==='duck'){goal=[x,.68,z,.4];}else if(tool==='push'){jet=[x,.32,z,38];jetRemaining=.12;}
  dirty=true;
}
canvas.addEventListener('pointerdown',event=>{if(tool==='orbit')return;pointerDown=true;canvas.setPointerCapture(event.pointerId);interact(event);});
canvas.addEventListener('pointermove',event=>{if(pointerDown)interact(event);});
canvas.addEventListener('pointerup',()=>pointerDown=false);canvas.addEventListener('pointercancel',()=>pointerDown=false);
window.addEventListener('keydown',event=>{if(/INPUT|SELECT|BUTTON/.test(document.activeElement.tagName))return;if(event.code==='Space'){event.preventDefault();setRunning(!running);}if(event.key==='1')setTool('orbit');if(event.key==='2')setTool('push');if(event.key==='3')setTool('duck');});
function writeCamera(){
  camera.updateMatrixWorld();const data=new Float32Array(84);data.set(camera.matrixWorldInverse.elements,0);data.set(camera.projectionMatrix.elements,16);data.set(camera.matrixWorld.elements,32);data.set(camera.projectionMatrixInverse.elements,48);
  data.set([width,height,1/width,1/height],64);data.set(solver.body,68);data.set(solver.rock,72);data.set([solver.domain[0],solver.domain[2],solver.domain[1],solver.spacing*($('view').value==='particles'?.43:.86)],76);data.set([.1,.5,.6,$('view').value==='particles'?1:0],80);device.queue.writeBuffer(camBuffer,0,data);
}
function updateMetrics(){
  $('activeSize').textContent=$('dimensionsLabel').textContent=tubDimensions.map(v=>v.toFixed(1)).join(' × ')+' m';
  $('particleSpacing').textContent=(solver.spacing*100).toFixed(1)+' cm';$('kernelRadius').textContent=(solver.h*100).toFixed(1)+' cm';
  $('duckPosition').textContent=solver.body.slice(0,3).map(v=>v.toFixed(2)).join(' / ');
  $('computeTime').textContent=computeMs===null?'—':computeMs.toFixed(2)+' ms';$('renderTime').textContent=renderMs===null?'—':renderMs.toFixed(2)+' ms';$('substepCount').textContent=sampleSubsteps??lastSubsteps;

  $('particleCount').textContent=solver.count.toLocaleString();$('time').textContent=solver.time.toFixed(2)+' s';$('step').textContent=(solver.dt*1000).toFixed(2)+' ms fixed step';$('gpuTime').textContent=gpuMs===null?'—':gpuMs.toFixed(1)+' ms';$('backend').textContent='WebGPU / 4 compute stages';
}
updateMetrics();setRunning(true);
function encodeRender(encoder,steps,probe=null){
  const pass=encoder.beginRenderPass({colorAttachments:[{view:views[0],clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}],depthStencilAttachment:{view:depthTexture.createView(),depthClearValue:1,depthLoadOp:'clear',depthStoreOp:'discard'},...(probe?{timestampWrites:{querySet:probe,beginningOfPassWriteIndex:0,endOfPassWriteIndex:1}}:querySet?{timestampWrites:{querySet,beginningOfPassWriteIndex:steps?1:0}}:{})});
  pass.setPipeline(particlePipeline);pass.setBindGroup(0,particleGroups[solver.current]);pass.draw(6,solver.count);pass.end();
  const surface=$('view').value==='surface';
  if(surface)for(let i=0;i<renderProfiles[$('renderQuality').value].passes;i++){
    const blur=encoder.beginRenderPass({...(probe&&(i===0||i===renderProfiles[$('renderQuality').value].passes-1)?{timestampWrites:{querySet:probe,...(i===0?{beginningOfPassWriteIndex:2}:{}),...(i===renderProfiles[$('renderQuality').value].passes-1?{endOfPassWriteIndex:3}:{})}}:{}),colorAttachments:[{view:views[i%2+1],clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});blur.setPipeline(blurPipelines[i%2]);blur.setBindGroup(0,textureGroups[i===0?0:i%2===0?2:1]);blur.draw(3);blur.end();
  }
  const final=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),clearValue:{r:.02,g:.03,b:.04,a:1},loadOp:'clear',storeOp:'store'}],...(probe?{timestampWrites:{querySet:probe,beginningOfPassWriteIndex:4,endOfPassWriteIndex:5}}:querySet?{timestampWrites:{querySet,endOfPassWriteIndex:2}}:{})});
  final.setPipeline(surfacePipeline);final.setBindGroup(0,textureGroups[surface?2:0]);final.draw(3);final.end();
}
function frame(now){
  requestAnimationFrame(frame);if(window.gpuFluidStopped)return;
  const elapsed=Math.min(.04,Math.max(0,(now-last)/1000));last=now;orbit.update();
  accumulator=running&&!switching?Math.min(accumulator+elapsed,solver.dt*solver.maxSteps):0;
  if(busy||switching)return;if(!running&&!dirty)return;
  resize();
  const steps=running?Math.min(solver.maxSteps,Math.floor(accumulator/solver.dt)):0;accumulator-=steps*solver.dt;lastSubsteps=steps;
  if(pointerDown&&tool==='push')jetRemaining=Math.max(jetRemaining,.1);
  const impulse=jet.slice();if(jetRemaining<=0)impulse[3]=0;jetRemaining=Math.max(0,jetRemaining-steps*solver.dt);
  const encoder=device.createCommandEncoder();solver.encode(encoder,steps,goal,impulse,querySet);writeCamera();encodeRender(encoder,steps);
  const readQuery=querySet&&!queryBusy&&now-lastQuery>500;
  if(readQuery){queryBusy=true;lastQuery=now;encoder.resolveQuerySet(querySet,0,3,queryResolve,0);encoder.copyBufferToBuffer(queryResolve,0,queryRead,0,24);}
  device.queue.submit([encoder.finish()]);busy=true;dirty=false;
  device.queue.onSubmittedWorkDone().then(async()=>{
    busy=false;frames++;
    if(document.documentElement.dataset.state!=='ready'&&!window.gpuFluidStopped){document.documentElement.dataset.state='ready';$('status').hidden=true;}
    if(readQuery){try{await queryRead.mapAsync(GPUMapMode.READ);const values=new BigUint64Array(queryRead.getMappedRange());sampleSubsteps=steps;gpuMs=Number(values[2]-values[0])/1e6;computeMs=steps?Number(values[1]-values[0])/1e6:0;renderMs=Number(values[2]-values[steps?1:0])/1e6;queryRead.unmap();}finally{queryBusy=false;}}
    if(now-fpsStart>750){$('fps').textContent=Math.round(frames*1000/(performance.now()-fpsStart));frames=0;fpsStart=performance.now();}updateMetrics();
  }).catch(window.gpuFluidFailure);
}
window.gpuFluidDiagnostics=()=>({backend:'WebGPU compute',algorithm:'3D WCSPH',count:solver.count,dimensions:tubDimensions.slice(),spacing:solver.spacing,computeMs,renderMs,lastSubsteps,renderQuality:$('renderQuality').value,time:solver.time,steps:solver.steps,dt:solver.dt,running,body:solver.body.slice(),gpuMs,grid:solver.grid.slice(),busy,display:$('view').value});
window.inspectGPUFluid=async()=>{await device.queue.onSubmittedWorkDone();return solver.inspect();};
requestAnimationFrame(frame);

// Explicit developer benchmark: pauses interactive work and submits fixed-size frames.
window.benchmarkGPUFrames=async({warmup=3,samples=7,steps=8,renderStages=false,movingCamera=false}={})=>{
  if(switching)throw new Error('Wait for the current rebuild to finish.');
  if(!querySet)throw new Error('GPU timestamp queries unavailable; refusing to label wall time as GPU time.');
  setRunning(false);switching=true;await device.queue.onSubmittedWorkDone();
  const size=renderStages?48:24;const probe=renderStages?device.createQuerySet({type:'timestamp',count:6}):null;const resolve=renderStages?device.createBuffer({size,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}):queryResolve;
  const read=device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});const results=[];
  try{
    solver.reset();goal=solver.body.slice();resize();
    for(let i=0;i<warmup+samples;i++){
      if(movingCamera){camera.position.x+=.04;camera.lookAt(orbit.target);}
      const encoder=device.createCommandEncoder();solver.encode(encoder,steps,goal,[0,0,0,0],querySet);writeCamera();encodeRender(encoder,steps,probe);
      encoder.resolveQuerySet(probe||querySet,0,renderStages?6:3,resolve,0);encoder.copyBufferToBuffer(resolve,0,read,0,size);device.queue.submit([encoder.finish()]);
      await read.mapAsync(GPUMapMode.READ);const t=new BigUint64Array(read.getMappedRange());
      if(i>=warmup)results.push(renderStages?{particleDepth:Number(t[1]-t[0])/1e6,filter:Number(t[3]-t[2])/1e6,surface:Number(t[5]-t[4])/1e6}:{computeMs:steps?Number(t[1]-t[0])/1e6:0,renderMs:Number(t[2]-t[steps?1:0])/1e6,totalMs:Number(t[2]-t[0])/1e6});read.unmap();
    }
    return {adapter:{vendor:info.vendor,architecture:info.architecture,description:info.description},width,height,steps,dt:solver.dt,count:solver.count,dimensions:tubDimensions,profile:$('renderQuality').value,results,state:await solver.inspect()};
  }finally{read.destroy();if(probe){probe.destroy();resolve.destroy();}switching=false;dirty=true;}
};
