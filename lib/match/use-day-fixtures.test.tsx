import { act, renderHook, waitFor } from '@testing-library/react-native';

import { useDayFixtures } from '@/lib/match/use-day-fixtures';

const mockList = jest.fn();
jest.mock('@/lib/match/day-fixtures', () => ({ listLeagueFixturesOnDay: (d: string) => mockList(d) }));

beforeEach(() => {
  mockList.mockReset();
  mockList.mockResolvedValue({ fixtures: [{ id: 'f1' }], error: null });
});

describe('useDayFixtures', () => {
  it('loads the day, and loads again when the day changes', async () => {
    const { result, rerender } = await renderHook((props: { day: string }) => useDayFixtures(props.day), { initialProps: { day: '2026-11-26' } });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockList).toHaveBeenLastCalledWith('2026-11-26');
    await rerender({ day: '2026-11-27' });
    await waitFor(() => expect(mockList).toHaveBeenLastCalledWith('2026-11-27'));
  });

  it('an error, then Try again loads again', async () => {
    mockList.mockResolvedValueOnce({ fixtures: [], error: 'offline' });
    const { result } = await renderHook(() => useDayFixtures('2026-11-26'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    await act(() => result.current.reload());
    expect(result.current.status).toBe('ready');
  });

  it('pull to refresh keeps the list while it reloads', async () => {
    let finish: (v: unknown) => void = () => {};
    const { result } = await renderHook(() => useDayFixtures('2026-11-26'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    mockList.mockReturnValueOnce(new Promise((r) => (finish = r)));
    let done: Promise<void> = Promise.resolve();
    await act(async () => {
      done = result.current.refresh();
    });
    expect(result.current.refreshing).toBe(true);
    expect(result.current.status).toBe('ready');
    await act(async () => {
      finish({ fixtures: [], error: null });
      await done;
    });
    expect(result.current.refreshing).toBe(false);
  });
});
