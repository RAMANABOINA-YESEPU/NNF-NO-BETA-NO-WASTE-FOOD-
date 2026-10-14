import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const outDir = path.resolve('public/icons');
fs.mkdirSync(outDir, { recursive: true });

// 1. Create a beautiful SVG icon
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#047857"/>
      <stop offset="50%" stop-color="#0d9488"/>
      <stop offset="100%" stop-color="#064e3b"/>
    </linearGradient>
    <linearGradient id="plate" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="#e2e8f0"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="8" stdDeviation="16" flood-color="#000000" flood-opacity="0.35"/>
    </filter>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <circle cx="256" cy="256" r="168" fill="url(#plate)" filter="url(#shadow)"/>
  <circle cx="256" cy="256" r="132" fill="none" stroke="#cbd5e1" stroke-width="6"/>
  <!-- Cutlery Fork and Spoon -->
  <g fill="#0f766e" stroke="#0f766e" stroke-linecap="round" stroke-linejoin="round">
    <!-- Fork left -->
    <path d="M190 170 v50 c0 18 12 32 28 34 v96 a6 6 0 0 0 12 0 v-96 c16 -2 28 -16 28 -34 v-50" fill="none" stroke-width="10"/>
    <path d="M208 170 v40 M222 170 v40" stroke-width="8"/>
    <!-- Knife/Spoon right -->
    <path d="M304 170 c-18 10 -24 35 -24 60 c0 16 10 28 24 30 v100 a6 6 0 0 0 12 0 v-190 z" fill="#0f766e"/>
  </g>
  <!-- NNF Badge bottom -->
  <rect x="156" y="380" width="200" height="48" rx="24" fill="#022c22" stroke="#34d399" stroke-width="4"/>
  <text x="256" y="412" font-family="Plus Jakarta Sans, sans-serif" font-size="24" font-weight="900" fill="#34d399" text-anchor="middle" letter-spacing="2">NNF MESS</text>
</svg>`;

fs.writeFileSync(path.join(outDir, 'icon.svg'), svg, 'utf8');
fs.writeFileSync(path.resolve('public/favicon.svg'), svg, 'utf8');

// Function to generate a basic valid PNG using zlib
function createPng(width: number, height: number, r: number, g: number, b: number): Buffer {
  const bytesPerPixel = 4;
  const rowSize = width * bytesPerPixel + 1;
  const rawData = Buffer.alloc(rowSize * height);

  for (let y = 0; y < height; y++) {
    const rowOffset = y * rowSize;
    rawData[rowOffset] = 0; // Filter: None
    for (let x = 0; x < width; x++) {
      const pixelOffset = rowOffset + 1 + x * bytesPerPixel;
      // Border radius check for rounded corners
      const cornerRadius = Math.floor(width * 0.22);
      let inCorner = false;
      const dx = x < cornerRadius ? cornerRadius - x : x > width - cornerRadius ? x - (width - cornerRadius) : 0;
      const dy = y < cornerRadius ? cornerRadius - y : y > height - cornerRadius ? y - (height - cornerRadius) : 0;
      if (dx > 0 && dy > 0 && Math.sqrt(dx * dx + dy * dy) > cornerRadius) {
        inCorner = true;
      }

      if (inCorner) {
        rawData[pixelOffset] = 0;
        rawData[pixelOffset + 1] = 0;
        rawData[pixelOffset + 2] = 0;
        rawData[pixelOffset + 3] = 0; // Transparent
      } else {
        // Gradient color from teal to emerald
        const factor = (x + y) / (width + height);
        rawData[pixelOffset] = Math.round(r + (16 - r) * factor); // Red
        rawData[pixelOffset + 1] = Math.round(g + (185 - g) * factor); // Green
        rawData[pixelOffset + 2] = Math.round(b + (129 - b) * factor); // Blue
        rawData[pixelOffset + 3] = 255; // Alpha
      }
    }
  }

  const deflated = zlib.deflateSync(rawData);

  // PNG structure
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // 8 bit depth
  ihdrData[9] = 6; // RGBA color type
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace

  const ihdrChunk = makeChunk('IHDR', ihdrData);
  const idatChunk = makeChunk('IDAT', deflated);
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type: string, data: Buffer): Buffer {
  const len = data.length;
  const chunk = Buffer.alloc(len + 12);
  chunk.writeUInt32BE(len, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);

  const crcTable = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 4; i < 8 + len; i++) {
    crc = crcTable[(crc ^ chunk[i]) & 0xff] ^ (crc >>> 8);
  }
  chunk.writeInt32BE((crc ^ 0xffffffff) | 0, 8 + len);
  return chunk;
}

let crcTableCache: number[] | null = null;
function getCrcTable(): number[] {
  if (crcTableCache) return crcTableCache;
  const table = new Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      if (c & 1) {
        c = 0xedb88320 ^ (c >>> 1);
      } else {
        c = c >>> 1;
      }
    }
    table[n] = c;
  }
  crcTableCache = table;
  return table;
}

// Generate standard PNG sizes
fs.writeFileSync(path.join(outDir, 'icon-192.png'), createPng(192, 192, 4, 120, 87));
fs.writeFileSync(path.join(outDir, 'icon-512.png'), createPng(512, 512, 4, 120, 87));
fs.writeFileSync(path.join(outDir, 'apple-touch-icon.png'), createPng(180, 180, 4, 120, 87));

console.log('PWA icons created successfully.');
