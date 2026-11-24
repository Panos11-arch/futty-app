// Booking v2 after paying (B3; spec 13 "Two kinds of booking", "Invites,
// after payment", "Publish game"): the sides, inviting the opposition, side
// B's acceptance, the no-opponent choice and publishing. Every amount is the
// server's (booking_detail's 'v2', my_opposition_invites,
// my_no_opponent_choices, pay-other-half); the app sends only ids and
// choices.
import { describeBookingErrorMessage } from '@/lib/booking-errors';
import type { PaymentSheet } from '@/lib/booking-checkout';
import { describeFunctionError } from '@/lib/edge-functions';
import { formatEuros } from '@/lib/money/format';
import { supabase } from '@/lib/supabase';
import { walletPayOptions } from '@/lib/wallet-pay';

// ---- Server responses -------------------------------------------------

export type SideLetter = 'a' | 'b';

export type V2Side = {
  side: SideLetter;
  captain: { id: string; name: string | null };
  team: { id: string; name: string } | null;
  payment_mode: 'pay_all' | 'each_pays_responsible' | 'gipedo_pano';
  players: number;
  /** The captain's own payment: held (not yet taken), paid, not paid, or the side left. */
  state: 'paid' | 'held' | 'unpaid' | 'left';
};

export type NoOpponentInfo = {
  due: boolean;
  choice: 'play_whole' | 'cancel' | 'auto_cancel' | null;
  pitch_cents: number;
  fee_cents: number;
  /** "Pay the whole pitch and play": the other half plus that half's fees. */
  amount_cents: number;
  choose_by: string;
};

/** booking_detail's 'v2' (supabase/migrations/*_pay_b3_after_pay.sql). */
export type BookingV2Info = {
  kind: 'whole' | 'half';
  pitch_label: string | null;
  /** The side the caller captains, if any. */
  captain_of: SideLetter | null;
  my_side: SideLetter | null;
  sides: V2Side[];
  /** Share id -> its side. */
  roster_sides: Record<string, SideLetter>;
  opposition: { found: boolean; open: boolean; invited: number } | null;
  /** The caller's open posts, to unpublish. */
  posts: { players: string | null; opposition: string | null };
  /** For the lone captain of a half pitch. */
  no_opponent: NoOpponentInfo | null;
};

/** One row of my_opposition_invites(): side B's price, from the server. */
export type OppositionInvite = {
  invite_id: string;
  booking_id: string;
  team_id: string | null;
  venue_name: string;
  booking_day: string;
  start_time: string;
  end_time: string;
  format: string;
  pitch_label: string | null;
  side_pitch_cents: number;
  side_players: number;
  /** Side B's captain paying for everyone. */
  pay_all_cents: number;
  /** His own share paying for myself. */
  each_pays_cents: number;
  /** What he'd hold for his side's unpaid spots (his side's half). */
  guarantee_cents: number;
  /** Another captain accepted first: "Opposition found". */
  found: boolean;
};

export type AcceptedOpposition = { booking_id: string; share_id: string | null; amount_cents: number; pay_by?: string };

/** One row of my_no_opponent_choices(), for Home. */
export type NoOpponentChoice = {
  booking_id: string;
  venue_name: string;
  booking_day: string;
  start_time: string;
  end_time: string;
  pitch_label: string | null;
  amount_cents: number;
  choose_by: string;
};

export type TeamResult = { id: string; name: string; city: string | null };

// ---- Words ----------------------------------------------------------------

/** "Side B · Bambos (Lions)", "Pays for myself", held: the side's captain's
 *  own payment as a status pill (none once the side left). */
export function sideRow(side: V2Side): { title: string; subtitle: string; pill: 'paid' | 'held' | 'unpaid' | null } {
  const captain = side.captain.name ?? 'Captain';
  return {
    title: `Side ${side.side.toUpperCase()} · ${captain}${side.team ? ` (${side.team.name})` : ''}`,
    subtitle:
      side.state === 'left' ? 'Left the game' : side.payment_mode === 'pay_all' ? 'Pays for everyone' : 'Pays for myself',
    pill: side.state === 'left' ? null : side.state,
  };
}

/** The roster in two groups, keeping its order. A player the server puts
 *  on no side (shouldn't happen on a half pitch) is shown on side A. */
export function rosterBySide<T extends { share_id: string }>(roster: T[], sides: Record<string, SideLetter>): Record<SideLetter, T[]> {
  return {
    a: roster.filter((e) => sides[e.share_id] !== 'b'),
    b: roster.filter((e) => sides[e.share_id] === 'b'),
  };
}

/** "Thu 26 Nov, 14:00", in Cyprus. */
export function cyprusDayTime(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Nicosia' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Nicosia' });
  return `${day.replace(',', '')}, ${time}`;
}

export function noOpponentLines(info: Pick<NoOpponentInfo, 'choose_by'>): { title: string; body: string } {
  return {
    title: 'No opponent yet',
    body: `Nobody has taken on your game. Choose by ${cyprusDayTime(info.choose_by)}, or it's cancelled free.`,
  };
}

