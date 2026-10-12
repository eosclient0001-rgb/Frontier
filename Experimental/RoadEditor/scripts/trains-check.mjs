// Headless check of the train system: builds the reference city's routes and consists, steps them
// for a while, and reports how many cars are placed and whether each car sits on its route
// (distance from the route centreline ≈ the consist's track offset).
import * as THREE from 'three';
import { generateCity } from '../src/road/cityGen.js';
import { NetworkBuilder } from '../src/road/builder.js';
import { TrainSystem } from '../src/render/trains.js';
import { sampleRoute } from '../src/road/routes.js';

const net = generateCity({});
const b = new NetworkBuilder(net);
await b.buildAll();
const scene = new THREE.Scene();
const PM = { vcol: new THREE.MeshBasicMaterial(), glass: new THREE.MeshBasicMaterial() };
const ts = new TrainSystem(scene, PM);
ts.setNetwork(net);
ts.update(0.3);            // triggers the deferred rebuild
ts.update(0.3);
console.log('routes', ts.routes.length, 'consists', ts.consists.length, 'cars', ts.consists.reduce((a, c) => a + c.cars.length, 0));
for (let t = 0; t < 600; t++) ts.update(1 / 30);
let placed = 0, worst = 0, count = 0;
for (const c of ts.consists) {
  for (let k = 0; k < c.cars.length; k++) {
    if (!c.cars[k].visible) continue;
    placed++;
    const p = c.cars[k].position;
    // distance from the car to the route's centreline
    const r = c.route; let best = Infinity;
    for (let i = 0; i < r.X.length; i += 4) { const d = Math.hypot(r.X[i] - p.x, r.Z[i] - p.z); if (d < best) best = d; }
    if (c.fam !== 'monorail') { worst = Math.max(worst, best); count++; }
  }
}
console.log('placed cars', placed, 'max car distance from route (non-monorail)', worst.toFixed(2));
for (const c of ts.consists) console.log(c.fam.padEnd(9), 'len', c.route.length.toFixed(0), 'lat', c.lat, 'speed', (c.speed).toFixed(1), 's', c.s.toFixed(0), 'dir', c.dir, 'loop', c.route.loop);
