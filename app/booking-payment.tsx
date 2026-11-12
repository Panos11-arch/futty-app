import { usePaymentSheet } from '@stripe/stripe-react-native';
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import { CheckoutView } from '@/components/booking/checkout-view';
import { PayShareView } from '@/components/booking/pay-share-view';
import type { PaymentMode } from '@/lib/booking-actions';
import { payForSlot, payShare, type PaymentSheet, type PayOptions } from '@/lib/booking-checkout';
import { afterPayment } from '@/lib/booking-navigation';
import { fetchBookingQuote, fetchPayShareData, useLoad, type Slot } from '@/lib/booking-search';

type Params = {
  bookingId?: string;
  venueId?: string;
  venueName?: string;
  day?: string;
  start?: string;
  end?: string;
  format?: string;
  playersPerSide?: string;
};

/** Checkout for a new booking (from Book), or Pay my share for a booking
 *  that already exists (bookingId: notifications, transactions). */
export default function BookingPaymentScreen() {
  const params = useLocalSearchParams<Params>();
  const { initPaymentSheet, presentPaymentSheet } = usePaymentSheet();
  const sheet: PaymentSheet = useMemo(
    () => ({ init: (p) => initPaymentSheet(p), present: () => presentPaymentSheet() }),
    [initPaymentSheet, presentPaymentSheet],
  );

  if (params.bookingId) {
    return <PayMyShare bookingId={params.bookingId} sheet={sheet} />;
  }
  if (!params.venueId || !params.day || !params.start || !params.end || !params.format) {
    return <PayMyShare bookingId="" sheet={sheet} />;
  }
  const slot: Slot = {
    venueId: params.venueId,
    day: params.day,
    start: params.start,
    end: params.end,
    format: params.format,
    playersPerSide: params.playersPerSide === '6' ? 6 : 5,
  };
  return <Checkout slot={slot} venueName={params.venueName ?? ''} sheet={sheet} />;
}

/** Paid: on to this booking's detail (roster, invite, cancel). */
function paid(bookingId: string | null) {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  afterPayment(bookingId, router);
}

function failed() {
  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
}

function Checkout({ slot, venueName, sheet }: { slot: Slot; venueName: string; sheet: PaymentSheet }) {
  const load = useCallback(() => fetchBookingQuote(slot), [slot]);
  const quote = useLoad(JSON.stringify(slot), load);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay({ mode, pay }: { mode: PaymentMode; pay: PayOptions }) {
    setPaying(true);
    setError(null);
    const outcome = await payForSlot({ slot, mode, pay, bookingId }, sheet);
    setPaying(false);
    setBookingId(outcome.bookingId);
    if (outcome.status === 'paid') paid(outcome.bookingId);
    else if (outcome.status === 'error') {
      failed();
      setError(outcome.message);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Checkout' }} />
      <CheckoutView
        venueName={venueName}
        quote={quote.state}
        onRetry={quote.reload}
        onPay={pay}
        paying={paying}
        error={error}
        bookingHeld={bookingId !== null}
      />
    </>
  );
}

function PayMyShare({ bookingId, sheet }: { bookingId: string; sheet: PaymentSheet }) {
  const load = useCallback(() => fetchPayShareData(bookingId), [bookingId]);
  const data = useLoad(bookingId || null, load);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function pay(options: PayOptions) {
    if (data.state.status !== 'ready' || !data.state.data.detail.me) return;
    setPaying(true);
    setError(null);
    const outcome = await payShare(data.state.data.detail.me.share_id, options, sheet);
    setPaying(false);
    if (outcome.status === 'paid') paid(bookingId);
    else if (outcome.status === 'error') {
      failed();
      setError(outcome.message);
      data.reload();
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: 'Pay my share' }} />
      <PayShareView
        data={bookingId ? data.state : { status: 'error', message: 'This booking could not be found.' }}
        onRetry={data.reload}
        onPay={pay}
        paying={paying}
        error={error}
      />
    </>
  );
}
