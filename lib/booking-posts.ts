// Booking v2 posts in "Find a game" (B4; spec 13 "Publish game" and
// "Invites, after payment"). Every amount here is the server's
// (booking_post_quotes, opposition_post_detail); the app never works one out.
import { describeBookingErrorMessage } from '@/lib/booking-errors';
import type { AcceptedOpposition, OppositionInvite } from '@/lib/booking-opposition';
import { slotLabel } from '@/lib/booking-search';
import { formatEuros } from '@/lib/money/format';
import { supabase } from '@/lib/supabase';

/** One row of booking_post_quotes(): a Booking v2 post, priced for its side. */
export type BookingPostQuote = {
  post_id: string;
  kind: 'players' | 'opposition';
  side: 'a' | 'b' | null;
  /** The caller's to unpublish (its author, or that side's captain). */
  mine: boolean;
  /** Still joinable or acceptable: not full, unpublished, found, cancelled or closed. */
  open: boolean;
  /** Kickoff for players; 24 hours before kickoff for opposition. */
  closes_at: string;
  /** Players posts: what a joiner pays (0 when his side paid for everyone). */
  join_cents: number | null;
  join_pitch_cents: number | null;
  join_fee_cents: number | null;
  /** Opposition posts: side B's captain paying for everyone, or his own share paying for myself. */
  pay_all_cents: number | null;
  each_pays_cents: number | null;
  /** What he'd hold for side B's unpaid spots (his side's half). */
  guarantee_cents: number | null;
};

/** One row of my_publishable_bookings(): a game the caller captains. */
export type PublishableBooking = {
  booking_id: string;
  venue_name: string;
  booking_day: string;
  start_time: string;
  end_time: string;
  format: string;
  pitch_label: string | null;
  kind: 'whole' | 'half';
  side: 'a' | 'b' | null;
  open_spots: number;
  players_post_id: string | null;
  opposition_post_id: string | null;
  can_publish_players: boolean;
  can_publish_opposition: boolean;
};

export type PostAction = 'unpublish' | 'join' | 'accept' | 'view' | 'closed';

/** What a post card offers. Null: a post made before Booking v2 keeps its old card. */
export function postAction(kind: 'players' | 'opposition', quote: BookingPostQuote | null, joinedByMe: boolean): PostAction | null {
  if (!quote) return null;
  if (kind === 'players' && joinedByMe) return 'view';
  if (!quote.open) return 'closed';
  if (quote.mine) return 'unpublish';
  return kind === 'players' ? 'join' : 'accept';
}

/** A closed Booking v2 post leaves the list, unless the caller joined it. */
export function isPostShown(quote: BookingPostQuote | null, joinedByMe: boolean): boolean {
  return !quote || quote.open || joinedByMe;
}

/** "€4.80 each", or "Paid by the captain" when his side paid for everyone. */
export function joinPriceText(quote: BookingPostQuote): string | null {
  if (quote.join_cents === null) return null;
  return quote.join_cents === 0 ? 'Paid by the captain' : `${formatEuros(quote.join_cents)} each`;
}

/** Side B's price before accepting: "€22.75 for your side, or €4.80 each". */
export function sideBPriceText(quote: BookingPostQuote): string | null {
  if (quote.pay_all_cents === null || quote.each_pays_cents === null) return null;
  return `${formatEuros(quote.pay_all_cents)} for your side, or ${formatEuros(quote.each_pays_cents)} each`;
}

export type PublishGameRow = { title: string; subtitle: string; action: 'publish' | 'unpublish'; postId: string | null };

/** One of my games in the list's "Publish" section; null when there's nothing to publish or unpublish. */
export function publishGameRow(game: PublishableBooking, kind: 'players' | 'opposition'): PublishGameRow | null {
  const postId = kind === 'players' ? game.players_post_id : game.opposition_post_id;
  const canPublish = kind === 'players' ? game.can_publish_players : game.can_publish_opposition;
  if (!postId && !canPublish) return null;
  const parts = [slotLabel(game.booking_day, game.start_time, game.end_time), game.pitch_label];
  if (kind === 'players') parts.push(`${game.open_spots} open spot${game.open_spots === 1 ? '' : 's'}`);
  return {
    title: game.venue_name,
    subtitle: parts.filter(Boolean).join(' · '),
    action: postId ? 'unpublish' : 'publish',
    postId,
  };
}

// ---- Server calls -------------------------------------------------------

/** The most posts booking_post_quotes takes at once. */
export const BOOKING_POST_QUOTES_BATCH = 50;

function words(message: string | undefined): string {
  return describeBookingErrorMessage(message ?? 'Something went wrong.');
}

/** Each Booking v2 post's quote, by post id (older posts are missing). Null
 *  if any request fails, so no card shows a price that may be wrong. */
export async function getBookingPostQuotes(postIds: string[]): Promise<Map<string, BookingPostQuote> | null> {
  const batches: string[][] = [];
  for (let i = 0; i < postIds.length; i += BOOKING_POST_QUOTES_BATCH) {
    batches.push(postIds.slice(i, i + BOOKING_POST_QUOTES_BATCH));
  }
  const results = await Promise.all(batches.map((ids) => supabase.rpc('booking_post_quotes', { p_post_ids: ids })));
  const quotes = new Map<string, BookingPostQuote>();
  for (const { data, error } of results) {
    if (error || !Array.isArray(data)) return null;
    for (const row of data as BookingPostQuote[]) quotes.set(row.post_id, row);
  }
  return quotes;
}

export async function fetchPublishableBookings(): Promise<PublishableBooking[]> {
  const { data, error } = await supabase.rpc('my_publishable_bookings');
  if (error) throw new Error(words(error.message));
  return (data ?? []) as PublishableBooking[];
}

type OppositionPostRow = Omit<OppositionInvite, 'invite_id' | 'team_id'> & { post_id: string; open: boolean };

/** A public opposition post for side B's accept screen, in the invite's
 *  shape (its id is the post's). Found: the screen says "Opposition found". */
export async function fetchOppositionPost(postId: string): Promise<OppositionInvite> {
  const { data, error } = await supabase.rpc('opposition_post_detail', { p_post_id: postId });
  if (error) throw new Error(words(error.message));
  const row = ((data ?? []) as OppositionPostRow[])[0];
  if (!row || (!row.open && !row.found)) throw new Error('This game is no longer open.');
  const { post_id, open: _open, ...rest } = row;
  return { ...rest, invite_id: post_id, team_id: null };
}

/** The first captain to accept becomes side B's captain; the server returns
 *  his share to pay or hold within the payment window. */
export async function acceptOppositionPost(
  postId: string,
  mode: 'pay_all' | 'each_pays_responsible',
  losersPay = false,
): Promise<{ accepted: AcceptedOpposition } | { error: string }> {
  // B1d: a Losers pay game is accepted knowingly ("Accept Losers pay").
  const { data, error } = await supabase.rpc('accept_opposition_post', {
    p_post_id: postId,
    p_mode: mode,
    ...(losersPay ? { p_losers_pay: true } : {}),
  });
  if (error || !data) return { error: words(error?.message) };
  return { accepted: data as AcceptedOpposition };
}
