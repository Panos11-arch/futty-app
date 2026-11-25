import AsyncStorage from '@react-native-async-storage/async-storage';

import type { BookingPostQuote } from './booking-posts';
import {
  buildCards,
  cardHref,
  cyprusDayTime,
  dayTitle,
  emptyFilters,
  fetchMatches,
  filtersChipLabel,
  groupByDay,
  levelText,
  loadMatchFilters,
  organiserOf,
  parseFilters,
  priceText,
  saveMatchFilters,
  spotsText,
  withoutPastDays,
  type MatchFilters,
  type MatchRow,
} from './find-match';

const mockRpc = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: { rpc: (...a: unknown[]) => mockRpc(...a) },
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));
const storage = AsyncStorage as unknown as { getItem: jest.Mock; setItem: jest.Mock };

beforeEach(() => {
  jest.resetAllMocks();
});

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
    people: [{ id: 'u1', name: 'Andreas' }],
    ...over,
  };
}

function quote(over: Partial<BookingPostQuote> = {}): BookingPostQuote {
  return {
    post_id: 'p1',
    kind: 'players',
    side: null,
    mine: false,
    open: true,
    closes_at: '2026-11-27T17:00:00Z',
    join_cents: 680,
    join_pitch_cents: 600,
    join_fee_cents: 80,
    pay_all_cents: null,
    each_pays_cents: null,
    guarantee_cents: null,
    ...over,
  };
}

const filters: MatchFilters = {
  format: '5-a-side',
  place: { kind: 'town', town: 'Limassol' },
  days: ['2026-11-24'],
  window: { preset: 'all_day', from: '00:00', to: '24:00' },
};

describe('filtersChipLabel', () => {
  it('reads "Format | Places | Dates and times" before any filter', () => {
    expect(filtersChipLabel(null, '2026-11-24')).toBe('Format | Places | Dates and times');
  });
  it('shows each chosen part', () => {
    expect(filtersChipLabel(filters, '2026-11-24')).toBe('5-a-side | Limassol | Today');
  });
  it('keeps the placeholder for an unset part', () => {
    expect(filtersChipLabel(emptyFilters(), '2026-11-24')).toBe('Format | Places | Dates and times');
  });
  it('adds the time window to the days, or shows it alone', () => {
    const evening = { preset: 'evening' as const, from: '18:00', to: '24:00' };
    expect(filtersChipLabel({ ...filters, window: evening }, '2026-11-24')).toBe('5-a-side | Limassol | Today Evening');
    expect(filtersChipLabel({ ...filters, days: [], window: evening }, '2026-11-24')).toBe('5-a-side | Limassol | Evening');
  });
  it('names a venue', () => {
    expect(filtersChipLabel({ ...filters, place: { kind: 'venue', venueId: 'v', name: 'Kamares' } }, '2026-11-24')).toBe(
      '5-a-side | Kamares | Today',
    );
  });
});

describe('parseFilters and storage', () => {
  it('accepts a whole filter', () => {
    expect(parseFilters(filters)).toEqual(filters);
    expect(parseFilters(emptyFilters())).toEqual(emptyFilters());
  });
  it.each([
    ['not an object', 'x'],
    ['an unknown format', { ...filters, format: '8-a-side' }],
    ['a bad day', { ...filters, days: ['24/11/2026'] }],
    ['a bad place', { ...filters, place: { kind: 'town' } }],
    ['a bad window', { ...filters, window: { preset: 'night', from: '00:00', to: '24:00' } }],
    ['a bad time', { ...filters, window: { preset: 'specific', from: '7pm', to: '24:00' } }],
  ])('refuses %s', (_, value) => {
    expect(parseFilters(value)).toBeNull();
  });

  it('loads what was saved', async () => {
    storage.getItem.mockResolvedValue(JSON.stringify(filters));
    await expect(loadMatchFilters()).resolves.toEqual(filters);
  });
  it('loads none when nothing, broken JSON or storage fails', async () => {
    storage.getItem.mockResolvedValueOnce(null);
    await expect(loadMatchFilters()).resolves.toBeNull();
    storage.getItem.mockResolvedValueOnce('{');
    await expect(loadMatchFilters()).resolves.toBeNull();
    storage.getItem.mockRejectedValueOnce(new Error('disk'));
    await expect(loadMatchFilters()).resolves.toBeNull();
  });
  it('saves, and never throws when storage fails', async () => {
    storage.setItem.mockResolvedValueOnce(undefined);
    await saveMatchFilters(filters);
    expect(storage.setItem).toHaveBeenCalledWith('futty.find_match.filters', JSON.stringify(filters));
    storage.setItem.mockRejectedValueOnce(new Error('full'));
    await expect(saveMatchFilters(filters)).resolves.toBeUndefined();
  });
  it('drops days before today', () => {
    const f = { ...filters, days: ['2026-11-20', '2026-11-24', '2026-11-25'] };
    expect(withoutPastDays(f, '2026-11-24').days).toEqual(['2026-11-24', '2026-11-25']);
    expect(withoutPastDays(filters, '2026-11-24')).toBe(filters);
  });
});

