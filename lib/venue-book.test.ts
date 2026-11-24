import { bookTimes, continueLine, dayCell, venueSlot } from './venue-book';

// booking-search (endTime) also holds the booking screens' server calls.
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

describe('dayCell', () => {
  it('the weekday and the date, read as a Cyprus calendar day', () => {
    expect(dayCell('2026-11-26')).toEqual({ weekday: 'Thu', date: '26', label: 'Thu 26 Nov' });
    expect(dayCell('2026-12-01')).toEqual({ weekday: 'Tue', date: '1', label: 'Tue 1 Dec' });
  });
});

describe('bookTimes', () => {
  const slots = [
    { start: '18:00', end: '19:00', available: false, priceCents: null },
    { start: '18:30', end: '19:30', available: true, priceCents: 6000 },
    { start: '19:00', end: '20:00', available: true, priceCents: 6000 },
  ];

  it('every start in the hours; one the server didn\'t list is taken', () => {
    expect(bookTimes(slots, '2026-11-26', new Date('2026-11-25T10:00:00Z'))).toEqual([
      { start: '18:00', taken: true },
      { start: '18:30', taken: false },
      { start: '19:00', taken: false },
    ]);
  });

  it('a start already past in Cyprus isn\'t shown at all', () => {
    // 16:45 UTC is 18:45 in Cyprus (UTC+2 in November).
    expect(bookTimes(slots, '2026-11-26', new Date('2026-11-26T16:45:00Z'))).toEqual([{ start: '19:00', taken: false }]);
  });
});

describe('venueSlot', () => {
  it('the slot checkout prices, with the end from the length', () => {
    expect(venueSlot('v1', { day: '2026-11-26', start: '20:00', minutes: 90, format: '5-a-side', playersPerSide: 5 })).toEqual({
      venueId: 'v1',
      day: '2026-11-26',
      start: '20:00',
      end: '21:30',
      format: '5-a-side',
      playersPerSide: 5,
    });
  });

  it('nothing until a time is chosen, or when the game would run past midnight', () => {
    expect(venueSlot('v1', { day: '2026-11-26', start: null, minutes: 60, format: '5-a-side', playersPerSide: 5 })).toBeNull();
    expect(venueSlot('v1', { day: '2026-11-26', start: '23:30', minutes: 60, format: '5-a-side', playersPerSide: 5 })).toBeNull();
    expect(venueSlot('v1', { day: '2026-11-26', start: '20:00', minutes: 60, format: null, playersPerSide: 5 })).toBeNull();
  });
});

describe('continueLine', () => {
  it('the bar above Continue: the day and time, then the pitch and format', () => {
    expect(continueLine('2026-11-26', '20:00', 'Pitch 2', '5-a-side')).toEqual({
      title: 'Thu 26 Nov · 20:00',
      subtitle: 'Pitch 2 · 5-a-side',
    });
    expect(continueLine('2026-11-26', '20:00', null, '5-a-side').subtitle).toBe('5-a-side');
  });
});
