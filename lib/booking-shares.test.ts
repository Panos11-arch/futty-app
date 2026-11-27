// S20A (b): inviting a team or all friends to a booking (spec 13 "Player
// invites"). The server checks who may invite and skips who can't come.
import { addBookingPlayer, inviteAllFriendsToBooking, inviteFriendToBooking, inviteTeamToBooking } from '@/lib/booking-shares';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => mockRpc(...args) } }));

beforeEach(() => {
  mockRpc.mockReset().mockResolvedValue({ data: 3, error: null });
});

it('invites by username and by friend, as before', async () => {
  await addBookingPlayer('b1', 'ana');
  await inviteFriendToBooking('b1', 'p1');
  expect(mockRpc.mock.calls).toEqual([
    ['add_booking_player', { p_booking_id: 'b1', p_username: 'ana' }],
    ['invite_friend_to_booking', { p_booking_id: 'b1', p_profile_id: 'p1' }],
  ]);
});

it('invites a team and all friends, and returns how many were sent', async () => {
  await expect(inviteTeamToBooking('b1', 't1')).resolves.toEqual({ count: 3, error: null });
  await expect(inviteAllFriendsToBooking('b1')).resolves.toEqual({ count: 3, error: null });
  expect(mockRpc.mock.calls).toEqual([
    ['invite_team_to_booking', { p_booking_id: 'b1', p_team_id: 't1' }],
    ['invite_all_friends_to_booking', { p_booking_id: 'b1' }],
  ]);
});

it('a refusal has no count', async () => {
  mockRpc.mockResolvedValue({ data: null, error: { message: 'not_member' } });
  await expect(inviteTeamToBooking('b1', 't1')).resolves.toEqual({ count: 0, error: { message: 'not_member' } });
  await expect(inviteAllFriendsToBooking('b1')).resolves.toEqual({ count: 0, error: { message: 'not_member' } });
});
