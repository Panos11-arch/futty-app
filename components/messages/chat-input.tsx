import { useState, type ReactNode } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import { draftState, INPUT_MAX_LINES, MESSAGE_MAX_LENGTH } from '@/lib/messages';
import { makeStyles, useTheme } from '@/lib/theme';

export type ChatInputProps = {
  /** Sends the trimmed text; resolves false when it didn't go (the text stays). */
  onSend: (body: string) => Promise<boolean> | boolean;
  disabled?: boolean;
  placeholder?: string;
  /** Put the text back when the send fails (chats without a retry bubble). */
  keepOnFailure?: boolean;
  /** Left of the field (Futty AI: the attach button). */
  leading?: ReactNode;
  /** Above the bar (Futty AI: the photos about to be sent). */
  above?: ReactNode;
  /** Send with no text (Futty AI: photos alone). */
  canSendEmpty?: boolean;
};

/**
 * The growing input (up to five lines, then it scrolls) and a round send
 * button that appears once there is text. The draft clears as soon as the
 * message is on its way: a failed one stays in the list with a retry.
 */
export function ChatInput({
  onSend,
  disabled = false,
  placeholder = 'Message',
  keepOnFailure = false,
  leading,
  above,
  canSendEmpty = false,
}: ChatInputProps) {
  const styles = useStyles();
  const { colors, type } = useTheme();
  const [text, setText] = useState('');
  const draft = draftState(text);
  const canSend = draft.canSend || (canSendEmpty && draft.body === '');
  const maxHeight = type.body.lineHeight * INPUT_MAX_LINES + space.sm * 2;

  function send() {
    if (!canSend || disabled) return;
    haptic.tap();
    setText('');
    const sent = draft.body;
    void Promise.resolve(onSend(sent)).then((ok) => {
      if (ok) haptic.success();
      else if (keepOnFailure) setText((now) => (now === '' ? sent : now));
    });
  }

  return (
    <View style={styles.wrap}>
      {above}
      <View style={styles.bar}>
        {leading}
        <View style={styles.field}>
          <TextInput
            testID="chat-input"
            accessibilityLabel="Message"
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            placeholderTextColor={colors.muted}
            multiline
            editable={!disabled}
            maxLength={MESSAGE_MAX_LENGTH + 50}
            style={[styles.input, type.body, { color: colors.ink, maxHeight }]}
          />
          {draft.tooLong ? (
            <Text variant="caption" tone="danger" accessibilityLiveRegion="polite">
              {`Keep it to ${MESSAGE_MAX_LENGTH} characters or fewer.`}
            </Text>
          ) : null}
        </View>
        {canSend && !disabled ? (
          <Pressable
            testID="chat-send"
            accessibilityRole="button"
            accessibilityLabel="Send"
            onPress={send}
            style={({ pressed }) => [styles.send, pressed && styles.pressed]}>
            <IconSymbol name="paperplane.fill" size={ICON.small} color={colors.greenInk} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  wrap: {
    borderTopWidth: hairline,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  field: { flex: 1, gap: space.xs },
  input: {
    minHeight: MIN_TOUCH,
    paddingHorizontal: space.lg,
    paddingTop: space.sm + space.xs / 2,
    paddingBottom: space.sm + space.xs / 2,
    borderRadius: radius.sheet,
    borderWidth: hairline,
    borderColor: colors.border,
    backgroundColor: colors.canvas,
  },
  send: {
    width: MIN_TOUCH,
    height: MIN_TOUCH,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.8 },
}));
