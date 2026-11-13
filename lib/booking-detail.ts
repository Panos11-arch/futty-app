// The booking detail screen (P5b; spec 15 section 5 "Booking detail", spec
// 13 "Booking screens" and "Cancellations and refunds"). Everything shown
// comes from booking_detail, cancellation_terms and cancellation_quote: this
// file only picks the server's fields and puts them into words. It never
// adds, divides or works out an amount; the only arithmetic is the time left
// until the server's cutoff.
import type { Status } from '@/components/ui/status-pill';
import type { CancellationLine, CancellationQuote, CancelResult, CancelScope } from '@/lib/booking-actions';
import { describeBookingErrorMessage } from '@/lib/booking-errors';
import { rosterName, slotLabel, type BookingDetail, type RosterEntry, type RosterState } from '@/lib/booking-search';
import {
  addBookingToCalendar,
  syncBookingInCalendar,
  type AddToCalendarResult,
  type CalendarBooking,
} from '@/lib/calendar';
import { formatEuros } from '@/lib/money/format';
import { supabase } from '@/lib/supabase';
import type { CancellationTerms } from '@/lib/venue-page';

/** A booking's detail, with the cancellation numbers the countdown uses. */
export type BookingDetailData = BookingDetail & { cancellation: CancellationTerms };

export async function fetchBookingDetail(bookingId: string): Promise<BookingDetailData> {
  const [detail, terms] = await Promise.all([
    supabase.rpc('booking_detail', { p_booking_id: bookingId }),
    supabase.rpc('cancellation_terms'),
  ]);
  const error = detail.error ?? terms.error;
  if (error) throw new Error(describeBookingErrorMessage(error.message));
  return { ...(detail.data as BookingDetail), cancellation: terms.data as CancellationTerms };
}

// ---- Roster -------------------------------------------------------------

const STATES: Record<RosterState, { pill: Status; words: string }> = {
  in_app: { pill: 'paid', words: 'Paid in the app' },
  cash: { pill: 'cash', words: 'Pays cash at the venue' },
  cash_paid: { pill: 'paid', words: 'Paid in cash at the venue' },
  unpaid: { pill: 'unpaid', words: 'Not paid yet' },
  covered: { pill: 'paid', words: 'The booker paid for this spot' },
};

export type RosterRow = { title: string; subtitle: string; pill: Status; amount: string | null };

/** A roster row. Amounts only for the booker, or on the caller's own row
 *  (spec 13): the server already leaves the others out, and this checks
 *  again so a mistake there can't show them. */
export function rosterRow(entry: RosterEntry, callerIsBooker: boolean): RosterRow {
  const state = STATES[entry.state];
  const mayShow = callerIsBooker || entry.is_me;
  let amount: string | null = null;
  if (mayShow && entry.state !== 'covered' && entry.amount_cents !== null) {
    amount = formatEuros(entry.amount_cents);
    if (entry.cash_cents) amount += ` + ${formatEuros(entry.cash_cents)} cash`;
  }
  return {
    title: rosterName(entry),
    subtitle: entry.is_booker ? `Booker · ${state.words}` : state.words,
    pill: state.pill,
    amount,
  };
}

// ---- The cancellation countdown ----------------------------------------

const MINUTE = 60_000;

function durationWords(ms: number): string {
  // Rounded up, so it never reads "0 min" while there's still time.
  const minutes = Math.ceil(ms / MINUTE);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const restMinutes = minutes % 60;
  if (hours < 24) return restMinutes ? `${hours} h ${restMinutes} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} d ${restHours} h` : `${days} d`;
}

/** The server's cutoff has been reached: time to ask it for the next one. */
export function cutoffPassed(next: BookingDetail['next_cutoff'], now: Date): boolean {
  return next !== null && Date.parse(next.at) <= now.getTime();
}

/** Share statuses whose money is held or taken: only these have anything to
 *  lose by cancelling later (pending is unpaid, covered was paid by the booker). */
