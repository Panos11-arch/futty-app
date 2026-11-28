import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { FeaturedEvent, featuredEventLine } from '@/components/home/featured-event';
import type { FeaturedEvent as Event } from '@/lib/featured-event';
import type { FeaturedEventState } from '@/lib/use-featured-event';

let mockState: FeaturedEventState = { status: 'loading' };
const mockReload = jest.fn();
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
// lib/featured-event reads Team Premium's flag (lib/premium), which loads the Supabase client.
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/use-featured-event', () => ({ useFeaturedEvent: () => ({ ...mockState, reload: mockReload }) }));

// S10B: the source is tournaments in sign-up.
const event: Event = { id: 't1', kind: 'tournament', name: 'Nuevo Campo Cup', format: '5-a-side', startDate: '2026-12-05', comingSoon: false };

describe('Home "Featured event" (image 01; tournaments from S10B)', () => {
  beforeEach(() => {
    jest.mocked(router.push).mockClear();
    mockReload.mockClear();
  });

  it('the line is the format and the Cyprus start day', () => {
    expect(featuredEventLine(event)).toBe('5-a-side · Sat 5 Dec');
  });

  it.each<[string, FeaturedEventState]>([
    ['loading', { status: 'loading' }],
    ['an error', { status: 'error', message: 'offline' }],
    ['no event', { status: 'ready', event: null }],
  ])('%s: no section and never an empty card', async (_, state) => {
    mockState = state;
    await render(<FeaturedEvent refreshSignal={0} />);
    expect(screen.queryByText('Featured event')).toBeNull();
    expect(screen.queryByTestId('home-featured-event')).toBeNull();
  });

  it('an event: its kind, name and line', async () => {
    mockState = { status: 'ready', event };
    await render(<FeaturedEvent refreshSignal={0} />);
    const card = screen.getByTestId('home-featured-event');
    expect(card).toHaveTextContent(/Tournament · Sign-up open/);
    expect(card).toHaveTextContent(/Nuevo Campo Cup/);
    expect(card).toHaveTextContent(/5-a-side · Sat 5 Dec/);
  });

  it('Join opens the tournament page', async () => {
    mockState = { status: 'ready', event };
    await render(<FeaturedEvent refreshSignal={0} />);
    await fireEvent.press(screen.getByTestId('home-featured-join'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/leagues/tournament/[id]', params: { id: event.id } });
  });

  it('Coming soon (no dates yet): Coming soon instead of Join (1o item 2)', async () => {
    mockState = { status: 'ready', event: { ...event, comingSoon: true, startDate: null } };
    await render(<FeaturedEvent refreshSignal={0} />);
    expect(screen.getByTestId('home-featured-event')).toHaveTextContent(/Coming soon/);
    expect(screen.queryByTestId('home-featured-join')).toBeNull();
  });

  it('pull to refresh loads it again', async () => {
    mockState = { status: 'ready', event };
    await render(<FeaturedEvent refreshSignal={0} />);
    expect(mockReload).not.toHaveBeenCalled();
    await screen.rerender(<FeaturedEvent refreshSignal={1} />);
    expect(mockReload).toHaveBeenCalledTimes(1);
  });
});
