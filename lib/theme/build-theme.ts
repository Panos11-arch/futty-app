/**
 * Builds the live theme from the player's display settings and what the
 * phone says (docs/specs/15-design.md sections 0.2 to 0.4). Pure, so every
 * rule here is unit-tested; ThemeProvider (theme-provider.tsx) feeds it.
 */
import {
  buildType,
  fontFamilies,
  hairline,
  paletteFor,
  radius,
  space,
  type FontSet,
  type Palette,
  type TypeScale,
} from '@/constants/futty-theme';

export type Appearance = 'system' | 'light' | 'dark';

/** Settings → Appearance and Settings → Accessibility, stored on the phone (settings.ts). */
export type DisplaySettings = {
  appearance: Appearance;
  /** The in-app text size slider, 1.0 to 2.0 */
  textScale: number;
  dyslexiaFont: boolean;
  boldText: boolean;
  highContrast: boolean;
  reduceMotion: boolean;
  colourBlind: boolean;
  haptics: boolean;
};

export const DEFAULT_SETTINGS: DisplaySettings = {
  appearance: 'system',
  textScale: 1,
  dyslexiaFont: false,
  boldText: false,
  highContrast: false,
  reduceMotion: false,
  colourBlind: false,
  haptics: true,
};

/** What the phone's own settings say. */
export type SystemSignals = {
  colorScheme: 'light' | 'dark' | 'unspecified' | null | undefined;
  /** The phone's text size, as React Native applies it to every fontSize */
  fontScale: number;
  reduceMotion: boolean;
  /** iOS Bold Text */
  boldText: boolean;
};

export type Theme = {
  scheme: 'light' | 'dark';
  colors: Palette;
  type: TypeScale;
  fonts: { heading: FontSet; body: FontSet };
  space: typeof space;
  radius: typeof radius;
  hairline: number;
  /** Our multiplier on every token size (the slider, capped with the phone's scale) */
  textScale: number;
  /** For every Text: stops the phone's scale taking the total above MAX_TEXT_SCALE */
  maxFontSizeMultiplier: number;
  highContrast: boolean;
  reduceMotion: boolean;
  colourBlind: boolean;
  haptics: boolean;
};

/** The phone's text size times the slider never goes above this. */
export const MAX_TEXT_SCALE = 2;
export const MIN_SLIDER = 1;

/** Keeps a stored slider value within 100% to 200%. */
export function clampSlider(value: number) {
  if (!Number.isFinite(value)) return MIN_SLIDER;
  return Math.min(MAX_TEXT_SCALE, Math.max(MIN_SLIDER, value));
}

/**
 * Splits the total text size between us and the phone. React Native applies
 * the phone's scale itself (up to maxFontSizeMultiplier), so we scale our
 * token sizes by `inApp` and cap the phone's part, giving
 * inApp × min(phone, max) = min(phone × slider, 2.0).
 */
export function combinedTextScale(phoneScale: number, slider: number) {
  const phone = Number.isFinite(phoneScale) && phoneScale > 0 ? phoneScale : 1;
  const inApp = Math.min(clampSlider(slider), MAX_TEXT_SCALE / phone);
  return { inApp, maxFontSizeMultiplier: MAX_TEXT_SCALE / inApp };
}

export function buildTheme(settings: DisplaySettings, system: SystemSignals): Theme {
  const scheme =
    settings.appearance === 'system' ? (system.colorScheme === 'dark' ? 'dark' : 'light') : settings.appearance;
  const heading = settings.dyslexiaFont ? fontFamilies.lexend : fontFamilies.cairo;
  const body = settings.dyslexiaFont ? fontFamilies.lexend : fontFamilies.inter;
  const bolder = settings.boldText || system.boldText;
  const { inApp, maxFontSizeMultiplier } = combinedTextScale(system.fontScale, settings.textScale);
  const shift = (set: FontSet): FontSet =>
    bolder
      ? { regular: set.medium, medium: set.semiBold, semiBold: set.bold, bold: set.extraBold, extraBold: set.extraBold }
      : set;

  return {
    scheme,
    colors: paletteFor(scheme, settings.highContrast),
    type: buildType(heading, body, inApp, bolder),
    fonts: { heading: shift(heading), body: shift(body) },
    space,
    radius,
    hairline,
    textScale: inApp,
    maxFontSizeMultiplier,
    highContrast: settings.highContrast,
    reduceMotion: settings.reduceMotion || system.reduceMotion,
    colourBlind: settings.colourBlind,
    haptics: settings.haptics,
  };
}

/** React Navigation's theme (native-stack headers, tab bar chrome) from the same tokens. */
export function navigationTheme(theme: Theme) {
  const { colors, fonts } = theme;
  return {
    dark: theme.scheme === 'dark',
    colors: {
      primary: colors.positive,
      background: colors.canvas,
      card: colors.surface,
      text: colors.ink,
      border: colors.border,
      notification: colors.warning,
    },
    fonts: {
      regular: { fontFamily: fonts.body.regular, fontWeight: '400' as const },
      medium: { fontFamily: fonts.body.medium, fontWeight: '500' as const },
      bold: { fontFamily: fonts.body.semiBold, fontWeight: '600' as const },
      heavy: { fontFamily: fonts.body.bold, fontWeight: '700' as const },
    },
  };
}
