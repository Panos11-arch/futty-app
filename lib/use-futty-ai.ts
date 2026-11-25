// S13A: my Futty AI chats, and one chat while it's open. Every message and
// answer is the server's (lib/futty-ai.ts); mine shows at once while it's
// on its way, and a failed one stays with "Try again".
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  aiErrorLine,
  fetchAiChat,
  fetchAiChats,
  NEW_CHAT,
  photoUrls,
  sendAiMessage,
  type AiChat,
  type AiMessage,
} from '@/lib/futty-ai';
import type { PickedPhoto } from '@/lib/futty-ai-photos';

const LOAD_ERROR = "Couldn't load your chats. Try again.";
const CHAT_LOAD_ERROR = "Couldn't load this chat. Try again.";
const GONE = 'This chat was deleted. Start a new chat.';

export type AiChatsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; chats: AiChat[] };

/** My chats, newest first, reloaded whenever the list comes back into view. */
export function useAiChats() {
  const [state, setState] = useState<AiChatsState>({ status: 'loading' });
  const [refreshing, setRefreshing] = useState(false);

  const reload = useCallback(async () => {
    try {
      setState({ status: 'ready', chats: await fetchAiChats() });
    } catch {
      setState((now) => (now.status === 'ready' ? now : { status: 'error', message: LOAD_ERROR }));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload])
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    await reload();
    setRefreshing(false);
  }, [reload]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    void reload();
  }, [reload]);

  return { state, refreshing, refresh, retry };
}

type Outgoing = { clientId: string; text: string; photos: PickedPhoto[] };

/** One chat ("new" until its first message), its photos' links, sending and retrying. */
export function useAiChat(routeId: string, onSaved?: (chatId: string) => void) {
  const [chatId, setChatId] = useState<string | null>(routeId === NEW_CHAT ? null : routeId);
  const [chat, setChat] = useState<AiChat | null>(null);
  const [messages, setMessages] = useState<AiMessage[] | null>(routeId === NEW_CHAT ? [] : null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const failed = useRef<Outgoing | null>(null);
  const counter = useRef(0);

  const addUrls = useCallback(async (list: AiMessage[]) => {
    const paths = list.flatMap((m) => m.photo_paths);
    if (paths.length === 0) return;
    try {
      const signed = await photoUrls(paths);
      setUrls((now) => ({ ...signed, ...now }));
    } catch {
      // The photo stays a placeholder; the text still shows.
    }
  }, []);

  const load = useCallback(async () => {
    if (routeId === NEW_CHAT) return;
    setLoadError(null);
    try {
      const result = await fetchAiChat(routeId);
      setChat(result.chat);
      setMessages(result.messages);
      void addUrls(result.messages);
    } catch (err) {
      setLoadError(err instanceof Error && err.message === 'chat_not_found' ? GONE : CHAT_LOAD_ERROR);
    }
  }, [routeId, addUrls]);

  useEffect(() => {
    void load();
  }, [load]);

  const deliver = useCallback(
    async (out: Outgoing) => {
      setBusy(true);
      setSendError(null);
      try {
        const result = await sendAiMessage({ chatId, text: out.text, photos: out.photos.map((p) => p.base64) });
        failed.current = null;
        // Just-sent photos show from the phone until their links load.
        const sentPhotos = result.messages.find((m) => m.role === 'user')?.photo_paths ?? [];
        setUrls((now) => {
          const next = { ...now };
          sentPhotos.forEach((path, i) => {
            if (out.photos[i]) next[path] = out.photos[i].uri;
          });
          return next;
        });
        setMessages((now) => [...(now ?? []).filter((m) => m.id !== out.clientId), ...result.messages]);
        if (!chatId) {
          setChatId(result.chat_id);
          onSaved?.(result.chat_id);
        }
        return true;
      } catch (err) {
        failed.current = out;
        setMessages((now) => (now ?? []).map((m) => (m.id === out.clientId ? { ...m, pending: 'failed' } : m)));
        setSendError(err instanceof Error && err.message ? err.message : aiErrorLine(null, null));
        return false;
      } finally {
        setBusy(false);
      }
    },
    [chatId, onSaved]
  );

  /** Sends a message and its photos; mine shows at once. */
  const send = useCallback(
    async (text: string, photos: PickedPhoto[] = []) => {
      if (busy) return false;
      const out: Outgoing = { clientId: `local-${++counter.current}`, text, photos };
      const mine: AiMessage = {
        id: out.clientId,
        role: 'user',
        body: text,
        actions: [],
        photo_paths: [],
        local_photos: photos.map((p) => p.uri),
        created_at: new Date().toISOString(),
        pending: 'sending',
      };
      // A failed message is replaced by the new one.
      setMessages((now) => [...(now ?? []).filter((m) => m.pending !== 'failed'), mine]);
      return deliver(out);
    },
    [busy, deliver]
  );

  /** "Try again": the failed message, as it was. */
  const retry = useCallback(() => {
    const out = failed.current;
    if (!out || busy) return;
    setMessages((now) => (now ?? []).map((m) => (m.id === out.clientId ? { ...m, pending: 'sending' } : m)));
    void deliver(out);
  }, [busy, deliver]);

  return { chatId, chat, messages, loadError, reload: load, busy, sendError, send, retry, urls, canRetry: !!failed.current };
}
