// Gipedo Pano on the booking screens (P8; spec 13 "Gipedo Pano", spec 15
// section 5). Everything comes from booking_quote and booking_detail: this
// file puts the server's fields into words and sends the captain's two
// actions (pull out, and the no-opponent choice). It never works out an
// amount. Spec 15's words: money is "held" and "taken", never "authorized",
// "captured" or "void".
import { describeBookingErrorMessage } from '@/lib/booking-errors';
import type { GipedoDetail, RosterState } from '@/lib/booking-search';
import { formatEuros } from '@/lib/money/format';
import { supabase } from '@/lib/supabase';

/** Checkout: what choosing Gipedo Pano means, with the server's hold. */
export function gipedoModeSentence(holdCents: number): string {
  return (
    `Gipedo Pano: the losing team pays for the pitch. Your card is held for ${formatEuros(holdCents)} and nothing is taken now. ` +
    "After the match the loser's hold is taken, a draw, a dispute or no result is split 50/50, and the winner's hold is released. " +
    'Another team can take it on until 24 hours before kickoff.'
  );
}

/** Where the game stands. */
export function gipedoStatusLine(g: GipedoDetail): string {
  const them = g.opponent.team?.name ?? 'The other team';
  if (g.opponent.state === 'held') return `${g.team?.name ?? 'Your team'} v ${them}. Both cards are held; the losing team pays the pitch.`;
  if (g.opponent.state === 'offered') return `${them} offered to play. Waiting for their card to be held.`;
  return 'Waiting for an opponent. Teams can take it on until 24 hours before kickoff.';
}

/** What pulling out does, from the server's pull-out quote (its amount and
 *  its fee per player). A forfeit settles at once (spec 13, decision 17). */
export function pullOutWords(g: GipedoDetail): string[] {
  const pull = g.pull_out;
  if (!pull) return [];
  if (pull.kind === 'free') return ['The booking is cancelled and your hold is released. Nothing is taken.'];
  if (pull.kind === 'forfeit') {
    return [
      `Kickoff is less than 6 hours away, so your team counts as the losing team: ${formatEuros(pull.cents)} is taken from your hold straight away and the other team's hold is released.`,
    ];
  }
  const perPlayer = pull.fee_per_player_cents === null ? '' : ` (${formatEuros(pull.fee_per_player_cents)} per player)`;
  return [
    `${formatEuros(pull.cents)} is taken from your hold${perPlayer} and the rest is released.`,
    g.my_side === 'a'
      ? "The booking is cancelled and the other team's hold is released."
      : 'The other team keeps the booking and can look for a new opponent.',
  ];
}

/** No opponent 24 hours before kickoff: the booking captain's choice. */
export function choiceWords(g: GipedoDetail): { message: string; playLabel: string; cancelLabel: string } | null {
  if (!g.choice_due || g.play_normal_cents === null) return null;
  return {
    message:
      'Nobody has taken on this game. Play it as a normal booking or cancel it free. ' +
      'If you don’t choose by 6 hours before kickoff, it is cancelled free.',
    playLabel: `Play as normal: ${formatEuros(g.play_normal_cents)}`,
    cancelLabel: 'Cancel free',
  };
}

/** What the caller's hold paid, once the server decided. */
export function settlementLine(g: GipedoDetail): string | null {
  const s = g.settlement;
  if (!s) return null;
  const amount = formatEuros(s.capture_cents);
  if (s.status === 'debt') return `Your hold had expired, so you owe ${amount}.`;
  if (s.reason === 'won' || s.capture_cents === 0) return 'Your team won. Your hold is released.';
  const taken = s.status === 'due' ? `${amount} is being taken from your hold.` : `${amount} was taken from your hold.`;
  return s.reason === 'split' ? `Split 50/50: ${taken}` : taken;
}

/** Roster words that differ in a Gipedo Pano game; null keeps the usual. */
export function rosterWordsForGipedo(state: RosterState): string | null {
  if (state === 'held') return 'Card held for Gipedo Pano';
  if (state === 'covered') return "Covered by the captains' holds";
  return null;
}

/** Pulls the caller's team out; resolves to an error message, or null. */
export async function pullOutOfGipedo(bookingId: string): Promise<string | null> {
  const { error } = await supabase.rpc('gipedo_pull_out', { p_booking_id: bookingId });
  return error ? describeBookingErrorMessage(error.message) : null;
}

/** The booking captain's choice with no opponent; an error message, or null. */
export async function chooseNoOpponent(bookingId: string, choice: 'play_normal' | 'cancel'): Promise<string | null> {
  const { error } = await supabase.rpc('gipedo_no_opponent_choice', { p_booking_id: bookingId, p_choice: choice });
  return error ? describeBookingErrorMessage(error.message) : null;
}
