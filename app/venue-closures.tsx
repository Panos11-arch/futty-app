// The venue dashboard's setup screen for days closed to new bookings (P6e).
import { ClosuresView } from '@/components/venue/closures-view';
import { VenueScreen } from '@/components/venue/venue-screen';

export default function VenueClosuresScreen() {
  return <VenueScreen title="Closures">{(venueId) => <ClosuresView venueId={venueId} />}</VenueScreen>;
}
