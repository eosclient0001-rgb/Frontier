// ============================================================================
//  png.js — dependency-free PNG encoder (pure JS, works in Node & workers)
//  Uses stored (uncompressed) DEFLATE — valid zlib, small code, no deps.
//  Supports 8/16-bit grayscale and 8-bit RGB/RGBA.
// ============================================================================

// ---- CRC32 -------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf, start = 0, end = buf.length) {
  let c = 0xFFFFFFFF;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function adler32(buf) {
  let a = 1, b = 0;
  for (let i = 0; i < buf.length; i++) {
    a = (a + buf[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** zlib stream with stored deflate blocks. */
export function zlibStored(raw) {
  const maxBlock = 65535;
  const nBlocks = Math.max(1, Math.ceil(raw.length / maxBlock));
  const out = new Uint8Array(2 + raw.length + nBlocks * 5 + 4);
  let o = 0;
  out[o++] = 0x78; out[o++] = 0x01;
  for (let bi = 0; bi < nBlocks; bi++) {
    const start = bi * maxBlock;
    const len = Math.min(maxBlock, raw.length - start);
    const final = bi === nBlocks - 1 ? 1 : 0;
    out[o++] = final;
    out[o++] = len & 0xFF; out[o++] = (len >>> 8) & 0xFF;
    const nlen = (~len) & 0xFFFF;
    out[o++] = nlen & 0xFF; out[o++] = (nlen >>> 8) & 0xFF;
    out.set(raw.subarray(start, start + len), o);
    o += len;
  }
  const ad = adler32(raw);
  out[o++] = (ad >>> 24) & 0xFF; out[o++] = (ad >>> 16) & 0xFF;
  out[o++] = (ad >>> 8) & 0xFF; out[o++] = ad & 0xFF;
  return out.subarray(0, o);
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/**
 * Encode a PNG.
 * @param {number} w, h
 * @param {Uint8Array|Uint16Array} pixels  row-major
 * @param {object} o { colorType: 0|2|6 (grey|rgb|rgba), bitDepth: 8|16 }
 */
export function encodePNG(w, h, pixels, { colorType = 0, bitDepth = 8 } = {}) {
  const ch = colorType === 0 ? 1 : colorType === 2 ? 3 : 4;
  const bpr = w * ch * (bitDepth / 8);
  const raw = new Uint8Array((bpr + 1) * h);
  const sixteen = bitDepth === 16;
  for (let y = 0; y < h; y++) {
    const rowStart = y * (bpr + 1);
    raw[rowStart] = 0; // filter: none
    for (let x = 0; x < w * ch; x++) {
      const v = pixels[y * w * ch + x];
      if (sixteen) {
        raw[rowStart + 1 + x * 2] = (v >>> 8) & 0xFF;
        raw[rowStart + 2 + x * 2] = v & 0xFF;
      } else {
        raw[rowStart + 1 + x] = v & 0xFF;
      }
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr[8] = bitDepth; ihdr[9] = colorType; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const sig = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  const parts = [sig, chunk('IHDR', ihdr), chunk('IDAT', zlibStored(raw)), chunk('IEND', new Uint8Array(0))];
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Grayscale 8-bit convenience. */
export function pngGray8(w, h, u8) { return encodePNG(w, h, u8, { colorType: 0, bitDepth: 8 }); }

/** Grayscale 16-bit convenience (values 0..65535). */
export function pngGray16(w, h, u16) { return encodePNG(w, h, u16, { colorType: 0, bitDepth: 16 }); }
