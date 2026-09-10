import { flowPathGLSL } from "./flow-path-glsl.js";
// WebGL2 GPGPU: fragment passes + MRT + instanced scatter. No WebGPU.
// Research basis and deviations: docs/erosion-model.md.
export const ATLAS_COLS = 16;
export const PARTICLE_SIZE = [64, 32];
export const MAX_PARTICLES = 2048;
export const SUPPORT_CELLS = 4; // max footprint 1.15 m / min cell 0.357 m
export const SLICE_COUNT = 9;
export const BAND = 0.32;

export const fullscreenVertex = `#version 300 es
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);gl_Position=vec4(p*2.-1.,0,1);}`;

// The 2D atlas is merely storage for the same XYZ volume, never a heightmap.
export const atlasGLSL = `
const ivec3 DIM=ivec3(112,72,112);
const vec3 LO=vec3(-22,-4,-20),HI=vec3(22,22,20);
const vec3 CELL=(HI-LO)/vec3(DIM);
const ivec2 ATLAS=ivec2(1792,504);
const float BAND=.32;
const float VOXEL_VOLUME=(44./112.)*(26./72.)*(40./112.);
ivec2 address(ivec3 q){q=clamp(q,ivec3(0),DIM-1);return ivec2((q.z%16)*112+q.x,(q.z/16)*72+q.y);}
ivec3 voxelAt(ivec2 uv){ivec2 tile=uv/ivec2(112,72);return ivec3(uv.x%112,uv.y%72,tile.y*16+tile.x);}
vec3 worldAt(ivec3 q){return LO+(vec3(q)+.5)*CELL;}
vec4 voxel(sampler2D tex,ivec3 q){return texelFetch(tex,address(q),0);}
vec4 atlasSample(sampler2D tex,vec3 p){
 vec3 q=clamp((p-LO)/CELL-.5,vec3(0),vec3(DIM)-1.001);
 ivec3 i=ivec3(floor(q));vec3 f=fract(q);
 #ifdef LINEAR_VOLUME
 vec2 uv0=(vec2((i.z%16)*112,(i.z/16)*72)+q.xy+.5)/vec2(ATLAS);
 int z1=i.z+1;vec2 uv1=(vec2((z1%16)*112,(z1/16)*72)+q.xy+.5)/vec2(ATLAS);
 return mix(textureLod(tex,uv0,0.),textureLod(tex,uv1,0.),f.z);
 #else
 return mix(mix(mix(voxel(tex,i),voxel(tex,i+ivec3(1,0,0)),f.x),mix(voxel(tex,i+ivec3(0,1,0)),voxel(tex,i+ivec3(1,1,0)),f.x),f.y),mix(mix(voxel(tex,i+ivec3(0,0,1)),voxel(tex,i+ivec3(1,0,1)),f.x),mix(voxel(tex,i+ivec3(0,1,1)),voxel(tex,i+ivec3(1,1,1)),f.x),f.y),f.z);
 #endif
}
float sdf(sampler2D tex,vec3 p){return atlasSample(tex,p).r+length(max(max(LO-p,p-HI),vec3(0)));}
vec3 surfaceNormal(sampler2D tex,vec3 p){
 vec3 g=vec3(sdf(tex,p+vec3(.16,0,0))-sdf(tex,p-vec3(.16,0,0)),sdf(tex,p+vec3(0,.16,0))-sdf(tex,p-vec3(0,.16,0)),sdf(tex,p+vec3(0,0,.16))-sdf(tex,p-vec3(0,0,.16)));
 return length(g)>1e-6?normalize(g):vec3(0,1,0);
}
float kernel(vec3 p,vec3 c,float r){float a=max(0.,1.-length(p-c)/r);return a*a;}
vec2 exchangeWeights(vec4 v,float k){float band=1.-smoothstep(BAND,2.*BAND,abs(v.r));return k*band*vec2(v.a,1.-v.a);}
ivec2 particleUV(int id){return ivec2(id%64,id/64);}
`;
const header = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${atlasGLSL}
`;
const physicsUniforms =
  flowPathGLSL +
  `
