/**
 * light and dark are intentionally identical: the app keeps one fixed light
 * look built from the tokens in constants/futty-theme.ts. useThemeColor,
 * ThemedText and ThemedView still take a colour scheme, it just always
 * resolves to the same values.
 */
import { Platform } from 'react-native';

import { colors } from '@/constants/futty-theme';

const futty = {
  text: colors.ink,
  background: colors.canvas,
  tint: colors.brand,
  icon: colors.inkMuted,
  tabIconDefault: colors.inkMuted,
  tabIconSelected: colors.brand,
};

export const Colors = {
  light: futty,
  dark: futty,
};

export const Fonts = Platform.select({
  ios: {
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: 'system-ui',
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: 'ui-serif',
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: 'ui-rounded',
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
    mono: 'ui-monospace',
  },
  default: {
    sans: 'normal',
    serif: 'serif',
    rounded: 'normal',
    mono: 'monospace',
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded: "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
