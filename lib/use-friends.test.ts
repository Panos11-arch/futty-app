// S20: the friends hooks (lib/use-friends.ts).
import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { FriendRow, ProfileCard } from '@/lib/friends';
import { useFriendRequestCount, useFriends, useProfileCard } from '@/lib/use-friends';

jest.mock('@/lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return { useFocusEffect: (effect: () => void) => useEffect(effect, [effect]) };
});

const mockApi = {
  fetchFriends: jest.fn(),
  fetchFriendRequestCount: jest.fn(),
  fetchProfileCard: jest.fn(),
  acceptFriendRequest: jest.fn(),
  declineFriendRequest: jest.fn(),
};
jest.mock('@/lib/friends', () => {
  const actual = jest.requireActual<typeof import('@/lib/friends')>('@/lib/friends');
  return {
    ...actual,
    fetchFriends: (...a: unknown[]) => mockApi.fetchFriends(...a),
    fetchFriendRequestCount: (...a: unknown[]) => mockApi.fetchFriendRequestCount(...a),
    fetchProfileCard: (...a: unknown[]) => mockApi.fetchProfileCard(...a),
    acceptFriendRequest: (...a: unknown[]) => mockApi.acceptFriendRequest(...a),
    declineFriendRequest: (...a: unknown[]) => mockApi.declineFriendRequest(...a),
  };
});

function row(over: Partial<FriendRow>): FriendRow {
  return {
    kind: 'friend',
    request_id: null,
    profile_id: 'p1',
    name: 'Ana',
    first_name: 'Ana',
    avatar_style: null,
    avatar_kit_colour: null,
    avatar_number: null,
    avatar_illustration: null,
    level: null,
    ...over,
  };
}

const request = row({ kind: 'request', request_id: 'r1', profile_id: 'p2', name: 'Cara', first_name: 'Cara' });
const friend = row({});

beforeEach(() => Object.values(mockApi).forEach((f) => f.mockReset()));

describe('useFriends', () => {
  it('loads the list', async () => {
    mockApi.fetchFriends.mockResolvedValue([request, friend]);
    const hook = await renderHook(() => useFriends());
    await waitFor(() => expect(hook.result.current.state).toEqual({ status: 'ready', rows: [request, friend] }));
  });

  it('an error is one line', async () => {
    mockApi.fetchFriends.mockRejectedValue(new Error('x'));
    const hook = await renderHook(() => useFriends());
    await waitFor(() => expect(hook.result.current.state).toEqual({ status: 'error', message: "Friends couldn't load." }));
  });

  it('a failed pull to refresh keeps the list', async () => {
    mockApi.fetchFriends.mockResolvedValueOnce([friend]).mockRejectedValueOnce(new Error('x'));
    const hook = await renderHook(() => useFriends());
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
    await act(async () => hook.result.current.refresh());
    expect(hook.result.current.state).toEqual({ status: 'ready', rows: [friend] });
    expect(hook.result.current.refreshing).toBe(false);
  });

  it('Try again loads again', async () => {
    mockApi.fetchFriends.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce([friend]);
    const hook = await renderHook(() => useFriends());
    await waitFor(() => expect(hook.result.current.state.status).toBe('error'));
    await act(async () => hook.result.current.reload());
    expect(hook.result.current.state).toEqual({ status: 'ready', rows: [friend] });
  });

  it('accept: returns the chat and reloads', async () => {
    mockApi.fetchFriends.mockResolvedValueOnce([request]).mockResolvedValueOnce([{ ...request, kind: 'friend', request_id: null }]);
    mockApi.acceptFriendRequest.mockResolvedValue({ conversationId: 'c1', error: null });
    const hook = await renderHook(() => useFriends());
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
    let result: unknown;
    await act(async () => {
      result = await hook.result.current.accept(request);
    });
    expect(mockApi.acceptFriendRequest).toHaveBeenCalledWith('r1');
    expect(result).toEqual({ error: null, conversationId: 'c1' });
    expect(hook.result.current.state).toEqual({ status: 'ready', rows: [{ ...request, kind: 'friend', request_id: null }] });
  });

  it('accept refused: the line, nothing changes', async () => {
    mockApi.fetchFriends.mockResolvedValue([request]);
    mockApi.acceptFriendRequest.mockResolvedValue({ conversationId: null, error: { message: 'blocked' } });
    const hook = await renderHook(() => useFriends());
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
    let result: unknown;
    await act(async () => {
      result = await hook.result.current.accept(request);
    });
    expect(result).toEqual({ error: "You can't add this player.", conversationId: null });
  });

  it('accept or decline a row without a request does nothing', async () => {
    mockApi.fetchFriends.mockResolvedValue([friend]);
    const hook = await renderHook(() => useFriends());
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
    await act(async () => {
      expect((await hook.result.current.accept(friend)).error).toBeTruthy();
      expect(await hook.result.current.decline(friend)).toBeTruthy();
    });
    expect(mockApi.acceptFriendRequest).not.toHaveBeenCalled();
    expect(mockApi.declineFriendRequest).not.toHaveBeenCalled();
  });

  it('decline: the row goes at once', async () => {
    mockApi.fetchFriends.mockResolvedValue([request, friend]);
    mockApi.declineFriendRequest.mockResolvedValue({ error: null });
    const hook = await renderHook(() => useFriends());
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
    await act(async () => {
      expect(await hook.result.current.decline(request)).toBeNull();
    });
    expect(mockApi.declineFriendRequest).toHaveBeenCalledWith('r1');
    expect(hook.result.current.state).toEqual({ status: 'ready', rows: [friend] });
  });

  it('decline refused: the row comes back', async () => {
    mockApi.fetchFriends.mockResolvedValue([request, friend]);
    mockApi.declineFriendRequest.mockResolvedValue({ error: { message: 'request_not_found' } });
    const hook = await renderHook(() => useFriends());
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
    await act(async () => {
      expect(await hook.result.current.decline(request)).toBe('This request is gone. Pull to refresh.');
    });
    expect(hook.result.current.state).toEqual({ status: 'ready', rows: [request, friend] });
  });
});

