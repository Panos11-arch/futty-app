// "People you play with most" (match-record decision 1c.6): the signed-in
// player's own list. Opened from Profile's row under This season (Panos,
// 26 November); it was in the Account menu, so it isn't shown twice. The
// server (my_teammates) leaves out blocked players and adult/minor pairs and
// sends a minor's first name only.
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { TeammatesList } from '@/components/match/teammates-list';
import { space } from '@/constants/futty-theme';
import { useMyTeammates } from '@/lib/match/use-profile-matches';
import { makeStyles } from '@/lib/theme';

/** Up to 20 players. */
const TEAMMATES = 20;

export default function MyTeammatesScreen() {
  const styles = useStyles();
  const teammates = useMyTeammates(TEAMMATES);
  const { reload } = teammates;
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']} testID="teammates-screen">
      <Stack.Screen options={{ title: 'Teammates' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <TeammatesList state={teammates} onRetry={reload} />
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.lg },
}));
