import { formatsOffered, isoWeekday, minToTime, playersForFormat, slotGrid, timeToMin } from './booking';

describe('formatsOffered', () => {
  it('is what the venue\'s open pitches host, plus what its combinations make, smallest first', () => {
    expect(
      formatsOffered(
        [
          { formats: ['7-a-side', '5-a-side'], is_open: true },
          { formats: ['9-a-side'], is_open: false },
          { formats: ['5-a-side', '6-a-side'], is_open: true },
        ],
        [{ format: '11-a-side' }],
      ),
    ).toEqual(['5-a-side', '6-a-side', '7-a-side', '11-a-side']);
  });

  it('is nothing for a venue with no pitches (an imported venue before its pitches are entered)', () => {
    expect(formatsOffered([], [])).toEqual([]);
  });
});

describe('slotGrid', () => {
  const hours = { opens: '18:00:00', closes: '21:00:00' };

  it('lays the opening hours out every 30 minutes; only the server\'s free slots can be booked, with its price', () => {
    const free = [
      { start_time: '18:30:00', end_time: '19:30:00', price_cents: 6000 },
      { start_time: '20:00:00', end_time: '21:00:00', price_cents: 7000 },
    ];
    expect(slotGrid(hours, free, 60)).toEqual([
      { start: '18:00', end: '19:00', available: false, priceCents: null },
      { start: '18:30', end: '19:30', available: true, priceCents: 6000 },
      { start: '19:00', end: '20:00', available: false, priceCents: null },
      { start: '19:30', end: '20:30', available: false, priceCents: null },
      { start: '20:00', end: '21:00', available: true, priceCents: 7000 },
    ]);
  });

  it('ends every game by closing time, as venue_free_slots does (a 00:00 close is stored as 23:59:59)', () => {
    const slots = slotGrid({ opens: '22:00:00', closes: '23:59:59' }, [], 60);
    expect(slots.map((s) => s.start)).toEqual(['22:00', '22:30']);
    expect(slotGrid({ opens: '21:00:00', closes: '24:00:00' }, [], 90).map((s) => s.end)).toEqual(['22:30', '23:00', '23:30', '24:00']);
  });

  it('shows nothing on a day without opening hours', () => {
    expect(slotGrid(null, [], 60)).toEqual([]);
  });
});

describe('small helpers', () => {
  it('gives the ISO weekday of a day the same way on every device', () => {
    expect(isoWeekday('2026-11-16')).toBe(1); // Monday
    expect(isoWeekday('2026-11-22')).toBe(7); // Sunday
  });

  it('counts players for a format', () => {
    expect(playersForFormat('5-a-side')).toBe(10);
    expect(playersForFormat('11-a-side')).toBe(22);
    expect(playersForFormat('Training')).toBeNull();
  });

  it('reads and writes times', () => {
    expect(timeToMin('24:00:00')).toBe(1440);
    expect(minToTime(1440)).toBe('24:00');
  });
});