describe('Cyprus days', () => {
  it('reads an instant in Cyprus time, not UTC', () => {
    // 22:30 UTC on 24 Nov is 00:30 on 25 Nov in Cyprus (UTC+2).
    expect(cyprusDayTime('2026-11-24T22:30:00Z')).toEqual({ day: '2026-11-25', time: '00:30' });
    // Summer time: UTC+3.
    expect(cyprusDayTime('2026-07-01T17:00:00Z')).toEqual({ day: '2026-07-01', time: '20:00' });
  });
  it('titles days', () => {
    expect(dayTitle('2026-11-24', '2026-11-24')).toBe('Today');
    expect(dayTitle('2026-11-25', '2026-11-24')).toBe('Tomorrow');
    expect(dayTitle('2026-11-27', '2026-11-24')).toBe('Friday 27 Nov');
    expect(dayTitle('2026-12-01', '2026-11-30')).toBe('Tomorrow');
  });
});

describe('card text', () => {
  it('shows a level range, one level, or none', () => {
    expect(levelText('4.00', '6.00')).toBe('Level 4.0–6.0');
    expect(levelText(6.1, 6.1)).toBe('Level 6.1');
    expect(levelText(null, null)).toBeNull();
  });
  it('shows spots on a players game only', () => {
    expect(spotsText(row())).toBe('12/14');
    expect(spotsText(row({ kind: 'opposition' }))).toBeNull();
    expect(spotsText(row({ players_in: null }))).toBeNull();
  });
  it('shows the price per player, or "Paid by the captain"', () => {
    expect(priceText(680)).toBe('€6.80 per player');
    expect(priceText(0)).toBe('Paid by the captain');
    expect(priceText(null)).toBeNull();
  });
  it('names the team on an older opposition post, else the poster', () => {
    expect(organiserOf(row())).toEqual({ kind: 'player', id: 'u1', name: 'Andreas' });
    expect(organiserOf(row({ team_id: 't1', team_name: 'Lions' }))).toEqual({ kind: 'team', id: 't1', name: 'Lions' });
  });
});

describe('buildCards', () => {
  it('prices a Booking v2 players post from its quote', () => {
    const [card] = buildCards([row()], new Map([['p1', quote()]]), new Map([['p1', { share_cents: 999, fee_cents: null, pitch_cents: null }]]));
    expect(card).toMatchObject({ priceCents: 680, v2: true, mine: false, day: '2026-11-27', time: '19:00' });
  });
  it('prices an opposition post at side B\'s each-pays price', () => {
    const [card] = buildCards(
      [row({ kind: 'opposition' })],
      new Map([['p1', quote({ kind: 'opposition', join_cents: null, each_pays_cents: 480, pay_all_cents: 2275 })]]),
      null,
    );
    expect(card.priceCents).toBe(480);
  });
  it('prices an older players post from squad_post_prices, and an older opposition post not at all', () => {
    const prices = new Map([['p1', { share_cents: 500, fee_cents: null, pitch_cents: null }]]);
    expect(buildCards([row()], new Map(), prices)[0]).toMatchObject({ priceCents: 500, v2: false });
    expect(buildCards([row({ kind: 'opposition' })], new Map(), prices)[0].priceCents).toBeNull();
    expect(buildCards([row()], new Map(), null)[0].priceCents).toBeNull();
  });
  it('leaves out a post its quote calls closed, and marks the caller\'s own', () => {
    expect(buildCards([row()], new Map([['p1', quote({ open: false })]]), null)).toEqual([]);
    expect(buildCards([row()], new Map([['p1', quote({ mine: true })]]), null)[0].mine).toBe(true);
  });
  it('treats missing people as none', () => {
    expect(buildCards([row({ people: null as unknown as [] })], new Map(), null)[0].people).toEqual([]);
  });
});