uniform sampler2D terrain,positions,velocities,cargo,metadata,species;
uniform vec4 physics; // dt, rain, restitution, wind
uniform vec4 process; // detachment, hardness, deposition, capacity
uniform vec4 config; // footprint, grain diameter (mm), active particle limit, source mode
uniform vec4 environment; // water level, strata, seed, step
uniform vec4 canyonShape; // gap, meander, flare, reserved
uniform vec4 river; // speed, width, depth, center offset
uniform vec4 windField; // speed, height, spread, direction radians
uniform vec4 weather; // incoming diameter mm, chemistry rate, solubility, river enabled
float total(vec4 a){return dot(a,vec4(1));}
float riverCenter(float z){return canyonShape.y*(2.5*sin(z*.15)+sin(z*.36+1.))+river.w;}
float riverMask(vec3 p){if(flowValue(0).y>.5){FlowFrame f=closestFlow(p.xz);return weather.w*(1.-smoothstep(f.width,f.width+1.5,f.distance))*(1.-smoothstep(environment.x+.3,environment.x+1.3,p.y));}return weather.w*(1.-smoothstep(river.y,river.y+2.,abs(p.x-riverCenter(p.z))))*(1.-smoothstep(environment.x+.3,environment.x+1.3,p.y));}
vec3 currentAt(vec3 p){
 if(flowValue(0).y>.5){FlowFrame f=closestFlow(p.xz);vec2 lateral=(f.point-p.xz)*.65;float lengthL=length(lateral);lateral*=min(1.,2./max(lengthL,.001));return vec3(f.tangent.x*f.speed+lateral.x,-.25,f.tangent.y*f.speed+lateral.y);}
 float derivative=canyonShape.y*(.375*cos(p.z*.15)+.36*cos(p.z*.36+1.));
 vec3 tangent=normalize(vec3(derivative,0,1));
 float lateral=clamp(riverCenter(p.z)-p.x,-river.y,river.y)*.65;
 return tangent*river.x+vec3(lateral,-.25,0);
}
vec4 depositedMix(vec4 a){vec4 weighted=a*vec4(.4,.07,1.,0);return weighted/max(total(weighted),1e-10);}
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
float rand(float x){return fract(sin(x*12.9898+environment.z*.17)*43758.5453);}
void main(){
 ivec2 uv=ivec2(gl_FragCoord.xy);int id=uv.y*64+uv.x;
 vec4 oldP=texelFetch(positions,uv,0),oldV=texelFetch(velocities,uv,0),meta=texelFetch(metadata,uv,0);
 nextPosition=oldP;nextVelocity=oldV;nextMetadata=meta;impact=vec4(0);
 if(float(id)>=config.z)return;
 vec3 p=oldP.xyz,v=oldV.xyz;float age=oldP.w,water=oldV.w,dt=physics.x;
 float kind=meta.x;vec4 load=texelFetch(species,uv,0);
 float life=kind==4.?45.:kind==2.?30.:20.;
 bool expired=age<0.||age>life||water<.015||(kind!=config.w&&total(load)<.0001)||any(lessThan(p,LO+vec3(.25)))||any(greaterThan(p,HI-vec3(.25)));
 if(expired){
  if(config.w==2.&&flowValue(0).y>.5&&flowValue(0).x<1.){nextPosition.w=-1.;nextVelocity=vec4(0);return;}
  if(physics.y<=0.||rand(float(id)+environment.w*3.17)>=physics.y){nextPosition.w=-1.;nextVelocity=vec4(0);return;}
  float seed=float(id)*7.13+environment.w*1.77;kind=config.w;
  nextMetadata=vec4(kind,config.x,weather.x,physics.z);impact.w=1.;
  vec2 xz=vec2(rand(seed),rand(seed+31.1))*vec2(36,30)-vec2(18,15);
  if(kind==2.){
   // River births are at the bed/water band, never at the sky emitter.
   // First batch fills the reach; replenishment subsequently enters upstream.
   float z=environment.w<.5?mix(-14.,14.,rand(seed+3.)):-14.5;
   float x=riverCenter(z)+(rand(seed+8.)-.5)*river.y*1.5;
   if(flowValue(0).y>.5){vec2 birth=flowBirth(rand(seed+3.),environment.w<.5);FlowFrame f=closestFlow(birth);birth+=vec2(f.tangent.y,-f.tangent.x)*(rand(seed+8.)-.5)*f.width*1.5;x=birth.x;z=birth.y;}
   p=vec3(x,environment.x-river.z*rand(seed+12.),z);
   for(int j=0;j<8;j++){float d=sdf(terrain,p);if(d>=.08)break;p+=surfaceNormal(terrain,p)*min(.7,.09-d);}
   v=currentAt(p);
  }else if(kind==3.){
   vec2 dir=vec2(cos(windField.w),sin(windField.w)),side=vec2(-dir.y,dir.x);
   vec2 horizontal=side*(rand(seed+5.)-.5)*26.;
   float extent=min((20.8+sign(dir.x)*horizontal.x)/max(abs(dir.x),.0001),(18.8+sign(dir.y)*horizontal.y)/max(abs(dir.y),.0001));
   horizontal-=dir*max(0.,extent);
   p=vec3(horizontal.x,clamp(windField.y+(rand(seed+9.)-.5)*windField.z,-1.,20.),horizontal.y);
   v=vec3(dir.x,0,dir.y)*windField.x;
  }else{
   if(kind==1.)xz=vec2(-10,-7)+(vec2(rand(seed+3.),rand(seed+8.))-.5)*3.;
   p=vec3(xz.x,21.,xz.y);
   for(int j=0;j<100;j++){float d=sdf(terrain,p);if(d<.075||p.y< -1.4)break;p.y-=clamp(d*.6,.04,1.);}
   vec3 n=surfaceNormal(terrain,p);p+=n*(kind==4.? .35:.09);
   v=vec3(physics.w*.7,kind==4.?-5.:-2.5,kind==1.?1.8:.3);
   impact.x=kind==4.?5.:2.5;
  }
  nextPosition=vec4(p,0);nextVelocity=vec4(v,1);return;
 }
 float solidLoad=total(load),coarse=load.z/max(solidLoad,.0001);
 float collisionRadius=max(.075,min(.18,meta.z*.0005));
 for(int i=0;i<4;i++){
  float h=dt*.25,flow=riverMask(p),depth=environment.x-p.y;
  bool wet=flow>.05||depth>0.;
  if(kind==3.&&!wet){
   vec3 air=vec3(cos(windField.w),0,sin(windField.w))*windField.x;
   float settling=clamp(meta.z*meta.z*.12,.015,1.5);
   air.y=(windField.y-p.y)*.45+sin(p.z*.65+environment.w*.08)*.4-settling;
   v=mix(v,air,1.-exp(-h*2.5));
  }else{
   float gravity=wet?mix(.08,.7,coarse):1.;
   v+=vec3(physics.w*.35,-9.81*gravity,physics.w*.08)*h;
   v*=exp(-h*(wet?.45:.15));
   // All wet carriers, including rain/rockfall sediment, share this current.
   if(flow>.01){vec3 current=currentAt(p);float drag=(kind==4.?1.6:3.5)*(1.-coarse*.65);v=mix(v,current,1.-exp(-h*drag*flow));}
  }
  v*=min(1.,12./max(length(v),.001));
  vec3 q=p+v*h;float d=sdf(terrain,q);
  if(d<collisionRadius){vec3 n=surfaceNormal(terrain,q);q+=n*(collisionRadius-d);float inward=min(dot(v,n),0.);impact.x=max(impact.x,-inward);impact.y=1.;v-=(1.+meta.w)*inward*n;v*=exp(-h*(kind==4.? .9:.45));}
  p=q;impact.z=max(impact.z,flow);
 }
 water*=exp(-dt*((kind==2.||kind==3.||kind==4.)?.004:.035));
 nextPosition=vec4(p,age+dt);nextVelocity=vec4(v,water);
}
`;

export const eventFragment =
  header +
  physicsUniforms +
  `
