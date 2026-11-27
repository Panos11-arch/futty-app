import { featuredEventRoute, getFeaturedEvent, registrationOpen, type FeaturedTournament } from '@/lib/featured-event';
import type { League } from '@/lib/leagues';
import type { TournamentHeader } from '@/lib/match/tournament-api';

// lib/premium (Team Premium's flag) loads the Supabase client.
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const league = (over: Partial<League> = {}): League => ({
  id: 'l1',
  name: 'Limassol 5-a-side League',
  format: '5-a-side',
  scope: 'Limassol',
  stage: 'signup',
  start_date: '2026-12-05',
  season_weeks: 10,
  capacity: 16,
  parent_league_id: null,
  ...over,
});

describe('getFeaturedEvent: leagues (S3; when no tournament is featured)', () => {
  const today = '2026-11-26';

  // S9: 9 and 11-a-side show Coming soon while Team Premium is off, so Home
  // never features them as "Sign-up open".
  it('never features a 9 or 11-a-side league while Team Premium is off; the next open one instead', () => {
    const nine = league({ id: 'l9', format: '9-a-side', start_date: '2026-11-28' });
    const eleven = league({ id: 'l11', format: '11-a-side', start_date: '2026-11-29' });
    expect(getFeaturedEvent([nine, eleven, league()], today)?.id).toBe('l1');
    expect(getFeaturedEvent([nine, eleven], today)).toBeNull();
  });

  it('features them once Team Premium is on', () => {
    const nine = league({ id: 'l9', format: '9-a-side', start_date: '2026-11-28' });
    expect(getFeaturedEvent([nine, league()], today, { teamPremiumEnabled: true })?.id).toBe('l9');
  });

  it('nothing in sign-up: no event, so Home hides the section', () => {
    expect(getFeaturedEvent([], today)).toBeNull();
    expect(getFeaturedEvent([league({ stage: 'season' }), league({ id: 'l2', stage: 'divisions' })], today)).toBeNull();
  });

  it('a league in sign-up that starts later is featured, with its facts', () => {
    expect(getFeaturedEvent([league()], today)).toEqual({
      id: 'l1',
      kind: 'league',
      name: 'Limassol 5-a-side League',
      format: '5-a-side',
      startDate: '2026-12-05',
    });
  });

  it('picks the soonest start', () => {
    const later = league({ id: 'later', start_date: '2027-01-10' });
    const sooner = league({ id: 'sooner', start_date: '2026-12-01' });
    expect(getFeaturedEvent([later, sooner], today)?.id).toBe('sooner');
  });

  it('a start date already gone (in Cyprus) is not featured; today still is', () => {
    expect(getFeaturedEvent([league({ start_date: '2026-11-25' })], today)).toBeNull();
    expect(getFeaturedEvent([league({ start_date: '2026-11-26' })], today)?.id).toBe('l1');
  });

  it('a league with no start date yet is not featured (no date to show)', () => {
    expect(getFeaturedEvent([league({ start_date: null })], today)).toBeNull();
  });

  it('a division under a hub is never featured, only the top league', () => {
    expect(getFeaturedEvent([league({ parent_league_id: 'hub' })], today)).toBeNull();
  });

  it('a league without a name gets its format and area', () => {
    expect(getFeaturedEvent([league({ name: '' })], today)?.name).toBe('5-a-side Limassol');
    expect(getFeaturedEvent([league({ name: null as unknown as string })], today)?.name).toBe('5-a-side Limassol');
  });
});

describe('featuredEventRoute (S10)', () => {
  it('opens the league’s competition page', () => {
    expect(featuredEventRoute({ id: 'l1', kind: 'league', name: 'x', format: '5-a-side', startDate: '2026-12-05' })).toEqual({
      pathname: '/leagues/[id]',
      params: { id: 'l1' },
    });
  });
});

// S10B (decided 27 November): a tournament comes before a league; sign-up
// open first, then Coming soon; ties by start date, then name. Finished
// tournaments, and ones whose registration has closed, are never featured.
const cup = (over: Partial<TournamentHeader> = {}): TournamentHeader => ({
  id: 't1',
  name: 'Nuevo Campo Cup',
  area: 'Limassol',
  country: 'Cyprus',
  format: '5-a-side',
  status: 'coming_soon',
  comingSoon: true,
  startDate: '2026-12-12',
  endDate: '2026-12-13',
  venueId: null,
  venueName: null,
  maxTeams: 16,
  teamsCount: 0,
  entryFeeCents: 1200,
  championTeamId: null,
  ...over,
});
const open = (over: Partial<TournamentHeader> = {}) => cup({ status: 'registration', comingSoon: false, ...over });

