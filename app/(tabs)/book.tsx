import { useFocusEffect, useNavigation } from 'expo-router';
import { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';

import { colors } from '@/constants/futty-theme';

type NavigationLike = {
  getParent: () => { navigate: (name: string) => void } | undefined;
};

/** Opens the booking wizard (app/book.tsx) as the root-stack screen it has
 *  always been. It's named, not linked: the URL /book now resolves to this
 *  tab, so a link would just land back here. */
export function openBookWizard(navigation: NavigationLike) {
  navigation.getParent()?.navigate('book');
}

// Not somewhere to return to: this tab, and the old routes that redirect.
const SKIP = new Set(['book', 'team', 'leagues', 'community']);

type TabsNavigation = NavigationLike & {
  getState: () => { history?: { type: string; key: string }[]; routes: { key: string; name: string }[] };
  navigate: (name: string) => void;
};

/**
 * The Book tab. Pressing it is intercepted in app/(tabs)/_layout.tsx, so this
 * screen only shows when something opens the URL /book (Home's Book button,
 * a booking_slot notification, a deep link). It hands straight over: back to
 * the tab you came from, with the wizard pushed on top, so closing the wizard
 * returns there just as before.
 */
export default function BookTab() {
  const navigation = useNavigation() as unknown as TabsNavigation;

  useFocusEffect(
    useCallback(() => {
      const state = navigation.getState();
      const routeName = (key: string) => state.routes.find((r) => r.key === key)?.name;
      const previous = (state.history ?? [])
        .filter((entry) => entry.type === 'route')
        .map((entry) => routeName(entry.key))
        .filter((name) => name && !SKIP.has(name))
        .pop();
      navigation.navigate(previous ?? 'index');
      openBookWizard(navigation);
    }, [navigation])
  );

  return <View style={styles.screen} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
});