uniform sampler2D impacts,materials;
layout(location=0) out vec4 contactEvent;
layout(location=1) out vec4 exchangeEvent;
void main(){
 ivec2 uv=ivec2(gl_FragCoord.xy);int id=uv.y*64+uv.x;
 contactEvent=vec4(0);exchangeEvent=vec4(0);
 vec4 p=texelFetch(positions,uv,0),v=texelFetch(velocities,uv,0),meta=texelFetch(metadata,uv,0),hit=texelFetch(impacts,uv,0);
 if(float(id)>=config.z||p.w<0.)return;
 float d=sdf(terrain,p.xyz);if(d> .28||d< -.6)return;
 vec3 n=surfaceNormal(terrain,p.xyz),c=p.xyz-n*d;
 float radius=meta.y,kind=meta.x;
 vec2 sums=vec2(0);ivec3 center=ivec3(floor((c-LO)/CELL));
 for(int z=-4;z<=4;z++)for(int y=-4;y<=4;y++)for(int x=-4;x<=4;x++){
  ivec3 q=center+ivec3(x,y,z);if(any(lessThan(q,ivec3(0)))||any(greaterThanEqual(q,DIM)))continue;
  float k=kernel(worldAt(q),c,radius);if(k<=0.)continue;sums+=exchangeWeights(voxel(terrain,q),k);
 }
 vec4 mixture=hit.w>.5?vec4(0):texelFetch(species,uv,0);
 float load=total(mixture),speed=length(v.xyz),water=v.w,dt=physics.x;
 float strata=.5+.5*sin(c.y*3.5);
 float loose=clamp(total(atlasSample(materials,c))/(VOXEL_VOLUME*.5),0.,1.);
 float critical=(.15+process.y*1.55+environment.y*strata*.55)*mix(1.,.22,loose);
 float stress=sqrt(speed/max(.12,radius*.5));
 float hemisphere=2.0943951*radius*radius*radius;
 float capacity=(.02+process.w*.3)*water*(.15+.35*speed);
 float detach=0.;
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
  float sizeFactor=clamp(pow(meta.z/3.,.45),.3,2.3);
  detach=process.x*max(0.,stress-critical)*hemisphere*.22*dt*sizeFactor;
 }
 detach=min(min(detach,max(0.,capacity-load)),sums.x*VOXEL_VOLUME*.06);
 float grainRadius=config.y*.001*.5;
 float settling=(2./9.)*9.81*grainRadius*grainRadius*1650./.001;
 float particulate=mixture.x+mixture.y+mixture.z;
 float suspendedFraction=particulate/max(capacity,.0001);
 settling*=pow(clamp(1.-suspendedFraction,0.,1.),5.);
 float surplus=max(0.,load-capacity);
 float deposit=process.z*(surplus*(1.-exp(-dt*5.))+particulate*settling*dt/max(.1,radius));
 // Coarse fragments settle sooner; dissolved material remains in solution.
 deposit+=process.z*mixture.z*dt*.6/(1.+speed);
 if(water<.04)deposit=max(deposit,particulate*.5*process.z);
 float depositionalSupply=dot(mixture,vec4(.4,.07,1.,0));
 deposit=min(min(depositionalSupply,deposit),sums.y*VOXEL_VOLUME*.06);
 contactEvent=vec4(c,radius);exchangeEvent=vec4(detach,deposit,sums);
}
`;

// One quad per particle per Z slice scatters the compact 3D kernel to the atlas.
export const splatVertex =
  header +
  `