describe('getFeaturedEvent: tournaments (S10B)', () => {
  const today = '2026-11-27';
  // 12:00 in Cyprus (UTC+2 in winter).
  const now = new Date('2026-11-27T10:00:00Z');
  const pick = (tournaments: TournamentHeader[], deadlines: Record<string, string | null | 'failed'> = {}, leagues: League[] = []) =>
    getFeaturedEvent(leagues, today, { tournaments, deadlines, now });

  it('a tournament comes before a league, with its facts', () => {
    const event = pick([cup()], {}, [league({ start_date: '2026-11-28' })]);
    expect(event).toEqual<FeaturedTournament>({
      id: 't1',
      kind: 'tournament',
      name: 'Nuevo Campo Cup',
      area: 'Limassol',
      format: '5-a-side',
      maxTeams: 16,
      entryFeeCents: 1200,
      comingSoon: true,
      startDate: '2026-12-12',
    });
  });

  it('sign-up open comes before Coming soon, even when Coming soon starts sooner', () => {
    const soon = cup({ id: 'soon', startDate: '2026-12-01' });
    const signup = open({ id: 'signup', startDate: '2027-02-01' });
    expect(pick([soon, signup], { signup: null })?.id).toBe('signup');
  });

  it('ties: the earliest start date, then the name; no date comes last', () => {
    const later = cup({ id: 'later', name: 'A Cup', startDate: '2027-01-10' });
    const sooner = cup({ id: 'sooner', name: 'Z Cup', startDate: '2026-12-05' });
    const undated = cup({ id: 'undated', name: 'A Cup', startDate: null });
    expect(pick([undated, later, sooner])?.id).toBe('sooner');
    expect(pick([undated, later])?.id).toBe('later');
    const b = cup({ id: 'b', name: 'B Cup' });
    const a = cup({ id: 'a', name: 'A Cup' });
    expect(pick([b, a])?.id).toBe('a');
  });

  it('finished, group-stage and knockout tournaments are never featured', () => {
    const played = (['groups', 'knockout', 'finished'] as const).map((status, i) => cup({ id: `p${i}`, status, comingSoon: false }));
    expect(pick(played)).toBeNull();
    expect(pick(played, {}, [league()])?.kind).toBe('league');
  });

  it('sign-up open is featured before its deadline and not after it', () => {
    expect(pick([open()], { t1: '2026-11-27T10:00:01Z' })?.id).toBe('t1');
    expect(pick([open()], { t1: '2026-11-27T10:00:00Z' })).toBeNull();
    expect(pick([open()], { t1: '2026-11-26T18:00:00Z' })).toBeNull();
  });

  it('no deadline: open', () => {
    expect(pick([open()], { t1: null })?.id).toBe('t1');
  });

  it('a failed read (or none) skips that tournament only; the next one is featured', () => {
    const broken = open({ id: 'broken', startDate: '2026-12-01' });
    const fine = open({ id: 'fine', startDate: '2026-12-20' });
    expect(pick([broken, fine], { broken: 'failed', fine: null })?.id).toBe('fine');
    expect(pick([broken, cup({ id: 'soon' })], {})?.id).toBe('soon');
    expect(pick([broken], { broken: 'failed' }, [league()])?.kind).toBe('league');
  });

  it('no tournaments: the league rule as before (Team Premium formats still never featured)', () => {
    const nine = league({ id: 'l9', format: '9-a-side', start_date: '2026-11-28' });
    expect(pick([], {}, [nine, league()])?.id).toBe('l1');
    expect(pick([], {}, [nine])).toBeNull();
    expect(getFeaturedEvent([league()], today)?.kind).toBe('league');
  });
});

describe('registrationOpen (S10B, Cyprus time)', () => {
  it('an instant: open until it passes', () => {
    expect(registrationOpen('2026-12-01T18:00:00Z', new Date('2026-12-01T17:59:59Z'))).toBe(true);
    expect(registrationOpen('2026-12-01T18:00:00Z', new Date('2026-12-01T18:00:00Z'))).toBe(false);
  });

  it('a date: open until the end of that Cyprus day', () => {
    // 23:59 and 00:00 in Cyprus (UTC+2) on either side of midnight.
    expect(registrationOpen('2026-12-01', new Date('2026-12-01T21:59:00Z'))).toBe(true);
    expect(registrationOpen('2026-12-01', new Date('2026-12-01T22:00:00Z'))).toBe(false);
  });

  it('none: open', () => {
    expect(registrationOpen(null, new Date())).toBe(true);
  });
});

describe('featuredEventRoute: tournaments (S10B, through tournamentHref)', () => {
  const event: FeaturedTournament = {
    id: 't1',
    kind: 'tournament',
    name: 'Nuevo Campo Cup',
    area: 'Limassol',
    format: '5-a-side',
    maxTeams: 16,
    entryFeeCents: 1200,
    comingSoon: true,
    startDate: null,
  };

  it('Coming soon opens the Coming soon screen', () => {
    expect(featuredEventRoute(event)).toEqual({
      pathname: '/leagues/coming-soon',
      params: { kind: 'tournament', name: 'Nuevo Campo Cup', scope: 'limassol', format: '5-a-side', teams: '16' },
    });
  });

  it('sign-up open opens the tournament page', () => {
    expect(featuredEventRoute({ ...event, comingSoon: false })).toEqual({
      pathname: '/leagues/tournament/[id]',
      params: { id: 't1' },
    });
  });
});
