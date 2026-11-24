// The frame for a venue dashboard screen opened from the dashboard (P6d):
// its title with the venue's name, the canvas background, and the venue it's
// for (the `venueId` route param, only if the signed-in owner owns it; never
// another of their venues in its place). Signed out goes to sign-in. The
// screen's own view gets the venue's id; the server checks staff again on
// every call.
import { Redirect, Stack, useLocalSearchParams } from 'expo-router';
import type { ReactNode } from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Banner, EmptyState, SkeletonBlock } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { useOwnedVenue } from '@/lib/use-owned-venue';

export function VenueScreen({ title, children }: { title: string; children: (venueId: string) => ReactNode }) {
  const styles = useStyles();
  const { venueId } = useLocalSearchParams<{ venueId?: string }>();
  const { state, reload } = useOwnedVenue(venueId);

  if (state.status === 'signed_out') return <Redirect href="/sign-in" />;

  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <Stack.Screen options={{ title: state.status === 'ready' ? `${title} · ${state.venue.name}` : title }} />
      {state.status === 'loading' ? (
        <View style={styles.padded}>
          <SkeletonBlock width="100%" height={space.xxl * 8} />
        </View>
      ) : null}
      {state.status === 'not_found' ? (
        <EmptyState icon="building.columns.fill" message="This venue isn’t linked to your account." />
      ) : null}
      {state.status === 'error' ? (
        <View style={styles.padded}>
          <Banner tone="danger" message={state.message} action={{ label: 'Try again', onPress: reload }} />
        </View>
      ) : null}
      {state.status === 'ready' ? children(state.venue.id) : null}
    </SafeAreaView>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  screen: { flex: 1, backgroundColor: colors.canvas },
  padded: { padding: space.lg },
}));
