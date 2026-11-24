import { darkPalette, highContrast, lightPalette } from '@/constants/futty-theme';
import {
  buildTheme,
  combinedTextScale,
  DEFAULT_SETTINGS,
  MAX_TEXT_SCALE,
  navigationTheme,
  type DisplaySettings,
  type SystemSignals,
} from '@/lib/theme/build-theme';

const phone = (over: Partial<SystemSignals> = {}): SystemSignals => ({
  colorScheme: 'light',
  fontScale: 1,
  reduceMotion: false,
  boldText: false,
  ...over,
});
const settings = (over: Partial<DisplaySettings> = {}): DisplaySettings => ({ ...DEFAULT_SETTINGS, ...over });

/** What the player actually sees: our scale times what RN applies from the phone. */
const total = (phoneScale: number, slider: number) => {
  const s = combinedTextScale(phoneScale, slider);
  return s.inApp * Math.min(phoneScale, s.maxFontSizeMultiplier);
};

describe('defaults', () => {
  it('follows the phone, 100% text, every toggle off, haptics on', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      appearance: 'system',
      textScale: 1,
      dyslexiaFont: false,
      boldText: false,
      highContrast: false,
      reduceMotion: false,
      colourBlind: false,
      haptics: true,
    });
  });
});

describe('appearance', () => {
  it.each([
    ['system', 'light', 'light'],
    ['system', 'dark', 'dark'],
    ['system', null, 'light'],
    ['light', 'dark', 'light'],
    ['dark', 'light', 'dark'],
  ] as const)('%s with the phone on %s is %s', (appearance, colorScheme, expected) => {
    const t = buildTheme(settings({ appearance }), phone({ colorScheme }));
    expect(t.scheme).toBe(expected);
    expect(t.colors).toBe(expected === 'dark' ? darkPalette : lightPalette);
  });

  it('high contrast strengthens borders and secondary text in both modes', () => {
    const light = buildTheme(settings({ highContrast: true, appearance: 'light' }), phone());
    expect(light.colors.border).toBe(highContrast.light.border);
    expect(light.colors.muted).toBe(highContrast.light.muted);
    expect(light.colors.inkMuted).toBe(highContrast.light.muted);
    const dark = buildTheme(settings({ highContrast: true, appearance: 'dark' }), phone());
    expect(dark.colors.border).toBe(highContrast.dark.border);
    expect(dark.colors.ink).toBe(darkPalette.ink);
  });

  it('gives React Navigation a matching light or dark theme', () => {
    const dark = navigationTheme(buildTheme(settings({ appearance: 'dark' }), phone()));
    expect(dark.dark).toBe(true);
    expect(dark.colors.background).toBe(darkPalette.canvas);
    expect(dark.colors.text).toBe(darkPalette.ink);
    const light = navigationTheme(buildTheme(settings(), phone()));
    expect(light.dark).toBe(false);
    expect(light.colors.card).toBe(lightPalette.surface);
  });
});

describe('text size: the phone times the slider never goes above 2.0x', () => {
  it('caps at 2.0', () => expect(MAX_TEXT_SCALE).toBe(2));

  it.each([
    [1, 1, 1],
    [1, 1.5, 1.5],
    [1, 2, 2],
    [1.5, 1, 1.5],
    [1.5, 2, 2],
    [1.3, 1.2, 1.56],
    [2, 2, 2],
    [2.5, 1, 2],
    [3.1, 1.6, 2],
    [0.85, 2, 1.7],
  ])('phone %sx + slider %sx = %sx', (phoneScale, slider, expected) => {
    expect(total(phoneScale, slider)).toBeCloseTo(expected, 5);
  });

  it('phone 1.5x + slider 2.0x shrinks our scale to 1.333 and lets the phone add 1.5', () => {
    expect(combinedTextScale(1.5, 2)).toEqual({ inApp: 2 / 1.5, maxFontSizeMultiplier: 1.5 });
  });

  it('keeps the slider within 100% to 200%', () => {
    expect(total(1, 5)).toBe(2);
    expect(total(1, 0.2)).toBe(1);
    expect(total(1, Number.NaN)).toBe(1);
  });

  it('scales every size and line height of the type scale', () => {
    const base = buildTheme(settings(), phone());
    const big = buildTheme(settings({ textScale: 2 }), phone());
    expect(big.type.body.fontSize).toBe(base.type.body.fontSize * 2);
    expect(big.type.display.lineHeight).toBe(base.type.display.lineHeight * 2);
    expect(big.maxFontSizeMultiplier).toBe(1);
  });
});

describe('fonts', () => {
  it('Cairo for headings and numbers, Inter for the rest', () => {
    const t = buildTheme(settings(), phone());
    expect(t.type.display.fontFamily).toBe('Cairo_700Bold');
    expect(t.type.number.fontFamily).toBe('Cairo_700Bold');
    expect(t.type.body.fontFamily).toBe('Inter_400Regular');
  });

  it('the dyslexia-friendly font replaces both with Lexend', () => {
    const t = buildTheme(settings({ dyslexiaFont: true }), phone());
    expect(t.type.display.fontFamily).toBe('Lexend_700Bold');
    expect(t.type.body.fontFamily).toBe('Lexend_400Regular');
    expect(t.fonts.body.semiBold).toBe('Lexend_600SemiBold');
  });

  it.each([
    ['the setting', settings({ boldText: true }), phone()],
    ['the phone', settings(), phone({ boldText: true })],
  ])('bold text from %s makes every step one weight heavier', (_n, s, p) => {
    const t = buildTheme(s, p);
    expect(t.type.body.fontFamily).toBe('Inter_500Medium');
    expect(t.type.headline.fontFamily).toBe('Inter_700Bold');
    expect(t.type.display.fontFamily).toBe('Cairo_800ExtraBold');
    expect(t.fonts.body.regular).toBe('Inter_500Medium');
  });
});

describe('motion, results and haptics', () => {
  it.each([
    [false, false, false],
    [true, false, true],
    [false, true, true],
    [true, true, true],
  ])('reduce motion: setting %s, phone %s -> %s', (setting, phoneOn, expected) => {
    expect(buildTheme(settings({ reduceMotion: setting }), phone({ reduceMotion: phoneOn })).reduceMotion).toBe(expected);
  });

  it('passes colour-blind friendly results and haptics through', () => {
    const t = buildTheme(settings({ colourBlind: true, haptics: false }), phone());
    expect(t.colourBlind).toBe(true);
    expect(t.haptics).toBe(false);
  });
});
