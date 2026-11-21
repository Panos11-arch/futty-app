import { addDays, cyprusToday, cyprusWallTime, e2eSlot, E2E_START } from './slot';

const HOUR = 3_600_000;

describe('cyprusToday: Cyprus, not UTC', () => {
  it('after midnight in Cyprus it is already tomorrow (UTC still says today)', () => {
    // 00:30 in Cyprus on 22 November (UTC+2), 22:30 UTC on the 21st.
    expect(cyprusToday(new Date('2026-11-21T22:30:00Z'))).toBe('2026-11-22');
  });

  it('in summer Cyprus is UTC+3', () => {
    expect(cyprusToday(new Date('2026-07-01T21:30:00Z'))).toBe('2026-07-02');
    expect(cyprusToday(new Date('2026-07-01T20:30:00Z'))).toBe('2026-07-01');
  });
});

describe('cyprusWallTime', () => {
  it('winter and summer offsets', () => {
    expect(cyprusWallTime('2026-11-23', '19:00').toISOString()).toBe('2026-11-23T17:00:00.000Z');
    expect(cyprusWallTime('2026-07-23', '19:00').toISOString()).toBe('2026-07-23T16:00:00.000Z');
  });

  it('on the days the clocks change', () => {
    expect(cyprusWallTime('2026-03-29', '19:00').toISOString()).toBe('2026-03-29T16:00:00.000Z');
    expect(cyprusWallTime('2026-10-25', '19:00').toISOString()).toBe('2026-10-25T17:00:00.000Z');
  });
});

describe('e2eSlot: always in the future in Cyprus time', () => {
  // Every half hour across two years, which covers both daylight-saving
  // changes and every Cyprus midnight.
  const nows: Date[] = [];
  for (let t = Date.parse('2026-01-01T00:00:00Z'); t < Date.parse('2028-01-01T00:00:00Z'); t += 30 * 60_000) {
    nows.push(new Date(t));
  }

  it.each(['ios', 'android'] as const)('%s: two days after Cyprus today, more than 6 hours ahead, inside the 7-day window', (platform) => {
    for (const now of nows) {
      const slot = e2eSlot(platform, now);
      const today = cyprusToday(now);
      expect(slot.day).toBe(addDays(today, 2));
      expect(slot.kickoffAt.getTime()).toBeGreaterThan(now.getTime() + 6 * HOUR);
      expect(slot.day <= addDays(today, 7)).toBe(true);
      // The kickoff is that wall-clock time in Cyprus, on that day.
      expect(cyprusToday(slot.kickoffAt)).toBe(slot.day);
      expect(slot.kickoffAt.toLocaleTimeString('en-GB', { timeZone: 'Asia/Nicosia', hour: '2-digit', minute: '2-digit' })).toBe(
        E2E_START[platform],
      );
    }
  });

  it('iOS and Android book different hours, 60 minutes each', () => {
    const now = new Date('2026-11-21T08:00:00Z');
    expect(e2eSlot('ios', now)).toMatchObject({ day: '2026-11-23', start: '19:00', end: '20:00' });
    expect(e2eSlot('android', now)).toMatchObject({ day: '2026-11-23', start: '20:00', end: '21:00' });
  });

  it('just after midnight in Cyprus, the slot moves with Cyprus, not UTC', () => {
    expect(e2eSlot('ios', new Date('2026-11-21T22:30:00Z')).day).toBe('2026-11-24');
  });
});
