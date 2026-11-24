// The after-game screen (S13B, app/match/after-game.tsx): the captain logs;
// everyone else votes for Man of the Match while it is open.
import '../navigation/mocks';

import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import AfterGameScreen from '@/app/match/after-game';
import { mockMatchLog } from '@/lib/match/log-score-mock';
import { mockMatchPage, mockRoster, PAGE_OPEN } from '@/lib/match/mock';

let mockLog: Record<string, unknown> = { status: 'loading' };
let mockParams: Record<string, string> = { id: 'm1' };
const mockReloadLog = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => false },
  Stack: { Screen: () => null },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('@/lib/match/use-match-log', () => ({ useMatchLog: () => ({ ...mockLog, reload: mockReloadLog }) }));
jest.mock('@/lib/match/use-match-page', () => ({
  useMatchPage: () => ({ status: 'ready', page: mockMatchPage(), reload: jest.fn() }),
  useMatchRoster: () => ({ status: 'ready', roster: mockRoster(), reload: jest.fn() }),
}));
jest.mock('@/lib/match/log-score-api', () => ({ logMatchResult: jest.fn(), setMatchStats: jest.fn() }));
jest.mock('@/lib/match/page-api', () => ({ castMotmVote: jest.fn() }));
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual<typeof import('react-native')>('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) };
});

beforeEach(() => {
  mockParams = { id: 'm1' };
  mockReloadLog.mockReset();
  jest.mocked(router.replace).mockClear();
});

describe('After the game', () => {
  it('loading: a skeleton; an error: one line and Try again; no match: one line', async () => {
    mockLog = { status: 'loading' };
    const view = await render(<AfterGameScreen />);
    expect(screen.getByTestId('after-game-skeleton')).toBeTruthy();
    mockLog = { status: 'error', message: 'boom' };
    await view.rerender(<AfterGameScreen />);
    await fireEvent.press(screen.getByText('Try again'));
    expect(mockReloadLog).toHaveBeenCalled();
    mockLog = { status: 'ready', log: null };
    await view.rerender(<AfterGameScreen />);
    expect(screen.getByText('Match not found')).toBeTruthy();
  });

  it('the captain, while he can log: Score first', async () => {
    mockLog = { status: 'ready', log: mockMatchLog() };
    await render(<AfterGameScreen />);
    expect(screen.getByTestId('post-match-step-score')).toBeTruthy();
  });

  it('a correction opens only with ?correct=1, on Goals', async () => {
    mockLog = { status: 'ready', log: mockMatchLog({ status: 'confirmed', score: { a: 2, b: 1 }, canLog: false, canCorrect: true }) };
    const view = await render(<AfterGameScreen />);
    expect(screen.queryByTestId('post-match-step-goals')).toBeNull();
    mockParams = { id: 'm1', correct: '1' };
    await view.rerender(<AfterGameScreen />);
    expect(screen.getByTestId('post-match-step-goals')).toBeTruthy();
  });

  it('a player who checked in: the Man of the Match vote while it is open', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(PAGE_OPEN);
    mockLog = { status: 'ready', log: mockMatchLog({ writableSides: [], canLog: false }) };
    await render(<AfterGameScreen />);
    expect(screen.getByTestId('post-match-step-motm')).toBeTruthy();
    expect(screen.queryByTestId('post-match-step-score')).toBeNull();
    jest.restoreAllMocks();
  });

  it('nothing left: one line and Open match', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2099-01-01T00:00:00Z'));
    mockLog = { status: 'ready', log: mockMatchLog({ writableSides: [], canLog: false }) };
    await render(<AfterGameScreen />);
    expect(screen.getByText('Nothing to add for this match.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('post-match-open-match'));
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/match/[id]', params: { id: 'm1' } });
    jest.restoreAllMocks();
  });
});
