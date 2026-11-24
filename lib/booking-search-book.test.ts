// S4: Book a pitch. The search choices, the server call, what's kept on
// the phone, favourites, "Missing a venue?" and where a tap goes.
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  calendarMonths,
  daysChipLabel,
  defaultBookQuery,
  fetchBookSearch,
  filterPlaces,
  loadLastFormat,
  loadRecentPlaces,
  MAX_SEARCH_DAYS,
  openTimeSlot,
  openVenue,
  placeLabel,
  playersPerSideFor,
  requestVenue,
  saveLastFormat,
  saveRecentPlace,
  setFavourite,
  slotChipLabel,
  specificHours,
  TIME_PRESETS,
  timeChipLabel,
  toggleDay,
  type BookSearchQuery,
  type SearchOptions,
} from './booking-search';

const mockRpc = jest.fn();
const mockInsert = jest.fn();
const mockDeleteEq = jest.fn();
const mockFrom = jest.fn((_table: string) => ({
  insert: mockInsert,
  delete: () => ({ eq: mockDeleteEq }),
}));
const mockSign = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    from: (table: string) => mockFrom(table),
    storage: { from: () => ({ createSignedUrls: (...args: unknown[]) => mockSign(...args) }) },
  },
}));

const options: SearchOptions = {
  today: '2026-11-24',
  window_days: 7,
  is_premium: false,
  six_on_five_available: true,
  game_lengths: [60, 90, 120],
  default_game_length: 60,
};

function query(overrides: Partial<BookSearchQuery> = {}): BookSearchQuery {
  return { ...defaultBookQuery(options, null), ...overrides };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
});

describe('defaultBookQuery', () => {
  it('opens on 5-a-side, today, all day, the server’s default length, everywhere', () => {
    expect(defaultBookQuery(options, null)).toEqual({
      days: ['2026-11-24'],
      window: { preset: 'all_day', from: '00:00', to: '24:00' },
      minutes: 60,
      format: '5-a-side',
      playersPerSide: 5,
      place: { kind: 'all' },
      types: [],
      favouritesOnly: false,
      includeUnavailable: false,
    });
  });

  it('opens on the last format the player used', () => {
    expect(defaultBookQuery(options, '7-a-side').format).toBe('7-a-side');
  });

  it('ignores a stored format that isn’t one', () => {
    expect(defaultBookQuery(options, 'padel').format).toBe('5-a-side');
  });

  it('uses the server’s default length, falling back to its first length', () => {
    expect(defaultBookQuery({ ...options, default_game_length: 90 }, null).minutes).toBe(90);
    expect(defaultBookQuery({ ...options, default_game_length: undefined, game_lengths: [90] }, null).minutes).toBe(90);
  });
});

describe('time windows', () => {
  it('has the four presets with their hours', () => {
    expect(TIME_PRESETS.map((p) => [p.label, p.from, p.to, p.range])).toEqual([
      ['All day', '00:00', '24:00', '00:00–23:59'],
      ['Morning', '06:00', '12:00', '06:00–12:00'],
      ['Afternoon', '12:00', '18:00', '12:00–18:00'],
      ['Evening', '18:00', '24:00', '18:00–24:00'],
    ]);
  });

  it('offers specific hours every half hour of the day', () => {
    const hours = specificHours();
    expect(hours[0]).toBe('00:00');
    expect(hours[1]).toBe('00:30');
    expect(hours.slice(-1)).toEqual(['23:30']);
    expect(hours).toHaveLength(48);
  });

  it('labels the chip by preset, or by the hours chosen', () => {
    expect(timeChipLabel({ preset: 'all_day', from: '00:00', to: '24:00' })).toBe('All day');
    expect(timeChipLabel({ preset: 'evening', from: '18:00', to: '24:00' })).toBe('Evening');
    expect(timeChipLabel({ preset: 'specific', from: '19:00', to: '21:00' })).toBe('19:00–21:00');
  });
});

