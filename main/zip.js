'use strict';

/**
 * Embroidery Converter — minimal, dependency-free ZIP reader/writer.
 * Copyright © 2026 orgware.ai (andkoma@akopp.de)
 * This application was created with AI support.
 *
 * The project's `.ecproj` package is a plain ZIP (manifest.json + assets +
 * previews). electron-builder's `archiver`/`yauzl` are DEV dependencies and
 * are NOT bundled into the packaged app, so we implement the small slice of
 * the ZIP spec we need on top of Node's built-in `zlib`:
 *
 *   • Writer: local file headers + DEFLATE (or STORE) + central directory +
 *     end-of-central-directory record.
 *   • Reader: parse the end-of-central-directory + central directory and
 *     inflate each entry.
 *
 * Scope/limits (sufficient for our own package format):
 *   • No ZIP64 (packages are well under 4 GB / 65k entries).
 *   • No encryption, no data descriptors (sizes known before writing).
 *   • UTF-8 filenames (general-purpose bit 11 set).
 */

const zlib = require('zlib');

/* ------------------------------------------------------------------ *
 *  CRC-32 (IEEE 802.3) with a precomputed table
 * ------------------------------------------------------------------ */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* ------------------------------------------------------------------ *
 *  DOS date/time packing (ZIP stores mtime as MS-DOS date/time)
 * ------------------------------------------------------------------ */
function dosDateTime(date) {
  const d = date instanceof Date ? date : new Date();
  const year = Math.max(1980, d.getFullYear());
  const time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((Math.floor(d.getSeconds() / 2)) & 0x1F);
  const dosDate = (((year - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F);
  return { time: time & 0xFFFF, date: dosDate & 0xFFFF };
}

/* ------------------------------------------------------------------ *
 *  Writer
 * ------------------------------------------------------------------ */
/**
 * Build a ZIP buffer from a list of entries.
 * @param {{name:string, data:Buffer|string, mtime?:Date, store?:boolean}[]} entries
 *        name  — path inside the zip (use '/' separators)
 *        data  — Buffer or string contents
 *        store — if true, no compression (STORE); default DEFLATE
 * @returns {Buffer}
 */
function zipSync(entries) {
  const localParts = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(String(entry.name).replace(/\\/g, '/'), 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data), 'utf8');
    const crc = crc32(raw);
    const useStore = !!entry.store;
    const compressed = useStore ? raw : zlib.deflateRawSync(raw);
    const method = useStore ? 0 : 8; // 0 = store, 8 = deflate
    const { time, date } = dosDateTime(entry.mtime);
    const gpFlag = 0x0800; // bit 11: filename is UTF-8

    // ---- Local file header ----
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);       // local file header signature
    lh.writeUInt16LE(20, 4);               // version needed to extract (2.0)
    lh.writeUInt16LE(gpFlag, 6);           // general purpose bit flag
    lh.writeUInt16LE(method, 8);           // compression method
    lh.writeUInt16LE(time, 10);            // mod time
    lh.writeUInt16LE(date, 12);            // mod date
    lh.writeUInt32LE(crc, 14);             // crc-32
    lh.writeUInt32LE(compressed.length, 18); // compressed size
    lh.writeUInt32LE(raw.length, 22);      // uncompressed size
    lh.writeUInt16LE(nameBuf.length, 26);  // file name length
    lh.writeUInt16LE(0, 28);               // extra field length

    localParts.push(lh, nameBuf, compressed);

    // ---- Central directory header ----
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);       // central file header signature
    ch.writeUInt16LE(20, 4);               // version made by
    ch.writeUInt16LE(20, 6);               // version needed to extract
    ch.writeUInt16LE(gpFlag, 8);           // general purpose bit flag
    ch.writeUInt16LE(method, 10);          // compression method
    ch.writeUInt16LE(time, 12);            // mod time
    ch.writeUInt16LE(date, 14);            // mod date
    ch.writeUInt32LE(crc, 16);             // crc-32
    ch.writeUInt32LE(compressed.length, 20); // compressed size
    ch.writeUInt32LE(raw.length, 24);      // uncompressed size
    ch.writeUInt16LE(nameBuf.length, 28);  // file name length
    ch.writeUInt16LE(0, 30);               // extra field length
    ch.writeUInt16LE(0, 32);               // file comment length
    ch.writeUInt16LE(0, 34);               // disk number start
    ch.writeUInt16LE(0, 36);               // internal file attributes
    ch.writeUInt32LE(0, 38);               // external file attributes
    ch.writeUInt32LE(offset, 42);          // relative offset of local header

    central.push(Buffer.concat([ch, nameBuf]));

    offset += lh.length + nameBuf.length + compressed.length;
  }

  const localBlob = Buffer.concat(localParts);
  const centralBlob = Buffer.concat(central);

  // ---- End of central directory record ----
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);       // EOCD signature
  eocd.writeUInt16LE(0, 4);                // number of this disk
  eocd.writeUInt16LE(0, 6);                // disk where central dir starts
  eocd.writeUInt16LE(entries.length, 8);   // number of central dir records on this disk
  eocd.writeUInt16LE(entries.length, 10);  // total number of central dir records
  eocd.writeUInt32LE(centralBlob.length, 12); // size of central directory
  eocd.writeUInt32LE(localBlob.length, 16);   // offset of central directory
  eocd.writeUInt16LE(0, 20);               // comment length

  return Buffer.concat([localBlob, centralBlob, eocd]);
}

/* ------------------------------------------------------------------ *
 *  Reader
 * ------------------------------------------------------------------ */
/**
 * Parse a ZIP buffer into entries. Each entry: { name, data:Buffer }.
 * @param {Buffer} buf
 * @returns {{name:string, data:Buffer}[]}
 */
function unzipSync(buf) {
  // Find EOCD by scanning backwards for its signature.
  let eocdPos = -1;
  const minPos = Math.max(0, buf.length - 22 - 0xFFFF);
  for (let i = buf.length - 22; i >= minPos; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocdPos = i; break; }
  }
  if (eocdPos < 0) throw new Error('Not a valid ZIP (no end-of-central-directory record)');

  const total = buf.readUInt16LE(eocdPos + 10);
  let p = buf.readUInt32LE(eocdPos + 16); // offset of central directory

  const out = [];
  for (let n = 0; n < total; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Corrupt central directory');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);

    // Read the local header to locate the data (its extra-field length can
    // differ from the central record's).
    if (buf.readUInt32LE(localOffset) !== 0x04034b50) throw new Error('Corrupt local header');
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const compData = buf.slice(dataStart, dataStart + compSize);

    let data;
    if (method === 0) data = Buffer.from(compData);
    else if (method === 8) data = zlib.inflateRawSync(compData);
    else throw new Error('Unsupported compression method: ' + method);

    out.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

module.exports = { zipSync, unzipSync, crc32 };
