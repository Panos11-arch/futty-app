// S9: where a tap on the Leagues screen goes. One place for each, so S10
// (the league page) changes only leagueHref and S10A (the tournament page)
// only tournamentHref.
import { normaliseScope, type CompetitionEntry } from '@/lib/match/league-directory';

/** A league with no season in sign-up or running opens "Coming soon";
 *  otherwise its page (the join flow is there while it's in sign-up). */
export function leagueHref(entry: Pick<CompetitionEntry, 'state' | 'scope' | 'format' | 'league' | 'name'>) {
  if (entry.state === 'coming_soon' || !entry.league) {
    return { pathname: '/leagues/coming-soon' as const, params: { name: entry.name, scope: entry.scope, format: entry.format } };
  }
  // S10's competition page.
  return { pathname: '/leagues/[id]' as const, params: { id: entry.league.id } };
}

export type TournamentRef = { id: string; name: string; area: string; format: string; maxTeams: number; comingSoon: boolean };

/** S10A: a tournament shows "Coming soon" (image 17) until its sign-up
 *  opens; then its page. */
export function tournamentHref(tournament: TournamentRef) {
  if (tournament.comingSoon) {
    return {
      pathname: '/leagues/coming-soon' as const,
      params: {
        kind: 'tournament',
        name: tournament.name,
        scope: normaliseScope(tournament.area),
        format: tournament.format,
        teams: String(tournament.maxTeams),
      },
    };
  }
  return { pathname: '/leagues/tournament/[id]' as const, params: { id: tournament.id } };
}
