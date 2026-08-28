import { StyleSheet, Text, type TextProps } from 'react-native';

import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';

export type ThemedTextProps = TextProps & {
  lightColor?: string;
  darkColor?: string;
  type?: 'default' | 'title' | 'defaultSemiBold' | 'subtitle' | 'link';
};

export function ThemedText({
  style,
  lightColor,
  darkColor,
  type = 'default',
  ...rest
}: ThemedTextProps) {
  const color = useThemeColor({ light: lightColor, dark: darkColor }, 'text');

  return (
    <Text
      style={[
        { color },
        type === 'default' ? styles.default : undefined,
        type === 'title' ? styles.title : undefined,
        type === 'defaultSemiBold' ? styles.defaultSemiBold : undefined,
        type === 'subtitle' ? styles.subtitle : undefined,
        type === 'link' ? styles.link : undefined,
        style,
      ]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  default: {
    fontFamily: FuttyFonts.sans,
    fontSize: 16,
    lineHeight: 24,
    // Distinct from headings (which keep the base emerald-950 'text' color
    // above) so body copy reads as secondary, matching the prototype's
    // heading-vs-body contrast.
    color: FuttyColors.stone700,
  },
  defaultSemiBold: {
    fontFamily: FuttyFonts.sansSemiBold,
    fontSize: 16,
    lineHeight: 24,
  },
  title: {
    fontFamily: FuttyFonts.display,
    fontSize: 32,
    lineHeight: 34,
  },
  subtitle: {
    fontFamily: FuttyFonts.sansBold,
    fontSize: 20,
  },
  link: {
    fontFamily: FuttyFonts.sansMedium,
    lineHeight: 30,
    fontSize: 16,
    color: FuttyColors.emerald700,
  },
});
