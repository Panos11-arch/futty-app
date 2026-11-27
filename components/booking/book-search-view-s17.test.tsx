// S17: Book a pitch with "Around me" (venues sorted by distance, the
// distance on each card) and "View map" (the venues as pins; a pin opens a
// mini card). The location problem, when there is one, is one line with
// what to do.
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Image } from 'expo-image';

import { BookSearchView, type BookSearchViewProps } from '@/components/booking/book-search-view';
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
  amenities: [],
  is_favourite: false,
  from_player_cents: 680,
  slots: [{ day: '2026-11-24', start: '18:00', end: '19:00', player_cents: 680 }],
};
const nuevo: BookResult = { ...kamares, venue_id: 'v2', name: 'Nuevo Campo', area: 'Germasogeia', from_player_cents: null };
const noCoords: BookResult = { ...kamares, venue_id: 'v3', name: 'Somewhere FC', area: null };

const COORDS = { v1: { latitude: 34.69, longitude: 33.03 }, v2: { latitude: 34.7, longitude: 33.09 } };

function props(overrides: Partial<BookSearchViewProps> = {}): BookSearchViewProps {
  return {
    options: { status: 'ready', data: options },
    query,
    onQueryChange: jest.fn(),
    results: { status: 'ready', data: [kamares, nuevo, noCoords] },
    refreshing: false,
    onRefresh: jest.fn(),
    onRetryOptions: jest.fn(),
    onRetryResults: jest.fn(),
    filterCount: 2,
    onFilterDraft: jest.fn(),
    towns: ['Limassol'],
    venues: [],
    recents: [],
    onPickPlace: jest.fn(),
    onOpenVenue: jest.fn(),
    onTime: jest.fn(),
    onFavourite: jest.fn(() => Promise.resolve()),
    onRequestVenue: jest.fn(() => Promise.resolve()),
    view: 'list',
    onViewChange: jest.fn(),
    onAroundMe: jest.fn(),
    nearMe: false,
    distances: {},
    coordinates: COORDS,
    locationProblem: null,
    ...overrides,
  };
}

describe('Around me', () => {
  it('the picker offers it; a tap closes the picker and hands it on', async () => {
    const p = props();
    await render(<BookSearchView {...p} />);
    await fireEvent.press(screen.getByTestId('book-search-field'));
    await fireEvent.press(screen.getByTestId('book-where-around-me'));
    expect(p.onAroundMe).toHaveBeenCalledTimes(1);
    expect(p.onPickPlace).not.toHaveBeenCalled();
  });

  it('on: the field says Around me, and each card its distance', async () => {
    await render(<BookSearchView {...props({ nearMe: true, distances: { v1: '3 km', v2: '8 km' } })} />);
    expect(within(screen.getByTestId('book-search-field')).getByText('Around me')).toBeTruthy();
    expect(screen.getByLabelText('Where: Around me')).toBeTruthy();
    expect(within(screen.getByTestId('free-venue-v1')).getByText('3 km · Kamares · Limassol')).toBeTruthy();
    expect(within(screen.getByTestId('free-venue-v2')).getByText('8 km · Germasogeia · Limassol')).toBeTruthy();
    // A venue without coordinates has no distance.
    expect(within(screen.getByTestId('free-venue-v3')).getByText('Limassol')).toBeTruthy();
  });

  it('a location problem: one line, and the button that fixes it', async () => {
    const onPress = jest.fn();
    await render(
      <BookSearchView
        {...props({ locationProblem: { message: 'Location is off. Turn it on in Settings.', action: { label: 'Open Settings', onPress } } })}
      />,
    );
    const banner = screen.getByTestId('book-location-banner');
    expect(within(banner).getByText('Location is off. Turn it on in Settings.')).toBeTruthy();
    await fireEvent.press(within(banner).getByText('Open Settings'));
    expect(onPress).toHaveBeenCalled();
  });
});

describe('View map', () => {
  it('the venues with coordinates as pins, no list', async () => {
    await render(<BookSearchView {...props({ view: 'map' })} />);
    expect(screen.getByTestId('book-map')).toBeTruthy();
    expect(screen.getByTestId('book-map-pin-v1')).toBeTruthy();
    expect(screen.getByTestId('book-map-pin-v2')).toBeTruthy();
    expect(screen.queryByTestId('book-map-pin-v3')).toBeNull();
    expect(screen.queryByTestId('book-results')).toBeNull();
    expect(screen.queryByTestId('book-map-card')).toBeNull();
  });

  it('the map frames the pins', async () => {
    await render(<BookSearchView {...props({ view: 'map' })} />);
    const region = JSON.parse(screen.getByTestId('book-map').props.accessibilityHint);
    expect(region.latitude).toBeCloseTo(34.695, 3);
    expect(region.longitude).toBeCloseTo(33.06, 3);
  });

  it('a pin opens its mini card: name, place, price; the card opens the venue', async () => {
    const p = props({ view: 'map', nearMe: true, distances: { v1: '3 km' } });
    await render(<BookSearchView {...p} />);
    await fireEvent.press(screen.getByTestId('book-map-pin-v1'));
    const card = screen.getByTestId('book-map-card');
    expect(within(card).getByText('Kamares Sports Centre')).toBeTruthy();
    expect(within(card).getByText('3 km · Kamares · Limassol')).toBeTruthy();
    expect(within(card).getByText('from €6.80 per player')).toBeTruthy();
    await fireEvent.press(within(card).getByTestId('book-map-card-open'));
    expect(p.onOpenVenue).toHaveBeenCalledWith('v1');
  });

  it('another pin swaps the card; a venue with no price shows none', async () => {
    await render(<BookSearchView {...props({ view: 'map' })} />);
    await fireEvent.press(screen.getByTestId('book-map-pin-v1'));
    await fireEvent.press(screen.getByTestId('book-map-pin-v2'));
    const card = screen.getByTestId('book-map-card');
    expect(within(card).getByText('Nuevo Campo')).toBeTruthy();
    expect(within(card).queryByText(/per player/)).toBeNull();
  });

  it('no venue on the map: one line and one button back to the list', async () => {
    const p = props({ view: 'map', coordinates: {} });
    await render(<BookSearchView {...p} />);
    expect(screen.getByText('No venues on the map')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('book-map-empty-list'));
    expect(p.onViewChange).toHaveBeenCalledWith('list');
  });

  it('while the search loads: skeletons, not an empty map', async () => {
    await render(<BookSearchView {...props({ view: 'map', results: { status: 'loading' } })} />);
    expect(screen.getByTestId('book-results-loading')).toBeTruthy();
    expect(screen.queryByText('No venues on the map')).toBeNull();
  });
});
