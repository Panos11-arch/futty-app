// The next booking on Home (docs/specs/15-design.md section 5).
//
// Contract 5 in docs/specs/06-coding.md: P5 rebuilds this file as the real
// NextBookingCard, keeping the export name and props below, so Home needs no
// change. This version is U3's placeholder. It shows the venue, the day and
// time in Cyprus time and the format. Who's in (AvatarStack) and who hasn't
// paid (StatusPill) come from booking_participants, which doesn't exist yet,
// so they are left out rather than faked. P5 loads them by booking.id.
import { Image } from 'expo-image';
import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { initials } from '@/components/ui/avatar';
import { Card } from '@/components/ui/card';
import { Text } from '@/components/ui/text';
import { colors, radius, space } from '@/constants/futty-theme';
import { cyprusWallTime } from '@/lib/calendar/cyprus-time';
import { formatKickoff, formatMatchDate } from '@/lib/match/format';
import type { MyBooking } from '@/lib/use-my-bookings';

export type NextBookingCardProps = {
  booking: Pick<MyBooking, 'id' | 'venue_id' | 'booking_day' | 'start_time' | 'end_time' | 'format'>;
  /** Null while venues load or when the venue isn't found. */
  venue: { name: string; city: string; photoUrl?: string | null } | null;
  onPress: () => void;
  /** Weather chip slot (P11). Nothing renders until one is passed in. */
  weather?: ReactNode;
  testID?: string;
};

/** "Sat 14 Nov · 19:00–20:00" in Cyprus time, whatever the phone's zone. */
export function bookingWhen(booking: Pick<MyBooking, 'booking_day' | 'start_time' | 'end_time'>): string {
  const start = cyprusWallTime(booking.booking_day, booking.start_time).toISOString();
  const end = cyprusWallTime(booking.booking_day, booking.end_time).toISOString();
  return `${formatMatchDate(start)} · ${formatKickoff(start)}–${formatKickoff(end)}`;
}

export function NextBookingCard({ booking, venue, onPress, weather, testID }: NextBookingCardProps) {
  const name = venue?.name ?? 'Booked venue';
  const when = bookingWhen(booking);

  return (
    <Card testID={testID} padded={false} onPress={onPress} accessibilityLabel={`Next game, ${name}, ${when}`}>
      {venue?.photoUrl ? (
        <Image source={{ uri: venue.photoUrl }} contentFit="cover" accessibilityLabel={`Photo of ${name}`} style={styles.photo} />
      ) : (
        <View testID="next-game-photo-placeholder" style={[styles.photo, styles.placeholder]}>
          <Text variant="display" tone="inkMuted">
            {initials(name)}
          </Text>
        </View>
      )}
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <View style={styles.titleText}>
            <Text variant="headline">{name}</Text>
            {venue?.city ? (
              <Text variant="callout" tone="inkMuted">
                {venue.city}
              </Text>
            ) : null}
          </View>
          {weather ? <View testID="next-game-weather">{weather}</View> : null}
        </View>
        <Text variant="body" tabular>
          {when}
        </Text>
        <Text variant="callout" tone="inkMuted">
          {booking.format}
        </Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  photo: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
  },
  placeholder: { backgroundColor: colors.canvas, alignItems: 'center', justifyContent: 'center' },
  body: { padding: space.lg, gap: space.xs },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
  titleText: { flex: 1, gap: space.xs },
});
