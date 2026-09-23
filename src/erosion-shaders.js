import { refinedFieldGLSL } from "./refined-field-glsl.js";
import {
  PARTICLE_SIZE,
  MAX_PARTICLES,
  RAIN_START,
  RAIN_PARTICLES,
  TOTAL_PARTICLE_SLOTS,
} from "./particle-pool.js";
export {
  PARTICLE_SIZE,
  MAX_PARTICLES,
  RAIN_START,
  RAIN_PARTICLES,
  TOTAL_PARTICLE_SLOTS,
} from "./particle-pool.js";
import { domainGLSL } from "./domain.js";
import {
  SIZE,
  MIN,
  MAX,
  CELL,
  BAND,
  ATLAS_COLS,
  ATLAS_SIZE,
  glslVec,
} from "./domain.js";
export { BAND, ATLAS_COLS } from "./domain.js";
import { rainPhysicsGLSL } from "./rain-physics.js";
import { hydraulicGLSL } from "./hydraulic-transport.js";
import { lifecycleGLSL } from "./particle-lifecycle.js";
import { flowPathGLSL } from "./flow-path-glsl.js";
// WebGL2 GPGPU: fragment passes + MRT + instanced scatter. No WebGPU.
// Research basis and deviations: docs/erosion-model.md.
export const SUPPORT_CELLS = 4; // support spans at most 3.8 voxels per axis at any domain size
export const SLICE_COUNT = 9;

export const fullscreenVertex = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}`;

// The 2D atlas is merely storage for the same XYZ volume, never a heightmap.
export const atlasGLSL = `
const int RAIN_START=${RAIN_START};
const int RAIN_COUNT=${RAIN_PARTICLES};
const ivec3 DIM=ivec3(${SIZE.join(",")});
${domainGLSL}
const ivec2 ATLAS=ivec2(${ATLAS_SIZE.join(",")});

ivec2 address(ivec3 q){q=clamp(q,ivec3(0),DIM-1);return ivec2((q.z%16)*DIM.x+q.x,(q.z/16)*DIM.y+q.y);}
ivec3 voxelAt(ivec2 uv){ivec2 tile=uv/DIM.xy;return ivec3(uv.x%DIM.x,uv.y%DIM.y,tile.y*16+tile.x);}
vec3 worldAt(ivec3 q){return LO+(vec3(q)+.5)*CELL;}
vec4 voxel(sampler2D tex,ivec3 q){return texelFetch(tex,address(q),0);}
vec4 atlasSample(sampler2D tex,vec3 p){
 vec3 q=clamp((p-LO)/CELL-.5,vec3(0),vec3(DIM)-1.001);
 ivec3 i=ivec3(floor(q));vec3 f=fract(q);
 #ifdef LINEAR_VOLUME
 vec2 uv0=(vec2((i.z%16)*DIM.x,(i.z/16)*DIM.y)+q.xy+.5)/vec2(ATLAS);
 int z1=i.z+1;vec2 uv1=(vec2((z1%16)*DIM.x,(z1/16)*DIM.y)+q.xy+.5)/vec2(ATLAS);
 return mix(textureLod(tex,uv0,0.),textureLod(tex,uv1,0.),f.z);
 #else
 return mix(mix(mix(voxel(tex,i),voxel(tex,i+ivec3(1,0,0)),f.x),mix(voxel(tex,i+ivec3(0,1,0)),voxel(tex,i+ivec3(1,1,0)),f.x),f.y),mix(mix(voxel(tex,i+ivec3(0,0,1)),voxel(tex,i+ivec3(1,0,1)),f.x),mix(voxel(tex,i+ivec3(0,1,1)),voxel(tex,i+ivec3(1,1,1)),f.x),f.y),f.z);
 #endif
}
float baseSDF(sampler2D tex,vec3 p){return atlasSample(tex,p).r+length(max(max(LO-p,p-HI),vec3(0)));}
${refinedFieldGLSL}
float sdf(sampler2D tex,vec3 p){return refinedDistance(tex,p);}
vec3 surfaceNormal(sampler2D tex,vec3 p){
 vec3 h=refineEnabled>.5?vec3(refineCell*.35):CELL*.45;
 // Same six central-difference samples, with two call sites rather than six
 // expanded refined samplers. A zero uniform preserves standalone consumers.
 vec3 g=vec3(0);int axes=int(shaderLoopLimits.z>0.?min(shaderLoopLimits.z,3.):3.);
 for(int axis=0;axis<axes;axis++){vec3 offset=vec3(0);offset[axis]=h[axis];g[axis]=sdf(tex,p+offset)-sdf(tex,p-offset);}
 g/=h;return length(g)>1e-6?normalize(g):vec3(0,1,0);
}
float kernel(vec3 p,vec3 c,float r){float a=max(0.,1.-length((p-c)/max(vec3(r),CELL*.95)));return a*a;}
void kernelBounds(vec3 c,float radius,out ivec3 lo,out ivec3 hi){
 vec3 support=max(vec3(radius),CELL*.95);
 lo=max(ivec3(ceil((c-support-LO)/CELL-.5)),ivec3(0));
 hi=min(ivec3(floor((c+support-LO)/CELL-.5)),DIM-1);
}

