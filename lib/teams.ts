import type { KitColourName } from '@/constants/futty-theme';
import { supabase } from '@/lib/supabase';
import type { AvatarFields } from '@/lib/avatar';

export const ROSTER_SIZE_PRESETS = [5, 7, 9, 11];

/** The towns a team can be in (the same list as the Leagues create-team form). */
export const TEAM_CITIES = ['Nicosia', 'Limassol', 'Larnaca', 'Paphos'] as const;

/** Formats Team Premium gates, and what a season costs — supabase/team-premium.sql. */
export const PREMIUM_FORMAT_PRICES: Record<string, number> = {
  '9-a-side': 45,
  '11-a-side': 59,
};

export function isPremiumFormat(format: string): format is keyof typeof PREMIUM_FORMAT_PRICES {
  return format in PREMIUM_FORMAT_PRICES;
}

// Must match the non-consumable Product IDs created in App Store Connect,
// and PRODUCT_FORMATS in supabase/functions/verify-team-purchase/index.ts.
export const TEAM_PREMIUM_SKUS: Record<'9-a-side' | '11-a-side', string> = {
  '9-a-side': 'team_premium_9aside',
  '11-a-side': 'team_premium_11aside',
};

export type Team = {
  id: string;
  name: string;
  city: string | null;
  created_by: string;
  xp: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals: number;
  roster_size: number;
  substitute_slots: number;
  premium_9aside: boolean;
  premium_11aside: boolean;
  created_at: string;
  /** S20A: the team's kit token; null for teams made before S20A. */
  kit_colour?: string | null;
  /** S20A: set when the last member deleted the team (hidden, history kept). */
  deleted_at?: string | null;
};

export { KIT_COLOURS, teamKit } from '@/lib/team-kit';

/** True when this team already has Team Premium for the given format —
 *  false (not an error) for any format Team Premium doesn't gate. */
export function hasTeamPremium(team: Team, format: string) {
  if (format === '9-a-side') return team.premium_9aside;
  if (format === '11-a-side') return team.premium_11aside;
  return true;
}

/** get_team_roster: avatar fields added by A12 (pay_profile_avatar). */
export type RosterMember = {
  profile_id: string;
  username: string | null;
  full_name: string | null;
  role: 'captain' | 'player' | 'substitute' | string;
  joined_at: string;
} & Partial<AvatarFields>;

export async function createTeam(
  name: string,
  city: string,
  rosterSize: number,
  substituteSlots: number
) {
  return supabase.rpc('create_team', {
    p_name: name,
    p_city: city,
    p_roster_size: rosterSize,
    p_substitute_slots: substituteSlots,
  });
}

/** Resolves a username to a profile id for adding a team member — profiles'
 *  own RLS only allows reading your own row, so this goes through an RPC. */
export async function findProfileByUsername(username: string) {
  return supabase.rpc('find_profile_by_username', { p_username: username });
}

/** Captain only. Sends the player an invite (a team_invite notification);
 *  they join the roster when they accept it. Nobody can add someone else
 *  directly. */
export async function inviteTeamMember(
  teamId: string,
  profileId: string,
  role: 'player' | 'substitute' = 'player'
) {
  return supabase.rpc('invite_team_member', { p_team_id: teamId, p_profile_id: profileId, p_role: role });
}

export async function getTeamRoster(teamId: string) {
  return supabase.rpc('get_team_roster', { p_team_id: teamId });
}

// ---- S20A: your own teams (supabase/migrations/*_match_s20a_teams.sql) ----

export type NewTeam = {
  name: string;
  city: string;
  kitColour: KitColourName;
  rosterSize: number;
  substituteSlots: number;
  /** Friends to invite; each gets an invite and joins when they accept. */
  memberIds: string[];
};

/** Any player, any number of teams. The server checks every member is a
 *  friend you may play with (not blocked, A4). */
export async function createMyTeam(team: NewTeam) {
  return supabase.rpc('create_my_team', {
    p_name: team.name.trim(),
    p_city: team.city,
    p_kit_colour: team.kitColour,
    p_roster_size: team.rosterSize,
    p_substitute_slots: team.substituteSlots,
    p_member_ids: team.memberIds,
  });
}

export async function cancelTeamInvite(inviteId: string) {
  return supabase.rpc('cancel_team_invite', { p_invite_id: inviteId });
}

export async function removeTeamMember(teamId: string, profileId: string) {
  return supabase.rpc('remove_team_member', { p_team_id: teamId, p_profile_id: profileId });
}

export async function passCaptaincy(teamId: string, profileId: string) {
  return supabase.rpc('pass_captaincy', { p_team_id: teamId, p_profile_id: profileId });
}

export async function leaveTeam(teamId: string) {
  return supabase.rpc('leave_team', { p_team_id: teamId });
}

/** The last member only: hides the team; its games and history stay. */
export async function deleteTeam(teamId: string) {
  return supabase.rpc('delete_team', { p_team_id: teamId });
}

export type PendingTeamInvite = { invite_id: string; profile_id: string; name: string; role: string };

/** The team's open invites (captain only). */
export async function fetchPendingTeamInvites(teamId: string): Promise<PendingTeamInvite[]> {
  const { data, error } = await supabase.rpc('team_pending_invites', { p_team_id: teamId });
  if (error) throw new Error(describeTeamError(error));
  return (data ?? []) as PendingTeamInvite[];
}

export type TeamCompetition = { league_id: string; name: string; format: string; running: boolean };

/** The leagues the team plays in, by their competition page. */
export async function fetchTeamCompetitions(teamId: string): Promise<TeamCompetition[]> {
  const { data, error } = await supabase.rpc('team_competitions', { p_team_id: teamId });
  if (error) throw new Error(LOAD_FAILED);
  return (data ?? []) as TeamCompetition[];
}

const LOAD_FAILED = "Couldn't load. Try again.";
const CANT_ADD = "You can't add this player.";

const TEAM_ERRORS: Record<string, string> = {
  not_friends: 'Only friends can join. Add them as a friend first.',
  blocked: CANT_ADD,
  age_pair_refused: CANT_ADD,
  player_not_found: 'Player not found.',
  name_required: 'Give the team a name.',
  invalid_kit_colour: 'Pick a kit colour.',
  team_full: 'No places left. Pick fewer players.',
  not_captain: 'Only the captain can do that.',
  not_member: 'They’re not in this team.',
  already_captain: 'You’re already captain.',
  use_leave: 'Use Leave team instead.',
  captain_must_pass: 'Make someone else captain first.',
  use_delete: 'You’re the last member. Delete the team instead.',
  not_last_member: 'Remove the other members first.',
  team_in_competition: 'This team is in a league. Try after it ends.',
  team_has_booking: 'This team has a game coming up. Try after it.',
  team_deleted: 'This team was deleted.',
  invite_not_pending: 'This invite was already answered.',
};

/** One line for a refused team action: what happened and what to do. */
export function describeTeamError(error: { message: string } | null) {
  return (error && TEAM_ERRORS[error.message]) || 'Something went wrong. Try again.';
}

// There is deliberately no client-side setTeamPremium() here anymore.
// premium_9aside/premium_11aside are now locked down (supabase/team-premium-
// payments.sql revokes client execute on set_team_premium) and can only be
// set by verify-team-purchase after confirming a real purchase directly with
// Apple — this just calls that function.
export async function verifyTeamPurchaseOnServer(transactionId: string, productId: string, teamId: string) {
  return supabase.functions.invoke<{ active: boolean }>('verify-team-purchase', {
    body: { transactionId, productId, teamId },
  });
}
