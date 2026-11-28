// Home's "Featured event" (S3; spec 15 section 0.6, image 01). From S10B its
// source is tournaments, not leagues (match-record.md 1o item 12: "Home's
// featured card keeps leagues as its source until S10B").
import { featuredEventRoute, getFeaturedEvent } from '@/lib/featured-event';
import type { TournamentHeader } from '@/lib/match/tournament-api';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

const tournament = (over: Partial<TournamentHeader> = {}): TournamentHeader => ({
  id: 't1',
  name: 'Nuevo Campo Cup',
  area: 'Limassol',
  country: 'CY',
  format: '5-a-side',
  status: 'registration',
  comingSoon: false,
  startDate: '2026-12-06',
  endDate: '2026-12-14',
  venueId: 'v1',
  venueName: 'Nuevo Campo',
  maxTeams: 16,
  teamsCount: 9,
  entryFeeCents: 1200,
  championTeamId: null,
  ...over,
});

describe('getFeaturedEvent (S10B: tournaments)', () => {
  const today = '2026-11-28';

  it('a tournament in sign-up is featured, with its facts', () => {
    expect(getFeaturedEvent([tournament()], today)).toEqual({
      id: 't1',
      kind: 'tournament',
      name: 'Nuevo Campo Cup',
      format: '5-a-side',
      startDate: '2026-12-06',
      comingSoon: false,
    });
  });

  it('picks the soonest start among those in sign-up', () => {
    const later = tournament({ id: 'later', startDate: '2027-01-10', endDate: '2027-01-11' });
    const sooner = tournament({ id: 'sooner', startDate: '2026-12-01', endDate: '2026-12-02' });
    expect(getFeaturedEvent([later, sooner], today)?.id).toBe('sooner');
  });

  it('nothing in sign-up: no event, so Home hides the section', () => {
    expect(getFeaturedEvent([], today)).toBeNull();
    expect(
      getFeaturedEvent([tournament({ status: 'groups' }), tournament({ id: 't2', status: 'finished' }), tournament({ id: 't3', status: 'cancelled' as never })], today),
    ).toBeNull();
  });

  it('a start already gone (in Cyprus) is not featured; today still is', () => {
    expect(getFeaturedEvent([tournament({ startDate: '2026-11-27', endDate: '2026-11-29' })], today)).toBeNull();
    expect(getFeaturedEvent([tournament({ startDate: '2026-11-28', endDate: '2026-11-29' })], today)?.id).toBe('t1');
  });

  it('a Coming soon tournament is featured only when nothing is in sign-up, and shows Coming soon (1o item 2)', () => {
    const soon = tournament({ id: 'soon', status: 'coming_soon', comingSoon: true, startDate: null, endDate: null });
    expect(getFeaturedEvent([soon, tournament()], today)?.id).toBe('t1');
    expect(getFeaturedEvent([soon], today)).toMatchObject({ id: 'soon', comingSoon: true, startDate: null });
  });
});

describe('featuredEventRoute', () => {
  it('opens the tournament page', () => {
    expect(
      featuredEventRoute({ id: 't1', kind: 'tournament', name: 'x', format: '5-a-side', startDate: '2026-12-06', comingSoon: false }),
    ).toEqual({ pathname: '/leagues/tournament/[id]', params: { id: 't1' } });
  });
});
