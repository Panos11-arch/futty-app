import { StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui/text';
import { colors, hairline, space } from '@/constants/futty-theme';
import { formatEuros } from '@/lib/money/format';

export type PriceLine = { label: string; cents: number };

export type PriceBreakdownProps = {
  /** Lines exactly as the server returns them, in integer cents. */
  lines: PriceLine[];
  /** The server's total. Never summed here. */
  totalCents: number;
  totalLabel?: string;
};

export function PriceBreakdown({ lines, totalCents, totalLabel = 'Total' }: PriceBreakdownProps) {
  return (
    <View style={styles.wrap}>
      {lines.map((line, i) => (
        <View key={`${line.label}-${i}`} style={styles.row}>
          <Text variant="body" tone="inkMuted" style={styles.label}>
            {line.label}
          </Text>
          <Text variant="body" tabular>
            {formatEuros(line.cents)}
          </Text>
        </View>
      ))}
      <View style={[styles.row, lines.length > 0 && styles.totalRow]}>
        <Text variant="headline" style={styles.label}>
          {totalLabel}
        </Text>
        <Text variant="headline" tabular>
          {formatEuros(totalCents)}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: space.md },
  label: { flex: 1 },
  totalRow: { borderTopWidth: hairline, borderTopColor: colors.border, paddingTop: space.sm },
});
