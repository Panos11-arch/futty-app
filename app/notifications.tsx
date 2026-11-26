import { router, useFocusEffect } from 'expo-router';
import { Fragment, useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SectionHeader } from '@/components/ui/section-header';
import { SkeletonText } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';
import { CYPRUS_TIME_ZONE } from '@/lib/calendar/cyprus-time';
import { acceptInvite, declineInvite, describeInviteError, inviteStatuses, type InviteStatus } from '@/lib/invites';
import {
  isVenueNotificationType,
  isVenuePlayerBookerType,
  markNotificationRead,
  type AppNotification,
  type NotificationType,
} from '@/lib/notifications';
import { routeForPushData } from '@/lib/push-tap';
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
  match_result_submitted: 'sportscourt.fill',
  match_result_confirmed: 'sportscourt.fill',
  match_result_disputed: 'sportscourt.fill',
  match_score_mismatch: 'sportscourt.fill',
  match_score_check: 'sportscourt.fill',
  match_score_rejected: 'sportscourt.fill',
  venue_new_booking: 'calendar',
  venue_booking_cancelled: 'exclamationmark.triangle.fill',
  venue_short_game: 'person.2.fill',
  venue_daily_summary: 'list.clipboard.fill',
  venue_player_offered: 'person.crop.circle.badge.plus',
  venue_player_withdrawn: 'person.2.fill',
  venue_player_accepted: 'person.crop.circle.badge.plus',
  venue_player_declined: 'person.2.fill',
  venue_player_removed: 'person.2.fill',
  saved_search_match: 'magnifyingglass',
  friend_request: 'person.crop.circle.badge.plus',
  friend_accepted: 'person.2.fill',
};

/** B3 (Booking v2): opened where routeForPushData says. */
const BOOKING_V2_TYPES = new Set([
  'opposition_invite',
  'no_opponent',
  'no_opponent_reminder',
  'opposition_found',
  'opposition_left',
  'opposition_lapsed',
]);

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

const cyprusDay = new Intl.DateTimeFormat('en-CA', { timeZone: CYPRUS_TIME_ZONE });

/** Splits the list (kept in the server's order) into Today and Earlier, by
 *  the Cyprus calendar day, whatever the phone's time zone. */
export function groupByDay<T extends { created_at: string }>(items: T[], now: Date = new Date()) {
  const today = cyprusDay.format(now);
  const groups = [
    { title: 'Today', items: items.filter((n) => cyprusDay.format(new Date(n.created_at)) === today) },
    { title: 'Earlier', items: items.filter((n) => cyprusDay.format(new Date(n.created_at)) !== today) },
  ];
  return groups.filter((g) => g.items.length > 0);
}

/** Where tapping a notification goes, per the `data` payload each trigger in
 *  supabase/notifications.sql (and supabase/fixture-confirmed-notifications.sql)
 *  writes. */
