import { getMyStreak, getPlayerStreakBadges, weeksLabel } from '@/lib/stats/streaks';

let mockCalls: unknown[][] = [];
let mockResponses: { data: unknown; error: unknown }[] = [];

jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (fn: string, args?: unknown) => {
      mockCalls.push(['rpc', fn, args]);
      return Promise.resolve(mockResponses.shift() ?? { data: null, error: null });
    },
  },
}));

beforeEach(() => {
  mockCalls = [];
  mockResponses = [];
});

const levels = [
  { badge: 'bronze', label: 'Bronze', weeks: 2, earned: true, awardedAt: '2026-11-16T07:00:00+00:00' },
  { badge: 'silver', label: 'Silver', weeks: 4, earned: false, awardedAt: null },
];

describe('getMyStreak', () => {
  it('reads the caller’s own streak from get_my_streak, with no profile id sent', async () => {
    mockResponses.push({ data: { current: 3, best: 5, isPremium: true, badges: levels }, error: null });
    const { streak, error } = await getMyStreak();
    expect(mockCalls).toEqual([['rpc', 'get_my_streak', undefined]]);
    expect(error).toBeNull();
    expect(streak).toEqual({ current: 3, best: 5, isPremium: true, badges: levels });
  });

  it('passes an error through', async () => {
    mockResponses.push({ data: null, error: { message: 'not_authenticated' } });
    const { streak, error } = await getMyStreak();
    expect(streak).toBeNull();
    expect(error).toEqual({ message: 'not_authenticated' });
  });
});

describe('getPlayerStreakBadges', () => {
  it('reads another player’s earned badges and whether they show in colour', async () => {
    const badges = [{ badge: 'bronze', label: 'Bronze', weeks: 2, awardedAt: '2026-11-16T07:00:00+00:00' }];
    mockResponses.push({ data: { inColour: false, badges }, error: null });
    const result = await getPlayerStreakBadges('p1');
    expect(mockCalls).toEqual([['rpc', 'get_player_streak_badges', { p_profile_id: 'p1' }]]);
    expect(result).toEqual({ badges: { inColour: false, badges }, error: null });
  });

  it('treats a missing answer as no badges', async () => {
    mockResponses.push({ data: null, error: null });
    expect((await getPlayerStreakBadges('p1')).badges).toEqual({ inColour: false, badges: [] });
  });
});

describe('weeksLabel', () => {
  it.each([
    [0, '0 weeks'],
    [1, '1 week'],
    [2, '2 weeks'],
    [30, '30 weeks'],
  ])('%i → %s', (n, label) => {
    expect(weeksLabel(n)).toBe(label);
  });
});
