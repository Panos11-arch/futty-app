import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { FeaturedEvent, featuredEventLine } from '@/components/home/featured-event';
import type { FeaturedEvent as Event } from '@/lib/featured-event';
import type { FeaturedEventState } from '@/lib/use-featured-event';

let mockState: FeaturedEventState = { status: 'loading' };
const mockReload = jest.fn();
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@/lib/use-featured-event', () => ({ useFeaturedEvent: () => ({ ...mockState, reload: mockReload }) }));

const event: Event = { id: 'l1', kind: 'league', name: 'Limassol League', format: '5-a-side', startDate: '2026-12-05' };

describe('Home "Featured event" (image 01; leagues in sign-up until S10B)', () => {
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

  it('an event: its kind, name and line, no photo and no price', async () => {
    mockState = { status: 'ready', event };
    await render(<FeaturedEvent refreshSignal={0} />);
    const card = screen.getByTestId('home-featured-event');
    expect(card).toHaveTextContent(/League · Sign-up open/);
    expect(card).toHaveTextContent(/Limassol League/);
    expect(card).toHaveTextContent(/5-a-side · Sat 5 Dec/);
    expect(card).not.toHaveTextContent(/€/);
  });

  it('Join opens the event (Leagues until S10)', async () => {
    mockState = { status: 'ready', event };
    await render(<FeaturedEvent refreshSignal={0} />);
    await fireEvent.press(screen.getByTestId('home-featured-join'));
    expect(router.push).toHaveBeenCalledWith('/leagues');
  });

  it('pull to refresh loads it again', async () => {
    mockState = { status: 'ready', event };
    await render(<FeaturedEvent refreshSignal={0} />);
    expect(mockReload).not.toHaveBeenCalled();
    await screen.rerender(<FeaturedEvent refreshSignal={1} />);
    expect(mockReload).toHaveBeenCalledTimes(1);
  });
});
