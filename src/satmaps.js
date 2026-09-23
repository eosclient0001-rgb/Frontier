import { viewportLoopGLSL } from "./viewport-loops.js";
// Procedural volumetric material palettes. No UV unwrap or heightfield bake.
export const satmapDefaults = {
  satmapEnabled: true,
  satmapPalette: 0,
  satmapView: 0,
  satmapBlend: 0.85,
  satmapElevation: 0.3,
  satmapSlope: 0.65,
  satmapCurvature: 0.55,
  satmapSediment: 0.85,
  satmapFlow: 0.65,
  satmapAO: 0.6,
  satmapScale: 1,
};
export const satmapPalettes = [
  {
    name: "Weathered sandstone",
    colors: [
      [0.32, 0.18, 0.105],
      [0.61, 0.43, 0.255],
      [0.72, 0.6, 0.4],
    ],
  },
  {
    name: "Alpine mineral",
    colors: [
      [0.2, 0.235, 0.215],
      [0.47, 0.48, 0.4],
      [0.65, 0.63, 0.49],
    ],
  },
  {
    name: "Volcanic basalt",
    colors: [
      [0.105, 0.12, 0.12],
      [0.3, 0.32, 0.31],
      [0.48, 0.43, 0.32],
    ],
  },
  {
    name: "Layered limestone",
    colors: [
      [0.33, 0.32, 0.27],
      [0.64, 0.62, 0.51],
      [0.75, 0.69, 0.53],
    ],
  },
];
const bounded = (p, key, lo = 0, hi = 1) =>
  Math.max(
    lo,
    Math.min(
      hi,
      Number.isFinite(Number(p[key])) ? Number(p[key]) : satmapDefaults[key],
    ),
  );
export function satmapUniforms(p = {}) {
  const palette = satmapPalettes[Math.round(bounded(p, "satmapPalette", 0, 3))];
  return {
    satControl: [
      p.satmapEnabled === false ? 0 : 1,
      bounded(p, "satmapBlend"),
      Math.round(bounded(p, "satmapView", 0, 6)),
      bounded(p, "satmapScale", 0.25, 3),
    ],
    satWeights: [
      bounded(p, "satmapElevation"),
      bounded(p, "satmapSlope"),
      bounded(p, "satmapCurvature"),
      bounded(p, "satmapSediment"),
    ],
    satWeather: [bounded(p, "satmapFlow"), bounded(p, "satmapAO"), 0, 0],
    satLow: [...palette.colors[0], 1],
    satHigh: [...palette.colors[1], 1],
    satDust: [...palette.colors[2], 1],
  };
}
export const satmapGLSL = `
${viewportLoopGLSL}
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
 return detailWeight(p)*clamp(dot(atlasSample(materialAtlas,p).xyz,vec3(1))/(VOXEL_VOLUME*.35),0.,1.);
#else
 return 0.;
#endif
}
// Tangential Hessian of the XYZ distance field, corrected for local gradient
// magnitude. Signed: convex positive, concave negative. Grid-scale estimate.
float satCurvature(vec3 p,vec3 n){
 float r=.62*sceneScale;vec3 u=normalize(cross(n,abs(n.y)<.9?vec3(0,1,0):vec3(1,0,0))),v=cross(n,u);
 // Same seven samples and original addition order, only two expanded
 // off-centre field call sites instead of six.
 float d=field(p),grad=.2,lap=0.;
 for(int axis=0;axis<viewportLimit(sampleLoopLimits.y,3);axis++){
  vec3 offset=(axis==0?n:axis==1?u:v)*r;float plus=field(p+offset),minus=field(p-offset);
  if(axis==0)grad=max(.2,abs(plus-minus)/(2.*r));else{lap+=plus;lap+=minus;}
 }
 return clamp((lap-4.*d)/(r*r*grad),-3.,3.);
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
`;
