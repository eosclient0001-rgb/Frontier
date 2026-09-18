import { primitiveGLSL } from "./primitives.js";
import { atlasGLSL } from "./erosion-shaders.js";
import { volumeNoiseGLSL } from "./volume-noise.js";
const header = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${atlasGLSL}
${volumeNoiseGLSL}
`;
export const shapeFragment =
  header +
  primitiveGLSL +
  `
uniform sampler2D terrain,materials;
uniform vec4 shapePosition,shapeSize,shapeRotation,shapeDetail,noiseA,noiseB;
layout(location=0) out vec4 nextTerrain;
layout(location=1) out vec4 nextMaterials;
vec2 rotatePair(vec2 p,float a){return vec2(cos(a)*p.x-sin(a)*p.y,sin(a)*p.x+cos(a)*p.y);}
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);vec4 v=texelFetch(terrain,uv,0),m=texelFetch(materials,uv,0);vec3 p=worldAt(voxelAt(uv)),q=p-shapePosition.xyz;
 q.xy=rotatePair(q.xy,-shapeRotation.z);q.zx=rotatePair(q.zx,-shapeRotation.y);q.yz=rotatePair(q.yz,-shapeRotation.x);vec3 noisePoint=q;
 q.y=densityTerrace(q.y,shapeDetail.y,shapeDetail.z);vec3 radius=max(vec3(.4),shapeSize.xyz*.5);float d=densityPrimitive(q,radius,int(shapePosition.w),shapeDetail.x,shapeDetail.w);
 if(noiseA.y>0.)d-=noiseA.y*densityFractal(noisePoint,noiseA,noiseB);
 // Keep a closed object inside the finite volume rather than clipping on its edge.
 vec3 bound=abs(p-vec3(0,8.8,0))-vec3(21.,12.1,19.);d=max(d,max(bound.x,max(bound.y,bound.z)));
 float nextD=min(v.r,d);if(nextD<v.r){v.r=nextD;v.a=clamp(.5-nextD/(2.*BAND),0.,1.);}
 nextTerrain=v;nextMaterials=m;
}
`;
export const detailBrushFragment =
  header +
  `
uniform sampler2D terrain,materials;
uniform vec4 brush,brushDetail,brushShape,brushDirection,noiseA,noiseB;
// detail: operation (1 ridge,2 dent,3 smooth,4 flatten,5 noise), strength, falloff, texture influence.
// shape: aspect along stroke, depth along surface normal, reserved.
layout(location=0) out vec4 nextTerrain;
layout(location=1) out vec4 nextMaterials;
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);vec4 v=texelFetch(terrain,uv,0),m=texelFetch(materials,uv,0);vec3 p=worldAt(voxelAt(uv)),delta=p-brush.xyz;
 if(length(delta)<brush.w*max(brushShape.x,brushShape.y)){
  vec3 n=surfaceNormal(terrain,brush.xyz),t=brushDirection.xyz-n*dot(brushDirection.xyz,n);if(length(t)<.01)t=cross(n,abs(n.y)<.9?vec3(0,1,0):vec3(1,0,0));t=normalize(t);vec3 b=cross(n,t);
  float r=length(vec3(dot(delta,t)/(brush.w*brushShape.x),dot(delta,b)/brush.w,dot(delta,n)/(brush.w*brushShape.y)));
  if(r<1.){float k=pow(max(0.,1.-r*r),brushDetail.z),noise=densityFractal(p,noiseA,noiseB),amount=brushDetail.y*k*max(.05,1.+brushDetail.w*noise),d=v.r;
   if(brushDetail.x<1.5)d-=amount;else if(brushDetail.x<2.5)d+=amount;
   else if(brushDetail.x<3.5){vec3 h=CELL;float avg=(sdf(terrain,p+vec3(h.x,0,0))+sdf(terrain,p-vec3(h.x,0,0))+sdf(terrain,p+vec3(0,h.y,0))+sdf(terrain,p-vec3(0,h.y,0))+sdf(terrain,p+vec3(0,0,h.z))+sdf(terrain,p-vec3(0,0,h.z)))/6.;d=mix(d,avg,clamp(amount,0.,1.));}
   else if(brushDetail.x<4.5)d=mix(d,dot(delta,n),clamp(amount,0.,1.));else d-=brushDetail.y*k*noise;
   float old=v.a;v.r=d;v.a=clamp(.5-d/(2.*BAND),0.,1.);m*=min(1.,v.a/max(old,1e-9));
  }
 }
 nextTerrain=v;nextMaterials=m;
}
`;
