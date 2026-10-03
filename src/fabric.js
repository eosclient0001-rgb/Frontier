// Fabric (material) state: the "node graph" equivalent lives here as parameter
// sets that the WGSL `evalFabric` function interprets per-pixel.

export const PATTERN_TYPES = [
  { value: 0, label: 'Solid / Plain' },
  { value: 1, label: 'Stripes' },
  { value: 2, label: 'Plaid / Tartan' },
  { value: 3, label: 'Polka Dots' },
  { value: 4, label: 'Damask Ornament' },
  { value: 5, label: 'Houndstooth' },
  { value: 6, label: 'Floral Print' },
  { value: 7, label: 'Lace' },
  { value: 8, label: 'Ombré / Dyed' },
];

export const MOTIF_STYLES = [
  { value: 0, label: 'Damask' },
  { value: 1, label: 'Floral' },
  { value: 2, label: 'Lace Net' },
];

const hexToRgb = (hex) => {
  const h = hex.replace('#', '');
  return [
    parseInt(h.slice(0, 2), 16) / 255,
    parseInt(h.slice(2, 4), 16) / 255,
    parseInt(h.slice(4, 6), 16) / 255,
  ];
};

export const DEFAULT_FABRIC = {
  name: 'Custom Weave',
  type: 1,
  scale: 2.6,
  rotation: 0,
  colA: '#2b4a8f',
  colB: '#f2ead9',
  colC: '#0f1b33',
  stripeWidth: 0.28,
  stripeAngle: 0.35,
  dotRadius: 0.22,
  motifRadius: 0.42,
  motifCount: 6,
  motifStyle: 0,
  amountStripe: 0.0,
  amountPlaid: 0.0,
  amountDot: 0.0,
  amountMotif: 0.0,
  weaveAmount: 0.65,
  weaveScale: 1.0,
  noiseAmount: 0.30,
  noiseScale: 1.0,
  roughness: 0.65,
  sheen: 0.25,
  opacity: 1.0,
};

