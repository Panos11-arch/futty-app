// S6 Find a match: the card, the filter sheet and the screen's states.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { FindMatchView, type FindMatchViewProps } from '@/components/booking/find-match/find-match-view';
import { MatchCard } from '@/components/booking/find-match/match-card';
import { MatchFilterSheet } from '@/components/booking/find-match/match-filter-sheet';
import { buildCards, emptyFilters, groupByDay, type MatchFilters, type MatchRow } from '@/lib/find-match';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(() => Promise.resolve()), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const TODAY = '2026-11-24';

function row(over: Partial<MatchRow> = {}): MatchRow {
  return {
    post_id: 'p1',
    kind: 'players',
    scheduled_at: '2026-11-27T17:00:00Z',
    format: '7-a-side',
    venue_id: 'v1',
    venue_name: 'Nuevo Campo',
    venue_city: 'Limassol',
    organiser_id: 'u1',
    organiser_name: 'Andreas',
    team_id: null,
    team_name: null,
    players_in: 12,
    capacity: 14,
    level_min: '4.00',
    level_max: '6.00',
    people: [
      { id: 'u1', name: 'Andreas' },
      { id: null, name: 'Staff Sam' },
    ],
    ...over,
  };
}

const prices = new Map([['p1', { share_cents: 680, fee_cents: null, pitch_cents: null }]]);
const playersCard = buildCards([row()], new Map(), prices)[0];
const oppositionCard = buildCards(
  [row({ post_id: 'p2', kind: 'opposition', team_id: 't1', team_name: 'Limassol Lions', level_min: '6.10', level_max: '6.10', players_in: null, capacity: null })],
  new Map(),
  null,
)[0];

describe('MatchCard', () => {
  async function renderCard(card = playersCard) {
    const p = { onOpen: jest.fn(), onOpenPlayer: jest.fn(), onOpenTeam: jest.fn() };
    await render(<MatchCard card={card} {...p} />);
    return p;
  }

  it('shows a players game as image 05: time · format, level, organiser, venue, spots, price', async () => {
    await renderCard();
    expect(screen.getByText('19:00 · 7-a-side')).toBeTruthy();
    expect(screen.getByText('Level 4.0–6.0')).toBeTruthy();
    expect(screen.getByText('Organised by Andreas')).toBeTruthy();
    expect(screen.getByText(' · Nuevo Campo')).toBeTruthy();
    expect(screen.getByText('12/14')).toBeTruthy();
    expect(screen.getByText('€6.80 per player')).toBeTruthy();
    expect(screen.queryByText('Opposition wanted')).toBeNull();
  });

  it('shows an opposition post with the tag, the team and its level, no spots, no price', async () => {
    await renderCard(oppositionCard);
    expect(screen.getByTestId('find-match-opposition-p2')).toBeTruthy();
    expect(screen.getByText('Opposition wanted')).toBeTruthy();
    expect(screen.getByText('Limassol Lions')).toBeTruthy();
    expect(screen.getByText(' · Level 6.1 · Nuevo Campo')).toBeTruthy();
    expect(screen.queryByText(/\/\d/)).toBeNull();
    expect(screen.queryByTestId('find-match-price-p2')).toBeNull();
  });

  it('opens the game, the organiser, each player and the team', async () => {
    const p = await renderCard();
    await fireEvent.press(screen.getByTestId('find-match-card-p1'));
    expect(p.onOpen).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('find-match-organiser-p1'));
    expect(p.onOpenPlayer).toHaveBeenCalledWith('u1');
    await fireEvent.press(screen.getByTestId('find-match-avatar-p1-0'));
    expect(p.onOpenPlayer).toHaveBeenCalledTimes(2);
    // A house player has no profile to open.
    expect(screen.queryByTestId('find-match-avatar-p1-1')).toBeNull();
  });

  it('opens the team on an older opposition post', async () => {
    const p = await renderCard(oppositionCard);
    await fireEvent.press(screen.getByTestId('find-match-organiser-p2'));
    expect(p.onOpenTeam).toHaveBeenCalledWith('t1');
  });

  it('says the whole card to a screen reader', async () => {
    await renderCard();
    expect(screen.getByLabelText('19:00, 7-a-side, Organised by Andreas, Level 4.0–6.0, Nuevo Campo, 12 of 14 players, €6.80 per player')).toBeTruthy();
  });
});

