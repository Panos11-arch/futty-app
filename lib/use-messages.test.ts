import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { ConversationHeader, ServerMessage } from '@/lib/messages';
import { useConversation, useInbox, useUnreadMessages } from '@/lib/use-messages';

// Realtime: every handler registered, by table, so a test can deliver a row.
const mockHandlers: Record<string, ((payload: unknown) => void)[]> = {};
const mockRemove = jest.fn();
jest.mock('@/lib/supabase', () => ({
  supabase: {
    channel: () => {
      const channel = {
        on: (_: string, opts: { table: string }, handler: (payload: unknown) => void) => {
          (mockHandlers[opts.table] ??= []).push(handler);
          return channel;
        },
        subscribe: () => channel,
      };
      return channel;
    },
    removeChannel: (...args: unknown[]) => mockRemove(...args),
  },
}));
jest.mock('@/lib/realtime', () => ({ useRealtimeChannelName: (name: string) => name }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'me' } }) }));
jest.mock('expo-router', () => {
  const { useEffect } = jest.requireActual<typeof import('react')>('react');
  return { useFocusEffect: (effect: () => void) => useEffect(effect, [effect]) };
});

const mockApi = {
  fetchConversationHeader: jest.fn(),
  fetchMessages: jest.fn(),
  sendMessage: jest.fn(),
  markConversationRead: jest.fn(),
  markMessagesDelivered: jest.fn(),
  fetchInbox: jest.fn(),
  fetchUnreadCount: jest.fn(),
};
let mockClientIds: string[] = [];
jest.mock('@/lib/messages', () => {
  const actual = jest.requireActual<typeof import('@/lib/messages')>('@/lib/messages');
  return {
    ...actual,
    fetchConversationHeader: (...a: unknown[]) => mockApi.fetchConversationHeader(...a),
    fetchMessages: (...a: unknown[]) => mockApi.fetchMessages(...a),
    sendMessage: (...a: unknown[]) => mockApi.sendMessage(...a),
    markConversationRead: (...a: unknown[]) => mockApi.markConversationRead(...a),
    markMessagesDelivered: (...a: unknown[]) => mockApi.markMessagesDelivered(...a),
    fetchInbox: (...a: unknown[]) => mockApi.fetchInbox(...a),
    fetchUnreadCount: (...a: unknown[]) => mockApi.fetchUnreadCount(...a),
    newClientId: () => mockClientIds.shift() ?? 'k-extra',
  };
});

const header = { id: 'c1', kind: 'captains', title: 'Ben', other_read_at: null, other_delivered_at: null } as unknown as ConversationHeader;

function server(id: string, at: string, over: Partial<ServerMessage> = {}): ServerMessage {
  return { id, sender_id: 'them', sender_name: 'Ben', mine: false, body: id, client_id: null, created_at: at, ...over };
}

async function deliver(table: string, payload: unknown) {
  await act(async () => (mockHandlers[table] ?? []).forEach((h) => h(payload)));
}

beforeEach(() => {
  for (const k of Object.keys(mockHandlers)) delete mockHandlers[k];
  Object.values(mockApi).forEach((f) => f.mockReset());
  mockApi.markConversationRead.mockResolvedValue({ error: null });
  mockApi.markMessagesDelivered.mockResolvedValue({ error: null });
  mockClientIds = ['k1', 'k2'];
});

