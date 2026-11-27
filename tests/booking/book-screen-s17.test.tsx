// S17: the Book a pitch screen's "Around me" and "View map". Location is
// asked for only on the tap, rounded to about 1 km (locateMe), used on the
// phone to sort, and never sent to the server.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import type { ReactElement } from 'react';
import { Linking } from 'react-native';

import BookScreen from '@/app/book';
import type { BookSearchViewProps } from '@/components/booking/book-search-view';
import type { BookResult } from '@/lib/booking-search';

const mockScreenOptions = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
  Stack: { Screen: ({ options }: { options: unknown }) => (mockScreenOptions(options), null) },
}));

let mockView: BookSearchViewProps | null = null;
jest.mock('@/components/booking/book-search-view', () => ({
  BookSearchView: (p: BookSearchViewProps) => {
    mockView = p;
    return null;
  },
}));
jest.mock('@/components/futty-ai/ask-ai-button', () => ({ AskAiButton: () => null }));
jest.mock('@/components/ui/icon-symbol', () =>
  jest.requireActual<typeof import('@/components/ui/test-utils')>('@/components/ui/test-utils').iconSymbolMock(),
);

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: () => ({ insert: jest.fn(), delete: jest.fn() }),
    storage: { from: () => ({ createSignedUrls: jest.fn(() => Promise.resolve({ data: [] })) }) },
  },
}));
jest.mock('@/lib/use-owed', () => ({ useDebtBlock: () => ({ message: null }) }));
jest.mock('@/lib/use-rules', () => ({ useRules: () => undefined }));
jest.mock('@/lib/use-venues', () => ({ useVenues: () => ({ status: 'ready', venues: [], cities: [] }) }));
jest.mock('@/lib/haptics', () => ({ haptic: { tap: jest.fn(), success: jest.fn(), error: jest.fn() } }));

const mockLocate = jest.fn();
const mockCoordinates = jest.fn();
jest.mock('@/lib/venue-location', () => ({
  ...jest.requireActual('@/lib/venue-location'),
  locateMe: () => mockLocate(),
  fetchVenueCoordinates: (ids: string[]) => mockCoordinates(ids),
}));

const options = {
  today: '2026-11-24',
  window_days: 7,
  is_premium: false,
  six_on_five_available: true,
  game_lengths: [60],
  default_game_length: 60,
};
const result = (id: string): BookResult => ({
  venue_id: id,
  name: id,
  town: 'Limassol',
  area: null,
  photo_path: null,
  photoUrl: null,
  amenities: [],
  is_favourite: false,
  from_player_cents: 680,
  slots: [],
});
// Far, near, no coordinates: the server's order.
const FAR = result('far');
const NEAR = result('near');
const NONE = result('none');
const HERE = { latitude: 34.68, longitude: 33.04 };
const COORDS = { far: { latitude: 35.17, longitude: 33.36 }, near: { latitude: 34.69, longitude: 33.05 } };

beforeEach(async () => {
  jest.clearAllMocks();
  mockView = null;
  await AsyncStorage.clear();
  mockRpc.mockImplementation((name: string) => {
    if (name === 'booking_search_options') return Promise.resolve({ data: options, error: null });
    if (name === 'book_search') return Promise.resolve({ data: [FAR, NEAR, NONE], error: null });
    return Promise.resolve({ data: [], error: null });
  });
  mockCoordinates.mockResolvedValue(COORDS);
});

function view(): BookSearchViewProps {
  if (!mockView) throw new Error('not rendered');
  return mockView;
}

async function ready() {
  await waitFor(() => expect(view().results.status).toBe('ready'));
  return view();
}

const ids = (v: BookSearchViewProps) => (v.results as { status: 'ready'; data: BookResult[] }).data.map((r) => r.venue_id);

