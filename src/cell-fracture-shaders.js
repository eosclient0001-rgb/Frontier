import { atlasGLSL } from "./erosion-shaders.js";
export const cellCommonGLSL = `
uniform sampler2D cellPatterns;
vec4 patternValue(int col,int row){return texelFetch(cellPatterns,ivec2(col,row),0);}
float paintedRegion(vec3 p,int row,int count){float d=1e5;
 for(int i=0;i<24;i++){if(i>=count)break;vec4 a=patternValue(65+i,row);vec3 b=patternValue(89+i,row).xyz,ab=b-a.xyz,ap=p-a.xyz;
 float t=clamp(dot(ap,ab)/max(dot(ab,ab),1e-8),0.,1.);d=min(d,length(ap-ab*t)-a.w);}return d;
}
vec2 voronoiFace(vec3 p,int row,int count){float best=1e20;int nearest=0;
 for(int i=0;i<64;i++){if(i>=count)break;vec3 r=p-patternValue(i+1,row).xyz;float d=dot(r,r);if(d<best){best=d;nearest=i;}}
 vec3 center=patternValue(nearest+1,row).xyz;float face=1e10;
 for(int i=0;i<64;i++){if(i>=count)break;if(i==nearest)continue;vec3 s=patternValue(i+1,row).xyz,r=p-s;face=min(face,(dot(r,r)-best)/max(2.*length(s-center),1e-8));}
 return vec2(float(nearest),max(0.,face));
}
`;
export const cellDisplayGLSL =
  cellCommonGLSL +
  `
vec3 cellPatternColor(vec3 p,vec3 color){
 for(int row=0;row<2;row++){
  vec4 meta=patternValue(0,row);if(meta.x<2.)continue;
  float region=paintedRegion(p,row,int(meta.y));if(region>meta.z*.5+.1)continue;
  vec2 cell=voronoiFace(p,row,int(meta.x));float edge=cell.y;
  if(meta.w>.5)edge=min(edge,abs(region));
  if(row==0){
   float tone=fract(sin((cell.x+1.)*17.13)*43758.5453);
   vec3 tint=mix(vec3(.17,.49,.40),vec3(.57,.66,.27),tone);
   if(region<0.)color=mix(color,tint,.40);
   float aa=max(.025,fwidth(edge));float crack=1.-smoothstep(meta.z*.5-aa,meta.z*.5+aa,edge);
   if(region<=0.||meta.w>.5)color=mix(color,vec3(.1,.82,.77),crack*.85);
  }else if(region<0.){
   float aa=max(.002,fwidth(edge));
   // Intact labels need a readable hairline even below one pixel. This is
   // coverage only: it never enters the distance field or collision volume.
   float coverage=min(1.,meta.z/max(aa,.002));
   if(patternValue(1,row).w>.5)coverage=max(coverage,.65);
   float ink=(1.-smoothstep(max(0.,meta.z*.5-aa),meta.z*.5+aa,edge))*coverage;
   color=mix(color,color*.1,ink*.95);
  }
 }return color;
}
`;
export const cellCutFragment = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
${atlasGLSL}
${cellCommonGLSL}
uniform sampler2D terrain,materials;
layout(location=0) out vec4 nextTerrain;
layout(location=1) out vec4 nextMaterials;
void main(){ivec2 uv=ivec2(gl_FragCoord.xy);vec4 v=texelFetch(terrain,uv,0),m=texelFetch(materials,uv,0),meta=patternValue(0,0);
 nextTerrain=v;nextMaterials=m;if(meta.x<2.)return;
 vec3 p=worldAt(voxelAt(uv));float r=paintedRegion(p,0,int(meta.y)),h=meta.z*.5;
 if(r>h)return;
 float cut=min(h-voronoiFace(p,0,int(meta.x)).y,-r);
 if(meta.w>.5)cut=max(cut,h-abs(r));
 float d=max(v.r,cut);if(d>v.r){float old=v.a;v.r=d;v.a=clamp(.5-d/(2.*BAND),0.,1.);m*=min(1.,v.a/max(old,1e-9));}
 nextTerrain=v;nextMaterials=m;
}
`;
