import { StyleSheet, TextInput, View, type TextInputProps } from 'react-native';

import { MIN_TOUCH } from '@/components/ui/foundation';
import { Text } from '@/components/ui/text';
import { colors, radius, space, type } from '@/constants/futty-theme';

export type TextFieldProps = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  label: string;
  helper?: string;
  /** Shown in place of the helper, in danger, and read out with the field. */
  error?: string;
};

export function TextField({ label, helper, error, editable = true, ...rest }: TextFieldProps) {
  const note = error ?? helper;
  return (
    <View style={styles.wrap}>
      <Text variant="callout">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={error}
        accessibilityState={{ disabled: !editable }}
        editable={editable}
        placeholderTextColor={colors.inkMuted}
        style={[styles.input, { borderColor: error ? colors.danger : colors.border }, !editable && styles.readOnly]}
        {...rest}
      />
      {note ? (
        <Text variant="caption" tone={error ? 'danger' : 'inkMuted'}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.xs },
  input: {
    ...type.body,
    color: colors.ink,
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderWidth: 1,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
  },
  readOnly: { backgroundColor: colors.canvas },
});
