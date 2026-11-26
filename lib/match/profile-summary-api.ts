// S8 Profile tab (docs/specs/15-design.md, image 19). Reads the caller's own
// summary, season tiles and recent games from the server
// (20261126125309_match_profile_summary.sql), and Showed up and Your venues
// (20261126180000_match_profile_more.sql), and formats them for display.
// Every number comes from the server; nothing here counts or computes stats.
import type { FormBadgeResult } from '@/components/ui/form-badge';
import { formatLevel } from '@/lib/match/levels';
import { formatMatchRating } from '@/lib/match/rating';
import { supabase } from '@/lib/supabase';

export type ProfileSummary = {
  followers: number;
  following: number;
  level: number | null;
  provisional: boolean | null;
  levelChangeMonth: number | null;
};

export type ProfileSeason = {
  formats: string[];
  games: number;
  wins: number;
  goals: number;
  assists: number;
  motm: number;
  avgRating: number | null;
  totw: number;
  /** Showed up, whole %; null until 3 games count (match-record.md "Showed up"). */
  showedUpPct: number | null;
};

/** A venue the caller played at (my_venues), most games first. */
export type MyVenue = {
  venue_id: string;
  name: string;
  city: string | null;
  games: number;
  last_played_at: string | null;
};

export type ProfileRecentGame = {
  match_id: string;
  kickoff_at: string;
  venue_id: string | null;
  venue_name: string | null;
  format: string;
  label: string;
  opponent_label: string;
  team_id: string | null;
  opponent_team_id: string | null;
  goals_for: number | null;
  goals_against: number | null;
  result: FormBadgeResult;
  goals: number;
  assists: number;
  rating: number | null;
};

type Read<T> = { value: T } | { error: string };

const toNumber = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

export async function getMyProfileSummary(): Promise<Read<ProfileSummary>> {
  const { data, error } = await supabase.rpc('my_profile_summary');
  if (error) return { error: error.message };
  const d = (data ?? {}) as Record<string, unknown>;
  return {
    value: {
      followers: Number(d.followers ?? 0),
      following: Number(d.following ?? 0),
      level: toNumber(d.level),
      provisional: d.provisional === null || d.provisional === undefined ? null : Boolean(d.provisional),
      levelChangeMonth: toNumber(d.levelChangeMonth),
    },
  };
}

export async function getMyProfileSeason(format: string | null): Promise<Read<ProfileSeason>> {
  const [season, showed] = await Promise.all([
    supabase.rpc('my_profile_season', { p_format: format }),
    supabase.rpc('my_profile_showed_up', { p_format: format }),
  ]);
  const error = season.error ?? showed.error;
  if (error) return { error: error.message };
  const d = (season.data ?? {}) as Record<string, unknown>;
  const s = (showed.data ?? {}) as Record<string, unknown>;
  return {
    value: {
      formats: Array.isArray(d.formats) ? (d.formats as string[]) : [],
      games: Number(d.games ?? 0),
      wins: Number(d.wins ?? 0),
      goals: Number(d.goals ?? 0),
      assists: Number(d.assists ?? 0),
      motm: Number(d.motm ?? 0),
      avgRating: toNumber(d.avgRating),
      totw: Number(d.totw ?? 0),
      showedUpPct: toNumber(s.pct),
    },
  };
}

export async function getMyVenues(limit = 20): Promise<Read<MyVenue[]>> {
  const { data, error } = await supabase.rpc('my_venues', { p_limit: limit });
  if (error) return { error: error.message };
  return {
    value: ((data as MyVenue[] | null) ?? []).map((v) => ({ ...v, games: Number(v.games) })),
  };
}

/** "9 games" under a venue. */
export function venueGamesLabel(games: number): string {
  return games === 1 ? '1 game' : `${games} games`;
}

export async function getMyProfileRecent(limit = 3): Promise<Read<ProfileRecentGame[]>> {
  const { data, error } = await supabase.rpc('my_profile_recent', { p_limit: limit });
  if (error) return { error: error.message };
  return {
    value: ((data as ProfileRecentGame[] | null) ?? []).map((g) => ({ ...g, rating: toNumber(g.rating) })),
  };
}

/** The level scale's top (match-record 1f, levels 1–10). */
export const LEVEL_MAX = 10;

/** "@handle · Area · Position · Right foot", leaving out what's empty. */
export function profileSubtitle(p: {
  username: string | null;
  city: string | null;
  position: string | null;
  preferred_foot: string | null;
}): string {
  const parts = [
    p.username ? `@${p.username}` : null,
    p.city,
    p.position,
    p.preferred_foot === 'Both' ? 'Both feet' : p.preferred_foot ? `${p.preferred_foot} foot` : null,
  ];
  return parts.filter((x): x is string => Boolean(x)).join(' · ');
}

/** "128 followers · 96 following" (singular for one). */
export function followLine(s: Pick<ProfileSummary, 'followers' | 'following'>): string {
  return `${s.followers} ${s.followers === 1 ? 'follower' : 'followers'} · ${s.following} following`;
}

/** The level bar's fill, 0–1. */
export function levelProgress(level: number | null): number {
  if (level === null || !Number.isFinite(level)) return 0;
  return Math.min(1, Math.max(0, level / LEVEL_MAX));
}

/** "of 10.0 · ▲0.2 this month"; the change is left out when there's none. */
export function levelRightLabel(change: number | null): string {
  const scale = `of ${formatLevel(LEVEL_MAX)}`;
  if (change === null || Math.round(change * 10) === 0) return scale;
  const arrow = change > 0 ? '▲' : '▼';
  return `${scale} · ${arrow}${formatLevel(Math.abs(change))} this month`;
}

/** "2 G · 1 A", leaving out zeros; empty when both are zero. */
export function goalsAssistsLabel(goals: number, assists: number): string {
  return [goals > 0 ? `${goals} G` : null, assists > 0 ? `${assists} A` : null].filter(Boolean).join(' · ');
}

/** "Nuevo Campo · Sun": the venue and the weekday in Cyprus. */
export function recentGameWhere(g: Pick<ProfileRecentGame, 'venue_name' | 'kickoff_at'>): string {
  const day = new Date(g.kickoff_at).toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Asia/Nicosia' });
  return [g.venue_name, day].filter(Boolean).join(' · ');
}

/** "Captain · Limassol" for a My teams row. */
export function teamSubtitle(role: string, city: string | null): string {
  const roleLabel = role ? role.charAt(0).toUpperCase() + role.slice(1) : null;
  return [roleLabel, city].filter(Boolean).join(' · ');
}

/** The season tiles in image 19's order. Showed up is "–" until 3 games count. */
export function seasonTiles(s: ProfileSeason): { key: string; label: string; value: string }[] {
  return [
    { key: 'games', label: 'Games', value: String(s.games) },
    { key: 'goals', label: 'Goals', value: String(s.goals) },
    { key: 'assists', label: 'Assists', value: String(s.assists) },
    { key: 'rating', label: 'Avg rating', value: s.avgRating === null ? '–' : formatMatchRating(s.avgRating) },
    { key: 'wins', label: 'Wins', value: String(s.wins) },
    { key: 'motm', label: 'MOTM', value: String(s.motm) },
    { key: 'totw', label: 'TOTW', value: String(s.totw) },
    { key: 'showedUp', label: 'Showed up', value: s.showedUpPct === null ? '–' : `${s.showedUpPct}%` },
  ];
}
