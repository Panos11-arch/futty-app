import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Fragment, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';

import { CardButton } from '@/components/navigation/card-button';
import { MyCardSheet } from '@/components/navigation/my-card-sheet';
import { ICON, MIN_TOUCH, TAB_BAR_HEIGHT } from '@/components/ui/foundation';
import { Text } from '@/components/ui/text';
import { hairline, radius, space } from '@/constants/futty-theme';
import { haptic } from '@/lib/haptics';
import { VISIBLE_TABS } from '@/lib/navigation-a11y';
import { makeStyles, useTheme } from '@/lib/theme';

/** The routes with a place on the bar, in order; the Card button sits before Rankings. */
const BAR_ROUTES: readonly string[] = VISIBLE_TABS.map((t) => t.name).filter((n) => n !== 'card');
const CARD_BEFORE = 'rankings';

/**
 * The tab bar (S2, spec 15 section 0.5): Home, Community, the Card button,
 * Rankings and Profile, fixed at the bottom of every tab. It sits below the
 * screens, never over them, so it never moves when a screen scrolls. The
 * selected tab sits in a soft green pill. Hidden routes (play, team,
 * leagues) never show.
 */
export function FuttyTabBar({ state, descriptors, navigation, insets }: BottomTabBarProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const [cardOpen, setCardOpen] = useState(false);
  const focusedKey = state.routes[state.index]?.key;

  const routes = BAR_ROUTES.map((name) => state.routes.find((r) => r.name === name)).filter(
    (r): r is (typeof state.routes)[number] => !!r,
  );

  function go(route: (typeof state.routes)[number]) {
    const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
    if (route.key !== focusedKey && !event.defaultPrevented) navigation.navigate(route.name, route.params);
  }

  return (
    <View testID="tab-bar" style={[styles.bar, { paddingBottom: insets.bottom }]}>
      <View testID="tab-bar-row" style={styles.row}>
        {routes.map((route) => {
          const { options } = descriptors[route.key];
          const selected = route.key === focusedKey;
          const ink = selected ? colors.tabSelectedInk : colors.muted;
          const title = options.title ?? route.name;
          const testID = options.tabBarButtonTestID;
          return (
            <Fragment key={route.key}>
              {route.name === CARD_BEFORE ? <CardButton onPress={() => setCardOpen(true)} /> : null}
              <Pressable
                testID={testID}
                accessibilityRole="button"
                accessibilityLabel={options.tabBarAccessibilityLabel ?? title}
                accessibilityState={{ selected }}
                onPressIn={() => {
                  // A soft tap on iOS, as the tabs have always had.
                  if (Platform.OS === 'ios') haptic.tap();
                }}
                onPress={() => go(route)}
                onLongPress={() => navigation.emit({ type: 'tabLongPress', target: route.key })}
                style={styles.item}>
                <View testID={testID ? `${testID}-pill` : undefined} style={[styles.pill, selected && styles.pillSelected]}>
                  {options.tabBarIcon?.({ focused: selected, color: ink, size: ICON.regular })}
                  <Text variant="caption" numberOfLines={1} style={[styles.label, { color: ink }]}>
                    {title}
                  </Text>
                </View>
              </Pressable>
            </Fragment>
          );
        })}
      </View>
      <MyCardSheet
        visible={cardOpen}
        onClose={() => setCardOpen(false)}
        onOpenProfile={() => {
          const profile = state.routes.find((r) => r.name === 'profile');
          if (profile) go(profile);
        }}
      />
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  bar: {
    backgroundColor: colors.tabBar,
    borderTopColor: colors.tabBarBorder,
    borderTopWidth: hairline,
  },
  row: {
    height: TAB_BAR_HEIGHT,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingHorizontal: space.xs,
  },
  item: {
    flex: 1,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pill: {
    alignItems: 'center',
    gap: space.xs / 2,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    borderRadius: radius.card,
  },
  pillSelected: { backgroundColor: colors.tabSelectedBg },
  label: { textAlign: 'center' },
}));
