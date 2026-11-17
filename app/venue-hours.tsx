// The venue dashboard's setup screen for opening hours, one row a day (P6e).
import { HoursView } from '@/components/venue/hours-view';
import { VenueScreen } from '@/components/venue/venue-screen';

export default function VenueHoursScreen() {
  return <VenueScreen title="Opening hours">{(venueId) => <HoursView venueId={venueId} />}</VenueScreen>;
}
