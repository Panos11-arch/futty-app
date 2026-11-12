// My Bookings: each upcoming booking opens its detail (app/booking/[id].tsx).
// The list and the ?booking= link are components/booking/my-bookings-view.tsx.
import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MyBookingsView } from '@/components/booking/my-bookings-view';
import { colors, space } from '@/constants/futty-theme';
import { linkedBookingId, openBookingDetail } from '@/lib/booking-navigation';
import { useMyBookings } from '@/lib/use-my-bookings';
import { useVenues } from '@/lib/use-venues';

export default function MyBookingsScreen() {
  // "Open in Futty" from a calendar event (lib/calendar, BOOKING_LINK_PATH).
  const { booking } = useLocalSearchParams<{ booking?: string }>();
  const bookings = useMyBookings();
  const venuesState = useVenues();
  const venues = venuesState.status === 'ready' ? venuesState.venues : [];

  return (
    <SafeAreaView style={styles.flex} edges={['bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <MyBookingsView
          bookings={bookings}
          venues={venues}
          linkedBooking={linkedBookingId(booking)}
          onOpen={(id) => openBookingDetail(id, router)}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.canvas },
  content: { padding: space.lg, paddingBottom: space.xxl },
});
