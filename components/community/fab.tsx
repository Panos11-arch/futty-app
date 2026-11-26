import { Pressable } from 'react-native';

import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { radius, shadow, space } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';

/** The round + button (image 18), bottom right over the list. */
export function Fab({ onPress, accessibilityLabel }: { onPress: () => void; accessibilityLabel: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      testID="community-fab"
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.fab, pressed && styles.pressed]}>
      <IconSymbol name="plus" size={ICON.regular} color={colors.greenInk} />
    </Pressable>
  );
}

const SIZE = MIN_TOUCH + space.md;

const useStyles = makeStyles(({ colors }) => ({
  fab: {
    position: 'absolute',
    right: space.lg,
    bottom: space.lg,
    width: SIZE,
    height: SIZE,
    borderRadius: radius.pill,
    backgroundColor: colors.green,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  pressed: { opacity: 0.9 },
}));
