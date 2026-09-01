import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { markNotificationRead, type AppNotification, type NotificationType } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { useNotifications } from '@/lib/use-notifications';

const ICON_BY_TYPE: Record<NotificationType, React.ComponentProps<typeof IconSymbol>['name']> = {
  fixture_message: 'bubble.left.fill',
  squad_post: 'person.2.fill',
  booking_slot: 'calendar',
  booking_cancelled: 'exclamationmark.triangle.fill',
  fixture_agreed: 'flag.checkered',
};

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Where tapping a notification goes, per the `data` payload each trigger in
 *  supabase/notifications.sql (and supabase/fixture-confirmed-notifications.sql)
 *  writes. */
async function openNotification(notification: AppNotification) {
  const data = notification.data as Record<string, unknown>;

  if (notification.type === 'fixture_message' && typeof data.fixtureId === 'string') {
    router.push({ pathname: '/fixture-chat', params: { fixtureId: data.fixtureId } });
  } else if (notification.type === 'squad_post' && typeof data.postId === 'string') {
    // Both "someone joined your post" and "your post got matched" share this
    // notification type/payload shape — only the second should open Fixture
    // Confirmed (item 3), and only for a matched "need opposition" post
    // (a matched "need players" post has no second team to show), so check
    // the post's current state rather than trusting which trigger fired.
    if (data.postType === 'opposition') {
      const { data: post } = await supabase
        .from('squad_posts')
        .select('status')
        .eq('id', data.postId)
        .maybeSingle();
      if (post?.status === 'matched') {
        router.push({ pathname: '/fixture-confirmed', params: { kind: 'squad', id: data.postId } });
        return;
      }
    }
    router.push({
      pathname: '/squads',
      params: { view: data.postType === 'opposition' ? 'opposition' : 'players' },
    });
  } else if (notification.type === 'fixture_agreed' && typeof data.fixtureId === 'string') {
    router.push({ pathname: '/fixture-confirmed', params: { kind: 'league', id: data.fixtureId } });
  } else if (notification.type === 'booking_slot') {
    router.push('/book');
  } else if (notification.type === 'booking_cancelled') {
    router.push('/my-bookings');
  }
}

function NotificationRow({ notification, onOpened }: { notification: AppNotification; onOpened: () => void }) {
  const border = useThemeColor({ light: FuttyColors.stone200, dark: FuttyColors.stone200 }, 'icon');
  const unread = !notification.read_at;

  async function press() {
    if (unread) await markNotificationRead(notification.id);
    onOpened();
    await openNotification(notification);
  }

  return (
    <Pressable accessibilityRole="button" onPress={press}>
      <ThemedView style={[styles.row, { borderColor: border }, unread && styles.rowUnread]}>
        <View style={[styles.iconCircle, unread && styles.iconCircleUnread]}>
          <IconSymbol
            name={ICON_BY_TYPE[notification.type]}
            size={16}
            color={unread ? FuttyColors.white : FuttyColors.stone500}
          />
        </View>
        <View style={styles.rowBody}>
          <ThemedText type="defaultSemiBold" style={styles.rowTitle}>
            {notification.title}
          </ThemedText>
          <ThemedText style={styles.rowText}>{notification.body}</ThemedText>
          <ThemedText style={styles.rowTime}>{timeAgo(notification.created_at)}</ThemedText>
        </View>
        {unread ? <View style={styles.unreadDot} /> : null}
      </ThemedView>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const notifications = useNotifications();

  useFocusEffect(
    useCallback(() => {
      notifications.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {notifications.status === 'loading' ? <ActivityIndicator /> : null}
        {notifications.status === 'error' ? (
          <ThemedText style={styles.note}>Could not load notifications: {notifications.message}</ThemedText>
        ) : null}
        {notifications.status === 'ready' && notifications.notifications.length === 0 ? (
          <IconLabel icon="bell.fill" style={styles.note} iconColor={FuttyColors.stone400} iconSize={12}>
            Nothing yet — messages, squad updates and freed-up slots will show up here.
          </IconLabel>
        ) : null}
        {notifications.status === 'ready'
          ? notifications.notifications.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                onOpened={notifications.reload}
              />
            ))
          : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: 10,
    padding: 16,
    paddingBottom: 48,
  },
  note: {
    fontSize: 12,
    opacity: 0.7,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  rowUnread: {
    borderColor: FuttyColors.emerald600,
  },
  iconCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: FuttyColors.stone50,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  iconCircleUnread: {
    backgroundColor: FuttyColors.emerald950,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 14,
    color: FuttyColors.stone900,
  },
  rowText: {
    fontFamily: FuttyFonts.sans,
    fontSize: 13,
    color: FuttyColors.stone500,
  },
  rowTime: {
    fontFamily: FuttyFonts.sans,
    fontSize: 11,
    color: FuttyColors.stone400,
    marginTop: 2,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: FuttyColors.emerald600,
    marginTop: 4,
  },
});
