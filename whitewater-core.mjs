import {FoamField} from './foam-field.mjs?v=20260918-startup4';
export const SPRAY=0,FOAM=1;
const FIELDS=['x','y','z','vx','vy','vz','age','life','size','kind','seed'];
// Only airborne droplets remain particles. All surface foam is a bounded scalar field.
export class Whitewater {
  constructor(capacity=512){
    this.capacity=capacity;for(const name of FIELDS)this[name]=new Float32Array(capacity);
    this.foam=new FoamField(128);this.limit=Math.min(256,capacity);this.foamEnabled=true;this.sprayEnabled=true;this.crestEnabled=true;this.amount=1;this.foamLife=5;this.reset();
  }
  reset(){this.count=0;this.time=0;this.randomState=1927;this.spawned=0;this.landed=0;this.dropped=0;this.crowns=[];this.foam.clear();}
  random(){this.randomState=(1664525*this.randomState+1013904223)>>>0;return this.randomState/4294967296;}
  remove(i){const last=--this.count;for(const key of FIELDS)this[key][i]=this[key][last];}
  clearKind(kind){if(kind===FOAM)this.foam.clear();else this.count=0;}
  setLimit(limit){this.limit=Math.max(16,Math.min(this.capacity,Math.floor(limit)));this.count=Math.min(this.count,this.limit);}
  emit(kind,x,y,z,vx,vy,vz,size,life){
    if(kind!==SPRAY||!this.sprayEnabled)return false;
    if(this.count>=this.limit){this.dropped++;return false;}
    const i=this.count++;this.x[i]=x;this.y[i]=y;this.z[i]=z;this.vx[i]=vx;this.vy[i]=vy;this.vz[i]=vz;
    this.size[i]=size;this.life[i]=life;this.age[i]=0;this.kind[i]=SPRAY;this.seed[i]=this.random();this.spawned++;return true;
  }
  burst(solver,x,z,level,strength=1,crown=true){
    if(!solver.isWet(x,z,.12))return;
    this.foam.configure(solver);const power=Math.max(.1,Math.min(1.5,strength));
    for(let i=0;i<Math.floor(34*power*this.amount);i++){
      const a=this.random()*Math.PI*2,r=.1+this.random()*.2,px=x+Math.cos(a)*r,pz=z+Math.sin(a)*r;
      if(!solver.isWet(px,pz,.02))continue;
      const v=(.3+this.random()*1.6)*Math.sqrt(power);
      this.emit(SPRAY,px,level+solver.sample(px,pz)+.06,pz,Math.cos(a)*v,(1.5+this.random()*2.7)*Math.sqrt(power),Math.sin(a)*v,.019+this.random()*.023,2.5);
    }
    if(this.foamEnabled){
      this.foam.splat(x,z,.46,.38,.3,.95*this.amount);
      for(let i=0;i<6;i++){
        const a=this.random()*6.28,r=.18+this.random()*.38;
        this.foam.splat(x+Math.cos(a)*r,z+Math.sin(a)*r,.18+this.random()*.26,.14+this.random()*.14,a,.65*power*this.amount);
      }
    }
    if(crown&&this.sprayEnabled&&this.crowns.length<4)this.crowns.push({x,z,age:0,life:.75,scale:power,phase:this.random()*6.28});
  }
  wake(solver,body,level){
    const speed=Math.hypot(body.vx,body.vz);if(speed<.25)return;this.foam.configure(solver);
    const ux=body.vx/speed,uz=body.vz/speed,angle=Math.atan2(uz,ux);
    if(this.foamEnabled)for(const side of [-1,1]){
      this.foam.splat(body.x-ux*.4-uz*.31*side,body.z-uz*.4+ux*.31*side,.33,.14,angle,.45*this.amount);
    }
    if(speed>1.1){
      const x=body.x-ux*.35,z=body.z-uz*.35;
      this.emit(SPRAY,x,level+solver.sample(x,z)+.08,z,body.vx*.15,.8+this.random()*.7,body.vz*.15,.02+this.random()*.016,1.5);
    }
  }
  update(solver,dt,level){
    if(!(dt>0)||!Number.isFinite(dt))return;this.time+=dt;this.foam.configure(solver);
    for(let i=this.count-1;i>=0;i--){
      this.age[i]+=dt;if(this.age[i]>=this.life[i]||!this.sprayEnabled){this.remove(i);continue;}
      const drag=Math.exp(-.3*dt);this.vx[i]*=drag;this.vz[i]*=drag;this.vy[i]=(this.vy[i]-9.81*dt)*drag;
      const x=this.x[i]+this.vx[i]*dt,z=this.z[i]+this.vz[i]*dt;
      if(!solver.isWet(x,z,.015)){this.remove(i);continue;}
      this.x[i]=x;this.z[i]=z;this.y[i]+=this.vy[i]*dt;
      if(this.y[i]<=level+solver.sample(x,z)+.015&&this.vy[i]<0){
        if(this.foamEnabled)this.foam.splat(x,z,.11,.10,this.seed[i]*6.28,.38*this.amount);
        this.landed++;this.remove(i);
      }
    }
    for(let i=this.crowns.length-1;i>=0;i--){this.crowns[i].age+=dt;if(this.crowns[i].age>=this.crowns[i].life||!this.sprayEnabled)this.crowns.splice(i,1);}
    if(this.foamEnabled){this.foam.halfLife=this.foamLife;this.foam.update(solver,dt,this.crestEnabled,this.amount);}
  }
  stats(){return {foam:this.foam.activeCells,foamArea:this.foam.area,foamResolution:[this.foam.nx,this.foam.nz],foamUpdates:this.foam.updates,foamBytes:this.foam.pixels.byteLength,spray:this.count,total:this.count,limit:this.limit,spawned:this.spawned,landed:this.landed,dropped:this.dropped,crowns:this.crowns.length};}
}
