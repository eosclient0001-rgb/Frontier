// ============================================================================
//  zip.js — minimal store-only ZIP writer (pure JS, no deps)
// ============================================================================

import { crc32 } from './png.js'; // reuses the CRC32 table

function dosDateTime(date = new Date()) {
  const time = ((date.getHours() & 31) << 11) | ((date.getMinutes() & 63) << 5) | ((date.getSeconds() / 2) & 31);
  const day = (((date.getFullYear() - 1980) & 127) << 9) | (((date.getMonth() + 1) & 15) << 5) | (date.getDate() & 31);
  return { time, day };
}

/**
 * @param {Array<{name:string, data:Uint8Array}>} files
 * @returns {Uint8Array}
 */
export function makeZip(files, date = new Date()) {
  const enc = new TextEncoder();
  const { time, day } = dosDateTime(date);
  const locals = [], centrals = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const crc = crc32(f.data);
    const sz = f.data.length;

    const lh = new Uint8Array(30 + nameBytes.length);
    const ldv = new DataView(lh.buffer);
    ldv.setUint32(0, 0x04034b50, true);
    ldv.setUint16(4, 20, true);          // version needed
    ldv.setUint16(6, 0x0800, true);      // UTF-8 flag
    ldv.setUint16(8, 0, true);           // method: store
    ldv.setUint16(10, time, true);
    ldv.setUint16(12, day, true);
    ldv.setUint32(14, crc, true);
    ldv.setUint32(18, sz, true);
    ldv.setUint32(22, sz, true);
    ldv.setUint16(26, nameBytes.length, true);
    ldv.setUint16(28, 0, true);
    lh.set(nameBytes, 30);
    locals.push(lh, f.data);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cdv = new DataView(ch.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0x0800, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, time, true);
    cdv.setUint16(14, day, true);
    cdv.setUint32(16, crc, true);
    cdv.setUint32(20, sz, true);
    cdv.setUint32(24, sz, true);
    cdv.setUint16(28, nameBytes.length, true);
    cdv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    centrals.push(ch);

    offset += lh.length + sz;
  }

  let centralSize = 0;
  for (const c of centrals) centralSize += c.length;
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  edv.setUint32(0, 0x06054b50, true);
  edv.setUint16(8, files.length, true);
  edv.setUint16(10, files.length, true);
  edv.setUint32(12, centralSize, true);
  edv.setUint32(16, offset, true);

  const all = [...locals, ...centrals, eocd];
  let total = 0;
  for (const p of all) total += p.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}
