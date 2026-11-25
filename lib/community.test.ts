import {
  dismissFollowSuggestion,
  fetchFeed,
  fetchFollowSuggestions,
  follow,
  listTeams,
  searchPlayers,
  unfollow,
} from './community';

const mockRpc = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => mockRpc(...a), from: (...a: unknown[]) => mockFrom(...a) },
}));

beforeEach(() => {
  jest.resetAllMocks();
});

describe('fetchFeed', () => {
  it('asks the server for a scope, first page', async () => {
    mockRpc.mockResolvedValue({ data: [{ item_id: 'p1' }], error: null });
    const res = await fetchFeed('for_you');
    expect(mockRpc).toHaveBeenCalledWith('community_feed', {
      p_scope: 'for_you',
      p_before_at: null,
      p_before_id: null,
      p_limit: 20,
    });
    expect(res).toEqual({ data: [{ item_id: 'p1' }], error: null });
  });

  it('passes the cursor and limit for the next page', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await fetchFeed('mine', { at: '2026-11-25T10:00:00Z', id: 'p9' }, 5);
    expect(mockRpc).toHaveBeenCalledWith('community_feed', {
      p_scope: 'mine',
      p_before_at: '2026-11-25T10:00:00Z',
      p_before_id: 'p9',
      p_limit: 5,
    });
  });

  it('returns the error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    expect(await fetchFeed('following')).toEqual({ data: null, error: { message: 'offline' } });
  });
});

describe('suggestions', () => {
  it('fetches with a limit', async () => {
    mockRpc.mockResolvedValue({ data: [{ id: 'u1', matches_in_common: 2 }], error: null });
    const res = await fetchFollowSuggestions(10);
    expect(mockRpc).toHaveBeenCalledWith('follow_suggestions', { p_limit: 10 });
    expect(res.data).toEqual([{ id: 'u1', matches_in_common: 2 }]);
  });

  it('defaults to 20 and passes errors back', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'nope' } });
    const res = await fetchFollowSuggestions();
    expect(mockRpc).toHaveBeenCalledWith('follow_suggestions', { p_limit: 20 });
    expect(res).toEqual({ data: null, error: { message: 'nope' } });
  });

  it('dismisses one player', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    expect(await dismissFollowSuggestion('u1')).toEqual({ error: null });
    expect(mockRpc).toHaveBeenCalledWith('dismiss_follow_suggestion', { p_profile_id: 'u1' });
  });
});

describe('searchPlayers', () => {
  it('does not call the server under 2 characters', async () => {
    expect(await searchPlayers(' a ')).toEqual({ data: [], error: null });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('searches the trimmed query', async () => {
    mockRpc.mockResolvedValue({ data: [{ id: 'u1' }], error: null });
    expect(await searchPlayers('  anna ')).toEqual({ data: [{ id: 'u1' }], error: null });
    expect(mockRpc).toHaveBeenCalledWith('search_players', { p_query: 'anna' });
  });

  it('returns the error', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    expect(await searchPlayers('anna')).toEqual({ data: null, error: { message: 'offline' } });
  });
});

describe('follows and teams (unchanged)', () => {
  it("follow and unfollow write the caller's own row", async () => {
    const insert = jest.fn().mockResolvedValue({ error: null });
    const eq3 = jest.fn().mockResolvedValue({ error: null });
    const eq2 = jest.fn(() => ({ eq: eq3 }));
    const eq1 = jest.fn(() => ({ eq: eq2 }));
    const del = jest.fn(() => ({ eq: eq1 }));
    mockFrom.mockReturnValue({ insert, delete: del });
    await follow('me', 'player', 'u1');
    expect(insert).toHaveBeenCalledWith({ follower_id: 'me', target_type: 'player', target_id: 'u1' });
    await unfollow('me', 'team', 't1');
    expect(eq1).toHaveBeenCalledWith('follower_id', 'me');
    expect(eq2).toHaveBeenCalledWith('target_type', 'team');
    expect(eq3).toHaveBeenCalledWith('target_id', 't1');
  });

  it('lists teams by name', async () => {
    const order = jest.fn().mockResolvedValue({ data: [], error: null });
    const select = jest.fn(() => ({ order }));
    mockFrom.mockReturnValue({ select });
    await listTeams();
    expect(mockFrom).toHaveBeenCalledWith('teams');
    expect(order).toHaveBeenCalledWith('name');
  });
});
