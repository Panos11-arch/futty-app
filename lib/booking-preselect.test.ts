// S20: Book together / Team vs team carried from a friend chat to the screen
// after paying (lib/booking-preselect.ts).
import {
  armBookingPreselect,
  fetchBookingPreselect,
  initialKindFor,
  peekBookingPreselect,
  takeBookingPreselect,
} from '@/lib/booking-preselect';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));

beforeEach(() => {
  mockRpc.mockReset();
  armBookingPreselect(null);
});

describe('the store', () => {
  it('armed while Book a pitch is open, taken once', () => {
    armBookingPreselect({ inviteProfileId: 'p1' });
    expect(peekBookingPreselect()).toEqual({ inviteProfileId: 'p1', oppositionTeamId: null });
    expect(peekBookingPreselect()).toEqual({ inviteProfileId: 'p1', oppositionTeamId: null });
    expect(takeBookingPreselect()).toEqual({ inviteProfileId: 'p1', oppositionTeamId: null });
    expect(takeBookingPreselect()).toBeNull();
  });

  it('disarmed when Book a pitch closes', () => {
    armBookingPreselect({ oppositionTeamId: 't1' });
    armBookingPreselect(null);
    expect(takeBookingPreselect()).toBeNull();
  });

  it('blank ids arm nothing', () => {
    armBookingPreselect({ inviteProfileId: '  ', oppositionTeamId: '' });
    expect(peekBookingPreselect()).toBeNull();
  });
});

describe('initialKindFor', () => {
  it('Team vs team starts on half pitch; anything else keeps the default', () => {
    expect(initialKindFor({ oppositionTeamId: 't1' })).toBe('half');
    expect(initialKindFor({ inviteProfileId: 'p1' })).toBeUndefined();
    expect(initialKindFor(null)).toBeUndefined();
  });
});

describe('fetchBookingPreselect', () => {
  it('asks the server for both', async () => {
    mockRpc.mockResolvedValue({
      data: { friend: { profile_id: 'p1', name: 'Ben' }, team: { id: 't1', name: 'Ben FC', city: 'Limassol' } },
      error: null,
    });
    await expect(fetchBookingPreselect({ inviteProfileId: 'p1', oppositionTeamId: 't1' })).resolves.toEqual({
      friend: { profile_id: 'p1', name: 'Ben' },
      team: { id: 't1', name: 'Ben FC', city: 'Limassol' },
    });
    expect(mockRpc).toHaveBeenCalledWith('booking_preselect', { p_profile_id: 'p1', p_team_id: 't1' });
  });

  it('a friend or team the server no longer allows: none', async () => {
    mockRpc.mockResolvedValue({ data: { friend: null, team: null }, error: null });
    await expect(fetchBookingPreselect({ inviteProfileId: 'p1' })).resolves.toEqual({ friend: null, team: null });
    expect(mockRpc).toHaveBeenCalledWith('booking_preselect', { p_profile_id: 'p1', p_team_id: null });
  });

  it('a team without a city', async () => {
    mockRpc.mockResolvedValue({ data: { friend: null, team: { id: 't1', name: 'Ben FC' } }, error: null });
    await expect(fetchBookingPreselect({ oppositionTeamId: 't1' })).resolves.toEqual({
      friend: null,
      team: { id: 't1', name: 'Ben FC', city: null },
    });
  });

  it('nothing armed: no call', async () => {
    await expect(fetchBookingPreselect(null)).resolves.toEqual({ friend: null, team: null });
    await expect(fetchBookingPreselect({ inviteProfileId: ' ' })).resolves.toEqual({ friend: null, team: null });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('an error, a throw or an odd answer: none', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'x' } });
    await expect(fetchBookingPreselect({ inviteProfileId: 'p1' })).resolves.toEqual({ friend: null, team: null });
    mockRpc.mockRejectedValueOnce(new Error('offline'));
    await expect(fetchBookingPreselect({ inviteProfileId: 'p1' })).resolves.toEqual({ friend: null, team: null });
    mockRpc.mockResolvedValueOnce({ data: { friend: { profile_id: 1 }, team: { id: 't1' } }, error: null });
    await expect(fetchBookingPreselect({ inviteProfileId: 'p1' })).resolves.toEqual({ friend: null, team: null });
  });
});
