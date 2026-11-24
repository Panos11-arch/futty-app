// S4: the Book a pitch screen (app/book.tsx) wires the view to the server
// and the phone: the opening search, places, recents, favourites, "Missing
// a venue?", and where a tap goes (a time: checkout for now, via
// openTimeSlot; a card: the venue page).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, render, waitFor } from '@testing-library/react-native';

import BookScreen from '@/app/book';
import type { BookSearchViewProps } from '@/components/booking/book-search-view';
import type { BookResult } from '@/lib/booking-search';

const mockPush = jest.fn();
let mockParams: Record<string, string> = {};
const mockScreenOptions = jest.fn();
jest.mock('expo-router', () => ({
  router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn() },
  useLocalSearchParams: () => mockParams,
  Stack: { Screen: ({ options }: { options: unknown }) => (mockScreenOptions(options), null) },
}));

let mockView: BookSearchViewProps | null = null;
jest.mock('@/components/booking/book-search-view', () => ({
  BookSearchView: (p: BookSearchViewProps) => {
    mockView = p;
    return null;
  },
}));

const mockRpc = jest.fn();
const mockInsert = jest.fn(() => Promise.resolve({ error: null }));
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: () => ({ insert: mockInsert, delete: () => ({ eq: jest.fn(() => Promise.resolve({ error: null })) }) }),
    storage: { from: () => ({ createSignedUrls: jest.fn(() => Promise.resolve({ data: [] })) }) },
  },
}));
jest.mock('@/lib/use-owed', () => ({ useDebtBlock: () => ({ message: null }) }));
jest.mock('@/lib/use-rules', () => ({ useRules: () => undefined }));
jest.mock('@/lib/use-venues', () => ({
  useVenues: () => ({ status: 'ready', venues: [{ id: 'v1', name: 'Kamares Sports Centre', city: 'Limassol' }], cities: [] }),
}));
const mockHaptic = jest.fn();
jest.mock('@/lib/haptics', () => ({ haptic: { tap: () => mockHaptic(), success: jest.fn(), error: jest.fn() } }));

const options = {
  today: '2026-11-24',
  window_days: 7,
  is_premium: false,
  six_on_five_available: true,
  game_lengths: [60, 90, 120],
  default_game_length: 60,
};
const kamares: BookResult = {
  venue_id: 'v1',
  name: 'Kamares Sports Centre',
  town: 'Limassol',
  area: null,
  photo_path: null,
  photoUrl: null,
  amenities: [],
  is_favourite: false,
  from_player_cents: 680,
  slots: [{ day: '2026-11-26', start: '19:00:00', end: '20:30:00', player_cents: 680 }],
};

function serve() {
  mockRpc.mockImplementation((name: string) => {
    if (name === 'booking_search_options') return Promise.resolve({ data: options, error: null });
    if (name === 'saved_search_places') return Promise.resolve({ data: [{ city: 'Limassol', areas: [] }], error: null });
    if (name === 'book_search') return Promise.resolve({ data: [kamares], error: null });
    if (name === 'venue_page') return Promise.resolve({ data: null, error: null });
    return Promise.resolve({ data: null, error: null });
  });
}

function view(): BookSearchViewProps {
  if (!mockView) throw new Error('not rendered');
  return mockView;
}

async function ready() {
  await waitFor(() => expect(view().results.status).toBe('ready'));
  return view();
}

beforeEach(async () => {
  jest.clearAllMocks();
  mockView = null;
  mockParams = {};
  await AsyncStorage.clear();
  serve();
});

