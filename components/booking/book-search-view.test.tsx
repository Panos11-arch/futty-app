// S4: Book a pitch (image 02). The search field, chips and sheets, the
// results list in each state, and where each tap goes.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Image } from 'expo-image';
import { Platform, StyleSheet } from 'react-native';

import { BookSearchView, type BookSearchViewProps } from '@/components/booking/book-search-view';
import { DISABLED_OPACITY } from '@/components/ui/foundation';
import { loadWithFile } from '@/components/ui/test-utils';
import { defaultBookQuery, type BookResult, type SearchOptions } from '@/lib/booking-search';

jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 34, left: 0 }),
}));
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
  NotificationFeedbackType: { Success: 'success', Error: 'error' },
}));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

loadWithFile(Image);

const options: SearchOptions = {
  today: '2026-11-24',
  window_days: 7,
  is_premium: false,
  six_on_five_available: true,
  game_lengths: [60, 90, 120],
  default_game_length: 60,
};
const query = defaultBookQuery(options, null);

const kamares: BookResult = {
  venue_id: 'v1',
  name: 'Kamares Sports Centre',
  town: 'Limassol',
  area: 'Kamares',
  photo_path: null,
  photoUrl: null,
  amenities: ['parking'],
  is_favourite: false,
  from_player_cents: 680,
  slots: [
    { day: '2026-11-24', start: '18:00', end: '19:00', player_cents: 680 },
    { day: '2026-11-24', start: '19:00', end: '20:00', player_cents: 680 },
  ],
};
const nuevo: BookResult = { ...kamares, venue_id: 'v2', name: 'Nuevo Campo', area: 'Germasogeia', from_player_cents: 580 };

function props(overrides: Partial<BookSearchViewProps> = {}): BookSearchViewProps {
  return {
    options: { status: 'ready', data: options },
    query,
    onQueryChange: jest.fn(),
    results: { status: 'ready', data: [kamares, nuevo] },
    refreshing: false,
    onRefresh: jest.fn(),
    onRetryOptions: jest.fn(),
    onRetryResults: jest.fn(),
    filterCount: 2,
    onFilterDraft: jest.fn(),
    towns: ['Limassol', 'Nicosia'],
    venues: [{ id: 'v1', name: 'Kamares Sports Centre', city: 'Limassol (Kamares)' }],
    recents: [],
    onPickPlace: jest.fn(),
    onOpenVenue: jest.fn(),
    onTime: jest.fn(),
    onFavourite: jest.fn(() => Promise.resolve()),
    onRequestVenue: jest.fn(() => Promise.resolve()),
    ...overrides,
  };
}

describe('BookSearchView: states', () => {
  it('shows skeletons while the options or the search load', async () => {
    await render(<BookSearchView {...props({ options: { status: 'loading' } })} />);
    expect(screen.getByTestId('book-loading')).toBeTruthy();
    await render(<BookSearchView {...props({ query: null })} />);
    expect(screen.getByTestId('book-loading')).toBeTruthy();
    await render(<BookSearchView {...props({ results: { status: 'loading' } })} />);
    expect(screen.getByTestId('book-results-loading')).toBeTruthy();
    expect(screen.getByTestId('book-search-field')).toBeTruthy();
  });

  it('shows one line and Try again when the options fail', async () => {
    const p = props({ options: { status: 'error', message: 'Couldn’t load. Try again.' } });
    await render(<BookSearchView {...p} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(p.onRetryOptions).toHaveBeenCalled();
  });

  it('shows one line and Try again when the search fails', async () => {
    const p = props({ results: { status: 'error', message: 'Pick up to three days from today.' } });
    await render(<BookSearchView {...p} />);
    expect(screen.getByText('Pick up to three days from today.')).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try again' }));
    expect(p.onRetryResults).toHaveBeenCalled();
  });

  it('shows the cards with the server’s from price', async () => {
    await render(<BookSearchView {...props()} />);
    expect(screen.getByText('Kamares Sports Centre')).toBeTruthy();
    expect(screen.getByText('from €6.80 per player')).toBeTruthy();
    expect(screen.getByText('from €5.80 per player')).toBeTruthy();
    expect(screen.getByText('Germasogeia · Limassol')).toBeTruthy();
  });

  it('shows the empty state with Missing a venue?, which sends a venue', async () => {
    const p = props({ results: { status: 'ready', data: [] } });
    await render(<BookSearchView {...p} />);
    expect(screen.getByText('No venues found')).toBeTruthy();
    expect(screen.getByText('Try other days, times or filters.')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('book-missing-venue'));
    await fireEvent.changeText(screen.getByTestId('missing-venue-name'), 'Kamares Arena');
    await fireEvent.changeText(screen.getByTestId('missing-venue-town'), 'Limassol');
    await fireEvent.press(screen.getByTestId('missing-venue-send'));
    expect(p.onRequestVenue).toHaveBeenCalledWith('Kamares Arena', 'Limassol');
    expect(await screen.findByText('Venue sent')).toBeTruthy();
  });

  it('from the picker, a venue not found opens Missing a venue? (Android: at once)', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    await render(<BookSearchView {...props()} />);
    await fireEvent.press(screen.getByTestId('book-search-field'));
    await fireEvent.changeText(screen.getByTestId('book-where-input'), 'zzz');
    await fireEvent.press(screen.getByTestId('book-where-missing-venue'));
    expect(screen.getByTestId('missing-venue-name')).toBeTruthy();
    jest.restoreAllMocks();
  });

  it('pulls to refresh', async () => {
    const p = props();
    await render(<BookSearchView {...p} />);
    const list = screen.getByTestId('book-results');
    await fireEvent(list, 'refresh');
    expect(p.onRefresh).toHaveBeenCalled();
  });
});

