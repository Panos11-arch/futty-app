// Route tree for the navigation tests: the real tab layout (tab bar, Card
// button, header) and the old team/leagues redirects, with light stand-ins
// for the screens whose content isn't under test.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, Text, View } from 'react-native';

function RootLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}

/** Home's real "Book a pitch" button carries tab-book (S2), and Home scrolls. */
function Home() {
  return (
    <ScrollView testID="home-scroll">
      <Text>Home screen</Text>
      <Pressable testID="tab-book" accessibilityRole="button" onPress={() => router.push('/book')}>
        <Text>Book a pitch</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push('/leagues')}>
        <Text>Open leagues link</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push('/team')}>
        <Text>Open team link</Text>
      </Pressable>
      <Pressable accessibilityRole="button" onPress={() => router.push('/account')}>
        <Text>Open account link</Text>
      </Pressable>
      {Array.from({ length: 40 }, (_, i) => (
        <View key={i} style={{ height: 80 }} />
      ))}
    </ScrollView>
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

/** Account's real Play row carries tab-play (S2). */
function Account() {
  return (
    <View>
      <Text>Account screen</Text>
      <Pressable testID="tab-play" accessibilityRole="button" onPress={() => router.push('/play')}>
        <Text>Play</Text>
      </Pressable>
    </View>
  );
}

const Community = () => <Text>Community screen</Text>;
const Rankings = () => <Text>Rankings screen</Text>;
const Profile = () => <Text>Profile screen</Text>;
const Notifications = () => <Text>Notifications screen</Text>;

export function navigationRoutes() {
  return {
    _layout: { default: RootLayout, unstable_settings: { anchor: '(tabs)' } },
    '(tabs)/_layout': require('@/app/(tabs)/_layout'),
    '(tabs)/index': Home,
    '(tabs)/community': Community,
    '(tabs)/rankings': Rankings,
    '(tabs)/profile': Profile,
    '(tabs)/play': Play,
    '(tabs)/team': require('@/app/(tabs)/team'),
    '(tabs)/leagues': require('@/app/(tabs)/leagues'),
    book: BookWizard,
    'account/index': Account,
    notifications: Notifications,
  };
}