describe('useFriendRequestCount', () => {
  it('reads the count', async () => {
    mockApi.fetchFriendRequestCount.mockResolvedValue(2);
    const hook = await renderHook(() => useFriendRequestCount());
    await waitFor(() => expect(hook.result.current).toBe(2));
  });

  it('stays 0 on a failure', async () => {
    mockApi.fetchFriendRequestCount.mockRejectedValue(new Error('x'));
    const hook = await renderHook(() => useFriendRequestCount());
    await act(async () => {});
    expect(hook.result.current).toBe(0);
  });
});

describe('useProfileCard', () => {
  const card = { profile_id: 'p1', friend_status: 'none' } as ProfileCard;

  it('loads by username', async () => {
    mockApi.fetchProfileCard.mockResolvedValue({ card, error: null });
    const hook = await renderHook(() => useProfileCard({ username: 'ben' }));
    await waitFor(() => expect(hook.result.current.state).toEqual({ status: 'ready', card }));
    expect(mockApi.fetchProfileCard).toHaveBeenCalledWith({ username: 'ben' });
  });

  it('not found', async () => {
    mockApi.fetchProfileCard.mockResolvedValue({ card: null, error: { message: 'player_not_found' } });
    const hook = await renderHook(() => useProfileCard({ profileId: 'p1' }));
    await waitFor(() => expect(hook.result.current.state).toEqual({ status: 'not_found' }));
  });

  it('an error, then Try again', async () => {
    mockApi.fetchProfileCard
      .mockResolvedValueOnce({ card: null, error: { message: 'boom' } })
      .mockResolvedValueOnce({ card, error: null });
    const hook = await renderHook(() => useProfileCard({ profileId: 'p1' }));
    await waitFor(() => expect(hook.result.current.state).toEqual({ status: 'error', message: "This card couldn't load." }));
    await act(async () => hook.result.current.reload());
    await waitFor(() => expect(hook.result.current.state).toEqual({ status: 'ready', card }));
  });

  it('a thrown error is an error', async () => {
    mockApi.fetchProfileCard.mockRejectedValue(new Error('x'));
    const hook = await renderHook(() => useProfileCard({ profileId: 'p1' }));
    await waitFor(() => expect(hook.result.current.state.status).toBe('error'));
  });

  it('nothing asked: loads nothing', async () => {
    const hook = await renderHook(() => useProfileCard(null));
    expect(hook.result.current.state).toEqual({ status: 'loading' });
    expect(mockApi.fetchProfileCard).not.toHaveBeenCalled();
  });

  it('setCard shows the new friendship', async () => {
    mockApi.fetchProfileCard.mockResolvedValue({ card, error: null });
    const hook = await renderHook(() => useProfileCard({ username: 'ben' }));
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
    await act(async () => hook.result.current.setCard({ ...card, friend_status: 'requested' }));
    expect(hook.result.current.state).toEqual({ status: 'ready', card: { ...card, friend_status: 'requested' } });
  });
});
