import { featuredEventRoute, getFeaturedEvent } from '@/lib/featured-event';
import type { League } from '@/lib/leagues';

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

describe('getFeaturedEvent (S3; events are leagues in sign-up until S10B)', () => {
  const today = '2026-11-26';

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

describe('featuredEventRoute (S10 swaps this one line for its competition page)', () => {
  it('opens Leagues for now', () => {
    expect(featuredEventRoute({ id: 'l1', kind: 'league', name: 'x', format: '5-a-side', startDate: '2026-12-05' })).toBe(
      '/leagues',
    );
  });
});
