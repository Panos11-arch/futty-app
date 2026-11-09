import { router, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AuthButton, AuthError } from '@/components/auth-form';
import { IconLabel } from '@/components/icon-label';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { useThemeColor } from '@/hooks/use-theme-color';
import { acceptInvite, declineInvite, describeInviteError, inviteStatuses, type InviteStatus } from '@/lib/invites';
import { markNotificationRead, type AppNotification, type NotificationType } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';
import { useNotifications } from '@/lib/use-notifications';

const ICON_BY_TYPE: Record<NotificationType, React.ComponentProps<typeof IconSymbol>['name']> = {
  fixture_message: 'bubble.left.fill',
  squad_post: 'person.2.fill',
  booking_slot: 'calendar',
  booking_cancelled: 'exclamationmark.triangle.fill',
  fixture_agreed: 'flag.checkered',
  match_payment_due: 'creditcard.fill',
  team_invite: 'person.crop.circle.badge.plus',
  booking_invite: 'calendar',
};

function inviteIdOf(notification: AppNotification) {
  const id = (notification.data as Record<string, unknown>).inviteId;
  return (notification.type === 'team_invite' || notification.type === 'booking_invite') && typeof id === 'string'
    ? id
    : null;
}

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
  } else if (notification.type === 'match_payment_due' && typeof data.bookingId === 'string') {
    router.push({ pathname: '/booking-payment', params: { bookingId: data.bookingId } });
  }
  // Invites are answered with the buttons on the row, not by opening them.
}

/** Accept / Decline on a team or booking invite, or what was decided. */
function InviteActions({
  notification,
  status,
  onAnswered,
}: {
  notification: AppNotification;
  status: InviteStatus | undefined;
  onAnswered: (status: InviteStatus) => void;
}) {
  const inviteId = inviteIdOf(notification);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!inviteId || !status) return null;
  if (status !== 'pending') {
    return <ThemedText style={styles.rowText}>{status === 'accepted' ? 'Accepted' : 'Declined'}</ThemedText>;
  }

  async function answer(choice: 'accept' | 'decline') {
    if (!inviteId || busy) return;
    setBusy(choice);
    setError(null);
    const { error: answerError } = choice === 'accept' ? await acceptInvite(inviteId) : await declineInvite(inviteId);
    setBusy(null);
    if (answerError) {
      setError(describeInviteError(answerError));
      return;
    }
    onAnswered(choice === 'accept' ? 'accepted' : 'declined');
    if (notification.read_at === null) await markNotificationRead(notification.id);
    // A game invite means paying your share next.
    const bookingId = (notification.data as Record<string, unknown>).bookingId;
    if (choice === 'accept' && notification.type === 'booking_invite' && typeof bookingId === 'string') {
      router.push({ pathname: '/booking-payment', params: { bookingId } });
    }
  }

  return (
    <View style={styles.inviteActions}>
      <View style={styles.inviteButtons}>
        <AuthButton label="Accept" compact busy={busy === 'accept'} disabled={!!busy} onPress={() => answer('accept')} />
        <AuthButton
          label="Decline"
          compact
          variant="secondary"
          busy={busy === 'decline'}
          disabled={!!busy}
          onPress={() => answer('decline')}
        />
      </View>
      {error ? <AuthError>{error}</AuthError> : null}
    </View>
  );
}

function NotificationRow({
  notification,
  inviteStatus,
  onOpened,
  onInviteAnswered,
}: {
  notification: AppNotification;
  inviteStatus: InviteStatus | undefined;
  onOpened: () => void;
  onInviteAnswered: (status: InviteStatus) => void;
}) {
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
          <InviteActions notification={notification} status={inviteStatus} onAnswered={onInviteAnswered} />
          <ThemedText style={styles.rowTime}>{timeAgo(notification.created_at)}</ThemedText>
        </View>
        {unread ? <View style={styles.unreadDot} /> : null}
      </ThemedView>
    </Pressable>
  );
}

export default function NotificationsScreen() {
  const notifications = useNotifications();
  const [invites, setInvites] = useState<Map<string, InviteStatus>>(new Map());

  const list = notifications.status === 'ready' ? notifications.notifications : null;
  useEffect(() => {
    if (!list) return;
    const ids = list.map(inviteIdOf).filter((id): id is string => id !== null);
    let active = true;
    inviteStatuses(ids).then((statuses) => {
      if (active) setInvites(statuses);
    });
    return () => {
      active = false;
    };
  }, [list]);

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
                inviteStatus={invites.get(inviteIdOf(notification) ?? '')}
                onOpened={notifications.reload}
                onInviteAnswered={(status) => {
                  const id = inviteIdOf(notification);
                  if (id) setInvites((current) => new Map(current).set(id, status));
                }}
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
  inviteActions: {
    gap: 6,
    marginTop: 8,
  },
  inviteButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: FuttyColors.emerald600,
    marginTop: 4,
  },
});
