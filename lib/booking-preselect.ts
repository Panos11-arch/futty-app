// S20: "Book together" and "Team vs team" from a friend chat (S13). The chat
// opens Book a pitch with the friend (inviteProfileId) or the friend's team
// (oppositionTeamId). Book a pitch arms this while it is open, whichever way
// the player then goes to pay (a time, the venue page), as Start a match
// does (lib/start-match.ts). The checkout starts on half pitch for Team vs
// team; the screen after paying takes it once and preselects the friend in
// Invite friends and the team in the opposition invite.
//
// Only a preselection: nothing here touches a price, a hold or who pays.
// The server returns the friend or team only while they're allowed
// (booking_preselect: friends, not blocked, A4; both captains for a team),
// so a missing or no-longer-allowed one simply isn't preselected.
import type { BookingKind } from '@/lib/booking-v2';
import { supabase } from '@/lib/supabase';

export type BookingPreselectIds = { inviteProfileId?: string | null; oppositionTeamId?: string | null };

/** The friend to preselect in Invite friends (the name as the server shows it, A5). */
export type PreselectFriend = { profile_id: string; name: string };
/** The team to preselect in the opposition invite (as team search returns it). */
export type PreselectTeam = { id: string; name: string; city: string | null };
export type BookingPreselect = { friend: PreselectFriend | null; team: PreselectTeam | null };

const NONE: BookingPreselect = { friend: null, team: null };

let armed: BookingPreselectIds | null = null;

function clean(id: string | null | undefined): string | null {
  return typeof id === 'string' && id.trim() !== '' ? id.trim() : null;
}

/** Book a pitch, opened from a friend chat: on while it is open (null turns it off). */
export function armBookingPreselect(ids: BookingPreselectIds | null): void {
  const friend = clean(ids?.inviteProfileId);
  const team = clean(ids?.oppositionTeamId);
  armed = friend || team ? { inviteProfileId: friend, oppositionTeamId: team } : null;
}

/** What is armed, without taking it (the checkout's starting choice). */
export function peekBookingPreselect(): BookingPreselectIds | null {
  return armed;
}

/** Once, right after paying. */
export function takeBookingPreselect(): BookingPreselectIds | null {
  const was = armed;
  armed = null;
  return was;
}

/** Team vs team starts the checkout on half pitch (only while the server
 *  offers half, CheckoutView checks); otherwise the checkout's own default. */
export function initialKindFor(ids: BookingPreselectIds | null): BookingKind | undefined {
  return ids?.oppositionTeamId ? 'half' : undefined;
}

/** The friend and team the server allows; none on any failure. */
export async function fetchBookingPreselect(ids: BookingPreselectIds | null): Promise<BookingPreselect> {
  const friend = clean(ids?.inviteProfileId);
  const team = clean(ids?.oppositionTeamId);
  if (!friend && !team) return NONE;
  try {
    const { data, error } = await supabase.rpc('booking_preselect', { p_profile_id: friend, p_team_id: team });
    if (error || !data || typeof data !== 'object') return NONE;
    const value = data as Partial<BookingPreselect>;
    const f = value.friend;
    const t = value.team;
    return {
      friend: f && typeof f.profile_id === 'string' && typeof f.name === 'string' ? { profile_id: f.profile_id, name: f.name } : null,
      team: t && typeof t.id === 'string' && typeof t.name === 'string' ? { id: t.id, name: t.name, city: t.city ?? null } : null,
    };
  } catch {
    return NONE;
  }
}