describe('groupByDay', () => {
  it('groups by Cyprus day in kickoff order', () => {
    const cards = buildCards(
      [
        row({ post_id: 'b', scheduled_at: '2026-11-27T19:00:00Z' }),
        row({ post_id: 'a', scheduled_at: '2026-11-24T18:00:00Z' }),
        row({ post_id: 'c', scheduled_at: '2026-11-27T17:00:00Z' }),
        // 23:30 UTC on 24 Nov: already the 25th in Cyprus.
        row({ post_id: 'd', scheduled_at: '2026-11-24T23:30:00Z' }),
      ],
      new Map(),
      null,
    );
    const sections = groupByDay(cards, '2026-11-24');
    expect(sections.map((s) => [s.title, s.data.map((c) => c.post_id)])).toEqual([
      ['Today', ['a']],
      ['Tomorrow', ['d']],
      ['Friday 27 Nov', ['c', 'b']],
    ]);
  });
  it('is empty with no games', () => {
    expect(groupByDay([], '2026-11-24')).toEqual([]);
  });
});

describe('cardHref', () => {
  const card = { post_id: 'p1', kind: 'players' as const, v2: true, mine: false };
  it('opens the B4 join screen for a players game', () => {
    expect(cardHref(card)).toEqual({ pathname: '/join-squad-post', params: { postId: 'p1' } });
    expect(cardHref({ ...card, v2: false })).toEqual({ pathname: '/join-squad-post', params: { postId: 'p1' } });
  });
  it('opens "Accept as opponent" for a Booking v2 opposition post', () => {
    expect(cardHref({ ...card, kind: 'opposition' })).toEqual({ pathname: '/opposition-invite', params: { postId: 'p1' } });
  });
  it('opens the posts list for an older opposition post and the caller\'s own', () => {
    expect(cardHref({ ...card, kind: 'opposition', v2: false })).toEqual({ pathname: '/squad-posts', params: { view: 'opposition' } });
    expect(cardHref({ ...card, mine: true })).toEqual({ pathname: '/squad-posts', params: { view: 'players' } });
  });
});

describe('fetchMatches', () => {
  it('sends the filters and prices the games as B4 does', async () => {
    mockRpc.mockImplementation((name: string) => {
      if (name === 'find_matches') return Promise.resolve({ data: [row(), row({ post_id: 'p2', kind: 'opposition' })], error: null });
      if (name === 'booking_post_quotes') return Promise.resolve({ data: [quote()], error: null });
      return Promise.resolve({ data: [], error: null });
    });
    const cards = await fetchMatches({ ...filters, place: { kind: 'venue', venueId: 'v9', name: 'X' } });
    expect(mockRpc).toHaveBeenCalledWith('find_matches', {
      p_format: '5-a-side',
      p_town: null,
      p_venue_id: 'v9',
      p_days: ['2026-11-24'],
      p_from: '00:00',
      p_to: '24:00',
    });
    expect(mockRpc).toHaveBeenCalledWith('booking_post_quotes', { p_post_ids: ['p1', 'p2'] });
    expect(mockRpc).toHaveBeenCalledWith('squad_post_prices', { p_post_ids: ['p1'] });
    expect(cards.map((c) => [c.post_id, c.priceCents])).toEqual([
      ['p1', 680],
      ['p2', null],
    ]);
  });
  it('sends a town, any format and no days as nulls', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await expect(fetchMatches({ ...emptyFilters(), place: { kind: 'town', town: 'Paphos' } })).resolves.toEqual([]);
    expect(mockRpc).toHaveBeenCalledWith('find_matches', expect.objectContaining({ p_format: null, p_town: 'Paphos', p_days: null }));
    expect(mockRpc).toHaveBeenCalledTimes(1);
  });
  it('throws one line when the games or the quotes fail', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    await expect(fetchMatches(filters)).rejects.toThrow('Couldn’t load games. Try again.');
    mockRpc.mockImplementation((name: string) =>
      Promise.resolve(name === 'find_matches' ? { data: [row()], error: null } : { data: null, error: { message: 'x' } }),
    );
    await expect(fetchMatches(filters)).rejects.toThrow('Couldn’t load games. Try again.');
  });
});
