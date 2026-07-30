// Server-side half of the brand logo (PDFKit + ExcelJS exports).
//
// Reads the SAME files the frontend uses - web/public/brand-logo.jpg is copied
// to web/dist by the Vite build, which is also what Express serves statically -
// so dropping one file brands the sidebar, the client-side exports and the
// server-side exports together, with nothing to configure.
//
// Mirrors web/src/lib/brandLogo.js. Falls back to the built-in orbit mark, and
// finally to null, so a report always generates even with no logo present.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Same order as the client: custom logo first, built-in mark last.
const CANDIDATES = ['brand-logo.jpg', 'brand-logo.png', 'orbit-logo.png'];

// The built frontend (what Express serves); web/public is the dev-time source.
const SEARCH_DIRS = [
  path.resolve(__dirname, '../../../web/dist'),
  path.resolve(__dirname, '../../../web/public'),
];

let cached; // resolved once per process

// Minimal header sniffing - enough to get intrinsic dimensions without pulling
// in an image library for what is a header decoration.
function pngSize(buf) {
  // PNG: 8-byte signature, then IHDR with width/height as big-endian uint32s.
  if (buf.length < 24) return null;
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

function jpegSize(buf) {
  // JPEG: walk the marker segments to the SOFn frame header, which carries size.
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let off = 2;
  while (off + 9 < buf.length) {
    if (buf[off] !== 0xff) { off++; continue; }
    const marker = buf[off + 1];
    // SOF0-SOF15, excluding the non-frame markers DHT(c4)/JPG(c8)/DAC(cc).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) };
    }
    const len = buf.readUInt16BE(off + 2);
    if (len < 2) return null;
    off += 2 + len;
  }
  return null;
}

/**
 * @returns {{buffer: Buffer, width: number, height: number, ratio: number, ext: string}|null}
 *   null when no logo file exists - callers must render the document anyway.
 */
export function getBrandLogo() {
  if (cached !== undefined) return cached;
  for (const dir of SEARCH_DIRS) {
    for (const name of CANDIDATES) {
      const file = path.join(dir, name);
      try {
        if (!fs.existsSync(file)) continue;
        const buffer = fs.readFileSync(file);
        const ext = path.extname(name).toLowerCase() === '.jpg' ? 'jpeg' : 'png';
        const dims = ext === 'jpeg' ? jpegSize(buffer) : pngSize(buffer);
        if (!dims || !dims.width || !dims.height) continue;
        cached = { buffer, width: dims.width, height: dims.height, ratio: dims.width / dims.height, ext };
        return cached;
      } catch { /* try the next candidate */ }
    }
  }
  cached = null;
  return cached;
}

/** Fit the logo into a bounding box without distorting it. */
export function fitLogo(logo, maxW, maxH) {
  if (!logo) return { width: 0, height: 0 };
  const width = Math.min(maxW, maxH * logo.ratio);
  return { width, height: width / logo.ratio };
}
