import { waterGLSL } from "./water-shader.js";
export const computeWGSL = /* wgsl */ `
struct Params { brush:vec4f, settings:vec4f, weather:vec4f, operation:vec4f, rayOrigin:vec4f, rayDirection:vec4f }
@group(0) @binding(0) var source:texture_3d<f32>;
@group(0) @binding(1) var destination:texture_storage_3d<rgba16float,write>;
@group(0) @binding(2) var<uniform> p:Params;
const dims=vec3i(112,72,112);
const lower=vec3f(-22,-4,-20);
const cell=vec3f(44.0/112.0,26.0/72.0,40.0/112.0);
fn load(q:vec3i)->vec4f{return textureLoad(source,clamp(q,vec3i(0),dims-1),0);}
@compute @workgroup_size(4,4,4)
fn main(@builtin(global_invocation_id) id:vec3u){
 let q=vec3i(id);if(any(q>=dims)){return;}
 let a=load(q);var result=a;
 let pos=lower+(vec3f(q)+.5)*cell;
 let px=load(q+vec3i(1,0,0));let mx=load(q-vec3i(1,0,0));
 let py=load(q+vec3i(0,1,0));let my=load(q-vec3i(0,1,0));
 let pz=load(q+vec3i(0,0,1));let mz=load(q-vec3i(0,0,1));
 let average=(px.x+mx.x+py.x+my.x+pz.x+mz.x)/6.0;
 if(p.operation.x>0.5){
   let r=distance(pos,p.brush.xyz);let sphere=r-p.brush.w;
   if(p.operation.x<1.5){result.x=max(a.x,-sphere);}
   else if(p.operation.x<2.5){result.x=min(a.x,sphere);}
   else if(r<p.brush.w){result.x=mix(a.x,average,.7*(1.0-r/p.brush.w));}
 }else if(abs(a.x)<1.15 && all(q>vec3i(0)) && all(q<dims-1)){
   let gradient=vec3f(px.x-mx.x,py.x-my.x,pz.x-mz.x)/(2.0*cell);
   let normal=gradient/max(length(gradient),.0001);
   let up=clamp(normal.y,0.0,1.0);let slope=sqrt(max(0.0,1.0-up*up));
   let layer=.5+.5*sin(pos.y*3.5);
   let hard=clamp(p.settings.z*.75+layer*p.weather.w*.38,.05,.97);
   let side=(px.y+mx.y+pz.y+mz.y)*.25;
   let moisture=clamp(a.y*.56+py.y*.24+side*.14+p.settings.x*.12*(.12+up),0.0,2.0);
   let flow=moisture*(.15+slope*.85);
   let erode=p.settings.y*flow*(1.0-hard)*.065;
   let thermal=p.settings.w*max(0.0,average-a.x)*(.25+slope)*.09;
   let wind=p.weather.x*(1.0-hard)*(.35+.65*max(normal.x,0.0))*.005;
   let sediment=a.z*.65+py.z*.20+erode;
   let deposition=p.weather.y*sediment*up*.14*(1.0-smoothstep(1.0,5.0,pos.y));
   let band=1.0-smoothstep(0.0,1.15,abs(a.x));
   result=vec4f(a.x+(erode+thermal+wind-deposition)*band,moisture*.98,max(0.0,sediment-deposition),1);
 }
 textureStore(destination,q,result);
}
`;