vec2 exchangeWeights(vec4 v,float k){float band=1.-smoothstep(BAND,2.*BAND,abs(v.r));return k*band*vec2(v.a,1.-v.a);}
ivec2 particleUV(int id){return ivec2(id%64,id/64);}
`;
const header = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${atlasGLSL}
${lifecycleGLSL}
${hydraulicGLSL}
${rainPhysicsGLSL}
`;
const physicsUniforms =
  flowPathGLSL +
  `
uniform sampler2D terrain,positions,velocities,cargo,metadata,species,rainFilm;
uniform sampler2D lifecycle; // remaining ticks, stall ticks, phase (0 active / 1 settling / 2 dead), settle ticks
uniform vec4 runoffSettings; // captured travel limit, fractional evaporation/s, shallow head (m), reserved
uniform vec4 lifeSettings; // rain maximum age, water loss/sec, rain stall seconds, transport speed threshold
uniform vec4 physics; // dt, rain, restitution, wind
uniform vec4 hydraulic; // SI erodibility, film depth, drag coefficient, preview multiplier
uniform float scatterLimit; // prevent overflow on the float16 scatter fallback
uniform float erosionExposure; // explicit artistic parcel multiplier, not particle count
uniform float hydraulicShaping;
uniform float representativeArea; // nominal catchment area / particle sample count
uniform vec4 process; // detachment, hardness, deposition, capacity
uniform vec4 config; // footprint, grain diameter (mm), active particle limit, source mode
uniform vec4 environment; // water level, strata, seed, step
uniform vec4 emitter; // runoff center XZ, rain footprint half-extents
uniform vec4 river; // speed, width, depth, center offset
uniform vec4 windField; // speed, height, spread, direction radians
uniform vec4 weather; // incoming diameter mm, chemistry rate, solubility, river enabled
float total(vec4 a){return dot(a,vec4(1));}
float riverMaskFrame(vec3 p,FlowFrame f){
 return weather.w*(1.-smoothstep(f.width,f.width+.6,f.distance))*(1.-smoothstep(f.height+.3,f.height+1.3,p.y))*smoothstep(f.height-river.z-1.5,f.height-river.z-.5,p.y);
}
float riverMask(vec3 p){if(flowValue(0).x<1.)return 0.;return riverMaskFrame(p,closestFlow(p.xz));}
vec3 currentAtFrame(vec3 p,FlowFrame f){
 vec2 lateral=(f.point-p.xz)*.65;float lengthL=length(lateral);lateral*=min(1.,2./max(lengthL,.001));
 return vec3(f.tangent.x*f.speed+lateral.x,clamp(dot(f.gradient,f.tangent)*f.speed,-6.,6.)-.12,f.tangent.y*f.speed+lateral.y);
}
vec3 currentAt(vec3 p){return currentAtFrame(p,closestFlow(p.xz));}
bool surfaceRunoff(vec4 meta){return (meta.x<.5&&meta.w>=0.)||meta.x==1.;}
vec3 drainageNormal(vec3 p){
 vec3 h=max(CELL*2.,vec3(runoffSettings.z*12.));
 // Do not mistake the finite-volume outside-distance extension for a hill.
 vec3 lo=max(LO+CELL*.5,p-h),hi=min(HI-CELL*.5,p+h);
 vec3 g=vec3(0);int axes=int(shaderLoopLimits.z>0.?min(shaderLoopLimits.z,3.):3.);
 for(int axis=0;axis<axes;axis++){vec3 a=p,b=p;a[axis]=hi[axis];b[axis]=lo[axis];g[axis]=(sdf(terrain,a)-sdf(terrain,b))/max(hi[axis]-lo[axis],1e-5);}
 return length(g)>1e-6?normalize(g):vec3(0,1,0);
}

vec4 rockProduct(float kind){
 if(kind>4.5)return vec4(0,0,0,1);
 if(kind>3.5)return vec4(.22,.08,.70,0);
 if(kind>2.5)return vec4(.85,.15,0,0);
 return vec4(.65,.30,.05,0);
}
`;

