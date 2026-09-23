import { atlasGLSL, fullscreenVertex } from './erosion-shaders.js';
export { fullscreenVertex };
// Sparse allocation/storage primitives; live exchange is in fine-hydraulic-shaders.js.
export const sparseHeader = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${atlasGLSL}
uniform sampler2D baseTerrain,sparseKeys,sparseValues;
uniform vec4 sparseLayout; // capacity, key width, value atlas width/height
uniform float sparseCell;
ivec2 keyUV(int slot){int w=int(sparseLayout.y);return ivec2(slot%w,slot/w);}
uint sparseHash(ivec3 k){uint x=uint(k.x)*73856093u^uint(k.y)*19349663u^uint(k.z)*83492791u;x^=x>>16;x*=0x7feb352du;x^=x>>15;x*=0x846ca68bu;return x^(x>>16);}
int probe(ivec3 k,int attempt){uint h=sparseHash(k),stride=(h>>16)|1u;return int((h+uint(attempt)*stride)&uint(int(sparseLayout.x)-1));}
bool inDomain(vec3 p){return all(greaterThanEqual(p,LO))&&all(lessThan(p,HI));}
int findSlot(ivec3 k){
 for(int i=0;i<32;i++){int slot=probe(k,i);vec4 entry=texelFetch(sparseKeys,keyUV(slot),0);if(entry.w<.5)return -1;if(all(equal(ivec3(entry.xyz),k)))return slot;}
 return -1;
}
ivec2 valueUV(int slot,ivec3 local){int i=slot*512+(local.z*8+local.y)*8+local.x,w=int(sparseLayout.z);return ivec2(i%w,i/w);}
vec3 nodeWorld(ivec3 q){return LO+(vec3(q)+.5)*sparseCell;}
float sparseNode(ivec3 q){
 vec3 p=nodeWorld(q);if(!inDomain(p))return sdf(baseTerrain,p);
 ivec3 brick=q/8,local=q-brick*8;int slot=findSlot(brick);
 return slot<0?sdf(baseTerrain,p):texelFetch(sparseValues,valueUV(slot,local),0).r;
}
float refinedSDF(vec3 p){
 if(!inDomain(p))return sdf(baseTerrain,p);
 vec3 q=(p-LO)/sparseCell-.5;ivec3 i=ivec3(floor(q));vec3 f=fract(q);
 return mix(mix(mix(sparseNode(i),sparseNode(i+ivec3(1,0,0)),f.x),mix(sparseNode(i+ivec3(0,1,0)),sparseNode(i+ivec3(1,1,0)),f.x),f.y),mix(mix(sparseNode(i+ivec3(0,0,1)),sparseNode(i+ivec3(1,0,1)),f.x),mix(sparseNode(i+ivec3(0,1,1)),sparseNode(i+ivec3(1,1,1)),f.x),f.y),f.z);
}
vec3 physicalNode(ivec2 uv,out int slot){int linear=uv.y*int(sparseLayout.z)+uv.x;slot=linear/512;int local=linear%512;ivec3 q=ivec3(local%8,(local/8)%8,local/64);return nodeWorld(ivec3(texelFetch(sparseKeys,keyUV(slot),0).xyz)*8+q);}
`;
const requests = `
uniform sampler2D requestPoints,claimHigh,claimLow;
uniform vec4 requestConfig; // input width, height, count, world-space halo radius
vec4 requestPoint(int id){int w=int(requestConfig.x);return texelFetch(requestPoints,ivec2(id%w,id/w),0);}
vec3 requestWorld(int linear){vec3 signCorner=vec3((linear&1)==0?-1.:1.,(linear&2)==0?-1.:1.,(linear&4)==0?-1.:1.);return requestPoint(linear/8).xyz+signCorner*requestConfig.w;}
ivec3 requestKey(int linear){return ivec3(floor((requestWorld(linear)-LO)/(sparseCell*8.)));}
int freeSlot(int linear){
 if(requestPoint(linear/8).w<0.||!inDomain(requestWorld(linear)))return -1;
 ivec3 k=requestKey(linear);
 for(int i=0;i<32;i++){int slot=probe(k,i);vec4 old=texelFetch(sparseKeys,keyUV(slot),0);if(old.w<.5)return slot;if(all(equal(ivec3(old.xyz),k)))return -1;}
 return -1;
}
`;
export const claimHighVertex = sparseHeader + requests + `
flat out float code;
void main(){int id=gl_VertexID,slot=freeSlot(id);code=0.;gl_PointSize=1.;gl_Position=vec4(-2,-2,0,1);if(slot<0)return;code=float(id/2048+1);gl_Position=vec4((vec2(keyUV(slot))+.5)/vec2(sparseLayout.y,sparseLayout.x/sparseLayout.y)*2.-1.,0,1);}
`;
export const claimLowVertex = claimHighVertex.replace(
  'code=float(id/2048+1);',
  'if(int(texelFetch(claimHigh,keyUV(slot),0).r)!=id/2048+1)return;code=float(id%2048+1);',
);
export const claimFragment = `#version 300 es
precision highp float;
flat in float code;out float value;void main(){value=code;}`;
export const allocateFragment = sparseHeader + requests + `
out vec4 nextKey;
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);nextKey=texelFetch(sparseKeys,uv,0);if(nextKey.w>.5)return;int high=int(texelFetch(claimHigh,uv,0).r),low=int(texelFetch(claimLow,uv,0).r);if(high>0&&low>0)nextKey=vec4(vec3(requestKey((high-1)*2048+low-1)),1);}
`;
export const initializeFragment = sparseHeader + `
uniform sampler2D oldKeys;
out vec4 nextValue;
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);int slot;vec3 p=physicalNode(uv,slot);nextValue=texelFetch(sparseValues,uv,0);if(texelFetch(sparseKeys,keyUV(slot),0).w<.5)return;if(texelFetch(oldKeys,keyUV(slot),0).w>.5)return;float d=baseSDF(baseTerrain,p);nextValue=vec4(d,0,0,clamp(.5-d/(1.9*sparseCell),0.,1.));}
`;
export const statusFragment = sparseHeader + requests + `
out vec4 status;
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);int id=uv.y*256+uv.x;status=vec4(0);if(id>=int(requestConfig.z)||requestPoint(id).w<0.)return;float valid=0.,resident=0.;for(int k=0;k<8;k++){if(!inDomain(requestWorld(id*8+k)))continue;valid++;if(findSlot(requestKey(id*8+k))>=0)resident++;}status=vec4(resident,valid-resident,valid,1);}
`;
// A CSG reference operation for validating storage and narrow geometry. This is
// NOT the hydraulic exchange implementation, and is never used as fake rain.
export const carveFragment = sparseHeader + `
uniform vec4 cutSphere;
bool completeCut(){for(int i=0;i<8;i++){vec3 signCorner=vec3((i&1)==0?-1.:1.,(i&2)==0?-1.:1.,(i&4)==0?-1.:1.);vec3 p=cutSphere.xyz+signCorner*cutSphere.w;if(!inDomain(p)||findSlot(ivec3(floor((p-LO)/(sparseCell*8.))))<0)return false;}return true;}
out vec4 nextValue;
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);int slot;vec3 p=physicalNode(uv,slot);nextValue=texelFetch(sparseValues,uv,0);if(texelFetch(sparseKeys,keyUV(slot),0).w<.5||!completeCut())return;float d=max(nextValue.r,cutSphere.w-distance(p,cutSphere.xyz));float solid=clamp(.5-d/(1.9*sparseCell),0.,1.);nextValue.g+=max(0.,nextValue.a-solid)*pow(sparseCell,3.);nextValue.r=d;nextValue.a=solid;}
`;
export const queryFragment = sparseHeader + `
uniform sampler2D queryPoints;
out vec4 value;
void main(){vec3 p=texelFetch(queryPoints,ivec2(gl_FragCoord.xy),0).xyz;value=vec4(refinedSDF(p),sdf(baseTerrain,p),0,1);}
`;