// Both renderers ray-march the same trilinearly sampled 3D volume.
export const renderWGSL = /* wgsl */ `
struct Uniforms { eye:vec4f, lookAt:vec4f, viewport:vec4f, light:vec4f, surface:vec4f, brush:vec4f, extra:vec4f }
@group(0) @binding(0) var volume:texture_3d<f32>;
@group(0) @binding(1) var filtering:sampler;
@group(0) @binding(2) var<uniform> u:Uniforms;
const low=vec3f(-22,-4,-20);
const high=vec3f(22,22,20);
fn field(p:vec3f)->f32{
 let uv=(p-low)/(high-low);
 let outside=length(max(max(low-p,p-high),vec3f(0)));
 return textureSampleLevel(volume,filtering,clamp(uv,vec3f(.0001),vec3f(.9999)),0).x+outside;
}
fn hash(p:vec3f)->f32{var q=fract(p*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
fn noise(p:vec3f)->f32{
 let i=floor(p);var f=fract(p);f=f*f*(3.0-2.0*f);
 return mix(mix(mix(hash(i),hash(i+vec3f(1,0,0)),f.x),mix(hash(i+vec3f(0,1,0)),hash(i+vec3f(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3f(0,0,1)),hash(i+vec3f(1,0,1)),f.x),mix(hash(i+vec3f(0,1,1)),hash(i+vec3f(1,1,1)),f.x),f.y),f.z);
}
fn normalAt(p:vec3f)->vec3f{let e=.13;return normalize(vec3f(field(p+vec3f(e,0,0))-field(p-vec3f(e,0,0)),field(p+vec3f(0,e,0))-field(p-vec3f(0,e,0)),field(p+vec3f(0,0,e))-field(p-vec3f(0,0,e))));}
fn materialNormal(p:vec3f,n:vec3f)->vec3f{
 let q=p*5.0;let e=.12;
 let g=vec3f(noise(q+vec3f(e,0,0))-noise(q-vec3f(e,0,0)),noise(q+vec3f(0,e,0))-noise(q-vec3f(0,e,0)),noise(q+vec3f(0,0,e))-noise(q-vec3f(0,0,e)))/(.24);
 return normalize(n-(g-n*dot(n,g))*u.surface.y*.72);
}
fn boxRange(ro:vec3f,rd:vec3f)->vec2f{let a=(low-ro)/rd;let b=(high-ro)/rd;let n=min(a,b);let f=max(a,b);return vec2f(max(max(n.x,n.y),n.z),min(min(f.x,f.y),f.z));}
fn trace(ro:vec3f,rd:vec3f)->f32{let range=boxRange(ro,rd);var t=max(.0,range.x);if(t>range.y){return 200.0;}for(var i=0;i<190;i++){let d=field(ro+rd*t);if(d<.065){return t;}t+=max(.035,d*.65);if(t>range.y){break;}}return 200.0;}
fn shadow(p:vec3f,l:vec3f)->f32{var t=.18;var s=1.0;for(var i=0;i<32;i++){let h=field(p+l*t);s=min(s,9.0*h/t);t+=clamp(h,.16,1.6);if(h<.04||t>29.0){break;}}return clamp(s,.0,1.0);}
fn ambient(p:vec3f,n:vec3f)->f32{var a=0.0;var weight=1.0;for(var i=1;i<=4;i++){let h=f32(i)*.48;a+=(h-field(p+n*h))*weight;weight*=.55;}return clamp(1.0-a*.38,.25,1.0);}
fn rockColor(p:vec3f,n:vec3f)->vec3f{
 let grain=noise(p*8.0);let broadNoise=noise(p*.43)+.45*noise(p*1.8);
 let bedding=p.y+noise(vec3f(p.x*.12,0,p.z*.12))*.4;
 let bands=.5+.5*sin(bedding*3.4+.4*sin(bedding*1.1));
 let thin=pow(.5+.5*sin(bedding*17.0+noise(p*2.0)*1.7),12.0);
 var c=mix(vec3f(.37,.135,.064),vec3f(.72,.33,.14),.37+broadNoise*.31);
 c=mix(c,c*vec3f(.74,.70,.65),bands*u.surface.x*.35);
 c*=1.0-thin*.20*u.surface.x;
 c+=vec3f(.055,.04,.028)*(grain-.5)*u.surface.y;
 let top=smoothstep(.55,.96,n.y);c=mix(c,vec3f(.64,.37,.185)*( .9+broadNoise*.12),top*.67);
 let streak=noise(vec3f(p.x*3.3,p.y*.13,p.z*3.3));c*=.79+.28*streak;
 let fractures=pow(1.0-abs(noise(p*vec3f(2.8,.24,2.8))*2.0-1.0),18.0);c*=1.0-fractures*.22*u.surface.y;
 if(u.extra.x>0.5){c=vec3f(.58,.55,.47);}
 return c;
}
fn sky(rd:vec3f)->vec3f{return mix(vec3f(.58,.60,.53),vec3f(.31,.40,.39),smoothstep(-.1,.8,rd.y));}
struct VertexOut{@builtin(position) position:vec4f,@location(0) uv:vec2f}
@vertex fn vertex(@builtin(vertex_index) i:u32)->VertexOut{var positions=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3));var o:VertexOut;o.position=vec4f(positions[i],0,1);o.uv=positions[i];return o;}
@fragment fn fragment(in:VertexOut)->@location(0) vec4f{
 let uv=in.uv;
 let forward=normalize(u.lookAt.xyz-u.eye.xyz);let right=normalize(cross(forward,vec3f(0,1,0)));let up=cross(right,forward);
 let rd=normalize(forward+right*uv.x*u.lookAt.w*.62+up*uv.y*.62);let ro=u.eye.xyz;
 let angle=u.light.x*.0174533;let sun=normalize(vec3f(cos(angle),.85,sin(angle)));
 var t=trace(ro,rd);let floorT=(-1.6-ro.y)/rd.y;var color=sky(rd);var hit=false;
 if(t<150.0){
  hit=true;let p=ro+rd*t;let geo=normalAt(p);let n=materialNormal(p,geo);let sh=shadow(p+geo*.17,sun);let ao=ambient(p,geo);
  let diffuse=max(dot(n,sun),0.0);
  let bounce=max(-n.y,0.0)*vec3f(.13,.075,.035);
  color=rockColor(p,n)*(vec3f(.25,.28,.27)*ao+vec3f(1.05,.91,.70)*diffuse*sh+bounce);
  // A gentle rim keeps back-facing stratigraphy readable.
  color+=rockColor(p,n)*pow(1.0-max(dot(n,-rd),0.0),3.0)*.09;
  if(u.brush.w>0.0){let dist=distance(p,u.brush.xyz);let ring=1.0-smoothstep(.04,.12,abs(dist-u.brush.w));color=mix(color,vec3f(1.0,.62,.28),ring*.8);color+=vec3f(.07,.025,.006)*(1.0-smoothstep(0.0,u.brush.w,dist));}
 }else if(floorT>0.0){
  t=floorT;hit=true;let p=ro+rd*t;let tex=noise(p*2.0)*.025+noise(p*.15)*.045;
  let sh=shadow(p+vec3f(0,.12,0),sun);
  color=(vec3f(.49,.445,.345)+tex)*(.56+.44*sh);
  let grid=min(abs(fract(p.x*.1+.5)-.5),abs(fract(p.z*.1+.5)-.5));
  let outside=smoothstep(18.0,26.0,max(abs(p.x),abs(p.z)));
  color*=1.0-(1.0-smoothstep(.001,.012,grid))*.09*outside;
 }
 if(u.light.w>.5 && rd.y<-.001){
  let tw=(u.light.z-ro.y)/rd.y;let p=ro+rd*tw;
  let center=2.5*sin(p.z*.15)+sin(p.z*.36+1.0);
  var wet=abs(p.x-center)<4.6+u.light.z*.12 && abs(p.z)<16.7;
  if(u.extra.y>0.5){wet=length(p.xz-vec2f(1,1))<8.0;}
  if(tw>0.0&&tw<t&&wet&&field(p)>.015){
   let time=u.eye.w;let ripple=u.surface.w;
   let wave=sin(p.x*3.1+p.z*1.4+time*.8)+.45*sin(p.z*6.3-p.x*2.0-time*.7);
   let n=normalize(vec3f(cos(p.x*3.1+p.z*1.4+time*.8)*ripple*.10,1.0,cos(p.z*6.3-p.x*2.0-time*.7)*ripple*.07));
   let fresnel=.035+.55*pow(1.0-max(dot(n,-rd),0.0),5.0);
   let depth=min(max(t-tw,0.0),8.0);let transmission=exp(-depth*(.35+(1.0-u.surface.z)*1.4));
   let sh=shadow(p+vec3f(0,.1,0),sun);
   let water=vec3f(.12,.26,.23)*(.65+.35*sh);
   color=mix(water,color,transmission*.6);
   color=mix(color,sky(reflect(rd,n)),fresnel);
   let spec=pow(max(dot(reflect(-sun,n),-rd),0.0),140.0);color+=vec3f(1,.88,.64)*spec*sh*.7;
   color+=wave*.004*ripple;
   let shore=1.0-smoothstep(.03,.22,field(p));color=mix(color,vec3f(.64,.65,.48),shore*.20);
   t=tw;hit=true;
  }
 }
 if(hit){let fog=1.0-exp(-t*t*(.000016+u.light.y*.000023));color=mix(color,vec3f(.58,.60,.52),min(.83,fog));}
 color=color/(color+vec3f(.78));color=pow(color,vec3f(.4545));
 let vignette=1.0-.13*dot(uv*.65,uv*.65);color*=vignette;
 let dither=(hash(vec3f(in.position.xy,u.eye.w))-.5)/255.0;
 return vec4f(color+dither,1);
}
`;

