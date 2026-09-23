import { atlasGLSL, fullscreenVertex } from "./erosion-shaders.js";
export { fullscreenVertex };
const header = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${atlasGLSL}
uniform sampler2D positions,velocities,metadata,lifecycle,terrain,buckets,bucketHigh,proposals,claimsRain,claimsRunoff;
uniform float carrierCount,transferTick;
ivec2 bucketAt(vec3 p){return clamp(ivec2(floor((p.xz-LO.xz)/(HI.xz-LO.xz)*128.)),ivec2(0),ivec2(127));}
int cohort(){return int(transferTick)%8;}
bool waterCarrier(int id){vec4 p=texelFetch(positions,particleUV(id),0),m=texelFetch(metadata,particleUV(id),0),l=texelFetch(lifecycle,particleUV(id),0);return p.w>=0.&&m.x<=2.&&m.w>=0.&&l.z<.5&&texelFetch(velocities,particleUV(id),0).w>(m.x<.5?1e-12:.015);}
int owner(ivec2 b){if(any(lessThan(b,ivec2(0)))||any(greaterThan(b,ivec2(127))))return -1;int code=int(texelFetch(buckets,b,0).r),high=int(texelFetch(bucketHigh,b,0).r);return code>0&&high>0?(high-1)*2048+code-1:-1;}
bool nearCarrier(vec3 p,int id,float kind){
 if(id<0||id>=int(carrierCount)||!waterCarrier(id))return false;
 if((kind<.5)!=(texelFetch(metadata,particleUV(id),0).x<.5))return false; // Never mix physical m³ with legacy runoff weights.
 vec3 q=texelFetch(positions,particleUV(id),0).xyz;
 return distance(p,q)<=(refineEnabled>.5?refineCell:max(CELL.x,CELL.z))*1.5&&abs(p.y-q.y)<=max(CELL.y,max(CELL.x,CELL.z)*.75)&&sdf(terrain,(p+q)*.5)>-min(CELL.x,min(CELL.y,CELL.z))*.3;
}
uint mixBits(uint x){x^=x>>16;x*=0x7feb352du;x^=x>>15;x*=0x846ca68bu;return x^(x>>16);}
int recipient(int id){return int(abs(texelFetch(proposals,particleUV(id),0).r))-1;}
int winner(int target){
 float r=texelFetch(claimsRain,particleUV(target),0).r;
 if(r>.5)return RAIN_START+int(r)-1;
 float c=texelFetch(claimsRunoff,particleUV(target),0).r;
 return c>.5?(int(c)-1)*8+cohort():-1;
}
bool accepted(int id){int target=recipient(id);return target>=0&&winner(target)==id;}
`;
export const bucketHighVertex =
  header +
  `
flat out float code;
void main(){int id=gl_VertexID;gl_PointSize=1.;gl_Position=vec4(-2,-2,0,1);code=0.;if(!waterCarrier(id))return;code=float(id/2048+1);gl_Position=vec4((vec2(bucketAt(texelFetch(positions,particleUV(id),0).xyz))+.5)/128.*2.-1.,0,1);}
`;
export const bucketVertex =
  header +
  `
flat out float code;
void main(){int id=gl_VertexID;gl_PointSize=1.;gl_Position=vec4(-2,-2,0,1);code=0.;if(!waterCarrier(id))return;ivec2 b=bucketAt(texelFetch(positions,particleUV(id),0).xyz);if(int(texelFetch(bucketHigh,b,0).r)!=id/2048+1)return;code=float(id%2048+1);gl_Position=vec4((vec2(b)+.5)/128.*2.-1.,0,1);}
`;
export const bucketFragment = `#version 300 es
precision highp float;
flat in float code;out float value;void main(){value=code;}`;
export const proposalFragment =
  header +
  `
