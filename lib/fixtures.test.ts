import { canLogFixtureScore, type Fixture } from '@/lib/fixtures';

import { onPhoneIn, restorePhoneZone, ZONES_AND_SEASONS } from '../tests/phone-time-zone';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));

// A fixture's day and time are Cyprus time (Asia/Nicosia). Its score can be
// logged two hours after kick-off in Cyprus, whatever zone the phone is in.
const KICKOFF = {
  winter: { day: '2026-11-20', time: '19:00:00', before: '2026-11-20T18:59:00Z', after: '2026-11-20T19:01:00Z' },
  summer: { day: '2027-07-16', time: '19:00:00', before: '2027-07-16T17:59:00Z', after: '2027-07-16T18:01:00Z' },
} as const;

describe.each(ZONES_AND_SEASONS)('canLogFixtureScore, phone on %s in %s', (zone, season) => {
  const k = KICKOFF[season];
  const fixture = {
    home_team_id: 'home',
    away_team_id: 'away',
    status: 'agreed',
    score_locked: false,
    scheduled_day: k.day,
    scheduled_time: k.time,
  } as Fixture;
  const captains = new Set(['home']);

  beforeEach(() => onPhoneIn(zone));
  afterEach(() => {
    jest.useRealTimers();
    restorePhoneZone();
  });

  it('not yet two hours after the Cyprus kick-off', () => {
    jest.useFakeTimers({ now: new Date(k.before) });
    expect(canLogFixtureScore(fixture, captains)).toBe(false);
  });

  it('two hours after the Cyprus kick-off', () => {
    jest.useFakeTimers({ now: new Date(k.after) });
    expect(canLogFixtureScore(fixture, captains)).toBe(true);
  });
});
