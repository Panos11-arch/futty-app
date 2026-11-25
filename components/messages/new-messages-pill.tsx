import { Pressable } from 'react-native';

import { MIN_TOUCH } from '@/components/ui/foundation';
import { Text } from '@/components/ui/text';
import { radius, shadow, space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

/** Floats above the input while the player is scrolled up and new ones came in. */
export function NewMessagesPill({ count, onPress }: { count: number; onPress: () => void }) {
  const styles = useStyles();
  if (count <= 0) return null;
  const label = count === 1 ? '1 new message' : `${count} new messages`;
  return (
    <Pressable
      testID="chat-new-messages"
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.pill, pressed && styles.pressed]}>
      <Text variant="callout" tone="greenInk">
        {label}
      </Text>
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  pill: {
    ...shadow,
    position: 'absolute',
    bottom: space.md,
    alignSelf: 'center',
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
  },
  pressed: { opacity: 0.85 },
}));
