// Minimal PNG writer. 8- and 16-bit, greyscale / RGB / RGBA.
// Compression comes from the platform's CompressionStream ('deflate' == zlib,
// which is exactly what PNG IDAT wants).

const CRC_TABLE = (() => {
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
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = data.length;
  const out = new Uint8Array(len + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, len);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + len, crc32(out.subarray(4, 8 + len)));
  return out;
}

async function deflate(bytes) {
  if (typeof CompressionStream === 'undefined') {
    // fall back to stored (uncompressed) deflate blocks — always valid
    const blocks = [];
    const n = bytes.length;
    let off = 0;
    do {
      const size = Math.min(65535, n - off);
      const last = off + size >= n ? 1 : 0;
      const head = new Uint8Array(5);
      head[0] = last;
      head[1] = size & 0xff; head[2] = (size >> 8) & 0xff;
      head[3] = (~size) & 0xff; head[4] = ((~size) >> 8) & 0xff;
      blocks.push(head, bytes.subarray(off, off + size));
      off += size;
    } while (off < n);
    return concat(blocks);
  }
  const cs = new CompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function concat(list) {
  let n = 0;
  for (const b of list) n += b.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const b of list) { out.set(b, o); o += b.length; }
  return out;
}

const COLOR_TYPES = { 1: 0, 2: 0, 3: 2, 4: 6 };   // channels -> PNG colour type

/**
 * @param {number} width
 * @param {number} height
 * @param {number} channels  1 grey, 3 rgb, 4 rgba
 * @param {Uint8Array|Uint16Array} pixels
 * @param {number} bitDepth  8 or 16
 */
export async function encodePNG(width, height, channels, pixels, bitDepth = 16) {
  const bpp = channels * (bitDepth / 8);
  const stride = width * bpp;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;                      // filter: none
    const src = pixels.subarray(y * stride, (y + 1) * stride);
    const dst = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    if (bitDepth === 16) {
      // PNG is big-endian; TypedArrays are platform-endian
      const u16 = new Uint16Array(src.buffer, src.byteOffset, src.length);
      for (let i = 0; i < u16.length; i++) {
        dst[i * 2] = (u16[i] >>> 8) & 0xff;
        dst[i * 2 + 1] = u16[i] & 0xff;
      }
    } else {
      dst.set(src);
    }
  }

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = bitDepth;
  ihdr[9] = COLOR_TYPES[channels];
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const idat = await deflate(raw);
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Blob([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', new Uint8Array(0)),
  ], { type: 'image/png' });
}

/** Decode a half-float (IEEE 754 binary16) stored in the low 16 bits of `h`. */
export function halfToFloat(h) {
  const s = (h & 0x8000) >> 15;
  const e = (h & 0x7c00) >> 10;
  const f = h & 0x03ff;
  if (e === 0) return (s ? -1 : 1) * Math.pow(2, -14) * (f / 1024);
  if (e === 0x1f) return f ? NaN : (s ? -Infinity : Infinity);
  return (s ? -1 : 1) * Math.pow(2, e - 15) * (1 + f / 1024);
}
