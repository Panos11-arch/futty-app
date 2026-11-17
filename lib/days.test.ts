import { runInThisContext } from 'node:vm';

import { dateKeyToDate, dayLabel, isToday } from '@/lib/days';

// "Today" is the Cyprus date (Asia/Nicosia), whatever zone the phone is set to.
// Each test sets the phone's zone, then labels a Cyprus day as the screens do:
// dayLabel(dateKeyToDate(booking_day)).

// Jest gives each test file a copy of process.env, so setting TZ on it doesn't
// change Date's local zone. Node only re-reads TZ when it is set on the real
// process, which lives outside Jest's sandbox.
const realProcess = runInThisContext('process') as NodeJS.Process;
const realTz = realProcess.env.TZ;

function onPhoneIn(timeZone: string) {
  realProcess.env.TZ = timeZone;
}

afterEach(() => {
  if (realTz === undefined) delete realProcess.env.TZ;
  else realProcess.env.TZ = realTz;
});

function label(day: string, nowUtc: string) {
  return dayLabel(dateKeyToDate(day), new Date(nowUtc));
}

describe('the phone zone really changes in these tests', () => {
  it('reads London, New York and Tokyo', () => {
    const instant = new Date('2026-11-16T22:30:00Z');
    onPhoneIn('Europe/London');
    expect(instant.getDate()).toBe(16);
    onPhoneIn('America/New_York');
    expect(instant.getHours()).toBe(17);
    onPhoneIn('Asia/Tokyo');
    expect(instant.getDate()).toBe(17);
  });
});

describe('dayLabel uses the Cyprus date, not the phone date', () => {
  it('London: 00:30 Tuesday in Cyprus is still Monday 22:30 on the phone', () => {
    onPhoneIn('Europe/London');
    const now = '2026-11-16T22:30:00Z';
    expect(label('2026-11-17', now)).toBe('Today');
    expect(label('2026-11-16', now)).not.toBe('Today');
    expect(label('2026-11-16', now)).toContain('16');
  });

  it('New York: 06:00 Tuesday in Cyprus is still Monday 23:00 on the phone', () => {
    onPhoneIn('America/New_York');
    const now = '2026-11-17T04:00:00Z';
    expect(label('2026-11-17', now)).toBe('Today');
    expect(label('2026-11-16', now)).not.toBe('Today');
  });

  it('Tokyo: 23:30 Monday in Cyprus is already Tuesday 06:30 on the phone', () => {
    onPhoneIn('Asia/Tokyo');
    const now = '2026-11-16T21:30:00Z';
    expect(label('2026-11-16', now)).toBe('Today');
    expect(label('2026-11-17', now)).not.toBe('Today');
    expect(label('2026-11-17', now)).toContain('17');
  });

  it('a phone on Cyprus time agrees with itself', () => {
    onPhoneIn('Asia/Nicosia');
    expect(label('2026-11-17', '2026-11-17T10:00:00Z')).toBe('Today');
  });
});

describe('around midnight Cyprus time', () => {
  it.each(['Europe/London', 'America/New_York', 'Asia/Tokyo'])('%s: flips at Cyprus midnight', (zone) => {
    onPhoneIn(zone);
    // Winter: Cyprus is UTC+2, so midnight starting 17 Nov is 22:00 UTC on 16 Nov.
    expect(label('2026-11-16', '2026-11-16T21:59:59Z')).toBe('Today');
    expect(label('2026-11-17', '2026-11-16T21:59:59Z')).not.toBe('Today');
    expect(label('2026-11-17', '2026-11-16T22:00:00Z')).toBe('Today');
    expect(label('2026-11-16', '2026-11-16T22:00:00Z')).not.toBe('Today');
  });
});

describe('across a daylight-saving change', () => {
  it.each(['Europe/London', 'America/New_York', 'Asia/Tokyo'])(
    '%s: autumn, Cyprus back to UTC+2 on 25 Oct 2026',
    (zone) => {
      onPhoneIn(zone);
      // Midnight starting 25 Oct is still summer time: 21:00 UTC on 24 Oct.
      expect(label('2026-10-24', '2026-10-24T20:59:59Z')).toBe('Today');
      expect(label('2026-10-25', '2026-10-24T21:00:00Z')).toBe('Today');
      // Midnight starting 26 Oct is winter time: 22:00 UTC on 25 Oct, not 21:00.
      expect(label('2026-10-25', '2026-10-25T21:30:00Z')).toBe('Today');
      expect(label('2026-10-26', '2026-10-25T21:30:00Z')).not.toBe('Today');
      expect(label('2026-10-26', '2026-10-25T22:00:00Z')).toBe('Today');
    },
  );

  it.each(['Europe/London', 'America/New_York', 'Asia/Tokyo'])(
    '%s: spring, Cyprus forward to UTC+3 on 28 Mar 2027',
    (zone) => {
      onPhoneIn(zone);
      // Midnight starting 28 Mar is still winter time: 22:00 UTC on 27 Mar.
      expect(label('2027-03-27', '2027-03-27T21:59:59Z')).toBe('Today');
      expect(label('2027-03-28', '2027-03-27T22:00:00Z')).toBe('Today');
      // Midnight starting 29 Mar is summer time: 21:00 UTC on 28 Mar, not 22:00.
      expect(label('2027-03-28', '2027-03-28T20:59:59Z')).toBe('Today');
      expect(label('2027-03-29', '2027-03-28T21:00:00Z')).toBe('Today');
      expect(label('2027-03-28', '2027-03-28T21:30:00Z')).not.toBe('Today');
    },
  );

  it('the week New York has changed clocks and Cyprus has not', () => {
    onPhoneIn('America/New_York');
    // US summer time starts 14 Mar 2027, Cyprus's on 28 Mar: New York is 6 hours
    // behind Cyprus that week, not 7. 23:30 on 20 Mar in Cyprus is 17:30 there.
    expect(label('2027-03-20', '2027-03-20T21:30:00Z')).toBe('Today');
    expect(label('2027-03-21', '2027-03-20T22:00:00Z')).toBe('Today');
  });
});

describe('isToday', () => {
  it('defaults to now and compares with the Cyprus date', () => {
    onPhoneIn('Asia/Tokyo');
    jest.useFakeTimers({ now: new Date('2026-11-16T21:30:00Z') });
    try {
      expect(isToday(dateKeyToDate('2026-11-16'))).toBe(true);
      expect(isToday(dateKeyToDate('2026-11-17'))).toBe(false);
      expect(dayLabel(dateKeyToDate('2026-11-16'))).toBe('Today');
    } finally {
      jest.useRealTimers();
    }
  });
});
