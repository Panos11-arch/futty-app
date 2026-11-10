import { StyleSheet, Text, type TextProps } from 'react-native';

import { colors, type as typeScale } from '@/constants/futty-theme';
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

// The old type names, mapped onto the scale in docs/specs/15-design.md.
const styles = StyleSheet.create({
  default: typeScale.body,
  defaultSemiBold: typeScale.headline,
  title: typeScale.display,
  subtitle: typeScale.title,
  link: { ...typeScale.body, color: colors.brand },
});
