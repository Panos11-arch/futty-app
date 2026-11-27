// "Matchday 1 ▾": opens an OptionSheet.
import { Pressable } from 'react-native';

import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { radius, space, hairline } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';

export function DropdownButton({
  label,
  accessibilityLabel,
  onPress,
  testID,
  bordered = false,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  testID: string;
  bordered?: boolean;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.button, bordered && styles.bordered, pressed && styles.pressed]}>
      <Text variant="callout" tone="inkMuted" numberOfLines={1}>
        {label}
      </Text>
      <IconSymbol name="chevron.down" size={ICON.small} color={colors.muted} />
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  button: { minHeight: MIN_TOUCH, flexDirection: 'row', alignItems: 'center', gap: space.xs, alignSelf: 'flex-start' },
  bordered: {
    paddingHorizontal: space.md,
    borderWidth: hairline,
    borderColor: colors.border,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
  },
  pressed: { opacity: 0.7 },
}));
