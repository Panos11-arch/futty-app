import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { DISABLED_OPACITY, ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { colors, hairline, radius, space } from '@/constants/futty-theme';

type IconName = ComponentProps<typeof IconSymbol>['name'];

/** Small selectable pill used by the horizontal/wrap filter rows across the
 *  app (day/city/format pickers, etc). Looks like components/ui Chip, plus a
 *  sublabel, a lock and a leading icon, which that one doesn't take. */
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
  const tone = selected ? 'brand' : 'ink';
  const iconColor = selected ? colors.brand : colors.inkMuted;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={[styles.chip, selected && styles.selected, disabled && styles.dimmed]}>
      <View style={styles.labelRow}>
        {locked ? <IconSymbol name="lock.fill" size={ICON.small} color={iconColor} /> : null}
        {icon && !locked ? <IconSymbol name={icon} size={ICON.small} color={iconColor} /> : null}
        <Text variant="callout" tone={tone}>
          {label}
        </Text>
      </View>
      {sublabel ? (
        <Text variant="caption" tone={selected ? 'brand' : 'inkMuted'}>
          {sublabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: colors.brandSoft, borderColor: colors.brandSoft },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: space.xs },
  dimmed: { opacity: DISABLED_OPACITY },
});
