// Bounded, deterministic secondary effects. Never writes into the water solver.
export const SPRAY=0, FOAM=1;
const FIELDS=['x','y','z','vx','vy','vz','age','life','size','kind','seed'];
export class Whitewater {
  constructor(capacity=6000){
    this.capacity=capacity;for(const name of FIELDS)this[name]=new Float32Array(capacity);
    this.limit=capacity;this.foamEnabled=true;this.sprayEnabled=true;this.crestEnabled=true;
    this.amount=1;this.foamLife=7;this.reset();
  }
  reset(){this.count=0;this.time=0;this.scanTime=0;this.randomState=1927;this.spawned=0;this.landed=0;this.dropped=0;this.crowns=[];this.cooldown=new Map();this.crestSources=0;}
  random(){this.randomState=(1664525*this.randomState+1013904223)>>>0;return this.randomState/4294967296;}
  remove(i){const last=--this.count;for(const name of FIELDS)this[name][i]=this[name][last];}
  clearKind(kind){for(let i=this.count-1;i>=0;i--)if(this.kind[i]===kind)this.remove(i);}
  setLimit(limit){this.limit=Math.max(100,Math.min(this.capacity,Math.floor(limit)));while(this.count>this.limit)this.remove(this.count-1);}
  emit(kind,x,y,z,vx,vy,vz,size,life){
    if((kind===FOAM&&!this.foamEnabled)||(kind===SPRAY&&!this.sprayEnabled))return false;
    if(this.count>=this.limit){this.dropped++;return false;}
    const i=this.count++;Object.entries({x,y,z,vx,vy,vz,size,life,kind,age:0,seed:this.random()}).forEach(([key,value])=>this[key][i]=value);
    this.spawned++;return true;
  }
  burst(solver,x,z,level,strength=1,crown=true){
    if(!solver.isWet(x,z,.12))return;
    const power=Math.max(.1,Math.min(1.5,strength));
    const total=Math.floor(170*power*this.amount);
    for(let i=0;i<total;i++){
      const angle=this.random()*Math.PI*2,r=.10+this.random()*.23;
      const px=x+Math.cos(angle)*r,pz=z+Math.sin(angle)*r;if(!solver.isWet(px,pz,.03))continue;
      const speed=(.4+this.random()*1.8)*Math.sqrt(power);
      const vy=(1.6+this.random()*2.6)*Math.sqrt(power);
      this.emit(SPRAY,px,level+solver.sample(px,pz)+.06,pz,Math.cos(angle)*speed,vy,Math.sin(angle)*speed,.013+this.random()*.026,2.6);
    }
    for(let i=0;i<Math.floor(36*power*this.amount);i++){
      const angle=this.random()*Math.PI*2,r=.20+this.random()*.3,px=x+Math.cos(angle)*r,pz=z+Math.sin(angle)*r;
      if(solver.isWet(px,pz,.03))this.emit(FOAM,px,level+solver.sample(px,pz)+.02,pz,Math.cos(angle)*.15,0,Math.sin(angle)*.15,.055+this.random()*.075,this.foamLife*(.6+this.random()*.8));
    }
    if(crown&&this.sprayEnabled&&this.crowns.length<16)this.crowns.push({x,z,age:0,life:.75,scale:power,phase:this.random()*6.28});
  }
  wake(solver,body,level){
    const speed=Math.hypot(body.vx,body.vz);if(speed<.25)return;
    const ux=body.vx/speed,uz=body.vz/speed;
    for(let i=0;i<Math.floor(14*this.amount);i++){
      const side=(i%2?1:-1),r=.2+this.random()*.3;
      const x=body.x-ux*.45-uz*r*side,z=body.z-uz*.45+ux*r*side;
      if(!solver.isWet(x,z,.02))continue;
      const y=level+solver.sample(x,z)+.025;
      this.emit(FOAM,x,y,z,-ux*.2-uz*side*.15,0,-uz*.2+ux*side*.15,.045+this.random()*.07,this.foamLife*(.65+this.random()*.5));
      if(i<4&&speed>.9)this.emit(SPRAY,x,y+.07,z,body.vx*.2-uz*side*.25,.6+this.random()*.8,body.vz*.2+ux*side*.25,.018+this.random()*.018,1.5);
    }
  }
  scanCrests(solver,level){
    if(!this.crestEnabled||(!this.foamEnabled&&!this.sprayEnabled)||this.count>=this.limit)return;
    const step=.38,nx=Math.floor(solver.width/step),nz=Math.floor(solver.size/step);
    // Local density limiter avoids layering thousands of opaque foam sprites.
    const density=new Map();
    for(let i=0;i<this.count;i++)if(this.kind[i]===FOAM){const key=Math.floor((this.x[i]+solver.width/2)/step)+':'+Math.floor((this.z[i]+solver.size/2)/step);density.set(key,(density.get(key)||0)+1);}
    for(let j=0;j<nz;j++)for(let i=0;i<nx;i++){
      const x=(i+.5)*step-solver.width/2,z=(j+.5)*step-solver.size/2,key=i+':'+j;
      if((this.cooldown.get(key)||0)>this.time||(density.get(key)||0)>7||!solver.isWet(x,z,.12))continue;
      const ix=Math.max(1,Math.min(solver.nx-2,Math.round((x+solver.width/2)/solver.dx)));
      const iz=Math.max(1,Math.min(solver.n-2,Math.round((z+solver.size/2)/solver.dz))),k=iz*solver.nx+ix;
      if(solver.solid[k]||solver.solid[k-1]||solver.solid[k+1]||solver.solid[k-solver.nx]||solver.solid[k+solver.nx])continue;
      const v=solver.velocity[k];if(Math.abs(v)<.12)continue;
      const h=solver.height,dx=solver.dx,dz=solver.dz;
      const gx=(h[k+1]-h[k-1])/(2*dx),gz=(h[k+solver.nx]-h[k-solver.nx])/(2*dz),slope=Math.hypot(gx,gz);
      const curvature=Math.abs((h[k+1]+h[k-1]-2*h[k])/(dx*dx)+(h[k+solver.nx]+h[k-solver.nx]-2*h[k])/(dz*dz));
      // Motion + shape gating: neither a static mound nor calm water emits.
      if(slope<.16||curvature<.65)continue;
      this.cooldown.set(key,this.time+.22);this.crestSources++;
      const count=Math.min(5,Math.ceil((slope+.2)*Math.abs(v)*10*this.amount));
      for(let q=0;q<count;q++){
        const px=x+(this.random()-.5)*step,pz=z+(this.random()-.5)*step;
        if(!solver.isWet(px,pz,.02))continue;
        const y=level+solver.sample(px,pz)+.025;
        const denom=gx*gx+gz*gz+.15,fx=Math.max(-1,Math.min(1,-v*gx/denom)),fz=Math.max(-1,Math.min(1,-v*gz/denom));
        this.emit(FOAM,px,y,pz,fx*.25,0,fz*.25,.04+this.random()*.08,this.foamLife*(.55+this.random()*.75));
        if(v>.45&&slope>.3&&q===0)this.emit(SPRAY,px,y+.035,pz,fx,.5+Math.min(2,v),fz,.018+this.random()*.018,2);
      }
    }
  }
  update(solver,dt,level){
    if(!(dt>0))return;
    this.time+=dt;this.scanTime+=dt;
    for(let i=this.count-1;i>=0;i--){
      this.age[i]+=dt;
      if(this.age[i]>=this.life[i]||(this.kind[i]===FOAM&&!this.foamEnabled)||(this.kind[i]===SPRAY&&!this.sprayEnabled)){this.remove(i);continue;}
      if(this.kind[i]===SPRAY){
        const drag=Math.exp(-.3*dt);this.vx[i]*=drag;this.vz[i]*=drag;this.vy[i]=(this.vy[i]-9.81*dt)*drag;
        const x=this.x[i]+this.vx[i]*dt,z=this.z[i]+this.vz[i]*dt;
        if(!solver.isWet(x,z,.015)){this.remove(i);continue;}
        this.x[i]=x;this.z[i]=z;this.y[i]+=this.vy[i]*dt;
        const surface=level+solver.sample(x,z);
        if(this.y[i]<=surface+.015&&this.vy[i]<0){
          if(!this.foamEnabled){this.remove(i);continue;}
          this.kind[i]=FOAM;this.y[i]=surface+.022;this.vx[i]*=.25;this.vz[i]*=.25;this.vy[i]=0;
          this.size[i]=.045+this.random()*.07;this.age[i]=0;this.life[i]=this.foamLife*(.65+this.random()*.65);this.landed++;
        }
      }else{
        const g=solver.gradient(this.x[i],this.z[i]);
        const vertical=solver.sampleField(solver.velocity,this.x[i],this.z[i]);
        const denom=g.x*g.x+g.z*g.z+.16;
        // A local phase-motion proxy, NOT a full horizontal liquid velocity field.
        const fx=Math.max(-.7,Math.min(.7,-vertical*g.x/denom))*.3;
        const fz=Math.max(-.7,Math.min(.7,-vertical*g.z/denom))*.3;
        const blend=1-Math.exp(-2*dt);this.vx[i]+=(fx-this.vx[i])*blend;this.vz[i]+=(fz-this.vz[i])*blend;
        const x=this.x[i]+this.vx[i]*dt,z=this.z[i]+this.vz[i]*dt;
        if(solver.isWet(x,z,.025)){this.x[i]=x;this.z[i]=z;}else{this.vx[i]*=-.1;this.vz[i]*=-.1;}
        this.y[i]=level+solver.sample(this.x[i],this.z[i])+.022;
      }
    }
    for(let i=this.crowns.length-1;i>=0;i--){this.crowns[i].age+=dt;if(this.crowns[i].age>=this.crowns[i].life||!this.sprayEnabled)this.crowns.splice(i,1);}
    if(this.scanTime>=.08){this.scanTime-=.08;this.scanCrests(solver,level);}
  }
  stats(){let foam=0,spray=0;for(let i=0;i<this.count;i++)this.kind[i]===FOAM?foam++:spray++;return {foam,spray,total:this.count,limit:this.limit,spawned:this.spawned,landed:this.landed,crestSources:this.crestSources,dropped:this.dropped,crowns:this.crowns.length};}
}
