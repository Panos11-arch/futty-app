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
import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { sendFuttyAiMessage, type ChatMessage } from '@/lib/futty-ai';

// Approximate react-navigation bottom tab bar height — only mounted on the
// tab screens (app/(tabs)/*), which is when the launcher needs to sit above
// it rather than under it. There's no way to read the real height from here:
// this component lives in the root layout, a sibling of <Tabs>, not inside
// it, so useBottomTabBarHeight (which needs that inner context) isn't
// available.
const TAB_BAR_HEIGHT = Platform.OS === 'ios' ? 50 : 58;

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

  return (
    <>
      {/* Fixed to the bottom-right corner, above the tab bar on tab screens —
          pointerEvents="box-none" on this wrapper is what lets touches pass
          through to whatever's behind it everywhere except the button itself. */}
      <View
        pointerEvents="box-none"
        style={[
          styles.launcherWrap,
          { bottom: insets.bottom + (onTabScreen ? TAB_BAR_HEIGHT : 0) + 16 },
        ]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open Futty AI"
          onPress={() => setOpen(true)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          style={({ pressed }) => [styles.launcher, pressed && styles.launcherPressed]}>
          <IconSymbol name="bubble.left.fill" size={24} color={FuttyColors.white} />
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
              <View style={styles.emptyRow}>
                <IconSymbol name="hand.wave.fill" size={14} color={FuttyColors.stone400} />
                <ThemedText style={styles.emptyNote}>
                  Ask me anything about Futty — booking a pitch, leagues, XP, Premium, and more.
                </ThemedText>
              </View>
            ) : null}
            {messages.map((message, index) => (
              <View
                key={index}
                style={[styles.bubbleRow, message.role === 'user' && styles.bubbleRowMine]}>
                <View style={[styles.bubble, message.role === 'user' ? styles.bubbleMine : styles.bubbleTheirs]}>
                  <ThemedText style={[styles.bubbleText, message.role === 'user' && styles.bubbleTextMine]}>
                    {message.content}
                  </ThemedText>
                </View>
              </View>
            ))}
            {busy ? <ActivityIndicator style={styles.loading} /> : null}
          </ScrollView>

          {error ? <ThemedText style={styles.errorText}>{error}</ThemedText> : null}

          <View style={styles.inputRow}>
            <TextInput
              value={input}
              onChangeText={setInput}
              placeholder="Ask Futty AI…"
              placeholderTextColor={FuttyColors.stone400}
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
              onPress={send}
              disabled={!input.trim() || busy}
              style={[styles.sendButton, (!input.trim() || busy) && styles.sendButtonDisabled]}>
              <IconSymbol name="paperplane.circle.fill" size={30} color={FuttyColors.emerald700} />
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </PopupModal>
    </>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  launcherWrap: {
    position: 'absolute',
    right: 16,
    // zIndex/elevation so the launcher always sits above scrollable screen
    // content instead of getting drawn under it on Android.
    zIndex: 50,
    elevation: 50,
  },
  launcher: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: FuttyColors.emerald950,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 6,
    elevation: 6,
  },
  launcherPressed: {
    opacity: 0.85,
  },
  messages: {
    padding: 16,
    gap: 10,
    flexGrow: 1,
  },
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    marginTop: 24,
    paddingHorizontal: 12,
  },
  emptyNote: {
    flex: 1,
    fontSize: 13,
    opacity: 0.6,
  },
  loading: {
    marginTop: 8,
  },
  bubbleRow: {
    flexDirection: 'row',
  },
  bubbleRowMine: {
    justifyContent: 'flex-end',
  },
  bubble: {
    maxWidth: '82%',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  bubbleTheirs: {
    backgroundColor: FuttyColors.white,
    borderWidth: 1,
    borderColor: FuttyColors.stone200,
    borderBottomLeftRadius: 4,
  },
  bubbleMine: {
    backgroundColor: FuttyColors.emerald950,
    borderBottomRightRadius: 4,
  },
  bubbleText: {
    fontFamily: FuttyFonts.sans,
    fontSize: 14,
    color: FuttyColors.stone700,
  },
  bubbleTextMine: {
    color: FuttyColors.white,
  },
  errorText: {
    color: FuttyColors.rose600,
    fontSize: 12,
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: FuttyColors.stone200,
  },
  input: {
    flex: 1,
    maxHeight: 100,
    fontSize: 15,
    fontFamily: FuttyFonts.sans,
    color: FuttyColors.stone700,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: FuttyColors.stone200,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  sendButton: {
    paddingBottom: 2,
  },
  sendButtonDisabled: {
    opacity: 0.4,
  },
});
