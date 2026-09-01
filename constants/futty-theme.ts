/**
 * Fixed brand palette/type ported from the prototype (Downloads/futty-app.jsx),
 * used app-wide. Deliberately NOT theme-adaptive — every screen always looks
 * like this regardless of system light/dark mode, matching how Home was
 * originally built and now extended everywhere: constants/theme.ts's
 * Colors.light/dark are both set from this palette, so ThemedText/ThemedView/
 * useThemeColor all resolve to it without per-screen changes. This file stays
 * the source of truth; components/screens should prefer going through
 * ThemedText/useThemeColor rather than importing FuttyColors directly, except
 * where a screen intentionally needs a raw value (e.g. Home's fixed header,
 * which predates this app-wide rollout and works the same way already).
 */
// Lighter, friendlier green ramp (was a near-black deep emerald) — same
// token names throughout the app so this is the only file that needs to
// change for the whole app to reskin.
export const FuttyColors = {
  emerald950: '#15803d',
  emerald800: '#16a34a',
  emerald700: '#22c55e',
  emerald600: '#4ade80',
  emerald200: '#bbf7d0',
  amber400: '#fbbf24',
  rose600: '#e11d48',
  // Supporting accents — used sparingly for variety (category icons, badges)
  // alongside the green/white primary, not as replacements for it.
  sky500: '#0ea5e9',
  sky100: '#e0f2fe',
  coral500: '#f97316',
  coral100: '#ffedd5',
  violet500: '#8b5cf6',
  violet100: '#ede9fe',
  stone50: '#fafaf9',
  stone200: '#e7e5e4',
  stone400: '#a8a29e',
  stone500: '#78716c',
  stone700: '#44403c',
  // Near-black — bold/heading text (item 6: high-contrast Playtomic look).
  // Green (emerald950 etc.) stays reserved for buttons/highlights/icons.
  stone900: '#1c1917',
  white: '#ffffff',
} as const;

/** Family names as registered with useFonts() in the root layout. */
export const FuttyFonts = {
  display: 'ArchivoBlack_400Regular',
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemiBold: 'Inter_600SemiBold',
  sansBold: 'Inter_700Bold',
  mono: 'IBMPlexMono_500Medium',
  monoSemiBold: 'IBMPlexMono_600SemiBold',
} as const;

/** React Navigation theme (native-stack headers, tab bar chrome) built from
 *  the same fixed palette — so a pushed screen's back button/title and the
 *  tab bar match the rest of the app instead of React Navigation's defaults. */
export const FuttyNavigationTheme = {
  dark: false,
  colors: {
    primary: FuttyColors.emerald950,
    background: FuttyColors.stone50,
    card: FuttyColors.white,
    text: FuttyColors.stone900,
    border: FuttyColors.stone200,
    notification: FuttyColors.amber400,
  },
  fonts: {
    regular: { fontFamily: FuttyFonts.sans, fontWeight: '400' as const },
    medium: { fontFamily: FuttyFonts.sansMedium, fontWeight: '500' as const },
    bold: { fontFamily: FuttyFonts.sansSemiBold, fontWeight: '600' as const },
    heavy: { fontFamily: FuttyFonts.sansBold, fontWeight: '700' as const },
  },
};
