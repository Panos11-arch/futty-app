import { router } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { IconButton } from '@/components/ui/icon-button';
import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { useNotifications } from '@/lib/use-notifications';

/**
 * The fixed header on every tab (S2, spec 15 section 0.5, images 01 and 26):
 * the Futty wordmark on Home and the tab's name elsewhere, the bell (with a
 * dot while anything is unread) and the menu, which opens Account.
 */
export function AppHeader({ title, home = false }: { title: string; home?: boolean }) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const unread = useNotifications().unreadCount;

  return (
    <View testID="app-header" style={[styles.header, { paddingTop: insets.top + space.sm }]}>
      <Text variant={home ? 'display' : 'title'} accessibilityRole="header" numberOfLines={1} style={styles.title}>
        {home ? 'Futty' : title}
      </Text>
      <View style={styles.actions}>
        <View>
          <IconButton
            testID="header-bell"
            icon="bell.fill"
            accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            onPress={() => router.push('/notifications')}
          />
          {unread > 0 ? <View testID="unread-dot" style={styles.unreadDot} pointerEvents="none" /> : null}
        </View>
        <IconButton
          testID="header-menu"
          icon="line.3.horizontal"
          accessibilityLabel="Account menu"
          onPress={() => router.push('/account')}
        />
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingLeft: space.lg,
    paddingRight: space.sm,
    paddingBottom: space.sm,
    backgroundColor: colors.canvas,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
  },
  title: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center' },
  unreadDot: {
    position: 'absolute',
    top: space.md - space.xs,
    right: space.md - space.xs,
    width: space.sm,
    height: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.danger,
  },
}));
