import { cyprusWallTime } from './cyprus-time';

describe('cyprusWallTime', () => {
  it('reads a winter time as UTC+2', () => {
    expect(cyprusWallTime('2026-12-05', '19:00:00').toISOString()).toBe('2026-12-05T17:00:00.000Z');
  });

  it('reads a summer time as UTC+3', () => {
    expect(cyprusWallTime('2026-07-05', '19:00').toISOString()).toBe('2026-07-05T16:00:00.000Z');
  });

  it('uses the new offset on the day clocks go back (25 October 2026)', () => {
    // 04:00 EEST becomes 03:00 EET at 01:00 UTC, so an evening game is UTC+2.
    expect(cyprusWallTime('2026-10-25', '19:00').toISOString()).toBe('2026-10-25T17:00:00.000Z');
    // Just before the change it is still summer time.
    expect(cyprusWallTime('2026-10-25', '02:00').toISOString()).toBe('2026-10-24T23:00:00.000Z');
  });

  it('uses the new offset on the day clocks go forward (29 March 2026)', () => {
    expect(cyprusWallTime('2026-03-29', '19:00').toISOString()).toBe('2026-03-29T16:00:00.000Z');
    expect(cyprusWallTime('2026-03-29', '01:00').toISOString()).toBe('2026-03-28T23:00:00.000Z');
  });

  it('reads a Cyprus late-evening time as the right UTC day', () => {
    // 00:30 in Cyprus is still the previous day in UTC.
    expect(cyprusWallTime('2026-12-06', '00:30').toISOString()).toBe('2026-12-05T22:30:00.000Z');
  });

  it('treats 24:00 as midnight at the end of the day', () => {
    expect(cyprusWallTime('2026-12-05', '24:00:00').toISOString()).toBe('2026-12-05T22:00:00.000Z');
  });

  it('rejects malformed input', () => {
    expect(() => cyprusWallTime('05/12/2026', '19:00')).toThrow();
    expect(() => cyprusWallTime('2026-12-05', 'seven')).toThrow();
  });
});
