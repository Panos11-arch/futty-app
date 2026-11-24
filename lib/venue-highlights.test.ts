import { fetchVenueHighlights, ratingText, resultDay } from './venue-highlights';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));

beforeEach(() => mockRpc.mockReset());

const server = {
  top_players: [
    { profile_id: 'p1', rating: 8.25, matches: 4 },
    { profile_id: 'p2', rating: 7, matches: 3 },
  ],
  recent_results: [
    {
      match_id: 'm1',
      kickoff_at: '2026-11-20T18:00:00+00:00',
      sides: [
        { side: 'a', label: 'Lions', team_id: 't1', score: 4 },
        { side: 'b', label: 'Tigers', team_id: 't2', score: 0 },
      ],
    },
  ],
};

describe('fetchVenueHighlights', () => {
  it('the server\'s top players with their public names, and its results', async () => {
    mockRpc.mockImplementation((name: string) =>
      Promise.resolve(
        name === 'venue_highlights'
          ? { data: server, error: null }
          : { data: [{ id: 'p1', username: 'ace', full_name: 'Andreas K' }, { id: 'p2', username: 'zed', full_name: null }], error: null },
      ),
    );
    const h = await fetchVenueHighlights('v1');
    expect(mockRpc).toHaveBeenCalledWith('venue_highlights', { p_venue_id: 'v1' });
    expect(mockRpc).toHaveBeenCalledWith('get_public_profiles', { p_profile_ids: ['p1', 'p2'] });
    expect(h.topPlayers).toEqual([
      { profileId: 'p1', name: 'Andreas K', kit: null, rating: '8.3', matches: 4 },
      { profileId: 'p2', name: 'zed', kit: null, rating: '7.0', matches: 3 },
    ]);
    expect(h.results).toEqual([
      {
        matchId: 'm1',
        day: 'Fri 20 Nov',
        sides: [
          { label: 'Lions', teamId: 't1', score: 4 },
          { label: 'Tigers', teamId: 't2', score: 0 },
        ],
      },
    ]);
  });

  it('nothing yet: empty lists, and no names call', async () => {
    mockRpc.mockResolvedValue({ data: { top_players: [], recent_results: [] }, error: null });
    expect(await fetchVenueHighlights('v1')).toEqual({ topPlayers: [], results: [] });
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });

  it('a refusal is an error in words', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'venue_not_found' } });
    await expect(fetchVenueHighlights('v1')).rejects.toThrow('Could not load this venue. Try again.');
  });
});

describe('words', () => {
  it('a rating with one decimal', () => {
    expect(ratingText(8)).toBe('8.0');
    expect(ratingText(7.45)).toBe('7.5');
  });

  it('a result\'s day in Cyprus', () => {
    // 23:30 UTC on 20 November is already the 21st in Cyprus.
    expect(resultDay('2026-11-20T23:30:00Z')).toBe('Sat 21 Nov');
  });
});
