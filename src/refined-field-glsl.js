// Shared by terrain rendering, GPU picks and particle collision. A fixed-size
// sparse XYZ layer; never a heightmap or a screen-space-only erosion effect.
export const refinedFieldGLSL = `
uniform sampler2D refineKeys,refineValues,refineMask;
uniform vec4 refineMaskSize;
uniform vec4 refineLayout;
uniform float refineEnabled,refineCell,refineLimit;
ivec2 rfKeyUV(int slot){int w=int(refineLayout.y);return ivec2(slot%w,slot/w);}
uint rfHash(ivec3 k){uint x=uint(k.x)*73856093u^uint(k.y)*19349663u^uint(k.z)*83492791u;x^=x>>16;x*=0x7feb352du;x^=x>>15;x*=0x846ca68bu;return x^(x>>16);}
int rfSlot(ivec3 k){uint h=rfHash(k),stride=(h>>16)|1u;for(int i=0;i<int(min(32.,refineLayout.x));i++){int slot=int((h+uint(i)*stride)&uint(int(refineLayout.x)-1));vec4 v=texelFetch(refineKeys,rfKeyUV(slot),0);if(v.w<.5)return -1;if(all(equal(ivec3(v.xyz),k)))return slot;}return -1;}
ivec2 rfUV(int slot,ivec3 q){int i=slot*512+(q.z*8+q.y)*8+q.x,w=int(refineLayout.z);return ivec2(i%w,i/w);}
float rfNode(sampler2D base,ivec3 q){vec3 p=LO+(vec3(q)+.5)*refineCell;if(any(lessThan(q,ivec3(0)))||any(greaterThanEqual(p,HI)))return baseSDF(base,p);ivec3 b=q/8;int slot=rfSlot(b);return slot<0?baseSDF(base,p):texelFetch(refineValues,rfUV(slot,q-b*8),0).r;}
ivec2 rfMaskAt(vec3 p){return clamp(ivec2(floor((p.xz-LO.xz)/(HI.xz-LO.xz)*refineMaskSize.xy)),ivec2(0),ivec2(refineMaskSize.xy)-1);}
bool rfColumn(vec3 p){return texelFetch(refineMask,rfMaskAt(p),0).r>.5;}
float refinedDistance(sampler2D base,vec3 p){
 float d=baseSDF(base,p);if(refineEnabled<.5||abs(d)>refineLimit+refineCell*2.||any(lessThan(p,LO))||any(greaterThanEqual(p,HI)))return d;
 if(!rfColumn(p))return d;
 vec3 q=(p-LO)/refineCell-.5;ivec3 i=ivec3(floor(q)),brick=i/8,local=i-brick*8;vec3 f=fract(q);
 bool interior=all(greaterThanEqual(i,ivec3(0)))&&all(lessThan(local,ivec3(7)));
 int slot=interior?rfSlot(brick):-1;if(interior&&slot<0)return d;
 float result=0.;for(int j=0;j<int(min(8.,refineLayout.x));j++){
  ivec3 offset=ivec3(j&1,(j>>1)&1,(j>>2)&1);vec3 weights=mix(vec3(1)-f,f,vec3(offset));
  float value=interior?texelFetch(refineValues,rfUV(slot,local+offset),0).r:rfNode(base,i+offset);
  result+=value*weights.x*weights.y*weights.z;
 }return result;
}
// Fine deposition can protrude outside the coarse surface. Do not let a
// coarse sphere-tracing step jump over the entire refined displacement band.
float refinedStep(sampler2D base,vec3 p,float d){return refineEnabled<.5?d*.55:max(.002,min(d*.28,max(refineCell*.2,baseSDF(base,p)-refineLimit-refineCell*2.)));}
float refinedRayStep(sampler2D base,vec3 p,vec3 direction,float d){
 if(refineEnabled<.5)return d*.55;
 if(rfColumn(p))return refinedStep(base,p,d);
 vec2 cellSize=(HI.xz-LO.xz)/refineMaskSize.xy,cell=floor((p.xz-LO.xz)/cellSize);
 vec2 edge=LO.xz+(cell+step(vec2(0),direction.xz))*cellSize;
 vec2 travel=vec2(abs(direction.x)>1e-8?(edge.x-p.x)/direction.x:1e10,abs(direction.z)>1e-8?(edge.y-p.z)/direction.z:1e10);
 return max(.002,min(d*.55,min(travel.x,travel.y)+.002));
}
`;
