import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { colors, hairline, space } from '@/constants/futty-theme';
import { formatEuros } from '@/lib/money/format';

export type StickyActionBarProps = {
  /** The server's total, in integer cents. Omit when there's no amount. */
  totalCents?: number;
  totalLabel?: string;
  actionLabel: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
};

/** Pinned to the bottom of a screen, above the home indicator. */
export function StickyActionBar({
  totalCents,
  totalLabel = 'Total',
  actionLabel,
  onPress,
  loading,
  disabled,
}: StickyActionBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View testID="sticky-action-bar" style={[styles.bar, { paddingBottom: Math.max(insets.bottom, space.lg) }]}>
      {totalCents !== undefined ? (
        <View style={styles.total}>
          <Text variant="caption" tone="inkMuted">
            {totalLabel}
          </Text>
          <Text variant="headline" tabular>
            {formatEuros(totalCents)}
          </Text>
        </View>
      ) : null}
      <View style={styles.action}>
        <Button label={actionLabel} onPress={onPress} loading={loading} disabled={disabled} fullWidth />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    paddingTop: space.md,
    paddingHorizontal: space.lg,
    backgroundColor: colors.surface,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
  },
  total: { gap: 2 },
  action: { flex: 1 },
});
