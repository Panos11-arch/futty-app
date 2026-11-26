// "Your venues" (Panos, 26 November): opened from Profile's row under This
// season. The caller's own venues only (my_venues).
import { Stack, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { VenuesList } from '@/components/match/venues-list';
import { space } from '@/constants/futty-theme';
import { useAuth } from '@/lib/auth';
import { useMyVenues } from '@/lib/match/use-profile-summary';
import { makeStyles } from '@/lib/theme';

/** Up to 20 venues. */
const VENUES = 20;

export default function MyVenuesScreen() {
  const styles = useStyles();
  const { user } = useAuth();
  const venues = useMyVenues(user?.id ?? null, VENUES);
  const { reload } = venues;
  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload])
  );
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']} testID="venues-screen">
      <Stack.Screen options={{ title: 'Your venues' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <VenuesList state={venues} onRetry={reload} />
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, gap: space.lg },
}));