describe('BookSearchView: the field and chips', () => {
  it('shows the place, and the chips Filters, format, day and time', async () => {
    await render(<BookSearchView {...props()} />);
    expect(within(screen.getByTestId('book-search-field')).getByText('All venues')).toBeTruthy();
    expect(screen.getByTestId('book-chip-filters')).toBeTruthy();
    expect(screen.getByRole('button', { name: '5-a-side' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'All day' })).toBeTruthy();
  });

  it('labels the chips from the search', async () => {
    const q = {
      ...query,
      days: ['2026-11-26'],
      window: { preset: 'evening' as const, from: '18:00', to: '24:00' },
      place: { kind: 'town' as const, town: 'Limassol' },
    };
    await render(<BookSearchView {...props({ query: q })} />);
    expect(within(screen.getByTestId('book-search-field')).getByText('Limassol')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Thu 26 Nov' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Evening' })).toBeTruthy();
  });

  it('opens the picker from the field and picks a place', async () => {
    const p = props();
    await render(<BookSearchView {...p} />);
    await fireEvent.press(screen.getByTestId('book-search-field'));
    await fireEvent.changeText(screen.getByTestId('book-where-input'), 'nic');
    await fireEvent.press(screen.getByTestId('book-where-town-Nicosia'));
    expect(p.onPickPlace).toHaveBeenCalledWith({ kind: 'town', town: 'Nicosia' });
  });

  it('turns favourites only on and off with the heart in the field', async () => {
    const p = props();
    await render(<BookSearchView {...p} />);
    const heart = screen.getByTestId('book-favourites');
    expect(heart.props.accessibilityState).toMatchObject({ selected: false });
    await fireEvent.press(heart);
    expect(p.onQueryChange).toHaveBeenCalledWith({ ...query, favouritesOnly: true });
  });

  it('picks a format', async () => {
    const p = props();
    await render(<BookSearchView {...p} />);
    await fireEvent.press(screen.getByTestId('book-chip-format'));
    await fireEvent.press(screen.getByTestId('book-format-7-a-side'));
    expect(p.onQueryChange).toHaveBeenCalledWith({ ...query, format: '7-a-side', playersPerSide: 5 });
  });

  it('picks days', async () => {
    const p = props();
    await render(<BookSearchView {...p} />);
    await fireEvent.press(screen.getByTestId('book-chip-date'));
    await fireEvent.press(screen.getByTestId('book-day-2026-11-26'));
    await fireEvent.press(screen.getByTestId('book-days-see-results'));
    expect(p.onQueryChange).toHaveBeenCalledWith({ ...query, days: ['2026-11-24', '2026-11-26'] });
  });

  it('picks a time', async () => {
    const p = props();
    await render(<BookSearchView {...p} />);
    await fireEvent.press(screen.getByTestId('book-chip-time'));
    await fireEvent.press(screen.getByTestId('book-time-preset-morning'));
    await fireEvent.press(screen.getByTestId('book-time-see-results'));
    expect(p.onQueryChange).toHaveBeenCalledWith({ ...query, window: { preset: 'morning', from: '06:00', to: '12:00' } });
  });

  it('filters, with the live count from the draft', async () => {
    const p = props();
    await render(<BookSearchView {...p} />);
    await fireEvent.press(screen.getByTestId('book-chip-filters'));
    expect(p.onFilterDraft).toHaveBeenLastCalledWith(query);
    expect(screen.getByRole('button', { name: 'See 2 results' })).toBeTruthy();
    await fireEvent.press(screen.getByTestId('book-length-90'));
    expect(p.onFilterDraft).toHaveBeenLastCalledWith({ ...query, minutes: 90 });
    await fireEvent.press(screen.getByTestId('book-filter-see-results'));
    expect(p.onQueryChange).toHaveBeenCalledWith({ ...query, minutes: 90 });
    expect(p.onFilterDraft).toHaveBeenLastCalledWith(null);
  });

  it('marks Filters when a filter is on', async () => {
    await render(<BookSearchView {...props({ query: { ...query, types: ['indoor'] } })} />);
    expect(screen.getByTestId('book-chip-filters').props.accessibilityState).toMatchObject({ selected: true });
  });

  it('shows Filters unmarked with the default filters', async () => {
    await render(<BookSearchView {...props()} />);
    expect(screen.getByTestId('book-chip-filters').props.accessibilityState).toMatchObject({ selected: false });
  });
});

