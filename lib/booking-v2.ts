// Booking v2 checkout (B2; spec 13 "Booking modes (Booking v2)", "How each
// side pays", worked examples 1-5 and 11). Every amount is integer cents
// from the server: booking_quote_v2 for the kinds and ways to pay,
// venue_free_pitches for the pitches, and (decided by Panos for B2) the
// older booking_quote for venue credit, which booking_quote_v2 doesn't
// return yet. This file only picks which of the server's fields to show; it
// never adds, divides or works out a price, fee, hold or total.
import type { PriceLine } from '@/components/ui/price-breakdown';
import type { PaymentMode } from '@/lib/booking-actions';
import { describeBookingErrorMessage } from '@/lib/booking-errors';
import { fetchBookingQuote, type CreditSplit, type Slot } from '@/lib/booking-search';
import { formatEuros } from '@/lib/money/format';
import { hoursText, minutesText, ruleText } from '@/lib/rules';
import { supabase } from '@/lib/supabase';
import type { CancellationTerms } from '@/lib/venue-page';

// ---- Server responses -------------------------------------------------

type Amount = { pitch_cents: number; fee_cents: number; card_cents: number };

/** "Pay for myself": the caller's own share, a player's share and the
 *  guarantee held for unpaid spots (the pitch on a whole pitch, the side's
 *  half on a half pitch). */
type ForMyself = Amount & { player_cents: number; guarantee_cents: number };

/** booking_quote_v2(): both kinds and each way to pay, priced for the caller. */
export type BookingQuoteV2 = {
  venue_id: string;
  day: string;
  start_time: string;
  end_time: string;
  format: string;
  players_per_side: number;
  players: number;
  pitch_cents: number;
  is_premium: boolean;
  kickoff_at: string;
  refunds_stop_at: string;
  non_refundable: boolean;
  whole: {
    pay_all: Amount;
    pay_for_myself: ForMyself;
    cash: { card_cents: number; cash_cents: number; guarantee_cents: number };
  };
  half: {
    /** Half pitches are switched on by Futty on the server. */
    available: boolean;
    side_pitch_cents: number;
    pay_all: Amount;
    pay_for_myself: ForMyself;
  };
  in_debt: boolean;
  cash_allowed: boolean;
  cancellation: CancellationTerms;
};

/** One row of venue_free_pitches(): a free pitch or one of the venue's own
 *  combinations, by its venue name. surface and indoor are null when a
 *  combination's pitches differ. */
export type FreePitch = {
  pitch_ids: string[];
  label: string;
  kind: 'pitch' | 'combination';
  surface: string | null;
  indoor: boolean | null;
  price_cents: number;
};

/** Venue credit for "pay for myself" on a whole pitch, from booking_quote:
 *  what's left to pay by card with it (null when there's no credit). */
export type CheckoutCredit = { available_cents: number; expires_at: string | null; with_credit: CreditSplit | null };

export type CheckoutData = { quote: BookingQuoteV2; credit: CheckoutCredit | null };

// ---- The choices ------------------------------------------------------

export type BookingKind = 'whole' | 'half';
export type WayToPay = 'pay_all' | 'pay_for_myself';

export type CheckoutChoiceV2 = { kind: BookingKind; way: WayToPay | null; cash: boolean; credit: boolean };

/** What book_slot is told. "Just my spot" is gone for Booking v2, and Losers
 *  pay (B1d) isn't offered yet. */
export function modeForWay(way: WayToPay): PaymentMode {
  return way === 'pay_all' ? 'pay_all' : 'each_pays_responsible';
}

export const KIND_LINES: Record<BookingKind, string> = {
  whole: 'You bring both teams.',
  half: 'Opponents pay half.',
};

export function wayLine(kind: BookingKind, way: WayToPay): string {
  if (way === 'pay_for_myself') return 'You pay your share. You cover unpaid spots.';
  return kind === 'whole' ? 'You pay the whole pitch now.' : "You pay your team's half now.";
}

/** Each way's price on its card: one payment for everyone, or what each
 *  player pays. */
export function wayPriceLabel(quote: BookingQuoteV2, kind: BookingKind, way: WayToPay): string {
  const prices = quote[kind];
  return way === 'pay_all' ? formatEuros(prices.pay_all.card_cents) : `${formatEuros(prices.pay_for_myself.player_cents)} each`;
}

/** Cash is whole pitch only, paying for myself, where the server allows it. */
export function cashOffered(quote: BookingQuoteV2, choice: Pick<CheckoutChoiceV2, 'kind' | 'way'>): boolean {
  return choice.kind === 'whole' && choice.way === 'pay_for_myself' && quote.cash_allowed;
}

/** Credit is offered where the server priced it: paying for myself on a whole pitch. */
export function creditOffered(credit: CheckoutCredit | null, choice: Pick<CheckoutChoiceV2, 'kind' | 'way'>): boolean {
  return choice.kind === 'whole' && choice.way === 'pay_for_myself' && !!credit?.with_credit && credit.available_cents > 0;
}

