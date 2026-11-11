import { Tabs } from 'expo-router';
import React from 'react';

import { HapticTab } from '@/components/haptic-tab';
import { ICON } from '@/components/ui/foundation';
import { IconSymbol, type IconSymbolName } from '@/components/ui/icon-symbol';
import { colors, hairline, type } from '@/constants/futty-theme';

import { openBookWizard } from './book';

function tabIcon(name: IconSymbolName) {
  function TabIcon({ color }: { color: string }) {
    return <IconSymbol size={ICON.regular} name={name} color={color} />;
  }
  return TabIcon;
}

// Four tabs (docs/specs/15-design.md section 4). Team, Leagues and Community
// live inside Play now; their routes stay (hidden from the bar) and redirect
// to the matching Play segment so old links and notifications still work.
export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarButton: HapticTab,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.inkMuted,
        tabBarLabelStyle: type.caption,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopColor: colors.border,
          borderTopWidth: hairline,
        },
      }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon('house.fill') }} />
      <Tabs.Screen
        name="book"
        options={{ title: 'Book', tabBarIcon: tabIcon('calendar') }}
        listeners={({ navigation }) => ({
          // Book opens the booking wizard as a pushed screen, as before, over
          // whichever tab you're on.
          tabPress: (event) => {
            event.preventDefault();
            openBookWizard(navigation);
          },
        })}
      />
      <Tabs.Screen name="play" options={{ title: 'Play', tabBarIcon: tabIcon('sportscourt.fill') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: tabIcon('person.fill') }} />
      <Tabs.Screen name="team" options={{ href: null }} />
      <Tabs.Screen name="leagues" options={{ href: null }} />
      <Tabs.Screen name="community" options={{ href: null }} />
    </Tabs>
  );
}
