// The booking detail screen (P5b; spec 15 section 5 "Booking detail", spec
// 13 "Booking screens" and "Cancellations and refunds"). Everything shown
// comes from booking_detail and cancellation_quote: this file only picks the
// server's fields and puts them into words. It never adds, divides or works
// out an amount; the only arithmetic is the time left until the server's
// cutoff.
import type { Status } from '@/components/ui/status-pill';
import type { CancellationLine, CancellationQuote, CancelResult, CancelScope } from '@/lib/booking-actions';
import { describeBookingErrorMessage } from '@/lib/booking-errors';
import { slotLabel, type BookingDetail, type NextCutoff, type RosterEntry, type RosterState } from '@/lib/booking-search';
import {
  addBookingToCalendar,
  syncBookingInCalendar,
  type AddToCalendarResult,
  type CalendarBooking,
} from '@/lib/calendar';
import { formatEuros } from '@/lib/money/format';
import { supabase } from '@/lib/supabase';

export async function fetchBookingDetail(bookingId: string): Promise<BookingDetail> {
  const { data, error } = await supabase.rpc('booking_detail', { p_booking_id: bookingId });
  if (error) throw new Error(describeBookingErrorMessage(error.message));
  return data as BookingDetail;
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
    title: entry.is_me ? 'You' : (entry.name ?? entry.username ?? 'Player'),
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
export function cutoffPassed(next: NextCutoff, now: Date): boolean {
  return next !== null && Date.parse(next.at) <= now.getTime();
}

/** "Free cancellation ends in 42 min", "Refunds stop in 1 d 4 h". Null
 *  once the cutoff has passed (the screen reloads for the next one). */
export function cutoffLabel(next: NextCutoff, now: Date): string | null {
  if (next === null) return 'Refunds have stopped for this game';
  const left = Date.parse(next.at) - now.getTime();
  if (left <= 0) return null;
  const words = durationWords(left);
  return next.kind === 'free_hour_ends' ? `Free cancellation ends in ${words}` : `Refunds stop in ${words}`;
}

// ---- What cancelling does ----------------------------------------------

function ownLineWords(own: CancellationLine, venueName: string): string {
  switch (own.action) {
    case 'release':
      return own.value_cents > 0
        ? `You get ${formatEuros(own.refund_cents)} back. The hold on your card is released.`
        : "You haven't paid for this spot, so nothing is charged.";
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

function players(n: number) {
  return n === 1 ? '1 other player' : `${n} other players`;
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
    let sentence = `${players(back.length)} get${back.length === 1 ? 's' : ''} their money back in full.`;
    if (back.some((l) => l.action === 'refund_choice')) {
      sentence += ' A player whose payment was already taken chooses a card refund or credit within 48 hours.';
    }
    words.push(sentence);
  }
  const kept = others.filter((l) => l.action === 'keep' || l.action === 'keep_and_credit');
  if (kept.length > 0) words.push(`${players(kept.length)} get${kept.length === 1 ? 's' : ''} nothing back.`);

  if (quote.lines.some((l) => l.guarantee_id !== null)) words.push('Your guarantee hold is released.');
  if (quote.booker_fee) {
    words.push(
      `Cancelling the whole team costs ${formatEuros(quote.booker_fee.amount_cents)} (${quote.booker_fee.players} players whose payment was taken). It is charged to your card when you confirm.`,
    );
  }
  return words;
}

/** What the screen says once the cancellation went through. */
export function cancelledMessage(scope: CancelScope, result: CancelResult): string {
  const done = scope === 'my_spot' ? 'Your spot is cancelled.' : 'The booking is cancelled.';
  const fee = result.fee;
  if (!fee) return done;
  const amount = formatEuros(fee.amountCents);
  if (fee.status === 'paid') return `${done} ${amount} was charged to your card.`;
  if (fee.status === 'processing') return `${done} The ${amount} charge is being processed.`;
  return `${done} The ${amount} charge didn't go through; we'll try again and let you know.`;
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
