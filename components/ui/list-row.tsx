import type { ReactNode } from 'react';
import { Pressable, View, type AccessibilityRole, type AccessibilityState } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';
import type { AvatarLook } from '@/lib/avatar';

export type ListRowLeading =
  | { icon: IconSymbolName }
  | { avatar: { name: string; photoUrl?: string | null; kit?: AvatarLook | null } };

export type ListRowProps = {
  title: string;
  subtitle?: string;
  leading?: ListRowLeading;
  /** Accessory on the right, such as a StatusPill or an amount. */
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  /** e.g. "radio" for one choice of several; defaults to "button" when pressable. */
  accessibilityRole?: AccessibilityRole;
  accessibilityState?: AccessibilityState;
  testID?: string;
};

export function ListRow({
  title,
  subtitle,
  leading,
  trailing,
  chevron,
  onPress,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityState,
  testID,
}: ListRowProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const content = (
    <>
      {leading && 'icon' in leading ? (
        <View testID="list-row-leading-icon">
          <IconSymbol name={leading.icon} size={ICON.regular} color={colors.inkMuted} />
        </View>
      ) : null}
      {leading && 'avatar' in leading ? <Avatar name={leading.avatar.name} photoUrl={leading.avatar.photoUrl} kit={leading.avatar.kit} /> : null}
      <View style={styles.text}>
        <Text variant="body">{title}</Text>
        {subtitle ? (
          <Text variant="callout" tone="inkMuted">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
      {chevron ? (
        <View testID="list-row-chevron">
          <IconSymbol name="chevron.right" size={ICON.small} color={colors.inkMuted} />
        </View>
      ) : null}
    </>
  );

  if (!onPress) {
    return (
      <View testID={testID} style={styles.row}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      accessibilityRole={accessibilityRole}
      accessibilityState={accessibilityState}
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  row: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    backgroundColor: colors.surface,
  },
  text: { flex: 1, gap: 2 },
  pressed: { backgroundColor: colors.canvas },
}));
