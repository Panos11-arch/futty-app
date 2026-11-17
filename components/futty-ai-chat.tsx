import { useSegments } from 'expo-router';
import { useState } from 'react';
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

import { PopupModal } from '@/components/popup-modal';
import { EmptyState } from '@/components/ui/empty-state';
import { DISABLED_OPACITY, ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { colors, hairline, radius, shadow, space, type } from '@/constants/futty-theme';
import { sendFuttyAiMessage, type ChatMessage } from '@/lib/futty-ai';

// Approximate react-navigation bottom tab bar height — only mounted on the
// tab screens (app/(tabs)/*), which is when the launcher needs to sit above
// it rather than under it. There's no way to read the real height from here:
// this component lives in the root layout, a sibling of <Tabs>, not inside
// it, so useBottomTabBarHeight (which needs that inner context) isn't
// available.
const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 50 : 58;

/** Launcher size: a 56 pt round button. */
const LAUNCHER = MIN_TOUCH + space.md;

export function FuttyAiChat() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const insets = useSafeAreaInsets();
  const segments = useSegments();

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

  return (
    <>
      {/* Fixed to the bottom-right corner, above the tab bar on tab screens —
          pointerEvents="box-none" on this wrapper is what lets touches pass
          through to whatever's behind it everywhere except the button itself. */}
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

      <PopupModal visible={open} onClose={close} title="Futty AI">
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView
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
                    <Text variant="body">{message.content}</Text>
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
    // zIndex/elevation so the launcher always sits above scrollable screen
    // content instead of getting drawn under it on Android.
    zIndex: 50,
    elevation: 50,
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