export const motionFragment =
  header +
  physicsUniforms +
  `
layout(location=0) out vec4 nextPosition;
layout(location=1) out vec4 nextVelocity;
layout(location=2) out vec4 nextMetadata;
layout(location=3) out vec4 impact;
// Integer hashing avoids the precision collapse of large-ID sine hashes.
uint rngState;
uint rainHash(uint x){x^=x>>16;x*=0x7feb352du;x^=x>>15;x*=0x846ca68bu;return x^(x>>16);}
float rand(float unused){rngState=rainHash(rngState+0x9e3779b9u);return float(rngState>>8)*(1./16777216.);}

void main(){
 ivec2 uv=ivec2(gl_FragCoord.xy);int id=uv.y*64+uv.x;
 rngState=rainHash(uint(id)^rainHash(uint(environment.w))^rainHash(uint(environment.z)));
 vec4 oldP=texelFetch(positions,uv,0),oldV=texelFetch(velocities,uv,0),meta=texelFetch(metadata,uv,0);
 nextPosition=oldP;nextVelocity=oldV;nextMetadata=meta;impact=vec4(0);
 // Disjoint passes read the SAME old state. Discard preserves the other pass's
 // outputs, so a newborn cannot also integrate, and retirement cannot rebirth.
 #ifdef MOTION_BIRTH_ONLY
 if(!(oldP.w<0.))discard;
 #endif
 #ifdef MOTION_TRANSPORT_ONLY
 if(oldP.w<0.)discard;
 #endif
 if(float(id)>=config.z&&id<RAIN_START)return;
 vec3 p=oldP.xyz,v=oldV.xyz;float age=oldP.w,water=oldV.w,dt=physics.x;
 float kind=meta.x;
 #ifndef MOTION_BIRTH_ONLY
 vec4 load=texelFetch(species,uv,0);
 vec4 clock=texelFetch(lifecycle,uv,0);
 // Retirement and birth are different ticks. Cargo feedback retires leftovers
 // exactly once, after a bounded opportunity to deposit the particulate load.
 bool outside=any(lessThan(p,LO+CELL*.25))||any(greaterThan(p,HI-CELL*.25))||any(isnan(p))||any(isinf(p));
 if(age>=0.&&(clock.z>2.5||outside||(clock.z>.5&&clock.w>=SETTLE_TICKS-1.))){nextPosition.w=-1.;nextVelocity=vec4(0);return;}
 if(age>=0.&&clock.z>.5){dt=min(dt,max(0.,SETTLE_TICKS-1.-clock.w)*.04);nextPosition=vec4(p,age+dt);nextVelocity=vec4(0);return;}
 if(age>=0.)dt=min(dt,max(0.,clock.x)*.04); // birth-captured age stays exact when speed changes
 #endif
 #ifndef MOTION_TRANSPORT_ONLY
 bool expired=age<0.;
 if(expired){
  bool precipitation=id>=RAIN_START;
  if(!precipitation&&config.w==0.&&hydraulicShaping<.5){nextPosition.w=-1.;nextVelocity=vec4(0);return;}
  if(precipitation&&(config.w!=0.||hydraulicShaping>.5)){nextPosition.w=-1.;nextVelocity=vec4(0);return;}
  if(config.w==2.&&flowValue(0).x<1.){nextPosition.w=-1.;nextVelocity=vec4(0);return;}
  // A time-based rain birth probability staggers the finite pool into a shower
  // instead of synchronizing every drop into one surface-spawned batch.
  float birthChance=config.w<.5?1.-exp(-physics.y*physics.x*(precipitation?4.:2.)):physics.y;
  if(physics.y<=0.||rand(float(id)+environment.w*3.17)>=birthChance){nextPosition.w=-1.;nextVelocity=vec4(0);return;}
  float seed=float(id)*7.13+environment.w*1.77;kind=precipitation?-1.:config.w;
  nextMetadata=vec4(kind,config.x,weather.x,physics.z);impact.w=1.;
  vec2 xz=emitter.xy+(vec2(rand(seed),rand(seed+31.1))*2.-1.)*emitter.zw;
  if(kind<.5){
   // Find the surface under each WORLD-space XZ sample, at any terrain height.
   p=vec3(xz.x,HI.y-CELL.y*.5,xz.y);
   bool found=false;
   for(int j=0;j<int(shaderLoopLimits.x>0.?min(shaderLoopLimits.x,256.):256.);j++){float d=sdf(terrain,p);if(d<(refineEnabled>.5?refineCell*.03:.075*sceneScale)){found=true;break;}p.y-=refineEnabled>.5?refinedRayStep(terrain,p,vec3(0,-1,0),d):clamp(d*.6,.04*sceneScale,max(1.,CELL.y*4.));if(p.y<LO.y)break;}
   if(!found){nextPosition.w=-1.;nextVelocity=vec4(0);impact=vec4(0);return;}
   if(hydraulicShaping>.5){p+=surfaceNormal(terrain,p)*(.075-sdf(terrain,p));v=vec3(0);nextMetadata.w=physics.z;}
   else{
   p.y=min(HI.y-CELL.y*.25,p.y+max(8.,CELL.y*2.)+rand(seed+13.)*max(3.,CELL.y));
   if(sdf(terrain,p)<.6){nextPosition.w=-1.;nextVelocity=vec4(0);impact=vec4(0);return;}
   v=vec3(physics.w*.7,-min(rainTerminalSpeed(weather.x),3.5+2.*rand(seed+19.)),physics.w*.08);
   nextMetadata.w=-1.-physics.z;
   }
  }else if(kind==2.){
   // Every generation starts at a visible route inlet, never a hidden preset channel.
   vec2 birth=flowBirth(rand(seed+3.),false);FlowFrame f=closestFlow(birth);
   birth+=vec2(f.tangent.y,-f.tangent.x)*(rand(seed+8.)-.5)*f.width*1.5;
   float x=birth.x,z=birth.y;
   p=vec3(x,closestFlow(vec2(x,z)).height-river.z*rand(seed+12.),z);
   for(int j=0;j<int(shaderLoopLimits.y>0.?min(shaderLoopLimits.y,8.):8.);j++){float d=sdf(terrain,p);if(d>=.08)break;p+=surfaceNormal(terrain,p)*min(.7,.09-d);}
   FlowFrame placed=closestFlow(p.xz);
   if(sdf(terrain,p)<0.||placed.distance>placed.width||p.y>placed.height+.3){nextPosition.w=-1.;nextVelocity=vec4(0);impact=vec4(0);return;}
   v=currentAt(p);
  }else if(kind==3.){
   vec2 dir=vec2(cos(windField.w),sin(windField.w)),side=vec2(-dir.y,dir.x);
   vec2 horizontal=emitter.xy+(vec2(rand(seed+5.),rand(seed+17.))*2.-1.)*emitter.zw;
   float extent=min((HI.x-CELL.x+sign(dir.x)*horizontal.x)/max(abs(dir.x),.0001),(HI.z-CELL.z+sign(dir.y)*horizontal.y)/max(abs(dir.y),.0001));
   horizontal-=dir*max(0.,extent);
   p=vec3(horizontal.x,clamp(windField.y+(rand(seed+9.)-.5)*windField.z,LO.y+CELL.y*.5,HI.y-CELL.y*.5),horizontal.y);
   v=vec3(dir.x,0,dir.y)*windField.x;
  }else{
   if(kind==1.)xz=emitter.xy+(vec2(rand(seed+3.),rand(seed+8.))-.5)*min(emitter.zw,vec2(3.*sceneScale));
   p=vec3(xz.x,HI.y-1.,xz.y);
   for(int j=0;j<int(shaderLoopLimits.x>0.?min(shaderLoopLimits.x,256.):256.);j++){float d=sdf(terrain,p);if(d<.075*sceneScale||p.y<LO.y+CELL.y)break;p.y-=refineEnabled>.5?refinedRayStep(terrain,p,vec3(0,-1,0),d):clamp(d*.6,.04*sceneScale,max(1.,CELL.y*4.));}
   vec3 n=surfaceNormal(terrain,p);p+=n*(kind==4.? .35:.09);
   v=vec3(physics.w*.7,kind==4.?-5.:-2.5,kind==1.?1.8:kind==4.?.3:0.);
   impact.x=kind==4.?5.:2.5;
  }
  if(hydraulicShaping>.5)nextMetadata.x=0.;
  nextPosition=vec4(p,0);nextVelocity=vec4(v,1);return;
 }
 #endif
 #ifndef MOTION_BIRTH_ONLY
 float solidLoad=total(load),coarse=load.z/max(solidLoad,1e-12);
 float collisionRadius=max(.075,min(.18,meta.z*.0005));
 // Resolve downhill drainage over shallow, sub-grid erosion pits. This is a
 // bounded-head routing approximation, not a pressure solver or a heightmap.
 bool routed=surfaceRunoff(meta)&&runoffSettings.z>0.;
 vec3 guide=vec3(0),pressureAcceleration=vec3(0);bool pressure=false;
 if(routed&&sdf(terrain,p)<runoffSettings.z+.15){
  vec3 n=drainageNormal(p),down=vec3(0,-1,0)+n*n.y;float slope=length(down);
  pressure=n.y>.05&&slope>.015&&p.y<=clock.w+runoffSettings.z+.001;
  if(pressure){guide=down/max(slope,1e-6)*min(8.,pow(max(hydraulic.y,min(runoffSettings.z,.1)),2./3.)*sqrt(slope)/.045);
   vec3 bedNormal=surfaceNormal(terrain,p),g=vec3(0,-9.81,0);
   pressureAcceleration=(g-n*dot(g,n))-(g-bedNormal*dot(g,bedNormal));
  }
 }

 int substeps=max(1,int(ceil(dt/.01-1e-5)));
 for(int i=0;i<min(32,substeps);i++){
  float h=dt/float(substeps);
  FlowFrame localRoute=closestFlow(p.xz);
  float flow=flowValue(0).x<1.?0.:riverMaskFrame(p,localRoute);
  bool wet=flow>.05||(localRoute.distance<localRoute.width&&p.y<localRoute.height&&p.y>localRoute.height-river.z-1.5);
  if(kind==3.&&!wet){
   vec3 air=vec3(cos(windField.w),0,sin(windField.w))*windField.x;
   float settling=clamp(meta.z*meta.z*.12,.015,1.5);
   air.y=(windField.y-p.y)*.45+sin(p.z*.65+environment.w*.08)*.4-settling;
   v=mix(v,air,1.-exp(-h*2.5));
  }else{
   float gravity=wet?mix(.08,.7,coarse):1.;
   v+=vec3(physics.w*.35,-9.81*gravity,physics.w*.08)*h;
   if(kind<.5&&meta.w<0.){float terminal=rainTerminalSpeed(meta.z);v.y/=1.+h*9.81*abs(v.y)/(terminal*terminal);v.y=max(v.y,-terminal);v.xz*=exp(-h*.15);}
   else v*=exp(-h*(wet?.45:.15));
   // All wet carriers, including rain/rockfall sediment, share this current.
   if(flow>.01){vec3 current=currentAtFrame(p,localRoute);float drag=(kind==4.?1.6:3.5)*(1.-coarse*.65);v=mix(v,current,1.-exp(-h*drag*flow));}
  }
  if(pressure){v+=pressureAcceleration*h;v=mix(v,guide,1.-exp(-h*.8));}
  v*=min(1.,(hydraulicShaping>.5?4.:12.)/max(length(v),.001));
  vec3 q=p+v*h;float d=sdf(terrain,q);
  if(d<collisionRadius){vec3 n=surfaceNormal(terrain,q);q+=n*min(.2,collisionRadius-d);float inward=min(dot(v,n),0.);impact.x=max(impact.x,-inward);impact.y=max(impact.y,1.);
   if(kind<.5&&meta.w<0.){impact.y=2.;meta.w=-meta.w-1.;nextMetadata.w=meta.w;}
   // Liquid contact is inelastic runoff, not a bouncing solid projectile.
   if(liquidAgent(kind))v-=min(dot(v,n),0.)*n;
   else v-=(1.+meta.w)*inward*n;
   v*=exp(-h*(kind==4.? .9:.45));}
  // Do not pump a carrier up a deep closed basin or through its walls.
  if(pressure&&q.y>clock.w+runoffSettings.z&&q.y>p.y){q=p;v=vec3(0);}
  if(kind<.5)water=water*exp(-h*(meta.w<0.?lifeSettings.y:runoffSettings.y));
  p=q;impact.z=max(impact.z,flow);
 }
 water=kind<.5?water:kind==1.?water*exp(-dt*runoffSettings.y):liquidAgent(kind)&&kind!=2.?max(0.,water-dt/12.):water*exp(-dt*.004);
 // Rainwater arrives through conservative parcel handoff/coalescence.
 // The impact diagnostic field must not recharge the same water a second time.
 nextPosition=vec4(p,age+dt);nextVelocity=vec4(v,water);
 #endif
}
`;

