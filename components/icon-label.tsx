import type { ComponentProps } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';

import { ThemedText, type ThemedTextProps } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors } from '@/constants/futty-theme';

type IconName = ComponentProps<typeof IconSymbol>['name'];

/** Icon + text row — the app-wide replacement for the prototype's
 *  emoji-prefixed labels (section headers, empty states, links). Keeps every
 *  ThemedText type/style prop working as-is, just adds an icon in front. */
export function IconLabel({
  icon,
  iconColor = FuttyColors.emerald950,
  iconSize = 16,
  gap = 6,
  containerStyle,
  ...textProps
}: {
  icon: IconName;
  iconColor?: string;
  iconSize?: number;
  gap?: number;
  containerStyle?: ViewStyle;
} & ThemedTextProps) {
  return (
    <View style={[styles.row, { gap }, containerStyle]}>
      <IconSymbol name={icon} size={iconSize} color={iconColor} />
      <ThemedText {...textProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});
