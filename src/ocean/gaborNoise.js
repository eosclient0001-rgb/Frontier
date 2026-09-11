// Gabor Noise for non-tiling ocean micro-detail
// Based on Lagae et al. 2009 + 2024 cheap Gabor water (gehsiegarnixan)
// No tiled noise, no repetition, infinite procedural, cheaper than Unreal's flow maps

export const gaborShaderCode = `
 // Gabor kernel: exp(-pi * r^2) * cos(2pi f * (x cos theta + y sin theta) + phi)
 float gabor(vec2 p, float freq, float angle, float phi, float aniso) {
   float c = cos(angle), s = sin(angle);
   vec2 rot = vec2(c*p.x + s*p.y, -s*p.x + c*p.y);
   rot.x *= aniso;
   float r2 = dot(rot, rot);
   float envelope = exp(-3.1415 * r2);
   float wave = cos(6.2831853 * freq * rot.x + phi);
   return envelope * wave;
 }
 // Sparse Gabor noise: sum of kernels at random cells
 // hash functions
 float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
 vec2 hash2(vec2 p){ return vec2(hash(p), hash(p+vec2(1,0))); }

 float gaborNoise(vec2 p, float scale, float freqBase, int octaves) {
   float sum = 0.0;
   float amp = 1.0;
   float freq = freqBase;
   float w = 0.0;
   for(int o=0;o<4;o++){
     if(o>=octaves) break;
     vec2 q = p * scale * freq;
     vec2 cell = floor(q);
     vec2 f = fract(q);
     float n = 0.0;
     // 3x3 neighbourhood
     for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
       vec2 cellN = cell + vec2(i,j);
       vec2 rnd = hash2(cellN);
       vec2 pos = vec2(i,j) + rnd - f;
       float angle = rnd.x * 6.2831853; // oriented by wind + randomness
       float phi = rnd.y * 6.2831853;
       float aniso = 0.3 + rnd.x*0.7; // anisotropic stretch for wave shape
       n += gabor(pos, 1.0, angle, phi, aniso);
     }
     sum += n * amp;
     w += amp;
     amp *= 0.5;
     freq *= 2.1;
   }
   return sum / w;
 }

 // Progressive domain warping for flow, no tiling
 vec2 gaborFlow(vec2 p, float time, vec2 windDir){
   vec2 flow = windDir * time * 0.05;
   float warp1 = gaborNoise(p*0.5 + flow*0.2, 1.0, 1.0, 2) * 0.3;
   float warp2 = gaborNoise(p*0.5 + flow*0.3 + vec2(1.3,2.1), 1.0, 1.0, 2) * 0.3;
   return p + vec2(warp1, warp2);
 }
`;

// For CPU side we just export the shader code, used in waterMaterial
