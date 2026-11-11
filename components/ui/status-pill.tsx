import { StyleSheet, View } from 'react-native';

import { Text, type TextTone } from '@/components/ui/text';
import { colors, radius, space } from '@/constants/futty-theme';

export type Status =
  | 'paid'
  | 'cash'
  | 'unpaid'
  | 'debt'
  | 'confirmed'
  | 'pending'
  | 'held'
  | 'charged'
  | 'released'
  | 'refunded';

/** Sentence-case label and tone. Status colours only ever appear as small pills or text. */
const statuses: Record<Status, { label: string; tone: TextTone }> = {
  paid: { label: 'Paid', tone: 'success' },
  cash: { label: 'Cash', tone: 'inkMuted' },
  unpaid: { label: 'Unpaid', tone: 'warning' },
  debt: { label: 'Debt', tone: 'danger' },
  confirmed: { label: 'Confirmed', tone: 'success' },
  pending: { label: 'Pending', tone: 'warning' },
  held: { label: 'Held', tone: 'inkMuted' },
  charged: { label: 'Charged', tone: 'success' },
  released: { label: 'Released', tone: 'inkMuted' },
  refunded: { label: 'Refunded', tone: 'inkMuted' },
};

export function StatusPill({ status }: { status: Status }) {
  const { label, tone } = statuses[status];
  return (
    <View testID="status-pill" accessible accessibilityLabel={label} style={styles.pill}>
      <Text variant="caption" tone={tone}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: colors.canvas,
  },
});
