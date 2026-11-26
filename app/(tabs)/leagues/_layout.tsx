import { Stack } from 'expo-router';

/** S9: the Leagues screen and what it opens, inside the hidden leagues tab
 *  so the tab bar stays (images 12, 16, 17). Each screen draws its own
 *  night header. */
export default function LeaguesLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
