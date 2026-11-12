// The sign-in and onboarding shell and its pieces (U6, docs/specs/15-design.md).
// Tokens only. AuthButton, AuthField, AuthError, AuthNotice and AuthLink are
// also used by older screens, so their props stay as they were; new screens
// use components/ui directly.
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

import { DISABLED_OPACITY, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text, type TextTone } from '@/components/ui/text';
import { colors, radius, space, type } from '@/constants/futty-theme';
import { getPasswordStrength } from '@/lib/password';

type IconName = ComponentProps<typeof IconSymbol>['name'];

/** One column on the canvas, keyboard-aware, vertically centred. */
export function AuthScreen({ children }: PropsWithChildren) {
  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** The Futty wordmark, in ink. No illustration. */
export function AuthWordmark() {
  return (
    <Text variant="display" accessibilityRole="header" style={styles.wordmark}>
      Futty
    </Text>
  );
}

export function AuthTitle({ children }: PropsWithChildren) {
  return <Text variant="title">{children}</Text>;
}

export function AuthSubtitle({ children }: PropsWithChildren) {
  return (
    <Text variant="body" tone="inkMuted">
      {children}
    </Text>
  );
}

/** A bare input for older screens; the auth screens use components/ui TextField. */
export function AuthField(props: TextInputProps) {
  return <TextInput placeholderTextColor={colors.inkMuted} {...props} style={[styles.input, props.style]} />;
}

type AuthButtonProps = {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  /** Renders as a low-emphasis outline instead of a filled button. */
  variant?: 'primary' | 'secondary';
  /** Trailing icon, e.g. a checkmark on a toggle button that's currently on. */
  icon?: IconName;
  /** Sizes to its label instead of stretching to fill its container. */
  compact?: boolean;
};

export function AuthButton({ label, onPress, disabled, busy, variant = 'primary', icon, compact }: AuthButtonProps) {
  const isPrimary = variant === 'primary';
  const tone: TextTone = isPrimary ? 'onBrand' : 'brand';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled || !!busy, busy: !!busy }}
      onPress={onPress}
      disabled={disabled || busy}
      style={[
        styles.button,
        isPrimary ? styles.buttonPrimary : styles.buttonSecondary,
        compact && styles.buttonCompact,
        (disabled || busy) && styles.inactive,
      ]}>
      {busy ? (
        <ActivityIndicator color={colors[tone]} />
      ) : (
        <View style={styles.buttonLabelRow}>
          <Text variant="headline" tone={tone}>
            {label}
          </Text>
          {icon ? <IconSymbol name={icon} size={20} color={colors[tone]} /> : null}
        </View>
      )}
    </Pressable>
  );
}

export function AuthError({ children }: PropsWithChildren) {
  return (
    <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
      {children}
    </Text>
  );
}

export function AuthNotice({ children }: PropsWithChildren) {
  return (
    <Text variant="callout" tone="success">
      {children}
    </Text>
  );
}

const STRENGTH_CONFIG = {
  weak: { label: 'Weak', tone: 'danger', filled: 1 },
  medium: { label: 'Medium', tone: 'warning', filled: 2 },
  strong: { label: 'Strong', tone: 'success', filled: 3 },
} as const;

/** Live weak/medium/strong indicator, based on length + character variety. */
export function PasswordStrengthMeter({ password }: { password: string }) {
  const strength = getPasswordStrength(password);
  if (!strength) return null;
  const config = STRENGTH_CONFIG[strength];

  return (
    <View style={styles.strengthWrap} accessible accessibilityLabel={`Password strength: ${config.label}`}>
      <View style={styles.strengthBars}>
        {[0, 1, 2].map((i) => (
          <View
            key={i}
            style={[styles.strengthBar, { backgroundColor: i < config.filled ? colors[config.tone] : colors.border }]}
          />
        ))}
      </View>
      <Text variant="caption" tone={config.tone}>
        {config.label}
      </Text>
    </View>
  );
}

/** A plain text link, at least 44 points tall. */
export function AuthLink({ label, onPress, disabled }: Omit<AuthButtonProps, 'variant' | 'busy'>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={[styles.link, disabled && styles.inactive]}>
      <Text variant="body" tone="brand" style={styles.linkText}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.xl,
  },
  wordmark: { marginBottom: space.lg },
  input: {
    ...type.body,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderRadius: radius.control,
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    marginTop: space.sm,
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.lg,
  },
  buttonPrimary: { backgroundColor: colors.brand },
  buttonSecondary: { borderWidth: 1, borderColor: colors.brand, backgroundColor: colors.surface },
  buttonCompact: { alignSelf: 'flex-start', paddingHorizontal: space.xl },
  inactive: { opacity: DISABLED_OPACITY },
  buttonLabelRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  link: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  linkText: { textAlign: 'center' },
  strengthWrap: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  strengthBars: { flex: 1, flexDirection: 'row', gap: space.xs },
  strengthBar: { flex: 1, height: space.xs, borderRadius: radius.pill },
});
