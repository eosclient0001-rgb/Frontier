import {performance} from 'node:perf_hooks';
import {SurfaceSolver} from '../solver.mjs';
import {Whitewater as Old,FOAM} from './fixtures/particle-foam-reference.mjs';
import {Whitewater as Current} from '../whitewater-core.mjs';
const water=new SurfaceSolver(96,8,12);water.disturb(0,0,.5,.3);
function oldCase(n){const fx=new Old(12000);fx.crestEnabled=false;fx.foamLife=10000;
 for(let i=0;i<n;i++){let x=(i%100)/100*11-5.5,z=Math.floor(i/100)/(n/100)*7-3.5;if(!water.isWet(x,z,.05)){x=0;z=0;}fx.emit(FOAM,x,.67,z,0,0,0,.08,10000);}return fx;}
function newCase(n){const fx=new Current(512);fx.crestEnabled=false;fx.foamLife=10000;fx.foam.configure(water);for(let i=0;i<n;i++){const x=(i%100)/100*11-5.5,z=Math.floor(i/100)/(n/100)*7-3.5;fx.foam.splat(x,z,.10,.10,0,.6);}return fx;}
function measure(make){const times=[];for(let pass=0;pass<7;pass++){const fx=make();for(let i=0;i<45;i++)fx.update(water,1/90,.65);const start=performance.now();for(let i=0;i<180;i++)fx.update(water,1/90,.65);times.push((performance.now()-start)/180);}times.sort((a,b)=>a-b);return times[3];}
const results=[];for(const n of [1000,6000]){const old=measure(()=>oldCase(n)),current=measure(()=>newCase(n));results.push({deposits:n,oldMsPerPhysicsStep:+old.toFixed(4),fieldMsPerPhysicsStep:+current.toFixed(4),speedup:+(old/current).toFixed(2)});}
console.log(JSON.stringify({note:'Node CPU simulation only; seeded coverage workloads, not a GPU/frame-rate benchmark. Median of 7 runs, 180 steps/run, 90 Hz.',node:process.version,field:'128 x 85 at 20 Hz',results},null,2));
