import { flowPathGLSL } from "./flow-path-glsl.js";
// Procedural, world-space water: no repeated UV/foam textures. These helpers
// are inserted AFTER the terrain/sky functions in the active WebGL2 shader.
export const waterGLSL =
  flowPathGLSL +
  `
uniform vec4 waterWaves; // displacement amplitude, wavelength, animation speed, reflection
uniform vec4 waterFoam; // amount, shore reach, pattern scale, guided current speed
uniform vec4 waterMotion; // wave heading radians, world seed
float waterCenter(float z){return 0.;}
float waterBend(float z){return 0.;}
float waterFootprint(vec2 p){FlowFrame route=closestFlow(p);return route.distance-route.width;}
// Intersect each finite inclined route ribbon. This is not a world-height plane.
// Return the nearest candidate and its directional derivative for wave bounds.
vec2 routeIntersection(vec3 ro,vec3 rd,float limit,float amplitude){
 vec2 best=vec2(1e6,1);int count=clamp(int(flowValue(0).x),0,64);
 for(int i=0;i<min(count,viewportLimit(waterLoopLimits.x,64));i++){
  vec4 a=flowValue(1+i*3),b=flowValue(2+i*3),h=flowValue(193+i);
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
 for(int i=0;i<viewportLimit(waterLoopLimits.y,4);i++){
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
 for(int i=0;i<viewportLimit(renderLoopLimits.w,28);i++){
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
 for(int i=0;i<viewportLimit(waterLoopLimits.z,8);i++){
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
 // Shade both optical rays through one runtime call site. Both retain their
 // own origin, direction, distance cap and the full fine-field rock material.
 float opticalDepth=12.;vec3 bed=vec3(.12,.20,.16),reflected=sky(reflection);
 for(int ray=0;ray<viewportLimit(waterLoopLimits.w,2);ray++){
  if(ray==1&&waterWaves.w<=.01)continue;
  vec3 origin=ray==0?p-n*.07:p+n*.14,direction=ray==0?refraction:reflection;
  float hit=waterTerrainRay(origin,direction,ray==0?12.:26.);
  if(hit>0.){vec3 lit=waterRockLight(origin+direction*hit,sun);if(ray==0){opticalDepth=hit;bed=lit;}else reflected=lit;}
 }
 vec3 absorption=mix(vec3(3.2,.75,.40),vec3(1.4,.23,.12),surface.z);
 vec3 transmission=exp(-absorption*opticalDepth);
 vec3 deep=vec3(.025,.16,.145)*(.50+.50*sh);
 vec3 water=bed*transmission+deep*(vec3(1)-transmission);
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
