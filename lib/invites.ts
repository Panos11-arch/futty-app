import type { PostgrestError } from '@supabase/supabase-js';

import { supabase } from '@/lib/supabase';

/** Team and booking invites (supabase/migrations/*_pay_guards_invites.sql).
 *  Each one arrives as a team_invite / booking_invite notification whose
 *  data.inviteId points here; only the invited player can answer it. */
export type InviteStatus = 'pending' | 'accepted' | 'declined';

export async function acceptInvite(inviteId: string) {
  return supabase.rpc('accept_invite', { p_invite_id: inviteId });
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
    default:
      return error.message;
  }
}
