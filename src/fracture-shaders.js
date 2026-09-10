import { cellDisplayGLSL } from "./cell-fracture-shaders.js";
import { atlasGLSL } from "./erosion-shaders.js";
const header = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${atlasGLSL}
`;
export const copyFragment =
  header +
  `
uniform sampler2D terrain,materials;
layout(location=0) out vec4 nextTerrain;
layout(location=1) out vec4 nextMaterials;
void main(){ivec2 q=ivec2(gl_FragCoord.xy);nextTerrain=texelFetch(terrain,q,0);nextMaterials=texelFetch(materials,q,0);}
`;
export const cutFragment =
  header +
  `
uniform sampler2D terrain,materials;
uniform vec4 cutCenter,cutU,cutV;
layout(location=0) out vec4 nextTerrain;
layout(location=1) out vec4 nextMaterials;
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);vec4 v=texelFetch(terrain,uv,0),m=texelFetch(materials,uv,0);vec3 r=worldAt(voxelAt(uv))-cutCenter.xyz;
 vec3 q=abs(vec3(dot(r,cutU.xyz),dot(r,cutV.xyz),dot(r,cross(cutU.xyz,cutV.xyz))))-vec3(cutU.w,cutV.w,cutCenter.w*.5);
 float cut=length(max(q,vec3(0)))+min(max(max(q.x,q.y),q.z),0.);
 float d=max(v.r,-cut),a=v.a;if(d>v.r){v.r=d;v.a=clamp(.5-d/(2.*BAND),0.,1.);m*=min(1.,v.a/max(a,1e-9));}
 nextTerrain=v;nextMaterials=m;}
`;
export const deleteFragment =
  header +
  `
uniform sampler2D terrain,materials,chunkMask;
layout(location=0) out vec4 nextTerrain;
layout(location=1) out vec4 nextMaterials;
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);vec4 v=texelFetch(terrain,uv,0),m=texelFetch(materials,uv,0);
 if(texelFetch(chunkMask,uv,0).r>.3){v=vec4(max(.65,abs(v.r)),0,v.b,0);m=vec4(0);}
 nextTerrain=v;nextMaterials=m;}
`;
// Visual hairlines are deliberately NOT in field()/collision/picking. Negative
// width is a pending guide; positive width is committed sub-voxel detail.
export const displayGLSL =
  cellDisplayGLSL +
  `
uniform int fractureCount,chunkSelected;
uniform vec4 fractureCenter[24],fractureU[24],fractureV[24];
uniform sampler2D chunkMask;
vec3 fractureColor(vec3 p,vec3 color){
 for(int i=0;i<24;i++){if(i>=fractureCount)break;
  vec3 r=p-fractureCenter[i].xyz;float a=abs(dot(r,fractureU[i].xyz)),b=abs(dot(r,fractureV[i].xyz));
  float d=abs(dot(r,cross(fractureU[i].xyz,fractureV[i].xyz)));
  float width=fractureCenter[i].w;
  if(a>fractureU[i].w||b>fractureV[i].w)continue;
  if(width<0.){float band=1.-smoothstep(-width*.5,-width*.5+.12,d);color=mix(color,vec3(.24,.75,.68),band*.55);}
  else {float aa=max(.002,fwidth(d));float ink=(1.-smoothstep(max(0.,width*.5-aa),width*.5+aa,d))*min(1.,width/max(aa,.002));color=mix(color,color*.12,ink*.9);}
 }
 color=cellPatternColor(p,color);
 if(chunkSelected==1){float selected=atlasSample(chunkMask,p).r; color=mix(color,vec3(1.,.42,.09),smoothstep(.12,.6,selected)*.65);}
 return color;
}
`;
