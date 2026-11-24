import { Pressable } from 'react-native';

import { DISABLED_OPACITY, MIN_TOUCH } from '@/components/ui/foundation';
import { Text } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

export type ChipProps = {
  label: string;
  selected?: boolean;
  disabled?: boolean;
  onPress: () => void;
  /** Tabular figures, for times. */
  tabular?: boolean;
  /** On a night header: an outline in light text; the selected chip is solid. */
  onDark?: boolean;
  testID?: string;
};

export function Chip({ label, selected = false, disabled = false, onPress, tabular, onDark = false, testID }: ChipProps) {
  const styles = useStyles();
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
      style={[
        styles.chip,
        onDark && styles.dark,
        selected && (onDark ? styles.darkSelected : styles.selected),
        disabled && styles.disabled,
      ]}>
      <Text variant="callout" tone={onDark ? (selected ? 'greenInk' : 'onNight') : 'ink'} tabular={tabular}>
        {label}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors, hairline }) => ({
  chip: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    borderWidth: hairline * 2,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: colors.greenSoft, borderColor: colors.green },
  dark: { backgroundColor: 'transparent', borderColor: colors.onNightMuted },
  darkSelected: { backgroundColor: colors.onNight, borderColor: colors.onNight },
  disabled: { opacity: DISABLED_OPACITY },
}));
