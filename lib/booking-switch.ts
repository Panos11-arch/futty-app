// Switching 5 v 5 / 6 v 6 after booking (P12; spec 13 "Switching after
// booking" and its decisions of 16 November). Everything shown comes from
// booking_detail's 'switch' (booking_switch_info on the server): this file
// only puts the server's amounts into words and the server's refusals into
// plain language. It never adds, divides or works out an amount, and sends
// only the booking id and the players per side the server offered.
import type { SwitchInfo } from '@/lib/booking-search';
import { describeBookingErrorMessage, SERVER_ERROR_FALLBACK } from '@/lib/booking-errors';
import { formatEuros } from '@/lib/money/format';
import { hoursText, ruleText } from '@/lib/rules';
import { supabase } from '@/lib/supabase';

/** The side the booking can switch to, when the caller may switch it now. */
export function switchTarget(info: SwitchInfo | null | undefined, isBooker: boolean): 5 | 6 | null {
  if (!isBooker || !info || !info.can_switch || info.switched) return null;
  return info.to_players_per_side;
}

export function switchButtonLabel(to: 5 | 6): string {
  return `Switch to ${to} v ${to}`;
}

/** "Sat 21 Nov at 12:00", in Cyprus. */
export function cyprusDayTimeLabel(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Nicosia' });
  const time = date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Nicosia' });
  return `${day} at ${time}`;
}

/** Under the button: once only, until the server's cutoff. */
export function switchClosesLabel(info: SwitchInfo): string {
  return info.closes_at
    ? `You can switch once, until ${cyprusDayTimeLabel(info.closes_at)}.`
    : 'You can switch once.';
}

/** What the switch means for the players' money, with the server's amounts.
 *  callerInGame: the booker holds a spot, so their own amount (which carries
 *  the leftover cents) is worth saying when it differs. */
export function switchMoneyWords(info: SwitchInfo, venueName: string, callerInGame: boolean): string[] {
  const to = info.to_players_per_side;
  const words: string[] = [];
  if (to) words.push(`The booking becomes ${to} v ${to}.`);
  const each = formatEuros(info.each_cents ?? 0);
  const own = info.booker_cents !== undefined && info.booker_cents !== info.each_cents && callerInGame
    ? formatEuros(info.booker_cents)
    : null;
  if (info.money === 'credit') {
    words.push(
      `Each player who has paid gets ${each} back as credit at ${venueName}. A payment that's still held gets it when it's taken.`,
    );
    words.push(`A player paying cash who hasn't paid yet pays ${each} less at the venue instead.`);
    if (own) words.push(`You get ${own}.`);
  } else if (info.money === 'extra') {
    words.push(
      `Each player who has paid, in the app or in cash at the venue, pays ${each} more after the match, charged to their card with the top-ups.`,
    );
    words.push(`A player paying cash who hasn't paid yet pays ${each} more at the venue instead.`);
    if (own) words.push(`You pay ${own} more.`);
  } else {
    words.push('You paid for everyone, so no money changes.');
  }
  words.push('Every player is told.');
  return words;
}

/** switch_players_per_side's refusals (switch_refusal on the server) in
 *  plain words. */
export function switchErrorMessage(code: string): string {
  switch (code) {
    case 'not_booker':
      return 'Only the booker can switch this booking.';
    case 'switch_closed':
      return ruleText(
        (r) => `Switching closes ${hoursText(r.refund_cutoff_hours)} before kickoff, so this booking can't be switched now.`,
        "Kickoff is too close, so this booking can't be switched now.",
      );
    case 'already_switched':
      return 'This booking has already been switched. A booking can only be switched once.';
    case 'already_that_format':
      return 'The booking is already that format.';
    case 'too_many_players':
      return "More than 10 players have joined, so it can't go back to 5 v 5.";
    case 'six_a_side_not_allowed':
      return "This venue doesn't allow 6 v 6 on this pitch.";
    case 'not_switchable':
    case 'invalid_players_per_side':
      return "This booking can't be switched.";
    case 'booking_cancelled':
      return 'This booking has been cancelled.';
    case 'booking_not_confirmed':
      return 'Finish paying for the booking first, then you can switch it.';
    default: {
      const words = describeBookingErrorMessage(code);
      return words === SERVER_ERROR_FALLBACK ? "The booking couldn't be switched. Try again." : words;
    }
  }
}

/** The second tap: resolves to null once switched, or the message to show. */
export async function switchPlayersPerSide(bookingId: string, to: 5 | 6): Promise<string | null> {
  const { error } = await supabase.rpc('switch_players_per_side', { p_booking_id: bookingId, p_players_per_side: to });
  return error ? switchErrorMessage(error.message) : null;
}
