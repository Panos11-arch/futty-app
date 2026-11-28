// S10B: the Events list ("Join an event" on Home; Playtomic 06). An event is a
// tournament for now: its card shows date | time, name, "Tournament", format,
// teams "9/16", venue and "€12 per player", all from the server's header.
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

import { eventCard, eventRoute, filterEvents, upcomingEvents, type EventFilters } from '@/lib/events';
import type { TournamentHeader } from '@/lib/match/tournament-api';

const t = (over: Partial<TournamentHeader & { firstKickoffAt: string | null }> = {}) => ({
  id: 't1',
  name: 'Nuevo Campo Cup',
  area: 'Limassol',
  country: 'CY',
  format: '5-a-side',
  status: 'registration' as const,
  comingSoon: false,
  startDate: '2026-12-06',
  endDate: '2026-12-14',
  venueId: 'v1',
  venueName: 'Nuevo Campo',
  maxTeams: 16,
  teamsCount: 9,
  entryFeeCents: 1200,
  championTeamId: null,
  firstKickoffAt: '2026-12-06T08:00:00Z',
  ...over,
});

describe('eventCard', () => {
  it('date | time, name, Tournament, format, teams, venue and price', () => {
    expect(eventCard(t())).toEqual({
      id: 't1',
      when: 'Sun 6 Dec | 10:00',
      name: 'Nuevo Campo Cup',
      type: 'Tournament',
      format: '5-a-side',
      teams: '9/16',
      place: 'Nuevo Campo',
      price: '€12 per player',
    });
  });

  it('no kick-off yet: the date only; no dates: Coming soon', () => {
    expect(eventCard(t({ firstKickoffAt: null })).when).toBe('Sun 6 Dec');
    expect(eventCard(t({ firstKickoffAt: null, startDate: null, endDate: null })).when).toBe('Coming soon');
  });

  it('no venue: the area; cents shown when not whole euros; free: no price', () => {
    expect(eventCard(t({ venueId: null, venueName: null })).place).toBe('Limassol');
    expect(eventCard(t({ entryFeeCents: 650 })).price).toBe('€6.50 per player');
    expect(eventCard(t({ entryFeeCents: 0 })).price).toBeNull();
  });
});

describe('upcomingEvents', () => {
  it('leaves out finished and cancelled ones; soonest first, Coming soon last', () => {
    const list = [
      t({ id: 'late', startDate: '2027-01-10', endDate: '2027-01-11' }),
      t({ id: 'soon', status: 'coming_soon', comingSoon: true, startDate: null, endDate: null }),
      t({ id: 'done', status: 'finished' }),
      t({ id: 'off', status: 'cancelled' as never }),
      t({ id: 'early', startDate: '2026-12-01', endDate: '2026-12-02' }),
    ];
    expect(upcomingEvents(list).map((e) => e.id)).toEqual(['early', 'late', 'soon']);
  });
});

describe('filterEvents: search, then the Format, Day and Type chips', () => {
  const list = [
    t({ id: 'a', name: 'Nuevo Campo Cup', format: '5-a-side', startDate: '2026-12-06', endDate: '2026-12-14' }),
    t({ id: 'b', name: 'Paphos Sevens', venueName: 'Paphos Arena', area: 'Paphos', format: '7-a-side', startDate: '2026-12-20', endDate: '2026-12-20' }),
  ];
  const none: EventFilters = { query: '', format: null, day: null, type: null };

  it('nothing chosen: all', () => {
    expect(filterEvents(list, none).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('search: name, venue or area, any case', () => {
    expect(filterEvents(list, { ...none, query: 'paphos' }).map((e) => e.id)).toEqual(['b']);
    expect(filterEvents(list, { ...none, query: 'CUP' }).map((e) => e.id)).toEqual(['a']);
  });

  it('format, and a day inside the event\'s dates', () => {
    expect(filterEvents(list, { ...none, format: '7-a-side' }).map((e) => e.id)).toEqual(['b']);
    expect(filterEvents(list, { ...none, day: '2026-12-10' }).map((e) => e.id)).toEqual(['a']);
    expect(filterEvents(list, { ...none, day: '2026-12-25' })).toEqual([]);
  });

  it('type: tournaments', () => {
    expect(filterEvents(list, { ...none, type: 'tournament' }).map((e) => e.id)).toEqual(['a', 'b']);
  });
});

describe('eventRoute', () => {
  it('opens the tournament page', () => {
    expect(eventRoute('t1')).toEqual({ pathname: '/leagues/tournament/[id]', params: { id: 't1' } });
  });
});
