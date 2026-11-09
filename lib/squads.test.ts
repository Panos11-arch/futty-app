import { describeBlockNotice, getSquadPostBlockNotice } from './squads';

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
