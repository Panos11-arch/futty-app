// The venue dashboard's Bookings list (P6d): source and status filters and a date range.
import { BookingsListView } from '@/components/venue/bookings-list-view';
import { VenueScreen } from '@/components/venue/venue-screen';

export default function VenueBookingsScreen() {
  return <VenueScreen title="Bookings">{(venueId) => <BookingsListView venueId={venueId} />}</VenueScreen>;
}
