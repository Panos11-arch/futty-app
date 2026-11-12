import { fireEvent, render, screen } from '@testing-library/react-native';

import { TeammatesList } from '@/components/match/teammates-list';

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const teammates = [
  { teammate_profile_id: 'b', matches_together: 7, last_played_at: '2026-11-07T17:00:00Z', name: 'Bob' },
  { teammate_profile_id: 'a', matches_together: 1, last_played_at: '2026-11-01T17:00:00Z', name: 'Ann' },
];

describe('TeammatesList', () => {
  it('keeps the server’s order and counts', async () => {
    await render(<TeammatesList state={{ status: 'ready', teammates }} onRetry={jest.fn()} />);
    expect(screen.getAllByTestId('teammate-row').map((r) => r.props.accessibilityLabel)).toEqual(['Bob', 'Ann']);
    expect(screen.getByText('7 games together')).toBeTruthy();
    expect(screen.getByText('1 game together')).toBeTruthy();
  });

  it('opens a teammate’s profile', async () => {
    await render(<TeammatesList state={{ status: 'ready', teammates }} onRetry={jest.fn()} />);
    await fireEvent.press(screen.getByText('Bob'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/player-profile', params: { profileId: 'b' } });
  });

  it('loading, empty and error states', async () => {
    const onRetry = jest.fn();
    const { rerender } = await render(<TeammatesList state={{ status: 'loading' }} onRetry={onRetry} />);
    expect(screen.getByTestId('teammates-skeleton')).toBeTruthy();
    await rerender(<TeammatesList state={{ status: 'ready', teammates: [] }} onRetry={onRetry} />);
    expect(screen.getByText('Play a confirmed match to see who you play with most')).toBeTruthy();
    await rerender(<TeammatesList state={{ status: 'error' }} onRetry={onRetry} />);
    await fireEvent.press(screen.getByText('Try again'));
    expect(onRetry).toHaveBeenCalled();
  });
});
