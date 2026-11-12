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

import { markNotificationRead } from '@/lib/notifications';
import { playHref } from '@/lib/play-segments';

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

/** Where a push's data opens: its match, booking, squad post or team, in
 *  that order; anything else opens the notifications list. */
export function routeForPushData(raw: unknown): Href {
  const data = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};

  const matchId = stringId(data, 'matchId');
  if (matchId) return { pathname: '/match/[id]', params: { id: matchId } };

  const bookingId = stringId(data, 'bookingId');
  // My Bookings doesn't pick out one booking from the param yet (Panos's screen).
  if (bookingId) return { pathname: '/my-bookings', params: { bookingId } };

  const postId = stringId(data, 'postId');
  if (postId) return { pathname: '/join-squad-post', params: { postId } };

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
