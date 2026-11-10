import { Pressable, StyleSheet } from 'react-native';

import { DISABLED_OPACITY, MIN_TOUCH } from '@/components/ui/foundation';
import { Text } from '@/components/ui/text';
import { colors, hairline, radius, space } from '@/constants/futty-theme';

export type ChipProps = {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
  /** Tabular figures, for times. */
  tabular?: boolean;
  testID?: string;
};

export function Chip({ label, selected = false, disabled = false, onPress, tabular, testID }: ChipProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={() => {
        if (!disabled) onPress();
      }}
      style={[styles.chip, selected && styles.selected, disabled && styles.disabled]}>
      <Text variant="callout" tone={selected ? 'brand' : 'ink'} tabular={tabular}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: colors.brandSoft, borderColor: colors.brandSoft },
  disabled: { opacity: DISABLED_OPACITY },
});
