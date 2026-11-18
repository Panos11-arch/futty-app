import { describeBlockNotice, getSquadPostBlockNotice, getSquadPostPrices } from './squads';

// jest.mock is hoisted above the import; the factory reads mockRpc lazily.
const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));

describe('describeBlockNotice', () => {
  it("names the venue and says the game booked before the block is still on", () => {
    expect(describeBlockNotice('Nuevo Campo')).toEqual({
      title: 'Nuevo Campo has closed new bookings',
      body: 'This game was booked before that, so it’s still on and you can join.',
    });
  });
});

describe('getSquadPostBlockNotice', () => {
  beforeEach(() => mockRpc.mockReset());

  it('asks the server about this post', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await getSquadPostBlockNotice('post-1');
    expect(mockRpc).toHaveBeenCalledWith('squad_post_block_notice', { p_post_id: 'post-1' });
  });

  it("returns the venue's notice when a block covers the game", async () => {
    mockRpc.mockResolvedValue({ data: [{ venue_name: 'Nuevo Campo' }], error: null });
    await expect(getSquadPostBlockNotice('post-1')).resolves.toEqual(describeBlockNotice('Nuevo Campo'));
  });

  it('returns null when no block covers the game', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await expect(getSquadPostBlockNotice('post-1')).resolves.toBeNull();
  });

  it('returns null when the check fails, so joining is never held up by it', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'network' } });
    await expect(getSquadPostBlockNotice('post-1')).resolves.toBeNull();
  });
});

describe('getSquadPostPrices', () => {
  beforeEach(() => mockRpc.mockReset());

  const row = (id: string) => ({ post_id: id, share_cents: 680, fee_cents: 80, pitch_cents: 600 });

  it("asks the server once for up to 50 posts and keeps its amounts as they are", async () => {
    mockRpc.mockResolvedValue({ data: [row('a'), row('b')], error: null });
    const prices = await getSquadPostPrices(['a', 'b', 'c']);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('squad_post_prices', { p_post_ids: ['a', 'b', 'c'] });
    expect(prices?.get('a')).toEqual({ share_cents: 680, fee_cents: 80, pitch_cents: 600 });
    expect(prices?.has('c')).toBe(false);
  });

  it('asks in batches of 50, the most the server takes', async () => {
    const ids = Array.from({ length: 120 }, (_, i) => `p${i}`);
    mockRpc.mockImplementation((_name: string, args: { p_post_ids: string[] }) =>
      Promise.resolve({ data: args.p_post_ids.map(row), error: null })
    );
    const prices = await getSquadPostPrices(ids);
    expect(mockRpc.mock.calls.map(([, args]) => args.p_post_ids.length)).toEqual([50, 50, 20]);
    expect(prices?.size).toBe(120);
  });

  it('asks nothing for no posts', async () => {
    expect((await getSquadPostPrices([]))?.size).toBe(0);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('null when any batch fails, so no card shows a price it may not have', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'network' } });
    await expect(getSquadPostPrices(['a'])).resolves.toBeNull();
  });
});
