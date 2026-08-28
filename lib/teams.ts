import { supabase } from '@/lib/supabase';

export const ROSTER_SIZE_PRESETS = [5, 7, 9, 11];

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
};

/** True when this team already has Team Premium for the given format —
 *  false (not an error) for any format Team Premium doesn't gate. */
export function hasTeamPremium(team: Team, format: string) {
  if (format === '9-a-side') return team.premium_9aside;
  if (format === '11-a-side') return team.premium_11aside;
  return true;
}

export type RosterMember = {
  profile_id: string;
  username: string | null;
  full_name: string | null;
  role: 'captain' | 'player' | 'substitute' | string;
  joined_at: string;
};

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

export async function addTeamMember(
  teamId: string,
  profileId: string,
  role: 'player' | 'substitute' = 'player'
) {
  return supabase.from('team_members').insert({ team_id: teamId, profile_id: profileId, role });
}

export async function getTeamRoster(teamId: string) {
  return supabase.rpc('get_team_roster', { p_team_id: teamId });
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
