/* Small shared helpers. */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const uid = (() => { let n = 0; return (p = 'id') => `${p}-${Date.now().toString(36)}-${(n++).toString(36)}`; })();
export const debounce = (fn, ms = 200) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

export function el(tag, cls, html) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

export function fmt(value, digits = 0) {
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: digits });
}

/* Hex → linear RGB triple (for GPU uniforms). */
export function hexToLinear(hex) {
  const m = hex.replace('#', '');
  const n = parseInt(m.length === 3 ? m.split('').map(c => c + c).join('') : m, 16);
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255].map(c =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
}

/* ── PNG encoding (deflate via CompressionStream, 8/16-bit grayscale + RGB) ── */
const crcTable = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function adler32(buf) {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) { a = (a + buf[i]) % 65521; b = (b + a) % 65521; }
  return (b << 16) | a;
}
function pngChunk(type, data) {
  const td = new Uint8Array(8 + data.length + 4);
  new DataView(td.buffer).setUint32(0, data.length);
  td.set(type.split('').map(c => c.charCodeAt(0)), 4);
  td.set(data, 8);
  new DataView(td.buffer, 8 + data.length, 4).setUint32(0, crc32(td.subarray(4, 8 + data.length)));
  return td;
}
async function deflateRaw(data) {
  // Prefer the platform deflate (raw, no zlib wrapper) when available.
  if (typeof CompressionStream === 'function') {
    try {
      const cs = new CompressionStream('deflate-raw');
      const writer = cs.writable.getWriter();
      void writer.write(data); void writer.close();
      const chunks = [];
      const reader = cs.readable.getReader();
      for (; ;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
      return zlibWrap(chunks, data);
    } catch (err) { /* fall back to stored blocks */ }
  }
  // Fallback: stored (uncompressed) deflate blocks.
  const parts = [];
  const maxBlock = 65535;
  const total = Math.max(data.length, 1);
  for (let i = 0; i < total; i += maxBlock) {
    const chunk = data.subarray(i, Math.min(i + maxBlock, data.length));
    const final = i + maxBlock >= data.length;
    const header = new Uint8Array(5);
    header[0] = final ? 1 : 0;                       // BFINAL, BTYPE = 00 (stored)
    new DataView(header.buffer).setUint16(1, chunk.length, true);
    new DataView(header.buffer).setUint16(3, (~chunk.length) & 0xffff, true);
    parts.push(header, chunk);
    if (final) break;
  }
  let size = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(2 + size + 4);
  out[0] = 0x78; out[1] = 0x01;                      // zlib header (deflate, 32K window)
  let o = 2;
  for (const part of parts) { out.set(part, o); o += part.length; }
  new DataView(out.buffer).setUint32(o, adler32(data) >>> 0);
  return out;
}
function zlibWrap(chunks, data) {
  const size = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(2 + size + 4);
  out[0] = 0x78; out[1] = 0x01;
  let o = 2;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  const dv = new DataView(out.buffer);
  dv.setUint32(o, adler32(data) >>> 0);
  return out;
}
/* channels: 1 gray, 2 gray+alpha, 3 RGB, 4 RGBA. bitDepth: 8 or 16. */
export async function encodePNG(width, height, bytes, channels, bitDepth = 8) {
  const bpp = channels * (bitDepth / 8);
  const raw = new Uint8Array(height * (1 + width * bpp));
  for (let y = 0; y < height; y++) {
    raw.set(bytes.subarray(y * width * bpp, (y + 1) * width * bpp), y * (1 + width * bpp) + 1);
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width); dv.setUint32(4, height);
  ihdr[8] = bitDepth;
  ihdr[9] = channels === 1 ? 0 : channels === 2 ? 4 : channels === 3 ? 2 : 6;
  const idat = await deflateRaw(raw);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Blob([sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))], { type: 'image/png' });
}
export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