describe('useConversation', () => {
  async function opened(page: ServerMessage[] = [server('m1', '2026-11-25T08:00:00Z')]) {
    mockApi.fetchConversationHeader.mockResolvedValue(header);
    mockApi.fetchMessages.mockResolvedValue(page);
    const hook = await renderHook(() => useConversation('c1'));
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
    return hook;
  }

  function messages(hook: { result: { current: ReturnType<typeof useConversation> } }) {
    const s = hook.result.current.state;
    return s.status === 'ready' ? s.messages : [];
  }

  it('loads the header and the newest page, and marks the chat read', async () => {
    const hook = await opened();
    expect(mockApi.fetchMessages).toHaveBeenCalledWith('c1');
    expect(mockApi.markConversationRead).toHaveBeenCalledWith('c1');
    expect(messages(hook).map((m) => m.id)).toEqual(['m1']);
    expect(hook.result.current.state).toMatchObject({ hasOlder: false });
  });

  it('error: one line', async () => {
    mockApi.fetchConversationHeader.mockRejectedValue({ message: 'not_in_conversation' });
    mockApi.fetchMessages.mockResolvedValue([]);
    const hook = await renderHook(() => useConversation('c1'));
    await waitFor(() => expect(hook.result.current.state).toEqual({ status: 'error', message: "You're no longer in this chat." }));
  });

  it('optimistic send: the bubble at once, then the sent copy', async () => {
    const hook = await opened();
    let resolve: (v: unknown) => void = () => {};
    mockApi.sendMessage.mockReturnValue(new Promise((r) => (resolve = r)));
    let sent: Promise<boolean> = Promise.resolve(false);
    await act(async () => {
      sent = hook.result.current.send('hello');
    });
    expect(messages(hook)[0]).toMatchObject({ id: 'k1', body: 'hello', mine: true, pending: 'sending' });
    expect(mockApi.sendMessage).toHaveBeenCalledWith('c1', 'hello', 'k1');
    await act(async () => {
      resolve({ data: { id: 'm2', created_at: '2026-11-25T08:01:00Z' }, error: null });
      await sent;
    });
    expect(messages(hook).map((m) => [m.id, m.pending])).toEqual([
      ['m2', undefined],
      ['m1', undefined],
    ]);
    await expect(sent).resolves.toBe(true);
  });

  it('a failed send stays as failed with one line; retry sends the same client id', async () => {
    const hook = await opened();
    mockApi.sendMessage.mockResolvedValueOnce({ data: null, error: { message: 'rate_limited' } });
    await act(async () => {
      await hook.result.current.send('hello');
    });
    expect(messages(hook)[0]).toMatchObject({ client_id: 'k1', pending: 'failed' });
    expect(hook.result.current.sendError).toBe('Too many messages. Try again in a minute.');

    mockApi.sendMessage.mockResolvedValueOnce({ data: { id: 'm2', created_at: '2026-11-25T08:02:00Z' }, error: null });
    await act(async () => {
      await hook.result.current.retry('k1');
    });
    expect(mockApi.sendMessage).toHaveBeenLastCalledWith('c1', 'hello', 'k1');
    expect(hook.result.current.sendError).toBeNull();
    expect(messages(hook).filter((m) => m.body === 'hello')).toHaveLength(1);
    expect(messages(hook)[0].id).toBe('m2');
    expect(messages(hook)[0].pending).toBeUndefined();
  });

  it('retry of an unknown message does nothing', async () => {
    const hook = await opened();
    await act(async () => {
      await expect(hook.result.current.retry('nope')).resolves.toBe(false);
    });
    expect(mockApi.sendMessage).not.toHaveBeenCalled();
  });

  it('realtime: their message appears and is read while at the bottom', async () => {
    const hook = await opened();
    mockApi.markConversationRead.mockClear();
    await deliver('messages', { new: { id: 'm9', sender_id: 'them', body: 'yo', created_at: '2026-11-25T09:00:00Z', conversation_id: 'c1' } });
    expect(messages(hook)[0]).toMatchObject({ id: 'm9', mine: false, body: 'yo' });
    expect(mockApi.markConversationRead).toHaveBeenCalledWith('c1');
    expect(hook.result.current.unseen).toBe(0);
  });

  it('realtime while scrolled up: counted for the pill, read on the way back down', async () => {
    const hook = await opened();
    await act(async () => hook.result.current.setAtBottom(false));
    mockApi.markConversationRead.mockClear();
    await deliver('messages', { new: { id: 'm9', sender_id: 'them', body: 'yo', created_at: '2026-11-25T09:00:00Z' } });
    await deliver('messages', { new: { id: 'm10', sender_id: 'them', body: 'yo', created_at: '2026-11-25T09:01:00Z' } });
    expect(hook.result.current.unseen).toBe(2);
    expect(mockApi.markConversationRead).not.toHaveBeenCalled();
    await act(async () => hook.result.current.setAtBottom(true));
    expect(hook.result.current.unseen).toBe(0);
    expect(mockApi.markConversationRead).toHaveBeenCalledWith('c1');
  });

  it('realtime: my own message (from the send) is not doubled and not counted', async () => {
    const hook = await opened();
    mockApi.sendMessage.mockResolvedValue({ data: { id: 'm2', created_at: '2026-11-25T08:01:00Z' }, error: null });
    await act(async () => {
      await hook.result.current.send('hi');
    });
    await deliver('messages', { new: { id: 'm2', sender_id: 'me', client_id: 'k1', body: 'hi', created_at: '2026-11-25T08:01:00Z' } });
    expect(messages(hook).filter((m) => m.body === 'hi')).toHaveLength(1);
    expect(hook.result.current.unseen).toBe(0);
  });

  it('realtime: ignores a row without its fields', async () => {
    const hook = await opened();
    await deliver('messages', { new: { id: 'x' } });
    expect(messages(hook)).toHaveLength(1);
  });

  it('read receipts: the other side reading reloads the header; my own does not', async () => {
    const hook = await opened();
    mockApi.fetchConversationHeader.mockClear();
    mockApi.fetchConversationHeader.mockResolvedValue({ ...header, other_read_at: '2026-11-25T08:00:00Z' });
    await deliver('conversation_reads', { new: { profile_id: 'me' } });
    expect(mockApi.fetchConversationHeader).not.toHaveBeenCalled();
    await deliver('conversation_reads', { new: { profile_id: 'them' } });
    await waitFor(() => expect(hook.result.current.state).toMatchObject({ header: { other_read_at: '2026-11-25T08:00:00Z' } }));
  });

  it('pages upward from the oldest message, until there are no more', async () => {
    const page = Array.from({ length: 30 }, (_, i) =>
      server(`m${30 - i}`, new Date(Date.parse('2026-11-25T08:00:00Z') - i * 60_000).toISOString())
    );
    const hook = await opened(page);
    expect(hook.result.current.state).toMatchObject({ hasOlder: true });
    mockApi.fetchMessages.mockResolvedValueOnce([server('m0', '2026-11-24T08:00:00Z')]);
    await act(async () => {
      await hook.result.current.loadOlder();
    });
    expect(mockApi.fetchMessages).toHaveBeenLastCalledWith('c1', expect.objectContaining({ id: 'm1' }));
    expect(messages(hook)).toHaveLength(31);
    expect(hook.result.current.state).toMatchObject({ hasOlder: false });
    mockApi.fetchMessages.mockClear();
    await act(async () => {
      await hook.result.current.loadOlder();
    });
    expect(mockApi.fetchMessages).not.toHaveBeenCalled();
  });
});

