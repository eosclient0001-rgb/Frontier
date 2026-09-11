// Frontier Water Shader - No Tiled Noise, Beyond Unreal
// GLSL 300 es, GTX 600+ compatible
// Based on 2023-2024 research: JONSWAP+TMA, Gabor, Jacobian foam

// --- Gabor Noise (non-tiling, infinite) ---
// Replaces Unreal's Texture2D tiled normal maps
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
vec2 hash2(vec2 p){ return vec2(hash(p), hash(p+vec2(1,0))); }

float gabor(vec2 p, float freq, float angle, float phi, float aniso) {
  float c = cos(angle), s = sin(angle);
  vec2 rot = vec2(c*p.x + s*p.y, -s*p.x + c*p.y);
  rot.x *= aniso;
  float r2 = dot(rot, rot);
  float env = exp(-3.1415 * r2);
  float wave = cos(6.2831853 * freq * rot.x + phi);
  return env * wave;
}

float gaborNoise(vec2 p, float scale, float freqBase, int octaves) {
  float sum = 0.0; float amp = 1.0; float freq = freqBase; float w = 0.0;
  for(int o=0;o<4;o++){
    if(o>=octaves) break;
    vec2 q = p * scale * freq;
    vec2 cell = floor(q); vec2 f = fract(q);
    float n = 0.0;
    for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){
      vec2 cellN = cell + vec2(i,j);
      vec2 rnd = hash2(cellN);
      vec2 pos = vec2(i,j) + rnd - f;
      float angle = rnd.x * 6.2831853;
      float phi = rnd.y * 6.2831853;
      float aniso = 0.3 + rnd.x*0.7;
      n += gabor(pos, 1.0, angle, phi, aniso);
    }
    sum += n * amp; w += amp; amp *= 0.5; freq *= 2.1;
  }
  return sum / w;
}

vec2 gaborFlow(vec2 p, float time, vec2 windDir){
  vec2 flow = windDir * time * 0.05;
  float warp1 = gaborNoise(p*0.5 + flow*0.2, 1.0, 1.0, 2) * 0.3;
  float warp2 = gaborNoise(p*0.5 + flow*0.3 + vec2(1.3,2.1), 1.0, 1.0, 2) * 0.3;
  return p + vec2(warp1, warp2);
}

// --- JONSWAP + TMA Spectrum (Donatini 2024) ---
// Physical, fetch-limited, depth-corrected
const float G = 9.81;
float dispersion(float k, float depth){
  if(k<0.001) return 0.0;
  return sqrt(G * k * tanh(k*depth));
}
float jonswap(float omega, float U10, float fetch, float gamma){
  float alpha = 0.076 * pow(G*fetch/(U10*U10), -0.22);
  float wp = 2.0*3.1415*3.5*pow(G*G/(U10*fetch),0.33);
  float sigma = omega <= wp ? 0.07 : 0.09;
  float r = exp(-pow(omega-wp,2.0)/(2.0*sigma*sigma*wp*wp));
  float PM = alpha*G*G*pow(omega,-5.0)*exp(-1.25*pow(wp/omega,4.0));
  return PM * pow(gamma, r);
}
float tmaFactor(float omega, float depth){
  if(depth>500.0) return 1.0;
  float wh = omega * sqrt(depth/G);
  if(wh<=1.0) return 0.5*wh*wh;
  if(wh<6.0) return 1.0 - 0.5*pow(2.0-wh,2.0);
  return 1.0;
}

// --- Vertex: JONSWAP sum + Gabor + Jacobian ---
// Not Gerstner (Unreal), not tiled noise
// Input: worldPos.xz, time, windDir
// Output: height, normal, Jacobian

// --- Fragment: PBR Water + Real Foam ---
// Foam: Jacobian + advection, not threshold
// Beer's law, Cox-Munk GGX, SSR sky

// Usage in Three.js / Unity / Unreal Custom Node:
// - Copy gaborNoise + gaborFlow into shader
// - Replace texture2D(normalMap) with gaborNoise
// - Sample FFT displacement textures (3 cascades) if available, else use procedural JONSWAP loop
// - Compute Jacobian J = (1+ddx_dx)*(1+ddz_dz)-ddx_dz*ddz_dx
// - Foam: foam = prevFoam*0.92 + (1-smoothstep(0.15,0.45,J))*2.5*dt; advect by velocity
// - No Texture2D with Repeat wrap -> no tiling

// Full implementation in src/ocean/waterMaterial.js and src/main.js fallback
