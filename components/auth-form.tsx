import type { ComponentProps, PropsWithChildren } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { getPasswordStrength } from '@/lib/password';

type IconName = ComponentProps<typeof IconSymbol>['name'];

/** Vertically centred, keyboard-aware shell shared by the auth screens. */
export function AuthScreen({ children }: PropsWithChildren) {
  return (
    <ThemedView style={styles.flex}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </ThemedView>
  );
}

export function AuthTitle({ icon, children }: PropsWithChildren<{ icon?: IconName }>) {
  const tint = useThemeColor({}, 'tint');
  if (!icon) return <ThemedText type="title">{children}</ThemedText>;
  return (
    <View style={styles.titleRow}>
      <View style={[styles.titleIconCircle, { backgroundColor: tint }]}>
        <IconSymbol name={icon} size={20} color={FuttyColors.white} />
      </View>
      <ThemedText type="title">{children}</ThemedText>
    </View>
  );
}

export function AuthSubtitle({ children }: PropsWithChildren) {
  return <ThemedText style={styles.subtitle}>{children}</ThemedText>;
}

export function AuthField(props: TextInputProps) {
  const textColor = useThemeColor({}, 'text');
  const borderColor = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');

  return (
    <TextInput
      placeholderTextColor={borderColor}
      {...props}
      style={[styles.input, { color: textColor, borderColor }, props.style]}
    />
  );
}

type AuthButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** Renders as a low-emphasis outline instead of a filled button. */
  variant?: 'primary' | 'secondary';
  /** Trailing icon — e.g. a checkmark on a toggle button that's currently on. */
  icon?: IconName;
  /** Sizes to its label instead of stretching to fill its container (item
   *  9) — for a single standalone action in a card/row (e.g. "Join squad",
   *  "Cancel"), not a full-screen primary CTA or one half of a paired
   *  confirm/cancel row (those still want to fill their own flex:1 cell).
   *  Default is unchanged (stretches) so no existing call site is affected
   *  by adding this. */
  compact?: boolean;
};

export function AuthButton({
  label,
  onPress,
  disabled,
  busy,
  variant = 'primary',
  icon,
  compact,
}: AuthButtonProps) {
  const tint = useThemeColor({}, 'tint');
  // A filled button's label needs to invert against tint (emerald-950) rather
  // than reuse the base text color, or it renders dark-on-dark.
  const onTint = useThemeColor({}, 'background');
  const isPrimary = variant === 'primary';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={[
        styles.button,
        isPrimary ? { backgroundColor: tint } : { borderWidth: 1, borderColor: tint },
        compact && styles.buttonCompact,
        (disabled || busy) && styles.buttonDisabled,
      ]}>
      {busy ? (
        <ActivityIndicator color={isPrimary ? onTint : tint} />
      ) : (
        <View style={styles.buttonLabelRow}>
          <ThemedText style={[styles.buttonLabel, { color: isPrimary ? onTint : tint }]}>
            {label}
          </ThemedText>
          {icon ? <IconSymbol name={icon} size={14} color={isPrimary ? onTint : tint} /> : null}
        </View>
      )}
    </Pressable>
  );
}

export function AuthError({ children }: PropsWithChildren) {
  return <ThemedText style={{ color: FuttyColors.rose600 }}>{children}</ThemedText>;
}

const STRENGTH_CONFIG = {
  weak: { label: 'Weak', color: FuttyColors.rose600, filled: 1 },
  medium: { label: 'Medium', color: FuttyColors.amber400, filled: 2 },
  strong: { label: 'Strong', color: FuttyColors.emerald700, filled: 3 },
} as const;

/** Live weak/medium/strong indicator, based on length + character variety. */
export function PasswordStrengthMeter({ password }: { password: string }) {
  const strength = getPasswordStrength(password);
  if (!strength) return null;
  const config = STRENGTH_CONFIG[strength];

  return (
    <View style={styles.strengthWrap}>
      <View style={styles.strengthBars}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[
              styles.strengthBar,
              { backgroundColor: i < config.filled ? config.color : FuttyColors.stone200 },
            ]}
          />
        ))}
      </View>
      <ThemedText style={[styles.strengthLabel, { color: config.color }]}>{config.label}</ThemedText>
    </View>
  );
}

export function AuthNotice({ children }: PropsWithChildren) {
  return <ThemedText style={{ color: FuttyColors.emerald600 }}>{children}</ThemedText>;
}

export function AuthLink({ label, onPress, disabled }: Omit<AuthButtonProps, 'variant' | 'busy'>) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled}>
      <ThemedText type="link" style={[styles.link, disabled && styles.buttonDisabled]}>
        {label}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: 12,
    padding: 24,
  },
  subtitle: {
    marginBottom: 8,
    opacity: 0.7,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  titleIconCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 16,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    marginTop: 8,
    minHeight: 50,
    paddingHorizontal: 16,
  },
  buttonCompact: {
    alignSelf: 'flex-start',
    paddingHorizontal: 22,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  buttonLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  link: {
    textAlign: 'center',
  },
  strengthWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: -4,
  },
  strengthBars: {
    flex: 1,
    flexDirection: 'row',
    gap: 4,
  },
  strengthBar: {
    flex: 1,
    height: 4,
    borderRadius: 2,
  },
  strengthLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
});
