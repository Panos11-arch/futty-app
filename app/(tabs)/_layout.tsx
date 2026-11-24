import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';

import { AppHeader } from '@/components/navigation/app-header';
import { FuttyTabBar } from '@/components/navigation/futty-tab-bar';
import { ICON } from '@/components/ui/foundation';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { type BarItemName, tabAccessibilityLabel, VISIBLE_TABS } from '@/lib/navigation-a11y';

/** Each tab's screen-reader label counts only the items on the bar (QA 24
 *  November, bug 6). */
function tabLabel(name: BarItemName) {
  const index = VISIBLE_TABS.findIndex((t) => t.name === name);
  return tabAccessibilityLabel(VISIBLE_TABS[index].title, index, Platform.OS);
}

/** A hidden route: no place on the bar, no header (it redirects). */
const HIDDEN = { href: null, headerShown: false } as const;

function tabIcon(name: IconSymbolName) {
  function TabIcon({ color }: { color: string }) {
    return <IconSymbol size={ICON.regular} name={name} color={color} />;
  }
  return TabIcon;
}

// S2 (docs/specs/15-design.md section 0.5): Home, Community, the Card button,
// Rankings and Profile, with the fixed header (wordmark or tab name, bell,
// menu). Book and Play are no longer tabs: /book opens the booking wizard
// (app/book.tsx) and Play stays as a hidden route, opened from Account →
// Play, until S6–S9 move its segments. /team and /leagues still redirect to
// Play so old links and notifications work. Each tab's button has a testID
// for the Maestro tests (.maestro).
export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <FuttyTabBar {...props} />}
      screenOptions={({ route }) => ({
        headerShown: true,
        header: ({ options }) => <AppHeader title={options.title ?? route.name} home={route.name === 'index'} />,
      })}>
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: tabIcon('house.fill'),
          tabBarButtonTestID: 'tab-home',
          tabBarAccessibilityLabel: tabLabel('index'),
        }}
      />
      <Tabs.Screen
        name="community"
        options={{
          title: 'Community',
          tabBarIcon: tabIcon('person.2.fill'),
          tabBarButtonTestID: 'tab-community',
          tabBarAccessibilityLabel: tabLabel('community'),
        }}
      />
      <Tabs.Screen
        name="rankings"
        options={{
          title: 'Rankings',
          tabBarIcon: tabIcon('trophy.fill'),
          tabBarButtonTestID: 'tab-rankings',
          tabBarAccessibilityLabel: tabLabel('rankings'),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: tabIcon('person.fill'),
          tabBarButtonTestID: 'tab-profile',
          tabBarAccessibilityLabel: tabLabel('profile'),
        }}
      />
      <Tabs.Screen name="play" options={{ href: null, title: 'Play' }} />
      <Tabs.Screen name="team" options={HIDDEN} />
      <Tabs.Screen name="leagues" options={HIDDEN} />
    </Tabs>
  );
}
