// The venue page's Home tab (S5): top players and recent results at the
// venue, from venue_highlights (supabase/migrations/
// 20261124200100_match_venue_highlights.sql). Names come from
// get_public_profiles, as on every other list.
import type { AvatarLook } from '@/lib/avatar';
import { getPublicNames } from '@/lib/match/profile-api';
import { supabase } from '@/lib/supabase';

type ServerHighlights = {
  top_players: { profile_id: string; rating: number; matches: number }[];
  recent_results: {
    match_id: string;
    kickoff_at: string;
    sides: { side: 'a' | 'b'; label: string; team_id: string | null; score: number }[];
  }[];
};

export type TopPlayer = { profileId: string; name: string; kit: AvatarLook | null; rating: string; matches: number };
export type VenueResult = { matchId: string; day: string; sides: { label: string; teamId: string | null; score: number }[] };
export type VenueHighlights = { topPlayers: TopPlayer[]; results: VenueResult[] };

/** A match rating with one decimal, as the match page shows it. */
export function ratingText(rating: number): string {
  return (Math.round(rating * 10) / 10).toFixed(1);
}

/** "Sat 21 Nov": the match's day in Cyprus. */
export function resultDay(kickoffAt: string): string {
  return new Date(kickoffAt)
    .toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Nicosia' })
    .replace(',', '');
}

export async function fetchVenueHighlights(venueId: string): Promise<VenueHighlights> {
  const { data, error } = await supabase.rpc('venue_highlights', { p_venue_id: venueId });
  if (error || !data) throw new Error('Could not load this venue. Try again.');
  const h = data as ServerHighlights;
  const { names, kits } = await getPublicNames(h.top_players.map((p) => p.profile_id));
  return {
    topPlayers: h.top_players.map((p) => ({
      profileId: p.profile_id,
      name: names[p.profile_id] ?? 'Player',
      kit: kits[p.profile_id] ?? null,
      rating: ratingText(p.rating),
      matches: p.matches,
    })),
    results: h.recent_results.map((r) => ({
      matchId: r.match_id,
      day: resultDay(r.kickoff_at),
      sides: r.sides.map((s) => ({ label: s.label, teamId: s.team_id, score: s.score })),
    })),
  };
}
