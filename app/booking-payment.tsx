import { usePaymentSheet } from '@stripe/stripe-react-native';
import * as Haptics from 'expo-haptics';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import { CheckoutView, type CheckoutPayChoice } from '@/components/booking/checkout-view';
import { PayShareView } from '@/components/booking/pay-share-view';
import { WeatherStrip } from '@/components/venue/weather-strip';
import { payForSlot, payShare, type PaymentSheet, type PayOptions } from '@/lib/booking-checkout';
import { afterBooking, afterPayment } from '@/lib/booking-navigation';
import { fetchPayShareData, useLoad, type Slot } from '@/lib/booking-search';
import { fetchCheckoutData, fetchFreePitches } from '@/lib/booking-v2';
import { useReloadOnReturn } from '@/lib/use-owed';
import { useRules } from '@/lib/use-rules';
import { useGameWeather } from '@/lib/use-weather';

const openPayOwed = () => router.push('/account/payments/owed');

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
  // Spec 13's rules for the numbers in this screen's text (P10): loads them
  // and re-renders when they arrive.
  useRules();
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
  const key = JSON.stringify(slot);
  // Booking v2 (B2): every amount from booking_quote_v2 (credit from
  // booking_quote), and the free pitches from venue_free_pitches.
  const loadQuote = useCallback(() => fetchCheckoutData(slot), [slot]);
  const quote = useLoad(key, loadQuote);
  const loadPitches = useCallback(() => fetchFreePitches(slot), [slot]);
  const pitches = useLoad(key, loadPitches);
  // Back from "Pay what I owe": price it again, only if the debt blocked it.
  useReloadOnReturn(quote.reload, quote.state.status === 'ready' && quote.state.data.quote.in_debt);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // P11: the forecast for the game's hours.
  const weather = useGameWeather(slot.venueId, { day: slot.day, start: slot.start, end: slot.end });

  async function pay({ mode, kind, pitchIds, losersPay, pay }: CheckoutPayChoice) {
    setPaying(true);
    setError(null);
    const outcome = await payForSlot({ slot, mode, kind, pitchIds, losersPay, pay, bookingId }, sheet);
    setPaying(false);
    setBookingId(outcome.bookingId);
    if (outcome.status === 'paid') {
      // B3: on to the screen after paying (invite friends, the opposition, publish).
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      afterBooking(outcome.bookingId, router);
    } else if (outcome.status === 'error') {
      failed();
      setError(outcome.message);
      // "Pitch 2 is no longer free. Pick another.": the list without it.
      if (outcome.pitchTaken) pitches.reload();
    }
  }

  const retry = () => {
    quote.reload();
    pitches.reload();
  };

  return (
    <>
      <Stack.Screen options={{ title: 'Checkout' }} />
      <CheckoutView
        venueName={venueName}
        quote={quote.state}
        pitches={pitches.state}
        onRetry={retry}
        onPay={pay}
        paying={paying}
        error={error}
        bookingHeld={bookingId !== null}
        onPayOwed={openPayOwed}
        weather={<WeatherStrip weather={weather.weather} loading={weather.loading} />}
      />
    </>
  );
}

function PayMyShare({ bookingId, sheet }: { bookingId: string; sheet: PaymentSheet }) {
  const load = useCallback(() => fetchPayShareData(bookingId), [bookingId]);
  const data = useLoad(bookingId || null, load);
  useReloadOnReturn(data.reload, data.state.status === 'ready' && data.state.data.blocked);
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
        onPayOwed={openPayOwed}
      />
    </>
  );
}
