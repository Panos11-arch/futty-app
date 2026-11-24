// A Book a pitch result (image 02; Playtomic 01, 02): the photo with the
// venue's name over it and a heart, then area · town, "from €X.XX per
// player" (the server's cheapest per-player price among the times shown),
// the amenities (up to 4 icons, S5A) and the free start times. The card opens the venue page; a
// time opens that slot (lib/booking-search openTimeSlot).
import { Image } from 'expo-image';
import { Pressable, View } from 'react-native';

import { Card, Chip, Text } from '@/components/ui';
import { DISABLED_OPACITY, ICON, MIN_TOUCH } from '@/components/ui/foundation';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { radius, space } from '@/constants/futty-theme';
import { slotChipLabel, type BookResult, type BookSlot } from '@/lib/booking-search';
import { formatEuros } from '@/lib/money/format';
import { makeStyles, useTheme } from '@/lib/theme';
import { AmenityIcons } from '@/components/venue/venue-extras';
import { AMENITIES } from '@/lib/venue-page';

export type VenueResultCardProps = {
  result: BookResult;
  /** Several days searched: each time shows its weekday. */
  severalDays: boolean;
  /** Booking is blocked (debt): the times show disabled and take no taps. */
  timesDisabled: boolean;
  onOpen: () => void;
  onTime: (slot: BookSlot) => void;
  onFavourite: (on: boolean) => void;
};

export function VenueResultCard({ result, severalDays, timesDisabled, onOpen, onTime, onFavourite }: VenueResultCardProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const id = result.venue_id;
  const place = [result.area, result.town].filter(Boolean).join(' · ');
  const price = result.from_player_cents === null ? null : `from ${formatEuros(result.from_player_cents)} per player`;

  return (
    <View testID={`free-venue-${id}`}>
      <Card
        testID={`free-venue-${id}-info`}
        padded={false}
        onPress={onOpen}
        accessibilityLabel={[result.name, place, price].filter(Boolean).join(', ')}>
        <View style={styles.top}>
          {result.photoUrl ? (
            <Image
              source={{ uri: result.photoUrl }}
              contentFit="cover"
              accessibilityLabel={`Photo of ${result.name}`}
              style={styles.fill}
            />
          ) : (
            <View testID="venue-result-panel" style={[styles.fill, styles.panel]} />
          )}
          <View style={styles.nameBand}>
            <Text variant="title" tone="onNight" numberOfLines={2}>
              {result.name}
            </Text>
          </View>
          <Pressable
            testID={`book-venue-${id}-heart`}
            accessibilityRole="button"
            accessibilityLabel={`${result.is_favourite ? 'Remove' : 'Save'} ${result.name}`}
            accessibilityState={{ selected: result.is_favourite }}
            onPress={() => onFavourite(!result.is_favourite)}
            style={styles.heart}>
            <IconSymbol name={result.is_favourite ? 'heart.fill' : 'heart'} size={ICON.regular} color={colors.onNight} />
          </Pressable>
        </View>
        <View style={styles.body}>
          <View style={styles.row}>
            <Text variant="callout" tone="inkMuted" style={styles.place}>
              {place}
            </Text>
            {price ? (
              <Text variant="headline" tabular>
                {price}
              </Text>
            ) : null}
          </View>
          {/* S5A: up to 4 amenity icons, food and drink first, then parking. */}
          <AmenityIcons
            testID={`free-venue-${id}-amenities`}
            amenities={result.amenities.filter((a) => a in AMENITIES).map((kind) => ({ kind }))}
            max={4}
          />
          {result.slots.length > 0 ? (
            <View
              testID={`free-venue-${id}-slot`}
              pointerEvents={timesDisabled ? 'none' : 'auto'}
              aria-disabled={timesDisabled}
              style={[styles.times, timesDisabled && styles.disabled]}>
              {result.slots.map((slot) => (
                <Chip
                  key={`${slot.day}-${slot.start}`}
                  testID={`book-venue-${id}-time-${slot.day}-${slot.start.replace(':', '')}`}
                  label={slotChipLabel(slot, severalDays)}
                  tabular
                  disabled={timesDisabled}
                  onPress={() => onTime(slot)}
                />
              ))}
            </View>
          ) : null}
        </View>
      </Card>
    </View>
  );
}

const useStyles = makeStyles(({ colors }) => ({
  top: {
    aspectRatio: 16 / 9,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  fill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  panel: { backgroundColor: colors.night },
  nameBand: { padding: space.lg, backgroundColor: colors.scrim },
  heart: {
    position: 'absolute',
    top: space.xs,
    right: space.xs,
    minWidth: MIN_TOUCH,
    minHeight: MIN_TOUCH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { padding: space.lg, gap: space.sm },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  place: { flex: 1 },
  times: { flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, paddingTop: space.xs },
  disabled: { opacity: DISABLED_OPACITY },
}));
