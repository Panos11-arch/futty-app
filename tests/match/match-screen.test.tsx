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
// The match page sections (A4b) are covered in match-page-screen.test.tsx; here the page has nothing to add.
jest.mock('@/lib/match/use-match-log', () => ({
  useMatchLog: () => ({ status: 'ready', log: null, reload: jest.fn() }),
}));
jest.mock('@/lib/match/use-match-page', () => ({
  useMatchPage: () => ({ status: 'ready', page: null, reload: jest.fn() }),
  useMatchRoster: () => ({ status: 'loading', reload: jest.fn() }),
  useFormationPresets: () => ({ status: 'loading', reload: jest.fn() }),
}));
jest.mock('@/lib/use-fixtures', () => ({ useMyCaptainTeamIds: () => new Set<string>() }));
jest.mock('@/components/booking/check-in-panel', () => ({ CheckInSection: () => null }));

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

  it('ready: when and where; no score card before a score (S13B: logged on the after-game screens)', async () => {
    mockState = { status: 'ready', match: mockResultMatch() };
    await render(<MatchScreen />);
    expect(screen.getByText('Sat 14 Nov · 19:00 · Nuevo Campo')).toBeTruthy();
    expect(screen.queryByTestId('match-result-panel')).toBeNull();
  });
});