// Keep the combined source for GPU equivalence tests, but never compile it in
// production: source/transport no longer share a single native shader binary.
export const motionBirthFragment = motionFragment.replace("#version 300 es", "#version 300 es\n#define MOTION_BIRTH_ONLY");
export const motionTransportFragment = motionFragment.replace("#version 300 es", "#version 300 es\n#define MOTION_TRANSPORT_ONLY");

export const lifecycleFragment =
  header +
  physicsUniforms +
  `
uniform sampler2D previousPositions,impacts;
out vec4 nextLife;
void main(){
 ivec2 uv=ivec2(gl_FragCoord.xy);int id=uv.y*64+uv.x;
 vec4 old=texelFetch(lifecycle,uv,0),p=texelFetch(positions,uv,0),v=texelFetch(velocities,uv,0),meta=texelFetch(metadata,uv,0),hit=texelFetch(impacts,uv,0);
 nextLife=old;if(float(id)>=config.z&&id<RAIN_START)return;
 if(p.w<0.){nextLife=vec4(0,0,2,0);return;}
 if(hit.w>.5){float life=(meta.x==1.||meta.x==2.)&&runoffSettings.x>0.?runoffSettings.x:(meta.x<.5?agentLife(meta.x,lifeSettings.x):agentLife(meta.x,lifeSettings.x)*sceneScale);nextLife=vec4(ceil(life/.04-1e-4),0,0,p.y);return;}
 // Every falling rain parcel becomes real sediment-carrying runoff.
 // One transition only: airborne clock -> captured runoff travel budget.
 if(hit.y>1.5&&meta.x<.5&&runoffSettings.x>0.){nextLife=vec4(ceil(runoffSettings.x/.04-1e-4),0,0,p.y);return;}
 float dryThreshold=meta.x<.5?1e-12:.015;
 float ticks=min(physics.x/.04,old.z>.5?max(0.,SETTLE_TICKS-1.-old.w):old.x);
 if(old.z>.5){nextLife=vec4(0,old.y,1,old.w+ticks);return;}
 if(meta.x<.5&&meta.w<0.){float remaining=max(0.,old.x-ticks);nextLife=vec4(remaining,0,(remaining<.001||v.w<=dryThreshold)?1.:0.,0);return;}
 vec3 n=surfaceNormal(terrain,p.xyz),delta=p.xyz-texelFetch(previousPositions,uv,0).xyz;
 float travel=length(delta-n*dot(delta,n))/max(1e-6,p.w-texelFetch(previousPositions,uv,0).w);
 float speed=min(length(v.xyz-n*dot(v.xyz,n)),travel);
 bool contact=hit.y>.5||(meta.x>=.5||meta.w>=0.)&&sdf(terrain,p.xyz)<.28*sceneScale;
 float stall=contact&&speed<lifeSettings.w?old.y+ticks:0.;
 float remaining=max(0.,old.x-ticks);
 float maxStall=ceil((surfaceRunoff(meta)||meta.x==2.?lifeSettings.z:1.2)/.04-1e-4);
 // A numerical travel timeout is not a physical sediment trap.
 if(remaining<.001&&(surfaceRunoff(meta)||meta.x==2.)&&speed>=lifeSettings.w&&v.w>dryThreshold){nextLife=vec4(0,stall,3,old.w);return;}
 bool settle=remaining<.001||v.w<=dryThreshold||(contact&&stall>=maxStall-.001);
 nextLife=vec4(remaining,stall,settle?1.:0.,settle?0.:min(old.w,p.y));
}
`;

