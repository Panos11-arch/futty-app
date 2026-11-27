import type { League } from '@/lib/leagues';

import { buildLeagueDirectory } from '@/lib/match/league-directory';
import { leagueHref, tournamentHref } from '@/lib/match/league-routes';

// lib/premium (Team Premium's flag) loads the Supabase client.
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const league = (over: Partial<League>): League => ({
  id: 'l1',
  name: 'Limassol 5s',
  format: '5-a-side',
  scope: 'Limassol',
  stage: 'signup',
  start_date: null,
  season_weeks: null,
  capacity: 8,
  parent_league_id: null,
  ...over,
});

const entries = (leagues: League[]) => buildLeagueDirectory(leagues, []).cities[0].entries;

describe('leagueHref', () => {
  it('a format with no season opens the Coming soon screen with its scope and format', () => {
    const nine = entries([league({})])[3];
    expect(leagueHref(nine)).toEqual({
      pathname: '/leagues/coming-soon',
      params: { name: 'Limassol 9-a-side League', scope: 'limassol', format: '9-a-side' },
    });
  });

  it('a league in sign-up opens its page, where the join flow is', () => {
    expect(leagueHref(entries([league({ stage: 'signup' })])[0])).toEqual({ pathname: '/leagues/[id]', params: { id: 'l1' } });
  });

  it('a running league opens its page', () => {
    expect(leagueHref(entries([league({ stage: 'season' })])[0])).toEqual({ pathname: '/leagues/[id]', params: { id: 'l1' } });
  });
});

describe('tournamentHref', () => {
  const cup = { id: 't1', name: 'Cup', area: 'Limassol', format: '5-a-side', maxTeams: 16 };

  it('opens the Coming soon screen until sign-up opens', () => {
    expect(tournamentHref({ ...cup, comingSoon: true })).toEqual({
      pathname: '/leagues/coming-soon',
      params: { kind: 'tournament', name: 'Cup', scope: 'limassol', format: '5-a-side', teams: '16' },
    });
  });

  it('opens the tournament page once sign-up opens', () => {
    expect(tournamentHref({ ...cup, comingSoon: false })).toEqual({ pathname: '/leagues/tournament/[id]', params: { id: 't1' } });
  });
});
