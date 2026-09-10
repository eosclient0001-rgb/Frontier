import { flowPathGLSL } from "./flow-path-glsl.js";
// Procedural, world-space water: no repeated UV/foam textures. These helpers
// are inserted AFTER the terrain/sky functions in the active WebGL2 shader.
export const waterGLSL =
  flowPathGLSL +
  `
uniform vec4 waterWaves; // displacement amplitude, wavelength, animation speed, reflection
uniform vec4 waterFoam; // amount, shore reach, pattern scale, guided current speed
uniform vec4 waterShape; // canyon gap, meander, wall flare, river X offset
uniform vec4 waterMotion; // wave heading radians, world seed
float waterCenter(float z){return waterShape.y*(2.5*sin(z*.15)+sin(z*.36+1.))+waterShape.w;}
float waterBend(float z){return waterShape.y*(.375*cos(z*.15)+.36*cos(z*.36+1.));}
float waterFootprint(vec2 p){
 if(flowValue(0).y>.5){FlowFrame route=closestFlow(p);return route.distance-route.width;}
 if(extra.y>.5)return length(p-vec2(1))-8.;
 float width=waterShape.x*.5+max(light.z,0.)*waterShape.z+1.9;
 return max(abs(p.x-waterCenter(p.y))-width,abs(p.y)-16.7);
}
// Independent non-commensurate modes + a slowly varying world-space phase warp.
// Analytic primary slopes include the canyon bend. Warp derivatives are omitted
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
 if(light.w<.5||abs(rd.y)<.025)return false;
 float tw=(light.z-ro.y)/rd.y;
 float amplitude=min(max(0.,waterWaves.x),max(1.,waterWaves.y)*.15);
 if(tw< -amplitude/max(abs(rd.y),.025)||tw>opaqueT+amplitude/max(abs(rd.y),.025))return false;
 vec3 wave=vec3(0),p=ro+rd*tw;
 if(waterFootprint(p.xz)>amplitude/max(abs(rd.y),.025)+.5)return false;
 float a=(light.z+amplitude-ro.y)/rd.y,b=(light.z-amplitude-ro.y)/rd.y;
 float lo=max(0.,min(a,b)),hi=max(a,b);if(hi<=0.)return false;
 tw=clamp(tw,lo,hi);
 for(int i=0;i<8;i++){
  p=ro+rd*tw;wave=waterWave(p.xz);float residual=p.y-light.z-wave.x;
  if(residual*sign(-rd.y)>0.)lo=tw;else hi=tw;
  float derivative=rd.y-wave.y*rd.x-wave.z*rd.z;
  float next=abs(derivative)>.04?tw-residual/derivative:(lo+hi)*.5;
  tw=(next>lo&&next<hi)?next:(lo+hi)*.5;
 }
 p=ro+rd*tw;wave=waterWave(p.xz);
 float footprint=waterFootprint(p.xz);
 if(tw<=0.||tw>=opaqueT||footprint>0.||abs(p.y-light.z-wave.x)>.075)return false;
 float shoreDistance=field(p);if(shoreDistance<.02)return false;
 float time=eye.w,flow=waterFoam.w;
 vec2 stream=vec2(p.x-waterCenter(p.z),p.z-time*flow*.55);
 if(flowValue(0).y>.5){FlowFrame route=closestFlow(p.xz);flow=waterFoam.w>0.?route.speed:0.;stream=vec2(dot(p.xz-route.point,vec2(route.tangent.y,-route.tangent.x)),route.along-time*flow*.55);}
 vec2 micro=vec2(noise(vec3(stream*3.13,time*.23)),noise(vec3(stream.yx*4.79+17.3,time*.19)))-.5;
 vec3 n=normalize(vec3(-wave.y-micro.x*surface.w*.32,1.,-wave.z-micro.y*surface.w*.32));
 bool above=ro.y>light.z+wave.x;if(!above)n=-n;
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
`;
