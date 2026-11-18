// Hooks for A7's screens: each loads one read from lib/match/stats-api.ts and
// gives loading, error (with reload) or ready.
import {
  getLatestTeamOfTheWeek,
  getLeaderboard,
  getLeaderboardScopes,
  getMinAppearances,
  getPlayerSeasonStats,
  getTeamOfTheWeekPlayers,
  getTeamRecentMatches,
  getTeamSeasonStats,
  type LeaderboardBoard,
  type LeaderboardRow,
  type LeaderboardScope,
  type PlayerSeasonStats,
  type SeasonChoice,
  type TeamOfTheWeek,
  type TeamOfTheWeekPlayer,
  type TeamSeasonStats,
} from '@/lib/match/stats-api';
import type { PlayerRecentMatchRow } from '@/lib/match/types';
import { useLoad } from '@/lib/match/use-match-result';

const seasonKey = (s: SeasonChoice) => (s.kind === 'year' ? `year:${s.year}` : 'all');

export function usePlayerSeasonStats(profileId: string | null | undefined, season: SeasonChoice) {
  const { state, reload } = useLoad<{ stats: PlayerSeasonStats | null }>(
    profileId
      ? async () => {
          const { stats, error } = await getPlayerSeasonStats(profileId, season);
          return error ? { error: error.message } : { value: { stats } };
        }
      : null,
    `${profileId}|${seasonKey(season)}`,
  );
  return { ...state, reload };
}

export function useTeamSeasonStats(teamId: string | null | undefined, season: SeasonChoice) {
  const { state, reload } = useLoad<{ stats: TeamSeasonStats | null }>(
    teamId
      ? async () => {
          const { stats, error } = await getTeamSeasonStats(teamId, season);
          return error ? { error: error.message } : { value: { stats } };
        }
      : null,
    `${teamId}|${seasonKey(season)}`,
  );
  return { ...state, reload };
}

export function useTeamRecentMatches(teamId: string | null | undefined, limit = 10) {
  const { state, reload } = useLoad<{ rows: PlayerRecentMatchRow[] }>(
    teamId
      ? async () => {
          const { rows, error } = await getTeamRecentMatches(teamId, limit);
          return error ? { error: error.message } : { value: { rows } };
        }
      : null,
    `${teamId}|${limit}`,
  );
  return { ...state, reload };
}

/** The scopes with a leaderboard this year, and the minimum appearances. */
export function useLeaderboardScopes(year: number) {
  const { state, reload } = useLoad<{ scopes: LeaderboardScope[]; min: number | null }>(async () => {
    const [{ scopes, error }, { min, error: minError }] = await Promise.all([
      getLeaderboardScopes(year),
      getMinAppearances(),
    ]);
    if (error || minError) return { error: (error ?? minError)!.message };
    return { value: { scopes, min } };
  }, String(year));
  return { ...state, reload };
}

export function useLeaderboard(scope: LeaderboardScope | null, year: number, board: LeaderboardBoard) {
  const { state, reload } = useLoad<{ rows: LeaderboardRow[] }>(
    scope
      ? async () => {
          const { rows, error } = await getLeaderboard(scope, year, board);
          return error ? { error: error.message } : { value: { rows } };
        }
      : null,
    `${scope?.scope}|${scope?.scope_key}|${year}|${board}`,
  );
  return { ...state, reload };
}

export function useLatestTeamOfTheWeek() {
  const { state, reload } = useLoad<{ team: TeamOfTheWeek | null }>(async () => {
    const { team, error } = await getLatestTeamOfTheWeek();
    return error ? { error: error.message } : { value: { team } };
  }, 'latest');
  return { ...state, reload };
}

export function useTeamOfTheWeekPlayers(teamOfTheWeekId: string | null | undefined) {
  const { state, reload } = useLoad<{ players: TeamOfTheWeekPlayer[] }>(
    teamOfTheWeekId
      ? async () => {
          const { players, error } = await getTeamOfTheWeekPlayers(teamOfTheWeekId);
          return error ? { error: error.message } : { value: { players } };
        }
      : null,
    teamOfTheWeekId ?? '',
  );
  return { ...state, reload };
}
