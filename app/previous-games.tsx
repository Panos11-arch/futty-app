import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BookingResultForm } from '@/components/booking-result-form';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { FuttyColors, FuttyFonts } from '@/constants/futty-theme';
import { dateKeyAndTimeToDate } from '@/lib/days';
import { useMyUnscoredBookings } from '@/lib/use-my-bookings';
import { useVenues } from '@/lib/use-venues';

/** The overflow behind the home screen's "View all" link — every plain
 *  booking (no opponent team) you've made that's ended with no result
 *  logged yet, not just the couple shown inline there. */
export default function PreviousGamesScreen() {
  const unscoredBookings = useMyUnscoredBookings();
  const venuesState = useVenues();

  useFocusEffect(
    useCallback(() => {
      unscoredBookings.reload();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
  );

  function venueNameFor(venueId: string) {
    return venuesState.status === 'ready'
      ? (venuesState.venues.find((v) => v.id === venueId)?.name ?? 'Booked venue')
      : 'Booked venue';
  }

  const sorted =
    unscoredBookings.status === 'ready'
      ? [...unscoredBookings.bookings].sort(
          (a, b) =>
            dateKeyAndTimeToDate(b.booking_day, b.start_time).getTime() -
            dateKeyAndTimeToDate(a.booking_day, a.start_time).getTime()
        )
      : [];

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        {unscoredBookings.status === 'loading' ? <ActivityIndicator /> : null}
        {unscoredBookings.status === 'error' ? (
          <Text style={styles.note}>Could not load: {unscoredBookings.message}</Text>
        ) : null}
        {unscoredBookings.status === 'ready' && sorted.length === 0 ? (
          <View style={styles.emptyRow}>
            <IconSymbol name="checkmark.circle.fill" size={12} color={FuttyColors.stone400} />
            <Text style={styles.note}>Nothing left to log — you&apos;re all caught up.</Text>
          </View>
        ) : null}
        {sorted.map((booking) => (
          <View key={booking.id} style={styles.card}>
            <BookingResultForm
              booking={booking}
              venueName={venueNameFor(booking.venue_id)}
              onSubmitted={unscoredBookings.reload}
            />
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  content: {
    gap: 10,
    padding: 16,
    paddingBottom: 48,
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
