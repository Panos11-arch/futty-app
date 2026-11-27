import type { PostgrestError } from '@supabase/supabase-js';

import { CYPRUS_TIME_ZONE } from '@/lib/calendar/cyprus-time';
import { supabase } from '@/lib/supabase';

/** Team and booking invites (supabase/migrations/*_pay_guards_invites.sql).
 *  Each one arrives as a team_invite / booking_invite notification whose
 *  data.inviteId points here; only the invited player can answer it. */
export type InviteStatus = 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired' | 'lapsed';

/** S20A (b): a game invite can say how the player pays: 'cash' keeps his
 *  spot (a whole pitch where each pays; waiting on Panos), 'card' gives him
 *  15 minutes to pay or hold. */
export async function acceptInvite(inviteId: string, method?: 'card' | 'cash') {
  return supabase.rpc('accept_invite', method ? { p_invite_id: inviteId, p_method: method } : { p_invite_id: inviteId });
}

/** S20A (b): the card player's one line while his spot waits for payment. */
export function payByLine(payBy: string | null): string | null {
  if (!payBy) return null;
  const time = new Date(payBy).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: CYPRUS_TIME_ZONE });
  return `Pay by ${time} or your spot is released.`;
}

/** S20A (b): when my card spot lapses (null: no deadline). RLS lets a
 *  player read his own share. A failed read shows no line. */
export async function myPayBy(shareId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase.from('booking_payment_shares').select('pay_by').eq('id', shareId).maybeSingle();
    if (error || !data) return null;
    return (data as { pay_by: string | null }).pay_by ?? null;
  } catch {
    return null;
  }
}

export async function declineInvite(inviteId: string) {
  return supabase.rpc('decline_invite', { p_invite_id: inviteId });
}

/** Current status of each invite, keyed by id (RLS returns only your own). */
export async function inviteStatuses(inviteIds: string[]) {
  if (inviteIds.length === 0) return new Map<string, InviteStatus>();
  const { data } = await supabase.from('invites').select('id, status').in('id', inviteIds);
  return new Map((data ?? []).map((row) => [row.id as string, row.status as InviteStatus]));
}

export function describeInviteError(error: PostgrestError) {
  switch (error.message) {
    case 'not_captain':
      return 'Only the team captain can invite players.';
    case 'already_on_team':
      return 'Already on this team.';
    case 'already_invited':
      return "They've already been invited.";
    case 'team_full':
      return 'No places left on the team (pending invites count too).';
    case 'player_not_found':
      return 'No player with that username.';
    case 'not_your_invite':
      return "That invite isn't for you.";
    case 'invite_not_pending':
      return 'You already answered this invite.';
    case 'booking_cancelled':
      return 'That game has been cancelled.';
    case 'slot_in_past':
      return 'That game has already started.';
    case 'venue_not_live':
      return "This venue isn't taking bookings on Futty right now.";
    // S20A: team invites refused for a block, an adult-minor pair (A4) or a deleted team.
    case 'blocked':
    case 'age_pair_refused':
      return "You can't join this team.";
    case 'team_deleted':
      return 'This team was deleted.';
    // S20A (b): player invites close when the side is full or at kickoff.
    case 'booking_full':
      return 'This game is full.';
    case 'invite_expired':
      return 'This invite expired. The game has started.';
    case 'cash_whole_pitch_only':
      return 'Cash is for a whole pitch only. Pay by card.';
    // Accepting: a debtor can't join at all (refuse_debtor_share, and the
    // revive of a lapsed share), so card is no way out here.
    case 'player_in_debt':
      return 'Settle what you owe first.';
    default:
      return error.message;
  }
}
