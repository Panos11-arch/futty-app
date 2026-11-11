import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { colors, tabular as tabularStyle, type } from '@/constants/futty-theme';

export type TextVariant = keyof typeof type;
export type TextTone = 'ink' | 'inkMuted' | 'brand' | 'success' | 'warning' | 'danger' | 'onBrand';

export type TextProps = RNTextProps & {
  variant?: TextVariant;
  tone?: TextTone;
  /** Tabular figures, for prices, times and scores. */
  tabular?: boolean;
};

/** Text on the type scale. Font scaling stays on so Dynamic Type works. */
export function Text({ variant = 'body', tone = 'ink', tabular = false, style, ...rest }: TextProps) {
  return <RNText style={[type[variant], { color: colors[tone] }, tabular && tabularStyle, style]} {...rest} />;
}
