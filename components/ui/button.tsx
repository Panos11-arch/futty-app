import * as Haptics from 'expo-haptics';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';

import { DISABLED_OPACITY, MIN_TOUCH } from '@/components/ui/foundation';
import { Text, type TextTone } from '@/components/ui/text';
import { colors, hairline, radius, space } from '@/constants/futty-theme';

export type ButtonVariant = 'primary' | 'secondary' | 'destructive' | 'plain';

export type ButtonProps = {
  /** Says what happens: "Pay €6.80", "Cancel my spot". Not "Submit" or "OK". */
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityHint?: string;
  testID?: string;
};

const looks: Record<ButtonVariant, { tone: TextTone; container: object }> = {
  primary: { tone: 'onBrand', container: { backgroundColor: colors.brand } },
  secondary: {
    tone: 'ink',
    container: { backgroundColor: colors.surface, borderWidth: hairline, borderColor: colors.border },
  },
  destructive: {
    tone: 'danger',
    container: { backgroundColor: colors.surface, borderWidth: hairline, borderColor: colors.border },
  },
  plain: { tone: 'brand', container: { backgroundColor: 'transparent' } },
};

/** Light haptic tap; never lets a haptics failure block the action. */
export function tapHaptic() {
  try {
    void Promise.resolve(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)).catch(() => {});
  } catch {
    // Haptics unavailable: the action still runs.
  }
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  fullWidth = false,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const inactive = loading || disabled;
  const look = looks[variant];

  const handlePress = () => {
    if (inactive) return;
    if (variant === 'primary') tapHaptic();
    onPress();
  };

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={handlePress}
      style={({ pressed }) => [
        styles.base,
        look.container,
        variant === 'plain' && styles.plain,
        fullWidth && styles.fullWidth,
        disabled && !loading && styles.disabled,
        pressed && styles.pressed,
      ]}>
      {loading ? (
        <View style={styles.spinnerRow}>
          <ActivityIndicator testID="button-spinner" color={colors[look.tone]} />
        </View>
      ) : (
        <Text variant="headline" tone={look.tone} style={styles.label}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'flex-start',
  },
  plain: { paddingHorizontal: space.sm },
  fullWidth: { alignSelf: 'stretch' },
  disabled: { opacity: DISABLED_OPACITY },
  pressed: { opacity: 0.8 },
  spinnerRow: { flexDirection: 'row', alignItems: 'center' },
  label: { textAlign: 'center' },
});
