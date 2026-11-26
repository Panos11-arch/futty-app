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
  // S10 replaces this with the competition page.
  return { pathname: '/leagues/[id]' as const, params: { id: entry.league.id } };
}

export type TournamentRef = { name: string; scope: string; format: string };

/** Tournaments show "Coming soon" until their sign-up opens; S10A adds the
 *  tournament page and its data. */
export function tournamentHref(tournament: TournamentRef) {
  return {
    pathname: '/leagues/coming-soon' as const,
    params: { kind: 'tournament', name: tournament.name, scope: normaliseScope(tournament.scope), format: tournament.format },
  };
}
