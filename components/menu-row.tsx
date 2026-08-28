import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors } from '@/constants/futty-theme';

type IconName = ComponentProps<typeof IconSymbol>['name'];

/** One tappable row in the account menu hierarchy (app/account/*) — an
 *  icon, a label, and a chevron. Shared so every menu/section page looks
 *  and behaves the same rather than each screen rolling its own row. */
export function MenuRow({
  icon,
  label,
  sublabel,
  onPress,
  destructive,
  iconColor,
}: {
  icon: IconName;
  label: string;
  sublabel?: string;
  onPress: () => void;
  /** Red label/icon — used only for Log Out. */
  destructive?: boolean;
  iconColor?: string;
}) {
  const tint = destructive ? FuttyColors.rose600 : (iconColor ?? FuttyColors.emerald950);

  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={styles.row}>
      <View style={[styles.iconCircle, destructive && styles.iconCircleDestructive]}>
        <IconSymbol name={icon} size={16} color={tint} />
      </View>
      <View style={styles.textBlock}>
        <ThemedText style={[styles.label, destructive && { color: FuttyColors.rose600 }]}>{label}</ThemedText>
        {sublabel ? <ThemedText style={styles.sublabel}>{sublabel}</ThemedText> : null}
      </View>
      {!destructive ? <IconSymbol name="chevron.right" size={16} color={FuttyColors.stone400} /> : null}
    </Pressable>
  );
}

export function MenuSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      {title ? <ThemedText style={styles.sectionTitle}>{title}</ThemedText> : null}
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    gap: 8,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: FuttyColors.stone400,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginLeft: 4,
  },
  sectionCard: {
    backgroundColor: FuttyColors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: FuttyColors.stone200,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: FuttyColors.stone200,
  },
  iconCircle: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: FuttyColors.stone50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleDestructive: {
    backgroundColor: '#fee2e2',
  },
  textBlock: {
    flex: 1,
    gap: 1,
  },
  label: {
    fontSize: 14,
    fontWeight: '700',
    color: FuttyColors.emerald950,
  },
  sublabel: {
    fontSize: 12,
    color: FuttyColors.stone500,
  },
});
