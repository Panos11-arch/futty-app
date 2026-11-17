import { render, screen } from '@testing-library/react-native';

import MatchScreen from '@/app/match/[id]';
import { mockResultMatch } from '@/lib/match/mock';
import type { ResultMatch } from '@/lib/match/result';

// A8 (spec 13, "Post-match offers"): the match screen asks the server for
// the offers once a score is in (even a rejected one), and shows nothing
// when the server returns none, as it does for a viewer who isn't playing
// (a booker or captain not on the roster, the venue's staff).

const mockRpc = jest.fn();
let mockMatch: ResultMatch;
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    storage: { from: () => ({ createSignedUrls: jest.fn() }) },
  },
}));
jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useFocusEffect: () => undefined,
  useLocalSearchParams: () => ({ id: 'm1' }),
}));
jest.mock('@/lib/match/use-match-result', () => ({
  useResultMatch: () => ({ status: 'ready', match: mockMatch, viewerId: 'viewer', reload: jest.fn() }),
}));
jest.mock('@/components/booking/check-in-panel', () => ({ CheckInSection: () => null }));
// The A4b match page sections have their own tests (tests/match/match-page-screen.test.tsx).
jest.mock('@/lib/match/use-levels', () => ({
  useMatchRatings: () => ({ status: 'loading', reload: jest.fn() }),
}));
jest.mock('@/lib/match/use-match-page', () => ({
  useMatchPage: () => ({ status: 'ready', page: null, reload: jest.fn() }),
  useMatchRoster: () => ({ status: 'loading', reload: jest.fn() }),
  useFormationPresets: () => ({ status: 'loading', reload: jest.fn() }),
}));
jest.mock('@/lib/use-fixtures', () => ({ useMyCaptainTeamIds: () => [] }));
jest.mock('@/components/match/result-panel', () => ({ MatchResultPanel: () => null }));
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: jest.requireActual<typeof import('react-native')>('react-native').View,
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const lemonade = {
  id: 'i1',
  name: 'Lemonade',
  description: null,
  offer_text: null,
  price_cents: 250,
  offer_price_cents: null,
  photo_path: null,
};

beforeEach(() => mockRpc.mockReset());

describe('Match screen post-match offers', () => {
  it('a viewer who isn\'t playing sees nothing and no error', async () => {
    mockMatch = mockResultMatch({ submission: {}, inMatch: false });
    mockRpc.mockResolvedValueOnce({ data: [], error: null });
    await render(<MatchScreen />);
    expect(mockRpc).toHaveBeenCalledWith('post_match_offers', { p_match_id: 'm1' });
    expect(screen.queryByText('Post-match offers')).toBeNull();
    expect(screen.queryByText(/Only players in this match/)).toBeNull();
  });

  it('a player sees them after a rejected score', async () => {
    mockMatch = mockResultMatch({ submission: { response: 'rejected' }, status: 'disputed', mySide: 'a' });
    mockRpc.mockResolvedValueOnce({ data: [lemonade], error: null });
    await render(<MatchScreen />);
    expect(await screen.findByText('Post-match offers')).toBeTruthy();
    expect(screen.getByText('Lemonade')).toBeTruthy();
  });

  it('asks for nothing before a score is in', async () => {
    mockMatch = mockResultMatch({ mySide: 'a' });
    await render(<MatchScreen />);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
