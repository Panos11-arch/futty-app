
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BookingResultForm } from '@/components/booking-result-form';
import { Banner } from '@/components/ui/banner';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { ListRow } from '@/components/ui/list-row';
import { SkeletonText } from '@/components/ui/skeleton';
import { colors, space } from '@/constants/futty-theme';
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
      {unscoredBookings.status === 'loading' || matchLinks.status === 'loading' ? (
        <Card testID="previous-games-skeleton">
          <SkeletonText lines={3} />
        </Card>
      ) : null}
      {unscoredBookings.status === 'error' ? (
        <Banner
          tone="danger"
          message={`Could not load: ${unscoredBookings.message}`}
          action={{ label: 'Try again', onPress: unscoredBookings.reload }}
        />
      ) : null}
      {matchLinks.status === 'error' ? (
        <Banner
          tone="danger"
          message="Could not load your matches."
          action={{ label: 'Try again', onPress: matchLinks.reload }}
        />
      ) : null}
      {unscoredBookings.status === 'ready' && matchLinks.status === 'ready' && sorted.length === 0 ? (
        <EmptyState icon="checkmark.circle.fill" message="Nothing left to log — you’re all caught up." />
      ) : null}
      {sorted.map((booking) => {
        const matchId = matchLinks.links.byBookingId.get(booking.id);
        return matchId ? (
          <Card key={booking.id} padded={false}>
            <ListRow
              title={venueNameFor(booking.venue_id)}
              subtitle={`${formatMatchWhen(cyprusWallTime(booking.booking_day, booking.start_time.slice(0, 5)).toISOString())} · enter or check the result`}
              leading={{ icon: 'sportscourt.fill' }}
              chevron
              onPress={() => router.push({ pathname: '/match/[id]', params: { id: matchId } })}
            />
          </Card>
        ) : (
          <Card key={booking.id}>
            <BookingResultForm
              booking={booking}
              venueName={venueNameFor(booking.venue_id)}
              onSubmitted={unscoredBookings.reload}
            />
          </Card>
        );
      })}
    </View>
  );
}

/** The overflow behind the home screen's "View all" link, not just the
 *  couple shown inline there. */
export default function PreviousGamesScreen() {
  return (
    <SafeAreaView style={styles.screen} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <PreviousGamesList />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, paddingBottom: space.xxl },
  list: { gap: space.md },
});
