// Weakly-compressible 3D SPH. All neighbor queries and integration execute on the GPU.
struct Particle { p: vec4<f32>, v: vec4<f32> }
struct Params {
  domain: vec4<f32>, fluid: vec4<f32>, body: vec4<f32>, motion: vec4<f32>,
  poke: vec4<f32>, grid: vec4<u32>, settings: vec4<f32>, rock: vec4<f32>, damping:vec4<f32>
}
@group(0) @binding(0) var<uniform> u: Params;
@group(0) @binding(1) var<storage,read> src: array<Particle>;
@group(0) @binding(2) var<storage,read_write> dst: array<Particle>;
@group(0) @binding(3) var<storage,read_write> heads: array<atomic<u32>>;
@group(0) @binding(4) var<storage,read_write> links: array<u32>;
@group(0) @binding(5) var<storage,read_write> density: array<vec2<f32>>;
@group(0) @binding(6) var<storage,read_write> counters: array<atomic<u32>>;
@group(0) @binding(7) var<storage,read_write> neighbors:array<u32>;
struct CellBin {count:atomic<u32>, ids:array<u32,32>}
@group(0) @binding(8) var<storage,read_write> bins:array<CellBin>;
const NIL: u32 = 0xffffffffu;
const PI: f32 = 3.14159265359;
fn cell(p:vec3<f32>)->vec3<i32>{
  let q=vec3<i32>(floor((p+vec3<f32>(u.domain.x,0.,u.domain.y))/u.domain.w));
  return clamp(q,vec3<i32>(0),vec3<i32>(u.grid.xyz)-1);
}
fn key(c:vec3<i32>)->u32{return u32(c.x)+u.grid.x*(u32(c.y)+u.grid.y*u32(c.z));}
fn valid(c:vec3<i32>)->bool{return all(c>=vec3<i32>(0))&&all(c<vec3<i32>(u.grid.xyz));}
fn support(distance:f32)->f32 {let q=clamp(1.-distance/u.domain.w,0.,1.);return .5*u.fluid.y*q*q*q;}
@compute @workgroup_size(128)
fn clear(@builtin(global_invocation_id) id:vec3<u32>){
  if(id.x<u.grid.x*u.grid.y*u.grid.z){atomicStore(&heads[id.x],NIL);atomicStore(&bins[id.x].count,0u);}
}
@compute @workgroup_size(128)
fn build(@builtin(global_invocation_id) id:vec3<u32>){
  if(id.x>=u.grid.w){return;}
  let bin=key(cell(src[id.x].p.xyz));
  links[id.x]=atomicExchange(&heads[bin],id.x);
  let slot=atomicAdd(&bins[bin].count,1u);
  if(slot<32u){bins[bin].ids[slot]=id.x;}
}
@compute @workgroup_size(128)
fn densities(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=u.grid.w){return;}
  let p=src[i].p.xyz;let c=cell(p);let h=u.domain.w;let h2=h*h;
  let poly=315./(64.*PI*pow(h,9.));var rho=0.;var accepted=0u;
  for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
    let other=c+vec3<i32>(x,y,z);if(!valid(other)){continue;}
    let bin=key(other);let count=atomicLoad(&bins[bin].count);
    if(count<=32u){
      // Consecutive indices avoid the serial links[j] dependency for ordinary cells.
      for(var k=0u;k<count;k++){
        let j=bins[bin].ids[count-1u-k];
        let d=p-src[j].p.xyz;let q=max(0.,h2-dot(d,d));rho+=u.fluid.x*poly*q*q*q;
        if(q>0.&&j!=i){if(accepted<96u){neighbors[(accepted+1u)*u.grid.w+i]=j;}accepted++;}
      }
    }else{
      // No dropped particles: overflowing bins use the existing complete linked list.
      var j=atomicLoad(&heads[bin]);var visits=0u;
      loop {
        if(j==NIL){break;}if(visits>=256u){atomicAdd(&counters[0],1u);break;}visits++;
        let d=p-src[j].p.xyz;let q=max(0.,h2-dot(d,d));rho+=u.fluid.x*poly*q*q*q;
        if(q>0.&&j!=i){if(accepted<96u){neighbors[(accepted+1u)*u.grid.w+i]=j;}accepted++;}
        j=links[j];
      }
    }
  }}}
  neighbors[i]=accepted;
  // Approximate solid boundary kernel support. Contacts themselves are projected below.
  rho+=support(p.y)+support(u.domain.z-p.y);
  rho+=support(u.domain.x-abs(p.x))+support(u.domain.y-abs(p.z));
  rho+=support(length(p-u.rock.xyz)-u.rock.w);
  rho+=support(length(p-u.body.xyz)-u.body.w);
  rho=max(rho,u.fluid.y*.15);
  density[i]=vec2<f32>(rho,u.fluid.z*max(0.,rho-u.fluid.y));
}
fn sphereContact(p0:vec3<f32>,v0:vec3<f32>,sphere:vec4<f32>,wallVelocity:vec3<f32>)->Particle{
  var p=p0;var v=v0;let delta=p-sphere.xyz;let distance=length(delta);let radius=sphere.w+u.settings.x;
  if(distance<radius){
    let normal=select(vec3<f32>(0.,1.,0.),delta/max(distance,.00001),distance>.00001);
    p=sphere.xyz+normal*(radius+.0001);
    if(p.y<u.settings.x){
      p.y=u.settings.x;let horizontal=p.xz-sphere.xz;
      let r=sqrt(max(0.,radius*radius-(p.y-sphere.y)*(p.y-sphere.y)));
      let direction=select(vec2<f32>(1.,0.),horizontal/max(length(horizontal),.00001),length(horizontal)>.00001);
      let projected=sphere.xz+direction*(r+.0001);p.x=projected.x;p.z=projected.y;
    }
    var relative=v-wallVelocity;let vn=dot(relative,normal);
    if(vn<0.){relative-=(1.+u.settings.w)*vn*normal;}
    let tangent=relative-dot(relative,normal)*normal;
    v=relative-tangent*.035+wallVelocity;atomicAdd(&counters[2],1u);
  }
  return Particle(vec4<f32>(p,1.),vec4<f32>(v,0.));
}
struct PairTerms {force:vec3<f32>,smoothing:vec3<f32>}
fn pairTerms(j:u32,p:vec3<f32>,v:vec3<f32>,rho:f32,pressure:f32,h:f32,spiky:f32,poly:f32)->PairTerms{
  var result=PairTerms(vec3<f32>(0.),vec3<f32>(0.));
  let delta=p-src[j].p.xyz;let r=length(delta);
  if(r<h&&r>.00001){
          let q=h-r;let rj=density[j].x;let pj=density[j].y;
          let kernel=h*h-r*r;result.smoothing+=2.*u.fluid.x/(rho+rj)*poly*kernel*kernel*kernel*(src[j].v.xyz-v);
          result.force+=u.fluid.x*(pressure/(rho*rho)+pj/(rj*rj))*spiky*q*q*delta/r;
          result.force+=u.fluid.w*u.fluid.x/rj*spiky*q*(src[j].v.xyz-v);
          result.force-=u.settings.z*(q/h)*(q/h)*delta/r;
  }return result;
}
@compute @workgroup_size(128)
fn integrate(@builtin(global_invocation_id) id:vec3<u32>){
  let i=id.x;if(i>=u.grid.w){return;}
  var p=src[i].p.xyz;var v=src[i].v.xyz;let c=cell(p);let h=u.domain.w;
  let rho=density[i].x;let pressure=density[i].y;
  let spiky=45./(PI*pow(h,6.));var acceleration=vec3<f32>(0.,-u.settings.y,0.);
  var smoothing=vec3<f32>(0.);let poly=315./(64.*PI*pow(h,9.));
  let cached=neighbors[i];
  if(cached<=96u){
    for(var k=0u;k<cached;k++){
      let terms=pairTerms(neighbors[(k+1u)*u.grid.w+i],p,v,rho,pressure,h,spiky,poly);
      acceleration+=terms.force;smoothing+=terms.smoothing;
    }
  }else{
    // Never drop interactions when the cache overflows: use the exact original traversal.
    for(var z=-1;z<=1;z++){for(var y=-1;y<=1;y++){for(var x=-1;x<=1;x++){
      let other=c+vec3<i32>(x,y,z);if(!valid(other)){continue;}
      var j=atomicLoad(&heads[key(other)]);var visits=0u;
      loop{if(j==NIL||visits>=256u){break;}visits++;
        if(i!=j){let terms=pairTerms(j,p,v,rho,pressure,h,spiky,poly);acceleration+=terms.force;smoothing+=terms.smoothing;}
        j=links[j];
      }
    }}}
  }
  let jet=p-u.poke.xyz;let weight=exp(-dot(jet,jet)/.18);
  acceleration+=u.poke.w*weight*(vec3<f32>(0.,1.,0.)+vec3<f32>(jet.x,0.,jet.z)*1.4);
  v+=acceleration*u.motion.w+smoothing*(u.damping.x*u.motion.w/.002);
  let speed=length(v);if(speed>12.){v*=12./speed;atomicAdd(&counters[1],1u);}
  p+=v*u.motion.w;
  // Kinematic, moving solid body: contact impulses are relative to its velocity.
  var hit=sphereContact(p,v,u.rock,vec3<f32>(0.));p=hit.p.xyz;v=hit.v.xyz;
  for(var contact=0;contact<12;contact++){
    let bodyDelta=p-u.body.xyz;let headDelta=p-u.body.xyz-vec3<f32>(0.,.34,.17);
    let bodyRadius=u.body.w+u.settings.x;let headRadius=.24+u.settings.x;
    if(dot(bodyDelta,bodyDelta)>=bodyRadius*bodyRadius&&dot(headDelta,headDelta)>=headRadius*headRadius){break;}
    hit=sphereContact(p,v,u.body,u.motion.xyz);p=hit.p.xyz;v=hit.v.xyz;
    hit=sphereContact(p,v,vec4<f32>(u.body.xyz+vec3<f32>(0.,.34,.17),.24),u.motion.xyz);p=hit.p.xyz;v=hit.v.xyz;
  }
  let lo=vec3<f32>(-u.domain.x+u.settings.x,u.settings.x,-u.domain.y+u.settings.x);
  let hi=vec3<f32>(u.domain.x-u.settings.x,u.domain.z-u.settings.x,u.domain.y-u.settings.x);
  for(var axis=0;axis<3;axis++){
    if(p[axis]<lo[axis]){p[axis]=lo[axis];v[axis]=abs(v[axis])*u.settings.w;atomicAdd(&counters[2],1u);}
    if(p[axis]>hi[axis]){p[axis]=hi[axis];v[axis]=-abs(v[axis])*u.settings.w;atomicAdd(&counters[2],1u);}
  }
  // Floor projection can lift a previously outside particle into the submerged rock.
  hit=sphereContact(p,v,u.rock,vec3<f32>(0.));p=hit.p.xyz;v=hit.v.xyz;
  let badP=any((bitcast<vec3<u32>>(p)&vec3<u32>(0x7f800000u))==vec3<u32>(0x7f800000u));
  let badV=any((bitcast<vec3<u32>>(v)&vec3<u32>(0x7f800000u))==vec3<u32>(0x7f800000u));
  if(badP||badV||any(abs(p)>vec3<f32>(100.))){
    p=vec3<f32>(0.,1.5,0.);v=vec3<f32>(0.);atomicAdd(&counters[3],1u);
  }
  dst[i]=Particle(vec4<f32>(p,rho/u.fluid.y),vec4<f32>(v,0.));
}
