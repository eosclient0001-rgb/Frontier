import { domainGLSL } from "./domain.js";
import { MIN, MAX, glslVec } from "./domain.js";
import { satmapGLSL } from "./satmaps.js";
import { waterGLSL } from "./water-shader.js";
import { viewportLoopGLSL } from "./viewport-loops.js";
export { viewportUniforms } from "./viewport-loops.js";
export const vertexGLSL = `#version 300 es
precision highp float;
out vec2 vUv;
void main(){vec2 p=vec2((gl_VertexID<<1)&2,gl_VertexID&2);vUv=p*2.-1.;gl_Position=vec4(vUv,0,1);}`;

export const fragmentGLSL = /* glsl */ `#version 300 es
precision highp float;
precision highp sampler3D;
uniform sampler3D volume;
uniform vec4 eye,target,viewport,light,surface,brush,extra;
uniform float terrainShown;
${viewportLoopGLSL}
#ifdef VIEWPORT_COMPOSITE
uniform highp sampler2D opaqueFrame;
#endif
in vec2 vUv;
out vec4 fragColor;
${domainGLSL}
#define low LO
#define high HI
float detailWeight(vec3 p){return 1.;}
vec3 worldPoint(vec3 p){return p;}
const float worldEnabled=0.;
#define worldLow LO
#define worldHigh HI
float field(vec3 p){vec3 uv=(p-low)/(high-low);return textureLod(volume,clamp(uv,vec3(.0001),vec3(.9999)),0.).x+length(max(max(low-p,p-high),vec3(0)));}
float hash(vec3 p){vec3 q=fract(p*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
vec3 normalAt(vec3 p){float e=.13*sceneScale;return normalize(vec3(field(p+vec3(e,0,0))-field(p-vec3(e,0,0)),field(p+vec3(0,e,0))-field(p-vec3(0,e,0)),field(p+vec3(0,0,e))-field(p-vec3(0,0,e))));}
vec3 materialNormal(vec3 p,vec3 n){vec3 q=p*5.,g=vec3(0);float e=.12;
 for(int axis=0;axis<viewportLimit(sampleLoopLimits.x,3);axis++){vec3 offset=vec3(0);offset[axis]=e;g[axis]=noise(q+offset)-noise(q-offset);}
 g/=.24;return normalize(n-(g-n*dot(n,g))*surface.y*.72);}

vec2 boxRange(vec3 ro,vec3 rd){vec3 lo=low,hi=high;vec3 a=(lo-ro)/rd,b=(hi-ro)/rd,n=min(a,b),f=max(a,b);return vec2(max(max(n.x,n.y),n.z),min(min(f.x,f.y),f.z));}
float trace(vec3 ro,vec3 rd){
 vec2 range=boxRange(ro,rd);float t=max(0.,range.x);if(t>range.y)return 1e6;
 for(int i=0;i<viewportLimit(renderLoopLimits.x,360);i++){
  vec3 p=ro+rd*t;float d=field(p);if(d<max(.04*sceneScale,t*.00008))return t;
  float stepSize=max(.02*sceneScale,d*.55);
  t+=stepSize;if(t>range.y)break;
 }return 1e6;
}
float shadow(vec3 p,vec3 l){if(terrainShown<.5)return 1.;float t=.18*sceneScale,s=1.;for(int i=0;i<viewportLimit(renderLoopLimits.y,32);i++){float h=field(p+l*t);s=min(s,9.*h/t);t+=clamp(h,.16*sceneScale,1.6*sceneScale);if(h<.04*sceneScale||t>29.*sceneScale)break;}return clamp(s,0.,1.);}
float ambient(vec3 p,vec3 n){float a=0.,w=1.;for(int i=1;i<=viewportLimit(renderLoopLimits.z,4);i++){float h=float(i)*.48*sceneScale;a+=(h-field(p+n*h))*w/sceneScale;w*=.55;}return clamp(1.-a*.38,.25,1.);}
#define WORLD_MATERIAL
${satmapGLSL}
vec3 rockColor(vec3 p,vec3 n){float grain=noise(p*8.),broadNoise=noise(p*.43)+.45*noise(p*1.8),bedding=p.y+noise(vec3(p.x*.12,0,p.z*.12))*.4,bands=.5+.5*sin(bedding*3.4+.4*sin(bedding*1.1)),thin=pow(.5+.5*sin(bedding*17.+noise(p*2.)*1.7),12.);vec3 c=mix(vec3(.37,.135,.064),vec3(.72,.33,.14),.37+broadNoise*.31);c=mix(c,c*vec3(.74,.70,.65),bands*surface.x*.35);c*=1.-thin*.20*surface.x;c+=vec3(.055,.04,.028)*(grain-.5)*surface.y;float top=smoothstep(.55,.96,n.y);c=mix(c,vec3(.64,.37,.185)*(.9+broadNoise*.12),top*.67);float streak=noise(vec3(p.x*3.3,p.y*.13,p.z*3.3));c*=.79+.28*streak;
 float fractures=pow(1.-abs(noise(p*vec3(2.8,.24,2.8))*2.-1.),18.);c*=1.-fractures*.22*surface.y;if(extra.y>3.5)c=mix(vec3(.25,.27,.255),vec3(.48,.455,.40),clamp(.25+broadNoise*.35+top*.1,0.,1.))*(.86+.15*streak)+vec3((grain-.5)*.025);c=satMaterial(p,n,c);if(extra.x>.5)c=vec3(.58,.55,.47);return c;}
vec3 sky(vec3 rd){return mix(vec3(.012),vec3(.005),smoothstep(-.1,.8,rd.y));}
#ifndef VIEWPORT_SOLID
${waterGLSL}
#endif
void main(){
 vec2 uv=vUv;vec3 forward=normalize(target.xyz-eye.xyz),right=normalize(cross(forward,vec3(0,1,0))),up=cross(right,forward),rd=normalize(forward+right*uv.x*target.w*.62+up*uv.y*.62),ro=eye.xyz;
 float angle=light.x*.0174533;vec3 sun=normalize(vec3(cos(angle),.85,sin(angle)));
 #ifndef VIEWPORT_COMPOSITE
 float t=terrainShown>.5?trace(ro,rd):1e6,floorT=(low.y-ro.y)/rd.y;vec3 color=sky(rd);bool hit=false;
 if(t<999999.){hit=true;vec3 p=ro+rd*t,geo=normalAt(p),n=materialNormal(p,geo);float sh=shadow(p+geo*.17,sun),ao=ambient(p,geo),diffuse=max(dot(n,sun),0.);vec3 bounce=max(-n.y,0.)*vec3(.13,.075,.035);vec3 albedo=rockColor(p,geo);color=albedo*(vec3(.25,.28,.27)*ao+vec3(1.05,.91,.70)*diffuse*sh+bounce);color+=albedo*pow(1.-max(dot(n,-rd),0.),3.)*.09;
 if(satControl.x>.5&&satControl.z>.5)color=satDiagnostic(p,geo);
 if(brush.w>0.){float d=distance(p,brush.xyz),ring=1.-smoothstep(.04*sceneScale,.12*sceneScale,abs(d-brush.w));color=mix(color,vec3(1.,.62,.28),ring*.8);color+=vec3(.07,.025,.006)*(1.-smoothstep(0.,brush.w,d));}}
 else if(floorT>0.){t=floorT;hit=false;vec3 p=ro+rd*t;float tex=noise(p*2.)*.025+noise(p*.15)*.045,sh=shadow(p+vec3(0,.12,0),sun);color=(vec3(.012)+tex*.035)*(.56+.44*sh);float grid=min(abs(fract(p.x*.1+.5)-.5),abs(fract(p.z*.1+.5)-.5)),outside=smoothstep(18.,26.,max(abs(p.x),abs(p.z)));color*=1.-(1.-smoothstep(.001,.012,grid))*.09*outside;}
 #else
 vec4 opaque=texelFetch(opaqueFrame,ivec2(gl_FragCoord.xy),0);
 float t=abs(opaque.a);vec3 color=opaque.rgb;bool hit=opaque.a>=0.&&t<999999.;
 #endif
 #ifdef VIEWPORT_SOLID
 // Positive distance denotes terrain; negative distance denotes floor/sky.
 fragColor=vec4(color,hit?t:-t);
 #else
 if(shadeWater(ro,rd,sun,t,color))hit=true;
 if(hit){float fog=1.-exp(-t*t*((.000016+light.y*.000023)/(sceneScale*sceneScale)));color=mix(color,vec3(.58,.60,.52),min(.83,fog));}
 color=color/(color+vec3(.78));color=pow(color,vec3(.4545));float vignette=1.-.13*dot(uv*.65,uv*.65);color*=vignette;float dither=(hash(vec3(gl_FragCoord.xy,eye.w))-.5)/255.;fragColor=vec4(color+dither,1);
 #endif
}
`;
