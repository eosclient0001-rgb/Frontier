import assert from 'node:assert/strict';
import {GPUSPH,PRESETS} from '../gpu-sph.mjs';
import {particleSpacingFor} from '../gpu-particle-size.mjs';
for(const dimensions of [[5,3.4],[7.5,5],[30,20],[100,100]]){
 let diameter=Infinity,volume=null;
 for(const count of Object.keys(PRESETS).map(Number)){
  const s=new GPUSPH({},count,dimensions);
  assert.equal(s.spacing,particleSpacingFor(count,dimensions));
  assert(s.radius*2<diameter);diameter=s.radius*2;
  const current=s.mass*count/1000;if(volume!==null)assert(Math.abs(current-volume)<1e-8);volume=current;
 }
}
let allocated=false;
const smallDevice={limits:{maxStorageBufferBindingSize:16*1024*1024,maxBufferSize:256*1024*1024,maxComputeWorkgroupsPerDimension:65535},createBuffer(){allocated=true;throw new Error('Unexpected allocation');}};
await assert.rejects(GPUSPH.create(smallDevice,96000,[7.5,5]),/particle size needs more buffer/);
assert.equal(allocated,false);
console.log('PASS monotonic physical size, nominal volume, shared size labels and pre-allocation device limit check');
