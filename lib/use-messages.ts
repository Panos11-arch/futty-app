// S13: the inbox, the unread badge and one open chat, kept live with
// Supabase Realtime. Every rule is the server's; lib/messages.ts calls it.
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth';
import {
  describeMessageError,
  fetchConversationHeader,
  fetchInbox,
  fetchMessages,
  fetchUnreadCount,
  markConversationRead,
  markMessagesDelivered,
  mergeMessages,
  MESSAGE_PAGE_SIZE,
  newClientId,
  sendMessage,
  type ChatMessage,
  type ConversationHeader,
  type InboxRow,
  type ServerMessage,
} from '@/lib/messages';
import { useRealtimeChannelName } from '@/lib/realtime';
import { supabase } from '@/lib/supabase';

function errorText(error: unknown): string {
  return describeMessageError(error as { message?: string });
}

/** Calls `onInsert` whenever a message the player can read arrives (RLS
 *  limits the stream to their own conversations). */
function useNewMessages(prefix: string, onInsert: (row: Partial<ServerMessage> & { conversation_id?: string }) => void, filter?: string) {
  const channelName = useRealtimeChannelName(prefix);
  const latest = useRef(onInsert);
  latest.current = onInsert;
  useEffect(() => {
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', ...(filter ? { filter } : {}) },
        (payload: { new: Partial<ServerMessage> & { conversation_id?: string } }) => latest.current(payload.new)
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelName, filter]);
}

// ---- The badge ------------------------------------------------------------------

/** Unread messages across every chat: Account and Community show it. */
export function useUnreadMessages(): number {
  const userId = useAuth().user?.id;
  const [count, setCount] = useState(0);

  const reload = useCallback(() => {
    if (!userId) return;
    fetchUnreadCount()
      .then(setCount)
      .catch(() => {});
  }, [userId]);

  useFocusEffect(reload);
  useNewMessages('unread-count', reload);
  return count;
}

// ---- The inbox -------------------------------------------------------------------

export type InboxState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; rows: InboxRow[] };

export function useInbox() {
  const userId = useAuth().user?.id;
  const [state, setState] = useState<InboxState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const requestId = useRef(0);

  const load = useCallback(
    async (mode: 'first' | 'refresh' | 'quiet' = 'first') => {
      if (!userId) return;
      const id = ++requestId.current;
      if (mode === 'first') setState({ status: 'loading' });
      if (mode === 'refresh') setRefreshing(true);
      try {
        const rows = await fetchInbox();
        if (id !== requestId.current) return;
        setState({ status: 'ready', rows });
        // The app has them now: the senders see "delivered".
        void markMessagesDelivered();
      } catch (error) {
        if (id !== requestId.current) return;
        setState((prev) => (prev.status === 'ready' && mode !== 'first' ? prev : { status: 'error', message: errorText(error) }));
      } finally {
        if (id === requestId.current) setRefreshing(false);
      }
    },
    [userId]
  );

  // Back on the inbox: refetch without the skeleton once it has shown rows.
  const loaded = useRef(false);
  loaded.current = state.status === 'ready';
  useFocusEffect(
    useCallback(() => {
      void load(loaded.current ? 'quiet' : 'first');
    }, [load])
  );
  useNewMessages('inbox', () => void load('quiet'));

  return {
    state,
    refreshing,
    refresh: () => load('refresh'),
    retry: () => load('first'),
  };
}

// ---- One chat ----------------------------------------------------------------------

export type ChatState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; header: ConversationHeader; messages: ChatMessage[]; hasOlder: boolean };

