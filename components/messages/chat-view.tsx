import { useRef, useState, type ReactElement, type ReactNode } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChatBubble } from '@/components/messages/chat-bubble';
import { ChatInput } from '@/components/messages/chat-input';
import { DatePill } from '@/components/messages/date-pill';
import { NewMessagesPill } from '@/components/messages/new-messages-pill';
import { Banner } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { ListRow } from '@/components/ui/list-row';
import { Sheet } from '@/components/ui/sheet';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { buildChatItems, type ChatItem, type ChatMessage, type Tick } from '@/lib/messages';
import { makeStyles, useTheme } from '@/lib/theme';

/** How far from the newest message still counts as "at the bottom". */
const AT_BOTTOM = space.xxl * 3;

export type ChatViewProps = {
  header: ReactNode;
  /** null while loading. Newest first. */
  messages: ChatMessage[] | null;
  /** Shown instead of the list when the chat couldn't load. */
  loadError?: string | null;
  onRetryLoad?: () => void;
  tickFor?: (message: ChatMessage) => Tick | null;
  onSend: (body: string) => Promise<boolean> | boolean;
  onRetrySend?: (clientId: string) => void;
  /** One line: why the last send failed. */
  sendError?: string | null;
  /** One line instead of the input: why the player can't write. */
  refusal?: string | null;
  refusalAction?: { label: string; onPress: () => void } | null;
  emptyLine?: string;
  /** Instead of the empty line (Futty AI: the quick replies). */
  empty?: ReactNode;
  /** Draws a message instead of the standard bubble (Futty AI). */
  renderMessage?: (item: Extract<ChatItem, { type: 'message' }>) => ReactElement;
  /** Below the newest message (Futty AI: the typing indicator). */
  typing?: ReactNode;
  /** A button after the send error ("Try again"). */
  sendErrorAction?: { label: string; onPress: () => void } | null;
  /** Passed to the input: left of the field, above the bar, send with no text. */
  inputLeading?: ReactNode;
  inputAbove?: ReactNode;
  canSendEmpty?: boolean;
  /** false: the header draws under the status bar itself (Futty AI's night header). */
  safeTop?: boolean;
  hasOlder?: boolean;
  loadingOlder?: boolean;
  onLoadOlder?: () => void;
  unseen?: number;
  onAtBottomChange?: (atBottom: boolean) => void;
  onCopy?: (message: ChatMessage) => void;
  onReport?: (message: ChatMessage) => void;
  placeholder?: string;
  keepOnFailure?: boolean;
};

/**
 * A WhatsApp-style chat: date pills, grouped bubbles with a tail on the
 * last of each run, paging upward, a "new messages" pill when scrolled up,
 * and an input that stays above the keyboard and the home indicator.
 */
