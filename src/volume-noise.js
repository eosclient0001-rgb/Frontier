// Shared deterministic, world/local XYZ density noise. Never a height texture.
const mix = (a, b, t) => a + (b - a) * t,
  smooth = (t) => t * t * (3 - 2 * t);
function hash(x, y, z, seed) {
  let n =
    Math.imul(x, 374761393) ^
    Math.imul(y, 668265263) ^
    Math.imul(z, 2147483647) ^
    Math.imul(seed, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}
export function valueNoise(p, seed = 1) {
  const i = p.map(Math.floor),
    f = p.map((v, k) => smooth(v - i[k]));
  const h = (x, y, z) => hash(i[0] + x, i[1] + y, i[2] + z, seed);
  return (
    mix(
      mix(
        mix(h(0, 0, 0), h(1, 0, 0), f[0]),
        mix(h(0, 1, 0), h(1, 1, 0), f[0]),
        f[1],
      ),
      mix(
        mix(h(0, 0, 1), h(1, 0, 1), f[0]),
        mix(h(0, 1, 1), h(1, 1, 1), f[0]),
        f[1],
      ),
      f[2],
    ) *
      2 -
    1
  );
}
export const noiseDefaults = {
  noiseType: 1,
  noiseAmount: 0,
  noiseScale: 3,
  noiseOctaves: 4,
  noiseGain: 0.5,
  noiseLacunarity: 2,
  noiseWarp: 0,
  noiseSeed: 4821,
  terraceHeight: 1,
  terraceStrength: 0,
};
export function fractalNoise(p, n = {}) {
  const c = {
    ...noiseDefaults,
    ...Object.fromEntries(Object.entries(n).filter(([, v]) => v !== undefined)),
  };
  if (!c.noiseType) return 0;
  let q = p.map((v) => v / Math.max(0.5, c.noiseScale));
  if (c.noiseWarp) {
    const d = [0, 1, 2].map((k) =>
      valueNoise(
        q.map((v) => v + k * 11.7),
        c.noiseSeed + 31 + k,
      ),
    );
    q = q.map((v, k) => v + c.noiseWarp * d[k]);
  }
  let sum = 0,
    norm = 0,
    amplitude = 1,
    weight = 1;
  for (let i = 0; i < Math.min(5, c.noiseOctaves); i++) {
    let v = valueNoise(q, c.noiseSeed + i * 19);
    if (c.noiseType === 2 || c.noiseType === 3) v = 1 - 2 * Math.abs(v);
    else if (c.noiseType === 4) v = 2 * Math.abs(v) - 1;
    if (c.noiseType === 3) {
      v *= weight;
      weight = Math.max(0.1, Math.min(1, (v + 1) * 0.65));
    }
    sum += v * amplitude;
    norm += amplitude;
    q = q.map((v) => v * c.noiseLacunarity);
    amplitude *= c.noiseGain;
  }
  return sum / Math.max(norm, 0.001);
}
export function terraceY(y, height, strength) {
  const h = Math.max(0.4, height),
    t = y / h,
    i = Math.floor(t),
    f = t - i,
    u = Math.max(0, Math.min(1, (f - 0.2) / 0.6));
  return mix(y, (i + smooth(u)) * h, strength);
}
export const volumeNoiseGLSL = `
uint densityHash(uvec3 p,uint seed){uint n=p.x*374761393u^p.y*668265263u^p.z*2147483647u^seed*1274126177u;n=(n^(n>>13u))*1274126177u;return n^(n>>16u);}
float densityCorner(ivec3 p,int seed){return float(densityHash(uvec3(p),uint(seed)))/4294967295.;}
float densityNoise(vec3 p,int seed){ivec3 i=ivec3(floor(p));vec3 f=fract(p);f=f*f*(3.-2.*f);return 2.*mix(mix(mix(densityCorner(i,seed),densityCorner(i+ivec3(1,0,0),seed),f.x),mix(densityCorner(i+ivec3(0,1,0),seed),densityCorner(i+ivec3(1,1,0),seed),f.x),f.y),mix(mix(densityCorner(i+ivec3(0,0,1),seed),densityCorner(i+ivec3(1,0,1),seed),f.x),mix(densityCorner(i+ivec3(0,1,1),seed),densityCorner(i+ivec3(1,1,1),seed),f.x),f.y),f.z)-1.;}
// A: type, amount, wavelength, octaves. B: gain, lacunarity, warp, seed.
float densityFractal(vec3 p,vec4 a,vec4 b){if(a.x<.5)return 0.;vec3 q=p/max(.5,a.z);int seed=int(b.w);if(b.z>0.)q+=b.z*vec3(densityNoise(q,seed+31),densityNoise(q+11.7,seed+32),densityNoise(q+23.4,seed+33));float sum=0.,norm=0.,amplitude=1.,weight=1.;for(int i=0;i<5;i++){if(i>=int(a.w))break;float v=densityNoise(q,seed+i*19);if(a.x>1.5&&a.x<3.5)v=1.-2.*abs(v);else if(a.x>3.5)v=2.*abs(v)-1.;if(a.x>2.5&&a.x<3.5){v*=weight;weight=clamp((v+1.)*.65,.1,1.);}sum+=v*amplitude;norm+=amplitude;q*=b.y;amplitude*=b.x;}return sum/max(norm,.001);}
float densityTerrace(float y,float height,float strength){float h=max(.4,height),t=y/h;return mix(y,(floor(t)+smoothstep(.2,.8,fract(t)))*h,strength);}
`;
export function noiseUniforms(n) {
  const c = {
    ...noiseDefaults,
    ...Object.fromEntries(Object.entries(n).filter(([, v]) => v !== undefined)),
  };
  return {
    noiseA: [c.noiseType, c.noiseAmount, c.noiseScale, c.noiseOctaves],
    noiseB: [c.noiseGain, c.noiseLacunarity, c.noiseWarp, c.noiseSeed],
  };
}