export const FABRIC_PRESETS = [
  {
    name: 'Indigo Silk', type: 0, scale: 2.0, colA: '#1d3f8f', colB: '#8fb4ff', colC: '#0b1738',
    weaveAmount: 0.35, noiseAmount: 0.12, roughness: 0.28, sheen: 0.75, opacity: 1.0,
    amountStripe: 0, amountPlaid: 0, amountDot: 0, amountMotif: 0,
  },
  {
    name: 'Ivory Satin', type: 0, scale: 2.0, colA: '#f6efe2', colB: '#fffaf0', colC: '#d8cbb4',
    weaveAmount: 0.25, noiseAmount: 0.08, roughness: 0.18, sheen: 0.9, opacity: 1.0,
    amountStripe: 0, amountPlaid: 0, amountDot: 0, amountMotif: 0,
  },
  {
    name: 'Red Tartan', type: 2, scale: 3.2, colA: '#8f1d20', colB: '#f0e6c8', colC: '#123b23',
    stripeWidth: 0.24, amountStripe: 0.25, amountPlaid: 0.4,
    weaveAmount: 0.8, noiseAmount: 0.3, roughness: 0.85, sheen: 0.1, opacity: 1.0,
    amountDot: 0, amountMotif: 0,
  },
  {
    name: 'Polka Chiffon', type: 3, scale: 5.0, colA: '#f5e9dd', colB: '#1b1b22', colC: '#c76a8a',
    dotRadius: 0.24, weaveAmount: 0.2, noiseAmount: 0.2, roughness: 0.5, sheen: 0.4, opacity: 1.0,
    amountStripe: 0, amountPlaid: 0, amountDot: 0, amountMotif: 0,
  },
  {
    name: 'Gold Damask', type: 4, scale: 3.4, colA: '#4a1b2a', colB: '#e3b96b', colC: '#2a0f18',
    motifCount: 7, motifStyle: 0, weaveAmount: 0.55, noiseAmount: 0.25, roughness: 0.45, sheen: 0.55,
    opacity: 1.0, amountStripe: 0, amountPlaid: 0, amountDot: 0, amountMotif: 0,
  },
  {
    name: 'Houndstooth Wool', type: 5, scale: 7.0, colA: '#1a1a1e', colB: '#ecebe6', colC: '#5a5a60',
    weaveAmount: 0.95, noiseAmount: 0.35, roughness: 0.92, sheen: 0.05, opacity: 1.0,
    amountStripe: 0, amountPlaid: 0, amountDot: 0, amountMotif: 0,
  },
  {
    name: 'Rose Print', type: 6, scale: 3.8, colA: '#f7e9ef', colB: '#c2335c', colC: '#3d6b3a',
    motifCount: 5, weaveAmount: 0.4, noiseAmount: 0.25, roughness: 0.55, sheen: 0.35, opacity: 1.0,
    amountStripe: 0, amountPlaid: 0, amountDot: 0, amountMotif: 0,
  },
  {
    name: 'Black Lace', type: 7, scale: 8.0, colA: '#141418', colB: '#2a2a30', colC: '#4a4a55',
    motifCount: 6, weaveAmount: 0.3, noiseAmount: 0.15, roughness: 0.4, sheen: 0.5, opacity: 1.0,
    amountStripe: 0, amountPlaid: 0, amountDot: 0, amountMotif: 0,
  },
  {
    name: 'Sunset Ombré', type: 8, scale: 2.2, colA: '#ff8a3d', colB: '#c9296e', colC: '#2b1b6b',
    weaveAmount: 0.3, noiseAmount: 0.3, roughness: 0.35, sheen: 0.7, opacity: 1.0,
    amountStripe: 0, amountPlaid: 0, amountDot: 0, amountMotif: 0,
  },
  {
    name: 'Denim Twill', type: 0, scale: 2.0, colA: '#3a5b8c', colB: '#93a9c4', colC: '#22344f',
    weaveAmount: 1.0, weaveScale: 1.6, noiseAmount: 0.45, roughness: 0.95, sheen: 0.02, opacity: 1.0,
    amountStripe: 0, amountPlaid: 0, amountDot: 0, amountMotif: 0,
  },
  {
    name: 'Champagne Sequin', type: 8, scale: 2.4, colA: '#e8cf9a', colB: '#fff6dd', colC: '#b08c4f',
    weaveAmount: 1.0, weaveScale: 3.2, noiseAmount: 0.6, roughness: 0.22, sheen: 1.0, opacity: 1.0,
    amountStripe: 0, amountPlaid: 0, amountDot: 0, amountMotif: 0,
  },
  {
    name: 'Emerald Velvet', type: 0, scale: 2.0, colA: '#0d5c3f', colB: '#2ea87a', colC: '#063324',
    weaveAmount: 0.4, noiseAmount: 0.55, noiseScale: 2.6, roughness: 0.55, sheen: 0.85, opacity: 1.0,
    amountStripe: 0, amountPlaid: 0, amountDot: 0, amountMotif: 0,
  },
];

export function packFabric(f, out = new Float32Array(32)) {
  const A = hexToRgb(f.colA ?? '#ffffff');
  const B = hexToRgb(f.colB ?? '#808080');
  const C = hexToRgb(f.colC ?? '#202020');
  out[0] = A[0]; out[1] = A[1]; out[2] = A[2]; out[3] = 1;
  out[4] = B[0]; out[5] = B[1]; out[6] = B[2]; out[7] = 1;
  out[8] = C[0]; out[9] = C[1]; out[10] = C[2]; out[11] = 1;
  out[12] = f.scale; out[13] = f.stripeWidth; out[14] = f.dotRadius; out[15] = f.motifRadius;
  out[16] = f.amountStripe; out[17] = f.amountPlaid; out[18] = f.amountDot; out[19] = f.amountMotif;
  out[20] = f.weaveAmount; out[21] = f.weaveScale; out[22] = f.noiseAmount; out[23] = f.noiseScale;
  out[24] = f.stripeAngle; out[25] = f.motifCount; out[26] = f.motifStyle; out[27] = f.rotation;
  out[28] = f.type; out[29] = f.roughness; out[30] = f.sheen; out[31] = f.opacity;
  return out;
}
