// Generates extension icons (16, 32, 48, 128 px) as PNG files.
// No external dependencies — writes raw PNG bytes with zlib deflate.
import { createWriteStream } from "fs";
import { deflateSync } from "zlib";
import { mkdirSync } from "fs";

const SIZES = [16, 32, 48, 128];
const OUT_DIR = new URL("../icons/", import.meta.url).pathname;
mkdirSync(OUT_DIR, { recursive: true });

// ── PNG helpers ──────────────────────────────────────────────────
function crc32(buf) {
  const table =
    crc32.t ||
    (crc32.t = (() => {
      const t = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[i] = c;
      }
      return t;
    })());
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([name, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6; // 8-bit RGBA
  const rows = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rows[y * (1 + width * 4)] = 0; // filter type none
    rgba.copy(rows, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4);
  }
  const idat = deflateSync(rows, { level: 6 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ── Drawing ──────────────────────────────────────────────────────
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

// Signed distance from point (px,py) to a regular polygon with n sides,
// radius r, centred at (cx,cy). Returns negative inside.
function sdRegularPolygon(px, py, cx, cy, r, n, angleOffset = 0) {
  const dx = px - cx,
    dy = py - cy;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return -r;
  const angle = Math.atan2(dy, dx) - angleOffset;
  const step = (2 * Math.PI) / n;
  const sector = Math.round(angle / step) * step;
  const nx = Math.cos(sector),
    ny = Math.sin(sector);
  // dot with the closest edge normal
  return dx * nx + dy * ny - r * Math.cos(Math.PI / n);
}

// Signed distance from segment (ax,ay)→(bx,by)
function sdSegment(px, py, ax, ay, bx, by) {
  const abx = bx - ax,
    aby = by - ay;
  const t = clamp01(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby));
  const ex = px - (ax + t * abx),
    ey = py - (ay + t * aby);
  return Math.hypot(ex, ey);
}

// Soft alpha from SDF value and pixel radius
function alpha(sd, px) {
  return clamp01(0.5 - sd / px);
}

function renderIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const cx = size / 2,
    cy = size / 2;

  // Geometry scaled to size
  const outerR = size * 0.465; // hex outer radius
  const innerR = size * 0.355; // inner hex ring
  const lineW = size * 0.062; // chevron stroke half-width
  const px = 1.2; // AA kernel (pixels)
  const rot = Math.PI / 2; // flat-top hexagon

  // Chevron row 1: (9.5,12.5)→(16,17)→(22.5,12.5) in 32px coords → scale
  const s = size / 32;
  const chevrons = [
    [
      [9.5 * s, 12.5 * s],
      [16 * s, 17 * s],
      [22.5 * s, 12.5 * s],
    ],
    [
      [9.5 * s, 16 * s],
      [16 * s, 20.5 * s],
      [22.5 * s, 16 * s],
    ],
  ];

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // ── Hex body (amber gradient top→bottom) ──────────────────
      const hexSd = sdRegularPolygon(x + 0.5, y + 0.5, cx, cy, outerR, 6, rot);
      const hexA = alpha(hexSd, px);
      if (hexA <= 0) continue;

      // Gradient: top = #f5ad5c (245,173,92) at 100%, bottom at 65%
      const t = clamp01((y + 0.5) / size);
      const gr = Math.round(lerp(245, 245, t));
      const gg = Math.round(lerp(173, 173 * 0.65, t));
      const gb = Math.round(lerp(92, 92 * 0.65, t));

      // Start with hex colour
      let r = gr,
        g = gg,
        b = gb,
        a = hexA;

      // ── Inner hex border (dark overlay) ───────────────────────
      const innerSd = sdRegularPolygon(x + 0.5, y + 0.5, cx, cy, innerR, 6, rot);
      // Ring is the band between innerR and outerR — draw as a thin stroke
      const ringA = alpha(innerSd, px) * 0.55;
      // Blend dark over amber
      const dr = 10,
        dg = 13,
        db = 20;
      r = Math.round(lerp(r, dr, ringA));
      g = Math.round(lerp(g, dg, ringA));
      b = Math.round(lerp(b, db, ringA));

      // ── Chevrons ──────────────────────────────────────────────
      for (const pts of chevrons) {
        const d0 = sdSegment(x + 0.5, y + 0.5, pts[0][0], pts[0][1], pts[1][0], pts[1][1]);
        const d1 = sdSegment(x + 0.5, y + 0.5, pts[1][0], pts[1][1], pts[2][0], pts[2][1]);
        const chevSd = Math.min(d0, d1) - lineW;
        const chevA = alpha(chevSd, px);
        if (chevA > 0) {
          r = Math.round(lerp(r, dr, chevA));
          g = Math.round(lerp(g, dg, chevA));
          b = Math.round(lerp(b, db, chevA));
        }
      }

      // ── Small rect at top (notch) — skip at tiny sizes ────────
      if (size >= 32) {
        const nx = 14.5 * s,
          ny = 3.5 * s,
          nw = 3 * s,
          nh = 1.2 * s;
        const inside = x + 0.5 >= nx && x + 0.5 <= nx + nw && y + 0.5 >= ny && y + 0.5 <= ny + nh;
        if (inside) {
          r = Math.round(lerp(r, dr, 0.5));
          g = Math.round(lerp(g, dg, 0.5));
          b = Math.round(lerp(b, db, 0.5));
        }
      }

      const i = (y * size + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = Math.round(a * 255);
    }
  }
  return encodePng(size, size, rgba);
}

// ── Write files ──────────────────────────────────────────────────
for (const size of SIZES) {
  const png = renderIcon(size);
  const path = `${OUT_DIR}icon${size}.png`;
  createWriteStream(path).end(png);
  console.log(`  wrote ${path} (${png.length} bytes)`);
}
console.log("Done.");
