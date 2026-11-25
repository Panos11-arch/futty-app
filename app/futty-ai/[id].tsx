import { router, Stack, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useMemo, useState } from 'react';
import { Linking, View } from 'react-native';

import { AiAnswer, MyAiMessage } from '@/components/futty-ai/ai-bubbles';
import { AiChatHeader } from '@/components/futty-ai/ai-chat-header';
import { AttachButton, AttachmentStrip } from '@/components/futty-ai/attachments';
import { PhotoViewer } from '@/components/futty-ai/photo-viewer';
import { QuickReplies } from '@/components/futty-ai/quick-replies';
import { TypingIndicator } from '@/components/futty-ai/typing-indicator';
import { ChatView } from '@/components/messages/chat-view';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { space } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import {
  actionButtons,
  MAX_AI_PHOTOS,
  NEW_CHAT,
  sentLabel,
  startedLabel,
  supportMailto,
  type AiActionButton,
  type AiMessage,
} from '@/lib/futty-ai';
import { pickAiPhotos, type PickedPhoto } from '@/lib/futty-ai-photos';
import type { ChatMessage } from '@/lib/messages';
import { makeStyles } from '@/lib/theme';
import { useAiChat } from '@/lib/use-futty-ai';

const CAMERA_OFF = 'Camera access is off. Allow it in Settings.';

/** For S13's chat list: who sent it, newest first. */
function toChatMessages(messages: AiMessage[]): ChatMessage[] {
  return messages
    .map((m) => ({
      id: m.id,
      sender_id: m.role === 'user' ? 'me' : 'futty-ai',
      sender_name: m.role === 'user' ? 'You' : 'Futty AI',
      mine: m.role === 'user',
      body: m.body,
      client_id: null,
      created_at: m.created_at,
      pending: m.pending,
    }))
    .reverse();
}

/**
 * S13A: one Futty AI chat (S13's chat, restyled like a support chat). The
 * header on night, Futty AI's answers on the left with the logo, mine on the
 * right on green, up to 3 photos a message, quick replies on an empty chat,
 * and action buttons that open the screen an answer points to.
 */
export default function FuttyAiChatScreen() {
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const ai = useAiChat(id ?? NEW_CHAT);
  const [attachments, setAttachments] = useState<PickedPhoto[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());

  // "Sent · Just now" moves on to minutes, then the time.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const messages = ai.messages;
  const byId = useMemo(() => new Map((messages ?? []).map((m) => [m.id, m])), [messages]);
  const latestMine = useMemo(() => [...(messages ?? [])].reverse().find((m) => m.role === 'user')?.id ?? null, [messages]);
  const startedAt = ai.chat?.created_at ?? messages?.[0]?.created_at ?? null;
  const title = ai.chat?.title ?? messages?.find((m) => m.role === 'user')?.body ?? 'Futty AI';

  function onAction(action: AiActionButton) {
    haptic.tap();
    if (action.tag === 'contact_support') {
      void Linking.openURL(supportMailto(title, messages ?? [])).catch(() => {});
    } else if (action.href) {
      router.push(action.href);
    }
  }

  async function attach(source: 'camera' | 'library') {
    setAttachOpen(false);
    setAttachError(null);
    const picked = await pickAiPhotos(source, MAX_AI_PHOTOS - attachments.length).catch(() => []);
    if (picked === 'denied') {
      setAttachError(CAMERA_OFF);
      return;
    }
    setAttachments((now) => [...now, ...picked].slice(0, MAX_AI_PHOTOS));
  }

  function send(body: string) {
    const photos = attachments;
    setAttachments([]);
    setAttachError(null);
    return ai.send(body, photos);
  }

  function photosOf(m: AiMessage) {
    if (m.local_photos?.length) return m.local_photos.map((uri, i) => ({ key: `${m.id}-${i}`, uri }));
    return m.photo_paths.map((path) => ({ key: path, uri: ai.urls[path] ?? null }));
  }

  return (
    <View style={styles.screen}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" />
      <ChatView
        safeTop={false}
        header={<AiChatHeader started={startedAt ? startedLabel(startedAt) : null} onBack={() => router.back()} />}
        messages={messages ? toChatMessages(messages) : null}
        loadError={ai.loadError}
        onRetryLoad={() => void ai.reload()}
        onSend={send}
        sendError={attachError ?? ai.sendError}
        sendErrorAction={!attachError && ai.sendError && ai.canRetry ? { label: 'Try again', onPress: ai.retry } : null}
        placeholder="Type a message"
        empty={
          <QuickReplies
            disabled={ai.busy}
            onPick={(q) => {
              haptic.tap();
              void ai.send(q);
            }}
          />
        }
        typing={ai.busy ? <TypingIndicator /> : null}
        canSendEmpty={attachments.length > 0}
        inputLeading={<AttachButton onPress={() => setAttachOpen(true)} disabled={attachments.length >= MAX_AI_PHOTOS || ai.busy} />}
        inputAbove={
          <AttachmentStrip
            uris={attachments.map((p) => p.uri)}
            onRemove={(i) => setAttachments((now) => now.filter((_, j) => j !== i))}
          />
        }
        renderMessage={(item) => {
          const m = byId.get(item.message.id);
          if (!m) return <View />;
          return m.role === 'assistant' ? (
            <AiAnswer
              body={m.body}
              actions={actionButtons(m.actions)}
              showAvatar={item.lastInGroup}
              firstInGroup={item.firstInGroup}
              onAction={onAction}
            />
          ) : (
            <MyAiMessage
              body={m.body}
              photos={photosOf(m)}
              sent={m.id === latestMine && !m.pending ? sentLabel(m.created_at, now) : null}
              pending={m.pending}
              firstInGroup={item.firstInGroup}
              onOpenPhoto={setViewing}
            />
          );
        }}
      />

      <Sheet visible={attachOpen} onClose={() => setAttachOpen(false)} title="Add photos">
        <View style={styles.sheetRows}>
          <ListRow testID="ai-attach-camera" title="Take a photo" onPress={() => void attach('camera')} />
          <ListRow testID="ai-attach-library" title="Choose photos" onPress={() => void attach('library')} />
        </View>
      </Sheet>

      <PhotoViewer uri={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.night },
  sheetRows: { gap: space.xs },
}));