async function openNotification(notification: AppNotification) {
  const data = notification.data as Record<string, unknown>;

  // A venue staff notice opens the venue dashboard, as its push does. Checked
  // before anything else: these carry a bookingId but aren't the staff's own.
  if (isVenueNotificationType(notification.type)) {
    router.push(routeForPushData({ ...data, type: notification.type }));
    return;
  }

  // P6e: the venue's offered player opens the booking, as its push does.
  if (isVenuePlayerBookerType(notification.type)) {
    router.push(routeForPushData({ ...data, type: notification.type }));
    return;
  }

  // S20: a friend request opens Friends; an accepted one, the friend chat.
  if (notification.type === 'friend_request' || notification.type === 'friend_accepted') {
    router.push(routeForPushData({ ...data, type: notification.type }));
    return;
  }

  // A match notification (A2) opens the match screen, as its push does.
  if (typeof data.matchId === 'string') {
    router.push(routeForPushData(data));
    return;
  }

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
  } else if (notification.type === 'saved_search_match') {
    // A freed slot opens Book at that venue; a game asking for players, its post.
    router.push(routeForPushData({ ...data, type: notification.type }));
  } else if (BOOKING_V2_TYPES.has(notification.type)) {
    // B3 (Booking v2): an opposition invite opens side B's accept screen;
    // the rest open the booking, where the sides and the choice are.
    router.push(routeForPushData({ ...data, type: notification.type }));
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
  const styles = useStyles();
  const inviteId = inviteIdOf(notification);
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!inviteId || !status) return null;
  if (status !== 'pending') {
    return (
      <Text variant="callout" tone="inkMuted">
        {status === 'accepted' ? 'Accepted' : 'Declined'}
      </Text>
    );
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
        <Button
          label="Accept"
          loading={busy === 'accept'}
          disabled={!!busy}
          onPress={() => answer('accept')}
        />
        <Button
          label="Decline"
          variant="secondary"
          loading={busy === 'decline'}
          disabled={!!busy}
          onPress={() => answer('decline')}
        />
      </View>
      {error ? (
        <Text variant="callout" tone="danger" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
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
  const styles = useStyles();
  const { colors } = useTheme();
  const unread = !notification.read_at;

  async function press() {
    if (unread) await markNotificationRead(notification.id);
    onOpened();
    await openNotification(notification);
  }

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${unread ? 'Unread. ' : ''}${notification.title}. ${notification.body}`}
        onPress={press}
        style={({ pressed }) => [styles.rowMain, pressed && styles.pressed]}>
        <IconSymbol name={ICON_BY_TYPE[notification.type]} size={ICON.small} color={colors.inkMuted} />
        <View style={styles.rowBody}>
          <Text variant={unread ? 'headline' : 'body'}>{notification.title}</Text>
          <Text variant="callout" tone="inkMuted">
            {notification.body}
          </Text>
          <Text variant="caption" tone="inkMuted" tabular>
            {timeAgo(notification.created_at)}
          </Text>
        </View>
        {unread ? <View testID="notification-unread-dot" style={styles.unreadDot} /> : null}
      </Pressable>
      <View style={styles.actions}>
        <InviteActions notification={notification} status={inviteStatus} onAnswered={onInviteAnswered} />
      </View>
    </View>
  );
}

export default function NotificationsScreen() {
  const styles = useStyles();
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
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {notifications.status === 'loading' ? (
          <Card testID="notifications-skeleton">
            <SkeletonText lines={4} />
          </Card>
        ) : null}
        {notifications.status === 'error' ? (
          <Banner
            tone="danger"
            message={`Could not load notifications: ${notifications.message}`}
            action={{ label: 'Try again', onPress: notifications.reload }}
          />
        ) : null}
        {notifications.status === 'ready' && notifications.notifications.length === 0 ? (
          <EmptyState
            icon="bell.fill"
            message="Nothing yet — messages, squad updates and freed-up slots will show up here."
          />
        ) : null}
        {notifications.status === 'ready'
          ? groupByDay(notifications.notifications).map((group) => (
              <View key={group.title} style={styles.group}>
                <SectionHeader title={group.title} />
                <Card padded={false}>
                  {group.items.map((notification, i) => (
                    <Fragment key={notification.id}>
                      {i > 0 ? <View style={styles.divider} /> : null}
                      <NotificationRow
                        notification={notification}
                        inviteStatus={invites.get(inviteIdOf(notification) ?? '')}
                        onOpened={notifications.reload}
                        onInviteAnswered={(status) => {
                          const id = inviteIdOf(notification);
                          if (id) setInvites((current) => new Map(current).set(id, status));
                        }}
                      />
                    </Fragment>
                  ))}
                </Card>
              </View>
            ))
          : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { gap: space.xl, padding: space.lg, paddingBottom: space.xxl },
  group: { gap: space.sm },
  row: { backgroundColor: colors.surface },
  rowMain: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    paddingBottom: space.md,
  },
  pressed: { backgroundColor: colors.canvas },
  rowBody: { flex: 1, gap: 2 },
  actions: { paddingLeft: space.lg + ICON.small + space.md, paddingRight: space.lg, paddingBottom: space.md },
  inviteActions: { gap: space.sm },
  inviteButtons: { flexDirection: 'row', gap: space.sm },
  unreadDot: {
    width: space.sm,
    height: space.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.ink,
    marginTop: space.sm - space.xs / 2,
  },
  divider: { height: hairline, backgroundColor: colors.border, marginLeft: space.lg },
}));
