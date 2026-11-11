import { Pressable, StyleSheet } from 'react-native';

import { DISABLED_OPACITY, ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { colors, radius } from '@/constants/futty-theme';

export type IconButtonProps = {
  icon: IconSymbolName;
  /** Required: an icon-only button has no visible text for screen readers. */
  accessibilityLabel: string;
  onPress: () => void;
  size?: keyof typeof ICON;
  tone?: 'ink' | 'inkMuted' | 'danger';
  disabled?: boolean;
  testID?: string;
};

export function IconButton({
  icon,
  accessibilityLabel,
  onPress,
  size = 'regular',
  tone = 'ink',
  disabled = false,
  testID,
}: IconButtonProps) {
  if (!accessibilityLabel?.trim()) {
    throw new Error('IconButton needs an accessibilityLabel');
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={() => {
        if (!disabled) onPress();
      }}
      style={({ pressed }) => [styles.base, disabled && styles.disabled, pressed && styles.pressed]}>
      <IconSymbol name={icon} size={ICON[size]} color={colors[tone]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: DISABLED_OPACITY },
  pressed: { backgroundColor: colors.canvas },
});
