/**
 * light and dark are intentionally identical — the app committed to a single
 * fixed brand look (see constants/futty-theme.ts) rather than adapting to the
 * system color scheme. useThemeColor/ThemedText/ThemedView still take a
 * colorScheme argument under the hood (unchanged call sites elsewhere), it
 * just always resolves to the same values now.
 */
import { Platform } from 'react-native';

import { FuttyColors } from '@/constants/futty-theme';

const futty = {
  // Bold/heading text is black (item 6) — tint stays green, reserved for
  // buttons/highlights/icons.
  text: FuttyColors.stone900,
  background: FuttyColors.stone50,
  tint: FuttyColors.emerald950,
  icon: FuttyColors.stone200,
  tabIconDefault: FuttyColors.stone400,
  tabIconSelected: FuttyColors.emerald950,
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
