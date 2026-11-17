// The frame for a venue dashboard screen opened from the dashboard (P6d):
// its title, the canvas background, and the venue it's for (the `venueId`
// route param, if the signed-in owner owns it). The screen's own view gets
// the venue's id; the server checks staff again on every call.
import { Stack, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, SkeletonBlock } from '@/components/ui';
import { colors, space } from '@/constants/futty-theme';
import { useOwnedVenue } from '@/lib/venue-money';

export function VenueScreen({ title, children }: { title: string; children: (venueId: string) => ReactNode }) {
  const { venueId } = useLocalSearchParams<{ venueId?: string }>();
  const venue = useOwnedVenue(venueId);

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title }} />
      {venue === undefined ? (
        <View style={styles.loading}>
          <SkeletonBlock width="100%" height={space.xxl * 8} />
        </View>
      ) : null}
      {venue === null ? (
        <EmptyState icon="building.columns.fill" message="No venues are linked to your account yet. Ask Futty to link your venue." />
      ) : null}
      {venue ? children(venue.id) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  loading: { padding: space.lg },
});