describe('Book a pitch screen', () => {
  it('is titled Search', async () => {
    await render(<BookScreen />);
    expect(mockScreenOptions).toHaveBeenCalledWith(expect.objectContaining({ title: 'Search' }));
  });

  it('opens on 5-a-side, today, all day, 60 minutes, and searches', async () => {
    await render(<BookScreen />);
    const v = await ready();
    expect(v.query).toMatchObject({ format: '5-a-side', days: ['2026-11-24'], minutes: 60, place: { kind: 'all' } });
    expect(mockRpc).toHaveBeenCalledWith('book_search', expect.objectContaining({ p_days: ['2026-11-24'], p_minutes: 60 }));
    expect(v.towns).toEqual(['Limassol']);
    expect(v.venues).toEqual([{ id: 'v1', name: 'Kamares Sports Centre', city: 'Limassol' }]);
  });

  it('opens on the last format used, and keeps a new one', async () => {
    await AsyncStorage.setItem('futty.book.last_format', '7-a-side');
    await render(<BookScreen />);
    let v = await ready();
    expect(v.query?.format).toBe('7-a-side');
    await act(async () => v.onQueryChange({ ...v.query!, format: '9-a-side' }));
    v = view();
    expect(v.query?.format).toBe('9-a-side');
    await waitFor(async () => expect(await AsyncStorage.getItem('futty.book.last_format')).toBe('9-a-side'));
  });

  // S6: opened from Find a match's "Start a match": Publish starts on after
  // paying, while this screen is open; never once it has closed.
  it('from Start a match, holds the Start a match flag while open', async () => {
    const { takeStartMatch } = jest.requireActual<typeof import('@/lib/start-match')>('@/lib/start-match');
    mockParams = { startMatch: '1' };
    const view = await render(<BookScreen />);
    await ready();
    expect(takeStartMatch()).toBe(true);

    mockParams = { startMatch: '1' };
    const again = await render(<BookScreen />);
    await again.unmount();
    expect(takeStartMatch()).toBe(false);
    await view.unmount();

    mockParams = {};
    await render(<BookScreen />);
    expect(takeStartMatch()).toBe(false);
  });

  it('from a venue page, searches that venue', async () => {
    mockParams = { venueId: 'v1' };
    await render(<BookScreen />);
    const v = await ready();
    expect(v.query?.place).toMatchObject({ kind: 'venue', venueId: 'v1' });
    expect(mockRpc).toHaveBeenCalledWith('book_search', expect.objectContaining({ p_venue_id: 'v1' }));
  });

  it('a time opens the venue page on Book with that slot (S5), with a light haptic', async () => {
    await render(<BookScreen />);
    const v = await ready();
    const result = (v.results as { status: 'ready'; data: BookResult[] }).data[0];
    await act(async () => v.onTime(result, result.slots[0]));
    expect(mockHaptic).toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledWith({
      pathname: '/venue/[id]',
      params: {
        id: 'v1',
        tab: 'book',
        day: '2026-11-26',
        start: '19:00',
        end: '20:30',
        format: '5-a-side',
        playersPerSide: '5',
      },
    });
  });

  it('passes 6 per side to the venue page when chosen on 5-a-side', async () => {
    await render(<BookScreen />);
    let v = await ready();
    await act(async () => v.onQueryChange({ ...v.query!, playersPerSide: 6 }));
    v = await ready();
    const result = (v.results as { status: 'ready'; data: BookResult[] }).data[0];
    await act(async () => v.onTime(result, result.slots[0]));
    expect(mockPush.mock.calls[0][0].params.playersPerSide).toBe('6');
  });

  it('a card opens the venue page with no time', async () => {
    await render(<BookScreen />);
    const v = await ready();
    await act(async () => v.onOpenVenue('v1'));
    expect(mockPush).toHaveBeenCalledWith({ pathname: '/venue/[id]', params: { id: 'v1' } });
  });

  it('picking a place searches it and keeps it in Recent', async () => {
    await render(<BookScreen />);
    let v = await ready();
    await act(async () => v.onPickPlace({ kind: 'town', town: 'Limassol' }));
    await waitFor(() => expect(view().recents).toEqual([{ kind: 'town', town: 'Limassol' }]));
    v = await ready();
    expect(v.query?.place).toEqual({ kind: 'town', town: 'Limassol' });
    expect(mockRpc).toHaveBeenLastCalledWith('book_search', expect.objectContaining({ p_town: 'Limassol' }));
  });

  it('counts the Filter sheet’s draft with the server', async () => {
    await render(<BookScreen />);
    const v = await ready();
    await act(async () => v.onFilterDraft({ ...v.query!, minutes: 90 }));
    await waitFor(() => expect(view().filterCount).toBe(1));
    expect(mockRpc).toHaveBeenCalledWith('book_search', expect.objectContaining({ p_minutes: 90 }));
    await act(async () => view().onFilterDraft(null));
    expect(view().filterCount).toBeNull();
  });

  it('saves a favourite and sends a missing venue', async () => {
    await render(<BookScreen />);
    const v = await ready();
    await act(async () => v.onFavourite('v1', true));
    expect(mockInsert).toHaveBeenCalledWith({ venue_id: 'v1' });
    await act(async () => v.onRequestVenue('Arena', 'Paphos'));
    expect(mockInsert).toHaveBeenCalledWith({ venue_name: 'Arena', town: 'Paphos' });
  });

  it('opens Pay what I owe', async () => {
    await render(<BookScreen />);
    const v = await ready();
    await act(async () => v.onPayOwed?.());
    expect(mockPush).toHaveBeenCalledWith('/account/payments/owed');
  });
});
