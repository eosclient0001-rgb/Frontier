import { WgslReflect } from 'wgsl_reflect';
const src = `struct P { a: f32, b: u32, }
@group(0) @binding(0) var<uniform> p: P;
@group(0) @binding(1) var vol: texture_storage_3d<r32float, write>;
@group(0) @binding(2) var src3: texture_3d<f32>;
@compute @workgroup_size(4,4,4) fn main(@builtin(global_invocation_id) gid: vec3u) {
  let v = textureLoad(src3, vec3i(gid), 0).r;
  textureStore(vol, vec3i(gid), vec4f(v * p.a, 0.0, 0.0, 1.0));
}`;
const r = new WgslReflect(src);
console.log('PARSE OK, entry compute:', r.entry.compute.map(e=>e.name));
