// Makes the Premium logo images (U9) from the existing mint F in
// assets/images/splash-icon.png. The F is never redrawn: logo-mark copies its
// pixels, logo-premium scales them down and lays them on black. No file
// access here (run.mjs does that), so all of it is tested. PNG is read and
// written with node:zlib only, so no image package is needed.
import { deflateSync, inflateSync } from 'node:zlib';

/** Straight (not premultiplied) 8-bit RGBA, row by row. */
export type Rgba = { width: number; height: number; data: Uint8Array };
export type LogoTokens = { mint: string; black: string };

/** Both images are 1024 × 1024, like icon.png. */
export const LOGO_SIZE = 1024;
/** The F in icon.png (the basic logo) is 647 px tall at 1024; the Premium F matches it. */
export const F_HEIGHT = 647;
/** Corner radius as a share of the side (230 px at 1024). FuttyLogo uses the same ratio. */
export const LOGO_CORNER_RATIO = 0.225;

const SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Reads an 8-bit, non-interlaced RGB or RGBA PNG. */
export function decodePng(file: Uint8Array): Rgba {
  const buf = Buffer.from(file);
  if (buf.length < 8 || !buf.subarray(0, 8).equals(SIGNATURE)) throw new Error('not a PNG');
  let width = 0;
  let height = 0;
  let channels = 0;
  const idat: Buffer[] = [];
  for (let p = 8; p < buf.length; ) {
    const length = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + length);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const [depth, colourType, , , interlace] = body.subarray(8, 13);
      if (depth !== 8 || interlace !== 0 || (colourType !== 2 && colourType !== 6)) {
        throw new Error('only 8-bit, non-interlaced RGB or RGBA PNGs are supported');
      }
      channels = colourType === 6 ? 4 : 3;
    } else if (type === 'IDAT') {
      idat.push(body);
    }
    p += 12 + length;
  }

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = a;
      else if (filter === 2) predictor = b;
      else if (filter === 3) predictor = (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = (line[x] + predictor) & 0xff;
    }
    pixels.set(cur, y * stride);
    prev = cur;
  }

  if (channels === 4) return { width, height, data: pixels };
  const data = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data.set(pixels.subarray(i * 3, i * 3 + 3), i * 4);
    data[i * 4 + 3] = 255;
  }
  return { width, height, data };
}

function chunk(type: string, body: Uint8Array) {
  const out = Buffer.alloc(12 + body.length);
  out.writeUInt32BE(body.length, 0);
  out.write(type, 4, 'ascii');
  Buffer.from(body).copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

/** Writes an RGBA PNG. The same image always gives the same bytes. */
export function encodePng(img: Rgba): Uint8Array {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(img.width, 0);
  header.writeUInt32BE(img.height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const stride = img.width * 4;
  const raw = Buffer.alloc(img.height * (stride + 1));
  for (let y = 0; y < img.height; y++) {
    raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from(SIGNATURE),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** The logo colours from the text of constants/futty-theme.ts, so the hex values live in one place. */
export function readLogoTokens(themeSource: string): LogoTokens {
  const read = (name: string) => {
    const match = themeSource.match(new RegExp(`\\b${name}:\\s*'(#[0-9A-Fa-f]{6})'`));
    if (!match) throw new Error(`${name} is missing from constants/futty-theme.ts`);
    return match[1];
  };
  return { mint: read('logoMint'), black: read('logoBlack') };
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** The smallest box around every pixel that isn't fully transparent. */
function trimToAlpha(img: Rgba): Rgba {
  let minX = img.width;
  let minY = img.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > 0) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
  }
  if (maxX < 0) throw new Error('the splash image has no visible pixels');
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const from = ((minY + y) * img.width + minX) * 4;
    data.set(img.data.subarray(from, from + width * 4), y * width * 4);
  }
  return { width, height, data };
}

/** Area-average downscale, in premultiplied alpha so the edges don't darken. */
function scaleArea(img: Rgba, scale: number): Rgba {
  const width = Math.round(img.width * scale);
  const height = Math.round(img.height * scale);
  const sx = img.width / width;
  const sy = img.height / height;
  const data = new Uint8Array(width * height * 4);
  for (let oy = 0; oy < height; oy++) {
    const y0 = oy * sy;
    const y1 = y0 + sy;
    for (let ox = 0; ox < width; ox++) {
      const x0 = ox * sx;
      const x1 = x0 + sx;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let area = 0;
      for (let y = Math.floor(y0); y < Math.ceil(y1); y++) {
        const wy = Math.min(y1, y + 1) - Math.max(y0, y);
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const w = wy * (Math.min(x1, x + 1) - Math.max(x0, x));
          const i = (y * img.width + x) * 4;
          const alpha = (img.data[i + 3] / 255) * w;
          r += img.data[i] * alpha;
          g += img.data[i + 1] * alpha;
          b += img.data[i + 2] * alpha;
          a += alpha;
          area += w;
        }
      }
      const o = (oy * width + ox) * 4;
      if (a > 0) data.set([Math.round(r / a), Math.round(g / a), Math.round(b / a)], o);
      data[o + 3] = Math.round((a / area) * 255);
    }
  }
  return { width, height, data };
}

/** logo-mark.png: the F alone, pixel for pixel, centred on a transparent square. */
export function makeMark(splash: Rgba, size = LOGO_SIZE): Rgba {
  const f = trimToAlpha(splash);
  const data = new Uint8Array(size * size * 4);
  const left = Math.floor((size - f.width) / 2);
  const top = Math.floor((size - f.height) / 2);
  for (let y = 0; y < f.height; y++) {
    data.set(f.data.subarray(y * f.width * 4, (y + 1) * f.width * 4), ((top + y) * size + left) * 4);
  }
  return { width: size, height: size, data };
}

/** How much of the pixel at (x, y) is inside the rounded square (anti-aliased edge). */
function squareCoverage(x: number, y: number, size: number, radius: number) {
  const cx = Math.min(Math.max(x + 0.5, radius), size - radius);
  const cy = Math.min(Math.max(y + 0.5, radius), size - radius);
  const distance = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
  return Math.min(Math.max(radius - distance + 0.5, 0), 1);
}

/** logo-premium.png: the F, at the same size as in icon.png, centred on a black rounded square. */
export function makePremium(splash: Rgba, tokens: LogoTokens): Rgba {
  const size = LOGO_SIZE;
  const radius = Math.round(size * LOGO_CORNER_RATIO);
  const trimmed = trimToAlpha(splash);
  const f = scaleArea(trimmed, F_HEIGHT / trimmed.height);
  const left = Math.floor((size - f.width) / 2);
  const top = Math.floor((size - f.height) / 2);
  const [br, bg, bb] = hexToRgb(tokens.black);

  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let rgb = [br, bg, bb];
      const fx = x - left;
      const fy = y - top;
      if (fx >= 0 && fy >= 0 && fx < f.width && fy < f.height) {
        const i = (fy * f.width + fx) * 4;
        const alpha = f.data[i + 3] / 255;
        rgb = rgb.map((c, k) => Math.round(f.data[i + k] * alpha + c * (1 - alpha)));
      }
      const o = (y * size + x) * 4;
      data.set(rgb, o);
      data[o + 3] = Math.round(squareCoverage(x, y, size, radius) * 255);
    }
  }
  return { width: size, height: size, data };
}
