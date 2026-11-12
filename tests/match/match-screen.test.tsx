import '../navigation/mocks';

import { fireEvent, render, screen } from '@testing-library/react-native';

import MatchScreen from '@/app/match/[id]';
import { mockResultMatch } from '@/lib/match/mock';

let mockState: Record<string, unknown>;
const mockReload = jest.fn();

jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return {
    Stack: { Screen: () => null },
    useLocalSearchParams: () => ({ id: 'm1' }),
    useFocusEffect: (effect: () => void) => useEffect(effect, [effect]),
  };
});
jest.mock('@/lib/match/use-match-result', () => ({
  useResultMatch: () => ({ ...mockState, viewerId: 'booker', reload: mockReload }),
}));
jest.mock('@/lib/use-fixtures', () => ({ useMyCaptainTeamIds: () => new Set<string>() }));
jest.mock('@/lib/match/results-api', () => ({ submitMatchResult: jest.fn(), respondToMatchResult: jest.fn() }));

beforeEach(() => mockReload.mockReset());

describe('Match screen', () => {
  it('loading: a skeleton', async () => {
    mockState = { status: 'loading' };
    await render(<MatchScreen />);
    expect(screen.getByTestId('match-skeleton')).toBeTruthy();
  });

  it('error: an inline error with retry', async () => {
    mockState = { status: 'error', message: 'boom' };
    await render(<MatchScreen />);
    expect(screen.getByText('Could not load this match.')).toBeTruthy();
    mockReload.mockClear();
    await fireEvent.press(screen.getByText('Try again'));
    expect(mockReload).toHaveBeenCalled();
  });

  it('not found (or not the viewer’s match)', async () => {
    mockState = { status: 'ready', match: null };
    await render(<MatchScreen />);
    expect(screen.getByText('Match not found')).toBeTruthy();
  });

  it('ready: when, where and the result panel', async () => {
    mockState = { status: 'ready', match: mockResultMatch() };
    await render(<MatchScreen />);
    expect(screen.getByText('Sat 14 Nov · 19:00 · Nuevo Campo')).toBeTruthy();
    expect(screen.getByTestId('match-result-panel')).toBeTruthy();
  });
});
