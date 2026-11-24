/**
 * The single source of design tokens (docs/specs/15-design.md sections 0.2
 * and 0.3). Every colour has a light and a dark value. Screens never import
 * a palette or the type scale from here: they read the live theme through
 * useTheme() or makeStyles() (lib/theme), which applies the player's
 * Appearance and Accessibility settings. Spacing, radius, hairline and
 * tabular figures are the same in every theme and can be imported directly.
 */
import { StyleSheet } from 'react-native';

/** The tokens every palette has. Old names (brand, inkMuted…) are aliases. */
type BaseTokens = {
  /** Headings and body text */
  ink: string;
  /** Secondary text, captions */
  muted: string;
  /** Screen background behind cards */
  canvas: string;
  /** Cards, sheets */
  surface: string;
  /** A card on a card, menus */
  surfaceRaised: string;
  /** Inputs, steppers, stat tiles, quick-action circles */
  fill: string;
  /** Hairlines, card borders, dividers */
  border: string;
  /** Primary buttons, selected tabs, chips and toggles, active states. Never text on light. */
  green: string;
  /** Text and icons on green */
  greenInk: string;
  /** Selected backgrounds */
  greenSoft: string;
  /** Dark panels: player card top, league and Team of the Week headers */
  night: string;
  /** Text on night */
  onNight: string;
  /** Secondary text on night */
  onNightMuted: string;
  /** Green-ish text: paid, confirmed, links. #12804A on light, the logo green on dark. */
  positive: string;
  warning: string;
  warningLight: string;
  /** Errors, destructive text */
  danger: string;
  dangerLight: string;
  /** Destructive filled buttons */
  dangerFill: string;
  onDanger: string;
  info: string;
  infoLight: string;
  /** W / D / L result badges */
  formWin: string;
  onFormWin: string;
  formDraw: string;
  onFormDraw: string;
  formLoss: string;
  onFormLoss: string;
  /** The top rating (Player of the Week) badge */
  ratingTop: string;
  onRatingTop: string;
  /** The pitch drawings (Team of the Week, goals) */
  pitch: string;
  pitchLine: string;
  /** Behind sheets and modals */
  scrim: string;
  tabBar: string;
  tabBarBorder: string;
  /** The selected tab's pill (S2) */
  tabSelectedBg: string;
  /** The selected tab's icon and label: dark on light, mint on dark */
  tabSelectedInk: string;
  /** The Card button (S2): Basic is a mint circle with a dark F */
  cardBasicBg: string;
  cardBasicLogo: string;
  /** Premium is a black circle with the neon F (the logo's own colour) */
  cardPremiumBg: string;
  /** The thin ring around the Premium circle: dark mode only */
  cardButtonRing: string;
  /** Logo only (components/ui/futty-logo.tsx). Never UI. The F. */
  logoMint: string;
  /** Logo only. The Premium logo's background. */
  logoBlack: string;
};

export type Palette = BaseTokens & {
  /** Alias of muted */
  inkMuted: string;
  /** Alias of green: a fill, never text on light */
  brand: string;
  /** Alias of greenSoft */
  brandSoft: string;
  /** Alias of greenInk */
  onBrand: string;
  /** Alias of positive */
  success: string;
};

export type ColorName = keyof Palette;

/** Adds the old names, so screens written before S1 keep working. */
export function withAliases(base: BaseTokens): Palette {
  return {
    ...base,
    inkMuted: base.muted,
    brand: base.green,
    brandSoft: base.greenSoft,
    onBrand: base.greenInk,
    success: base.positive,
  };
}

const identity = { logoMint: '#00FF9C', logoBlack: '#000000' } as const;

export const lightPalette: Palette = withAliases({
  ink: '#0B1215',
  muted: '#5B6470',
  canvas: '#F4F5F7',
  surface: '#FFFFFF',
  surfaceRaised: '#FFFFFF',
  fill: '#F1F3F5',
  border: '#E4E7EB',
  green: '#00FF9C',
  greenInk: '#03140C',
  greenSoft: 'rgba(0, 255, 156, 0.12)',
  night: '#05100B',
  onNight: '#FFFFFF',
  onNightMuted: '#8FA39A',
  positive: '#12804A',
  warning: '#8A5C00',
  warningLight: '#FFF6DA',
  danger: '#B42318',
  dangerLight: '#FDE8E8',
  dangerFill: '#B42318',
  onDanger: '#FFFFFF',
  info: '#2456D6',
  infoLight: '#E6EEFE',
  formWin: '#00FF9C',
  onFormWin: '#03140C',
  formDraw: '#9CA3AF',
  onFormDraw: '#0B1215',
  formLoss: '#B42318',
  onFormLoss: '#FFFFFF',
  ratingTop: '#F5B800',
  onRatingTop: '#03140C',
  pitch: '#0F3D27',
  pitchLine: '#8FA79A',
  scrim: 'rgba(5, 16, 11, 0.55)',
  tabBar: '#FFFFFF',
  tabBarBorder: '#E4E7EB',
  tabSelectedBg: 'rgba(0, 255, 156, 0.12)',
  tabSelectedInk: '#03140C',
  cardBasicBg: '#00FF9C',
  cardBasicLogo: '#03140C',
  cardPremiumBg: '#000000',
  cardButtonRing: 'transparent',
  ...identity,
});

