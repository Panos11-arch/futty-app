// S10A page: one hook per tournament read (lib/match/tournament-api.ts), as
// lib/match/use-competition.ts does for leagues: loading, error (with
// reload) or ready. A tab's hooks run when that tab first mounts.
import {
  getTournament,
  getTournamentKnockout,
  getTournamentMatches,
  getTournamentStandings,
  isAppAdmin,
  listTournaments,
  type KnockoutSlot,
  type Tournament,
  type TournamentFixture,
  type TournamentHeader,
  type TournamentStandings,
} from '@/lib/match/tournament-api';
import { useLoad } from '@/lib/match/use-match-result';

export function useTournaments() {
  const { state, reload } = useLoad<{ tournaments: TournamentHeader[] }>(async () => {
    const { tournaments, error } = await listTournaments();
    return error ? { error: error.message } : { value: { tournaments } };
  }, 'tournaments');
  return { ...state, reload };
}

export function useTournament(tournamentId: string | null | undefined) {
  const { state, reload } = useLoad<{ tournament: Tournament | null }>(
    tournamentId
      ? async () => {
          const { tournament, error } = await getTournament(tournamentId);
          return error ? { error: error.message } : { value: { tournament } };
        }
      : null,
    `${tournamentId}`,
  );
  return { ...state, reload };
}

export function useTournamentStandings(tournamentId: string) {
  const { state, reload } = useLoad<{ standings: TournamentStandings }>(async () => {
    const { standings, error } = await getTournamentStandings(tournamentId);
    return error ? { error: error.message } : { value: { standings } };
  }, tournamentId);
  return { ...state, reload };
}

export function useTournamentMatches(tournamentId: string, teamId: string | null) {
  const { state, reload } = useLoad<{ matches: TournamentFixture[] }>(async () => {
    const { matches, error } = await getTournamentMatches(tournamentId, teamId);
    return error ? { error: error.message } : { value: { matches } };
  }, `${tournamentId}|${teamId}`);
  return { ...state, reload };
}

export function useTournamentKnockout(tournamentId: string) {
  const { state, reload } = useLoad<{ slots: KnockoutSlot[] }>(async () => {
    const { slots, error } = await getTournamentKnockout(tournamentId);
    return error ? { error: error.message } : { value: { slots } };
  }, tournamentId);
  return { ...state, reload };
}

/** Shows the admin screen's entry; a failed check hides it. */
export function useIsAppAdmin() {
  const { state, reload } = useLoad<{ admin: boolean }>(async () => {
    const { admin, error } = await isAppAdmin();
    return error ? { error: error.message } : { value: { admin } };
  }, 'is-app-admin');
  return { admin: state.status === 'ready' && state.admin, reload };
}
