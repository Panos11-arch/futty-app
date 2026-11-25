// The − and + of the logging screens: a 44-point target, a label for screen
// readers, dimmed when it can't be used.
import { Pressable, StyleSheet } from 'react-native';

import { DISABLED_OPACITY, ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { radius } from '@/constants/futty-theme';
import type { ColorName } from '@/constants/futty-theme';
import { useTheme } from '@/lib/theme';

export type StepButtonProps = {
  kind: 'minus' | 'plus';
  accessibilityLabel: string;
  onPress: () => void;
  disabled?: boolean;
  /** light: on canvas or cards; pitch: on the dark pitch. */
  look?: 'light' | 'pitch';
  testID?: string;
};

export function StepButton({ kind, accessibilityLabel, onPress, disabled = false, look = 'light', testID }: StepButtonProps) {
  const { colors } = useTheme();
  const fill: ColorName = look === 'pitch' ? 'night' : 'fill';
  const ink: ColorName = look === 'pitch' ? 'onNight' : 'ink';
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={4}
      onPress={onPress}
      style={{
        width: MIN_TOUCH,
        height: MIN_TOUCH,
        borderRadius: look === 'pitch' ? radius.control : radius.pill,
        borderWidth: look === 'pitch' ? 0 : StyleSheet.hairlineWidth,
        borderColor: colors.border,
        backgroundColor: colors[fill],
        alignItems: 'center',
        justifyContent: 'center',
        opacity: disabled ? DISABLED_OPACITY : 1,
      }}>
      <IconSymbol name={kind} size={ICON.small} color={colors[ink]} />
    </Pressable>
  );
}
