// P6 check-in QR: futtyapp://check-in?match=<id>&code=<code>, opened when a
// player scans the venue's QR with the phone's own camera (app/check-in.tsx).
// It reads the link, shows the game, and checks in on a tap (never on open).
import '../navigation/mocks';

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import CheckInScreen from '@/app/check-in';

const MATCH = '6f1c2a9e-1b2c-4d3e-8f90-0a1b2c3d4e5f';
const CODE = '3f9a1c0e5b7d2a4c6e8f0a1b2c3d4e5f';

let mockParams: Record<string, string | string[] | undefined> = { match: MATCH, code: CODE };
let mockUser: { id: string } | null = { id: 'me' };
const mockReplace = jest.fn();
const mockBack = jest.fn();
let mockCanGoBack = false;

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
  router: {
    replace: (...args: unknown[]) => mockReplace(...args),
    back: () => mockBack(),
    canGoBack: () => mockCanGoBack,
  },
}));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) };
});
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: mockUser }) }));

const mockFetchCheckInMatch = jest.fn();
const mockFetchMyCheckIn = jest.fn();
const mockCheckInToMatch = jest.fn();
jest.mock('@/lib/check-in', () => ({
  ...jest.requireActual('@/lib/check-in'),
  fetchCheckInMatch: (...args: unknown[]) => mockFetchCheckInMatch(...args),
  fetchMyCheckIn: (...args: unknown[]) => mockFetchMyCheckIn(...args),
  checkInToMatch: (...args: unknown[]) => mockCheckInToMatch(...args),
}));
let mockNow = new Date('2026-11-20T18:30:00Z');
jest.mock('@/lib/booking-search', () => ({ useNow: () => mockNow }));

// A 20:00–21:00 Cyprus game (UTC+2 in November): check-in 19:00 to 22:00.
const match = {
  id: MATCH,
  kickoff_at: '2026-11-20T18:00:00+00:00',
  ends_at: '2026-11-20T19:00:00+00:00',
  status: 'scheduled',
  venue_name: 'Pitch Club',
};

beforeEach(() => {
  mockParams = { match: MATCH, code: CODE };
  mockUser = { id: 'me' };
  mockReplace.mockReset();
  mockBack.mockReset();
  mockCanGoBack = false;
  mockNow = new Date('2026-11-20T18:30:00Z');
  mockFetchCheckInMatch.mockReset().mockResolvedValue({ data: match, error: null });
  mockFetchMyCheckIn.mockReset().mockResolvedValue({ data: false, error: null });
  mockCheckInToMatch.mockReset().mockResolvedValue({ data: null, error: null });
});

describe('the check-in deep link', () => {
  it('shows the game and checks in only on a tap', async () => {
    await render(<CheckInScreen />);
    expect(mockFetchCheckInMatch).toHaveBeenCalledWith({ matchId: MATCH });
    expect(await screen.findByText('Fri 20 Nov · 20:00 · Pitch Club')).toBeTruthy();
    expect(mockCheckInToMatch).not.toHaveBeenCalled();
    await act(() => fireEvent.press(screen.getByText('Check in')));
    expect(mockCheckInToMatch).toHaveBeenCalledWith(MATCH, CODE);
    expect(screen.getByText("You're checked in.")).toBeTruthy();
    await act(() => fireEvent.press(screen.getByText('See the match')));
    expect(mockReplace).toHaveBeenCalledWith(`/match/${MATCH}`);
  });

  it('says so when the player is already checked in', async () => {
    mockFetchMyCheckIn.mockResolvedValue({ data: true, error: null });
    await render(<CheckInScreen />);
    expect(await screen.findByText("You're checked in.")).toBeTruthy();
    expect(screen.queryByText('Check in')).toBeNull();
  });

  it('before the window, says when it opens', async () => {
    mockNow = new Date('2026-11-20T16:00:00Z');
    await render(<CheckInScreen />);
    expect(await screen.findByText('Check-in opens at 19:00')).toBeTruthy();
    expect(screen.queryByText('Check in')).toBeNull();
  });

  it('after the window, says it is closed', async () => {
    mockNow = new Date('2026-11-20T20:00:00Z');
    await render(<CheckInScreen />);
    expect(
      await screen.findByText(
        'Check-in for this game is closed. It opens an hour before kickoff and closes an hour after the end.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Check in')).toBeNull();
  });

  it('words a refusal from the server', async () => {
    mockCheckInToMatch.mockResolvedValue({ data: null, error: { message: 'invalid_code' } });
    await render(<CheckInScreen />);
    await act(async () => fireEvent.press(await screen.findByText('Check in')));
    expect(screen.getByText("That code doesn't match this game. Check it with the venue.")).toBeTruthy();
  });

  it('a broken link says it is not a check-in link and never calls the server', async () => {
    mockParams = { match: 'nope', code: CODE };
    await render(<CheckInScreen />);
    expect(screen.getByText("This isn't a Futty check-in link. Scan the QR the venue shows you.")).toBeTruthy();
    expect(mockFetchCheckInMatch).not.toHaveBeenCalled();
    await act(() => fireEvent.press(screen.getByText('Done')));
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('a game the player cannot see reads as not found', async () => {
    mockFetchCheckInMatch.mockResolvedValue({ data: null, error: null });
    await render(<CheckInScreen />);
    expect(await screen.findByText("We couldn't find this game, or you're not in it.")).toBeTruthy();
  });

  it('offers a retry when the game cannot load', async () => {
    mockFetchCheckInMatch.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await render(<CheckInScreen />);
    await act(async () => fireEvent.press(await screen.findByText('Try again')));
    expect(mockFetchCheckInMatch).toHaveBeenCalledTimes(2);
    expect(await screen.findByText('Check in')).toBeTruthy();
  });

  it('signed out: asks to sign in and checks nothing', async () => {
    mockUser = null;
    mockCanGoBack = true;
    await render(<CheckInScreen />);
    expect(screen.getByText('Sign in to check in, then scan the venue’s code again.')).toBeTruthy();
    expect(mockFetchCheckInMatch).not.toHaveBeenCalled();
    await act(() => fireEvent.press(screen.getByText('Sign in')));
    expect(mockReplace).toHaveBeenCalledWith('/sign-in');
  });

  it('Done goes back when it can', async () => {
    mockCanGoBack = true;
    mockParams = {};
    await render(<CheckInScreen />);
    await act(() => fireEvent.press(screen.getByText('Done')));
    expect(mockBack).toHaveBeenCalled();
  });
});
