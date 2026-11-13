// My Bookings (P5b): each upcoming booking is a row that opens its detail
// (app/booking/[id].tsx), where the roster, invite, Need players / Need
// opposition and Cancel (with what happens to the money shown first) live.
// "Open in Futty" from a calendar event lands here with ?booking=<id> and
// goes straight to that booking.
import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import { EmptyState, ListRow, SkeletonBlock } from '@/components/ui';
import { space } from '@/constants/futty-theme';
import { dateKeyToDate, dayLabel } from '@/lib/days';
import type { useMyBookings } from '@/lib/use-my-bookings';
import type { Venue } from '@/lib/use-venues';

export type MyBookingsViewProps = {
  bookings: ReturnType<typeof useMyBookings>;
  venues: Pick<Venue, 'id' | 'name' | 'city'>[];
  /** The ?booking= id from a calendar link, or null. */
  linkedBooking: string | null;
  onOpen: (bookingId: string) => void;
};

export function MyBookingsView({ bookings, venues, linkedBooking, onOpen }: MyBookingsViewProps) {
  const openRef = useRef(onOpen);
  openRef.current = onOpen;
  useEffect(() => {
    if (linkedBooking) openRef.current(linkedBooking);
  }, [linkedBooking]);

  if (bookings.status === 'loading') {
    return (
      <View style={styles.list}>
        <SkeletonBlock width="100%" height={56} />
        <SkeletonBlock width="100%" height={56} />
      </View>
    );
  }
  if (bookings.status === 'error') {
    return (
      <EmptyState
        icon="exclamationmark.circle.fill"
        message={`Could not load your bookings: ${bookings.message}`}
        action={{ label: 'Try again', onPress: bookings.reload }}
      />
    );
  }
  if (bookings.bookings.length === 0) {
    return <EmptyState icon="sportscourt.fill" message="No upcoming bookings. Book a pitch to see it here." />;
  }

  return (
    <View style={styles.list}>
      {bookings.bookings.map((booking) => {
        const venue = venues.find((v) => v.id === booking.venue_id);
        const when = `${dayLabel(dateKeyToDate(booking.booking_day))} · ${booking.start_time.slice(0, 5)}–${booking.end_time.slice(0, 5)}`;
        return (
          <ListRow
            key={booking.id}
            testID={`booking-${booking.id}`}
            title={venue?.name ?? 'Unknown venue'}
            subtitle={`${venue?.city ? `${venue.city} · ` : ''}${when} · ${booking.format}`}
            leading={{ icon: 'sportscourt.fill' }}
            chevron
            onPress={() => onOpen(booking.id)}
            accessibilityLabel={`Open booking at ${venue?.name ?? 'venue'}, ${when}`}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
});
