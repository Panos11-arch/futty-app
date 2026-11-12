import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BookingResultForm } from '@/components/booking-result-form';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { ListRow } from '@/components/ui/list-row';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { dateKeyAndTimeToDate } from '@/lib/days';
import { cyprusWallTime } from '@/lib/calendar/cyprus-time';
import { formatMatchWhen } from '@/lib/match/format';
import { useMatchLinks } from '@/lib/match/use-match-result';
import { useMyUnscoredBookings } from '@/lib/use-my-bookings';
import { useVenues } from '@/lib/use-venues';

/** Every plain booking (no opponent team) you've made that's ended with no
 *  result logged yet. No scrolling of its own: the screen below (the
 *  overflow behind Home's "View all" link) and Play's Matches segment
 *  (app/(tabs)/play.tsx) each wrap it. */
export function PreviousGamesList() {
  const unscoredBookings = useMyUnscoredBookings();
  const venuesState = useVenues();
  const matchLinks = useMatchLinks({
    bookingIds: unscoredBookings.status === 'ready' ? unscoredBookings.bookings.map((b) => b.id) : [],
  });

  useFocusEffect(
    useCallback(() => {
      unscoredBookings.reload();
      matchLinks.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  function venueNameFor(venueId: string) {
    return venuesState.status === 'ready'
      ? (venuesState.venues.find((v) => v.id === venueId)?.name ?? 'Booked venue')
      : 'Booked venue';
  }

  // A booking with a match (made since A2) is scored in the match screen,
  // never with the old form; wait until we know which ones have one.
  const sorted =
    unscoredBookings.status === 'ready' && matchLinks.status === 'ready'
      ? [...unscoredBookings.bookings].sort(
          (a, b) =>
            dateKeyAndTimeToDate(b.booking_day, b.start_time).getTime() -
            dateKeyAndTimeToDate(a.booking_day, a.start_time).getTime()
        )
      : [];

  return (
    <View style={styles.list}>
      {unscoredBookings.status === 'loading' || matchLinks.status === 'loading' ? <ActivityIndicator /> : null}
      {unscoredBookings.status === 'error' ? (
        <Text style={styles.note}>Could not load: {unscoredBookings.message}</Text>
      ) : null}
      {matchLinks.status === 'error' ? (
        <Text style={styles.note} onPress={matchLinks.reload}>
          Could not load your matches. Tap to try again.
        </Text>
      ) : null}
      {unscoredBookings.status === 'ready' && matchLinks.status === 'ready' && sorted.length === 0 ? (
        <View style={styles.emptyRow}>
          <IconSymbol name="checkmark.circle.fill" size={12} color={FuttyColors.stone400} />
          <Text style={styles.note}>Nothing left to log — you&apos;re all caught up.</Text>
        </View>
      ) : null}
      {sorted.map((booking) => {
        const matchId = matchLinks.links.byBookingId.get(booking.id);
        return matchId ? (
          <View key={booking.id} style={styles.card}>
            <ListRow
              title={venueNameFor(booking.venue_id)}
              subtitle={`${formatMatchWhen(cyprusWallTime(booking.booking_day, booking.start_time.slice(0, 5)).toISOString())} · enter or check the result`}
              leading={{ icon: 'sportscourt.fill' }}
              chevron
              onPress={() => router.push({ pathname: '/match/[id]', params: { id: matchId } })}
            />
          </View>
        ) : (
        <View key={booking.id} style={styles.card}>
          <BookingResultForm
            booking={booking}
            venueName={venueNameFor(booking.venue_id)}
            onSubmitted={unscoredBookings.reload}
          />
        </View>
        );
      })}
    </View>
  );
}

/** The overflow behind the home screen's "View all" link, not just the
 *  couple shown inline there. */
export default function PreviousGamesScreen() {
  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <PreviousGamesList />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingBottom: 48,
  },
  list: {
    gap: 10,
  },
  note: {
    fontFamily: FuttyFonts.sans,
    fontSize: 12,
    opacity: 0.7,
  },
  emptyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  card: {
    borderWidth: 1,
    borderColor: FuttyColors.stone200,
    borderRadius: 12,
    padding: 12,
  },
});
