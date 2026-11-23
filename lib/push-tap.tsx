// Opens the right screen when a player taps a push: with the app open, in
// the background, or launched from the push (cold start). Mounted once, in
// app/_layout.tsx, after the sign-in and app-lock gates.
//
// Every push carries its notification's `data` plus `type` and
// `notificationId` (supabase/functions/notify-send-pushes/handler.ts).
// expo-notifications API per https://docs.expo.dev/versions/v55.0.0/sdk/notifications/
// ("Handle push notifications with navigation").
import * as Notifications from 'expo-notifications';
import { router, type Href } from 'expo-router';
import { useEffect } from 'react';
import { Platform } from 'react-native';

import { isVenueNotificationType, isVenuePlayerBookerType, markNotificationRead } from '@/lib/notifications';
import { playHref } from '@/lib/play-segments';

/** A10 (match-record.md decision 1j): these open the post-match flow, after
 *  the game and again when the vote and ratings open. */
const POST_MATCH_FLOW_TYPES = new Set(['match_after_game', 'match_result_confirmed', 'motm_vote_open']);

/** B3 (Booking v2): these open the booking, where the sides and the
 *  no-opponent choice are. */
const BOOKING_V2_TYPES = new Set(['no_opponent', 'no_opponent_reminder', 'opposition_found', 'opposition_left', 'opposition_lapsed']);

// A push that arrives while the app is open shows as a banner (and in the
// notification list), silently, so it can be tapped like any other.
if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  });
}

function stringId(data: Record<string, unknown>, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Where a push's data opens: a venue staff notice opens the venue dashboard
 *  (checked first, so staff never land on My Bookings); the post-match pushes
 *  open the post-match flow; otherwise its match,
 *  booking, squad post or team, in that order; anything else opens the
 *  notifications list. */
export function routeForPushData(raw: unknown): Href {
  const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  // The dashboard has no route for a given day or booking yet; it opens on today.
  if (isVenueNotificationType(data.type)) return '/venue-dashboard';

  // A7: team of the week opens the week's teams.
  if (data.type === 'team_of_the_week') return '/match/team-of-the-week';

  const matchId = stringId(data, 'matchId');
  if (matchId && typeof data.type === 'string' && POST_MATCH_FLOW_TYPES.has(data.type)) {
    return { pathname: '/match/after-game', params: { id: matchId } };
  }
  if (matchId) return { pathname: '/match/[id]', params: { id: matchId } };

  // B3 (Booking v2): an opposition invite opens side B's accept screen.
  const inviteId = stringId(data, 'inviteId');
  if (data.type === 'opposition_invite' && inviteId) return { pathname: '/opposition-invite', params: { inviteId } };

  const bookingId = stringId(data, 'bookingId');
  // B3: a half pitch's opposition and no-opponent choice are on the booking.
  if (bookingId && typeof data.type === 'string' && BOOKING_V2_TYPES.has(data.type)) {
    return { pathname: '/booking/[id]', params: { id: bookingId } };
  }
  // P6e: the venue's offered player opens the booking, where the booker answers.
  if (bookingId && isVenuePlayerBookerType(data.type)) return { pathname: '/booking/[id]', params: { id: bookingId } };
  // My Bookings doesn't pick out one booking from the param yet (Panos's screen).
  if (bookingId) return { pathname: '/my-bookings', params: { bookingId } };

  const postId = stringId(data, 'postId');
  if (postId) return { pathname: '/join-squad-post', params: { postId } };

  // A saved search's freed slot opens Book at that venue.
  const venueId = stringId(data, 'venueId');
  if (data.type === 'saved_search_match' && venueId) return { pathname: '/book', params: { venueId } };

  const teamId = stringId(data, 'teamId');
  if (teamId) return playHref('teams', { teamId });

  return '/notifications';
}

// Pushes already opened, by request identifier. Module-level so a remount
// (signing out and in again) doesn't open the cold-start push a second time.
const handled = new Set<string>();

/** For tests. */
export function resetHandledPushTaps() {
  handled.clear();
}

function openTappedPush(response: Notifications.NotificationResponse | null) {
  if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
  const { identifier, content } = response.notification.request;
  if (handled.has(identifier)) return;
  handled.add(identifier);

  const data = (content.data ?? {}) as Record<string, unknown>;
  router.push(routeForPushData(data));
  const notificationId = stringId(data, 'notificationId');
  if (notificationId) void markNotificationRead(notificationId);
  Notifications.clearLastNotificationResponse();
}

/** Renders nothing; listens for push taps while mounted. */
export function PushTapHandler() {
  useEffect(() => {
    if (Platform.OS === 'web') return;
    // Cold start (or a tap that arrived before this mounted, e.g. while signed out).
    openTappedPush(Notifications.getLastNotificationResponse());
    const subscription = Notifications.addNotificationResponseReceivedListener(openTappedPush);
    return () => subscription.remove();
  }, []);

  return null;
}
