import { usePaymentSheet } from '@stripe/stripe-react-native';
import * as Haptics from 'expo-haptics';
import { router, Stack } from 'expo-router';
import { useMemo, useState } from 'react';

import { OwedView, owedItemKey, type OwedItem, type OwedViewProps } from '@/components/booking/owed-view';
import type { PaymentSheet, PayOutcome } from '@/lib/booking-checkout';
import { payOwed, updateGuaranteeCard, useCredit, useOwed } from '@/lib/use-owed';

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
  const [payingKey, setPayingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<OwedViewProps['message']>(null);

  async function pay(item: OwedItem) {
    // A share not paid yet is paid on Pay my share, priced by the server there.
    if (item.type === 'payment' && item.payment.kind === 'payment_due') {
      router.push({ pathname: '/booking-payment', params: { bookingId: item.payment.booking_id } });
      return;
    }
    let outcome: PayOutcome;
    setPayingKey(owedItemKey(item));
    setMessage(null);
    if (item.type === 'debt') {
      outcome = await payOwed({ debtId: item.debt.debt_id }, sheet);
    } else if (item.payment.kind === 'card_failed') {
      outcome = await updateGuaranteeCard(item.payment.booking_id, sheet);
    } else if (item.payment.share_id) {
      outcome = await payOwed({ shareId: item.payment.share_id }, sheet);
    } else {
      outcome = { status: 'error', message: 'This payment could not be found.' };
    }
    setPayingKey(null);
    if (outcome.status === 'paid') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      setMessage({
        tone: 'info',
        text:
          item.type === 'payment' && item.payment.kind === 'card_failed'
            ? 'Card saved. Your guarantee is retried with it once Stripe confirms.'
            : 'Payment sent. It clears once Stripe confirms it.',
      });
      owed.reload();
    } else if (outcome.status === 'error') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
      setMessage({ tone: 'danger', text: outcome.message });
      owed.reload();
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
        onPay={pay}
        payingKey={payingKey}
        message={message}
      />
    </>
  );
}