const PAID_STATUSES = new Set(['authorized', 'paid']);

/** The countdown to the caller's next cancellation cutoff (spec 13,
 *  "Cancellations and refunds"), shown only to a player who has paid.
 *  Null when there's nothing to show, or once the cutoff has passed (the
 *  screen reloads for the next one).
 *    - in the free hour: everything back;
 *    - after it, until refunds stop: credit at the venue, minus the
 *      cancellation fee (for each player when the booker paid for everyone);
 *      a cash player has only the service fee at stake, which is kept either
 *      way, so there's no countdown;
 *    - once refunds have stopped: nothing back. */
export function countdownLabel(detail: BookingDetailData, now: Date): string | null {
  const { me, next_cutoff: next, venue } = detail;
  if (!me || !PAID_STATUSES.has(me.status)) return null;
  if (next === null) return 'Cancelling now gives no money back.';
  const left = Date.parse(next.at) - now.getTime();
  if (left <= 0) return null;
  const words = durationWords(left);
  // free_until is set while the free hour runs, even when it lasts until
  // refunds stop (the server then reports refunds_stop as the next cutoff).
  if (next.kind === 'free_hour_ends' || me.free_until !== null) return `Free cancellation ends in ${words}`;
  if (me.payment_method === 'cash') return null;
  const fee = formatEuros(detail.cancellation.fee_cents);
  if (detail.is_booker && detail.booking.payment_mode === 'pay_all') {
    return `Cancel in the next ${words} and you get credit at ${venue.name}, minus ${fee} for each player.`;
  }
  // Paid with credit only: a credit-paid share's free hour runs from when the
  // card was saved, which booking_detail doesn't say, so "up to".
  if (me.amount_cents === 0) {
    return `Cancel in the next ${words} and your credit at ${venue.name} comes back, minus up to ${fee}.`;
  }
  return `Cancel in the next ${words} and you get credit at ${venue.name}, minus ${fee}.`;
}

// ---- Paying a pending booking ------------------------------------------

/** "19:15", in Cyprus. */
export function cyprusTimeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Nicosia' });
}

/** The booker's deadline on a booking still waiting for payment (spec 13,
 *  "When money is held and taken" step 5), from the server's window. */
export function paymentDeadlineLabel(detail: BookingDetail): string | null {
  const ends = detail.booking.payment_window_ends_at;
  if (!detail.is_booker || detail.booking.status !== 'pending_payment' || !ends) return null;
  return `Pay by ${cyprusTimeLabel(ends)} or the booking is released.`;
}

// ---- What cancelling does ----------------------------------------------

/** Money that comes back from a release: what the server's line says it is. */
function releaseWords(own: CancellationLine, venueName: string): string {
  const back = `You get ${formatEuros(own.refund_cents)} back`;
  const cardHold = own.paid_cents > 0 && own.stripe_intent_id !== null;
  const credit = own.credit_used_cents > 0;
  if (cardHold && credit) {
    return `${back}: the hold on your card is released and ${formatEuros(own.credit_used_cents)} goes back to your credit at ${venueName}.`;
  }
  if (cardHold) return `${back}. The hold on your card is released.`;
  if (credit) return `${back}. It goes back to your credit at ${venueName}.`;
  return `${back}.`;
}

function ownLineWords(own: CancellationLine, venueName: string): string {
  switch (own.action) {
    case 'release':
      return own.value_cents > 0 ? releaseWords(own, venueName) : "You haven't paid for this spot, so nothing is charged.";
    case 'keep_and_credit':
      return `${formatEuros(own.kept_cents)} is kept. ${formatEuros(own.credit_cents)} becomes credit at ${venueName}.`;
    case 'keep':
      return `Nothing comes back. ${formatEuros(own.kept_cents)} is kept.`;
    case 'refund_choice':
      return `You get ${formatEuros(own.refund_cents)} back, by card refund or as credit at ${venueName}.`;
    default:
      return "You haven't paid for this spot, so nothing is charged.";
  }
}