describe('BookSearchView: taps on a card', () => {
  it('a time opens that slot; the card opens the venue', async () => {
    const p = props();
    await render(<BookSearchView {...p} />);
    await fireEvent.press(screen.getByTestId('book-venue-v1-time-2026-11-24-1900'));
    expect(p.onTime).toHaveBeenCalledWith(kamares, kamares.slots[1]);
    await fireEvent.press(screen.getByTestId('free-venue-v2-info'));
    expect(p.onOpenVenue).toHaveBeenCalledWith('v2');
  });

  it('saves a favourite at once, and puts it back with one line when that fails', async () => {
    const p = props({ onFavourite: jest.fn(() => Promise.reject(new Error('Couldn’t save this venue. Try again.'))) });
    await render(<BookSearchView {...p} />);
    await fireEvent.press(screen.getByTestId('book-venue-v1-heart'));
    expect(p.onFavourite).toHaveBeenCalledWith('v1', true);
    expect(await screen.findByText('Couldn’t save this venue. Try again.')).toBeTruthy();
    await waitFor(() =>
      expect(screen.getByTestId('book-venue-v1-heart').props.accessibilityLabel).toBe('Save Kamares Sports Centre'),
    );
  });

  it('shows the saved heart while the server saves it', async () => {
    let saved = () => {};
    const p = props({ onFavourite: jest.fn(() => new Promise<void>((resolve) => (saved = resolve))) });
    await render(<BookSearchView {...p} />);
    const pressing = fireEvent.press(screen.getByTestId('book-venue-v1-heart'));
    await waitFor(() =>
      expect(screen.getByTestId('book-venue-v1-heart').props.accessibilityLabel).toBe('Remove Kamares Sports Centre'),
    );
    saved();
    await pressing;
    expect(screen.getByTestId('book-venue-v1-heart').props.accessibilityLabel).toBe('Remove Kamares Sports Centre');
  });
});

describe('BookSearchView: debt', () => {
  const debtMessage = 'You owe €6.80 from a past booking. Pay it to book again.';

  it('shows the banner with Pay what I owe, and blocks the times', async () => {
    const p = props({ debtMessage, onPayOwed: jest.fn() });
    await render(<BookSearchView {...p} />);
    expect(within(screen.getByTestId('debt-banner')).getByText(debtMessage)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Pay what I owe' }));
    expect(p.onPayOwed).toHaveBeenCalled();
    const slot = screen.getByTestId('free-venue-v1-slot');
    expect(slot.props.pointerEvents).toBe('none');
    expect(StyleSheet.flatten(slot.props.style).opacity).toBe(DISABLED_OPACITY);
  });

  it('shows no banner when not in debt', async () => {
    await render(<BookSearchView {...props()} />);
    expect(screen.queryByTestId('debt-banner')).toBeNull();
  });
});
