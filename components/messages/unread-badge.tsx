import { View } from 'react-native';

import { Text } from '@/components/ui/text';
import { radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

/** The unread count on green; nothing at 0. */
export function UnreadBadge({ count, testID }: { count: number; testID?: string }) {
  const styles = useStyles();
  if (count <= 0) return null;
  return (
    <View style={styles.badge} testID={testID} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Text variant="caption" tone="greenInk" tabular>
        {count > 99 ? '99+' : String(count)}
      </Text>
    </View>
  );
}

export function unreadLabel(count: number): string | null {
  return count > 0 ? `${count} unread` : null;
}

const useStyles = makeStyles(({ colors }) => ({
  badge: {
    minWidth: space.xl,
    paddingHorizontal: space.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
    alignItems: 'center',
  },
}));
