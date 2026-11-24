import { ActivityIndicator, Pressable, View } from 'react-native';

import { DISABLED_OPACITY, MIN_TOUCH } from '@/components/ui/foundation';
import { Text, useToneColour, type TextTone } from '@/components/ui/text';
import { radius, space, type ColorName } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import { makeStyles } from '@/lib/theme';

/**
 * primary: green with dark text, the one main action. dark: night fill.
 * secondary: an outline. destructive: an outline with red text. plain: text only.
 */
export type ButtonVariant = 'primary' | 'dark' | 'secondary' | 'destructive' | 'plain';

export type ButtonProps = {
  /** Says what happens: "Pay €6.80", "Cancel my spot". Not "Submit" or "OK". */
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  /** compact: a smaller button inside a row or card ("Play", "Log"). */
  size?: 'regular' | 'compact';
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  accessibilityHint?: string;
  testID?: string;
};

const looks: Record<ButtonVariant, { tone: TextTone; fill?: ColorName; border?: ColorName }> = {
  primary: { tone: 'greenInk', fill: 'green' },
  dark: { tone: 'onNight', fill: 'night' },
  secondary: { tone: 'ink', fill: 'surface', border: 'border' },
  destructive: { tone: 'danger', fill: 'surface', border: 'border' },
  plain: { tone: 'positive' },
};

/** Light haptic tap; respects the Haptics setting and never blocks the action. */
export function tapHaptic() {
  haptic.tap();
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'regular',
  loading = false,
  disabled = false,
  fullWidth = false,
  accessibilityHint,
  testID,
}: ButtonProps) {
  const styles = useStyles();
  const inactive = loading || disabled;
  const look = looks[variant];
  const spinner = useToneColour(look.tone);

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
        styles[variant],
        size === 'compact' && styles.compact,
        fullWidth && styles.fullWidth,
        disabled && !loading && styles.disabled,
        pressed && styles.pressed,
      ]}>
      {loading ? (
        <View style={styles.spinnerRow}>
          <ActivityIndicator testID="button-spinner" color={spinner} />
        </View>
      ) : (
        <Text variant={size === 'compact' ? 'callout' : 'headline'} tone={look.tone} style={styles.label}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors, hairline }) => {
  const fill = (v: ButtonVariant) => {
    const look = looks[v];
    return {
      backgroundColor: look.fill ? colors[look.fill] : 'transparent',
      ...(look.border ? { borderWidth: hairline * 2, borderColor: colors[look.border] } : {}),
    };
  };
  return {
    base: {
      minHeight: MIN_TOUCH,
      paddingHorizontal: space.lg,
      paddingVertical: space.sm,
      borderRadius: radius.control,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'flex-start',
    },
    primary: fill('primary'),
    dark: fill('dark'),
    secondary: fill('secondary'),
    destructive: fill('destructive'),
    plain: { ...fill('plain'), paddingHorizontal: space.sm },
    compact: { paddingHorizontal: space.md, borderRadius: radius.chip },
    fullWidth: { alignSelf: 'stretch' },
    disabled: { opacity: DISABLED_OPACITY },
    pressed: { opacity: 0.8 },
    spinnerRow: { flexDirection: 'row', alignItems: 'center' },
    label: { textAlign: 'center' },
  };
});
