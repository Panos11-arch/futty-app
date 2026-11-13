import { usePaymentSheet } from '@stripe/stripe-react-native';
import * as Haptics from 'expo-haptics';
import { router, Stack } from 'expo-router';
import { useCallback, useMemo } from 'react';

import { OwedView } from '@/components/booking/owed-view';
import type { PaymentSheet } from '@/lib/booking-checkout';
import { useCredit, useOwed, usePayOwed, type OwedItem } from '@/lib/use-owed';

/** "Pay what I owe" (P5c): debts, payments to finish and credit, from
 *  my_owed and my_credit. Paying sends only an id; the server charges
 *  exactly what's owed, and the webhook clears it once Stripe confirms. */
export default function OwedScreen() {
  const owed = useOwed();
  const credit = useCredit();
  const { initPaymentSheet, presentPaymentSheet } = usePaymentSheet();
  const sheet: PaymentSheet = useMemo(
    () => ({ init: (p) => initPaymentSheet(p), present: () => presentPaymentSheet() }),
    [initPaymentSheet, presentPaymentSheet],
  );
  const openPayShare = useCallback(
    (bookingId: string) => router.push({ pathname: '/booking-payment', params: { bookingId } }),
    [],
  );
  const { pay, payingKey, message } = usePayOwed({ sheet, openPayShare, reload: owed.reload });

  async function onPay(item: OwedItem) {
    const result = await pay(item);
    if (result.status === 'paid') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } else if (result.status === 'error') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Debt and credit' }} />
      <OwedView
        owed={owed.state}
        credit={credit.state}
        onRetryOwed={owed.reload}
        onRetryCredit={credit.reload}
        onPay={onPay}
        payingKey={payingKey}
        message={message}
      />
    </>
  );
}