describe('useInbox', () => {
  it('loads the rows and tells the senders they were delivered', async () => {
    mockApi.fetchInbox.mockResolvedValue([{ id: 'c1' }]);
    const hook = await renderHook(() => useInbox());
    await waitFor(() => expect(hook.result.current.state).toEqual({ status: 'ready', rows: [{ id: 'c1' }] }));
    expect(mockApi.markMessagesDelivered).toHaveBeenCalled();
  });

  it('error: one line, and Try again loads again', async () => {
    mockApi.fetchInbox.mockRejectedValueOnce(new Error('offline'));
    const hook = await renderHook(() => useInbox());
    await waitFor(() => expect(hook.result.current.state).toEqual({ status: 'error', message: 'Something went wrong. Try again.' }));
    mockApi.fetchInbox.mockResolvedValueOnce([]);
    await act(async () => {
      await hook.result.current.retry();
    });
    expect(hook.result.current.state).toEqual({ status: 'ready', rows: [] });
  });

  it('a failed refresh keeps the rows', async () => {
    mockApi.fetchInbox.mockResolvedValueOnce([{ id: 'c1' }]);
    const hook = await renderHook(() => useInbox());
    await waitFor(() => expect(hook.result.current.state.status).toBe('ready'));
    mockApi.fetchInbox.mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await hook.result.current.refresh();
    });
    expect(hook.result.current.state).toEqual({ status: 'ready', rows: [{ id: 'c1' }] });
    expect(hook.result.current.refreshing).toBe(false);
  });

  it('a new message reloads the rows', async () => {
    mockApi.fetchInbox.mockResolvedValue([]);
    await renderHook(() => useInbox());
    await waitFor(() => expect(mockApi.fetchInbox).toHaveBeenCalledTimes(1));
    await deliver('messages', { new: { id: 'm1' } });
    await waitFor(() => expect(mockApi.fetchInbox).toHaveBeenCalledTimes(2));
  });
});

describe('useUnreadMessages', () => {
  it('the count, refreshed by a new message; 0 when it cannot load', async () => {
    mockApi.fetchUnreadCount.mockResolvedValueOnce(3).mockResolvedValueOnce(4);
    const hook = await renderHook(() => useUnreadMessages());
    await waitFor(() => expect(hook.result.current).toBe(3));
    await deliver('messages', { new: { id: 'm1' } });
    await waitFor(() => expect(hook.result.current).toBe(4));

    mockApi.fetchUnreadCount.mockReset();
    mockApi.fetchUnreadCount.mockRejectedValue(new Error('x'));
    const other = await renderHook(() => useUnreadMessages());
    await act(() => Promise.resolve());
    expect(other.result.current).toBe(0);
  });
});
