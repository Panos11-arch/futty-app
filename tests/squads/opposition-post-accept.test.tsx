// B4: "Accept as opponent" on a public opposition post opens side B's accept
// screen for that post: side B's price from opposition_post_detail, then
// accept_opposition_post and the payment within the window.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import OppositionInviteScreen from '@/app/opposition-invite';

const mockParams: { current: Record<string, string> } = { current: {} };
const mockFetchPost = jest.fn();
const mockAcceptPost = jest.fn();
const mockFetchInvite = jest.fn();
const mockAcceptInvite = jest.fn();
const mockPayShare = jest.fn();
const mockAfterBooking = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn() },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams.current,
}));
jest.mock('@stripe/stripe-react-native', () => ({
  usePaymentSheet: () => ({ initPaymentSheet: jest.fn(), presentPaymentSheet: jest.fn() }),
}));
jest.mock('expo-haptics', () => ({
  notificationAsync: () => Promise.resolve(),
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/use-rules', () => ({ useRules: () => undefined }));
jest.mock('@/lib/booking-posts', () => ({
  fetchOppositionPost: (...a: unknown[]) => mockFetchPost(...a),
  acceptOppositionPost: (...a: unknown[]) => mockAcceptPost(...a),
}));
jest.mock('@/lib/booking-opposition', () => ({
  ...jest.requireActual('@/lib/booking-opposition'),
  fetchOppositionInvite: (...a: unknown[]) => mockFetchInvite(...a),
  acceptOpposition: (...a: unknown[]) => mockAcceptInvite(...a),
}));
jest.mock('@/lib/booking-checkout', () => ({ payShare: (...a: unknown[]) => mockPayShare(...a) }));
jest.mock('@/lib/booking-navigation', () => ({ afterBooking: (...a: unknown[]) => mockAfterBooking(...a) }));

const post = {
  invite_id: 'p1',
  booking_id: 'b1',
  team_id: null,
  venue_name: 'Arena',
  booking_day: '2027-01-08',
  start_time: '12:00:00',
  end_time: '13:00:00',
  format: '5-a-side',
  pitch_label: 'Pitch 1',
  side_pitch_cents: 2000,
  side_players: 5,
  pay_all_cents: 2275,
  each_pays_cents: 480,
  guarantee_cents: 2000,
  found: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockParams.current = { postId: 'p1' };
  mockFetchPost.mockResolvedValue(post);
});

describe('Accept as opponent on a public opposition post (spec 13 "Invites, after payment")', () => {
  it('shows side B\'s price from the server, accepts the post and pays the share it returns', async () => {
    mockAcceptPost.mockResolvedValue({ accepted: { booking_id: 'b1', share_id: 's1', amount_cents: 2275 } });
    mockPayShare.mockResolvedValue({ status: 'paid' });
    await render(<OppositionInviteScreen />);
    expect(await screen.findByText('Arena')).toBeTruthy();
    expect(mockFetchPost).toHaveBeenCalledWith('p1');
    expect(mockFetchInvite).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('opposition-accept'));
    await fireEvent.press(screen.getByTestId('opposition-way-pay-all'));
    expect(screen.getAllByText('€22.75').length).toBeGreaterThan(0);
    await fireEvent.press(screen.getByTestId('opposition-pay'));

    await waitFor(() => expect(mockAfterBooking).toHaveBeenCalledWith('b1', expect.anything()));
    expect(mockAcceptPost).toHaveBeenCalledWith('p1', 'pay_all', false);
    expect(mockAcceptInvite).not.toHaveBeenCalled();
    expect(mockPayShare.mock.calls[0][0]).toBe('s1');
  });

  it('another captain was first: "Opposition found"', async () => {
    mockFetchPost.mockResolvedValue({ ...post, found: true });
    await render(<OppositionInviteScreen />);
    expect(await screen.findByText('Opposition found. Another captain accepted first.')).toBeTruthy();
    expect(screen.queryByTestId('opposition-accept')).toBeNull();
  });

  it('the server refuses (closed 24 hours before kickoff): its words, and nothing to pay', async () => {
    mockAcceptPost.mockResolvedValue({ error: 'Invites for this game have closed.' });
    await render(<OppositionInviteScreen />);
    await fireEvent.press(await screen.findByTestId('opposition-accept'));
    await fireEvent.press(screen.getByTestId('opposition-way-each-pays'));
    await fireEvent.press(screen.getByTestId('opposition-pay'));
    expect(await screen.findByText('Invites for this game have closed.')).toBeTruthy();
    expect(mockAcceptPost).toHaveBeenCalledWith('p1', 'each_pays_responsible', false);
    expect(mockPayShare).not.toHaveBeenCalled();
  });

  it('an invite still uses the invite', async () => {
    mockParams.current = { inviteId: 'i1' };
    mockFetchInvite.mockResolvedValue({ ...post, invite_id: 'i1' });
    await render(<OppositionInviteScreen />);
    expect(await screen.findByText('Arena')).toBeTruthy();
    expect(mockFetchInvite).toHaveBeenCalledWith('i1');
    expect(mockFetchPost).not.toHaveBeenCalled();
  });
});

describe('Accept Losers pay on a public opposition post (B1d)', () => {
  it('a Losers pay game is accepted knowingly', async () => {
    mockFetchPost.mockResolvedValue({ ...post, losers_pay: true, losers_pay_all_cents: 4550, losers_each_pays_cents: 960, losers_spot_cents: 960 });
    mockAcceptPost.mockResolvedValue({ accepted: { booking_id: 'b1', share_id: 's1', amount_cents: 4550 } });
    mockPayShare.mockResolvedValue({ status: 'paid' });
    await render(<OppositionInviteScreen />);
    await fireEvent.press(await screen.findByRole('button', { name: 'Accept Losers pay' }));
    await fireEvent.press(screen.getByTestId('opposition-way-pay-all'));
    await fireEvent.press(screen.getByTestId('opposition-pay'));
    await waitFor(() => expect(mockAcceptPost).toHaveBeenCalledWith('p1', 'pay_all', true));
  });
});
