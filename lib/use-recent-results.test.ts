import { renderHook, waitFor } from '@testing-library/react-native';

import { useRecentResults } from '@/lib/use-recent-results';

import { CYPRUS_LATE_KICKOFF, onPhoneIn, restorePhoneZone, ZONES_AND_SEASONS } from '../tests/phone-time-zone';

let mockFriendlies: unknown[] = [];
let mockFixtures: unknown[] = [];
let mockBookings: unknown[] = [];

jest.mock('@/lib/auth', () => {
  const auth = { user: { id: 'me' } };
  return { useAuth: () => auth };
});
jest.mock('@/lib/use-my-teams', () => {
  const teams = { status: 'ready', teams: [{ team: { id: 't1' } }] };
  return { useMyTeams: () => teams };
});
jest.mock('@/lib/friendly-matches', () => ({
  listFriendlyMatchesForTeams: () => Promise.resolve({ data: mockFriendlies, error: null }),
}));
jest.mock('@/lib/fixtures', () => ({
  listFixturesForTeams: () => Promise.resolve({ data: mockFixtures, error: null }),
}));
jest.mock('@/lib/supabase', () => {
  const query = {
    select: () => query,
    eq: () => query,
    not: () => query,
    order: () => query,
    limit: () => Promise.resolve({ data: mockBookings, error: null }),
  };
  return { supabase: { from: () => query } };
});

const teams = { home_team: { name: 'Tigers' }, away_team: { name: 'Lions' }, home_score: 2, away_score: 1 };

// League fixtures and bookings store a Cyprus day and time. playedAt must be the
// real instant, so every screen can show it in Cyprus time and the three kinds
// sort together, whatever zone the phone is in.
describe.each(ZONES_AND_SEASONS)('playedAt, phone on %s in %s', (zone, season) => {
  const played = CYPRUS_LATE_KICKOFF[season];
  beforeEach(() => {
    onPhoneIn(zone);
    mockFriendlies = [];
    mockFixtures = [];
    mockBookings = [];
  });
  afterEach(restorePhoneZone);

  async function results() {
    const { result } = await renderHook(() => useRecentResults());
    await waitFor(() => expect(result.current.status).toBe('ready'));
    return (result.current as { results: { key: string; playedAt: string }[] }).results;
  }

  it('a league fixture: its Cyprus day and time as an instant', async () => {
    mockFixtures = [
      { id: 'f1', status: 'completed', scheduled_day: played.day, scheduled_time: played.time, ...teams },
    ];
    expect((await results())[0].playedAt).toBe(played.iso);
  });

  it('a booking: its Cyprus day and start time as an instant', async () => {
    mockBookings = [{ id: 'b1', booking_day: played.day, start_time: played.time, result_goals_for: 4, result_goals_against: 2 }];
    expect((await results())[0].playedAt).toBe(played.iso);
  });

  it('newest first across friendlies, fixtures and bookings', async () => {
    // A friendly 30 minutes after the fixture, a booking 30 minutes before it.
    const friendlyAt = new Date(new Date(played.iso).getTime() + 30 * 60000).toISOString();
    mockFriendlies = [{ id: 'm1', status: 'confirmed', post: { scheduled_at: friendlyAt }, ...teams }];
    mockFixtures = [
      { id: 'f1', status: 'completed', scheduled_day: played.day, scheduled_time: played.time, ...teams },
    ];
    mockBookings = [
      { id: 'b1', booking_day: played.day, start_time: '23:00:00', result_goals_for: 4, result_goals_against: 2 },
    ];
    expect((await results()).map((r) => r.key)).toEqual(['friendly:m1', 'league:f1', 'booking:b1']);
  });
});
