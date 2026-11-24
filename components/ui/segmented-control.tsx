import { Pressable, View } from 'react-native';

import { MIN_TOUCH } from '@/components/ui/foundation';
import { Text } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

/** testID: for end-to-end tests (.maestro). */
export type SegmentedOption<T extends string> = { value: T; label: string; testID?: string };

export type SegmentedControlProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** What the choice is about, e.g. "Who pays". */
  accessibilityLabel: string;
  /** On a night header: a dark track with a green selected pill (Rankings, image 27). */
  onDark?: boolean;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  onDark = false,
}: SegmentedControlProps<T>) {
  const styles = useStyles();
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
      style={[styles.track, onDark && styles.darkTrack]}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            testID={option.testID}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected }}
            onPress={() => {
              if (!selected) onChange(option.value);
            }}
            style={[styles.segment, selected && (onDark ? styles.darkSelected : styles.selected)]}>
            <Text
              variant="callout"
              tone={onDark ? (selected ? 'greenInk' : 'onNightMuted') : selected ? 'ink' : 'muted'}
              style={styles.label}>
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  track: {
    flexDirection: 'row',
    backgroundColor: colors.fill,
    borderRadius: radius.control,
    padding: space.xs,
    gap: space.xs,
  },
  darkTrack: { backgroundColor: colors.night },
  segment: {
    flex: 1,
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.sm,
    borderRadius: radius.chip,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selected: { backgroundColor: colors.surface },
  darkSelected: { backgroundColor: colors.green },
  label: { textAlign: 'center' },
}));
