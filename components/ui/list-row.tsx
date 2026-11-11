import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { Avatar } from '@/components/ui/avatar';
import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { colors, space } from '@/constants/futty-theme';

export type ListRowLeading = { icon: IconSymbolName } | { avatar: { name: string; photoUrl?: string | null } };

export type ListRowProps = {
  title: string;
  subtitle?: string;
  leading?: ListRowLeading;
  /** Accessory on the right, such as a StatusPill or an amount. */
  trailing?: ReactNode;
  chevron?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
};

export function ListRow({ title, subtitle, leading, trailing, chevron, onPress, accessibilityLabel, testID }: ListRowProps) {
  const content = (
    <>
      {leading && 'icon' in leading ? (
        <View testID="list-row-leading-icon">
          <IconSymbol name={leading.icon} size={ICON.regular} color={colors.inkMuted} />
        </View>
      ) : null}
      {leading && 'avatar' in leading ? <Avatar name={leading.avatar.name} photoUrl={leading.avatar.photoUrl} /> : null}
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
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
});
