import * as S from "./erosion-shaders.js";
const helpers = `
#define FINE_VOLUME (refineCell*refineCell*refineCell)
#define FINE_BAND (refineCell*.95)
uniform sampler2D fineFields;
vec3 fineWorld(ivec3 q){return LO+(vec3(q)+.5)*refineCell;}
vec4 fineVoxel(sampler2D tex,ivec3 q){if(any(lessThan(q,ivec3(0)))||any(greaterThanEqual(fineWorld(q),HI)))return vec4(1e10,0,0,0);ivec3 b=q/8;int slot=rfSlot(b);return slot<0?vec4(1e10,0,0,0):texelFetch(tex,rfUV(slot,q-b*8),0);}
float fineKernel(vec3 p,vec3 c,float r){float a=max(0.,1.-distance(p,c)/r);return a*a;}
void fineBounds(vec3 c,float r,out ivec3 lo,out ivec3 hi){lo=ivec3(ceil((c-vec3(r)-LO)/refineCell-.5));hi=ivec3(floor((c+vec3(r)-LO)/refineCell-.5));}
vec2 fineWeights(vec4 v,float k){return k*(1.-smoothstep(FINE_BAND,2.*FINE_BAND,abs(v.r)))*vec2(v.a,1.-v.a);}
ivec3 fineAtPixel(ivec2 uv,out int slot){int n=uv.y*int(refineLayout.z)+uv.x;slot=n/512;int local=n%512;return ivec3(texelFetch(refineKeys,rfKeyUV(slot),0).xyz)*8+ivec3(local%8,(local/8)%8,local/64);}
`;
function transform(source, marker) {
  const at = source.indexOf(marker);
  if (at < 0) throw new Error("Missing shared hydraulic shader marker");
  let body = source.slice(at);
  body = body
    .replaceAll("kernelBounds(", "fineBounds(")
    .replaceAll("kernel(", "fineKernel(")
    .replaceAll("worldAt(", "fineWorld(")
    .replaceAll("exchangeWeights(", "fineWeights(")
    .replaceAll("voxel(terrain,q)", "fineVoxel(fineFields,q)")
    .replaceAll("voxel(materials,q)", "fineVoxel(materials,q)")
    .replaceAll("voxel(acceptance,q)", "fineVoxel(acceptance,q)")
    .replaceAll("VOXEL_VOLUME", "FINE_VOLUME")
    .replaceAll("sums.x*FINE_VOLUME*.06", "sums.x*FINE_VOLUME")
    .replaceAll("sums.y*FINE_VOLUME*.06", "sums.y*FINE_VOLUME")
    .replaceAll(
      "atlasSample(materials,c)",
      "fineVoxel(materials,ivec3(floor((c-LO)/refineCell)))",
    );
  return source.slice(0, at) + helpers + body;
}
let event = transform(
  S.eventFragment,
  "layout(location=0) out vec4 contactEvent;",
);
event = event
  .replace("d> .28*sceneScale||d< -.6*sceneScale", "abs(d)>refineCell*1.5")
  .replace(
    "float radius=meta.y,kind=meta.x;",
    "float radius=refineCell*1.5,kind=meta.x;",
  );
const start = event.indexOf("  vec4 model=hydraulic;"),
  end = event.indexOf("\n }\n if(kind>=2.5)", start);
if (start < 0 || end < 0)
  throw new Error("Missing shared hydraulic exchange block");
event =
  event.slice(0, start) +
  `
  vec4 model=hydraulic;model.w=1.;
  float area=max(water,0.)/max(model.y,.001);
  vec4 exchange=waterExchange(speed,1.,dot(mixture.xyz,vec3(1)),config.y*.001,environment.y*strata,loose,area,dt,process,model);
  detach=exchange.x;waterDeposit=exchange.y;capacity=exchange.z;substrateFraction=1.;
` +
  event.slice(end);
event = event
  .replace(
    "layout(location=0) out vec4 contactEvent;",
    "uniform sampler2D refinementStatus;\nlayout(location=0) out vec4 contactEvent;",
  )
  .replace(
    "substrateFraction=1.;\n vec4 p=",
    "substrateFraction=1.;\n vec4 residency=texelFetch(refinementStatus,ivec2(id%256,id/256),0);if(residency.z<.5||residency.y>.5)return;\n vec4 p=",
  );
