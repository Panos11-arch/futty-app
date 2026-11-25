// S6: a game started from Find a match ("Start a match") opens the screen
// after paying with the right Publish switch preselected; "Publish game"
// waits for the booking to be confirmed first. Without Start a match nothing
// is preselected.
import { render, waitFor } from '@testing-library/react-native';

import BookingAfterPayScreen from '@/app/booking-after-pay';
import { armStartMatch } from '@/lib/start-match';

const mockViewProps = jest.fn();
const mockFetchDetail = jest.fn();
const mockPublish = jest.fn();
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
  publishBooking: (...a: unknown[]) => mockPublish(...a),
  unpublishPost: jest.fn(),
  inviteOpposition: jest.fn(),
  fetchFollowedTeamIds: jest.fn(),
  searchTeams: jest.fn(),
}));
jest.mock('@/lib/use-rules', () => ({ useRules: () => undefined }));
jest.mock('@/lib/venue-extras', () => ({ fetchVenueExtras: () => Promise.resolve(null) }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));

function detail(status: string, v2: Record<string, unknown>) {
  return {
    is_booker: true,
    venue: { id: 'v1', name: 'Kamares' },
    booking: { status },
    v2: { posts: { players: null, opposition: null }, captain_of: null, opposition: null, ...v2 },
  };
}

function lastProps() {
  return mockViewProps.mock.calls[mockViewProps.mock.calls.length - 1][0] as {
    preselect: string | null;
    onPublishGame: (on: boolean) => Promise<string | null>;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  armStartMatch(false);
  mockParams = { bookingId: 'b1', from: 'pay' };
  mockPublish.mockResolvedValue(null);
});

describe('Booked, after Start a match', () => {
  it('a whole pitch: "Publish game" is preselected', async () => {
    armStartMatch(true);
    mockFetchDetail.mockResolvedValue(detail('confirmed', { kind: 'whole' }));
    await render(<BookingAfterPayScreen />);
    await waitFor(() => expect(lastProps().preselect).toBe('players'));
  });

  it('a half pitch: the opposition "Publish" is preselected for side A', async () => {
    armStartMatch(true);
    mockFetchDetail.mockResolvedValue(
      detail('pending_payment', { kind: 'half', captain_of: 'a', opposition: { found: false, open: true, invited: 0 } }),
    );
    await render(<BookingAfterPayScreen />);
    await waitFor(() => expect(lastProps().preselect).toBe('opposition'));
  });

  it('"Publish game" waits until the booking is confirmed, then publishes', async () => {
    armStartMatch(true);
    mockFetchDetail
      .mockResolvedValueOnce(detail('pending_payment', { kind: 'whole' }))
      .mockResolvedValueOnce(detail('confirmed', { kind: 'whole' }))
      .mockResolvedValue(detail('confirmed', { kind: 'whole' }));
    await render(<BookingAfterPayScreen />);
    await waitFor(() => expect(lastProps().preselect).toBe('players'));
    await expect(lastProps().onPublishGame(true)).resolves.toBeNull();
    expect(mockPublish).toHaveBeenCalledWith('b1', 'players');
    // The first load, then the confirmation check.
    expect(mockFetchDetail.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('nothing is preselected without Start a match, or when not right after paying', async () => {
    mockFetchDetail.mockResolvedValue(detail('confirmed', { kind: 'whole' }));
    await render(<BookingAfterPayScreen />);
    await waitFor(() => expect(mockViewProps).toHaveBeenCalled());
    await waitFor(() => expect(lastProps().preselect).toBeNull());

    armStartMatch(true);
    mockParams = { bookingId: 'b1' };
    await render(<BookingAfterPayScreen />);
    await waitFor(() => expect(lastProps().preselect).toBeNull());
  });
});
