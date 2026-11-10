// Route tree for the navigation tests: the real tab layout, Book launcher and
// the old team/leagues/community routes, with light stand-ins for the
// screens whose content isn't under test.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

function Home() {
  return (
    <View>
      <Text>Home screen</Text>
      <Pressable accessibilityRole="button" onPress={() => router.push('/book')}>
        <Text>Open book link</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push('/leagues')}>
        <Text>Open leagues link</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push('/team')}>
        <Text>Open team link</Text>
      </Pressable>
    </View>
  );
}

function Play() {
  const { segment, teamId } = useLocalSearchParams<{ segment?: string; teamId?: string }>();
  return (
    <Text>
      Play segment {segment ?? 'none'} team {teamId ?? 'none'}
    </Text>
  );
}

function BookWizard() {
  return (
    <View>
      <Text>Book wizard</Text>
      <Pressable accessibilityRole="button" onPress={() => router.back()}>
        <Text>Close wizard</Text>
      </Pressable>
    </View>
  );
}

const Profile = () => <Text>Profile screen</Text>;

export function navigationRoutes() {
  return {
    _layout: { default: RootLayout, unstable_settings: { anchor: '(tabs)' } },
    '(tabs)/_layout': require('@/app/(tabs)/_layout'),
    '(tabs)/index': Home,
    '(tabs)/book': require('@/app/(tabs)/book'),
    '(tabs)/play': Play,
    '(tabs)/profile': Profile,
    '(tabs)/team': require('@/app/(tabs)/team'),
    '(tabs)/leagues': require('@/app/(tabs)/leagues'),
    '(tabs)/community': require('@/app/(tabs)/community'),
    book: BookWizard,
  };
}
