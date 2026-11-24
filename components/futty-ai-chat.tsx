import { useSegments } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { POPUP_HEADER_HEIGHT, PopupModal } from '@/components/popup-modal';
import { EmptyState } from '@/components/ui/empty-state';
import { DISABLED_OPACITY, ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { colors, hairline, radius, shadow, space, type } from '@/constants/futty-theme';
import { sendFuttyAiMessage, type ChatMessage } from '@/lib/futty-ai';
import { type Block, parseReply } from '@/lib/futty-ai-markdown';

// Approximate react-navigation bottom tab bar height — only mounted on the
// tab screens (app/(tabs)/*), which is when the launcher needs to sit above
// it rather than under it. There's no way to read the real height from here:
// this component lives in the root layout, a sibling of <Tabs>, not inside
// it, so useBottomTabBarHeight (which needs that inner context) isn't
// available.
const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 50 : 58;

/** Launcher size: a 56 pt round button. */
const LAUNCHER = MIN_TOUCH + space.md;

/** Screens where the launcher would cover Book, Pay or the booking sheet
 *  (F9), or a form's last button and its error (QA 24 November: Edit
 *  profile's "Save changes", the Booked screen's "Go to booking"): it's
 *  hidden there until the Futty AI redesign (S13A) moves it. */
export function hidesLauncher(segments: string[]): boolean {
  const [first, second] = segments;
  return (
    first === 'book' ||
    first === 'venue' ||
    first === 'booking' ||
    first === 'booking-payment' ||
    first === 'booking-after-pay' ||
    first === 'edit-profile' ||
    (first === 'account' && second === 'payments')
  );
}

/** The keyboard view's props: the body starts below the top safe area and
 *  the popup's header, so it needs that offset or the input bar ends up
 *  behind the keyboard (F9). Android resizes by height inside the Modal. */
export function chatKeyboardProps(os: typeof Platform.OS, insetTop: number) {
  return {
    behavior: os === 'ios' ? ('padding' as const) : ('height' as const),
    keyboardVerticalOffset: insetTop + POPUP_HEADER_HEIGHT,
  };
}

/** One reply: bold, bullet and numbered lists and line breaks, never a raw
 *  asterisk (lib/futty-ai-markdown.ts). */
function Reply({ text }: { text: string }) {
  const inline = (block: Block) =>
    block.inline.map((part, i) => (
      <Text key={i} variant="body" style={part.bold ? styles.bold : undefined}>
        {part.text}
      </Text>
    ));
  return (
    <View style={styles.reply}>
      {parseReply(text).map((block, i) =>
        block.kind === 'paragraph' ? (
          <Text key={i} variant="body">
            {inline(block)}
          </Text>
        ) : (
          <View key={i} style={styles.listRow} testID={block.kind === 'bullet' ? 'ai-bullet' : 'ai-numbered'}>
            <Text variant="body">{block.kind === 'bullet' ? '•' : `${block.number}.`}</Text>
            <Text variant="body" style={styles.flex}>
              {inline(block)}
            </Text>
          </View>
        )
      )}
    </View>
  );
}

export function FuttyAiChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const segments = useSegments();
  const scrollRef = useRef<ScrollView>(null);

  // Keep the last message in view when the keyboard opens (F9).
  useEffect(() => {
    if (!open) return;
    const sub = Keyboard.addListener('keyboardDidShow', () => scrollRef.current?.scrollToEnd({ animated: true }));
    return () => sub.remove();
  }, [open]);

  // Root layout renders this once for every screen, tabs and pushed screens
  // alike — only the tab screens have a bottom tab bar to clear.
  const onTabScreen = segments[0] === '(tabs)';

  function close() {
    setOpen(false);
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: text }];
    setMessages(nextMessages);
    setInput('');
    // Close the keyboard once a message is sent, so the reply is visible.
    Keyboard.dismiss();
    setBusy(true);
    setError(null);

    const { data, error: sendError } = await sendFuttyAiMessage(nextMessages);

    setBusy(false);

    if (sendError || !data?.reply) {
      setError("Couldn't reach Futty AI — try again in a moment.");
      return;
    }

    setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }]);
  }

  const sendDisabled = !input.trim() || busy;

  const showLauncher = !hidesLauncher(segments);

  return (
    <>
      {/* Fixed to the bottom-right corner, above the tab bar on tab screens —
          pointerEvents="box-none" on this wrapper is what lets touches pass
          through to whatever's behind it everywhere except the button itself. */}
      {showLauncher ? (
        <View
          pointerEvents="box-none"
          style={[
            styles.launcherWrap,
            { bottom: insets.bottom + (onTabScreen ? TAB_BAR_HEIGHT : 0) + space.lg },
          ]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open Futty AI"
            onPress={() => setOpen(true)}
            style={({ pressed }) => [styles.launcher, pressed && styles.launcherPressed]}>
            <IconSymbol name="bubble.left.fill" size={ICON.regular} color={colors.onBrand} />
          </Pressable>
        </View>
      ) : null}

      <PopupModal visible={open} onClose={close} title="Futty AI">
        <KeyboardAvoidingView style={styles.flex} {...chatKeyboardProps(Platform.OS, insets.top)}>
          <ScrollView
            ref={scrollRef}
            onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
            contentContainerStyle={styles.messages}
            keyboardShouldPersistTaps="handled"
            // Swiping down over the conversation also closes the keyboard.
            keyboardDismissMode="interactive">
            {messages.length === 0 ? (
              <EmptyState
                icon="bubble.left.fill"
                message="Ask me anything about Futty — booking a pitch, leagues, XP, Premium, and more."
              />
            ) : null}
            {messages.map((message, index) => {
              const mine = message.role === 'user';
              return (
                <View key={index} style={[styles.bubbleRow, mine && styles.bubbleRowMine]}>
                  <View
                    testID={mine ? 'bubble-mine' : 'bubble-theirs'}
                    style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                    {mine ? <Text variant="body">{message.content}</Text> : <Reply text={message.content} />}
                  </View>
                </View>
              );
            })}
            {busy ? (
              <View style={styles.bubbleRow}>
                <View style={[styles.bubble, styles.bubbleTheirs]}>
                  <ActivityIndicator accessibilityLabel="Futty AI is replying" color={colors.inkMuted} />
                </View>
              </View>
            ) : null}
          </ScrollView>

          {error ? (
            <Text variant="callout" tone="danger" accessibilityLiveRegion="polite" style={styles.error}>
              {error}
            </Text>
          ) : null}

          <View style={styles.inputRow}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Ask Futty AI…"
              placeholderTextColor={colors.inkMuted}
              accessibilityLabel="Message to Futty AI"
              style={styles.input}
              onSubmitEditing={send}
              returnKeyType="send"
              // With multiline on, Return used to add a new line instead of
              // sending (onSubmitEditing never fired). Now Return sends and
              // closes the keyboard; long messages still wrap.
              submitBehavior="blurAndSubmit"
              editable={!busy}
              multiline
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Send"
              accessibilityState={{ disabled: sendDisabled }}
              onPress={send}
              disabled={sendDisabled}
              style={[styles.sendButton, sendDisabled && styles.sendButtonDisabled]}>
              <IconSymbol name="paperplane.circle.fill" size={ICON.regular + space.sm} color={colors.brand} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </PopupModal>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  launcherWrap: {
    position: 'absolute',
    right: space.lg,
    // zIndex so the launcher always sits above scrollable screen content
    // instead of getting drawn under it on Android. Nothing beneath it is
    // raised either, and the one shadow comes from the theme (U8).
    zIndex: 50,
  },
  launcher: {
    width: LAUNCHER,
    height: LAUNCHER,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  launcherPressed: { opacity: 0.8 },
  messages: { padding: space.lg, gap: space.sm, flexGrow: 1 },
  bubbleRow: { flexDirection: 'row' },
  bubbleRowMine: { justifyContent: 'flex-end' },
  bubble: {
    maxWidth: '82%',
    borderRadius: radius.card,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  bubbleTheirs: { backgroundColor: colors.surface, borderWidth: hairline, borderColor: colors.border },
  bubbleMine: { backgroundColor: colors.brandSoft },
  reply: { gap: space.xs },
  listRow: { flexDirection: 'row', gap: space.xs },
  bold: { fontFamily: type.headline.fontFamily },
  error: { paddingHorizontal: space.lg, paddingBottom: space.xs },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    padding: space.md,
    borderTopWidth: hairline,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  input: {
    ...type.body,
    flex: 1,
    maxHeight: 100,
    minHeight: MIN_TOUCH,
    color: colors.ink,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  sendButton: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  sendButtonDisabled: { opacity: DISABLED_OPACITY },
});
