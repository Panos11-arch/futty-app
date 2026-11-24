// Checkout for a new booking (Booking v2), used by the payment screen and
// the venue page's payment sheet (S5): the server's quote and free pitches
// for the slot, and Pay. Every amount is the server's (booking_quote_v2,
// venue_free_pitches); the app only sends the player's choices.
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import type { CheckoutPayChoice } from '@/components/booking/checkout-view';
import { payForSlot, type PaymentSheet } from '@/lib/booking-checkout';
import { afterBooking } from '@/lib/booking-navigation';
import { useLoad, type Slot } from '@/lib/booking-search';
import { fetchCheckoutData, fetchFreePitches } from '@/lib/booking-v2';
import { haptic } from '@/lib/haptics';
import { useReloadOnReturn } from '@/lib/use-owed';

export function useSlotCheckout(slot: Slot | null, sheet: PaymentSheet) {
  const key = slot ? JSON.stringify(slot) : null;
  const loadQuote = useCallback(() => fetchCheckoutData(slot!), [slot]);
  const quote = useLoad(key, loadQuote);
  const loadPitches = useCallback(() => fetchFreePitches(slot!), [slot]);
  const pitches = useLoad(key, loadPitches);
  // Back from "Pay what I owe": price it again, only if the debt blocked it.
  useReloadOnReturn(quote.reload, quote.state.status === 'ready' && quote.state.data.quote.in_debt);
  const [bookingId, setBookingId] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Another slot (the time changed on the venue page): a booking held for
  // the old one isn't this checkout's; the next Pay books the new slot.
  useEffect(() => {
    setBookingId(null);
    setError(null);
  }, [key]);

  async function pay({ mode, kind, pitchIds, losersPay, pay: options }: CheckoutPayChoice) {
    if (!slot) return;
    setPaying(true);
    setError(null);
    const outcome = await payForSlot({ slot, mode, kind, pitchIds, losersPay, pay: options, bookingId }, sheet);
    setPaying(false);
    setBookingId(outcome.bookingId);
    if (outcome.status === 'paid') {
      // B3: on to the screen after paying (invite friends, the opposition, publish).
      haptic.success();
      afterBooking(outcome.bookingId, router);
    } else if (outcome.status === 'error') {
      haptic.error();
      setError(outcome.message);
      // "Pitch 2 is no longer free. Pick another.": the list without it.
      if (outcome.pitchTaken) pitches.reload();
    }
  }

  const retry = () => {
    quote.reload();
    pitches.reload();
  };

  return {
    quote: quote.state,
    pitches: pitches.state,
    retry,
    pay,
    paying,
    error,
    bookingHeld: bookingId !== null,
  };
}
