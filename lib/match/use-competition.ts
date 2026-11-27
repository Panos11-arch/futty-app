// S10 screens: one hook per competition read (lib/match/competition-api.ts).
// Each gives loading, error (with reload) or ready, as lib/match/use-stats.ts
// does. A tab's hooks run when that tab first mounts.
import {
  getCompetition,
  getCompetitionAwards,
  getCompetitionMatches,
  getCompetitionPlayerStats,
  getCompetitionPowerRanking,
  getCompetitionStandings,
  getCompetitionStats,
  isPremiumRequired,
  type Competition,
  type CompetitionAwards,
  type CompetitionMatch,
  type CompetitionPowerRow,
  type CompetitionStandings,
  type PlayerStatRow,
  type StatsCategory,
  type StatsTab,
} from '@/lib/match/competition-api';
import { useLoad } from '@/lib/match/use-match-result';
import { fetchLeagueCaptainContacts, type CaptainContact } from '@/lib/messages';

/** The competition (header, Overview); `seasonId` null is the current season. */
export function useCompetition(leagueId: string | null | undefined, seasonId: string | null) {
  const { state, reload } = useLoad<{ competition: Competition | null }>(
    leagueId
      ? async () => {
          const { competition, error } = await getCompetition(leagueId, seasonId);
          return error ? { error: error.message } : { value: { competition } };
        }
      : null,
    `${leagueId}|${seasonId}`,
  );
  return { ...state, reload };
}

export function useCompetitionStandings(seasonId: string) {
  const { state, reload } = useLoad<{ standings: CompetitionStandings }>(async () => {
    const { standings, error } = await getCompetitionStandings(seasonId);
    return error ? { error: error.message } : { value: { standings } };
  }, seasonId);
  return { ...state, reload };
}

export function useCompetitionMatches(seasonId: string, teamId: string | null) {
  const { state, reload } = useLoad<{ matches: CompetitionMatch[] }>(async () => {
    const { matches, error } = await getCompetitionMatches(seasonId, teamId);
    return error ? { error: error.message } : { value: { matches } };
  }, `${seasonId}|${teamId}`);
  return { ...state, reload };
}

/** `premium` is true when the server refused a non-Premium caller. */
export function useCompetitionPlayerStats(seasonId: string, teamId: string | null) {
  const { state, reload } = useLoad<{ rows: PlayerStatRow[]; premium: boolean }>(async () => {
    const { rows, error } = await getCompetitionPlayerStats(seasonId, teamId);
    if (isPremiumRequired(error)) return { value: { rows: [], premium: true } };
    return error ? { error: error.message } : { value: { rows, premium: false } };
  }, `${seasonId}|${teamId}`);
  return { ...state, reload };
}

/** One tab of Stats (top 3 per card), or one category in full (`category` set). */
export function useCompetitionStats(seasonId: string, tab: StatsTab, category: string | null = null, limit = 3) {
  const { state, reload } = useLoad<{ categories: StatsCategory[] }>(async () => {
    const { categories, error } = await getCompetitionStats(seasonId, tab, category, limit);
    return error ? { error: error.message } : { value: { categories } };
  }, `${seasonId}|${tab}|${category}|${limit}`);
  return { ...state, reload };
}

export function useCompetitionAwards(seasonId: string, matchday: number | null) {
  const { state, reload } = useLoad<{ awards: CompetitionAwards | null }>(async () => {
    const { awards, error } = await getCompetitionAwards(seasonId, matchday);
    return error ? { error: error.message } : { value: { awards } };
  }, `${seasonId}|${matchday}`);
  return { ...state, reload };
}

export function useCompetitionPowerRanking(seasonId: string) {
  const { state, reload } = useLoad<{ rows: CompetitionPowerRow[] }>(async () => {
    const { rows, error } = await getCompetitionPowerRanking(seasonId);
    return error ? { error: error.message } : { value: { rows } };
  }, seasonId);
  return { ...state, reload };
}

/** The captains I can reach from each table's fixtures. Empty for anyone who
 *  isn't a captain there; a failed read only hides the message buttons. */
export function useCaptainContacts(tableIds: string[]) {
  const key = [...tableIds].sort().join(',');
  const { state } = useLoad<{ contacts: CaptainContact[] }>(async () => {
    const lists = await Promise.all(tableIds.map((id) => fetchLeagueCaptainContacts(id).catch(() => [] as CaptainContact[])));
    return { value: { contacts: lists.flat() } };
  }, key);
  return state.status === 'ready' ? state.contacts : [];
}
