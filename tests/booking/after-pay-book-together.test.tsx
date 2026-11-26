// S20: after Book together or Team vs team (a friend chat → Book a pitch →
// pay), the screen after paying takes the preselection once, asks the server
// which friend and team are still allowed, and passes them to AfterPayView.
// A missing or no-longer-allowed one is simply not preselected. The team
// waits for the booking to be confirmed, so the opposition invite can open.
import { render, waitFor } from '@testing-library/react-native';

import BookingAfterPayScreen from '@/app/booking-after-pay';
import { armBookingPreselect, peekBookingPreselect } from '@/lib/booking-preselect';

const mockViewProps = jest.fn();
const mockFetchDetail = jest.fn();
const mockRpc = jest.fn();
const mockInviteFriend = jest.fn();
let mockParams: Record<string, string> = {};

jest.mock('expo-router', () => ({
  router: { replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
  useNavigation: () => ({ addListener: () => () => undefined }),
  Stack: { Screen: () => null },
}));
jest.mock('@/components/booking/after-pay-view', () => ({
  AfterPayView: (props: Record<string, unknown>) => (mockViewProps(props), null),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('@/lib/booking-detail', () => ({
  fetchBookingDetail: (...a: unknown[]) => mockFetchDetail(...a),
  shareText: jest.fn(),
}));
jest.mock('@/lib/booking-opposition', () => ({
  publishBooking: jest.fn(),
  unpublishPost: jest.fn(),
  inviteOpposition: jest.fn(),
  fetchFollowedTeamIds: jest.fn(),
  searchTeams: jest.fn(),
}));
jest.mock('@/lib/booking-shares', () => ({
  addBookingPlayer: jest.fn(),
  inviteFriendToBooking: (...a: unknown[]) => mockInviteFriend(...a),
}));
jest.mock('@/lib/use-rules', () => ({ useRules: () => undefined }));
jest.mock('@/lib/venue-extras', () => ({ fetchVenueExtras: () => Promise.resolve(null) }));
jest.mock('@/lib/supabase', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
// The team waits for the payment webhook; no real waiting in tests.
jest.mock('@/lib/start-match', () => {
  const actual = jest.requireActual<typeof import('@/lib/start-match')>('@/lib/start-match');
  return {
    ...actual,
    waitUntilConfirmed: (check: () => Promise<boolean>) => actual.waitUntilConfirmed(check, { tries: 3, delayMs: 0, sleep: async () => {} }),
  };
});

type ViewProps = {
  preselectFriend: unknown;
  preselectTeam: unknown;
  onInviteFriendById: (id: string) => Promise<string | null>;
};
function lastProps() {
  return mockViewProps.mock.calls[mockViewProps.mock.calls.length - 1][0] as ViewProps;
}

const ben = { profile_id: 'p-ben', name: 'Ben Friend' };
const benFc = { id: 't-ben', name: 'Ben FC', city: 'Limassol' };
const detail = (status: string) => ({ is_booker: true, venue: { id: 'v1' }, booking: { status }, v2: null });

beforeEach(() => {
  jest.clearAllMocks();
  armBookingPreselect(null);
  mockParams = { bookingId: 'b1', from: 'pay' };
  mockFetchDetail.mockResolvedValue(detail('confirmed'));
});

describe('Booked, after Book together', () => {
  it('the friend the server allows is preselected; invited by id', async () => {
    armBookingPreselect({ inviteProfileId: 'p-ben' });
    mockRpc.mockResolvedValue({ data: { friend: ben, team: null }, error: null });
    await render(<BookingAfterPayScreen />);
    await waitFor(() => expect(lastProps().preselectFriend).toEqual(ben));
    expect(mockRpc).toHaveBeenCalledWith('booking_preselect', { p_profile_id: 'p-ben', p_team_id: null });
    expect(lastProps().preselectTeam).toBeNull();
    expect(peekBookingPreselect()).toBeNull(); // taken once

    mockInviteFriend.mockResolvedValueOnce({ error: null });
    await expect(lastProps().onInviteFriendById('p-ben')).resolves.toBeNull();
    expect(mockInviteFriend).toHaveBeenCalledWith('b1', 'p-ben');
    mockInviteFriend.mockResolvedValueOnce({ error: { message: 'not_friends' } });
    await expect(lastProps().onInviteFriendById('p-ben')).resolves.toBe("You're no longer friends. Invite by username.");
  });

  it('no longer allowed (or missing): nothing preselected', async () => {
    armBookingPreselect({ inviteProfileId: 'p-gone' });
    mockRpc.mockResolvedValue({ data: { friend: null, team: null }, error: null });
    await render(<BookingAfterPayScreen />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(lastProps().preselectFriend).toBeNull();
    expect(lastProps().preselectTeam).toBeNull();
  });

  it('the check fails: nothing preselected', async () => {
    armBookingPreselect({ inviteProfileId: 'p-ben' });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'offline' } });
    await render(<BookingAfterPayScreen />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(lastProps().preselectFriend).toBeNull();
  });

  it('opened from a booking, not right after paying: nothing taken', async () => {
    armBookingPreselect({ inviteProfileId: 'p-ben' });
    mockParams = { bookingId: 'b1' };
    await render(<BookingAfterPayScreen />);
    await waitFor(() => expect(mockFetchDetail).toHaveBeenCalled());
    expect(mockRpc).not.toHaveBeenCalled();
    expect(peekBookingPreselect()).not.toBeNull();
  });

  it('not from a friend chat: no call', async () => {
    await render(<BookingAfterPayScreen />);
    await waitFor(() => expect(mockFetchDetail).toHaveBeenCalled());
    expect(mockRpc).not.toHaveBeenCalled();
    expect(lastProps().preselectFriend).toBeNull();
  });
});

describe('Booked, after Team vs team', () => {
  it('the team is preselected, and the screen reloads once the booking is confirmed', async () => {
    armBookingPreselect({ oppositionTeamId: 't-ben' });
    mockRpc.mockResolvedValue({ data: { friend: null, team: benFc }, error: null });
    mockFetchDetail
      .mockResolvedValueOnce(detail('pending')) // the screen's first load
      .mockResolvedValueOnce(detail('pending')) // still waiting for the webhook
      .mockResolvedValue(detail('confirmed'));
    await render(<BookingAfterPayScreen />);
    await waitFor(() => expect(lastProps().preselectTeam).toEqual(benFc));
    expect(mockRpc).toHaveBeenCalledWith('booking_preselect', { p_profile_id: null, p_team_id: 't-ben' });
    // First load, two checks, then the reload.
    await waitFor(() => expect(mockFetchDetail.mock.calls.length).toBeGreaterThanOrEqual(4));
  });

  it('a team no longer allowed (not both captains, not friends): nothing, no waiting', async () => {
    armBookingPreselect({ oppositionTeamId: 't-x' });
    mockRpc.mockResolvedValue({ data: { friend: null, team: null }, error: null });
    await render(<BookingAfterPayScreen />);
    await waitFor(() => expect(mockRpc).toHaveBeenCalled());
    expect(lastProps().preselectTeam).toBeNull();
    expect(mockFetchDetail).toHaveBeenCalledTimes(1);
  });
});
