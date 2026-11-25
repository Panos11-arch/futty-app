import { act, renderHook, waitFor } from '@testing-library/react-native';

import { FEED_PAGE_SIZE, type FeedItem, type FeedScope } from './community';
import { useCommunityFeed } from './use-community-feed';

const mockFetchFeed = jest.fn();
jest.mock('@/lib/supabase', () => ({ supabase: {} }));
jest.mock('@/lib/community', () => ({
  ...jest.requireActual('@/lib/community'),
  fetchFeed: (...a: unknown[]) => mockFetchFeed(...a),
}));

function item(id: string, at = '2026-11-25T10:00:00Z'): FeedItem {
  return { kind: 'squad_post', item_id: id, sort_at: at } as FeedItem;
}

function page(n: number, from = 0): FeedItem[] {
  return Array.from({ length: n }, (_, i) => item(`p${from + i}`));
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe('useCommunityFeed', () => {
  it('loads the first page of its scope', async () => {
    mockFetchFeed.mockResolvedValue({ data: [item('a')], error: null });
    const { result } = await renderHook(() => useCommunityFeed('following'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(mockFetchFeed).toHaveBeenCalledWith('following');
    expect(result.current.items.map((i) => i.item_id)).toEqual(['a']);
    expect(result.current.hasMore).toBe(false);
  });

  it('is loading until the server answers', async () => {
    mockFetchFeed.mockReturnValue(new Promise(() => {}));
    const { result } = await renderHook(() => useCommunityFeed('for_you'));
    expect(result.current.status).toBe('loading');
    expect(result.current.items).toEqual([]);
  });

  it('an error, then "Try again" loads again', async () => {
    mockFetchFeed.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    const { result } = await renderHook(() => useCommunityFeed('for_you'));
    await waitFor(() => expect(result.current.status).toBe('error'));
    mockFetchFeed.mockResolvedValueOnce({ data: [], error: null });
    await act(() => result.current.reload());
    expect(result.current.status).toBe('ready');
    expect(result.current.items).toEqual([]);
  });

  it('loads more after the last row and stops on a short page', async () => {
    mockFetchFeed
      .mockResolvedValueOnce({ data: page(FEED_PAGE_SIZE), error: null })
      .mockResolvedValueOnce({ data: page(3, FEED_PAGE_SIZE), error: null });
    const { result } = await renderHook(() => useCommunityFeed('for_you'));
    await waitFor(() => expect(result.current.hasMore).toBe(true));
    await act(() => result.current.loadMore());
    expect(mockFetchFeed).toHaveBeenLastCalledWith('for_you', {
      at: '2026-11-25T10:00:00Z',
      id: `p${FEED_PAGE_SIZE - 1}`,
    });
    expect(result.current.items).toHaveLength(FEED_PAGE_SIZE + 3);
    expect(result.current.hasMore).toBe(false);
    await act(() => result.current.loadMore());
    expect(mockFetchFeed).toHaveBeenCalledTimes(2);
  });

  it('a failed next page keeps what is shown', async () => {
    mockFetchFeed
      .mockResolvedValueOnce({ data: page(FEED_PAGE_SIZE), error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    const { result } = await renderHook(() => useCommunityFeed('for_you'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(() => result.current.loadMore());
    expect(result.current.status).toBe('ready');
    expect(result.current.items).toHaveLength(FEED_PAGE_SIZE);
    expect(result.current.loadingMore).toBe(false);
  });

  it('refresh keeps the list on screen and replaces it', async () => {
    mockFetchFeed.mockResolvedValueOnce({ data: [item('old')], error: null });
    const { result } = await renderHook(() => useCommunityFeed('mine'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    mockFetchFeed.mockResolvedValueOnce({ data: [item('new')], error: null });
    await act(() => result.current.refresh());
    expect(result.current.items.map((i) => i.item_id)).toEqual(['new']);
    expect(result.current.refreshing).toBe(false);
  });

  it('a failed refresh keeps the old list', async () => {
    mockFetchFeed.mockResolvedValueOnce({ data: [item('old')], error: null });
    const { result } = await renderHook(() => useCommunityFeed('mine'));
    await waitFor(() => expect(result.current.status).toBe('ready'));
    mockFetchFeed.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    await act(() => result.current.refresh());
    expect(result.current.status).toBe('ready');
    expect(result.current.items.map((i) => i.item_id)).toEqual(['old']);
  });

  it("a new scope ignores the old scope's late answer", async () => {
    let resolveOld: (v: unknown) => void = () => {};
    mockFetchFeed.mockImplementationOnce(() => new Promise((r) => (resolveOld = r)));
    mockFetchFeed.mockResolvedValueOnce({ data: [item('mine')], error: null });
    const { result, rerender } = await renderHook((props: { scope: FeedScope }) => useCommunityFeed(props.scope), {
      initialProps: { scope: 'for_you' as FeedScope },
    });
    await rerender({ scope: 'mine' });
    await waitFor(() => expect(result.current.status).toBe('ready'));
    await act(async () => resolveOld({ data: [item('old')], error: null }));
    expect(result.current.items.map((i) => i.item_id)).toEqual(['mine']);
  });
});