describe('days', () => {
  it('builds Monday-first months, with only the booking window selectable', () => {
    const months = calendarMonths('2026-11-24', 7);
    expect(months.map((m) => m.title)).toEqual(['November 2026', 'December 2026']);
    const nov = months[0];
    // 1 November 2026 is a Sunday: six blanks before it.
    expect(nov.weeks[0].slice(0, 6)).toEqual([null, null, null, null, null, null]);
    expect(nov.weeks[0][6]).toEqual({ day: '2026-11-01', date: 1, selectable: false });
    const all = months.flatMap((m) => m.weeks.flat()).filter((d) => d !== null);
    expect(all.filter((d) => d.selectable).map((d) => d.day)).toEqual([
      '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28', '2026-11-29', '2026-11-30', '2026-12-01',
    ]);
    // December runs to its last day, so the grid doesn't stop mid-week.
    expect(months[1].weeks.flat().filter((d) => d !== null).slice(-1)[0]?.day).toBe('2026-12-31');
  });

  it('shows one month when the window ends inside it', () => {
    expect(calendarMonths('2026-11-02', 7).map((m) => m.title)).toEqual(['November 2026']);
  });

  it('adds days in order, up to 3, and removes a picked day', () => {
    expect(MAX_SEARCH_DAYS).toBe(3);
    expect(toggleDay(['2026-11-26'], '2026-11-24')).toEqual(['2026-11-24', '2026-11-26']);
    expect(toggleDay(['2026-11-24', '2026-11-25', '2026-11-26'], '2026-11-27')).toEqual([
      '2026-11-24', '2026-11-25', '2026-11-26',
    ]);
    expect(toggleDay(['2026-11-24', '2026-11-25'], '2026-11-24')).toEqual(['2026-11-25']);
  });

  it('labels the chip: Today, a date, or the first date and how many more', () => {
    expect(daysChipLabel(['2026-11-24'], '2026-11-24')).toBe('Today');
    expect(daysChipLabel(['2026-11-26'], '2026-11-24')).toBe('Thu 26 Nov');
    expect(daysChipLabel(['2026-11-26', '2026-11-28', '2026-11-29'], '2026-11-24')).toBe('Thu 26 Nov +2');
  });

  it('labels a time chip with its day only when several days are searched', () => {
    const slot = { day: '2026-11-26', start: '18:00', end: '19:00', player_cents: 680 };
    expect(slotChipLabel(slot, false)).toBe('18:00');
    expect(slotChipLabel(slot, true)).toBe('Thu 18:00');
  });
});

describe('players per side', () => {
  it('is the choice only on 5-a-side where 6 v 6 is allowed; 5 otherwise, as before', () => {
    expect(playersPerSideFor('5-a-side', 6, true)).toBe(6);
    expect(playersPerSideFor('5-a-side', 6, false)).toBe(5);
    expect(playersPerSideFor('7-a-side', 6, true)).toBe(5);
    expect(playersPerSideFor('5-a-side', 5, true)).toBe(5);
  });
});

describe('places', () => {
  const towns = ['Larnaca', 'Limassol', 'Nicosia'];
  const venues = [
    { id: 'v1', name: 'Kamares Sports Centre', city: 'Limassol (Kamares)' },
    { id: 'v2', name: 'Nuevo Campo', city: 'Limassol' },
  ];

  it('finds towns and venues by any part of the name, ignoring case', () => {
    expect(filterPlaces('lim', towns, venues)).toEqual({ towns: ['Limassol'], venues: [] });
    expect(filterPlaces('CAMPO', towns, venues)).toEqual({ towns: [], venues: [venues[1]] });
    expect(filterPlaces('  ', towns, venues)).toEqual({ towns: [], venues: [] });
  });

  it('names a place', () => {
    expect(placeLabel({ kind: 'all' })).toBe('All venues');
    expect(placeLabel({ kind: 'town', town: 'Limassol' })).toBe('Limassol');
    expect(placeLabel({ kind: 'venue', venueId: 'v1', name: 'Nuevo Campo' })).toBe('Nuevo Campo');
  });
});