describe('Around me', () => {
  it('nothing is asked for until the tap', async () => {
    await render(<BookScreen />);
    const v = await ready();
    expect(mockLocate).not.toHaveBeenCalled();
    expect(v.nearMe).toBe(false);
    expect(ids(v)).toEqual(['far', 'near', 'none']);
  });

  it('on the tap: nearest first, distances on the cards, and the location never goes to the server', async () => {
    mockLocate.mockResolvedValue({ status: 'ready', here: HERE });
    await render(<BookScreen />);
    await ready();
    const searches = mockRpc.mock.calls.length;
    await act(async () => view().onAroundMe?.());
    await waitFor(() => expect(view().nearMe).toBe(true));
    await waitFor(() => expect(ids(view())).toEqual(['near', 'far', 'none']));
    expect(view().distances).toEqual({ near: '1 km', far: '62 km' });
    expect(view().locationProblem).toBeNull();
    // The search isn't asked again: sorting happens on the phone.
    expect(mockRpc.mock.calls.length).toBe(searches);
    const sent = JSON.stringify(mockRpc.mock.calls) + JSON.stringify(mockCoordinates.mock.calls);
    expect(sent).not.toContain('34.68');
    expect(sent).not.toContain('33.04');
  });

  it('location refused: one line, and a button to Settings', async () => {
    mockLocate.mockResolvedValue({ status: 'denied' });
    const settings = jest.spyOn(Linking, 'openSettings').mockResolvedValue();
    await render(<BookScreen />);
    await ready();
    await act(async () => view().onAroundMe?.());
    await waitFor(() => expect(view().locationProblem?.message).toBe('Location is off. Turn it on in Settings.'));
    expect(view().nearMe).toBe(false);
    expect(view().locationProblem?.action.label).toBe('Open Settings');
    await act(async () => view().locationProblem?.action.onPress());
    expect(settings).toHaveBeenCalled();
  });

  it('no position: one line, and Try again asks again', async () => {
    mockLocate.mockResolvedValueOnce({ status: 'failed' }).mockResolvedValueOnce({ status: 'ready', here: HERE });
    await render(<BookScreen />);
    await ready();
    await act(async () => view().onAroundMe?.());
    await waitFor(() => expect(view().locationProblem?.message).toBe('Couldn’t find you. Try again.'));
    expect(view().locationProblem?.action.label).toBe('Try again');
    await act(async () => view().locationProblem?.action.onPress());
    await waitFor(() => expect(view().nearMe).toBe(true));
    expect(view().locationProblem).toBeNull();
    expect(mockLocate).toHaveBeenCalledTimes(2);
  });

  it('picking a place ends Around me', async () => {
    mockLocate.mockResolvedValue({ status: 'ready', here: HERE });
    await render(<BookScreen />);
    await ready();
    await act(async () => view().onAroundMe?.());
    await waitFor(() => expect(view().nearMe).toBe(true));
    await act(async () => view().onPickPlace({ kind: 'town', town: 'Limassol' }));
    await waitFor(() => expect(view().nearMe).toBe(false));
    expect(view().distances).toEqual({});
  });
});

describe('View map', () => {
  async function headerRight() {
    const last = mockScreenOptions.mock.calls[mockScreenOptions.mock.calls.length - 1][0] as {
      headerRight: () => ReactElement;
    };
    return render(last.headerRight());
  }

  it('the header\'s View map shows the map; then View list goes back', async () => {
    await render(<BookScreen />);
    await ready();
    expect(view().view).toBe('list');
    await headerRight();
    await fireEvent.press(screen.getByTestId('book-view-map'));
    await waitFor(() => expect(view().view).toBe('map'));
    await headerRight();
    expect(screen.getByText('View list')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('book-view-map'));
    await waitFor(() => expect(view().view).toBe('list'));
  });

  it('the view can switch back from inside (the empty map\'s button)', async () => {
    await render(<BookScreen />);
    await ready();
    await act(async () => view().onViewChange?.('map'));
    expect(view().view).toBe('map');
    await act(async () => view().onViewChange?.('list'));
    expect(view().view).toBe('list');
  });

  it('the results\' coordinates are read for the pins', async () => {
    await render(<BookScreen />);
    await ready();
    await waitFor(() => expect(view().coordinates).toEqual(COORDS));
    expect(mockCoordinates).toHaveBeenCalledWith(['far', 'near', 'none']);
  });
});
