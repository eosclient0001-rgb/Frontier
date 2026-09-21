// CPU checks of parameter scaling and initialization only; GPU dispatch is tested separately.
import assert from 'node:assert/strict';
import {GPUSPH} from '../gpu-sph.mjs';
for(const dims of [[5,3.4],[7.5,5],[10,6.8],[14,10],[5,10],[14,3.4],[30,20],[100,100],[300,200]])for(const count of [6144,12000,24000,48000,96000]){
 let seed;const device={queue:{writeBuffer(buffer,offset,data){if(data.length===count*8)seed=data.slice();}}};
 const s=new GPUSPH(device,count,dims);s.buffers=[{},{}];s.counters={};s.reset();
 assert.equal(seed.length,count*8);assert(Math.abs(s.mass*count/(dims[0]*dims[1])-1000*6144*.12**3/17)<1e-8);
 for(let i=0;i<count;i++){
  const k=i*8,x=seed[k],y=seed[k+1],z=seed[k+2];assert(Number.isFinite(x+y+z));assert(Math.abs(x)<dims[0]/2-s.radius);assert(Math.abs(z)<dims[1]/2-s.radius);assert(y>=s.radius&&y<=s.domain[2]-s.radius);
  for(const o of [s.body,s.rock,[s.body[0],s.body[1]+.34,s.body[2]+.17,.24]])assert(Math.hypot(x-o[0],y-o[1],z-o[2])>=o[3]+s.radius-1e-6);
 }
 console.log('PASS',dims.join(' × '),count,'seeded, bounded, constant nominal depth');
}
for(const dims of [[NaN,5],[4,5],[5,Infinity],[5,3]])assert.throws(()=>new GPUSPH({},6144,dims));
console.log('PASS invalid dimensions rejected');
