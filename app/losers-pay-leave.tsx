// Leaving (a player) or pulling out (a captain) of a Losers pay game, from
// the booking (spec 13 "Losers pay (Gipedo Pano in Booking v2)", "Pulling
// out"). The quote and the amounts are the server's; on the tap the quote
// is read again and, if the money changed, shown to check again first.
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';

import { LosersPayLeaveView, type ConfirmOutcome } from '@/components/booking/losers-pay-leave-view';
import {
  actionTitle,
  confirmLosersPay,
  fetchQuote,
  sameMoney,
  type LosersPayAction,
  type LosersPayQuote,
} from '@/lib/booking-losers-pay';
import { useLoad } from '@/lib/booking-search';
import { useRules } from '@/lib/use-rules';

export default function LosersPayLeaveScreen() {
  useRules();
  const { bookingId = '', action: actionParam = 'leave' } = useLocalSearchParams<{ bookingId: string; action: string }>();
  const action: LosersPayAction = actionParam === 'pull_out' ? 'pull_out' : 'leave';
  const load = useCallback(() => fetchQuote(action, bookingId), [action, bookingId]);
  const { state, reload } = useLoad(bookingId || null, load);

  async function confirm(shown: LosersPayQuote): Promise<ConfirmOutcome> {
    let now: LosersPayQuote;
    try {
      now = await fetchQuote(action, bookingId);
    } catch (err) {
      return fail(err instanceof Error ? err.message : 'Something went wrong.');
    }
    if (!sameMoney(shown, now)) return { status: 'changed', quote: now };
    const error = await confirmLosersPay(action, bookingId);
    if (error) return fail(error);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    return { status: 'done' };
  }

  return (
    <>
      <Stack.Screen options={{ title: actionTitle(action) }} />
      <LosersPayLeaveView
        action={action}
        state={bookingId ? state : { status: 'error', message: 'This booking could not be found.' }}
        onRetry={reload}
        onConfirm={confirm}
        onKeep={() => router.back()}
        onDone={() => router.back()}
      />
    </>
  );
}

function fail(message: string): ConfirmOutcome {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
  return { status: 'error', message };
}