export function useConversation(conversationId: string | undefined) {
  const userId = useAuth().user?.id;
  const [state, setState] = useState<ChatState>({ status: 'loading' });
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  /** Messages that arrived while the player was scrolled up. */
  const [unseen, setUnseen] = useState(0);
  const atBottom = useRef(true);
  const bodies = useRef(new Map<string, string>());

  const patch = useCallback((fn: (s: Extract<ChatState, { status: 'ready' }>) => Partial<Extract<ChatState, { status: 'ready' }>>) => {
    setState((prev) => (prev.status === 'ready' ? { ...prev, ...fn(prev) } : prev));
  }, []);

  const markRead = useCallback(() => {
    if (conversationId) void markConversationRead(conversationId);
  }, [conversationId]);

  const load = useCallback(async () => {
    if (!conversationId || !userId) return;
    setState({ status: 'loading' });
    try {
      const [header, page] = await Promise.all([fetchConversationHeader(conversationId), fetchMessages(conversationId)]);
      setState({ status: 'ready', header, messages: page, hasOlder: page.length === MESSAGE_PAGE_SIZE });
      markRead();
    } catch (error) {
      setState({ status: 'error', message: errorText(error) });
    }
  }, [conversationId, userId, markRead]);

  useEffect(() => {
    void load();
  }, [load]);

  const reloadHeader = useCallback(async () => {
    if (!conversationId) return;
    try {
      const header = await fetchConversationHeader(conversationId);
      patch(() => ({ header }));
    } catch {
      // The receipts stay as they were.
    }
  }, [conversationId, patch]);

  // New messages, live.
  useNewMessages(
    `chat-${conversationId ?? 'none'}`,
    (row) => {
      if (!row.id || !row.created_at || typeof row.body !== 'string') return;
      const mine = row.sender_id === userId;
      const message: ChatMessage = {
        id: row.id,
        sender_id: row.sender_id ?? null,
        sender_name: '',
        mine,
        body: row.body,
        client_id: mine ? (row.client_id ?? null) : null,
        created_at: row.created_at,
      };
      patch((s) => ({ messages: mergeMessages(s.messages, [message]) }));
      if (!mine) {
        if (atBottom.current) markRead();
        else setUnseen((n) => n + 1);
      }
    },
    conversationId ? `conversation_id=eq.${conversationId}` : undefined
  );

  // Read receipts, live.
  const receiptsChannel = useRealtimeChannelName(`receipts-${conversationId ?? 'none'}`);
  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(receiptsChannel)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversation_reads', filter: `conversation_id=eq.${conversationId}` },
        (payload: { new?: { profile_id?: string } }) => {
          if (payload.new?.profile_id !== userId) void reloadHeader();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, receiptsChannel, reloadHeader, userId]);

  const loadOlder = useCallback(async () => {
    if (!conversationId || loadingOlder || state.status !== 'ready' || !state.hasOlder) return;
    const oldest = [...state.messages].reverse().find((m) => !m.pending);
    if (!oldest) return;
    setLoadingOlder(true);
    try {
      const page = await fetchMessages(conversationId, oldest);
      patch((s) => ({ messages: mergeMessages(s.messages, page), hasOlder: page.length === MESSAGE_PAGE_SIZE }));
    } catch {
      // Scrolling up again tries again.
    } finally {
      setLoadingOlder(false);
    }
  }, [conversationId, loadingOlder, state, patch]);

  const deliver = useCallback(
    async (clientId: string) => {
      if (!conversationId) return false;
      const body = bodies.current.get(clientId);
      if (body === undefined) return false;
      const { data, error } = await sendMessage(conversationId, body, clientId);
      if (error || !data) {
        setSendError(errorText(error));
        patch((s) => ({
          messages: s.messages.map((m) => (m.client_id === clientId ? { ...m, pending: 'failed' as const } : m)),
        }));
        return false;
      }
      bodies.current.delete(clientId);
      const sent: ChatMessage = {
        id: data.id,
        sender_id: userId ?? null,
        sender_name: '',
        mine: true,
        body,
        client_id: clientId,
        created_at: data.created_at,
      };
      patch((s) => ({ messages: mergeMessages(s.messages, [sent]) }));
      return true;
    },
    [conversationId, patch, userId]
  );

  /** Optimistic: the bubble shows at once, then turns into the sent one. */
  const send = useCallback(
    async (body: string) => {
      if (state.status !== 'ready') return false;
      const clientId = newClientId();
      bodies.current.set(clientId, body);
      setSendError(null);
      const pending: ChatMessage = {
        id: clientId,
        sender_id: userId ?? null,
        sender_name: '',
        mine: true,
        body,
        client_id: clientId,
        created_at: new Date().toISOString(),
        pending: 'sending',
      };
      patch((s) => ({ messages: mergeMessages(s.messages, [pending]) }));
      return deliver(clientId);
    },
    [state.status, userId, patch, deliver]
  );

  /** Sends a failed message again, with the same client id (never doubled). */
  const retry = useCallback(
    async (clientId: string) => {
      setSendError(null);
      patch((s) => ({
        messages: s.messages.map((m) => (m.client_id === clientId ? { ...m, pending: 'sending' as const } : m)),
      }));
      return deliver(clientId);
    },
    [patch, deliver]
  );

  const setAtBottom = useCallback(
    (value: boolean) => {
      const wasAway = !atBottom.current;
      atBottom.current = value;
      if (value && wasAway) {
        setUnseen(0);
        markRead();
      }
    },
    [markRead]
  );

  return {
    state,
    loadingOlder,
    sendError,
    unseen,
    send,
    retry,
    loadOlder,
    setAtBottom,
    reload: load,
    reloadHeader,
  };
}
