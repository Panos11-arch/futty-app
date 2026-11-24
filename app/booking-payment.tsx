import { usePaymentSheet } from '@stripe/stripe-react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';

import { CheckoutView } from '@/components/booking/checkout-view';
import { PayShareView } from '@/components/booking/pay-share-view';
import { WeatherStrip } from '@/components/venue/weather-strip';
import { payShare, type PaymentSheet, type PayOptions } from '@/lib/booking-checkout';
import { afterPayment } from '@/lib/booking-navigation';
import { fetchPayShareData, useLoad, type Slot } from '@/lib/booking-search';
import { useReloadOnReturn } from '@/lib/use-owed';
import { useRules } from '@/lib/use-rules';
import { useSlotCheckout } from '@/lib/use-slot-checkout';
import { useGameWeather } from '@/lib/use-weather';
import { haptic } from '@/lib/haptics';

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
  haptic.success();
  afterPayment(bookingId, router);
}

function failed() {
  haptic.error();
}

function Checkout({ slot, venueName, sheet }: { slot: Slot; venueName: string; sheet: PaymentSheet }) {
  // Booking v2 (B2): every amount from booking_quote_v2 (credit from
  // booking_quote), and the free pitches from venue_free_pitches.
  const checkout = useSlotCheckout(slot, sheet);
  // P11: the forecast for the game's hours.
  const weather = useGameWeather(slot.venueId, { day: slot.day, start: slot.start, end: slot.end });

  return (
    <>
      <Stack.Screen options={{ title: 'Checkout' }} />
      <CheckoutView
        venueName={venueName}
        quote={checkout.quote}
        pitches={checkout.pitches}
        onRetry={checkout.retry}
        onPay={checkout.pay}
        paying={checkout.paying}
        error={checkout.error}
        bookingHeld={checkout.bookingHeld}
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
