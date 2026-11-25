import { Image } from 'expo-image';
import { Pressable, ScrollView, View } from 'react-native';

import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { hairline, radius, space } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';

const THUMB = space.xxl + space.lg;

/**
 * The attach button, left of the input. The icon map has no paperclip yet
 * (components/ui/icon-mapping.ts changes only in S16), so it shows the photo
 * icon; disabled once a message has its 3 photos.
 */
export function AttachButton({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      testID="ai-attach"
      accessibilityRole="button"
      accessibilityLabel="Attach photos"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.attach, (pressed || disabled) && styles.dim]}>
      <IconSymbol name="photo" size={ICON.regular} color={colors.ink} />
    </Pressable>
  );
}

/** The photos about to be sent, each with a remove button. */
export function AttachmentStrip({ uris, onRemove }: { uris: string[]; onRemove: (index: number) => void }) {
  const styles = useStyles();
  const { colors } = useTheme();
  if (uris.length === 0) return null;
  return (
    <ScrollView horizontal contentContainerStyle={styles.strip} testID="ai-attachments" keyboardShouldPersistTaps="handled">
      {uris.map((uri, i) => (
        <View key={`${uri}-${i}`} style={styles.item}>
          <Image source={{ uri }} contentFit="cover" style={styles.thumb} accessibilityLabel={`Photo ${i + 1}`} />
          <Pressable
            testID="ai-attachment-remove"
            accessibilityRole="button"
            accessibilityLabel={`Remove photo ${i + 1}`}
            hitSlop={space.sm}
            onPress={() => onRemove(i)}
            style={styles.remove}>
            <IconSymbol name="xmark" size={ICON.small} color={colors.ink} />
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  attach: { width: MIN_TOUCH, height: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  dim: { opacity: 0.5 },
  strip: { gap: space.sm, paddingHorizontal: space.md, paddingTop: space.sm },
  item: { flexDirection: 'row', alignItems: 'flex-start' },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.control, borderWidth: hairline, borderColor: colors.border },
  remove: {
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
