// The Booking v2 payment sheet's big choices (04-payment-sheet: whole or
// half pitch, the ways to pay) and its pitch rows (03-venue-book-tab). Every
// price is the server's, passed in as words already.
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui';
import { DISABLED_OPACITY, MIN_TOUCH } from '@/components/ui/foundation';
import { hairline, radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

/** The selected border is thicker so the choice reads without colour. */
const SELECTED_BORDER = 2;

export type ChoiceCardProps = {
  title: string;
  line: string;
  /** The server's price, already in euros. */
  price?: string;
  selected: boolean;
  /** Locked once a booking is held: shown, but not changeable. */
  locked?: boolean;
  onPress: () => void;
  testID: string;
};

/** One of two big choices side by side: a title, its price, one line. */
export function ChoiceCard({ title, line, price, selected, locked = false, onPress, testID }: ChoiceCardProps) {
  const styles = useStyles();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ selected, disabled: locked && !selected }}
      onPress={() => {
        if (!locked) onPress();
      }}
      style={[styles.card, selected && styles.selected, locked && !selected && styles.locked]}>
      <Text variant="headline">{title}</Text>
      {price ? (
        <Text variant="body" tabular>
          {price}
        </Text>
      ) : null}
      <Text variant="callout" tone="inkMuted">
        {line}
      </Text>
    </Pressable>
  );
}

export type PitchRowProps = {
  label: string;
  details: string;
  price: string;
  selected: boolean;
  locked?: boolean;
  onPress: () => void;
  testID: string;
};

/** A free pitch: its venue name, indoor or outdoor and surface, the server's price. */
export function PitchRow({ label, details, price, selected, locked = false, onPress, testID }: PitchRowProps) {
  const styles = useStyles();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected, disabled: locked && !selected }}
      onPress={() => {
        if (!locked) onPress();
      }}
      style={[styles.row, selected && styles.selected, locked && !selected && styles.locked]}>
      <View style={styles.rowText}>
        <Text variant="headline">{label}</Text>
        {details ? (
          <Text variant="callout" tone="inkMuted">
            {details}
          </Text>
        ) : null}
      </View>
      <Text variant="headline" tabular>
        {price}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  card: {
    flex: 1,
    minHeight: MIN_TOUCH,
    padding: space.lg,
    gap: space.xs,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  row: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  rowText: { flex: 1, gap: space.xs },
  selected: { borderWidth: SELECTED_BORDER, borderColor: colors.brand, backgroundColor: colors.brandSoft },
  locked: { opacity: DISABLED_OPACITY },
}));