export const pickWGSL = /* wgsl */ `
struct Pick { origin:vec4f, direction:vec4f }
@group(0) @binding(0) var volume:texture_3d<f32>;
@group(0) @binding(1) var filtering:sampler;
@group(0) @binding(2) var<uniform> p:Pick;
@group(0) @binding(3) var<storage,read_write> result:vec4f;
fn field(q:vec3f)->f32{return textureSampleLevel(volume,filtering,clamp((q-vec3f(-22,-4,-20))/vec3f(44,26,40),vec3f(0),vec3f(1)),0).x;}
@compute @workgroup_size(1) fn main(){
 let a=(vec3f(-22,-4,-20)-p.origin.xyz)/p.direction.xyz;let b=(vec3f(22,22,20)-p.origin.xyz)/p.direction.xyz;
 let n=min(a,b);let f=max(a,b);var t=max(0.0,max(max(n.x,n.y),n.z));let end=min(min(f.x,f.y),f.z);result=vec4f(0);
 for(var i=0;i<240;i++){if(t>end){return;}let q=p.origin.xyz+p.direction.xyz*t;let d=field(q);if(d<.075){result=vec4f(q,1);return;}t+=max(.035,d*.65);}
}
`;

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
in vec2 vUv;
out vec4 fragColor;
const vec3 low=vec3(-22,-4,-20),high=vec3(22,22,20);
float field(vec3 p){vec3 uv=(p-low)/(high-low);return texture(volume,clamp(uv,vec3(.0001),vec3(.9999))).x+length(max(max(low-p,p-high),vec3(0)));}
float hash(vec3 p){vec3 q=fract(p*.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
float noise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
vec3 normalAt(vec3 p){float e=.13;return normalize(vec3(field(p+vec3(e,0,0))-field(p-vec3(e,0,0)),field(p+vec3(0,e,0))-field(p-vec3(0,e,0)),field(p+vec3(0,0,e))-field(p-vec3(0,0,e))));}
vec3 materialNormal(vec3 p,vec3 n){vec3 q=p*5.;float e=.12;vec3 g=vec3(noise(q+vec3(e,0,0))-noise(q-vec3(e,0,0)),noise(q+vec3(0,e,0))-noise(q-vec3(0,e,0)),noise(q+vec3(0,0,e))-noise(q-vec3(0,0,e)))/.24;return normalize(n-(g-n*dot(n,g))*surface.y*.72);}
vec2 boxRange(vec3 ro,vec3 rd){vec3 a=(low-ro)/rd,b=(high-ro)/rd,n=min(a,b),f=max(a,b);return vec2(max(max(n.x,n.y),n.z),min(min(f.x,f.y),f.z));}
float trace(vec3 ro,vec3 rd){vec2 range=boxRange(ro,rd);float t=max(0.,range.x);if(t>range.y)return 200.;for(int i=0;i<190;i++){float d=field(ro+rd*t);if(d<.065)return t;t+=max(.035,d*.65);if(t>range.y)break;}return 200.;}
float shadow(vec3 p,vec3 l){if(terrainShown<.5)return 1.;float t=.18,s=1.;for(int i=0;i<32;i++){float h=field(p+l*t);s=min(s,9.*h/t);t+=clamp(h,.16,1.6);if(h<.04||t>29.)break;}return clamp(s,0.,1.);}
float ambient(vec3 p,vec3 n){float a=0.,w=1.;for(int i=1;i<=4;i++){float h=float(i)*.48;a+=(h-field(p+n*h))*w;w*=.55;}return clamp(1.-a*.38,.25,1.);}
vec3 rockColor(vec3 p,vec3 n){float grain=noise(p*8.),broadNoise=noise(p*.43)+.45*noise(p*1.8),bedding=p.y+noise(vec3(p.x*.12,0,p.z*.12))*.4,bands=.5+.5*sin(bedding*3.4+.4*sin(bedding*1.1)),thin=pow(.5+.5*sin(bedding*17.+noise(p*2.)*1.7),12.);vec3 c=mix(vec3(.37,.135,.064),vec3(.72,.33,.14),.37+broadNoise*.31);c=mix(c,c*vec3(.74,.70,.65),bands*surface.x*.35);c*=1.-thin*.20*surface.x;c+=vec3(.055,.04,.028)*(grain-.5)*surface.y;float top=smoothstep(.55,.96,n.y);c=mix(c,vec3(.64,.37,.185)*(.9+broadNoise*.12),top*.67);float streak=noise(vec3(p.x*3.3,p.y*.13,p.z*3.3));c*=.79+.28*streak;
 float fractures=pow(1.-abs(noise(p*vec3(2.8,.24,2.8))*2.-1.),18.);c*=1.-fractures*.22*surface.y;if(extra.x>.5)c=vec3(.58,.55,.47);return c;}
vec3 sky(vec3 rd){return mix(vec3(.012),vec3(.005),smoothstep(-.1,.8,rd.y));}
${waterGLSL}
void main(){
 vec2 uv=vUv;vec3 forward=normalize(target.xyz-eye.xyz),right=normalize(cross(forward,vec3(0,1,0))),up=cross(right,forward),rd=normalize(forward+right*uv.x*target.w*.62+up*uv.y*.62),ro=eye.xyz;
 float angle=light.x*.0174533;vec3 sun=normalize(vec3(cos(angle),.85,sin(angle)));
 float t=terrainShown>.5?trace(ro,rd):200.,floorT=(-1.6-ro.y)/rd.y;vec3 color=sky(rd);bool hit=false;
 if(t<150.){hit=true;vec3 p=ro+rd*t,geo=normalAt(p),n=materialNormal(p,geo);float sh=shadow(p+geo*.17,sun),ao=ambient(p,geo),diffuse=max(dot(n,sun),0.);vec3 bounce=max(-n.y,0.)*vec3(.13,.075,.035);color=rockColor(p,n)*(vec3(.25,.28,.27)*ao+vec3(1.05,.91,.70)*diffuse*sh+bounce);color+=rockColor(p,n)*pow(1.-max(dot(n,-rd),0.),3.)*.09;
 if(brush.w>0.){float d=distance(p,brush.xyz),ring=1.-smoothstep(.04,.12,abs(d-brush.w));color=mix(color,vec3(1.,.62,.28),ring*.8);color+=vec3(.07,.025,.006)*(1.-smoothstep(0.,brush.w,d));}}
 else if(floorT>0.){t=floorT;hit=false;vec3 p=ro+rd*t;float tex=noise(p*2.)*.025+noise(p*.15)*.045,sh=shadow(p+vec3(0,.12,0),sun);color=(vec3(.012)+tex*.035)*(.56+.44*sh);float grid=min(abs(fract(p.x*.1+.5)-.5),abs(fract(p.z*.1+.5)-.5)),outside=smoothstep(18.,26.,max(abs(p.x),abs(p.z)));color*=1.-(1.-smoothstep(.001,.012,grid))*.09*outside;}
 if(shadeWater(ro,rd,sun,t,color))hit=true;
 if(hit){float fog=1.-exp(-t*t*(.000016+light.y*.000023));color=mix(color,vec3(.58,.60,.52),min(.83,fog));}
 color=color/(color+vec3(.78));color=pow(color,vec3(.4545));float vignette=1.-.13*dot(uv*.65,uv*.65);color*=vignette;float dither=(hash(vec3(gl_FragCoord.xy,eye.w))-.5)/255.;fragColor=vec4(color+dither,1);
}
`;
