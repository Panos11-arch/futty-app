// Saved searches in the app: the server decides; these are the words and
// the calls.
import { primeRules, CHANGED_RULES } from '@/lib/rules.fixtures';
import {
  createSavedSearch,
  deleteSavedSearch,
  draftFromSearch,
  gameFits,
  halfHours,
  isoWeekday,
  savedSearchErrorMessage,
} from '@/lib/saved-searches';

let mockCalls: unknown[][] = [];
let mockResponse: { data: unknown; error: unknown } = { data: null, error: null };

jest.mock('@/lib/supabase', () => {
  const query: Record<string, unknown> = {};
  for (const method of ['select', 'insert', 'delete', 'eq', 'order']) {
    query[method] = (...args: unknown[]) => {
      mockCalls.push([method, ...args]);
      return query;
    };
  }
  query.then = (resolve: (r: unknown) => unknown) => resolve(mockResponse);
  return {
    supabase: {
      from: (table: string) => {
        mockCalls.push(['from', table]);
        return query;
      },
    },
  };
});

beforeEach(() => {
  mockCalls = [];
  mockResponse = { data: null, error: null };
  primeRules();
});

describe('saved searches', () => {
  it('a draft from the booking search: that day, that game', () => {
    expect(draftFromSearch({ day: '2026-11-19', start: '23:00', minutes: 60, format: '5-a-side' })).toEqual({
      day: '2026-11-19',
      weekday: null,
      from_local: '23:00',
      to_local: '24:00',
      minutes: 60,
      format: '5-a-side',
      city: null,
      area: null,
    });
  });

  it('weekdays are ISO (Monday 1, Sunday 7)', () => {
    expect(isoWeekday('2026-11-16')).toBe(1);
    expect(isoWeekday('2026-11-22')).toBe(7);
  });

  it('every half hour, midnight to midnight', () => {
    const times = halfHours();
    expect(times[0]).toBe('00:00');
    expect(times[1]).toBe('00:30');
    expect(times.at(-1)).toBe('24:00');
    expect(times).toHaveLength(49);
  });

  it('the game must fit in the window', () => {
    expect(gameFits({ from_local: '19:00', to_local: '20:00', minutes: 60 })).toBe(true);
    expect(gameFits({ from_local: '19:00', to_local: '20:00', minutes: 90 })).toBe(false);
    expect(gameFits({ from_local: '22:30', to_local: '24:00', minutes: 90 })).toBe(true);
  });

  it('the limit in the refusal follows the rules', () => {
    expect(savedSearchErrorMessage('saved_search_limit')).toBe('You can save up to 5 searches. Delete one to save this.');
    primeRules(CHANGED_RULES);
    expect(savedSearchErrorMessage('saved_search_limit')).toBe('You can save up to 3 searches. Delete one to save this.');
    primeRules(null);
    expect(savedSearchErrorMessage('saved_search_limit')).toBe(
      'You’ve saved as many searches as you can. Delete one to save this.',
    );
  });

  it('every other refusal in plain words', () => {
    expect(savedSearchErrorMessage('saved_search_too_far')).toBe('That day is further ahead than you can book.');
    expect(savedSearchErrorMessage('saved_search_in_past')).toBe('That day has passed. Pick another day.');
    expect(savedSearchErrorMessage('saved_search_unknown_place')).toBe('No venue on Futty is there yet. Pick another place.');
    expect(savedSearchErrorMessage('new row violates check constraint "saved_searches_fits"')).toBe(
      'The game doesn’t fit between those times.',
    );
    expect(savedSearchErrorMessage('anything else')).toBe('Couldn’t save this search. Try again.');
  });

  it('saves and deletes through the table (the server checks the rules)', async () => {
    const draft = draftFromSearch({ day: '2026-11-19', start: '19:00', minutes: 60, format: null });
    await createSavedSearch(draft);
    expect(mockCalls).toEqual([['from', 'saved_searches'], ['insert', draft]]);

    mockCalls = [];
    await deleteSavedSearch('s1');
    expect(mockCalls).toEqual([['from', 'saved_searches'], ['delete'], ['eq', 'id', 's1']]);
  });

  it('a refused save throws the plain words', async () => {
    mockResponse = { data: null, error: { message: 'saved_search_limit' } };
    await expect(createSavedSearch(draftFromSearch({ day: '2026-11-19', start: '19:00', minutes: 60, format: null }))).rejects.toThrow(
      'You can save up to 5 searches. Delete one to save this.',
    );
  });
});
