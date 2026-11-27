import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { FixtureScoreEntry } from '@/components/match/fixture-score-entry';
import type { Fixture } from '@/lib/fixtures';

let mockLinks: { status: string; links: { byLeagueFixtureId: Map<string, string> } };

jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock()
);
jest.mock('@/components/fixture-score-form', () => {
  const { Text } = jest.requireActual<typeof import('react-native')>('react-native');
  return { FixtureScoreForm: () => <Text>old fixture form</Text> };
});
jest.mock('@/lib/match/use-match-result', () => ({ useMatchLinks: () => ({ ...mockLinks, reload: jest.fn() }) }));

const fixture = { id: 'fx1', match_flow: false } as Fixture;

describe('FixtureScoreEntry', () => {
  it('a fixture recorded before A2 keeps the old form', async () => {
    mockLinks = { status: 'ready', links: { byLeagueFixtureId: new Map() } };
    await render(<FixtureScoreEntry fixture={fixture} onSubmitted={jest.fn()} />);
    expect(screen.getByText('old fixture form')).toBeTruthy();
  });

  it('a fixture with a match goes straight to its Log the score flow', async () => {
    mockLinks = { status: 'ready', links: { byLeagueFixtureId: new Map([['fx1', 'm9']]) } };
    await render(<FixtureScoreEntry fixture={{ ...fixture, match_flow: true }} onSubmitted={jest.fn()} />);
    expect(screen.queryByText('old fixture form')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Log the score' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/match/after-game', params: { id: 'm9' } });
  });

  it('a fixture made since S10 with no match yet shows no form (the server would refuse it)', async () => {
    mockLinks = { status: 'ready', links: { byLeagueFixtureId: new Map() } };
    await render(<FixtureScoreEntry fixture={{ ...fixture, match_flow: true }} onSubmitted={jest.fn()} />);
    expect(screen.queryByText('old fixture form')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Log the score' })).toBeNull();
  });

  it('shows no form until it knows', async () => {
    mockLinks = { status: 'loading', links: { byLeagueFixtureId: new Map() } };
    await render(<FixtureScoreEntry fixture={fixture} onSubmitted={jest.fn()} />);
    expect(screen.queryByText('old fixture form')).toBeNull();
  });
});
