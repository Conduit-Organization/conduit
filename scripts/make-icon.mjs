// Render the Conduit mark to PNG app icons — pure Node, no native deps, no headless browser.
//
// The mark (from app/src/components/icons.tsx) is a mint arc + a node dot:
//   <path d="M736.4,315.3 A300,300 0 1 0 736.4,684.7" stroke=mint stroke-width=86 round-cap />
//   <circle cx=800 cy=500 r=44 fill=mint />
// i.e. a 300-radius circle centred at (500,500), drawn the long way so a wedge opens on the
// right (a "C"), with a node sitting in that opening. We rasterize it directly (super-sampled
// for clean edges) onto a rounded ink-gradient tile, then PNG-encode with Node's zlib.
//
// Outputs: build/icon.png (1024, for electron-builder packaging) and
//          electron/dist/icon.png (256, for the BrowserWindow / taskbar).
import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// ---- palette (matches app/src/styles.css) ----
const MINT = [43, 227, 168];      // #2be3a8
const BG_TOP = [22, 32, 43];      // #16202b
const BG_BOT = [9, 13, 18];       // #090d12
const GLOW = [43, 227, 168];      // faint mint bloom behind the mark

// ---- mark geometry in the 1000×1000 design space ----
const CX = 500, CY = 500;         // arc centre
const R = 300;                    // arc radius
const HALF = 43;                  // half of stroke-width 86
const GAP_DEG = 38;               // wedge half-angle left open on the right
const CAP1 = [736.4, 315.3];      // round-cap endpoints
const CAP2 = [736.4, 684.7];
const DOT = [800, 500], DOT_R = 44;

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// Is design-space point (sx,sy) painted mint by the mark?
function inMark(sx, sy) {
  // node dot
  if ((sx - DOT[0]) ** 2 + (sy - DOT[1]) ** 2 <= DOT_R * DOT_R) return true;
  // round caps at the two arc ends
  if ((sx - CAP1[0]) ** 2 + (sy - CAP1[1]) ** 2 <= HALF * HALF) return true;
  if ((sx - CAP2[0]) ** 2 + (sy - CAP2[1]) ** 2 <= HALF * HALF) return true;
  // the arc band, minus the open wedge on the right
  const dx = sx - CX, dy = sy - CY;
  const dist = Math.hypot(dx, dy);
  if (Math.abs(dist - R) <= HALF) {
    const ang = Math.atan2(dy, dx) * 180 / Math.PI; // -180..180, 0 = +x (right)
    if (Math.abs(ang) > GAP_DEG) return true;       // outside the wedge → painted
  }
  return false;
}

// Signed distance to a rounded rectangle centred on the tile (<=0 inside).
function roundRectSDF(px, py, size, margin, radius) {
  const half = size / 2 - margin;
  const qx = Math.abs(px - size / 2) - (half - radius);
  const qy = Math.abs(py - size / 2) - (half - radius);
  const ax = Math.max(qx, 0), ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - radius;
}

function renderRGBA(size) {
  const SS = 4;                               // 4×4 super-sampling
  const margin = Math.round(size * 0.055);
  const radius = Math.round(size * 0.225);
  const markScale = (size / 1000) * 0.6;      // shrink the 1000-box so the mark has padding
  const buf = Buffer.alloc(size * size * 4);

  for (let y = 0; y < size; y++) {
    // vertical background gradient factor
    for (let x = 0; x < size; x++) {
      let aSum = 0, rSum = 0, gSum = 0, bSum = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          // soft tile edge: coverage from the rounded-rect SDF (~1px AA)
          const d = roundRectSDF(px, py, size, margin, radius);
          const cov = clamp(0.5 - d, 0, 1); // <0 inside → cov→1
          if (cov <= 0) continue;
          // design-space coords for this subsample
          const dsx = (px - size / 2) / markScale + CX;
          const dsy = (py - size / 2) / markScale + CY;
          let r, g, b;
          if (inMark(dsx, dsy)) {
            [r, g, b] = MINT;
          } else {
            const t = py / size;                       // 0 top → 1 bottom
            r = BG_TOP[0] + (BG_BOT[0] - BG_TOP[0]) * t;
            g = BG_TOP[1] + (BG_BOT[1] - BG_TOP[1]) * t;
            b = BG_TOP[2] + (BG_BOT[2] - BG_TOP[2]) * t;
            // faint mint bloom centred a touch above middle
            const gd = Math.hypot(px - size * 0.5, py - size * 0.42) / size;
            const glow = Math.max(0, 0.16 - gd) ;
            r += GLOW[0] * glow; g += GLOW[1] * glow; b += GLOW[2] * glow;
          }
          aSum += cov;
          rSum += r * cov; gSum += g * cov; bSum += b * cov;
        }
      }
      const n = SS * SS;
      const a = aSum / n;
      const o = (y * size + x) * 4;
      if (a > 0) {
        buf[o]     = clamp(Math.round(rSum / aSum), 0, 255);
        buf[o + 1] = clamp(Math.round(gSum / aSum), 0, 255);
        buf[o + 2] = clamp(Math.round(bSum / aSum), 0, 255);
        buf[o + 3] = clamp(Math.round(a * 255), 0, 255);
      } // else fully transparent (already zeroed)
    }
  }
  return buf;
}

// ---- minimal PNG encoder (8-bit RGBA) ----
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
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(rgba, size) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8-bit RGBA
  // filtered raw: one filter byte (0) per scanline
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function write(size, outPath) {
  const rgba = renderRGBA(size);
  const png = encodePNG(rgba, size);
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, png);
  console.log(`  icon ${size}×${size} → ${path.relative(ROOT, outPath)} (${(png.length / 1024).toFixed(1)} KB)`);
}

write(1024, path.join(ROOT, 'build', 'icon.png'));      // electron-builder packaging icon
write(256, path.join(ROOT, 'electron', 'dist', 'icon.png')); // BrowserWindow / taskbar icon
console.log('✓ icons generated');
