import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { tabular as tabularStyle, type ColorName, type TypeVariant } from '@/constants/futty-theme';
import { useTheme } from '@/lib/theme';

export type TextVariant = TypeVariant;
export type TextTone =
  | 'ink'
  | 'inkMuted'
  | 'muted'
  | 'brand'
  | 'positive'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'onBrand'
  | 'greenInk'
  | 'onNight'
  | 'onNightMuted';

/**
 * Which colour each tone draws in. Brand text is the darker `positive` green:
 * the logo green is never text on light backgrounds (spec 15 section 0.2).
 */
const toneColour: Record<TextTone, ColorName> = {
  ink: 'ink',
  inkMuted: 'muted',
  muted: 'muted',
  brand: 'positive',
  positive: 'positive',
  success: 'positive',
  warning: 'warning',
  danger: 'danger',
  info: 'info',
  onBrand: 'greenInk',
  greenInk: 'greenInk',
  onNight: 'onNight',
  onNightMuted: 'onNightMuted',
};

/** The colour a tone draws in, for icons that sit beside text. */
export function useToneColour(tone: TextTone): string {
  return useTheme().colors[toneColour[tone]];
}

export type TextProps = RNTextProps & {
  variant?: TextVariant;
  tone?: TextTone;
  /** Tabular figures, for prices, times and scores. */
  tabular?: boolean;
};

/**
 * Text on the type scale. Font scaling stays on so Dynamic Type works, capped
 * so the phone's text size times ours never goes above 200%.
 */
export function Text({ variant = 'body', tone = 'ink', tabular = false, style, ...rest }: TextProps) {
  const { type, colors, maxFontSizeMultiplier } = useTheme();
  return (
    <RNText
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[type[variant], { color: colors[toneColour[tone]] }, tabular && tabularStyle, style]}
      {...rest}
    />
  );
}
