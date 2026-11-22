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
        style={[
          styles.input,
          rest.multiline && styles.multiline,
          { borderColor: error ? colors.danger : colors.border },
          !editable && styles.readOnly,
        ]}
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
  // No lineHeight on a single-line field: on iOS a lineHeight larger than the
  // font's own adds a baseline offset that pushes the text and placeholder
  // down until they clip. Multiline text keeps it for its line spacing.
  input: {
    fontSize: type.body.fontSize,
    fontFamily: type.body.fontFamily,
    color: colors.ink,
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    borderWidth: 1,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
  },
  multiline: { lineHeight: type.body.lineHeight },
  readOnly: { backgroundColor: colors.canvas },
});
