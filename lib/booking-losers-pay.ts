// Leaving or pulling out of a Losers pay game (spec 13 "Losers pay (Gipedo
// Pano in Booking v2)", "Pulling out", decided 23 and 24 November). What it
// takes is the server's (losers_pay_leave_quote, losers_pay_pull_out_quote);
// the app sends only the booking id and shows the amounts it gets back.
import { describeBookingErrorMessage } from '@/lib/booking-errors';
import { formatEuros } from '@/lib/money/format';
import { hoursText, ruleText } from '@/lib/rules';
import { supabase } from '@/lib/supabase';

export type LosersPayAction = 'leave' | 'pull_out';

/** losers_pay_leave_quote: a player (not a captain) leaving. */
export type LeaveQuote = {
  booking_id: string;
  /** False when nothing is held for him (his side paid for everyone, or he never held). */
  held: boolean;
  /** His normal share's window, as today: free, then €1 kept, then nothing back. */
  window: 'free' | 'middle' | 'late' | null;
  held_cents: number;
  capture_cents: number;
  credit_cents: number;
  released_cents: number;
  venue_name?: string | null;
};

/** losers_pay_pull_out_quote: a captain pulling his side out. */
export type PullOutQuote = {
  booking_id: string;
  /** fee: €1 per player; lost: as the losing side; alone: €1 per player and
   *  the booking cancelled; cancel_free: no opponent once the 24-hour choice is open. */
  kind: 'fee' | 'lost' | 'alone' | 'cancel_free';
  side: 'a' | 'b';
  payment_mode: 'pay_all' | 'each_pays_responsible';
  players: number;
  fee_per_player_cents: number;
  held_cents: number;
  capture_cents: number;
  released_cents: number;
  cancels_booking: boolean;
  cutoff_at: string;
};

export type LosersPayQuote = LeaveQuote | PullOutQuote;

function words(message: string | undefined): string {
  return describeBookingErrorMessage(message ?? 'Something went wrong.');
}

export async function fetchLeaveQuote(bookingId: string): Promise<LeaveQuote> {
  const { data, error } = await supabase.rpc('losers_pay_leave_quote', { p_booking_id: bookingId });
  if (error || !data) throw new Error(words(error?.message));
  return data as LeaveQuote;
}

export async function fetchPullOutQuote(bookingId: string): Promise<PullOutQuote> {
  const { data, error } = await supabase.rpc('losers_pay_pull_out_quote', { p_booking_id: bookingId });
  if (error || !data) throw new Error(words(error?.message));
  return data as PullOutQuote;
}

export function fetchQuote(action: LosersPayAction, bookingId: string): Promise<LosersPayQuote> {
  return action === 'leave' ? fetchLeaveQuote(bookingId) : fetchPullOutQuote(bookingId);
}

/** Leaves or pulls out. Error words, or null once done. */
export async function confirmLosersPay(action: LosersPayAction, bookingId: string): Promise<string | null> {
  const fn = action === 'leave' ? 'losers_pay_leave' : 'losers_pay_pull_out';
  const { error } = await supabase.rpc(fn, { p_booking_id: bookingId });
  return error ? words(error.message) : null;
}

/** The money a quote moves: if it changed since it was shown, the player checks again. */
export function sameMoney(a: LosersPayQuote, b: LosersPayQuote): boolean {
  const kind = (q: LosersPayQuote) => ('kind' in q ? q.kind : q.window);
  return a.capture_cents === b.capture_cents && a.released_cents === b.released_cents && kind(a) === kind(b);
}

// ---- Words ----------------------------------------------------------------

export function actionTitle(action: LosersPayAction): string {
  return action === 'leave' ? 'Leave this game' : 'Pull your team out';
}

export function confirmLabel(action: LosersPayAction, quote: LosersPayQuote | null): string {
  if (action === 'leave') return 'Confirm: leave';
  return quote && 'kind' in quote && quote.kind === 'cancel_free' ? 'Confirm: cancel free' : 'Confirm: pull out';
}

export function keepLabel(action: LosersPayAction): string {
  return action === 'leave' ? 'Keep my spot' : 'Keep my team in';
}

const cutoffWords = () =>
  ruleText((r) => `less than ${hoursText(r.refund_cutoff_hours)} before kickoff`, 'this close to kickoff');

/** What leaving does to his money, line by line. */
export function leaveLines(q: LeaveQuote): string[] {
  if (!q.held) return ['Nothing is held on your card for this game, so nothing is taken. Your spot opens for someone else.'];
  const held = formatEuros(q.held_cents);
  const released = formatEuros(q.released_cents);
  if (q.window === 'free' || q.capture_cents === 0) return [`Your ${held} hold is released in full.`];
  const taken = `${formatEuros(q.capture_cents)} is taken from your ${held} hold`;
  if (q.credit_cents > 0) {
    const kept = formatEuros(q.capture_cents - q.credit_cents);
    return [
      `${taken}: ${kept} is kept and ${formatEuros(q.credit_cents)} comes back as credit${q.venue_name ? ` at ${q.venue_name}` : ''}.`,
      `The other ${released} is released.`,
    ];
  }
  return [`${taken} and nothing comes back, as it's ${cutoffWords()}.`, `The other ${released} is released.`];
}

/** What pulling the side out does, line by line. */
export function pullOutLines(q: PullOutQuote): string[] {
  const taken = formatEuros(q.capture_cents);
  const released = formatEuros(q.released_cents);
  if (q.kind === 'cancel_free') {
    return ["You have no opponent, so the game is cancelled free: everyone's money is given back."];
  }
  if (q.kind === 'lost') {
    return [
      `It's ${cutoffWords()}, so your team pays as the losing side: ${taken} is taken from your team's holds.`,
      "The other team's holds are released and their game goes ahead.",
    ];
  }
  const fee = formatEuros(q.fee_per_player_cents);
  const lines = [
    q.payment_mode === 'pay_all'
      ? `${taken} (${fee} × ${q.players} players) is taken from your hold.`
      : `${fee} is taken from each player's hold that's placed: ${taken} in all.`,
    `The rest (${released}) is released.`,
  ];
  lines.push(q.cancels_booking ? 'The game is cancelled.' : 'The other team keeps the slot and looks for a new opponent.');
  return lines;
}

export function quoteLines(q: LosersPayQuote): string[] {
  return 'kind' in q ? pullOutLines(q) : leaveLines(q);
}

export function doneMessage(action: LosersPayAction, quote: LosersPayQuote | null): string {
  if (action === 'leave') return "You've left the game.";
  if (quote && 'kind' in quote && quote.cancels_booking) return 'Your game is cancelled.';
  return 'Your team is out of the game.';
}