/** Proposed in the S1 PR, from images 26 and 27 and the tab bar mockup. */
export const darkPalette: Palette = withAliases({
  ink: '#F4F5F7',
  muted: '#8FA39A',
  canvas: '#05100B',
  surface: '#0F1A16',
  surfaceRaised: '#16231E',
  fill: '#16231E',
  border: '#1E2A26',
  green: '#00FF9C',
  greenInk: '#03140C',
  greenSoft: 'rgba(0, 255, 156, 0.16)',
  night: '#0C1F17',
  onNight: '#F4F5F7',
  onNightMuted: '#8FA39A',
  positive: '#00FF9C',
  warning: '#F2C230',
  warningLight: '#2A2108',
  danger: '#FF6B6B',
  dangerLight: '#2A1212',
  dangerFill: '#C62828',
  onDanger: '#FFFFFF',
  info: '#7DB8F2',
  infoLight: '#0E2238',
  formWin: '#00FF9C',
  onFormWin: '#03140C',
  formDraw: '#6B7570',
  onFormDraw: '#FFFFFF',
  formLoss: '#C62828',
  onFormLoss: '#FFFFFF',
  ratingTop: '#F5B800',
  onRatingTop: '#03140C',
  pitch: '#0F3D27',
  pitchLine: '#8FA79A',
  scrim: 'rgba(0, 0, 0, 0.65)',
  tabBar: '#0B1215',
  tabBarBorder: '#1E2A26',
  tabSelectedBg: 'rgba(0, 255, 156, 0.16)',
  tabSelectedInk: '#00FF9C',
  cardBasicBg: '#00FF9C',
  cardBasicLogo: '#03140C',
  cardPremiumBg: '#000000',
  cardButtonRing: '#00FF9C',
  ...identity,
});

/** Accessibility → High contrast: stronger borders and secondary text. */
export const highContrast: Record<'light' | 'dark', Partial<BaseTokens>> = {
  light: { border: '#9AA3AD', tabBarBorder: '#9AA3AD', muted: '#3D4550' },
  dark: { border: '#3A4A43', tabBarBorder: '#3A4A43', muted: '#C2D0C9', onNightMuted: '#C2D0C9' },
};

/** The palette for a mode, with high contrast applied when asked. */
export function paletteFor(scheme: 'light' | 'dark', contrast = false): Palette {
  const base = scheme === 'dark' ? darkPalette : lightPalette;
  return contrast ? withAliases({ ...base, ...highContrast[scheme] }) : base;
}

/**
 * The light palette, for tests and lib code that need a fixed value. Screens
 * and components never import it: they use useTheme() (a guard checks).
 */
export const colors = lightPalette;

/**
 * A12: the 8 kit colours a player can pick for their avatar shirt
 * (components/ui/avatar.tsx). `label` is the shirt number's colour, tested
 * at 4.5:1 or more against `shirt` (constants/futty-theme.test.ts). The
 * names are what profiles.avatar_kit_colour stores; the database checks
 * them (supabase/migrations/*_pay_profile_avatar.sql). Avatars only, the
 * same in light and dark.
 */
export const kitColours = {
  kitRed: { shirt: '#C8102E', label: '#FFFFFF' },
  kitBlue: { shirt: '#1D428A', label: '#FFFFFF' },
  kitSky: { shirt: '#6CABDD', label: '#0B1215' },
  kitGreen: { shirt: '#00843D', label: '#FFFFFF' },
  kitYellow: { shirt: '#FFD100', label: '#0B1215' },
  kitOrange: { shirt: '#F57F20', label: '#0B1215' },
  kitBlack: { shirt: '#111111', label: '#FFFFFF' },
  kitWhite: { shirt: '#FFFFFF', label: '#0B1215' },
} as const;

export type KitColourName = keyof typeof kitColours;

