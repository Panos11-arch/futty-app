import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { MIN_TOUCH } from '@/components/ui/foundation';
import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import { dateKeyToDate, toDateKey } from '@/lib/days';
import { makeStyles } from '@/lib/theme';

const DEFAULT_DOB = new Date(2000, 0, 1);

type Props = {
  /** YYYY-MM-DD, or '' for none yet. */
  value: string;
  onChange: (next: string) => void;
  testID?: string;
  disabled?: boolean;
  /** Shown above the field, like TextField's label (sign-up). */
  label?: string;
};

/**
 * A date of birth (S12, A1), on sign-up and on the date of birth screen.
 * Android shows its date picker as an imperative native dialog
 * (DateTimePickerAndroid.open) rather than a rendered component: rendering
 * <DateTimePicker> continuously there would pop the dialog immediately and
 * repeatedly. iOS renders it inline as a spinner, toggled by the same tap.
 */
export function DateOfBirthField({ value, onChange, testID = 'dob-field', disabled = false, label }: Props) {
  const styles = useStyles();
  const [showIOSPicker, setShowIOSPicker] = useState(false);
  const dateValue = value ? dateKeyToDate(value) : DEFAULT_DOB;
  const maximumDate = new Date(); // can't be born in the future

  function open() {
    if (disabled) return;
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: dateValue,
        mode: 'date',
        maximumDate,
        onChange: (event, selected) => {
          if (event.type === 'set' && selected) onChange(toDateKey(selected));
        },
      });
    } else {
      setShowIOSPicker((v) => !v);
    }
  }

  return (
    <View style={styles.wrap}>
      {label ? <Text variant="callout">{label}</Text> : null}
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={value ? `Date of birth ${value}` : 'Pick date of birth'}
        accessibilityState={{ disabled }}
        onPress={open}>
        <View style={styles.input} pointerEvents="none">
          <Text variant="body" tone={value ? 'ink' : 'inkMuted'} tabular>
            {value || 'Pick a date'}
          </Text>
        </View>
      </Pressable>
      {Platform.OS === 'ios' && showIOSPicker ? (
        <DateTimePicker
          testID={`${testID}-picker`}
          value={dateValue}
          mode="date"
          display="spinner"
          maximumDate={maximumDate}
          onChange={(event, selected) => {
            if (event.type === 'set' && selected) onChange(toDateKey(selected));
          }}
        />
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  wrap: { gap: space.xs },
  input: {
    justifyContent: 'center',
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.md,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
  },
}));