export const eventFragment =
  header +
  physicsUniforms +
  `
uniform sampler2D impacts,materials,previousPositions;
layout(location=0) out vec4 contactEvent;
layout(location=1) out vec4 exchangeEvent;
layout(location=2) out float substrateFraction;
void main(){
 ivec2 uv=ivec2(gl_FragCoord.xy);int id=uv.y*64+uv.x;
 contactEvent=vec4(0);exchangeEvent=vec4(0);substrateFraction=1.;
 vec4 p=texelFetch(positions,uv,0),v=texelFetch(velocities,uv,0),meta=texelFetch(metadata,uv,0),hit=texelFetch(impacts,uv,0);
 if((float(id)>=config.z&&id<RAIN_START)||p.w<0.)return;
 if(texelFetch(lifecycle,uv,0).z>2.5)return;
 if(meta.x<.5&&meta.w<0.)return; // No surface reads or exchange while rain is airborne.
 float d=sdf(terrain,p.xyz);if(d> .28*sceneScale||d< -.6*sceneScale)return;
 vec3 n=surfaceNormal(terrain,p.xyz),c=p.xyz-n*d;
 float radius=meta.y,kind=meta.x;
 float availableLoose=0.;
 vec2 sums=vec2(0);ivec3 lo,hi;kernelBounds(c,radius,lo,hi);
 for(int z=lo.z;z<=hi.z;z++)for(int y=lo.y;y<=hi.y;y++)for(int x=lo.x;x<=hi.x;x++){
  ivec3 q=ivec3(x,y,z);
  float k=kernel(worldAt(q),c,radius);if(k<=0.)continue;sums+=exchangeWeights(voxel(terrain,q),k);availableLoose+=k*total(voxel(materials,q));
 }
 vec4 mixture=hit.w>.5?vec4(0):texelFetch(species,uv,0);
 bool settling=texelFetch(lifecycle,uv,0).z>.5;
 vec3 tangent=v.xyz-n*dot(v.xyz,n),delta=p.xyz-texelFetch(previousPositions,uv,0).xyz;
 float travel=length(delta-n*dot(delta,n))/max(1e-6,p.w-texelFetch(previousPositions,uv,0).w);
 float speed=liquidAgent(kind)?min(length(tangent),travel):length(v.xyz);
 if(hit.w>.5)speed=length(tangent);
 float load=total(mixture),water=v.w,dt=hit.w>.5?physics.x:max(0.,p.w-texelFetch(previousPositions,uv,0).w),exposure=max(1.,erosionExposure);
 float strata=.5+.5*sin(c.y*3.5);
 float loose=clamp(total(atlasSample(materials,c))/(VOXEL_VOLUME*.5),0.,1.);
 float critical=(.15+process.y*1.55+environment.y*strata*.55)*mix(1.,.22,loose);
 // Only the FIRST rain impact has a normal-impact contribution. Constraint
 // corrections / gravity bounce on subsequent contacts cannot excavate rock.
 float hemisphere=2.0943951*radius*radius*radius;
 float capacity=(.02+process.w*.3)*water*(.15+.35*speed);
 float detach=0.,waterDeposit=0.;
 if(kind==5.){
  capacity=(.025+weather.z*.3)*water;
  float unsaturated=max(0.,1.-load/max(capacity,.0001));
  // Reaction-limited dissolution. No mechanical shear threshold.
  detach=process.x*weather.y*unsaturated*water*hemisphere*.12*dt/(.35+process.y);
 }else if(kind==4.){
  float mass=2650.*.5235988*pow(meta.z*.001,3.);
  float impactEnergy=.5*mass*hit.x*hit.x;
  detach=process.x*max(0.,pow(impactEnergy,.55)-critical*.15)*hemisphere*.14*dt;
 }else if(kind==3.){
  float sizeFactor=clamp(pow(meta.z/.12,1.2),.1,4.);
  float abrasion=max(hit.x*.8,speed*.16);
  detach=process.x*max(0.,abrasion-critical*.4)*sizeFactor*hemisphere*.15*dt;
 }else{
  vec4 model=hydraulic;
  if(kind<.5){
   // V is actual m³, never contributing area * preview multiplier.
   vec3 drive=drainageNormal(c);float slope=length(drive.xz);
   vec4 exchange=rainExchange(speed,slope,water,dot(mixture.xyz,vec3(1)),availableLoose,config.y*.001,dt,process,model,exposure);
   detach=exchange.x;waterDeposit=exchange.y;capacity=exchange.z;substrateFraction=rainRockFraction;
   if(hit.y>1.5){
    float room=max(0.,capacity-dot(mixture.xyz,vec3(1)));
    // Splash redistributes available loose material; it does not blast bare rock.
    float splash=min(availableLoose,min(splashVolume(water,hit.x,process.y,process.x,process.w)*exp(-2.*model.y/max(meta.z*.001,.0001)),room*.1));
    float previous=detach;detach=min(detach+splash,room);substrateFraction*=previous/max(detach,1e-12);
   }
  }else{
   model.w*=exposure;
   if(kind==2.)model.y=max(model.y,closestFlow(c.xz).height-c.y);
   vec4 exchange=waterExchange(speed,water,dot(mixture.xyz,vec3(1)),config.y*.001,environment.y*strata,loose,representativeArea,dt,process,model);
   detach=exchange.x;waterDeposit=exchange.y;capacity=exchange.z;
  }

 }
 if(kind>=2.5){detach*=exposure;capacity*=exposure;}
 if(settling||(liquidAgent(kind)&&kind!=5.&&hit.w<.5&&!(kind<.5&&hit.y>1.5)&&speed<lifeSettings.w))detach=0.;
 if(kind>=2.5)detach=min(detach,max(0.,capacity-load));
 detach=min(detach,sums.x*VOXEL_VOLUME*.06);
 float grainRadius=config.y*.001*.5;
 float settlingSpeed=(2./9.)*9.81*grainRadius*grainRadius*1650./.001;
 float particulate=mixture.x+mixture.y+mixture.z;
 float suspendedFraction=particulate/max(capacity,.0001);
 settlingSpeed*=pow(clamp(1.-suspendedFraction,0.,1.),5.);
 float surplus=max(0.,load-capacity);
 float deposit=process.z*(surplus*(1.-exp(-dt*5.))+particulate*settlingSpeed*dt/max(.1,radius));
 // Coarse fragments settle sooner; dissolved material remains in solution.
 deposit+=process.z*mixture.z*dt*.6/(1.+speed);
 if(water<.04)deposit=max(deposit,particulate*.5*process.z);
 if(kind<2.5)deposit=waterDeposit;
 float depositionalSupply=dot(mixture,settling?vec4(1,1,1,0):vec4(.4,.07,1.,0));
 if(settling){
  // Water evaporates; it does not become rock. Deposit only carried solids,
  // including fine sediment, independent of the artistic deposition slider.
  deposit=particulate*(1.-exp(-dt*8.));
  if(texelFetch(lifecycle,uv,0).w>=SETTLE_TICKS-2.)deposit=particulate;
 }
 deposit=min(min(depositionalSupply,deposit),sums.y*VOXEL_VOLUME*.06);
 // Resolve competing demands by their net magnitude, not a deposition veto.
 // Even tiny settling is positive once a drop carries sediment; letting
 // it cancel ALL detachment stops healthy, unsaturated runoff from eroding.
 // Keep just one exchange direction, without weakening rest/lifetime guards.
 float netExchange=detach-deposit;
 float safeLimit=scatterLimit>0.?scatterLimit:1e30;
 detach=min(max(netExchange,0.),safeLimit);deposit=min(max(-netExchange,0.),safeLimit);
 contactEvent=vec4(c,radius);exchangeEvent=vec4(detach,deposit,sums);
}
`;

