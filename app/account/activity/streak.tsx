// The weekly streak and streak badges (match-record decision 1i), moved
// here from the old Profile tab by S8: image 19 has no place for it.
import { Stack } from 'expo-router';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StreakCard } from '@/components/stats/streak-card';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';

export default function StreakScreen() {
  const styles = useStyles();
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']} testID="streak-screen">
      <Stack.Screen options={{ title: 'Streak' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <StreakCard />
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.lg },
}));
