// S17: Book a pitch's "View map" (Playtomic 01): the search's venues as pins.
// A pin opens a mini card (name, place, price); its View venue opens the
// venue page. Venues without coordinates aren't on the map; with none at all, one
// line and a button back to the list.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';

import { Button, Card, Text } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import type { BookResult } from '@/lib/booking-search';
import { formatEuros } from '@/lib/money/format';
import { mapRegion, type Coordinates } from '@/lib/venue-location';
import { makeStyles } from '@/lib/theme';

export type VenuesMapProps = {
  results: BookResult[];
  coordinates: Record<string, Coordinates>;
  /** Each venue's "area · town", with its distance first when Around me is on. */
  placeLine: (result: BookResult) => string;
  onOpenVenue: (venueId: string) => void;
  onList: () => void;
};

export function VenuesMap({ results, coordinates, placeLine, onOpenVenue, onList }: VenuesMapProps) {
  const styles = useStyles();
  const [chosen, setChosen] = useState<string | null>(null);
  const pinned = results.filter((r) => coordinates[r.venue_id]);

  if (pinned.length === 0) {
    return (
      <View style={styles.empty}>
        <Text variant="headline">No venues on the map</Text>
        <Button testID="book-map-empty-list" label="View list" variant="secondary" onPress={onList} />
      </View>
    );
  }

  const card = pinned.find((r) => r.venue_id === chosen) ?? null;
  return (
    <View style={styles.screen}>
      <MapView
        testID="book-map"
        style={StyleSheet.absoluteFill}
        initialRegion={mapRegion(pinned.map((r) => coordinates[r.venue_id]))}
        onPress={() => setChosen(null)}>
        {pinned.map((r) => (
          <Marker
            key={r.venue_id}
            testID={`book-map-pin-${r.venue_id}`}
            coordinate={coordinates[r.venue_id]}
            title={r.name}
            onPress={() => setChosen(r.venue_id)}
          />
        ))}
      </MapView>
      {card ? (
        <View style={styles.cardWrap}>
          <Card testID="book-map-card">
            <View style={styles.card}>
              <Text variant="headline" numberOfLines={1}>
                {card.name}
              </Text>
              <Text variant="callout" tone="inkMuted" numberOfLines={1}>
                {placeLine(card)}
              </Text>
              {card.from_player_cents !== null ? (
                <Text variant="callout" tabular>{`from ${formatEuros(card.from_player_cents)} per player`}</Text>
              ) : null}
              <Button testID="book-map-card-open" label="View venue" size="compact" onPress={() => onOpenVenue(card.venue_id)} />
            </View>
          </Card>
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  screen: { flex: 1 },
  cardWrap: { position: 'absolute', left: space.lg, right: space.lg, bottom: space.xl },
  card: { gap: space.xs },
  empty: { alignItems: 'center', gap: space.md, paddingVertical: space.xxl },
}));
