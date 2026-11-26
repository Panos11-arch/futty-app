// Home's four quick actions (image 01; Playtomic's home): big round buttons
// with a label under each. Nothing that loads sits above them, so they never
// move under a finger. "Join an event" opens Leagues until S10B builds the
// events list.
import { type Href, router } from 'expo-router';
import { Pressable, View } from 'react-native';

import { MIN_TOUCH } from '@/components/ui/foundation';
import type { IconSymbolName } from '@/components/ui/icon-mapping';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { Text } from '@/components/ui/text';
import { space } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import { makeStyles, useTheme } from '@/lib/theme';

export type QuickAction = { label: string; icon: IconSymbolName; href: Href; testID: string };

export const QUICK_ACTIONS: QuickAction[] = [
  // tab-book is kept from before S2 (Maestro: .maestro/subflows/open-tab.yaml).
  { label: 'Book a pitch', icon: 'calendar', href: '/book', testID: 'tab-book' },
  { label: 'Find a match', icon: 'soccerball', href: { pathname: '/squads', params: { view: 'players' } }, testID: 'home-action-find-match' },
  { label: 'Leagues', icon: 'trophy.fill', href: '/leagues', testID: 'home-action-leagues' },
  // S10B: the events list replaces Leagues here.
  { label: 'Join an event', icon: 'flag.fill', href: '/leagues', testID: 'home-action-event' },
];

export function QuickActions() {
  const styles = useStyles();
  const { colors } = useTheme();
  return (
    <View style={styles.row}>
      {QUICK_ACTIONS.map((action) => (
        <Pressable
          key={action.testID}
          testID={action.testID}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={() => {
            haptic.tap();
            router.push(action.href);
          }}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <View style={styles.circle}>
            <IconSymbol name={action.icon} size={space.xl + space.xs} color={colors.green} />
          </View>
          <Text variant="caption" style={styles.label} numberOfLines={2}>
            {action.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: space.sm },
  action: { flex: 1, alignItems: 'center', gap: space.sm, minHeight: MIN_TOUCH },
  pressed: { opacity: 0.7 },
  circle: {
    width: space.xxl * 2,
    height: space.xxl * 2,
    borderRadius: space.xxl,
    backgroundColor: colors.night,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { textAlign: 'center' },
}));
