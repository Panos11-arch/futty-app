// Home's "Upcoming matches" (image 01): the player's next bookings, each a
// NextBookingCard (P5; S5A adds its amenity icons and "After-game offers").
// A card opens the booking. Hidden when nothing is booked: Book a pitch is
// right above.
import { router } from 'expo-router';
import { View } from 'react-native';

import { NextBookingCard } from '@/components/booking/next-game-card';
import { InlineError } from '@/components/home/inline-error';
import { useReloadOn, useReloadOnRefocus } from '@/components/home/refresh';
import { SectionHeader } from '@/components/ui/section-header';
import { SkeletonBlock, SkeletonText } from '@/components/ui/skeleton';
import { space } from '@/constants/futty-theme';
import { makeStyles } from '@/lib/theme';
import { useMyBookings } from '@/lib/use-my-bookings';
import { useVenues } from '@/lib/use-venues';

/** How many of the next bookings Home shows; the rest are in My bookings. */
export const UPCOMING_SHOWN = 3;

export function UpcomingMatches({ refreshSignal }: { refreshSignal: number }) {
  const styles = useStyles();
  const myBookings = useMyBookings();
  const venuesState = useVenues();

  // Home stays mounted behind My bookings: a cancel there must show here.
  useReloadOnRefocus(myBookings.reload);
  useReloadOn(refreshSignal, () => {
    myBookings.reload();
    venuesState.reload();
  });

  function venueFor(venueId: string) {
    const venue = venuesState.status === 'ready' ? venuesState.venues.find((v) => v.id === venueId) : null;
    return venue ? { name: venue.name, city: venue.city } : null;
  }

  if (myBookings.status === 'loading') {
    return (
      <View testID="next-game-skeleton" style={styles.section}>
        <SkeletonText lines={1} variant="headline" />
        <SkeletonBlock width="100%" height={space.xxl * 5} />
      </View>
    );
  }
  if (myBookings.status === 'error') {
    return (
      <View style={styles.section}>
        <SectionHeader title="Upcoming matches" />
        <InlineError message="Could not load your bookings." onRetry={myBookings.reload} />
      </View>
    );
  }
  if (myBookings.bookings.length === 0) return null;

  const shown = myBookings.bookings.slice(0, UPCOMING_SHOWN);
  return (
    <View testID="home-upcoming" style={styles.section}>
      <SectionHeader
        title="Upcoming matches"
        action={
          myBookings.bookings.length > shown.length
            ? { label: 'See all', onPress: () => router.push('/my-bookings') }
            : undefined
        }
      />
      {shown.map((booking) => (
        // No photo block on Home (image 01; Dimitris, 26 November).
        <NextBookingCard
          key={booking.id}
          testID={`home-upcoming-${booking.id}`}
          booking={booking}
          venue={venueFor(booking.venue_id)}
          showPhoto={false}
        />
      ))}
    </View>
  );
}

const useStyles = makeStyles(() => ({
  section: { gap: space.md },
}));