export const eventFragment = event;
export const cargoFragment = transform(
  S.cargoFragment,
  "layout(location=0) out vec4 nextCargo;",
);
const header = `#version 300 es
precision highp float;precision highp int;precision highp sampler2D;
${S.atlasGLSL}
${helpers}
`;
export const requestFragment =
  header +
  `
uniform sampler2D terrain,positions,metadata;
uniform float carrierCount;
out vec4 point;
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);int id=uv.y*64+uv.x;vec4 p=texelFetch(positions,uv,0);point=vec4(0,0,0,-1);if(id>=int(carrierCount)||p.w<0.||texelFetch(metadata,uv,0).w<0.)return;float d=sdf(terrain,p.xyz);if(abs(d)>refineCell*1.5)return;point=vec4(p.xyz-surfaceNormal(terrain,p.xyz)*d,0);}
`;
export const splatVertex =
  header +
  `
uniform sampler2D contacts,exchanges,species,lifecycle;
flat out vec2 demand;
flat out vec4 materialDemand;
void main(){int id=gl_VertexID/125,j=gl_VertexID%125;gl_PointSize=1.;gl_Position=vec4(-2,-2,0,1);demand=vec2(0);materialDemand=vec4(0);
 vec4 c=texelFetch(contacts,particleUV(id),0),e=texelFetch(exchanges,particleUV(id),0);if(c.w<=0.||e.x+e.y<=0.)return;
 ivec3 q=ivec3(floor((c.xyz-LO)/refineCell))+ivec3(j%5-2,(j/5)%5-2,j/25-2);
 if(any(lessThan(q,ivec3(0)))||any(greaterThanEqual(fineWorld(q),HI)))return;
 int slot=rfSlot(q/8);if(slot<0)return;float k=fineKernel(fineWorld(q),c.xyz,c.w);if(k<=0.)return;
 demand=e.xy*fineWeights(fineVoxel(fineFields,q),k)/max(e.zw,vec2(1e-9));
 vec4 load=texelFetch(species,particleUV(id),0);vec4 fractions=load*(texelFetch(lifecycle,particleUV(id),0).z>.5?vec4(1,1,1,0):vec4(.4,.07,1,0));materialDemand=fractions/max(dot(fractions,vec4(1)),1e-12)*demand.y;
 gl_Position=vec4((vec2(rfUV(slot,q-(q/8)*8))+.5)/refineLayout.zw*2.-1.,0,1);
}`;
export const splatFragment = `#version 300 es
precision highp float;flat in vec2 demand;flat in vec4 materialDemand;
layout(location=0) out vec4 requested;layout(location=1) out vec4 species;
void main(){requested=vec4(demand,0,0);species=materialDemand;}`;
export const applyFragment =
  header +
  `
uniform sampler2D terrain,requests,materials,speciesRequests;
uniform float maxFineChange;
layout(location=0) out vec4 nextField;layout(location=1) out vec4 acceptance;layout(location=2) out vec4 nextMaterial;
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);int slot;ivec3 q=fineAtPixel(uv,slot);vec4 v=texelFetch(fineFields,uv,0),m=texelFetch(materials,uv,0),r=texelFetch(requests,uv,0);nextField=v;nextMaterial=m;acceptance=vec4(0);if(texelFetch(refineKeys,rfKeyUV(slot),0).w<.5)return;
 float base=baseSDF(terrain,fineWorld(q)),floorSolid=clamp(.5-(base+refineLimit)/(2.*FINE_BAND),0.,1.),ceilSolid=clamp(.5-(base-refineLimit)/(2.*FINE_BAND),0.,1.);
 float budget=maxFineChange/(2.*FINE_BAND)*FINE_VOLUME;
 float E=min(r.x,min(max(0.,v.a-floorSolid)*FINE_VOLUME,budget)),D=min(r.y,min(max(0.,ceilSolid-v.a)*FINE_VOLUME,budget));
 float solid=clamp(v.a+(D-E)/FINE_VOLUME,floorSolid,ceilSolid);
 float net=(solid-v.a)*FINE_VOLUME,shared=min(E,D);E=shared+max(0.,-net);D=shared+max(0.,net);
 float er=r.x>0.?E/r.x:0.,dr=r.y>0.?D/r.y:0.;acceptance=vec4(er,dr,E,D);
 nextField=vec4(E+D>0.?FINE_BAND*(1.-2.*solid):v.r,v.g+E,v.b+D,solid);
 nextMaterial=m*max(0.,1.-E/max(dot(m,vec4(1)),1e-12))+texelFetch(speciesRequests,uv,0)*dr;
}`;
export const distanceFragment =
  header +
  `
uniform sampler2D terrain;
out vec4 nextField;
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);int slot;ivec3 q=fineAtPixel(uv,slot);vec4 v=texelFetch(fineFields,uv,0);nextField=v;if(texelFetch(refineKeys,rfKeyUV(slot),0).w<.5)return;
 float changed=v.g+v.b;for(int j=0;j<6;j++){ivec3 offset=ivec3(j/2==0?1:0,j/2==1?1:0,j/2==2?1:0)*(j%2==0?1:-1);vec4 neighbor=fineVoxel(fineFields,q+offset);changed+=neighbor.g+neighbor.b;}if(changed<=0.)return;
 if(v.a>.000001&&v.a<.999999){nextField.r=FINE_BAND*(1.-2.*v.a);return;}
 vec3 a=vec3(min(abs(rfNode(terrain,q-ivec3(1,0,0))),abs(rfNode(terrain,q+ivec3(1,0,0)))),min(abs(rfNode(terrain,q-ivec3(0,1,0))),abs(rfNode(terrain,q+ivec3(0,1,0)))),min(abs(rfNode(terrain,q-ivec3(0,0,1))),abs(rfNode(terrain,q+ivec3(0,0,1)))));
 nextField.r=(v.a>=.5?-1.:1.)*max(FINE_BAND,min(a.x,min(a.y,a.z))+refineCell);
}`;
export const rebaseFragment =
  header +
  `
uniform sampler2D oldBase,newBase,oldMaterial;
layout(location=0) out vec4 nextField;layout(location=1) out vec4 nextMaterial;
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);int slot;vec3 p=fineWorld(fineAtPixel(uv,slot));vec4 v=texelFetch(fineFields,uv,0);nextField=v;nextMaterial=texelFetch(oldMaterial,uv,0);if(texelFetch(refineKeys,rfKeyUV(slot),0).w<.5)return;float previousSolid=v.a,delta=baseSDF(newBase,p)-baseSDF(oldBase,p);if(delta==0.)return;v.r+=delta;v.a=clamp(.5-v.r/(2.*FINE_BAND),0.,1.);nextField=v;nextMaterial*=min(1.,v.a/max(previousSolid,1e-9));}`;
export const copyFragment = `#version 300 es
precision highp float;uniform sampler2D source;out vec4 result;void main(){result=texelFetch(source,ivec2(gl_FragCoord.xy),0);}`;
export const flowVertex = S.splatVertex;
export const flowFragment = `#version 300 es
precision highp float;precision highp int;precision highp sampler2D;
${S.atlasGLSL}
uniform sampler2D terrain;flat in vec4 eventContact,eventFlow;flat in int sliceIndex;
out vec4 flow;
void main(){ivec3 q=voxelAt(ivec2(gl_FragCoord.xy));if(q.z!=sliceIndex)discard;float k=kernel(worldAt(q),eventContact.xyz,eventContact.w);if(k<=0.)discard;flow=eventFlow*k;}`;
export const flowApply = `#version 300 es
precision highp float;uniform sampler2D oldFlow,flowRequests;out vec4 result;
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);vec4 v=texelFetch(oldFlow,uv,0)*.996+texelFetch(flowRequests,uv,0);result=v*min(1.,128./max(v.w,.00001));}`;
export const maskVertex =
  header +
  `
void main(){int slot=gl_VertexID/4,corner=gl_VertexID%4;gl_PointSize=1.;gl_Position=vec4(-2,-2,0,1);vec4 key=texelFetch(refineKeys,rfKeyUV(slot),0);if(key.w<.5)return;
 vec2 side=vec2(corner&1,(corner>>1)&1);vec3 p=LO+vec3(key.x*8.,key.y*8.,key.z*8.)*refineCell;p.xz+=mix(vec2(-refineCell*.5),vec2(refineCell*8.5),side);
 gl_Position=vec4((vec2(rfMaskAt(p))+.5)/128.*2.-1.,0,1);}`;
export const maskFragment = `#version 300 es
precision highp float;out float occupied;void main(){occupied=1.;}`;