// One quad per particle per Z slice scatters the compact 3D kernel to the atlas.
export const splatVertex =
  header +
  `
uniform sampler2D contacts,exchanges,species,metadata,positions,lifecycle,substrateFractions;
uniform float waterLevel,flowWeight;
uniform sampler2D velocities,impacts;
flat out vec4 eventFlow;
uniform float carrierCount;
flat out float eventWetness,eventRain,eventSubstrate;
flat out vec4 eventSpecies;
flat out vec4 eventContact;
flat out vec4 eventExchange;
flat out int sliceIndex;
void main(){
 int linear=gl_InstanceID/9;int id=linear<int(carrierCount)?linear:RAIN_START+linear-int(carrierCount);int offset=gl_InstanceID%9-4;
 eventSubstrate=texelFetch(substrateFractions,particleUV(id),0).r;
 eventContact=texelFetch(contacts,particleUV(id),0);eventExchange=texelFetch(exchanges,particleUV(id),0);
 eventSpecies=depositFractions(texelFetch(species,particleUV(id),0),texelFetch(lifecycle,particleUV(id),0).z>.5);
 float kind=texelFetch(metadata,particleUV(id),0).x;eventWetness=(kind==3.||kind==4.)?step(texelFetch(positions,particleUV(id),0).y,waterLevel):1.;
 vec4 velocity=texelFetch(velocities,particleUV(id),0);
 eventRain=kind<-.5&&texelFetch(impacts,particleUV(id),0).y>1.5?max(0.,velocity.w)*.12:0.;
 float exposure=kind<2.5&&texelFetch(lifecycle,particleUV(id),0).z<.5?max(0.,velocity.w)*flowWeight:0.;
 eventFlow=vec4(velocity.xyz*exposure,exposure);
 int z=int(floor((eventContact.z-LO.z)/CELL.z))+offset;sliceIndex=z;
 if(eventContact.w<=0.||z<0||z>=DIM.z){gl_Position=vec4(-2,-2,0,1);return;}
 vec2 corner=vec2((gl_VertexID==1||gl_VertexID==2||gl_VertexID==4)?1.:-1.,(gl_VertexID>=2&&gl_VertexID<=4)?1.:-1.);
 vec2 q=(eventContact.xy-LO.xy)/CELL.xy+corner*(max(vec2(eventContact.w),CELL.xy*.95)/CELL.xy+1.);
 q=clamp(q,vec2(0),vec2(DIM.xy));
 vec2 pixel=q+vec2((z%16)*DIM.x,(z/16)*DIM.y);
 gl_Position=vec4(pixel/vec2(ATLAS)*2.-1.,0,1);
}
`;
export const splatFragment =
  header +
  `
uniform sampler2D terrain;
flat in vec4 eventContact,eventExchange,eventSpecies,eventFlow;
flat in float eventWetness,eventRain,eventSubstrate;
flat in int sliceIndex;
layout(location=0) out vec4 request;
layout(location=1) out vec4 requestedSpecies;
layout(location=2) out vec4 requestedFlow;
layout(location=3) out float substrateRequest;
void main(){
 ivec2 pixel=ivec2(gl_FragCoord.xy);ivec3 q=voxelAt(pixel);
 if(q.z!=sliceIndex)discard;
 float k=kernel(worldAt(q),eventContact.xyz,eventContact.w);if(k<=0.)discard;
 vec2 weights=exchangeWeights(voxel(terrain,q),k);
 vec2 demand=eventExchange.xy*weights/max(eventExchange.zw,vec2(1e-9));
 request=vec4(demand,k*.03*eventWetness,k*eventRain);requestedSpecies=eventSpecies*demand.y;
 requestedFlow=eventFlow*(weights.x+weights.y);substrateRequest=demand.x*eventSubstrate;
}
`;
export const applyFragment =
  header +
  `
uniform sampler2D terrain,requests,materials,speciesRequests,previousFlow,flowRequests,substrateRequests,previousAcceptance;
uniform float maxSolidChange,stepTicks;
layout(location=0) out vec4 nextTerrain;
layout(location=1) out vec4 acceptance;
layout(location=2) out vec4 nextMaterials;
layout(location=3) out vec4 nextFlow;
void main(){
 ivec2 uv=ivec2(gl_FragCoord.xy);vec4 v=texelFetch(terrain,uv,0),r=texelFetch(requests,uv,0),m=texelFetch(materials,uv,0);
 vec4 history=texelFetch(previousFlow,uv,0)*pow(.996,max(1.,stepTicks))+texelFetch(flowRequests,uv,0);
 nextFlow=history*min(1.,128./max(history.w,.00001));
 // Apply the shared surface-change budget AFTER summing all overlapping agents.
 float budget=maxSolidChange*VOXEL_VOLUME;
 float looseSupply=dot(m,vec4(1));
 float erosion=min(min(r.x,looseSupply+texelFetch(substrateRequests,uv,0).r),min(v.a*VOXEL_VOLUME,budget));
 float deposition=min(r.y,min((1.-v.a)*VOXEL_VOLUME+erosion,budget));
 // Compensated occupancy: retain changes smaller than one float32 alpha ULP.
 float increment=texelFetch(previousAcceptance,uv,0).w+(deposition-erosion)/VOXEL_VOLUME;
 float solid=clamp(v.a+increment,0.,1.);
 float residual=increment-(solid-v.a);
 if(solid==0.&&residual<0.||solid==1.&&residual>0.)residual=0.;
 float d=v.r;if(erosion+deposition>0.)d=BAND*(1.-2.*solid);
 nextTerrain=vec4(d,min(1.,v.g*pow(.995,max(1.,stepTicks))+r.z),v.b+deposition,solid);
 float er=r.x>0.?erosion/r.x:0.,dr=r.y>0.?deposition/r.y:0.;
 acceptance=vec4(er,dr,erosion,residual);
 nextMaterials=m*max(0.,1.-erosion/max(looseSupply,1e-10))+texelFetch(speciesRequests,uv,0)*dr;
}
`;
export const cargoFragment =
  header +
  physicsUniforms +
  `
uniform sampler2D contacts,exchanges,acceptance,previousPositions,impacts,materials;
layout(location=0) out vec4 nextCargo;
layout(location=1) out vec4 nextSpecies;
void main(){
 ivec2 uv=ivec2(gl_FragCoord.xy);vec4 old=texelFetch(cargo,uv,0),p=texelFetch(positions,uv,0),previous=texelFetch(previousPositions,uv,0),hit=texelFetch(impacts,uv,0);
 vec4 mix=texelFetch(species,uv,0);float kind=texelFetch(metadata,uv,0).x;
 if(float(uv.y*64+uv.x)>=config.z&&uv.y*64+uv.x<RAIN_START){nextCargo=old;nextSpecies=mix;return;}
 bool retired=(p.w<0.&&previous.w>=0.)||hit.w>.5;
 if(retired){old.w+=old.x;old.x=0.;mix=vec4(0);}
 vec4 c=texelFetch(contacts,uv,0),e=texelFetch(exchanges,uv,0);vec2 accepted=vec2(0);vec4 newMaterial=vec4(0);
 if(c.w>0.&&e.x+e.y>0.){
  ivec3 lo,hi;kernelBounds(c.xyz,c.w,lo,hi);
  for(int z=lo.z;z<=hi.z;z++)for(int y=lo.y;y<=hi.y;y++)for(int x=lo.x;x<=hi.x;x++){
   ivec3 q=ivec3(x,y,z);
   float k=kernel(worldAt(q),c.xyz,c.w);if(k<=0.)continue;
   vec4 ground=voxel(terrain,q);vec2 weights=exchangeWeights(ground,k);
   vec2 amount=e.xy*weights/max(e.zw,vec2(1e-9))*voxel(acceptance,q).xy;
   accepted+=amount;
   vec4 material=voxel(materials,q);
   vec4 loose=material/max(max(total(material),voxel(acceptance,q).z),1e-10);loose/=max(1.,total(loose));
   vec4 product=loose+rockProduct(kind)*max(0.,1.-total(loose));
   if(kind==5.)product=vec4(0,0,0,1);
   newMaterial+=amount.x*product;
  }
 }
 mix=max(vec4(0),mix+newMaterial-depositFractions(mix,texelFetch(lifecycle,uv,0).z>.5)*accepted.y);
 // Attrition transfers coarse -> sand/fines without changing total cargo.
 float broken=mix.z*(1.-exp(-physics.x*(.025+hit.x*.30+hit.z*.10)));
 mix.z-=broken;mix.x+=broken*.8;mix.y+=broken*.2;
 float flour=mix.x*(1.-exp(-physics.x*hit.z*.008));mix.x-=flour;mix.y+=flour;
 float carried=max(0.,old.x+accepted.x-accepted.y);
 mix*=carried/max(total(mix),1e-12);
 nextSpecies=mix;nextCargo=vec4(carried,old.y+accepted.x,old.z+accepted.y,old.w);
}
`;

