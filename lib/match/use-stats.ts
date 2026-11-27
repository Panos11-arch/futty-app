// Hooks for A7's screens: each loads one read from lib/match/stats-api.ts and
// gives loading, error (with reload) or ready.
import {
  getMyMostPlayedFormat,
  getPowerRanking,
  getPowerRankingHistory,
  getTeamPowerRanking,
  type PowerRankingGame,
  type PowerRankingRow,
  type TeamFormatRanking,
} from '@/lib/match/power-ranking-api';
import {
  getTeamOfTheWeek,
  getLeaderboard,
  getLeaderboardScopes,
  getMinAppearances,
  getPlayerSeasonStats,
  getTeamOfTheWeekPlayers,
  getTeamShape,
  getTeamRecentMatches,
  getTeamSeasonStats,
  listTeamOfTheWeekWeeks,
  listTeamsOfTheWeek,
  type LeaderboardBoard,
  type LeaderboardRow,
  type LeaderboardScope,
  type PlayerSeasonStats,
  type SeasonChoice,
  type TeamOfTheWeek,
  type TeamOfTheWeekPlayer,
  type TeamShape,
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

/** One team of the week by id (a notification or the Home card names it); null once it is gone. */
export function useTeamOfTheWeekById(teamId: string | null | undefined) {
  const { state, reload } = useLoad<{ team: TeamOfTheWeek | null }>(
    teamId
      ? async () => {
          const { team, error } = await getTeamOfTheWeek(teamId);
          return error ? { error: error.message } : { value: { team } };
        }
      : null,
    teamId ?? '',
  );
  return { ...state, reload };
}

/** The weeks with a team of the week in `format`, newest first. */
export function useTeamOfTheWeekWeeks(format: string) {
  const { state, reload } = useLoad<{ weeks: string[] }>(async () => {
    const { weeks, error } = await listTeamOfTheWeekWeeks(format);
    return error ? { error: error.message } : { value: { weeks } };
  }, format);
  return { ...state, reload };
}

/** Every team of one week and format (the area picker's choices). */
export function useTeamsOfTheWeek(weekStart: string | null, format: string) {
  const { state, reload } = useLoad<{ teams: TeamOfTheWeek[] }>(
    weekStart
      ? async () => {
          const { teams, error } = await listTeamsOfTheWeek(weekStart, format);
          return error ? { error: error.message } : { value: { teams } };
        }
      : null,
    weekStart ? `${weekStart}|${format}` : '',
  );
  return { ...state, reload };
}

/** The power ranking in `format`. */
export function usePowerRanking(format: string) {
  const { state, reload } = useLoad<{ rows: PowerRankingRow[] }>(async () => {
    const { rows, error } = await getPowerRanking(format);
    return error ? { error: error.message } : { value: { rows } };
  }, format);
  return { ...state, reload };
}

/** A team's counted games in `format`, latest first (the breakdown). */
export function usePowerRankingHistory(teamId: string | null, format: string) {
  const { state, reload } = useLoad<{ games: PowerRankingGame[] }>(
    teamId
      ? async () => {
          const { games, error } = await getPowerRankingHistory(teamId, format);
          return error ? { error: error.message } : { value: { games } };
        }
      : null,
    teamId ? `${teamId}|${format}` : '',
  );
  return { ...state, reload };
}

/** A team's place in each format where it is listed. */
export function useTeamPowerRanking(teamId: string | null | undefined) {
  const { state, reload } = useLoad<{ rows: TeamFormatRanking[] }>(
    teamId
      ? async () => {
          const { rows, error } = await getTeamPowerRanking(teamId);
          return error ? { error: error.message } : { value: { rows } };
        }
      : null,
    teamId ?? '',
  );
  return { ...state, reload };
}

/** The viewer's most played format (null with none, or when it can't be read). */
export function useMyMostPlayedFormat() {
  const { state } = useLoad<{ format: string | null }>(async () => {
    const { format } = await getMyMostPlayedFormat();
    return { value: { format } };
  }, 'me');
  return state;
}

/** A team's players and its format's shape (to show the empty slots). */
export function useTeamOfTheWeekPlayers(team: Pick<TeamOfTheWeek, 'id' | 'format'> | null | undefined) {
  const { state, reload } = useLoad<{ players: TeamOfTheWeekPlayer[]; shape: TeamShape | null }>(
    team
      ? async () => {
          const [players, shape] = await Promise.all([getTeamOfTheWeekPlayers(team.id), getTeamShape(team.format)]);
          const error = players.error ?? shape.error;
          return error ? { error: error.message } : { value: { players: players.players, shape: shape.shape } };
        }
      : null,
    team ? `${team.id}|${team.format}` : '',
  );
  return { ...state, reload };
}
