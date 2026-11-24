import fs from 'node:fs';
import path from 'node:path';

import * as theme from '@/constants/futty-theme';
import {
  colors,
  darkPalette,
  fontFamilies,
  highContrast,
  KIT_COLOUR_NAMES,
  kitColours,
  lightPalette,
  mono,
  type,
  type Palette,
} from '@/constants/futty-theme';

// WCAG 2.x relative luminance and contrast ratio, computed here rather than
// trusted from a design tool.
function channel(c: number) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 0xff;
  const g = (n >> 8) & 0xff;
  const b = n & 0xff;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: string, b: string) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const palettes: [string, Palette][] = [
  ['light', lightPalette],
  ['dark', darkPalette],
  ['light, high contrast', { ...lightPalette, ...highContrast.light }],
  ['dark, high contrast', { ...darkPalette, ...highContrast.dark }],
];

describe('colour tokens (spec 15 section 0.2)', () => {
  it('has the light values from the spec', () => {
    expect(lightPalette).toMatchObject({
      green: '#00FF9C',
      greenInk: '#03140C',
      night: '#05100B',
      ink: '#0B1215',
      muted: '#5B6470',
      canvas: '#F4F5F7',
      surface: '#FFFFFF',
      border: '#E4E7EB',
      greenSoft: 'rgba(0, 255, 156, 0.12)',
      warning: '#8A5C00',
      warningLight: '#FFF6DA',
      danger: '#B42318',
    });
  });

  it('has the proposed dark values (S1 PR)', () => {
    expect(darkPalette).toMatchObject({
      canvas: '#05100B',
      surface: '#0F1A16',
      surfaceRaised: '#16231E',
      border: '#1E2A26',
      ink: '#F4F5F7',
      muted: '#8FA39A',
      green: '#00FF9C',
      greenInk: '#03140C',
      positive: '#00FF9C',
      tabBar: '#0B1215',
      tabBarBorder: '#1E2A26',
    });
  });

  it('light and dark have exactly the same tokens', () => {
    expect(Object.keys(darkPalette).sort()).toEqual(Object.keys(lightPalette).sort());
  });

  it('high contrast only overrides tokens that exist', () => {
    for (const mode of ['light', 'dark'] as const) {
      for (const key of Object.keys(highContrast[mode])) expect(lightPalette).toHaveProperty(key);
    }
  });

  it('keeps the old names as aliases, so existing screens keep working', () => {
    for (const p of [lightPalette, darkPalette]) {
      expect(p.inkMuted).toBe(p.muted);
      expect(p.brand).toBe(p.green);
      expect(p.brandSoft).toBe(p.greenSoft);
      expect(p.onBrand).toBe(p.greenInk);
      expect(p.success).toBe(p.positive);
    }
  });

  it('`colors` is the light palette (for tests and lib code only; screens use useTheme)', () => {
    expect(colors).toBe(lightPalette);
  });

  it('positive is a darker text green, not the logo green, in light mode', () => {
    expect(lightPalette.positive).toBe('#12804A');
    expect(lightPalette.positive).not.toBe(lightPalette.green);
    expect(contrast(lightPalette.positive, lightPalette.canvas)).toBeCloseTo(4.57, 2);
    expect(contrast(lightPalette.positive, lightPalette.surface)).toBeCloseTo(4.99, 2);
  });

  it('uses the logo colours only for the logo (U9), so the rest of the app keeps its colours', () => {
    const root = path.join(__dirname, '..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          if (/\b(logoMint|logoBlack)\b/.test(fs.readFileSync(path.join(root, rel), 'utf8'))) hits.push(rel);
        }
      }
    };
    ['app', 'components', 'lib', 'hooks'].filter((d) => fs.existsSync(path.join(root, d))).forEach(walk);
    expect(hits).toEqual(['components/ui/futty-logo.tsx']);
  });

  // Every pair a screen draws text in. Each must pass WCAG AA (4.5:1) in
  // light, dark and both high-contrast modes.
  const textOn: [keyof Palette, keyof Palette][] = [
    ['ink', 'canvas'],
    ['ink', 'surface'],
    ['ink', 'surfaceRaised'],
    ['ink', 'fill'],
    ['muted', 'canvas'],
    ['muted', 'surface'],
    ['muted', 'fill'],
    ['positive', 'canvas'],
    ['positive', 'surface'],
    ['warning', 'canvas'],
    ['warning', 'surface'],
    ['warning', 'warningLight'],
    ['danger', 'canvas'],
    ['danger', 'surface'],
    ['danger', 'dangerLight'],
    ['info', 'surface'],
    ['info', 'infoLight'],
    ['greenInk', 'green'],
    ['onNight', 'night'],
    ['onNightMuted', 'night'],
    ['onFormWin', 'formWin'],
    ['onFormDraw', 'formDraw'],
    ['onFormLoss', 'formLoss'],
    ['onRatingTop', 'ratingTop'],
    ['onDanger', 'dangerFill'],
  ];

  describe.each(palettes)('%s', (_name, p) => {
    it.each(textOn)('%s on %s has a contrast ratio of at least 4.5', (fg, bg) => {
      expect(contrast(p[fg], p[bg])).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('never uses green as text on white or canvas in light mode', () => {
    const text = new Set(textOn.filter(([, bg]) => bg === 'canvas' || bg === 'surface').map(([fg]) => fg));
    for (const fg of text) expect(lightPalette[fg]).not.toBe(lightPalette.green);
  });

  it('computes contrast correctly (black on white is 21)', () => {
    expect(contrast('#000000', '#FFFFFF')).toBeCloseTo(21, 5);
  });
});

describe('kit colour tokens (A12)', () => {
  it('has the 8 kit colours, in picker order', () => {
    expect(KIT_COLOUR_NAMES).toEqual([
      'kitRed',
      'kitBlue',
      'kitSky',
      'kitGreen',
      'kitYellow',
      'kitOrange',
      'kitBlack',
      'kitWhite',
    ]);
    expect(Object.keys(kitColours).sort()).toEqual([...KIT_COLOUR_NAMES].sort());
  });

  it('has the agreed shirt colours', () => {
    expect(Object.fromEntries(KIT_COLOUR_NAMES.map((n) => [n, kitColours[n].shirt]))).toEqual({
      kitRed: '#C8102E',
      kitBlue: '#1D428A',
      kitSky: '#6CABDD',
      kitGreen: '#00843D',
      kitYellow: '#FFD100',
      kitOrange: '#F57F20',
      kitBlack: '#111111',
      kitWhite: '#FFFFFF',
    });
  });

  for (const name of KIT_COLOUR_NAMES) {
    it(`the number on ${name} has a contrast ratio of at least 4.5`, () => {
      expect(contrast(kitColours[name].label, kitColours[name].shirt)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('type scale (spec 15 section 0.3)', () => {
  it('uses Cairo for headings and numbers, Inter for everything else', () => {
    expect(type).toEqual({
      display: { fontSize: 28, lineHeight: 38, fontFamily: 'Cairo_700Bold' },
      title: { fontSize: 22, lineHeight: 30, fontFamily: 'Cairo_700Bold' },
      number: { fontSize: 22, lineHeight: 30, fontFamily: 'Cairo_700Bold' },
      headline: { fontSize: 17, lineHeight: 22, fontFamily: 'Inter_600SemiBold' },
      body: { fontSize: 16, lineHeight: 22, fontFamily: 'Inter_400Regular' },
      callout: { fontSize: 14, lineHeight: 20, fontFamily: 'Inter_500Medium' },
      caption: { fontSize: 13, lineHeight: 18, fontFamily: 'Inter_500Medium' },
    });
  });

  it('has a dyslexia-friendly family (Lexend, SIL Open Font License 1.1) with every weight', () => {
    expect(Object.keys(fontFamilies.lexend)).toEqual(Object.keys(fontFamilies.inter));
    expect(Object.values(fontFamilies.lexend).every((f) => f.startsWith('Lexend_'))).toBe(true);
  });

  it('Archivo Black is gone', () => {
    const pkg = fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8');
    expect(pkg).not.toMatch(/archivo/i);
    expect(JSON.stringify(fontFamilies)).not.toMatch(/archivo/i);
  });
});

describe('deprecated names (removed in U8)', () => {
  it('FuttyColors and FuttyFonts are gone', () => {
    expect(theme).not.toHaveProperty('FuttyColors');
    expect(theme).not.toHaveProperty('FuttyFonts');
  });

  it('IBM Plex Mono stays, for codes only', () => {
    expect(mono).toEqual({ medium: 'IBMPlexMono_500Medium', semiBold: 'IBMPlexMono_600SemiBold' });
  });

  it('nothing in app/, components/ or lib/ uses the old names', () => {
    const root = path.join(__dirname, '..');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) walk(rel);
        else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
          if (/\b(FuttyColors|FuttyFonts)\b/.test(fs.readFileSync(path.join(root, rel), 'utf8'))) hits.push(rel);
        }
      }
    };
    ['app', 'components', 'lib', 'hooks'].filter((d) => fs.existsSync(path.join(root, d))).forEach(walk);
    expect(hits).toEqual([]);
  });
});
