import fs from 'node:fs';
import path from 'node:path';

import * as theme from '@/constants/futty-theme';
import { colors, KIT_COLOUR_NAMES, kitColours, mono, type } from '@/constants/futty-theme';

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

describe('colour tokens', () => {
  it('has the values from the design brief', () => {
    expect(colors).toEqual({
      ink: '#0B1215',
      inkMuted: '#5B6470',
      surface: '#FFFFFF',
      canvas: '#F4F5F7',
      border: '#E4E7EB',
      brand: '#0E5A3A',
      brandSoft: '#E7F1EC',
      success: '#1F7A45',
      warning: '#8A5C00',
      danger: '#B42318',
      onBrand: '#FFFFFF',
      logoMint: '#00FF9C',
      logoBlack: '#000000',
    });
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

  const textColours = ['ink', 'inkMuted', 'brand', 'success', 'warning', 'danger'] as const;
  const backgrounds = ['surface', 'canvas'] as const;

  for (const fg of textColours) {
    for (const bg of backgrounds) {
      it(`${fg} on ${bg} has a contrast ratio of at least 4.5`, () => {
        expect(contrast(colors[fg], colors[bg])).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it('onBrand on brand has a contrast ratio of at least 4.5', () => {
    expect(contrast(colors.onBrand, colors.brand)).toBeGreaterThanOrEqual(4.5);
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

describe('type scale', () => {
  it('matches the design brief', () => {
    expect(type).toEqual({
      display: { fontSize: 28, lineHeight: 34, fontFamily: 'Inter_700Bold' },
      title: { fontSize: 22, lineHeight: 28, fontFamily: 'Inter_700Bold' },
      headline: { fontSize: 17, lineHeight: 22, fontFamily: 'Inter_600SemiBold' },
      body: { fontSize: 15, lineHeight: 20, fontFamily: 'Inter_400Regular' },
      callout: { fontSize: 13, lineHeight: 18, fontFamily: 'Inter_500Medium' },
      caption: { fontSize: 12, lineHeight: 16, fontFamily: 'Inter_500Medium' },
    });
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
