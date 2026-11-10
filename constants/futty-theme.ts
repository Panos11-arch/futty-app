/**
 * The single source of design tokens (docs/specs/15-design.md section 3).
 * Screens use these, through components/ui, and never hard-code a colour,
 * font size, radius or shadow. The app has one fixed light look:
 * constants/theme.ts maps Colors.light and Colors.dark to the same tokens.
 */
import { StyleSheet } from 'react-native';

export const colors = {
  /** Headings and body text */
  ink: '#0B1215',
  /** Secondary text, captions */
  inkMuted: '#5B6470',
  /** Cards, sheets, inputs */
  surface: '#FFFFFF',
  /** Screen background behind cards */
  canvas: '#F4F5F7',
  /** Hairlines, card borders, dividers */
  border: '#E4E7EB',
  /** Primary buttons, selected states, links. Nothing else */
  brand: '#0E5A3A',
  /** Selected chip and row backgrounds */
  brandSoft: '#E7F1EC',
  /** Paid, confirmed */
  success: '#1F7A45',
  /** Pending, weather warnings, short game */
  warning: '#8A5C00',
  /** Debt, failed payment, destructive actions */
  danger: '#B42318',
  /** Text and icons on brand buttons */
  onBrand: '#FFFFFF',
} as const;

/** Inter families as registered with useFonts() in app/_layout.tsx. */
const inter = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
} as const;

/** Type scale: size / line height, weight via the matching Inter family. */
export const type = {
  display: { fontSize: 28, lineHeight: 34, fontFamily: inter.bold },
  title: { fontSize: 22, lineHeight: 28, fontFamily: inter.bold },
  headline: { fontSize: 17, lineHeight: 22, fontFamily: inter.semiBold },
  body: { fontSize: 15, lineHeight: 20, fontFamily: inter.regular },
  callout: { fontSize: 13, lineHeight: 18, fontFamily: inter.medium },
  caption: { fontSize: 12, lineHeight: 16, fontFamily: inter.medium },
} as const;

/** Spread onto any type style that shows prices, times or scores. */
export const tabular = { fontVariant: ['tabular-nums'] as 'tabular-nums'[] };

/** 4-point grid: 16 side gutter, 12 between cards, 24 between sections. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { card: 12, control: 10, pill: 999 } as const;

/** The one shadow: y 2, blur 8, 6% black. Use it or a hairline border, never both. */
export const shadow = { boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.06)' } as const;

export const hairline = StyleSheet.hairlineWidth;

/**
 * @deprecated Old palette names, kept so screens don't break before they're
 * restyled. Each maps to the nearest new token. Use `colors`. Removed in U8.
 */
export const FuttyColors = {
  /** @deprecated use colors.brand */
  emerald950: colors.brand,
  /** @deprecated use colors.brand */
  emerald800: colors.brand,
  /** @deprecated use colors.brand */
  emerald700: colors.brand,
  /** @deprecated use colors.brand */
  emerald600: colors.brand,
  /** @deprecated use colors.brandSoft */
  emerald200: colors.brandSoft,
  /** @deprecated use colors.warning */
  amber400: colors.warning,
  /** @deprecated use colors.danger */
  rose600: colors.danger,
  /** @deprecated use colors.inkMuted */
  sky500: colors.inkMuted,
  /** @deprecated use colors.canvas */
  sky100: colors.canvas,
  /** @deprecated use colors.warning */
  coral500: colors.warning,
  /** @deprecated use colors.canvas */
  coral100: colors.canvas,
  /** @deprecated use colors.inkMuted */
  violet500: colors.inkMuted,
  /** @deprecated use colors.canvas */
  violet100: colors.canvas,
  /** @deprecated use colors.canvas */
  stone50: colors.canvas,
  /** @deprecated use colors.border */
  stone200: colors.border,
  /** @deprecated use colors.inkMuted */
  stone400: colors.inkMuted,
  /** @deprecated use colors.inkMuted */
  stone500: colors.inkMuted,
  /** @deprecated use colors.ink */
  stone700: colors.ink,
  /** @deprecated use colors.ink */
  stone900: colors.ink,
  /** @deprecated use colors.surface */
  white: colors.surface,
} as const;

/**
 * @deprecated Use the `type` scale. Removed in U8, except the mono families,
 * which stay for codes like the check-in code.
 */
export const FuttyFonts = {
  /** @deprecated Archivo Black is gone; use type.display */
  display: inter.bold,
  /** @deprecated use type.body */
  sans: inter.regular,
  /** @deprecated use type.callout or type.caption */
  sansMedium: inter.medium,
  /** @deprecated use type.headline */
  sansSemiBold: inter.semiBold,
  /** @deprecated use type.title or type.display */
  sansBold: inter.bold,
  /** IBM Plex Mono, for codes only */
  mono: 'IBMPlexMono_500Medium',
  /** IBM Plex Mono, for codes only */
  monoSemiBold: 'IBMPlexMono_600SemiBold',
} as const;

/** React Navigation theme (native-stack headers, tab bar chrome) from the same tokens. */
export const FuttyNavigationTheme = {
  dark: false,
  colors: {
    primary: colors.brand,
    background: colors.canvas,
    card: colors.surface,
    text: colors.ink,
    border: colors.border,
    notification: colors.warning,
  },
  fonts: {
    regular: { fontFamily: inter.regular, fontWeight: '400' as const },
    medium: { fontFamily: inter.medium, fontWeight: '500' as const },
    bold: { fontFamily: inter.semiBold, fontWeight: '600' as const },
    heavy: { fontFamily: inter.bold, fontWeight: '700' as const },
  },
};
