import test from 'node:test';
import assert from 'node:assert/strict';
import { validate, sample, flux, spotProfile, readIES, writeIES } from './photometry.mjs';

test('constant candela integrates to 4πI lumens',()=>{const p=[{angle:0,cd:100},{angle:180,cd:100}];assert.ok(Math.abs(flux(p)-400*Math.PI)<.001);});
test('spot profile includes exact narrow cone edges and interpolates',()=>{const p=spotProfile(1000,1,3);assert.equal(sample(p,1),1000);assert.equal(sample(p,3),0);assert.ok(sample(p,2)>0);});
test('IES output roundtrips absolute axisymmetric candela',()=>{const p=[{angle:0,cd:1200},{angle:30,cd:450},{angle:180,cd:0}];assert.deepEqual(readIES(writeIES(p,'Test')),p);});
test('candela multiplier is applied on import',()=>{const text=writeIES([{angle:0,cd:10},{angle:180,cd:0}]).replace('1 -1 1 2 1 1 2','1 -1 2 2 1 1 2');assert.equal(readIES(text)[0].cd,20);});
test('reject unsupported asymmetry, tilt, invalid and incomplete data',()=>{const text=writeIES([{angle:0,cd:10},{angle:180,cd:0}]);assert.throws(()=>readIES(text.replace('TILT=NONE','TILT=INCLUDE')));assert.throws(()=>readIES(text.replace('1 -1 1 2 1 1 2','1 -1 1 2 2 1 2')));assert.throws(()=>readIES(text.replace('10 0\n','10\n')));assert.throws(()=>validate([{angle:0,cd:1},{angle:180,cd:-1}]));});
