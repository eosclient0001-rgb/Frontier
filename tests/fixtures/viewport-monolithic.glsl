#version 300 es
#define SATMAP_GPU
precision highp int;
precision highp sampler2D;
precision highp float;
precision highp sampler3D;

const int RAIN_START=16384;
const int RAIN_COUNT=2048;
const ivec3 DIM=ivec3(128,80,128);

#ifndef TERRAIN_DOMAIN
#define TERRAIN_DOMAIN
uniform vec3 LO,HI,CELL;
uniform vec3 shaderLoopLimits;
uniform float BAND,VOXEL_VOLUME,sceneScale;
#endif

const ivec2 ATLAS=ivec2(2048,640);

ivec2 address(ivec3 q){q=clamp(q,ivec3(0),DIM-1);return ivec2((q.z%16)*DIM.x+q.x,(q.z/16)*DIM.y+q.y);}
ivec3 voxelAt(ivec2 uv){ivec2 tile=uv/DIM.xy;return ivec3(uv.x%DIM.x,uv.y%DIM.y,tile.y*16+tile.x);}
vec3 worldAt(ivec3 q){return LO+(vec3(q)+.5)*CELL;}
vec4 voxel(sampler2D tex,ivec3 q){return texelFetch(tex,address(q),0);}
vec4 atlasSample(sampler2D tex,vec3 p){
 vec3 q=clamp((p-LO)/CELL-.5,vec3(0),vec3(DIM)-1.001);
 ivec3 i=ivec3(floor(q));vec3 f=fract(q);
 #ifdef LINEAR_VOLUME
 vec2 uv0=(vec2((i.z%16)*DIM.x,(i.z/16)*DIM.y)+q.xy+.5)/vec2(ATLAS);
 int z1=i.z+1;vec2 uv1=(vec2((z1%16)*DIM.x,(z1/16)*DIM.y)+q.xy+.5)/vec2(ATLAS);
 return mix(textureLod(tex,uv0,0.),textureLod(tex,uv1,0.),f.z);
 #else
 return mix(mix(mix(voxel(tex,i),voxel(tex,i+ivec3(1,0,0)),f.x),mix(voxel(tex,i+ivec3(0,1,0)),voxel(tex,i+ivec3(1,1,0)),f.x),f.y),mix(mix(voxel(tex,i+ivec3(0,0,1)),voxel(tex,i+ivec3(1,0,1)),f.x),mix(voxel(tex,i+ivec3(0,1,1)),voxel(tex,i+ivec3(1,1,1)),f.x),f.y),f.z);
 #endif
}
float baseSDF(sampler2D tex,vec3 p){return atlasSample(tex,p).r+length(max(max(LO-p,p-HI),vec3(0)));}

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

float sdf(sampler2D tex,vec3 p){return refinedDistance(tex,p);}
vec3 surfaceNormal(sampler2D tex,vec3 p){
 vec3 h=refineEnabled>.5?vec3(refineCell*.35):CELL*.45;
 // Same six central-difference samples, with two call sites rather than six
 // expanded refined samplers. A zero uniform preserves standalone consumers.
 vec3 g=vec3(0);int axes=int(shaderLoopLimits.z>0.?min(shaderLoopLimits.z,3.):3.);
 for(int axis=0;axis<axes;axis++){vec3 offset=vec3(0);offset[axis]=h[axis];g[axis]=sdf(tex,p+offset)-sdf(tex,p-offset);}
 g/=h;return length(g)>1e-6?normalize(g):vec3(0,1,0);
}
float kernel(vec3 p,vec3 c,float r){float a=max(0.,1.-length((p-c)/max(vec3(r),CELL*.95)));return a*a;}
void kernelBounds(vec3 c,float radius,out ivec3 lo,out ivec3 hi){
 vec3 support=max(vec3(radius),CELL*.95);
 lo=max(ivec3(ceil((c-support-LO)/CELL-.5)),ivec3(0));
 hi=min(ivec3(floor((c+support-LO)/CELL-.5)),DIM-1);
}

vec2 exchangeWeights(vec4 v,float k){float band=1.-smoothstep(BAND,2.*BAND,abs(v.r));return k*band*vec2(v.a,1.-v.a);}
ivec2 particleUV(int id){return ivec2(id%64,id/64);}

