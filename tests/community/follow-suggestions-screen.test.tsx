import './mocks';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { router } from 'expo-router';

import FollowSuggestionsScreen from '@/app/follow-suggestions';

import { suggestion } from './fixtures';

const mockFetch = jest.fn();
const mockDismiss = jest.fn();
const mockToggle = jest.fn();
jest.mock('@/lib/community', () => ({
  ...jest.requireActual('@/lib/community'),
  fetchFollowSuggestions: (...a: unknown[]) => mockFetch(...a),
  dismissFollowSuggestion: (...a: unknown[]) => mockDismiss(...a),
}));
jest.mock('@/lib/use-follows', () => ({
  useFollows: () => ({ status: 'ready', isFollowing: () => false, toggle: mockToggle, reload: jest.fn() }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockToggle.mockResolvedValue({ error: null });
  mockDismiss.mockResolvedValue({ error: null });
});

describe('See all suggestions', () => {
  it('skeleton while loading, asking for up to 50', async () => {
    mockFetch.mockReturnValue(new Promise(() => {}));
    await render(<FollowSuggestionsScreen />);
    expect(screen.getByTestId('suggestions-list-skeleton')).toBeTruthy();
    expect(mockFetch).toHaveBeenCalledWith(50);
  });

  it('rows: open, follow, dismiss', async () => {
    mockFetch.mockResolvedValue({
      data: [suggestion(), suggestion({ id: 'u-petros', full_name: 'Petros', matches_in_common: 1 })],
      error: null,
    });
    await render(<FollowSuggestionsScreen />);
    expect(await screen.findByText('1 match in common')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Nikos, 3 matches in common' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'u-nikos' } });
    await fireEvent.press(screen.getAllByRole('button', { name: 'Follow' })[0]);
    expect(mockToggle).toHaveBeenCalledWith('player', 'u-nikos');
    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss Petros' }));
    expect(mockDismiss).toHaveBeenCalledWith('u-petros');
    await waitFor(() => expect(screen.queryByText('Petros')).toBeNull());
  });

  it('empty: one line and one button', async () => {
    mockFetch.mockResolvedValue({ data: [], error: null });
    await render(<FollowSuggestionsScreen />);
    expect(await screen.findByText('No suggestions yet.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Go back' }));
    expect(router.back).toHaveBeenCalled();
  });

  it('error: one line and Try again', async () => {
    mockFetch.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    await render(<FollowSuggestionsScreen />);
    expect(await screen.findByText("Couldn't load suggestions.")).toBeTruthy();
    mockFetch.mockResolvedValueOnce({ data: [suggestion()], error: null });
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Nikos')).toBeTruthy();
  });
});
