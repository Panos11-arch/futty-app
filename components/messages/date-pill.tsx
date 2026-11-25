import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

/** "Today", "Yesterday", a weekday or a date, centred between days. */
export function DatePill({ label }: { label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.wrap} accessible accessibilityRole="header">
      <View style={styles.pill}>
        <Text variant="caption" tone="inkMuted">
          {label}
        </Text>
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  wrap: { alignItems: 'center', paddingVertical: space.sm },
  pill: {
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: hairline,
    borderColor: colors.border,
  },
}));
