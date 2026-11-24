import type { ComponentProps, ReactNode } from 'react';
import { Children, Fragment } from 'react';
import { Pressable, View } from 'react-native';

import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SectionHeader } from '@/components/ui/section-header';
import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';

type IconName = ComponentProps<typeof IconSymbol>['name'];

/** One tappable row in the account menu hierarchy (app/account/*) — an
 *  icon, a label, and a chevron. Shared so every menu/section page looks
 *  and behaves the same rather than each screen rolling its own row.
 *  Grouped iOS-style list (docs/specs/15-design.md): monochrome icons, body
 *  text, chevron; destructive rows in danger. */
export function MenuRow({
  icon,
  label,
  sublabel,
  onPress,
  destructive,
  iconColor,
  testID,
}: {
  icon: IconName;
  label: string;
  sublabel?: string;
  onPress: () => void;
  /** Danger label/icon — used only for Log out. */
  destructive?: boolean;
  iconColor?: string;
  /** For the Maestro tests (.maestro). */
  testID?: string;
}) {
  const styles = useStyles();
  const { colors } = useTheme();
  const tint = destructive ? colors.danger : (iconColor ?? colors.inkMuted);

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={sublabel ? `${label}, ${sublabel}` : label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
      <IconSymbol name={icon} size={ICON.small} color={tint} />
      <View style={styles.textBlock}>
        <Text variant="body" tone={destructive ? 'danger' : 'ink'}>
          {label}
        </Text>
        {sublabel ? (
          <Text variant="callout" tone="inkMuted">
            {sublabel}
          </Text>
        ) : null}
      </View>
      {!destructive ? <IconSymbol name="chevron.right" size={ICON.small} color={colors.inkMuted} /> : null}
    </Pressable>
  );
}

/** A titled group of rows on one card, separated by inset hairlines. */
export function MenuSection({ title, children }: { title?: string; children: ReactNode }) {
  const styles = useStyles();
  const rows = Children.toArray(children).filter(Boolean);
  return (
    <View style={styles.section}>
      {title ? <SectionHeader title={title} /> : null}
      <View style={styles.sectionCard}>
        {rows.map((row, i) => (
          <Fragment key={i}>
            {i > 0 ? <View style={styles.divider} /> : null}
            {row}
          </Fragment>
        ))}
      </View>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  section: { gap: space.sm },
  sectionCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: hairline,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  row: {
    minHeight: MIN_TOUCH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
  },
  pressed: { backgroundColor: colors.canvas },
  textBlock: { flex: 1, gap: 2 },
  divider: { height: hairline, backgroundColor: colors.border, marginLeft: space.lg + ICON.small + space.md },
}));
