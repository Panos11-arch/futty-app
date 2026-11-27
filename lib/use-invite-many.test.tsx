import { act, renderHook, waitFor } from '@testing-library/react-native';

import { fetchMyInviteTeams, useInviteMany } from '@/lib/use-invite-many';

let mockAnswer: { data: unknown; error: unknown } = { data: [], error: null };
let mockThrow = false;
const mockInviteAll = jest.fn();
const mockInviteTeam = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => {
      if (mockThrow) throw new Error('offline');
      return { select: () => ({ eq: () => Promise.resolve(mockAnswer) }) };
    },
  },
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('@/lib/booking-shares', () => ({
  inviteAllFriendsToBooking: (...a: unknown[]) => mockInviteAll(...a),
  inviteTeamToBooking: (...a: unknown[]) => mockInviteTeam(...a),
}));

beforeEach(() => {
  mockAnswer = { data: [], error: null };
  mockThrow = false;
  jest.clearAllMocks();
});

it('my teams, A to Z, deleted ones left out', async () => {
  mockAnswer = {
    data: [
      { teams: { id: 't2', name: 'Zeta', deleted_at: null } },
      { teams: { id: 't1', name: 'Alpha', deleted_at: null } },
      { teams: { id: 't3', name: 'Gone', deleted_at: '2026-11-01' } },
      { teams: null },
    ],
    error: null,
  };
  await expect(fetchMyInviteTeams('me')).resolves.toEqual([
    { id: 't1', name: 'Alpha' },
    { id: 't2', name: 'Zeta' },
  ]);
});

it('a failed or thrown read is no teams', async () => {
  mockAnswer = { data: null, error: { message: 'x' } };
  await expect(fetchMyInviteTeams('me')).resolves.toEqual([]);
  mockThrow = true;
  await expect(fetchMyInviteTeams('me')).resolves.toEqual([]);
});

it('the hook loads my teams and turns refusals into words', async () => {
  mockAnswer = { data: [{ teams: { id: 't1', name: 'Alpha', deleted_at: null } }], error: null };
  mockInviteAll.mockResolvedValue({ count: 4, error: null });
  mockInviteTeam.mockResolvedValue({ count: 0, error: { message: 'not_member' } });
  const { result } = await renderHook(() => useInviteMany('b1'));
  await waitFor(() => expect(result.current.teams).toEqual([{ id: 't1', name: 'Alpha' }]));
  await act(async () => {
    await expect(result.current.onInviteAllFriends()).resolves.toEqual({ count: 4, error: null });
    await expect(result.current.onInviteTeam('t1')).resolves.toEqual({ count: 0, error: "You're not in that team." });
  });
  expect(mockInviteAll).toHaveBeenCalledWith('b1');
  expect(mockInviteTeam).toHaveBeenCalledWith('b1', 't1');
});
