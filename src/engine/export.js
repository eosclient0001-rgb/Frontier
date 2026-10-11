// =================================================================================================
//  export.js — getting data out
// -------------------------------------------------------------------------------------------------
//  Height maps are written as 16-bit greyscale PNG, which is what every downstream terrain tool
//  expects; an 8-bit height map throws away 99.6% of the available values and produces visible
//  terracing the moment it is displaced. Deflate comes from the platform's CompressionStream, so
//  no third-party encoder is needed.
// =================================================================================================

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
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') {
    throw new Error('This browser cannot deflate, so PNG export is unavailable.');
  }
  const cs = new CompressionStream('deflate');
  const stream = new Blob([bytes]).stream().pipeThrough(cs);
  const buf = await new Response(stream).arrayBuffer();
  return new Uint8Array(buf);
}

function concat(parts) {
  let n = 0;
  for (const p of parts) n += p.length;
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

const SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Eight-bit RGB. Sixteen-bit greyscale is handled by heightsToPNG, which needs the sub filter
// applied across byte pairs rather than single bytes.
async function encodePNG(width, height, colorType, pixels) {
  const channels = colorType === 2 ? 3 : 4;
  const stride = width * channels;
  const raw = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 1; // sub filter: each byte is stored as its difference from the left
    const dst = y * (stride + 1) + 1;
    const src = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[src + x - channels] : 0;
      raw[dst + x] = (pixels[src + x] - left) & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8;
  ihdr[9] = colorType;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = await deflateRaw(raw);
  return concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]);
}

export async function heightsToPNG(heights, res) {
  const stride = res * 2;
  const raw = new Uint8Array((stride + 1) * res);
  for (let y = 0; y < res; y++) {
    const dst = y * (stride + 1);
    raw[dst] = 1;
    for (let x = 0; x < res; x++) {
      const h = Math.max(0, Math.min(1, heights[y * res + x]));
      const v = Math.round(h * 65535);
      const o = dst + 1 + x * 2;
      const left = x > 0 ? ((raw[o - 2] << 8) | raw[o - 1]) : 0;
      const d = (v - left) & 0xffff;
      raw[o] = (d >> 8) & 0xff;
      raw[o + 1] = d & 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, res);
  dv.setUint32(4, res);
  ihdr[8] = 16;
  ihdr[9] = 0;
  const idat = await deflateRaw(raw);
  return concat([SIG, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))]);
}

export async function normalsToPNG(heights, res, extent, heightMeters) {
  const cell = extent / res;
  const px = new Uint8Array(res * res * 3);
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const h = (xx, yy) =>
        heights[Math.min(res - 1, Math.max(0, yy)) * res + Math.min(res - 1, Math.max(0, xx))] * heightMeters;
      const dhx = (h(x + 1, y) - h(x - 1, y)) / (2 * cell);
      const dhz = (h(x, y + 1) - h(x, y - 1)) / (2 * cell);
      const len = Math.hypot(-dhx, 1, -dhz);
      const i = (y * res + x) * 3;
      px[i] = Math.round(((-dhx / len) * 0.5 + 0.5) * 255);
      px[i + 1] = Math.round(((1 / len) * 0.5 + 0.5) * 255);
      px[i + 2] = Math.round(((-dhz / len) * 0.5 + 0.5) * 255);
    }
  }
  return encodePNG(res, res, 2, px);
}

export function heightsToOBJ(heights, res, extent, heightMeters) {
  const half = extent / 2;
  const lines = [`# Frontier Terrain — ${res}x${res}, ${extent} m, ${heightMeters} m relief`, 'o terrain'];
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const h = heights[y * res + x] * heightMeters;
      lines.push(`v ${((x / (res - 1)) * extent - half).toFixed(3)} ${h.toFixed(3)} ${((y / (res - 1)) * extent - half).toFixed(3)}`);
    }
  }
  for (let y = 0; y < res - 1; y++) {
    for (let x = 0; x < res - 1; x++) {
      const a = y * res + x + 1;
      const b = a + 1;
      const c = a + res;
      const d = c + 1;
      lines.push(`f ${a} ${c} ${b}`, `f ${b} ${c} ${d}`);
    }
  }
  return lines.join('\n');
}

export async function rgbaToPNG(rgba, width, height, padded) {
  const out = new Uint8Array(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = y * padded + x * 4;
      const ds = (y * width + x) * 3;
      out[ds] = rgba[s + 2];
      out[ds + 1] = rgba[s + 1];
      out[ds + 2] = rgba[s];
    }
  }
  return encodePNG(width, height, 2, out);
}

export function downloadBytes(name, bytes, mime = 'application/octet-stream') {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(name, text, mime = 'text/plain') {
  downloadBytes(name, new TextEncoder().encode(text), mime);
}
