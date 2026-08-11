// Generates the app icons from the design's logo mark: a lime rounded square
// with the dark chevron from the title bar.
//
//   node scripts/gen-icons.mjs
//
// Everything is rasterised here so the repo carries no binary source assets.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../src-tauri/icons");

// --- PNG encoding -----------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolour + alpha
  // Each scanline is prefixed with filter type 0.
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- drawing ----------------------------------------------------------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a + (b - a) * t;

/** Signed distance from a point to a rounded rectangle, negative inside. */
function roundedRectDistance(x, y, half, radius) {
  const dx = Math.abs(x) - (half - radius);
  const dy = Math.abs(y) - (half - radius);
  const ox = Math.max(dx, 0);
  const oy = Math.max(dy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(dx, dy), 0) - radius;
}

/** Distance from a point to the segment a->b. */
function segmentDistance(px, py, ax, ay, bx, by) {
  const vx = bx - ax;
  const vy = by - ay;
  const t = clamp(((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy), 0, 1);
  return Math.hypot(px - (ax + vx * t), py - (ay + vy * t));
}

function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const s = size / 24; // the design's logo is drawn on a 24-unit grid
  const half = 12 * s;
  const radius = 6.2 * s;
  const strokeHalf = 1.55 * s;

  // Chevron "m4 17 6-6-6-6", centred on the 24-unit grid.
  const pts = [
    [4.6 * s, 17.4 * s],
    [10.6 * s, 11.4 * s],
    [4.6 * s, 5.4 * s],
  ];
  const bar = [[13.4 * s, 17.4 * s], [19.4 * s, 17.4 * s]];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const cx = x + 0.5 - size / 2;
      const cy = y + 0.5 - size / 2;

      // Plate: lime gradient along the 140deg axis of the design.
      const t = clamp((cx * 0.64 + cy * 0.77) / (size * 0.9) + 0.5, 0, 1);
      let r = mix(0xc9, 0x8f, t);
      let g = mix(0xf4, 0xd1, t);
      let b = mix(0x5a, 0x2a, t);

      const plate = clamp(0.5 - roundedRectDistance(cx, cy, half, radius), 0, 1);

      // Mark: the chevron plus its baseline, in the design's ink colour.
      const px = x + 0.5;
      const py = y + 0.5;
      let markDist = Infinity;
      for (let i = 0; i < pts.length - 1; i++) {
        markDist = Math.min(
          markDist,
          segmentDistance(px, py, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]),
        );
      }
      markDist = Math.min(
        markDist,
        segmentDistance(px, py, bar[0][0], bar[0][1], bar[1][0], bar[1][1]),
      );
      const mark = clamp(strokeHalf + 0.5 - markDist, 0, 1);

      r = mix(r, 0x14, mark);
      g = mix(g, 0x18, mark);
      b = mix(b, 0x0a, mark);

      const i = (y * size + x) * 4;
      rgba[i] = Math.round(r);
      rgba[i + 1] = Math.round(g);
      rgba[i + 2] = Math.round(b);
      rgba[i + 3] = Math.round(plate * 255);
    }
  }

  return rgba;
}

// --- ICO container ----------------------------------------------------------

function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  let offset = 6 + entries.length * 16;
  const dir = [];
  for (const { size, png } of entries) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size; // 0 means 256
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0; // palette
    e[3] = 0; // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32LE(png.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += png.length;
    dir.push(e);
  }

  return Buffer.concat([header, ...dir, ...entries.map((e) => e.png)]);
}

// --- main -------------------------------------------------------------------

mkdirSync(OUT, { recursive: true });

const pngFor = (size) => encodePng(size, render(size));

const files = {
  "32x32.png": 32,
  "128x128.png": 128,
  "128x128@2x.png": 256,
  "icon.png": 512,
};

for (const [name, size] of Object.entries(files)) {
  writeFileSync(resolve(OUT, name), pngFor(size));
  console.log(`icons/${name}  ${size}x${size}`);
}

const ico = encodeIco([16, 32, 48, 64, 128, 256].map((size) => ({ size, png: pngFor(size) })));
writeFileSync(resolve(OUT, "icon.ico"), ico);
console.log(`icons/icon.ico  6 sizes, ${ico.length} bytes`);