out float proposal;
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);int id=uv.y*64+uv.x;proposal=0.;if((id>=int(carrierCount)&&id<RAIN_START)||!waterCarrier(id))return;
 vec3 p=texelFetch(positions,uv,0).xyz;ivec2 b=bucketAt(p);
 if(id<RAIN_START){if(id%8!=cohort())return;int target=owner(b);if(target>id&&nearCarrier(p,target,texelFetch(metadata,uv,0).x))proposal=-float(target+1);return;}
 // Prefer a nearby stable canonical parcel; never merge across distant terrain.
 int best=-1;float distanceBest=1e30;
 for(int z=-1;z<=1;z++)for(int x=-1;x<=1;x++){int target=owner(b+ivec2(x,z));if(!nearCarrier(p,target,texelFetch(metadata,uv,0).x))continue;float d=distance(p,texelFetch(positions,particleUV(target),0).xyz);if(d<distanceBest){best=target;distanceBest=d;}}
 if(best>=0){proposal=-float(best+1);return;}
 // Bounded free-slot search. Contenders are arbitrated before anyone moves.
 uint seed=mixBits(uint(id)^mixBits(uint(transferTick)));
 for(int k=0;k<32;k++){seed=mixBits(seed+0x9e3779b9u);int target=int(seed%uint(max(1.,carrierCount)));if(texelFetch(positions,particleUV(target),0).w<0.){proposal=float(target+1);return;}}
}
`;
export const claimVertex =
  header +
  `
flat out vec2 codes;
void main(){int linear=gl_VertexID,id=linear<int(carrierCount)?linear:RAIN_START+linear-int(carrierCount);int target=recipient(id);codes=vec2(0);gl_PointSize=1.;gl_Position=vec4(-2,-2,0,1);if(target<0)return;
 codes=id>=RAIN_START?vec2(float(id-RAIN_START+1),0):vec2(0,float(id/8+1));
 gl_Position=vec4((vec2(particleUV(target))+.5)/vec2(64,256)*2.-1.,0,1);}
`;
export const claimFragment = `#version 300 es
precision highp float;
flat in vec2 codes;layout(location=0) out float rain;layout(location=1) out float runoff;
void main(){rain=codes.x;runoff=codes.y;}`;
export const transferMotionFragment =
  header +
  `
layout(location=0) out vec4 nextPosition;
layout(location=1) out vec4 nextVelocity;
layout(location=2) out vec4 nextMetadata;
layout(location=3) out vec4 nextLife;
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);int id=uv.y*64+uv.x;
 nextPosition=texelFetch(positions,uv,0);nextVelocity=texelFetch(velocities,uv,0);nextMetadata=texelFetch(metadata,uv,0);nextLife=texelFetch(lifecycle,uv,0);
 if(id>=int(carrierCount)&&id<RAIN_START)return;
 if(accepted(id)){nextPosition.w=-1.;nextVelocity=vec4(0);nextLife=vec4(0,0,2,0);return;}
 if(id>=RAIN_START)return;int source=winner(id);if(source<0)return;ivec2 from=particleUV(source);
 vec4 p=texelFetch(positions,from,0),v=texelFetch(velocities,from,0),m=texelFetch(metadata,from,0),l=texelFetch(lifecycle,from,0);
 if(texelFetch(proposals,from,0).r>0.){nextPosition=p;nextVelocity=v;nextMetadata=m;nextMetadata.x=max(0.,m.x);nextLife=l;}
 else{float water=nextVelocity.w+v.w;nextVelocity.xyz=(nextVelocity.xyz*nextVelocity.w+v.xyz*v.w)/max(water,1e-9);nextVelocity.w=water;nextLife.x=min(nextLife.x,l.x);nextLife.y=min(nextLife.y,l.y);nextLife.w=min(nextLife.w,l.w);}
}
`;
export const transferCargoFragment =
  header +
  `
uniform sampler2D cargo,species;
layout(location=0) out vec4 nextCargo;
layout(location=1) out vec4 nextSpecies;
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);int id=uv.y*64+uv.x;nextCargo=texelFetch(cargo,uv,0);nextSpecies=texelFetch(species,uv,0);
 if(id>=int(carrierCount)&&id<RAIN_START)return;
 if(accepted(id)){nextCargo=vec4(0);nextSpecies=vec4(0);return;}
 if(id>=RAIN_START)return;int source=winner(id);if(source<0)return;
 nextCargo+=texelFetch(cargo,particleUV(source),0);nextSpecies+=texelFetch(species,particleUV(source),0);
}
`;
