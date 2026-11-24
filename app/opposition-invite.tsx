// Side B's accept screen (B3, Booking v2): from an "opposition_invite"
// notification, or (B4) from a public opposition post in "Find a game"
// (postId: "Accept as opponent"). "Accept as captain", choose how side B pays, then pay or
// hold within the payment window; then on to the screen after paying, to
// invite side B's players.
import { usePaymentSheet } from '@stripe/stripe-react-native';
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';

import { OppositionInviteView } from '@/components/booking/opposition-invite-view';
import { payShare } from '@/lib/booking-checkout';
import { afterBooking } from '@/lib/booking-navigation';
import { acceptOpposition, fetchOppositionInvite, type AcceptedOpposition } from '@/lib/booking-opposition';
import { acceptOppositionPost, fetchOppositionPost } from '@/lib/booking-posts';
import { useLoad } from '@/lib/booking-search';
import { useRules } from '@/lib/use-rules';

const card = { method: 'card' as const, acceptNonRefundable: false, useCredit: false };

export default function OppositionInviteScreen() {
  useRules();
  const { inviteId = '', postId = '' } = useLocalSearchParams<{ inviteId: string; postId: string }>();
  const id = postId || inviteId;
  const load = useCallback(() => (postId ? fetchOppositionPost(postId) : fetchOppositionInvite(inviteId)), [inviteId, postId]);
  const { state, reload } = useLoad(id || null, load);
  const { initPaymentSheet, presentPaymentSheet } = usePaymentSheet();
  const [accepted, setAccepted] = useState<AcceptedOpposition | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay(mode: 'pay_all' | 'each_pays_responsible') {
    setPaying(true);
    setError(null);
    // Accepted once: a retry (the sheet closed, a card declined) pays the
    // same share again.
    let mine = accepted;
    if (!mine) {
      const losersPay = state.status === 'ready' && state.data.losers_pay === true;
      const result = postId
        ? await acceptOppositionPost(postId, mode, losersPay)
        : await acceptOpposition(inviteId, mode, losersPay);
      if ('error' in result) {
        setPaying(false);
        setError(result.error);
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
        return;
      }
      mine = result.accepted;
      setAccepted(mine);
    }
    const outcome = mine.share_id
      ? await payShare(mine.share_id, card, { init: (p) => initPaymentSheet(p), present: () => presentPaymentSheet() })
      : ({ status: 'paid' } as const);
    setPaying(false);
    if (outcome.status === 'paid') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      afterBooking(mine.booking_id, router);
    } else if (outcome.status === 'error') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setError(outcome.message);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Play against us?' }} />
      <OppositionInviteView
        state={id ? state : { status: 'error', message: 'This invite is no longer open.' }}
        onRetry={reload}
        onPay={pay}
        paying={paying}
        error={error}
        accepted={accepted !== null}
      />
    </>
  );
}