uniform sampler2D volume;
uniform sampler2D materialAtlas,refineMaterial;
uniform vec4 eye,target,viewport,light,surface,brush,extra;
uniform float terrainShown;
in vec2 vUv;
out vec4 fragColor;

#ifndef TERRAIN_DOMAIN
#define TERRAIN_DOMAIN
uniform vec3 LO,HI,CELL;
uniform vec3 shaderLoopLimits;
uniform float BAND,VOXEL_VOLUME,sceneScale;
#endif

#define low LO
#define high HI
float detailWeight(vec3 p){return 1.;}
vec3 worldPoint(vec3 p){return p;}
const float worldEnabled=0.;
#define worldLow LO
#define worldHigh HI
float field(vec3 p){return sdf(volume,p);}
float hash(vec3 p){vec3 q=fract(p*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
vec3 normalAt(vec3 p){return surfaceNormal(volume,p);}
vec3 materialNormal(vec3 p,vec3 n){vec3 q=p*5.;float e=.12;vec3 g=vec3(noise(q+vec3(e,0,0))-noise(q-vec3(e,0,0)),noise(q+vec3(0,e,0))-noise(q-vec3(0,e,0)),noise(q+vec3(0,0,e))-noise(q-vec3(0,0,e)))/.24;return normalize(n-(g-n*dot(n,g))*surface.y*(refineEnabled>.5?.08:.72));}
vec2 boxRange(vec3 ro,vec3 rd){vec3 lo=low,hi=high;vec3 a=(lo-ro)/rd,b=(hi-ro)/rd,n=min(a,b),f=max(a,b);return vec2(max(max(n.x,n.y),n.z),min(min(f.x,f.y),f.z));}
float trace(vec3 ro,vec3 rd){
 vec2 range=boxRange(ro,rd);float t=max(0.,range.x);if(t>range.y)return 1e6;
 for(int i=0;i<360;i++){
  vec3 p=ro+rd*t;float d=field(p);if(d<(refineEnabled>.5?max(refineCell*.025,t*.2/max(1.,viewport.y)):max(.04*sceneScale,t*.00008)))return t;
  float stepSize=refineEnabled>.5?refinedRayStep(volume,p,rd,d):max(.02*sceneScale,d*.55);
  t+=stepSize;if(t>range.y)break;
 }return 1e6;
}
float shadow(vec3 p,vec3 l){if(terrainShown<.5)return 1.;float scale=refineEnabled>.5?max(.5,refineCell*2.):sceneScale;float t=.18*scale,s=1.;for(int i=0;i<32;i++){float h=field(p+l*t);s=min(s,9.*h/t);t+=clamp(h,.16*scale,1.6*scale);if(h<.04*scale||t>29.*scale)break;}return clamp(s,0.,1.);}
float ambient(vec3 p,vec3 n){float scale=refineEnabled>.5?max(.5,refineCell*2.):sceneScale;float a=0.,w=1.;for(int i=1;i<=4;i++){float h=float(i)*.48*scale;a+=(h-field(p+n*h))*w/scale;w*=.55;}return clamp(1.-a*.38,.25,1.);}
#define WORLD_MATERIAL

#ifndef WORLD_MATERIAL
float detailWeight(vec3 p){return 1.;}
vec3 worldPoint(vec3 p){return p;}
const float worldEnabled=0.;
const float sceneScale=1.;
const vec3 worldLow=vec3(-16,-8,-16),worldHigh=vec3(16,16,16);
#endif

uniform vec4 satControl,satWeights,satWeather,satLow,satHigh,satDust;
#ifdef SATMAP_GPU
uniform sampler2D flowAtlas;
#endif
vec4 satHistory(vec3 p){
#ifdef SATMAP_GPU
 return detailWeight(p)*atlasSample(flowAtlas,p);
#else
 return vec4(0);
#endif
}
float satSediment(vec3 p){
#ifdef SATMAP_GPU
 if(refineEnabled>.5){ivec3 q=ivec3(floor((p-LO)/refineCell));int slot=rfSlot(q/8);if(slot>=0)return clamp(dot(texelFetch(refineMaterial,rfUV(slot,q-(q/8)*8),0).xyz,vec3(1))/(refineCell*refineCell*refineCell*.35),0.,1.);}return detailWeight(p)*clamp(dot(atlasSample(materialAtlas,p).xyz,vec3(1))/(VOXEL_VOLUME*.35),0.,1.);
#else
 return 0.;
#endif
}
// Tangential Hessian of the XYZ distance field, corrected for local gradient
// magnitude. Signed: convex positive, concave negative. Grid-scale estimate.
float satCurvature(vec3 p,vec3 n){
 float r=refineEnabled>.5?refineCell*1.5:.62*sceneScale;vec3 u=normalize(cross(n,abs(n.y)<.9?vec3(0,1,0):vec3(1,0,0))),v=cross(n,u);
 float d=field(p),grad=max(.2,abs(field(p+n*r)-field(p-n*r))/(2.*r));
 return clamp((field(p+u*r)+field(p-u*r)+field(p+v*r)+field(p-v*r)-4.*d)/(r*r*grad),-3.,3.);
}
vec3 satDiagnostic(vec3 p,vec3 n){
 int mode=int(satControl.z);
 if(mode==1){vec4 h=satHistory(p);float exposure=1.-exp(-h.w*.6);vec3 direction=h.xyz/max(h.w,.00001);return mix(vec3(.035),.5+.5*normalize(direction+vec3(1e-5)),exposure);}
 if(mode==2)return mix(vec3(.025),vec3(.92,.66,.26),satSediment(p));
 if(mode==3)return vec3(ambient(p,n));
 if(mode==4){float k=satCurvature(p,n);return mix(vec3(.45),k>0.?vec3(.94,.51,.20):vec3(.13,.47,.72),clamp(abs(k)*.6,0.,1.));}
 if(mode==5)return mix(vec3(.13,.23,.30),vec3(.90,.79,.53),clamp((worldEnabled>.5?(worldPoint(p).y-worldLow.y)/(worldHigh.y-worldLow.y):(p.y-low.y)/(high.y-low.y)),0.,1.));
 return vec3(1.-abs(n.y));
}
vec3 satMaterial(vec3 p,vec3 n,vec3 original){
 if(satControl.x<.5)return original;
 vec3 q=worldPoint(p)*satControl.w;float elevation=clamp((worldEnabled>.5?(worldPoint(p).y-worldLow.y)/(worldHigh.y-worldLow.y):(p.y-low.y)/(high.y-low.y)),0.,1.);
 float up=smoothstep(.15,.85,n.y),slope=1.-abs(n.y),curvature=satCurvature(p,n);
 float concave=clamp(-curvature*.55,0.,1.),convex=clamp(curvature*.55,0.,1.);
 float broad=noise(q*.19+vec3(noise(q*.47)*2.));
 float bands=.5+.5*sin(q.y*2.5+noise(q*.32)*2.2);
 float ramp=clamp(.32+(broad-.5)*.55+elevation*satWeights.x+convex*.23*satWeights.z-slope*.26*satWeights.y,0.,1.);
 vec3 c=mix(satLow.rgb,satHigh.rgb,ramp);
 c*=.91+.12*bands;
 float sediment=satSediment(p),dust=clamp(up*(.10+concave*.32*satWeights.z)*satWeights.y+sediment*satWeights.w,0.,.94);
 c=mix(c,satDust.rgb*(.85+.22*broad),dust);
 vec4 history=satHistory(p);float wet=(1.-exp(-history.w*.45))*satWeather.x;
 vec3 direction=history.xyz/max(history.w,.00001);direction-=n*dot(n,direction);
 vec3 fallback=vec3(0,-1,0)-n*dot(n,vec3(0,-1,0));
 if(length(direction)<.001)direction=length(fallback)>.001?fallback:vec3(1,0,0);
 direction=normalize(direction);vec3 side=normalize(cross(n,direction));
 float streak=noise(vec3(dot(q,side)*3.1,dot(q,direction)*.22,dot(q,n)*1.7));
 c*=1.-wet*(.14+.18*streak);
 c*=mix(1.,.72+.28*ambient(p,n),satWeather.y);
 c*=.94+.10*noise(q*7.3)+.025*(noise(q*19.7)-.5);
 return mix(original,c,satControl.y);
}


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

vec3 rockColor(vec3 p,vec3 n){float grain=noise(p*8.),broadNoise=noise(p*.43)+.45*noise(p*1.8),bedding=p.y+noise(vec3(p.x*.12,0,p.z*.12))*.4,bands=.5+.5*sin(bedding*3.4+.4*sin(bedding*1.1)),thin=pow(.5+.5*sin(bedding*17.+noise(p*2.)*1.7),12.);vec3 c=mix(vec3(.37,.135,.064),vec3(.72,.33,.14),.37+broadNoise*.31);c=mix(c,c*vec3(.74,.70,.65),bands*surface.x*.35);c*=1.-thin*.20*surface.x;c+=vec3(.055,.04,.028)*(grain-.5)*surface.y;float top=smoothstep(.55,.96,n.y);c=mix(c,vec3(.64,.37,.185)*(.9+broadNoise*.12),top*.67);float streak=noise(vec3(p.x*3.3,p.y*.13,p.z*3.3));c*=.79+.28*streak;
 float fractures=pow(1.-abs(noise(p*vec3(2.8,.24,2.8))*2.-1.),18.);c*=1.-fractures*.22*surface.y;if(extra.y>3.5)c=mix(vec3(.25,.27,.255),vec3(.48,.455,.40),clamp(.25+broadNoise*.35+top*.1,0.,1.))*(.86+.15*streak)+vec3((grain-.5)*.025);c=satMaterial(p,n,c);vec4 layer=atlasSample(materialAtlas,p);float layerVolume=VOXEL_VOLUME;if(refineEnabled>.5){ivec3 q=ivec3(floor((p-LO)/refineCell));int slot=rfSlot(q/8);if(slot>=0){layer=texelFetch(refineMaterial,rfUV(slot,q-(q/8)*8),0);layerVolume=refineCell*refineCell*refineCell;}}float lm=dot(layer,vec4(1));vec3 loose=(layer.x*vec3(.66,.45,.23)+layer.y*vec3(.38,.34,.25)+layer.z*vec3(.45,.39,.31))/max(lm,.000001);if(satControl.x<.5)c=mix(c,loose,clamp(lm/(layerVolume*.45),0.,.85));if(extra.x>.5)c=vec3(.58,.55,.47);return fractureColor(p,c);}
vec3 sky(vec3 rd){return mix(vec3(.012),vec3(.005),smoothstep(-.1,.8,rd.y));}

uniform highp sampler2D flowPaths;
vec4 flowValue(int i){return texelFetch(flowPaths,ivec2(i,0),0);}
struct FlowFrame{vec2 point;vec2 tangent;float distance;float width;float speed;float along;float height;vec2 gradient;};
FlowFrame closestFlow(vec2 p){FlowFrame f;f.point=p;f.tangent=vec2(0,1);f.distance=1e5;f.width=0.;f.speed=0.;f.along=0.;f.height=-100.;f.gradient=vec2(0);int count=clamp(int(flowValue(0).x),0,64);
 for(int i=0;i<count;i++){vec4 a=flowValue(1+i*3),b=flowValue(2+i*3);vec2 ab=b.xy-a.xy;float l=length(ab),t=clamp(dot(p-a.xy,ab)/max(l*l,1e-8),0.,1.);vec2 q=a.xy+ab*t;float d=length(p-q);
 if(d-a.w<f.distance-f.width){f.point=q;f.tangent=ab/max(l,.0001);f.distance=d;f.width=a.w;f.speed=b.w;f.along=a.z+t*l;vec4 elevation=flowValue(193+i);f.height=mix(elevation.x,elevation.y,t);f.gradient=ab/max(l*l,1e-8)*(elevation.y-elevation.x);}}
 return f;
}
vec2 flowBirth(float randomValue,bool warm){vec4 meta=flowValue(0);float target=randomValue*meta.z;vec2 p=vec2(0);
 for(int i=0;i<clamp(int(meta.x),0,64);i++){vec4 a=flowValue(1+i*3),b=flowValue(2+i*3),c=flowValue(3+i*3);if(target<=b.z){float t=clamp((target-c.z)/max(.001,b.z-c.z),0.,1.);p=warm?mix(a.xy,b.xy,t):c.xy;break;}}
 return p;
}

uniform vec4 waterWaves; // displacement amplitude, wavelength, animation speed, reflection
uniform vec4 waterFoam; // amount, shore reach, pattern scale, guided current speed
uniform vec4 waterMotion; // wave heading radians, world seed
float waterCenter(float z){return 0.;}
float waterBend(float z){return 0.;}
float waterFootprint(vec2 p){FlowFrame route=closestFlow(p);return route.distance-route.width;}
// Intersect each finite inclined route ribbon. This is not a world-height plane.
// Return the nearest candidate and its directional derivative for wave bounds.
vec2 routeIntersection(vec3 ro,vec3 rd,float limit,float amplitude){
 vec2 best=vec2(1e6,1);int count=int(flowValue(0).x);
 for(int i=0;i<64;i++){
  if(i>=count)break;vec4 a=flowValue(1+i*3),b=flowValue(2+i*3),h=flowValue(193+i);
  vec2 ab=b.xy-a.xy;float l2=max(dot(ab,ab),1e-8);vec2 grade=ab*(h.y-h.x)/l2;
  float denominator=rd.y-dot(grade,rd.xz);if(abs(denominator)<.005)continue;
  float t=(h.x+dot(grade,ro.xz-a.xy)-ro.y)/denominator;
  if(t<0.||t>limit+amplitude/abs(denominator)||t>=best.x)continue;
  vec2 q=ro.xz+rd.xz*t;float u=clamp(dot(q-a.xy,ab)/l2,0.,1.);
  if(length(q-mix(a.xy,b.xy,u))>a.w+amplitude/abs(denominator))continue;
  best=vec2(t,denominator);
 }
 return best;
}
// Independent non-commensurate modes + a slowly varying world-space phase warp.
// Analytic primary slopes follow the explicit river route. Warp derivatives are omitted
// (a small, low-frequency approximation); fine ripples affect normals only.
vec3 waterWave(vec2 p){
 float time=eye.w*waterWaves.z,lambda=max(1.,waterWaves.y),amp=min(max(0.,waterWaves.x),lambda*.15);
 bool custom=flowValue(0).y>.5;FlowFrame route=closestFlow(p);float speed=custom?(waterFoam.w>0.?route.speed:0.):waterFoam.w;
 vec2 side=vec2(route.tangent.y,-route.tangent.x);
 vec2 q=custom?vec2(dot(p-route.point,side),route.along-time*speed*.35):vec2(p.x-waterCenter(p.y),p.y-time*speed*.35);
 float warp=(noise(vec3(p*.17,time*.043+waterMotion.y*.001))-.5)*1.1;
 vec3 result=vec3(0);
 for(int i=0;i<4;i++){
  float f=float(i),angle=waterMotion.x+f*1.137,frequency=(6.2831853/lambda)*pow(1.713,f);
  vec2 direction=vec2(cos(angle),sin(angle));
  float weight=i==0?.52:i==1?.26:i==2?.14:.08;
  float phase=dot(q,direction)*frequency-time*sqrt(9.81*frequency)*.42+warp*(1.+f*.37)+f*2.413;
  vec2 slope=direction*(amp*weight*frequency*cos(phase));if(custom)slope=side*slope.x+route.tangent*slope.y;else slope.y-=waterBend(p.y)*slope.x;
  result+=vec3(amp*weight*sin(phase),slope);
 }
 return result;
}
// Short, bounded terrain-only rays for bank reflections and bed refraction.
// They never trace the water recursively or read a CPU/screen-space image.
float waterTerrainRay(vec3 origin,vec3 direction,float limit){
 if(terrainShown<.5||dot(direction,direction)<.1)return -1.;float t=.08;
 for(int i=0;i<28;i++){
  vec3 p=origin+direction*t;
  if(any(lessThan(p,low))||any(greaterThan(p,high)))return -1.;
  float d=field(p);if(d<.055)return t;
  t+=clamp(d*.72,.055,2.);if(t>limit)return -1.;
 }return -1.;
}
vec3 waterRockLight(vec3 p,vec3 sun){vec3 n=normalAt(p);return rockColor(p,n)*(vec3(.25,.28,.27)+vec3(.92,.81,.65)*max(dot(n,sun),0.));}
bool shadeWater(vec3 ro,vec3 rd,vec3 sun,inout float opaqueT,inout vec3 color){
 if(light.w<.5||flowValue(0).x<1.)return false;
 float amplitude=min(max(0.,waterWaves.x),max(1.,waterWaves.y)*.15);
 vec2 candidate=routeIntersection(ro,rd,opaqueT,amplitude);
 if(candidate.x>1e5)return false;
 float tw=candidate.x,span=max(.02,amplitude/abs(candidate.y));
 float lo=max(0.,tw-span),hi=tw+span;
 vec3 wave=vec3(0),p=ro+rd*tw;FlowFrame route=closestFlow(p.xz);
 for(int i=0;i<8;i++){
  p=ro+rd*tw;route=closestFlow(p.xz);wave=waterWave(p.xz);
  float residual=p.y-route.height-wave.x;
  float derivative=rd.y-dot(route.gradient+wave.yz,rd.xz);
  if(abs(residual)<.002)break;
  if(residual*sign(-candidate.y)>0.)lo=tw;else hi=tw;
  float next=abs(derivative)>.005?tw-residual/derivative:(lo+hi)*.5;
  tw=(next>=lo&&next<=hi)?next:(lo+hi)*.5;
 }
 p=ro+rd*tw;route=closestFlow(p.xz);wave=waterWave(p.xz);
 float footprint=waterFootprint(p.xz);
 if(tw<=0.||tw>=opaqueT||footprint>0.||abs(p.y-route.height-wave.x)>.075)return false;
 float shoreDistance=field(p);if(shoreDistance<.02)return false;
 float time=eye.w,flow=waterFoam.w;
 vec2 stream=vec2(p.x-waterCenter(p.z),p.z-time*flow*.55);
 if(flowValue(0).y>.5){FlowFrame route=closestFlow(p.xz);flow=waterFoam.w>0.?route.speed:0.;stream=vec2(dot(p.xz-route.point,vec2(route.tangent.y,-route.tangent.x)),route.along-time*flow*.55);}
 vec2 micro=vec2(noise(vec3(stream*3.13,time*.23)),noise(vec3(stream.yx*4.79+17.3,time*.19)))-.5;
 vec3 n=normalize(vec3(-route.gradient.x-wave.y-micro.x*surface.w*.32,1.,-route.gradient.y-wave.z-micro.y*surface.w*.32));
 bool above=ro.y>route.height+wave.x;if(!above)n=-n;
 vec3 reflection=reflect(rd,n),refraction=refract(rd,n,above? .7501875:1.333);
 float sh=shadow(p+n*.14,sun),fresnel=.0204+.9796*pow(1.-clamp(dot(n,-rd),0.,1.),5.);
 float opticalDepth=clamp(opaqueT-tw,.05,12.);
 vec3 bed=color;
 float bedHit=waterTerrainRay(p-n*.07,refraction,12.);
 if(bedHit>0.){opticalDepth=bedHit;bed=waterRockLight(p-n*.07+refraction*bedHit,sun);}
 else{opticalDepth=12.;bed=vec3(.12,.20,.16);}
 vec3 absorption=mix(vec3(3.2,.75,.40),vec3(1.4,.23,.12),surface.z);
 vec3 transmission=exp(-absorption*opticalDepth);
 vec3 deep=vec3(.025,.16,.145)*(.50+.50*sh);
 vec3 water=bed*transmission+deep*(vec3(1)-transmission);
 vec3 reflected=sky(reflection);
 if(waterWaves.w>.01){float hit=waterTerrainRay(p+n*.14,reflection,26.);if(hit>0.)reflected=waterRockLight(p+n*.14+reflection*hit,sun);}
 water=mix(water,reflected,clamp(fresnel*waterWaves.w,0.,.95));
 float rough=mix(210.,65.,clamp(surface.w*.6+length(wave.yz)*.25,0.,1.));
 float glint=pow(max(dot(reflect(-sun,n),-rd),0.),rough);
 water+=vec3(1.6,1.34,.93)*glint*sh*waterWaves.w;
 // Foam follows flow coordinates and current SDF proximity. Low-frequency warp
 // breaks up the bank ribbon; independent scales form patches and porous edges.
 float scale=max(.15,waterFoam.z);
 vec2 warp=vec2(noise(vec3(stream*.29,time*.071)),noise(vec3(stream*.23+31.8,time*.097)))-.5;
 vec2 fq=stream/scale+warp*2.7;
 float patches=noise(vec3(fq*.73,time*.21));
 float lace=noise(vec3(fq*2.317+19.7,time*.37));
 float grain=noise(vec3(fq*7.193+7.3,time*.49));
 float reach=max(.08,waterFoam.y)*( .7+.6*patches);
 // A nearby flat river BED is not a shoreline: suppress broad milk-white
 // coverage there. Near-vertical banks/obstacles retain broken foam ribbons.
 float upwardSlope=clamp((field(p+vec3(0,.3,0))-shoreDistance)/.3,0.,1.);
 float bank=1.-smoothstep(.35,.85,upwardSlope);
 float shore=(1.-smoothstep(.035,reach,shoreDistance))*bank;
 float shallows=(1.-smoothstep(.15,.9,opticalDepth))*clamp(flow*.13,0.,1.);
 float crest=smoothstep(.28,.78,length(wave.yz))*smoothstep(.2,.85,wave.x/max(amplitude,.001));
 float supply=clamp(shore*.9+shallows*.25+crest*.42,0.,1.)*waterFoam.x;
 float pattern=smoothstep(.23,.70,patches*.65+lace*.35);
 float foam=clamp(supply*pattern*1.3,0.,1.);
 vec3 foamColor=mix(vec3(.66,.70,.62),vec3(.94,.96,.86),grain)*(.55+.45*sh);
 water=mix(water,foamColor,foam);
 // Soften only the ARTISTIC footprint edge, not the physical SDF shoreline.
 float edge=smoothstep(0.,.25,-footprint);
 color=mix(color,water,edge);opaqueT=tw;return true;
}

void main(){
 vec2 uv=vUv;vec3 forward=normalize(target.xyz-eye.xyz),right=normalize(cross(forward,vec3(0,1,0))),up=cross(right,forward),rd=normalize(forward+right*uv.x*target.w*.62+up*uv.y*.62),ro=eye.xyz;
 float angle=light.x*.0174533;vec3 sun=normalize(vec3(cos(angle),.85,sin(angle)));
 float t=terrainShown>.5?trace(ro,rd):1e6,floorT=(low.y-ro.y)/rd.y;vec3 color=sky(rd);bool hit=false;
 if(t<999999.){hit=true;vec3 p=ro+rd*t,geo=normalAt(p),n=materialNormal(p,geo);float sh=shadow(p+geo*.17,sun),ao=ambient(p,geo),diffuse=max(dot(n,sun),0.);vec3 bounce=max(-n.y,0.)*vec3(.13,.075,.035);vec3 albedo=rockColor(p,geo);color=albedo*(vec3(.25,.28,.27)*ao+vec3(1.05,.91,.70)*diffuse*sh+bounce);color+=albedo*pow(1.-max(dot(n,-rd),0.),3.)*.09;
 if(satControl.x>.5&&satControl.z>.5)color=satDiagnostic(p,geo);
 if(brush.w>0.){float d=distance(p,brush.xyz),ring=1.-smoothstep(.04*sceneScale,.12*sceneScale,abs(d-brush.w));color=mix(color,vec3(1.,.62,.28),ring*.8);color+=vec3(.07,.025,.006)*(1.-smoothstep(0.,brush.w,d));}}
 else if(floorT>0.){t=floorT;hit=false;vec3 p=ro+rd*t;float tex=noise(p*2.)*.025+noise(p*.15)*.045,sh=shadow(p+vec3(0,.12,0),sun);color=(vec3(.012)+tex*.035)*(.56+.44*sh);float grid=min(abs(fract(p.x*.1+.5)-.5),abs(fract(p.z*.1+.5)-.5)),outside=smoothstep(18.,26.,max(abs(p.x),abs(p.z)));color*=1.-(1.-smoothstep(.001,.012,grid))*.09*outside;}
 if(shadeWater(ro,rd,sun,t,color))hit=true;
 if(hit){float fog=1.-exp(-t*t*((.000016+light.y*.000023)/(sceneScale*sceneScale)));color=mix(color,vec3(.58,.60,.52),min(.83,fog));}
 color=color/(color+vec3(.78));color=pow(color,vec3(.4545));float vignette=1.-.13*dot(uv*.65,uv*.65);color*=vignette;float dither=(hash(vec3(gl_FragCoord.xy,eye.w))-.5)/255.;fragColor=vec4(color+dither,1);
}