uniform sampler2D contacts,exchanges,species,metadata,positions;
uniform float waterLevel;
flat out float eventWetness;
flat out vec4 eventSpecies;
flat out vec4 eventContact;
flat out vec4 eventExchange;
flat out int sliceIndex;
void main(){
 int id=gl_InstanceID/9;int offset=gl_InstanceID%9-4;
 eventContact=texelFetch(contacts,particleUV(id),0);eventExchange=texelFetch(exchanges,particleUV(id),0);
 vec4 mix=texelFetch(species,particleUV(id),0)*vec4(.4,.07,1.,0);eventSpecies=mix/max(dot(mix,vec4(1)),1e-10);
 float kind=texelFetch(metadata,particleUV(id),0).x;eventWetness=(kind==3.||kind==4.)?step(texelFetch(positions,particleUV(id),0).y,waterLevel):1.;
 int z=int(floor((eventContact.z-LO.z)/CELL.z))+offset;sliceIndex=z;
 if(eventContact.w<=0.||z<0||z>=112){gl_Position=vec4(-2,-2,0,1);return;}
 vec2 corner=vec2((gl_VertexID==1||gl_VertexID==2||gl_VertexID==4)?1.:-1.,(gl_VertexID>=2&&gl_VertexID<=4)?1.:-1.);
 vec2 q=(eventContact.xy-LO.xy)/CELL.xy+corner*(eventContact.w/CELL.xy+1.);
 q=clamp(q,vec2(0),vec2(112,72));
 vec2 pixel=q+vec2((z%16)*112,(z/16)*72);
 gl_Position=vec4(pixel/vec2(ATLAS)*2.-1.,0,1);
}
`;
export const splatFragment =
  header +
  `
