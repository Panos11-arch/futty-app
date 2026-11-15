// The next booking on Home (docs/specs/15-design.md section 5): venue photo,
// day and time in Cyprus time, format, who's in and who hasn't paid, and a
// weather chip slot.
//
// Contract 5 in docs/specs/06-coding.md: P5 rebuilt U3's placeholder here,
// keeping the export names and props, so Home needs no change. Who's in and
// who hasn't paid come from booking_detail(booking.id): names and paid state
// only, never amounts. If that can't load, the card shows without them.
// Tapping opens the booking's detail (/booking/{id}) unless the caller passes
// its own onPress.
import { Image } from 'expo-image';
import { router } from 'expo-router';
import { useCallback, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { initials } from '@/components/ui/avatar';
import { AvatarStack } from '@/components/ui/avatar-stack';
import { Card } from '@/components/ui/card';
import { StatusPill } from '@/components/ui/status-pill';
import { Text } from '@/components/ui/text';
import { colors, radius, space } from '@/constants/futty-theme';
import { openBookingDetail } from '@/lib/booking-navigation';
import { fetchBookingRoster, rosterName, useLoad, whoHasntPaid } from '@/lib/booking-search';
import { cyprusWallTime } from '@/lib/calendar/cyprus-time';
import { formatKickoff, formatMatchDate } from '@/lib/match/format';
import type { MyBooking } from '@/lib/use-my-bookings';

export type NextBookingCardProps = {
  booking: Pick<MyBooking, 'id' | 'venue_id' | 'booking_day' | 'start_time' | 'end_time' | 'format'>;
  /** Null while venues load or when the venue isn't found. */
  venue: { name: string; city: string; photoUrl?: string | null } | null;
  /** What a tap does. Without it, the booking's detail opens. */
  onPress?: () => void;
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
  const loadRoster = useCallback(() => fetchBookingRoster(booking.id), [booking.id]);
  const roster = useLoad(booking.id, loadRoster);
  const players = roster.state.status === 'ready' ? roster.state.data : [];
  const unpaid = whoHasntPaid(players);

  return (
    <Card
      testID={testID}
      padded={false}
      onPress={onPress ?? (() => openBookingDetail(booking.id, router))}
      accessibilityLabel={`Next game, ${name}, ${when}`}
    >
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
        {players.length > 0 ? (
          <View testID="next-game-roster" style={styles.rosterRow}>
            <AvatarStack people={players.map((p) => ({ id: p.share_id, name: rosterName(p) }))} />
            <Text variant="callout" tone="inkMuted" tabular>
              {`${players.length} in`}
            </Text>
          </View>
        ) : null}
        {unpaid.length > 0 ? (
          <View testID="next-game-unpaid" style={styles.rosterRow}>
            <StatusPill status="unpaid" />
            <Text variant="callout" style={styles.titleText}>
              {`Not paid yet: ${unpaid.join(', ')}`}
            </Text>
          </View>
        ) : null}
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
  rosterRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.xs },
});