export type CheckoutAmountsV2 = { lines: PriceLine[]; totalCents: number; cashCents: number | null };

/** The server's amounts for the choice, as they are. Credit shows as a minus
 *  line; nothing is summed here. */
export function checkoutAmountsV2(data: CheckoutData, choice: CheckoutChoiceV2): CheckoutAmountsV2 | null {
  const { quote } = data;
  if (!choice.way) return null;
  if (choice.way === 'pay_all') {
    const all = quote[choice.kind].pay_all;
    return {
      lines: [
        { label: choice.kind === 'whole' ? 'Pitch' : "Your team's half", cents: all.pitch_cents },
        { label: 'Service fee', cents: all.fee_cents },
      ],
      totalCents: all.card_cents,
      cashCents: null,
    };
  }
  const mine = quote[choice.kind].pay_for_myself;
  if (choice.credit && creditOffered(data.credit, choice)) {
    const split = data.credit!.with_credit!;
    return {
      lines: [
        { label: 'Your part of the pitch', cents: mine.pitch_cents },
        { label: 'Your credit', cents: -split.credit_cents },
        { label: 'Service fee', cents: split.fee_cents },
      ],
      totalCents: split.card_cents,
      cashCents: null,
    };
  }
  if (choice.cash && choice.kind === 'whole') {
    const cash = quote.whole.cash;
    return { lines: [{ label: 'Service fee', cents: cash.card_cents }], totalCents: cash.card_cents, cashCents: cash.cash_cents };
  }
  return {
    lines: [
      { label: 'Your part of the pitch', cents: mine.pitch_cents },
      { label: 'Service fee', cents: mine.fee_cents },
    ],
    totalCents: mine.card_cents,
    cashCents: null,
  };
}

/** The guarantee held for unpaid spots: paying for myself only. */
export function guaranteeCents(quote: BookingQuoteV2, choice: Pick<CheckoutChoiceV2, 'kind' | 'way' | 'cash'>): number | null {
  if (choice.way !== 'pay_for_myself') return null;
  if (choice.kind === 'whole' && choice.cash) return quote.whole.cash.guarantee_cents;
  return quote[choice.kind].pay_for_myself.guarantee_cents;
}

/** Spec 13: "We hold €X on your card for unpaid spots, taken 2 hours after
 *  the game." The hours are the collection rule (app_rules). */
export function guaranteeLine(cents: number): string {
  const amount = formatEuros(cents);
  return ruleText(
    (r) => `We hold ${amount} on your card for unpaid spots, taken ${hoursText(r.collection_delay_hours)} after the game.`,
    `We hold ${amount} on your card for unpaid spots, taken after the game.`,
  );
}

/** The cancellation rule in one line, from the server's numbers; "Rules"
 *  shows all three (checkoutCancellationLines). */
export function checkoutCancellationLine(terms: CancellationTerms): string {
  return `Free cancellation for ${minutesText(terms.free_minutes)} after paying, until ${hoursText(terms.refund_cutoff_hours)} before kickoff.`;
}

/** "Outdoor · Artificial grass": what the server knows of the pitch. */
export function pitchDetails(pitch: Pick<FreePitch, 'indoor' | 'surface'>): string {
  const where = pitch.indoor === true ? 'Indoor' : pitch.indoor === false ? 'Outdoor' : null;
  return [where, pitch.surface].filter(Boolean).join(' · ');
}

// ---- Server calls -------------------------------------------------------

function fail(message: string): never {
  throw new Error(describeBookingErrorMessage(message));
}

function slotArgs(slot: Slot) {
  return {
    p_venue_id: slot.venueId,
    p_day: slot.day,
    p_start: slot.start,
    p_end: slot.end,
    p_format: slot.format,
    p_players_per_side: slot.playersPerSide,
  };
}

/** The free pitches and combinations for the slot, in the server's order. */
export async function fetchFreePitches(slot: Slot): Promise<FreePitch[]> {
  const { data, error } = await supabase.rpc('venue_free_pitches', slotArgs(slot));
  if (error) fail(error.message);
  return (data ?? []) as FreePitch[];
}

/** booking_quote_v2, with the caller's venue credit from booking_quote. The
 *  credit is extra: if that quote can't be had, credit just isn't offered. */
export async function fetchCheckoutData(slot: Slot): Promise<CheckoutData> {
  const [v2, old] = await Promise.all([
    supabase.rpc('booking_quote_v2', slotArgs(slot)),
    fetchBookingQuote(slot).catch(() => null),
  ]);
  if (v2.error) fail(v2.error.message);
  const credit =
    old && old.credit.available_cents > 0
      ? { available_cents: old.credit.available_cents, expires_at: old.credit.expires_at, with_credit: old.each_pays.mine.with_credit }
      : null;
  return { quote: v2.data as BookingQuoteV2, credit };
}
