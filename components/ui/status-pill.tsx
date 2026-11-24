import { View } from 'react-native';

import { Text, type TextTone } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

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

type Fill = 'greenSoft' | 'warningLight' | 'dangerLight' | 'infoLight' | 'fill';
type Look = { label: string; tone: TextTone; fill: Fill };

const good = { tone: 'success', fill: 'greenSoft' } as const;
const waiting = { tone: 'warning', fill: 'warningLight' } as const;
const neutral = { tone: 'inkMuted', fill: 'fill' } as const;

/** Sentence-case label, a tinted pill and darker text of the same tone. */
const statuses: Record<Status, Look> = {
  paid: { label: 'Paid', ...good },
  cash: { label: 'Cash', ...neutral },
  unpaid: { label: 'Unpaid', ...waiting },
  debt: { label: 'Debt', tone: 'danger', fill: 'dangerLight' },
  confirmed: { label: 'Confirmed', ...good },
  pending: { label: 'Pending', ...waiting },
  held: { label: 'Held', tone: 'info', fill: 'infoLight' },
  charged: { label: 'Charged', ...good },
  released: { label: 'Released', ...neutral },
  refunded: { label: 'Refunded', ...neutral },
};

export function StatusPill({ status }: { status: Status }) {
  const styles = useStyles();
  const { label, tone, fill } = statuses[status];
  return (
    <View testID="status-pill" accessible accessibilityLabel={label} style={[styles.pill, styles[fill]]}>
      <Text variant="caption" tone={tone}>
        {label}
      </Text>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: space.sm,
    paddingVertical: 2,
    borderRadius: radius.pill,
  },
  greenSoft: { backgroundColor: colors.greenSoft },
  warningLight: { backgroundColor: colors.warningLight },
  dangerLight: { backgroundColor: colors.dangerLight },
  infoLight: { backgroundColor: colors.infoLight },
  fill: { backgroundColor: colors.fill },
}));
