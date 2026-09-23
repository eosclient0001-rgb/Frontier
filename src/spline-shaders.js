import { atlasGLSL } from "./erosion-shaders.js";
const header = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${atlasGLSL}
`;
export const pathCutFragment =
  header +
  `
uniform sampler2D terrain,materials,pathPoints;
uniform vec4 pathSettings; // segments, width, depth, bank slope
layout(location=0) out vec4 nextTerrain;
layout(location=1) out vec4 nextMaterials;
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);vec4 v=texelFetch(terrain,uv,0),m=texelFetch(materials,uv,0);vec3 p=worldAt(voxelAt(uv));float cutter=1e5;
 for(int i=0;i<32;i++){if(i>=int(pathSettings.x))break;vec3 a=texelFetch(pathPoints,ivec2(i,0),0).xyz,b=texelFetch(pathPoints,ivec2(i+1,0),0).xyz;vec2 ab=b.xz-a.xz;if(dot(ab,ab)<1e-8)continue;float t=clamp(dot(p.xz-a.xz,ab)/max(dot(ab,ab),1e-8),0.,1.);vec3 q=mix(a,b,t);float bed=q.y-pathSettings.z,slope=pathSettings.w;
 float d=max((length(p.xz-q.xz)-pathSettings.y*.5-max(0.,p.y-bed)*slope)/sqrt(1.+slope*slope),bed-p.y);cutter=min(cutter,d);}
 float d=max(v.r,-cutter);if(d>v.r){float old=v.a;v.r=d;v.a=clamp(.5-d/(2.*BAND),0.,1.);m*=min(1.,v.a/max(old,1e-9));}nextTerrain=v;nextMaterials=m;
}
`;
export const heightBrushFragment =
  header +
  `
uniform sampler2D terrain,materials;
uniform vec4 brush,heightSettings;
layout(location=0) out vec4 nextTerrain;
layout(location=1) out vec4 nextMaterials;
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);vec3 p=worldAt(voxelAt(uv));vec4 v=texelFetch(terrain,uv,0),m=texelFetch(materials,uv,0);float r=length(p.xz-brush.xz)/brush.w;
 if(r<1.){float falloff=pow(1.-r*r,2.)*(1.-smoothstep(brush.w*.6,brush.w*1.5,abs(p.y-brush.y)));vec3 source=p-vec3(0,heightSettings.x*heightSettings.y*falloff,0);vec4 sampled=atlasSample(terrain,source);v=sampled;v.a=clamp(.5-v.r/(2.*BAND),0.,1.);m=atlasSample(materials,source)*min(1.,v.a/max(sampled.a,1e-9));}
 nextTerrain=v;nextMaterials=m;
}
`;