describe('on the phone', () => {
  it('keeps the last 5 places, newest first, without repeats', async () => {
    for (const town of ['A', 'B', 'C', 'D', 'E', 'F']) await saveRecentPlace({ kind: 'town', town });
    await saveRecentPlace({ kind: 'town', town: 'D' });
    expect((await loadRecentPlaces()).map(placeLabel)).toEqual(['D', 'F', 'E', 'C', 'B']);
  });

  it('never keeps "All venues" as a recent place', async () => {
    await saveRecentPlace({ kind: 'all' });
    expect(await loadRecentPlaces()).toEqual([]);
  });

  it('keeps the last format', async () => {
    expect(await loadLastFormat()).toBeNull();
    await saveLastFormat('7-a-side');
    expect(await loadLastFormat()).toBe('7-a-side');
  });

  it('carries on with nothing when the phone’s storage fails or holds junk', async () => {
    await AsyncStorage.setItem('futty.book.recent_places', '{not json');
    expect(await loadRecentPlaces()).toEqual([]);
    await AsyncStorage.setItem('futty.book.recent_places', JSON.stringify([{ kind: 'town' }, 3, { kind: 'town', town: 'X' }]));
    expect(await loadRecentPlaces()).toEqual([{ kind: 'town', town: 'X' }]);
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    expect(await loadLastFormat()).toBeNull();
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk'));
    await expect(saveLastFormat('5-a-side')).resolves.toBeUndefined();
    jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('disk'));
    await expect(saveRecentPlace({ kind: 'town', town: 'Y' })).resolves.toEqual([{ kind: 'town', town: 'Y' }]);
  });
});

describe('fetchBookSearch', () => {
  const row = {
    venue_id: 'v1',
    name: 'Kamares',
    town: 'Limassol',
    area: 'Kamares',
    photo_path: 'v1/a.jpg',
    amenities: ['parking'],
    is_favourite: false,
    from_player_cents: 680,
    slots: [{ day: '2026-11-26', start: '18:00:00', end: '19:00:00', player_cents: 680 }],
  };

  it('sends the search as the server takes it and returns its rows with photo URLs and short times', async () => {
    mockRpc.mockResolvedValue({ data: [row, { ...row, venue_id: 'v2', photo_path: null }], error: null });
    mockSign.mockResolvedValue({ data: [{ path: 'v1/a.jpg', signedUrl: 'https://x/a.jpg' }] });
    const result = await fetchBookSearch(
      query({
        days: ['2026-11-26', '2026-11-27'],
        window: { preset: 'evening', from: '18:00', to: '24:00' },
        minutes: 90,
        format: '5-a-side',
        playersPerSide: 6,
        place: { kind: 'town', town: 'Limassol' },
        types: ['indoor'],
        favouritesOnly: true,
        includeUnavailable: true,
      }),
      true,
    );
    expect(mockRpc).toHaveBeenCalledWith('book_search', {
      p_days: ['2026-11-26', '2026-11-27'],
      p_from: '18:00',
      p_to: '24:00',
      p_minutes: 90,
      p_format: '5-a-side',
      p_players_per_side: 6,
      p_town: 'Limassol',
      p_venue_id: null,
      p_types: ['indoor'],
      p_favourites_only: true,
      p_include_unavailable: true,
    });
    expect(result[0]).toEqual({
      ...row,
      photoUrl: 'https://x/a.jpg',
      slots: [{ day: '2026-11-26', start: '18:00', end: '19:00', player_cents: 680 }],
    });
    expect(result[1].photoUrl).toBeNull();
    expect(mockSign).toHaveBeenCalledWith(['v1/a.jpg'], 3600);
  });

  it('sends one venue, 5 per side off 5-a-side, and no type filter when none is ticked', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await fetchBookSearch(query({ format: '7-a-side', playersPerSide: 6, place: { kind: 'venue', venueId: 'v9', name: 'X' } }), true);
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_town: null, p_venue_id: 'v9', p_types: null, p_players_per_side: 5 });
    expect(mockSign).not.toHaveBeenCalled();
  });

  it('turns a refusal into words', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'invalid_days' } });
    await expect(fetchBookSearch(query(), false)).rejects.toThrow('Pick up to three days from today.');
  });
});