function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** The quote in plain words, line by line, with the server's amounts. */
export function describeQuote(quote: CancellationQuote, venueName: string): string[] {
  const shares = quote.lines.filter((l) => l.share_id !== null);
  // my_spot: only the caller's line. whole_team: the caller is the booker.
  const own = quote.scope === 'my_spot' ? shares[0] : shares.find((l) => l.is_booker);
  const others = quote.scope === 'my_spot' ? [] : shares.filter((l) => l !== own);

  const words = [
    quote.cancels_booking
      ? 'The booking is cancelled and the pitch is released.'
      : 'Your spot opens up and the other players are told.',
  ];
  if (own) words.push(ownLineWords(own, venueName));

  const back = others.filter((l) => (l.action === 'release' || l.action === 'refund_choice') && l.refund_cents > 0);
  if (back.length > 0) {
    let sentence = `${plural(back.length, 'other player gets', 'other players get')} their money back in full.`;
    if (back.some((l) => l.action === 'refund_choice')) {
      sentence += ' A player whose payment was already taken chooses a card refund or credit within 48 hours.';
    }
    words.push(sentence);
  }
  const kept = others.filter((l) => l.action === 'keep' || l.action === 'keep_and_credit');
  if (kept.length > 0) words.push(`${plural(kept.length, 'other player gets', 'other players get')} nothing back.`);

  // Before the hold is placed the guarantee is only a saved card: nothing to say.
  if (quote.guarantee_hold_placed && quote.lines.some((l) => l.guarantee_id !== null && l.action === 'release')) {
    words.push('Your guarantee hold is released.');
  }
  if (quote.booker_fee) {
    const { amount_cents: amount, players } = quote.booker_fee;
    words.push(
      `Cancelling the whole team costs ${formatEuros(amount)} (${plural(players, 'player', 'players')} whose payment was taken). ` +
        "It is charged to your card when you confirm. If the charge doesn't go through, the booking is still cancelled.",
    );
  }
  return words;
}

/** What the screen says once the cancellation went through. A failed
 *  whole-team charge (spec 13, decided 10 November): retried until the
 *  original kickoff, then whatever is unpaid is a debt to Futty, which
 *  blocks booking everywhere until it's paid. */
export function cancelledMessage(scope: CancelScope, result: CancelResult): string {
  const done = scope === 'my_spot' ? 'Your spot is cancelled.' : 'The booking is cancelled.';
  const fee = result.fee;
  if (!fee) return done;
  const amount = formatEuros(fee.amountCents);
  if (fee.status === 'paid') return `${done} ${amount} was charged to your card.`;
  if (fee.status === 'processing') return `${done} The ${amount} charge is being processed.`;
  return (
    `${done} The ${amount} charge didn't go through. We'll try your card again until kickoff. ` +
    "Anything still unpaid then becomes a debt to Futty, and you can't book or join a game until it's paid."
  );
}

// ---- Cancelling: quote first, confirm second ---------------------------

export type DetailCancelScope = 'my_spot' | 'whole_team';
export type QuoteResult = { quote: CancellationQuote } | { error: string };
export type ConfirmResult =
  | { status: 'cancelled'; notice?: string }
  | { status: 'changed'; quote: CancellationQuote }
  | { status: 'error'; message: string };

export type CancelDeps = {
  /** cancel-booking. */
  cancel: (
    bookingId: string,
    confirmed?: { scope: CancelScope; quote: string },
  ) => Promise<{ data: CancelResult | null; error: unknown }>;
  /** cancellation_quote, put into a QuoteResult. */
  quote: (scope: DetailCancelScope) => Promise<QuoteResult>;
  /** The error code an Edge Function sent back. */
  errorCode: (error: unknown) => Promise<string>;
  /** Stripe's 3-D Secure step. */
  handleNextAction: (clientSecret: string) => Promise<{ error?: unknown }>;
  removeFromCalendar: (bookingId: string) => Promise<unknown>;
};