describe('MatchFilterSheet', () => {
  async function renderSheet(initial: MatchFilters | null = null) {
    const p = {
      visible: true,
      onClose: jest.fn(),
      initial,
      today: TODAY,
      windowDays: 7,
      towns: ['Limassol'],
      venues: [{ id: 'v1', name: 'Kamares', city: 'Larnaca' }],
      onApply: jest.fn(),
    };
    await render(<MatchFilterSheet {...p} />);
    return p;
  }

  it('steps through format, places, days and time, then applies', async () => {
    const p = await renderSheet();
    expect(screen.getByText('Which format?')).toBeTruthy();
    expect(screen.getByTestId('find-match-filter-next-format').props.accessibilityState?.disabled).toBe(true);
    await fireEvent.press(screen.getByTestId('find-match-format-5-a-side'));
    await fireEvent.press(screen.getByTestId('find-match-filter-next-format'));

    expect(screen.getByText('Places')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('find-match-place-town:Limassol'));
    await fireEvent.press(screen.getByTestId('find-match-filter-next-places'));

    expect(screen.getByText('Choose your days')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('find-match-day-2026-11-25'));
    await fireEvent.press(screen.getByTestId('find-match-filter-next-days'));

    expect(screen.getByText('At what time?')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('find-match-time-preset-evening'));
    await fireEvent.press(screen.getByTestId('find-match-filter-see-results'));
    expect(p.onApply).toHaveBeenCalledWith({
      format: '5-a-side',
      place: { kind: 'town', town: 'Limassol' },
      days: ['2026-11-25'],
      window: { preset: 'evening', from: '18:00', to: '24:00' },
    });
  });

  it('starts from the filters so far and can pick a venue', async () => {
    const p = await renderSheet({ ...emptyFilters(), format: '7-a-side' });
    await fireEvent.press(screen.getByTestId('find-match-filter-next-format'));
    await fireEvent.press(screen.getByTestId('find-match-place-venue:v1'));
    await fireEvent.press(screen.getByTestId('find-match-filter-next-places'));
    await fireEvent.press(screen.getByTestId('find-match-filter-next-days'));
    await fireEvent.press(screen.getByTestId('find-match-filter-see-results'));
    expect(p.onApply).toHaveBeenCalledWith(
      expect.objectContaining({ format: '7-a-side', place: { kind: 'venue', venueId: 'v1', name: 'Kamares' }, days: [] }),
    );
  });
});

describe('FindMatchView', () => {
  const filters: MatchFilters = { ...emptyFilters(), format: '5-a-side', place: { kind: 'town', town: 'Limassol' } };

  function props(over: Partial<FindMatchViewProps> = {}): FindMatchViewProps {
    return {
      today: TODAY,
      windowDays: 7,
      towns: ['Limassol'],
      venues: [],
      recents: [],
      filters,
      results: { status: 'ready', data: groupByDay([playersCard, oppositionCard], TODAY) },
      refreshing: false,
      onRefresh: jest.fn(),
      onRetry: jest.fn(),
      onApplyFilters: jest.fn(),
      onPickPlace: jest.fn(),
      onRequestVenue: jest.fn(async () => {}),
      onOpenCard: jest.fn(),
      onOpenPlayer: jest.fn(),
      onOpenTeam: jest.fn(),
      onStartMatch: jest.fn(),
      ...over,
    };
  }

  it('with no filters: "No filters yet", one line, "Set filters" opens "Which format?"', async () => {
    await render(<FindMatchView {...props({ filters: null, results: null })} />);
    expect(screen.getByText('No filters yet')).toBeTruthy();
    expect(screen.getByText('Format | Places | Dates and times')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('find-match-set-filters'));
    expect(screen.getByText('Which format?')).toBeTruthy();
  });

  it('shows skeletons while loading', async () => {
    await render(<FindMatchView {...props({ results: { status: 'loading' } })} />);
    expect(screen.getByTestId('find-match-skeleton')).toBeTruthy();
  });

  it('shows one line and "Try again" on an error', async () => {
    const p = props({ results: { status: 'error', message: 'Couldn’t load games. Try again.' } });
    await render(<FindMatchView {...p} />);
    expect(screen.getByText('Couldn’t load games. Try again.')).toBeTruthy();
    await fireEvent.press(screen.getByText('Try again'));
    expect(p.onRetry).toHaveBeenCalled();
  });

  it('shows one line and one button when nothing is open', async () => {
    await render(<FindMatchView {...props({ results: { status: 'ready', data: [] } })} />);
    expect(screen.getByText('No open games')).toBeTruthy();
    await fireEvent.press(screen.getByText('Change filters'));
    expect(screen.getByText('Which format?')).toBeTruthy();
  });

  it('groups the games by day under the filter chip; a card opens it', async () => {
    const p = props();
    await render(<FindMatchView {...p} />);
    expect(screen.getByText('5-a-side | Limassol | Dates and times')).toBeTruthy();
    expect(screen.getByText('FRIDAY 27 NOV')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('find-match-card-p2'));
    expect(p.onOpenCard).toHaveBeenCalledWith(oppositionCard);
  });

  it('"Start a match" and the search field', async () => {
    const p = props();
    await render(<FindMatchView {...p} />);
    await fireEvent.press(screen.getByTestId('find-match-start'));
    expect(p.onStartMatch).toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('find-match-search'));
    expect(screen.getByText('Where do you want to play?')).toBeTruthy();
  });

  it('picking a place from the search sets it', async () => {
    const p = props();
    await render(<FindMatchView {...p} />);
    await fireEvent.press(screen.getByTestId('find-match-search'));
    await fireEvent.changeText(screen.getByTestId('book-where-input'), 'Lim');
    await fireEvent.press(screen.getByTestId('book-where-town-Limassol'));
    await waitFor(() => expect(p.onPickPlace).toHaveBeenCalledWith({ kind: 'town', town: 'Limassol' }));
  });
});
