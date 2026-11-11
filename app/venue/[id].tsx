// A venue's page (docs/specs/15-design.md section 5). A venue that isn't
// live is hidden from players (spec 13): the server answers not found to
// everyone but its owner.
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Linking, Platform } from 'react-native';

import { Sheet } from '@/components/ui';
import { VenuePageView } from '@/components/venue/venue-page-view';
import { useVenuePage } from '@/lib/use-venue-page';
import { appleMapsUrl, googleMapsUrl } from '@/lib/venue-page';

export default function VenueScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { state, reload } = useVenuePage(id);
  const [choosingMaps, setChoosingMaps] = useState(false);
  const venue = state.status === 'ready' ? state.data.venue : null;

  const openDirections = () => {
    if (!venue) return;
    // Android has no Apple Maps: straight to Google Maps.
    if (Platform.OS === 'ios') setChoosingMaps(true);
    else Linking.openURL(googleMapsUrl(venue));
  };

  return (
    <>
      <Stack.Screen options={{ title: venue?.name ?? 'Venue' }} />
      <VenuePageView
        state={state}
        onRetry={reload}
        onDirections={openDirections}
        onBook={() => venue && router.push({ pathname: '/book', params: { venueId: venue.id } })}
      />
      <Sheet
        visible={choosingMaps}
        onClose={() => setChoosingMaps(false)}
        title="Directions"
        primaryAction={{
          label: 'Open in Apple Maps',
          onPress: () => {
            setChoosingMaps(false);
            if (venue) Linking.openURL(appleMapsUrl(venue));
          },
        }}
        secondaryAction={{ label: 'Open in Google Maps', onPress: () => venue && Linking.openURL(googleMapsUrl(venue)) }}
      />
    </>
  );
}
