import {
  EMPTY_FORM,
  cyprusDayTime,
  cyprusInstant,
  formFromTournament,
  toTournamentChanges,
  toTournamentInput,
} from '@/lib/match/tournament-form';
import type { Tournament } from '@/lib/match/tournament-api';

const form = { ...EMPTY_FORM, name: ' Nuevo Campo Cup ', area: 'Limassol', entryFee: '12', matchMinutes: '50' };

describe('toTournamentInput', () => {
  it('Coming soon: no dates, no deadline; the fee in whole cents', () => {
    expect(toTournamentInput(form)).toEqual({
      input: {
        name: 'Nuevo Campo Cup',
        area: 'Limassol',
        venueId: null,
        format: '5-a-side',
        startDate: null,
        endDate: null,
        registrationDeadline: null,
        squadSubs: 2,
        entryFeeCents: 1200,
        matchMinutes: 50,
      },
    });
  });

  it('dates and a deadline in Cyprus time', () => {
    const r = toTournamentInput({
      ...form,
      entryFee: '12,50',
      startDate: '2026-12-06',
      endDate: '2026-12-14',
      deadlineDay: '2026-12-01',
      deadlineTime: '20:00',
    });
    expect(r).toMatchObject({
      input: { entryFeeCents: 1250, startDate: '2026-12-06', endDate: '2026-12-14', registrationDeadline: '2026-12-01T18:00:00.000Z' },
    });
  });

  it.each([
    [{ name: ' ' }, 'invalid_tournament'],
    [{ area: '' }, 'invalid_tournament'],
    [{ entryFee: 'twelve' }, 'invalid_entry_fee'],
    [{ entryFee: '' }, 'invalid_entry_fee'],
    [{ matchMinutes: '' }, 'invalid_match_minutes'],
    [{ matchMinutes: '50.5' }, 'invalid_match_minutes'],
    [{ startDate: '6 Dec' }, 'invalid_dates'],
    [{ endDate: '2026-12-14' }, 'invalid_dates'],
    [{ startDate: '2026-12-14', endDate: '2026-12-06' }, 'invalid_dates'],
    [{ startDate: '2026-12-06', endDate: 'soon' }, 'invalid_dates'],
    [{ deadlineDay: '2026-12-01' }, 'invalid_dates'],
    [{ deadlineDay: '2026-12-01', deadlineTime: '25:00' }, 'invalid_dates'],
  ])('%j is refused with %s', (change, error) => {
    expect(toTournamentInput({ ...form, ...change })).toEqual({ error });
  });
});

describe('Cyprus times', () => {
  it('a Cyprus day and time is the right instant, winter and summer', () => {
    expect(cyprusInstant('2026-12-06', '19:00')).toBe('2026-12-06T17:00:00.000Z');
    expect(cyprusInstant('2026-07-06', '19:00')).toBe('2026-07-06T16:00:00.000Z');
    expect(cyprusInstant('2026-12-06', '19:60')).toBeNull();
    expect(cyprusInstant('x', '19:00')).toBeNull();
  });

  it('and back', () => {
    expect(cyprusDayTime('2026-12-06T17:00:00.000Z')).toEqual({ day: '2026-12-06', time: '19:00' });
    expect(cyprusDayTime('2026-12-06T22:30:00.000Z')).toEqual({ day: '2026-12-07', time: '00:30' });
  });
});

describe('formFromTournament', () => {
  const t = {
    id: 't1',
    name: 'Cup',
    area: 'Limassol',
    venueId: 'v1',
    format: '7-a-side',
    startDate: '2026-12-06',
    endDate: null,
    registrationDeadline: '2026-12-01T18:00:00.000Z',
    squadMin: 7,
    squadMax: 8,
    entryFeeCents: 650,
    matchMinutes: 40,
  } as Tournament;

  it('fills the form, the subs from the squad limits', () => {
    expect(formFromTournament(t)).toEqual({
      name: 'Cup',
      area: 'Limassol',
      venueId: 'v1',
      format: '7-a-side',
      startDate: '2026-12-06',
      endDate: '',
      deadlineDay: '2026-12-01',
      deadlineTime: '20:00',
      squadSubs: 1,
      entryFee: '6.50',
      matchMinutes: '40',
    });
  });

  it('defaults what the header alone lacks', () => {
    const header = { ...t, registrationDeadline: undefined, squadMin: undefined, squadMax: undefined, matchMinutes: undefined };
    expect(formFromTournament(header)).toMatchObject({ deadlineDay: '', deadlineTime: '', squadSubs: 2, matchMinutes: '' });
  });
});

describe('toTournamentChanges', () => {
  it('only what changed', () => {
    expect(toTournamentChanges(form, { ...form, startDate: '2026-12-06' })).toEqual({ input: { startDate: '2026-12-06' } });
    expect(toTournamentChanges(form, form)).toEqual({ input: {} });
  });

  it('a Coming soon header has no deadline or length: they stay unsent', () => {
    const header = { ...form, matchMinutes: '' };
    expect(toTournamentChanges(header, { ...header, entryFee: '15' })).toEqual({ input: { entryFeeCents: 1500 } });
    expect(toTournamentChanges(header, { ...header, matchMinutes: '40' })).toEqual({ input: { matchMinutes: 40 } });
  });

  it('a bad field is refused', () => {
    expect(toTournamentChanges(form, { ...form, entryFee: 'x' })).toEqual({ error: 'invalid_entry_fee' });
  });

  it('an initial form that was never valid sends every field', () => {
    expect(toTournamentChanges({ ...form, name: '' }, form)).toMatchObject({ input: { name: 'Nuevo Campo Cup', matchMinutes: 50 } });
  });
});
