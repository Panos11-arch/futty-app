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
};

export function AuthButton({
  label,
  onPress,
  disabled,
  busy,
  variant = 'primary',
  icon,
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
});
