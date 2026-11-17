// The venue dashboard's setup screen for the venue's amenities (P6e).
import { AmenitiesView } from '@/components/venue/amenities-view';
import { VenueScreen } from '@/components/venue/venue-screen';

export default function VenueAmenitiesScreen() {
  return <VenueScreen title="Amenities">{(venueId) => <AmenitiesView venueId={venueId} />}</VenueScreen>;
}
