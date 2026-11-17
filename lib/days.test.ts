import { runInThisContext } from 'node:vm';

import { renderHook } from '@testing-library/react-native';

import {
  dateKeyAndTimeToDate,
  dateKeyToDate,
  dayLabel,
  dayNumberLabel,
  isToday,
  monthLabel,
  nextDays,
  toDateKey,
  useDays,
  weekdayLabel,
} from '@/lib/days';

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

// The matchmaking day chips: useDays() -> nextDays(). The first chip must be
// today in Cyprus, so a phone abroad never skips Cyprus today or offers
// Cyprus yesterday.
function keys(count: number, nowUtc: string) {
  return nextDays(count, new Date(nowUtc)).map(toDateKey);
}

describe('nextDays starts from the Cyprus date, not the phone date', () => {
  it('London: 00:30 Tuesday in Cyprus, still Monday on the phone, starts on Tuesday', () => {
    onPhoneIn('Europe/London');
    expect(keys(3, '2026-11-16T22:30:00Z')).toEqual(['2026-11-17', '2026-11-18', '2026-11-19']);
  });

  it('New York: 06:00 Tuesday in Cyprus, still Monday on the phone, starts on Tuesday', () => {
    onPhoneIn('America/New_York');
    expect(keys(3, '2026-11-17T04:00:00Z')).toEqual(['2026-11-17', '2026-11-18', '2026-11-19']);
  });

  it('Tokyo: 23:30 Monday in Cyprus, already Tuesday on the phone, starts on Monday', () => {
    onPhoneIn('Asia/Tokyo');
    expect(keys(3, '2026-11-16T21:30:00Z')).toEqual(['2026-11-16', '2026-11-17', '2026-11-18']);
  });

  it('the first day is labelled Today and no other is', () => {
    onPhoneIn('Asia/Tokyo');
    const now = new Date('2026-11-16T21:30:00Z');
    const labels = nextDays(3, now).map((day) => dayLabel(day, now));
    expect(labels[0]).toBe('Today');
    expect(labels.slice(1)).not.toContain('Today');
  });

  it('rolls over the end of a month and a year', () => {
    onPhoneIn('Asia/Tokyo');
    // 23:30 on 31 Dec in Cyprus is already 1 Jan in Tokyo.
    expect(keys(3, '2026-12-31T21:30:00Z')).toEqual(['2026-12-31', '2027-01-01', '2027-01-02']);
  });
});

describe('nextDays around midnight Cyprus time', () => {
  it.each(['Europe/London', 'America/New_York', 'Asia/Tokyo'])('%s: starts the next day at Cyprus midnight', (zone) => {
    onPhoneIn(zone);
    expect(keys(2, '2026-11-16T21:59:59Z')).toEqual(['2026-11-16', '2026-11-17']);
    expect(keys(2, '2026-11-16T22:00:00Z')).toEqual(['2026-11-17', '2026-11-18']);
  });
});

