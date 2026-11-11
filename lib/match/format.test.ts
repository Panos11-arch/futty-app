import { formatKickoff, formatMatchDate, formatMatchWhen } from '@/lib/match/format';

// Cyprus is UTC+3 until 25 October 2026 at 04:00, UTC+2 after.
const BEFORE_DST_END = '2026-10-24T16:00:00.000Z';
const AFTER_DST_END = '2026-10-31T17:00:00.000Z';

describe('match times in Cyprus time', () => {
  it('reads 19:00 on both sides of the clock change', () => {
    expect(formatKickoff(BEFORE_DST_END)).toBe('19:00');
    expect(formatKickoff(AFTER_DST_END)).toBe('19:00');
  });

  it('formats the day and the full line', () => {
    expect(formatMatchDate(AFTER_DST_END)).toBe('Sat 31 Oct');
    expect(formatMatchWhen('2026-11-14T17:00:00.000Z')).toBe('Sat 14 Nov · 19:00');
  });

  it('puts a late UTC instant on the next Cyprus day', () => {
    expect(formatMatchWhen('2026-11-14T22:30:00.000Z')).toBe('Sun 15 Nov · 00:30');
  });

  describe('whatever the phone time zone', () => {
    const original = process.env.TZ;
    beforeAll(() => {
      process.env.TZ = 'America/New_York';
    });
    afterAll(() => {
      process.env.TZ = original;
    });

    it('still shows Cyprus time', () => {
      expect(formatMatchWhen(AFTER_DST_END)).toBe('Sat 31 Oct · 19:00');
      expect(formatKickoff(BEFORE_DST_END)).toBe('19:00');
    });
  });
});
