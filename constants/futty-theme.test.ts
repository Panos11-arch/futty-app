import { FuttyColors, FuttyFonts, colors, type } from '@/constants/futty-theme';

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
    });
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

describe('deprecated names', () => {
  it('map every old colour to the nearest new token', () => {
    expect(FuttyColors).toEqual({
      emerald950: colors.brand,
      emerald800: colors.brand,
      emerald700: colors.brand,
      emerald600: colors.brand,
      emerald200: colors.brandSoft,
      amber400: colors.warning,
      rose600: colors.danger,
      sky500: colors.inkMuted,
      sky100: colors.canvas,
      coral500: colors.warning,
      coral100: colors.canvas,
      violet500: colors.inkMuted,
      violet100: colors.canvas,
      stone50: colors.canvas,
      stone200: colors.border,
      stone400: colors.inkMuted,
      stone500: colors.inkMuted,
      stone700: colors.ink,
      stone900: colors.ink,
      white: colors.surface,
    });
  });

  it('no longer use Archivo Black for display text', () => {
    expect(FuttyFonts.display).toBe('Inter_700Bold');
    expect(Object.values(FuttyFonts).some((f) => f.includes('Archivo'))).toBe(false);
  });
});