// Occupancy fixes the interface sign; propagation repairs distances outside the
// partial-volume surface cells without creating/destroying stored material.
export const distanceFragment =
  header +
  `
uniform sampler2D terrain,occupancyResidual;
out vec4 nextTerrain;
void main(){
 ivec3 q=voxelAt(ivec2(gl_FragCoord.xy));vec4 v=voxel(terrain,q);
 if(v.a>.00001&&v.a<.99999){v.r=BAND*(1.-2.*v.a)-2.*BAND*texelFetch(occupancyResidual,ivec2(gl_FragCoord.xy),0).w;nextTerrain=v;return;}
 vec3 a=vec3(min(abs(voxel(terrain,q-ivec3(1,0,0)).r),abs(voxel(terrain,q+ivec3(1,0,0)).r)),min(abs(voxel(terrain,q-ivec3(0,1,0)).r),abs(voxel(terrain,q+ivec3(0,1,0)).r)),min(abs(voxel(terrain,q-ivec3(0,0,1)).r),abs(voxel(terrain,q+ivec3(0,0,1)).r)));
 float value=min(min(a.x+CELL.x,a.y+CELL.y),a.z+CELL.z);
 // Isotropic local Eikonal quadratic, conservative cell spacing approximation.
 // Anisotropic Eikonal update: X/Y/Z spacing can differ on rectangular/tall terrain.
 vec3 h=CELL;
 for(int i=0;i<2;i++)for(int j=0;j<2-i;j++)if(a[j]>a[j+1]){float v=a[j];a[j]=a[j+1];a[j+1]=v;v=h[j];h[j]=h[j+1];h[j+1]=v;}
 float A=0.,B=0.,C=-1.,t=0.;
 for(int i=0;i<3;i++){float w=1./(h[i]*h[i]);A+=w;B+=a[i]*w;C+=a[i]*a[i]*w;t=(B+sqrt(max(0.,B*B-A*C)))/A;if(i==2||t<=a[i+1])break;}
 value=min(value,t);v.r=(v.a>=.5?-1.:1.)*max(BAND,value);
 nextTerrain=v;
}
`;
export const distanceRainFragment = distanceFragment
  .replace(
    "out vec4 nextTerrain;",
    `layout(location=0) out vec4 nextTerrain;
 layout(location=1) out float nextRain;
 uniform sampler2D rainFilm,rainRequests;
 uniform float rainStep;`,
  )
  .replace(
    "void main(){",
    `void main(){ivec2 pixel=ivec2(gl_FragCoord.xy);
 nextRain=clamp(texelFetch(rainFilm,pixel,0).r*exp(-rainStep*.2)+texelFetch(rainRequests,pixel,0).w,0.,1.);`,
  );