describe('nextDays across a daylight-saving change', () => {
  it.each(['Europe/London', 'America/New_York', 'Asia/Tokyo'])(
    '%s: autumn, 21 days through 25 Oct 2026 have no gap or repeat',
    (zone) => {
      onPhoneIn(zone);
      // 23:30 on 24 Oct in Cyprus (summer time, UTC+3).
      const days = keys(21, '2026-10-24T20:30:00Z');
      expect(days[0]).toBe('2026-10-24');
      expect(days.slice(0, 4)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
      expect(days[20]).toBe('2026-11-13');
      expect(new Set(days).size).toBe(21);
      // 23:30 on 25 Oct in Cyprus is now winter time (UTC+2): still the 25th.
      expect(keys(1, '2026-10-25T21:30:00Z')).toEqual(['2026-10-25']);
    },
  );

  it.each(['Europe/London', 'America/New_York', 'Asia/Tokyo'])(
    '%s: spring, 21 days through 28 Mar 2027 have no gap or repeat',
    (zone) => {
      onPhoneIn(zone);
      // 23:30 on 27 Mar in Cyprus (winter time, UTC+2).
      const days = keys(21, '2027-03-27T21:30:00Z');
      expect(days.slice(0, 3)).toEqual(['2027-03-27', '2027-03-28', '2027-03-29']);
      expect(days[20]).toBe('2027-04-16');
      expect(new Set(days).size).toBe(21);
      // 00:30 on 29 Mar in Cyprus is summer time (UTC+3): already the 29th.
      expect(keys(1, '2027-03-28T21:30:00Z')).toEqual(['2027-03-29']);
    },
  );

  it('the week New York has changed clocks and Cyprus has not', () => {
    onPhoneIn('America/New_York');
    // 00:00 on 21 Mar in Cyprus is 18:00 on 20 Mar in New York.
    expect(keys(2, '2027-03-20T22:00:00Z')).toEqual(['2027-03-21', '2027-03-22']);
  });
});

describe('useDays', () => {
  it('defaults to now and starts from the Cyprus date', async () => {
    onPhoneIn('Asia/Tokyo');
    jest.useFakeTimers({ now: new Date('2026-11-16T21:30:00Z') });
    try {
      const { result } = await renderHook(() => useDays(2));
      expect(result.current.map(toDateKey)).toEqual(['2026-11-16', '2026-11-17']);
    } finally {
      jest.useRealTimers();
    }
  });
});

// The day chips and "Mon 3 Aug" labels name the Cyprus date, in en-GB, on any phone.
describe.each([
  ['America/New_York', 'winter', '2026-11-20', 'Fri', '20', 'Nov', 'Sat 21 Nov'],
  ['America/New_York', 'summer', '2027-07-16', 'Fri', '16', 'Jul', 'Sat 17 Jul'],
  ['Asia/Tokyo', 'winter', '2026-11-20', 'Fri', '20', 'Nov', 'Sat 21 Nov'],
  ['Asia/Tokyo', 'summer', '2027-07-16', 'Fri', '16', 'Jul', 'Sat 17 Jul'],
])('day labels, phone on %s in %s', (zone, _season, day, weekday, number, month, tomorrow) => {
  beforeEach(() => onPhoneIn(zone));

  it('name the Cyprus day', () => {
    const date = dateKeyToDate(day);
    expect(weekdayLabel(date)).toBe(weekday);
    expect(dayNumberLabel(date)).toBe(number);
    expect(monthLabel(date)).toBe(month);
    expect(dayLabel(date, new Date('2026-01-01T12:00:00Z'))).toBe(`${weekday} ${number} ${month}`);
  });

  it('the chips from nextDays name the Cyprus days', () => {
    // 23:30 in Cyprus: Tokyo is already on the next day, New York still on this one.
    const now = new Date(day.startsWith('2026') ? '2026-11-20T21:30:00Z' : '2027-07-16T20:30:00Z');
    const labels = nextDays(2, now).map((date) => dayLabel(date, now));
    expect(labels).toEqual(['Today', tomorrow]);
  });
});

// A Cyprus booking day and start time is one instant, whatever zone the phone is in.
describe.each([
  ['America/New_York', 'winter', '2026-11-20', '2026-11-20T21:30:00.000Z'],
  ['America/New_York', 'summer', '2027-07-16', '2027-07-16T20:30:00.000Z'],
  ['Asia/Tokyo', 'winter', '2026-11-20', '2026-11-20T21:30:00.000Z'],
  ['Asia/Tokyo', 'summer', '2027-07-16', '2027-07-16T20:30:00.000Z'],
])('dateKeyAndTimeToDate, phone on %s in %s', (zone, _season, day, instant) => {
  it('reads the day and time as Cyprus time', () => {
    onPhoneIn(zone);
    expect(dateKeyAndTimeToDate(day, '23:30:00').toISOString()).toBe(instant);
  });
});
