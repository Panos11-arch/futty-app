import {
  decodePng,
  encodePng,
  F_HEIGHT,
  LOGO_CORNER_RATIO,
  LOGO_SIZE,
  makeMark,
  makePremium,
  readLogoTokens,
  type Rgba,
} from './logo';

const MINT = [0x00, 0xff, 0x9c];
const tokens = { mint: '#00FF9C', black: '#000000' };

/** A stand-in for splash-icon.png: a solid mint block (a fake F) on transparent. */
function fakeSplash(size = 64, box = { x: 20, y: 4, w: 24, h: 56 }): Rgba {
  const data = new Uint8Array(size * size * 4);
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      data.set([...MINT, 255], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, data };
}

function px(img: Rgba, x: number, y: number) {
  const i = (y * img.width + x) * 4;
  return Array.from(img.data.slice(i, i + 4));
}

describe('PNG', () => {
  it('round-trips RGBA through encode and decode', () => {
    const img = fakeSplash();
    const back = decodePng(encodePng(img));
    expect(back.width).toBe(64);
    expect(back.height).toBe(64);
    expect(Buffer.from(back.data).equals(Buffer.from(img.data))).toBe(true);
  });

  it('refuses a file that is not a PNG', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow('not a PNG');
  });

  it('encodes the same image to the same bytes every time', () => {
    const img = fakeSplash();
    expect(Buffer.from(encodePng(img)).equals(Buffer.from(encodePng(img)))).toBe(true);
  });
});

describe('readLogoTokens', () => {
  it('reads both logo colours from the theme source', () => {
    const source = "export const colors = {\n  ink: '#0B1215',\n  logoMint: '#00FF9C',\n  logoBlack: '#000000',\n};";
    expect(readLogoTokens(source)).toEqual({ mint: '#00FF9C', black: '#000000' });
  });

  it('throws when a logo colour is missing', () => {
    expect(() => readLogoTokens("logoMint: '#00FF9C'")).toThrow('logoBlack');
  });
});

describe('makeMark', () => {
  it('keeps the F pixel for pixel, centred on a transparent square', () => {
    const splash = fakeSplash(64, { x: 2, y: 2, w: 24, h: 56 });
    const mark = makeMark(splash, 64);
    expect(mark.width).toBe(64);
    expect(px(mark, 0, 0)).toEqual([0, 0, 0, 0]);
    expect(px(mark, 63, 63)).toEqual([0, 0, 0, 0]);
    // Centred: 24 wide in 64 -> x 20..43; 56 tall -> y 4..59.
    expect(px(mark, 19, 30)[3]).toBe(0);
    expect(px(mark, 20, 30)).toEqual([...MINT, 255]);
    expect(px(mark, 43, 30)).toEqual([...MINT, 255]);
    expect(px(mark, 44, 30)[3]).toBe(0);
    expect(px(mark, 30, 4)).toEqual([...MINT, 255]);
    expect(px(mark, 30, 3)[3]).toBe(0);
  });

  it('refuses a splash with no F in it', () => {
    expect(() => makeMark({ width: 4, height: 4, data: new Uint8Array(64) }, 4)).toThrow('no visible pixels');
  });
});

describe('makePremium', () => {
  const premium = makePremium(fakeSplash(), tokens);

  it('is a 1024 square', () => {
    expect(premium.width).toBe(LOGO_SIZE);
    expect(premium.height).toBe(LOGO_SIZE);
  });

  it('is opaque black at the edge midpoints, with transparent rounded corners', () => {
    const mid = LOGO_SIZE / 2;
    expect(px(premium, mid, 0)).toEqual([0, 0, 0, 255]);
    expect(px(premium, 0, mid)).toEqual([0, 0, 0, 255]);
    expect(px(premium, LOGO_SIZE - 1, mid)).toEqual([0, 0, 0, 255]);
    expect(px(premium, mid, LOGO_SIZE - 1)).toEqual([0, 0, 0, 255]);
    expect(px(premium, 0, 0)[3]).toBe(0);
    expect(px(premium, LOGO_SIZE - 1, LOGO_SIZE - 1)[3]).toBe(0);
    // Just inside the corner radius, along the diagonal, is solid again.
    const r = Math.round(LOGO_SIZE * LOGO_CORNER_RATIO);
    expect(px(premium, r, r)).toEqual([0, 0, 0, 255]);
  });

  it('puts the mint F in the centre, as tall as the F in icon.png', () => {
    const mid = LOGO_SIZE / 2;
    expect(px(premium, mid, mid)).toEqual([...MINT, 255]);
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < LOGO_SIZE; y++) {
      const [r] = px(premium, mid, y);
      if (r === 0 && px(premium, mid, y)[1] > 128) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    expect(bottom - top + 1).toBeGreaterThanOrEqual(F_HEIGHT - 1);
    expect(bottom - top + 1).toBeLessThanOrEqual(F_HEIGHT + 1);
    expect(Math.abs((top + bottom) / 2 - mid)).toBeLessThanOrEqual(1);
  });

  it('takes the background colour from the tokens', () => {
    const navy = makePremium(fakeSplash(), { mint: '#00FF9C', black: '#000080' });
    expect(px(navy, LOGO_SIZE / 2, 0)).toEqual([0, 0, 0x80, 255]);
  });
});
