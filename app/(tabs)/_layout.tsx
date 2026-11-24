import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';

import { HapticTab } from '@/components/haptic-tab';
import { ICON } from '@/components/ui/foundation';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { hairline } from '@/constants/futty-theme';
import { useTheme } from '@/lib/theme';
import { tabAccessibilityLabel, VISIBLE_TABS } from '@/lib/navigation-a11y';

import { openBookWizard } from './book';

/** Each tab's screen-reader label counts only the tabs on the bar (QA 24
 *  November, bug 6). */
function tabLabel(name: (typeof VISIBLE_TABS)[number]['name']) {
  const index = VISIBLE_TABS.findIndex((t) => t.name === name);
  return tabAccessibilityLabel(VISIBLE_TABS[index].title, index, Platform.OS);
}

/** A hidden route: expo-router renders no tab button for it. */
const HIDDEN = { href: null } as const;

function tabIcon(name: IconSymbolName) {
  function TabIcon({ color }: { color: string }) {
    return <IconSymbol size={ICON.regular} name={name} color={color} />;
  }
  return TabIcon;
}

// Four tabs (docs/specs/15-design.md section 4). Team, Leagues and Community
// live inside Play now; their routes stay (hidden from the bar) and redirect
// to the matching Play segment so old links and notifications still work.
// Each tab's button has a testID for the Maestro tests (.maestro).
export default function TabLayout() {
  const { colors, type } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarActiveTintColor: colors.positive,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: type.caption,
        tabBarStyle: {
          backgroundColor: colors.tabBar,
          borderTopColor: colors.tabBarBorder,
          borderTopWidth: hairline,
        },
      }}>
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
        name="book"
        options={{
          title: 'Book',
          tabBarIcon: tabIcon('calendar'),
          tabBarButtonTestID: 'tab-book',
          tabBarAccessibilityLabel: tabLabel('book'),
        }}
        listeners={({ navigation }) => ({
          // Book opens the booking wizard as a pushed screen, as before, over
          // whichever tab you're on.
          tabPress: (event) => {
            event.preventDefault();
            openBookWizard(navigation);
          },
        })}
      />
      <Tabs.Screen
        name="play"
        options={{
          title: 'Play',
          tabBarIcon: tabIcon('sportscourt.fill'),
          tabBarButtonTestID: 'tab-play',
          tabBarAccessibilityLabel: tabLabel('play'),
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
      <Tabs.Screen name="team" options={HIDDEN} />
      <Tabs.Screen name="leagues" options={HIDDEN} />
      <Tabs.Screen name="community" options={HIDDEN} />
    </Tabs>
  );
}
