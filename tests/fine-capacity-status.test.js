import test from 'node:test';
import assert from 'node:assert/strict';
import { fineCapacityStatus, fineCapacityText } from '../src/fine-capacity-status.js';
import { FineHydraulics } from '../src/fine-hydraulics.js';
test('capacity reporting distinguishes complete, blocked, and absent contacts without claiming erosion', () => {
  const result = fineCapacityStatus([0,0,0,1,0,0,0,0],
    [8,0,8,1, 6,2,8,1, 0,0,0,0, 8,0,8,1],3,2,16);
  assert.deepEqual(result,{bricks:1,capacity:2,selected:3,requested:2,missing:1,complete:1,iteration:16});
  assert.match(fineCapacityText(result),/1 contacts blocked/);
  assert.match(fineCapacityText({...result,missing:0}),/not erosion volume/);
  assert.match(fineCapacityText(null),/next hydraulic update/);
});
test('playback capacity monitoring is throttled and reads only keys and selected status rows', () => {
  const reads=[];
  const fine={solver:{tick:1,activeCount:1024},layout:{capacity:4096,keyWidth:64,keyHeight:64},pageTable:'keys',status:'status',
    read(texture,w,h){reads.push([texture,w,h]);return new Float32Array(w*h*4);}};
  const sample=now=>FineHydraulics.prototype.sampleCapacityStatus.call(fine,now);
  sample(0); assert.deepEqual(reads,[['keys',64,64],['status',256,4]]);
  fine.solver.tick=16;sample(3000);assert.equal(reads.length,2);
  fine.solver.tick=17;sample(1000);assert.equal(reads.length,2);
  sample(3000);assert.equal(reads.length,4);
  fine.solver.tick=33;fine.solver.activeCount=16384;sample(6000);
  assert.deepEqual(reads.at(-1),['status',256,64]);
});
