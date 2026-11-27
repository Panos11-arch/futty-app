import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import { FeaturedEvent, featuredEventLine } from '@/components/home/featured-event';
import type { FeaturedEvent as Event, FeaturedTournament } from '@/lib/featured-event';
import type { FeaturedEventState } from '@/lib/use-featured-event';

let mockState: FeaturedEventState = { status: 'loading' };
const mockReload = jest.fn();
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
// lib/featured-event reads Team Premium's flag (lib/premium), which loads the Supabase client.
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/use-featured-event', () => ({ useFeaturedEvent: () => ({ ...mockState, reload: mockReload }) }));

const event: Event = { id: 'l1', kind: 'league', name: 'Limassol League', format: '5-a-side', startDate: '2026-12-05' };

describe('Home "Featured event": a league (image 01; when no tournament is featured)', () => {
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

  it('Join opens the league’s competition page (S10)', async () => {
    mockState = { status: 'ready', event };
    await render(<FeaturedEvent refreshSignal={0} />);
    await fireEvent.press(screen.getByTestId('home-featured-join'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/leagues/[id]', params: { id: event.id } });
  });

  it('pull to refresh loads it again', async () => {
    mockState = { status: 'ready', event };
    await render(<FeaturedEvent refreshSignal={0} />);
    expect(mockReload).not.toHaveBeenCalled();
    await screen.rerender(<FeaturedEvent refreshSignal={1} />);
    expect(mockReload).toHaveBeenCalledTimes(1);
  });
});

// S10B, image 01: a tournament comes before a league.
const cup: FeaturedTournament = {
  id: 't1',
  kind: 'tournament',
  name: 'Nuevo Campo Cup',
  area: 'Limassol',
  format: '5-a-side',
  maxTeams: 16,
  entryFeeCents: 1200,
  comingSoon: true,
  startDate: '2026-12-12',
};

describe('Home "Featured event": a tournament (S10B, image 01)', () => {
  beforeEach(() => jest.mocked(router.push).mockClear());

  it('Coming soon: the kind line, the name, teams · format · fee, and a Coming soon button', async () => {
    mockState = { status: 'ready', event: cup };
    await render(<FeaturedEvent refreshSignal={0} />);
    const card = screen.getByTestId('home-featured-event');
    expect(card).toHaveTextContent(/Tournament · Coming soon/);
    expect(card).toHaveTextContent(/Nuevo Campo Cup/);
    expect(screen.getByText('16 teams · 5-a-side · €12 per player')).toBeTruthy();
    expect(screen.queryByTestId('home-featured-join')).toBeNull();
    expect(screen.getByTestId('home-featured-coming-soon')).toHaveTextContent('Coming soon');
  });

  it('Coming soon opens the Coming soon screen (tournamentHref)', async () => {
    mockState = { status: 'ready', event: cup };
    await render(<FeaturedEvent refreshSignal={0} />);
    await fireEvent.press(screen.getByTestId('home-featured-coming-soon'));
    expect(router.push).toHaveBeenCalledWith({
      pathname: '/leagues/coming-soon',
      params: { kind: 'tournament', name: 'Nuevo Campo Cup', scope: 'limassol', format: '5-a-side', teams: '16' },
    });
  });

  it('sign-up open: the kind line and Join, which opens the tournament page', async () => {
    mockState = { status: 'ready', event: { ...cup, comingSoon: false } };
    await render(<FeaturedEvent refreshSignal={0} />);
    expect(screen.getByTestId('home-featured-event')).toHaveTextContent(/Tournament · Sign-up open/);
    expect(screen.queryByTestId('home-featured-coming-soon')).toBeNull();
    await fireEvent.press(screen.getByTestId('home-featured-join'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/leagues/tournament/[id]', params: { id: 't1' } });
  });

  it('the fee is the short form only, never the organiser line; cents show when not whole', async () => {
    mockState = { status: 'ready', event: { ...cup, entryFeeCents: 650 } };
    await render(<FeaturedEvent refreshSignal={0} />);
    expect(screen.getByText('16 teams · 5-a-side · €6.50 per player')).toBeTruthy();
    expect(screen.getByTestId('home-featured-event')).not.toHaveTextContent(/organiser/);
  });

  it('no fee: that part is left out', async () => {
    mockState = { status: 'ready', event: { ...cup, entryFeeCents: 0 } };
    await render(<FeaturedEvent refreshSignal={0} />);
    expect(screen.getByText('16 teams · 5-a-side')).toBeTruthy();
    expect(screen.getByTestId('home-featured-event')).not.toHaveTextContent(/€/);
  });

  it('words: labels only, buttons 1-3 words starting with a verb or the Coming soon state', async () => {
    for (const comingSoon of [true, false]) {
      mockState = { status: 'ready', event: { ...cup, comingSoon } };
      const view = await render(<FeaturedEvent refreshSignal={0} />);
      const button = screen.getByRole('button');
      expect(button.props.accessibilityLabel.split(' ').length).toBeLessThanOrEqual(3);
      expect(screen.getByText('Featured event')).toBeTruthy();
      expect(screen.getByTestId('home-featured-event')).not.toHaveTextContent(/\.\s|!/);
      await view.unmount();
    }
  });
});
