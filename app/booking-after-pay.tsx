// The screen after paying (B3, Booking v2): invite friends, on a half pitch
// invite the opposition, publish the game. Wires AfterPayView to the server;
// "Go to booking" opens the booking's detail.
import { router, Stack, useLocalSearchParams, useNavigation } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Share } from 'react-native';

import { AfterPayView } from '@/components/booking/after-pay-view';
import { useAuth } from '@/lib/auth';
import { fetchBookingDetail, shareText } from '@/lib/booking-detail';
import { describeBookingErrorMessage } from '@/lib/booking-errors';
import { bookingDetailHref } from '@/lib/booking-navigation';
import {
  fetchFollowedTeamIds,
  inviteOpposition,
  publishBooking,
  searchTeams,
  unpublishPost,
  type BookingV2Info,
} from '@/lib/booking-opposition';
import { useLoad } from '@/lib/booking-search';
import { addBookingPlayer } from '@/lib/booking-shares';
import { startMatchPublishKind, takeStartMatch, waitUntilConfirmed, type PublishKind } from '@/lib/start-match';
import { useRules } from '@/lib/use-rules';

// S6: how long "Publish game" waits for the payment webhook to confirm a
// booking started from Find a match (the server refuses it before then).
const CONFIRM_TRIES = 10;
const CONFIRM_DELAY_MS = 2000;

export default function BookingAfterPayScreen() {
  useRules();
  const { bookingId = '', from } = useLocalSearchParams<{ bookingId: string; from?: string }>();
  const { user } = useAuth();
  const load = useCallback(() => fetchBookingDetail(bookingId), [bookingId]);
  const { state, reload } = useLoad(bookingId || null, load);
  const detail = state.status === 'ready' ? state.data : null;

  // S6: paid for a game started from Find a match ("Start a match"): the
  // right Publish switch starts on. Taken once, right after paying; worked
  // out once, from the booking as it first loads.
  const [startedMatch] = useState(() => from === 'pay' && takeStartMatch());
  const preselect = useRef<PublishKind | null | undefined>(undefined);
  if (detail && preselect.current === undefined) {
    preselect.current = startedMatch ? startMatchPublishKind(detail) : null;
  }

  // The open posts, kept up to date without reloading the screen, so a
  // switch turned off unpublishes the post it made.
  const posts = useRef<BookingV2Info['posts'] | null>(null);
  useEffect(() => {
    posts.current = detail?.v2?.posts ?? null;
  }, [detail]);
  const refreshPosts = async () => {
    try {
      posts.current = (await fetchBookingDetail(bookingId)).v2?.posts ?? null;
    } catch {
      // Kept as it was; the next switch tries again.
    }
  };

  const followed = useRef<Set<string> | null>(null);

  // QA 24 November, S4: back (the header button, a swipe or Android's back)
  // goes to the booking, never back to the checkout of a paid booking.
  const navigation = useNavigation();
  // Only right after paying: opened from a booking, back goes back to it.
  const afterPaying = from === 'pay';
  useEffect(() => {
    if (!bookingId || !afterPaying) return;
    return navigation.addListener('beforeRemove', (e) => {
      if (e.data.action.type !== 'GO_BACK' && e.data.action.type !== 'POP') return;
      e.preventDefault();
      router.replace(bookingDetailHref(bookingId));
    });
  }, [navigation, bookingId, afterPaying]);

  async function publish(kind: 'players' | 'opposition', on: boolean): Promise<string | null> {
    let error: string | null;
    if (on) {
      if (kind === 'players' && preselect.current === 'players') {
        await waitUntilConfirmed(
          async () => (await fetchBookingDetail(bookingId)).booking.status === 'confirmed',
          { tries: CONFIRM_TRIES, delayMs: CONFIRM_DELAY_MS },
        );
      }
      error = await publishBooking(bookingId, kind);
    }
    else {
      const postId = posts.current?.[kind] ?? null;
      error = postId ? await unpublishPost(postId) : null;
    }
    await refreshPosts();
    return error;
  }

  return (
    <>
      <Stack.Screen options={afterPaying ? { title: 'Booked', headerBackTitle: 'Booking' } : { title: 'Booked' }} />
      <AfterPayView
        state={bookingId ? state : { status: 'error', message: 'This booking could not be found.' }}
        onRetry={reload}
        onInviteFriend={async (username) => {
          const { error } = await addBookingPlayer(bookingId, username);
          return error ? describeBookingErrorMessage(error.message) : null;
        }}
        onShare={() => {
          if (detail) void Share.share({ message: shareText(detail) }).catch(() => {});
        }}
        onSearchTeams={async (query) => {
          if (!followed.current) followed.current = user ? await fetchFollowedTeamIds(user.id).catch(() => new Set<string>()) : new Set();
          return searchTeams(query, followed.current);
        }}
        onInviteOpposition={async (choice) => {
          const result = await inviteOpposition(bookingId, choice);
          return 'error' in result ? result.error : null;
        }}
        onPublishOpposition={(on) => publish('opposition', on)}
        onPublishGame={(on) => publish('players', on)}
        preselect={preselect.current ?? null}
        onDone={() => router.replace(bookingDetailHref(bookingId))}
      />
    </>
  );
}