export const sculptFragment =
  header +
  `
uniform sampler2D terrain,materials;
uniform vec4 brush;
uniform int tool;
layout(location=0) out vec4 nextTerrain;
layout(location=1) out vec4 nextMaterials;
void main(){ivec3 q=voxelAt(ivec2(gl_FragCoord.xy));vec4 v=voxel(terrain,q);vec3 p=worldAt(q);float r=distance(p,brush.xyz);float d=v.r;
 if(tool==1)d=max(d,brush.w-r);else if(tool==2)d=min(d,r-brush.w);
 else if(r<brush.w){float avg=(voxel(terrain,q+ivec3(1,0,0)).r+voxel(terrain,q-ivec3(1,0,0)).r+voxel(terrain,q+ivec3(0,1,0)).r+voxel(terrain,q-ivec3(0,1,0)).r+voxel(terrain,q+ivec3(0,0,1)).r+voxel(terrain,q-ivec3(0,0,1)).r)/6.;d=mix(d,avg,.7*(1.-r/brush.w));}
 float oldSolid=v.a;
 if(d!=v.r){v.r=d;v.a=clamp(.5-d/(2.*BAND),0.,1.);}nextTerrain=v;
 nextMaterials=voxel(materials,q)*min(1.,v.a/max(oldSolid,1e-9));}
`;
export const pickFragment =
  header +
  `
uniform sampler2D terrain;
uniform vec3 origin,direction;
out vec4 hit;
void main(){hit=vec4(0);vec3 safe=sign(direction+vec3(1e-12))*max(abs(direction),vec3(1e-6));vec3 a=(LO-origin)/safe,b=(HI-origin)/safe,n=min(a,b),f=max(a,b);float t=max(0.,max(max(n.x,n.y),n.z)),end=min(min(f.x,f.y),f.z);
 for(int i=0;i<240;i++){if(t>end)return;vec3 p=origin+direction*t;float d=sdf(terrain,p);if(d<(refineEnabled>.5?refineCell*.03:.075*sceneScale)){
 if(refineEnabled>.5){for(int j=0;j<4;j++){float e=refineCell*.02,df=(sdf(terrain,p+direction*e)-sdf(terrain,p-direction*e))/(2.*e);if(abs(df)<1e-4)break;p-=direction*clamp(sdf(terrain,p)/df,-refineCell*.1,refineCell*.1);}}
 hit=vec4(p,1);return;}t+=refineEnabled>.5?refinedRayStep(terrain,p,direction,d):max(.035*sceneScale,d*.6);}}
`;
export const grainVertex =
  header +
  flowPathGLSL +
  `
uniform sampler2D terrain,positions,velocities,cargo,exchanges,metadata,species,lifecycle;
uniform vec4 eye,target;
uniform float activeCount,visualMode,waterLevel,particleViewportHeight,particleDrawStride,particleBase;
out vec4 grainColor;
out vec2 streakDirection;
out float streakWidth;
void main(){
 int id=int(particleBase)+gl_VertexID*int(max(1.,particleDrawStride));ivec2 uv=particleUV(id);vec4 p=texelFetch(positions,uv,0),load=texelFetch(cargo,uv,0),event=texelFetch(exchanges,uv,0),meta=texelFetch(metadata,uv,0),s=texelFetch(species,uv,0);
 streakDirection=vec2(0,1);streakWidth=1.;
 grainColor=vec4(0);gl_Position=vec4(-2,-2,0,1);gl_PointSize=1.;
 if((float(id)>=activeCount&&id<RAIN_START)||p.w<0.)return;
 bool plume=visualMode>.5;
 float particulate=s.x+s.y+s.z;
 if(plume){FlowFrame waterRoute=closestFlow(p.xz);bool wetRoute=waterRoute.distance<waterRoute.width&&p.y<waterRoute.height+.5&&p.y>waterRoute.height-4.;
  if(particulate<.002||((meta.x==3.||meta.x==4.)&&!wetRoute))return;}
 // Lift only the diagnostic surface marker above the coarse ray-hit epsilon.
 // The simulated particle and erosion contact remain at the true SDF surface.
 vec3 marker=p.xyz;if(meta.w>=0.&&abs(sdf(terrain,p.xyz))<max(.25,.2*sceneScale))marker+=surfaceNormal(terrain,p.xyz)*(refineEnabled>.5?refineCell*.08:max(.12,.06*sceneScale));
 vec3 forward=normalize(target.xyz-eye.xyz),right=normalize(cross(forward,vec3(0,1,0))),up=cross(right,forward),rel=marker-eye.xyz;
 float z=dot(rel,forward);if(z<.1)return;
 float lengthRay=length(rel);vec3 ray=rel/lengthRay;float t=0.;
 for(int i=0;i<192;i++){if(t>lengthRay-.25)break;float d=sdf(terrain,eye.xyz+ray*t);if(d<(refineEnabled>.5?refineCell*.02:.05))return;t+=refineEnabled>.5?refinedRayStep(terrain,eye.xyz+ray*t,ray,d):clamp(d*.65,.05*sceneScale,2.*sceneScale);}
 if(t<lengthRay-.25)return;
 gl_Position=vec4(dot(rel,right)/(.62*target.w),dot(rel,up)/.62,0,z);
 vec3 material=(s.x*vec3(.85,.59,.26)+s.y*vec3(.46,.44,.32)+s.z*vec3(.58,.52,.44)+s.w*vec3(.74,.55,.94))/max(load.x,.00001);
 vec3 fresh=meta.x==3.?vec3(.9,.78,.43):meta.x==4.?vec3(.67,.62,.55):meta.x==5.?vec3(.65,.52,1.):vec3(.3,.8,1.);
 vec3 color=mix(fresh,material,clamp(load.x*15.,0.,meta.x<2.5?.6:1.));
 if(event.y>event.x&&!plume)color=mix(color,vec3(.53,1.,.45),.5);
 gl_PointSize=plume?clamp(650./z,6.,28.):clamp((100.+log(1.+meta.z)*22.)/z,2.4,10.);
 bool fallingRain=!plume&&meta.x<.5&&meta.w<0.&&texelFetch(lifecycle,uv,0).z<.5;
 if(fallingRain){
  vec3 velocity=texelFetch(velocities,uv,0).xyz,tailRel=rel-velocity*.045;
  float tailZ=max(.1,dot(tailRel,forward));
  vec2 screenMotion=(vec2(dot(rel,right),dot(rel,up))/z-vec2(dot(tailRel,right),dot(tailRel,up))/tailZ)*particleViewportHeight/1.24;
  float pixels=length(screenMotion);
  streakDirection=pixels>.01?screenMotion/pixels:vec2(0,1);
  gl_PointSize=clamp(pixels+2.,4.,18.);
  streakWidth=clamp(1.4/gl_PointSize,.08,.4);
  color=vec3(.62,.82,.96);
 }
 float fade=texelFetch(lifecycle,uv,0).z>.5?max(0.,1.-texelFetch(lifecycle,uv,0).w/SETTLE_TICKS):1.;
 grainColor=vec4(plume?material:color,(plume?min(.22,particulate*2.):.88)*fade);
}
`;
export const grainFragment = `#version 300 es
precision highp float;
in vec4 grainColor;
in vec2 streakDirection;
in float streakWidth;
out vec4 color;
void main(){vec2 q=vec2(gl_PointCoord.x-.5,.5-gl_PointCoord.y);float r=length(vec2(dot(q,vec2(-streakDirection.y,streakDirection.x))/streakWidth,dot(q,streakDirection)))*2.;if(r>1.||grainColor.a==0.)discard;color=vec4(grainColor.rgb,grainColor.a*(1.-smoothstep(.15,1.,r)));}`;