/** Picker order. */
export const KIT_COLOUR_NAMES: readonly KitColourName[] = [
  'kitRed',
  'kitBlue',
  'kitSky',
  'kitGreen',
  'kitYellow',
  'kitOrange',
  'kitBlack',
  'kitWhite',
];

export type Weight = 'regular' | 'medium' | 'semiBold' | 'bold' | 'extraBold';
export type FontSet = Record<Weight, string>;

/**
 * Families as registered with useFonts() in app/_layout.tsx. Cairo, Inter
 * and Lexend are all under the SIL Open Font License 1.1.
 */
export const fontFamilies = {
  /** Everything except headings and numbers */
  inter: {
    regular: 'Inter_400Regular',
    medium: 'Inter_500Medium',
    semiBold: 'Inter_600SemiBold',
    bold: 'Inter_700Bold',
    extraBold: 'Inter_800ExtraBold',
  },
  /** Headings, numbers on cards and the wordmark */
  cairo: {
    regular: 'Cairo_400Regular',
    medium: 'Cairo_500Medium',
    semiBold: 'Cairo_600SemiBold',
    bold: 'Cairo_700Bold',
    extraBold: 'Cairo_800ExtraBold',
  },
  /** Accessibility → Dyslexia-friendly font, for both of the above */
  lexend: {
    regular: 'Lexend_400Regular',
    medium: 'Lexend_500Medium',
    semiBold: 'Lexend_600SemiBold',
    bold: 'Lexend_700Bold',
    extraBold: 'Lexend_800ExtraBold',
  },
} as const satisfies Record<string, FontSet>;

export type TypeStyle = { fontSize: number; lineHeight: number; fontFamily: string };

/** Which family and weight each step of the scale uses. */
export const typeSpec = {
  display: { size: 28, line: 38, family: 'heading', weight: 'bold' },
  title: { size: 22, line: 30, family: 'heading', weight: 'bold' },
  /** Big numbers on cards: scores, points, totals */
  number: { size: 22, line: 30, family: 'heading', weight: 'bold' },
  headline: { size: 17, line: 22, family: 'body', weight: 'semiBold' },
  body: { size: 16, line: 22, family: 'body', weight: 'regular' },
  callout: { size: 14, line: 20, family: 'body', weight: 'medium' },
  caption: { size: 13, line: 18, family: 'body', weight: 'medium' },
} as const satisfies Record<string, { size: number; line: number; family: 'heading' | 'body'; weight: Weight }>;

export type TypeVariant = keyof typeof typeSpec;
export type TypeScale = Record<TypeVariant, TypeStyle>;

/** Builds the type scale for a pair of families and a text scale. */
export function buildType(heading: FontSet, body: FontSet, scale = 1, bolder = false): TypeScale {
  const order: Weight[] = ['regular', 'medium', 'semiBold', 'bold', 'extraBold'];
  const step = (w: Weight) => (bolder ? order[Math.min(order.indexOf(w) + 1, order.length - 1)] : w);
  const out = {} as TypeScale;
  for (const [name, s] of Object.entries(typeSpec) as [TypeVariant, (typeof typeSpec)[TypeVariant]][]) {
    out[name] = {
      fontSize: Math.round(s.size * scale * 10) / 10,
      lineHeight: Math.round(s.line * scale * 10) / 10,
      fontFamily: (s.family === 'heading' ? heading : body)[step(s.weight)],
    };
  }
  return out;
}

/** The default type scale (Cairo + Inter, 100%), for tests and lib code. Screens use useTheme(). */
export const type: TypeScale = buildType(fontFamilies.cairo, fontFamilies.inter);

/** Spread onto any type style that shows prices, times or scores. */
export const tabular = { fontVariant: ['tabular-nums'] as 'tabular-nums'[] };

/** 4-point grid: 16 side gutter, 12 between cards, 24 between sections. */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

/** Cards 16, buttons and inputs 12, chips and small tiles 10, sheet tops 24. */
export const radius = { card: 16, control: 12, chip: 10, sheet: 24, pill: 999 } as const;

/** The one shadow: y 2, blur 8, 6% black. Floating things only (FAB, sheets); cards use a border. */
export const shadow = { boxShadow: '0px 2px 8px rgba(0, 0, 0, 0.06)' } as const;

export const hairline = StyleSheet.hairlineWidth;

/** IBM Plex Mono, loaded in app/_layout.tsx, for codes only (the check-in
 *  code). Everything else uses the families in `type`. */
export const mono = {
  medium: 'IBMPlexMono_500Medium',
  semiBold: 'IBMPlexMono_600SemiBold',
} as const;
