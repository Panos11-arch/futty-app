import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';

type IconName = ComponentProps<typeof IconSymbol>['name'];

/** Small selectable pill used by the horizontal/wrap filter rows across the
 *  app (day/city/format pickers, etc). */
export function Chip({
  label,
  sublabel,
  selected,
  disabled,
  locked,
  icon,
  onPress,
}: {
  label: string;
  sublabel?: string;
  selected: boolean;
  disabled?: boolean;
  locked?: boolean;
  /** Leading icon shown instead of an emoji baked into the label string. */
  icon?: IconName;
  onPress: () => void;
}) {
  const tint = useThemeColor({}, 'tint');
  const onTint = useThemeColor({}, 'background');
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  const textColor = useThemeColor({}, 'text');
  const iconColor = selected ? onTint : textColor;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={[
        styles.chip,
        { borderColor: selected ? tint : border },
        selected && { backgroundColor: tint },
        disabled && styles.dimmed,
      ]}>
      <View style={styles.chipLabelRow}>
        {locked ? <IconSymbol name="lock.fill" size={10} color={iconColor} /> : null}
        {icon && !locked ? <IconSymbol name={icon} size={12} color={iconColor} /> : null}
        <ThemedText style={[styles.chipLabel, selected && { color: onTint }]}>{label}</ThemedText>
      </View>
      {sublabel ? (
        <ThemedText style={[styles.chipSublabel, selected && { color: onTint }]}>
          {sublabel}
        </ThemedText>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 9,
    alignItems: 'center',
    minWidth: 64,
  },
  chipLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  chipLabel: {
    fontSize: 14,
    fontWeight: '600',
  },
  chipSublabel: {
    fontSize: 11,
    opacity: 0.7,
  },
  dimmed: {
    opacity: 0.4,
  },
});