describe('favourites', () => {
  it('adds a favourite by venue only (the server makes it the caller’s)', async () => {
    mockInsert.mockResolvedValue({ error: null });
    await setFavourite('v1', true);
    expect(mockFrom).toHaveBeenCalledWith('favourite_venues');
    expect(mockInsert).toHaveBeenCalledWith({ venue_id: 'v1' });
  });

  it('removes one', async () => {
    mockDeleteEq.mockResolvedValue({ error: null });
    await setFavourite('v1', false);
    expect(mockDeleteEq).toHaveBeenCalledWith('venue_id', 'v1');
  });

  it('treats adding one already there as done, and says when it fails', async () => {
    mockInsert.mockResolvedValueOnce({ error: { code: '23505', message: 'duplicate key' } });
    await expect(setFavourite('v1', true)).resolves.toBeUndefined();
    mockInsert.mockResolvedValueOnce({ error: { code: '42501', message: 'denied' } });
    await expect(setFavourite('v1', true)).rejects.toThrow('Couldn’t save this venue. Try again.');
    mockDeleteEq.mockResolvedValueOnce({ error: { message: 'x' } });
    await expect(setFavourite('v1', false)).rejects.toThrow('Couldn’t save this venue. Try again.');
  });
});

describe('requestVenue', () => {
  it('sends the trimmed name and town', async () => {
    mockInsert.mockResolvedValue({ error: null });
    await requestVenue('  Kamares Arena ', ' Limassol ');
    expect(mockFrom).toHaveBeenCalledWith('venue_requests');
    expect(mockInsert).toHaveBeenCalledWith({ venue_name: 'Kamares Arena', town: 'Limassol' });
  });

  it('refuses an empty field before asking the server', async () => {
    await expect(requestVenue(' ', 'Limassol')).rejects.toThrow('Add the venue name and town.');
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it('says when the day’s limit is reached, or it fails', async () => {
    mockInsert.mockResolvedValueOnce({ error: { message: 'venue_request_limit' } });
    await expect(requestVenue('A', 'B')).rejects.toThrow('You’ve sent 5 today. Try again tomorrow.');
    mockInsert.mockResolvedValueOnce({ error: { message: 'boom' } });
    await expect(requestVenue('A', 'B')).rejects.toThrow('Couldn’t send this. Try again.');
  });
});

describe('where a tap goes', () => {
  const nav = { push: jest.fn(), replace: jest.fn() };
  beforeEach(() => nav.push.mockClear());

  // S5: a time opens the venue page's Book tab with this slot picked; its
  // Continue opens the payment sheet there.
  it('a time opens the venue page on Book, with that slot picked', () => {
    openTimeSlot(
      { venueId: 'v1', venueName: 'Kamares', day: '2026-11-26', start: '18:00', end: '19:30', format: '5-a-side', playersPerSide: 6 },
      nav,
    );
    expect(nav.push).toHaveBeenCalledWith({
      pathname: '/venue/[id]',
      params: {
        id: 'v1',
        tab: 'book',
        day: '2026-11-26',
        start: '18:00',
        end: '19:30',
        format: '5-a-side',
        playersPerSide: '6',
      },
    });
  });

  it('a card opens the venue page with no time', () => {
    openVenue('v1', nav);
    expect(nav.push).toHaveBeenCalledWith({ pathname: '/venue/[id]', params: { id: 'v1' } });
  });
});
