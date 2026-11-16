// P10: loading spec 13's rules. Fetched from app_rules, checked, kept on the
// phone; the last good copy is used offline; a broken row never replaces a
// good copy; with nothing at all the screen gets an error, never a number.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook, waitFor } from '@testing-library/react-native';

import { getCachedRules } from '@/lib/rules';
import { CHANGED_RULES, SPEC_RULES } from '@/lib/rules.fixtures';
import { ensureRules, fetchRules, resetRulesForTests, RULES_STORAGE_KEY, useRules } from '@/lib/use-rules';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const mockSingle = jest.fn();
const mockSelect = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => {
        mockSelect(table, columns);
        return { single: () => mockSingle() };
      },
    }),
  },
}));

beforeEach(async () => {
  resetRulesForTests();
  mockSingle.mockReset();
  mockSelect.mockReset();
  await AsyncStorage.clear();
});

describe('fetchRules', () => {
  it('reads app_rules, keeps the rules in memory and saves them on the phone', async () => {
    mockSingle.mockResolvedValue({ data: { ...SPEC_RULES, id: true }, error: null });
    await expect(fetchRules()).resolves.toEqual(SPEC_RULES);
    expect(mockSelect).toHaveBeenCalledWith('app_rules', expect.stringContaining('refund_cutoff_hours'));
    expect(getCachedRules()).toEqual(SPEC_RULES);
    expect(JSON.parse((await AsyncStorage.getItem(RULES_STORAGE_KEY))!)).toEqual(SPEC_RULES);
  });

  it('a broken row from the server never replaces the rules in use', async () => {
    mockSingle.mockResolvedValueOnce({ data: SPEC_RULES, error: null });
    await fetchRules();
    mockSingle.mockResolvedValueOnce({ data: { ...CHANGED_RULES, refund_cutoff_hours: null }, error: null });
    await expect(fetchRules()).rejects.toThrow('incomplete');
    expect(getCachedRules()).toEqual(SPEC_RULES);
    expect(JSON.parse((await AsyncStorage.getItem(RULES_STORAGE_KEY))!)).toEqual(SPEC_RULES);
  });

  it('one request at a time', async () => {
    mockSingle.mockResolvedValue({ data: SPEC_RULES, error: null });
    await Promise.all([fetchRules(), fetchRules(), fetchRules()]);
    expect(mockSingle).toHaveBeenCalledTimes(1);
  });
});

describe('ensureRules', () => {
  it('offline: the copy saved last time is used', async () => {
    await AsyncStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(CHANGED_RULES));
    mockSingle.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    await ensureRules();
    expect(getCachedRules()).toEqual(CHANGED_RULES);
  });

  it('a saved copy that is broken is ignored', async () => {
    await AsyncStorage.setItem(RULES_STORAGE_KEY, '{"fee_each_pays_cents": 80}');
    mockSingle.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    await ensureRules();
    expect(getCachedRules()).toBeNull();
  });
});

describe('useRules', () => {
  it('loads, then shows the fetched rules', async () => {
    mockSingle.mockResolvedValue({ data: SPEC_RULES, error: null });
    const { result } = await renderHook(() => useRules());
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', rules: SPEC_RULES, fresh: true }));
  });

  it('offline with a saved copy: ready with the saved rules, marked not fresh', async () => {
    await AsyncStorage.setItem(RULES_STORAGE_KEY, JSON.stringify(SPEC_RULES));
    mockSingle.mockResolvedValue({ data: null, error: { message: 'Network request failed' } });
    const { result } = await renderHook(() => useRules());
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', rules: SPEC_RULES, fresh: false }));
  });

  it('nothing saved and offline: an error to retry, never a guessed number; retrying loads them', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } });
    const { result } = await renderHook(() => useRules());
    await waitFor(() => expect(result.current.state).toEqual({ status: 'error', message: 'Network request failed' }));
    mockSingle.mockResolvedValueOnce({ data: SPEC_RULES, error: null });
    await act(async () => {
      await result.current.reload();
    });
    await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', rules: SPEC_RULES, fresh: true }));
  });

  it('new rules reach a screen already showing the old ones', async () => {
    mockSingle.mockResolvedValueOnce({ data: SPEC_RULES, error: null });
    const { result } = await renderHook(() => useRules());
    await waitFor(() => expect(result.current.state).toMatchObject({ status: 'ready', rules: SPEC_RULES }));
    mockSingle.mockResolvedValueOnce({ data: CHANGED_RULES, error: null });
    await act(async () => {
      await result.current.reload();
    });
    await waitFor(() => expect(result.current.state).toMatchObject({ status: 'ready', rules: CHANGED_RULES }));
  });
});