/** The button says what happens, with the server's amount. */
export function payWholeLabel(amountCents: number): string {
  return `Pay ${formatEuros(amountCents)} and play`;
}

// ---- Server calls -------------------------------------------------------

function words(message: string | undefined): string {
  return describeBookingErrorMessage(message ?? 'Something went wrong.');
}

/** Side A's captain invites players (by username) and teams (their captains). */
export async function inviteOpposition(
  bookingId: string,
  { usernames, teamIds }: { usernames: string[]; teamIds: string[] },
): Promise<{ sent: number } | { error: string }> {
  const profileIds: string[] = [];
  for (const name of usernames) {
    const { data, error } = await supabase.rpc('find_profile_by_username', { p_username: name });
    if (error) return { error: words(error.message) };
    const row = (Array.isArray(data) ? data[0] : data) as { id?: string } | null | undefined;
    if (!row?.id) return { error: `No player called ${name}.` };
    profileIds.push(row.id);
  }
  const { data, error } = await supabase.rpc('invite_opposition', {
    p_booking_id: bookingId,
    p_profile_ids: profileIds,
    p_team_ids: teamIds,
  });
  if (error) return { error: words(error.message) };
  return { sent: (data as number) ?? 0 };
}

/** The teams the player follows, to list first. */
export async function fetchFollowedTeamIds(userId: string): Promise<Set<string>> {
  const { data } = await supabase.from('user_follows').select('target_id').eq('follower_id', userId).eq('target_type', 'team');
  return new Set(((data ?? []) as { target_id: string }[]).map((r) => r.target_id));
}

/** Every team whose name matches, the ones the player follows first. */
export async function searchTeams(query: string, followed: Set<string>): Promise<TeamResult[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  const { data, error } = await supabase.from('teams').select('id, name, city').ilike('name', `%${q}%`).order('name').limit(20);
  if (error) throw new Error(words(error.message));
  const rows = (data ?? []) as TeamResult[];
  return [...rows.filter((t) => followed.has(t.id)), ...rows.filter((t) => !followed.has(t.id))];
}

export async function fetchOppositionInvite(inviteId: string): Promise<OppositionInvite> {
  const { data, error } = await supabase.rpc('my_opposition_invites');
  if (error) throw new Error(words(error.message));
  const invite = ((data ?? []) as OppositionInvite[]).find((i) => i.invite_id === inviteId);
  if (!invite) throw new Error('This invite is no longer open.');
  return invite;
}

/** The first captain to accept becomes side B's captain; the server returns
 *  his share to pay or hold within the payment window. */
export async function acceptOpposition(
  inviteId: string,
  mode: 'pay_all' | 'each_pays_responsible',
): Promise<{ accepted: AcceptedOpposition } | { error: string }> {
  const { data, error } = await supabase.rpc('accept_opposition', { p_invite_id: inviteId, p_mode: mode });
  if (error || !data) return { error: words(error?.message) };
  return { accepted: data as AcceptedOpposition };
}

export async function fetchNoOpponentChoices(): Promise<NoOpponentChoice[]> {
  const { data, error } = await supabase.rpc('my_no_opponent_choices');
  if (error) throw new Error(words(error.message));
  return (data ?? []) as NoOpponentChoice[];
}

/** "Cancel free": everyone gets their money back. Error words, or null. */
export async function cancelFree(bookingId: string): Promise<string | null> {
  const { error } = await supabase.rpc('booking_no_opponent_choice', { p_booking_id: bookingId, p_choice: 'cancel' });
  return error ? words(error.message) : null;
}

export async function publishBooking(bookingId: string, kind: 'players' | 'opposition'): Promise<string | null> {
  const { error } = await supabase.rpc('publish_booking', { p_booking_id: bookingId, p_kind: kind });
  return error ? words(error.message) : null;
}

export async function unpublishPost(postId: string): Promise<string | null> {
  const { error } = await supabase.rpc('unpublish_post', { p_post_id: postId });
  return error ? words(error.message) : null;
}

export type SheetOutcome = { status: 'paid' } | { status: 'cancelled' } | { status: 'error'; message: string };

/** "Pay the whole pitch and play": pay-other-half makes the payment for
 *  exactly the server's amount; it counts only once Stripe's webhook says so. */
export async function payOtherHalf(bookingId: string, sheet: PaymentSheet): Promise<SheetOutcome> {
  const { data, error } = await supabase.functions.invoke<{ clientSecret?: string }>('pay-other-half', { body: { bookingId } });
  if (error || !data?.clientSecret) {
    const code = error ? await describeFunctionError(error) : 'Something went wrong.';
    return { status: 'error', message: words(code) };
  }
  const { error: initError } = await sheet.init({
    merchantDisplayName: 'Futty',
    ...walletPayOptions,
    paymentIntentClientSecret: data.clientSecret,
  });
  if (initError) return { status: 'error', message: initError.message };
  const { error: presentError } = await sheet.present();
  if (presentError) {
    return presentError.code === 'Canceled' ? { status: 'cancelled' } : { status: 'error', message: presentError.message };
  }
  return { status: 'paid' };
}