/** The booker's whole-team charge may need 3-D Secure; the booking is
 *  cancelled either way (spec 13). */
async function finishFee(result: CancelResult, handleNextAction: CancelDeps['handleNextAction']): Promise<CancelResult> {
  const fee = result.fee;
  if (fee?.status !== 'requires_action' || !fee.clientSecret) return result;
  const { error } = await handleNextAction(fee.clientSecret);
  return { ...result, fee: { ...fee, status: error ? 'failed' : 'processing' } };
}

/** The second tap: cancels exactly the quote shown (null for a booking made
 *  before P4a). If what would happen has changed, the new quote comes back
 *  to be shown and confirmed again. */
export async function confirmCancellation(
  bookingId: string,
  { scope, quote }: { scope: DetailCancelScope; quote: string | null },
  deps: CancelDeps,
): Promise<ConfirmResult> {
  const { data, error } = await deps.cancel(bookingId, quote ? { scope, quote } : undefined);
  if (error || !data) {
    const code = error ? await deps.errorCode(error) : 'Something went wrong.';
    if (code === 'quote_changed') {
      const again = await deps.quote(scope);
      return 'quote' in again ? { status: 'changed', quote: again.quote } : { status: 'error', message: again.error };
    }
    return { status: 'error', message: describeBookingErrorMessage(code) };
  }
  const result = await finishFee(data, deps.handleNextAction);
  // Left the game: take it off the calendar. A cancelled booking is removed
  // by the sync after the screen reloads.
  if (scope === 'my_spot') {
    try {
      await deps.removeFromCalendar(bookingId);
    } catch {
      // The calendar is a convenience; the cancellation stands.
    }
  }
  return { status: 'cancelled', notice: cancelledMessage(scope, result) };
}

// ---- Calendar and share ------------------------------------------------

/** What lib/calendar needs, all from booking_detail. booking_detail has no
 *  pitch name, so there is none. */
export function calendarBookingFrom(detail: BookingDetail): CalendarBooking {
  const { booking, venue } = detail;
  return {
    id: booking.id,
    status: booking.status,
    venueName: venue.name,
    venueAddress: venue.address,
    pitch: null,
    format: booking.format,
    bookingDay: booking.booking_day,
    startTime: booking.start_time,
    endTime: booking.end_time,
    players: detail.roster.map((r) => r.name ?? r.username ?? 'Player'),
  };
}

/** The Add to calendar button: the only call that may ask for permission. */
export function addDetailToCalendar(detail: BookingDetail) {
  return addBookingToCalendar(calendarBookingFrom(detail));
}

/** On every load: updates the event, or removes it once cancelled. */
export function syncDetailInCalendar(detail: BookingDetail) {
  return syncBookingInCalendar(calendarBookingFrom(detail));
}

const CALENDAR_MESSAGES: Record<AddToCalendarResult, string> = {
  added: 'Added to your calendar.',
  updated: 'Your calendar event is up to date.',
  permission_denied: 'Allow calendar access in Settings to add this game.',
  no_calendar: 'There is no calendar on this phone that can take new events.',
  booking_cancelled: 'This booking is cancelled.',
  unavailable: "Add to calendar isn't available on this device.",
};

export function calendarMessage(result: AddToCalendarResult): string {
  return CALENDAR_MESSAGES[result];
}

/** Text-only share: the venue, day, time and address. No link. */
export function shareText(detail: BookingDetail): string {
  const { booking, venue } = detail;
  const where = [venue.address, venue.city].filter(Boolean).join(', ');
  const when = slotLabel(booking.booking_day, booking.start_time, booking.end_time);
  return `Football at ${venue.name}, ${when}.${where ? ` ${where}` : ''}`;
}