uniform sampler2D terrain;
flat in vec4 eventContact,eventExchange,eventSpecies;
flat in float eventWetness;
flat in int sliceIndex;
layout(location=0) out vec4 request;
layout(location=1) out vec4 requestedSpecies;
void main(){
 ivec2 pixel=ivec2(gl_FragCoord.xy);ivec3 q=voxelAt(pixel);
 if(q.z!=sliceIndex)discard;
 float k=kernel(worldAt(q),eventContact.xyz,eventContact.w);if(k<=0.)discard;
 vec2 weights=exchangeWeights(voxel(terrain,q),k);
 vec2 demand=eventExchange.xy*weights/max(eventExchange.zw,vec2(1e-9));
 request=vec4(demand,k*.03*eventWetness,0);requestedSpecies=eventSpecies*demand.y;
}
`;
export const applyFragment =
  header +
  `
uniform sampler2D terrain,requests,materials,speciesRequests;
layout(location=0) out vec4 nextTerrain;
layout(location=1) out vec4 acceptance;
layout(location=2) out vec4 nextMaterials;
void main(){
 ivec2 uv=ivec2(gl_FragCoord.xy);vec4 v=texelFetch(terrain,uv,0),r=texelFetch(requests,uv,0),m=texelFetch(materials,uv,0);
 float erosion=min(r.x,v.a*VOXEL_VOLUME);
 float deposition=min(r.y,(1.-v.a)*VOXEL_VOLUME+erosion);
 float solid=clamp(v.a+(deposition-erosion)/VOXEL_VOLUME,0.,1.);
 float d=v.r;if(erosion+deposition>0.)d=BAND*(1.-2.*solid);
 nextTerrain=vec4(d,min(1.,v.g*.995+r.z),v.b+deposition,solid);
 float er=r.x>0.?erosion/r.x:0.,dr=r.y>0.?deposition/r.y:0.;
 acceptance=vec4(er,dr,erosion,deposition);
 nextMaterials=m*max(0.,1.-erosion/max(v.a*VOXEL_VOLUME,1e-10))+texelFetch(speciesRequests,uv,0)*dr;
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
 if(float(uv.y*64+uv.x)>=config.z){nextCargo=old;nextSpecies=mix;return;}
 bool retired=(p.w<0.&&previous.w>=0.)||hit.w>.5;
 if(retired){old.w+=old.x;old.x=0.;mix=vec4(0);}
 vec4 c=texelFetch(contacts,uv,0),e=texelFetch(exchanges,uv,0);vec2 accepted=vec2(0);vec4 newMaterial=vec4(0);
 if(c.w>0.&&e.x+e.y>0.){
  ivec3 center=ivec3(floor((c.xyz-LO)/CELL));
  for(int z=-4;z<=4;z++)for(int y=-4;y<=4;y++)for(int x=-4;x<=4;x++){
   ivec3 q=center+ivec3(x,y,z);if(any(lessThan(q,ivec3(0)))||any(greaterThanEqual(q,DIM)))continue;
   float k=kernel(worldAt(q),c.xyz,c.w);if(k<=0.)continue;
   vec4 ground=voxel(terrain,q);vec2 weights=exchangeWeights(ground,k);
   vec2 amount=e.xy*weights/max(e.zw,vec2(1e-9))*voxel(acceptance,q).xy;
   accepted+=amount;
   vec4 loose=voxel(materials,q)/max(ground.a*VOXEL_VOLUME,1e-10);loose/=max(1.,total(loose));
   vec4 product=loose+rockProduct(kind)*max(0.,1.-total(loose));
   if(kind==5.)product=vec4(0,0,0,1);
   newMaterial+=amount.x*product;
  }
 }
 mix=max(vec4(0),mix+newMaterial-depositedMix(mix)*accepted.y);
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
uniform sampler2D terrain;
out vec4 nextTerrain;
void main(){
 ivec3 q=voxelAt(ivec2(gl_FragCoord.xy));vec4 v=voxel(terrain,q);
 if(v.a>.00001&&v.a<.99999){v.r=BAND*(1.-2.*v.a);nextTerrain=v;return;}
 vec3 a=vec3(min(abs(voxel(terrain,q-ivec3(1,0,0)).r),abs(voxel(terrain,q+ivec3(1,0,0)).r)),min(abs(voxel(terrain,q-ivec3(0,1,0)).r),abs(voxel(terrain,q+ivec3(0,1,0)).r)),min(abs(voxel(terrain,q-ivec3(0,0,1)).r),abs(voxel(terrain,q+ivec3(0,0,1)).r)));
 float value=min(min(a.x+CELL.x,a.y+CELL.y),a.z+CELL.z);
 // Isotropic local Eikonal quadratic, conservative cell spacing approximation.
 float h=min(min(CELL.x,CELL.y),CELL.z);
 if(a.x>a.y){float t=a.x;a.x=a.y;a.y=t;}if(a.y>a.z){float t=a.y;a.y=a.z;a.z=t;}if(a.x>a.y){float t=a.x;a.x=a.y;a.y=t;}
 float t=a.x+h;
 if(t>a.y)t=(a.x+a.y+sqrt(max(0.,2.*h*h-(a.x-a.y)*(a.x-a.y))))*.5;
 if(t>a.z){float sum=a.x+a.y+a.z;t=(sum+sqrt(max(0.,sum*sum-3.*(dot(a,a)-h*h))))/3.;}
 value=min(value,t);v.r=(v.a>=.5?-1.:1.)*max(BAND,value);
 nextTerrain=v;
}
`;
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
 for(int i=0;i<240;i++){if(t>end)return;vec3 p=origin+direction*t;float d=sdf(terrain,p);if(d<.075){hit=vec4(p,1);return;}t+=max(.035,d*.6);}}
`;
export const grainVertex =
  header +
  `
uniform sampler2D terrain,positions,cargo,exchanges,metadata,species;
uniform vec4 eye,target;
uniform float activeCount,visualMode,waterLevel;
out vec4 grainColor;
void main(){
 ivec2 uv=particleUV(gl_VertexID);vec4 p=texelFetch(positions,uv,0),load=texelFetch(cargo,uv,0),event=texelFetch(exchanges,uv,0),meta=texelFetch(metadata,uv,0),s=texelFetch(species,uv,0);
 grainColor=vec4(0);gl_Position=vec4(-2,-2,0,1);gl_PointSize=1.;
 if(float(gl_VertexID)>=activeCount||p.w<0.)return;
 bool plume=visualMode>.5;
 float particulate=s.x+s.y+s.z;
 if(plume&&(particulate<.002||p.y>waterLevel+.5))return;
 vec3 forward=normalize(target.xyz-eye.xyz),right=normalize(cross(forward,vec3(0,1,0))),up=cross(right,forward),rel=p.xyz-eye.xyz;
 float z=dot(rel,forward);if(z<.1)return;
 float lengthRay=length(rel);vec3 ray=rel/lengthRay;float t=0.;
 for(int i=0;i<100;i++){if(t>lengthRay-.25)break;float d=sdf(terrain,eye.xyz+ray*t);if(d<.05)return;t+=clamp(d*.65,.05,2.);}
 if(t<lengthRay-.25)return;
 gl_Position=vec4(dot(rel,right)/(.62*target.w),dot(rel,up)/.62,0,z);
 vec3 material=(s.x*vec3(.85,.59,.26)+s.y*vec3(.46,.44,.32)+s.z*vec3(.58,.52,.44)+s.w*vec3(.74,.55,.94))/max(load.x,.00001);
 vec3 fresh=meta.x==3.?vec3(.9,.78,.43):meta.x==4.?vec3(.67,.62,.55):meta.x==5.?vec3(.65,.52,1.):vec3(.3,.8,1.);
 vec3 color=mix(fresh,material,clamp(load.x*15.,0.,1.));
 if(event.y>event.x&&!plume)color=mix(color,vec3(.53,1.,.45),.5);
 gl_PointSize=plume?clamp(650./z,6.,28.):clamp((100.+log(1.+meta.z)*22.)/z,1.8,10.);
 grainColor=vec4(plume?material:color,plume?min(.22,particulate*2.):.88);
}
`;
export const grainFragment = `#version 300 es
precision highp float;
in vec4 grainColor;
out vec4 color;
void main(){float r=length(gl_PointCoord-.5)*2.;if(r>1.||grainColor.a==0.)discard;color=vec4(grainColor.rgb,grainColor.a*(1.-smoothstep(.15,1.,r)));}`;
