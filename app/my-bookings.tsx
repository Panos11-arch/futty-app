// My Bookings: each upcoming booking opens its detail (app/booking/[id].tsx),
// where the roster, invite, Need players / Need opposition and Cancel (with
// what happens to the money shown first) live.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { EmptyState, ListRow, SkeletonBlock } from '@/components/ui';
import { colors, space } from '@/constants/futty-theme';
import { dateKeyToDate, dayLabel } from '@/lib/days';
import { useMyBookings } from '@/lib/use-my-bookings';
import { useVenues, type Venue } from '@/lib/use-venues';

function openBooking(id: string) {
  router.push({ pathname: '/booking/[id]', params: { id } });
}

function MyBookingsList({ venues }: { venues: Venue[] }) {
  const myBookings = useMyBookings();

  if (myBookings.status === 'loading') {
    return (
      <View style={styles.list}>
        <SkeletonBlock width="100%" height={56} />
        <SkeletonBlock width="100%" height={56} />
      </View>
    );
  }
  if (myBookings.status === 'error') {
    return (
      <EmptyState
        icon="exclamationmark.circle.fill"
        message={`Could not load your bookings: ${myBookings.message}`}
        action={{ label: 'Try again', onPress: myBookings.reload }}
      />
    );
  }
  if (myBookings.bookings.length === 0) {
    return <EmptyState icon="sportscourt.fill" message="No upcoming bookings. Book a pitch to see it here." />;
  }

  return (
    <View style={styles.list}>
      {myBookings.bookings.map((booking) => {
        const venue = venues.find((v) => v.id === booking.venue_id);
        const when = `${dayLabel(dateKeyToDate(booking.booking_day))} · ${booking.start_time.slice(0, 5)}–${booking.end_time.slice(0, 5)}`;
        return (
          <ListRow
            key={booking.id}
            title={venue?.name ?? 'Unknown venue'}
            subtitle={`${venue?.city ? `${venue.city} · ` : ''}${when} · ${booking.format}`}
            leading={{ icon: 'sportscourt.fill' }}
            chevron
            onPress={() => openBooking(booking.id)}
            accessibilityLabel={`Open booking at ${venue?.name ?? 'venue'}, ${when}`}
          />
        );
      })}
    </View>
  );
}

export default function MyBookingsScreen() {
  // "Open in Futty" from a calendar event (lib/calendar, BOOKING_LINK_PATH)
  // lands here with ?booking=<id>: go straight to that booking.
  const { booking } = useLocalSearchParams<{ booking?: string }>();
  useEffect(() => {
    if (booking) openBooking(booking);
  }, [booking]);

  const venuesState = useVenues();
  const venues = venuesState.status === 'ready' ? venuesState.venues : [];

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <MyBookingsList venues={venues} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, paddingBottom: space.xxl },
  list: { gap: space.sm },
});
