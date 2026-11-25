import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { FuttyLogo } from '@/components/ui/futty-logo';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';

export type AiChatHeaderProps = {
  /** "Started 20 Nov at 17:53"; none before the first message. */
  started: string | null;
  onBack: () => void;
};

/** On night: back, the Futty logo, "Futty AI" and when the chat started (Cyprus time). */
export function AiChatHeader({ started, onBack }: AiChatHeaderProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingTop: insets.top + space.sm }]} testID="ai-chat-header">
      <Pressable
        testID="ai-chat-back"
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={onBack}
        style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
        <IconSymbol name="chevron.left" size={ICON.regular} color={colors.onNight} />
      </Pressable>
      <FuttyLogo size={space.xxl} />
      <View style={styles.names} accessible accessibilityRole="header">
        <Text variant="headline" tone="onNight" numberOfLines={1}>
          Futty AI
        </Text>
        {started ? (
          <Text variant="caption" tone="onNightMuted" numberOfLines={1} testID="ai-chat-started">
            {started}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    paddingHorizontal: space.xs,
    paddingVertical: space.sm,
    backgroundColor: colors.night,
  },
  back: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'center', justifyContent: 'center' },
  names: { flex: 1 },
  pressed: { opacity: 0.7 },
}));