export function ChatView({
  header,
  messages,
  loadError,
  onRetryLoad,
  tickFor,
  onSend,
  onRetrySend,
  sendError,
  refusal,
  refusalAction,
  emptyLine,
  empty,
  renderMessage,
  typing,
  sendErrorAction,
  inputLeading,
  inputAbove,
  canSendEmpty,
  safeTop = true,
  hasOlder = false,
  loadingOlder = false,
  onLoadOlder,
  unseen = 0,
  onAtBottomChange,
  onCopy,
  onReport,
  placeholder,
  keepOnFailure,
}: ChatViewProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const list = useRef<FlatList<ChatItem>>(null);
  const atBottom = useRef(true);
  const [selected, setSelected] = useState<ChatMessage | null>(null);
  const items = messages ? buildChatItems(messages) : [];

  function onScroll(e: NativeSyntheticEvent<NativeScrollEvent>) {
    // Inverted: offset 0 is the newest message.
    const now = e.nativeEvent.contentOffset.y < AT_BOTTOM;
    if (now !== atBottom.current) {
      atBottom.current = now;
      onAtBottomChange?.(now);
    }
  }

  function toBottom() {
    list.current?.scrollToOffset({ offset: 0, animated: true });
    atBottom.current = true;
    onAtBottomChange?.(true);
  }

  async function send(body: string) {
    toBottom();
    return onSend(body);
  }

  const actions = [
    onCopy ? { label: 'Copy', onPress: () => selected && onCopy(selected), testID: 'chat-action-copy' } : null,
    onReport ? { label: 'Report', onPress: () => selected && onReport(selected), testID: 'chat-action-report' } : null,
  ].filter(Boolean) as { label: string; onPress: () => void; testID: string }[];

  return (
    <SafeAreaView style={styles.screen} edges={safeTop ? ['top', 'bottom'] : ['bottom']}>
      {header}
      <KeyboardAvoidingView testID="chat-keyboard" style={styles.flex} behavior="padding">
        <View style={styles.flex}>
          {loadError ? (
            <View style={styles.centre}>
              <Banner tone="danger" message={loadError} action={onRetryLoad ? { label: 'Try again', onPress: onRetryLoad } : undefined} />
            </View>
          ) : !messages ? (
            <View testID="chat-skeleton" style={styles.skeleton}>
              <SkeletonBlock width="55%" height={space.xxl + space.lg} />
              <View style={styles.skeletonMine}>
                <SkeletonBlock width="45%" height={space.xxl + space.lg} />
              </View>
              <SkeletonBlock width="35%" height={space.xxl + space.lg} />
            </View>
          ) : messages.length === 0 ? (
            <View style={styles.centre}>
              {empty ?? (
                <Text variant="callout" tone="inkMuted" testID="chat-empty">
                  {emptyLine}
                </Text>
              )}
            </View>
          ) : (
            <FlatList
              ref={list}
              testID="chat-list"
              inverted
              data={items}
              keyExtractor={(item) => item.key}
              renderItem={({ item }) =>
                item.type === 'date' ? (
                  <DatePill label={item.label} />
                ) : renderMessage ? (
                  renderMessage(item)
                ) : (
                  <ChatBubble
                    body={item.message.body}
                    createdAt={item.message.created_at}
                    mine={item.message.mine}
                    tick={item.message.mine ? (tickFor?.(item.message) ?? null) : null}
                    firstInGroup={item.firstInGroup}
                    lastInGroup={item.lastInGroup}
                    onLongPress={actions.length > 0 && !item.message.pending ? () => setSelected(item.message) : undefined}
                    onRetry={
                      item.message.pending === 'failed' && item.message.client_id && onRetrySend
                        ? () => onRetrySend(item.message.client_id as string)
                        : undefined
                    }
                  />
                )
              }
              onScroll={onScroll}
              scrollEventThrottle={64}
              onEndReached={hasOlder ? onLoadOlder : undefined}
              onEndReachedThreshold={0.3}
              // Inverted: the header sits below the newest message.
              ListHeaderComponent={typing ? <>{typing}</> : null}
              ListFooterComponent={
                loadingOlder ? (
                  <ActivityIndicator testID="chat-loading-older" color={colors.muted} style={styles.older} />
                ) : null
              }
              contentContainerStyle={styles.listContent}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="interactive"
              maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
            />
          )}
          <NewMessagesPill count={unseen} onPress={toBottom} />
        </View>

        {sendError ? (
          <View style={styles.errorRow}>
            <Text
              variant="callout"
              tone="danger"
              style={[styles.line, styles.flex]}
              accessibilityLiveRegion="polite"
              testID="chat-send-error">
              {sendError}
            </Text>
            {sendErrorAction ? (
              <Button
                testID="chat-send-retry"
                label={sendErrorAction.label}
                variant="plain"
                size="compact"
                onPress={sendErrorAction.onPress}
              />
            ) : null}
          </View>
        ) : null}
        {refusal ? (
          <View style={styles.refusal} testID="chat-refusal">
            <Text variant="callout" tone="inkMuted" style={styles.flex}>
              {refusal}
            </Text>
            {refusalAction ? (
              <Button
                testID="chat-refusal-action"
                label={refusalAction.label}
                variant="plain"
                size="compact"
                onPress={refusalAction.onPress}
              />
            ) : null}
          </View>
        ) : (
          <ChatInput
            onSend={send}
            disabled={!!loadError || !messages}
            placeholder={placeholder}
            keepOnFailure={keepOnFailure}
            leading={inputLeading}
            above={inputAbove}
            canSendEmpty={canSendEmpty}
          />
        )}
      </KeyboardAvoidingView>

      <Sheet visible={!!selected} onClose={() => setSelected(null)} title="Message">
        <View style={styles.sheetActions}>
          {actions.map((a) => (
            <ListRow
              key={a.label}
              testID={a.testID}
              title={a.label}
              onPress={() => {
                a.onPress();
                setSelected(null);
              }}
            />
          ))}
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  flex: { flex: 1 },
  centre: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.lg },
  skeleton: { flex: 1, justifyContent: 'flex-end', gap: space.sm, padding: space.md },
  skeletonMine: { flexDirection: 'row', justifyContent: 'flex-end' },
  listContent: { paddingVertical: space.sm },
  older: { paddingVertical: space.md },
  line: { paddingHorizontal: space.lg, paddingVertical: space.xs },
  errorRow: { flexDirection: 'row', alignItems: 'center', paddingRight: space.md },
  refusal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    minHeight: space.xxl + space.lg,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.surface,
  },
  sheetActions: { gap: space.xs },
}));
