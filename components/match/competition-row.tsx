import { Pressable, View } from 'react-native';

import { CompetitionBadge } from '@/components/match/night-header';
import { ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { hairline, space } from '@/constants/futty-theme';
import { makeStyles, useTheme } from '@/lib/theme';

/** "Pin" or "Pinned" at the end of a competition row (image 12). */
export function PinButton({ name, pinned, onPress, testID }: { name: string; pinned: boolean; onPress: () => void; testID?: string }) {
  const styles = useStyles();
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={pinned ? `Unpin ${name}` : `Pin ${name}`}
      accessibilityState={{ selected: pinned }}
      hitSlop={space.sm}
      onPress={onPress}
      style={({ pressed }) => [styles.pin, pressed && styles.pressed]}>
      <Text variant="body" tone={pinned ? 'ink' : 'inkMuted'}>
        {pinned ? 'Pinned' : 'Pin'}
      </Text>
    </Pressable>
  );
}

export type CompetitionRowProps = {
  title: string;
  subtitle: string;
  /** Group rows (a city, the Cyprus Open League) have a badge; format rows sit indented. */
  badge?: string;
  /** A group row opens and closes; a format row opens the competition. */
  expanded?: boolean;
  /** name: what the Pin button says it pins ("Pin Limassol 5-a-side League"). */
  pin?: { pinned: boolean; name: string; onPress: () => void; testID?: string };
  onPress: () => void;
  testID?: string;
};

/** One row on the LEAGUES tab: a group (badge, chevron) or a competition
 *  (indented, Pin or Pinned). */
export function CompetitionRow({ title, subtitle, badge, expanded, pin, onPress, testID }: CompetitionRowProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const isGroup = expanded !== undefined;
  return (
    <View style={[styles.row, !badge && styles.child]}>
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={`${title}, ${subtitle}`}
        accessibilityState={isGroup ? { expanded } : undefined}
        onPress={onPress}
        style={({ pressed }) => [styles.main, !badge && styles.indent, pressed && styles.pressed]}>
        {badge ? <CompetitionBadge label={badge} /> : null}
        <View style={styles.texts}>
          <Text variant="headline" numberOfLines={2}>
            {title}
          </Text>
          <Text variant="callout" tone="inkMuted" numberOfLines={2}>
            {subtitle}
          </Text>
        </View>
        {isGroup ? (
          <View style={expanded ? styles.chevronUp : undefined}>
            <IconSymbol name="chevron.down" size={ICON.regular} color={colors.inkMuted} />
          </View>
        ) : null}
      </Pressable>
      {pin ? <PinButton name={pin.name} pinned={pin.pinned} onPress={pin.onPress} testID={pin.testID} /> : null}
    </View>
  );
}

/** "PINNED (1)" or "ALL" above a block of rows. */
export function DirectoryLabel({ label, expanded, onPress, testID }: { label: string; expanded?: boolean; onPress?: () => void; testID?: string }) {
  const styles = useStyles();
  const { colors } = useTheme();
  const text = (
    <Text variant="callout" tone="inkMuted" accessibilityRole="header">
      {label.toUpperCase()}
    </Text>
  );
  if (!onPress) return <View style={styles.label}>{text}</View>;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ expanded }}
      onPress={onPress}
      style={[styles.label, styles.labelRow]}>
      {text}
      <View style={expanded ? styles.chevronUp : undefined}>
        <IconSymbol name="chevron.down" size={ICON.small} color={colors.inkMuted} />
      </View>
    </Pressable>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderBottomWidth: hairline,
    borderBottomColor: colors.border,
    paddingRight: space.lg,
  },
  child: { backgroundColor: colors.fill },
  main: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.lg,
    minHeight: MIN_TOUCH,
    paddingVertical: space.lg,
    paddingLeft: space.lg,
  },
  indent: { paddingLeft: space.xxl + space.md },
  texts: { flex: 1, gap: space.xs / 2 },
  chevronUp: { transform: [{ rotate: '180deg' }] },
  pin: { minWidth: MIN_TOUCH, minHeight: MIN_TOUCH, alignItems: 'flex-end', justifyContent: 'center' },
  pressed: { opacity: 0.7 },
  label: { paddingHorizontal: space.lg, paddingTop: space.xl, paddingBottom: space.md },
  labelRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: MIN_TOUCH },
}));
